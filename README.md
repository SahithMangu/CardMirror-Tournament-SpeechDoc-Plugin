# Tabroom Rounds

A CardMirror plugin that creates speech documents named from your live Tabroom pairings.

Instead of typing `1AC Harvard Round 1 vs Ridge AM` by hand every round, pick the round from a list and the document is created and named for you. Same idea as Verbatim's speech-doc dropdown, built for CardMirror.

> **macOS only.** See [Platform support](#platform-support).

> ### Unofficial project
>
> This is a hobby project. It is **not affiliated with, endorsed by, sponsored by, or supported by** CardMirror, Tabroom, the National Speech & Debate Association, openCaselist, Verbatim, or anyone else whose work it builds on. Nobody involved with those projects reviewed, approved, or is responsible for this.
>
> I wrote it for myself because I got tired of typing document names between rounds, and shared it in case it is useful. It comes with no warranty and no guarantee of support. If it breaks, that is on me — please open an issue here rather than contacting any of the projects listed above.
>
> All product names and trademarks belong to their respective owners.

## How it works

Tabroom has no public API for your own pairings. The path that works — and the one Verbatim uses — goes through openCaselist:

```
plugin  ->  local helper  ->  api.opencaselist.com/v1/tabroom/rounds  ->  Tabroom
```

The helper (`tabroom_bridge.py`) logs into openCaselist with your Tabroom credentials and serves your rounds over loopback. The plugin reaches it through CardMirror's `cardmirror-bridge` channel, so the renderer never sees a token or a socket.

A helper is needed because openCaselist authenticates with a `SameSite=Lax` cookie, and browsers refuse to send it cross-site — a plugin running inside CardMirror cannot set a `Cookie` header. A normal process can.

### Why openCaselist and not one of the unofficial Tabroom APIs

A few community projects wrap Tabroom, most visibly
[neelr/tabroom-private-api](https://github.com/neelr/tabroom-private-api) and
[gmitch215/TabroomAPI](https://github.com/gmitch215/TabroomAPI). They are useful
work, but they solve a different problem and could not power this plugin.

**They serve public tournament data, not your own schedule.** Their endpoints are
keyed by tournament id — `getTournament(30082)`, `/tournament/pairings` — so what
comes back is the public postings page for an event. This plugin needs *your*
rounds: which side you are, who you are hitting, in the round you are about to
walk into. To get that out of a public postings page you would have to know the
tournament id and event, pull every pairing, and match your own entry by name —
which breaks the moment a name is formatted differently.

**Your own schedule requires being logged in**, and that is the actual hard part.
`api.tabroom.com` is private and needs authentication; gmitch215's own README says
as much. So an unofficial wrapper does not avoid the authentication problem, it
just moves it.

**Both are also effectively unmaintained.** neelr's last commit was February 2021
and its hosted endpoint lives on `now.sh`, which Vercel retired. gmitch215's
repository is archived by its author, and is Kotlin-only, so it could not be
called from this helper or plugin without reimplementing it. Scrapers break
silently when markup changes, which is a bad property for something you rely on
between rounds.

**openCaselist gets this right by being sanctioned.** Tabroom issued it a partner
API key, so it can look up a specific person's rounds and hand back exactly the
fields this plugin needs — tournament, round, side, opponent, judge, start time.
It is maintained by the same person who maintains Verbatim. The only cost is the
local helper, which exists purely because openCaselist authenticates with a
cookie that a plugin inside CardMirror is not allowed to send.

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

If that changes and I can properly test on those systems, support may be added later.

This is enforced, not just documented: the helper refuses to start on anything other than macOS. The only commands that still work elsewhere are `--forget` and `--uninstall-agent`, so that anyone who ran an older version on another system can still delete their saved login.

The web edition of CardMirror is out of scope for a different and permanent reason: it has no Electron host, so the `flowApps`/`flowPost` bridge does not exist and there is no way for a plugin to reach a local process at all.

## You need an internet connection

Fetching your pairings is a live request to openCaselist, so **this needs internet at the moment you ask for rounds.** There is no fully offline mode.

| | Internet needed? |
| --- | --- |
| CardMirror and the ribbon button | No |
| The helper starting up | No |
| Signing in (once) | **Yes** |
| Fetching your rounds | **Yes** |
| Creating and naming the document | No |

Your login lasts about two weeks and is stored locally, so you are not signing in every round — but the round list itself is fetched fresh each time.

**If the connection drops, nothing breaks.** CardMirror keeps working and the plugin fails softly:

- If rounds were fetched earlier in the session, you get **those**, labelled `Offline — showing the rounds from your last refresh (12 min ago)`. Still enough to name a document for the round you are about to debate.
- If there is nothing cached yet, you get `Cannot reach openCaselist — check your internet connection.` and nothing else happens.

The cached copy lives in the helper's memory, so it is there as long as the helper keeps running, and is lost if your Mac restarts. Nothing about your rounds is written to disk.

One practical note for tournaments: sign in and pull your rounds once while you still have a decent connection. After that a flaky venue network degrades to stale-but-usable rather than nothing.

## How quickly do new pairings show up

Fast. The path to Tabroom is live — openCaselist does not cache anything, it forwards each request straight through — so a real round trip measures **about 0.1 to 0.3 seconds**.

The only waiting comes from limits this plugin puts on itself, to stay well clear of openCaselist's rate limits:

| | Delay |
| --- | --- |
| Actual round trip to Tabroom | ~0.1–0.3s |
| Reuse of a recent answer | up to **45s** |
| Minimum gap between live calls | 10s |

In practice, if you have not checked in the last 45 seconds, pressing the trophy button fetches live and shows your pairing in well under a second. Press it repeatedly and you may get an answer up to 45 seconds old — which is generally fine, since pairings do not change second to second. **Tabroom: Refresh Rounds** skips that 45-second reuse and asks Tabroom again — subject only to the 10-second floor, which nothing bypasses.

So the realistic worst case between a pairing going up and you seeing it is **under a minute** with the button, or about **10 seconds** if you use Refresh. Usually it is instant. See [Rate limiting](#rate-limiting) for why those limits exist.

**What this cannot do is beat Tabroom itself.** Tab staff pair a round and then release it, and there is often a gap between the two. The plugin only ever sees what Tabroom has published, so it cannot show you a pairing before it is out — no tool can.

One related gotcha: the button asks for *current* rounds, and Tabroom decides what counts as current. A pairing that is published but not starting for a while may not be in that list yet. If you know a pairing is up and the button shows nothing, try **Tabroom: All Rounds This Season**, which does not apply that filter.

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
