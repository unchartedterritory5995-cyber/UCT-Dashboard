/* global process */
// UCT Agent AUTOTEST, mode SIMULATED: every request, scripted plan, the REAL panel in jsdom over the fixture board.
// Skipped unless AGENT_AUTOTEST=1: it is a report, not a CI gate (a failure here is data, it never fails this file).
//   AGENT_AUTOTEST=1 AT_OUT=<dir> npx vitest run src/testing/agent/autotest/simulated.test.jsx
// A request on a board with no jsdom form (real Watchlist widget, scanner, Multi Chart, layout library) is recorded as
// `browser-only`, pass null: it is not a pass. Its plan is lint-checked, not executed, in this mode.
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import { cleanup, screen, fireEvent } from '@testing-library/react'
import { mkdirSync } from 'node:fs'
import { registerCatalog } from '../../../agent/qa/capabilityRegression/testing/registry'
import { mountCase, BOARDS as CASE_BOARDS, receiptsNow, proposalsNow } from '../../../agent/qa/capabilityRegression/testing/harness'
import { pinClock } from '../../../agent/qa/capabilityRegression/testing/clock'
import { groupOfAction } from '../../../agent/routing'
import { endGuide } from '../../../agent/guide/guideStore'
import { GUIDE_FEATURES } from '../../../agent/guide/registry'
import * as drawingsStore from '../../../components/chart/drawingsStore'
import { _resetAlertCache } from '../../../agent/capabilities/alert'
import { _resetDrawingMemory } from '../../../agent/capabilities/drawings'
import { _resetLastCreated } from '../../../agent/capabilities/watchlist'
import { publicRequests, setHash } from './requests.mjs'
import { loadHeldout } from './heldout.mjs'
import { loadManifest } from './lint.mjs'
import { BOARDS } from './boards.mjs'
import { scripted } from './plan.mjs'
import { grade, worldPrint } from './oracle.mjs'
import { rowOf, writeFailure, finish, say as log } from './report.mjs'

const ON = process.env.AGENT_AUTOTEST === '1'
const MODE = 'SIMULATED'
const OUT = process.env.AT_OUT || 'autotest-out'
vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const names = (board, h, p, id) => {
  const c = h.charts.read(id)
  const cs = c?.cs || {}
  const ov = (cs.overlays || []).map((o, i) => ({ o, i })).filter(({ o }) => !o.removed).map(({ o }) => `${String(o.type || 'ema').toUpperCase()} ${o.period}`)
  const inst = p.instancesOn(board, id).map(i => (i.defId === 'movingAverage' ? `${String(i.inputs?.maType || 'sma').toUpperCase()} ${i.inputs?.period}` : String(i.defId).toUpperCase()))
  return [...ov, ...inst]
}
async function snapshot(m, boardName) {
  const { board, h, p } = m
  const charts = {}
  for (const [role, r] of Object.entries(BOARDS[boardName].roles)) {
    const w = board.state.widgets.find(x => x.id === r.id)
    if (!w) { charts[role] = { gone: true }; continue }
    const c = h.charts.read(r.id)
    const cs = c?.cs || {}
    const paneInst = p.instancesOn(board, r.id).filter(i => i.defId !== 'movingAverage').length
    // `pixels`: there are none in jsdom, so here it is the chart's whole stored state plus its view read-out
    charts[role] = { sym: c?.symbol, tf: String(c?.tf ?? 'D'), scale: cs.percentScale ? 'percent' : cs.logScale ? 'log' : 'linear', volume: cs.showVolume !== false && cs.volume?.visible !== false, chips: names(board, h, p, r.id), panes: paneInst, pixels: JSON.stringify([c?.symbol, c?.tf, c?.stored, c?.view, c?.replay]) }
  }
  const syms = [...new Set(Object.values(charts).map(c => c.sym).filter(Boolean))]
  const drawings = Object.fromEntries(syms.map(s => [s, drawingsStore.peekDrawings(s)]).filter(([, d]) => d?.length))
  const alerts = await (await fetch('/api/watchlist-alerts')).json().catch(() => [])
  const ia = await (await fetch('/api/indicator-alerts')).json().catch(() => ({ alerts: [] }))
  const lists = board.state.server?.lists || []
  return {
    charts, widgets: board.state.widgets.map(w => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h })), chartCount: board.state.widgets.filter(w => w.type === 'chart').length, types: board.state.widgets.map(w => w.type),
    wl: Object.fromEntries(lists.map(l => [l.name, (l.items || l.symbols || []).map(i => i.sym || i)])), wlNotes: Object.fromEntries(lists.map(l => [l.name, Object.fromEntries((l.items || []).filter(i => i.notes).map(i => [i.sym, i.notes]))])), drawings, drawingCount: Object.values(drawings).reduce((n, d) => n + d.length, 0), alerts: Array.isArray(alerts) ? alerts : [], ialerts: ia.alerts || [],
    layouts: [], written: {},
    unreadable: ['panePx', 'axis', 'session', 'faces', 'w', 'layoutWrites', 'written'],
  }
}

let seq = 0
function mountBoard(req) {
  const d = BOARDS[req.board]
  _resetAlertCache(); _resetDrawingMemory(); _resetLastCreated()
  const name = `__autotest${++seq}`
  const selId = req.select ? d.roles[req.select].id : null
  const mapped = { ...d.sim.extra, decorate: (s) => (s ? { ...s, label: `Chart (${s.symbol})`, ...(selId && s.ref === selId ? { selected: true } : {}) } : s) }
  CASE_BOARDS[name] = () => [d.sim.widgets(), d.sim.groups, mapped]
  const m = mountCase(name, {})
  delete CASE_BOARDS[name]
  m.p.select(selId)
  return m
}

