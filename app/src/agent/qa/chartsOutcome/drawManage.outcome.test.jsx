// CHARTS OUTCOME — drawing management across charts (pl-exec round 8, family 5): hide / show one drawing, lock / unlock it, hide
// or show every drawing on a chart — on the chart the words or the click mean, read back from the REAL drawings store by symbol
// (the decoy line on another symbol never changes), each with Undo. Rows: C1-126 (hide all), C1-158 (lock / unlock), C1-159 (hide /
// show one). Held-out phrasings (agentDrawManageHeldOut) are said as written; the plan is the one a correct planner sends.
// ⛔ THE MODEL IS SCRIPTED. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, chartAt, selectedChart, drawingsOf, waitFor } from './outcomeHarness'
import { DRAW_HELD_OUT } from '../../agentDrawManageHeldOut.test.js'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => { for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA']) store.clearAll(s) })

const peek = (s) => store.peekDrawings(s)
const POS = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' }
const SYM = { tl: 'SPY', tr: 'QQQ', bl: 'NVDA', br: 'TSLA' }
const LINE = (c, symbol, price) => ({ action: 'drawing.addLevel', target: drawingsOf(c, symbol).ref, args: { price, color: null, style: null } })
const symOf = (c, on) => (on === 'sel' ? selectedChart(c).symbol : chartAt(c, POS[on]).symbol)
const lineOf = (c, symbol) => { const ds = drawingsOf(c, symbol).drawings || []; if (!ds.length) throw new Error(`the context lists no drawing on ${symbol}: ${JSON.stringify(drawingsOf(c, symbol)).slice(0, 300)}`); return ds[0] }
const OP = {
  hide: (c, s) => ({ action: 'drawing.setVisible', target: drawingsOf(c, s).ref, args: { drawing: lineOf(c, s).id, visible: false } }),
  show: (c, s) => ({ action: 'drawing.setVisible', target: drawingsOf(c, s).ref, args: { drawing: lineOf(c, s).id, visible: true } }),
  lock: (c, s) => ({ action: 'drawing.lock', target: drawingsOf(c, s).ref, args: { drawing: lineOf(c, s).id, locked: true } }),
  unlock: (c, s) => ({ action: 'drawing.lock', target: drawingsOf(c, s).ref, args: { drawing: lineOf(c, s).id, locked: false } }),
  hideAll: (c, s) => ({ action: 'drawing.setAllVisible', target: drawingsOf(c, s).ref, args: { visible: false } }),
  showAll: (c, s) => ({ action: 'drawing.setAllVisible', target: drawingsOf(c, s).ref, args: { visible: true } }),
}
// the state each op leaves on the meant line, and the state it starts from (a show / unlock needs the opposite first)
const AFTER = { hide: { hidden: true }, show: { hidden: false }, lock: { locked: true }, unlock: { locked: false }, hideAll: { hidden: true }, showAll: { hidden: false } }
const BEFORE = { show: 'hide', unlock: 'lock', showAll: 'hideAll' }
const flag = (d, k) => !!d?.[k]

describe('drawing management on the chart meant, the decoy untouched, Undo exact', () => {
  it.each(DRAW_HELD_OUT.map(c => [c.id, c.text, c]))('%s "%s"', async (_id, _t, c) => {
    const m = open(QUAD(), QUAD_SYMS, { extra: { drawings: true }, ...(c.click ? { selected: c.click } : {}) })
    const meant = c.on === 'sel' ? SYM[c.click] : SYM[c.on]
    await m.say(`draw a line at 200 on the ${meant} chart`, (ctx) => [LINE(ctx, meant, 200)])
    if (meant !== 'SPY') await m.say('and one at 150 on SPY', (ctx) => [LINE(ctx, 'SPY', 150)])
    await waitFor(() => expect(peek(meant)).toHaveLength(1))
    if (BEFORE[c.op]) await m.say('set it up first', (ctx) => [OP[BEFORE[c.op]](ctx, meant)])
    const decoy = JSON.stringify(peek('SPY'))
    const key = Object.keys(AFTER[c.op])[0]
    const before = flag(peek(meant)[0], key)
    const out = await m.say(c.text, (ctx) => [OP[c.op](ctx, symOf(ctx, c.on))])
    await waitFor(() => expect(flag(peek(meant)[0], key), out).toBe(AFTER[c.op][key]))
    if (meant !== 'SPY') expect(JSON.stringify(peek('SPY'))).toBe(decoy)
    await m.say('undo')
    await waitFor(() => expect(flag(peek(meant)[0], key)).toBe(before))
  }, 60000)
  it('NEGATIVE a plan on the decoy chart for "this chart" (bl clicked) never lands there', async () => {
    const m = open(QUAD(), QUAD_SYMS, { extra: { drawings: true }, selected: 'bl' })
    await m.say('draw a line at 200 on the NVDA chart', (ctx) => [LINE(ctx, 'NVDA', 200)])
    await m.say('and one at 150 on SPY', (ctx) => [LINE(ctx, 'SPY', 150)])
    await waitFor(() => expect(peek('SPY')).toHaveLength(1))
    await m.say('hide that line on this chart for now', (ctx) => [OP.hide(ctx, 'SPY')])
    expect(flag(peek('SPY')[0], 'hidden')).toBe(false)
  }, 60000)
})
