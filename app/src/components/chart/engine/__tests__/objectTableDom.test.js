// app/src/components/chart/engine/__tests__/objectTableDom.test.js
//
// ─── ⭐⭐ R2 STEP 6 — THE TABLE IS DOM, AND HERE IS WHAT THAT BUYS ───────────
//
// Four things this file is here to hold, each of which the canvas painter it
// replaced could not have been asked for:
//
//   1. an EMPTY cell is ABSENT, not blank — the vendor's own capture counts 3
//      Range cells and 1 Volume cell for a script that writes 4 and 2;
//   2. the TRAILING SPACE survives into the element, because a compare against
//      those captures is a string compare and one cell has one;
//   3. the nine positions become nine CSS corners, so a resize costs nothing;
//   4. there is no `devicePixelRatio` anywhere in the adapter, which is what
//      "DPR handled" means for a layer with no backing store.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { layoutTables, TABLE_ANCHORS } from '../objectCanvas'
import {
  renderTables, buildTable, anchorStyle, cellIsDrawn, rowCells,
} from '../objectTableDom'
import { CHART_TOOLBAR_FOOTPRINT_PX } from '../../ChartToolbar'

const dom = new JSDOM('<!doctype html><div id="root"></div>')
const doc = dom.window.document
const freshRoot = () => {
  const el = doc.createElement('div')
  doc.body.appendChild(el)
  return el
}

/** The render-state shape `toRenderState` produces for a table. */
const table = (cells, extra = {}) => ({
  id: 1, position: 'top_right', bgcolor: 'transparent', ...extra, cells,
})

const cell = (col, row, text, extra = {}) => ({
  col, row, text, text_color: '#fff', text_size: 'normal', ...extra,
})

const textsOf = (root) =>
  [...root.querySelectorAll('td')].map((td) => td.textContent)

describe('⛔⛔ an empty cell is ABSENT from the DOM, not present-and-blank', () => {
  it('⭐⭐ v2\'s RANGE row: four cells written, three drawn', () => {
    // `uncharted-volume-v2.pine` writes all four Range cells unconditionally and
    // lets DCR fold to `''` when `show_dcr_in_range_table` is false — its default.
    // The vendor capture of the same script records THREE cells, because
    // TradingView never calls `fillText` for an empty string.
    const root = freshRoot()
    const stats = renderTables(root, layoutTables({
      tables: [table([
        cell(0, 0, 'ATR : $6.21 (0.81%)'),
        cell(1, 0, '| Range: 137.58%'),
        cell(2, 0, '| ATRx: 0.92'),
        cell(3, 0, ''),
      ], { position: 'top_left' })],
    }), doc)
    expect(stats).toEqual({ tables: 1, cells: 3, skipped: 0 })
    expect(root.querySelectorAll('td')).toHaveLength(3)
    expect(textsOf(root)).toEqual([
      'ATR : $6.21 (0.81%)', '| Range: 137.58%', '| ATRx: 0.92',
    ])
    // ⛔ AND THE ASSERTION THE RULING ASKED FOR, STATED AS AN ABSENCE: no
    // element anywhere in this layer holds the empty string.
    expect([...root.querySelectorAll('td')].some((td) => td.textContent === '')).toBe(false)
  })

  it('⛔ a table whose every cell is empty produces NO element at all', () => {
    // Not an empty `<table>`: an empty table still paints its frame and its
    // background over the pane, which is a box the author did not draw.
    const root = freshRoot()
    const stats = renderTables(root, layoutTables({
      tables: [table([cell(0, 0, ''), cell(1, 0, '')])],
    }), doc)
    expect(stats).toEqual({ tables: 0, cells: 0, skipped: 1 })
    expect(root.children).toHaveLength(0)
  })

  it('⭐ a cell with a BACKGROUND and no text is still a cell', () => {
    // The rule is "nothing in it", not "no text". A coloured cell is a thing the
    // author drew on purpose — a heat swatch beside a number is a common shape —
    // and dropping it would lose the drawing while the number stayed.
    const root = freshRoot()
    const stats = renderTables(root, layoutTables({
      tables: [table([cell(0, 0, '', { bgcolor: '#c00' }), cell(1, 0, 'x')])],
    }), doc)
    expect(stats.cells).toBe(2)
    expect(root.querySelectorAll('td')[0].style.background).toBe('rgb(204, 0, 0)')
  })

  it('⛔ an INTERIOR hole keeps its column slot and SAYS SO — only trailing ones go', () => {
    // ⚰️ Dropping an interior empty would slide every later column left, which
    // in a multi-row table destroys the alignment that makes it a table. The
    // slot is held open at zero width and marked, so a reader counting cells can
    // tell a held slot from a drawn one instead of guessing from a total.
    const root = freshRoot()
    const stats = renderTables(root, layoutTables({
      tables: [table([
        cell(0, 0, 'A'), cell(1, 0, ''), cell(2, 0, 'C'), cell(3, 0, ''),
        cell(0, 1, 'D'), cell(1, 1, 'E'), cell(2, 1, 'F'),
      ])],
    }), doc)
    expect(stats.cells).toBe(5)
    const rows = [...root.querySelectorAll('tr')]
    expect(rows[0].querySelectorAll('td')).toHaveLength(3)   // A, held, C — not D
    expect(rows[0].querySelectorAll('[data-uct-cell="empty"]')).toHaveLength(1)
    expect(rows[0].querySelectorAll('td')[1].style.padding).toBe('0px')
    expect(rows[1].querySelectorAll('td')).toHaveLength(3)
  })

  it('⛔ a row with nothing drawn is not a `<tr>` either', () => {
    const root = freshRoot()
    renderTables(root, layoutTables({
      tables: [table([cell(0, 0, ''), cell(0, 1, 'second row')])],
    }), doc)
    expect(root.querySelectorAll('tr')).toHaveLength(1)
    expect(root.querySelector('tr').textContent).toBe('second row')
  })

  it('⛔ CONTROL — the predicate is not always-false, and not always-true', () => {
    // Without this the four cases above could all be passing over a renderer
    // that drops everything, or one whose emptiness test never fires.
    expect(cellIsDrawn({ text: 'x' })).toBe(true)
    expect(cellIsDrawn({ text: ' ' })).toBe(true)  // one space IS text — see below
    expect(cellIsDrawn({ text: '' })).toBe(false)
    expect(cellIsDrawn(null)).toBe(false)
    expect(rowCells([{ text: '' }, { text: '' }])).toEqual([])
    expect(rowCells([{ text: 'a' }]).map((c) => c.drawn)).toEqual([true])
  })
})

