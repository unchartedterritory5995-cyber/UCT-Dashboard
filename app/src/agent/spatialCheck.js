// ── SPATIAL CONSTRAINT CHECK (#988, AUDIT probe 17): the LAST safety net on a model plan's chart targets ──────────────────
//
// The resolvers in deixis.js decide which chart the words mean. This module does not resolve anything for the plan: it reads
// the spatial CONSTRAINTS the sentence states, on its own geometry, and checks the plan's targets against all of them. Any
// violation → { ask } listing only the cells that satisfy them (never an anchor), and nothing is applied.
//
//   in line L        "the top row", "the left column" (a WHOLE line as the target)  → every target is in that line
//   place P          "the middle one of the top row", "the top row's last chart"    → the target is that cell
//   relation R / A   "beside / next to / above / below / left of / right of the <named> chart" → the target is a neighbour
//                    of the NAMED anchor on that side, and never the anchor itself
//   anchor = click   "the one above this", "the chart beside it"                     → the click is never a target unless
//                    the words ALSO name it ("this one and the one beside it")
//   count N          "both charts", "the two charts …"                                → exactly N charts
//
// ⛔ It only CONSTRAINS: a sentence that states none of these leaves the plan to the screens before it (null). A clause that
// says a chart is fine / left alone / not meant ("the middle of the bottom row looks fine") states no target constraint, and
// a line or place that is a move's destination, a comparison ("like the top row") or a source states none either.
import { ordinalChart, chartsNamedBy, relativeChart, selectedChart, chartRefOf } from './deixis'
import { CLICK_ACT_NP } from './clickRef'

const INERT = /\b(?:fine|alone|already|leave|leaving|left alone|can stay|stays?|stay put|untouched|as (?:it|they) (?:is|are)|don'?t|do not|doesn'?t|not|never|ignore|skip|keep)\b/i
const CLAUSES = /[,;.!?]|\b(?:and then|but|then|while|also|plus|although|though)\b/i
const MOVE = /\b(?:move|moving|shift|drag|slide|swap|put (?:it|this|this one|this chart) (?:in|on|into))\b/i
// a line / place introduced by these is not the change's target (a comparison, a source, a neighbour's anchor, a destination)
const NOT_TARGET_PREP = /\b(?:except(?:\s+for)?|but(?:\s+not)?|other than|apart from|excluding|save for|minus|like|as|than|from|beside|next to|near|above|below|under(?:neath)?|over|beneath|left of|right of|to the (?:left|right) of|on top of|into|onto)\s*$/i

