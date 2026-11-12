#!/bin/sh
# Install, verify, or uninstall the /krig skill across Claude Code, Codex CLI, and Antigravity (agy).
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
SKILL_NAME="krig"
SKILL_SRC="$REPO_DIR/skills/$SKILL_NAME"

MODE="install"
if [ "${1:-}" = "--dry-run" ]; then
  MODE="dry-run"
elif [ "${1:-}" = "--check" ]; then
  MODE="check"
elif [ "${1:-}" = "--uninstall" ]; then
  MODE="uninstall"
elif [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: ./scripts/install.sh [--dry-run | --check | --uninstall]"
  exit 0
elif [ -n "${1:-}" ]; then
  echo "Unknown option: $1" >&2
  exit 2
fi

if [ ! -f "$SKILL_SRC/SKILL.md" ]; then
  echo "Error: skill source not found at $SKILL_SRC/SKILL.md" >&2
  exit 1
fi

FAILURES=0
BACKUP_SEQ=0

resolve_link_dir() {
  target_link="$1"
  if [ -d "$target_link" ]; then
    (cd "$target_link" 2>/dev/null && pwd -P) || true
  fi
}

ensure_link() {
  dst_dir="$1"
  dst="$dst_dir/$SKILL_NAME"

  if [ "$MODE" = "uninstall" ]; then
    if [ -L "$dst" ] && [ "$(resolve_link_dir "$dst")" = "$SKILL_SRC" ]; then
      rm -f "$dst"
      echo "- removed: $dst"
    fi
    return 0
  fi

  if [ "$MODE" = "check" ]; then
    if [ ! -L "$dst" ]; then
      echo "FAIL: missing symlink ($dst)" >&2
      FAILURES=$((FAILURES + 1))
      return 0
    fi
    actual="$(resolve_link_dir "$dst")"
    if [ "$actual" != "$SKILL_SRC" ]; then
      echo "FAIL: symlink mismatch ($dst: ${actual:-broken}, expected: $SKILL_SRC)" >&2
      FAILURES=$((FAILURES + 1))
      return 0
    fi
    if [ ! -r "$dst/SKILL.md" ] || [ ! -r "$dst/agents/openai.yaml" ]; then
      echo "FAIL: unreadable skill files ($dst)" >&2
      FAILURES=$((FAILURES + 1))
      return 0
    fi
    echo "OK: $dst => $SKILL_SRC"
    return 0
  fi

  if [ -L "$dst" ] && [ "$(resolve_link_dir "$dst")" = "$SKILL_SRC" ]; then
    echo "= up-to-date: $dst"
    return 0
  fi

  if [ "$MODE" = "dry-run" ]; then
    echo "[dry-run] ln -s $SKILL_SRC $dst"
    return 0
  fi

  mkdir -p "$dst_dir"
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    if [ -L "$dst" ] || { [ ! -d "$dst" ] && [ ! -s "$dst" ]; }; then
      rm -f "$dst"
    else
      trash_dir="$HOME/.claude/skills/.trash"
      mkdir -p "$trash_dir"
      BACKUP_SEQ=$((BACKUP_SEQ + 1))
      backup="$trash_dir/${SKILL_NAME}.bak.$(date +%Y%m%d%H%M%S).$$.${BACKUP_SEQ}"
      mv "$dst" "$backup"
      echo "! backed up existing path: $backup"
    fi
  fi

  ln -s "$SKILL_SRC" "$dst"
  echo "+ linked: $dst => $SKILL_SRC"
}

for rel in \
  ".agents/skills" \
  ".claude/skills" \
  ".codex/skills" \
  ".gemini/skills" \
  ".gemini/config/skills" \
  ".gemini/antigravity-cli/skills"
do
  ensure_link "$HOME/$rel"
done

if [ -d "$HOME/.pi" ]; then
  ensure_link "$HOME/.pi/agent/skills"
fi

AGY_PROFILES_DIR="$HOME/.config/krill/profiles/agy"
if [ -d "$AGY_PROFILES_DIR" ]; then
  for profile in "$AGY_PROFILES_DIR"/*/; do
    [ -d "$profile" ] || continue
    profile="${profile%/}"
    ensure_link "$profile/.gemini/config/skills"
    ensure_link "$profile/.gemini/antigravity-cli/skills"
  done
fi

if [ "$MODE" = "check" ]; then
  if [ "$FAILURES" -gt 0 ]; then
    echo "FAILED: ${FAILURES} symlink target(s) failed verification" >&2
    exit 1
  fi
  node "$HOME/.claude/skills/$SKILL_NAME/scripts/route.mjs" --list >/dev/null
  node "$HOME/.gemini/antigravity-cli/skills/$SKILL_NAME/scripts/route.mjs" --json -- "PROJ-120 구현해줘" >/dev/null
  echo "OK: verified all host symlinks and CLI entrypoints"
fi
