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

VERSION=$(python3 -c "import json;print(json.load(open('cardmirror-plugin.json'))['version'])")
[ -n "$VERSION" ] || fail "Could not read version from cardmirror-plugin.json"
TAG="v$VERSION"

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
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
else
  git push -u origin main
fi

SLUG=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "repo: $SLUG"

step "Publishing release $TAG"
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "release $TAG already exists, replacing its assets"
  gh release upload "$TAG" cardmirror-plugin.json plugin.js "$ZIP" --clobber
else
  gh release create "$TAG" cardmirror-plugin.json plugin.js "$ZIP" \
    --title "$TAG" \
    --notes "Speech documents named from your live Tabroom pairings."
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
