// UCT Terminal: share a panel. THE PICTURE: rows to a drawing plan, and the plan onto a canvas.
//
// No screenshot library and no SVG snapshot: the table is drawn by hand from the rows
// `shareRead.js` read off the panel (an SVG `foreignObject` snapshot taints the canvas in Safari,
// so it could never be copied). Two halves:
//
//   layoutShare(read, lines, measure)  PURE. Column widths, wrapping, row heights and the whole
//                                      picture's size, as a flat list of draw steps. Tested with a
//                                      ruler that is not a canvas.
//   drawShare(ctx, layout, theme)      replays the steps onto a 2D context.
//
// ⛔ NOTHING IS EVER CLIPPED. A column that cannot hold its text wraps it at a space; a single
// word wider than its column breaks inside the word; a table too wide for the picture makes the
// picture wider, up to `maxWidth`, and wraps after that. Text is never cut with "...".
//
// ⛔ THE SIZE IS CAPPED, AND THE PICTURE SAYS SO. A list of 300 rows would be a picture nobody
// can read in a chat: the picture holds the first `rowCap` rows on screen and a line under the
// table says how many there were. The spreadsheet file has every row.
//
// Sized for a chat app: 600 px wide at twice the pixel density, so 1200 px across and crisp on
// a high-density screen, and still readable at the width Discord shows a picture inline.

export const IMAGE = Object.freeze({
  minWidth: 600,
  maxWidth: 880,
  pad: 24,
  rowCap: 50,
  /** The longest side of the finished bitmap, in device pixels. */
  maxEdge: 8000,
  /** The most device pixels a bitmap may hold (iOS Safari refuses a canvas much past this). */
  maxArea: 16000000,
  cellPadX: 10,
  cellPadY: 7,
  lineH: 18,
  minCol: 44,
})

const SIZE = Object.freeze({ title: 19, sub: 12, head: 11, body: 13, small: 11.5, foot: 11, brand: 13 })
const DEFAULT_FAMILY = "'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif"
/** The app's tabular-figures build of its face (declared and activated in app/index.html for the
 *  chart axis). A canvas ignores `font-variant-numeric`, so this is what keeps a column of
 *  numbers lined up digit under digit; a glyph it lacks falls through to the page's own face. */
export const TABULAR_FACE = "'Instrument Sans Tab'"

/** The CSS font strings one picture uses: tabular figures first, then the page's own family. */
export function shareFonts(family = DEFAULT_FAMILY) {
  const stack = `${TABULAR_FACE}, ${family || DEFAULT_FAMILY}`
  const f = (weight, size) => `${weight} ${size}px ${stack}`
  return Object.freeze({
    title: f(600, SIZE.title), sub: f(400, SIZE.sub), head: f(500, SIZE.head), body: f(400, SIZE.body),
    bold: f(600, SIZE.body), small: f(400, SIZE.small), band: f(600, SIZE.small), foot: f(400, SIZE.foot),
    brand: f(700, SIZE.brand),
  })
}

/**
 * The picture's pixel density: at least 2, the screen's own when it is higher, and lowered only
 * as far as it takes to keep the bitmap inside `maxEdge` and `maxArea`.
 */
export function imageScale(width, height, dpr = 1, { maxEdge = IMAGE.maxEdge, maxArea = IMAGE.maxArea } = {}) {
  const want = Math.max(2, Number.isFinite(dpr) ? dpr : 1)
  const long = Math.max(width || 0, height || 0)
  if (!(long > 0)) return want
  const byEdge = maxEdge / long
  const byArea = Math.sqrt(maxArea / Math.max(1, width * height))
  return Math.min(want, byEdge, byArea)
}

/**
 * The first `cap` data rows across the tables, in order, and how many there were. A table left
 * with no row is dropped. Bands (a group name inside a list) ride with the rows that follow them.
 */
export function capRows(read, cap = IMAGE.rowCap) {
  let left = Math.max(0, cap)
  let total = 0
  const tables = []
  for (const table of read?.tables || []) {
    const rows = []
    let pendingBands = []
    for (const row of table.rows) {
      if (!row.cells) { pendingBands.push(row); continue }
      total += 1
      if (left > 0) { rows.push(...pendingBands, row); left -= 1 }
      pendingBands = []
    }
    if (rows.some((r) => r.cells)) tables.push({ ...table, rows })
  }
  return { tables, shown: Math.min(total, Math.max(0, cap)), total }
}

