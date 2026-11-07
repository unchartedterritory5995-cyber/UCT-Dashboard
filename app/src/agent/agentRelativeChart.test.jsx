// A chart named RELATIVE to the clicked one ("the one above this", "the chart to the right of this one", "the one next to this").
// Autotest u-target-02 (BROWSER-MOCK-MODEL, 11-07): BL clicked, "make the one above this weekly", the plan on TL, and the Agent asked
// "Which chart do you mean?" — the click was counted as the chart named and TL as unnamed. The click is the ANCHOR of a relative
// reference, never its target: the chart meant is the clicked chart's neighbour on that side. No click, no neighbour there, or two
// that fit → asked. A bare "this" still means the clicked chart. Through the REAL panel on the fixture board, the model scripted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { relativeChart } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// 2×2: c0 TL, c1 TR, c2 BL, c3 BR
const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const WIDGETS = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const mountOn = (clicked) => {
  const m = p.mount(WIDGETS, SYMS, { decorate: label })
  if (clicked) p.select(clicked)
  return m
}
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const tfs = (b) => WIDGETS.map(w => tfOf(b, w.id)).join('')
const asked = () => /Which chart do you mean|Did you mean/.test(screen.getByTestId('agent-transcript').textContent)
// the model's plan on the chart the context labels `Chart (<id>)`
const planOn = (id) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }])

describe('relativeChart: the clicked chart is the anchor', () => {
  const at = (ref, x, y) => ({ ref, cell: { x, y, w: 12, h: 10 } })
  const C = [at('c0', 0, 0), at('c1', 12, 0), at('c2', 0, 10), at('c3', 12, 10)]
  const hit = (t, sel) => relativeChart(t, C, sel)?.hits.map(c => c.ref) ?? null
  it.each([
    ['the one above this', 'c2', ['c0']], ['the chart below this one', 'c0', ['c2']], ['the one under it', 'c1', ['c3']],
    ['the one to the right of this', 'c0', ['c1']], ['the chart left of this one', 'c3', ['c2']], ['the cell right above this', 'c3', ['c1']],
    ['the one next to this', 'c2', ['c3']], ['the one beside the selected chart', 'c1', ['c0']],
  ])('%s (clicked %s) → %j', (t, sel, want) => expect(hit(t, sel)).toEqual(want))
  it('nothing on that side, or no click: no chart', () => {
    expect(hit('the one above this', 'c0')).toEqual([])
    expect(hit('the one above this', null)).toEqual([])
  })
  it('not a relative reference: null ("above 50", "this chart", "the top one")', () => {
    for (const t of ['alert me above 50', 'make this chart weekly', 'make the top one weekly', 'the right one']) expect(hit(t, 'c2')).toBeNull()
  })
})

describe('a chart named relative to the clicked one (u-target-02 family)', () => {
  it.each([['make the one above this weekly', 'c2', 'c0'], ['make the chart above this one weekly', 'c2', 'c0'],
    ['make the one to the right of this weekly', 'c0', 'c1'], ['make the one next to this weekly', 'c2', 'c3'],
    ['switch the chart below this one to weekly', 'c1', 'c3']])('%s (clicked %s): the plan on %s runs there; the clicked chart is unchanged', async (t, clicked, meant) => {
    const { say, board: b } = mountOn(clicked)
    p.st.envelopes.push(planOn(meant))
    await say(t)
    expect(tfOf(b, meant)).toBe('W')
    expect(tfOf(b, clicked)).toBe('D')
    expect(asked()).toBe(false)
  }, 30000)
  it('NEGATIVE: the plan on the CLICKED chart is not run (it is the anchor, not the target)', async () => {
    const { say, board: b } = mountOn('c2')
    p.st.envelopes.push(planOn('c2'))
    await say('make the one above this weekly')
    expect(tfs(b)).toBe('DDDD')
  }, 30000)
  it('NEGATIVE: no chart on that side of the clicked one: asked, nothing changes', async () => {
    const { say, board: b } = mountOn('c0')
    p.st.envelopes.push(planOn('c2'))
    await say('make the one above this weekly')
    expect(tfs(b)).toBe('DDDD')
    expect(asked()).toBe(true)
  }, 30000)
  it('NEGATIVE: nothing clicked: no anchor, asked, nothing changes', async () => {
    const { say, board: b } = mountOn(null)
    p.st.envelopes.push(planOn('c0'))
    await say('make the one above this weekly')
    expect(tfs(b)).toBe('DDDD')
    expect(asked()).toBe(true)
  }, 30000)
  it('a bare "this" still means the clicked chart', async () => {
    const { say, board: b } = mountOn('c2')
    p.st.envelopes.push(planOn('c2'))
    await say('make this one weekly for me please')
    expect(tfOf(b, 'c2')).toBe('W')
    expect(tfs(b)).toBe('DDWD')
  }, 30000)
})

