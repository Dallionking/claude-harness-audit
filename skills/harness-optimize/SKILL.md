---
name: harness-optimize
description: Audit AND optimize this machine's Claude Code harness end-to-end — read recent session history, hooks, settings.json, skills, commands, state files (plus Codex and RTK if installed), find what's slow/dead/bloated, then APPLY safe fixes with backups and verify each one. Use when the user says "optimize my harness", "optimize my Claude Code setup", "my sessions feel slow/noisy", "clean up and fix my .claude", or after running /harness-audit and wanting the fixes applied. Triggers on: harness optimize, optimize harness, optimize my setup, tune claude code, fix my hooks, harness tune-up.
allowed-tools: Bash, Read, Glob, Grep, Write, Edit, Workflow, AskUserQuestion
---

# /harness-optimize — Audit, then actually fix your Claude Code harness

`/harness-audit` tells you what's wrong. This skill **applies the fixes** — safely, with a backup of every file it touches, a verification step after every change, and a PASS/MISS/SKIP report at the end. It adapts to whatever exists on the machine: a bare `~/.claude/` works; Codex, RTK, custom hook pipelines, and big session histories are detected and included only if present.

## Non-negotiable safety rules

1. **Backup before anything.** First action, always:
   ```bash
   STAMP=$(date +%Y-%m-%d-%H%M)
   BK=~/.claude/backups/harness-optimize-$STAMP
   mkdir -p "$BK" && cp ~/.claude/settings.json "$BK/" 2>/dev/null
   ```
   Every file you later modify gets copied into `$BK` *before* the edit. Every file you retire gets **moved** there — this skill never deletes anything, anywhere.
