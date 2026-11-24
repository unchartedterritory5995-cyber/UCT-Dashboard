// ── E2E EVAL: score a case's dialogue end to end (test-only) ───────────────────────────────────────────────
//
// evaluateCase(): turn by turn, on FRESH mounts (each replays the dialogue's actual earlier turns, so the board, chat
// and memory are what the member would have):
//   1. the turn as the arm ran it (bank responder: recorded paid answers; a miss stops the dialogue as `pending`)
//   2. its oracle board(s): the same earlier turns, then the EXPECTED plan as the model's envelope on the NL-1 path
//      (every `alt` plan and every `$in` reading is one oracle); `from: 'start'` = from the dialogue's first board
//   3. the score (testing/e2eScore.js), which also picks the next step of a branching dialogue
// expectedResponder(): the expected envelopes for EVERY turn (the oracle self-check: each case's own expectation must
// score success end to end).
import { getCapability } from '../capabilities'
import { ARMS, bankResponder, oracleResponder, replay, stepsOf, branchStep, inChoices, targetOf, concreteArgs, offered } from './e2eRun'
import { scoreTurn, usdOf } from './e2eScore'
import { entities } from './e2eHost'

/** The model's final plan in a turn: the LAST answered request's ops (a repair replaces the plan; a reroute is one runner item). */
const finalPlan = (t) => { const answered = t.requests.filter(q => q.envelope); return (answered[answered.length - 1]?.envelope?.ops || []).map(o => o.action) }
const plansOf = (e) => [e.ops, ...(e.alt || [])].filter(p => Array.isArray(p))
const unblocked = (plan, e) => plan.filter(o => !(e.blocked || []).includes(o.a))

/** Every turn answered with ITS expected envelope (the oracle self-check). `mutate(turn, envelope)` makes a known-wrong one. */
// `repairable`: answer as a first call the server did not repair (usage.repaired null), so the panel may send its ONE client repair
export function expectedResponder({ mutate = null, repairable = false } = {}) {
  return (req) => {
    const e = req.step?.expect || { kind: 'answer' }
    let r
    if (e.kind === 'clarify') {
      const refs = offered(req.body.context)
      const choices = (e.choicesInclude || []).map(label => ({ label, ref: (refs.get(String(label).toLowerCase()) || [])[0]?.ref || null }))
      r = { key: 'expected', envelope: { disposition: 'clarify', reply: '', ops: [], unsupported_category: null, correction: null,
        question: { text: e.question || `Which one do you mean${choices.length ? `: ${choices.map(c => c.label).join(' or ')}` : ''}?`, choices } },
        usage: { model_calls: 1, repaired: false, citations: [] } }
    } else if (e.kind === 'act' || e.kind === 'propose' || (e.ops || []).length) {
      // the model's right answer is the WHOLE plan (a save conflict is the product's to handle, not the model's), and a
      // turn judged from the dialogue's first board corrects the last change (NL-1 `correction`: Undo, then the new plan)
      r = oracleResponder({ host: req.host, plan: plansOf(e)[0] || [], kind: e.kind })(req)
      if (e.from === 'start' && req.turn > 0) r = { ...r, envelope: { ...r.envelope, correction: { replaces: 'last_change' } } }
    } else {
      r = { key: 'expected', envelope: { disposition: e.kind === 'unsupported' ? 'unsupported' : 'answer', reply: 'I can’t do that here.', question: null, ops: [], unsupported_category: e.kind === 'unsupported' ? 'other' : null, correction: null }, usage: { model_calls: 1, repaired: false, citations: [] } }
    }
    if (mutate) r = { ...r, envelope: mutate(req.turn, r.envelope, req) || r.envelope }
    if (repairable && !req.body.repair) r = { ...r, usage: { ...r.usage, repaired: null } }
    return r
  }
}