/**
 * Wrap coloured runs to a width. Breaks at spaces; a word wider than the whole width breaks
 * inside the word, so nothing is ever cut off. Returns lines of `{ text, color, bold, w }`.
 */
export function wrapRuns(runs, maxWidth, measure, fonts) {
  const widthOf = (text, bold) => measure(text, bold ? fonts.bold : fonts.body)
  return wrapWith(runs, maxWidth, widthOf)
}

function wrapWith(runs, maxWidth, widthOf) {
  const limit = Math.max(1, maxWidth)
  const lines = [[]]
  let used = 0
  const put = (text, run) => {
    const line = lines[lines.length - 1]
    const w = widthOf(text, run.bold)
    const last = line[line.length - 1]
    if (last && last.color === run.color && last.bold === run.bold) { last.text += text; last.w += w } else line.push({ text, color: run.color, bold: run.bold, w })
    used += w
  }
  const newLine = () => {
    const line = lines[lines.length - 1]
    // A line never ends on the space it broke at.
    const last = line[line.length - 1]
    if (last && /\s$/.test(last.text)) {
      const trimmed = last.text.replace(/\s+$/, '')
      last.w = widthOf(trimmed, last.bold)
      last.text = trimmed
      if (!trimmed) line.pop()
    }
    lines.push([])
    used = 0
  }
  for (const run of runs || []) {
    for (const piece of String(run.text || '').split(/(\s+)/)) {
      if (!piece) continue
      const space = /^\s+$/.test(piece)
      if (space) { if (used > 0) put(' ', run); continue }
      const w = widthOf(piece, run.bold)
      if (used > 0 && used + w > limit) newLine()
      if (w <= limit) { put(piece, run); continue }
      // One word wider than the column: break inside it.
      let chunk = ''
      for (const ch of piece) {
        if (chunk && used + widthOf(chunk + ch, run.bold) > limit) { put(chunk, run); newLine(); chunk = ch } else chunk += ch
      }
      if (chunk) put(chunk, run)
    }
  }
  const out = lines.filter((l) => l.length)
  for (const line of out) {
    const last = line[line.length - 1]
    if (/\s$/.test(last.text)) { last.text = last.text.replace(/\s+$/, ''); last.w = widthOf(last.text, last.bold) }
  }
  return out.filter((l) => l.some((r) => r.text))
}

const lineWidth = (line) => line.reduce((n, r) => n + r.w, 0)

/**
 * Column widths that fit `available`. Each column has a `natural` width (its text on one line)
 * and a `floor` (its longest single word). Room to spare is shared out in proportion; too little
 * room is taken from the columns that can wrap, never below their floor; and when even the floors
 * do not fit, every column gives way in proportion and its text breaks inside words.
 */
export function fitColumns(natural, floors, available) {
  const total = natural.reduce((a, b) => a + b, 0)
  if (!natural.length || !(available > 0)) return natural.slice()
  if (total <= available) return natural.map((w) => w + ((available - total) * w) / (total || 1))
  const floorOf = (i) => Math.min(natural[i], Math.max(floors[i] || 0, 0))
  const slack = natural.map((w, i) => w - floorOf(i))
  const give = slack.reduce((a, b) => a + b, 0)
  const need = total - available
  if (give >= need) return natural.map((w, i) => w - (need * slack[i]) / (give || 1))
  const floorTotal = natural.reduce((n, _, i) => n + floorOf(i), 0)
  return natural.map((_, i) => (floorOf(i) * available) / (floorTotal || 1))
}

/** One table's columns: natural and floor widths (cell padding included), and the row-number gutter. */
export function measureTable(table, measure, fonts) {
  const pad = IMAGE.cellPadX * 2
  const natural = table.columns.map((c) => measure(c.text, fonts.head) + pad)
  const floors = table.columns.map((c) => Math.max(IMAGE.minCol, ...String(c.text).split(/\s+/).map((w) => measure(w, fonts.head) + pad)))
  let gutter = 0
  for (const row of table.rows) {
    if (!row.cells) continue
    if (row.no) gutter = Math.max(gutter, measure(String(row.no), fonts.foot) + 12)
    row.cells.forEach((cell, i) => {
      for (const line of cell.lines) {
        let w = 0
        for (const run of line) {
          w += measure(run.text, run.bold ? fonts.bold : fonts.body)
          for (const word of run.text.split(/\s+/)) floors[i] = Math.max(floors[i], measure(word, run.bold ? fonts.bold : fonts.body) + pad)
        }
        natural[i] = Math.max(natural[i], w + pad)
      }
    })
  }
  return { natural, floors: floors.map((f, i) => Math.min(f, natural[i])), gutter }
}

