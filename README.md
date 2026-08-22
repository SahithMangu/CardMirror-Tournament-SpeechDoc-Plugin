# Tabroom Rounds

A CardMirror plugin that creates speech documents named from your live Tabroom pairings.

Instead of typing `1AC Harvard Round 1 vs Hill SM` by hand every round, pick the round from a list and the document is created and named for you. Same idea as Verbatim's speech-doc dropdown, built for CardMirror.

## How it works

Tabroom has no public API for your own pairings. The path that works and the one Verbatim uses goes through openCaselist:

```
plugin  ->  local helper  ->  api.opencaselist.com/v1/tabroom/rounds  ->  Tabroom
```

The helper (`tabroom_bridge.py`) logs into openCaselist with your Tabroom credentials and serves your rounds over loopback. The plugin reaches it through CardMirror's `cardmirror-bridge` channel, so the renderer never sees a token or a socket.

A helper is needed because openCaselist authenticates with a `SameSite=Lax` cookie, and browsers refuse to send it cross-site — a plugin running inside CardMirror cannot set a `Cookie` header. A normal process can.

## Install

### 1. The helper

Download `TabroomBridgeSetup.zip`, unzip it, and double-click **Tabroom Bridge Setup**.

macOS will block it the first time because it is unsigned right-click the app and choose **Open**, then confirm. You only do this once.

It installs a background helper that starts at login. No terminal, and no credentials up front: you sign in from inside CardMirror.

Double-click the app again later to reinstall or remove it.

<details>
<summary>Terminal alternative</summary>

```
python3 tabroom_bridge.py --install-agent
```

| Flag | Effect |
| --- | --- |
| `--install-agent` | Install and start the background helper (macOS) |
| `--uninstall-agent` | Stop and remove it |
| `--login` | Sign in from the terminal instead of in-app |
| `--forget` | Erase stored credentials and token |

Run with no flags to keep it in the foreground. Either path copies the helper to `~/Library/Application Support/tabroom-bridge/`, so the download can be deleted afterwards.

</details>

Logs: `~/.config/tabroom-bridge/logs/bridge.log`

### 2. The plugin

In CardMirror: open the developer console (command palette → "devtools") and run `window.__plugins('community-on')` to allow installs from outside the curated allowlist. Then **Settings → Plugins** and paste this repository's `owner/repo` into the install field.

To develop against it instead, use **Load plugin from file…** and pick `plugin.js`. Session-only, so reload after each restart.

## Use

Open the command palette (`Cmd/Ctrl+Shift+Space`) and run one of:

- **Tabroom: New Speech Doc From Round** — live rounds
- **Tabroom: Refresh Rounds** — skip the cache
- **Tabroom: All Rounds This Season** — full history, useful for testing off-season
- **Tabroom: Sign In** / **Tabroom: Sign Out**

The first time you fetch rounds you are asked to sign in, right inside CardMirror. The password goes to the local helper, which stores it in the Keychain and renews the session by itself. You should not need to sign in again.

Pick a round, pick a speech, and CardMirror creates the document. In three-pane mode its own slot picker asks which pane to open it in.

Speech buttons are filtered by side — aff rounds offer 1AC/2AC/1AR/2AR, neg rounds the negative speeches. Rounds with no side recorded offer all eight.

Both commands ship unbound. Assign keys in **Settings → Keybindings**.

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

## Known limitations

- The plugin drives CardMirror's New Speech Document button and prompt through the DOM, since the v1 plugin API has no document-creation method. CardMirror is in alpha, so these selectors may break on an update. When they do, the composed name is copied to the clipboard instead
- Requires `flowApps` / `flowPost` in the plugin API. Older builds will report that the bridge is not registered
- Desktop only. The web edition has no Electron host and no bridge
- `current=true` returns nothing outside a tournament window. Use **All Rounds This Season** to confirm the connection works

## License

MIT
