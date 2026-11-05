// UCT Agent AUTOTEST: outputs. Every line and every file carries the MODE, so a scripted pass is never read as a model pass.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { classify, dedupe } from './classify.mjs'
import { redact } from './heldout.mjs'

export const MODES = {
  SIMULATED: 'SIMULATED (scripted plan, real panel in jsdom, fixture board). Proves a plan runs. Proves nothing about a browser or a model.',
  'BROWSER-MOCK-MODEL': 'BROWSER-MOCK-MODEL (real UI in headless Chrome, SCRIPTED model). Proves the plan executes on real components. Proves nothing about whether a model picks that plan.',
  'REAL-MODEL': 'REAL-MODEL (real UI, real model, ledger-metered).',
}
export const say = (mode, line) => console.log(`[${mode}] ${line}`)

/** One finished request → the row for results.json (redacted when held out), plus its failure record. */
export function rowOf(req, evidence, result, { mode, known }) {
  const turns = evidence.turns || []
  const modelCalls = turns.reduce((n, t) => n + (t.modelCalls || 0), 0) + (evidence.undo?.turn?.modelCalls || 0)
  const failed = result.checks.filter(c => c.pass === false)
  const row = { id: req.id, set: req.set, family: req.family, kind: req.kind, board: req.board, inventory: req.inventory, pass: result.pass, graded: result.graded, na: result.na, modelCalls, usd: evidence.usd ?? null, ms: turns.reduce((n, t) => n + (t.ms || 0), 0), path: modelCalls ? 'model' : 'local' }
  if (result.pass) return row
  const c = classify(req, evidence, result, { known, mode })
  return { ...row, layer: c.layer, why: c.why, firstCheck: failed[0]?.name, failed: failed.map(x => ({ name: x.name, detail: x.detail, tag: x.tag })), expectedActions: (req.turns || []).flatMap(t => (t.plan?.ops || []).map(o => o.action)), say: req.turns.map(t => t.say) }
}

/** The failure folder a fix worker opens: request, plan, state before and after, screenshot (saved beside it by the runner). */
export function writeFailure(dir, req, evidence, row, mode) {
  if (req.set === 'heldout') return null
  const d = join(dir, 'failures', req.id)
  mkdirSync(d, { recursive: true })
  const strip = (s) => (s ? { ...s, faces: undefined } : s)
  writeFileSync(join(d, 'failure.json'), JSON.stringify({ MODE: mode, request: req, row, turns: evidence.turns, undo: evidence.undo?.turn, guide: evidence.guide, crash: evidence.crash, before: strip(evidence.before), after: strip(evidence.after), undoAfter: strip(evidence.undo?.after) }, null, 1))
  return d
}

export function finish(dir, mode, rows, meta = {}) {
  const pub = rows.filter(r => r.set !== 'heldout')
  const held = rows.filter(r => r.set === 'heldout')
  const fails = rows.filter(r => r.pass === false)
  const notRun = rows.filter(r => r.pass === null)
  const families = dedupe(pub.filter(r => r.pass === false))
  const byLayer = {}
  for (const f of fails) byLayer[f.layer] = (byLayer[f.layer] || 0) + 1
  const out = {
    MODE: mode, statement: MODES[mode], meta,
    totals: { requests: rows.length, passed: rows.filter(r => r.pass === true).length, failed: fails.length, notRunInThisMode: notRun.length, publicRequests: pub.length, heldoutRequests: held.length, heldoutPassed: held.filter(r => r.pass === true).length, modelCalls: rows.reduce((n, r) => n + (r.modelCalls || 0), 0), localOnly: rows.filter(r => r.modelCalls === 0).length, checksGraded: rows.reduce((n, r) => n + (r.graded || 0), 0), checksNotReadable: rows.reduce((n, r) => n + (r.na || 0), 0), byLayer },
    failureFamilies: families,
    heldoutFailuresByFamilyAndLayer: held.filter(r => r.pass === false).reduce((m, r) => { const k = `${r.family} / ${r.layer}`; m[k] = (m[k] || 0) + 1; return m }, {}),
    rows: [...pub, ...held.map(redact)],
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `results.${mode}.json`), JSON.stringify(out, null, 1))
  say(mode, `${out.totals.passed}/${out.totals.requests - notRun.length} passed${notRun.length ? `, ${notRun.length} not run in this mode` : ''}; ${out.totals.modelCalls} model calls; ${families.length} failure families`)
  return out
}