const ROW_WORD = { top: 'first', upper: 'first', first: 'first', bottom: 'last', lower: 'last', last: 'last', middle: 'middle', center: 'middle', centre: 'middle', second: 1, third: 2 }
const COL_WORD = { left: 'first', first: 'first', right: 'last', last: 'last', middle: 'middle', center: 'middle', centre: 'middle', second: 1, third: 2 }
const WHOLE_LINE = /\b(?:the|my)\s+(top|bottom|upper|lower|middle|cent(?:er|re)|first|second|third|last|left|right)\s+(row|column)\b(?!['’]s)/gi
const PLACE_BEFORE = /\b(?:first|second|third|last|middle|cent(?:er|re)|left(?:most)?|right(?:most)?|top(?:most)?|bottom(?:most)?|upper(?:most)?|lower(?:most)?)\s+(?:chart|one|cell|pane|panel|graph)\s+(?:in|of|on|along|from)\s*$/i
// a relation whose anchor is NAMED (not "this / it / the selected one"): "beside the top-left chart", "above the NVDA chart"
const REL_NAMED = /\b(beside|next to|alongside|above|over|on top of|below|under(?:neath)?|beneath|(?:to the |on the )?left of|(?:to the |on the )?right of|(?:one\s+step\s+)?(?:in\s+)?diagonally(?:\s+in(?:wards?)?)?\s+from)\s+(the\s+(?!(?:one|chart)\b)[a-z0-9 -]{1,30}?\s*(?:chart|one|cell|pane|graph|corner))\b/gi
const SIDES = (w) => {
  const s = w.toLowerCase()
  if (/diagonal/.test(s)) return ['diag-in']                      // one step in, toward the board's centre (unseen14 g2-05)
  if (/beside|next to|alongside/.test(s)) return ['left', 'right']
  if (/above|over|on top of/.test(s)) return ['above']
  if (/below|under|beneath/.test(s)) return ['below']
  if (/left of/.test(s)) return ['left']
  return ['right']
}
const COUNT = /\b(?:(both)\s+(?:of\s+)?(?:the\s+)?(?:charts|ones|of them)\b|the\s+(two|three|four|five|six)\s+(?:charts|ones)\b)/i
const N_OF = { two: 2, three: 3, four: 4, five: 5, six: 6 }

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1
const withCell = (charts) => charts.filter(c => c && c.cell)
/** The board's lines across one axis, each sorted along it. */
function linesOf(charts, axis) {
  const all = withCell(charts)
  const key = (c) => (axis === 'row' ? c.cell.y : c.cell.x)
  const along = (c) => (axis === 'row' ? c.cell.x : c.cell.y)
  const keys = [...new Set(all.map(key))].sort((a, b) => a - b)
  return keys.map(k => all.filter(c => key(c) === k).sort((a, b) => along(a) - along(b)))
}
function pickLine(lines, word, axis) {
  const w = String(word).toLowerCase()
  const map = axis === 'row' ? ROW_WORD : COL_WORD
  if ((axis === 'row' && /^(?:left|right)$/.test(w)) || (axis === 'column' && /^(?:top|upper|bottom|lower)$/.test(w))) return null
  const v = map[w]
  if (v === undefined) return null
  if (v === 'first') return lines[0] || null
  if (v === 'last') return lines[lines.length - 1] || null
  if (v === 'middle') return lines.length >= 3 && lines.length % 2 === 1 ? lines[(lines.length - 1) / 2] : null
  return lines[v] || null
}
/** The neighbours of `a` on `side` (the nearest cells sharing its row / column span). */
function neighbours(charts, a, side) {
  if (side === 'diag-in') {
    // the diagonal neighbour toward the board's centre: one row toward it, then one column toward it (each step unique)
    const all = withCell(charts)
    const cx = (Math.min(...all.map(c => c.cell.x)) + Math.max(...all.map(c => c.cell.x + c.cell.w))) / 2
    const cy = (Math.min(...all.map(c => c.cell.y)) + Math.max(...all.map(c => c.cell.y + c.cell.h))) / 2
    const v = neighbours(charts, a, a.cell.y + a.cell.h / 2 < cy ? 'below' : 'above')
    if (v.length !== 1) return []
    return neighbours(charts, v[0], a.cell.x + a.cell.w / 2 < cx ? 'right' : 'left')
  }
  const o = withCell(charts).filter(c => c.ref !== a.ref)
  const xo = (c) => overlaps(c.cell.x, c.cell.x + c.cell.w, a.cell.x, a.cell.x + a.cell.w)
  const yo = (c) => overlaps(c.cell.y, c.cell.y + c.cell.h, a.cell.y, a.cell.y + a.cell.h)
  const nearest = (list, edge, best) => { if (!list.length) return []; const e = best(...list.map(edge)); return list.filter(c => edge(c) === e) }
  if (side === 'above') return nearest(o.filter(c => xo(c) && c.cell.y + c.cell.h <= a.cell.y), c => c.cell.y + c.cell.h, Math.max)
  if (side === 'below') return nearest(o.filter(c => xo(c) && c.cell.y >= a.cell.y + a.cell.h), c => c.cell.y, Math.min)
  if (side === 'left') return nearest(o.filter(c => yo(c) && c.cell.x + c.cell.w <= a.cell.x), c => c.cell.x + c.cell.w, Math.max)
  return nearest(o.filter(c => yo(c) && c.cell.x >= a.cell.x + a.cell.w), c => c.cell.x, Math.min)
}
/** The ONE chart an anchor phrase names by position, order or symbol ("the top-left chart", "the second one", "the NVDA chart"). */
function namedAnchor(phrase, charts) {
  const p = String(phrase).toLowerCase()
  if (/\b(?:this|it|selected|clicked|current|active)\b/.test(p)) return null
  const rows = linesOf(charts, 'row'), cols = linesOf(charts, 'column')
  const h = /\b(left|right)\b/.exec(p)
  const vw = /\b(top|upper)\b/.test(p) ? 'top' : /\b(bottom|lower)\b/.test(p) ? 'bottom' : null
  const hw = h ? h[1] : null
  const mid = /\b(?:middle|cent(?:er|re))\b/.test(p)
  if (vw || hw || mid) {
    // the row and the column the words name; "middle" names the axis the other word does not ("top middle" → the middle column,
    // "middle left" → the middle row), or, alone, whichever axis HAS a middle (both on a 3×3: the centre)
    const midRow = pickLine(rows, 'middle', 'row'), midCol = pickLine(cols, 'middle', 'column')
    const row = vw ? pickLine(rows, vw, 'row') : mid && hw ? midRow : mid ? midRow : null
    const col = hw ? pickLine(cols, hw, 'column') : mid && vw ? midCol : mid ? midCol : null
    if ((vw && !row) || (hw && !col) || (mid && vw && !col) || (mid && hw && !row) || (mid && !vw && !hw && !row && !col)) return null
    let set = withCell(charts)
    if (row) set = set.filter(c => row.includes(c))
    if (col) set = set.filter(c => col.includes(c))
    return set.length === 1 ? set[0] : null
  }
  const ord = ordinalChart(phrase, charts)
  if (ord?.ref) return charts.find(c => c.ref === ord.ref) || null
  const named = chartsNamedBy(phrase, charts)
  return named.size === 1 ? charts.find(c => c.ref === [...named][0]) || null : null
}
/**
 * A relation from a NAMED anchor in the words ("the chart beside the top-left one", "the one above the NVDA chart") → { anchor,
 * hits } (hits = the anchor's neighbours on that side: the chart meant when one) | null. Read by deixis.resolveDeictic too, so
 * the anchor is never taken for the target. (Call-time import cycle with deixis.js: neither module uses the other at load.)
 */
export function namedAnchorRelation(text, charts = []) {
  for (const c of targetClauses(text)) {
    for (const m of c.matchAll(REL_NAMED)) {
      const a = namedAnchor(m[2], charts)
      if (!a) continue
      return { anchor: a.ref, hits: [...new Set(SIDES(m[1]).flatMap(s => neighbours(charts, a, s)).map(x => x.ref))] }
    }
  }
  return null
}
/** The cells of every WHOLE absolute line the words aim at ("the top row", "the left column") — a named set of charts. */
export function wholeLinesNamed(text, charts = []) {
  const out = new Set()
  for (const c of targetClauses(text)) {
    if (MOVE.test(c)) continue
    for (const m of c.matchAll(WHOLE_LINE)) {
      const before = c.slice(0, m.index)
      if (PLACE_BEFORE.test(before) || NOT_TARGET_PREP.test(before)) continue
      const line = pickLine(linesOf(charts, m[2].toLowerCase()), m[1], m[2].toLowerCase())
      for (const x of line || []) out.add(x.ref)
    }
  }
  return out
}
/**
 * For the INSTANT path (fastPath.extractTarget): the target phrase a whole line or a named-anchor relation makes, as a span of
 * `text` to lift off the clause → { start, end, target } | null. A whole line → { all: true, refs } (every cell of it, one
 * change); a named-anchor relation → { chart } (one neighbour) or { ask } (several / none — never the anchor).
 */
export function spatialTargetSpan(text, charts = []) {
  const s = String(text || '')
  const clauses = targetClauses(s)
  if (!clauses.length) return null
  const nar = namedAnchorRelation(s, charts)
  if (nar) {
    const m = new RegExp(`(?:\\bthe\\s+(?:one|chart|cell|pane|graph)\\s+)?${REL_NAMED.source}`, 'i').exec(s)
    if (m) {
      const pool = charts.filter(c => c.ref !== nar.anchor)
      const target = nar.hits.length === 1 ? { chart: nar.hits[0], word: 'relation' }
        : { ask: { text: 'Which chart do you mean?', choices: (nar.hits.length ? charts.filter(c => nar.hits.includes(c.ref)) : pool).map(c => ({ ref: c.ref, label: c.label })) } }
      return { start: m.index, end: m.index + m[0].length, target }
    }
  }
  const refs = wholeLinesNamed(s, charts)
  if (refs.size) {
    for (const m of s.matchAll(WHOLE_LINE)) {
      const line = pickLine(linesOf(charts, m[2].toLowerCase()), m[1], m[2].toLowerCase())
      if (line && line.every(x => refs.has(x.ref))) return { start: m.index, end: m.index + m[0].length, target: refs.size === 1 ? { chart: [...refs][0], word: 'line' } : { all: true, refs: [...refs], line: true } }
    }
  }
  return null
}
// ── CLICK-LINE relations (#988, pl-auto unseen12 families): the click's own row / column, read as a relation FROM the click ──
//   rest      "the rest of / the other charts in / everything else in this row | column" → that line minus the click (a set);
//             "the other chart | one in this row" → the same, one chart (several → asked, never the click)
//   sameOther "same column, other row" (comma / colon / but / and) → the click's column minus the click
//   farEnd    "same row, far end (from this one)", "the other side of the (bottom) row from this one" → the far end of that line
//   corner    "the top | bottom corner on the same side as this one" → that end of the click's column
//   step      "one column right / two rows down from this chart" → that many cells that way
//   appos     "… this one, the first chart in its row" → the click when that place IS the click (an appositive), else asked
const CL_DEIXIS = "(?:this|that|its|my|the\\s+same|the\\s+(?:clicked|selected)(?:\\s+(?:one|chart))?['’]s|this\\s+(?:one|chart)['’]s)"
const CL_REST = new RegExp(`\\b(?:(?:the\\s+)?rest\\s+of|(?:the\\s+)?other\\s+(?:(two|three|four|2|3|4)\\s+)?(chart|one|cell|pane|charts|ones|cells|panes)?\\s*(?:in|of|on|along)|everything\\s+else\\s+(?:in|on|of|along)|(?:all\\s+)?the\\s+others\\s+(?:in|on|of|along))\\s+${CL_DEIXIS}\\s+(row|column)\\b`, 'i')
// (G3) "everything / all the charts in this row | column" — the WHOLE line, the click in it (an exclusion is taken out of it)
const CL_ALL = new RegExp(`\\b(?:everything|all\\s+(?:of\\s+)?(?:the\\s+)?(?:charts|ones|cells|panes))\\s+(?:in|on|along|of)\\s+${CL_DEIXIS}\\s+(row|column)\\b`, 'i')
const N_COUNT = { pair: 2, two: 2, three: 3, four: 4, 2: 2, 3: 3, 4: 4 }
const SIDE_OF = { 'right of': 'right', 'left of': 'left', below: 'below', under: 'below', beneath: 'below', underneath: 'below', above: 'above', over: 'above' }
const CL_SIDE = '(to the right of|to the left of|right of|left of|below|under(?:neath)?|beneath|above|over)'
const CL_COUNTED = new RegExp(String.raw`\bthe\s+(two|three|four|2|3|4)\s+(?:charts|ones|cells|panes)\s+` + CL_SIDE + String.raw`\s+(?:this|it)(?:\s+(?:one|chart))?\b`, 'i')
const CL_LINE_REL = new RegExp(String.raw`\bthe\s+(?:(pair|two|three|four|2|3|4)\s+)?(?:(?:charts|ones|cells|panes)\s+)?(?:directly\s+)?` + CL_SIDE + String.raw`\s+(?:this|that|my|the\s+clicked\s+chart['’]s)\s+(row|column)\b`, 'i')
// "put this row on weekly", "this row except the TSLA one", "the whole of this column": the click's whole line as the object
const CL_THIS_LINE = /(?:^|[,;:]\s*|\b(?:put|make|set|switch|turn|change|flip|get|have)\s+)(?:all\s+of\s+|the\s+(?:whole|entire)\s+(?:of\s+)?)?(?:this|that)\s+(row|column)\b(?!['’]s)(?=\s+(?:except|but|other|apart|excluding|on|to|into|in|at|weekly|daily|monthly|hourly|log|linear|please|$)|\s*[,.;!?]|\s*$)/i
// (H4, probe 19) a TWO-AXIS diagonal from the click: "diagonally below and to the right of this", "up and to the right
// diagonally from this" — that one cell, or none (off the board: never wrapped)
const CL_DIAG2 = /\b(?:diagonally\s+)?(above|below|up|down|under(?:neath)?|over)\s+and\s+(?:to\s+the\s+)?(left|right)(?:\s+diagonally)?\s+(?:of|from)\s+(?:this|it)\b/i
const CL_SAME_OTHER = /\bsame\s+(row|column)\s*[,:;]?\s*(?:(?:but|and)\s+)?(?:the\s+|a\s+)?(?:other|another|different|opposite)\s+(row|column)\b/i
const CL_FAR_END = /\b(?:same\s+(row|column)\s*[,:;]?\s*(?:at\s+)?(?:the\s+)?(?:far|other|opposite)\s+end|(?:the\s+)?(?:other|far|opposite)\s+(?:end|side)\s+of\s+(?:the|this|its|my)\s+(?:(top|bottom|middle|upper|lower|left|right|first|last|same)\s+)?(row|column)(?:\s+(?:from|to)\s+(?:this|it)(?:\s+(?:one|chart))?)?)\b/i
const CL_CORNER = /\b(top|bottom|upper|lower)\s+corner\s+(?:on|in|along|at)\s+the\s+same\s+(?:side|column)\s+as\s+(?:this|it)\b/i
const CL_STEP = /\b(one|1|two|2|three|3)\s+(row|column|cell|chart|spot|place)s?\s+(up|down|left|right)\s+(?:from|of)\s+(?:this|it)\b/i
const CL_APPOS = /\bthis\s+(?:one|chart)\b[^,;.]{0,40}?,\s*the\s+(first|second|third|last|middle|left(?:most)?|right(?:most)?|top(?:most)?|bottom(?:most)?)\s+(?:chart|one)\s+(?:in|of|on)\s+(?:its|this)\s+(row|column)\b/i
const N_WORD = { one: 1, two: 2, three: 3 }
/** A click-line relation in the words (no geometry) → a match with `clickLine: { kind, … }`, or null. */
export function clickLineMatch(text) {
  const s0 = String(text || '')
  // a click-line phrase in a clause that says those charts are fine / can stay / are left alone names no target: blanked out
  const s = s0.split(/([,;.!?]|\b(?:but|and then|then)\b)/i).map(part => (INERT.test(part) ? part.replace(/\S/g, ' ') : part)).join('')
  const tag = (m, clickLine) => (m ? Object.assign(m, { clickLine, input: s0 }) : null)
  let m = CL_APPOS.exec(s)
  if (m) return tag(m, { kind: 'appos', pos: m[1].toLowerCase(), axis: m[2].toLowerCase() })
  // (H1, probe 19) COUNTED plural relations from the click: "the two charts to the left of this one" — the line that way, and
  // exactly that many (a count the board has not is asked)
  m = CL_DIAG2.exec(s)
  if (m) return tag(m, { kind: 'diag2', v: /^(?:above|up|over)$/i.test(m[1]) ? 'above' : 'below', h: m[2].toLowerCase() })
  m = CL_COUNTED.exec(s)
  if (m) return tag(m, { kind: 'counted', n: N_COUNT[m[1].toLowerCase()], dir: SIDE_OF[m[2].toLowerCase().replace(/^to the |^on the /, '')] })
  // (H3, probe 19) a plural relation to a whole LINE: "the charts under this row", "the pair to the left of this column"
  m = CL_LINE_REL.exec(s)
  if (m) return tag(m, { kind: 'lineRel', n: m[1] ? N_COUNT[m[1].toLowerCase()] : null, dir: SIDE_OF[m[2].toLowerCase().replace(/^to the |^on the /, '')], axis: m[3].toLowerCase() })
  m = CL_REST.exec(s)
  if (m) return tag(m, { kind: 'rest', axis: m[3].toLowerCase(), one: !m[1] && !!m[2] && !/s$/i.test(m[2]), n: m[1] ? N_COUNT[m[1].toLowerCase()] : null })
  m = CL_ALL.exec(s) || CL_THIS_LINE.exec(s)
  if (m) return tag(m, { kind: 'all', axis: m[1].toLowerCase() })
  m = CL_SAME_OTHER.exec(s)
  if (m && m[1].toLowerCase() !== m[2].toLowerCase()) return tag(m, { kind: 'sameOther', axis: m[1].toLowerCase() })
  m = CL_FAR_END.exec(s)
  if (m) return tag(m, { kind: 'farEnd', axis: (m[1] || m[3]).toLowerCase(), which: m[2] && m[2].toLowerCase() !== 'same' ? m[2].toLowerCase() : null })
  m = CL_CORNER.exec(s)
  if (m) return tag(m, { kind: 'corner', v: /^(?:top|upper)$/i.test(m[1]) ? 'top' : 'bottom' })
  m = CL_STEP.exec(s)
  if (m) return tag(m, { kind: 'step', n: N_WORD[m[1].toLowerCase()] || Number(m[1]), dir: m[3].toLowerCase() })
  return null
}
/** The click's own line on `axis` (cells sharing its row / column span), in order along it. */
function clickLine(charts, s, axis) {
  const all = withCell(charts)
  const yo = (c) => overlaps(c.cell.y, c.cell.y + c.cell.h, s.cell.y, s.cell.y + s.cell.h)
  const xo = (c) => overlaps(c.cell.x, c.cell.x + c.cell.w, s.cell.x, s.cell.x + s.cell.w)
  return axis === 'row' ? all.filter(yo).sort((a, b) => a.cell.x - b.cell.x) : all.filter(xo).sort((a, b) => a.cell.y - b.cell.y)
}
/** The charts a click-line relation names on this board, from the clicked chart `s` → { hits, plural, onClick }. */
export function clickLineHits(m, charts, s) {
  const k = m?.clickLine
  if (!k || !s?.cell) return { hits: [], plural: false, onClick: false }
  // an exclusion in the same words ("… except SPY") is taken out of a line set
  const ex = (k.kind === 'rest' || k.kind === 'all') ? excludedCharts(m.input, charts, s.ref) : new Set()
  const counted = (hits, n) => (n != null && hits.length !== n ? { hits: [], plural: false, onClick: false, countOff: { said: n, has: hits.length } } : { hits, plural: hits.length > 1, onClick: false })
  if (k.kind === 'rest') { const hits = clickLine(charts, s, k.axis).filter(c => c.ref !== s.ref && !ex.has(c.ref)); return k.n != null ? counted(hits, k.n) : { hits, plural: !k.one, onClick: false } }
  if (k.kind === 'diag2') {
    const v = neighbours(charts, s, k.v)
    const hit = v.length === 1 ? neighbours(charts, v[0], k.h) : []
    return { hits: hit.length === 1 ? hit : [], plural: false, onClick: false, offBoard: !hit.length }
  }
  if (k.kind === 'counted') {
    const hits = []
    let at = s
    for (;;) { const next = neighbours(charts, at, k.dir); if (next.length !== 1) break; hits.push(next[0]); at = next[0] }
    return counted(hits, k.n)
  }
  if (k.kind === 'lineRel') {
    // the line next to the click's line on that side (rows: above / below; columns: left / right); the click's line is the anchor
    const along = k.axis === 'row' ? (k.dir === 'below' || k.dir === 'above') : (k.dir === 'left' || k.dir === 'right')
    if (!along) return { hits: [], plural: false, onClick: false }
    const step = neighbours(charts, s, k.dir)
    if (!step.length) return { hits: [], plural: false, onClick: false }
    const hits = clickLine(charts, step[0], k.axis)
    return counted(hits, k.n)
  }
  if (k.kind === 'all') { const hits = clickLine(charts, s, k.axis).filter(c => !ex.has(c.ref)); return { hits, plural: true, onClick: hits.some(c => c.ref === s.ref) } }
  if (k.kind === 'sameOther') return { hits: clickLine(charts, s, k.axis).filter(c => c.ref !== s.ref), plural: false, onClick: false }
  if (k.kind === 'farEnd') {
    const line = k.which ? pickLine(linesOf(charts, k.axis), k.which, k.axis) : clickLine(charts, s, k.axis)
    if (!line || line.length < 2) return { hits: [], plural: false, onClick: false }
    const pos = (c) => (k.axis === 'row' ? c.cell.x : c.cell.y)
    const lo = pos(line[0]), hi = pos(line[line.length - 1])
    const end = pos(s) <= lo ? line[line.length - 1] : pos(s) >= hi ? line[0] : null
    return { hits: end && end.ref !== s.ref ? [end] : [], plural: false, onClick: false }
  }
  if (k.kind === 'corner') {
    const col = clickLine(charts, s, 'column')
    const c = k.v === 'top' ? col[0] : col[col.length - 1]
    return { hits: c && c.ref !== s.ref ? [c] : [], plural: false, onClick: false }
  }
  if (k.kind === 'step') {
    const side = k.dir === 'up' ? 'above' : k.dir === 'down' ? 'below' : k.dir
    let at = s
    for (let i = 0; i < k.n; i++) { const next = neighbours(charts, at, side); if (next.length !== 1) return { hits: [], plural: false, onClick: false }; at = next[0] }
    return { hits: [at], plural: false, onClick: false }
  }
  if (k.kind === 'appos') {
    const line = clickLine(charts, s, k.axis)
    const p = k.pos.replace(/most$/, '')
    const n = line.length
    const idx = p === 'first' || p === (k.axis === 'row' ? 'left' : 'top') ? 0 : p === 'last' || p === (k.axis === 'row' ? 'right' : 'bottom') ? n - 1
      : p === 'second' ? 1 : p === 'third' ? 2 : p === 'middle' && n % 2 === 1 && n >= 3 ? (n - 1) / 2 : -1
    const hit = line[idx]
    return hit && hit.ref === s.ref ? { hits: [s], plural: false, onClick: true } : { hits: [], plural: false, onClick: false }
  }
  return { hits: [], plural: false, onClick: false }
}

// a relation from the CLICK said plainly ("the chart above this one", "the one to the left of it"): its neighbours on that side
const REL_CLICK = /\b(beside|next to|alongside|above|over|on top of|below|under(?:neath)?|beneath|(?:to the |on the )?left of|(?:to the |on the )?right of)\s+(?:this(?:\s+(?:one|chart))?|it|the (?:selected|clicked) (?:one|chart))\b/i

/** The target-bearing clauses: inert ones ("… looks fine", "leave … alone", "not …") dropped. */
// "everything BUT the bottom row" is an exclusion, never a clause boundary (read as "except")
// ("every chart but the bottom row": a forced question offered the excluded row — the singular "every / each chart" is a set too)
const exceptForm = (t) => String(t || '').replace(/\b(everything|all|charts|ones|them|these|row|column|board|(?:every|each)\s+chart)\s+but\b(?!\s+not\b)/gi, '$1 except')
function targetClauses(text) {
  return exceptForm(text).split(CLAUSES).map(s => s.trim()).filter(s => s && !INERT.test(s))
}
// (H5, probe 19) a clause that only says how a chart already IS ("the chart below it already is", "the two to its right are fine")
// relates nothing: blanked out, position for position, before a relation is read from the words (a negation is NOT blanked — it
// is an exclusion the relation readers keep)
// ROOT CAUSE (d97663ad4f, spatialCheck.blankStated): STATED was a word list ("alone", "as it is", "untouched", …) and blanked
// IMPERATIVE negations of the click ("leave this alone", "keep this as it is") as if they were stated facts. Now a STRUCTURAL
// test: a clause is STATIVE (blanked) only when it has a stative predicate (a copula / "already" / "has|have") and NO imperative
// or negation operator; an imperative negation of the click is its own structure (negatedClick below) and EXCLUDES the click.
// A STATEMENT about a chart: its SUBJECT comes first (a noun phrase: the / those / these / that / they / both / all / a ticker's
// chart …) and then a stative predicate (a copula, "already", "has / have", "stays", "looks"). A clause that starts with the
// change ("weekly for whatever is beneath it") or with a verb is never one, whatever copula a relative clause in it carries.
// ("'s" is a copula only before a state — "it's fine" — never the possessive "it's right side", "this one's row")
const STATIVE_PRED = /\b(?:is|are|was|were|isn['’]t|aren['’]t|already|has|have|stays?|looks?|seems?)\b|['’]re\b|['’]s\s+(?:fine|good|ok(?:ay)?|set|done|already|perfect|great)\b/i
const SUBJECT_FIRST = /^\s*(?:(?:and|but|so|while|though|since)\s+)?(?:the|those|these|that|they|both|all|its|it|each|every)\b/i
const RELATIVE_COPULA = /\b(?:whatever|whichever|which|who|what|that)\s+(?:is|are|was|were)\b/i
const IMPERATIVE_NEG = /^\s*(?:(?:and|but|then|so|or)\s+)?(?:please\s+)?(?:leave|keep|let|don['’]?t|do\s+not|never|not|stop|skip|ignore|exclude|avoid)\b/i
const NEG_OPERATOR = /\b(?:not|never|no)\b|n['’]t\b/i
/** A clause that only STATES how a chart already is ("the chart below it already is", "the two to its right are fine"). */
export const statedClause = (part) => SUBJECT_FIRST.test(part) && STATIVE_PRED.test(part) && !RELATIVE_COPULA.test(part)
  && !IMPERATIVE_NEG.test(part) && !NEG_OPERATOR.test(part)
const CLAUSE_PARTS = /([,;.!?]|\b(?:but|and then|then|and)\b)/i
export function blankStated(text) {
  return String(text || '').split(CLAUSE_PARTS).map(part => (statedClause(part) ? part.replace(/\S/g, ' ') : part)).join('')
}
// (AUDIT probe 3, #988) an IMPERATIVE NEGATION of the click — "leave this alone", "keep this one as it is", "don't touch this
// chart", "don't change the clicked one", "not this one", "never touch it": the operator (leave / keep / let / don't / do not /
// never / not …) governs the click (this / this one / this chart / it / the clicked or selected one / here) as its OBJECT. The
// click is EXCLUDED; the clause names no other chart and relates nothing (blanked for the relation readers, positions kept).
// (#988, pl-grid / AUDIT probe 20) …or by the ACT: "not the one I clicked", "leave the chart I'm on alone" (clickRef.js)
// (AUDIT #1030 T2, probe-24 class) a POSSESSIVE that names a chart stands for the click when the member has one: "leave mine
// alone", "don't touch my chart", "keep my own one as it is". Only a chart noun (one / chart / cell / pane / panel / graph) or
// bare "mine" / "my own" — never "my watchlist", "my settings", "my layout" (not the click). negatedClick only matters when a
// chart is selected (excludedCharts / chartsOutOfPlan read it as `sel && …`), so with no click this changes nothing.
const CLICK_POSS = '(?:mine|my\\s+own(?:\\s+(?:one|chart|cell|pane|panel|graph))?|my\\s+(?:one|chart|cell|pane|panel|graph))'
const CLICK_OBJ = '(?:this(?:\\s+(?:one|chart))?|it|here|the\\s+(?:clicked|selected|current|active)\\s+(?:one|chart)|' + CLICK_POSS + '|' + CLICK_ACT_NP + ')'
// (AUDIT probe 20 b) a STATIVE clause whose subject is the click — "the one I selected stays daily", "this one can stay as it is",
// "the chart I'm on is fine as it is": the click is kept as it is, so it is EXCLUDED (as "leave this alone"). A want ("the one I
// selected should be weekly", "…needs log scale") is not one: that clause is the change, on the click.
// (#988, AUDIT probe 2 "make it weekly, it is right above support") a clause that says where the PRICE is, not how the chart
// should be, never keeps the click as it is. Three guards: (i) the subject NAMES the chart (this one / this chart / the clicked
// one / the one I clicked …), never bare it / this / here, which stand for the stock or its price as often as for the chart;
// (ii) fine / right / ok / good ENDS the clause (optionally "as it is", "the way it is", "where it is", "for now", "already"),
// so "is right above support" is no verdict; (iii) stays / remains is never followed by a price place (above / below / under /
// over / near / around / between / beneath, or at / on a level, support, resistance or an average).
const STAY_SUBJ = '(?:this\\s+(?:one|chart)|the\\s+(?:clicked|selected|current|active)\\s+(?:one|chart)|' + CLICK_POSS + '|' + CLICK_ACT_NP + ')'
const STAY_TAIL = '(?:\\s+(?:as\\s+(?:it\\s+)?is|the\\s+way\\s+it\\s+is|where\\s+it\\s+is|(?:for\\s+)?now|already|too))*'
const PRICE_LEVEL = '(?:the\\s+|its\\s+|a\\s+)?(?:\\$?\\d|support|resistance|highs?|lows?|levels?|(?:trend\\s*)?lines?|(?:day\\s+)?(?:ma|sma|ema|vwap|moving\\s+average)\\b)'
const PRICE_PLACE = '(?:(?:right|just|well|still|firmly|comfortably)\\s+)*(?:above|below|under(?:neath)?|over|beneath|near|around|between|(?:at|on)\\s+' + PRICE_LEVEL + ')'
const STAY_CLICK = new RegExp('^\\s*(?:(?:and|but|so|while|though)\\s+)?' + STAY_SUBJ + '\\s+(?:'
  + '(?:(?:can|should|will|must|may|could)\\s+)?(?:stays?|remains?)\\b(?!\\s+' + PRICE_PLACE + ')[^,;.!?]*'
  + '|(?:is|[\'’]s)\\s+(?:(?:just|already|totally|completely)\\s+)?(?:fine|good|ok(?:ay)?|perfect|right|alright|all\\s+right)\\b' + STAY_TAIL
  + ')\\s*[.!]?\\s*$', 'i')
const NEG_CLICK = new RegExp('^\\s*(?:(?:and|but|then|so|or)\\s+)?(?:please\\s+)?(?:'
  + '(?:leave|keep|let)\\s+' + CLICK_OBJ + '\\b(?!\\s*[\'’]s)(?:\\s+(?:alone|be|as\\s+(?:it\\s+)?is|untouched|unchanged|where\\s+it\\s+is))?'
  + '|(?:don[\'’]?t|do\\s+not|never)\\s+(?:touch|change|move|switch|alter|modify|update|do\\s+anything\\s+to)\\s+' + CLICK_OBJ + '\\b(?!\\s*[\'’]s)'
  + '|not\\s+' + CLICK_OBJ + '\\b(?!\\s*[\'’]s)(?:\\s+(?:though|please))?'
  + ')\\s*[.!]?\\s*$', 'i')
// …and an imperative negation of a RELATION from the click ("leave the charts around it alone", "keep the ones around it as they
// are", "don't touch the one below it", "not the one under it"): its charts are an EXCLUSION SET; the clause names no target and
// relates nothing for the relation readers (blanked), so the rest of the words still say which chart the change is for
const NEG_REL = new RegExp('^\\s*(?:(?:and|but|then|so|or)\\s+)?(?:please\\s+)?(?:leave|keep|let|(?:don[\'’]?t|do\\s+not|never)\\s+(?:touch|change|move|switch|alter|modify)|not)\\s+'
  + '((?:the|those|these)\\s+(?:\\w+\\s+){0,3}?(?:charts?|ones?|cells?|panes?)\\s+(?:around|surrounding|next\\s+to|beside|near|below|under(?:neath)?|beneath|above|over|to\\s+the\\s+(?:left|right)\\s+of|left\\s+of|right\\s+of|on\\s+either\\s+side\\s+of)\\s+(?:it|this(?:\\s+(?:one|chart))?))'
  + '(?:\\s+(?:alone|be|as\\s+(?:it|they)\\s+(?:is|are)|as\\s+is|untouched|unchanged))?\\s*[.!]?\\s*$', 'i')
/** The negated relations in the words → the phrases ("the charts around it"), each an exclusion set. */
export function negatedRelations(text) {
  const out = []
  for (const part of String(text || '').split(CLAUSE_PARTS)) { const m = NEG_REL.exec(part); if (m) out.push(m[1]) }
  return out
}
// (#988, AUDIT control) "keep this one daily, make the others weekly": keep / leave the click AT A SETTING, said against the rest
// of the board, keeps the click as it is (EXCLUDED, as "leave this alone"). Alone ("keep it on log scale") it can be the change
// itself, so it excludes only when the words also name the rest (the others / the rest / everything else / the other charts).
const KEEP_SETTING = '(?:daily|weekly|monthly|hourly|intraday|\\d{1,3}\\s*(?:m|min|mins|minutes?|h|hr|hours?)|(?:log|linear|normal|regular|arithmetic|percent(?:age)?)(?:\\s+scale)?'
  + '|candles?|candlesticks?|bars|(?:a\\s+)?line(?:\\s+chart)?|heikin[\\s-]?ashi|the\\s+same)'
const KEEP_SET_CLICK = new RegExp('^\\s*(?:(?:and|but|then|so|or)\\s+)?(?:please\\s+)?(?:keep|leave)\\s+' + CLICK_OBJ + '\\s+(?:(?:on|at|in)\\s+)?(?:(?:a|the)\\s+)?'
  + KEEP_SETTING + '(?:\\s+(?:as\\s+(?:it\\s+)?is|for\\s+now|too))?\\s*[.!]?\\s*$', 'i')
const REST_WORDS = /\b(?:(?:all\s+)?the\s+(?:rest|others|other\s+(?:ones?|charts?|\w+\s+charts?|two|three|four|five))|everything\s+else|all\s+(?:the\s+)?others|every\s+other\s+(?:one|chart)|the\s+remaining\s+(?:ones?|charts?))\b/i
/** → { excludes: bool, text: the words with each such clause blanked (positions kept) }. */
export function negatedClick(text) {
  let excludes = false
  const rest = REST_WORDS.test(String(text || ''))
  const out = String(text || '').split(CLAUSE_PARTS).map(part => {
    if (NEG_CLICK.test(part) || STAY_CLICK.test(part) || (rest && KEEP_SET_CLICK.test(part))) { excludes = true; return part.replace(/\S/g, ' ') }
    if (NEG_REL.test(part)) return part.replace(/\S/g, ' ')
    return part
  }).join('')
  return { excludes, text: out }
}
/** The words with every inert clause dropped: what names a TARGET (AUDIT probe 18 G5: "…, the QQQ chart next to SPY is fine"). */
export function activeText(text) {
  return targetClauses(text).join(', ')
}

// ── AUDIT probe 18 (#988) ──
// (G3) an EXCLUSION: "everything in this row except SPY", "all the charts but not the QQQ one", "other than this one" — the
// charts it names are never targets (a plan that includes one is asked, on the apply AND the proposal path).
// ⛔ NO LOOKBEHIND (iOS 16.0–16.3, #988 AUDIT L1): "everything / all / … BUT x" is read through exceptForm, which already writes
// every such "but" as "except" — the old look-behind "<scope word> but" alternative could never match its output, so it is gone (equivalence:
// agentNoLookbehind988.test.js). EXCEPT is only ever run on exceptForm(text).
const EXCEPT = /\b(?:except(?:\s+for)?|but\s+not|other\s+than|apart\s+from|excluding|save\s+for|minus)\s+((?:the\s+)?(?:top|bottom|upper|lower|middle|cent(?:er|re)|first|second|third|last|left|right)\s+(?:row|column)|(?:the\s+)?(?:(?:two|three|four|pair|2|3|4)\s+)?(?:(?:charts?|ones?)\s+)?(?:on|at|along)\s+the\s+(?:left|right|top|bottom)(?:\s+(?:side|edge|row|column))?|(?:the\s+)?[A-Za-z0-9 -]{1,30}?)(?=\s+(?:on|to|in|onto|at|for|from|please|thanks|weekly|daily|monthly|hourly)\b|\s*[,.;!?]|\s*$)/gi
/** Every exclusion match in the words (as excludedCharts reads them; the #988 no-lookbehind equivalence rail holds it) */
export const exceptMatches = (text) => [...exceptForm(text).matchAll(EXCEPT)]
// (#988, pl-grid / AUDIT probe 20) the other exclusion forms, read beside EXCEPT (which the equivalence rail holds as it was):
// "instead of / rather than / besides / aside from X", a clause-leading "not X" ("…weekly, not the bottom-left", "not the
// bottom-left — …"), and any operator on the click named by the ACT ("other than the one I'm looking at": its apostrophe is
// outside EXCEPT's phrase). An "X" the board cannot place excludes nothing.
const NEG_EXCEPT = new RegExp('(?:\\b(?:instead\\s+of|rather\\s+than|besides|aside\\s+from|other\\s+than|except(?:\\s+for)?|excluding|apart\\s+from)'
  + '|(?:^|[,;:—–]|\\b(?:and|but))\\s*not(?!\\s+(?:just|only|merely|simply|sure|yet|now|too|so)\\b))\\s+('
  // (AUDIT #1143 T2, subject position) the click named by the ACT is a complete phrase in itself: it ends where the act ends,
  // whatever follows ("…except the one I'm on flips to weekly") — no list of the verbs that may come next
  + CLICK_ACT_NP + '(?![A-Za-z0-9])'
  + '|(?:the\\s+)?[A-Za-z0-9 -]{1,30}?(?=\\s+(?:on|to|in|onto|at|for|from|please|thanks|weekly|daily|monthly|hourly)\\b|\\s*[,.;!?—–]|\\s*$))', 'gi')
// (AUDIT #1143 T2) a WHOLE-BOARD quantifier with "but" AFTER the change: "make every chart weekly but this one", "turn them all
// weekly but the one I clicked", "everything to weekly but mine", "every chart weekly but the QQQ one". exceptForm only reads a
// "but" glued to its scope word ("everything but …"); this reads the separated one, ONLY when (i) the words hold a whole-board
// quantifier and (ii) the "but" is followed by a phrase that names a chart (the click by any name, a possessive, or "the … one /
// chart"), never "but keep the log scale" / "but not yet". Kept OUT of exceptForm so the #988 no-lookbehind equivalence rail
// (EXCEPT on exceptForm) is untouched; read only by excludedCharts and withoutExclusions.
const WHOLE_BOARD = /\b(?:everything|every\s+(?:chart|one|cell|pane)|each\s+(?:chart|one|cell|pane)|all\s+(?:of\s+)?(?:them|these|the\s+(?:charts|cells|panes|others)|my\s+charts|charts|cells|panes|four|three|six|nine|two)|(?:them|these|charts)\s+all)\b/i
const SEP_BUT = new RegExp('\\bbut\\s+(?!not\\b)('
  + 'this(?:\\s+(?:one|chart))?|' + CLICK_POSS + '|' + CLICK_ACT_NP + '|the\\s+(?:[A-Za-z0-9-]+\\s+){1,3}?(?:one|chart|cell|pane)'
  + ')(?=\\s+(?:on|to|in|onto|at|for|from|please|thanks|weekly|daily|monthly|hourly)\\b|\\s*[,.;!?—–]|\\s*$)', 'gi')
const sepButMatches = (text) => (WHOLE_BOARD.test(String(text || '')) ? [...String(text || '').matchAll(SEP_BUT)] : [])
/** The words with every exclusion phrase blanked (EXCEPT and NEG_EXCEPT): a position said only to EXCLUDE a chart ("…, not the
 * left one") is no place the request is aimed at (deixis.screenUnnamedTargets' said positions). */
export function withoutExclusions(text) {
  let s = exceptForm(text)
  for (const m of [...s.matchAll(EXCEPT), ...s.matchAll(NEG_EXCEPT), ...sepButMatches(s)]) s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length)
  return s
}
// (AUDIT control) NEG_EXCEPT's "X" excludes only a CHART or a POSITION — a chart noun, a place / order word, the click, or a ticker
// on the board. A value or a setting ("weekly, not daily", "log, not linear", "show the 50, not the 200") is a contrast on the
// change itself and excludes nothing.
const NEG_CHART_WORD = /\b(?:one|ones|charts?|cells?|panes?|panels?|graphs?|top|bottom|upper|lower|left|right|middle|cent(?:er|re)|corner|first|second|third|fourth|last|row|column|this|that|it)\b/i
// (AUDIT #1143 T2, subject position) "everything except mine goes weekly": an exception phrase can run on into the predicate
// ("mine flips", "this one rolls over to …"), and members use ANY verb there. So the click is decided by the phrase's START, never
// by a list of what may follow: a phrase that BEGINS with a click name (the act, a possessive, this one / this chart, the clicked
// / selected one) names the click. Bare "this" counts only as the WHOLE phrase ("except this", never "except this week's …").
// ⛔ WRONG-TARGET GUARD: a click name followed by a possessive or a RELATION re-aims the phrase at ANOTHER chart ("except this
// one's neighbour", "except mine next to it", "the one I clicked to the left of AMD"): never the click. Which chart it is, this
// reader cannot say — so never the click silently and never nothing (a plan there would run): 'reaimed' → UNPLACED (asked).
// The re-aim is read from what follows the click name INSIDE the phrase AND after it in the words (`tail`): the exception readers
// stop their phrase before "to / on / from …", so "to the left of AMD" or "across | from SPY" is often outside it.
const CLICK_PREFIX = new RegExp('^(?:' + CLICK_ACT_NP + '|' + CLICK_POSS + '|(?:the\\s+)?this\\s+(?:one|chart)|the\\s+(?:selected|clicked)\\s+(?:one|chart)|(?:the\\s+)?this(?=\\s*$))(?![A-Za-z0-9])', 'i')
const REAIMED = /^\s*(?:['’]s\b|(?:of|next(?:\s+to)?|beside|besides|above|below|beneath|under(?:neath)?|over|near|nearest|around|across(?:\s+from)?|opposite|diagonal(?:ly)?|adjacent\s+to|left\s+of|right\s+of|to\s+the\s+(?:left|right)\s+of|neighbou?rs?|next\s+door)\b)/i
/** 'click' | 'reaimed' | null — the exception phrase's START names the click (whatever predicate follows), unless re-aimed. */
const clickRole = (phrase, tail = '') => {
  const p = String(phrase || '').trim()
  const m = CLICK_PREFIX.exec(p)
  if (!m) return null
  return REAIMED.test(`${p.slice(m[0].length)} ${String(tail || '')}`.replace(/^\s+/, ' ')) ? 'reaimed' : 'click'
}
const tailOf = (m) => String(m.input || '').slice(m.index + m[0].length)
function negNamesAChart(phrase, charts) {
  if (clickRole(phrase) || NEG_CHART_WORD.test(phrase)) return true
  const words = phrase.toUpperCase().split(/[^A-Z0-9.]+/).filter(Boolean)
  return charts.some(c => c?.symbol && words.includes(String(c.symbol).toUpperCase()))
}
/** The charts an exclusion in the words names (by symbol, position, order, or "this one" = the click). */
export function excludedCharts(text, charts = [], sel = null) {
  const out = new Set()
  // the exception PHRASES a reader below placed (added a chart or UNPLACED), normalized — matched by phrase, not by index: the
  // readers run on exceptForm(text), the unplaced scan on the words as said
  const placed = []
  let adds = 0
  const add = out.add.bind(out)
  out.add = (x) => { adds++; return add(x) }
  const negs = [...exceptForm(text).matchAll(NEG_EXCEPT)].filter(m => negNamesAChart(m[1].trim(), charts))
  for (const m of [...exceptMatches(text), ...negs, ...sepButMatches(text)]) {
    const a0 = adds
    try { readException(m) } finally { if (adds > a0) placed.push(normPhrase(m[1])) }
  }
  // (AUDIT #1143 follow-up 2) an exception the readers could NOT place but whose words NAME A CHART — "except the one next to
  // mine", "apart from this one's neighbour", "other than the chart I opened" — was silently nothing, so the chart the member
  // excluded was NOT protected (a plan on it ran). Now it is UNPLACED: the plan is asked. Only when the excepted words name a
  // chart (a chart noun, a relation / neighbour, a possessive for the click, "this one", a place word, or "'s"); a value or a
  // time ("except on Fridays", "except volume", "except the 50 day", "excluding after-hours") still excludes nothing.
  // ⛔ read on the words AS SAID, never exceptForm: exceptForm writes "the same column BUT the other row" as "column except …",
  // which is a line relation, not an exception (agentLineRelations)
  for (const k of String(text || '').matchAll(EXC_KW)) {
    const w = normPhrase(k[1])
    if (placed.some(ph => ph && (w.startsWith(ph) || ph.startsWith(w)))) continue
    if (!CHARTISH.test(k[1])) continue
    // a TICKER in the excepted words is the board's to place (master policy: a ticker the board does not show excludes nothing)
    // — only a PLAIN ticker reference ("the TSLA one"); a ticker's possessive or a relation from it ("SPY's neighbour", "the one
    // beside SPY") names ANOTHER chart and stays unplaced
    if (/\b[A-Z]{1,5}\b(?!['’]s)/.test(k[1].replace(/\bI\b/g, '')) && !/['’]s\b|\b(?:next|beside|above|below|beneath|under|over|near|around|across|opposite|diagonal\w*|kitty|adjacent|neighbou?rs?|left|right)\b/i.test(k[1])) continue
    // a RELATION from the click that the relation reader resolves ("the one above this one", "diagonally across from this one",
    // "kitty-corner from this one") is placed by spatialConstraints' relation readers (agentEveryExceptSet) — not unplaced here
    if (sel && relativeChart(k[1], charts, sel)?.hits?.length) continue
    add(UNPLACED)
  }
  out.add = add
  return out
  function readException(m) {
    const phrase = m[1].trim()
    const role = clickRole(phrase, tailOf(m))
    if (role === 'click') { if (sel) out.add(sel); return }
    if (role === 'reaimed') { out.add(UNPLACED); return }
    const wl = /^(?:the\s+)?(top|bottom|upper|lower|middle|cent(?:er|re)|first|second|third|last|left|right)\s+(row|column)$/i.exec(phrase)
    if (wl) {
      const line = pickLine(linesOf(charts, wl[2].toLowerCase()), wl[1].toLowerCase().replace('upper', 'top').replace('lower', 'bottom'), wl[2].toLowerCase())
      if (line) { for (const c of line) out.add(c.ref) } else out.add(UNPLACED)
      return
    }
    const side = /^(?:the\s+)?(?:(two|three|four|pair|2|3|4)\s+)?(?:charts?\s+|ones?\s+)?(?:on|at|along)\s+the\s+(left|right|top|bottom)(?:\s+(?:side|edge|row|column))?$/i.exec(phrase)
    if (side) {
      const axis = /^(?:left|right)$/i.test(side[2]) ? 'column' : 'row'
      const ls = linesOf(charts, axis)
      const line = /^(?:left|top)$/i.test(side[2]) ? ls[0] : ls[ls.length - 1]
      const n = side[1] ? N_COUNT[side[1].toLowerCase()] : null
      if (line && (n == null || line.length === n)) { for (const c of line) out.add(c.ref) } else out.add(UNPLACED)
      return
    }
    if (/^(?:the\s+)?(?:this(?:\s+(?:one|chart))?|it|the\s+(?:selected|clicked)\s+(?:one|chart))$/i.test(phrase)) { if (sel) out.add(sel); return }
    const a = namedAnchor(/\b(?:chart|one)$/i.test(phrase) ? phrase : `${phrase} chart`, charts) || namedAnchor(phrase, charts)
    if (a) { out.add(a.ref); return }
    // (#988, AUDIT control) a position that fits SEVERAL charts ("not the left one" on a 2×2): every chart it fits is excluded —
    // never none (a plan there would run) and never the whole plan asked (the click elsewhere is still meant)
    const pw = String(phrase).toLowerCase().match(/\b(?:top|bottom|upper|lower|left|right)\b/g)
    if (pw && /^(?:the\s+)?(?:(?:top|bottom|upper|lower|left|right)[\s-]*){1,2}(?:one|chart|cell|pane|panel|graph|side)?s?$/i.test(phrase)) {
      const parts = pw.map(w => w.replace('upper', 'top').replace('lower', 'bottom'))
      const fit = charts.filter(c => c.position && parts.every(p => String(c.position).split('-').includes(p)))
      if (fit.length) { for (const c of fit) out.add(c.ref); return }
    }
    // ⛔ (pl-auto u14-g3-05) a ticker on SEVERAL charts ("this row except the TSLA one", TSLA twice on the board) is the one in
    // the line the request is scoped to; none or several there → UNPLACED (the plan is asked). Never silently no exclusion.
    const multi = symbolCharts(phrase, charts)
    if (multi.length > 1) {
      const scope = scopeLine(text, charts, sel)
      const inScope = scope ? multi.filter(c => scope.includes(c)) : []
      out.add(inScope.length === 1 ? inScope[0].ref : UNPLACED)
    }
  }
}
// an exception KEYWORD and the words it governs, up to the clause's end, on the words AS SAID. "but" is a keyword only glued to a
// WHOLE-BOARD word ("everything but …", "every chart but …") — never after "row" / "column" (a line relation) or a value.
// NOT "instead of" / "rather than": measured, those are value contrasts or target swaps ("the weekly timeframe instead of the
// chart one", "a line instead of candles"), never an exclusion from a set.
const EXC_KW = /\b(?:except(?:\s+for)?|apart\s+from|other\s+than|excluding|besides|aside\s+from|save\s+for|minus|but\s+not|(?:everything|all|them|these|(?:every|each)\s+chart)\s+but)\s+([^,.;!?—–]{1,60})/gi
const normPhrase = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// those words name a CHART: a chart noun, a neighbour / relation, the click's own names, a place word, or a possessive 's OF A
// CHART — after a chart noun / "mine" ("this one's neighbour") or an all-caps TICKER ("SPY's neighbour"); never any word's 's
// ("except Apple's earnings day", "other than Friday's close" are dates / values, not charts)
const CHARTISH_WORDS = new RegExp('\\b(?:one|ones|charts?|cells?|panes?|panels?|graphs?|neighbou?rs?|next\\s+to|beside|adjacent|opposite|'
  + 'mine|my\\s+(?:own|one|chart|cell|pane|panel|graph)|this\\s+(?:one|chart)|top|bottom|upper|lower|corner|row|column)\\b'
  + '|\\b(?:one|chart|cell|pane|panel|graph|mine)[\'’]s\\b', 'i')
const TICKER_POSS = /\b[A-Z]{1,5}['’]s\b/
const CHARTISH = { test: (s) => CHARTISH_WORDS.test(s) || TICKER_POSS.test(s) }
/** The charts showing a ticker the phrase names, when that ticker is on more than one chart ([] otherwise). */
function symbolCharts(phrase, charts) {
  const bySym = new Map()
  for (const c of charts) { const k = String(c?.symbol || '').toUpperCase(); if (k) bySym.set(k, [...(bySym.get(k) || []), c]) }
  for (const [sym, list] of bySym) {
    if (list.length < 2) continue
    const re = new RegExp(`(?:^|[^A-Za-z0-9.])${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, sym.length <= 2 ? '' : 'i')
    if (re.test(phrase)) return list
  }
  return []
}
/** The one line a request is scoped to: "this row / column" (the click's), or an absolute "the top row", "the left column". */
function scopeLine(text, charts, sel) {
  const s = String(text || '')
  const t = /\bthis\s+(row|column)\b/i.exec(s)
  if (t && sel) return linesOf(charts, t[1].toLowerCase()).find(l => l.some(c => c.ref === sel)) || null
  const w = /\bthe\s+(top|bottom|upper|lower|middle|cent(?:er|re)|first|second|third|last|left|right)\s+(row|column)\b/i.exec(s)
  if (w) return pickLine(linesOf(charts, w[2].toLowerCase()), w[1].toLowerCase().replace('upper', 'top').replace('lower', 'bottom'), w[2].toLowerCase())
  return null
}
/** An exclusion the board cannot place ("except the three on the left" with two there): every plan is asked. */
export const UNPLACED = '\u0000unplaced'
// (G4) "the SPY chart on weekly, and the one to ITS right": a relation's possessive / pronoun anchor after a clause that names
// exactly ONE chart (by symbol, position or order) is THAT chart — never the click
const ANAPHOR = /\b(?:its|it)\b/i
/** The anchor a relation in the words is read from: a chart named in an earlier clause when the relation says "its / it", else the click. */
export function relationAnchor(text, charts = [], sel = null) {
  // ("X weekly AND the one to its right": a plain "and" separates the named chart from the relation too)
  const parts = String(text || '').split(/[,;.!?]|\b(?:and|then|but|while|also|plus)\b/i).map(s => s.trim()).filter(Boolean)
  for (let i = 1; i < parts.length; i++) {
    if (!ANAPHOR.test(parts[i]) || /\bthis\b/i.test(parts[i])) continue
    for (let j = i - 1; j >= 0; j--) {
      if (INERT.test(parts[j]) || /\b(?:this|it)\b/i.test(parts[j])) break
      const named = [...chartsNamedBy(parts[j], charts)]
      if (named.length === 1) return named[0]
      if (named.length > 1) break
    }
  }
  return sel
}

/**
 * The constraints the words state over a board → { allowed: Set|null, excluded: Set, count: N|null, plural: bool, notes }.
 * `allowed` null = the words state no target set (the plan is left to the screens before this one).
 */
export function spatialConstraints(text, charts = [], sel = null) {
  const out = { allowed: null, excluded: new Set(), count: null, plural: false, why: [] }
  const add = (refs, why) => { out.allowed = out.allowed || new Set(); for (const r of refs) out.allowed.add(r); out.why.push(why) }
  const clauses = targetClauses(text)
  for (const c of clauses) {
    if (MOVE.test(c)) continue
    // P: an absolute place in a line (either order) — the resolver's own reading of the words, checked on this geometry below
    const ord = ordinalChart(c, charts)
    if (ord?.line) {
      const before = c.slice(0, ord.match.index)
      if (!NOT_TARGET_PREP.test(before)) add(ord.ref ? [ord.ref] : [], 'place')
    }
    // L: a WHOLE absolute line ("the top row") that is not the line of a place ("the middle one of the top row")
    for (const m of c.matchAll(WHOLE_LINE)) {
      const before = c.slice(0, m.index)
      if (PLACE_BEFORE.test(before) || NOT_TARGET_PREP.test(before)) continue
      const line = pickLine(linesOf(charts, m[2].toLowerCase()), m[1], m[2].toLowerCase())
      add(line ? line.map(x => x.ref) : [], 'line')
      out.plural = out.plural || (line?.length || 0) > 1
    }
    // R from a NAMED anchor: the anchor's neighbours on that side; the anchor itself never
    for (const m of c.matchAll(REL_NAMED)) {
      const a = namedAnchor(m[2], charts)
      if (!a) continue
      const hits = SIDES(m[1]).flatMap(s => neighbours(charts, a, s)).map(x => x.ref)
      add(hits, 'relation')
      out.excluded.add(a.ref)
    }
    const n = COUNT.exec(c)
    if (n) out.count = n[1] ? 2 : N_OF[n[2].toLowerCase()]
  }
  // the click as a relation's ANCHOR ("the one above this"): never a target unless the words also name it as one
  // (G4) "the SPY chart …, and the one to its right": the relation is read from THAT chart (a target itself), not the click
  const anchor = relationAnchor(text, charts, sel)
  if (anchor && anchor !== sel) {
    const rel = relativeChart(text, charts, anchor)
    if (rel?.hits?.length) { add(rel.hits.map(c => c.ref), 'relation-named'); add([anchor], 'named') }
  } else if (sel) {
    const rel = relativeChart(text, charts, sel)
    if (rel && rel.alsoClick && rel.match?.clickLine && rel.hits?.length) add(rel.hits.map(c => c.ref), 'line-click')
    if (rel && !rel.alsoClick && !rel.negated) {
      const hits = (rel.hits || []).map(c => c.ref)
      // the click is the anchor — unless the relation lands ON it ("the first chart in this row" with the first one clicked)
      if (!hits.includes(sel)) out.excluded.add(sel)
      // a PLAIN side relation from the click ("the chart above this one"; no count, walk or line in it), read on this module's
      // own geometry: the target is a neighbour on that side. Any other relation's reading is the resolver's (its hits).
      const s = charts.find(c => c.ref === sel && c.cell)
      const m = s ? clauses.map(c => REL_CLICK.exec(c)).find(Boolean) : null
      const x = rel.match || {}
      const plain = m && !rel.plural && !['walk', 'line', 'farLine', 'corner', 'sameBut', 'diagonal', 'step', 'farEnd', 'neighbours', 'unplaced', 'clickLine'].some(k => x[k])
        && !/\b(?:two|three|four|five|[2-9]|second|third|fourth|next[-\s]but[-\s]one|both|all|every|diagonal(?:ly)?|corner|across|opposite)\b/i.test(String(text || ''))
        && !/\b(?:up|down)\s+and\s+(?:to\s+the\s+)?(?:left|right)\b|\b(?:left|right)\s+and\s+(?:up|down)\b/i.test(String(text || ''))
      if (plain) add(SIDES(m[1]).flatMap(side => neighbours(charts, s, side)).map(x => x.ref), 'relation-click')
      else if (hits.length) add(hits, 'relation-click')
    }
  }
  // (G3) an exclusion is never a target, whatever else the words name
  for (const r of excludedCharts(text, charts, sel)) out.excluded.add(r)
  // (AUDIT probe 3) "leave this alone …", "don't touch this chart …": the click is excluded, whatever the plan
  if (sel && negatedClick(text).excludes) out.excluded.add(sel)
  // "… leave the ones around it alone", "not the one under it": a negated RELATION — its charts are excluded
  if (sel) { const rel = relativeChart(text, charts, sel); if (rel?.negated) for (const c of rel.excluded || []) out.excluded.add(c.ref) }
  const s0 = sel ? charts.find(c => c.ref === sel && c.cell) : null
  if (s0) for (const phrase of negatedRelations(text)) {
    const all = /\b(?:around|surrounding|next\s+to|beside|near|on\s+either\s+side\s+of)\b/i.test(phrase)
    const hits = all ? ['left', 'right', 'above', 'below'].flatMap(d => neighbours(charts, s0, d)) : (relativeChart(phrase, charts, sel)?.hits || [])
    for (const c of hits) out.excluded.add(c.ref)
  }
  return out
}

// (#988, AUDIT ruling option 2) EVERY CHART EXCEPT …: a quantifier ("every chart", "all the charts", "everything", "all of them")
// followed by an exclusion (a chart, a line, a side, a ticker, the click, or a RELATION to the click) names a SET: the quantified
// charts minus what the exclusion places. A relation inside the exclusion ("except the one diagonally across from this") makes the
// click that relation's anchor, but the click is still one of "every chart": it is in the set. It is in the set when, and only
// when, the quantifier covers it — an UNSCOPED quantifier. A quantifier scoped by a relation or a line ("every chart below this
// one …") covers only that scope, and the click, its anchor, is never in it. → { refs, excluded } or null (not this family, or an
// exclusion the board cannot place).
const EVERY_Q = /\b(?:every(?:\s+single)?\s+(?:chart|one|panel|pane|cell|graph)|everything|each\s+(?:chart|one)|all\s+(?:of\s+)?(?:the\s+|my\s+|these\s+|those\s+)?(?:charts|ones|panels|panes|graphs|cells)|all\s+of\s+them|all\s+(?:\d|two|three|four|five|six|seven|eight|nine)(?:\s+charts|\s+of\s+them)?)\b/i
const EXCEPT_WORD = /\b(?:except(?:\s+for)?|but\s+not|other\s+than|apart\s+from|aside\s+from|excluding|save\s+for|minus|besides)\b/i
const BOARD_PP = /\b(?:on|in|across)\s+(?:the|my|this)\s+(?:board|screen|layout|grid|page|workspace|dashboard)\b/gi
const SCOPE_WORD = /\b(?:above|below|under|over|beneath|underneath|left|right|next|beside|near|row|column|side|other|others|else|around|across|opposite|diagonal\w*|top|bottom|upper|lower|middle|cent(?:er|re)|corner|this|that|it|these|those)\b/i
const REL_TO_CLICK = /\b(?:above|below|under|over|beneath|underneath|left|right|next|beside|near|nearest|closest|adjacent|across|opposite|diagonal\w*|corner|around|surrounding|kitty|catty)\b/i
const CLICK_WORD = new RegExp('\\b(?:this|it|its|here)\\b|' + CLICK_ACT_NP, 'i')
export const quantifierCoversClick = (scoped) => !scoped
export function everyExceptSet(text, charts = [], sel = null) {
  const t = exceptForm(text)
  const q = EVERY_Q.exec(t)
  if (!q) return null
  const after = q.index + q[0].length
  const ex = EXCEPT_WORD.exec(t.slice(after))
  if (!ex) return null
  const seg = t.slice(after, after + ex.index).replace(BOARD_PP, ' ')
  const phrase = t.slice(after + ex.index).split(/[,;.!?]|\s+(?:and|then)\s+/i)[0]
  const excluded = new Set(excludedCharts(text, charts, sel))
  if (sel && negatedClick(text).excludes) excluded.add(sel)
  // a RELATION to the click inside the exclusion ("except the one diagonally across from this"): its target is excluded; a
  // relation the board cannot place is no reading of this family (null: the gates ask as before)
  if (sel && REL_TO_CLICK.test(phrase) && CLICK_WORD.test(phrase)) {
    const rel = relativeChart(phrase, charts, sel)
    const hits = ((rel?.negated ? rel.excluded : rel?.hits) || []).map(c => c.ref).filter(r => r !== sel)
    if (!hits.length) return null
    for (const r of hits) excluded.add(r)
  }
  if (!excluded.size || excluded.has(UNPLACED)) return null
  // the quantifier decides the pool: unscoped, it covers the whole board (the click included); scoped, only the charts that
  // scope places, and never the click (its anchor)
  let pool = charts
  if (!quantifierCoversClick(SCOPE_WORD.test(seg))) {
    const sc = spatialConstraints(t.slice(0, after + ex.index), charts, sel)
    if (!sc.allowed?.size) return null
    pool = charts.filter(c => sc.allowed.has(c.ref) && c.ref !== sel)
  }
  const set = pool.filter(c => !excluded.has(c.ref))
  if (!set.length || set.length === charts.length) return null
  return { refs: set.map(c => c.ref), excluded: [...excluded] }
}

/**
 * The plan without its chart-backed ops on a chart the words EXCLUDE (each text read on its own: the request, and a question's
 * own request on its answer) → { ops, dropped }. An exclusion the board cannot place is the constraint check's (asked), not this.
 */
export function withoutExcludedCharts(ops, texts, { host, getTargetKind, getCapability }) {
  const charts = host?.charts?.list?.() || []
  if (charts.length < 2 || !Array.isArray(ops) || !ops.length) return { ops, dropped: 0 }
  const sel = selectedChart(host)
  const ex = new Set()
  for (const t of new Set((texts || []).filter(x => typeof x === 'string' && x.trim()))) {
    for (const r of excludedCharts(t, charts, sel)) ex.add(r)
    for (const r of spatialConstraints(t, charts, sel).excluded) ex.add(r)
  }
  ex.delete(UNPLACED)
  if (!ex.size) return { ops, dropped: 0 }
  let dropped = 0
  const keep = []
  for (const o of ops) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    if (kind && !cap.query) {
      const snap = (kind.list(host) || []).find(s => s.ref === o.target)
      const chart = snap ? chartRefOf(kind, snap) : null
      if (chart && ex.has(chart)) { dropped++; continue }
    }
    // (AUDIT, #988 GO) a change that lands on charts named in its ARGS — an indicator Save's `addTo`, run later as follow-ups
    // that never pass through execute — loses the excluded ones too
    if (Array.isArray(o?.args?.addTo) && o.args.addTo.some(r => ex.has(String(r).replace(/^[a-z]+:/i, '')))) {
      const addTo = o.args.addTo.filter(r => !ex.has(String(r).replace(/^[a-z]+:/i, '')))
      dropped += o.args.addTo.length - addTo.length
      keep.push({ ...o, args: { ...o.args, addTo } })
      continue
    }
    keep.push(o)
  }
  return { ops: dropped ? keep : ops, dropped }
}

/**
 * The final check on a model plan (useAgent, after the deictic and unnamed-target screens). → null (every target satisfies
 * every constraint, or there are none) | { ask: { text, choices } } (a violation: nothing runs).
 */
export function checkSpatialConstraints({ host, ops, text, pickedRefs = [], getTargetKind, getCapability }) {
  if ((pickedRefs || []).some(Boolean)) return null                         // the member picked from UCT's own question
  const charts = host?.charts?.list?.() || []
  if (charts.length < 2) return null
  const sel = selectedChart(host)
  const k = spatialConstraints(text, charts, sel)
  if (!k.allowed && !k.excluded.size && !k.count) return null
  const planned = new Set()
  let first = null                                                          // the plan's first chart-backed kind (for the choices)
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    const kind = cap ? getTargetKind(cap.target) : null
    if (!kind || cap.query) continue
    const list = kind.list(host) || []
    const snap = list.find(s => s.ref === o.target)
    const chart = snap ? chartRefOf(kind, snap) : null
    if (!chart) continue
    planned.add(chart)
    if (!first) first = { kind, list }
  }
  if (!planned.size) return null
  const bad = [...planned].filter(c => (k.allowed && !k.allowed.has(c)) || k.excluded.has(c))
  if (k.excluded.has(UNPLACED)) bad.push(UNPLACED)
  const countOff = k.count != null && planned.size !== k.count
  if (!bad.length && !countOff) return null
  const ok = charts.filter(c => (!k.allowed || k.allowed.has(c.ref)) && !k.excluded.has(c.ref))
  const pool = new Set((ok.length ? ok : charts.filter(c => !k.excluded.has(c.ref))).map(c => c.ref))
  // the choices are entries of the plan's own target kind (a chart, or a chart's indicators entry), as the screens before offer
  const choices = first.list.filter(s => pool.has(chartRefOf(first.kind, s))).map(s => ({ ref: s.ref, label: s.label }))
  return { ask: { text: k.plural || countOff ? 'Which charts do you mean? Your words name these:' : 'Which chart do you mean? Pick one:', choices },
    violation: { bad, countOff, why: k.why } }
}