/**
 * The whole picture as draw steps.
 *
 *   read    `{ tables, notes }` from shareRead.readPanel
 *   lines   `{ title, command, asOf, source, shared }` from shareText.shareLines
 *   measure `(text, font) => width in px`
 *
 * Returns `{ width, height, steps, shown, total }`: logical pixels, and how many of the rows on
 * screen the picture holds.
 */
export function layoutShare(read, lines, measure, { fonts = shareFonts(), rowCap = IMAGE.rowCap, brand = 'UCT Intelligence', site = 'uctintelligence.com' } = {}) {
  const { tables, shown, total } = capRows(read, rowCap)
  const pad = IMAGE.pad
  const plans = tables.map((t) => measureTable(t, measure, fonts))
  const wanted = Math.max(IMAGE.minWidth, ...plans.map((p) => p.natural.reduce((a, b) => a + b, 0) + p.gutter + pad * 2))
  const width = Math.ceil(Math.min(IMAGE.maxWidth, wanted) / 2) * 2
  const inner = width - pad * 2
  const steps = []
  let y = pad

  const plainWrap = (text, font, max) => wrapWith([{ text, color: '', bold: false }], max, (t) => measure(t, font)).map((l) => l.map((r) => r.text).join(''))
  const paragraph = (text, font, ink, lineH, max = inner, x = pad) => {
    for (const line of plainWrap(text, font, max)) {
      steps.push({ op: 'text', x, y: y + lineH - Math.round(lineH * 0.28), text: line, font, ink, align: 'left' })
      y += lineH
    }
  }
  const rule = (ink = 'border') => { steps.push({ op: 'rule', x: pad, y: Math.round(y) + 0.5, w: inner, ink }) }

  // ── the head: what this is (left), whose it is (right), then the command and the as-of time ──
  const logo = 18
  const brandW = measure(brand, fonts.brand) + logo + 8
  const titleTop = y
  paragraph(lines.title, fonts.title, 'bright', 25, Math.max(120, inner - brandW - 16))
  steps.push({ op: 'logo', x: width - pad - brandW, y: titleTop + 3, size: logo })
  steps.push({ op: 'text', x: width - pad, y: titleTop + 25 - 7, text: brand, font: fonts.brand, ink: 'gold', align: 'right' })
  y += 2
  paragraph([lines.command, lines.asOf].filter(Boolean).join(' \u00B7 '), fonts.sub, 'muted', 17)
  y += 10
  rule()
  y += 4

  // ── the tables ──
  let closed = false   // did the last table end on a row hairline, with nothing drawn since?
  tables.forEach((table, t) => {
    const plan = plans[t]
    const x0 = pad + plan.gutter
    const widths = fitColumns(plan.natural, plan.floors, inner - plan.gutter)
    const lefts = widths.reduce((acc, w) => [...acc, acc[acc.length - 1] + w], [x0])
    const textAt = (i, align, w) => {
      if (align === 'right') return lefts[i] + widths[i] - IMAGE.cellPadX - w
      if (align === 'center') return lefts[i] + (widths[i] - w) / 2
      return lefts[i] + IMAGE.cellPadX
    }
    if (table.caption) {
      y += 8
      paragraph(table.caption, fonts.band, 'muted', 17)
    }
    // the header row
    const heads = table.columns.map((c, i) => plainWrap(c.text, fonts.head, widths[i] - IMAGE.cellPadX * 2))
    const headLines = Math.max(1, ...heads.map((h) => h.length))
    const headH = headLines * 15 + 12
    heads.forEach((h, i) => h.forEach((text, k) => {
      const w = measure(text, fonts.head)
      steps.push({ op: 'text', x: textAt(i, table.columns[i].align, w), y: y + 6 + (k + 1) * 15 - 4, text, font: fonts.head, ink: 'muted', align: 'left' })
    }))
    y += headH
    rule()

    let stripe = 0
    for (const row of table.rows) {
      if (!row.cells) {
        y += 6
        paragraph(row.band, fonts.band, 'muted', 18)
        rule()
        continue
      }
      const wrapped = row.cells.map((cell, i) => cell.lines.flatMap((line) => wrapRuns(line, widths[i] - IMAGE.cellPadX * 2, measure, fonts)))
      const count = Math.max(1, ...wrapped.map((w) => w.length))
      const rowH = count * IMAGE.lineH + IMAGE.cellPadY * 2
      if (table.zebra && stripe % 2 === 1) steps.push({ op: 'rect', x: pad, y, w: inner, h: rowH, color: table.zebra })
      stripe += 1
      if (row.no) {
        steps.push({ op: 'text', x: x0 - 6, y: y + IMAGE.cellPadY + 13, text: String(row.no), font: fonts.foot, ink: 'muted', align: 'right' })
      }
      wrapped.forEach((cellLines, i) => cellLines.forEach((line, k) => {
        let x = textAt(i, row.cells[i].align || table.columns[i].align, lineWidth(line))
        for (const run of line) {
          steps.push({ op: 'text', x, y: y + IMAGE.cellPadY + 13 + k * IMAGE.lineH, text: run.text, font: run.bold || row.cells[i].header ? fonts.bold : fonts.body, ink: 'text', color: run.color || '', align: 'left' })
          x += run.w
        }
      }))
      y += rowH
      closed = table.rule !== false
      if (closed) steps.push({ op: 'rule', x: pad, y: Math.round(y) + 0.5, w: inner, ink: 'hair', color: typeof table.rule === 'string' ? table.rule : '' })
    }
    y += 6
  })

  // ── what the panel says about its list, and what this picture left out ──
  const notes = [...(read?.notes || [])]
  if (total > shown) notes.push(`This picture shows the first ${shown} of the ${total} rows on screen.`)
  if (notes.length) y += 6
  for (const note of notes) { paragraph(note, fonts.small, 'muted', 17); y += 2 }

  // ── the foot: where the numbers come from, when this was made, and where it is from ──
  // One line between the list and the foot, never two: the last row's own hairline is that line
  // when nothing was said under the table.
  if (notes.length || !closed) { y += 10; rule() }
  y += 8
  if (lines.source) { paragraph(lines.source, fonts.foot, 'muted', 16); y += 2 }
  const siteW = measure(site, fonts.foot)
  const footTop = y
  paragraph(lines.shared, fonts.foot, 'muted', 16, Math.max(120, inner - siteW - 16))
  steps.push({ op: 'text', x: width - pad, y: footTop + 16 - 4, text: site, font: fonts.foot, ink: 'muted', align: 'right' })
  y += pad - 4

  return { width, height: Math.ceil(y), steps, shown, total }
}

