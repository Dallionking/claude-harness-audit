---
name: harness-audit
description: Audit this machine's Claude Code harness (hooks, settings.json, agents, skills, commands, session history) and produce adversarially-verified delete/update/enhance recommendations plus a runnable benchmark suite. Use when the user says "audit my harness", "audit my Claude Code setup", "find dead hooks/config", "what should I delete/clean up in ~/.claude", or wants to convert hand-run multi-agent rituals into Workflow scripts. Triggers on: harness audit, audit harness, harness health, clean up .claude, dead hooks, config drift.
allowed-tools: Bash, Read, Glob, Grep, Write, Workflow
---

# /harness-audit — Audit your Claude Code harness with Workflows

Turns the Claude Code **Workflows** feature on your own `~/.claude/` to find rot and prove the fixes.

## When to use
- Your harness has grown (custom hooks, many agents/skills/commands) and you suspect drift.
- You renamed/disabled scripts and aren't sure what still points where.
- You run the same multi-agent ritual by hand every session and want to script it.
- Before a model upgrade — re-check which gates/context-resets are still load-bearing.

## What it does (4 phases, all local)
1. **Inventory** — parallel auditors over: hooks + `settings.json` (dead refs, latency, fail-open/closed), the always-on instruction surface (context budget), agents (overlap, model tiers, broken skill wiring), skills + commands (duplication, orphans, routing coverage), and recent session history (recurring friction → candidate hooks/skills/workflows).
2. **Synthesize** — merge/dedupe into ranked **delete / update / enhance / new** recommendations with evidence (`file:line`), effort, and dependencies.
3. **Verify** — one adversarial refuter per recommendation re-reads the cited file *now* and marks it **confirmed / needs-scoping / rejected**. This is the most important phase — first-pass findings are a hypothesis, not truth.
4. **Benchmark** — a runnable before/after suite (context-budget bytes, hook `missing_target_files`, hook latency, dead-reference count) so every fix is provable.

## How to run

1. Ensure Dynamic Workflows are on: `/config` → Dynamic workflows (Claude Code v2.1.154+).
2. Run the workflow:

```
Workflow({ name: "harness-audit", args: { stamp: "<today's date, YYYY-MM-DD>" } })
```

Pass today's date as `stamp` so artifacts land in `~/.claude/harness-audit-<date>/`, the same directory as the bench baseline below (without `args.stamp` the workflow defaults to `~/.claude/harness-audit-audit/`).

Or, if invoked conversationally, the orchestrator should:
- Capture a baseline snapshot first (see `bench` below) — the immutable "before".
- Launch `harness-audit.workflow.js`.
- Read the artifacts it writes to `~/.claude/harness-audit-<date>/` and present delete/update/enhance + benchmarks.

## Golden rules (do not skip)
- **Capture the baseline BEFORE any fix.** Without a committed "before", every "I fixed it" is unverifiable self-attestation — the exact problem this audit exists to kill.
- **Never apply an unverified recommendation.** Apply only `confirmed` ones as-written; apply `needs-scoping` ones with the correction; skip `rejected`.
- **Fix the cheapest, highest-blast-radius items first** (dead hooks fire on every matching event — clearing them de-noises every other benchmark).
- **Keep existing state files and git guards** as fail-closed defense-in-depth; workflows write into them, they don't replace them.

## Companion workflow: gap-loop
`gap-loop.workflow.js` (`/gap-loop`) is a standalone bounded gap-analysis loop — rounds of adversarial analysis until N consecutive clean rounds (zero findings AND score ≥ threshold), auto-fixing between rounds, with a soft escalation cap. Use it on any change set, PRD, or feature. It's the smallest, highest-leverage "ritual → workflow" conversion and a good first taste of the pattern.

## Baseline snapshot (run before fixing)

```bash
SUITE="$HOME/.claude/harness-audit-$(date +%Y-%m-%d)/bench/baseline"; mkdir -p "$SUITE"
# context budget
ib=$(cat ~/.claude/CLAUDE.md ~/.claude/*.md 2>/dev/null | wc -c); echo "instruction_bytes=$ib approx_tokens=$((ib/4))" | tee "$SUITE/context-budget.txt"
# hook health (dead target files)
python3 - <<'PY' | tee "$SUITE/hook-failures.txt"
import json,os,shlex
p=os.path.expanduser("~/.claude/settings.json")
s=json.load(open(p)) if os.path.exists(p) else {}
missing=total=0
for ev,arr in s.get("hooks",{}).items():
    for g in arr:
        for h in g.get("hooks",[]):
            total+=1
            for t in shlex.split(h.get("command","")):
                if t.startswith("/") and any(x in t for x in (".sh",".cjs",".py",".js")):
                    if not os.path.exists(t): print("MISSING",ev,t); missing+=1
                    break
print(f"total_hook_commands={total} missing_target_files={missing}")
PY
```

After applying fixes, re-run into `.../bench/after/` and diff. `missing_target_files` should reach 0.
