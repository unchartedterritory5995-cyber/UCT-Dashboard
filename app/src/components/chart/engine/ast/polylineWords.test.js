// app/src/components/chart/engine/ast/polylineWords.test.js
//
// ─── ⭐ e98 (polyline words) — A POLYLINE THIS CHART DOES NOT DRAW IS NAMED AS THE AUTHOR WROTE IT ──────────────────
//
// 1. The drawing note read "This script uses `polyline.new.*`", a name no script writes: `assessObjectLoss` appends
//    `.*` to every `outOfScope` entry, and the reader records an out-of-scope family both as its namespace
//    (`polyline`, a declaration) and as a call (`polyline.new`). `objectLoss.readerNamesShown` shows a namespace as
//    `<ns>.*`, a call as itself, and no call of a namespace already shown whole. Display only.
// 2. A script with no plot, no alert condition and no drawing step carried, that writes a polyline, was refused
//    `pine:no-output` ("offers no plot and no alert condition"), naming nothing it wrote. The guard is unchanged; the
//    sentence now says it draws polylines, which this chart does not draw yet (`pine.js::noOutputSentence`).
//
// Production lane (the door's host lane): no env switch is read here.
import { describe, it, expect } from 'vitest'
import { translatePine, REFUSALS, POLYLINE_NO_OUTPUT_CLAUSE, writesPolyline } from './pine.js'
import { readerNamesShown, assessObjectLoss, objectLossNote } from './objectLoss.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const v6 = (body) => `//@version=6\nindicator("e98 polyline words", overlay = true)\n${body}`

// a plot, and a polyline written at the call site
const PLOT_AND_POLYLINE = v6([
  'if barstate.islast',
  '    pts = array.new<chart.point>()',
  '    for i = 0 to 9',
  '        pts.push(chart.point.from_index(bar_index - i, close[i]))',
  '    polyline.new(pts, line_color = color.red, line_width = 2)',
  'plot(close)',
].join('\n'))

// a plot, and a polyline held in a `var` and deleted: the reader records the namespace AND the calls
const PLOT_AND_HELD_POLYLINE = v6([
  'var polyline pl = na',
  'if barstate.islast',
  '    pl.delete()',
  '    pts = array.from(chart.point.from_index(bar_index - 10, low), chart.point.from_index(bar_index, high))',
  '    pl := polyline.new(pts)',
  'plot(close)',
].join('\n'))

// no plot, no alert condition: the polyline is the drawing
const ONLY_POLYLINE = v6([
  'var polyline pl = na',
  'if barstate.islast',
  '    pl.delete()',
  '    pts = array.from(chart.point.from_index(bar_index - 10, low), chart.point.from_index(bar_index - 5, high), chart.point.from_index(bar_index, low))',
  '    pl := polyline.new(pts, closed = true, fill_color = color.new(color.blue, 80))',
].join('\n'))

const strict = (src) => translatePine(src, { strict: true })
const drawingNote = (t) => {
  const n = objectLossNote(assessObjectLoss(t))
  return n ? n.note : ''
}

describe('e98 — readerNamesShown', () => {
  it('a call keeps its own name; a namespace reads `<ns>.*`', () => {
    expect(readerNamesShown(['polyline.new.*'])).toEqual(['polyline.new'])
    expect(readerNamesShown(['polyline.*'])).toEqual(['polyline.*'])
  })
  it('a call of a namespace shown whole is not listed twice', () => {
    expect(readerNamesShown(['polyline.*', 'polyline.delete.*', 'polyline.new.*'])).toEqual(['polyline.*'])
  })
  it('CONTROL: names that are not `.*` entries pass through, sorted', () => {
    expect(readerNamesShown(['line.set_style', 'box.set_text_wrap'])).toEqual(['box.set_text_wrap', 'line.set_style'])
    expect(readerNamesShown(['polyline.*', 'line.new'])).toEqual(['line.new', 'polyline.*'])
  })
})

