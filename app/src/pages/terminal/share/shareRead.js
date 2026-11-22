// UCT Terminal: share a panel. THE READER: the panel's own DOM to plain rows.
//
// ⛔ WHAT IS SHARED IS WHAT IS ON SCREEN. This reads the tables the panel has already drawn for
// this member: the rows rendered now, after their filters and their sort, in the order shown. It
// never asks the server for anything and it cannot produce a row the panel does not show.
//
// Pure: no React, no network, no canvas. `getStyle` is `getComputedStyle` in the browser and a
// stub in tests (jsdom applies no stylesheet, so a phone-hidden column is hidden there by a stub).
//
// What a cell becomes:
//   * its VISIBLE text, as lines: a `<br>` or a block child starts a new line (the two-line cells
//     the panels merge related columns into);
//   * each run of text keeps the colour the page computed for it (the green and red of a gain
//     and a loss), so the picture needs no colour table of its own;
//   * an icon (`<svg>`) and screen-reader-only text are not visible text. A cell that shows ONLY
//     an icon falls back to its words (the icon's title, an `aria-label`, hidden text), so a
//     tick still exports as "Confirmed";
//   * a ticker cell exports the PLAIN ticker. The watchlist star (components/terminal/WatchMark)
//     is the member's own private mark, drawn as an icon whose words live in a `<title>`: it is
//     never read, so it neither leaks into a file as a stray word nor shows in a picture that
//     is about to be posted;
//   * the Terminal's row number (the small `aria-hidden` number a row <GO> addresses) is kept
//     beside the row, not inside the ticker cell: a picture draws it in a gutter, a file leaves
//     it out.
//
// What a column becomes: a header cell that is hidden (`display: none`, the phone fold) drops its
// whole column; a column with no visible header and no visible text (the Delete buttons) is a
// column of controls and is dropped; a sort caret is not part of a header's name.

const SKIP = new Set(['svg', 'script', 'style', 'template', 'noscript', 'select', 'input', 'textarea', 'canvas', 'img',
  'video', 'audio', 'iframe', 'datalist', 'progress', 'meter'])
const BLOCK = new Set(['div', 'p', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'section', 'article', 'header', 'footer', 'h1',
  'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'figure', 'figcaption', 'address', 'hr'])
const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|flow-root)$/
const CONTROL = 'button, a[href], [role="button"], input, select, textarea'
/** A sort caret at the end of a header's name. */
const CARET = /\s*[\u25B2\u25BC\u25B3\u25BD\u25B4\u25BE\u2191\u2193\u21C5\u2195\u2B0D]+\s*$/
/** The Terminal's row number: a short run of digits. */
const ROW_NO = /^\d{1,4}$/
const tagOf = (el) => String(el?.localName || '').toLowerCase()

function styleOf(el, getStyle) {
  try { return getStyle?.(el) || null } catch { return null }
}

const defaultGetStyle = (el) => (typeof getComputedStyle === 'function' ? getComputedStyle(el) : null)

/** Screen-reader-only: the app's one utility class (tokens.css `.sr-only`), or its computed shape. */
function isSrOnly(el, st) {
  if (el.classList?.contains('sr-only')) return true
  return !!st && st.position === 'absolute' && st.overflow === 'hidden' && (st.width === '1px' || st.height === '1px')
}

/** Not drawn at all: `hidden`, `display: none`, `visibility: hidden`. */
function isHidden(el, st) {
  if (el.hidden || el.getAttribute?.('hidden') != null) return true
  return !!st && (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse')
}

/** Is anything between `el` and `root` (both included) hidden, or inside a closed `<details>`? */
function isShown(el, root, getStyle) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (isHidden(n, styleOf(n, getStyle))) return false
    const parent = n.parentElement
    if (parent && tagOf(parent) === 'details' && !parent.open && tagOf(n) !== 'summary') return false
    if (n === root) break
  }
  return true
}

