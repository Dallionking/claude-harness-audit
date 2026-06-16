#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# skill-parity-sync.sh — Claude ⇄ Codex skill parity
#
# Model:  Claude (~/.claude/skills) is CONTENT-CANONICAL for the portable skill
#         library (richer frontmatter, newest substantive edits). Codex mirrors it.
#         A small CODEX_CANONICAL exception list names skills genuinely developed in
#         Codex (those flow Codex→Claude). Each harness keeps its own NATIVE skills
#         (Codex .system/ + persona bundles; Claude infra dirs).
#
# Operations (in order):
#   1. PULL        — unique Codex-only skills → Claude (Claude becomes the superset)
#   2. ARCHIVE     — superseded Codex skills (replaced by a Claude consolidation/rename)
#   3. DRIFT merge — shared skills whose content diverged: overwrite the stale side
#                    from the canonical side (Claude by default; CODEX_CANONICAL reversed)
#   4. PUSH        — Claude-only skills → Codex (pure add)
#   5. REPORT
#
# Safety: archive-not-delete · EVERY overwrite archives the losing copy first
#         (100% reversible) · idempotent · --apply required to write (dry-run default).
# Usage:  bash skill-parity-sync.sh            # dry-run, prints plan
#         bash skill-parity-sync.sh --apply     # execute
# ─────────────────────────────────────────────────────────────────────────────
set -eo pipefail   # NOT -u: bash 3.2 throws on empty-array "${arr[@]}" expansions (the loops below)

CLAUDE_DIR="$HOME/.claude/skills"
CODEX_DIR="$HOME/.codex/skills"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_DIR="$HOME/.coding-harness/skill-vault/_archive/skill-parity-$STAMP"
REPORT="$HOME/.coding-harness/skill-vault/parity-audits/$STAMP-parity-sync.md"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# ── Curated classification — STRUCTURAL defaults (publishable / no private names).
#    Harness-specific skill names load from a LOCAL config so they never enter a
#    public copy of this script. See skill-parity.config.example.sh.
CODEX_NATIVE=( .system _shared _install-reports )   # Codex infra; extend via local config
SUPERSEDED=()                                       # Codex skills replaced by a Claude consolidation → archive
CODEX_CANONICAL=()                                  # shared skills where Codex's copy wins on drift
CLAUDE_INFRA=( _install-reports _shared )           # Claude infra dirs never pushed to Codex

# Local overrides (private, gitignored) — may APPEND to the arrays above.
PARITY_CONFIG="${SKILL_PARITY_CONFIG:-$HOME/.coding-harness/skill-vault/skill-parity.config.sh}"
[ -f "$PARITY_CONFIG" ] && source "$PARITY_CONFIG"

in_list() { local x="$1"; shift; local e; for e in "$@"; do [[ "$e" == "$x" ]] && return 0; done; return 1; }

# ── Enumerate ────────────────────────────────────────────────────────────────
claude_skills=(); for d in "$CLAUDE_DIR"/*/; do n="$(basename "$d")"; in_list "$n" "${CLAUDE_INFRA[@]}" || claude_skills+=("$n"); done
codex_skills=();  for d in "$CODEX_DIR"/*/;  do codex_skills+=("$(basename "$d")"); done
is_claude(){ in_list "$1" "${claude_skills[@]}"; }
is_codex(){  in_list "$1" "${codex_skills[@]}"; }

# Codex-only → PULL (portable) / ARCHIVE (superseded) / skip (native) / LEFTOVER
PULL=(); ARCHIVE=(); LEFTOVER=()
for n in "${codex_skills[@]}"; do
  is_claude "$n" && continue
  in_list "$n" "${CODEX_NATIVE[@]}" && continue
  if in_list "$n" "${SUPERSEDED[@]}"; then ARCHIVE+=("$n")
  elif [[ -f "$CODEX_DIR/$n/SKILL.md" ]]; then PULL+=("$n")
  else LEFTOVER+=("$n"); fi
done

# Claude skills → PUSH (missing in Codex) / DRIFT (content differs)
PUSH=(); DRIFT_PUSH=(); DRIFT_PULL=()
for n in "${claude_skills[@]}"; do
  [[ -f "$CLAUDE_DIR/$n/SKILL.md" ]] || continue
  if ! is_codex "$n"; then PUSH+=("$n"); continue; fi
  diff -q "$CLAUDE_DIR/$n/SKILL.md" "$CODEX_DIR/$n/SKILL.md" >/dev/null 2>&1 && continue
  if in_list "$n" "${CODEX_CANONICAL[@]}"; then DRIFT_PULL+=("$n"); else DRIFT_PUSH+=("$n"); fi
done

