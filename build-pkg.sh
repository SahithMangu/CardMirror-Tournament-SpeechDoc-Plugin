#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

IDENTIFIER="com.tabroombridge.helper"
VERSION=$(python3 -c "import json;print(json.load(open('cardmirror-plugin.json'))['version'])")
BUILD="build-pkg"
ROOT="$BUILD/root"
SCRIPTS="$BUILD/scripts"
OUT="TabroomBridge.pkg"
INSTALL_DIR="/usr/local/lib/tabroom-bridge"

command -v pkgbuild >/dev/null || { echo "pkgbuild not found. This must run on macOS."; exit 1; }

rm -rf "$BUILD" "$OUT"
mkdir -p "$ROOT$INSTALL_DIR" "$SCRIPTS"

cp tabroom_bridge.py "$ROOT$INSTALL_DIR/tabroom_bridge.py"
chmod 755 "$ROOT$INSTALL_DIR/tabroom_bridge.py"

cat > "$SCRIPTS/postinstall" <<'POSTINSTALL'
#!/bin/bash
set -u

CONSOLE_USER=$(/usr/bin/stat -f%Su /dev/console)
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  echo "No logged-in user found; skipping agent setup."
  exit 0
fi

USER_HOME=$(/usr/bin/dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory | /usr/bin/awk '{print $2}')
USER_UID=$(/usr/bin/id -u "$CONSOLE_USER")
INSTALL_DIR="/usr/local/lib/tabroom-bridge"
LABEL="com.tabroombridge.helper"
LEGACY_LABEL="com.sahith.tabroom-bridge"
PLIST="$USER_HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$USER_HOME/.config/tabroom-bridge/logs"

PY=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$candidate" ] && "$candidate" -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done

if [ -z "$PY" ]; then
  echo "Python 3.9+ not found. Run: xcode-select --install"
  exit 1
fi

/bin/mkdir -p "$USER_HOME/Library/LaunchAgents" "$LOGS"

/bin/cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$INSTALL_DIR/tabroom_bridge.py</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>$LOGS/bridge.log</string>
  <key>StandardErrorPath</key>
  <string>$LOGS/bridge.err.log</string>
</dict>
</plist>
PLISTEOF

/usr/sbin/chown -R "$CONSOLE_USER" "$PLIST" "$USER_HOME/.config/tabroom-bridge"

# Older versions installed under a different label; remove that agent first
# so launchd is not left running two helpers against the same bridge files.
/bin/launchctl bootout "gui/$USER_UID/$LEGACY_LABEL" 2>/dev/null || true
/bin/rm -f "$USER_HOME/Library/LaunchAgents/$LEGACY_LABEL.plist" 2>/dev/null || true

/bin/launchctl bootout "gui/$USER_UID/$LABEL" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$USER_UID" "$PLIST" 2>/dev/null \
  || /bin/launchctl asuser "$USER_UID" /bin/launchctl load "$PLIST" 2>/dev/null \
  || true

exit 0
POSTINSTALL

chmod +x "$SCRIPTS/postinstall"

pkgbuild \
  --root "$ROOT" \
  --scripts "$SCRIPTS" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location / \
  "$OUT"

rm -rf "$BUILD"

echo
echo "Built $OUT ($VERSION)"
if [ "${1:-}" = "--sign" ]; then
  IDENT=$(security find-identity -v -p basic | grep "Developer ID Installer" | head -1 | sed 's/.*"\(.*\)"/\1/')
  if [ -n "$IDENT" ]; then
    productsign --sign "$IDENT" "$OUT" "signed-$OUT"
    mv "signed-$OUT" "$OUT"
    echo "Signed with: $IDENT"
  else
    echo "No Developer ID Installer certificate found; left unsigned."
  fi
else
  echo "Unsigned. Users right-click the pkg and choose Open the first time."
  echo "Pass --sign to sign it if you have a Developer ID Installer certificate."
fi
