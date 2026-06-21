#!/usr/bin/env bash
# swarm-test skill installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/Horizon-Factory/swarm-test/main/install.sh | bash
#   # or, if already cloned:
#   ~/.claude/skills/swarm-test/install.sh --update
#
set -euo pipefail

REPO="https://github.com/Horizon-Factory/swarm-test.git"
DEST="${SWARM_TEST_DIR:-$HOME/.claude/skills/swarm-test}"
MODE="${1:-install}"

c_green() { printf '\033[32m%s\033[0m\n' "$1"; }
c_yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
c_red()   { printf '\033[31m%s\033[0m\n' "$1"; }
c_dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

check_prereqs() {
  local ok=1
  if command -v claude >/dev/null 2>&1; then
    c_green "✓ claude CLI found"
  else
    c_red   "✗ claude CLI not found — install Claude Code: https://claude.com/claude-code"
    ok=0
  fi
  if command -v node >/dev/null 2>&1; then
    local v; v="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$v" -ge 18 ]; then c_green "✓ node $(node -v)"; else c_red "✗ node >= 18 required (have $(node -v))"; ok=0; fi
  else
    c_red "✗ node not found"
    ok=0
  fi
  local pm="none"
  command -v pnpm >/dev/null 2>&1 && pm="pnpm"
  [ "$pm" = none ] && command -v yarn >/dev/null 2>&1 && pm="yarn"
  [ "$pm" = none ] && command -v npm  >/dev/null 2>&1 && pm="npm"
  if [ "$pm" != none ]; then c_green "✓ package manager: $pm"; else c_yellow "⚠ no package manager found (pnpm/yarn/npm)"; fi
  return $((1 - ok))
}

if [ "$MODE" = "--update" ] || [ "$MODE" = "update" ]; then
  if [ ! -d "$DEST/.git" ]; then
    c_red "Not a git checkout at $DEST — run install instead."
    exit 1
  fi
  c_dim "Updating $DEST"
  git -C "$DEST" pull --ff-only
  c_green "✓ swarm-test updated"
else
  if [ -d "$DEST/.git" ]; then
    c_yellow "Already installed at $DEST — updating instead."
    git -C "$DEST" pull --ff-only
  else
    mkdir -p "$(dirname "$DEST")"
    c_dim "Cloning into $DEST"
    git clone --depth 1 "$REPO" "$DEST"
  fi
  c_green "✓ swarm-test installed at $DEST"
fi

# Expose the sibling mobile skill (swarm-mobile) as its own skill dir so Claude
# Code discovers it. It lives inside this repo; symlink it next to swarm-test.
if [ -d "$DEST/swarm-mobile" ]; then
  MOBILE_LINK="$(dirname "$DEST")/swarm-mobile"
  if [ ! -e "$MOBILE_LINK" ]; then
    ln -s "$DEST/swarm-mobile" "$MOBILE_LINK" && c_green "✓ swarm-mobile linked at $MOBILE_LINK"
  elif [ -L "$MOBILE_LINK" ]; then
    c_dim "swarm-mobile already linked at $MOBILE_LINK"
  else
    c_yellow "⚠ $MOBILE_LINK exists and is not a symlink — leaving it alone."
  fi
fi

echo
c_dim "Prerequisite check:"
check_prereqs || c_yellow "Some prerequisites are missing — fix them before running the skill."

echo
c_dim "Web   — per-project (once): pnpm add -D @playwright/test && npx playwright install chromium"
c_dim "         then: code a feature, say \"run the swarm\"."
c_dim "Mobile — once (macOS): curl -Ls \"https://get.maestro.mobile.dev\" | bash   (needs Java 11+)"
c_dim "         then, with a simulator/emulator booted: code a feature, say \"swarm the simulator\"."
