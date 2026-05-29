export const meta = {
  name: 'harness-audit',
  description: 'Audit this machine\'s Claude Code harness (hooks/settings, instruction surface, agents, skills/commands, session history) and produce adversarially-verified delete/update/enhance recommendations plus a runnable benchmark suite. Local-only; reads ~/.claude.',
  phases: [
    { title: 'Inventory', detail: 'parallel auditors over each harness domain' },
    { title: 'Synthesize', detail: 'merge into ranked delete/update/enhance/new recommendations' },
    { title: 'Verify', detail: 'one adversarial refuter per recommendation, re-checked on disk' },
    { title: 'Benchmark', detail: 'runnable before/after suite + gap analysis' },
  ],
}

// args = { home?: "~/.claude", outDir?: "...", maxRecsToVerify?: 40 }
const A = (args && typeof args === 'object') ? args : {}
const HOME = A.home || `${process.env.HOME}/.claude`
const STAMP = A.stamp || 'audit'   // pass a date stamp from the caller; runtime has no Date.now()
const OUT = A.outDir || `${process.env.HOME}/.claude/harness-audit-${STAMP}`

const CTX = `
This audits the LIVE Claude Code harness under ${HOME} on this machine. Read real files; cite file:line.
Every finding maps to delete / update / enhance / new with an effort size (S<=30m, M<=half-day, L multi-session).
Write detailed findings to ${OUT}/findings/<domain>.md and return the structured summary.
Common rot to look for: hook commands whose target file is missing or *.disabled; docs (CLAUDE.md) that claim a
guardrail is enforced when its hook is dead; an oversized always-on instruction surface; vendored repos bloating any
referenced dir so grep is poisoned; backup/cruft files inside loaded dirs; duplicate/orphan skills+commands; agents with
broken skill wiring or stale model pins; and hand-run multi-agent rituals (gap analysis, gate pipelines, councils,
swarms) that should become reusable Workflow scripts.
`

const FINDINGS_SCHEMA = {
  type: 'object', required: ['domain', 'summary', 'findings', 'findings_file'], additionalProperties: true,
  properties: {
    domain: { type: 'string' }, summary: { type: 'string' }, findings_file: { type: 'string' },
    metrics: { type: 'object', additionalProperties: true },
    findings: { type: 'array', items: { type: 'object', required: ['title', 'severity', 'category', 'evidence', 'recommendation'], additionalProperties: true,
      properties: {
        title: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        category: { type: 'string', enum: ['delete', 'update', 'enhance', 'keep', 'new'] },
        evidence: { type: 'string' }, recommendation: { type: 'string' }, effort: { type: 'string', enum: ['S', 'M', 'L'] },
      } } },
  },
}

phase('Inventory')
const DOMAINS = [
  { key: 'hooks-settings', p: `${CTX}\nDOMAIN: hooks + settings.json. Read ${HOME}/settings.json fully; for EVERY hook command verify the target file exists. Evaluate dead/broken refs, redundant matchers + cumulative per-event latency, timeout budgets that can stall the loop, fail-open vs fail-closed posture, and whether documented enforcement matches the wired hooks. Also review permission allow/deny coverage.` },
  { key: 'instruction-surface', p: `${CTX}\nDOMAIN: the always-on context. Read ${HOME}/CLAUDE.md and any always-loaded *.md. Estimate total tokens auto-loaded at SessionStart and name the biggest consumer. Find contradictions/stale rules, duplication across files, and prose that should be tables/checklists.` },
  { key: 'agents', p: `${CTX}\nDOMAIN: agents (${HOME}/agents/). Read frontmatter of each. Find overlap/redundant clusters, model-tier mismatches or missing model fields, agents referenced nowhere, broken skills: wiring, and thin/bloated definitions. Put counts in metrics.` },
  { key: 'skills-commands', p: `${CTX}\nDOMAIN: skills + commands (be systematic with ls/grep, do NOT read every file). Quantify duplication (mirror skills, multiple namespaces for the same thing), naming collisions, orphan skills referenced by nothing, and routing coverage vs any routing doc. Flag top candidates to convert into Workflow scripts. Put counts in metrics.` },
  { key: 'session-history', p: `${CTX}\nDOMAIN: session history. Find any session logs/transcripts this harness keeps (e.g. ${HOME}/projects/**/*.jsonl or a brain/sessions dir). Sample recent ones. Extract RECURRING friction (same fix across sessions = strongest signal for a new hook/skill/workflow), hand-run rituals that should be scripts, what consistently works, and what consistently fails. Be honest that this is sampled, not exhaustive. Frame findings as delete/update/enhance/new.` },
]
const inventory = (await parallel(DOMAINS.map((d) => () =>
  agent(d.p, { label: `audit:${d.key}`, phase: 'Inventory', schema: FINDINGS_SCHEMA })))).filter(Boolean)
log(`Inventory: ${inventory.length}/${DOMAINS.length} domains, ${inventory.reduce((n, r) => n + (r.findings?.length || 0), 0)} raw findings`)

