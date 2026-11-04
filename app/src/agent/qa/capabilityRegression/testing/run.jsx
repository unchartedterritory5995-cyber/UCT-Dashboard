// CAPABILITY REGRESSION (Mission 2) — replay one case (a corpus phrasing at level c, or a golden workflow) through
// the REAL panel and assert its STATE: the board, the charts' indicators, which canonical reads / writes ran, a
// receipt / proposal / refusal by its structure. Never an exact string of prose.
import { expect } from 'vitest'
import { waitFor, fireEvent, screen } from '@testing-library/react'
import { mountCase, faithful, boardState, chartsOf, refusals, receiptsNow, proposalsNow } from './harness'
import { routedNames } from './route'

/** A hex colour's hue family (red / green / blue / yellow / …) — a colour word maps to a palette shade, never one exact hex. */
export function hueFamily(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return null
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max - min < 0.12) return 'grey'
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  h = (h * 60 + 360) % 360
  return h < 20 || h >= 335 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow' : h < 165 ? 'green' : h < 260 ? 'blue' : 'purple'
}
const callLine = (c) => `${c[0]} ${c[1]}${c[2] ? ` ${JSON.stringify(c[2])}` : ''}`
const turnCount = (p) => p.st.calls.filter(c => c[1] === '/api/agent/turn').length

/** Check one step's expectations; throws (vitest expect) with the case label on the first one that does not hold. */
export function checkExpect(ctx, e, label) {
  const { board, h, p, start, before, since } = ctx
  const calls = p.st.calls.slice(since.calls).filter(c => c[1] !== '/api/agent/turn' && c[1] !== '/api/agent/record')
  if (e.modelTurns != null) expect(turnCount(p) - since.turns, `${label}: model turns`).toBeLessThanOrEqual(e.modelTurns)
  if (e.unchanged) expect(boardState(board), `${label}: the board is unchanged`).toBe(before)
  if (e.restored) expect(boardState(board), `${label}: the board is back as it started`).toBe(start)
  if (e.charts) {
    const cs = chartsOf(board)
    if (e.charts.count != null) expect(cs.length, `${label}: chart count`).toBe(e.charts.count)
    const syms = cs.map(w => h.charts.read(w.id)?.symbol)
    if (e.charts.symbols) expect(syms, `${label}: chart symbols (board order)`).toEqual(e.charts.symbols)
    if (e.charts.symbolSet) expect([...syms].sort(), `${label}: chart symbols (any order)`).toEqual([...e.charts.symbolSet].sort())
    if (e.charts.keepsIds) for (const id of e.charts.keepsIds) expect(cs.map(w => w.id), `${label}: chart ${id} reused (kept)`).toContain(id)
    if (e.charts.sameSize) expect(new Set(cs.map(w => `${w.w}x${w.h}`)).size, `${label}: all charts the same size`).toBe(1)
    if (e.charts.tf) expect(cs.map(w => h.charts.read(w.id)?.tf), `${label}: every chart's timeframe`).toEqual(cs.map(() => e.charts.tf))
    if (e.charts.tfs) expect(cs.map(w => h.charts.read(w.id)?.tf), `${label}: the charts' timeframes`).toEqual(e.charts.tfs)
    if (e.charts.types) expect(cs.map(w => h.charts.read(w.id)?.cs?.chartType ?? null), `${label}: chart types`).toEqual(e.charts.types)
  }
  if (e.setting) {
    const id = chartsOf(board)[e.setting.chart || 0]?.id
    expect(h.charts.read(id)?.cs?.[e.setting.key], `${label}: chart setting ${e.setting.key}`).toEqual(e.setting.value)
  }
  if (e.settingSome) {
    const id = chartsOf(board)[e.settingSome.chart || 0]?.id
    const v = h.charts.read(id)?.cs?.[e.settingSome.key] || []
    expect(v.some(x => Object.entries(e.settingSome.match).every(([k, want]) => x?.[k] === want)), `${label}: ${e.settingSome.key} holds ${JSON.stringify(e.settingSome.match)}`).toBe(true)
  }
  if (e.widgetTypes) {
    const types = board.state.widgets.map(w => w.type)
    for (const t of e.widgetTypes.include || []) expect(types, `${label}: a ${t} widget on the board`).toContain(t)
  }
  if (e.instance) {
    // one indicator instance, found by dotted-path fields ({"inputs.period": 9}); `has` = exact fields; `colour` = a hue family
    const id = chartsOf(board)[e.instance.chart || 0]?.id
    const get = (o, k) => k.split('.').reduce((a, x) => a?.[x], o)
    const hit = p.instancesOn(board, id).find(i => Object.entries(e.instance.find).every(([k, v]) => get(i, k) === v))
    expect(hit, `${label}: an indicator matching ${JSON.stringify(e.instance.find)}`).toBeTruthy()
    for (const [k, v] of Object.entries(e.instance.has || {})) expect(get(hit, k), `${label}: ${k}`).toEqual(v)
    if (e.instance.colour) expect(hueFamily(get(hit, e.instance.colour.key)), `${label}: ${e.instance.colour.key} is ${e.instance.colour.family}`).toBe(e.instance.colour.family)
  }
  if (e.layout) {
    const lib = board.state.layouts
    if (e.layout.active) expect(lib?.entries.find(x => x.id === lib.activeId)?.name, `${label}: the open layout`).toBe(e.layout.active)
    for (const n of e.layout.names || []) expect((lib?.entries || []).map(x => x.name), `${label}: a layout named ${n}`).toContain(n)
  }
  if (e.watchlist) {
    const wl = (board.state.server?.lists || []).find(l => l.name === e.watchlist.name)
    expect(wl, `${label}: the watchlist ${e.watchlist.name}`).toBeTruthy()
    for (const sym of e.watchlist.include || []) expect(wl.items.map(i => i.sym), `${label}: ${sym} on ${e.watchlist.name}`).toContain(sym)
    for (const sym of e.watchlist.exclude || []) expect(wl.items.map(i => i.sym), `${label}: ${sym} not on ${e.watchlist.name}`).not.toContain(sym)
  }
  if (e.indicators) {
    const id = chartsOf(board)[e.indicators.chart || 0]?.id
    const got = p.brief(board, id)
    for (const want of e.indicators.include || []) expect(got, `${label}: indicator ${want} on chart ${e.indicators.chart || 0}`).toContain(want)
    for (const no of e.indicators.exclude || []) expect(got, `${label}: no ${no}`).not.toContain(no)
    if (e.indicators.count != null) expect(got.length, `${label}: indicator count`).toBe(e.indicators.count)
  }
  for (const r of e.reads || []) expect(calls.map(callLine).some(l => new RegExp(r, 'i').test(l)), `${label}: a canonical read matching /${r}/ ran (ran: ${calls.map(c => `${c[0]} ${c[1]}`).join(' | ')})`).toBe(true)
  for (const r of e.writes || []) expect(calls.map(callLine).some(l => new RegExp(r, 'i').test(l)), `${label}: a canonical write matching /${r}/ ran`).toBe(true)
  for (const r of e.noCalls || []) expect(calls.map(callLine).some(l => new RegExp(r, 'i').test(l)), `${label}: nothing matching /${r}/ ran`).toBe(false)
  if (e.receipt != null) expect(receiptsNow().length - since.receipts > 0, `${label}: a receipt`).toBe(e.receipt)
  if (e.undoable) expect(receiptsNow().at(-1)?.getAttribute('data-undoable'), `${label}: the receipt is undoable`).toBe('true')
  if (e.proposal != null) expect(proposalsNow().length > 0, `${label}: a proposal waiting`).toBe(e.proposal)
  if (e.refusal != null) expect(refusals().length - since.refusals > 0, `${label}: a refusal`).toBe(e.refusal)
}

