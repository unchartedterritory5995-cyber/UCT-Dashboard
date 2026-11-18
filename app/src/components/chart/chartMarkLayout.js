// THE MARKS AS LABELS (the Study drill chart; the owner on the real member screen, 2026-11-17: "the arrow and the
// text/font could look much better and be a lot more of a cool production"). The library's own bar markers are a plain
// arrow and system text; ChartMarkOverlay draws the same marks as HTML instead: a pointer whose tip sits on the bar, a
// hairline stem when the label has to stand off, and a pill with the word. This file is the pure half: the sizes, the
// colours a mark's hue turns into, and where each piece goes, so the placement is tested without a chart.
//
// Placement rules, in order:
//   1. the pointer's tip sits `gap` px off the bar: under its low for a bottom mark, over its high for a top mark;
//   2. the pill is pushed out past every candle under its width, so a label never covers a candle where the room exists
//      (the stem then runs from the pointer to the pill); it sits centred on the bar, or leans to one side when the
//      candles there let it sit clearly closer (on a trend one side's candles are much nearer), inside the plot;
//   3. a pill that would land on a pill already placed on that side stacks outward past it;
//   4. a pill is kept inside the price pane; when that clamp would put it over its own bar it takes the other side.

/** The look on a wide screen and on a phone (>= 11 px type on a phone: the owner reviews on his). */
export const MARK_SIZES = Object.freeze({
  wide: Object.freeze({ font: 12, h: 24, padX: 10, glyph: 9, glyphGap: 6, track: 0.14, caretW: 11, caretH: 7, gap: 3, stemMin: 3, clear: 5, stack: 5, edge: 4, dot: 7 }),
  phone: Object.freeze({ font: 11, h: 21, padX: 8, glyph: 8, glyphGap: 5, track: 0.12, caretW: 9, caretH: 6, gap: 3, stemMin: 2, clear: 4, stack: 4, edge: 3, dot: 6 }),
})

/** A look: one of MARK_SIZES, by name or as given. */
export function markSize(look) {
  if (look && typeof look === 'object' && Number.isFinite(look.font)) return { ...MARK_SIZES.wide, ...look }
  return MARK_SIZES[look === 'phone' || look?.size === 'phone' ? 'phone' : 'wide']
}

/** The pill's width for `text` (upper-cased, letter-spaced, a glyph ahead of it when `glyph`): an estimate from the
 *  type's average advance, used where nothing has been laid out (a test, the first frame before the font is in). */
export function estimatePillWidth(text, look, glyph = false) {
  const L = markSize(look)
  const t = String(text || '')
  if (!t) return L.dot
  let em = 0
  for (const ch of t) em += ch === ' ' ? 0.3 : /[0-9]/.test(ch) ? 0.6 : /[MW]/.test(ch) ? 0.86 : /[I1]/.test(ch) ? 0.32 : 0.68
  return Math.ceil(em * L.font + t.length * L.track * L.font + L.padX * 2 + (glyph ? L.glyph + L.glyphGap : 0))
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i

/** '#dcbb5e' -> [220, 187, 94, 1]; 'rgba(255, 255, 255, 0.55)' -> [255, 255, 255, 0.55]; anything else -> null. */
export function parseColor(color) {
  const c = String(color || '').trim()
  const h = HEX.exec(c)
  if (h) {
    const s = h[1].length === 3 ? h[1].split('').map((x) => x + x).join('') : h[1]
    return [...[0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)), 1]
  }
  const m = RGB.exec(c)
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)))
  const a = m[4] == null ? 1 : Math.max(0, Math.min(1, Number(m[4])))
  return [r, g, b, Number.isFinite(a) ? a : 1]
}

/** The colours one mark wears, from its own hue: a tinted fill over the chart's black, a hairline edge, a soft glow, and
 *  ink lifted halfway to white so the word reads on the tint. A muted hue (an alpha) stays muted throughout. A colour the
 *  parser cannot read falls back to UCT gold. */
export function markColors(color) {
  const [r, g, b, al] = parseColor(color) || [220, 187, 94, 1]
  const k2 = (k) => Math.round(k * al * 1000) / 1000
  const a = (k) => `rgba(${r}, ${g}, ${b}, ${k2(k)})`
  const lift = (c) => Math.round(c + (255 - c) * 0.52)
  return {
    tone: al < 1 ? a(1) : `rgb(${r}, ${g}, ${b})`,
    fillTop: a(0.26), fillBottom: a(0.1), edge: a(0.66), glow: a(0.42), soft: a(0.18),
    ink: al < 1 ? `rgba(${lift(r)}, ${lift(g)}, ${lift(b)}, ${k2(1)})` : `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`,
  }
}

/** The signs a mark may carry ahead of its word (ChartMarkOverlay draws them). */
export const MARK_GLYPHS = Object.freeze(['diamond', 'up', 'down', 'check', 'cross'])

/** The markers (the library's shape, plus an optional `glyph` and `kind`) as the overlay's items: a stable key, the side,
 *  the upper-cased word, the sign, the colours. A marker with no time is dropped; repeats get keys of their own. */
