#!/bin/bash
# Removes the Tabroom bridge helper completely.
#
#   ./uninstall.sh          stop the helper and remove everything it installed
#   ./uninstall.sh --keep-login   leave the saved Tabroom login in the Keychain
#
# The plugin itself is removed separately, in CardMirror:
# Settings > Plugins > Tabroom Rounds > Uninstall.
set -uo pipefail

LABEL="com.tabroombridge.helper"
LEGACY_LABELS=("com.sahith.tabroom-bridge")
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_DIR="/usr/local/lib/tabroom-bridge"
SUPPORT_DIR="$HOME/Library/Application Support/tabroom-bridge"
CONFIG_DIR="$HOME/.config/tabroom-bridge"
BRIDGE_DIR="$HOME/Library/Application Support/cardmirror-bridge"
KEYCHAIN_SERVICE="tabroom-bridge-opencaselist"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
gone() { printf '    removed %s\n' "$1"; }
skip() { printf '    not present: %s\n' "$1"; }

step "Stopping the helper"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null \
  || launchctl unload "$PLIST" 2>/dev/null \
  || true
# Versions before 1.2.0 installed under a different label.
for legacy in "${LEGACY_LABELS[@]}"; do
  launchctl bootout "gui/$(id -u)/$legacy" 2>/dev/null || true
  legacy_plist="$HOME/Library/LaunchAgents/$legacy.plist"
  [ -e "$legacy_plist" ] && rm -f "$legacy_plist" && gone "$legacy_plist"
done
# KeepAlive means launchd may have restarted it; make sure it is actually down.
sleep 1
if pgrep -f tabroom_bridge.py >/dev/null 2>&1; then
  pkill -f tabroom_bridge.py 2>/dev/null || true
  sleep 1
fi
pgrep -f tabroom_bridge.py >/dev/null 2>&1 \
  && echo "    WARNING: a tabroom_bridge.py process is still running" \
  || echo "    helper stopped"

if [ "${1:-}" != "--keep-login" ]; then
  step "Clearing the saved Tabroom login"
  if security find-generic-password -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1; then
    while security delete-generic-password -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1; do :; done
    echo "    Keychain entry deleted"
  else
    skip "Keychain entry"
  fi
else
  step "Keeping the saved Tabroom login (--keep-login)"
fi

step "Removing files"
for p in "$PLIST" "$SUPPORT_DIR" "$CONFIG_DIR" \
         "$BRIDGE_DIR/tabroom-bridge.json" "$BRIDGE_DIR/tabroom-bridge.session.json"; do
  if [ -e "$p" ]; then rm -rf "$p" && gone "$p"; else skip "$p"; fi
done

# The pkg wrote this one as root, so it needs sudo.
if [ -e "$INSTALL_DIR" ]; then
  echo "    $INSTALL_DIR needs admin rights to remove"
  if sudo rm -rf "$INSTALL_DIR"; then gone "$INSTALL_DIR"; fi
else
  skip "$INSTALL_DIR"
fi

# Only prune the shared bridge folder if nothing else is registered in it.
if [ -d "$BRIDGE_DIR" ] && [ -z "$(ls -A "$BRIDGE_DIR" 2>/dev/null)" ]; then
  rmdir "$BRIDGE_DIR" && gone "$BRIDGE_DIR (was empty)"
fi

step "Done"
echo "The helper is gone. Remove the plugin in CardMirror:"
echo "  Settings > Plugins > Tabroom Rounds > Uninstall"
