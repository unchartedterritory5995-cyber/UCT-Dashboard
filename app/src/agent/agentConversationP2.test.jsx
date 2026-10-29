// PHASE 2 — NATURAL-LANGUAGE INTELLIGENCE (2026-10-29). How traders actually follow up, through the REAL panel
// (AgentPanel + useAgent + registry, planner, policy, runtime, receipts and Undo), the REAL board writer and the REAL
// Indicators mutation interface on each chart's stored settings (testing/panelHarness). Stand-in: the Agent model —
// any turn that reaches it is visible (MODEL_SENTINEL), so each case proves WHICH layer read the request. No paid call.
//
//   R  references    "the fast one", "the first one", "the second one", "them both", "that indicator I just added",
//                    "the other one", "it" — resolved from session memory on the live chart
//   S  chart sets    "now put those on my other charts", "do the same thing on the other charts",
//                    "make all my charts match this one", "make this chart look like the one next to it"
//   M  multi-step    "Create four daily charts for SPY, QQQ, NVDA and TSLA, put the 9 and 20 EMA on all of them, make the
//                    9 green and 20 yellow, and put RSI in its own pane." · "Put RSI under price and make it a little
//                    taller" · a step that cannot land STOPS the request and says what was / was not done · limits
//   G  guards        stale references, pronouns after a chart change, nothing invented, typos
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO, FOUR, MODEL_SENTINEL } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const colorOf = (board, id, name) => {
  const i = p.instancesOn(board, id).find(x => x.defId === 'movingAverage' && `${String(x.inputs?.maType || '').toUpperCase()} ${x.inputs?.period}` === name)
  return i?.inputs?.color ?? null
}
const rsiOn = (board, id) => p.instancesOn(board, id).filter(i => i.defId === 'rsi')
const GREEN = '#2faf68', YELLOW = '#facc15', RED = '#df4646'