describe('e98 — the drawing note names a polyline as the script writes it', () => {
  it('a plot and a polyline: "uses `polyline.new`", never `polyline.new.*`', () => {
    const t = strict(PLOT_AND_POLYLINE)
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.objectDiagnostics.outOfScope, 'non-vacuous: the reader recorded the call').toEqual(['polyline.new'])
    const note = drawingNote(t)
    expect(note).toBe("This script uses `polyline.new`, which this chart doesn't draw yet, so what it draws is incomplete.")
  })

  it('a held, deleted polyline: the namespace once, as `polyline.*`', () => {
    const t = strict(PLOT_AND_HELD_POLYLINE)
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.objectDiagnostics.outOfScope).toEqual(expect.arrayContaining(['polyline']))
    const note = drawingNote(t)
    expect(note).toContain('`polyline.*`')
    expect(note).not.toMatch(/`polyline\.[a-z_]+\.\*`/)
    expect(note).not.toContain('`polyline.delete`')
  })

  it('the classification is unchanged: readerNames still carries the raw `.*` entries', () => {
    const loss = assessObjectLoss(strict(PLOT_AND_POLYLINE))
    expect(loss.readerNames).toEqual(['polyline.new.*'])
  })

  it('the member door carries the same note', () => {
    const r = memberPaneDefinition({ source: PLOT_AND_POLYLINE })
    expect(r.ok, r.reason).toBe(true)
    const notes = (r.notes || []).map((n) => String(n.note || n))
    expect(notes).toContain("This script uses `polyline.new`, which this chart doesn't draw yet, so what it draws is incomplete.")
    expect(notes.join('\n')).not.toContain('.new.*')
  }, 60000)
})

describe('e98 — `pine:no-output` names the polylines', () => {
  it('only a polyline: the guard is unchanged and the sentence says it draws polylines', () => {
    const t = strict(ONLY_POLYLINE)
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:no-output')
    expect(writesPolyline(t.objectDiagnostics), 'non-vacuous').toBe(true)
    expect(t.refusal.message).toBe(`${REFUSALS['pine:no-output']}: ${POLYLINE_NO_OUTPUT_CLAUSE}`)
  })

  it('the member door says so', () => {
    const r = memberPaneDefinition({ source: ONLY_POLYLINE })
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:no-output')
    expect(r.reason).toContain(POLYLINE_NO_OUTPUT_CLAUSE)
  }, 60000)

  it('CONTROL: no plot and no polyline keeps the bare sentence', () => {
    const t = strict(v6('x = close * 2'))
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:no-output')
    expect(t.refusal.message).toBe(REFUSALS['pine:no-output'])
  })

  it('CONTROL: a polyline beside a drawing that IS carried is not a no-output refusal', () => {
    const t = strict(v6([
      'var polyline pl = na',
      'if barstate.islast',
      '    pl := polyline.new(array.from(chart.point.from_index(bar_index - 3, low), chart.point.from_index(bar_index, high)))',
      '    line.new(bar_index - 5, close, bar_index, close)',
    ].join('\n')))
    expect(t.refusal ? t.refusal.guard : null).not.toBe('pine:no-output')
    expect(JSON.stringify(t.refusal || {})).not.toContain(POLYLINE_NO_OUTPUT_CLAUSE)
  })

  it('CONTROL: `pine:objects-only` (the screener lane, a carried line beside a polyline) keeps its own sentence', () => {
    const t = translatePine(v6([
      'var polyline pl = na',
      'if barstate.islast',
      '    pl := polyline.new(array.from(chart.point.from_index(bar_index - 3, low), chart.point.from_index(bar_index, high)))',
      '    line.new(bar_index - 5, close, bar_index, close)',
    ].join('\n')))
    expect(writesPolyline(t.objectDiagnostics), 'non-vacuous: the polyline is recorded').toBe(true)
    expect(t.refusal.guard).toBe('pine:objects-only')
    expect(t.refusal.message).toBe(REFUSALS['pine:objects-only'])
  })

  it('writesPolyline reads the namespace and the call, nothing else', () => {
    expect(writesPolyline({ outOfScope: ['polyline'] })).toBe(true)
    expect(writesPolyline({ outOfScope: ['polyline.delete'] })).toBe(true)
    expect(writesPolyline({ outOfScope: [] })).toBe(false)
    expect(writesPolyline({ outOfScope: ['polylines'] })).toBe(false)
    expect(writesPolyline(null)).toBe(false)
  })
})