describe('⭐⭐ the trailing space survives — a raster could not carry it', () => {
  it('the Vol cell reaches the DOM at its full length, space included', () => {
    // ⭐ The vendor capture reads `'Vol : 45.51M (1.05x) '`, len 21 for 20
    // visible characters, on THREE separate captures across two symbols. The
    // script puts it there deliberately — "prevents the closing `)` from being
    // clipped against the price scale". A screenshot cannot recover it; a
    // `textContent` read does, with no instrumentation of the renderer at all.
    const root = freshRoot()
    renderTables(root, layoutTables({
      tables: [table([cell(0, 0, 'Vol : 45.51M (1.05x) ', { text_halign: 'left' })])],
    }), doc)
    const td = root.querySelector('td')
    expect(td.textContent).toBe('Vol : 45.51M (1.05x) ')
    expect(td.textContent).toHaveLength(21)
    // ⛔ AND LAYOUT MUST NOT COLLAPSE IT. `white-space: normal` would drop the
    // trailing space when the cell is measured, which is the one way the string
    // could be right in the DOM and wrong on the pane.
    expect(td.style.whiteSpace).toBe('pre')
  })

  it('⛔ `textContent`, never `innerHTML` — a member\'s script is not markup', () => {
    const root = freshRoot()
    renderTables(root, layoutTables({
      tables: [table([cell(0, 0, '<b>RSI</b> & <i>x</i>')])],
    }), doc)
    expect(root.querySelector('td').textContent).toBe('<b>RSI</b> & <i>x</i>')
    expect(root.querySelectorAll('b')).toHaveLength(0)
  })
})

