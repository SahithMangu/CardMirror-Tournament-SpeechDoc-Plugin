#!/usr/bin/env python3

import atexit
import getpass
import json
import os
import plistlib
import secrets
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_ID = "tabroom-bridge"
APP_NAME = "Tabroom Bridge"
APP_VERSION = "1.0.0"
REPO = "SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin"
UPDATE_CHECK_INTERVAL = 24 * 3600
BRIDGE_SCHEMA = 1
TOKEN_HEADER = "X-Bridge-Token"

API = "https://api.opencaselist.com/v1"
KEYCHAIN_SERVICE = "tabroom-bridge-opencaselist"
AGENT_LABEL = "com.tabroombridge.helper"
# Labels this helper used to install under. Installing or uninstalling must
# clear these too, or launchd keeps the old agent alive alongside the new one
# and two helpers fight over the same bridge registration files.
LEGACY_AGENT_LABELS = ("com.sahith.tabroom-bridge",)
ROUNDS_TTL = 45.0
MIN_UPSTREAM_INTERVAL = 10.0
BUDGET_WINDOW = 15 * 60.0
BUDGET_MAX = 120
RATE_BACKOFF = 90.0
LOGIN_MAX_PER_HOUR = 5
LOGIN_BACKOFF_STEPS = [60.0, 300.0, 900.0, 3600.0]
LOGIN_BREAKER_FAILURES = 5

SESSION_TOKEN = secrets.token_hex(32)


def bridge_dir() -> Path:
    override = os.environ.get("CARDMIRROR_BRIDGE_DIR")
    if override:
        return Path(override)
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "cardmirror-bridge"
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "cardmirror-bridge"
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "cardmirror-bridge"


def state_dir() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "tabroom-bridge"
    return Path.home() / ".config" / "tabroom-bridge"


def read_state() -> dict:
    try:
        return json.loads((state_dir() / "state.json").read_text())
    except Exception:
        return {}


def write_state(data: dict) -> None:
    d = state_dir()
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except Exception:
        pass
    p = d / "state.json"
    p.write_text(json.dumps(data))
    try:
        os.chmod(p, 0o600)
    except Exception:
        pass


def log(msg: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{stamp}] {msg}", flush=True)


