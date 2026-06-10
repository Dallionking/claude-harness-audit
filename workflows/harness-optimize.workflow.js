export const meta = {
  name: 'harness-optimize',
  description: 'Optimization scan for the local Claude Code harness: parallel scanners over hooks/settings latency + dead refs, state-file growth, session-history friction, clutter, and optional Codex/RTK surfaces; adversarially verifies findings and returns a structured, ranked fix-plan the harness-optimize skill then applies with backups.',
  phases: [
    { title: 'Discover', detail: 'map which surfaces exist on this machine' },
    { title: 'Scan', detail: 'parallel scanners per surface' },
    { title: 'Verify', detail: 'one adversarial refuter per proposed fix' },
  ],
}

// args = { home?: "~/.claude", stamp?: "2026-01-01", outDir?: "...", maxFixesToVerify?: 30 }
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = {} } }
if (!A || typeof A !== 'object') A = {}
// NOTE: the workflow runtime exposes no `process`/Node APIs. Paths use ~ and are
// expanded by the agents' shell. Pass a date stamp via args; runtime has no Date.now().
const HOME = A.home || '~/.claude'
const STAMP = A.stamp || 'optimize'
const OUT = A.outDir || `~/.claude/harness-optimize-${STAMP}`
const MAX_VERIFY = A.maxFixesToVerify || 30

const CTX = `
You are scanning the LIVE Claude Code harness under ${HOME} on this machine to produce APPLYABLE fixes.
Read real files; every fix must cite evidence (file:line or command output). Write detailed notes to
${OUT}/scan/<domain>.md and return the structured summary. Severity reflects per-message cost: something
that fires on EVERY prompt or EVERY tool call outranks a one-time cost. Do not propose loosening any
permission/deny rule. Do not propose deleting anything — retire-to-backup only. Fixes must be concrete
enough to apply mechanically (exact file, exact change), not advisory prose.
`

const FIX_SCHEMA = {
  type: 'object', required: ['domain', 'summary', 'fixes'], additionalProperties: true,
  properties: {
    domain: { type: 'string' }, summary: { type: 'string' },
    metrics: { type: 'object', additionalProperties: true },
    fixes: { type: 'array', items: { type: 'object', required: ['title', 'severity', 'kind', 'evidence', 'apply'], additionalProperties: true,
      properties: {
        title: { type: 'string' },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        kind: { type: 'string', enum: ['dead-ref', 'orphan-clutter', 'broad-matcher', 'duplicate-injector', 'state-growth', 'instruction-bloat', 'secret-exposure', 'rtk', 'codex-drift', 'session-friction', 'other'] },
        evidence: { type: 'string' },
        apply: { type: 'string', description: 'exact mechanical change: file + edit, or command sequence' },
        verify: { type: 'string', description: 'command that proves the fix landed' },
        effort: { type: 'string', enum: ['S', 'M', 'L'] },
        needs_user_decision: { type: 'boolean' },
      } } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', required: ['verdict', 'reason'], additionalProperties: true,
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'needs-scoping', 'rejected'] },
    reason: { type: 'string' },
    corrected_apply: { type: 'string' },
  },
}

// ── Phase 1: discover which surfaces exist ──────────────────────────────────
phase('Discover')
const surfaces = await agent(`${CTX}
Map which surfaces exist on this machine. Run:
  ls ${HOME}/ ; [ -f ${HOME}/settings.json ] && echo settings=yes
  ls ${HOME}/hooks/ 2>/dev/null | wc -l ; ls ${HOME}/skills/ 2>/dev/null | wc -l ; ls ${HOME}/commands/ 2>/dev/null | wc -l
  [ -d ~/.codex ] && echo codex=yes && ls ~/.codex/ | head -5
  command -v rtk >/dev/null && echo rtk=yes
  find ${HOME}/projects -name "*.jsonl" -mtime -14 2>/dev/null | wc -l
Return JSON: { has_settings, hooks_count, skills_count, commands_count, has_codex, has_rtk, recent_sessions } plus 1-line notes.`, {
  label: 'discover', phase: 'Discover',
  schema: { type: 'object', required: ['has_settings'], additionalProperties: true,
    properties: { has_settings: { type: 'boolean' }, hooks_count: { type: 'number' }, skills_count: { type: 'number' }, commands_count: { type: 'number' }, has_codex: { type: 'boolean' }, has_rtk: { type: 'boolean' }, recent_sessions: { type: 'number' } } },
})

