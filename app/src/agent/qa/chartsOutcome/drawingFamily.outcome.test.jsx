// COMPLETE DRAWING CONTROL — every tool, anchor edit, menu setting, Fibonacci edit and line alert, asserted on the state in
// the REAL drawings store and the fixture alert routes, through the real panel. See outcomeHarness.jsx for what this
// proves: only the model is scripted, each plan reads its target from the request, and NOTHING here shows that the real
// model would pick the plan. Two phrasings for one plan show the same plan works, not that a model reads both ways.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { TOOLS } from '../../../components/chart/ChartToolbar'
import { CONTROLS, SCHEMA, controlIdsFor } from '../../../components/chart/drawingSettingsSchema'
import { POINT_COUNT, validateDrawing } from '../../../components/chart/drawingTools'
import { resolveLevels, resolveBands, levelPriceOf } from '../../../components/chart/drawingFib'
import { getCapability } from '../../capabilities'
import { ADD_TOOLS, ALL_PROPS, drawingPropsFor } from '../../capabilities/drawingFamily'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, chart, selectedChart, drawingsOf, must, waitFor, proposalsNow, receiptsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => { for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA']) store.clearAll(s) })

const peek = (s = 'NVDA') => store.peekDrawings(s)
const one = (s = 'NVDA') => { const l = peek(s); expect(l).toHaveLength(1); return l[0] }
// `say` finds the turn's text by the member's words in the transcript, so a phrase must not also occur in a reply: a
// planned phrase here is made unique (a scripted plan does not read it). "undo" has no plan and stays as it is.
let said = 0
const quad = (o = {}) => {
  const m = open(QUAD(), QUAD_SYMS, { extra: { drawings: true }, selected: 'bl', ...o })
  const say = m.say
  return { ...m, say: (text, plan, opts) => (plan ? say(`${text} [turn ${++said}]`, plan, opts) : say(text)) }
}
const ref = (c, s = 'NVDA') => drawingsOf(c, s).ref
const pt = (date, price) => ({ date, price })
const ADD = (c, tool, points, extra = {}, s = 'NVDA') => ({ action: 'drawing.add', target: ref(c, s), args: { tool, points, color: null, style: null, ...extra } })
const recentId = (c, s = 'NVDA') => must(drawingsOf(c, s).drawings.find(d => d.recent), 'recent drawing').id
const MOVE = (c, points, id = recentId(c)) => ({ action: 'drawing.setAnchors', target: ref(c), args: { drawing: id, points } })
const SET = (c, set, id = recentId(c)) => ({ action: 'drawing.setProps', target: ref(c), args: { drawing: id, set: set.map(([prop, value, opacity = null]) => ({ prop, value, opacity })) } })
const FIB = (c, a, id = recentId(c)) => ({ action: 'drawing.setFibLevels', target: ref(c), args: { drawing: id, levels: [], bands: [], reset: false, ...a } })
const ALERT = (c, direction, level = null, id = recentId(c)) => ({ action: 'drawing.setAlert', target: ref(c), args: { drawing: id, direction, level } })
const TREND = (c) => [{ action: 'drawing.addTrendline', target: ref(c), args: { from: pt('2026-10-01', 100), to: pt('2026-10-20', 120), color: null, style: null } }]
const FIBDRAW = (c) => [{ action: 'drawing.addFib', target: ref(c), args: { from: pt('2026-10-01', 100), to: pt('2026-10-20', 200), color: null, style: null } }]
const LEVEL = (c, price = 200) => [{ action: 'drawing.addLevel', target: ref(c), args: { price, color: null, style: null } }]
const RECT = (c) => [{ action: 'drawing.addRectangle', target: ref(c), args: { from: pt('2026-10-01', 100), to: pt('2026-10-20', 120), color: null, style: null } }]
const TEXT = (c) => [{ action: 'drawing.addText', target: ref(c), args: { text: 'gap', date: '2026-10-15', price: 150, color: null } }]
const drawn = async (m, plan, phrase = 'draw it') => {
  await m.say(phrase, (c) => plan(c))
  await waitFor(() => expect(peek().length).toBeGreaterThan(0))
  return peek().at(-1)
}

describe('rails: the family is generated from the drawing layer, so a new tool or setting cannot go missing', () => {
  it('every tool on the toolbar is placeable; the Position Calculator is the one door that is not a drawing', () => {
    const toolbar = TOOLS.filter(t => t !== 'sep').map(t => t.id)
    const dedicated = { trendline: 'addTrendline', horizontal: 'addLevel', hray: 'addHorizontalRay', rect: 'addRectangle', fib: 'addFib', avwap: 'addAvwap', text: 'addText' }
    for (const id of toolbar) {
      if (id === 'position') continue
      if (dedicated[id]) expect(getCapability(`drawing.${dedicated[id]}`), id).toBeTruthy()
      else expect(ADD_TOOLS[id], id).toBeTruthy()
    }
    // the tools with a keyboard chord only, and the ray the Agent already draws, stay placeable
    expect(ADD_TOOLS.priceRange).toBeTruthy()
    expect(getCapability('drawing.addRay')).toBeTruthy()
  })
  it('every tool the family adds states as many point meanings as the overlay places points', () => {
    for (const [tool, spec] of Object.entries(ADD_TOOLS)) expect(spec.points, tool).toHaveLength(POINT_COUNT[tool])
  })
  it('every menu control that edits a named property is reachable on exactly the tools that declare it', () => {
    for (const type of Object.keys(SCHEMA)) {
      const wanted = controlIdsFor(type).map(id => CONTROLS[id]).filter(c => c?.prop)
      for (const c of wanted) expect(drawingPropsFor(type).has(c.prop), `${type}.${c.prop}`).toBe(true)
      expect(wanted.every(c => ALL_PROPS.includes(c.prop))).toBe(true)
    }
    expect(drawingPropsFor('circle').has('fillColor')).toBe(false)
  })
  it('a vertical line needs no price, and every other tool still does', () => {
    expect(validateDrawing('vertical', [{ time: '2026-10-15', price: null }]).ok).toBe(true)
    expect(validateDrawing('vertical', [{ time: '2026-10-15', price: 'x' }]).ok).toBe(false)
    expect(validateDrawing('hray', [{ time: '2026-10-15', price: null }]).ok).toBe(false)
  })
})

describe('slice 1: every tool, through one generic path', () => {
  const CASES = [
    ['extended', ['extend a line through Oct 1 at 100 and Oct 20 at 120', 'draw an extended line between those'], [pt('2026-10-01', 100), pt('2026-10-20', 120)]],
    ['vertical', ['vertical line on Oct 15', 'mark Oct 15 with a vertical'], [pt('2026-10-15', null)]],
    ['circle', ['circle that area', 'draw an ellipse from Oct 1 at 100 to Oct 20 at 120'], [pt('2026-10-01', 100), pt('2026-10-20', 120)]],
    ['arrow', ['arrow from Oct 20 at 120 back to Oct 1 at 100', 'point an arrow at Oct 1'], [pt('2026-10-20', 120), pt('2026-10-01', 100)]],
    ['fibext', ['fib extension from 100 to 150', 'fibonacci extension of that move'], [pt('2026-10-01', 100), pt('2026-10-20', 150)]],
    ['pitchfork', ['pitchfork from these points', 'andrews pitchfork'], [pt('2026-10-01', 100), pt('2026-10-10', 130), pt('2026-10-14', 110)]],
    ['channel', ['channel from these lows', 'parallel channel with the top at 130'], [pt('2026-10-01', 100), pt('2026-10-20', 120), pt('2026-10-05', 130)]],
    ['cup', ['draw the cup', 'cup curve from the rim to the rim'], [pt('2026-09-01', 150), pt('2026-10-01', 100), pt('2026-10-20', 149)]],
    ['measure', ['measure from Oct 1 to Oct 20', 'how far is that, put a ruler on it'], [pt('2026-10-01', 100), pt('2026-10-20', 120)]],
    ['priceRange', ['measure 100 to 120', 'price range'], [pt('2026-10-01', 100), pt('2026-10-01', 120)]],
    ['dateRange', ['bars and time from Oct 1 to Oct 20', 'how long was that'], [pt('2026-10-01', 100), pt('2026-10-20', 100)]],
    ['advance', ['mark the move from the setup candle', 'price move label'], [pt('2026-10-01', 100), pt('2026-10-20', 120)]],
  ]
  it.each(CASES)('%s: the right symbol, the anchors as said, the overlay\'s own keys; Undo takes it off', async (tool, phrases, points) => {
    const m = quad()
    await m.say(phrases[0], (c) => [ADD(c, tool, points)])
    await waitFor(() => expect(peek()).toHaveLength(1))
    const d = peek()[0]
    expect(d.type).toBe(tool)
    expect(d.points).toEqual(points.map(p => ({ time: p.date, price: p.price })))
    expect(d.pane).toBe('price')
    expect(validateDrawing(tool, d.points, { tf: 'D' }).ok).toBe(true)
    for (const s of ['SPY', 'QQQ', 'TSLA']) expect(peek(s)).toEqual([])
    expect(m.lastReceipt().textContent).toMatch(/on NVDA/)
    await m.say('undo')
    await waitFor(() => expect(peek()).toEqual([]))
    // the same plan from the second phrasing, with a colour this time
    await m.say(phrases[1], (c) => [ADD(c, tool, points, { color: 'red', style: 'dashed' })])
    await waitFor(() => expect(peek()).toHaveLength(1))
    const key = tool === 'advance' ? 'labelColor' : 'color'
    expect(peek()[0][key]).toMatch(/^#/)
    expect(peek()[0].lineStyle).toBe('dashed')
  })
  it('a new drawing carries what the toolbar stamps on it (a Measure answers all four questions; Bars & Time is flat)', async () => {
    const m = quad()
    await m.say('ruler', (c) => [ADD(c, 'measure', [pt('2026-10-01', 100), pt('2026-10-20', 120)]), ADD(c, 'dateRange', [pt('2026-10-02', 100), pt('2026-10-21', 140)])])
    await waitFor(() => expect(peek()).toHaveLength(2))
    expect(peek()[0]).toMatchObject({ showDollar: true, showPercent: true, showBars: true, showTime: true })
    expect(peek()[1].points.map(p => p.price)).toEqual([100, 100])
  })
  it('a Price Move carries figures, so a date with no bar under it still paints a label', async () => {
    const m = quad()
    await m.say('price move', (c) => [ADD(c, 'advance', [pt('2026-10-03', 100), pt('2026-10-20', 125)])])    // Oct 3 2026 is a Saturday
    await waitFor(() => expect(peek()).toHaveLength(1))
    expect(peek()[0]).toMatchObject({ advPct: 25, advDelta: 25, advHigh: 125, showDollar: true, showPercent: true })
  })
  it('the follow-up: "make it red" reaches the channel just drawn', async () => {
    const m = quad()
    await m.say('channel', (c) => [ADD(c, 'channel', [pt('2026-10-01', 100), pt('2026-10-20', 120), pt('2026-10-05', 130)])])
    await waitFor(() => expect(peek()).toHaveLength(1))
    const was = peek()[0].color
    await m.say('make it red', (c) => [{ action: 'drawing.style', target: ref(c), args: { drawing: recentId(c), color: 'red', style: null, width: null } }])
    await waitFor(() => expect(peek()[0].color).not.toBe(was))
  })
  it.each([
    ['a date in the future', 'trendline', 'extended', [pt('2027-01-01', 100), pt('2027-02-01', 120)], /in the future/],
    ['words that are no date', 'nonsense', 'arrow', [pt('the low', 100), pt('2026-10-20', 120)], /couldn't read “the low”/],
    ['no price', 'priceless', 'arrow', [pt('2026-10-01', null), pt('2026-10-20', 120)], /isn't a price/],
    ['a negative price', 'negative', 'circle', [pt('2026-10-01', -5), pt('2026-10-20', 120)], /isn't a price/],
    ['too few points', 'short', 'channel', [pt('2026-10-01', 100), pt('2026-10-20', 120)], /takes 3 points: base start/],
    ['too many points', 'long', 'vertical', [pt('2026-10-01', null), pt('2026-10-20', null)], /takes 1 point/],
    ['the same point twice', 'same', 'measure', [pt('2026-10-01', 100), pt('2026-10-01', 100)], /are the same/],
    ['a backward extended line', 'backward', 'extended', [pt('2026-10-20', 100), pt('2026-10-01', 120)], /time order/],
    ['a cup whose bottom is outside its rims', 'cup', 'cup', [pt('2026-10-01', 150), pt('2026-10-20', 100), pt('2026-10-10', 149)], /time order/],
    ['a channel with no width', 'flat channel', 'channel', [pt('2026-10-01', 100), pt('2026-10-21', 120), pt('2026-10-11', 110)], /no width/],
    ['a circle with no width', 'flat circle', 'circle', [pt('2026-10-01', 100), pt('2026-10-01', 120)], /different date/],
    ['a Fibonacci extension over no move', 'flat fib', 'fibext', [pt('2026-10-01', 100), pt('2026-10-20', 100)], /same/],
  ])('%s is refused, writes nothing and claims nothing', async (_n, phrase, tool, points, why) => {
    const m = quad()
    const out = await m.say(phrase, (c) => [ADD(c, tool, points)])
    expect(out).toMatch(why)
    expect(peek()).toEqual([])
    expect(receiptsNow()).toHaveLength(0)
  })
  it('an anchor outside the history the chart loaded is refused', async () => {
    const m = quad({ extra: { drawings: true, timeNav: true } })
    const out = await m.say('arrow', (c) => [ADD(c, 'arrow', [pt('1999-01-04', 100), pt('2026-10-20', 120)])])
    expect(out).toMatch(/before the history loaded/)
    expect(peek()).toEqual([])
  })
  it.each(['position', 'heatmap', 'trendline'])('the tool %s is not this path\'s, and is refused', async (tool) => {
    const m = quad()
    expect(await m.say('draw it', (c) => [ADD(c, tool, [pt('2026-10-01', 100)])])).toMatch(/isn't an option for tool/)
    expect(peek()).toEqual([])
  })
  it('a repeat is refused rather than stacked', async () => {
    const m = quad()
    const points = [pt('2026-10-01', 100), pt('2026-10-20', 120)]
    await drawn(m, (c) => [ADD(c, 'arrow', points)])
    const out = await m.say('again', (c) => [ADD(c, 'arrow', points)])
    expect(out).toMatch(/already an arrow/)
    expect(peek()).toHaveLength(1)
  })
})

describe('slice 2: moving anchors', () => {
  it('the request carries each anchor; "move the second point" reads it and changes only that one; Undo restores it', async () => {
    const m = quad()
    await drawn(m, TREND)
    await m.say('move the second point to Oct 28 at 140', (c) => {
      expect(drawingsOf(c, 'NVDA').drawings[0].anchors).toEqual(['2026-10-01 at 100', '2026-10-20 at 120'])
      return [MOVE(c, [{ point: 2, date: '2026-10-28', price: 140 }])]
    })
    await waitFor(() => expect(one().points[1]).toEqual({ time: '2026-10-28', price: 140 }))
    expect(one().points[0]).toEqual({ time: '2026-10-01', price: 100 })
    expect(m.lastReceipt().textContent).toMatch(/point 2 to \$140/)
    await m.say('undo')
    await waitFor(() => expect(one().points[1]).toEqual({ time: '2026-10-20', price: 120 }))
  })
  it.each([
    ['only the date', { point: 1, date: '2026-10-05', price: null }, [{ time: '2026-10-05', price: 100 }, { time: '2026-10-20', price: 120 }]],
    ['only the price', { point: 1, date: null, price: 90 }, [{ time: '2026-10-01', price: 90 }, { time: '2026-10-20', price: 120 }]],
  ])('%s changes, the rest stays', async (_n, move, want) => {
    const m = quad()
    await drawn(m, TREND)
    await m.say('move it', (c) => [MOVE(c, [move])])
    await waitFor(() => expect(one().points).toEqual(want))
  })
  it('a whole drawing moves with one item per point; "flatten that line" is the same path', async () => {
    const m = quad()
    await drawn(m, TREND)
    await m.say('move it up 5', (c) => [MOVE(c, [{ point: 1, date: null, price: 105 }, { point: 2, date: null, price: 125 }])])
    await waitFor(() => expect(one().points.map(p => p.price)).toEqual([105, 125]))
    await m.say('flatten that line', (c) => [MOVE(c, [{ point: 2, date: null, price: 105 }])])
    await waitFor(() => expect(one().points.map(p => p.price)).toEqual([105, 105]))
  })
  it('it works on any tool: a rectangle\'s corner, a channel\'s third point, a vertical line\'s date, a horizontal ray', async () => {
    const m = quad()
    await drawn(m, RECT)
    await m.say('stretch the box to 130', (c) => [MOVE(c, [{ point: 2, date: null, price: 130 }])])
    await waitFor(() => expect(peek()[0].points[1].price).toBe(130))
    await m.say('channel', (c) => [ADD(c, 'channel', [pt('2026-10-01', 100), pt('2026-10-20', 120), pt('2026-10-05', 130)])])
    await waitFor(() => expect(peek()).toHaveLength(2))
    await m.say('widen it', (c) => [MOVE(c, [{ point: 3, date: null, price: 140 }])])
    await waitFor(() => expect(peek()[1].points[2].price).toBe(140))
    await m.say('vertical', (c) => [ADD(c, 'vertical', [pt('2026-10-15', null)])])
    await waitFor(() => expect(peek()).toHaveLength(3))
    await m.say('move it to Oct 16', (c) => [MOVE(c, [{ point: 1, date: '2026-10-16', price: null }])])
    await waitFor(() => expect(peek()[2].points).toEqual([{ time: '2026-10-16', price: null }]))
  })
  it('a Bars & Time stays flat, and a Price Move restates its figures, when an anchor moves', async () => {
    const m = quad()
    await drawn(m, (c) => [ADD(c, 'dateRange', [pt('2026-10-01', 100), pt('2026-10-20', 100)])])
    await m.say('lift the first end', (c) => [MOVE(c, [{ point: 1, date: null, price: 110 }])])
    await waitFor(() => expect(peek()[0].points.map(p => p.price)).toEqual([110, 110]))
    await m.say('price move', (c) => [ADD(c, 'advance', [pt('2026-10-01', 100), pt('2026-10-20', 120)])])
    await waitFor(() => expect(peek()).toHaveLength(2))
    await m.say('the top was 150', (c) => [MOVE(c, [{ point: 2, date: null, price: 150 }])])
    await waitFor(() => expect(peek()[1].advPct).toBe(50))
  })
  it('a point dragged past the last bar stops being one when it gets a date', async () => {
    const m = quad()
    await drawn(m, TREND)
    store.updateDrawing('NVDA', peek()[0].id, { points: [peek()[0].points[0], { ...peek()[0].points[1], futureBars: 12 }] })
    await m.say('move it', (c) => [MOVE(c, [{ point: 2, date: '2026-10-25', price: null }])])
    await waitFor(() => expect(one().points[1]).toEqual({ time: '2026-10-25', price: 120 }))
  })
  it.each([
    ['a point the drawing does not have', [{ point: 3, date: null, price: 1 }], /has 2 points/],
    ['nothing to change', [{ point: 1, date: null, price: null }], /Say the new date or price/],
    ['a date in the future', [{ point: 2, date: '2027-01-05', price: null }], /in the future/],
    ['a first point after the second', [{ point: 1, date: '2026-10-25', price: null }], /time order/],
    ['the two points on one spot', [{ point: 2, date: '2026-10-01', price: 100 }], /are the same/],
    ['a bad price', [{ point: 1, date: null, price: -4 }], /isn't a price/],
  ])('refused: %s, and nothing moves', async (_n, points, why) => {
    const m = quad()
    const before = await drawn(m, TREND)
    const out = await m.say('move it', (c) => [MOVE(c, points)])
    expect(out).toMatch(why)
    expect(one()).toEqual(before)
  })
  it('refused: a date on a horizontal line, a price on a vertical line, a locked drawing, a pane drawing', async () => {
    const m = quad()
    await drawn(m, LEVEL)
    expect(await m.say('move', (c) => [MOVE(c, [{ point: 1, date: '2026-10-05', price: null }])])).toMatch(/no date/)
    await m.say('vertical', (c) => [ADD(c, 'vertical', [pt('2026-10-15', null)])])
    await waitFor(() => expect(peek()).toHaveLength(2))
    expect(await m.say('move', (c) => [MOVE(c, [{ point: 1, date: null, price: 5 }])])).toMatch(/no price/)
    const v = peek()[1]
    store.updateDrawing('NVDA', v.id, { locked: true })
    expect(await m.say('move', (c) => [MOVE(c, [{ point: 1, date: '2026-10-16', price: null }], v.id)])).toMatch(/locked/)
    store.updateDrawing('NVDA', v.id, { locked: false, pane: 'rsi', points: [{ time: '2026-10-15', price: 5, paneY: 0.5 }] })
    expect(await m.say('move', (c) => [MOVE(c, [{ point: 1, date: '2026-10-16', price: null }], v.id)])).toMatch(/indicator pane/)
    expect(await m.say('set level', (c) => [{ action: 'drawing.setLevel', target: ref(c), args: { drawing: peek()[0].id, price: 150 } }])).not.toMatch(/indicator pane/)
    store.updateDrawing('NVDA', peek()[0].id, { pane: 'rsi', points: [{ price: 5, paneY: 0.5 }] })
    expect(await m.say('set level', (c) => [{ action: 'drawing.setLevel', target: ref(c), args: { drawing: peek()[0].id, price: 160 } }])).toMatch(/indicator pane/)
  })
  it('a drawing with an alert is shown first, then moves; an id that is not on the chart moves nothing', async () => {
    const m = quad()
    const d = await drawn(m, TREND)
    m.st.alerts = [{ id: 'x', user_id: 'me', sym: 'NVDA', target_price: 120, direction: 'above', is_active: 1, triggered_at: null, created_at: '2026-11-03T13:00:00Z', alert_type: 'trendline', drawing_id: d.id }]
    await m.say('move the second point', (c) => [MOVE(c, [{ point: 2, date: null, price: 130 }], d.id)])
    expect(proposalsNow()).toHaveLength(1)
    expect(one().points[1].price).toBe(120)
    await m.apply()
    await waitFor(() => expect(one().points[1].price).toBe(130))
    expect(m.lastReceipt().textContent).toMatch(/its alert follows/)
    expect(await m.say('move', (c) => [MOVE(c, [{ point: 1, date: null, price: 1 }], 'nope')])).toMatch(/no drawing “nope”/)
  })
})

describe('slice 3: Fibonacci levels', () => {
  it.each([['0.786', 0.786], ['78.6', 78.6]])('"remove the %s" hides that level, no other, and leaves the anchors; Undo restores it', async (_n, level) => {
    const m = quad()
    const before = await drawn(m, FIBDRAW)
    await m.say('remove the 78.6', (c) => [FIB(c, { levels: [{ level, visible: false, color: null }] })])
    await waitFor(() => expect(resolveLevels(one()).find(l => l.level === 0.786).visible).toBe(false))
    expect(resolveLevels(one()).filter(l => !l.visible)).toHaveLength(1)
    expect(one().points).toEqual(before.points)
    expect(m.lastReceipt().textContent).toMatch(/0\.786 hidden/)
    await m.say('undo')
    await waitFor(() => expect(resolveLevels(one()).every(l => l.visible)).toBe(true))
  })
  it('a level\'s colour, a band on with its colour, then the band off: the editor\'s own sparse maps', async () => {
    const m = quad()
    await drawn(m, FIBDRAW)
    await m.say('make the 61.8 red and shade from there to the 78.6 blue', (c) => [FIB(c, {
      levels: [{ level: 61.8, visible: null, color: 'red' }],
      bands: [{ from: 0.618, to: 0.786, enabled: true, color: 'blue', opacity: 25 }],
    })])
    await waitFor(() => expect(resolveBands(one())).toHaveLength(1))
    expect(Object.keys(one().levels)).toEqual(['0.618'])
    expect(resolveBands(one())[0]).toMatchObject({ from: 0.618, to: 0.786 })
    expect(resolveBands(one())[0].color).toMatch(/^#[0-9a-f]{6}40$/)
    await m.say('take the shading off', (c) => [FIB(c, { bands: [{ from: 0.618, to: 0.786, enabled: false, color: null, opacity: null }] })])
    await waitFor(() => expect(resolveBands(one())).toEqual([]))
  })
  it('a band with no colour takes the editor\'s derived default', async () => {
    const m = quad()
    await drawn(m, FIBDRAW)
    await m.say('shade 0.5 to 0.618', (c) => [FIB(c, { bands: [{ from: 0.5, to: 0.618, enabled: true, color: null, opacity: null }] })])
    await waitFor(() => expect(resolveBands(one())).toHaveLength(1))
    expect(resolveBands(one())[0].color).toMatch(/26$/)
  })
  it('reset returns the Fibonacci to the table, leaves the anchors; a second reset says so', async () => {
    const m = quad()
    const before = await drawn(m, FIBDRAW)
    await m.say('hide the 0.5', (c) => [FIB(c, { levels: [{ level: 0.5, visible: false, color: null }] })])
    await waitFor(() => expect(one().levels).toBeTruthy())
    await m.say('reset the fib', (c) => [FIB(c, { reset: true })])
    await waitFor(() => expect(one().levels).toBe(null))
    expect(one().fills).toBeFalsy()
    expect(one().points).toEqual(before.points)
    expect(await m.say('reset again', (c) => [FIB(c, { reset: true })])).toMatch(/already at their defaults/)
  })
  it('a Fibonacci extension has its own table: 1.618 exists there, and not on a retracement', async () => {
    const m = quad()
    await drawn(m, (c) => [ADD(c, 'fibext', [pt('2026-10-01', 100), pt('2026-10-20', 150)])])
    await m.say('hide the 161.8', (c) => [FIB(c, { levels: [{ level: 161.8, visible: false, color: null }] })])
    await waitFor(() => expect(resolveLevels(peek()[0]).find(l => l.level === 1.618).visible).toBe(false))
    await m.say('fib', FIBDRAW)
    await waitFor(() => expect(peek()).toHaveLength(2))
    expect(await m.say('hide the 161.8', (c) => [FIB(c, { levels: [{ level: 1.618, visible: false, color: null }] })])).toMatch(/isn't a level/)
  })
  it.each([
    ['a level the tool does not have', { levels: [{ level: 0.3, visible: false, color: null }] }, /isn't a level/],
    ['levels that are not neighbours', { bands: [{ from: 0, to: 0.5, enabled: true, color: null, opacity: null }] }, /neighbouring/],
    ['a colour that is not one', { levels: [{ level: 0.5, visible: null, color: 'sparkly' }] }, /isn't a colour/],
    ['nothing at all', {}, /Say which levels/],
    ['a level with no change', { levels: [{ level: 0.5, visible: null, color: null }] }, /Say what to change/],
  ])('refused: %s', async (_n, a, why) => {
    const m = quad()
    const before = await drawn(m, FIBDRAW)
    expect(await m.say('edit', (c) => [FIB(c, a)])).toMatch(why)
    expect(one()).toEqual(before)
  })
  it('refused on a tool with no levels, and on a locked one', async () => {
    const m = quad()
    const t = await drawn(m, TREND)
    expect(await m.say('hide the 0.5', (c) => [FIB(c, { levels: [{ level: 0.5, visible: false, color: null }] })])).toMatch(/isn't a Fibonacci/)
    await m.say('fib', FIBDRAW)
    await waitFor(() => expect(peek()).toHaveLength(2))
    store.updateDrawing('NVDA', peek()[1].id, { locked: true })
    expect(await m.say('hide', (c) => [FIB(c, { levels: [{ level: 0.5, visible: false, color: null }] }, peek()[1].id)])).toMatch(/locked/)
    expect(peek()[0]).toEqual(t)
  })
})

describe('slice 4: every setting the tool\'s menu offers', () => {
  it('a rectangle\'s fill keeps the candles visible unless an opacity is said; its percent label; Undo restores each', async () => {
    const m = quad()
    await drawn(m, RECT)
    await m.say('shade that box blue', (c) => [SET(c, [['fillColor', 'blue']])])
    await waitFor(() => expect(one().fillColor).toMatch(/^#[0-9a-f]{6}26$/))
    expect(m.lastReceipt().textContent).toMatch(/Fill .* at 15%/)
    await m.say('make it 50%', (c) => [SET(c, [['fillColor', 'blue', 50]])])
    await waitFor(() => expect(one().fillColor).toMatch(/80$/))
    await m.say('show the percent', (c) => [SET(c, [['showPercentChange', true]])])
    await waitFor(() => expect(one().showPercentChange).toBe(true))
    await m.say('undo')
    await waitFor(() => expect(one().showPercentChange).toBeFalsy())
    await m.say('undo')
    await waitFor(() => expect(one().fillColor).toMatch(/26$/))
    await m.say('take the fill off', (c) => [SET(c, [['fillColor', null]])])
    await waitFor(() => expect(one().fillColor).toBe(null))
  })
  it('one tool\'s setting is refused on another, and the refusal names what that tool has', async () => {
    const m = quad()
    const c0 = await drawn(m, (c) => [ADD(c, 'circle', [pt('2026-10-01', 100), pt('2026-10-20', 120)])])
    const out = await m.say('fill that circle', (c) => [SET(c, [['fillColor', 'blue']])])
    expect(out).toMatch(/A circle has no “Fill” setting/)
    expect(one()).toEqual(c0)
  })
  it('a horizontal line\'s price label; an arrow\'s size by name', async () => {
    const m = quad()
    await drawn(m, LEVEL)
    expect(peek()[0].showPriceLabel).toBeFalsy()
    await m.say('show the price on that line', (c) => [SET(c, [['showPriceLabel', true]])])
    await waitFor(() => expect(peek()[0].showPriceLabel).toBe(true))
    await m.say('hide the price on that line', (c) => [SET(c, [['showPriceLabel', false]])])
    await waitFor(() => expect(peek()[0].showPriceLabel).toBe(false))
    await m.say('arrow', (c) => [ADD(c, 'arrow', [pt('2026-10-01', 100), pt('2026-10-20', 120)])])
    await waitFor(() => expect(peek()).toHaveLength(2))
    await m.say('big arrow', (c) => [SET(c, [['arrowSize', 'large']])])
    await waitFor(() => expect(peek()[1].arrowSize).toBeGreaterThan(10))
    expect(await m.say('huge', (c) => [SET(c, [['arrowSize', 'gigantic']])])).toMatch(/small, medium, large/)
  })
  it('a note: font, size, bold, italic, its words, and a background colour that actually shows', async () => {
    const m = quad()
    await drawn(m, TEXT)
    await m.say('make the note bold and italic at size 20', (c) => [SET(c, [['bold', true], ['italic', true], ['fontSize', 20]])])
    await waitFor(() => expect(one()).toMatchObject({ bold: true, italic: true, fontSize: 20 }))
    await m.say('yellow background and a red border', (c) => [SET(c, [['bgColor', 'yellow'], ['borderColor', 'red']])])
    await waitFor(() => expect(one()).toMatchObject({ bgEnabled: true, borderEnabled: true }))
    expect(one().bgColor).toMatch(/^#/)
    await m.say('change it to earnings gap', (c) => [SET(c, [['text', 'earnings gap']])])
    await waitFor(() => expect(one().text).toBe('earnings gap'))
    expect(await m.say('size 500', (c) => [SET(c, [['fontSize', 500]])])).toMatch(/whole number from 8 to 64/)
    expect(await m.say('blank it', (c) => [SET(c, [['text', '   ']])])).toMatch(/what the note should say/)
    expect(await m.say('comic', (c) => [SET(c, [['fontFamily', 'Comic Sans of Doom']])])).toMatch(/The fonts are/)
  })
  it('a note has no line: drawing.style refuses a dash rather than a false receipt, and takes a colour', async () => {
    const m = quad()
    await drawn(m, TEXT)
    const before = one()
    expect(await m.say('dash it', (c) => [{ action: 'drawing.style', target: ref(c), args: { drawing: recentId(c), color: null, style: 'dashed', width: null } }])).toMatch(/no line to style/)
    expect(one()).toEqual(before)
  })
  it('Measure\'s label fields and position; Price Move refuses to hide its last figure', async () => {
    const m = quad()
    await drawn(m, (c) => [ADD(c, 'measure', [pt('2026-10-01', 100), pt('2026-10-20', 120)])])
    await m.say('hide bars on the measure and put the label on top', (c) => [SET(c, [['showBars', false], ['labelPos', 'top']])])
    await waitFor(() => expect(one()).toMatchObject({ showBars: false, labelPos: 'top' }))
    await m.say('price move', (c) => [ADD(c, 'advance', [pt('2026-10-01', 100), pt('2026-10-20', 120)])])
    await waitFor(() => expect(peek()).toHaveLength(2))
    const id = peek()[1].id
    await m.say('hide the dollars', (c) => [SET(c, [['showDollar', false]], id)])
    await waitFor(() => expect(peek()[1].showDollar).toBe(false))
    expect(await m.say('hide the percent too', (c) => [SET(c, [['showPercent', false]], id)])).toMatch(/must show at least one figure/)
    expect(peek()[1].showPercent).toBe(true)
  })
  it('a setting already that way says so; a locked drawing is refused; nothing asked is refused', async () => {
    const m = quad()
    await drawn(m, RECT)
    await m.say('percent on', (c) => [SET(c, [['showPercentChange', true]])])
    await waitFor(() => expect(one().showPercentChange).toBe(true))
    const out = await m.say('percent on again', (c) => [SET(c, [['showPercentChange', true]])])
    expect(out).toMatch(/already set like that/)
    expect(await m.say('nothing', (c) => [SET(c, [])])).toMatch(/Say which setting/)
    store.updateDrawing('NVDA', peek()[0].id, { locked: true })
    expect(await m.say('fill', (c) => [SET(c, [['fillColor', 'blue']], peek()[0].id)])).toMatch(/locked/)
  })
})

describe('slice 5: Measure is a stored drawing', () => {
  it('it persists in the store, states what follows from its anchors, and the receipt claims no bar count', async () => {
    const m = quad()
    await drawn(m, (c) => [ADD(c, 'measure', [pt('2026-10-01', 100), pt('2026-10-20', 125)])])
    expect(one().type).toBe('measure')
    const text = m.lastReceipt().textContent
    expect(text).toMatch(/\+\$25 \(\+25\.00%\)/)
    expect(text).not.toMatch(/\bbars?\b/)
    const d = one()
    await m.say('list the drawings', (c) => { expect(drawingsOf(c, 'NVDA').drawings[0].id).toBe(d.id); return [{ action: 'drawing.list', target: ref(c), args: {} }] })
    await m.say('end it at 90', (c) => [MOVE(c, [{ point: 2, date: null, price: 90 }], d.id)])
    await waitFor(() => expect(one().points[1].price).toBe(90))
  })
})

describe('slice 6: an alert that follows the line', () => {
  const bound = (m) => m.st.alerts.filter(a => a.drawing_id)
  const moveOn = async (m, plan, phrase) => { await m.say(phrase, plan); expect(proposalsNow()).toHaveLength(1); await m.apply() }
  it('a trendline: shown first, Dismiss sets nothing; Apply sends the geometry the chart menu sends, bound to this drawing; Undo removes it', async () => {
    const m = quad()
    const d = await drawn(m, TREND)
    await m.say('alert me if it breaks below this trendline', (c) => [ALERT(c, 'below')], { disposition: 'propose' })
    expect(proposalsNow()).toHaveLength(1)
    await m.dismiss()
    expect(bound(m)).toEqual([])
    await moveOn(m, (c) => [ALERT(c, 'below', null, d.id)], 'alert me if it loses that line')
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    const a = bound(m)[0]
    expect(a).toMatchObject({ sym: 'NVDA', direction: 'below', alert_type: 'trendline', drawing_id: d.id, anchor_p1: 100, anchor_p2: 120, target_price: 120, is_active: 1 })
    expect(a.anchor_t1).toBe(Date.UTC(2026, 9, 1, 16) / 1000)
    expect(a.anchor_t2).toBe(Date.UTC(2026, 9, 20, 16) / 1000)
    expect(m.lastReceipt().textContent).toMatch(/level moves with the line/)
    expect(one()).toEqual(d)
    await m.say('undo')
    await waitFor(() => expect(bound(m)).toEqual([]))
    expect(one()).toEqual(d)
  })
  it('Undo will not pretend once the alert has gone off', async () => {
    const m = quad()
    await drawn(m, TREND)
    await moveOn(m, (c) => [ALERT(c, 'above')], 'alert above it')
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    m.st.alerts = m.st.alerts.map(a => ({ ...a, is_active: 0, triggered_at: '2026-11-04T15:00:00Z' }))
    await m.say('undo')
    expect(bound(m)).toHaveLength(1)
    expect(m.p.transcript()).toMatch(/already went off/)
  })
  it('one Fibonacci level binds as <drawing>#<level> at that level\'s price, and then the Fibonacci cannot be removed out from under it', async () => {
    const m = quad()
    const d = await drawn(m, FIBDRAW)
    await moveOn(m, (c) => [ALERT(c, 'below', 61.8)], 'alert at the 61.8')
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    expect(bound(m)[0]).toMatchObject({ drawing_id: `${d.id}#0.618`, alert_type: 'line' })
    expect(bound(m)[0].target_price).toBeCloseTo(levelPriceOf(d, 0.618), 6)
    expect(await m.say('delete the fib', (c) => [{ action: 'drawing.remove', target: ref(c), args: { drawing: d.id } }])).toMatch(/alert is attached/)
    expect(peek()).toHaveLength(1)
  })
  it('a horizontal line is a line alert at its price', async () => {
    const m = quad()
    const d = await drawn(m, LEVEL)
    await moveOn(m, (c) => [ALERT(c, 'above')], 'alert above that line')
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    expect(bound(m)[0]).toMatchObject({ alert_type: 'line', target_price: 200, drawing_id: d.id })
  })
  it('the same alert twice is refused; the other side of the line is a different alert', async () => {
    const m = quad()
    const d = await drawn(m, TREND)
    await moveOn(m, (c) => [ALERT(c, 'above', null, d.id)], 'above')
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    expect(await m.say('again', (c) => [ALERT(c, 'above', null, d.id)])).toMatch(/already has an active alert above/)
    await moveOn(m, (c) => [ALERT(c, 'below', null, d.id)], 'below')
    await waitFor(() => expect(bound(m)).toHaveLength(2))
  })
  it.each([
    ['a tool that cannot carry one', (c) => ADD(c, 'circle', [pt('2026-10-01', 100), pt('2026-10-20', 120)]), null, /can't carry an alert/],
    ['a Fibonacci with no level named', FIBDRAW, null, /Which level/],
    ['a level the Fibonacci does not have', FIBDRAW, 0.3, /Which level/],
    ['a level on a plain line', TREND, 0.5, /has no levels/],
  ])('refused: %s', async (_n, draw, level, why) => {
    const m = quad()
    await drawn(m, (c) => [draw(c)].flat())
    expect(await m.say('alert', (c) => [ALERT(c, 'above', level)])).toMatch(why)
    expect(bound(m)).toEqual([])
    expect(proposalsNow()).toHaveLength(0)
  })
  it('refused: a point past the last bar, because its time needs the chart\'s bars', async () => {
    const m = quad()
    const d = await drawn(m, TREND)
    store.updateDrawing('NVDA', d.id, { points: [d.points[0], { ...d.points[1], futureBars: 3 }] })
    expect(await m.say('alert', (c) => [ALERT(c, 'above', null, d.id)])).toMatch(/past the last bar/)
    expect(bound(m)).toEqual([])
  })
  it('refused: an alert book that cannot be read sets nothing', async () => {
    const m = quad()
    const d = await drawn(m, TREND)
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((u, o) => (String(u).startsWith('/api/watchlist-alerts') ? Promise.reject(new Error('down')) : real(u, o)))
    expect(await m.say('alert', (c) => [ALERT(c, 'above', null, d.id)])).toMatch(/couldn't read your alerts/)
    expect(bound(m)).toEqual([])
  })
})

describe('the board: the right symbol from the request', () => {
  it('"this chart" reaches the clicked chart\'s symbol for the generic tool too', async () => {
    const m = open([chart('a', 0, 0, 12, 20), chart('b', 12, 0, 12, 20)], { 'N:a': 'NVDA', 'N:b': 'TSLA' }, { extra: { drawings: true }, selected: 'b' })
    await m.say('vertical line on Oct 15 on this chart', (c) => [ADD(c, 'vertical', [pt('2026-10-15', null)], {}, selectedChart(c).symbol)])
    await waitFor(() => expect(peek('TSLA')).toHaveLength(1))
    expect(peek('NVDA')).toEqual([])
  })
})
