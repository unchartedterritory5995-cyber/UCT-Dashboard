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

const INERT = /\b(?:fine|alone|leave|leaving|left alone|can stay|stays?|stay put|untouched|as (?:it|they) (?:is|are)|don'?t|do not|doesn'?t|not|never|ignore|skip|keep)\b/i
const CLAUSES = /[,;.!?]|\b(?:and then|but|then|while|also|plus|although|though)\b/i
const MOVE = /\b(?:move|moving|shift|drag|slide|swap|put (?:it|this|this one|this chart) (?:in|on|into))\b/i
// a line / place introduced by these is not the change's target (a comparison, a source, a neighbour's anchor, a destination)
const NOT_TARGET_PREP = /\b(?:like|as|than|from|beside|next to|near|above|below|under(?:neath)?|over|beneath|left of|right of|to the (?:left|right) of|on top of|into|onto)\s*$/i

const ROW_WORD = { top: 'first', upper: 'first', first: 'first', bottom: 'last', lower: 'last', last: 'last', middle: 'middle', center: 'middle', centre: 'middle', second: 1, third: 2 }
const COL_WORD = { left: 'first', first: 'first', right: 'last', last: 'last', middle: 'middle', center: 'middle', centre: 'middle', second: 1, third: 2 }
const WHOLE_LINE = /\b(?:the|my)\s+(top|bottom|upper|lower|middle|cent(?:er|re)|first|second|third|last|left|right)\s+(row|column)\b(?!['’]s)/gi
const PLACE_BEFORE = /\b(?:first|second|third|last|middle|cent(?:er|re)|left(?:most)?|right(?:most)?|top(?:most)?|bottom(?:most)?|upper(?:most)?|lower(?:most)?)\s+(?:chart|one|cell|pane|panel|graph)\s+(?:in|of|on|along|from)\s*$/i
// a relation whose anchor is NAMED (not "this / it / the selected one"): "beside the top-left chart", "above the NVDA chart"
const REL_NAMED = /\b(beside|next to|alongside|above|over|on top of|below|under(?:neath)?|beneath|(?:to the |on the )?left of|(?:to the |on the )?right of)\s+(the\s+(?!(?:one|chart)\b)[a-z0-9 -]{1,30}?\s*(?:chart|one|cell|pane|graph))\b/gi
const SIDES = (w) => {
  const s = w.toLowerCase()
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
const CL_REST = new RegExp(`\\b(?:(?:the\\s+)?rest\\s+of|(?:the\\s+)?other\\s+(chart|one|cell|pane|charts|ones|cells|panes)\\s+(?:in|of|on|along)|everything\\s+else\\s+(?:in|on|of|along)|(?:all\\s+)?the\\s+others\\s+(?:in|on|of|along))\\s+${CL_DEIXIS}\\s+(row|column)\\b`, 'i')
// (G3) "everything / all the charts in this row | column" — the WHOLE line, the click in it (an exclusion is taken out of it)
const CL_ALL = new RegExp(`\\b(?:everything|all\\s+(?:of\\s+)?(?:the\\s+)?(?:charts|ones|cells|panes))\\s+(?:in|on|along|of)\\s+${CL_DEIXIS}\\s+(row|column)\\b`, 'i')
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
  m = CL_REST.exec(s)
  if (m) return tag(m, { kind: 'rest', axis: m[2].toLowerCase(), one: !!m[1] && !/s$/i.test(m[1]) })
  m = CL_ALL.exec(s)
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
  if (k.kind === 'rest') { const hits = clickLine(charts, s, k.axis).filter(c => c.ref !== s.ref && !ex.has(c.ref)); return { hits, plural: !k.one, onClick: false } }
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
function targetClauses(text) {
  return String(text || '').split(CLAUSES).map(s => s.trim()).filter(s => s && !INERT.test(s))
}
/** The words with every inert clause dropped: what names a TARGET (AUDIT probe 18 G5: "…, the QQQ chart next to SPY is fine"). */
export function activeText(text) {
  return targetClauses(text).join(', ')
}

// ── AUDIT probe 18 (#988) ──
// (G3) an EXCLUSION: "everything in this row except SPY", "all the charts but not the QQQ one", "other than this one" — the
// charts it names are never targets (a plan that includes one is asked, on the apply AND the proposal path)
const EXCEPT = /\b(?:except(?:\s+for)?|but\s+not|other\s+than|apart\s+from|excluding|save\s+for|minus)\s+((?:the\s+)?[A-Za-z0-9 -]{1,30}?)(?=\s+(?:on|to|in|onto|at|for|from|please|thanks|weekly|daily|monthly|hourly)\b|\s*[,.;!?]|\s*$)/gi
/** The charts an exclusion in the words names (by symbol, position, order, or "this one" = the click). */
export function excludedCharts(text, charts = [], sel = null) {
  const out = new Set()
  for (const m of String(text || '').matchAll(EXCEPT)) {
    const phrase = m[1].trim()
    if (/^(?:the\s+)?(?:this(?:\s+(?:one|chart))?|it|the\s+(?:selected|clicked)\s+(?:one|chart))$/i.test(phrase)) { if (sel) out.add(sel); continue }
    const a = namedAnchor(/\b(?:chart|one)$/i.test(phrase) ? phrase : `${phrase} chart`, charts) || namedAnchor(phrase, charts)
    if (a) out.add(a.ref)
  }
  return out
}
// (G4) "the SPY chart on weekly, and the one to ITS right": a relation's possessive / pronoun anchor after a clause that names
// exactly ONE chart (by symbol, position or order) is THAT chart — never the click
const ANAPHOR = /\b(?:its|it)\b/i
/** The anchor a relation in the words is read from: a chart named in an earlier clause when the relation says "its / it", else the click. */
export function relationAnchor(text, charts = [], sel = null) {
  const parts = String(text || '').split(CLAUSES).map(s => s.trim()).filter(Boolean)
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
  return out
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
  const countOff = k.count != null && planned.size !== k.count
  if (!bad.length && !countOff) return null
  const ok = charts.filter(c => (!k.allowed || k.allowed.has(c.ref)) && !k.excluded.has(c.ref))
  const pool = new Set((ok.length ? ok : charts.filter(c => !k.excluded.has(c.ref))).map(c => c.ref))
  // the choices are entries of the plan's own target kind (a chart, or a chart's indicators entry), as the screens before offer
  const choices = first.list.filter(s => pool.has(chartRefOf(first.kind, s))).map(s => ({ ref: s.ref, label: s.label }))
  return { ask: { text: k.plural || countOff ? 'Which charts do you mean? Your words name these:' : 'Which chart do you mean? Pick one:', choices },
    violation: { bad, countOff, why: k.why } }
}
