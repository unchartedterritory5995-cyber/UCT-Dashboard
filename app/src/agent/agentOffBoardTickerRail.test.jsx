// RAIL (AUDIT, 11-13): deixis.offBoardTicker may only turn an ACT into an ASK — it never causes a write to any chart.
// The rule is consulted in exactly two places, both of which IDENTIFY a chart: resolveDeictic's "the one left" (theOneLeft)
// and screenUnnamedTargets' "left.length === 1". When it fires, it withholds that identification, so the caller asks.
// Generated: off-board tickers × anaphor × exclusion phrasings × boards of 1, 2 and 3 charts × no click / a click on the plan's
// chart / a click on another chart. The scripted plan always changes SPY (a wrong-chart plan for "Change AMD …").
//   DECIDED   (2+ charts, no click on the plan's chart): the rule fires → asked, and NO chart changes.
//   NOT CONSULTED  (1 chart; or the plan's chart is the one clicked): the rules that run before it decide. At aee4be9f54 the plan's
//             chart was written there (identical with the rule disabled, M4+M5). Since the AUDIT target-ticker ruling
//             (deixis.targetTickerConflict) "Change AMD …" with the plan on SPY is ASKED there too — so every cell: asked, no write.
// GUARD SITES: the two places the rule withholds an identification are held directly (screenUnnamedTargets / screenDeicticOps),
// because in the panel targetTickerConflict now asks behind them as well (the panel cells alone no longer isolate this rule).
// Unit block: what the reader counts as an off-board ticker (never an exclusion, an on-board symbol, an indicator acronym, or
// words typed in capitals).
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, the real panel (panelHarness), scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { offBoardTicker, screenUnnamedTargets, screenDeicticOps } from './deixis'
import { getCapability, getTargetKind } from './capabilities'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const BOARDS = [['SPY'], ['SPY', 'NVDA'], ['SPY', 'NVDA', 'QQQ']]
const OFF_BOARD = ['AMD', 'AAPL', 'TSLA']
const SAYS = [(T) => `Change ${T} to the 1-hour timeframe, add a 20 EMA to it`, (T) => `Change ${T} to the 1-hour timeframe and add a 20 EMA`]
const EXCLUSIONS = [(O) => `, but leave my ${O} chart alone.`, (O) => `, but leave my ${O} alone.`, (O) => `. Don't touch ${O}.`, (O) => `, but not ${O}.`, (O) => `. ${O} stays as is.`]
// click: none, the plan's chart (SPY, w0), another chart (w1: NVDA, the excluded one)
const CLICKS = [null, 'w0', 'w1']

const CASES = []
for (const tk of OFF_BOARD) for (const say of SAYS) for (const exc of EXCLUSIONS) for (const syms of BOARDS) for (const sel of CLICKS) {
  if (sel === 'w1' && syms.length < 2) continue
  CASES.push([say(tk) + exc('NVDA'), syms, sel])
}

const mount = (syms, sel) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean/i.test(transcript())
const planOnSpy = (body) => {
  const r = body.context.charts.find(c => c.label === 'Chart (SPY)').ref
  const ix = body.context.indicatorEdits.find(x => x.symbol === 'SPY').ref
  return p.env('apply', [{ action: 'chart.setTimeframe', target: r, args: { timeframe: '60' } },
    { action: 'indicator.add', target: ix, args: { defId: 'ema', inputs: [{ key: 'period', value: 20 }] } }])
}

describe('offBoardTicker only ever turns an act into an ask: never a write', () => {
  it('the grid is generated: 3 tickers × 2 phrasings × 5 exclusions × (1 + 3 + 3 board/click cells)', () => expect(CASES).toHaveLength(3 * 2 * 5 * 8))
  it.each(CASES)('"%s" on %j, click %s', async (t, syms, sel) => {
    const m = mount(syms, sel)
    const ids = syms.map((_, i) => `w${i}`)
    const before = Object.fromEntries(ids.map(id => [id, stored(m.board, id)]))
    p.st.envelopes.push(planOnSpy)
    await m.say(t)
    const written = ids.filter(id => stored(m.board, id) !== before[id])
    // every cell: the excluded chart (NVDA, w1) and any third chart never change
    expect(written.filter(id => id !== 'w0'), transcript()).toEqual([])
    // every cell: asked, nothing written (decided by this rule on 2+ charts; by the target-ticker ruling elsewhere)
    expect(asked(), transcript()).toBe(true)
    expect(written, transcript()).toEqual([])
  }, 60000)
})

// ── GUARD SITES, held directly: with the rule, "the one left" never identifies the plan's chart for an off-board target ─────────
describe('GUARD SITES: "the one left" is withheld when the change words name an off-board ticker', () => {
  const GUARD = OFF_BOARD.flatMap(T => EXCLUSIONS.map(exc => [T, exc('NVDA')]))
  const opsOnSpy = [{ action: 'chart.setTimeframe', target: 'w0', args: { timeframe: '60' } }]
  it.each(GUARD)('screenUnnamedTargets: "Change %s to the 1-hour timeframe%s" (SPY + NVDA, no click) → asks', (T, tail) => {
    const m = mount(['SPY', 'NVDA'])
    const r = screenUnnamedTargets({ host: m.h, ops: opsOnSpy, text: `Change ${T} to the 1-hour timeframe${tail}`, getTargetKind, getCapability })
    expect(r?.ask, JSON.stringify(r)).toBeTruthy()
  })
  it.each(GUARD)('screenDeicticOps: "Change %s to the 1-hour timeframe, add a 20 EMA to it%s" (SPY + NVDA, no click) → asks', (T, tail) => {
    const m = mount(['SPY', 'NVDA'])
    const r = screenDeicticOps({ host: m.h, ops: opsOnSpy, text: `Change ${T} to the 1-hour timeframe, add a 20 EMA to it${tail}`, getTargetKind, getCapability })
    expect(r?.ask, JSON.stringify(r)).toBeTruthy()
  })
  it('controls: the same words naming SPY (on the board) identify SPY at both sites', () => {
    const m = mount(['SPY', 'NVDA'])
    expect(screenUnnamedTargets({ host: m.h, ops: opsOnSpy, text: "Change SPY to the 1-hour timeframe. Don't touch NVDA.", getTargetKind, getCapability })).toBeNull()
    expect(screenDeicticOps({ host: m.h, ops: opsOnSpy, text: "Change SPY to the 1-hour timeframe, add a 20 EMA to it. Don't touch NVDA.", getTargetKind, getCapability })).toBeNull()
  })
})

describe('offBoardTicker: what counts as a ticker the board does not show', () => {
  const charts = [{ symbol: 'SPY' }, { symbol: 'NVDA' }]
  it.each([
    ['Change AMD to the 1-hour timeframe, but leave my NVDA alone.', 'AMD'],
    ['put $TSLA on weekly, not NVDA', 'TSLA'],
    ['Change SPY to the 1-hour timeframe, add a 20 EMA to it, but leave my NVDA chart alone.', null],   // on the board
    ['Change SPY to hourly. Don\'t touch AMD.', null],                                                // only in the exclusion
    ['add the RSI and MACD to SPY, VWAP too, not NVDA', null],                                         // indicator acronyms
    ['CHANGE AMD TO HOURLY, NOT NVDA', null],                                                         // typed in capitals
    ['hide volume, not the NVDA chart', null],
  ])('"%s" → %s', (t, want) => expect(offBoardTicker(t, charts)).toBe(want))
})