2. **Validate after every config edit.** `settings.json` → `python3 -c "import json; json.load(open(...))"`. TOML → `python3 -c "import tomllib; ..."`. An invalid config is worse than any problem you were fixing — restore from `$BK` immediately if validation fails.
3. **Never loosen safety to reduce friction.** If session history shows permission denials, *classify before touching*: denials of force-pushes, mass external sends, sandbox escapes, or recursive deletes are the permission system **working** — report them as healthy, do not add allow rules. Only propose allowlist additions for clearly-benign repeated read-only commands, and only via the user's confirmation.
4. **Evidence over assertion.** Never claim a fix worked without a command + real output proving it (the hook fires, the JSON parses, the file count dropped). No output = say "not yet verified."
5. **Findings are hypotheses.** Audit claims (yours or a subagent's) get re-verified against the live file before you act on them. Expect ~30% of first-pass findings to be wrong or stale.

## Phase 0 — Discover what exists (don't assume)

```bash
ls ~/.claude/ 2>/dev/null | head -40
[ -f ~/.claude/settings.json ] && wc -c ~/.claude/settings.json
ls ~/.claude/hooks/ 2>/dev/null | wc -l
ls ~/.codex/ 2>/dev/null | head -10        # Codex installed?
command -v rtk && rtk gain 2>&1 | head -8  # RTK installed?
find ~/.claude/projects -name "*.jsonl" -mtime -14 2>/dev/null | wc -l   # session volume
```
Build a surface map: which of {hooks, agents, skills, commands, state files, session history, Codex, RTK, statusline, plugins} this machine actually has. Everything later is conditional on this map.

## Phase 1 — Audit (reuse, don't reinvent)

If Dynamic Workflows are enabled, run the bundled scan: `Workflow({ name: "harness-optimize", args: { stamp: "<today>" } })` — parallel scanners + adversarial verification, returns a structured fix-plan. Note: `name:` resolution can serve a stale cached copy after the repo updates (e.g. `git pull` through the install symlink) — if results look out of date, invoke via `Workflow({ scriptPath: "~/.claude/workflows/harness-optimize.workflow.js", args: { stamp: "<today>" } })` to force the fresh file. Otherwise (or additionally), scan inline:

- **Dead hook references**: for every `hooks.*[].hooks[].command` in `settings.json`, check the referenced script exists and is executable. A hook whose target is missing fails silently on every matching event.
- **Orphans + clutter**: files in `~/.claude/hooks/` not referenced by `settings.json`; `*.bak*`, `*.disabled`, dated `_archive*`/`_backup*` dirs and tarballs at `~/.claude/` top level.
- **Over-broad matchers**: PreToolUse hooks with matchers like `Bash`, `Read`, or `Bash|WebFetch|Read` that spawn a process on *every* tool call for a niche purpose. Each costs ~50–100ms of interpreter startup per call. Scope the matcher to the actual trigger patterns (`Bash(*ffmpeg*)|Bash(*.mp4*)` style) or move to on-demand.
- **Duplicate prompt-parsers**: multiple UserPromptSubmit hooks that each re-parse the prompt and inject overlapping context = duplicated tokens on every message. Check for: missing dedup windows, and missing guards against machine-generated content (`<task-notification>`, `<tool_use_result>`, command output) — hooks firing on non-user messages is pure waste.
- **Unbounded state files**: `find ~/.claude -maxdepth 3 -name "*.jsonl" -size +250k -not -path "*/projects/*"` — append-only logs that grow forever slow down every hook that reads them.
- **Instruction-surface weight**: `wc -c` every always-loaded file (`~/.claude/CLAUDE.md` + its `@includes`); ÷4 ≈ tokens paid on every single message. Over ~5k tokens → recommend the router pattern (lean always-on entry + load-on-demand references).
- **Session-history friction** (if history exists): sample the most recent ~30 transcripts:
  ```bash
  cd ~/.claude/projects/<most-active-dir>
  grep -l '"is_error":true' $(ls -t *.jsonl | head -30) | wc -l          # error-loop sessions
  grep -ho 'has been denied[^"]\{0,80\}' $(ls -t *.jsonl | head -30) | sort | uniq -c | sort -rn | head   # denial classes
  ```
  Look for: repeated identical failing commands, recovery rituals (`/continue`, kill-session loops), and hook-latency markers (`"durationMs":5...` on PreToolUse ≈ a hook hitting its timeout).
- **RTK (if installed)**: `rtk gain` warnings (outdated/missing hook) and `rtk discover | head -40` (missed rewrite volume).
- **Codex (if installed)**: stale duplicate instruction surfaces (`instructions.md` vs `AGENTS.md` vs `AGENTS.override.md` — newest wins, ancestors confuse), broken symlinks, plaintext API keys in `config.toml`, `*.bak*` litter. Codex loads `AGENTS.override.md` over `AGENTS.md` when both exist.
- **Secrets in configs**: API keys as literals in any config file → flag with a redacted preview. Moving them is a *guided* fix (see Phase 3) and rotation is always recommended since they've been sitting in plaintext.

## Phase 2 — Plan + ask the user the decisions that matter

Rank fixes by (blast-radius × confidence ÷ effort). Then use AskUserQuestion for the genuinely user-owned calls — typically: **cleanup aggressiveness** (retire-to-backup vs report-only), **scope** (touch Codex/other CLIs or Claude-only), and anything that changes live behavior they might be relying on. Don't ask about objectively-safe fixes (dead refs, JSON-invalid configs); just do those.

## Phase 3 — Apply (the fix patterns)

Work smallest-risk first. After each fix: validate + smoke-test before moving on.

| Fix | Pattern |
|---|---|
| Dead hook ref | Remove the entry from `settings.json` (backup first) → re-validate JSON. |
| Orphan/.bak/.disabled hooks | `mv` into `$BK/hooks-retired/`. Re-grep configs for dangling references afterward. |
| Over-broad matcher | Rewrite matcher to the narrow trigger set. Smoke-test: `echo '<sample-json>' | <hook-cmd>` still emits/exits correctly. |
| Duplicate prompt-parsers | Add a shared skip for machine-generated content + a dedup window keyed in one shared state file. Full consolidation into one router is the deep fix — offer it, don't force it. |
| Unbounded state files | Install a rotation script (keep newest ~2000 lines, gzip the trimmed head next to the file) wired to SessionEnd. Run it once now and show the line-count drop. |
| Archive clutter | Consolidate into `~/.claude/backups/archive-consolidated-<date>/`. Report MB moved. |
| RTK outdated | `rtk init -g`, then **verify the hook actually landed in settings.json** — non-interactive init can remove the old hook without installing the new one. Wire `rtk hook claude` under a `Bash` matcher if missing; verify: `echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git status"}}' | rtk hook claude` returns an updatedInput. |
| Secrets in config | Move values to a `chmod 600` env file; reference via env inheritance where the tool supports it, or a tiny exec-wrapper that sources the env file first (survives GUI launches that skip shell rc files). Print a rotation checklist — the old values were exposed. |
| Instruction bloat | Propose the router split; only apply with user approval (it changes what the model always sees). |

## Phase 4 — Verify + report

- Re-run the Phase-1 scans that found problems; paste the before→after numbers (dead refs 4→0, state file 11k→2k lines, hooks dir 35→25 entries…).
- `python3 -m json.tool ~/.claude/settings.json > /dev/null && echo settings-valid` one final time. (Bare `~` as a shell argument is expanded before Python sees it; `open('~/...')` inside a Python string is not.)
- If anything was MISS or intentionally skipped, say so loudly.

End with the table — one line per finding:

```
PASS  dead-hook-refs        4 removed, settings.json valid, smoke-tested
PASS  state-rotation        11,889 → 2,000 lines, archive created
SKIP  prompt-router merge   offered, user chose minimal dedup instead
MISS  codex secrets         3 url-based servers have no wrapper path — rotation list printed
```

A flagged gap is professional; a buried one is the failure.
