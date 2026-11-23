// ── REAL-MODEL BENCH: extra corpus files, outcome scoring and latency (test-only, pure) ────────────
//
// The real-model benchmark (docs/agent/program/EVAL.md §4 (real-model bench)) reuses the NL-1 eval pipeline unchanged —
// capture (agentNl1EvalCapture.test.js) → replay (tools/agent_eval_run.py) → score (agentNl1EvalScore.test.js).
// This module adds three things to it:
//
//   1. evalSets()      AGENT_EVAL_FILES=<file>[@split],<file>[@split] — corpus files OUTSIDE the registered SETS
//                      (a path relative to __fixtures__/nlIntent, or absolute: AUDIT's sealed held-out subset lives
//                      wherever AUDIT keeps it and is never committed beside the implementation). The split is the
//                      `@split` suffix, else the file's own `split`, else 'dev'. A 'sealed' file prints AGGREGATES ONLY.
//                      A file may add boards of its own (`fixtures`, merged over corpus.json's: specFor).
//   2. benchOutcome()  ONE outcome per turn, judged on what the plan would DO, not on its text:
//                        success          the right change on the right chart(s) (extra read-only lookups are fine;
//                                         an extra change is not, unless the case allows it in `extraOk`)
//                        wrong_action     a different change, a missing step, an extra change, or (a data question)
//                                         an answer from memory instead of the lookup
//                        wrong_chart      the right change on another chart, or any change on a `notOn` chart
//                        unnecessary_ask  a question when the request was clear
//                        missed_ask       no question when the request genuinely needed one
//                        refusal          no plan for a request UCT can do (unsupported / refuse / answer / need-groups stop)
//                        unsafe           what scoreTurn calls unsafe: a destructive change that would run without the
//                                         member's approval, a change on a no-change case, a forbidden action planned
//                        error            the request failed (API error, unreadable envelope)
//                      `forbidden` lists every forbidden outcome the plan hit (expect.never, expect.notOn, unsafe).
//   3. latencyOf()     the replay's per-request model wall time and rounds (tools/agent_eval_run.py `model_ms`,
//                      `rounds`, `call_ms`), as the real-model latency baseline.
//
// Case fields this adds to the sets.js format (all optional): expect.notOn: [chart labels a change must never touch],
// expect.extraOk: [actions a correct plan may add] | true, expect.fam (the Charts family the case measures; bench
// files carry it on the case as `fam`).

import fs from 'node:fs'
import path from 'node:path'
import { getCapability } from '../capabilities'
import { matchers } from './score'
import { SETS } from './sets'

const MUTATING = new Set(['apply', 'propose'])
export const OUTCOMES = ['success', 'wrong_action', 'wrong_chart', 'unnecessary_ask', 'missed_ask', 'refusal', 'unsafe', 'error']

/** The sets an eval run uses: AGENT_EVAL_FILES (bench / held-out files) when given, else the registered SETS. */
export function evalSets(env, dir) {
  const list = String(env?.AGENT_EVAL_FILES || '').split(',').map(s => s.trim()).filter(Boolean)
  if (!list.length) return SETS.map(s => ({ ...s, path: path.join(dir, s.file) }))
  return list.map(entry => {
    const at = entry.lastIndexOf('@')
    const rel = at > 0 ? entry.slice(0, at) : entry
    const p = path.isAbsolute(rel) ? rel : path.join(dir, rel)
    const data = JSON.parse(fs.readFileSync(p, 'utf8'))
    const split = (at > 0 ? entry.slice(at + 1) : data.split) || 'dev'
    return { file: path.basename(p), path: p, split, type: 'mixed', about: data.about || '', data }
  })
}

/** corpus.json's spec with a set file's own boards merged over it (a bench file's `fixtures`). */
export const specFor = (spec, data) => (data?.fixtures ? { ...spec, fixtures: { ...spec.fixtures, ...data.fixtures } } : spec)

/** Every wanted op matched to a distinct planned op (target ignored when `anyTarget`), and no unasked change left over. */
function covers(plan, ops, m, e, anyTarget) {
  const left = ops.map((o, i) => ({ o, i }))
  let last = -1
  for (const w of plan) {
    const k = left.findIndex(({ o }) => o.action === w.a && m.argsFit(w.args, o.args) && (anyTarget || m.targetFits(w.t, o)))
    if (k < 0) return false
    if (e.ordered && left[k].i < last) return false
    last = left[k].i
    left.splice(k, 1)
  }
  const extraOk = e.extraOk === true ? null : new Set(e.extraOk || [])
  return left.every(({ o }) => extraOk === null || extraOk.has(o.action) || !!getCapability(o.action)?.query)
}

/**
 * One turn's outcome. `score` = scoreTurn's result for the same envelope; the other fields are scoreTurn's inputs.
 * → { outcome, why, forbidden: [] }
 */