// AUDIT R1/R2/R3 (11-07): the RELATION word decides, not the noun before it. A relation word (above, below, under, beneath,
// left/right of, next to, beside, alongside, adjacent to, near) right before an anchor (this/that, it, the selected/clicked/
// current one, the one I clicked) makes the click the anchor: a plan on the anchor never runs there (asked), a plan on the meant
// neighbour runs there, and no single neighbour → asked. These phrasings are this branch's own (AUDIT's probe set is separate).
describe('the relation rule, paired: the anchor never runs, the meant neighbour does', () => {
  // [text, clicked, meant neighbour]
  const PAIRS = [
    ['set the name sitting under this chart to weekly', 'c1', 'c3'],
    ['weekly for whatever is beneath it', 'c0', 'c2'],
    ['the symbol directly above the current one should be weekly', 'c3', 'c1'],
    ['change the panel that sits to the left of this one to weekly', 'c1', 'c0'],
    ['flip the graph on the right of the selected one to weekly', 'c2', 'c3'],
    ['make the stock alongside this one weekly', 'c3', 'c2'],
    ['go weekly on the one right below the one I clicked', 'c0', 'c2'],
    ['put whatever is above the one you have selected on weekly', 'c2', 'c0'],
  ]
  it.each(PAIRS)('%s (clicked %s): a plan on the clicked chart is asked about, nothing changes', async (t, clicked) => {
    const { say, board: b } = mountOn(clicked)
    p.st.envelopes.push(planOn(clicked))
    await say(t)
    expect(tfs(b)).toBe('DDDD')
    expect(asked()).toBe(true)
  }, 30000)
  it.each(PAIRS)('%s (clicked %s): the plan on %s runs there, the clicked chart is unchanged', async (t, clicked, meant) => {
    const { say, board: b } = mountOn(clicked)
    p.st.envelopes.push(planOn(meant))
    await say(t)
    expect(tfOf(b, meant)).toBe('W')
    expect(tfOf(b, clicked)).toBe('D')
  }, 30000)
  it.each([
    ['make the one near this weekly', 'c0'],              // near: two neighbours (right and below) fit
    ['make the chart above it weekly', 'c1'],             // nothing above the top row
  ])('%s (clicked %s): no single neighbour → asked, nothing changes, whatever the plan', async (t, clicked) => {
    for (const plan of ['c0', 'c1', 'c2', 'c3']) {
      cleanup(); p = setupPanel()
      const { say, board: b } = mountOn(clicked)
      p.st.envelopes.push(planOn(plan))
      await say(t)
      expect(tfs(b), `plan on ${plan}`).toBe('DDDD')
    }
  }, 60000)
  it.each([
    ['make this ticker weekly', 'c2', 'c2'],                       // a bare pointer: the click
    ['alert me under 30 rsi, and make this chart weekly', 'c1', 'c1'],   // "under 30" is no relation to "this chart"
  ])('%s (clicked %s): no relation word, so the click is the chart meant', async (t, clicked, meant) => {
    const { say, board: b } = mountOn(clicked)
    p.st.envelopes.push(planOn(meant))
    await say(t)
    expect(tfOf(b, meant)).toBe('W')
  }, 30000)
  it('relativeChart reads the relation, not the noun: "under this candle" is no anchor', () => {
    const at = (ref, x, y) => ({ ref, cell: { x, y, w: 12, h: 10 } })
    const C = [at('c0', 0, 0), at('c1', 12, 0), at('c2', 0, 10), at('c3', 12, 10)]
    expect(relativeChart('draw a line under this candle', C, 'c0')).toBeNull()
    // a price or a drawing related to "it" is no chart relation (drawingFamily: "alert above it" is the line's alert)
    for (const t of ['alert above it', 'put a line under it', 'ping me when it goes below that']) expect(relativeChart(t, C, 'c0'), t).toBeNull()
    expect(relativeChart('the ticker under this', C, 'c0')?.hits.map(c => c.ref)).toEqual(['c2'])
    expect(relativeChart('whatever is adjacent to it', C, 'c0')?.hits.map(c => c.ref).sort()).toEqual(['c1', 'c2'])
  })
})

