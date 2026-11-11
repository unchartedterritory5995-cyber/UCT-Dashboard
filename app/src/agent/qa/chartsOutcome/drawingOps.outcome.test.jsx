// DRAWING MENU OPERATIONS — the menu's Duplicate (C1-157) and a position's Alerts row (C1-118), asserted on the REAL
// drawings store and the fixture alert routes, through the real panel. Only the model is scripted (see outcomeHarness.jsx):
// this proves what a correct plan does to the state, not that a paid model would pick it.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { offsetPoints } from '../../../components/chart/drawingGeometry'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, drawingsOf, must, waitFor, proposalsNow } from './outcomeHarness'

// The entry alert's side is read from the current price (the gateway's `quotes`); the fixture server does not serve it,
// so each test says what the price is — or that it cannot be read ({}).
let QUOTES = {}
vi.mock('../../capabilities/alert', async (importOriginal) => ({ ...(await importOriginal()), quotesFor: async (syms) => Object.fromEntries(syms.filter(s => s in QUOTES).map(s => [s, QUOTES[s]])) }))
vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => { QUOTES = {}; for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA']) store.clearAll(s) })

const peek = (s = 'NVDA') => store.peekDrawings(s)
let said = 0
const quad = (o = {}) => {
  const m = open(QUAD(), QUAD_SYMS, { extra: { drawings: true }, selected: 'bl', ...o })
  const say = m.say
  return { ...m, say: (text, plan, opts) => (plan ? say(`${text} [turn ${++said}]`, plan, opts) : say(text)) }
}
const ref = (c, s = 'NVDA') => drawingsOf(c, s).ref
const recentId = (c, s = 'NVDA') => must(drawingsOf(c, s).drawings.find(d => d.recent), 'recent drawing').id
const TREND = (c, s = 'NVDA') => [{ action: 'drawing.addTrendline', target: ref(c, s), args: { from: { date: '2026-10-01', price: 100 }, to: { date: '2026-10-20', price: 120 }, color: 'red', style: 'dashed' } }]
const DUP = (c, id = recentId(c), s = 'NVDA') => ({ action: 'drawing.duplicate', target: ref(c, s), args: { drawing: id } })
const POS = (c, id, levels) => ({ action: 'drawing.setPositionAlerts', target: ref(c), args: { drawing: id, levels } })
const strip = (d) => { const rest = { ...d }; delete rest.id; return rest }

describe('C1-157 Duplicate: the menu\'s own copy, on the right symbol, undone by id', () => {
  it('a copy lands just below the original with the original\'s style, unlocked; the copy becomes "it"; Undo removes only the copy', async () => {
    const m = quad()
    await m.say('draw a trendline', (c) => TREND(c))
    await waitFor(() => expect(peek()).toHaveLength(1))
    const orig = peek()[0]
    store.updateDrawing('NVDA', orig.id, { locked: true })
    const locked = peek()[0]
    await m.say('duplicate it', (c) => [DUP(c)])
    await waitFor(() => expect(peek()).toHaveLength(2))
    const copy = peek()[1]
    // exactly what the menu's onDuplicate writes: the drawing without its id, points offset, unlocked
    expect(strip(copy)).toEqual({ ...strip(locked), points: offsetPoints(locked.points), locked: false })
    expect(peek()[0]).toEqual(locked)
    for (const s of ['SPY', 'QQQ', 'TSLA']) expect(peek(s)).toEqual([])
    expect(m.lastReceipt().textContent).toMatch(/Duplicated the trendline on NVDA/)
    expect(m.pending()).toBe(0)
    // the copy is the drawing a follow-up means
    await m.say('make it blue', (c) => { expect(recentId(c)).toBe(copy.id); return [{ action: 'drawing.style', target: ref(c), args: { drawing: copy.id, color: 'blue', style: null, width: null } }] })
    await waitFor(() => expect(peek()[1].color).not.toBe(copy.color))
    await m.say('undo')
    await m.say('undo')
    await waitFor(() => expect(peek()).toEqual([locked]))
  })
  it('wrong-target control: duplicating on TSLA\'s chart copies TSLA\'s drawing; NVDA\'s is untouched', async () => {
    const m = quad()
    await m.say('trendline on nvda', (c) => TREND(c, 'NVDA'))
    await m.say('trendline on tsla', (c) => TREND(c, 'TSLA'))
    await waitFor(() => expect(peek('TSLA')).toHaveLength(1))
    const nv = peek('NVDA')
    const ts = peek('TSLA')[0]
    await m.say('duplicate the tsla trendline', (c) => [DUP(c, drawingsOf(c, 'TSLA').drawings[0].id, 'TSLA')])
    await waitFor(() => expect(peek('TSLA')).toHaveLength(2))
    expect(peek('NVDA')).toEqual(nv)
    expect(peek('TSLA')[1].points).toEqual(offsetPoints(ts.points))
  })
  it('an id from another symbol\'s entry writes nothing anywhere', async () => {
    const m = quad()
    await m.say('trendline on nvda', (c) => TREND(c, 'NVDA'))
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    const id = peek('NVDA')[0].id
    // refused or asked back (the runtime may offer the entry that does hold the id) — never a copy on either symbol
    expect(await m.say('duplicate it on tsla', (c) => [DUP(c, id, 'TSLA')])).not.toMatch(/Duplicated/)
    expect(proposalsNow()).toHaveLength(0)
    expect(peek('NVDA')).toHaveLength(1)
    expect(peek('TSLA')).toEqual([])
  })
  it('refused: a hidden drawing (the copy would be invisible) and a retired position (its menu has no Duplicate)', async () => {
    const m = quad()
    await m.say('draw a trendline', (c) => TREND(c))
    await waitFor(() => expect(peek()).toHaveLength(1))
    const t = peek()[0]
    store.updateDrawing('NVDA', t.id, { hidden: true })
    expect(await m.say('duplicate it', (c) => [DUP(c, t.id)])).toMatch(/hidden — show it first/)
    const pid = store.addDrawing('NVDA', { type: 'position', points: [{ time: '2026-10-01', price: 100 }, { time: '2026-10-01', price: 90 }, { time: '2026-10-20', price: 120 }] })
    expect(await m.say('duplicate the position', (c) => [DUP(c, pid)])).toMatch(/can't be duplicated/)
    expect(peek()).toHaveLength(2)
  })
})

describe('C1-118 position alerts: the menu\'s three bells, each on the side the position gives it', () => {
  const bound = (m) => m.st.alerts.filter(a => a.drawing_id)
  const LONG = [{ time: '2026-10-01', price: 100 }, { time: '2026-10-01', price: 90 }, { time: '2026-10-20', price: 120 }]
  const SHORT = [{ time: '2026-10-01', price: 100 }, { time: '2026-10-01', price: 110 }, { time: '2026-10-20', price: 80 }]
  const position = (points = LONG) => store.addDrawing('NVDA', { type: 'position', points })
  it('stop and target of a long: shown first, Dismiss sets nothing; Apply binds <id>#1 below the stop and <id>#2 above the target; Undo removes both', async () => {
    const m = quad()
    const id = position()
    await m.say('alert me on my stop and target', (c) => [POS(c, id, ['stop', 'target'])])
    expect(proposalsNow()).toHaveLength(1)
    await m.dismiss()
    expect(bound(m)).toEqual([])
    await m.say('set the stop and target alerts', (c) => [POS(c, id, ['stop', 'target'])])
    await m.apply()
    await waitFor(() => expect(bound(m)).toHaveLength(2))
    const by = Object.fromEntries(bound(m).map(a => [a.drawing_id, a]))
    expect(by[`${id}#1`]).toMatchObject({ sym: 'NVDA', alert_type: 'line', target_price: 90, direction: 'below' })
    expect(by[`${id}#2`]).toMatchObject({ sym: 'NVDA', alert_type: 'line', target_price: 120, direction: 'above' })
    expect(m.lastReceipt().textContent).toMatch(/long position on NVDA/)
    await m.say('undo')
    await waitFor(() => expect(bound(m)).toEqual([]))
  })
  it('a short flips the sides: stop above, target below', async () => {
    const m = quad()
    const id = position(SHORT)
    await m.say('alerts on the stop and target', (c) => [POS(c, id, ['stop', 'target'])])
    await m.apply()
    await waitFor(() => expect(bound(m)).toHaveLength(2))
    const by = Object.fromEntries(bound(m).map(a => [a.drawing_id, a.direction]))
    expect(by).toEqual({ [`${id}#1`]: 'above', [`${id}#2`]: 'below' })
  })
  it('the entry\'s side comes from the current price (above the entry → below), exactly the menu\'s rule', async () => {
    QUOTES = { NVDA: 105 }
    const m = quad()
    const id = position()
    await m.say('alert on my entry', (c) => [POS(c, id, ['entry'])])
    await m.apply()
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    expect(bound(m)[0]).toMatchObject({ drawing_id: `${id}#0`, target_price: 100, direction: 'below' })
  })
  it('the entry with no readable price is refused as unavailable — never a guessed side, nothing written', async () => {
    const m = quad()
    const id = position()
    expect(await m.say('all three alerts', (c) => [POS(c, id, ['entry', 'stop', 'target'])])).toMatch(/couldn't read NVDA's current price/)
    expect(proposalsNow()).toHaveLength(0)
    expect(bound(m)).toEqual([])
  })
  it('"all three" skips a level already set (as the menu\'s button does); one named level already set is refused', async () => {
    QUOTES = { NVDA: 95 }
    const m = quad()
    const id = position()
    await m.say('stop alert', (c) => [POS(c, id, ['stop'])])
    await m.apply()
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    expect(await m.say('stop alert again', (c) => [POS(c, id, ['stop'])])).toMatch(/already has an active stop alert/)
    await m.say('all three', (c) => [POS(c, id, ['entry', 'stop', 'target'])])
    await m.apply()
    await waitFor(() => expect(bound(m)).toHaveLength(3))
    expect(bound(m).map(a => a.drawing_id).sort()).toEqual([`${id}#0`, `${id}#1`, `${id}#2`])
    expect(m.lastReceipt().textContent).toMatch(/stop already had one/)
  })
  it.each([
    ['not a position', null, /isn't a position/],
    ['a position that is neither long nor short', [{ time: '2026-10-01', price: 100 }, { time: '2026-10-01', price: 110 }, { time: '2026-10-20', price: 120 }], /don't make a long or a short/],
  ])('refused: %s', async (_n, points, why) => {
    const m = quad()
    let id
    if (points) id = store.addDrawing('NVDA', { type: 'position', points })
    else { await m.say('draw a trendline', (c) => TREND(c)); await waitFor(() => expect(peek()).toHaveLength(1)); id = peek()[0].id }
    expect(await m.say('alert on the stop', (c) => [POS(c, id, ['stop'])])).toMatch(why)
    expect(bound(m)).toEqual([])
  })
  it('refused: an alert book that cannot be read sets nothing', async () => {
    const m = quad()
    const id = position()
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((u, o) => (String(u).startsWith('/api/watchlist-alerts') ? Promise.reject(new Error('down')) : real(u, o)))
    expect(await m.say('stop alert', (c) => [POS(c, id, ['stop'])])).toMatch(/couldn't read your alerts/)
    expect(bound(m)).toEqual([])
  })
  it('drawing.setAlert on a position now points at the position\'s own alerts instead of "on the chart"', async () => {
    const m = quad()
    const id = position()
    expect(await m.say('alert above the position', (c) => [{ action: 'drawing.setAlert', target: ref(c), args: { drawing: id, direction: 'above', level: null } }])).toMatch(/entry, stop and target/)
  })
})
