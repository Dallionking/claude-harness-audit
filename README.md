# claude-harness-audit

**Audit your Claude Code harness with the Workflows feature — find dead hooks, bloated context, stale config, and rituals you should turn into scripts. Every finding is adversarially verified and shipped with a benchmark so you can prove the fix worked.**

If you've grown a real Claude Code setup — custom hooks, dozens of agents, hundreds of skills, slash commands, session history — it rots. Hooks point at files you renamed. Your `CLAUDE.md` claims a guardrail is active when the script behind it is disabled. `references/` quietly grows to gigabytes and poisons every `grep`. You run the same multi-agent ritual (gap analysis, gate pipelines, councils) by hand every session, burning tokens babysitting subagents.

This skill turns the **Claude Code Workflows feature** (write scripts that call subagents) on your own harness:

1. **Inventory** — parallel auditors over your hooks/settings, instruction surface, agents, skills/commands, and session history.
2. **Synthesize** — merge into ranked **delete / update / enhance / new** recommendations.
3. **Verify** — one adversarial refuter per recommendation re-checks the evidence on disk. Catches the ~30% of first-pass findings that are wrong (already-fixed, mis-scoped, phantom paths).
4. **Benchmark** — a runnable suite (context-budget, hook health/latency, dead-reference count) so every "I fixed it" is provable, not self-attested.

## Requirements

- Claude Code **v2.1.154+** with Dynamic Workflows enabled (`/config` → Dynamic workflows → on).
- That's it. No API keys, no external services. Everything runs locally over your own `~/.claude/`.

## Install

```bash
git clone https://github.com/<you>/claude-harness-audit
cd claude-harness-audit
./install.sh          # symlinks the skill + workflows into ~/.claude/
```

Or copy manually:
```bash
cp -r skills/harness-audit ~/.claude/skills/
cp workflows/*.workflow.js ~/.claude/workflows/
```

## Use

In Claude Code:
```
/harness-audit
```
or just ask: *"audit my Claude Code harness."* The skill runs the workflow, writes artifacts to `~/.claude/harness-audit-<date>/`, and reports what to delete, update, enhance, plus a benchmark suite.

Run a single bounded gap-analysis loop on anything:
```
/gap-loop   (then describe the target)
```

## What you get

```
~/.claude/harness-audit-<date>/
  RECOMMENDATIONS.md      # ranked delete/update/enhance/new, with evidence + effort
  VERIFICATION.md         # confirmed / needs-scoping / rejected verdicts
  BENCHMARKS.md           # runnable before/after suite + honest gap analysis
  findings/               # per-domain raw reports
  bench/baseline/         # your "before" snapshot — commit this
```

## Why adversarial verification matters

The audit's first pass is a hypothesis. The verify phase re-reads the cited file *right now* and tries to refute each claim. In testing on a large real harness, this caught recommendations that would have caused wrong fixes — editing paths that don't exist, using a CLI flag that isn't real, deleting a still-live component. **Never apply an unverified harness recommendation.**

## License

MIT — see [LICENSE](LICENSE). Built with Claude Code.
