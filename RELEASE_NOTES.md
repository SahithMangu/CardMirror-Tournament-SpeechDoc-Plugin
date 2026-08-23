Pick your round from a list and the speech document is created and named for you — `1AC Blake Round 3 vs Ridge AM` instead of typing it between rounds.

**This is an unofficial hobby project.** Not affiliated with, endorsed by or sponsored by CardMirror, Tabroom, the NSDA, openCaselist or Verbatim. Please report problems here, not to any of them. No warranty.

macOS only. Needs CardMirror 1.3.0+, a Tabroom account, and the Python already on your Mac. Nothing to `pip install`.

**This one needs internet** — your pairings are fetched live from openCaselist each time. See below.

## Installing

Two pieces — the [README](https://github.com/SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin#install) has the long version.

**1. The helper.** Download `TabroomBridge.pkg` below and open it. macOS blocks unsigned installers the first time, so **right-click the pkg and choose Open**, then confirm. It installs a small background service that starts at login. No terminal, and no credentials up front.

Prefer the terminal? `python3 tabroom_bridge.py --install-agent` does the same thing.

**2. The plugin.** In CardMirror's devtools console run `window.__plugins('community-on')` once, then **Settings → Plugins → Install a plugin** and paste `SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin`.

Then press the **trophy button** in the ribbon, next to the speech-doc buttons. The first time, it asks you to sign in to Tabroom — that happens inside CardMirror, and the helper keeps the session alive for about two weeks so you should not need to do it again.

## What it does

- **A trophy button in the ribbon** opens the round picker directly. It works from a cold start — no command has to be run first. Turn it off in **Settings → Plugins → Tabroom Rounds**.
- **Names the document for you** from the tournament, round, opponent and speech — `2NC Berkeley Round 5 vs Peninsula KL`.
- **Filters speeches by side.** Aff rounds offer 1AC/2AC/1AR/2AR, neg rounds the negative speeches, and rounds with no side recorded offer all eight.
- **Flight 1 / 2 / None toggle**, remembered between rounds and folded into the filename. Tabroom does not expose flight through this endpoint, so it is a manual switch.
- **Off-season and testing:** **Tabroom: All Rounds This Season** lists your history, and is the way to confirm the connection works when no tournament is live.
- **Handles bad tournament wifi.** If the connection drops, you get the rounds from your last refresh, labelled with their age, instead of an error. Everything is also on the command palette, and any command can be bound to a key in **Settings → Keybindings**.

## How fast is it

The round trip to Tabroom measures about **0.1–0.3s** — openCaselist forwards straight through with no cache of its own. The only waiting is self-imposed rate limiting: an answer may be reused for up to 45 seconds, and **Tabroom: Refresh Rounds** skips that. Worst case between a pairing going up and you seeing it is under a minute.

It cannot beat Tabroom itself, though — tab staff pair a round and then release it, and the plugin only ever sees what has been published.

## Turning it off

`launchctl bootout gui/$(id -u)/com.tabroombridge.helper` stops the helper until you start it again; `./uninstall.sh` removes it completely, including the saved login. The plugin comes off at **Settings → Plugins → Tabroom Rounds → Uninstall**.

## Privacy

Nothing is collected, and there is no analytics or telemetry — I have no server and cannot tell you are using this. The helper makes exactly two kinds of outbound connection: **openCaselist**, to fetch your own pairings, and **GitHub**, to check for a newer helper version. Your password lives in the **macOS Keychain**, your rounds are never written to disk, and the helper listens only on `127.0.0.1` with a token that changes each time it starts. The README has the one-line `grep` that proves the full list of network calls.
