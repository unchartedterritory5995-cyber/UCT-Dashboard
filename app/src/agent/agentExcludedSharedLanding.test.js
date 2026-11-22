// SAFETY (exclusions × every mutation family): ONE change can land on MORE than one chart — a drawing lives on its SYMBOL, so it
// shows on every chart of that symbol; a symbol change on a color-LINKED chart retargets every chart in its link group (the
// product's own symbol search does exactly that). The excluded-chart gate (spatialCheck.withoutExcludedCharts) used to check
// only the ONE chart a target snapshot names (its `chartRef`), so "…every chart except the top-right one" still changed the
// top-right chart whenever it shared the change's landing with a chart the plan did target. A chart the words exclude is never
// changed — by its own op, or by an op on a chart it is linked to / shares drawings with.
// Class-generated: every exclusion phrasing the reader places × every non-query drawing capability, and × chart.setSymbol on a
// linked chart; controls prove what does NOT share a landing (chart.setScale on a linked chart, an unlinked chart, another
// symbol's drawings) is untouched. LOCAL / SIMULATED (BROWSER-MOCK-MODEL): unit, the real capability registry, a scripted board.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability, getTargetKind, allCapabilityNames } from './capabilities'
import { withoutExcludedCharts, excludedCharts } from './spatialCheck'
import { buildDrawingSource, buildListViewSource } from './host'
import { publishListView } from '../pages/watchlist/watchlistViews'
import { chartsLandedOn, LINK_FOLLOWING } from './chartLanding'

registerBuiltins()

// 2×2: the top row is ONE link group (A) on SPY; the bottom row is two UNLINKED charts that both show NVDA (shared drawings)
const CELLS = { TL: [0, 0], TR: [12, 0], BL: [0, 10], BR: [12, 10] }
const POS = { TL: 'top-left', TR: 'top-right', BL: 'bottom-left', BR: 'bottom-right' }
const GROUP = { TL: 'A', TR: 'A', BL: 'N', BR: 'N' }
const SYM = { TL: 'SPY', TR: 'SPY', BL: 'NVDA', BR: 'NVDA' }
const board = (sel = null, over = {}) => {
  const charts = Object.keys(CELLS).map(ref => ({ ref, label: `Chart (${ref})`, position: POS[ref], symbol: (over.sym || SYM)[ref], drawSym: (over.sym || SYM)[ref],
    group: (over.group || GROUP)[ref], cell: { x: CELLS[ref][0], y: CELLS[ref][1], w: 12, h: 10 }, ...(ref === sel ? { selected: true } : {}) }))
  const src = { list: () => charts, read: (r) => charts.find(c => c.ref === r) || null, selected: () => sel }
  const store = { peekDrawings: () => [], getActiveTracingId: () => null }
  return { charts: src, drawings: buildDrawingSource(src, store) }
}
const deps = (host) => ({ host, getCapability, getTargetKind })
const gate = (ops, text, host) => withoutExcludedCharts(ops, [text], deps(host))

// exclusion phrasings for ONE chart (by position) — only those the reader PLACES on this board are generated, so a failure below
// is the gate's, never the reader's (the floor at the end keeps that set from shrinking unseen)
const EXCLUDE = (pos) => [
  `do it on every chart except the ${pos} one`,
  `all of them except the ${pos} chart`,
  `every chart but the ${pos} one`,
  `everything apart from the ${pos} chart`,
  `all charts, not the ${pos} one`,
  `all charts excluding the ${pos} chart`,
  `every chart other than the ${pos} one`,
  `all of them but leave the ${pos} chart alone`,
]
const placed = (text, host, ref) => excludedCharts(text, host.charts.list(), host.charts.selected()).has(ref)
const PLACED = (pos, ref) => EXCLUDE(pos).filter(t => placed(t, board(), ref))

const DRAWING_CHANGES = () => allCapabilityNames().filter(n => getCapability(n)?.target === 'drawing' && !getCapability(n)?.query)
const switchOps = (targets, sym = 'AMD') => targets.map(t => ({ action: 'chart.setSymbol', target: t, args: { symbol: sym } }))

