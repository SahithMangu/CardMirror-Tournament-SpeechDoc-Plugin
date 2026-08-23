# Tabroom Rounds

A CardMirror plugin that creates speech documents named from your live Tabroom pairings.

Instead of typing `1AC Harvard Round 1 vs Ridge AM` by hand every round, pick the round from a list and the document is created and named for you. Same idea as Verbatim's speech-doc dropdown, built for CardMirror.

> **macOS only.** See [Platform support](#platform-support).

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

**This is macOS only.** Windows and Linux are not supported.

| | Supported |
| --- | --- |
| **macOS** | yes |
| **Windows** | no |
| **Linux** | no |
| **CardMirror web edition** | no |

I only have a Mac. I will not tell people to run something on a system I have never been able to test on — the instructions could be subtly wrong, and the person finding out would be someone mid-tournament. So rather than ship half-supported guesswork, Windows and Linux are simply out of scope for now.

If that changes and I can properly test on those systems, support may be added later. Until then, please do not run the helper on Windows or Linux and expect it to behave.

The web edition of CardMirror is out of scope for a different and permanent reason: it has no Electron host, so the `flowApps`/`flowPost` bridge does not exist and there is no way for a plugin to reach a local process at all.

## Install

There are two pieces: a **plugin** inside CardMirror, and a small **helper** that runs in the background. You need both. The helper exists because openCaselist authenticates with a cookie, and a plugin running inside CardMirror's browser engine is not allowed to send one.

### 1. The helper

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

**The plugin** — **Settings → Plugins → Tabroom Rounds → Uninstall** inside CardMirror.

## Known limitations

- The plugin drives CardMirror's New Speech Document button and prompt through the DOM, since the v1 plugin API has no document-creation method. CardMirror is in alpha, so these selectors may break on an update. When they do, the composed name is copied to the clipboard instead
- Requires `flowApps` / `flowPost` in the plugin API. Older builds will report that the bridge is not registered
- macOS only. See [Platform support](#platform-support)
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
