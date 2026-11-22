// HOTFIX (negated-ticker targeting) — the CROSS-FAMILY matrix through the REAL panel over the outcome harness (AgentPanel +
// useAgent + the real capability writers: the board writer, the drawings store, the Indicators mutation interface). The
// scripted model plan names ALL FOUR charts, the excluded one (NVDA, bottom-left) included. For every family and every
// negated-ticker phrasing: NVDA's stored state (its board widget, its drawings) stays BYTE-IDENTICAL — after the turn AND after
// the member takes whatever the panel offers (the set choice, Apply) — and NVDA is never on a card nor in a question's options.
// The other three DO change once the member takes the offer (the change is real, not refused wholesale).
// Families: chart.setTimeframe, chartFeatures.earningsStrip, chartSetup.setMovingAverages, drawing.addLevel, indicator.add
// (multiChart.cell: negatedTicker.grid.test.jsx). Evidence: LOCAL / SIMULATED (vitest, jsdom, scripted model).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { open, outcomeSuite, afterEachOutcome, QUAD_SYMS, drawingsOf, screen, fireEvent, proposalsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => { for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA']) store.clearAll(s) })

// four charts with the product's default settings (moving averages on, so chartSetup.setMovingAverages has work to do)
const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: {} })
const BOARD = () => [cell('tl', 0, 0), cell('tr', 12, 0), cell('bl', 0, 10), cell('br', 12, 10)]
const EXCLUDED = 'bl'                                  // NVDA
const SYM = { tl: 'SPY', tr: 'QQQ', bl: 'NVDA', br: 'TSLA' }

const ixe = (c, sym) => c.indicatorEdits.find(e => e.symbol === sym).ref
const FAMILIES = {
  timeframe: { verb: (q) => `switch ${q} to weekly`, ops: (c) => c.charts.map(x => ({ action: 'chart.setTimeframe', target: x.ref, args: { timeframe: 'W' } })) },
  earningsStrip: { verb: (q) => `add the earnings strip to ${q}`, ops: (c) => c.charts.map(x => ({ action: 'chartFeatures.earningsStrip', target: x.ref, args: { op: 'open' } })) },
  chartSetup: { verb: (q) => `hide the moving averages on ${q}`, ops: (c) => c.charts.map(x => ({ action: 'chartSetup.setMovingAverages', target: x.ref, args: { visible: false } })) },
  drawing: { verb: (q) => `draw a horizontal line at 100 on ${q}`, ops: (c) => c.charts.map(x => ({ action: 'drawing.addLevel', target: drawingsOf(c, x.symbol).ref, args: { price: 100, color: null, style: null } })) },
  indicator: { verb: (q) => `add RSI to ${q}`, ops: (c) => c.charts.map(x => ({ action: 'indicator.add', target: ixe(c, x.symbol), args: { defId: 'rsi', inputs: null } })) },
}
// the phrasings (the Lead's and the reviewer's failing families, own words): separator × cue × object form
const PHRASES = [
  (v) => `${v('every chart')}, but leave NVDA's alone`,
  (v) => `${v('all of them')}, skip NVDA's`,
  (v) => `${v('every chart')}. Not the NVDA chart though.`,
  (v) => `${v('all charts')}; dont touch NVDA`,
  (v) => `${v('all charts')} — don’t touch the NVDA one`,
  (v) => `${v('every chart')}: do not touch NVDA's chart`,
  (v) => `${v('every chart')}, hands off the NVDA chart`,
  (v) => `${v('every chart')}. Leave NVDA out of it.`,
  (v) => `${v('every chart')} but leave out the NVDA one`,
  (v) => `${v('every chart')} apart from NVDA's`,
  (v) => `Leave NVDA's alone and ${v('every chart')}`,
  (v) => `${v('every chart')} – ignore nvda`,
  (v) => `${v('every chart')}, NVDA's can stay as it is`,
  (v) => `${v('every chart')} without NVDA's`,
]
const CASES = Object.keys(FAMILIES).flatMap(f => PHRASES.map((ph, i) => [f, i, ph(FAMILIES[f].verb)]))

const stored = (m, id) => JSON.stringify([m.board.state.widgets.find(w => w.id === id), store.peekDrawings(SYM[id])])
const buttons = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent.trim())
const chartButtons = () => buttons().filter(t => /Chart \(/.test(t))
const cards = () => proposalsNow().map(e => e.textContent).join(' ')
// take what the panel offers: the set choice (one button naming every chart of the set), then any Apply
async function takeOffer(m) {
  const set = [...document.querySelectorAll('[data-testid="agent-transcript"] button')].find(b => /Chart \(/.test(b.textContent) && /,| and /.test(b.textContent))
  if (set) { fireEvent.click(set); await m.p.idle(); await new Promise(r => setTimeout(r, 0)); await m.p.idle() }
  if (screen.queryAllByRole('button', { name: 'Apply' }).length) await m.apply()
}

describe('cross-family: a plan naming every chart never touches, cards or offers the chart a negated-ticker clause excludes', () => {
  it('the matrix covers every family and every phrasing', () => {
    expect(CASES.length).toBe(Object.keys(FAMILIES).length * PHRASES.length)
  })
  it.each(CASES)('%s #%i: "%s"', async (fam, i, text) => {
    const m = open(BOARD(), QUAD_SYMS, { extra: { drawings: true } })
    const before = Object.fromEntries(Object.keys(SYM).map(id => [id, stored(m, id)]))
    await m.say(text, FAMILIES[fam].ops)
    expect(stored(m, EXCLUDED), m.p.transcript?.() || '').toBe(before[EXCLUDED])
    expect(chartButtons().join(' | ')).not.toMatch(/NVDA/)
    expect(cards()).not.toMatch(/NVDA/)
    await takeOffer(m)
    expect(stored(m, EXCLUDED)).toBe(before[EXCLUDED])
    expect(cards()).not.toMatch(/NVDA/)
    // the change is real on the charts the member did not exclude
    const moved = ['tl', 'tr', 'br'].filter(id => stored(m, id) !== before[id])
    expect(moved, screen.getByTestId('agent-transcript').textContent).toEqual(['tl', 'tr', 'br'])
  }, 60000)
})