// ═══ R — references ══════════════════════════════════════════════════════════════════════════════════════
describe('R · references across messages', () => {
  it('R1 "Throw the 9 and 20 on my chart" → "Make the fast one green" → "Actually, make the 20 yellow instead" — all local, the right lines', async () => {
    const { board, say } = p.mount(...ONE())
    await say('Throw the 9 and 20 on my chart')
    expect(p.brief(board, 'c')).toEqual(['movingAverage(9 ema)', 'movingAverage(20 ema)'])
    await say('Make the fast one green')
    expect(colorOf(board, 'c', 'EMA 9')).toBe(GREEN)
    expect(colorOf(board, 'c', 'EMA 20')).not.toBe(GREEN)
    await say('Actually, make the 20 yellow instead')
    expect(colorOf(board, 'c', 'EMA 20')).toBe(YELLOW)
    expect(colorOf(board, 'c', 'EMA 9')).toBe(GREEN)
    expect(p.turns()).toBe(0)
    expect(p.transcript()).not.toContain(MODEL_SENTINEL)
  }, 40000)

  it('R2 "the first one" / "the second one" / "them both" — the order they were added, kept across restyling turns', async () => {
    const { board, say } = p.mount(...ONE())
    await say('Add the 9 and 20 EMA')
    await say('Make the first one green')
    await say('make the second one red')
    expect(colorOf(board, 'c', 'EMA 9')).toBe(GREEN)
    expect(colorOf(board, 'c', 'EMA 20')).toBe(RED)
    const out = await say('make them both dashed')
    expect(out).toMatch(/EMA 9's line style.*dashed/)
    expect(out).toMatch(/EMA 20's line style.*dashed/)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('R3 "Get rid of that indicator I just added" with two just added → asked which (choices); the pick is a removal PROPOSAL — nothing removed yet', async () => {
    const { board, say, click } = p.mount(...ONE())
    await say('Throw the 9 and 20 on my chart')
    const q = await say('Get rid of that indicator I just added')
    expect(q).toMatch(/Which one — EMA 9 or EMA 20\?/)
    await click('EMA 20')
    await waitFor(() => expect(p.proposals()).toHaveLength(1))
    expect(p.brief(board, 'c')).toEqual(['movingAverage(9 ema)', 'movingAverage(20 ema)'])     // a removal waits for Apply
    expect(p.turns()).toBe(0)
  }, 40000)

  it('R4 "the other one" — after the member picked one of two', async () => {
    const { board, say } = p.mount(...ONE())
    await say('add the 9 and 20 ema')
    await say('make the first one green')
    await say('make the other one red')
    expect(colorOf(board, 'c', 'EMA 20')).toBe(RED)
    expect(colorOf(board, 'c', 'EMA 9')).toBe(GREEN)
  }, 40000)

  it('R5 "it" after one add: "make it a little taller" sizes its pane, "make it purple" colours it — never a second indicator', async () => {
    const { board, say } = p.mount(...ONE())
    await say('add rsi')
    const tall = await say('make it a little taller')
    expect(tall).toMatch(/Set the RSI \(14\) pane on Chart \(QQQ\) to \d+% of the chart's height/)
    await say('make it purple')
    expect(rsiOn(board, 'c')).toHaveLength(1)
    expect(rsiOn(board, 'c')[0].inputs?.color ?? rsiOn(board, 'c')[0].presentation).toBeTruthy()
    expect(p.turns()).toBe(0)
  }, 40000)

  it('R6 the model is told what "the first one" could mean: conversation_memory.recent_indicators, in order, with the refs it targets', async () => {
    const { say } = p.mount(...ONE())
    await say('add the 9 and 20 ema')
    await say('explain what the first one is doing on my chart and whether it matters')    // a question → the model
    const mem = p.lastTurnBody()?.context?.conversation_memory
    expect(mem.recent_indicators.map(i => i.name)).toEqual(['EMA 9', 'EMA 20'])
    expect(mem.recent_indicators.every(i => typeof i.target === 'string' && typeof i.id === 'string')).toBe(true)
    const refs = new Set((p.lastTurnBody().context.indicatorEdits || []).map(e => e.ref))
    expect(mem.recent_indicators.every(i => refs.has(i.target))).toBe(true)
  }, 40000)
})

// ═══ S — chart sets ══════════════════════════════════════════════════════════════════════════════════════
describe('S · "my other charts", "the same", "match this one"', () => {
  it('S1 "add the 9 and 20 ema to the top left chart" → "Now put those on my other charts" — copied onto the other three, one model call: none', async () => {
    const { board, say } = p.mount(...FOUR())
    await say('add the 9 and 20 ema to the top left chart')
    expect(p.brief(board, 'c0')).toEqual(['movingAverage(9 ema)', 'movingAverage(20 ema)'])
    expect(p.brief(board, 'c1')).toEqual([])
    const out = await say('Now put those on my other charts')
    for (const id of ['c1', 'c2', 'c3']) expect(p.brief(board, id), id).toEqual(['movingAverage(9 ema)', 'movingAverage(20 ema)'])
    expect(out).toMatch(/Copied EMA 9, EMA 20 on Chart \(QQQ\)/)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('S1b …then "make them all green" — the originals AND the copies on the other charts', async () => {
    const { board, say } = p.mount(...FOUR())
    await say('add the 9 and 20 ema to the top left chart')
    await say('Now put those on my other charts')
    await say('make them all green')
    for (const id of ['c0', 'c1', 'c2', 'c3']) {
      expect(colorOf(board, id, 'EMA 9'), id).toBe(GREEN)
      expect(colorOf(board, id, 'EMA 20'), id).toBe(GREEN)
    }
    expect(p.turns()).toBe(0)
  }, 60000)

  it('S2 "add rsi to the top left chart" → "Do the same thing on the other charts" — the last turn repeated on each other chart', async () => {
    const { board, say } = p.mount(...FOUR())
    await say('add rsi to the top left chart')
    await say('Do the same thing on the other charts')
    for (const id of ['c0', 'c1', 'c2', 'c3']) expect(rsiOn(board, id), id).toHaveLength(1)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('S3 "make the top left chart weekly" → "make all my charts match this one" — ONE proposal for the three others (a look copy is approved first); nothing changed yet', async () => {
    const { h, say } = p.mount(...FOUR())
    await say('make the top left chart weekly')
    expect(h.charts.read('c0').tf).toBe('W')
    await say('make all my charts match this one')
    await waitFor(() => expect(p.proposals()).toHaveLength(1))
    const card = p.proposals()[0].textContent
    for (const s of ['QQQ', 'NVDA', 'TSLA']) expect(card).toContain(`Chart (${s}): Copy the look of Chart (SPY)`)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('S4 two charts, no click: "make the left chart weekly" → "make this chart look like the one next to it" — this = the chart the conversation is on', async () => {
    const { say } = p.mount(...TWO())
    await say('make the left chart weekly')
    await say('make this chart look like the one next to it')
    await waitFor(() => expect(p.proposals()).toHaveLength(1))
    expect(p.proposals()[0].textContent).toMatch(/Copy the look of Chart \(AMD\)/)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('S5 "make them all daily" / "put the 50 sma on all of them" — the pronoun belongs to "all"', async () => {
    const { board, h, say } = p.mount(...FOUR())
    await say('make the top left chart weekly')
    await say('make them all daily')
    for (const c of h.charts.list()) expect(c.tf).toBe('D')
    await say('put the 50 sma on all of them')
    for (const id of ['c0', 'c1', 'c2', 'c3']) expect(p.brief(board, id)).toEqual(['movingAverage(50 sma)'])
    expect(p.turns()).toBe(0)
  }, 40000)

  it('S6 "top left" without a hyphen is the top-left chart', async () => {
    const { h, say } = p.mount(...FOUR())
    await say('switch the top left chart to weekly')
    expect(h.charts.read('c0').tf).toBe('W')
    expect(h.charts.read('c3').tf).not.toBe('W')
    expect(p.turns()).toBe(0)
  }, 40000)
})

// ═══ M — multi-step requests ═════════════════════════════════════════════════════════════════════════════
const FLAGSHIP = 'Create four daily charts for SPY, QQQ, NVDA and TSLA, put the 9 and 20 EMA on all of them, make the 9 green and 20 yellow, and put RSI in its own pane.'
const chartIds = (board) => board.state.widgets.filter(w => w.type === 'chart').map(w => w.id)
describe('M · several steps in one message', () => {
  it('M1 the flagship request: four daily charts, 9 & 20 on each (never a duplicate), 9 green, 20 yellow, RSI in its own pane — no model call', async () => {
    const { board, h, say } = p.mount(...ONE())
    const out = await say(FLAGSHIP)
    const ids = chartIds(board)
    expect(ids).toHaveLength(4)
    expect(h.charts.list().map(c => c.symbol)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    for (const c of h.charts.list()) expect(c.tf).toBe('D')
    for (const id of ids) {
      const mas = p.instancesOn(board, id).filter(i => i.defId === 'movingAverage')
      expect(mas.filter(i => i.inputs?.period === 9 && i.inputs?.maType === 'ema'), id).toHaveLength(1)     // never a second EMA 9
      expect(mas.filter(i => i.inputs?.period === 20 && i.inputs?.maType === 'ema'), id).toHaveLength(1)
      expect(colorOf(board, id, 'EMA 9'), id).toBe(GREEN)
      expect(colorOf(board, id, 'EMA 20'), id).toBe(YELLOW)
      expect(rsiOn(board, id), id).toHaveLength(1)
    }
    expect(out).toMatch(/already on/)                                    // the new charts' own EMA 9 / EMA 20, said
    expect(out).toMatch(/All 4 steps done\./)
    expect(p.turns()).toBe(0)
    expect(p.proposals()).toHaveLength(0)
  }, 60000)

  it('M2 "Put RSI under price and make it a little taller" — added (its own pane is under price), then that pane is made taller', async () => {
    const { board, say } = p.mount(...ONE())
    const out = await say('Put RSI under price and make it a little taller')
    expect(rsiOn(board, 'c')).toHaveLength(1)
    expect(out).toMatch(/Added RSI \(14\) on Chart \(QQQ\)/)
    expect(out).toMatch(/Set the RSI \(14\) pane on Chart \(QQQ\) to \d+% of the chart's height/)
    expect(out).toMatch(/All 2 steps done\./)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('M3 a step that cannot land STOPS the request: what was done, what was not — never "done"', async () => {
    const { board, h, say } = p.mount(...ONE())
    // the reused chart has no SMA 50 (its defaults were removed), so "the 50" cannot be read on every chart
    const out = await say('Create four daily charts for SPY, QQQ, NVDA and TSLA, make the 50 purple and the 20 thicker, then add rsi to all of them')
    expect(chartIds(board)).toHaveLength(4)                              // step 1 landed, and stays
    expect(out).toMatch(/Done 1 of 3 steps, then stopped at “make the 50 purple and the 20 thicker”: Chart \(SPY\) has nothing that matches “the 50”/)
    expect(out).toMatch(/Not done: “make the 50 purple and the 20 thicker”, “add rsi to all of them”\./)
    expect(out).not.toMatch(/All 3 steps done/)
    for (const id of chartIds(board)) expect(rsiOn(board, id)).toHaveLength(0)
    expect(h.charts.list()).toHaveLength(4)
    expect(p.turns()).toBe(0)
  }, 60000)

  it('M4 a clause nothing reads → the WHOLE request goes to the model (nothing half-run)', async () => {
    const { board, say } = p.mount(...ONE())
    await say('add rsi and then tell me a joke about the fed')
    expect(p.turns()).toBe(1)
    expect(rsiOn(board, 'c')).toHaveLength(0)
  }, 40000)

  it('M5 more steps than one message may hold → said, nothing changed (the limit is preserved, not raised)', async () => {
    const { board, say } = p.mount(...ONE())
    const out = await say('add rsi, make it purple, add macd, make it red, add atr, make it blue, then switch to weekly')
    expect(out).toMatch(/That's 7 steps in one message — UCT does at most 6 at a time/)
    expect(p.instancesOn(board, 'c')).toHaveLength(0)
  }, 40000)

  it('M6 each step has its own Undo: "undo" takes back only the newest step', async () => {
    const { board, say } = p.mount(...ONE())
    await say('Put RSI under price and make it a little taller')
    const sized = rsiOn(board, 'c')[0]
    expect(sized).toBeTruthy()
    await say('undo')
    expect(rsiOn(board, 'c')).toHaveLength(1)                          // the RSI stays; only its height came back
  }, 40000)
})

// ═══ G — guards ══════════════════════════════════════════════════════════════════════════════════════════
describe('G · never stale, never invented', () => {
  it('G1 an indicator removed by hand is not "the first one" any more — nothing changes locally', async () => {
    const { board, say } = p.mount(...ONE())
    await say('add the 9 and 20 ema')
    // the member removes EMA 9 by hand (the stored settings, as the legend ✕ leaves them)
    const w = board.state.widgets.find(x => x.id === 'c')
    const cs = mergeChartSettings(JSON.stringify(w.opts.settings))
    w.opts = { ...w.opts, settings: { ...cs, indicatorInstances: cs.indicatorInstances.filter(i => !(i.defId === 'movingAverage' && i.inputs?.period === 9)) } }
    await say('make the first one green')
    expect(colorOf(board, 'c', 'EMA 20')).not.toBe(GREEN)
  }, 40000)

  it('G2 "make it green" right after a CHART change is not about an old indicator', async () => {
    const { board, say } = p.mount(...ONE())
    await say('add rsi')
    await say('switch to weekly')
    await say('make it green')
    const r = rsiOn(board, 'c')[0]
    expect(r.inputs?.color).not.toBe(GREEN)
  }, 40000)

  it('G3 "make the first one green" with nothing in the conversation and no averages on the chart → the model, nothing invented', async () => {
    const { board, say } = p.mount(...ONE())
    await say('make the first one green')
    expect(p.turns()).toBe(1)
    expect(p.instancesOn(board, 'c')).toHaveLength(0)
  }, 40000)

  it('G4 typos: "ad teh 20 ema" → "mak it grean"', async () => {
    const { board, say } = p.mount(...ONE())
    await say('ad teh 20 ema')
    expect(p.brief(board, 'c')).toEqual(['movingAverage(20 ema)'])
    await say('mak it grean')
    expect(colorOf(board, 'c', 'EMA 20')).toBe(GREEN)
    expect(p.turns()).toBe(0)
  }, 40000)

  it('G5 "Put the 9 above the 20" — both on the price chart: said plainly what UCT cannot do (no fake change)', async () => {
    const { board, say } = p.mount(...ONE())
    await say('add the 9 and 20 ema')
    const before = JSON.stringify(p.instancesOn(board, 'c'))
    const out = await say('Put the 9 above the 20')
    expect(out).toMatch(/both draw on the price chart — UCT can’t change which line draws on top yet/)
    expect(JSON.stringify(p.instancesOn(board, 'c'))).toBe(before)
  }, 40000)
})