/** The chart ids a case's `notOn` labels name, on the board before the turn. */
function notOnIds(host, labels) {
  const out = []
  for (const l of labels || []) {
    const t = targetOf(host, 'chart.setTimeframe', l)
    if (t) out.push(String(t.ref).split('~')[0])
  }
  return out
}

/** The oracle boards of turn `i`: one per expected plan / `$in` reading. */
async function oracleBoards({ spec, c, arm, conflict, steps, i, decided, step, replayResponder }) {
  const e = step.expect
  if (!['act', 'propose'].includes(e.kind) && !(e.ops || []).length) return { boards: [], data: [] }
  const out = [], data = []
  for (const plan0 of plansOf(e)) {
    const plan = unblocked(plan0, e)
    for (let pick = 0; pick < inChoices(plan); pick++) {
      // the oracle's WORDS do not matter, only the board its plan leaves: the turn's own words first; if a rail turns the
      // plan into a question it cannot settle, again with words that name the expected targets
      let board = null, reads = []
      for (const words of ['own', 'named']) {
        const fromStart = e.from === 'start'
        const r = await replay({ spec, c, arm, responder: replayResponder(), conflict, steps, upTo: fromStart ? 0 : i, decided })
        if (r.missAt != null) return { boards: [], data: [], pending: true }
        const m = r.m
        const before = JSON.stringify(entities(m.snap()))
        m.built.setConflict(null)
        m.setNl1(true)
        m.server.responder = oracleResponder({ host: m.built.host, plan, kind: e.kind, pick })
        m.server.turn = i; m.server.step = step
        const want = [...new Set(plan.map(o => targetOf(m.built.host, o.a, o.t)?.label).filter(Boolean))]
        const text = words === 'own' ? (e.oracleSay || step.say) : `do it on ${want.join(' and ')}`
        const said = await m.say(text)
        // a rail asked which target: the oracle answers with the expected one
        const pickLabel = said.newChoices.find(ch => want.includes(ch))
        if (pickLabel) { const again = await m.choose(pickLabel); if (again.card) await m.approve() }
        if (said.card) await m.approve()
        board = m.snap()
        reads = said.data
        if (!plan.length || JSON.stringify(entities(board)) !== before || words === 'named' || !want.length) break
      }
      out.push(board)
      data.push(reads)
      if (!plan.length) break
    }
  }
  return { boards: out, data }
}

/**
 * One case for one arm. `responderFor(meta)` (default: the bank) answers the turns. → { rows: [turn rows], missed }
 * A row: { key, dialogue, caseId, turn, say (dev only), outcome, why, flags, lane, requests, modelMs, rounds, usd, expectKind }
 */
