export const meta = {
  name: 'gap-loop',
  description: 'Bounded gap-analysis loop with a 2-clean-round latch. Runs rounds of adversarial gap analysis (zero new findings AND score>=threshold = a clean round), auto-fixes between rounds, and stops after N consecutive clean rounds or a soft escalation cap. Replaces the hand-driven .sprint-state.json steps[4].rounds[] ritual with a deterministic, schema-driven loop. Pass the target via args.',
  phases: [{ title: 'GapLoop', detail: 'analyze -> (auto-fix) -> re-analyze until 2 consecutive clean rounds' }],
}

// ── P0 guards (2026-06-23) ────────────────────────────────────────────────────
// Three inlined guard helpers — extracted as pure functions so gap-loop-guards.cjs
// can test them without the WDK sandbox.  Logic is identical to that module.

// (a) per-tool-call cap: prevents verifier-stall (the 17-round incident 2026-06-09).
// Default cap: 5 calls to the same tool per round. Override: GAPLOOP_TOOL_CAP env.
const TOOL_CAP = Number(process.env.GAPLOOP_TOOL_CAP || 5)

function _makeRoundState() {
  return { toolCounts: {}, seenTriples: new Set() }
}

function _checkToolCap(state, toolName) {
  const c = state.toolCounts
  c[toolName] = (c[toolName] || 0) + 1
  if (c[toolName] > TOOL_CAP) {
    return { abort: true, reason: `tool-cap: '${toolName}' called ${c[toolName]} times, cap ${TOOL_CAP} — aborting round` }
  }
  return { abort: false, reason: '' }
}

// (b) no-progress detection: hash (intent, tool, args); repeat with no state
// change → abort that round.
function _tripleKey(intent, tool, argsObj) {
  const sorted = JSON.stringify(argsObj, argsObj ? Object.keys(argsObj).sort() : undefined)
  return `${intent}\x00${tool}\x00${sorted}`
}

function _checkNoProgress(state, intent, tool, argsObj) {
  const key = _tripleKey(intent, tool, argsObj)
  if (state.seenTriples.has(key)) {
    return { abort: true, reason: `no-progress: (intent="${intent}", tool="${tool}") repeated with no state change — aborting round` }
  }
  state.seenTriples.add(key)
  return { abort: false, reason: '' }
}

function _markStateChange(state) { state.seenTriples.clear() }

// (c) fail-closed gate: only boolean true passes; undefined/null/any other
// value → FAIL. Prevents an unreadable/missing gate from silently passing.
function _checkGateResult(result) {
  if (result === true) return { pass: true, reason: '' }
  const repr = result === undefined ? 'undefined'
             : result === null      ? 'null'
             : typeof result === 'object' ? `object(${JSON.stringify(result)})`
             : String(result)
  return { pass: false, reason: `fail-closed: gate returned ${repr} — treating as FAIL` }
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

// Cost ceiling (W2-6, 2026-06-12): MAX_ROUNDS already bounds rounds, but a
// budget directive ("+Nk") should also stop the loop before it overruns the
// target. No-op when no budget target is set (budget.total === null).
const ROUND_BUDGET_FLOOR = Number(process.env.GAPLOOP_ROUND_BUDGET_FLOOR || 60_000)
while (clean < NEED_CLEAN && round < MAX_ROUNDS) {
  if (budget.total && budget.remaining() < ROUND_BUDGET_FLOOR) {
    log(`gap-loop: stopping at round ${round} — budget floor (${Math.round(budget.remaining()/1000)}k < ${ROUND_BUDGET_FLOOR/1000}k)`)
    break
  }
  round++

  // Fresh per-round guard state (guards a + b reset each round).
  const roundState = _makeRoundState()

  // Guard (b): check for no-progress before dispatching the gap agent.
  const npGap = _checkNoProgress(roundState, 'gap-analysis', 'agent', { round, prevCount: prevFindings.length })
  if (npGap.abort) {
    log(`Round ${round}: ABORT — ${npGap.reason}`)
    break
  }

  // Guard (a): count the gap agent call against the tool cap.
  const tcGap = _checkToolCap(roundState, 'gap-agent')
  if (tcGap.abort) {
    log(`Round ${round}: ABORT — ${tcGap.reason}`)
    break
  }

  const gapRaw = await agent(gapPrompt(round, prevFindings), { label: `gap:round${round}`, phase: 'GapLoop', schema: GAP_SCHEMA })

  // Guard (c): fail-closed — treat any non-boolean-true gate signal as FAIL.
  // The gap agent result is structural (findings array + score), not a raw
  // boolean gate, so we derive a gate boolean and validate that.
  const derivedGate = (gapRaw && typeof gapRaw === 'object') ? true : gapRaw
  const gateCheck = _checkGateResult(derivedGate)
  if (!gateCheck.pass) {
    log(`Round ${round}: gate FAIL — ${gateCheck.reason} — escalating`)
    rounds.push({ round, score: null, findings_count: -1, clean: false, findings: [], fix: null, abortReason: gateCheck.reason })
    break
  }

  const gap = gapRaw
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
      // Guard (b): mark that a real fix is about to land so the next iteration
      // is allowed to re-run the same tool+args if needed.
      _markStateChange(roundState)

      // Guard (a): count the fix agent call.
      const tcFix = _checkToolCap(roundState, 'fix-agent')
      if (tcFix.abort) {
        log(`Round ${round}: fix ABORT — ${tcFix.reason}`)
      } else {
        fix = await agent(fixPrompt(findings), { label: `fix:round${round}`, phase: 'GapLoop', schema: FIX_SCHEMA })
        log(`Round ${round}: auto-fix applied ${fix.applied?.length || 0}, skipped ${fix.skipped?.length || 0}`)
      }
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