/**
 * Replay steps on a fresh panel. step = { say, model?: { ops, disposition }, expect, approve?: true, afterApprove? }.
 * Each step's expectations are retried until they hold (UI work settles asynchronously) and then asserted.
 */
export async function replay({ board: boardName = 'ONE', steps, seed = {} }, label) {
  const m = mountCase(boardName, { seed })
  const { p, board, say } = m
  const start = boardState(board)
  for (const [i, s] of steps.entries()) {
    const before = boardState(board)
    const since = { calls: p.st.calls.length, turns: turnCount(p), receipts: receiptsNow().length, refusals: refusals().length }
    p.st.envelopes.length = 0
    if (s.routes) {
      const got = routedNames(s.say, { host: m.h }).names
      for (const a of s.routes) expect(got, `${label} · step ${i + 1}: "${s.say}" routes ${a}`).toContain(a)
    }
    if (s.model) p.st.envelopes.push(faithful(p, s.model))
    await say(s.say)
    const ctx = { ...m, start, before, since }
    const l = `${label} · step ${i + 1} "${s.say}"`
    if (s.expect) await waitFor(() => checkExpect(ctx, s.expect, l), { timeout: 6000 })
    if (s.approve) {
      const since2 = { ...since, calls: p.st.calls.length, receipts: receiptsNow().length }
      fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1))
      await m.p.idle()
      if (s.afterApprove) await waitFor(() => checkExpect({ ...ctx, since: since2 }, s.afterApprove, `${l} → Apply`), { timeout: 6000 })
    }
  }
  return m
}