class Credentials:
    def available(self) -> bool:
        return self.load() is not None

    def load(self):
        if sys.platform == "darwin":
            state = read_state()
            account = state.get("username")
            if not account:
                return None
            try:
                out = subprocess.run(
                    [
                        "security",
                        "find-generic-password",
                        "-s",
                        KEYCHAIN_SERVICE,
                        "-a",
                        account,
                        "-w",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
            except Exception:
                return None
            if out.returncode != 0:
                return None
            return account, out.stdout.rstrip("\n")
        state = read_state()
        if state.get("username") and state.get("password"):
            return state["username"], state["password"]
        return None

    def store(self, username: str, password: str) -> None:
        state = read_state()
        state["username"] = username
        if sys.platform == "darwin":
            subprocess.run(
                [
                    "security",
                    "add-generic-password",
                    "-s",
                    KEYCHAIN_SERVICE,
                    "-a",
                    username,
                    "-w",
                    password,
                    "-U",
                ],
                capture_output=True,
                timeout=10,
            )
            state.pop("password", None)
        else:
            state["password"] = password
        write_state(state)

    def forget(self) -> None:
        state = read_state()
        account = state.get("username")
        if sys.platform == "darwin" and account:
            subprocess.run(
                ["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
                capture_output=True,
                timeout=10,
            )
        write_state({})


credentials = Credentials()


class Budget:
    def __init__(self, window: float, maximum: int):
        self.window = window
        self.maximum = maximum
        self.hits = []
        self.last_call = 0.0

    def prune(self, now: float) -> None:
        cutoff = now - self.window
        self.hits = [h for h in self.hits if h > cutoff]

    def check(self, now: float):
        self.prune(now)
        since = now - self.last_call
        if since < MIN_UPSTREAM_INTERVAL:
            return int(MIN_UPSTREAM_INTERVAL - since) + 1
        if len(self.hits) >= self.maximum:
            return int(self.hits[0] + self.window - now) + 1
        return None

    def consume(self, now: float) -> None:
        self.hits.append(now)
        self.last_call = now

    def remaining(self) -> int:
        self.prune(time.time())
        return max(0, self.maximum - len(self.hits))


class Caselist:
    def __init__(self):
        self.lock = threading.RLock()
        state = read_state()
        self.token = state.get("token")
        self.expires = state.get("expires", 0)
        self.rounds_cache = None
        self.rounds_at = 0.0
        self.blocked_until = 0.0
        self.budget = Budget(BUDGET_WINDOW, BUDGET_MAX)
        self.login_attempts = []
        self.login_failures = int(state.get("loginFailures", 0))
        self.login_blocked_until = 0.0
        self.breaker_tripped = self.login_failures >= LOGIN_BREAKER_FAILURES

    def save_token(self) -> None:
        state = read_state()
        state["token"] = self.token
        state["expires"] = self.expires
        write_state(state)

    def logged_in(self) -> bool:
        return bool(self.token) and time.time() < self.expires

    def login_allowed(self):
        now = time.time()
        if self.breaker_tripped:
            return "credentials rejected repeatedly; run with --login to reset"
        if now < self.login_blocked_until:
            return f"backing off for {int(self.login_blocked_until - now)}s"
        self.login_attempts = [a for a in self.login_attempts if a > now - 3600]
        if len(self.login_attempts) >= LOGIN_MAX_PER_HOUR:
            return "hourly login cap reached"
        return None

    def note_login_result(self, ok: bool) -> None:
        state = read_state()
        if ok:
            self.login_failures = 0
            self.login_blocked_until = 0.0
            self.breaker_tripped = False
        else:
            self.login_failures += 1
            step = LOGIN_BACKOFF_STEPS[
                min(self.login_failures - 1, len(LOGIN_BACKOFF_STEPS) - 1)
            ]
            self.login_blocked_until = time.time() + step
            if self.login_failures >= LOGIN_BREAKER_FAILURES:
                self.breaker_tripped = True
                log("login breaker tripped; stopping automatic retries")
        state["loginFailures"] = self.login_failures
        write_state(state)

    def login(self, username: str, password: str) -> dict:
        self.login_attempts.append(time.time())
        payload = json.dumps(
            {"username": username, "password": password, "remember": True}
        ).encode()
        req = urllib.request.Request(
            f"{API}/login",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                body = json.loads(res.read().decode())
        except urllib.error.HTTPError as e:
            if e.code != 429:
                self.note_login_result(False)
            else:
                self.login_blocked_until = time.time() + RATE_BACKOFF
            return {"ok": False, "status": e.code, "error": e.read().decode(errors="replace")}
        except Exception as e:
            return {"ok": False, "status": 0, "error": str(e)}

        self.note_login_result(True)
        self.token = body.get("token")
        self.expires = time.time() + 13 * 24 * 3600
        self.save_token()
        self.rounds_cache = None
        log(f"logged in as {username}")
        return {"ok": True, "userId": body.get("userId"), "trusted": body.get("trusted")}

    def ensure_session(self) -> bool:
        with self.lock:
            if self.logged_in():
                return True
            blocked = self.login_allowed()
            if blocked:
                return False
            creds = credentials.load()
            if not creds:
                return False
            log("token expired, re-authenticating")
            return bool(self.login(creds[0], creds[1]).get("ok"))

    def drop_session(self) -> None:
        self.token = None
        self.expires = 0
        self.rounds_cache = None
        self.save_token()

    def rounds(self, current: bool, force: bool, retried: bool = False) -> dict:
        with self.lock:
            now = time.time()
            if now < self.blocked_until:
                return {
                    "ok": False,
                    "error": "rate-limited",
                    "retryAfter": int(self.blocked_until - now),
                }
            if not self.ensure_session():
                return {"ok": False, "error": "not-logged-in"}

            key = bool(current)
            if (
                not force
                and self.rounds_cache is not None
                and self.rounds_cache[0] == key
                and now - self.rounds_at < ROUNDS_TTL
            ):
                return {"ok": True, "rounds": self.rounds_cache[1], "cached": True}

            wait = self.budget.check(now)
            if wait is not None:
                if self.rounds_cache is not None and self.rounds_cache[0] == key:
                    return {
                        "ok": True,
                        "rounds": self.rounds_cache[1],
                        "cached": True,
                        "stale": True,
                        "retryAfter": wait,
                    }
                return {"ok": False, "error": "throttled", "retryAfter": wait}
            self.budget.consume(now)

            url = f"{API}/tabroom/rounds"
            if key:
                url += "?current=true"
            req = urllib.request.Request(
                url, headers={"Cookie": f"caselist_token={self.token}"}
            )
            try:
                with urllib.request.urlopen(req, timeout=20) as res:
                    rounds = json.loads(res.read().decode())
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    self.drop_session()
                    if retried or not self.ensure_session():
                        return {"ok": False, "error": "not-logged-in"}
                    return self.rounds(current, True, retried=True)
                if e.code == 429:
                    try:
                        retry = float(e.headers.get("Retry-After") or RATE_BACKOFF)
                    except Exception:
                        retry = RATE_BACKOFF
                    retry = max(retry, RATE_BACKOFF)
                    self.blocked_until = now + retry
                    log(f"429 from openCaselist; pausing {int(retry)}s")
                    return {"ok": False, "error": "rate-limited", "retryAfter": int(retry)}
                return {"ok": False, "error": f"http-{e.code}"}
            except Exception as e:
                return {"ok": False, "error": str(e)}

            if not isinstance(rounds, list):
                rounds = []
            self.rounds_cache = (key, rounds)
            self.rounds_at = now
            return {"ok": True, "rounds": rounds, "cached": False}


caselist = Caselist()


class Updater:
    def __init__(self):
        self.lock = threading.Lock()
        self.latest = None
        self.checked_at = 0.0

    @staticmethod
    def newer(a: str, b: str) -> bool:
        def parts(v):
            return [int(x) if x.isdigit() else 0 for x in str(v).lstrip("v").split(".")]
        pa, pb = parts(a), parts(b)
        for i in range(max(len(pa), len(pb))):
            x = pa[i] if i < len(pa) else 0
            y = pb[i] if i < len(pb) else 0
            if x != y:
                return x > y
        return False

    def check(self, force: bool = False):
        with self.lock:
            now = time.time()
            if not force and now - self.checked_at < UPDATE_CHECK_INTERVAL:
                return self.latest
            self.checked_at = now
            req = urllib.request.Request(
                f"https://api.github.com/repos/{REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "tabroom-bridge"},
            )
            try:
                with urllib.request.urlopen(req, timeout=15) as res:
                    data = json.loads(res.read().decode())
            except Exception as e:
                log(f"update check failed: {e}")
                return self.latest
            tag = str(data.get("tag_name") or "").lstrip("v")
            asset = None
            for a in data.get("assets", []):
                if a.get("name") == "tabroom_bridge.py":
                    asset = a.get("browser_download_url")
                    break
            self.latest = {"version": tag, "url": asset} if tag and asset else None
            return self.latest

    def available(self) -> bool:
        info = self.latest
        return bool(info and self.newer(info["version"], APP_VERSION))

    def apply(self) -> dict:
        info = self.check(force=True)
        if not info:
            return {"ok": False, "error": "no-release-found"}
        if not self.newer(info["version"], APP_VERSION):
            return {"ok": False, "error": "already-current", "version": APP_VERSION}
        req = urllib.request.Request(
            info["url"], headers={"User-Agent": "tabroom-bridge"}
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                source = res.read().decode()
        except Exception as e:
            return {"ok": False, "error": f"download-failed: {e}"}

        if "APP_ID" not in source or len(source) < 5000:
            return {"ok": False, "error": "downloaded file does not look like the helper"}
        try:
            compile(source, "tabroom_bridge.py", "exec")
        except SyntaxError as e:
            return {"ok": False, "error": f"downloaded file failed to parse: {e}"}

        target = Path(__file__).resolve()
        # Installers before 1.2.1 pointed the LaunchAgent at the root-owned
        # copy in /usr/local/lib, which the agent (running as the user) cannot
        # rewrite. Say so plainly instead of surfacing a bare EACCES.
        if not os.access(target, os.W_OK) or not os.access(target.parent, os.W_OK):
            return {
                "ok": False,
                "error": "read-only-install",
                "detail": (
                    f"This helper runs from {target}, which it does not have "
                    "permission to modify, so it cannot update itself. "
                    "Reinstall TabroomBridge.pkg from the latest release once; "
                    "after that, updates apply automatically."
                ),
                "version": APP_VERSION,
                "latestVersion": info["version"],
            }

        staged = target.with_suffix(".py.new")
        try:
            staged.write_text(source)
            os.chmod(staged, 0o755)
            staged.replace(target)
        except Exception as e:
            try:
                staged.unlink()
            except Exception:
                pass
            return {"ok": False, "error": f"could not write update: {e}"}

        log(f"updated to {info['version']}; restarting")
        threading.Timer(1.0, lambda: os._exit(0)).start()
        return {"ok": True, "version": info["version"]}


updater = Updater()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def authorized(self) -> bool:
        return self.headers.get(TOKEN_HEADER) == SESSION_TOKEN

    def send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.authorized():
            self.send_json(401, {"error": "bad-token"})
            return
        if self.path.split("?")[0] == "/ping":
            self.send_json(200, {"ok": True, "app": APP_ID, "version": APP_VERSION})
            return
        self.send_json(404, {"error": "no-such-route"})

    def do_POST(self):
        if not self.authorized():
            self.send_json(401, {"error": "bad-token"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode() or "{}")
        except Exception:
            body = {}
        route = self.path.split("?")[0]

        if route == "/ping":
            self.send_json(200, {"ok": True, "app": APP_ID, "version": APP_VERSION})
        elif route == "/status":
            self.send_json(
                200,
                {
                    "ok": True,
                    "loggedIn": caselist.logged_in(),
                    "hasCredentials": credentials.available(),
                    "expires": caselist.expires,
                    "budgetRemaining": caselist.budget.remaining(),
                    "budgetMax": BUDGET_MAX,
                    "loginBreaker": caselist.breaker_tripped,
                    "version": APP_VERSION,
                    "updateAvailable": updater.available(),
                    "latestVersion": (updater.latest or {}).get("version"),
                },
            )
        elif route == "/rounds":
            self.send_json(
                200,
                caselist.rounds(
                    current=body.get("current", True), force=bool(body.get("force"))
                ),
            )
        elif route == "/login":
            username = str(body.get("username") or "").strip()
            password = str(body.get("password") or "")
            if not username or not password:
                self.send_json(200, {"ok": False, "error": "missing-credentials"})
                return
            blocked = caselist.login_allowed()
            if blocked and "cap" in blocked:
                self.send_json(200, {"ok": False, "error": blocked})
                return
            caselist.breaker_tripped = False
            caselist.login_blocked_until = 0.0
            result = caselist.login(username, password)
            if result.get("ok"):
                credentials.store(username, password)
                self.send_json(200, {"ok": True, "userId": result.get("userId")})
            else:
                message = result.get("error") or "login failed"
                try:
                    parsed = json.loads(message)
                    message = parsed.get("message") or message
                except Exception:
                    pass
                self.send_json(
                    200, {"ok": False, "error": message, "status": result.get("status")}
                )
        elif route == "/check-update":
            info = updater.check(force=bool(body.get("force")))
            self.send_json(
                200,
                {
                    "ok": True,
                    "version": APP_VERSION,
                    "latestVersion": (info or {}).get("version"),
                    "updateAvailable": updater.available(),
                },
            )
        elif route == "/self-update":
            self.send_json(200, updater.apply())
        elif route == "/logout":
            caselist.drop_session()
            credentials.forget()
            self.send_json(200, {"ok": True})
        else:
            self.send_json(404, {"error": "no-such-route"})


def write_handshake(port: int) -> None:
    d = bridge_dir()
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except Exception:
        pass

    identity = d / f"{APP_ID}.json"
    identity.write_text(
        json.dumps(
            {
                "schema": BRIDGE_SCHEMA,
                "app": APP_NAME,
                "appVersion": APP_VERSION,
                "kind": "flow",
            }
        )
    )
    session = d / f"{APP_ID}.session.json"
    session.write_text(
        json.dumps({"port": port, "token": SESSION_TOKEN, "pid": os.getpid()})
    )
    for f in (identity, session):
        try:
            os.chmod(f, 0o600)
        except Exception:
            pass


def clear_session() -> None:
    try:
        (bridge_dir() / f"{APP_ID}.session.json").unlink()
    except Exception:
        pass


def support_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "tabroom-bridge"
    return state_dir()


def agent_plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{AGENT_LABEL}.plist"


def resolve_python() -> str:
    exe = sys.executable or ""
    if "/Cellar/" in exe or "/.pyenv/" in exe or "/venv/" in exe:
        for candidate in ("/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"):
            if Path(candidate).exists():
                return candidate
    return exe or "/usr/bin/python3"


def remove_legacy_agents() -> None:
    """Stop and delete agents installed under a previous label."""
    for label in LEGACY_AGENT_LABELS:
        path = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
        uid = os.getuid()
        subprocess.run(
            ["launchctl", "bootout", f"gui/{uid}/{label}"], capture_output=True
        )
        subprocess.run(["launchctl", "unload", str(path)], capture_output=True)
        try:
            path.unlink()
            print(f"Removed old helper agent: {label}")
        except FileNotFoundError:
            pass
        except Exception:
            pass


def install_agent() -> None:
    if sys.platform != "darwin":
        print("LaunchAgent install is macOS only.")
        sys.exit(1)

    remove_legacy_agents()

    home = support_dir()
    home.mkdir(parents=True, exist_ok=True)
    installed = home / "tabroom_bridge.py"
    source = Path(__file__).resolve()
    if source != installed:
        installed.write_text(source.read_text())
        os.chmod(installed, 0o700)

    logs = state_dir() / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    python = resolve_python()
    plist = {
        "Label": AGENT_LABEL,
        "ProgramArguments": [python, str(installed)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "StandardOutPath": str(logs / "bridge.log"),
        "StandardErrorPath": str(logs / "bridge.err.log"),
    }
    path = agent_plist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        plistlib.dump(plist, f)
    subprocess.run(["launchctl", "unload", str(path)], capture_output=True)
    result = subprocess.run(["launchctl", "load", str(path)], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"launchctl load failed: {result.stderr.strip()}")
        sys.exit(1)
    print(f"Installed to {installed}")
    print(f"Running in the background. Logs: {logs / 'bridge.log'}")


def uninstall_agent() -> None:
    remove_legacy_agents()
    path = agent_plist_path()
    subprocess.run(
        ["launchctl", "bootout", f"gui/{os.getuid()}/{AGENT_LABEL}"], capture_output=True
    )
    subprocess.run(["launchctl", "unload", str(path)], capture_output=True)
    try:
        path.unlink()
    except Exception:
        pass
    try:
        (support_dir() / "tabroom_bridge.py").unlink()
    except Exception:
        pass
    clear_session()
    print("Background helper removed.")


def agent_installed() -> bool:
    return agent_plist_path().exists()


def prompt_login() -> None:
    print("Log in with your Tabroom account (this goes to openCaselist, not Tabroom).")
    username = input("Tabroom email: ").strip()
    password = getpass.getpass("Password: ")
    result = caselist.login(username, password)
    if not result.get("ok"):
        print(f"Login failed ({result.get('status')}): {result.get('error')}")
        sys.exit(1)
    credentials.store(username, password)
    where = "the macOS Keychain" if sys.platform == "darwin" else "a 0600 config file"
    print(f"Logged in. Password stored in {where} so it can renew itself.")


def serve() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.socket.getsockname()[1]
    write_handshake(port)
    atexit.register(clear_session)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: sys.exit(0))
    log(f"listening on 127.0.0.1:{port}")
    if credentials.available():
        caselist.ensure_session()
    else:
        log("no credentials stored; waiting for sign-in from CardMirror")
    threading.Thread(target=lambda: updater.check(force=True), daemon=True).start()
    try:
        server.serve_forever()
    finally:
        clear_session()


def main() -> None:
    args = sys.argv[1:]
    if "--install-agent" in args:
        install_agent()
        return
    if "--uninstall-agent" in args:
        uninstall_agent()
        return
    if "--forget" in args:
        caselist.drop_session()
        credentials.forget()
        print("Credentials and token cleared.")
        return
    if "--login" in args:
        prompt_login()
    serve()


if __name__ == "__main__":
    main()