const clean = (s) => String(s || '').replace(/\u2011/g, '-').replace(/\s+/g, ' ')
const weightOf = (st) => {
  const w = st?.fontWeight
  return w === 'bold' || Number(w) >= 600
}

/**
 * A cell's visible text as lines of coloured runs: `[[{ text, color, bold }, ...], ...]`.
 * `no` is the Terminal's row number when the cell opens with one.
 */
function readLines(cell, getStyle, { rowNo = false } = {}) {
  const lines = [[]]
  let no = null
  const blank = () => lines.every((l) => l.every((r) => !r.text.trim()))
  const breakLine = () => { if (lines[lines.length - 1].some((r) => r.text.trim())) lines.push([]) }
  const push = (text, el) => {
    const line = lines[lines.length - 1]
    const last = line[line.length - 1]
    let t = clean(text)
    if (!t) return
    if ((!last || /\s$/.test(last.text)) && t.startsWith(' ')) t = t.slice(1)
    if (!t) return
    const st = styleOf(el, getStyle)
    const color = st?.color || ''
    const bold = weightOf(st)
    if (last && last.color === color && last.bold === bold) last.text += t
    else line.push({ text: t, color, bold })
  }
  const walk = (node, parent) => {
    if (node.nodeType === 3) { push(node.nodeValue, parent); return }
    if (node.nodeType !== 1) return
    const tag = tagOf(node)
    if (SKIP.has(tag)) return
    const st = styleOf(node, getStyle)
    if (isHidden(node, st) || isSrOnly(node, st)) return
    if (tag === 'br') { lines.push([]); return }
    if (rowNo && no === null && blank() && node.getAttribute('aria-hidden') === 'true' && ROW_NO.test(node.textContent.trim())) {
      no = node.textContent.trim()
      return
    }
    const display = st?.display || ''
    const block = BLOCK.has(tag) || BLOCK_DISPLAY.test(display)
    // A flex or grid box lays its children out apart from each other: side by side they read as
    // words, stacked they read as lines. Inline children touch, exactly as they do on screen.
    const boxed = /flex|grid/.test(display)
    const stacked = boxed && (/grid/.test(display) || /^column/.test(st?.flexDirection || ''))
    if (block) breakLine()
    let first = true
    for (const child of node.childNodes) {
      if (boxed && child.nodeType === 1 && !first) { if (stacked) breakLine(); else push(' ', node) }
      walk(child, node)
      if (child.nodeType === 1) first = false
    }
    if (block) breakLine()
  }
  for (const child of cell.childNodes) walk(child, cell)
  const out = lines
    .map((l) => {
      const runs = l.filter((r) => r.text)
      if (runs.length) {
        runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, '') }
        runs[runs.length - 1] = { ...runs[runs.length - 1], text: runs[runs.length - 1].text.replace(/\s+$/, '') }
      }
      return runs.filter((r) => r.text)
    })
    .filter((l) => l.length)
  return { lines: out, no }
}

/** The words behind a cell that shows no text: hidden text, an `aria-label`, an icon's title. */
function spokenText(cell) {
  const sr = cell.querySelector('.sr-only')
  if (sr && clean(sr.textContent).trim()) return clean(sr.textContent).trim()
  const labelled = cell.hasAttribute('aria-label') ? cell : cell.querySelector('[aria-label]')
  if (labelled && clean(labelled.getAttribute('aria-label')).trim()) return clean(labelled.getAttribute('aria-label')).trim()
  const title = cell.querySelector('svg title')
  if (title && clean(title.textContent).trim()) return clean(title.textContent).trim()
  const img = cell.querySelector('img[alt]')
  return img ? clean(img.getAttribute('alt')).trim() : ''
}

/** Is the cell nothing but controls (a Delete button, a row menu)? */
function isControlsOnly(cell) {
  if (!cell.querySelector(CONTROL)) return false
  const copy = cell.cloneNode(true)
  copy.querySelectorAll(CONTROL).forEach((n) => n.remove())
  return !clean(copy.textContent).trim()
}

