// app/src/components/chart/engine/__tests__/tableMergeCells.test.js
//
// ─── ⭐⭐ `table.merge_cells` — A RECTANGLE DRAWN AS ONE CELL ─────────────────
//
// The object reader listed `table.merge_cells` as unsupported: the header it
// merges was drawn one column wide and the covered addresses were dropped.
//
// ⚰️ MEASURED against TradingView (2026-09-28, NYSE:RDDT 1D):
// `momentum-volatility-scanner` writes `table.cell(dashboard, 0, 0, "📊 Scanner")`
// then `table.merge_cells(dashboard, 0, 0, 1, 0)`. The vendor records cell (0,0)
// with `colspan: 2` AND the covered cell (1,0) as a cell of its own with empty
// text — 12 cells, where we held 11.
// `docs/pine/vendor-harness/objects-triage-2026-09-28.md`, C16.
//
// Four layers, one case each: the reader carries it, the runtime holds the span
// and the covered cells, the render state keeps the span, and the DOM draws ONE
// element spanning the rectangle — never an element per covered address.
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { translatePine } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { layoutTables } from '../objectCanvas'
import { renderTables } from '../objectTableDom'

const LF = String.fromCharCode(10)
const P = (ops) => ({
  programVersion: 1, regs: [{ id: 't', family: 'table' }], colls: [], ops,
})
const K = (value) => ({ v: 'const', value })
const newTable = (extra = {}) => ({
  k: 'create', family: 'table', site: 's0', into: 't', once: true, when: null,
  props: { position: K('top_right'), columns: K(2), rows: K(3) }, ...extra,
})
const put = (col, row, text) => ({
  k: 'cell', target: { r: 'reg', id: 't' }, when: null, col: K(col), row: K(row),
  props: { text: K(text) },
})
const merge = (c0, r0, c1, r1) => ({
  k: 'mergecells', target: { r: 'reg', id: 't' }, when: null,
  col: K(c0), row: K(r0), col2: K(c1), row2: K(r1),
})
const run = (ops) => evaluateObjects(P(ops), { barCount: 2, readNode: () => NaN, readTime: (i) => i })
const cellsOf = (r) => r.live.find((o) => o.family === 'table').cells
  .map((c) => ({ at: `${c.col},${c.row}`, text: c.props.text ?? '', span: c.props.colspan || c.props.rowspan ? [c.props.colspan, c.props.rowspan] : undefined }))

describe('⭐ the reader CARRIES `table.merge_cells`', () => {
  it('as a `mergecells` op over the four addresses, and no longer as unsupported', () => {
    const t = translatePine([
      '//@version=5', 'indicator("t", overlay=true)',
      'var d = table.new(position.bottom_right, 2, 6)',
      'if barstate.islast',
      '    table.cell(d, 0, 0, "Scanner")',
      '    table.merge_cells(d, 0, 0, 1, 0)',
    ].join(LF), { strict: true })
    const m = (t.objects.ops || []).find((o) => o.k === 'mergecells')
    expect(m).toMatchObject({ col: K(0), row: K(0), col2: K(1), row2: K(0), lastBarOnly: true })
    expect(t.objectDiagnostics.unsupported).not.toContain('table.merge_cells')
  })
})

describe('⭐⭐ the runtime holds the SPAN and the COVERED cells', () => {
  it('the header spans two columns and the covered address is a cell of its own, empty', () => {
    const r = run([newTable(), put(0, 0, 'Scanner'), merge(0, 0, 1, 0), put(0, 1, 'State:'), put(1, 1, 'NEUTRAL')])
    expect(r.status).toBe('ok')
    expect(cellsOf(r)).toEqual([
      { at: '0,0', text: 'Scanner', span: [2, 1] },
      { at: '1,0', text: '', span: undefined },
      { at: '0,1', text: 'State:', span: undefined },
      { at: '1,1', text: 'NEUTRAL', span: undefined },
    ])
  })

  it('⛔ CONTROL — an inverted, a one-cell or an out-of-table rectangle merges NOTHING', () => {
    for (const bad of [merge(1, 0, 0, 0), merge(0, 0, 0, 0), merge(0, 0, 5, 0), merge(0, 0, 1, 9)]) {
      const r = run([newTable(), put(0, 0, 'x'), bad])
      expect(cellsOf(r), JSON.stringify(bad)).toEqual([{ at: '0,0', text: 'x', span: undefined }])
    }
  })
})

describe('⭐⭐ and the DOM draws ONE element spanning the rectangle', () => {
  it('a `colSpan` of 2 on the header, no element for the covered address, and the rows below aligned', () => {
    const r = run([newTable(), put(0, 0, 'Scanner'), merge(0, 0, 1, 0), put(0, 1, 'State:'), put(1, 1, 'NEUTRAL')])
    const state = toRenderState(r.live, { bars: [{ t: 0 }, { t: 1 }] })
    expect(state.tables[0].cells.map((c) => [c.col, c.row, c.colspan])).toEqual([[0, 0, 2], [1, 0, undefined], [0, 1, undefined], [1, 1, undefined]])
    const doc = new JSDOM('<!doctype html><div></div>').window.document
    const root = doc.createElement('div')
    renderTables(root, layoutTables(state), doc)
    const rows = [...root.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => [td.textContent, td.colSpan]))
    expect(rows).toEqual([[['Scanner', 2]], [['State:', 1], ['NEUTRAL', 1]]])
  })

  it('⛔ a covered address INSIDE a row gets no element — the cell after it keeps its column', () => {
    // A trailing covered cell is dropped as a trailing empty anyway, so this is
    // the case that can tell "spanned" from "an empty cell drawn beside it".
    const r = run([newTable({ props: { position: K('top_right'), columns: K(3), rows: K(2) } }),
      put(0, 0, 'Head'), merge(0, 0, 1, 0), put(2, 0, 'X'), put(0, 1, 'a'), put(1, 1, 'b'), put(2, 1, 'c')])
    const doc = new JSDOM('<!doctype html><div></div>').window.document
    const root = doc.createElement('div')
    renderTables(root, layoutTables(toRenderState(r.live, { bars: [{ t: 0 }, { t: 1 }] })), doc)
    const rows = [...root.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => [td.textContent, td.colSpan]))
    expect(rows).toEqual([[['Head', 2], ['X', 1]], [['a', 1], ['b', 1], ['c', 1]]])
  })

  it('⛔ CONTROL — without the merge, the header is one column wide beside an absent cell', () => {
    const r = run([newTable(), put(0, 0, 'Scanner'), put(0, 1, 'State:'), put(1, 1, 'NEUTRAL')])
    const doc = new JSDOM('<!doctype html><div></div>').window.document
    const root = doc.createElement('div')
    renderTables(root, layoutTables(toRenderState(r.live, { bars: [{ t: 0 }, { t: 1 }] })), doc)
    const rows = [...root.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => [td.textContent, td.colSpan]))
    expect(rows).toEqual([[['Scanner', 1]], [['State:', 1], ['NEUTRAL', 1]]])
  })
})
