// app/src/components/chart/engine/objectTableDom.js
//
// ─── ⭐⭐ R2 STEP 6 — THE TABLE ADAPTER, AS DOM ──────────────────────────────
//
//   PINE → OBJECT PROGRAM → EVALUATOR → GENERIC RENDER STATE → layoutTables()
//                                                                    ↓
//                                              objectCanvas.js  ·  **this**
//
// The sibling of `objectCanvas.js`, and it reads the SAME `layoutTables(state)`
// output — one authority for what the grid is, two adapters for where it lands.
// Lines, labels and boxes live in price/time and belong on a canvas. A table
// does not: its position is `top_right`, it never moves when the chart is
// panned, and its columns are sized by TEXT. That is a `<table>`.
//
// ⭐⭐ WHY DOM AND NOT THE CANVAS PAINTER IT REPLACES — three things the raster
// could not do, each of which this wave has to be able to assert:
//
//   1. **The cell text is READABLE BY AN INSTRUMENT.** The vendor captures this
//      is compared against were taken by wrapping `fillText`, because a
//      screenshot cannot recover the TRAILING SPACE in `'Vol : 45.51M (1.05x) '`.
//      A DOM cell carries the string; `textContent` is the comparison, and no
//      instrumentation of the renderer is needed to read it.
//   2. **DEVICE PIXEL RATIO IS NOT THIS LAYER'S PROBLEM.** A canvas has a
//      backing store that must be scaled by `devicePixelRatio` and re-scaled on
//      every zoom, and text drawn into a mis-scaled one is soft. DOM text has no
//      backing store: the browser rasterises it at the device's real resolution
//      at whatever zoom the member is using. ⛔ So this file contains NO
//      `devicePixelRatio` and sets no `width`/`height` attribute, and
//      `objectTableDom.test.js` asserts that as a property of the SOURCE —
//      "DPR handled" here means "structurally absent", not "computed and
//      applied", and the difference is worth writing down because the reviewer
//      is looking for the arithmetic the canvas layer has to do.
//   3. **RESIZE IS FREE.** The anchor is nine CSS corner positions, so a pane
//      resize, a container resize (R-M) and a browser zoom re-place the table
//      with no measurement, no `ResizeObserver` and no repaint — which is also
//      why there is no artefact to leave behind. A canvas has to be told.
//
// ⚰️ AND THE CANVAS PAINTER IS GONE, NOT LEFT BESIDE THIS. `paintTable` drew the
// same table from the same layout with its own measured column widths. Two
// renderers for one table is the second-authority-over-one-value defect this
// repo keeps paying for, and here it would have been VISIBLE: two dashboards,
// one under the other, a few pixels apart. `layoutTables` stays where it is.
import { TEXT_SIZE_PX, TABLE_ANCHORS, TABLE_MARGIN } from './objectCanvas'
import CLOSED_TABLE from './ast/closedTable.json'

/** ⭐ THE FONT STACK IS THE CANVAS PAINTER'S, VERBATIM. The two adapters draw
 *  one document and the labels are still on the canvas, so a table in a
 *  different typeface from the label beside it would read as two indicators. */
const FONT = '-apple-system, Segoe UI, sans-serif'
const CELL_PAD_PX = 6

/**
 * ⛔⛔ A CELL WITH NOTHING IN IT IS NOT A CELL, AND THAT IS A MEASUREMENT.
 *
 * `uncharted-volume-v2.pine` writes all four of its Range cells unconditionally
 * and lets two of them fold to `''`, with the author's own comment saying so:
 * *"Empty strings render as blank cells (no visible separator from neighbors)"*.
 * The vendor capture of that same script — `fillText` wrapped for one redraw —
 * records THREE cells in the Range table and ONE in the Volume table, because
 * TradingView never calls `fillText` for an empty string.
 *
 * ⛔ So an empty cell must be ABSENT, not present-and-blank. A blank `<td>` with
 * padding is a visible gap the author did not draw, and — worse for the compare
 * — it is a cell an instrument would count. A cell earns its element by having
 * text or a background of its own; nothing else does.
 */
