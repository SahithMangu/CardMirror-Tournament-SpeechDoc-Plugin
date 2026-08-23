#!/bin/bash
set -euo pipefail

REPO_NAME="${REPO_NAME:-CardMirror-Tournament-SpeechDoc-Plugin}"
GIT_NAME="${GIT_NAME:-Sahith Mangu}"
GIT_EMAIL="${GIT_EMAIL:-sahithmangu1@gmail.com}"
APP="Tabroom Bridge Setup.app"
ZIP="TabroomBridgeSetup.zip"

cd "$(dirname "$0")"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mError: %s\033[0m\n' "$1" >&2; exit 1; }

command -v git >/dev/null || fail "git is not installed."
command -v gh >/dev/null || fail "GitHub CLI is not installed. Run: brew install gh"
gh auth status >/dev/null 2>&1 || fail "Not signed in to GitHub. Run: gh auth login"

[ -f RELEASE_NOTES.md ] || fail "RELEASE_NOTES.md is missing; release notes come from it."
VERSION=$(python3 -c "import json;print(json.load(open('cardmirror-plugin.json'))['version'])")
[ -n "$VERSION" ] || fail "Could not read version from cardmirror-plugin.json"
TAG="v$VERSION"

# Keep the helper's APP_VERSION locked to the manifest version. When these
# drifted, the helper compared its hardcoded "1.0.0" against the release tag,
# so every update check reported an update, reapplied the same file and
# restarted -- forever.
step "Stamping helper version $VERSION"
python3 - "$VERSION" <<'STAMP'
import re, sys
version = sys.argv[1]
path = "tabroom_bridge.py"
src = open(path).read()
new, n = re.subn(r'^APP_VERSION = "[^"]*"',
                 f'APP_VERSION = "{version}"', src, count=1, flags=re.M)
if n != 1:
    sys.exit("could not find APP_VERSION in tabroom_bridge.py")
if new != src:
    open(path, "w").write(new)
    print(f"APP_VERSION -> {version}")
else:
    print(f"APP_VERSION already {version}")
STAMP

step "Building the installer"
if command -v pkgbuild >/dev/null 2>&1; then
  ./build-pkg.sh >/dev/null && echo "built TabroomBridge.pkg"
  PKG="TabroomBridge.pkg"
else
  echo "pkgbuild not available, skipping the .pkg"
  PKG=""
fi

step "Packaging $ZIP"
[ -d "$APP" ] || fail "$APP is missing."
chmod +x "$APP/Contents/MacOS/setup"
cp tabroom_bridge.py "$APP/Contents/Resources/tabroom_bridge.py"
rm -f "$ZIP"
zip -qry "$ZIP" "$APP"
echo "built $ZIP"

step "Checking the plugin bundle"
node -e "new Function(require('fs').readFileSync('plugin.js','utf8'))" 2>/dev/null \
  && echo "plugin.js parses" \
  || echo "node not found, skipping syntax check"
python3 -m py_compile tabroom_bridge.py && rm -rf __pycache__
echo "tabroom_bridge.py compiles"

step "Preparing the repository"
if [ ! -d .git ]; then
  git init -q
  git branch -M main
fi
git config user.name "$GIT_NAME"
git config user.email "$GIT_EMAIL"

cat > .gitignore <<'EOF'
__pycache__/
*.pyc
state.json
*.session.json
.DS_Store
logs/
TabroomBridgeSetup.zip
TabroomBridge.pkg
build-pkg/
EOF

git add -A
if git diff --cached --quiet; then
  echo "nothing new to commit"
else
  git commit -qm "Release $TAG"
  echo "committed"
fi

step "Pushing to GitHub"
if ! git remote get-url origin >/dev/null 2>&1; then
  OWNER=$(gh api user -q .login)
  if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
    echo "repo already exists on GitHub, linking to it"
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
  else
    gh repo create "$REPO_NAME" --public --source=. --remote=origin
  fi
fi

if ! git push -u origin main 2>/dev/null; then
  echo "remote has commits of its own, rebasing onto them"
  git pull --rebase origin main
  git push -u origin main
fi

SLUG=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "repo: $SLUG"

step "Publishing release $TAG"
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "release $TAG already exists, replacing its assets"
  gh release upload "$TAG" cardmirror-plugin.json plugin.js tabroom_bridge.py "$ZIP" ${PKG:+"$PKG"} --clobber
  gh release edit "$TAG" --title "Tabroom Rounds $VERSION" --notes-file RELEASE_NOTES.md
else
  gh release create "$TAG" cardmirror-plugin.json plugin.js tabroom_bridge.py "$ZIP" ${PKG:+"$PKG"} \
    --title "Tabroom Rounds $VERSION" \
    --notes-file RELEASE_NOTES.md
fi

step "Verifying"
ASSETS=$(gh release view "$TAG" --json assets -q '.assets[].name' | tr '\n' ' ')
echo "assets: $ASSETS"
for required in cardmirror-plugin.json plugin.js; do
  case "$ASSETS" in
    *"$required"*) ;;
    *) fail "$required is missing from the release. CardMirror will not install it." ;;
  esac
done

DRAFT=$(gh release view "$TAG" --json isDraft -q .isDraft)
PRE=$(gh release view "$TAG" --json isPrerelease -q .isPrerelease)
[ "$DRAFT" = "false" ] || fail "Release is a draft. CardMirror only reads the latest published release."
[ "$PRE" = "false" ] || fail "Release is a prerelease. CardMirror only reads the latest published release."

printf '\n\033[32mDone.\033[0m\n'
echo "Install in CardMirror:"
echo "  1. Open the developer console and run: window.__plugins('community-on')"
echo "  2. Settings > Plugins > paste: $SLUG"
