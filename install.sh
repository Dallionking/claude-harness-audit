#!/usr/bin/env bash
# Install claude-harness-audit into your Claude Code user config (~/.claude/).
# Symlinks by default so `git pull` updates in place. Pass --copy to copy instead.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"
MODE="link"
[ "${1:-}" = "--copy" ] && MODE="copy"

mkdir -p "$DEST/skills" "$DEST/workflows"

place() {
  local from="$1" to="$2"
  rm -rf "$to"
  if [ "$MODE" = "link" ]; then ln -s "$from" "$to"; else cp -r "$from" "$to"; fi
  echo "  $MODE  $to"
}

echo "Installing claude-harness-audit -> $DEST"
place "$SRC/skills/harness-audit" "$DEST/skills/harness-audit"
for wf in "$SRC"/workflows/*.workflow.js; do
  place "$wf" "$DEST/workflows/$(basename "$wf")"
done

cat <<'EOF'

Done. Next:
  1. Enable workflows:  Claude Code -> /config -> Dynamic workflows -> on  (needs v2.1.154+)
  2. Run it:            /harness-audit     (or: "audit my Claude Code harness")
  3. Single gap loop:   /gap-loop

Artifacts land in ~/.claude/harness-audit-<date>/. Commit bench/baseline/ as your "before".
EOF