phase('Synthesize')
const SYNTH_SCHEMA = {
  type: 'object', required: ['recommendations', 'workflow_candidates'], additionalProperties: true,
  properties: {
    executive_summary: { type: 'string' },
    recommendations: { type: 'array', items: { type: 'object', required: ['id', 'title', 'type', 'priority', 'rationale', 'evidence'], additionalProperties: true,
      properties: { id: { type: 'string' }, title: { type: 'string' }, type: { type: 'string', enum: ['update', 'delete', 'enhance', 'new'] },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, rationale: { type: 'string' }, evidence: { type: 'string' },
        affected_paths: { type: 'array', items: { type: 'string' } }, effort: { type: 'string', enum: ['S', 'M', 'L'] } } } },
    workflow_candidates: { type: 'array', items: { type: 'object', required: ['name', 'replaces'], additionalProperties: true,
      properties: { name: { type: 'string' }, replaces: { type: 'string' }, why: { type: 'string' } } } },
  },
}
const synthesis = await agent(`${CTX}\nYou are the SYNTHESIS lead. Merge/dedupe these domain findings into ranked recommendations (P0 = broken-now or high-leverage-low-effort). Identify which hand-run rituals should become Workflow scripts. Write the full set to ${OUT}/RECOMMENDATIONS.md and a durable workflow-patterns note to ${OUT}/NOTES.md.\n\nFINDINGS:\n${JSON.stringify(inventory, null, 1)}`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA })
log(`Synthesis: ${synthesis.recommendations.length} recommendations, ${synthesis.workflow_candidates.length} workflow candidates`)

phase('Verify')
const VERDICTS_SCHEMA = {
  type: 'object', required: ['verdicts'], additionalProperties: false,
  properties: { verdicts: { type: 'array', items: { type: 'object', required: ['rec_id', 'verdict', 'confidence', 'reasoning'], additionalProperties: false,
    properties: { rec_id: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'needs-scoping', 'rejected'] },
      confidence: { type: 'number' }, risk: { type: 'string' }, reasoning: { type: 'string' }, corrections: { type: 'string' } } } } },
}
// batch the recommendations so verifiers reliably emit StructuredOutput (one-agent-per-rec is failure-prone)
const recs = synthesis.recommendations.slice(0, A.maxRecsToVerify || 40)
const BATCH = 5
const batches = []
for (let i = 0; i < recs.length; i += BATCH) batches.push(recs.slice(i, i + BATCH))
const verifyResults = (await parallel(batches.map((b, i) => () =>
  agent(`${CTX}\nYou are an ADVERSARIAL VERIFIER. For EACH recommendation below, OPEN the cited files and try to REFUTE the claim. confirmed = evidence holds now AND safe+worth doing; needs-scoping = real issue but partly wrong/mis-scoped/risky (say the correction); rejected = evidence does not hold (already fixed / false). Be skeptical.\n\nRECS:\n${b.map((r) => `[${r.id}] (${r.type}/${r.priority}) ${r.title}\n  RATIONALE: ${r.rationale}\n  EVIDENCE: ${r.evidence}`).join('\n\n')}\n\nHARD REQUIREMENT: your ONLY output is one StructuredOutput call with the verdicts array (one per rec). No prose.`,
    { label: `verify:batch${i + 1}`, phase: 'Verify', schema: VERDICTS_SCHEMA })))).filter(Boolean)
const verdicts = verifyResults.flatMap((r) => r.verdicts || [])
const by = (v) => verdicts.filter((x) => x.verdict === v)
log(`Verify: ${verdicts.length}/${recs.length} — confirmed ${by('confirmed').length}, needs-scoping ${by('needs-scoping').length}, rejected ${by('rejected').length}`)

phase('Benchmark')
const BENCH_SCHEMA = {
  type: 'object', required: ['benchmarks', 'gaps'], additionalProperties: true,
  properties: {
    benchmarks: { type: 'array', items: { type: 'object', required: ['name', 'metric', 'how_to_measure', 'target'], additionalProperties: true,
      properties: { name: { type: 'string' }, metric: { type: 'string' }, how_to_measure: { type: 'string' }, baseline_command: { type: 'string' }, target: { type: 'string' }, ties_to: { type: 'array', items: { type: 'string' } } } } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}
const bench = await agent(`${CTX}\nDesign a runnable benchmark suite so each confirmed recommendation is provable on THIS machine (copy-paste shell commands measuring: SessionStart context bytes, hook missing_target_files + latency, dead-reference/size counts, and one workflow-vs-handrun token comparison). Include a baseline_command per benchmark. Then a final honest GAP ANALYSIS of what this audit could not cover. Write to ${OUT}/BENCHMARKS.md.\n\nVERIFIED RECS:\n${JSON.stringify(verdicts, null, 1)}`,
  { label: 'benchmark', phase: 'Benchmark', schema: BENCH_SCHEMA })
log(`Benchmarks: ${bench.benchmarks.length} defined, ${bench.gaps.length} gaps`)

return {
  executive_summary: synthesis.executive_summary,
  counts: { recommendations: recs.length, confirmed: by('confirmed').length, needs_scoping: by('needs-scoping').length, rejected: by('rejected').length, benchmarks: bench.benchmarks.length, workflow_candidates: synthesis.workflow_candidates.length },
  confirmed: by('confirmed').map((v) => v.rec_id),
  needs_scoping: by('needs-scoping').map((v) => ({ id: v.rec_id, correction: v.corrections })),
  rejected: by('rejected').map((v) => ({ id: v.rec_id, why: v.reasoning })),
  workflow_candidates: synthesis.workflow_candidates,
  artifacts: { recommendations: `${OUT}/RECOMMENDATIONS.md`, benchmarks: `${OUT}/BENCHMARKS.md`, notes: `${OUT}/NOTES.md`, findings: `${OUT}/findings/` },
}