const plain = (lines) => lines.map((l) => l.map((r) => r.text).join('')).join(' ')

function alignOf(cell, getStyle) {
  const a = styleOf(cell, getStyle)?.textAlign || ''
  if (/right|end/.test(a)) return 'right'
  if (/center/.test(a)) return 'center'
  if (/left|start/.test(a)) return 'left'
  return null
}

/** Does this text read as a number (a price, a percent, a count, a dash for "no value")? */
export function looksNumeric(text) {
  const t = String(text || '').trim()
  if (!t) return false
  return /^[\u2014\u2013-]$/.test(t) || /^[+\-\u2212]?[$\u20AC\u00A3]?\d[\d,]*(\.\d+)?\s?(%|[KMBTx]|R|bps|pts)?$/.test(t)
}

/** The rows of a table section laid on a grid, so a `colspan` or `rowspan` keeps columns true. */
function gridOf(rows) {
  const grid = []
  rows.forEach((tr, r) => {
    grid[r] = grid[r] || []
    let c = 0
    for (const cell of tr.children) {
      const tag = tagOf(cell)
      if (tag !== 'td' && tag !== 'th') continue
      while (grid[r][c]) c += 1
      const cs = Math.max(1, Number(cell.getAttribute('colspan')) || 1)
      const rs = Math.max(1, Number(cell.getAttribute('rowspan')) || 1)
      for (let dr = 0; dr < rs; dr += 1) {
        grid[r + dr] = grid[r + dr] || []
        for (let dc = 0; dc < cs; dc += 1) grid[r + dr][c + dc] = { cell, origin: dr === 0 && dc === 0, span: cs }
      }
      c += cs
    }
  })
  return grid
}

const rowsIn = (table, tag) => [...table.children].filter((n) => tagOf(n) === tag).flatMap((sec) => [...sec.children].filter((n) => tagOf(n) === 'tr'))

/** The heading a table sits under: its caption, else the nearest heading of its own section. */
function captionOf(table, getStyle) {
  const cap = [...table.children].find((n) => tagOf(n) === 'caption')
  if (cap) return plain(readLines(cap, getStyle).lines)
  return ''
}

function headingOf(table, root, getStyle) {
  for (let box = table.parentElement; box && box !== root.parentElement; box = box.parentElement) {
    const before = [...box.children].filter((n) => /^h[1-6]$/.test(tagOf(n)) && (n.compareDocumentPosition(table) & 4))
    if (before.length) return plain(readLines(before[before.length - 1], getStyle).lines)
    if (box === root) break
  }
  return clean(table.getAttribute('aria-label')).trim()
}