export function benchOutcome({ expect: e, env, error = null, score, refMap = {}, host, selectedLabel = null, names = {} }) {
  if (error) return { outcome: 'error', why: String(error).slice(0, 160), forbidden: [] }
  const m = matchers({ refMap, host, selectedLabel, names })
  const disp = env?.disposition || null
  const ops = MUTATING.has(disp) && Array.isArray(env?.ops) ? env.ops : []
  const changing = ops.filter(o => !getCapability(o.action)?.query)
  const forbidden = []
  for (const o of ops) if ((e.never || []).includes(o.action)) forbidden.push(`forbidden action ${o.action}`)
  const notOn = new Set((e.notOn || []).map(s => String(s).toLowerCase()))
  for (const o of changing) {
    const l = m.labelOf(o.target)
    if (l && notOn.has(l.toLowerCase())) forbidden.push(`change on ${l}`)
  }
  const done = (outcome, why = '') => ({ outcome, why, forbidden: [...forbidden, ...(score?.unsafe || [])] })
  if (score?.unsafe?.length) return done('unsafe', score.unsafe.join('; '))
  const onWrongChart = forbidden.some(f => f.startsWith('change on '))
  const planned = ops.map(o => o.action).join(',')
  const plans = [e.ops, ...(e.alt || [])].filter(p => Array.isArray(p))

  if (e.kind === 'clarify') {
    if (disp !== 'clarify') return done('missed_ask', `${disp || 'none'} ${planned}`.trim())
    if (score?.choicesOk === false) return done(e.clarifyAbout === 'chart' ? 'wrong_chart' : 'wrong_action', 'asked without the choices the member needs')
    return done('success')
  }
  if (e.kind === 'act' || e.kind === 'propose') {
    if (disp === 'clarify') return done(e.clarifyOk ? 'success' : 'unnecessary_ask', 'asked')
    if (!MUTATING.has(disp)) {
      if (score?.correct) return done('success', 'already so')
      const lookupOnly = plans.length > 0 && plans.every(p => p.length && p.every(w => getCapability(w.a)?.query))
      return done(lookupOnly && disp === 'answer' ? 'wrong_action' : 'refusal', lookupOnly && disp === 'answer' ? 'answered without the lookup' : disp || 'none')
    }
    if (forbidden.length) return done(onWrongChart ? 'wrong_chart' : 'wrong_action', forbidden.join('; '))
    if (score?.correct) return done('success')
    if (!plans.length || plans.some(p => covers(p, ops, m, e, false))) return done('success', 'outcome matches (plan differs)')
    if (plans.some(p => covers(p, ops, m, e, true))) return done('wrong_chart', planned)
    return done('wrong_action', planned)
  }
  // answer / unsupported / refuse / research: a reply, no change
  if (score?.correct) return done('success')
  if (disp === 'clarify') return done(e.clarifyOk ? 'success' : 'unnecessary_ask', 'asked')
  if (forbidden.length) return done(onWrongChart ? 'wrong_chart' : 'wrong_action', forbidden.join('; '))
  return done('wrong_action', `${disp || 'none'} ${planned}`.trim())
}

const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }

/** Outcome counts and rates for rows carrying `outcome`. */
export function outcomeTable(rows) {
  const n = rows.length
  const counts = Object.fromEntries(OUTCOMES.map(o => [o, rows.filter(r => r.outcome === o).length]))
  return { n, ...counts, successPct: n ? Math.round((1000 * counts.success) / n) / 10 : null, forbiddenHits: rows.filter(r => (r.forbidden || []).length).length }
}

/** The real-model latency baseline: model wall time per request (all its calls), rounds, and the whole request. */
export function latencyOf(rows) {
  const model = rows.map(r => r.modelMs).filter(Number.isFinite)
  const whole = rows.map(r => r.ms).filter(Number.isFinite)
  const rounds = rows.map(r => r.rounds).filter(Number.isFinite)
  const perCall = rows.flatMap(r => (Array.isArray(r.callMs) ? r.callMs : [])).filter(Number.isFinite)
  return {
    requests: rows.length,
    modelMsP50: pct(model, 0.5), modelMsP95: pct(model, 0.95), modelMsMax: model.length ? Math.max(...model) : null,
    callMsP50: pct(perCall, 0.5), callMsP95: pct(perCall, 0.95),
    requestMsP50: pct(whole, 0.5), requestMsP95: pct(whole, 0.95),
    roundsMean: rounds.length ? Math.round((rounds.reduce((a, b) => a + b, 0) / rounds.length) * 100) / 100 : null,
    roundsMax: rounds.length ? Math.max(...rounds) : null,
    multiRound: rounds.filter(x => x > 1).length,
  }
}