// AUDIT R5 (11-07): a relation is one chart reference among the sentence's others, read per clause. A NEGATED relation's chart is
// never touched; beside a clause pointing at the click, the click is the chart meant. An affirmative relation beside a pointer to
// the click is two references: asked, whatever the plan. Own phrasings (AUDIT's probes are separate).
describe('R5: negation and compound sentences around a relation', () => {
  it.each([
    ['switch this one to weekly but don\'t touch the chart under it', 'c0', 'c2'],
    ['make this ticker weekly without changing the chart to the right of it', 'c0', 'c1'],
    ['weekly on this chart; ignore the one beside it', 'c3', 'c2'],
  ])('%s (clicked %s): a plan on the click runs there; a plan on %s, the chart named to be left alone, never runs', async (t, clicked, spared) => {
    {
      const { say, board: b } = mountOn(clicked)
      p.st.envelopes.push(planOn(clicked))
      await say(t)
      expect(tfOf(b, clicked)).toBe('W')
      expect(tfOf(b, spared)).toBe('D')
    }
    cleanup(); p = setupPanel()
    {
      const { say, board: b } = mountOn(clicked)
      p.st.envelopes.push(planOn(spared))
      await say(t)
      expect(tfs(b)).toBe('DDDD')
    }
  }, 60000)
  it.each([
    ['leave the chart above this one alone', 'c2', 'c0'],
    ['everything stays, except the pane left of it', 'c1', 'c0'],
  ])('%s (clicked %s): a negated relation alone never makes %s a target', async (t, clicked, spared) => {
    const { say, board: b } = mountOn(clicked)
    p.st.envelopes.push(planOn(spared))
    await say(t)
    expect(tfs(b)).toBe('DDDD')
  }, 30000)
  it.each([
    ['make this one weekly and the one below it weekly too', 'c0'],
    ['set it weekly, then the graph right of it as well', 'c0'],
  ])('%s (clicked %s): two chart references, so one plan on either is asked about, nothing changes', async (t, clicked) => {
    for (const plan of ['c0', 'c1', 'c2']) {
      cleanup(); p = setupPanel()
      const { say, board: b } = mountOn(clicked)
      p.st.envelopes.push(planOn(plan))
      await say(t)
      expect(tfs(b), `plan on ${plan}`).toBe('DDDD')
    }
  }, 60000)
})

// pl-auto browser regression u-target-05/08 (BROWSER-MOCK-MODEL, 620c05604c): a NEGATED pointer ("except this one", "not this
// chart") had every op aimed onto the click. Negation governing the pointer EXCLUDES the clicked chart: never a target; a plan
// on the other charts runs there.
describe('a negated pointer excludes the click', () => {
  const planOnMany = (ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } })))
  it.each([
    ['weekly for all of them except this one', 'c3', ['c0', 'c1', 'c2'], 'WWWD'],
    ['every chart but this chart to weekly', 'c0', ['c1', 'c2', 'c3'], 'DWWW'],
    ['switch the others to weekly, not this one', 'c1', ['c0', 'c2', 'c3'], 'WDWW'],
  ])('%s (clicked %s): the plan on %j runs there; the click stays', async (t, clicked, plan, want) => {
    const { say, board: b } = mountOn(clicked)
    p.st.envelopes.push(planOnMany(plan))
    await say(t)
    expect(tfs(b)).toBe(want)
  }, 30000)
  it.each([
    ['weekly for all of them except this one', 'c3'],
    ['anything other than this chart goes weekly', 'c0'],
  ])('%s (clicked %s): NEGATIVE: a plan on the excluded click never runs', async (t, clicked) => {
    const { say, board: b } = mountOn(clicked)
    p.st.envelopes.push(planOn(clicked))
    await say(t)
    expect(tfs(b)).toBe('DDDD')
  }, 30000)
})
describe('a negated pointer on a board of two', () => {
  const TWO_W = [cell('a', 0, 0), cell('b', 12, 0)]
  it.each([['not this chart, the other one: weekly'], ['the other chart, not this one, to weekly']])('%s (clicked b): the plan on a runs there, b stays', async (t) => {
    const { say, board: b } = p.mount(TWO_W, { 'N:a': 'SPY', 'N:b': 'QQQ' }, { decorate: label })
    p.select('b')
    p.st.envelopes.push(planOn('a'))
    await say(t)
    expect(['a', 'b'].map(id => tfOf(b, id)).join('')).toBe('WD')
  }, 30000)
})