export function markItems(markers) {
  const seen = new Map()
  const out = []
  for (const m of markers || []) {
    if (!m || m.time == null) continue
    const text = String(m.text || '').trim().toUpperCase()
    const base = `${m.id ?? ''}|${m.time}|${text}`
    const n = seen.get(base) || 0
    seen.set(base, n + 1)
    out.push({
      key: n ? `${base}#${n}` : base, time: m.time, text, dot: !text,
      side: m.position === 'aboveBar' ? 'above' : 'below',
      glyph: text && MARK_GLYPHS.includes(m.glyph) ? m.glyph : null,
      colors: markColors(m.color),
      kind: m.kind || null,
    })
  }
  return out
}

const overlaps = (a, b, padX, padY) =>
  a.pillX < b.pillX + b.w + padX && b.pillX < a.pillX + a.w + padX && a.pillY < b.pillY + b.h + padY && b.pillY < a.pillY + a.h + padY

/**
 * Where each mark's pieces sit, in the overlay's pixels.
 *   items: [{ key, x, top, bottom, side: 'above'|'below', w, h, dot }] in time order: `x` the bar's centre, `top` / `bottom`
 *          the pixel y of its high and low (null x = the bar is not on the chart: hidden)
 *   frame: { left, right, top, bottom } the price pane's plot box
 *   span:  (x0, x1) => { top, bottom } | null, the highest high and lowest low (pixel y) of the candles between x0 and x1
 * Returns one entry per item: { key, hidden } or { key, side, x, tipY, caret: bool, pillX, pillY, w, h, stem: [y0, y1] | null,
 * flipped, clamped }.
 */
export function layoutMarks(items, frame, look, span = null) {
  const L = markSize(look)
  const placed = []
  const out = []
  for (const it of items || []) {
    if (!it || !Number.isFinite(it.x) || !Number.isFinite(it.top) || !Number.isFinite(it.bottom) || it.x < frame.left - 2 || it.x > frame.right + 2) {
      out.push({ key: it?.key, hidden: true })
      continue
    }
    const want = it.side === 'above' ? 'above' : 'below'
    let p = placeOne(it, want, frame, L, span, placed)
    // rule 4: the clamp put the label over its own bar; the other side, when it fits there
    if (p.clamped && coversOwnBar(p, it)) {
      const other = placeOne(it, want === 'below' ? 'above' : 'below', frame, L, span, placed)
      if (!other.clamped || !coversOwnBar(other, it)) p = { ...other, flipped: true }
    }
    placed.push(p)
    out.push(p)
  }
  return out
}

function coversOwnBar(p, it) {
  return p.pillY < it.bottom && p.pillY + p.h > it.top && p.pillX < it.x && p.pillX + p.w > it.x
}

/** How far a label leaning to one side still covers its own bar: the pointer meets the pill inside its rounded end. */
const leanInset = (L, h) => Math.round(h / 2 + L.caretW / 2 + 2)
// leaning off-centre costs this many px of stem: a centred label wins unless leaning brings it clearly closer
const LEAN_COST = 10

function placeOne(it, side, frame, L, span, placed) {
  const below = side === 'below'
  const dot = !!it.dot
  const w = dot ? L.dot : it.w
  const h = dot ? L.dot : it.h
  const lo = frame.left + L.edge
  const hi = frame.right - L.edge - w
  const tipY = below ? it.bottom + L.gap : it.top - L.gap
  const reach = dot ? 0 : L.caretH + L.stemMin
  const near = below ? tipY + reach : tipY - reach - h
  // rule 2: past every candle under the label's width, centred on the bar or leaning off it (on a trend the candles on
  // one side sit much closer than the other's), taking the closest
  const inset = leanInset(L, h)
  const offsets = dot ? [w / 2] : [w / 2, inset, w - inset]
  let pillX = null, pillY = null, cost = Infinity
  for (let k = 0; k < offsets.length; k++) {
    const x = Math.round(Math.max(lo, Math.min(hi, it.x - offsets[k])))
    if (pillX != null && x === pillX) continue
    let y = near
    const s = dot ? null : span?.(x - 2, x + w + 2)
    if (s && below && Number.isFinite(s.bottom)) y = Math.max(y, s.bottom + L.clear)
    if (s && !below && Number.isFinite(s.top)) y = Math.min(y, s.top - L.clear - h)
    const c = Math.abs(y - near) + (k ? LEAN_COST : 0)
    if (c < cost) { cost = c; pillX = x; pillY = y }
  }
  // rule 3: stack past a label already on this side
  const me = { pillX, pillY, w, h }
  for (let guard = 0; guard < 16; guard++) {
    const hit = placed.find((q) => q.side === side && overlaps(me, q, 4, 2))
    if (!hit) break
    me.pillY = below ? hit.pillY + hit.h + L.stack : hit.pillY - L.stack - h
  }
  pillY = me.pillY
  // rule 4: inside the price pane
  let clamped = false
  if (pillY + h > frame.bottom - L.edge) { pillY = frame.bottom - L.edge - h; clamped = true }
  if (pillY < frame.top + L.edge) { pillY = frame.top + L.edge; clamped = true }
  pillY = Math.round(pillY)
  const from = below ? tipY + L.caretH : tipY - L.caretH
  const to = below ? pillY : pillY + h
  const stem = !dot && (below ? to - from : from - to) >= 1 ? (below ? [from, to] : [to, from]) : null
  return { key: it.key, side, x: it.x, tipY, caret: !dot, pillX, pillY, w, h, stem, flipped: false, clamped }
}
