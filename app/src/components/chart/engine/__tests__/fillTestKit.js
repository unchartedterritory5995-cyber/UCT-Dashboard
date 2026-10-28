// app/src/components/chart/engine/__tests__/fillTestKit.js
//
// Shared fixtures for the fill visible-window rails (`fillVisibleWindow.test.js`
// on a counted double, `fillRealChart.test.js` on the real lightweight-charts),
// so both compare the SAME notion of "what is on the canvas".

/** Canvas width the rails draw against. */
export const W = 800
/** Antialiasing reach: a segment within this many px of the canvas edge can still
 *  tint an edge pixel, so it counts as visible. */
export const AA_PX = 2

/** `YYYY-MM-DD` for day i after 2006-01-02 — the shape D/W/M bars reach the fill in
 *  production (`bars_fetch._fmt_sqlite_bars`; `adjustTime` leaves strings alone). */
export const isoDay = (i) => new Date(Date.UTC(2006, 0, 2) + i * 86_400_000).toISOString().slice(0, 10)

/** A Clouds-shaped band: a wavy upper/lower pair crossing each other, a colour per
 *  bar that flips with the sign, optional NaN holes; `iso` gives daily string times. */
export function band(n, { holes = [], lead = 0, colours = true, phase = 0, iso = false } = {}) {
  const times = Array.from({ length: n }, (_, i) => (iso ? isoDay(i) : 1_000 + i * 7))
  const upper = new Float64Array(n)
  const lower = new Float64Array(n)
  const cols = []
  for (let i = 0; i < n; i += 1) {
    const j = i - phase
    const a = 100 + 20 * Math.sin(j / 9) + 3 * Math.sin(j * 1.7)
    const b = 100 + 15 * Math.cos(j / 13)
    upper[i] = i < lead ? NaN : a
    lower[i] = i < lead ? NaN : b
    cols.push(a >= b ? 'rgba(0, 137, 123, 0.3)' : 'rgba(136, 14, 79, 0.3)')
  }
  for (const h of holes) { upper[h] = NaN }
  return { times, upper, lower, colors: colours ? cols : undefined }
}

/** Every path segment of every polygon the recorder saw, with the colour it was
 *  painted in, keeping only segments whose x-extent reaches [-AA_PX, W + AA_PX] —
 *  the pixels a viewer can see, plus the antialiasing reach of the canvas edge.
 *  Walls the clip introduced off-canvas are dropped on purpose; anything ON canvas
 *  must match exactly. */
export function visibleSegments(rec, w = W) {
  const out = []
  let cur = null
  let pt = null
  let start = null
  const keep = (s) => {
    const xs = [s.x0, s.x1, s.cx ?? s.x0]
    if (Math.max(...xs) >= -AA_PX && Math.min(...xs) <= w + AA_PX) cur.push(s)
  }
  for (const o of rec.ops) {
    if (o.op === 'beginPath') { cur = []; pt = null; continue }
    if (!cur) continue
    if (o.op === 'moveTo') { pt = { x: o.x, y: o.y }; start = pt; continue }
    if (o.op === 'lineTo') { keep({ k: 'L', x0: pt.x, y0: pt.y, x1: o.x, y1: o.y }); pt = { x: o.x, y: o.y } }
    if (o.op === 'quadraticCurveTo') {
      keep({ k: 'Q', x0: pt.x, y0: pt.y, cx: o.cpx, cy: o.cpy, x1: o.x, y1: o.y }); pt = { x: o.x, y: o.y }
    }
    if (o.op === 'closePath') keep({ k: 'L', x0: pt.x, y0: pt.y, x1: start.x, y1: start.y })
    if (o.op === 'fill' && o.compositeOp !== 'destination-out') {
      if (cur.length) out.push({ colour: o.style, segs: cur })
      cur = null
    }
  }
  return out
}