// pl-auto indicator-add-02 (BROWSER-MOCK-MODEL): "I want to see MACD under this chart" (TWO, left clicked) asked "Which chart do you
// mean?": "under this chart" places a PANE, not a chart. A relation word is a chart relation only when what it places is a chart;
// an indicator, a pane, a line, a level, volume placed above / below / under "this chart" binds to the click as a bare pointer does.
// Own phrasings; paired: the plan on the click runs, a plan on the other chart is asked about.
describe('a relation word that places an indicator, a pane or a line is not a chart relation', () => {
  const TWO_W = [cell('a', 0, 0), cell('b', 12, 0)]
  // indicator ops aim at the chart's indicatorEdits entry (the context lists one per chart, by its chart ref)
  const addOn = (id, defId) => (body) => {
    const e = (body.context.indicatorEdits || []).find(x => x.chart === `Chart (${id})`)
    return p.env('apply', [{ action: 'indicator.add', target: e.ref, args: { defId } }])
  }
  const rsiOn = (b, id) => (b.state.widgets.find(w => w.id === id).opts?.settings?.indicatorInstances || []).some(i => !i.deleted)
  it.each([
    ['put an RSI under this chart', 'rsi'],
    ['stick the stochastic below this one', 'stoch'],
    ['I want a MACD pane beneath this chart', 'macd'],
  ])('%s (clicked a): the plan on the click runs there', async (t, defId) => {
    const { say, board: b } = p.mount(TWO_W, { 'N:a': 'SPY', 'N:b': 'QQQ' }, { decorate: label })
    p.select('a')
    p.st.envelopes.push(addOn('a', defId))
    const out = await say(t)
    expect(rsiOn(b, 'a'), out).toBe(true)
    expect(rsiOn(b, 'b')).toBe(false)
  }, 30000)
  // a plan on the OTHER chart: "this chart" is a bare pointer here, so the audited rule applies (a true "this" moves the plan onto
  // the click, c5e2706425) — never the other chart, and never a "which chart?" for a pane placement
  it.each([['put an RSI under this chart', 'rsi'], ['stick the stochastic below this one', 'stoch']])('NEGATIVE %s (clicked a): a plan on the OTHER chart never lands there', async (t, defId) => {
    const { say, board: b } = p.mount(TWO_W, { 'N:a': 'SPY', 'N:b': 'QQQ' }, { decorate: label })
    p.select('a')
    p.st.envelopes.push(addOn('b', defId))
    const out = await say(t)
    expect(rsiOn(b, 'b')).toBe(false)
    expect(out).not.toMatch(/Which chart do you mean/)
  }, 30000)
  it('relativeChart: the placed thing decides', () => {
    const at = (ref, x, y) => ({ ref, cell: { x, y, w: 12, h: 10 } })
    const C = [at('c0', 0, 0), at('c1', 12, 0), at('c2', 0, 10), at('c3', 12, 10)]
    for (const t of ['MACD under this chart', 'show volume beneath this one', 'draw a line above this chart', 'an alert level below this chart', 'the rsi pane under this one'])
      expect(relativeChart(t, C, 'c0'), t).toBeNull()
    expect(relativeChart('the chart under this one', C, 'c0')?.hits.map(c => c.ref)).toEqual(['c2'])
  })
})

// pl-auto unseen5 (the same class, its phrasings are pl-auto's own held-out set and not copied here): indicators, volume, moving
// averages and price levels placed over / under / above "this chart / one / cell / the current price" are no chart relation;
// the chart controls stay chart relations.
describe('the placed thing decides, across indicators, volume, averages and levels (own phrasings)', () => {
  const at = (ref, x, y) => ({ ref, cell: { x, y, w: 12, h: 10 } })
  const C = [at('c0', 0, 0), at('c1', 12, 0), at('c2', 0, 10), at('c3', 12, 10)]
  it.each([
    'throw a stochastic beneath this cell', 'keltner channels over this one', 'hide the volume bars under this one',
    'turn off the averages over this chart', 'mark a level at 50 above the current price', 'an atr study under this cell please',
  ])('"%s" is no chart relation', (t) => expect(relativeChart(t, C, 'c0')).toBeNull())
  it.each([
    ['the cell below this one', 'c0', ['c2']], ['the one to the left of this one', 'c1', ['c0']], ['the chart above this cell', 'c3', ['c1']],
  ])('control "%s" (clicked %s) stays a chart relation → %j', (t, sel, want) => expect(relativeChart(t, C, sel)?.hits.map(c => c.ref)).toEqual(want))
})
