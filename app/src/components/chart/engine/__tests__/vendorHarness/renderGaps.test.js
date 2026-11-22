// app/src/components/chart/engine/__tests__/vendorHarness/renderGaps.test.js
//
// The render-gap split (`renderGaps.js`): the render state's own `unplaced`, divided into the COORDINATE class
// and the WITHHELD-TEXT class by asking the render state twice, never by restating its rules.
import { describe, it, expect } from 'vitest'
import { toRenderState } from '../../objectRenderState'
import { unplacedByClass, renderGapRow, withTextsPlaced, UNPLACED_FAMILIES } from './renderGaps'

// a DAILY series, as a member's daily chart holds it (dates, not instants)
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']
const bars = DAYS.map((t) => ({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }))
const frame = { bars, tf: 'D' }
// an `xloc.bar_time` x (Pine milliseconds) 15.3 days past the last bar's open: a finite time off the session
// grid, which no bar of this chart places (reverse-stochastic's label, RDDT 1D)
const OFF_GRID = Date.parse('2026-11-13T14:30:00Z') + 15.3 * 86_400_000

const label = (id, x, xloc, text) => ({ family: 'label', id, props: { x, y: 1, xloc, yloc: 'price', text } })
const live = [
  label(1, 3, 'bar_index', 'drawn'),
  label(2, OFF_GRID, 'bar_time', 'a coordinate'),
  label(3, 2, 'bar_index', null),                       // a withheld text
  label(4, OFF_GRID, 'bar_time', null),                // both: the coordinate decides (the render state's order)
  { family: 'box', id: 5, props: { left: 1, right: 4, top: 5, bottom: 3, xloc: 'bar_index', text: null } },
  { family: 'line', id: 6, props: { x1: OFF_GRID, x2: OFF_GRID + 86_400_000, y1: 1, y2: 2, xloc: 'bar_time' } },
  { family: 'line', id: 7, props: { x1: 1, x2: 5, y1: 1, y2: 2, xloc: 'bar_index' } },
  { family: 'linefill', id: 8, props: { line1: { __ref: 6 }, line2: { __ref: 7 } } },
  { family: 'table', id: 9, props: { position: 'top_right' },
    cells: [{ col: 0, row: 0, props: { text: 'drawn' } }, { col: 1, row: 0, props: { text: null } }] },
]

describe('render gaps: the render state split by reason class', () => {
  it('names each unplaced drawing by its class, and the two classes sum to the render state\'s count', () => {
    const { state, coordinate, textWithheld } = unplacedByClass(live, frame)
    expect(coordinate).toEqual({ label: 2, line: 1, linefill: 1 })
    expect(textWithheld).toEqual({ box: 1, cell: 1, label: 1 })
    for (const f of UNPLACED_FAMILIES) {
      expect((coordinate[f] || 0) + (textWithheld[f] || 0), f).toBe(state.unplaced[f])
    }
    // the authority itself, untouched: the same state the harness builds
    expect(state).toEqual(toRenderState(live, frame))
  })

  it('CONTROL: a live set that places everything has no gap of either class', () => {
    const placed = withTextsPlaced(live.filter((o) => ![2, 4, 6, 8].includes(o.id)))
    const { coordinate, textWithheld } = unplacedByClass(placed, frame)
    expect(coordinate).toEqual({})
    expect(textWithheld).toEqual({})
  })

  it('placing the texts touches only the texts', () => {
    const placed = withTextsPlaced(live)
    expect(placed.map((o) => o.id)).toEqual(live.map((o) => o.id))
    expect(placed[2].props).toEqual({ ...live[2].props, text: '' })
    expect(placed[1].props).toBe(live[1].props)
    expect(placed[8].cells[1].props.text).toBe('')
    expect(live[2].props.text).toBe(null)                                  // the input is not mutated
  })
})

describe('render gaps: one capture\'s row', () => {
  const report = (extra) => ({ ok: true, objects: { drawsObjects: true, ok: true, held: live, xFrame: { bars, tf: 'D' }, ...extra } })

  it('a measured capture: keys and counts only, the withheld-text kind as the run named it', () => {
    const { row, recomputed } = renderGapRow(report({ lane: 'runtime', textsWithheldWhy: { 'format:tie': 2 } }))
    expect(row).toEqual({ status: 'measured', lane: 'runtime', held: live.length,
      coordinate: { label: 2, line: 1, linefill: 1 }, textWithheld: { box: 1, cell: 1, label: 1 }, textKinds: ['format:tie'] })
    expect(recomputed.unplaced).toEqual(toRenderState(live, frame).unplaced)
    expect(JSON.stringify(row)).not.toMatch(/drawn|a coordinate/)           // no text of the script leaves
  })

  it('a withheld text the run did not name is `unnamed`, never guessed', () => {
    expect(renderGapRow(report({})).row.textKinds).toEqual(['unnamed'])
  })

  it('families withheld by name are a gap of their own, keyed by guard', () => {
    const { row } = renderGapRow(report({ withheldFamilies: ['box', 'line'], withheldGuards: ['objects:collector'] }))
    expect(row.withheld).toEqual({ 'objects:collector': 2 })
    const whole = renderGapRow({ ok: true, objects: { drawsObjects: true, ok: false, withheld: 'runtime:objects-withheld' } }).row
    expect(whole).toEqual({ status: 'measured', lane: 'host', held: 0, withheld: { 'runtime:objects-withheld': 1 } })
  })

  it('nothing measured where nothing ran, and a script without drawings is measured with none', () => {
    expect(renderGapRow({ ok: false, refusal: 'member door refused (pine:x): …' }).row).toEqual({ status: 'refused' })
    expect(renderGapRow({ ok: true, objects: { drawsObjects: false } }).row).toEqual({ status: 'measured', held: 0 })
    expect(renderGapRow({ ok: true, objects: { drawsObjects: true, ok: false, reason: 'the object lane threw: x' } }).row)
      .toEqual({ status: 'objects-failed', lane: 'host' })
  })
})
