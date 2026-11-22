/* eslint-disable react-refresh/only-export-components -- a test harness */
// CHARTS OUTCOME EVIDENCE — one REAL Agent panel (testing/panelHarness through the capability-regression mountCase:
// AgentPanel + useAgent + registry, policy, runtime, receipts, Undo) over the fixture board, with the REAL capability, the
// canonical writer behind it (the drawings store, the fixture server's real-route semantics, the chart-tab reducers,
// the board writer) and its read-back. Only the MODEL is scripted, and it is scripted to read the REQUEST it was sent:
// a target comes from `body.context` (a position, the `selected` flag, the `recent` mark, a name) exactly as a planner
// has to find it. A request that does not carry what the script needs FAILS the test; it is never answered regardless.
//
// So this proves: what the Agent tells the model is enough to name the target, and what a correct plan does to the
// STATE. It does NOT prove a paid model would pick that plan, nor anything about the real browser (a test here that
// says otherwise is wrong). Assertions read state, never a registry entry, and a receipt only ALONGSIDE state.
import { expect, vi } from 'vitest'
import { cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerCatalog } from '../capabilityRegression/testing/registry'
import { mountCase, BOARDS, receiptsNow, proposalsNow, refusals } from '../capabilityRegression/testing/harness'
import { pinClock } from '../capabilityRegression/testing/clock'
import { bareSettings } from '../../testing/panelHarness'
import { groupOfAction } from '../../routing'
import { _resetAlertCache } from '../../capabilities/alert'
import { _resetDrawingMemory } from '../../capabilities/drawings'
import { _resetLastCreated } from '../../capabilities/watchlist'

export { screen, waitFor, fireEvent, receiptsNow, proposalsNow, refusals }

export async function outcomeSuite() {
  pinClock()
  await registerCatalog()
}
export const afterEachOutcome = () => { vi.restoreAllMocks(); cleanup() }

export const chart = (id, x, y, w, h, extra = {}) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() }, ...extra })
/** Four charts, SPY / QQQ / NVDA / TSLA, top-left to bottom-right. */
export const QUAD = () => [chart('tl', 0, 0, 12, 10), chart('tr', 12, 0, 12, 10), chart('bl', 0, 10, 12, 10), chart('br', 12, 10, 12, 10)]
export const QUAD_SYMS = { 'N:tl': 'SPY', 'N:tr': 'QQQ', 'N:bl': 'NVDA', 'N:br': 'TSLA' }

let boardN = 0
/** Mount one panel on `widgets`. `sel` = the chart the member last clicked (the real host marks it `selected`). */
export function open(widgets, syms, { extra = {}, seed = {}, selected = null } = {}) {
  _resetAlertCache(); _resetDrawingMemory(); _resetLastCreated()
  const name = `__outcome${++boardN}`
  let sel = selected
  const decorate = (s) => (s ? { ...s, label: `Chart (${s.symbol})`, ...(sel != null && s.ref === sel ? { selected: true } : {}) } : s)
  BOARDS[name] = () => [widgets, syms, { decorate, ...extra }]
  const m = mountCase(name, { seed })
  delete BOARDS[name]
  m.p.select(sel)
  m.p.st.scriptErrors = []
  const select = (ref) => { sel = ref; m.p.select(ref) }
  /** The member says `text`; `plan(context, body)` → the ops a correct planner would send from THIS request. */
  const say = async (text, plan = null, { disposition = 'apply' } = {}) => {
    m.p.st.envelopes.length = 0
    if (plan) m.p.st.envelopes.push(scripted(m.p, plan, disposition))
    const out = await m.say(text)
    expect(m.p.st.scriptErrors, `the request for "${text}" carried what the plan needed`).toEqual([])
    return out
  }
  const apply = async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)); await settle(m.p) }
  const dismiss = async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' }).at(-1)); await settle(m.p) }
  return { ...m, say, apply, dismiss, select, lastReceipt, pending: () => proposalsNow().length }
}
const settle = async (p) => { await p.idle(); await new Promise(r => setTimeout(r, 0)); await p.idle() }
const lastReceipt = () => receiptsNow().at(-1) || null

function scripted(p, plan, disposition) {
  return (body) => {
    let ops
    try { ops = plan(body.context, body) } catch (e) {
      p.st.scriptErrors.push(String(e?.message || e))
      return p.env('answer', [], '«the request did not carry the target»')
    }
    const have = new Set((body.capabilities || []).map(c => c.name))
    const missing = ops.map(o => o.action).filter(a => !have.has(a))
    if (!missing.length) return p.env(disposition, ops, '')
    if (!body.reroute && body.routing) {
      p.st.envelopes.unshift(scripted(p, plan, disposition))
      return { ...p.env('answer', [], ''), need_groups: [...new Set(missing.map(groupOfAction).filter(Boolean))] }
    }
    p.st.scriptErrors.push(`the model was not given ${missing.join(', ')}`)
    return p.env('answer', [], '«not given»')
  }
}

/** Throws (failing the request's check) when the context does not hold the thing. */
export const must = (v, what) => { if (v == null || v === false) throw new Error(`the context has no ${what}`); return v }
export const chartAt = (ctx, position) => must((ctx.charts || []).find(c => c.position === position), `chart at ${position}`)
export const selectedChart = (ctx) => must((ctx.charts || []).find(c => c.selected), 'selected chart')
export const drawingsOf = (ctx, symbol) => must((ctx.drawings || []).find(e => e.symbol === symbol), `drawings entry for ${symbol}`)
export const boardRef = (ctx) => must(ctx.board?.[0]?.ref, 'board entry')
/** A chart entry (charts[]: the model's ref) → its widget id on the board entry (board[0].widgets), joined by position, the
 *  only thing the two lists share: a planner has to make this same join to close or tab a chart. */
export const widgetOf = (ctx, c) => must((ctx.board?.[0]?.widgets || []).find(w => w.type === 'chart' && w.position === c.position), `board widget at ${c.position}`).id
export const widgetAt = (ctx, position) => widgetOf(ctx, chartAt(ctx, position))
export const subjectChart = (ctx) => must((ctx.charts || []).find(c => c.ref === ctx.conversation_memory?.subject_chart), 'subject_chart')