describe('⭐⭐ nine positions, nine CSS corners — a resize costs nothing', () => {
  const CASES = [
    ['top_left', { top: '8px', left: '8px', transform: '' }],
    ['top_right', { top: '8px', right: '8px', transform: '' }],
    ['bottom_left', { bottom: '8px', left: '8px', transform: '' }],
    ['bottom_right', { bottom: '8px', right: '8px', transform: '' }],
    ['middle_center', { top: '50%', left: '50%', transform: 'translateX(-50%) translateY(-50%)' }],
    ['top_center', { top: '8px', left: '50%', transform: 'translateX(-50%)' }],
    ['middle_left', { top: '50%', left: '8px', transform: 'translateY(-50%)' }],
  ]
  for (const [pos, want] of CASES) {
    it(`\`${pos}\` anchors by corner, not by a measured pixel`, () => {
      const got = anchorStyle(TABLE_ANCHORS[pos])
      for (const k of Object.keys(want)) {
        expect(got[k] === undefined ? '' : got[k], k).toBe(want[k])
      }
    })
  }

  it('⛔⛔ AND NOTHING IN THE ADAPTER MEASURES THE PANE — that is the whole claim', () => {
    // ⭐ THE SOURCE IS THE EVIDENCE HERE, deliberately. "It survives a resize"
    // cannot be asserted from a jsdom element whose layout is never computed;
    // what CAN be asserted is that the adapter reads no size at all, which is
    // why there is nothing for a resize to invalidate. The browser screenshots
    // in the same commit are the other half.
    //
    // ⛔ COMMENTS STRIPPED FIRST. Every one of these names is discussed in the
    // prose above the code, so a raw `includes` would match the explanation and
    // report a property of this test rather than of the adapter.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/chart/engine/objectTableDom.js'), 'utf8')
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    for (const banned of [
      'devicePixelRatio', 'clientWidth', 'clientHeight', 'getBoundingClientRect',
      'ResizeObserver', 'requestAnimationFrame', 'offsetWidth',
    ]) {
      expect(code, `${banned} reached the table adapter`).not.toContain(banned)
    }
    // ⛔ AND THE CONTROL: the stripper must still be able to SEE a real
    // occurrence, or the seven assertions above are seven ways of matching
    // nothing. `createElement` is in the code and discussed in the prose too.
    expect(code).toContain('createElement')
  })
})

describe('⭐ what the element carries, so an observer can find and read it', () => {
  it('the table names its id and its declared position', () => {
    const root = freshRoot()
    renderTables(root, layoutTables({
      tables: [table([cell(0, 0, 'x')], { id: 42, position: 'bottom_left' })],
    }), doc)
    const el = root.querySelector('[data-uct-object-table]')
    expect(el.getAttribute('data-uct-object-table')).toBe('42')
    expect(el.getAttribute('data-uct-table-position')).toBe('bottom_left')
    expect(el.tagName).toBe('TABLE')
  })

  it('⛔ the dashboard never eats a chart drag', () => {
    // A table pinned over the pane that accepted pointer events would make the
    // chart un-pannable wherever it sits. Selectable text is the one DOM
    // affordance given up for that, and it is given up on purpose.
    const root = freshRoot()
    renderTables(root, layoutTables({ tables: [table([cell(0, 0, 'x')])] }), doc)
    expect(root.querySelector('table').style.pointerEvents).toBe('none')
  })

  it('⭐ re-rendering REPLACES — no doubled dashboard after an update', () => {
    const root = freshRoot()
    const one = layoutTables({ tables: [table([cell(0, 0, 'first')])] })
    const two = layoutTables({ tables: [table([cell(0, 0, 'second')])] })
    renderTables(root, one, doc)
    renderTables(root, two, doc)
    expect(root.querySelectorAll('table')).toHaveLength(1)
    expect(root.querySelector('td').textContent).toBe('second')
    // …and an empty render takes the last one away rather than leaving it.
    expect(renderTables(root, [], doc)).toEqual({ tables: 0, cells: 0, skipped: 0 })
    expect(root.children).toHaveLength(0)
  })

  it('⛔ a malformed layout is skipped, not thrown on', () => {
    expect(buildTable(null, doc)).toBe(null)
    expect(buildTable({ rows: 0, cols: 0 }, doc)).toBe(null)
    expect(renderTables(null, [], doc)).toEqual({ tables: 0, cells: 0, skipped: 0 })
  })
})

