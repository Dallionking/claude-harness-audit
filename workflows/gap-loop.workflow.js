export const meta = {
  name: 'gap-loop',
  description: 'Bounded gap-analysis loop with a 2-clean-round latch. Runs rounds of adversarial gap analysis (zero new findings AND score>=threshold = a clean round), auto-fixes between rounds, and stops after N consecutive clean rounds or a soft escalation cap. Replaces the hand-driven .sprint-state.json steps[4].rounds[] ritual with a deterministic, schema-driven loop. Pass the target via args.',
  phases: [{ title: 'GapLoop', detail: 'analyze -> (auto-fix) -> re-analyze until 2 consecutive clean rounds' }],
}

// ── args (all optional except target) ────────────────────────────────────────
// args = { target, repo?, threshold?=8, cleanRounds?=2, maxRounds?=8, autoFix?=true, criteria? }
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = {} } }
if (!A || typeof A !== 'object') A = {}
const TARGET = A.target || A.t || 'the most recent uncommitted change set in this repo'
const REPO = A.repo || '.'
const THRESHOLD = Number(A.threshold ?? 8)
const NEED_CLEAN = Number(A.cleanRounds ?? 2)
const MAX_ROUNDS = Number(A.maxRounds ?? 8)
const AUTO_FIX = A.autoFix !== false
const CRITERIA = A.criteria || 'correctness, completeness vs stated requirements, missing edge cases, security, untested paths, and mirror/drift between spec and implementation'

const GAP_SCHEMA = {
  type: 'object',
  required: ['score', 'findings'],
  additionalProperties: true,
  properties: {
    score: { type: 'number' },           // 0-10, single canonical scale
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'description'],
        additionalProperties: true,
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'string' },
          description: { type: 'string' },
          fix_hint: { type: 'string' },
        },
      },
    },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['applied'],
  additionalProperties: true,
  properties: {
    applied: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

function gapPrompt(round, prevFindings) {
  return `You are an ADVERSARIAL gap analyst. Perform ONE round of gap analysis on:
TARGET: ${TARGET}
REPO: ${REPO}
Acceptance criteria / lens: ${CRITERIA}

Round ${round}. ${prevFindings && prevFindings.length ? `Previously reported findings that should now be fixed:\n${prevFindings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file || ''}:${f.line || ''} ${f.description}`).join('\n')}\nVerify each is actually resolved on disk; if still present, report it again.` : 'This is the first round.'}

Read the relevant files yourself (Read/Grep/GitNexus). Be skeptical — surface only REAL gaps you can cite, not style nits. Use ONE numeric scale: score 0-10 where 10 = ship-ready, no gaps. A round is CLEAN only when findings == [] AND score >= ${THRESHOLD}.

HARD REQUIREMENT: your only output is a single StructuredOutput call matching the schema (score + findings[]). No prose report.`
}

function fixPrompt(findings) {
  return `You are a focused fix agent. Resolve these gap-analysis findings in ${REPO}. Make the minimal correct edit per finding; do not refactor adjacent code or expand scope. Run any obvious local check after editing.
FINDINGS:
${findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file || ''}:${f.line || ''} — ${f.description}${f.fix_hint ? ` (hint: ${f.fix_hint})` : ''}`).join('\n')}

HARD REQUIREMENT: your only output is a single StructuredOutput call (applied[], skipped[], notes). No prose report.`
}

phase('GapLoop')

const rounds = []
let clean = 0
let round = 0
let prevFindings = []

while (clean < NEED_CLEAN && round < MAX_ROUNDS) {
  round++
  const gap = await agent(gapPrompt(round, prevFindings), { label: `gap:round${round}`, phase: 'GapLoop', schema: GAP_SCHEMA })
  const findings = gap.findings || []
  const isClean = findings.length === 0 && Number(gap.score) >= THRESHOLD
  let fix = null
  if (isClean) {
    clean++
    log(`Round ${round}: CLEAN (score ${gap.score}, 0 findings) — ${clean}/${NEED_CLEAN} consecutive clean`)
  } else {
    clean = 0
    log(`Round ${round}: ${findings.length} findings, score ${gap.score} — clean counter reset`)
    if (AUTO_FIX && findings.length) {
      fix = await agent(fixPrompt(findings), { label: `fix:round${round}`, phase: 'GapLoop', schema: FIX_SCHEMA })
      log(`Round ${round}: auto-fix applied ${fix.applied?.length || 0}, skipped ${fix.skipped?.length || 0}`)
    }
  }
  rounds.push({ round, score: gap.score, findings_count: findings.length, clean: isClean, findings, fix })
  prevFindings = findings
}

const passed = clean >= NEED_CLEAN
const escalated = !passed && round >= MAX_ROUNDS
if (escalated) log(`SOFT ESCALATION: hit max ${MAX_ROUNDS} rounds without ${NEED_CLEAN} consecutive clean rounds — surface to human.`)

return {
  passed,
  escalated,
  rounds_run: round,
  consecutive_clean: clean,
  threshold: THRESHOLD,
  final_score: rounds.length ? rounds[rounds.length - 1].score : null,
  open_findings: passed ? [] : (rounds.length ? rounds[rounds.length - 1].findings : []),
  target: TARGET,
  repo: REPO,
  rounds: rounds.map((r) => ({ round: r.round, score: r.score, findings_count: r.findings_count, clean: r.clean })),
}