/**
 * Replay a layout onto a 2D context at `scale`. `theme` is `{ bg, text, bright, muted, border,
 * hair, gold }`; a step's own `color` (a gain's green, read off the page) wins over its ink, and
 * a colour the context will not take falls back to the ink.
 */
export function drawShare(ctx, layout, theme, { scale = 2, logo = null } = {}) {
  const paint = (step) => {
    const base = theme[step.ink] || theme.text
    ctx.fillStyle = base
    if (step.color) { try { ctx.fillStyle = step.color } catch { ctx.fillStyle = base } }
  }
  ctx.save()
  ctx.scale(scale, scale)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.textBaseline = 'alphabetic'
  for (const step of layout.steps) {
    if (step.op === 'rect') {
      paint({ ink: 'bg', color: step.color })
      ctx.fillRect(step.x, step.y, step.w, step.h)
    } else if (step.op === 'rule') {
      paint({ ink: step.ink === 'hair' ? 'hair' : 'border', color: step.color })
      ctx.fillRect(step.x, step.y - 0.5, step.w, 1)
    } else if (step.op === 'text') {
      paint(step)
      ctx.font = step.font
      ctx.textAlign = step.align === 'right' ? 'right' : 'left'
      ctx.fillText(step.text, step.x, step.y)
    } else if (step.op === 'logo' && logo) {
      try { ctx.drawImage(logo, step.x, step.y, step.size, step.size) } catch { /* the wordmark stands alone */ }
    }
  }
  ctx.restore()
}