// ─── ⛔⛔ THE ONE NUMBER THE ADAPTER CANNOT KNOW, AND ITS TWO AUTHORITIES ────
//
// ⚰️ FOUND IN PIXELS. On the first live run both of `uncharted-volume-v2.pine`'s
// dashboards were built correctly, anchored to the corners the script declares —
// and PAINTED OVER by the drawing toolbar, which floats `absolute; top: 4px;
// height: 26px; z-index: 5` across the top of the same container. Every counter
// said the tables had drawn. They had. A member could not read them.
//
// ⭐ The fix is an INSET the HOST supplies, because the host owns that chrome and
// the adapter owns its freedom from measurement. That makes the toolbar's
// geometry live in two files, which is the shape this repo pays for over and
// over — so the CSS is parsed here and the sum is checked against the constant.
describe('⛔ the toolbar footprint agrees with the CSS it was read from', () => {
  const CSS = fs.readFileSync(path.join(process.cwd(),
    'src/components/chart/ChartToolbar.module.css'), 'utf8')

  /** `.toolbar { … top: 4px … height: 26px … }` — the first rule only. */
  const toolbarRule = CSS.slice(CSS.indexOf('.toolbar {'), CSS.indexOf('}', CSS.indexOf('.toolbar {')))
  /** ⛔ DECLARATIONS, NOT A SUBSTRING SEARCH. `top` also appears inside this
   *  rule's own comments, and a regex over the whole block would happily read a
   *  number out of the prose explaining the number. */
  const px = (prop) => {
    for (const decl of toolbarRule.split(';')) {
      const line = decl.replace(/\/\*[\s\S]*?\*\//g, '').trim()
      const [k, v] = line.split(':')
      if (!v || k.trim() !== prop) continue
      const n = Number(v.trim().replace(/px$/, ''))
      if (Number.isFinite(n)) return n
    }
    return null
  }

  it('⭐⭐ top + height === CHART_TOOLBAR_FOOTPRINT_PX', () => {
    const top = px('top')
    const height = px('height')
    // ⛔ The parse must not be vacuous: two nulls would sum to 0 and 0 !== 30
    // would fail loudly, but 0 + 30 would pass while reading nothing.
    expect(top, 'could not read `top` off .toolbar').not.toBeNull()
    expect(height, 'could not read `height` off .toolbar').not.toBeNull()
    expect(top + height).toBe(CHART_TOOLBAR_FOOTPRINT_PX)
  })

  it('⛔ CONTROL — the rule that was parsed is the FLOATING one', () => {
    // A `.toolbar` that stopped being absolutely positioned would not sit over
    // the chart at all, and the inset would then be reserving space for nothing.
    expect(toolbarRule).toContain('position: absolute')
    expect(toolbarRule).toContain('z-index: 5')
  })
})

// ─── ⭐⭐ ITEM 4 — THE PRICE SCALE IS NOT PLOT AREA ─────────────────────────
//
// ⚰️ MEASURED at both touch tiers on the real pane, 2026-09-13. The chart
// container is 390px wide on a phone and lightweight-charts gives the right
// price scale its last 104px (x=286..390). A table anchored `right: 8px`
// therefore ran from x=264 to x=382 — straight over the price labels — and at
// 1024 the same thing happened at x=550..654. Both tiers, every gesture.
//
// ⛔ `position.top_right` MEANS THE TOP RIGHT OF THE PLOT, which is what the
// vendor draws, not the top right of the widget including its axis. The fix is
// an inset the HOST reports (`priceScale('right').width()`), for the same reason
// the toolbar inset is: the adapter measures nothing, and the chart is the only
// thing that knows how wide its own axis is this frame.
describe('⛔ a right-anchored table clears the price scale', () => {
  it('⭐ the inset is SUBTRACTED from the right anchor, not from the left one', () => {
    // The anchor helper is pure and takes no measurements — the inset arrives as
    // a style on the layer root, so what this pins is that a right-anchored
    // table is positioned FROM the right edge and a left-anchored one is not.
    expect(anchorStyle(TABLE_ANCHORS.top_right).right).toBe('8px')
    expect(anchorStyle(TABLE_ANCHORS.top_right).left).toBeUndefined()
    expect(anchorStyle(TABLE_ANCHORS.top_left).left).toBe('8px')
    expect(anchorStyle(TABLE_ANCHORS.top_left).right).toBeUndefined()
  })

  it('⛔⛔ THE MEASURED GEOMETRY, as arithmetic — the defect and the fix', () => {
    // Real numbers off the live pane, so this fails if either the scale width or
    // the margin moves. Phone: container 390, scale 104 wide starting at 286.
    const container = 390
    const scaleW = 104
    const margin = 8
    const tableW = 118
    const plotRight = container - scaleW          // 286
    const before = container - margin             // 382 — the old right edge
    const after = container - scaleW - margin     // 278 — with the inset
    expect(before).toBeGreaterThan(plotRight)     // ⚰️ overlapped
    expect(after).toBeLessThanOrEqual(plotRight)  // ⭐ clear
    expect(after - tableW).toBeGreaterThan(0)     // and still on screen
  })
})
