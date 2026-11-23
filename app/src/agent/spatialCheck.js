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
import { chartsLandedOn } from './chartLanding'
import { tickerChanged, namedTickers } from './chartRail'

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
  // (pl-exclhole) every exclusion OBJECT first, read on the words alone (any capitalized ticker counts as one): "except SPY, QQQ
  // and NVDA" names none of the three as a target (the keyword phrase below stops at the comma)
  let s = exceptForm(withoutExclusionObjects(text, syntacticBoard(text)))
  // (H-RDR-1 follow-up) an anchor-relative exclusion first, WHOLE: the "except X" blank below stops at "to" / "on", and would
  // leave "… to AMD" / "… to NVDA's right" — the anchor — read as a place or a ticker the request aims at
  s = blankAnchorRel(s, anchorRelSpans(s))
  for (const m of [...s.matchAll(EXCEPT), ...s.matchAll(NEG_EXCEPT), ...sepButMatches(s)]) s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length)
  // (hotfix) a negated-ticker clause ("…, but leave NVDA's alone") names no place either
  for (const m of [...s.matchAll(NEG_CUE_RE), ...s.matchAll(NEG_ANY_RE), ...s.matchAll(NEG_STAY_RE)]) {
    if (negTickerRefs(m[0]).length) s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length)
  }
  // (H-RDR-1) …nor a negated chart clause ("…, but leave the top-left one alone"): the place it names is excluded, not aimed at
  return blankNegChartRefs(s)
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
// (calc-TF AUDIT ask 5) "every chart except NVDA's" / "… except NVDA's chart": EXCEPT's phrase class has no apostrophe (the #988
// equivalence rail holds it as it is), so a BARE ticker possessive was never placed — it fell to the unplaced scan and the ask
// OFFERED the very chart the member excluded. Read here, on the words as said, only when NOTHING follows the possessive but
// "chart" / "one" and the clause's end (a neighbour or relation — "SPY's neighbour" — stays unplaced, as before).
const EXCEPT_TICKER_POSS = /\b(?:except(?:\s+for)?|apart\s+from|aside\s+from|besides|other\s+than|excluding|but\s+not|save\s+for|minus)\s+((?:the\s+)?[A-Za-z]{1,5}['’]s(?:\s+(?:chart|one))?)(?=\s+(?:on|to|in|onto|at|for|from|please|thanks|weekly|daily|monthly|hourly)\b|\s*[,.;!?]|\s*$)/gi
const tickerPossMatches = (text) => [...String(text || '').matchAll(EXCEPT_TICKER_POSS)]
// (hotfix, ticker-possessive targeting) a NEGATED TICKER clause beside a change on the board: "…, but leave NVDA's alone",
// "…, skip NVDA's", "…; dont touch NVDA", "Not the NVDA chart though.", "hands off the NVDA chart", "Leave NVDA out of it.",
// "spare NVDA and …", "…, NVDA's can stay as it is". The cue (leave / keep / skip / not / hands off / ignore / don't touch /
// exclude / spare / without …) governs a TICKER reference — "NVDA's (chart | one)", "the NVDA one | chart", or a bare ticker
// the board shows — as its whole object, at a clause's start (after , ; : . ! ? — – or but / and / then / so / though …) or,
// for "without" / "with the exception of", anywhere. Only TICKER objects are read here (a position, a line, the click and a
// relation keep their own readers); a value or an indicator ("keep the RSI", "don't touch the axis", "skip to the next bar",
// "leave it on weekly") is no ticker reference and reads nothing. Each reference is PLACED on the board's symbols:
//   one chart shows it → excluded; several → UNPLACED (asked) and every one of them never offered;
//   none, and it is a POSSESSIVE ("leave Apple's alone") → UNPLACED (it names a chart the board cannot place: asked);
//   none, and a plain ticker → nothing (master policy: a ticker the board does not show is no chart to protect).
const NEG_NOUN = String.raw`(?:chart|one|cell|pane|panel|graph)`
const NEG_TOK = String.raw`[A-Za-z][A-Za-z0-9]{0,5}(?:\.[A-Za-z0-9]{1,2})?`
const NEG_PTOK = String.raw`[A-Za-z][A-Za-z0-9]{0,11}`                // a possessive may be a company ("Microsoft's": asked)
// ⛔ PRODUCTION 11-13: "my" is a determiner like "the" — "leave my NVDA chart alone", "leave my NVDA alone" were read as NO
// exclusion (the reference had to start at the ticker), so a plan that also touched NVDA ran there
const NEG_DET = String.raw`(?:(?:the|my)\s+)`
const NEG_REF1 = String.raw`${NEG_DET}?${NEG_PTOK}['’]s(?:\s+${NEG_NOUN})?|${NEG_DET}${NEG_TOK}\s+${NEG_NOUN}|(?:my\s+)?${NEG_TOK}(?:\s+${NEG_NOUN})?`
const NEG_REFS = String.raw`(?:${NEG_REF1})(?:\s*(?:,|&|\band\b|\bor\b|\bnor\b)\s*(?:${NEG_REF1}))*`
const NEG_START = String.raw`(?:^|[,;:.!?—–(]|\b(?:and|but|then|so|though|although|while|also|plus|or|just|now)\b)\s*(?:(?:please|just|also|then|and|but|so|now|oh|ok(?:ay)?)\s+)*`
const NEG_DONT = String.raw`(?:don['’]?t|dont|do\s+not|never|please\s+don['’]?t|no\s+need\s+to)\s+(?:touch|change|modify|alter|update|switch|mess\s+with|bother\s+with|include|do\s+anything\s+(?:to|with)|(?:apply|add)\s+(?:it|this|that|them)\s+to|put\s+(?:it|this|that|them)\s+on)`
const NEG_CUE = String.raw`(?:leave(?:\s+(?:alone|out))?|keep(?:\s+out)?|skip|ignore|exclude|spare|hands\s+off(?:\s+of)?|not(?:\s+(?:on|for|to|in|with))?|${NEG_DONT})`
const NEG_TAIL = String.raw`(?:\s+(?:alone|be|out(?:\s+of\s+(?:it|this|that|them|this\s+one))?|as\s+(?:it\s+|they\s+)?(?:is|are|was)|as\s+is|untouched|unchanged|the\s+same|where\s+(?:it\s+is|they\s+are)|though|please|thanks|for\s+now|this\s+time|too))*`
// keep / leave AT A SETTING ("keep NVDA on daily") excludes only beside the whole board or the rest (alone it can be the change)
const NEG_AT = String.raw`(?:\s+(?:(?:on|at|in)\s+)?(?:(?:a|the)\s+)?${KEEP_SETTING}(?:\s+(?:as\s+(?:it\s+)?is|for\s+now|too))?)`
const NEG_END = String.raw`(?=\s*(?:[,;:.!?—–)]|$)|\s+(?:and|but|then|though|while|so)\b)`
const NEG_STAY = String.raw`(?:(?:can|should|will|may|must|could)\s+)?(?:stays?|remains?)(?:\s+(?:as\s+(?:it\s+)?is|as\s+is|the\s+same|unchanged|untouched|put|where\s+it\s+is|${KEEP_SETTING}|on\s+${KEEP_SETTING}))?|(?:is|['’]s)\s+(?:(?:just|already)\s+)?(?:fine|good|ok(?:ay)?|perfect|alright)(?:\s+(?:as\s+(?:it\s+)?is|as\s+is|the\s+way\s+it\s+is))?`
const NEG_CUE_RE = new RegExp(String.raw`${NEG_START}(${NEG_CUE})\s+(${NEG_REFS})(${NEG_AT})?${NEG_TAIL}${NEG_END}`, 'gi')
const NEG_ANY_RE = new RegExp(String.raw`\b(without|with\s+the\s+exception\s+of)\s+(${NEG_REFS})${NEG_TAIL}${NEG_END}`, 'gi')
const NEG_STAY_RE = new RegExp(String.raw`${NEG_START}()(${NEG_REFS})\s+(?:${NEG_STAY})${NEG_END}`, 'gi')
// the loose form for the UNPLACED net: a cue and whatever it governs to the clause's end ("leave SPY's neighbour alone")
const NEG_NET_RE = new RegExp(String.raw`${NEG_START}(${NEG_CUE}|without|with\s+the\s+exception\s+of)\s+([^,;:.!?—–]{1,60}?)${NEG_TAIL}${NEG_END}`, 'gi')
export const LOWER_STOP = /^(?:all|now|one|out|any|are|for|the|and|low|big|key|fun|run|see|has|two|new|top|it|on|be|so|or|go|me|us|we|my|an|a|to|in|at|by|of|up|is|no|do|own|way|day|bar|bars|log|this|that|them|these|those|rest|else|time|week|line|axis|grid|row|rows|both|each|mine|here|there|today|again|weekly|daily|monthly|hourly|chart|charts|ones)$/i
/** Each ticker reference a negated-ticker clause governs → [{ phrase, tok, poss, index, input }]. */
export function negTickerRefs(text, charts = []) {
  const s = String(text || '')
  const syms = new Set(charts.map(c => String(c?.symbol || '').toUpperCase()).filter(Boolean))
  const wide = REST_WORDS.test(s) || WHOLE_BOARD.test(s)
  const out = []
  const read = (m, refs, at) => {
    if (at && !wide) return
    const cue = String(m[1] || '').toLowerCase()
    if (/^keep$/.test(cue) && !wide && m[0].trim().endsWith(refs.trim())) return       // a bare "keep X" is no exclusion alone
    for (const r of refs.split(/\s*(?:,|&|\band\b|\bor\b|\bnor\b)\s*/i).filter(Boolean)) {
      const x = new RegExp(String.raw`^${NEG_DET}?(?:(${NEG_PTOK})(['’]s)|(${NEG_TOK}))(?:\s+${NEG_NOUN})?$`, 'i').exec(r.trim())
      if (!x) continue
      const tok = x[1] || x[3], poss = !!x[2], up = tok.toUpperCase()
      const onBoard = syms.has(up) && (tok === up || (tok.length >= 3 && !LOWER_STOP.test(tok)))
      const tickerish = onBoard || (/^[A-Z][A-Z0-9.]{0,5}$/.test(tok) && tok !== 'I') || (poss && /^[A-Z]/.test(tok))
      if (!tickerish) continue
      out.push({ phrase: r.trim(), tok: up, poss, onBoard, index: m.index, input: s })
    }
  }
  for (const m of s.matchAll(NEG_CUE_RE)) read(m, m[2], m[3])
  for (const m of s.matchAll(NEG_ANY_RE)) read(m, m[2], null)
  for (const m of s.matchAll(NEG_STAY_RE)) read(m, m[2], null)
  return out
}
// ── H-RDR-1: a negated CHART clause whose object is NOT a ticker ──
// ROOT CAUSE: the negated-clause reader above (NEG_CUE_RE / NEG_STAY_RE → negTickerRefs) only ever read TICKER objects, and the
// click reader (NEG_CLICK) only a fixed few verbs. So "add RSI to every chart, but leave the top-left one alone", "skip the
// first chart", "don't touch chart 2", "hands off this one", "keep the bottom row the same", "the upper left one stays as it is"
// excluded NOTHING and a plan on that chart ran. This reads the SAME cues (leave … alone / as is / be / untouched, keep … the
// same, skip, ignore, exclude, spare, hands off, don't touch / change / modify …, not, without, … stays / is fine) governing ANY
// chart reference — a position, a line, a side, an ordinal ("the second chart", "chart 3", "chart three"), the click by any
// name, a pronoun — and places it with the SAME phrase resolver the "except X" readers use (excludedCharts' readException).
// Ticker objects stay with negTickerRefs. What is UNRESOLVED (→ UNPLACED, the plan is asked) is decided in excludedCharts.
// The cue governs a LIST of references ("leave the top one and the bottom one alone") up to its clause's end; the list ends at
// the first piece that is not a reference ("skip the first chart and make the rest weekly": "make the rest weekly" ends it).
const NEG_GEN_RE = new RegExp(String.raw`${NEG_START}(${NEG_CUE}|without|with\s+the\s+exception\s+of)\s+([^,;:.!?—–()]{1,90})`, 'gi')
const NEG_GEN_STAY_RE = new RegExp(String.raw`${NEG_START}((?:(?:the|this|that|these|those|my|both)\s+[^,;:.!?—–()]{1,60}?|chart\s+(?:#\s*)?[A-Za-z0-9]{1,6}(?:\s+(?:and|&)\s+(?:the\s+)?[^,;:.!?—–()]{1,40}?)?|mine|my\s+own))\s+(?:${NEG_STAY}|stay(?:\s+(?:as\s+(?:they\s+)?are|the\s+same|unchanged|untouched|put))?|are\s+(?:fine|good|ok(?:ay)?)(?:\s+as\s+(?:they\s+)?are)?)${NEG_END}`, 'gi')
// where a cue's clause ends inside the run the regex took (a clause conjunction; "and" is a list word, read piece by piece)
const GEN_CLAUSE_END = /\s+(?:but|then|though|although|while|so|because|since|plus|also)\b/i
// a piece's trailing tail words ("alone", "as it is", "the same", "out of it", "on daily" …)
const GEN_TAIL = new RegExp(String.raw`^(.*?)((?:\s+(?:alone|be|out(?:\s+of\s+(?:it|this|that|them|this\s+one))?|as\s+(?:it\s+|they\s+)?(?:is|are|was)|as\s+is|untouched|unchanged|the\s+same|where\s+(?:it\s+is|they\s+are)|though|please|thanks|for\s+now|this\s+time|too|either))*)$`, 'i')
const GEN_AT = new RegExp(String.raw`^(.*?)\s+(?:(?:on|at|in)\s+)?(?:(?:a|the)\s+)?${KEEP_SETTING}(?:\s+(?:as\s+(?:it\s+)?is|for\s+now|too))?$`, 'i')
const STRONG_TAIL = /\b(?:alone|be|untouched|unchanged|as\s+(?:it\s+|they\s+)?(?:is|are|was)|as\s+is|the\s+same|out|where\s+(?:it\s+is|they\s+are))\b/i
const NUM_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const PLACE_W = String.raw`(?:top|bottom|upper|lower|left|right|middle|cent(?:er|re)|top[\s-]?left|top[\s-]?right|bottom[\s-]?left|bottom[\s-]?right|upper[\s-]?left|upper[\s-]?right|lower[\s-]?left|lower[\s-]?right|left[\s-]?hand|right[\s-]?hand|leftmost|rightmost|topmost|bottommost)`
const ORD_W = String.raw`(?:first|second|third|fourth|fifth|sixth|last|1st|2nd|3rd|4th|5th|6th)`
const NOUN_W = String.raw`(?:ones?|charts?|cells?|panes?|panels?|graphs?|rows?|columns?|side|corner)`
// a piece that IS a chart reference, whole: a place / order / line / side noun phrase, "chart N", the click by any name, a pronoun
const REF_SHAPE = new RegExp('^(?:'
  + String.raw`(?:the|my|this|that|these|those|both)\s+(?:(?:${PLACE_W}|${ORD_W}|two|three|four|selected|clicked|current|active|other|same)[\s-]+){0,3}${NOUN_W}(?:\s+(?:on|in|at|along)\s+the\s+(?:left|right|top|bottom)(?:\s+(?:side|edge|row|column))?)?`
  + String.raw`|(?:the|my)\s+(?:${PLACE_W}[\s-]*){1,2}`
  + String.raw`|(?:the\s+)?(?:(?:two|three|four|pair|2|3|4)\s+)?(?:(?:charts?|ones?)\s+)?(?:on|at|along)\s+the\s+(?:left|right|top|bottom)(?:\s+(?:side|edge|row|column))?`
  + String.raw`|chart\s+(?:#\s*)?[1-9]|mine|my\s+own(?:\s+${NOUN_W})?|it|this|that|them|those|these`
  + '|' + CLICK_ACT_NP
  + ')$', 'i')
const LOOSE_DET = /^(?:the|my|this|that|these|those|both|any|either)\s+\S/i
const BARE_ORD_PLACE = new RegExp(String.raw`^(?:the|my)\s+(?:${ORD_W}|${PLACE_W})$`, 'i')
const CHART_NOUN = /\b(?:ones?|charts?|cells?|panes?|panels?|graphs?|rows?|columns?|corner)\b/i
const BARE_PRONOUN = /^(?:it|this|that|them|those|these)$/i
const GEN_RELATION = /\b(?:next\s+to|beside|besides|alongside|above|below|beneath|under(?:neath)?|over|near(?:est)?|around|surrounding|across|opposite|diagonal(?:ly)?|adjacent|kitty|catty|left\s+of|right\s+of|neighbou?rs?|either\s+side)\b|['’]s\b/i
/** "chart three" / "chart #2" → "chart 3" (ORD_RE reads digits only) */
export const ordinalDigits = (p) => String(p || '').replace(/\bchart\s+(?:#\s*)?(one|two|three|four|five|six|seven|eight|nine)\b/gi, (_, w) => `chart ${NUM_WORD[w.toLowerCase()]}`)
  // …and "the rightmost / left-hand / topmost chart" is the right / left / top one (namedAnchor reads the plain place words)
  .replace(/\b(left|right|top|bottom)(?:most|[\s-]hand)\b/gi, '$1')
/** Each non-ticker chart reference a negated clause governs → [{ phrase, cue, strong, loose, index, end }]. */
export function negChartRefs(text, charts = []) {
  const s = String(text || '')
  const wide = REST_WORDS.test(s) || WHOLE_BOARD.test(s)
  const out = []
  const read = (m, cue0, body0, stay) => {
    const cue = String(cue0 || '').toLowerCase().replace(/\s+/g, ' ')
    let body = String(body0 || '')
    const ce = GEN_CLAUSE_END.exec(body)
    if (ce) body = body.slice(0, ce.index)
    const pieces = body.split(/\s*(?:&|\band\b|\bor\b|\bnor\b)\s*/i).map(x => x.trim())
    const got = []
    const bodyAt = stay ? m.index : m.index + m[0].length - String(body0 || '').length
    let pos = 0
    for (let i = 0; i < pieces.length; i++) {
      let p = pieces[i]
      if (!p) break
      pos = body.indexOf(p, pos) + p.length
      const t = GEN_TAIL.exec(p)
      let core = (t ? t[1] : p).trim(), tail = t ? t[2] : ''
      let at = false
      const a = GEN_AT.exec(core)
      if (a && !tail) { core = a[1].trim(); at = true }
      core = ordinalDigits(core.replace(/^(?:the\s+)?(?:whole|entire)\s+/i, 'the '))
      const last = i === pieces.length - 1 || !!tail || at
      // a bare order / place word listed before a piece with the noun ("the first and the last chart") is that chart
      if (i < pieces.length - 1 && BARE_ORD_PLACE.test(core)) core = `${core} chart`
      const shaped = REF_SHAPE.test(core)
      // a piece that names a chart but is no plain reference ("the one next to the top-left one") is read only when it is the
      // cue's whole object: right after the cue, ending at a tail or at the clause's end, and a noun phrase under a determiner
      // ("dont touch NVDA Top-left chart (SPY)" — a request run on into a choice's label — is no such phrase)
      // (a phrase that runs on into a destination — "the top-left one to weekly" — is a negated action, negActionRefs' to read)
      const loose = !stay && !shaped && i === 0 && last && CHART_NOUN.test(core) && LOOSE_DET.test(core)
        && !/\s(?:to|into|onto|from|with|for)(?:\s|$)/i.test(core.replace(/\b(?:next|close|adjacent|closest|nearest)\s+to\b|\bto\s+the\s+(?:left|right)\s+of\b|\b(?:across|away)\s+from\b/gi, ' '))
      if (!shaped && !loose) break
      got.push({ phrase: core, tail, at, loose, end: stay ? m.index + m[0].length : bodyAt + pos })
      if (tail || at || loose) break
    }
    if (!got.length) return
    const tail = got[got.length - 1].tail || (stay ? ' as is' : '')
    const at = got[got.length - 1].at
    if (at && !wide) return                                       // "keep the top one on daily" alone can be the change itself
    const strong = STRONG_TAIL.test(tail) || /^(?:leave out|keep out|skip|ignore|exclude|spare|hands off(?: of)?|without|with the exception of)$/.test(cue) || /^(?:don|do not|never|please don|no need)/.test(cue) || at || stay
    if (/^keep$/.test(cue) && !strong && !wide) return            // a bare "keep X" is no exclusion alone
    if (/^leave$/.test(cue) && !STRONG_TAIL.test(tail) && !wide) return   // "leave the top one on" / "leave it there": no exclusion
    for (const g of got) {
      if (BARE_PRONOUN.test(g.phrase) && !STRONG_TAIL.test(tail) && !stay) continue    // "skip that", "ignore it": no chart named
      if (negTickerRefs(`not ${g.phrase}`, charts).length) continue                  // a ticker: negTickerRefs reads it
      if (ACT_COMPLEMENT.test(g.phrase)) continue        // "don't touch the other charts": a complement, read by the rest readers
      // a loose phrase naming a board ticker ("hands off the NVDA chart Top-left chart (SPY)…", a request run on into a choice's
      // label) is the ticker reader's and the net's, never placed here by its place words
      if (g.loose && g.phrase.split(/[^A-Za-z0-9.]+/).some(w => w && charts.some(c => String(c?.symbol || '') === w))) continue
      out.push({ phrase: g.phrase, cue, strong, loose: g.loose, stay, index: m.index, end: got[got.length - 1].end })
    }
  }
  for (const m of s.matchAll(NEG_GEN_RE)) read(m, m[1], m[2], false)
  // "<the chart> stays as it is / is fine": the stative keep is itself the cue
  for (const m of s.matchAll(NEG_GEN_STAY_RE)) read(m, 'stays', m[1], true)
  return out
}
// ── H-RDR-1 (AUDIT follow-up): a NEGATED IMPERATIVE WITH A DESTINATION ──
// "don't change the top-left one to weekly", "do not add RSI to the second chart", "never hide volume on the NVDA chart", "do not
// close chart 2": the member forbids an ACTION on a chart. negChartRefs reads a cue whose object IS the chart ("don't touch X");
// here any verb is negated and the chart sits anywhere in its clause (object, destination, "on / to / from X"). On master a model
// plan doing exactly the forbidden op on that chart was EXECUTED (every chart-backed family measured). Every chart reference in
// the negated clause is a chart the change must never land on: excluded (placed by the same resolver), or UNPLACED when it cannot
// be placed — so a plan on it is asked, never run. Not a negation of the change: "don't forget / hesitate / worry / wait", "never
// mind". The clause ends at a clause conjunction or at "and <command verb>" ("don't touch the top one and make the rest weekly").
// The cue: don't / do not / never / no need to, and (AUDIT T2) the formal ones — refrain from, under no circumstances, on no
// account, by no means (each optionally "should / must … you"). (a4) A SERIAL verb stays under the negation: "don't go and change
// X", "don't go ahead and …", "don't try and / to …", "don't come and …", "don't bother to …", "don't dare …", "never ever …" — the
// governed verb is the one after it (a new positive command is "<clause>, and <verb> …" with the negation behind it).
// (C, AUDIT T2 r2) an optional run of courtesy / intensifier words before the cue: "kindly do not …", "absolutely under no
// circumstances …", "I really don't want you to …" (the run is words only: it never crosses a comma)
const NEG_COURTESY = String.raw`(?:(?:please|kindly|really|absolutely|seriously|definitely|just|simply|truly|honestly|totally|certainly|positively|strictly|actually)\s+){0,3}`
const NEG_ACT_CUE = String.raw`${NEG_COURTESY}(?:(?:i\s+${NEG_COURTESY})?(?:don['’]?t|dont|do\s+not)|never|no\s+need\s+to|refrain\s+from|(?:under\s+no\s+circumstances|on\s+no\s+account|by\s+no\s+means)(?:\s+(?:should|must|may|can|will|are)\s+(?:you|we|it))?)`
const NEG_SERIAL = String.raw`(?:(?:go|come)\s+(?:ahead\s+)?(?:and\s+)?|try\s+(?:and|to)\s+|bother\s+(?:to\s+)?|dare\s+(?:to\s+)?|even\s+(?:think\s+about\s+|try\s+to\s+)?|ever\s+)?`
const NEG_ACT_RE = new RegExp(String.raw`${NEG_START}(${NEG_ACT_CUE})\s+${NEG_SERIAL}(?!(?:forget|hesitate|worry|mind|wait|be|let|need|have|know|see|think|understand|get\s+me\s+wrong)\b)([A-Za-z]+)\b([^,;:.!?—–()]{0,100})`, 'gi')
// (a3) an ASIDE set off by commas between the cue (or its verb) and what it governs — "don't, if you can help it, change the top
// one", "never change, under any circumstances, the SPY chart" — is no clause break: blanked (position for position) before the
// negated clause is read. An aside is short (≤ 7 words), never starts with a conjunction (", and switch …" is a new command) and
// names no chart (", the QQQ one, …" is a list, not an aside).
const ASIDE_RE = new RegExp(String.raw`\b(${NEG_ACT_CUE}(?:\s+${NEG_SERIAL}[A-Za-z]+)?)(\s*,\s*(?!(?:and|but|then|so|or|nor|also|plus)\b)[^,;:.!?—–()]{1,48}?\s*,)`, 'gi')
function blankAsides(s, charts) {
  const syms = charts.map(c => String(c?.symbol || '')).filter(Boolean)
  let out = s
  for (const m of s.matchAll(ASIDE_RE)) {
    const aside = m[2].replace(/^\s*,|,\s*$/g, '').trim()
    if (aside.split(/\s+/).length > 7) continue
    ACT_NP.lastIndex = 0
    if (ACT_NP.test(aside) || syms.some(t => new RegExp(String.raw`(?:^|[^A-Za-z0-9.])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`).test(aside))) continue
    const at = m.index + m[1].length
    out = out.slice(0, at) + ' '.repeat(m[2].length) + out.slice(at + m[2].length)
  }
  ACT_NP.lastIndex = 0
  return out
}
const ACT_NEXT_COMMAND = /\s+(?:and|&)\s+(?:then\s+)?(?:please\s+)?(?:put|make|set|switch|change|add|move|turn|show|hide|remove|give|apply|take|drop|flip|close|delete|draw|plot|open|reset|replace|use|do|swap|load|bring)\b/i
// (the click by the act comes first: "the one I clicked" is that whole phrase, never "the one")
const ACT_NP = new RegExp(String.raw`(?:${CLICK_ACT_NP})|\b(?:the|my|this|that|these|those|both)\s+(?:[A-Za-z0-9#'’-]+\s+){0,3}?(?:charts?|ones?|cells?|panes?|panels?|graphs?|rows?|columns?)\b(?!['’]s)|\bchart\s+(?:#\s*)?(?:[1-9]|one|two|three|four|five|six|seven|eight|nine)\b|^\s*(?:it|this)\b(?!['’]s)|\bmine\b`, 'gi')
// a complement of the negated chart is no chart the clause names ("don't touch the other charts", "the rest")
// ("the other chart", singular on a board of several, is no complement: it names one chart the board cannot place — asked)
const ACT_COMPLEMENT = /\b(?:others|rest|remaining|else|every|all|each)\b|\bother\s+(?:[A-Za-z-]+\s+)?(?:charts|ones|cells|panes|panels|graphs)\b/i
/** The chart references a negated imperative's clause names → [{ phrase, tok, shaped, index, end }] (tok: a board ticker). */
export function negActionRefs(text, charts = []) {
  const s = blankAsides(String(text || ''), charts)
  const syms = [...new Set(charts.map(c => String(c?.symbol || '').toUpperCase()).filter(Boolean))]
  const out = []
  for (const m of s.matchAll(NEG_ACT_RE)) {
    let body = String(m[3] || '')
    const ce = GEN_CLAUSE_END.exec(body)
    if (ce) body = body.slice(0, ce.index)
    const nc = ACT_NEXT_COMMAND.exec(body)
    if (nc) body = body.slice(0, nc.index)
    const at = m.index + m[0].length - String(m[3] || '').length
    const end = at + body.length
    const seen = []
    for (const r of body.matchAll(ACT_NP)) {
      let phrase = ordinalDigits(r[0].trim())
      if (ACT_COMPLEMENT.test(phrase)) continue
      // a RELATION after the noun ("the one below it", "the chart next to NVDA"): the whole relation is the reference (it names
      // ANOTHER chart than its anchor) — placed only as a relation from the click, else UNPLACED
      const after = body.slice(r.index + r[0].length)
      const relTail = /^\s+(?:next\s+to|beside|alongside|above|below|beneath|under(?:neath)?|over|near(?:est)?|around|surrounding|across|opposite|diagonal(?:ly)?|adjacent|left\s+of|right\s+of|to\s+the\s+(?:left|right)\s+of|on\s+either\s+side)\b/i.test(after)
      if (relTail) phrase = `${phrase}${after}`.trim()
      seen.push([r.index, relTail ? body.length : r.index + r[0].length])
      const tok = relTail ? null : syms.find(t => new RegExp(String.raw`(?:^|[^A-Za-z0-9.])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, t.length <= 2 ? '' : 'i').test(phrase)) || null
      out.push({ phrase, tok, shaped: !relTail && REF_SHAPE.test(phrase), relation: relTail, index: m.index, end })
      if (relTail) break
    }
    // a bare board ticker in the clause ("don't add RSI to SPY", "never switch NVDA to weekly")
    for (const t of syms) {
      const re = new RegExp(String.raw`(?:^|[^A-Za-z0-9.$])\$?(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![A-Za-z0-9])`, t.length >= 3 ? 'gi' : 'g')
      for (const x of body.matchAll(re)) {
        const i = x.index + x[0].length - x[1].length
        if (seen.some(([a, b]) => i >= a && i < b)) continue
        if (x[1] !== t && (t.length < 3 || LOWER_STOP.test(x[1]))) continue
        out.push({ phrase: x[1], tok: t, shaped: false, bare: true, index: m.index, end })
      }
    }
  }
  // (B, AUDIT T2 r2) FAIL SAFE: a negation whose scope ENDS AT A COMMA before it has governed anything — the cue (or the cue and
  // its verb) followed directly by a comma that is no short aside ("don't, <a long aside>, change the top one", "never change,
  // <…>, the SPY chart") — cannot say what it forbids. Every chart the rest of its sentence names may be the one: UNPLACED (asked),
  // never left to run. Not a cue whose verb is no action ("don't worry, …", "never mind, …").
  for (const m of s.matchAll(NEG_DANGLE_RE)) {
    const restAt = m.index + m[0].length
    const stop = /[.!?;]/.exec(s.slice(restAt))
    const rest = s.slice(restAt, stop ? restAt + stop.index : s.length)
    if (!namesAChartRef(rest, syms)) continue
    out.push({ phrase: rest.trim(), dangling: true, index: m.index, end: restAt + rest.length })
  }
  return out
}
const NEG_DANGLE_RE = new RegExp(String.raw`${NEG_START}(${NEG_ACT_CUE})(?:\s+${NEG_SERIAL}(?!(?:forget|hesitate|worry|mind|wait|be|let|need|have|know|see|think|understand|get)\b)[A-Za-z]+)?\s*,`, 'gi')
/** Does the phrase name a chart: a chart noun phrase, "chart N", a click name, a place / order word, or a board ticker? */
function namesAChartRef(text, symsUpper = []) {
  const s = String(text || '')
  ACT_NP.lastIndex = 0
  const np = ACT_NP.test(s)
  ACT_NP.lastIndex = 0
  return np || /\b(?:the|my)\s+(?:top|bottom|upper|lower|left|right|middle|cent(?:er|re)|first|second|third|fourth|last)\b/i.test(s)
    || symsUpper.some(t => new RegExp(String.raw`(?:^|[^A-Za-z0-9.])\$?${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, t.length >= 3 ? 'i' : '').test(s))
}
// (b9, AUDIT T2) an ADDITIVE exclusion after an exclusion's own clause — "…, but leave the top-left one alone, and the bottom one
// too", "…; skip chart 2, and chart 4 as well", "don't change the top one to weekly, or the bottom one either", "…, and also the NVDA
// chart": the list goes on past the first clause's tail. Read ONLY right after a clause that is itself an exclusion (a negation /
// exception / keep cue in it) and only as a bare reference with an additive marker (too / as well / also / either, or "and also …"):
// "make the top one weekly, and the bottom one too" (no exclusion before it) and ", and switch the bottom one to weekly" (a new
// command) are never read. Each reference is placed like any other exclusion's object, or UNPLACED.
const ADD_OBJ = String.raw`(?:(?:the|my|this|that)\s+[^,;:.!?—–()]{1,40}?|chart\s+(?:#\s*)?[A-Za-z0-9]{1,6}|\$?[A-Z][A-Z0-9]{0,4}(?:['’]s)?(?:\s+(?:chart|one))?|mine)`
// (A, AUDIT T2 r2) the tail follows a clause break ([,;—–], optionally with a conjunction) OR, with no punctuation, a bare
// conjunction: "…leave X alone and the bottom one too", "don't touch X and also Y". A positive command after "and" ("and set Y to
// weekly") never fits ADD_OBJ: it starts with its verb.
const ADD_RE = new RegExp(String.raw`(?:[,;—–]\s*(?:(?:and|&|plus|or|nor)\s+)?|\s+(?:and|&|plus|or|nor)\s+)(also\s+)?(${ADD_OBJ})(?:\s+(too|as\s+well|also|either))?\s*(?=[,;.!?—–]|\s+(?:and|but|then|so)\b|$)`, 'g')
const EXCLUSION_CLAUSE = /\b(?:leave|leaving|keep|keeping|skip|skipping|ignore|exclude|excluding|spare|hands\s+off|except|apart\s+from|other\s+than|besides|aside\s+from|but\s+not|not|never|don['’]?t|dont|do\s+not|without|refrain|no\s+circumstances|no\s+account|no\s+means|stays?|alone|untouched)\b/i
/** The references an additive tail adds to the exclusion before it → [{ phrase, tok, shaped, index, end }]. */
export function additiveRefs(text, charts = []) {
  const s = String(text || '')
  const syms = [...new Set(charts.map(c => String(c?.symbol || '').toUpperCase()).filter(Boolean))]
  const out = []
  for (const m of s.matchAll(ADD_RE)) {
    if (!m[1] && !m[3]) continue                                  // no additive marker: a list item or a new command, not this
    const prev = s.slice(0, m.index).split(/[,;.!?—–]/).filter(x => x.trim()).pop() || ''
    // the clause before must exclude A CHART: a cue (never "don't forget / worry / hesitate / mind / wait …") and a chart reference
    // ("…, not daily, and the bottom one too" excludes nothing)
    const prevCue = prev.replace(/\b(?:don['’]?t|dont|do\s+not|never)\s+(?:forget|worry|hesitate|mind|wait)\b[\s\S]*$/i, ' ')
    if (!EXCLUSION_CLAUSE.test(prevCue) || !namesAChartRef(prevCue, syms)) continue
    const phrase = ordinalDigits(m[2].trim())
    const tokM = /^\$?([A-Z][A-Z0-9]{0,4})(?:['’]s)?(?:\s+(?:chart|one))?$/.exec(phrase) || /^(?:the|my)\s+\$?([A-Z][A-Z0-9]{0,4})\s+(?:chart|one)$/.exec(phrase)
    const tok = tokM && syms.includes(tokM[1]) ? tokM[1] : null
    const shaped = !tok && REF_SHAPE.test(phrase)
    if (tokM && !tok) continue                                    // a ticker the board does not show is no chart to protect
    if (!tok && !shaped && !CHART_NOUN.test(phrase)) continue     // "…, and the RSI too": no chart named
    out.push({ phrase, tok, shaped, index: m.index, end: m.index + m[0].length })
  }
  return out
}
/** The words with every negated chart clause negChartRefs reads blanked, position for position. */
export function blankNegChartRefs(text, charts = []) {
  let s = String(text || '')
  for (const r of [...negChartRefs(s, charts), ...negActionRefs(s, charts), ...additiveRefs(s, charts)]) s = s.slice(0, r.index) + ' '.repeat(Math.max(0, r.end - r.index)) + s.slice(r.end)
  // (H-RDR-1 follow-up) …and every anchor-relative exclusion ("except the one left of AAPL"): neither its anchor nor its
  // relation is a place the request aims at
  return blankAnchorRel(s, anchorRelSpans(s))
}
/** …and every negated TICKER clause too (negTickerRefs' clauses): the words with no negated clause about a chart left. */
export function blankNegatedClauses(text, charts = []) {
  let s = blankNegChartRefs(text, charts)
  for (const m of [...s.matchAll(NEG_CUE_RE), ...s.matchAll(NEG_ANY_RE), ...s.matchAll(NEG_STAY_RE)]) {
    if (negTickerRefs(m[0], charts).length) s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length)
  }
  return s
}
// ── H-RDR-1 follow-up: ANCHOR-RELATIVE EXCLUSIONS ──
// ROOT CAUSE: a chart EXCLUDED by a relation from ANOTHER chart — "switch all of them to weekly except the one left of AAPL",
// "leave the chart below the NVDA one alone and set the rest to 1h", "everything but the one next to SPY" — was read by readers
// that each saw only part of the phrase. The "except X" resolver placed the ANCHOR ("the one above AMD" → the AMD chart, by its
// ticker), the named-relation reader (REL_NAMED) made the excluded chart an ALLOWED target, the click-relation reader read
// "below SPY" as "below the click", and "<every chart> … but the one next to SPY" was read by nothing. So the anchor was
// excluded and the chart the member excluded was changed (or offered by the question).
// Here the phrase is read WHOLE: <the one | the chart | …> <relation> <anchor>, in an exclusion's scope (an exception keyword,
// a negation cue, "leave / keep … alone", "but" after a whole-board quantifier, or "<it> stays as it is"), and resolved on the
// board's own geometry:
//   relation   left of · right of · above / over / on top of · below / under / underneath / beneath · next to / beside /
//              alongside (either side in the row) · adjacent to / near (any side) · "to / on <anchor's> left / right"
//   anchor     a TICKER on the board · a POSITION or ORDER ("the top-right one", "the centre chart", "chart 2") · the chart an
//              EARLIER TURN changed ("it" / "that one" with nothing clicked, "the one I just changed" — the session subject)
//              (the click itself — "this one", "it" with a chart clicked — stays with the click-relation readers, as before)
//   result     exactly one anchor and exactly one chart on that side → that chart is EXCLUDED (and only it: never the anchor);
//              a plural head ("the charts left of AAPL") → every chart on that side. Anything else — the anchor on several
//              charts (two AAPL charts), no such anchor, nothing on that side, "next to" with two neighbours, an anchor word
//              the board cannot read — is UNPLACED (the plan is asked), and every chart the phrase MAY mean is `unoffered`.
// The phrase is then blanked for every other reader, so none of them reads its anchor or relation as anything else.
const AR_NOUN = String.raw`(?:ones?|charts?|cells?|panes?|panels?|graphs?)`
const AR_HEAD = String.raw`\b(?:the|that)\s+(?:(?:single|other)\s+)?(${AR_NOUN})`
const AR_LINK = String.raw`(?:\s+(?:that['’]s|that\s+is|which\s+is|sitting|located|placed|positioned))?(?:\s+(?:right|directly|immediately|just))?`
// (anchor-diagonal follow-up) the DIAGONAL family: diagonal(ly) from / to / of / across from / opposite, catty- / kitty- / cater-
// corner (from / to), across from, opposite (to / from) — read by grid arithmetic (arDiagonal below), never by the side readers
const AR_DIAG_REL = String.raw`diagonal(?:ly)?\s+(?:across\s+from|opposite(?:\s+(?:to|from))?|from|to|of)|(?:catty|kitty|cater)[\s-]?corner(?:ed|s)?(?:\s+(?:from|to|of))?|across\s+from|opposite(?:\s+(?:to|from))?`
const AR_REL = String.raw`(${AR_DIAG_REL}|to\s+the\s+left\s+of|on\s+the\s+left\s+of|left\s+of|to\s+the\s+right\s+of|on\s+the\s+right\s+of|right\s+of|on\s+top\s+of|above|over|below|under(?:neath)?|beneath|next\s+to|beside|alongside|adjacent\s+to|near(?:est)?(?:\s+to)?)`
// the anchor: a short run of words, lazily, up to a tail / destination / clause end (the resolver below says what it names)
const AR_ANCHOR_END = String.raw`(?=\s+(?:alone|as|the\s+same|untouched|unchanged|be|out|where|stays?|remains?|is|are|can|should|will|must|to|on|in|into|onto|at|for|from|with|please|thanks|though|too|either|also|and|or|nor|but|then|so|while|because|weekly|daily|monthly|hourly)\b|\s*[,;:.!?—–()]|\s*$)`
const AR_RE = new RegExp(String.raw`${AR_HEAD}${AR_LINK}\s+${AR_REL}\s+((?:the\s+|my\s+)?[$A-Za-z0-9][^,;:.!?—–()]{0,40}?)${AR_ANCHOR_END}`, 'gi')
// "the one to AAPL's left", "the chart on its right" ("the one to the left of it" is AR_RE's)
const AR_POSS_RE = new RegExp(String.raw`${AR_HEAD}${AR_LINK}\s+(?:to|on)\s+((?:the\s+)?(?:its|\$?[A-Za-z]{1,5}(?:\.[A-Za-z])?['’]s|[a-z -]{1,24}?\s+(?:one|chart)['’]s))\s+(left|right)(?:[\s-]+hand)?(?:\s+side)?\b`, 'gi')
// "the corner opposite AAPL", "the one in the opposite corner from AAPL", "the chart in the far corner to SPY", "the corner
// diagonally across from NVDA": the board corner opposite the anchor (rel 'corner')
const AR_CORNER_RE = new RegExp(String.raw`\b(?:the|that)\s+((?:(?:one|chart|cell|pane|panel|graph)\s+(?:in|at)\s+the\s+)?(?:(?:opposite|far|other|diagonal)\s+corner(?:\s+(?:one|chart|cell))?\s+(?:from|to|of)|corner(?:\s+(?:one|chart|cell))?\s+(?:diagonal(?:ly)?\s+(?:across\s+from|opposite(?:\s+(?:to|from))?|from|to)|(?:directly\s+)?(?:opposite(?:\s+(?:to|from))?|across\s+from))))\s+((?:the\s+|my\s+)?[$A-Za-z0-9][^,;:.!?—–()]{0,40}?)${AR_ANCHOR_END}`, 'gi')
/** The diagonal-family kind of a relation: 'corner' | 'diag' | 'across' | null (a side relation). */
const AR_DIAG_KIND = (rel) => {
  const s = String(rel || '').toLowerCase()
  if (s === 'corner') return 'corner'
  if (/diagonal|catty|kitty|cater/.test(s)) return 'diag'
  if (/across|opposite/.test(s)) return 'across'
  return null
}
const AR_SIDES = (rel) => {
  const s = String(rel || '').toLowerCase()
  if (/left/.test(s)) return ['left']
  if (/right/.test(s)) return ['right']
  if (/above|over|top/.test(s)) return ['above']
  if (/below|under|beneath/.test(s)) return ['below']
  if (/adjacent|near/.test(s)) return ['left', 'right', 'above', 'below']
  return ['left', 'right']                                         // next to / beside / alongside
}
// the scope: what governs the phrase in its own clause
const AR_BOUND = /[,;:.!?—–()]|\b(?:and|then|while|so|also|plus|though|although|because)\b/gi
const AR_CUE = /\b(?:except(?:\s+for)?|apart\s+from|aside\s+from|other\s+than|excluding|besides|save\s+for|minus|but\s+not|not|never|without|with\s+the\s+exception\s+of|skip(?:ping)?|ignor(?:e|ing)|exclud(?:e|ing)|spar(?:e|ing)|hands\s+off(?:\s+of)?|leav(?:e|ing)\s+out|keep(?:ing)?\s+out|don['’]?t|dont|do\s+not|no\s+need\s+to|refrain\s+from|under\s+no\s+circumstances|on\s+no\s+account|by\s+no\s+means)\b/gi
const AR_NOT_FORBID = /\b(?:don['’]?t|dont|do\s+not|never|not)\s+(?:forget|hesitate|worry|mind|wait|sure|know|think|understand|only)\b/gi
const AR_KEEP_CUE = /\b(?:leav(?:e|ing)|keep(?:ing)?|let)\s*$/i
const AR_STRONG_TAIL = /^\s*(?:alone|be\b|as\s+(?:it\s+|they\s+)?(?:is|are|was)|as\s+is|the\s+same|untouched|unchanged|out(?:\s+of\s+(?:it|this|that|them))?|where\s+(?:it\s+is|they\s+are))/i
const AR_STAY_TAIL = /^\s*(?:(?:can|should|will|must|may|could)\s+)?(?:stays?|remains?|(?:is|are)\s+(?:(?:just|already)\s+)?(?:fine|good|ok(?:ay)?|perfect|alright|done))\b/i
const AR_LEAD = /^\s*(?:(?:but|and|though|just|please|oh|ok(?:ay)?)\s+)*$/i
const AR_BUT_LEAD = /\bbut\s*$/i
const AR_CLICK = new RegExp('^(?:the\\s+)?(?:this(?:\\s+(?:one|chart|cell|pane))?|here|the\\s+(?:selected|clicked|current|active|highlighted|focused)\\s+(?:one|chart)|(?:the\\s+)?(?:selected|clicked)\\s+(?:one|chart)|mine|my\\s+(?:own\\s+)?(?:one|chart)|' + CLICK_ACT_NP + ')$', 'i')
const AR_PRONOUN = /^(?:it|its|that(?:\s+(?:one|chart))?)$/i
const AR_PRIOR = /^(?:the\s+)?(?:same\s+(?:one|chart)(?:\s+as\s+(?:before|last\s+time))?|(?:last|previous)\s+(?:one|chart)(?:\s+(?:I|you)\s+(?:just\s+)?[a-z]+)?|(?:one|chart)\s+(?:I|you)\s+(?:just\s+)?(?:changed|made|set|switched|touched|updated|edited|picked|chose|used)(?:\s+(?:earlier|before|last\s+time|a\s+moment\s+ago))?|(?:one|chart)\s+from\s+(?:before|earlier|last\s+time)|(?:one|chart)\s+we\s+(?:just\s+)?(?:changed|did))$/i
const AR_TICKER = /^(?:the\s+|my\s+)?\$?([A-Za-z]{1,5}(?:\.[A-Za-z]{1,2})?)(?:['’]s)?(?:\s+(?:chart|one|cell|pane|panel|graph))?$/
const AR_PLACE = /\b(?:top|bottom|upper|lower|left|right|middle|cent(?:er|re)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|last|1st|2nd|3rd|[4-9]th|leftmost|rightmost|topmost|bottommost)\b|^(?:the\s+)?chart\s+(?:#\s*)?[1-9]$/i
/** Every anchor-relative phrase in an exclusion's scope → [{ index, end, phrase, head, rel, anchor, plural }] (not resolved).
 *  A phrase anchored on the CLICK or on a pronoun ("the one left of this one", "… next to it") is the click-relation readers'
 *  (and, for a pronoun with nothing clicked, anchorRelExclusions'): returned only with `clickToo`. */
export function anchorRelSpans(text, { clickToo = false } = {}) {
  const s = String(text || '')
  const out = []
  const scan = (m, rel, anchor, head = m[1]) => {
    const i = m.index, e = m.index + m[0].length
    if (out.some(o => i < o.end && o.index < e)) return
    // the clause the phrase sits in: back to the last boundary before it, on to the next one after it
    let a = 0
    for (const b of s.slice(0, i).matchAll(AR_BOUND)) a = b.index + b[0].length
    const pre = s.slice(a, i)
    const nb = new RegExp(AR_BOUND.source, 'i').exec(s.slice(e))
    const post = nb ? s.slice(e, e + nb.index) : s.slice(e)
    const cleaned = pre.replace(AR_NOT_FORBID, ' ')
    let scoped = false
    // (1) a cue governing it closely: an exception keyword / negation / skip … at most six words before the phrase
    for (const c of cleaned.matchAll(AR_CUE)) {
      const between = cleaned.slice(c.index + c[0].length).trim()
      if (between.split(/\s+/).filter(Boolean).length <= 6) { scoped = true; break }
    }
    // (2) "leave / keep <it> alone | as it is | the same | untouched" (a bare "leave / keep X" is no exclusion)
    if (!scoped && AR_KEEP_CUE.test(pre) && AR_STRONG_TAIL.test(post)) scoped = true
    // (3) "<every chart> …, but the one next to SPY": "but" glued to the phrase after a whole-board quantifier
    if (!scoped && AR_BUT_LEAD.test(pre) && (WHOLE_BOARD.test(s) || EVERY_Q.test(s))) scoped = true
    // (4) a stated keep: "the one below NVDA stays as it is / is fine"
    if (!scoped && AR_LEAD.test(pre) && AR_STAY_TAIL.test(post)) scoped = true
    if (!scoped) return
    const an = ordinalDigits(String(anchor || '').trim()).replace(/\s+/g, ' ')
    if (!clickToo && (AR_CLICK.test(an) || AR_PRONOUN.test(an))) return
    out.push({ index: i, end: e, phrase: m[0], head, rel, anchor: String(anchor || '').trim(), plural: rel !== 'corner' && /s$/i.test(head) })
  }
  for (const m of s.matchAll(AR_CORNER_RE)) scan(m, 'corner', m[2])
  for (const m of s.matchAll(AR_POSS_RE)) scan(m, m[3], String(m[2]).replace(/['’]s$/i, ''))
  for (const m of s.matchAll(AR_RE)) scan(m, m[2], m[3])
  return out.sort((x, y) => x.index - y.index)
}
/** What an anchor phrase names on the board → { kind, charts } (kind: ticker | place | prior | click | unknown). */
function anchorOf(anchor0, charts, sel, subject) {
  const anchor = ordinalDigits(String(anchor0 || '').trim()).replace(/\s+/g, ' ')
  const byRef = (r) => charts.filter(c => c.ref === r)
  if (AR_CLICK.test(anchor)) return { kind: 'click', charts: sel ? byRef(sel) : [] }
  if (AR_PRIOR.test(anchor)) return { kind: 'prior', charts: subject ? byRef(subject) : [] }
  // "it" / "that one": the click when a chart is clicked (S6: a click outranks memory), else the chart an earlier turn changed
  if (AR_PRONOUN.test(anchor)) return sel ? { kind: 'click', charts: byRef(sel) } : { kind: 'prior', charts: subject ? byRef(subject) : [] }
  const t = AR_TICKER.exec(anchor)
  if (t) {
    const tok = t[1]
    const list = charts.filter(c => String(c?.symbol || '').toUpperCase() === tok.toUpperCase())
    const caps = tok === tok.toUpperCase()
    if (list.length && (caps || (tok.length >= 3 && !LOWER_STOP.test(tok)))) return { kind: 'ticker', charts: list }
    if (caps && /[A-Z]/.test(tok) && !AR_PLACE.test(anchor)) return { kind: 'ticker', charts: [] }   // a ticker the board does not show
  }
  if (AR_PLACE.test(anchor)) {
    const a = namedAnchor(/\b(?:chart|one|cell|pane|panel|graph)$/i.test(anchor) || /^(?:the\s+)?chart\s+/i.test(anchor) ? anchor : `${anchor} chart`, charts)
    return { kind: 'place', charts: a ? [a] : [] }
  }
  return { kind: 'unknown', charts: [] }
}
/** The charts on `sides` of `a` (plural: every chart on that side in line with it; else the nearest neighbours). */
function sideCharts(charts, a, sides, plural) {
  const out = []
  for (const side of sides) {
    if (!plural) { out.push(...neighbours(charts, a, side)); continue }
    let at = [a]
    const seen = new Set([a.ref])
    for (let i = 0; i < charts.length && at.length; i++) {
      const next = at.flatMap(x => neighbours(charts, x, side)).filter(x => !seen.has(x.ref))
      for (const x of next) { seen.add(x.ref); out.push(x) }
      at = next
    }
  }
  return [...new Map(out.map(c => [c.ref, c])).values()]
}
/** The board as a REGULAR lattice (every chart one equal cell, every row × column filled) → Map(ref → {r, c}, R, C) | null. */
function latticeOf(charts) {
  const all = charts.filter(Boolean)
  if (!all.length || all.some(c => !c.cell)) return null
  const w = all[0].cell.w, h = all[0].cell.h
  if (all.some(c => c.cell.w !== w || c.cell.h !== h)) return null
  const xs = [...new Set(all.map(c => c.cell.x))].sort((a, b) => a - b), ys = [...new Set(all.map(c => c.cell.y))].sort((a, b) => a - b)
  if (xs.length * ys.length !== all.length) return null
  const at = new Map(all.map(c => [c.ref, { r: ys.indexOf(c.cell.y), c: xs.indexOf(c.cell.x) }]))
  if (new Set([...at.values()].map(p => `${p.r},${p.c}`)).size !== all.length) return null
  return { at, R: ys.length, C: xs.length }
}
/**
 * (anchor-diagonal follow-up) A DIAGONAL-family relation from `anchors` → { refs, unplaced, unoffered }. On a regular lattice:
 *   diag    (diagonal / catty-corner / kitty-corner) every chart with |Δrow| = |Δcol| > 0: exactly one → that chart (a plural head:
 *           all of them); several (the centre of a 3×3, a 3×3 corner: the centre AND the far corner) or none (one row) → asked
 *   across  (across from / opposite) the row, the column or the diagonal: exactly one such chart (a 1×2 / 2×1 board) → it; else
 *           (a 2×2: the row-mate, the column-mate or the diagonal?) asked — never a guess between row and diagonal
 *   corner  ("the corner opposite X") the anchor is a board corner of a board at least 2×2 → the mirrored corner; else asked
 * An irregular board, no anchor, or the anchor on several charts → asked. Every chart the phrase MAY mean is `unoffered`
 * (an irregular board: every chart sharing no row / column with the anchor, or any chart for "across").
 */
function arDiagonal(charts, anchors, kind, plural) {
  const L = latticeOf(charts)
  const others = (a) => charts.filter(c => c && c.ref !== a.ref)
  let may
  if (!L) {
    may = anchors.flatMap(a => others(a).filter(c => kind === 'across' || !c.cell || !a.cell
      || (!overlaps(c.cell.x, c.cell.x + c.cell.w, a.cell.x, a.cell.x + a.cell.w) && !overlaps(c.cell.y, c.cell.y + c.cell.h, a.cell.y, a.cell.y + a.cell.h))))
  } else {
    const fits = (a, c) => {
      const p = L.at.get(a.ref), q = L.at.get(c.ref)
      const dr = Math.abs(p.r - q.r), dc = Math.abs(p.c - q.c)
      if (kind === 'diag') return dr === dc && dr > 0
      if (kind === 'across') return (dr === 0) !== (dc === 0) || (dr === dc && dr > 0)
      const corner = (x) => (x.r === 0 || x.r === L.R - 1) && (x.c === 0 || x.c === L.C - 1)
      if (L.R < 2 || L.C < 2 || !corner(p)) return corner(q)                      // no single opposite corner: every corner may be meant
      return q.r === L.R - 1 - p.r && q.c === L.C - 1 - p.c
    }
    may = anchors.flatMap(a => others(a).filter(c => fits(a, c)))
  }
  may = [...new Set(may.map(c => c.ref))]
  const a = anchors[0]
  const exact = !!L && anchors.length === 1 && may.length >= 1 && (may.length === 1 || (plural && kind === 'diag'))
    && (kind !== 'corner' || (L.R >= 2 && L.C >= 2 && (() => { const p = L.at.get(a.ref); return (p.r === 0 || p.r === L.R - 1) && (p.c === 0 || p.c === L.C - 1) })()))
  const refs = exact ? may.filter(r => r !== a.ref) : []
  return refs.length ? { refs, unplaced: false, unoffered: [] } : { refs: [], unplaced: true, unoffered: may }
}
/**
 * The anchor-relative exclusions the words state, resolved → [{ index, end, phrase, refs: [chart refs], unplaced, unoffered }].
 * A phrase anchored on the CLICK is left to the click-relation readers (not returned). `subject`: the chart ref an earlier turn
 * changed (session memory), the anchor of "it" / "that one" with nothing clicked and of "the one I just changed".
 */
export function anchorRelExclusions(text, charts = [], sel = null, subject = null) {
  const out = []
  for (const sp of anchorRelSpans(text, { clickToo: true })) {
    const an = anchorOf(sp.anchor, charts, sel, subject)
    if (an.kind === 'click') continue
    const dk = AR_DIAG_KIND(sp.rel)
    if (dk) { out.push({ ...sp, kind: an.kind, anchorRefs: an.charts.map(c => c.ref), ...arDiagonal(charts, an.charts, dk, sp.plural) }); continue }
    const sides = AR_SIDES(sp.rel)
    const may = [...new Set(an.charts.flatMap(a => sideCharts(charts, a, sides, sp.plural)).map(c => c.ref))]
    let refs = [], unplaced = false
    if (an.charts.length !== 1) unplaced = true                                   // no such anchor, or on several charts
    else if (!may.length) unplaced = true                                         // nothing on that side
    else if (!sp.plural && may.length > 1) unplaced = true                        // "next to" with two neighbours: which one?
    else refs = may.filter(r => r !== an.charts[0].ref)
    if (!unplaced && !refs.length) unplaced = true
    out.push({ ...sp, kind: an.kind, anchorRefs: an.charts.map(c => c.ref), refs, unplaced, unoffered: unplaced ? may : [] })
  }
  return out
}
/** The words with every anchor-relative exclusion phrase blanked, position for position. */
// a function DECLARATION (hoisted): deixis.relationMatch calls it across the deixis ⇄ spatialCheck import cycle, where a module
// mock spreading the in-progress module (agentNegatedTickerLayers) would copy an uninitialised const
export function withoutAnchorRel(text) { return blankAnchorRel(text, anchorRelSpans(text)) }
function blankAnchorRel(text, list) {
  let s = String(text || '')
  for (const r of list) s = s.slice(0, r.index) + ' '.repeat(r.end - r.index) + s.slice(r.end)
  return s
}
/** The charts an exclusion in the words names (by symbol, position, order, or "this one" = the click). */
export function excludedCharts(text0, charts = [], sel = null, opts = {}) {
  // (H-RDR-1 follow-up) an ANCHOR-RELATIVE exclusion ("except the one left of AAPL") is read whole, first, and blanked for every
  // reader below — none of them may read its anchor as the exclusion or its relation as one from the click
  const anchorRel = anchorRelExclusions(text0, charts, sel, opts?.subject || null)
  const textA = anchorRel.length ? blankAnchorRel(text0, anchorRel) : text0
  const text = textA
  const out = new Set()
  // the exception PHRASES a reader below placed (added a chart or UNPLACED), normalized — matched by phrase, not by index: the
  // readers run on exceptForm(text), the unplaced scan on the words as said
  const placed = []
  const unoffered = new Set()
  let adds = 0
  const add = out.add.bind(out)
  out.add = (x) => { adds++; return add(x) }
  // ⛔ (AUDIT 53) a ticker the words CHANGE is never one they exclude: "AAPL instead of SPY" / "QQQ instead of SPY" name SPY as the
  // chart to change — no reader below excludes it (nor unplaces it: a linked SPY pair is still the target). The new symbol is a
  // ticker no chart shows, or a shown one as the relation's direct complement (tickerChanged tight)
  const shownSyms = new Set(charts.map(c => String(c?.symbol || '').toUpperCase()).filter(Boolean))
  const namedSyms = namedTickers(textA, [...shownSyms])
  const fresh = namedSyms.filter(t => !shownSyms.has(t)), onBoard = namedSyms.filter(t => shownSyms.has(t))
  const changed = (sym) => !!sym && (tickerChanged(textA, sym, fresh) || tickerChanged(textA, sym, onBoard, { tight: true }))
  const changedIn = (phrase) => namedTickers(phrase, [...shownSyms]).some(t => shownSyms.has(t) && changed(t))
  // ⛔ (pl-exclhole, AUDIT 11-23 T2) EXCLUSION OBJECTS, read first: every exclusion cue's object — a description by timeframe,
  // chart type, size or ticker, a position, and any LIST of them (commas, "and", "or", "&") — is placed exactly, or the exclusion
  // is UNPLACED (asked; the charts it may mean never offered). Never "exclude nothing" for an object that names a board attribute.
  // A phrase inside a span read whole (every item placed) is never ALSO unplaced by a legacy net below (xoCovered); the legacy
  // readers still run on the words as said (their own context — "…alone, and the bottom one too" — stays whole).
  const xo = readExclusionObjects(textA, charts, { ...opts, changed }, (p) => {
    // the resolver's verdict only — nothing it adds stays in the result unless the object reader takes it (a span it skips —
    // "keep the top one on daily" alone — must leave no trace)
    const got = []
    const prev = out.add
    const had = new Set(out), hadOff = new Set(unoffered)
    out.add = (x) => { got.push(x); return prev(x) }
    try { readException({ 0: p, 1: p, index: String(textA || '').length, input: String(textA || '') }) } finally { out.add = prev }
    for (const x of got) if (!had.has(x)) out.delete(x)
    const may = [...unoffered].filter(x => !hadOff.has(x))
    for (const x of may) unoffered.delete(x)
    if (got.includes(UNPLACED)) return { kind: 'unplaced', unoffered: may }
    return got.length ? { kind: 'placed', refs: got } : { kind: 'unplaced', unoffered: may }
  })
  for (const r of xo.refs) out.add(r)
  const xoWhole = xo.spans.filter(x => x.whole).map(x => ` ${normPhrase(String(textA || '').slice(x.index, x.end))} `)
  const xoCovered = (p) => { const w = normPhrase(String(p || '')).replace(NET_CUE_LEAD, ''); return !!w && xoWhole.some(t => t.includes(` ${w} `)) }
  const negs = [...exceptForm(text).matchAll(NEG_EXCEPT)].filter(m => negNamesAChart(m[1].trim(), charts))
  for (const m of [...exceptMatches(text), ...negs, ...sepButMatches(text), ...tickerPossMatches(text)]) {
    const a0 = adds
    try { readException(m) } finally { if (adds > a0) placed.push(normPhrase(m[1])) }
  }
  // (hotfix) a NEGATED TICKER clause ("…, but leave NVDA's alone", "…; dont touch NVDA", "Not the NVDA chart though."):
  // each ticker reference placed on the board's symbols (negTickerRefs)
  for (const r of negTickerRefs(text, charts)) {
    if (changed(r.tok)) { placed.push(normPhrase(r.phrase)); continue }
    const list = charts.filter(c => String(c?.symbol || '').toUpperCase() === r.tok)
    placed.push(normPhrase(r.phrase))
    if (list.length === 1) { out.add(list[0].ref); continue }
    if (list.length > 1) {
      const scope = scopeLine(text, charts, sel)
      const inScope = scope ? list.filter(c => scope.includes(c)) : []
      if (inScope.length === 1) { out.add(inScope[0].ref); continue }
      if (xoCovered(r.phrase)) continue                          // (pl-exclhole) "both SPY charts": read whole above
      out.add(UNPLACED)
      for (const c of list) unoffered.add(c.ref)
      continue
    }
    if (r.poss) out.add(UNPLACED)
  }
  // (H-RDR-1) a NEGATED CHART clause whose object is a position, a line, an ordinal, the click or a pronoun ("…, but leave the
  // top-left one alone", "skip the second chart", "hands off this one", "the bottom row stays as it is"): placed by the SAME
  // phrase resolver as "except X" (readException).
  // UNRESOLVED — the exact rule. A reference negChartRefs reads (a cue from NEG_CUE / without / … stays, governing a piece that
  // is a chart reference: REF_SHAPE, or a lone chart-noun phrase ending at a tail or the clause's end) is UNRESOLVED, and the
  // exclusion is UNPLACED (every plan on the board is asked; no chart is guessed), when ALL of these hold:
  //   (a) the phrase resolver placed no chart for it: no place word fits exactly one chart or a line / side (a 2×2 has no
  //       "middle one"), no ordinal is on the board ("the sixth chart" on four), no ticker names it, and it is the click by a
  //       click name ("this one", "it", "the one I clicked", "mine") with NOTHING clicked — or the phrase is a RELATION
  //       (GEN_RELATION: "the one beside NVDA", "the chart next to the top-left one") or a LOOSE phrase (a chart noun under a
  //       determiner that is no plain reference shape: "the big chart", "the timeframe on the top-left chart") and so is never
  //       read by that resolver (a loose phrase naming a board ticker is left to the ticker reader and its net);
  //   (b) it is not a relation from the click that the relation readers place ("the charts around it", "the one below it"
  //       with a chart clicked: those charts are excluded instead);
  //   (c) its cue is not a bare "not" governing a loose phrase ("…, not the chart I meant" is a contrast: nothing, as before);
  //   (d) it is not a STATED keep ("<X> stays / is fine"), whose unplaceable subject excludes nothing (see below).
  // A reference that IS placed adds exactly its chart(s) and nothing else — a recognized exclusion is never also UNPLACED (its
  // phrase is in `placed`, which the net below compares without the cue: NET_CUE_LEAD).
  for (const r of negChartRefs(text, charts)) {
    const a0 = adds
    // ⛔ a RELATION ("the one beside NVDA", "the chart below the top-left one") names ANOTHER chart than its anchor: never read by
    // the phrase resolver (it would place the anchor); only a relation from the click is placed (below), else UNPLACED.
    // A LOOSE phrase (no plain reference shape: "the timeframe on the top-left chart") is never placed by its words either —
    // it is UNPLACED (asked) unless it is a relation from the click: an exclusion is guessed from no phrase it cannot read whole
    if (!r.loose && !GEN_RELATION.test(r.phrase)) readException({ 0: r.phrase, 1: r.phrase, index: r.end, input: String(text || '') })
    placed.push(normPhrase(r.phrase))
    if (adds > a0) continue
    if (r.cue === 'not' && !r.strong && r.loose) continue
    // (d) a STATED keep ("the column on the right is fine", "chart 5 stays as it is") the board cannot place is a statement,
    // not an instruction: it excludes nothing (the stated-clause rule, G5, as before) — never UNPLACED
    if (r.stay) continue
    // a RELATION from the click ("leave the charts around it alone", "don't touch the one below it") is placed by the relation
    // readers (negatedRelations / relativeChart in spatialConstraints): resolved there, never unplaced here
    if (sel && negatedRelations(text).some(p => normPhrase(p) === normPhrase(r.phrase))) continue
    const rel = sel ? relativeChart(r.phrase, charts, sel) : null
    if (rel?.hits?.length) { for (const c of rel.hits) if (c.ref !== sel) out.add(c.ref); if (adds > a0) continue }
    if (xoCovered(r.phrase)) continue                            // (pl-exclhole) a description read whole above
    out.add(UNPLACED)
  }
  // (H-RDR-1, AUDIT) a NEGATED IMPERATIVE with a destination ("don't change the top-left one to weekly", "do not add RSI to the
  // second chart", "never hide volume on SPY"): every chart its clause names is a chart the change must never land on. A plain
  // reference is placed by readException; a board ticker on its symbol (one chart → it; several → UNPLACED, none offered); any
  // other chart phrase ("the big chart", "the one beside NVDA") or a reference that cannot be placed → UNPLACED (asked). These
  // survive the changed-ticker rule below: "don't change SPY to AAPL" forbids the change on SPY, it never licenses it.
  const forbidden = new Set()
  // (b9) …and an ADDITIVE tail after an exclusion ("…alone, and the bottom one too"): the same placement, the same fail-safe
  for (const r of [...negActionRefs(text, charts), ...additiveRefs(text, charts)]) {
    if (r.dangling) {
      // (B) a negation that ended at a comma before governing anything: every chart its sentence names may be the forbidden one
      out.add(UNPLACED)
      try { for (const c of chartsNamedBy(r.phrase, charts, sel)) unoffered.add(c) } catch { /* no names */ }
      continue
    }
    if (placed.includes(normPhrase(r.phrase))) continue
    const a0 = adds
    const before = new Set(out)
    if (r.tok && !r.shaped) {
      const list = charts.filter(c => String(c?.symbol || '').toUpperCase() === r.tok)
      if (list.length === 1) out.add(list[0].ref)
      else if (xoCovered(r.phrase)) adds++                         // (pl-exclhole) "the SPY charts": read whole above
      else { out.add(UNPLACED); for (const c of list) unoffered.add(c.ref) }
    } else if (r.relation) {
      // a relation from the click ("don't touch the one below it"): its charts (the relation readers', as negChartRefs reads it)
      if (sel && !negatedRelations(text).some(p => normPhrase(p) === normPhrase(r.phrase))) {
        const rel = relativeChart(r.phrase, charts, sel)
        for (const c of rel?.hits || []) if (c.ref !== sel) out.add(c.ref)
      } else if (sel) adds++                                       // placed by spatialConstraints' negated-relation reader
    } else if (r.shaped && !GEN_RELATION.test(r.phrase)) readException({ 0: r.phrase, 1: r.phrase, index: r.end, input: String(text || '') })
    if (adds === a0 && !xoCovered(r.phrase)) out.add(UNPLACED)
    for (const x of out) if (!before.has(x) && x !== UNPLACED) forbidden.add(x)
    placed.push(normPhrase(r.phrase))
  }
  // (AUDIT #1143 follow-up 2) an exception the readers could NOT place but whose words NAME A CHART — "except the one next to
  // mine", "apart from this one's neighbour", "other than the chart I opened" — was silently nothing, so the chart the member
  // excluded was NOT protected (a plan on it ran). Now it is UNPLACED: the plan is asked. Only when the excepted words name a
  // chart (a chart noun, a relation / neighbour, a possessive for the click, "this one", a place word, or "'s"); a value or a
  // time ("except on Fridays", "except volume", "except the 50 day", "excluding after-hours") still excludes nothing.
  // ⛔ read on the words AS SAID, never exceptForm: exceptForm writes "the same column BUT the other row" as "column except …",
  // which is a line relation, not an exception (agentLineRelations)
  // (hotfix) …and a NEGATED-TICKER cue ("leave SPY's neighbour alone", "hands off the one beside NVDA") on the same net: only
  // when its words carry a ticker (an all-caps symbol or a capitalized possessive) and a chart word — "not the chart I meant",
  // "don't touch the axis", "skip to the next bar" carry none and read nothing (as before)
  const negNet = [...String(text || '').matchAll(NEG_NET_RE)].map(k => ({ 1: k[2] }))
    .filter(k => /\b(?!I\b)[A-Z][A-Z0-9]{0,4}\b|\b[A-Z][a-z]+['’]s\b/.test(k[1]) && CHARTISH_WORDS.test(k[1]))
  // (H-RDR-1 r3) an exception keyword governing a LIST of plain references — "except the top-left one and the bottom-right one
  // (as well)", "apart from the SPY chart and the NVDA chart", "other than chart 1 or chart 4" — places EACH item like a single
  // exception (the single-phrase readers stop at 30 characters, and the net below defers a plain ticker list to them); an item the
  // board cannot place is UNPLACED. Only when every item is a reference: "except volume and RSI" is no list of charts.
  for (const k of String(text || '').matchAll(EXC_KW)) {
    const body = k[1].replace(/\s+(?:too|as\s+well|also|either)\s*$/i, '').trim()
    const items = body.split(/\s*(?:&|\band\b|\bor\b|\bnor\b|\bplus\b)\s*/i).map(x => ordinalDigits(x.trim().replace(/^also\s+/i, ''))).filter(Boolean)
    if (items.length < 2) continue
    if (!items.every(x => REF_SHAPE.test(x) || /^(?:(?:the|my)\s+)?\$?[A-Z][A-Z0-9]{0,4}(?:['’]s)?(?:\s+(?:chart|one))?$/.test(x))) continue
    for (const x of items) {
      const a0 = adds
      readException({ 0: x, 1: x, index: k.index + k[0].length, input: String(text || '') })
      if (adds === a0 && !xoCovered(x)) out.add(UNPLACED)
    }
    placed.push(normPhrase(k[1]))
  }
  for (const k of [...String(text || '').matchAll(EXC_KW), ...negNet]) {
    // (H-RDR-1) compared WITHOUT the cue a phrase starts with ("every chart but leave SPY's chart alone": EXC_KW's phrase is
    // "leave SPY's chart alone", the reader placed "SPY's chart") — a recognized exclusion is never ALSO unplaced (asked)
    const w = normPhrase(k[1]).replace(NET_CUE_LEAD, '')
    if (placed.some(ph => ph && (w.startsWith(ph) || ph.startsWith(w)))) continue
    if (xoCovered(k[1])) continue
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
  // ⛔ (AUDIT finding 1) a ticker the words CHANGE is never one they exclude: "AAPL instead of SPY" / "AAPL rather than SPY" name
  // SPY as the chart to change (AAPL its new symbol) — an exclusion reading of it would protect SPY and aim the change elsewhere
  for (const c of charts) if (c?.ref && out.has(c.ref) && !forbidden.has(c.ref) && c.symbol && changed(String(c.symbol).toUpperCase())) out.delete(c.ref)
  // (H-RDR-1 follow-up) the anchor-relative exclusions: exactly the chart(s) the relation lands on, or UNPLACED (asked) with every
  // chart the phrase may mean never offered — after the changed-ticker rule (the anchor is no ticker the words change)
  for (const r of anchorRel) {
    for (const x of r.refs) add(x)
    if (r.unplaced) { add(UNPLACED); for (const x of r.unoffered) unoffered.add(x) }
  }
  // (pl-exclhole) an exclusion object the board cannot place exactly: asked, and every chart it may mean never offered
  if (xo.unplaced) add(UNPLACED)
  for (const x of xo.unoffered) unoffered.add(x)
  out.add = add
  // the charts an UNPLACED exception may mean (a ticker on several charts): never offered by a question (`unoffered`)
  Object.defineProperty(out, 'unoffered', { value: unoffered, enumerable: false })
  return out
  function readException(m) {
    const phrase = ordinalDigits(m[1].trim())                    // (H-RDR-1) "chart three" is "chart 3"
    if (changedIn(phrase)) return
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
    // (calc-TF AUDIT ask 5) a BARE ticker possessive — "except NVDA's", "except NVDA's chart / one" — is that ticker's chart
    // (nothing follows that could re-aim it: no neighbour, no relation). A ticker the board does not show still places nothing here.
    const tp = /^(?:the\s+)?([A-Za-z]{1,5})['’]s(?:\s+(?:chart|one))?$/.exec(phrase)
    if (tp) {
      const t = namedAnchor(`${tp[1]} chart`, charts)
      if (t) { out.add(t.ref); return }
    }
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
      if (inScope.length !== 1 && xoCovered(phrase)) return       // (pl-exclhole) "the SPY charts": read whole above
      out.add(inScope.length === 1 ? inScope[0].ref : UNPLACED)
      if (inScope.length !== 1) for (const c of multi) unoffered.add(c.ref)
    }
  }
}
// an exception KEYWORD and the words it governs, up to the clause's end, on the words AS SAID. "but" is a keyword only glued to a
// WHOLE-BOARD word ("everything but …", "every chart but …") — never after "row" / "column" (a line relation) or a value.
// NOT "instead of" / "rather than": measured, those are value contrasts or target swaps ("the weekly timeframe instead of the
// chart one", "a line instead of candles"), never an exclusion from a set.
const EXC_KW = /\b(?:except(?:\s+for)?|apart\s+from|other\s+than|excluding|besides|aside\s+from|save\s+for|minus|but\s+not|(?:everything|all|them|these|(?:every|each)\s+chart)\s+but)\s+([^,.;!?—–]{1,60})/gi
const normPhrase = (s) => ordinalDigits(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// (H-RDR-1) a negation cue at the head of a normalized phrase (the unplaced net compares the object, not the cue)
const NET_CUE_LEAD = /^(?:(?:but|and|then|so|please|just|also)\s+)*(?:not|leave(?:\s+out)?|leaving|keep(?:\s+out)?|skip|ignore|exclude|spare|hands\s+off(?:\s+of)?|without|(?:don\s+t|dont|do\s+not|never)\s+(?:touch|change|modify|alter|update|switch|mess\s+with|bother\s+with|include))\s+/
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
// ── EXCLUSION OBJECTS (pl-exclhole, AUDIT 11-23 T2) ──
// ROOT CAUSE: every exclusion reader above reads ONE object of a fixed shape — a position, a line, a ticker, the click, a
// relation — and stops at the first comma or at 30 characters. An object they cannot read fell through to "exclude nothing"
// unless one of several nets happened to see its words. Measured on master (a model plan on every chart):
//   "set every chart to monthly but not the daily ones"            → [] — APPLIED to every chart, the daily ones included
//   "leave the daily ones and the weekly one alone"                → []
//   "set all to weekly except SPY, QQQ and NVDA"                    → SPY only — the question OFFERED QQQ and NVDA
//   "except the weekly one" (one weekly chart)                      → UNPLACED, and the question offered that very chart
// THE CLASS: an exclusion CUE governs an OBJECT; the object is a LIST of items (commas, "and", "or", "nor", "&", "plus", any
// length); each item is a chart DESCRIPTION read on the board's own state, or a reference the legacy readers own.
//   cues        except (for) · apart / aside from · other than · excluding · besides · save for · minus · but not ·
//               everything / all / every chart but · without · with the exception of · skip · ignore · exclude · spare ·
//               hands off · leave / keep out · don't / do not / never touch / change / modify / alter / update / switch /
//               include / mess with · leave / keep / let X alone / as is / the same / untouched / unchanged / be (or any
//               leave / keep X beside a whole-board quantifier) · a clause-leading "not X" (only an X with a chart noun or a
//               board ticker: "weekly, not daily" is a value contrast) · "but X" after a whole-board quantifier (only a
//               description) · "X stay(s) / remain(s) / is fine" (only descriptions) · a negated imperative's descriptions
//               ("don't add RSI to the daily ones")
//   items       TIMEFRAME  "the daily ones", "daily", "the dailies", "the ones on weekly", "the charts set to 1h", "the
//                          5 minute charts", "intraday ones"
//               CHART TYPE "the line charts", "the candlestick ones", "the charts showing bars"
//               SIZE       "the big chart", "the small ones" (the board's own cell sizes)
//               TICKER     "SPY", "NVDA's", "the SPY charts", "both QQQ ones"
//               POSITION   "the top row", "the top-left one", "chart 3", "the left column" (the legacy phrase resolver)
//               legacy     the click, a pronoun, a relation, a possessive of a chart → left to the readers above (deferred)
//   verdict     each item: EXACT when the board places it (a plural description: every chart that fits it; a singular one:
//               exactly one chart, or one link group); otherwise UNPLACED — the plan is asked and every chart the item may
//               mean is never offered (a singular description on several charts, a description that fits no chart, a
//               description narrowed by words the reader cannot read, a reader that is switched off).
//               An item that names NO board attribute (a value, an indicator: "except volume") excludes nothing, as before;
//               a ticker the board does not show excludes nothing (master policy), its possessive is UNPLACED.
// ⛔ FAIL SAFE: an item that names a board attribute (a timeframe, a chart type / size word with a chart noun, a board ticker,
// a position / line / order word, "chart N") and that no reader places is UNPLACED — NEVER "exclude nothing".
// `opts.xoDisable` (tests only: the non-vacuity control) switches class readers off by name: timeframe, type, size, ticker,
// position, list. Switched off, each class — under every cue form — must come out UNPLACED, never a silent run.
// ⛔ NO LOOKBEHIND (#988 AUDIT L1).
const XO_NOUN = String.raw`(?:charts?|ones?|cells?|panes?|panels?|graphs?)`
const XO_DET = String.raw`(?:(?:the|my|those|these|both|any|all(?:\s+(?:of\s+)?(?:the|my|those|these))?)\s+)`
const XO_TFW = String.raw`(?:\d{1,3}[\s-]*(?:m|min|mins|minutes?|h|hr|hrs|hours?)|1d|1w|hourly|daily|weekly|monthly|intraday)`
const XO_TFPL = String.raw`(?:dailies|weeklies|monthlies|hourlies)`
const XO_TYPEW = String.raw`(?:candles?|candlesticks?|candle[\s-]stick|hollow(?:[\s-]+candles?)?|bars?|ohlc|line|area)`
const XO_SIZEW = String.raw`(?:big|bigger|biggest|large|larger|largest|huge|wide|wider|widest|small|smaller|smallest|little|tiny|mini|narrow|narrower|narrowest)`
const XO_PLURAL_DET = /^(?:both|all|those|these)\b/i
const XO_TF1 = new RegExp(String.raw`^${XO_DET}?(${XO_TFW})(?:\s+(${XO_NOUN}))?$`, 'i')
const XO_TF2 = new RegExp(String.raw`^${XO_DET}?(${XO_NOUN})\s+(?:(?:that\s+are|that['’]re|which\s+are|that\s+is|which\s+is|currently|still|already|set|now)\s+)*(?:(?:on|at|to|in)\s+)?(?:the\s+|a\s+)?(${XO_TFW})(?:\s+(?:timeframe|tf|interval|setting|view))?$`, 'i')
const XO_TF3 = new RegExp(String.raw`^${XO_DET}?(${XO_TFPL})$`, 'i')
const XO_TY1 = new RegExp(String.raw`^${XO_DET}?(${XO_TYPEW})(?:[\s-]+(?:style|type))?\s+(${XO_NOUN})$`, 'i')
const XO_TY2 = new RegExp(String.raw`^${XO_DET}?(${XO_NOUN})\s+(?:(?:that\s+are|which\s+are|that\s+is|which\s+is|drawn|shown|set|currently)\s+)*(?:in|on|with|as|showing|using|to)\s+(?:a\s+|the\s+)?(${XO_TYPEW})(?:\s+(?:style|type|mode|view|charts?))?$`, 'i')
const XO_SZ = new RegExp(String.raw`^${XO_DET}?(${XO_SIZEW})\s+(${XO_NOUN})$`, 'i')
const XO_TK = new RegExp(String.raw`^${XO_DET}?\$?([A-Za-z][A-Za-z0-9]{0,5}(?:\.[A-Za-z0-9]{1,2})?)(['’]s)?(?:\s+(${XO_NOUN}))?$`, 'i')
// a board attribute in an item the readers could not place (→ UNPLACED, never nothing)
const XO_ATTR = new RegExp(String.raw`\b${XO_TFPL}\b|\b${XO_TFW}(?:\s+${XO_NOUN})?\s*$|\b${XO_TFW}\s+${XO_NOUN}\b|\b${XO_TYPEW}(?:[\s-]+(?:style|type))?\s+${XO_NOUN}\b|\b${XO_SIZEW}\s+${XO_NOUN}\b|\b(?:top|bottom|upper|lower|left|right|middle|cent(?:er|re)|corner|first|second|third|fourth|fifth|sixth|last|leftmost|rightmost|topmost|bottommost)\b[\s\S]*\b(?:${XO_NOUN}|rows?|columns?|corners?|sides?)\b|^(?:the\s+)?(?:(?:top|bottom|upper|lower|left|right)[\s-]*){1,2}$|\b(?:rows?|columns?)\b|\bchart\s+(?:#\s*)?(?:[1-9]|one|two|three|four|five|six|seven|eight|nine)\b`, 'i')
const XO_PREFIX = /\b(except(?:\s+for)?|apart\s+from|aside\s+from|other\s+than|excluding|besides|save\s+for|minus|but\s+not|without|with\s+the\s+exception\s+of|skip(?:ping)?|ignor(?:e|ing)|exclude|spar(?:e|ing)|hands\s+off(?:\s+of)?|leav(?:e|ing)\s+out|keep(?:ing)?\s+out|(?:don['’]?t|dont|do\s+not|never|please\s+don['’]?t)\s+(?:touch|change|modify|alter|update|switch|mess\s+with|bother\s+with|include|do\s+anything\s+(?:to|with))|(?:everything|all|them|these|(?:every|each)\s+(?:chart|one))\s+but(?!\s+not\b))\s+/gi
const XO_CIRCUM = /\b(leav(?:e|ing)|keep(?:ing)?|let)\s+(?!out\b)/gi
const XO_NOT = /(?:^|[,;:—–]|\b(?:and|though|just)\b)\s*not\s+(?!(?:just|only|merely|simply|sure|yet|now|too|so|really|quite|very|even|that\s+(?:much|many)|this\s+time|anymore|necessarily|exactly|any)\b)/gi
const XO_SEP_BUT = /\bbut\s+(?!not\b|leave|keep|skip|ignore|exclude|spare|don|do\b|never|please|also|then|make|set|put|switch|change|add)/gi
const XO_STAY = new RegExp(String.raw`(?:^|[,;:.!?—–]\s*|\b(?:but|though|while|so|and)\s+)((?:the|my|both|all|those|these)\s+[^,;:.!?—–()]{1,80}?|\$?[A-Z]{1,5}(?:\s*(?:,|\band\b|&)\s*\$?[A-Z]{1,5})*)\s+(?:(?:can|should|will|may|must|could)\s+)?(?:stay|stays|remain|remains|(?:is|are)\s+(?:just\s+|already\s+)?(?:fine|good|ok(?:ay)?|perfect|alright))\b`, 'gi')
const XO_SCAN = new RegExp(String.raw`\b${XO_DET}(?:${XO_TFW}\s+${XO_NOUN}|${XO_NOUN}\s+(?:(?:that\s+are|which\s+are|set)\s+)?(?:on|at)\s+(?:the\s+)?${XO_TFW}(?!\s+(?:timeframe|tf))|${XO_TFPL}|${XO_TYPEW}(?:[\s-]+(?:style|type))?\s+${XO_NOUN}|${XO_SIZEW}\s+${XO_NOUN})\b|\b${XO_TFPL}\b`, 'gi')
const XO_BODY_END = /[.;:!?—–()]|\s+(?:but|then|though|although|while|because|since|whereas|unless|if|when)\b/i
const XO_SEP = /\s*,\s*(?:(?:and|or|&|nor|plus)\s+)?|\s+(?:and|or|nor|plus)\s+|\s*&\s*/gi
// an item that starts a new clause ends the list: a command, a complement ("the rest"), a relative clause, a person
const XO_LIST_END = /^(?:(?:please\s+)?(?:set|make|put|switch|change|add|move|turn|show|hide|remove|give|apply|take|drop|flip|close|delete|draw|plot|open|reset|replace|use|do|swap|load|bring|go|goes|leave|keep|let|skip|ignore|exclude|spare|stay|stays|then|to|into|onto|with|and|or|nor|plus|also|not|never|don['’]?t|dont|hands\s+off|without)\b|(?:all\s+)?the\s+(?:rest|others|remaining)\b|everything\s+else\b|all\s+(?:the\s+)?(?:rest|others)\b|every\s+other\b|each\s+other\b|(?:which|who|whose|because|since|as|if|when|so|but|i|we|you|they|it['’]s|that\s+(?:i|you|we|is|are|was|were))\b)/i
const XO_TAIL = /^(.*?)((?:\s+(?:alone|be|out(?:\s+of\s+(?:it|this|that|them))?|as\s+(?:it\s+|they\s+)?(?:is|are|was|were)|as\s+is|untouched|unchanged|the\s+same|where\s+(?:it\s+is|they\s+are)|though|please|thanks|for\s+now|this\s+time|too|either|as\s+well|also))*)$/i
const XO_STRONG_TAIL = /\b(?:alone|be|out|as\s+(?:it\s+|they\s+)?(?:is|are|was|were)|as\s+is|untouched|unchanged|the\s+same|where)\b/i
const XO_KEEP_AT = new RegExp(String.raw`^(.*?)\s+(?:(?:on|at|in)\s+)?(?:(?:a|the)\s+)?${KEEP_SETTING}(?:\s+(?:as\s+(?:it\s+)?is|for\s+now|too))?$`, 'i')
const XO_SETTING_TAIL = new RegExp(String.raw`\s+(?:(?:on|at|in|to|into)\s+)?(?:(?:a|the)\s+)?${KEEP_SETTING}(?:\s+(?:timeframe|tf|scale|view))?$`, 'i')
// "on a chart other than the one I clicked, the bottom-right one": an indefinite target before the cue makes a bare comma an
// APPOSITION (it renames the target), never a list item
const XO_INDEF_BEFORE = /\b(?:a|an|another|one|some)\s+(?:(?:different|other|single|new)\s+)?(?:chart|cell|pane|panel|graph)?\s*$/i
const XO_VALUE_BEFORE = /\b(?:something|anything|timeframe|interval|period|setting|value|style|colou?r|type|scale|resolution)\s*$/i
const XO_TF_NORM = (c) => { const t = String(c?.tf ?? 'D').toUpperCase(); return /^1[DWM]$/.test(t) ? t.slice(1) : t }
function xoTfPred(w0) {
  const w = String(w0 || '').toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  const one = { dailies: 'daily', weeklies: 'weekly', monthlies: 'monthly', hourlies: 'hourly' }[w] || w
  if (one === 'intraday') return (c) => !['D', 'W', 'M'].includes(XO_TF_NORM(c))
  let code = { daily: 'D', '1d': 'D', weekly: 'W', '1w': 'W', monthly: 'M', hourly: '60' }[one] || null
  if (!code) {
    const m = /^(\d{1,3})\s*(m|min|mins|minutes?|h|hr|hrs|hours?)$/.exec(one)
    if (m) code = /^h/.test(m[2]) ? String(Number(m[1]) * 60) : String(Number(m[1]))
  }
  return code ? (c) => XO_TF_NORM(c) === code : null
}
const xoTypeOf = (w) => (/hollow/i.test(w) ? 'hollow' : /^candle/i.test(w) ? 'candles' : /^(?:bars?|ohlc)$/i.test(w) ? 'bars' : /^line$/i.test(w) ? 'line' : /^area$/i.test(w) ? 'area' : null)
const xoGroupKey = (c) => (typeof c?.group === 'string' && c.group && !c.group.startsWith('N') ? `g:${c.group}` : `c:${c.ref}`)
// a plural description: every chart that fits (none → UNPLACED); a singular one: exactly one chart or one link group
function xoPick(hits, plural) {
  if (!hits.length) return { kind: 'unplaced', unoffered: [] }
  if (plural || new Set(hits.map(xoGroupKey)).size === 1) return { kind: 'placed', refs: hits.map(c => c.ref) }
  return { kind: 'unplaced', unoffered: hits.map(c => c.ref) }
}
function xoTimeframe(item, charts, weak) {
  let m, word, plural, noun
  if ((m = XO_TF3.exec(item))) { word = m[1]; plural = true; noun = true }
  else if ((m = XO_TF1.exec(item))) { word = m[1]; noun = !!m[2]; plural = !m[2] || /s$/i.test(m[2]) || XO_PLURAL_DET.test(item) }
  else if ((m = XO_TF2.exec(item))) { word = m[2]; noun = true; plural = /s$/i.test(m[1]) || XO_PLURAL_DET.test(item) }
  else return null
  if (weak && !noun) return { kind: 'none' }                       // "weekly, not daily": a value contrast
  const p = xoTfPred(word)
  return p ? xoPick(charts.filter(p), plural) : null
}
function xoType(item, charts) {
  let m, word, nounW
  if ((m = XO_TY1.exec(item))) { word = m[1]; nounW = m[2] } else if ((m = XO_TY2.exec(item))) { word = m[2]; nounW = m[1] } else return null
  const t = xoTypeOf(word)
  if (!t) return null
  return xoPick(charts.filter(c => String(c?.cs?.chartType || 'candles').toLowerCase() === t), /s$/i.test(nounW) || XO_PLURAL_DET.test(item))
}
function xoSize(item, charts) {
  const m = XO_SZ.exec(item)
  if (!m) return null
  const plural = /s$/i.test(m[2]) || XO_PLURAL_DET.test(item)
  const wide = /^(?:wide|wider|widest|narrow|narrower|narrowest)$/i.test(m[1])
  const big = /^(?:big|bigger|biggest|large|larger|largest|huge|wide|wider|widest)$/i.test(m[1])
  const size = (c) => (c?.cell ? (Number(c.cell.w) || 0) * (wide ? 1 : (Number(c.cell.h) || 0)) : null)
  const all = charts.map(c => c.ref)
  if (charts.some(c => size(c) == null)) return { kind: 'unplaced', unoffered: all }
  const sizes = charts.map(size)
  const hi = Math.max(...sizes), lo = Math.min(...sizes)
  if (hi === lo) return { kind: 'unplaced', unoffered: all }       // every chart the same size: no "big one" on this board
  const hits = charts.filter(c => size(c) === (big ? hi : lo))
  const r = xoPick(hits, plural)
  return r.kind === 'placed' ? r : { kind: 'unplaced', unoffered: hits.map(c => c.ref) }
}
function xoTicker(item, charts, changed) {
  const m = XO_TK.exec(item)
  if (!m) return null
  const tok = m[1], up = tok.toUpperCase(), poss = !!m[2]
  const list = charts.filter(c => String(c?.symbol || '').toUpperCase() === up)
  if (list.length && (tok === up || (tok.length >= 3 && !LOWER_STOP.test(tok)))) {
    if (changed?.(up)) return { kind: 'none' }                     // a ticker the words CHANGE is never one they exclude
    return xoPick(list, (m[3] && /s$/i.test(m[3])) || XO_PLURAL_DET.test(item))
  }
  if (/^[A-Z]/.test(tok) && poss) return { kind: 'unplaced', unoffered: [] }   // "Apple's": a chart the board cannot place
  if (tok === up && /^[A-Z][A-Z0-9.]*$/.test(tok) && tok !== 'I') return { kind: 'none', ticker: true }   // not on the board: master policy
  return null
}
// a predicate after an exclusion's object (subject position) or the change's value after it ("… with AMD", "… to weekly")
const XO_PRED_VERB = String.raw`(?:goes|go|switch(?:es)?|flips?|turns?|moves?|gets?|becomes?|should|stays?|remains?|is|are|can|will|must|may|could|needs?|changes?|looks?)`
const XO_PREDICATE = new RegExp(String.raw`^(?:${XO_PRED_VERB}\b|(?:to|into|onto)\s)`)
// "… with AMD" is the change's VALUE only in a replace / swap request ("replace every chart except the top-right one with AMD");
// anywhere else it narrows ("the daily ones with RSI": unplaced, never the daily ones)
const XO_REPLACE = /\b(?:replace|replacing|swap|swapping|substitute|exchange)\b/i
const XO_WITH_VALUE = /^(?:with|for)\s+\$?[A-Z]{1,5}\b/
const XO_PRED_IN = new RegExp(String.raw`\s${XO_PRED_VERB}\b`, 'i')
const XO_DESC_ATTR =new RegExp(String.raw`\b${XO_TFPL}\b|\b${XO_TFW}\b|\b${XO_TYPEW}(?:[\s-]+(?:style|type))?\s+${XO_NOUN}\b|\b${XO_SIZEW}\s+${XO_NOUN}\b`, 'i')
// a board ticker in the words (a short one in capitals only)
const xoNamesSym = (t, charts) => charts.some(c => {
  const s = String(c?.symbol || '')
  return s.length >= 2 && new RegExp(String.raw`(?:^|[^A-Za-z0-9.])\$?${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, s.length >= 4 ? 'i' : '').test(t)
})
const xoDeferred = (item) =>!!clickRole(item) || BARE_PRONOUN.test(item) || /^(?:mine|my\s+own(?:\s+\w+)?)$/i.test(item)
  || GEN_RELATION.test(item) || anchorRelSpans(`except ${item}`, { clickToo: true }).length > 0
const xoPositionShaped = (p) => REF_SHAPE.test(p) || BARE_ORD_PLACE.test(p)
  || /^(?:the\s+)?(?:top|bottom|upper|lower|middle|cent(?:er|re)|first|second|third|last|left|right)\s+(?:row|column)$/i.test(p)
  || /^(?:the\s+)?(?:(?:two|three|four|pair|2|3|4)\s+)?(?:(?:charts?|ones?)\s+)?(?:on|at|along)\s+the\s+(?:left|right|top|bottom)(?:\s+(?:side|edge|row|column))?$/i.test(p)
  || /^(?:the\s+)?(?:(?:top|bottom|upper|lower|left|right)[\s-]*){1,2}(?:one|chart|cell|pane|panel|graph|side)?s?$/i.test(p)
/** The charts an unreadable item MAY mean (never offered): its tickers', timeframes', places' charts — or every chart. */
function xoMayMean(item, charts) {
  const may = new Set()
  for (const c of charts) {
    const sym = String(c?.symbol || '')
    if (sym && new RegExp(String.raw`(?:^|[^A-Za-z0-9.])${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, sym.length <= 2 ? '' : 'i').test(item)) may.add(c.ref)
  }
  for (const m of item.matchAll(new RegExp(String.raw`\b(${XO_TFPL}|${XO_TFW})\b`, 'gi'))) { const p = xoTfPred(m[1]); if (p) for (const c of charts) if (p(c)) may.add(c.ref) }
  for (const w of item.toLowerCase().match(/\b(?:top|bottom|upper|lower|left|right)\b/g) || []) {
    const k = w.replace('upper', 'top').replace('lower', 'bottom')
    for (const c of charts) if (String(c?.position || '').split('-').includes(k)) may.add(c.ref)
  }
  return may.size ? [...may] : charts.map(c => c.ref)
}
/**
 * One item of an exclusion's object → { kind: 'placed', refs } | { kind: 'unplaced', unoffered } | { kind: 'defer' } |
 * { kind: 'none' }. `only` limits the readers (the stay / negated-action forms read descriptions only).
 */
function xoReadItem(item0, charts, ctx, { weak = false, only = null } = {}) {
  const off = ctx.off
  const on = (k) => !off.has(k) && (!only || only.includes(k))
  const base = ordinalDigits(String(item0 || '').trim().replace(/^(?:also|just|only|even|both\s+of|either\s+of)\s+/i, '')
    .replace(/^(?:changing|touching|affecting|modifying|altering|updating|including)\s+/i, ''))
    .replace(/\b(row|column)s\b/gi, '$1')
  if (!base) return { kind: 'none' }
  const tries = [base]
  if (!/^(?:the|my|this|that|those|these|both|all|any|chart)\b/i.test(base) && !/^\$?[A-Z]/.test(base)) tries.push(`the ${base}`)
  const noDest = base.replace(/\s+(?:to|into|onto)\s+\S[\s\S]*$/i, '').trim()
  if (noDest && noDest !== base) tries.push(noDest)
  const noPrep = base.replace(/^(?:on|in|for|from)\s+(?=\S)/i, '').trim()
  if (noPrep !== base) tries.push(noPrep)
  // the change's own setting after the object ("except SPY on weekly", "but the bottom row to 1h please")
  const noSetting = base.replace(XO_SETTING_TAIL, '').trim()
  if (noSetting && noSetting !== base) tries.push(noSetting)
  for (const t of tries) {
    const r = (on('timeframe') && xoTimeframe(t, charts, weak)) || (on('type') && xoType(t, charts)) || (on('size') && xoSize(t, charts))
      || (on('ticker') && xoTicker(t, charts, ctx.changed))
    if (r) return r
  }
  // the click, a pronoun or a relation — also once the change's own setting is off it ("keep it daily") — is the legacy readers'
  if (tries.some(xoDeferred)) return { kind: 'defer' }
  // a complement ("the other charts", "the rest") is no chart the exclusion names
  if (ACT_COMPLEMENT.test(base)) return { kind: 'none' }
  // SUBJECT POSITION / a replacement after the object: "everything except the QQQ one goes weekly", "every chart except the
  // top-right one with AMD" — the object is the longest leading phrase a reader places when what follows is a predicate or the
  // change's value (never a narrowing: "the daily ones in the top row" stays whole, and so unplaced)
  const words = base.split(/\s+/)
  for (let n = words.length - 1; n >= 1; n--) {
    const rest = words.slice(n).join(' ')
    if (!XO_PREDICATE.test(rest) && !(ctx.replace && XO_WITH_VALUE.test(rest))) continue
    const pre = words.slice(0, n).join(' ')
    const r = (on('timeframe') && xoTimeframe(pre, charts, weak)) || (on('type') && xoType(pre, charts)) || (on('size') && xoSize(pre, charts))
      || (on('ticker') && xoTicker(pre, charts, ctx.changed))
      || (!only && on('position') && ctx.place && !xoDeferred(pre) && xoPositionShaped(ordinalDigits(pre)) ? ctx.place(ordinalDigits(pre)) : null)
    if (r && r.kind === 'placed') return r
  }
  // a clause ("the second chart stays as it is", "my watchlist goes weekly") is the stative / legacy readers'
  if (XO_PRED_IN.test(base.replace(/\b(?:that|which|who)\s+(?:are|is)\b|\bthat['’]re\b/gi, ' '))) return { kind: 'defer' }
  const shaped = only ? null : tries.find(xoPositionShaped)
  if (shaped && on('position') && ctx.place) return ctx.place(shaped)
  if (shaped && !ctx.place) return { kind: 'defer' }
  // ⛔ FAIL SAFE: a board attribute no reader placed is UNPLACED — never nothing
  if (XO_ATTR.test(base) || xoNamesSym(base, charts)) return { kind: 'unplaced', net: true, unoffered: xoMayMean(base, charts) }
  return { kind: 'none' }
}
/** The items of an object body (commas, and, or, nor, &, plus) with their offsets in the body. */
function xoItems(body, off) {
  if (off.has('list')) return [{ t: body, at: 0 }]
  const items = []
  let last = 0
  let sep = ''
  for (const sp of body.matchAll(XO_SEP)) { if (!sp[0]) continue; items.push({ t: body.slice(last, sp.index), at: last, sep }); sep = sp[0]; last = sp.index + sp[0].length }
  items.push({ t: body.slice(last), at: last, sep })
  return items
}
/**
 * Every exclusion object in the words, read on the board → { refs: Set, unplaced, unoffered: Set, spans: [{ index, end, form,
 * verdicts, whole }] } (whole: every item of the span placed).
 * `place(phrase)` is the legacy phrase resolver for a position (excludedCharts' readException); null = positions deferred.
 */
export function readExclusionObjects(text0, charts = [], opts = {}, place = null) {
  const s = String(text0 || '')
  const off = new Set(opts?.xoDisable || [])
  const res = { refs: new Set(), unplaced: false, unoffered: new Set(), spans: [] }
  if (!s.trim() || charts.length < 1) return res
  const ctx = { off, changed: opts?.changed || null, place, replace: XO_REPLACE.test(s) }
  const ef = exceptForm(s)
  const wide = REST_WORDS.test(s) || WHOLE_BOARD.test(s) || EVERY_Q.test(ef) || !!bareQuantifier(ef)
  const cues = []
  for (const m of s.matchAll(XO_PREFIX)) {
    if (XO_VALUE_BEFORE.test(s.slice(0, m.index))) continue       // "anything other than daily": a value, not a chart set
    cues.push({ at: m.index, bodyAt: m.index + m[0].length, form: 'prefix' })
  }
  for (const m of s.matchAll(XO_CIRCUM)) cues.push({ at: m.index, bodyAt: m.index + m[0].length, form: 'circum' })
  for (const m of s.matchAll(XO_NOT)) cues.push({ at: m.index, bodyAt: m.index + m[0].length, form: 'not' })
  if (wide) for (const m of s.matchAll(XO_SEP_BUT)) cues.push({ at: m.index, bodyAt: m.index + m[0].length, form: 'but' })
  const take = (v) => {
    if (v.kind === 'placed') for (const r of v.refs) res.refs.add(r)
    if (v.kind === 'unplaced') { res.unplaced = true; for (const r of v.unoffered || []) res.unoffered.add(r) }
  }
  for (const k of cues) {
    const rest = s.slice(k.bodyAt)
    const e = rest.search(XO_BODY_END)
    let body = e < 0 ? rest : rest.slice(0, e)
    const nc = ACT_NEXT_COMMAND.exec(body)
    if (nc) body = body.slice(0, nc.index)
    const items = xoItems(body, off)
    const weak = k.form === 'not' || k.form === 'but'
    const appos = XO_INDEF_BEFORE.test(s.slice(0, k.at)) && !items.some(x => /\S/.test(x.sep || '') && !/^\s*,\s*$/.test(x.sep))
    const got = []
    let end = 0, strongTail = false, at = false
    for (let i = 0; i < items.length; i++) {
      const raw = items[i].t
      const t0 = raw.trim()
      if (!t0 || XO_LIST_END.test(t0)) break
      if (i > 0 && appos) break
      const tm = XO_TAIL.exec(t0)
      let core = (tm ? tm[1] : t0).trim()
      const tail = tm ? tm[2] || '' : ''
      let v = xoReadItem(core, charts, ctx, { weak })
      // "keep the top one on daily": a kept setting after the object (only when the whole item is no description itself —
      // "the charts set to daily" IS one)
      if (k.form === 'circum' && !tail && v.kind !== 'placed') {
        const a = XO_KEEP_AT.exec(core)
        if (a && a[1].trim()) { const v2 = xoReadItem(a[1].trim(), charts, ctx, { weak }); if (v2.kind === 'placed' || (v2.kind !== 'none' && (v.kind === 'none' || v.kind === 'defer'))) { v = v2; at = true } }
      }
      // a shared noun / determiner: "the daily and weekly ones", "the top and bottom rows" — retried with the list's noun
      if (v.kind !== 'placed' && i < items.length - 1) {
        const noun = new RegExp(String.raw`\s(${XO_NOUN}|rows|columns)\s*$`, 'i').exec(items[items.length - 1].t.trim().replace(XO_TAIL, '$1'))
        if (noun && !new RegExp(String.raw`\b${XO_NOUN}$`, 'i').test(core)) {
          const v2 = xoReadItem(`${/^(?:the|my|those|these|both|all)\b/i.test(core) ? '' : 'the '}${core} ${noun[1]}`, charts, ctx, { weak })
          if (v2.kind === 'placed') v = v2
        }
      }
      // "not X" / "but X": only an object that names a board attribute ("weekly, not daily" and "not the chart I meant" are
      // contrasts: the legacy readers' verdict stands)
      if (weak && i === 0 && v.kind !== 'placed' && v.kind !== 'unplaced') break
      // …and a fail-safe UNPLACED only for a DESCRIPTION with a chart noun ("not the daily ones" on a board with none); a position
      // or a clause ("but the first chart stays as it is") stays with the legacy readers
      if (weak && v.net && !((XO_DESC_ATTR.test(core) && new RegExp(String.raw`\b(?:${XO_NOUN}|${XO_TFPL})\b`, 'i').test(core)) || xoNamesSym(core, charts) || xoPositionShaped(ordinalDigits(core)))) { if (i === 0) break; v = { kind: 'defer' } }
      got.push(v)
      end = items[i].at + raw.replace(/\s+$/, '').length
      if (tail) { strongTail = strongTail || XO_STRONG_TAIL.test(tail); break }
      if (at) break
      // a non-chart first item ends the object ("except volume and …" is no list of charts)
      if (i === 0 && v.kind === 'none' && !v.ticker) break
    }
    if (!got.length) continue
    // "not all the daily charts" may mean SOME of them: never exact — asked, none of them offered
    if (k.form === 'not' && /^\s*all\b/i.test(body)) for (let i = 0; i < got.length; i++) if (got[i].kind === 'placed') got[i] = { kind: 'unplaced', unoffered: got[i].refs }
    // leave / keep / let X: an exclusion only with its tail ("alone", "as is", …), a kept setting, or beside the whole board
    // ("keep the top one on daily" alone can be the change itself: a kept setting counts only beside the whole board)
    if (k.form === 'circum' && !strongTail && !wide) continue
    if (got.every(v => v.kind === 'none')) continue
    for (const v of got) take(v)
    const whole = got.every(v => v.kind === 'placed' || v.kind === 'none') && got.some(v => v.kind === 'placed')
    res.spans.push({ index: k.at, end: k.bodyAt + end, form: k.form, verdicts: got.map(v => v.kind), whole })
  }
  // an ADDITIVE tail after an exclusion ("…leave the daily ones alone, and the weekly one too"): the legacy additive reader finds
  // it (additiveRefs); its object is read here like any other item
  for (const r of additiveRefs(s, charts)) {
    const v = xoReadItem(r.phrase, charts, ctx)
    if (v.kind !== 'placed' && v.kind !== 'unplaced') continue
    take(v)
    res.spans.push({ index: r.index, end: r.end, form: 'additive', verdicts: [v.kind], whole: v.kind === 'placed' })
  }
  // "<descriptions> stay as they are / are fine": the stative keep — read only when every item is a description it places
  if (!off.has('stay')) {
    for (const m of s.matchAll(XO_STAY)) {
      const subj = m[1]
      const at = m.index + m[0].indexOf(subj)
      const items = xoItems(subj, off).map(x => x.t.trim()).filter(Boolean)
      // a description subject only (a position's stated keep is the legacy G5 rule's): every item names a timeframe, a chart
      // type or size with a chart noun, or a board ticker
      if (!items.length || !items.every(x => XO_DESC_ATTR.test(x) || xoNamesSym(x, charts))) continue
      const vs = items.map(x => xoReadItem(x, charts, ctx, { only: ['timeframe', 'type', 'size', 'ticker'] }))
      if (!vs.length || vs.some(v => v.kind === 'none' || v.kind === 'defer')) continue
      if (vs.some(v => v.kind === 'unplaced' && !v.unoffered?.length)) continue     // describes no chart here: a statement
      for (const v of vs) take(v)
      res.spans.push({ index: at, end: at + subj.length, form: 'stay', verdicts: vs.map(v => v.kind), whole: vs.every(v => v.kind === 'placed') })
    }
  }
  // a negated imperative's DESCRIPTIONS anywhere in its clause ("don't add RSI to the daily ones", "never hide volume on the
  // dailies"): every description is a chart the change must never land on
  if (!off.has('negAction')) {
    for (const m of s.matchAll(NEG_ACT_RE)) {
      let body = String(m[3] || '')
      const ce = GEN_CLAUSE_END.exec(body)
      if (ce) body = body.slice(0, ce.index)
      const nc = ACT_NEXT_COMMAND.exec(body)
      if (nc) body = body.slice(0, nc.index)
      const bodyAt = m.index + m[0].length - String(m[3] || '').length
      for (const h of body.matchAll(XO_SCAN)) {
        const v = xoReadItem(h[0], charts, ctx, { only: ['timeframe', 'type', 'size'] })
        if (v.kind !== 'placed' && v.kind !== 'unplaced') continue
        if (v.kind === 'unplaced' && !v.unoffered?.length) v.unoffered = xoMayMean(h[0], charts)
        take(v)
        res.spans.push({ index: bodyAt + h.index, end: bodyAt + h.index + h[0].length, form: 'negAction', verdicts: [v.kind], whole: v.kind === 'placed' })
      }
    }
  }
  return res
}
/** The exclusion-object spans the words hold (everyExceptSet's "is there an exclusion" test; positions left to the readers). */
export function exclusionObjectSpans(text, charts = []) {
  try { return readExclusionObjects(text, charts, {}, null).spans.filter(x => x.verdicts.some(v => v === 'placed' || v === 'unplaced')) } catch { return [] }
}
/** The words with every exclusion object's span blanked, position for position: a place listed only to EXCLUDE a chart ("…other
 *  than NVDA, the bottom row") is no place the request aims at. */
/** A stand-in board for reading the words alone: one chart per capitalized ticker-like word (span finding only, never placing). */
export function syntacticBoard(text) {
  const toks = [...new Set([...String(text || '').matchAll(/(?:^|[^A-Za-z0-9.$])\$?([A-Z]{1,5})(?![A-Za-z0-9])/g)].map(m => m[1]).filter(t => t !== 'I'))]
  return toks.length ? toks.map(t => ({ ref: `sym:${t}`, symbol: t, tf: '' })) : [{ ref: 'sym:', symbol: '', tf: '' }]
}
export function withoutExclusionObjects(text, charts = [], onto = null) {
  let s = onto == null ? String(text || '') : String(onto)
  // (only a span this reader read — a placed or unplaced item; a span of deferred references stays the legacy readers' words)
  try { for (const x of exclusionObjectSpans(String(text || ''), charts)) s =s.slice(0, x.index) + ' '.repeat(Math.max(0, x.end - x.index)) + s.slice(x.end) } catch { /* the words as said */ }
  return s
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
export function spatialConstraints(text0, charts = [], sel = null, opts = {}) {
  const out = { allowed: null, excluded: new Set(), count: null, plural: false, why: [] }
  // (H-RDR-1 follow-up) an ANCHOR-RELATIVE exclusion ("except the chart under the top-right one") states no target and no
  // relation from the click: blanked for every reader here (its chart is excludedCharts' — read on the words as said, below)
  const anchorRel = anchorRelExclusions(text0, charts, sel, opts?.subject || null)
  const text = anchorRel.length ? blankAnchorRel(text0, anchorRel) : text0
  const add = (refs, why) => { out.allowed = out.allowed || new Set(); for (const r of refs) out.allowed.add(r); out.why.push(why) }
  // (H-RDR-1) a negated chart clause names an EXCLUSION, never an allowed target ("hands off the top-left one" is no place to aim)
  const clauses = targetClauses(withoutExclusionObjects(text, charts, blankNegChartRefs(text, charts)))
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
      // (H-RDR-1) …and only when the words WITHOUT their negated chart / ticker clauses still relate a chart to it: "…, but keep
      // the bottom right one as it is" says nothing about the click ("as it is" is no relation from it), so it is no anchor
      const relB = relativeChart(blankNegatedClauses(text, charts), charts, sel)
      if (!hits.includes(sel) && relB && !relB.alsoClick && !relB.negated) out.excluded.add(sel)
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
  const exc = excludedCharts(text0, charts, sel, opts)
  for (const r of exc) out.excluded.add(r)
  out.unoffered = exc.unoffered
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
// (#2532 follow-up) a BARE whole-board quantifier — "set all to weekly but leave AAPL alone", "make each weekly except AMD", "put
// RSI on the lot, skip chart 2" — carries no chart noun, so EVERY_Q never read it and the plan was only proposed ("I wasn't sure
// you meant …"). It is read as "every chart" ONLY in the shape where it can mean nothing else: the quantifier stands alone (its
// next word is the change's destination / setting / an exclusion word / the clause's end — never a noun: "all indicators", "all
// the lines", "each other", "every one of the drawings" stay what they were), it is no idiom ("at all", "after all", "above all",
// "all in all", "that's all"), and — as for every quantifier here — the exclusion must PLACE a chart (an indicator, a value or an
// unplaceable phrase forms no set: "remove all but RSI", "hide all except volume" keep their meaning and are handled as before).
// "the rest / the others / everything else" counts only when the caller says nothing else can be "the rest" of (`opts.rest`: no
// click, no earlier-turn chart) — otherwise "the rest" may be relative to that chart, and the gates ask as before.
// ⛔ NO LOOKBEHIND (#988 AUDIT L1): the idiom test reads the words before the match in code.
const BARE_NEXT = String.raw`(?=\s*(?:[,;:.!?—–]|$)|\s+(?:to|into|onto|on|in|at|for|but|except|apart|other\s+than|save|minus|excluding|besides|aside|bar|barring|without|please|now|too|then|and|so|weekly|daily|monthly|hourly|intraday|log|linear|percent(?:age)?|candles?|candlesticks?|bars|heikin|\d{1,3}\s*(?:m|min|mins|minutes?|h|hr|hours?|d|w)?)\b)`
const BARE_Q = new RegExp(String.raw`\b(?:all|each|every\s+(?:single\s+)?one|the\s+(?:whole\s+)?lot)${BARE_NEXT}`, 'gi')
const REST_Q = new RegExp(String.raw`\b(?:(?:all\s+)?the\s+(?:rest|others)|everything\s+else|all\s+(?:the\s+)?others)${BARE_NEXT}`, 'gi')
const BARE_IDIOM_BEFORE = /\b(?:at|after|above|all\s+in|that['’]?s|is|was|it['’]?s|of|once\s+and\s+for|not)\s+$/i
const BARE_IDIOM_AFTER = /^\s+(?:in\s+all|of\s+(?:a\s+)?sudden|set|good|done|right|clear|gone|the\s+same)\b/i
/** The first bare whole-board quantifier in the (exceptForm'd) words, or null. */
export function bareQuantifier(t, { rest = false } = {}) {
  const s = String(t || '')
  for (const re of rest ? [BARE_Q, REST_Q] : [BARE_Q]) {
    for (const m of s.matchAll(re)) {
      if (BARE_IDIOM_BEFORE.test(s.slice(0, m.index)) || BARE_IDIOM_AFTER.test(s.slice(m.index + m[0].length))) continue
      return m
    }
  }
  return null
}
export const quantifierCoversClick = (scoped) => !scoped
export function everyExceptSet(text, charts = [], sel = null, opts = {}) {
  const t = exceptForm(text)
  const q = EVERY_Q.exec(t) || bareQuantifier(t, { rest: !!opts?.rest })
  if (!q) return null
  const after = q.index + q[0].length
  const ex0 = EXCEPT_WORD.exec(t.slice(after))
  // (hotfix) a negated-TICKER clause beside the quantifier ("every chart weekly, but leave NVDA's alone") is this family too:
  // the quantifier's own words run to its clause's end, and the exclusion is the ticker the clause names
  // (H-RDR-1) …and a negated CHART clause ("every chart weekly, but leave the top-left one alone", "…; skip chart 2")
  const ex = ex0 || ((negTickerRefs(text, charts).length || negChartRefs(text, charts).length || negActionRefs(text, charts).length || anchorRelSpans(text).length || exclusionObjectSpans(text, charts).length)
    ? { index: t.slice(after).split(/[,;:.!?—–]|\s+(?:but|and|then|though)\s+/i)[0].length, neg: true } : null)
  if (!ex) return null
  const seg = t.slice(after, after + ex.index).replace(BOARD_PP, ' ')
  const phrase = ex.neg ? '' : t.slice(after + ex.index).split(/[,;.!?]|\s+(?:and|then)\s+/i)[0]
  const excluded = new Set(excludedCharts(text, charts, sel, opts))
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
    const sc = spatialConstraints(t.slice(0, after + ex.index), charts, sel, opts)
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
export function withoutExcludedCharts(ops, texts, { host, getTargetKind, getCapability, subject = null }) {
  const charts = host?.charts?.list?.() || []
  if (charts.length < 2 || !Array.isArray(ops) || !ops.length) return { ops, dropped: 0 }
  const sel = selectedChart(host)
  const ex = new Set()
  for (const t of new Set((texts || []).filter(x => typeof x === 'string' && x.trim()))) {
    for (const r of excludedCharts(t, charts, sel, { subject })) ex.add(r)
    for (const r of spatialConstraints(t, charts, sel, { subject }).excluded) ex.add(r)
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
      // ⛔ EVERY chart the change lands on, not only the one its snapshot names: a drawing shows on every chart of its symbol,
      // and a symbol change on a linked chart retargets its whole link group (chartLanding) — "…except the top-right one" never
      // changes the top-right chart through the chart it is linked to / shares drawings with
      const landed = snap ? chartsLandedOn(cap, kind, snap, charts) : null
      // ⛔ fail closed: a landing that cannot be read (chartLanding `unknown`) is never assumed to miss the excluded chart
      if (landed && (landed.unknown || [...landed].some(r => ex.has(r)))) { dropped++; continue }
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
export function checkSpatialConstraints({ host, ops, text, pickedRefs = [], getTargetKind, getCapability, subject = null }) {
  if ((pickedRefs || []).some(Boolean)) return null                         // the member picked from UCT's own question
  const charts = host?.charts?.list?.() || []
  if (charts.length < 2) return null
  const sel = selectedChart(host)
  const k = spatialConstraints(text, charts, sel, { subject })
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
  // ⛔ (hotfix) never a chart the words exclude, nor one an unplaced exclusion may mean (a ticker on several charts)
  const pool = new Set((ok.length ? ok : charts.filter(c => !k.excluded.has(c.ref))).map(c => c.ref).filter(r => !k.unoffered?.has(r)))
  // the choices are entries of the plan's own target kind (a chart, or a chart's indicators entry), as the screens before offer
  const choices = first.list.filter(s => pool.has(chartRefOf(first.kind, s))).map(s => ({ ref: s.ref, label: s.label }))
  return { ask: { text: k.plural || countOff ? 'Which charts do you mean? Your words name these:' : 'Which chart do you mean? Pick one:', choices },
    violation: { bad, countOff, why: k.why } }
}