export async function evaluateCase({ spec, c, arm, bank = new Map(), collect = null, catalogs = null, set = 'e2e', split = 'dev', prices = null, responderFor = null, skipOracle = false }) {
  const steps = stepsOf(c)
  const conflict = c.host?.conflict || null
  const meta = { caseId: c.id, turn: 0 }
  const responder = responderFor ? responderFor(meta) : bankResponder({ arm, bank, collect, catalogs, set, split, meta })
  const decided = []
  const rows = []
  const price = prices?.models?.[ARMS[arm].model] || null
  for (let i = 0; i < steps.length; i++) {
    meta.turn = i
    const step = branchStep(steps[i], decided[i - 1])
    const base = { key: `${c.id}#${i}`, dialogue: c.id, caseId: c.id, turn: i, mix: c.mix || c.cat || null, fam: c.fam || null, cls: c.cls || null, expectKind: step.expect?.kind }
    let run
    try {
      run = await replay({ spec, c, arm, responder, conflict, steps, upTo: i + 1, decided })
    } catch (err) {
      rows.push({ ...base, outcome: 'error', why: String(err?.message || err).slice(0, 160), flags: [] })
      break
    }
    if (run.missAt != null) {
      rows.push({ ...base, outcome: 'pending', flags: [] })
      for (let k = i + 1; k < steps.length; k++) rows.push({ ...base, key: `${c.id}#${k}`, turn: k, outcome: 'pending', flags: [] })
      break
    }
    const t = run.turns[i]
    const e = step.expect
    const pre = e.from === 'start' ? run.start : t.pre
    let oracle = { boards: [], data: [] }
    if (!skipOracle) oracle = await oracleBoards({ spec, c, arm, conflict, steps, i, decided, step, replayResponder: () => (responderFor ? responderFor({ ...meta }) : bankResponder({ arm, bank })) })
    // a question: UCT offered choices (a local question) or the model's envelope asked
    // (a question with no buttons — "Which charts should it go on?" — counts too, by the panel's own question words)
    const asked = t.newChoices.length > 0 || t.requests.some(q => q.envelope?.disposition === 'clarify')
      || /(?:which|what) (?:chart|charts|one|ones|list|indicator|pane|layout)\b[^?]{0,120}\?|did you mean\b[^?]{0,120}\?/i.test(t.reply)   // no leading \b: the text runs into the timestamp (\"…PMWhich\")
    const lookup = plansOf(e).length > 0 && plansOf(e).every(p => p.length && p.every(o => getCapability(o.a)?.query))
    const moved = (b) => JSON.stringify(entities(b)) !== JSON.stringify(entities(pre))
    const oracleMoved = oracle.boards.some(moved)
    const invalid = ['act', 'propose'].includes(e.kind) && !lookup && !e.blocked?.length && !oracleMoved
    // an expected plan that changed nothing here could not be executed on this board: only the plans that ran are oracles
    if (['act', 'propose'].includes(e.kind) && !lookup && !e.blocked?.length && oracleMoved) oracle = { ...oracle, boards: oracle.boards.filter(moved) }
    const sc = invalid ? { outcome: 'oracle_invalid', why: 'the expected plan changes nothing on this board (it cannot be executed here)', flags: [] } : scoreTurn({ e, pre, mid: t.mid, post: t.post, oracles: oracle.boards, asked, choices: t.newChoices, reply: `${t.reply} ${t.approved}`,
      data: t.data, oracleData: oracle.data, notOnIds: notOnIds(run.m.built.host, e.notOn),
      planned: finalPlan(t) })
    decided[i] = { outcome: sc.outcome, asked }
    const reqs = t.requests.filter(q => !q.miss)
    const P = JSON.stringify(entities(pre))
    rows.push({ ...base, outcome: sc.outcome, why: sc.why, flags: sc.flags, asked, reply: `${t.reply} ${t.approved}`.replace(/\s+/g, ' ').trim().slice(0, 400),
      oracleChanged: oracle.boards.some(b => JSON.stringify(entities(b)) !== P), oracleReads: oracle.data.flat().length,
      lookup, blocked: !!e.blocked?.length, planScored: lookup && !oracle.data.flat().length,
      lane: t.requests.length ? 'model' : 'deterministic', requests: reqs.length,
      modelMs: reqs.reduce((a, q) => a + (q.row?.model_ms || 0), 0), rounds: reqs.reduce((a, q) => a + (q.row?.rounds || 0), 0),
      usd: reqs.reduce((a, q) => a + usdOf(q.row?.usage, price), 0),
      // the model's FINAL plan (a client repair replaces the first one: useAgent uses r2's envelope), and what ran
      planned: finalPlan(t), executed: t.executed, failedCommits: t.failedCommits,
      forbiddenPlanned: finalPlan(t).filter(a => (e.never || []).includes(a)) })
  }
  return { rows }
}

/** Expected-plan sanity: every action a case names exists, and args that matchers make concrete stay args. */
export function expectProblems(c) {
  const p = []
  for (const s of stepsOf(c)) {
    const steps = s.branch ? Object.values(s.branch) : [s]
    for (const t of steps) for (const plan of plansOf(t.expect || {})) for (const o of plan) {
      if (!getCapability(o.a)) p.push(`${c.id}: unknown action ${o.a}`)
      void concreteArgs(o.args || {})
    }
  }
  return p
}