# ── Plan output ──────────────────────────────────────────────────────────────
echo "═══ skill-parity-sync ($([[ $APPLY == 1 ]] && echo APPLY || echo DRY-RUN)) ═══"
echo "Claude portable: ${#claude_skills[@]}   Codex: ${#codex_skills[@]}"
echo "PULL  (Codex→Claude, unique):       ${#PULL[@]}"
echo "PUSH  (Claude→Codex, missing):      ${#PUSH[@]}"
echo "DRIFT→Codex (Claude canonical):     ${#DRIFT_PUSH[@]}"
echo "DRIFT→Claude (Codex canonical):     ${#DRIFT_PULL[@]}   ${DRIFT_PULL[*]:-none}"
echo "ARCHIVE (superseded, reversible):   ${#ARCHIVE[@]}   ${ARCHIVE[*]:-none}"
echo "LEFTOVER (Codex-only, review):      ${#LEFTOVER[@]}   ${LEFTOVER[*]:-none}"

if [[ $APPLY == 0 ]]; then echo; echo "Dry-run only. Re-run with --apply to execute."; exit 0; fi

# ── Execute (archive-before-overwrite throughout) ────────────────────────────
mkdir -p "$ARCHIVE_DIR/_overwritten-codex" "$ARCHIVE_DIR/_overwritten-claude" \
         "$ARCHIVE_DIR/_superseded" "$(dirname "$REPORT")"

# copy SRC tree → DEST (exclude .git/.DS_Store; macOS-reliable; tolerates read-only git objects)
copytree(){ mkdir -p "$2"; ( cd "$1" && tar cf - --exclude='./.git' --exclude='*/.git' --exclude='.DS_Store' . ) | ( cd "$2" && tar xpf - ); }
# mirror: drop a BROKEN symlink at the dest first (repairs dangling ../../.agents/skills links);
# writes THROUGH a live symlink (preserves intentional external links).
mirror(){ { [ -L "$2" ] && [ ! -e "$2" ] && rm -f "$2"; } ; copytree "$1" "$2"; }

for n in "${PULL[@]}"; do mirror "$CODEX_DIR/$n" "$CLAUDE_DIR/$n"; done
for n in "${ARCHIVE[@]}"; do mv "$CODEX_DIR/$n" "$ARCHIVE_DIR/_superseded/"; done
for n in "${PUSH[@]}"; do mirror "$CLAUDE_DIR/$n" "$CODEX_DIR/$n"; done
for n in "${DRIFT_PUSH[@]}"; do                       # Claude → Codex (archive old Codex)
  copytree "$CODEX_DIR/$n" "$ARCHIVE_DIR/_overwritten-codex/$n"; mirror "$CLAUDE_DIR/$n" "$CODEX_DIR/$n"; done
for n in "${DRIFT_PULL[@]}"; do                       # Codex → Claude (archive old Claude)
  copytree "$CLAUDE_DIR/$n" "$ARCHIVE_DIR/_overwritten-claude/$n"; mirror "$CODEX_DIR/$n" "$CLAUDE_DIR/$n"; done

# ── Normalize frontmatter → strict-valid YAML (Codex's Rust parser is strict; ──
#    Claude's is lenient. Fixes \\' escapes / unquoted colons / missing delimiters
#    that make Codex drop skills. Deterministic + idempotent → parity preserved. ──
NORMALIZER="$HOME/.coding-harness/skill-vault/normalize-skill-frontmatter.py"
if [[ -f "$NORMALIZER" ]]; then
  echo "Normalizing frontmatter (Codex-strict YAML)…"
  python3 "$NORMALIZER" --apply "$CLAUDE_DIR" "$STAMP" 2>&1 | grep -E "^(FIXED|SYNTHESIZED|STILL_INVALID):" || true
  python3 "$NORMALIZER" --apply "$CODEX_DIR"  "$STAMP" 2>&1 | grep -E "^(FIXED|SYNTHESIZED|STILL_INVALID):" || true
fi

# ── Report ───────────────────────────────────────────────────────────────────
set +u   # empty-array expansions below are informational (bash 3.2 + set -u safe)
{
  echo "# Skill Parity Sync — $STAMP"
  echo
  echo "Content-canonical: Claude (\`~/.claude/skills\`), except CODEX_CANONICAL skills."
  echo
  echo "| op | count | direction |"
  echo "|----|-------|-----------|"
  echo "| PULL unique | ${#PULL[@]} | Codex→Claude |"
  echo "| PUSH missing | ${#PUSH[@]} | Claude→Codex |"
  echo "| DRIFT resync | ${#DRIFT_PUSH[@]} | Claude→Codex |"
  echo "| DRIFT resync | ${#DRIFT_PULL[@]} | Codex→Claude (${DRIFT_PULL[*]:-—}) |"
  echo "| ARCHIVE superseded | ${#ARCHIVE[@]} | ${ARCHIVE[*]:-—} |"
  echo "| LEFTOVER | ${#LEFTOVER[@]} | ${LEFTOVER[*]:-—} |"
  echo
  echo "## PULLed into Claude"; printf '%s\n' "${PULL[@]:-—}" | sort | sed 's/^/- /'
  echo "## PUSHed to Codex (missing)"; printf '%s\n' "${PUSH[@]:-—}" | sort | sed 's/^/- /'
  echo
  echo "Archive (reversible): \`$ARCHIVE_DIR\`"
  echo "Codex-native (kept Codex-only): ${CODEX_NATIVE[*]}"
} > "$REPORT"

echo; echo "Applied. Report: $REPORT"; echo "Archive: $ARCHIVE_DIR"