describe('the class is real: the gate sees every chart a change lands on', () => {
  it('the drawing family and the link-following family are both registered (the generated rows are not empty)', () => {
    expect(DRAWING_CHANGES().length).toBeGreaterThan(5)
    expect([...LINK_FOLLOWING]).toContain('chart.setSymbol')
    for (const a of LINK_FOLLOWING) expect(getCapability(a), a).toBeTruthy()
  })
  it('chartsLandedOn: a drawing lands on every chart of its symbol; a linked symbol change on its whole group; anything else on its own chart', () => {
    const host = board()
    const kD = getTargetKind('drawing'), kC = getTargetKind('chart')
    const snapD = kD.list(host).find(s => s.ref === 'NVDA')
    expect([...chartsLandedOn(getCapability(DRAWING_CHANGES()[0]), kD, snapD, host.charts.list())].sort()).toEqual(['BL', 'BR'])
    const tl = kC.list(host).find(s => s.ref === 'TL')
    expect([...chartsLandedOn(getCapability('chart.setSymbol'), kC, tl, host.charts.list())].sort()).toEqual(['TL', 'TR'])
    expect([...chartsLandedOn(getCapability('chart.setScale'), kC, tl, host.charts.list())]).toEqual(['TL'])
    const bl = kC.list(host).find(s => s.ref === 'BL')
    expect([...chartsLandedOn(getCapability('chart.setSymbol'), kC, bl, host.charts.list())]).toEqual(['BL'])
  })
})

// ── a drawing on a symbol two charts show: excluding the chart that is NOT its representative (the clicked / first one) ──
const DRAW_ROWS = DRAWING_CHANGES().flatMap(action => PLACED('bottom-right', 'BR').map(text => [action, text]))
describe('drawings are shared by symbol: a drawing change never reaches an excluded chart that shows the same symbol', () => {
  it.each(DRAW_ROWS)('%s — "%s" (BR excluded; the NVDA drawings also show on BR)', (action, text) => {
    const g = gate([{ action, target: 'NVDA', args: {} }], text, board())
    expect(g.dropped, `${action} on the NVDA drawings would show on the excluded BR chart`).toBe(1)
    expect(g.ops).toEqual([])
  })
  it.each(DRAWING_CHANGES())('%s — clicked TL (SPY), "…except the bottom-right one": the NVDA drawings still reach BR → dropped', (action) => {
    const g = gate([{ action, target: 'NVDA', args: {} }], 'do it on every chart except the bottom-right one', board('TL'))
    expect(g.dropped).toBe(1)
  })
  it.each(DRAWING_CHANGES())('control: %s — clicked BL, "leave this one alone": the clicked chart carries the NVDA drawings → dropped', (action) => {
    const g = gate([{ action, target: 'NVDA', args: {} }], 'draw on every chart but leave this one alone', board('BL'))
    expect(g.dropped).toBe(1)
  })
  it.each(DRAWING_CHANGES())('control: %s on the SPY drawings with BR excluded passes untouched (SPY is not on BR)', (action) => {
    const ops = [{ action, target: 'SPY', args: {} }]
    expect(gate(ops, EXCLUDE('bottom-right')[0], board())).toEqual({ ops, dropped: 0 })
  })
  it.each(DRAWING_CHANGES())('control: %s on the NVDA drawings with BR on its OWN symbol passes untouched', (action) => {
    const ops = [{ action, target: 'NVDA', args: {} }]
    const host = board(null, { sym: { TL: 'SPY', TR: 'SPY', BL: 'NVDA', BR: 'AMD' } })
    expect(gate(ops, EXCLUDE('bottom-right')[0], host)).toEqual({ ops, dropped: 0 })
  })
})

// ── a symbol change on a color-linked chart: the linked chart follows, so it is a change to the excluded chart too ──
const LINK_ROWS = PLACED('top-right', 'TR').map(text => [text])
describe('a symbol change on a linked chart never retargets an excluded chart in its link group', () => {
  it.each(LINK_ROWS)('"%s" → AMD: TL is linked to the excluded TR, so TL\'s switch is dropped; BL and BR run', (text) => {
    const host = board()
    const g = gate(switchOps(['TL', 'BL', 'BR']), text, host)
    expect(g.ops.map(o => o.target), 'TL is linked to TR: switching it switches TR').toEqual(['BL', 'BR'])
    expect(g.dropped).toBe(1)
    // idempotent: the gated plan passes unchanged (an approved card built behind the gate is never refused)
    expect(gate(g.ops, text, host)).toEqual({ ops: g.ops, dropped: 0 })
  })
  it('clicked TR, "switch them to AMD but leave this one alone": TL (linked to the click) is not switched', () => {
    expect(gate(switchOps(['TL', 'BL', 'BR']), 'switch them to AMD but leave this one alone', board('TR')).ops.map(o => o.target)).toEqual(['BL', 'BR'])
  })
  it.each(LINK_ROWS)('control: "%s" with the top row UNLINKED — TL\'s switch runs (it reaches no other chart)', (text) => {
    const ops = switchOps(['TL', 'BL', 'BR'])
    expect(gate(ops, text, board(null, { group: { TL: 'N', TR: 'N', BL: 'N', BR: 'N' } }))).toEqual({ ops, dropped: 0 })
  })
  it.each(LINK_ROWS)('control: "%s" — a change that does NOT follow the link (log scale) still runs on the linked TL', (text) => {
    const ops = ['TL', 'BL', 'BR'].map(t => ({ action: 'chart.setScale', target: t, args: { scale: 'log' } }))
    expect(gate(ops, text, board())).toEqual({ ops, dropped: 0 })
  })
  it('control: no exclusion in the words → a linked switch runs as planned', () => {
    const ops = switchOps(['TL'])
    expect(gate(ops, 'switch the top-left chart to AMD', board())).toEqual({ ops, dropped: 0 })
  })
  it('control: the excluded chart in ANOTHER link group is not reached by a switch in this one', () => {
    const ops = switchOps(['TL'])
    const host = board(null, { group: { TL: 'A', TR: 'A', BL: 'B', BR: 'B' } })
    expect(gate(ops, EXCLUDE('bottom-right')[0], host)).toEqual({ ops, dropped: 0 })
  })
})