// ── Phase 2: parallel scanners (only for surfaces that exist) ───────────────
const SCANNERS = []

SCANNERS.push({ key: 'hooks-settings', prompt: `${CTX}
Domain: hooks + settings.json wiring. Parse ${HOME}/settings.json hooks section. For EVERY hook entry:
(a) does the target script exist + is it executable; (b) which event/matcher does it fire on; (c) flag
over-broad matchers (a niche-purpose hook matching bare "Bash"/"Read"/"Edit" or "Bash|WebFetch|Read");
(d) UserPromptSubmit hooks: read each script's source — does it guard against machine-generated content
(<task-notification>, <tool_use_result>)? does it dedup repeat injections? (e) duplicate entries (same
script wired in two events). Also list orphan files in ${HOME}/hooks/ not referenced by settings.json,
and *.bak* / *.disabled litter. Metric: total hooks, dead refs, orphans, every-prompt spawn count.` })

SCANNERS.push({ key: 'state-growth', prompt: `${CTX}
Domain: unbounded state/log growth. Find: find ${HOME} -maxdepth 3 -name "*.jsonl" -size +250k -not -path "*/projects/*" 2>/dev/null
plus ${HOME}/logs/. For each: line count, growth pattern (timestamps in first/last lines), which hook/script
writes it (grep ${HOME}/hooks and ${HOME}/scripts for the filename), and whether anything reads it on a hot
path (a hook reading a multi-MB jsonl on every tool call is HIGH). Propose rotation (keep ~2000 newest lines,
gzip trimmed head, wire to SessionEnd).` })

SCANNERS.push({ key: 'instruction-clutter', prompt: `${CTX}
Domain: instruction surface + top-level clutter. (1) Context budget: wc -c ${HOME}/CLAUDE.md and every file it
@includes (recursively); ÷4 ≈ always-on tokens. >5k tokens → propose router split (needs_user_decision=true).
(2) Clutter: dated _archive*/_backup*/backup-* dirs and *.tar.gz at ${HOME} top level with sizes — propose
consolidation into ${HOME}/backups/archive-consolidated-<date>/. (3) Secrets: grep -lE "(api[_-]?key|token|secret).{0,4}=.{0,4}['\\"][A-Za-z0-9_-]{16,}" in ${HOME}/settings.json ${HOME}/*.json — flag with REDACTED preview, needs_user_decision=true.` })

if (surfaces && surfaces.recent_sessions > 0) SCANNERS.push({ key: 'session-friction', prompt: `${CTX}
Domain: session-history friction (last 14 days). Under ${HOME}/projects/: identify the 3 most active project dirs.
Sample the ~30 newest *.jsonl in each (grep, never read whole files):
(a) '"is_error":true' counts — find repeated identical failing commands;
(b) 'has been denied' extracts — CLASSIFY: safety-working-as-designed (force-push, mass-send, sandbox-escape, delete)
    vs possible-false-positive (benign read-only commands) — only the latter may become fixes, needs_user_decision=true;
(c) '"durationMs":[4-9][0-9]{3}' on PreToolUse events — hooks hitting timeouts;
(d) recovery rituals in ${HOME}/history.jsonl if present (kill/continue/resume frequency).
Metric: error-loop sessions, denial classes, slow-hook hits.` })

if (surfaces && surfaces.has_rtk) SCANNERS.push({ key: 'rtk', prompt: `${CTX}
Domain: RTK integration. Run: rtk gain 2>&1 | head -20 (capture any hook warning); rtk discover 2>&1 | head -50
(missed rewrite volume, top commands). Check settings.json for the rtk hook entry ("rtk hook claude" native form vs
legacy shell shim). Fix proposals: update via rtk init -g THEN verify the hook entry actually exists afterward
(non-interactive init can remove without re-adding — the verify command must check settings.json).` })

