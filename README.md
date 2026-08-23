# Tabroom Rounds

A CardMirror plugin that creates speech documents named from your live Tabroom pairings.

Instead of typing `1AC Harvard Round 1 vs Ridge AM` by hand every round, pick the round from a list and the document is created and named for you. Same idea as Verbatim's speech-doc dropdown, built for CardMirror.

## How it works

Tabroom has no public API for your own pairings. The path that works — and the one Verbatim uses — goes through openCaselist:

```
plugin  ->  local helper  ->  api.opencaselist.com/v1/tabroom/rounds  ->  Tabroom
```

The helper (`tabroom_bridge.py`) logs into openCaselist with your Tabroom credentials and serves your rounds over loopback. The plugin reaches it through CardMirror's `cardmirror-bridge` channel, so the renderer never sees a token or a socket.

A helper is needed because openCaselist authenticates with a `SameSite=Lax` cookie, and browsers refuse to send it cross-site — a plugin running inside CardMirror cannot set a `Cookie` header. A normal process can.

## Install

There are two pieces: a **plugin** inside CardMirror, and a small **helper** that runs in the background. You need both. The helper exists because openCaselist authenticates with a cookie, and a plugin running inside CardMirror's browser engine is not allowed to send one.

### 1. The helper

Download **TabroomBridge.pkg** from the [latest release](../../releases/latest) and open it.

macOS blocks unsigned installers the first time, so right-click the pkg and choose **Open**, then confirm. You only do this once.

It installs a small background service that starts at login. No terminal, and no credentials up front — you sign in from inside CardMirror.

The service idles at about 21 MB of memory and no measurable CPU. It only contacts openCaselist when you ask it for rounds.

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
~/Library/Application Support/CardMirror/plugins/tabroom-rounds/
    cardmirror-plugin.json
    plugin.js
```

On Windows that folder is `%APPDATA%\CardMirror\plugins\tabroom-rounds\`, and on Linux `~/.config/CardMirror/plugins/tabroom-rounds/`.

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

## Known limitations

- The plugin drives CardMirror's New Speech Document button and prompt through the DOM, since the v1 plugin API has no document-creation method. CardMirror is in alpha, so these selectors may break on an update. When they do, the composed name is copied to the clipboard instead
- Requires `flowApps` / `flowPost` in the plugin API. Older builds will report that the bridge is not registered
- Desktop only. The web edition has no Electron host and no bridge
- `current=true` returns nothing outside a tournament window. Use **All Rounds This Season** to confirm the connection works

## License

MIT