export const cellIsDrawn = (c) =>
  !!c && ((typeof c.text === 'string' && c.text !== '') || !!c.bgcolor)

/** Where the nine Pine anchors put a box inside its container, as CSS.
 *  ⛔ CORNERS AND PERCENTAGES, NEVER MEASURED PIXELS. A `left` computed from
 *  `clientWidth` is a number that goes stale the instant the pane resizes; a
 *  `right: 8px` is still correct at the next frame, at the next zoom level and
 *  at the next container size, with nothing having run. */
export function anchorStyle(anchor) {
  const a = anchor || TABLE_ANCHORS.top_right
  const M = `${TABLE_MARGIN}px`
  const out = { position: 'absolute' }
  const tx = []
  if (a.h === 0) out.left = M
  else if (a.h === 1) out.right = M
  else { out.left = '50%'; tx.push('translateX(-50%)') }
  if (a.v === 0) out.top = M
  else if (a.v === 1) out.bottom = M
  else { out.top = '50%'; tx.push('translateY(-50%)') }
  if (tx.length) out.transform = tx.join(' ')
  return out
}

/** The cells of one row, in column order, with TRAILING empties removed.
 *
 *  ⭐ TRAILING VERSUS INTERIOR IS A REAL DISTINCTION, not a shortcut. Dropping a
 *  trailing empty removes an element that occupies nothing; dropping an INTERIOR
 *  one would slide every later column left, which in a multi-row table breaks
 *  the alignment that makes it a table at all. An interior hole keeps its slot
 *  as a zero-width, zero-padding cell and says so in `data-uct-cell`, so a
 *  reader counting cells can tell the two apart rather than having to guess. */
export function rowCells(row) {
  const cells = row || []
  let last = -1
  for (let i = 0; i < cells.length; i += 1) if (cellIsDrawn(cells[i])) last = i
  if (last < 0) return []
  return cells.slice(0, last + 1).map((c, col) => ({ col, cell: c, drawn: cellIsDrawn(c) }))
}

const setStyle = (el, style) => {
  for (const k of Object.keys(style)) {
    const v = style[k]
    if (v !== undefined && v !== null && v !== '') el.style[k] = v
  }
}

/**
 * Build (not mutate) the element for one laid-out table.
 *
 * @param {object} tb   one entry of `layoutTables(state)`
 * @param {Document} doc
 * @returns {{el: HTMLElement, cells: number}|null}  null when nothing is drawn
 */