describe('the placed-phrasing floor (the generated rows really exercise the gate)', () => {
  it('the exclusion phrasings the reader places on this board stay at least 7 of 8 per chart', () => {
    expect(PLACED('top-right', 'TR').length).toBeGreaterThanOrEqual(7)
    expect(PLACED('bottom-right', 'BR').length).toBeGreaterThanOrEqual(7)
  })
})

describe('LINK_FOLLOWING rail: every chart change that follows the link group is declared', () => {
  it('a chart-target capability whose summary says linked widgets follow is listed (and every listed one says so)', () => {
    const says = (n) => /\blinked\b[^.]*\bfollow/i.test(getCapability(n)?.summary || '')
    const chartCaps = allCapabilityNames().filter(n => getCapability(n)?.target === 'chart' && !getCapability(n)?.query)
    expect(chartCaps.filter(says).filter(n => !LINK_FOLLOWING.has(n))).toEqual([])
    for (const n of LINK_FOLLOWING) expect(says(n), n).toBe(true)
  })
})

// ── (AUDIT H1797-1) a link-following change whose TARGET is not a chart: a Watchlist widget's arrow step moves its linked
// chart. The list view is read through the REAL host source (host.buildListViewSource over a published widget view), so the
// link group the gate reads is the one the board draws.
const listBoard = (listColor, sel = null) => {
  const host = board(sel)
  const widgets = [...host.charts.list().map(c => ({ id: c.ref, type: 'chart', color: c.group === 'N' ? 'N' : c.group, x: c.cell.x, y: c.cell.y, w: 12, h: 10 })),
    { id: 'WL', type: 'watchlist', color: listColor, x: 24, y: 0, w: 6, h: 20, opts: { watchKey: 'user:1', watchName: 'Momentum' } }]
  const live = { name: 'Momentum', rows: () => ['SPY', 'AMD', 'MU'], cfg: {}, sort: null, columns: [], fixedColumns: [], persisted: true, selected: 'SPY', active: true, saveCols: () => {}, select: () => {} }
  const off = publishListView({ type: 'watchlist', color: listColor, key: 'user:1' }, () => live)
  return { host: { ...host, listViews: buildListViewSource({ getWidgets: () => widgets }) }, off }
}
const LIST_ROWS = PLACED('top-right', 'TR').flatMap(text => ['next', 'previous', 'first', 'last'].map(d => [text, d]))
describe('a list widget linked to an excluded chart never steps it (watchlist.step: "the linked chart follows")', () => {
  it.each(LIST_ROWS)('"%s" — watchlist.step %s on a list in link group A (TL + TR): dropped', (text, direction) => {
    const { host, off } = listBoard('A')
    try {
      const ref = getTargetKind('listView').list(host)[0]?.ref
      expect(ref, 'the list view is a target').toBeTruthy()
      const g = gate([{ action: 'watchlist.step', target: ref, args: { direction, by: null } }], text, host)
      expect(g.dropped, 'stepping the list moves TR, which the words exclude').toBe(1)
    } finally { off() }
  })
  it.each(LIST_ROWS)('control: "%s" — watchlist.step %s on an UNLINKED list still acts', (text, direction) => {
    const { host, off } = listBoard('N')
    try {
      const ref = getTargetKind('listView').list(host)[0]?.ref
      const ops = [{ action: 'watchlist.step', target: ref, args: { direction, by: null } }]
      expect(gate(ops, text, host)).toEqual({ ops, dropped: 0 })
    } finally { off() }
  })
  it('control: a list linked to group A with the excluded chart in the bottom row (no A chart excluded) still acts', () => {
    const { host, off } = listBoard('A')
    try {
      const ops = [{ action: 'watchlist.step', target: getTargetKind('listView').list(host)[0].ref, args: { direction: 'next', by: null } }]
      expect(gate(ops, EXCLUDE('bottom-right')[0], host)).toEqual({ ops, dropped: 0 })
    } finally { off() }
  })
})