/** One `<table>` to `{ caption, columns, rows }`, or null when it shows no row. */
function readTable(table, getStyle) {
  let head = rowsIn(table, 'thead')
  let body = [...rowsIn(table, 'tbody'), ...rowsIn(table, 'tfoot')]
  if (!head.length && !body.length) body = [...table.children].filter((n) => tagOf(n) === 'tr')
  // A table with no <thead> whose first row is all header cells keeps that row as its header.
  if (!head.length && body.length && [...body[0].children].every((c) => tagOf(c) === 'th')) head = [body.shift()]
  body = body.filter((tr) => !isHidden(tr, styleOf(tr, getStyle)))
  if (!body.length) return null

  const headGrid = gridOf(head)
  const headRow = headGrid[headGrid.length - 1] || []
  const bodyGrid = gridOf(body)
  const width = Math.max(headRow.length, ...bodyGrid.map((r) => r.length))
  if (!width) return null

  // A hidden header cell hides its column (the phone fold); with no header, the first row decides.
  const guide = headRow.length ? headRow : bodyGrid[0]
  const hiddenCol = (c) => {
    const slot = guide[c]
    return !!slot && isHidden(slot.cell, styleOf(slot.cell, getStyle))
  }

  const columns = []
  for (let c = 0; c < width; c += 1) {
    if (hiddenCol(c)) continue
    const slot = headRow[c]
    const shown = slot && slot.origin ? plain(readLines(slot.cell, getStyle).lines).replace(CARET, '').trim() : ''
    columns.push({ index: c, text: shown, spoken: slot && slot.origin ? spokenText(slot.cell) : '', align: slot ? alignOf(slot.cell, getStyle) : null })
  }

  const rows = bodyGrid.map((gridRow) => {
    const origins = gridRow.filter((s) => s && s.origin)
    // One cell across the whole row is a band: a group name inside the list, or a "no rows" line.
    if (origins.length === 1 && origins[0].span >= width && width > 1) {
      return { band: plain(readLines(origins[0].cell, getStyle).lines) }
    }
    let no = null
    const cells = columns.map((col, i) => {
      const slot = gridRow[col.index]
      if (!slot || !slot.origin) return { lines: [], align: null, bare: true, header: false }
      const read = readLines(slot.cell, getStyle, { rowNo: i === 0 })
      if (read.no !== null && no === null) no = read.no
      return {
        lines: read.lines, el: slot.cell, align: alignOf(slot.cell, getStyle),
        bare: !read.lines.length, header: tagOf(slot.cell) === 'th',
      }
    })
    return { no, cells }
  }).filter((row) => row.band !== '')

  // A column of controls: no visible header, and no visible text in any row.
  const keep = columns.map((col, i) => !!col.text || rows.some((row) => row.cells && !row.cells[i].bare))
  const kept = columns.filter((_, i) => keep[i])
  if (!kept.length) return null
  for (const row of rows) {
    if (!row.cells) continue
    row.cells = row.cells.filter((_, i) => keep[i]).map((cell) => {
      // A cell with no visible text speaks for itself only when it is not a control.
      if (cell.bare && cell.el && !isControlsOnly(cell.el)) {
        const said = spokenText(cell.el)
        if (said) return { lines: [[{ text: said, color: '', bold: false }]], align: cell.align, header: cell.header }
      }
      return { lines: cell.lines, align: cell.align, header: cell.header }
    })
  }

  const dataRows = rows.filter((row) => row.cells)
  const outColumns = kept.map((col, i) => {
    const texts = dataRows.map((row) => plain(row.cells[i].lines)).filter(Boolean)
    const numeric = texts.length > 0 && texts.filter(looksNumeric).length * 2 > texts.length
    const fromCells = dataRows.map((row) => row.cells[i].align).find(Boolean)
    return { text: col.text || col.spoken || '', align: fromCells || col.align || (i > 0 && numeric ? 'right' : 'left') }
  })
  for (const row of dataRows) row.cells = row.cells.map((cell, i) => ({ lines: cell.lines, align: cell.align || outColumns[i].align, header: cell.header }))
  if (!dataRows.length) return null
  return { caption: captionOf(table, getStyle), columns: outColumns, rows, ...lookOf(body, getStyle) }
}

const solid = (c) => !!c && c !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(c)

/**
 * How the panel draws its rows, read from the page: `rule` is the hairline under a row (its
 * colour; `false` when the panel draws none; `null` when the page did not say), `zebra` the
 * background of every second row when the panel stripes them.
 */
function lookOf(body, getStyle) {
  const cellOf = (tr) => [...(tr?.children || [])].find((c) => /^(td|th)$/.test(tagOf(c)))
  const edge = (el) => {
    const st = el && styleOf(el, getStyle)
    if (!st || !st.borderBottomWidth) return null
    return parseFloat(st.borderBottomWidth) > 0 && st.borderBottomStyle !== 'none' ? (st.borderBottomColor || null) : false
  }
  const fill = (tr) => {
    for (const el of [cellOf(tr), tr]) {
      const c = el && styleOf(el, getStyle)?.backgroundColor
      if (solid(c)) return c
    }
    return ''
  }
  const fromCell = edge(cellOf(body[0]))
  const rule = fromCell || edge(body[0]) || (fromCell === false ? false : null)
  const zebra = body.length > 1 && fill(body[1]) && fill(body[1]) !== fill(body[0]) ? fill(body[1]) : null
  return { rule, zebra }
}

