# Security

This is an unofficial hobby project maintained by one person. It handles a
Tabroom password, so this file states plainly what it does with it, what the
design does and does not protect against, and how to report a problem.

## Reporting a vulnerability

Use **[private vulnerability reporting](https://github.com/SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin/security/advisories/new)**
on this repository. That opens a private channel — please use it rather than a
public issue for anything exploitable.

For non-sensitive bugs, a normal [issue](https://github.com/SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin/issues)
is fine.

I am one person doing this around school, so I cannot promise a response time.
I will acknowledge reports as soon as I see them. Please do not report issues in
this project to CardMirror, Tabroom, the NSDA, openCaselist or Verbatim — they
did not write it and are not responsible for it.

## Supported versions

Only the [latest release](https://github.com/SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin/releases/latest)
is supported. Earlier releases are marked superseded and should not be installed.

## What this software does with your credentials

**Your Tabroom password is stored on your machine** and is used to sign in to
openCaselist. It is needed beyond the first login because openCaselist sessions
expire after a hard 14 days with no refresh endpoint — re-sending username and
password is the only way to get a new token, so unattended renewal requires
keeping the password.

- **macOS:** stored in the **login Keychain**, service `tabroom-bridge-opencaselist`.
- The session token, not the password, is written to
  `~/.config/tabroom-bridge/state.json` with mode `0600`.

**Be clear about what Keychain storage does and does not give you.** It provides
encryption at rest, which protects the password if the disk is read while you are
logged out or if the machine is stolen. It does **not** isolate the secret from
other software running as you: the item is created through the `security` CLI with
no application access-control list, so any process running under your account can
read it back without a prompt. Against a same-user attacker this is comparable to a
`0600` file. If malware is already running as your user, assume the password is
exposed — and note that it is your real Tabroom account password, not a
scoped token.

To erase it: `./uninstall.sh`, or `python3 tabroom_bridge.py --forget`.

## Network surface

The helper makes outbound requests to exactly two hosts:

| Host | Purpose | Credentials sent |
| --- | --- | --- |
| `api.opencaselist.com` | Sign in, fetch your own rounds | Your login on `POST /v1/login`; thereafter a `Cookie: caselist_token=...` header |
| `api.github.com` | Check for a newer helper version, and download it if you accept | None |

There is no analytics, telemetry, crash reporting or usage tracking of any kind,
and no server operated by the author. The full set of URLs in the source can be
listed with:

```bash
grep -oE "https?://[a-zA-Z0-9./_-]+" tabroom_bridge.py plugin.js | sort -u
```

TLS certificates are verified (Python's default `ssl` context, `CERT_REQUIRED`
with hostname checking), so intercepting these requests requires a CA your machine
already trusts.

This list is enforced, not just documented. `.allowed-hosts` holds the approved
hosts and a [GitHub Action](.github/workflows/network-surface.yml) fails the build
if the source references any other. It runs on pull requests too, including from
forks, so a change that adds a host cannot be merged without it showing up red.
The README has step-by-step instructions for confirming this yourself, including
how to make the check fail on purpose.

## Local listener

The helper runs an HTTP server bound to **`127.0.0.1` only**, on an
OS-assigned port. It is not reachable from other machines. Every request must
carry an `X-Bridge-Token` header matching a token that is regenerated on each
start and written to `~/Library/Application Support/cardmirror-bridge/tabroom-bridge.session.json`
(mode `0600`). Requests without it are rejected with 401.

Any process running as your user can read that token file and therefore talk to
the helper. The token stops other users and the network, not same-user code.

## Rate limiting

The helper limits itself well below openCaselist's published limits: a 45-second
response cache, a 10-second floor between upstream calls, 120 requests per 15
minutes, login backoff of 1m/5m/15m/1h, and a circuit breaker after 5 consecutive
login failures that persists across restarts so a supervised restart loop cannot
reset it. `Retry-After` is honored on 429.

## Verifying what you install

The `tabroom_bridge.py` and `plugin.js` attached to a release are **byte-identical
to the files in this repository** at that tag, so you can diff them against source
you have read:

```bash
gh release download v1.2.5 -p tabroom_bridge.py -D /tmp/rel
diff /tmp/rel/tabroom_bridge.py tabroom_bridge.py
```

The `.pkg` is built by `build-pkg.sh` from that same file. It is not
byte-reproducible (it embeds build timestamps), so compare the Python source
rather than the installer.

## Known weaknesses

Stated openly rather than left for you to find:

- **The installer is unsigned and not notarized.** macOS will warn, and the
  documented workaround is right-click → Open. That is a habit worth being wary of
  in general. If you would rather not bypass Gatekeeper, install with
  `python3 tabroom_bridge.py --install-agent`, which runs a short, readable script
  you can inspect first.
- **The self-updater does not verify a signature.** It downloads over verified TLS
  and checks that the file parses as Python and looks like the helper, which
  guards against corruption and truncation but not against a compromised GitHub
  release. Updates are never applied without you asking.
- **The password is recoverable by same-user processes**, as described above.
- **The plugin drives CardMirror's UI through the DOM** because the plugin API has
  no document-creation method. It reads and clicks CardMirror's own elements; it
  does not modify CardMirror itself.
- **Plugins in CardMirror are not sandboxed.** Any plugin, this one included, runs
  with the same access the editor has. That is why installing from outside the
  curated allowlist requires deliberately enabling community installs.

## Scope

In scope: credential handling, the local listener, the update mechanism, the
network surface, and anything that lets code or data escape the boundaries
described above.

Out of scope: vulnerabilities in CardMirror, Tabroom, or openCaselist themselves —
please report those to their maintainers.