export function buildTable(tb, doc) {
  if (!tb || !tb.rows || !tb.cols || !doc) return null
  const rows = []
  let drawnCells = 0
  for (let r = 0; r < tb.rows; r += 1) {
    const cells = rowCells((tb.grid || [])[r])
    // ⛔ A ROW WITH NOTHING DRAWN IS NOT A ROW EITHER — an empty `<tr>` is still
    // a line of vertical padding, which is a stripe the author never drew.
    if (!cells.length) continue
    rows.push(cells)
    for (const c of cells) if (c.drawn) drawnCells += 1
  }
  if (!drawnCells) return null

  const el = doc.createElement('table')
  el.setAttribute('data-uct-object-table', String(tb.id))
  el.setAttribute('data-uct-table-position', String(tb.position || 'top_right'))
  setStyle(el, {
    ...anchorStyle(tb.anchor),
    borderCollapse: 'collapse',
    borderSpacing: '0',
    fontFamily: FONT,
    lineHeight: '1.2',
    tableLayout: 'auto',
    margin: '0',
    // ⛔ THE MEMBER'S POINTER BELONGS TO THE CHART. A table that swallowed a
    // drag would make the pane un-pannable wherever the dashboard sits, and
    // TradingView's own tables are not interactive either. Selectable text is
    // the one DOM affordance deliberately given up here; the comparison
    // instrument reads `textContent`, which needs no pointer.
    pointerEvents: 'none',
    background: tb.bgcolor && tb.bgcolor !== 'transparent' ? tb.bgcolor : 'transparent',
    ...(tb.frame_width > 0 && tb.frame_color
      ? { border: `${tb.frame_width}px solid ${tb.frame_color}` }
      : {}),
  })

  const tbody = doc.createElement('tbody')
  for (const cells of rows) {
    const tr = doc.createElement('tr')
    for (const { col, cell, drawn } of cells) {
      const td = doc.createElement('td')
      td.setAttribute('data-uct-cell-col', String(col))
      if (!drawn) {
        td.setAttribute('data-uct-cell', 'empty')
        setStyle(td, { padding: '0', width: '0', fontSize: '0' })
        tr.appendChild(td)
        continue
      }
      const px = TEXT_SIZE_PX[(cell && cell.text_size) || 'normal'] || TEXT_SIZE_PX.normal
      setStyle(td, {
        padding: `${Math.round(CELL_PAD_PX / 2)}px ${CELL_PAD_PX}px`,
        fontSize: `${px}px`,
        color: cell.text_color || '#D1D4DC',
        textAlign: cell.text_halign === 'left' ? 'left'
          : cell.text_halign === 'right' ? 'right' : 'center',
        verticalAlign: cell.text_valign === 'top' ? 'top'
          : cell.text_valign === 'bottom' ? 'bottom' : 'middle',
        // ⭐ `pre` IS WHY THE TRAILING SPACE SURVIVES. The default
        // `white-space: normal` collapses a trailing space away in layout, and
        // the vendor's own capture records that space three times across two
        // symbols. It is the author's, deliberately — "prevents the closing `)`
        // from being clipped against the price scale".
        whiteSpace: 'pre',
        ...(cell.bgcolor ? { background: cell.bgcolor } : {}),
        ...(tb.border_width > 0 && tb.border_color
          ? { border: `${tb.border_width}px solid ${tb.border_color}` }
          : {}),
      })
      // ⛔ `textContent`, NEVER `innerHTML`. A cell's string comes from a
      // member's Pine script; through `innerHTML` a `<` in a label would be
      // markup on our page. `textContent` also means the compare reads exactly
      // the bytes the template produced, which is the point of doing this in DOM.
      td.textContent = String(cell.text === undefined || cell.text === null ? '' : cell.text)
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  el.appendChild(tbody)
  return { el, cells: drawnCells }
}

/**
 * Replace `root`'s children with the tables `tabs` describes.
 *
 * ⭐ REBUILT, NOT DIFFED. This runs only when the object STATE changes — a pan,
 * a zoom or a resize does not reach it — so the cheap thing and the correct
 * thing are the same thing, and there is no reconciliation to get wrong.
 *
 * @returns {{tables:number, cells:number, skipped:number}}
 */
export function renderTables(root, tabs, doc) {
  const out = { tables: 0, cells: 0, skipped: 0 }
  if (!root || !doc) return out
  while (root.firstChild) root.removeChild(root.firstChild)
  for (const tb of tabs || []) {
    const built = buildTable(tb, doc)
    if (!built) { out.skipped += 1; continue }
    root.appendChild(built.el)
    out.tables += 1
    out.cells += built.cells
  }
  return out
}


// ─── ⭐⭐ R-R — FITTING A TABLE TO A PHONE, WITHOUT LOSING A NUMBER ─────────
//
// ⚰️ MEASURED at the phone tier: the plot is 286px wide (390 screen − 104 price
// scale) and `uncharted-volume-v2.pine`'s Range table needs 287px at its
// defaults and 356px with the toggles on. The table starts exactly where it
// should; it is simply wider than the space.
//
// ⛔ THE RULING'S PRIORITY ORDER decides what may be given up, and it rules out
// almost everything: never lose a NUMBER (clipping is out), never cover the
// price labels (an opaque background is out), keep the author's declared row
// shape. What survives is a UNIFORM SCALE — one factor for font, padding and
// cell widths together — with a readable floor, and wrapping only when the floor
// would otherwise be broken.
//
// ⭐ THE SAME FACTOR FOR EVERY TABLE. Scaling each table to its own need would
// silently re-rank them: the author made the Range table wider than the Volume
// table, and two independent factors would erase that. One factor, chosen so the
// WIDEST table fits, keeps their relative sizes as written.

/** The readable floor and the member's sentence — both from the manifest, which
 *  is the one owner of each (`closedTable.json::_tables_fit`). */
export const TABLES_FIT = Object.freeze({
  floorPx: (CLOSED_TABLE._tables_fit && CLOSED_TABLE._tables_fit.floorPx) || 9,
  memberNote: (CLOSED_TABLE._tables_fit && CLOSED_TABLE._tables_fit.memberNote) || '',
})

/**
 * ⭐⭐ THE DECISION, AS ARITHMETIC — no DOM, so it is testable and has one answer.
 *
 * @param {number[]} neededWidths what each table wants, in CSS px
 * @param {number}   plotWidth    the width it must fit into
 * @param {number}   basePx       the author's declared text size in px
 * @returns {{factor, wrap, scaled, widest}}
 */
export function fitFactor({ neededWidths = [], plotWidth = 0, basePx = TEXT_SIZE_PX.normal,
  floorPx = TABLES_FIT.floorPx } = {}) {
  const widths = neededWidths.filter((w) => Number.isFinite(w) && w > 0)
  const widest = widths.length ? Math.max(...widths) : 0
  // ⛔ NOTHING TO DO IS A REAL ANSWER, and it must be distinguishable from a
  // scale of 1 that was chosen: `scaled` is what the disclosure keys off.
  if (!widest || !plotWidth || widest <= plotWidth) {
    return { factor: 1, wrap: false, scaled: false, widest }
  }
  const want = plotWidth / widest
  const floorFactor = floorPx / basePx
  if (want >= floorFactor) return { factor: want, wrap: false, scaled: true, widest }
  // ⛔ THE FLOOR HELD, SO THE ROW SHAPE GOES. Scaling past the floor would keep
  // the shape and make the numbers unreadable, which loses the value in a way a
  // member cannot even see they have lost.
  return { factor: floorFactor, wrap: true, scaled: true, widest }
}

/** Apply one factor to every table under `root`, anchored at its own corner.
 *
 *  ⭐ A CSS TRANSFORM IS THE UNIFORM SCALE. Font, padding and the content-driven
 *  cell widths all move by exactly one number, which is what the ruling asks for
 *  and what setting three properties by hand would only approximate.
 *  ⛔ THE ORIGIN MATCHES THE ANCHOR, or a right-anchored table would shrink away
 *  from the corner it is pinned to and stop being anchored.
 */
export function applyFit(root, fit) {
  if (!root) return
  for (const t of root.querySelectorAll('[data-uct-object-table]')) {
    const pos = t.getAttribute('data-uct-table-position') || 'top_right'
    const originX = pos.endsWith('_right') ? 'right' : pos.endsWith('_center') ? 'center' : 'left'
    const originY = pos.startsWith('bottom') ? 'bottom' : pos.startsWith('middle') ? 'center' : 'top'
    if (!fit.scaled) {
      t.style.transform = ''
      t.style.transformOrigin = ''
      t.removeAttribute('data-uct-table-scaled')
      continue
    }
    t.style.transformOrigin = `${originY} ${originX}`
    t.style.transform = `scale(${fit.factor.toFixed(4)})`
    t.setAttribute('data-uct-table-scaled', fit.factor.toFixed(4))
    if (fit.wrap) {
      // ⛔ WRAPPING IS A LAST RESORT AND IS MARKED. The cells flow onto a second
      // line rather than being squeezed; the TEXT is untouched, so `textContent`
      // — and the trailing space the vendor compare reads — is unchanged.
      const row = t.querySelector('tr')
      if (row) {
        row.style.display = 'flex'
        row.style.flexWrap = 'wrap'
      }
      t.style.display = 'block'
      t.setAttribute('data-uct-table-wrapped', '1')
    } else {
      const row = t.querySelector('tr')
      if (row) { row.style.display = ''; row.style.flexWrap = '' }
      t.style.display = ''
      t.removeAttribute('data-uct-table-wrapped')
    }
  }
}
