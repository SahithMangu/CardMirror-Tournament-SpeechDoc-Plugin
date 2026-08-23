# Tabroom Rounds

A CardMirror plugin that creates speech documents named from your live Tabroom pairings.

Instead of typing `1AC Harvard Round 1 vs Ridge AM` by hand every round, pick the round from a list and the document is created and named for you. Same idea as Verbatim's speech-doc dropdown, built for CardMirror.

> **Works on macOS, Windows, and Linux.** Only the one-click installer is macOS-only — on Windows and Linux you start the helper yourself with one command and everything else behaves the same. See [Platform support](#platform-support).

## How it works

Tabroom has no public API for your own pairings. The path that works — and the one Verbatim uses — goes through openCaselist:

```
plugin  ->  local helper  ->  api.opencaselist.com/v1/tabroom/rounds  ->  Tabroom
```

The helper (`tabroom_bridge.py`) logs into openCaselist with your Tabroom credentials and serves your rounds over loopback. The plugin reaches it through CardMirror's `cardmirror-bridge` channel, so the renderer never sees a token or a socket.

A helper is needed because openCaselist authenticates with a `SameSite=Lax` cookie, and browsers refuse to send it cross-site — a plugin running inside CardMirror cannot set a `Cookie` header. A normal process can.

## Your data stays on your computer

**This plugin collects nothing. Not your login, not your rounds, not usage data — nothing is sent to the author or to any third party.** There is no analytics, no telemetry, no crash reporting, no "phone home". I have no server, and I cannot see that you are using this.

Everything runs on your own machine. In full, the only network connections anything here makes are:

| Connection | Why | What is sent |
| --- | --- | --- |
| `api.opencaselist.com` | Fetch **your own** pairings | Your openCaselist login, then your session token. This is the same site Verbatim uses, and the same account you already have. |
| `api.github.com` | Check whether a newer helper version exists | Nothing about you — just a public request for the latest release number. |
| `github.com` | Only if you click the download link in the "helper needed" dialog | Nothing — it opens this repo's releases page in your browser. |

That is the complete list. You can confirm it yourself:

```bash
grep -oE "https?://[a-zA-Z0-9./_-]+" tabroom_bridge.py plugin.js | sort -u
```

Specifics worth knowing:

- **Your password** is stored in the **macOS Keychain**, not in a file, and is used only to renew your openCaselist session when the two-week token expires. It is never written to disk in plain text and never leaves your machine except to log in to openCaselist.
- **The helper is not reachable from the internet.** It binds to `127.0.0.1` (loopback only) on a random port, and every request must carry a token that is regenerated each time it starts. Nothing outside your computer can reach it — not other machines on your Wi-Fi, not the tournament network.
- **Your rounds are never uploaded anywhere.** They are fetched from openCaselist, cached in memory for 45 seconds, and used to name a document.
- **Everything is readable.** The helper is a single Python file with no dependencies, and the plugin is a single JavaScript file. Both are in this repo, and both are short enough to read end to end.

To erase everything, including the saved login, see [Removing it](#removing-it).

## Platform support

**The installer is macOS-only. The plugin and the helper itself are not.**

| | Plugin | Helper runs | One-click install + autostart |
| --- | --- | --- | --- |
| **macOS** | yes | yes | yes — `TabroomBridge.pkg` |
| **Windows** | yes | yes, started manually | no |
| **Linux** | yes | yes, started manually | no |
| **CardMirror web edition** | no | — | — |

What is macOS-only is the *packaging*: the `.pkg`, the LaunchAgent that starts the helper at login, and storing your password in the Keychain.

**On why there is no Windows `.exe`:** I do not currently have a Windows machine, so I cannot build and *test* an installer, and I would rather ship no installer than an untested one. Windows support is otherwise real — the helper runs there fine, you just launch it yourself. A proper installer is planned if I get access to a Windows machine.

Everything underneath is portable. The helper is plain Python and already resolves the shared bridge directory correctly on all three platforms — `%APPDATA%\cardmirror-bridge` on Windows, `$XDG_DATA_HOME/cardmirror-bridge` (or `~/.local/share/...`) on Linux — matching where CardMirror looks. Step-by-step instructions are in [Windows and Linux](#windows-and-linux) below, written for people who have never opened a terminal.

**Requirement:** Python 3.9 or newer, which you may already have. Nothing else — the helper uses only Python's standard library, so there is never a `pip install` step. macOS ships with a suitable Python already; on Windows you install it once from [python.org](https://www.python.org/downloads/).

The web edition is genuinely out of scope: it has no Electron host, so `flowApps`/`flowPost` do not exist and there is no way to reach a local process at all.

## Install

There are two pieces: a **plugin** inside CardMirror, and a small **helper** that runs in the background. You need both. The helper exists because openCaselist authenticates with a cookie, and a plugin running inside CardMirror's browser engine is not allowed to send one.

### 1. The helper

#### macOS

Download **TabroomBridge.pkg** from the [latest release](../../releases/latest) and open it.

macOS blocks unsigned installers the first time, so right-click the pkg and choose **Open**, then confirm. You only do this once.

It installs a small background service that starts at login. No terminal, and no credentials up front — you sign in from inside CardMirror.

macOS already includes a Python new enough to run this, so there is normally nothing else to install. On a brand-new Mac that has never had developer tools, the installer may tell you Python is missing — if so, run `xcode-select --install` in Terminal, accept the Apple prompt, then open the pkg again.

The service uses no measurable CPU when idle, and settles at roughly 15 MB of memory (a little higher for the first minute or two after it starts). It only contacts openCaselist when you ask it for rounds.

<details>
<summary>Other install methods</summary>

**App bundle** — download `TabroomBridgeSetup.zip`, unzip, right-click **Tabroom Bridge Setup** and choose Open. Run it again later to reinstall or remove.

**Terminal**

```
python3 tabroom_bridge.py --install-agent
```

| Flag | Effect |
| --- | --- |
| `--install-agent` | Install and start the background helper (macOS) |
| `--uninstall-agent` | Stop and remove it |
| `--login` | Sign in from the terminal instead of in-app |
| `--forget` | Erase stored credentials and token |

Run with no flags to keep it in the foreground.

</details>

To remove it later: `python3 /usr/local/lib/tabroom-bridge/tabroom_bridge.py --uninstall-agent`

Logs: `~/.config/tabroom-bridge/logs/bridge.log`

#### Windows and Linux

> **There is no Windows installer, and I am sorry about that.** I do not own a Windows machine, so I have no way to build and actually *test* a `.exe` or `.msi` — and shipping an installer I have never run is a good way to break someone's computer the night before a tournament. The manual steps below do exactly what the Mac installer does. If I get access to a Windows machine, a proper installer is the first thing I will add.

Nothing about the plugin is worse on Windows or Linux. The only difference is that you start the helper yourself instead of an installer doing it for you.

**You will need Python.** That is the only requirement — this tool uses nothing but Python's built-in library, so there is no `pip install` step and nothing else to download.

<br>

**Step 1 — Install Python (if you do not have it)**

Windows: download it from **[python.org/downloads](https://www.python.org/downloads/)** and run the installer.

> ⚠️ On the very first screen of the Python installer, tick the box that says **"Add python.exe to PATH"** before clicking Install. It is easy to miss, and if you skip it the commands below will not work. If you already installed Python without it, just run the installer again and choose Modify.

Linux: you almost certainly already have it. If not, `sudo apt install python3` on Ubuntu/Debian, or `sudo dnf install python3` on Fedora.

**Step 2 — Open a terminal**

- **Windows:** press the Start button, type `cmd`, and press Enter. A black window opens. That is Command Prompt.
- **Linux:** press `Ctrl` + `Alt` + `T`, or search for "Terminal" in your applications.

**Step 3 — Check Python is working**

Type this and press Enter:

```
py --version
```

On Linux, and on Windows if `py` is not recognised, use `python3 --version` instead. You should see something like `Python 3.12.1`. Anything **3.9 or higher** is fine. If you instead get "not recognised as an internal or external command", Python is not on your PATH — redo Step 1 and make sure that checkbox is ticked.

**Step 4 — Download the helper**

Get **`tabroom_bridge.py`** from the [latest release](../../releases/latest). It will land in your Downloads folder. It is a single text file — you can open it in Notepad and read the whole thing if you want to.

**Step 5 — Point the terminal at that folder**

The terminal is always "in" one folder at a time, and it can only run a file that is in the folder it is currently in. `cd` means "change directory". Type:

```
cd %USERPROFILE%\Downloads
```

On Linux that is `cd ~/Downloads`. If you saved the file somewhere else, put that folder's path there instead.

**Step 6 — Start the helper**

```
py tabroom_bridge.py
```

On Linux, `python3 tabroom_bridge.py`.

You should see a line saying it is listening. **Leave this window open.**

If Windows ever shows a firewall prompt, you can safely click **Cancel** or deny it. The helper only ever listens on `127.0.0.1`, which means your own computer and nothing else — it does not need, and will not use, any network access to work. You can minimise it, but if you close it the helper stops and CardMirror will say it cannot find it. Now open CardMirror and sign in exactly as the Mac instructions describe — the plugin will find the helper on its own.

<br>

**Two things that differ from the Mac version**

- **It does not start automatically.** Repeat Step 6 each time you restart your computer. If you would rather it start on its own, set up a **Task Scheduler** task set to "At log on" (Windows) or a **systemd user unit** in `~/.config/systemd/user/` enabled with `systemctl --user enable --now` (Linux).
- **Your password is stored in a permission-locked file** in your config folder rather than in the macOS Keychain, because Windows and Linux have no single equivalent. Everything else is identical — the helper still only listens on your own machine, still requires a token, and still rate-limits itself.

`--login`, `--forget`, and `--uninstall-agent` all work here. `--install-agent` is the only macOS-only flag.

### 2. The plugin

Make sure **Settings → Plugins → Enable plugins** is on.

CardMirror ships with a short allowlist of approved plugin repositories, and this one is not on it. Before either method below, open the developer console inside CardMirror (command palette, `Cmd/Ctrl+Shift+Space`, then type `devtools`) and run:

```js
window.__plugins('community-on')
```

That is a one-time step per machine. It exists so nobody can be talked into installing an arbitrary plugin by accident.

#### Install from GitHub (recommended)

**Settings → Plugins → Install a plugin**, paste either of these into the field, and press Install:

```
SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin
https://github.com/SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin
```

Restart CardMirror. Installing this way means the plugin's row in Settings gets a **Check for updates** button, so future versions are one click.

#### Install manually

Download `cardmirror-plugin.json` and `plugin.js` from the latest release and put them in a folder named exactly `tabroom-rounds`:

```
~/Library/Application Support/@cardmirror/desktop/plugins/tabroom-rounds/
    cardmirror-plugin.json
    plugin.js
```

On Windows that folder is `%APPDATA%\@cardmirror\desktop\plugins\tabroom-rounds\`, and on Linux `~/.config/@cardmirror/desktop/plugins/tabroom-rounds/`.

If you are not sure, the surest way to find it is to install any plugin from GitHub first and look at where it landed.

Restart CardMirror. The folder name has to match the `id` in the manifest exactly, or the plugin is skipped without an error. Manual installs get no update checks.

#### Load temporarily (for development)

**Settings → Plugins → Load plugin from file…** and pick `plugin.js`. It runs for the current session only and is gone on restart.

## Use

The quickest way in is the trophy button in the ribbon, next to the speech-doc buttons. It opens the round picker directly, and it works from a cold start — no command has to be run first. Turn it off in **Settings → Plugins → Tabroom Rounds** if you would rather keep the ribbon clean.

Everything is also on the command palette (`Cmd/Ctrl+Shift+Space`):

- **Tabroom: New Speech Doc From Round** — live rounds
- **Tabroom: Refresh Rounds** — skip the cache
- **Tabroom: All Rounds This Season** — full history, useful for testing off-season
- **Tabroom: Sign In** / **Tabroom: Sign Out**

The first time you fetch rounds you are asked to sign in, right inside CardMirror. The password goes to the local helper, which stores it in the Keychain and renews the session by itself. You should not need to sign in again.

Pick a round, pick a speech, and CardMirror creates the document. In three-pane mode its own slot picker asks which pane to open it in.

Speech buttons are filtered by side — aff rounds offer 1AC/2AC/1AR/2AR, neg rounds the negative speeches. Rounds with no side recorded offer all eight.

All commands ship unbound. Assign keys in **Settings → Keybindings**.

## Flight

Tabroom stores flight on the panel, but it is not exposed through the rounds endpoint, so it cannot be read automatically. The picker has a Flight 1 / 2 / None toggle that is remembered between rounds and folded into the filename when set.

## Rate limiting

openCaselist allows 2000 GETs per 15 minutes and 20 login attempts per minute. The helper stays far below both:

- 45-second response cache
- 10-second minimum between upstream calls, which `Refresh` cannot bypass
- 120 requests per 15 minutes, sliding window; past that you get cached rounds marked stale
- Login backoff of 1m, 5m, 15m, 1h on consecutive failures, capped at 5 attempts per hour
- A circuit breaker after 5 straight login failures that stops automatic retries until you run `--login`. The failure count persists to disk so an agent restart cannot reset it
- `Retry-After` honored on any 429

A heavy tournament day is roughly 40 upstream calls.

## Security

- The password lives in the macOS Keychain. On other platforms it falls back to a `0600` file under `~/.config/tabroom-bridge`
- The session token is cached for two weeks and renewed automatically
- The loopback server binds `127.0.0.1` only and rejects any request without the per-launch bridge token
- Handshake files are written `0600` inside a `0700` directory

## Updating

The plugin updates through CardMirror: **Settings → Plugins → Check for updates** on its row.

The helper updates itself. When the plugin needs a newer one it offers to update in place, and **Tabroom: Update Helper** checks on demand. It downloads the new file from this repository's latest release, refuses anything that does not parse as Python, swaps it atomically, and restarts. You do not need to reinstall the pkg.

## Pausing the helper

The helper is idle almost all the time. It sits blocked on a loopback socket and does no polling, no timers, and no background work — it wakes only when CardMirror asks it for rounds. Measured on an Apple Silicon Mac: **0.0% CPU**, and memory that starts near 30 MB at launch and settles to roughly **12–15 MB** within a few minutes. Check yours:

```bash
ps -o pid,rss,%cpu,etime,command -p $(pgrep -f tabroom_bridge)
```

Still, if you want it off between tournaments:

```bash
launchctl bootout gui/$(id -u)/com.tabroombridge.helper
```

And to start it again:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tabroombridge.helper.plist
```

While it is stopped the plugin reports that the helper is not running, and everything else in CardMirror is unaffected.

It has to be *running* to be reachable, not merely installed: CardMirror checks that the helper's process is alive before it will open a connection, so an on-demand "start it when needed" setup is not possible from the plugin side. Stopping and starting it is manual, by design.

## Removing it

Two pieces, removed separately.

**The helper** — run the uninstaller from this repo:

```bash
./uninstall.sh
```

It stops the helper, deletes the saved login from the Keychain, and removes the LaunchAgent, the installed script, the logs, and the bridge registration. Pass `--keep-login` to leave your Keychain entry alone. It asks for your admin password once, because the pkg installed `/usr/local/lib/tabroom-bridge` as root.

If you would rather not run a script, the helper can do most of it itself:

```bash
python3 /usr/local/lib/tabroom-bridge/tabroom_bridge.py --forget
python3 /usr/local/lib/tabroom-bridge/tabroom_bridge.py --uninstall-agent
sudo rm -rf /usr/local/lib/tabroom-bridge ~/.config/tabroom-bridge
```

On **Windows and Linux** there is no installer, so there is nothing to uninstall — stop the helper by closing its terminal window (or pressing `Ctrl` + `C` in it), then delete these if you want it gone completely:

- the `tabroom_bridge.py` file you downloaded
- `%APPDATA%\tabroom-bridge` (Windows) or `~/.config/tabroom-bridge` (Linux) — this holds your saved login
- `%APPDATA%\cardmirror-bridge\tabroom-bridge.json` (Windows) or `~/.local/share/cardmirror-bridge/tabroom-bridge.json` (Linux)

Or let the helper do the last two for you: `py tabroom_bridge.py --forget`.

`uninstall.sh` is written for macOS and is not needed on Windows or Linux.

**The plugin** — **Settings → Plugins → Tabroom Rounds → Uninstall** inside CardMirror.

## Known limitations

- The plugin drives CardMirror's New Speech Document button and prompt through the DOM, since the v1 plugin API has no document-creation method. CardMirror is in alpha, so these selectors may break on an update. When they do, the composed name is copied to the clipboard instead
- Requires `flowApps` / `flowPost` in the plugin API. Older builds will report that the bridge is not registered
- Desktop only. The web edition has no Electron host and no bridge
- `current=true` returns nothing outside a tournament window. Use **All Rounds This Season** to confirm the connection works

## Thanks

This plugin is a thin layer on top of other people's work, and it would not exist without them.

- **[Anthony Trufanov](https://github.com/ant981228)** — for [CardMirror](https://github.com/ant981228/cardmirror), and for building it with a real plugin system and a documented bridge for outside processes. Almost everything here hangs off hooks he chose to expose rather than keep private.
- **[Aaron Hardy](https://paperlessdebate.com/)** — for [Verbatim](https://paperlessdebate.com/verbatim/), which set the standard for what paperless debate software should do, and for [openCaselist](https://github.com/ashtarcommunications/caselist), whose `/tabroom/rounds` endpoint is the only reason a tool like this can see your pairings at all. Verbatim's speech-doc dropdown is the feature this plugin is chasing, and its approach showed the way. Both are free and open source.

Thanks also to the **Tabroom** team at the NSDA for running the infrastructure the whole activity depends on.

Any bugs here are mine, not theirs. Please report issues to this repository rather than to them.

## License

MIT