async function driveTurn(m, req, turn) {
  const rc0 = receiptsNow().length
  const calls0 = m.p.turns()
  const before = worldPrint(await snapshot(m, req.board))
  const env = { value: null }
  const plan = (body) => {
    const s = scripted(turn, body, req.board)
    env.value = s
    const have = new Set((body.capabilities || []).map(c => c.name))
    const missing = s.ops.map(o => o.action).filter(a => !have.has(a))
    if (missing.length && !body.reroute && body.routing) { m.p.st.envelopes.unshift(plan); return { ...m.p.env('answer', [], ''), need_groups: [...new Set(missing.map(groupOfAction).filter(Boolean))] } }
    if (missing.length) return m.p.env('answer', [], `the model was not given: ${missing.join(', ')}`)
    return { ...m.p.env(s.disposition, s.ops, s.reply), question: s.question, unsupported_category: s.unsupported_category }
  }
  m.p.st.envelopes.length = 0
  m.p.st.envelopes.push(plan)
  const last0 = await m.say(turn.say)
  let last = last0
  let card = null, heldUntilApply
  if (proposalsNow().length) {
    card = proposalsNow().at(-1).textContent
    heldUntilApply = worldPrint(await snapshot(m, req.board)) === before
    if (turn.approve !== false) {
      fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1))
      await m.p.idle(); await new Promise(r => setTimeout(r, 0)); await m.p.idle()
      last = m.p.transcript().slice(-500)
    }
  }
  const rows = receiptsNow()
  const newReceipt = rows.length > rc0
  const modelCalls = m.p.turns() - calls0
  m.p.st.envelopes.length = 0
  return { say: turn.say, card, heldUntilApply, newReceipt, receiptText: newReceipt ? rows.at(-1).textContent : null, modelCalls, last: String(last).slice(-500), envelope: env.value }
}

/** A how-to in jsdom: no control exists to ring, so the panel explains in words, and the walkthrough's OWN registered steps are
 *  checked against the oracle. Ring geometry, clicks and the run to the end are the browser's: BROWSER modes grade those. */
const guideEvidence = (spec, req) => {
  const id = req.turns.flatMap(t => t.plan?.ops || []).find(o => o.action === 'guide.show')?.args?.feature
  const f = GUIDE_FEATURES.find(x => x.id === id)
  if (!f) return { started: false, why: `no guide feature ${id}`, steps: [] }
  return { started: true, steps: spec.steps.map((s, i) => ({ index: i, target: s.target, text: f.steps[i]?.text, textOk: f.steps[i]?.target === s.target && new RegExp(s.text, 'i').test(f.steps[i]?.text || '') })) }
}

async function runOne(req) {
  const ev = { turns: [], undo: null, guide: null, errors: [] }
  try {
    const m = mountBoard(req)
    await m.p.idle()
    ev.before = await snapshot(m, req.board)
    for (const t of req.turns) ev.turns.push(await driveTurn(m, req, t))
    if (req.oracle.guide) ev.guide = guideEvidence(req.oracle.guide, req)
    ev.after = await snapshot(m, req.board)
    if (req.oracle.undo && req.oracle.outcome === 'change') {
      const u = await driveTurn(m, req, { say: 'undo' })
      ev.undo = { turn: u, after: await snapshot(m, req.board) }
    }
    endGuide('exit')
  } catch (e) { ev.crash = String(e?.stack || e?.message || e).slice(0, 600) }
  if (ev.crash || !ev.after) return { evidence: ev, result: { pass: false, graded: 0, na: 0, checks: [{ name: 'the run reached the end', pass: false, detail: ev.crash, tag: 'crash' }] } }
  return { evidence: ev, result: grade(req, ev) }
}

const rows = []
const known = new Set(loadManifest().map(c => c.name))
const all = () => { const pub = publicRequests(); let held = []; try { held = loadHeldout() } catch { /* no key: public only */ } return [...pub, ...held] }

describe.skipIf(!ON)('autotest SIMULATED', () => {
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  afterAll(() => {
    if (!ON) return
    mkdirSync(OUT, { recursive: true })
    const pub = publicRequests()
    finish(OUT, MODE, rows, { hash: setHash(pub) })
  })
  const list = ON ? all() : []
  it('sets up', async () => { pinClock(); await registerCatalog(); expect(list.length).toBeGreaterThan(0) })
  for (const req of list) {
    const label = req.set === 'heldout' ? req.id : `${req.id} ${req.turns[0].say}`
    it(label, async () => {
      if (!BOARDS[req.board].sim || req.browserOnly) {
        rows.push({ id: req.id, set: req.set, family: req.family, kind: req.kind, board: req.board, inventory: req.inventory, pass: null, graded: 0, na: 0, modelCalls: null, path: 'browser-only' })
        return
      }
      const { evidence, result } = await runOne(req)
      const row = rowOf(req, evidence, result, { mode: MODE, known })
      rows.push(row)
      if (!row.pass) {
        writeFailure(OUT, req, evidence, row, MODE)
        log(MODE, `FAIL ${req.id}${req.set === 'heldout' ? '' : ` [${row.layer}] ${row.firstCheck}: ${String(row.failed?.[0]?.detail || '').slice(0, 160)}`}`)
      }
    }, 60000)
  }
})