if (surfaces && surfaces.has_codex) SCANNERS.push({ key: 'codex', prompt: `${CTX}
Domain: Codex (~/.codex) drift. Check: (a) stale duplicate instruction surfaces — instructions.md vs AGENTS.md vs
AGENTS.override.md (compare dates + content; override wins when both exist; ancestors with CONTRADICTORY guidance are
HIGH); (b) broken symlinks: find ~/.codex -maxdepth 1 -type l ! -exec test -e {} \\; -print; (c) plaintext secrets in
config.toml (REDACTED previews, needs_user_decision=true); (d) *.bak* litter count+size; (e) large session/archive
dirs (du -sh ~/.codex/* | sort -rh | head -8) — propose compress-to-tarball for cold archives.` })

// Conditional scanners that discovery didn't enable must be visible too — `undefined > 0` /
// a missing has_rtk/has_codex silently skips a domain otherwise (only has_settings is required).
const CONDITIONAL_SCANNERS = ['session-friction', 'rtk', 'codex']
const scannersSkipped = CONDITIONAL_SCANNERS.filter(k => !SCANNERS.some(s => s.key === k))
if (scannersSkipped.length) log(`skipped by discovery (surface absent or unreported): ${scannersSkipped.join(', ')}`)

phase('Scan')
const scanResults = await parallel(SCANNERS.map(s => () =>
  agent(s.prompt, { label: `scan:${s.key}`, phase: 'Scan', schema: FIX_SCHEMA })
))
// A dead scanner must not silently drop a whole domain's fixes from the plan (mirrors the
// verify-phase guard below): log launched-vs-returned and surface the failed keys to the consumer.
const scans = scanResults.filter(Boolean)
const scannersFailed = SCANNERS.filter((_s, i) => !scanResults[i]).map(s => s.key)
log(`scan: ${scans.length}/${SCANNERS.length} scanners returned${scannersFailed.length ? ` (failed: ${scannersFailed.join(', ')})` : ''}`)

// ── Phase 3: adversarial verification of every proposed fix ─────────────────
phase('Verify')
const allFixes = scans.flatMap(s => (s.fixes || []).map(f => ({ ...f, domain: s.domain })))
const ranked = allFixes.sort((a, b) =>
  ['critical', 'high', 'medium', 'low'].indexOf(a.severity) - ['critical', 'high', 'medium', 'low'].indexOf(b.severity)
).slice(0, MAX_VERIFY)
if (allFixes.length > MAX_VERIFY) log(`verifying top ${MAX_VERIFY} of ${allFixes.length} fixes (severity-ranked); rest reported unverified`)

const verified = await parallel(ranked.map(f => () =>
  agent(`Adversarially verify this proposed harness fix by re-reading the LIVE files NOW. Try to REFUTE it:
is the evidence current, is the apply-step correct and mechanical, could it break anything that currently works
(check what else references the same file/hook)? Fix: ${JSON.stringify(f)}
Default to needs-scoping when uncertain; provide corrected_apply when scoping.`, {
    label: `verify:${(f.title || '').slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA,
  }).then(v => ({ ...f, verdict: v ? v.verdict : 'unverified', verdict_reason: v && v.reason, corrected_apply: v && v.corrected_apply }))
))

// A failed verifier must not silently drop a fix: a null parallel slot (agent died) or a null
// StructuredOutput both land in verify_failed so every in-cap fix appears in exactly one bucket.
const verifiedAll = verified.map((v, i) => v || { ...ranked[i], verdict: 'unverified', verdict_reason: 'verifier agent returned no result' })
const confirmed = verifiedAll.filter(f => f.verdict === 'confirmed')
const scoped = verifiedAll.filter(f => f.verdict === 'needs-scoping')
const rejected = verifiedAll.filter(f => f.verdict === 'rejected')
const verifyFailed = verifiedAll.filter(f => f.verdict === 'unverified')
log(`fix-plan: ${confirmed.length} confirmed, ${scoped.length} need scoping, ${rejected.length} rejected, ${verifyFailed.length} verifier-failed, ${allFixes.length - ranked.length} beyond verify cap`)

return {
  out_dir: OUT,
  surfaces,
  scanners_skipped: scannersSkipped,
  scanners_failed: scannersFailed,
  metrics: Object.fromEntries(scans.map(s => [s.domain, s.metrics || {}])),
  fix_plan: {
    confirmed,
    needs_scoping: scoped,
    rejected,
    verify_failed: verifyFailed,
    unverified: allFixes.slice(MAX_VERIFY),
  },
}