// ── (AUDIT H1797-1 item 3) a landing that cannot be read FAILS CLOSED when the words exclude a chart ──
describe('an unreadable landing is never assumed safe', () => {
  const throwingKind = { name: 'probe', list: () => [{ ref: 'p1', chartRef: 'TL' }], sharedBy: () => { throw new Error('unreadable') } }
  const probeDeps = (host) => ({ host, getCapability: (a) => (a === 'probe.change' ? { name: 'probe.change', target: 'probe' } : getCapability(a)), getTargetKind: (k) => (k === 'probe' ? throwingKind : getTargetKind(k)) })
  it('a kind whose sharedBy throws: dropped when the words exclude a chart', () => {
    const g = withoutExcludedCharts([{ action: 'probe.change', target: 'p1', args: {} }], [EXCLUDE('bottom-right')[0]], probeDeps(board()))
    expect(g.dropped).toBe(1)
  })
  it('control: the same kind with no exclusion in the words runs', () => {
    const ops = [{ action: 'probe.change', target: 'p1', args: {} }]
    expect(withoutExcludedCharts(ops, ['change the top-left chart'], probeDeps(board()))).toEqual({ ops, dropped: 0 })
  })
  it('a link-following action on a snapshot that reports neither a chart nor a link group: dropped (its landing is unknown)', () => {
    const blind = { name: 'blind', list: () => [{ ref: 'b1' }] }
    const d = { host: board(), getCapability: (a) => (a === 'blind.step' ? { name: 'blind.step', target: 'blind' } : getCapability(a)), getTargetKind: (k) => (k === 'blind' ? blind : getTargetKind(k)) }
    LINK_FOLLOWING.add('blind.step')
    try {
      expect(withoutExcludedCharts([{ action: 'blind.step', target: 'b1', args: {} }], [EXCLUDE('top-right')[0]], d).dropped).toBe(1)
    } finally { LINK_FOLLOWING.delete('blind.step') }
  })
  it('chartsLandedOn marks the unreadable landing', () => {
    expect(chartsLandedOn({ name: 'probe.change' }, throwingKind, { ref: 'p1', chartRef: 'TL' }, board().charts.list()).unknown).toBe(true)
  })
})

// ── (AUDIT H1797-1 item 2) the rail over EVERY capability: words that say a change follows a link must be declared ──
// An exemption names why the change reaches no OTHER widget of a link group.
const LINK_EXEMPT = {
  'widget.setLink': 'recolors the NAMED widget only: it takes the group\'s symbol; no other widget of either group changes',
  'chart.linkTab': 'recolors the NAMED chart tab only: it takes the group\'s symbol; no other widget of either group changes',
  'chart.addTab': 'adds a tab to the NAMED chart widget, following that widget\'s own symbol; no other widget changes',
}
describe('LINK_FOLLOWING rail over every capability', () => {
  const FOLLOWS = /\blink(?:ed)?\b[^.]*\bfollows?\b|\bfollows?\b[^.]*\blink(?:ed)?\b|\bsame colou?r\b[^.]*\bfollow/i
  const says = (n) => FOLLOWS.test(`${getCapability(n)?.summary || ''} ${getCapability(n)?.hints || ''}`)
  it('every capability whose summary or hints say a link follows is in LINK_FOLLOWING or reasonably exempt', () => {
    const hits = allCapabilityNames().filter(n => !getCapability(n)?.query && says(n))
    expect(hits).toEqual(expect.arrayContaining(['chart.setSymbol', 'watchlist.step']))
    expect(hits.filter(n => !LINK_FOLLOWING.has(n) && !LINK_EXEMPT[n])).toEqual([])
  })
  it('every LINK_FOLLOWING action and every exemption is a registered capability that says so', () => {
    for (const n of [...LINK_FOLLOWING, ...Object.keys(LINK_EXEMPT)]) { expect(getCapability(n), n).toBeTruthy(); expect(says(n), n).toBe(true) }
    expect(Object.keys(LINK_EXEMPT).filter(n => LINK_FOLLOWING.has(n))).toEqual([])
  })
})