/** "Showing the first 25 of 80" and its kin: the panel saying its list is a cut of a longer one. */
const CUT = /^(Showing|The (top|first|last|newest|latest|biggest|busiest|highest))\b[^.]*\b\d[\d,]*\b[^.]*\bof\b[^.]*\d/i
/** The panel saying it is drawing an older answer because the newest read failed. */
const STALE = /\bShowing the last (list )?read\b/i

/** A paragraph as sentences. No lookbehind: Safari 16.0 to 16.3 cannot parse one, and one bad
 *  pattern would stop this whole module loading there. A decimal point never ends a sentence. */
export function sentencesOf(text) {
  const parts = String(text || '').split(/([.!?])\s+(?=[A-Z0-9"'(])/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    const s = `${parts[i]}${parts[i + 1] || ''}`.trim()
    if (s) out.push(s)
  }
  return out
}

/**
 * What the panel itself says about its list that a share must repeat: that the list was cut, and
 * that it is showing an older read. The words are the panel's own, never rewritten.
 */
export function readPanelNotes(root, { getStyle = defaultGetStyle } = {}) {
  if (!root?.querySelectorAll) return []
  const out = []
  const add = (s) => { const t = s.trim(); if (t && !out.includes(t)) out.push(t) }
  for (const el of root.querySelectorAll('p, span, small, li, div')) {
    if (el.closest('table')) continue
    // Only an element that holds words of its own: a wrapper is read through its children.
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue
    const raw = clean(el.textContent)
    if (!STALE.test(raw) && !/ of /i.test(raw)) continue
    if (!isShown(el, root, getStyle)) continue
    const text = plain(readLines(el, getStyle).lines).trim()
    if (STALE.test(text)) { add(text.length > 240 ? `${text.slice(0, 237)}...` : text); continue }
    for (const sentence of sentencesOf(text)) if (CUT.test(sentence)) add(sentence)
  }
  return out
}

/**
 * Every table the panel shows, as plain rows.
 *
 *   { tables: [{ caption, columns: [{ text, align }], rows: [{ no, cells: [{ lines, align }] } | { band }] }],
 *     notes: [...], rowCount }
 *
 * `rowCount` counts the data rows across the tables: 0 means there is nothing to share.
 */
export function readPanel(root, { getStyle = defaultGetStyle } = {}) {
  const empty = { tables: [], notes: [], rowCount: 0 }
  if (!root?.querySelectorAll) return empty
  const tables = []
  for (const el of root.querySelectorAll('table')) {
    if (el.parentElement?.closest('table') && root.contains(el.parentElement.closest('table'))) continue
    if (!isShown(el, root, getStyle)) continue
    const read = readTable(el, getStyle)
    if (read) tables.push({ ...read, el })
  }
  if (!tables.length) return empty
  // One table needs no heading of its own (the panel's title names it); several each need one.
  const out = tables.map(({ el, ...t }) => ({ ...t, caption: t.caption || (tables.length > 1 ? headingOf(el, root, getStyle) : '') }))
  const rowCount = out.reduce((n, t) => n + t.rows.filter((r) => r.cells).length, 0)
  return { tables: out, notes: readPanelNotes(root, { getStyle }), rowCount }
}

/** A cell's text on one line per shown line. */
export function cellLines(cell) {
  return (cell?.lines || []).map((l) => l.map((r) => r.text).join('').trim()).filter(Boolean)
}
