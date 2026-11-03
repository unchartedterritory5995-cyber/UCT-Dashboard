// THE LOGO IN REAL 3D (owner, batch 10: "the sideways image in its rotation is really shitty looking"). The
// compass mark is authored as geometry (four ring arcs, two green spikes, two red points, the split candle and its
// wicks) and EXTRUDED: every edge becomes a lit side face, so the mark is a solid object from any angle, not a
// stack of picture copies. Drawn on a canvas each frame: back faces, the side faces sorted far to near and shaded
// by a fixed light, then the front faces with a soft sheen. It turns slowly on its vertical axis; the wrapper still
// throbs and bounces on separate rhythms. `mood` sets the tempo, the tilt and the glow only. No face, ever.
import { useEffect, useRef } from 'react'
import d5 from './duo.module.css'

const GREEN = [47, 175, 104], RED = [223, 70, 70]
const DEPTH = 7
const SPEED = { idle: 9, think: 15, happy: 5, oops: 20, fire: 2.6 }   // seconds per turn

function arc(cx, cy, r, a0, a1, n = 18) { const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) } return pts }
function ring(a0, a1) { const o = arc(0, 0, 37, a0, a1), i = arc(0, 0, 27, a1, a0); return [...o, ...i] }
const D = Math.PI / 180
// the mark, in a -50..50 box, y down: top-left arc red, top-right green, bottom-left green, bottom-right red
const SHAPES = [
  { pts: ring(-173 * D, -97 * D), color: RED },
  { pts: ring(-83 * D, -7 * D), color: GREEN },
  { pts: ring(97 * D, 173 * D), color: GREEN },
  { pts: ring(7 * D, 83 * D), color: RED },
  { pts: [[-4.5, -19], [4.5, -19], [1.5, -50]], color: GREEN },       // top spike
  { pts: [[-4.5, 19], [4.5, 19], [-1.5, 50]], color: GREEN },        // bottom spike
  { pts: [[-19, -4.5], [-19, 4.5], [-50, 1]], color: RED },          // left point
  { pts: [[19, -4.5], [19, 4.5], [50, -1]], color: RED },            // right point
  { pts: [[-8, -17], [8, -17], [-8, 17]], color: GREEN },            // candle, upper-left half
  { pts: [[8, -17], [8, 17], [-8, 17]], color: RED },                // candle, lower-right half
  { pts: [[-1.6, -25], [1.6, -25], [1.6, -17], [-1.6, -17]], color: GREEN },   // top wick
  { pts: [[-1.6, 17], [1.6, 17], [1.6, 25], [-1.6, 25]], color: GREEN },       // bottom wick
]
const LIGHT = (() => { const v = [-0.45, -0.55, 1]; const l = Math.hypot(...v); return v.map((x) => x / l) })()
const rgb = ([r, g, b], k = 1, a = 1) => `rgba(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0},${a})`

function draw(ctx, W, H, theta, tilt) {
  ctx.clearRect(0, 0, W, H)
  const s = (Math.min(W, H) / 100) * 0.86, f = 260
  const ct = Math.cos(theta), st = Math.sin(theta), cp = Math.cos(tilt), sp = Math.sin(tilt)
  const proj = ([x, y], z) => {
    const x1 = x * ct + z * st, z1 = -x * st + z * ct
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp
    const k = f / (f - z2)
    return [W / 2 + x1 * s * k, H / 2 + y2 * s * k, z2]
  }
  const faces = []
  SHAPES.forEach(({ pts, color }) => {
    const n = pts.length
    const front = pts.map((p) => proj(p, DEPTH / 2)), back = pts.map((p) => proj(p, -DEPTH / 2))
    // winding (screen space) decides which of the two caps faces the viewer
    const area = (P) => P.reduce((a, p, i) => { const q = P[(i + 1) % P.length]; return a + (p[0] * q[1] - q[0] * p[1]) }, 0)
    const frontVisible = area(front) < 0 === area(pts.map((p) => [p[0], p[1]])) < 0 ? ct >= 0 : ct < 0
    const zc = (P) => P.reduce((a, p) => a + p[2], 0) / P.length
    faces.push({ z: zc(frontVisible ? front : back) - 50, poly: frontVisible ? front : back, fill: rgb(color, frontVisible ? 1 : 0.55), cap: frontVisible })
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n]
      const ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey) || 1
      let nx = ey / len, ny = -ex / len
      if (area(pts) > 0) { nx = -nx; ny = -ny }
      const nr = [nx * ct, ny * cp - (-nx * st) * sp, ny * sp + (-nx * st) * cp]   // the edge normal, rotated like the points
      const lam = nr[0] * LIGHT[0] + nr[1] * LIGHT[1] + nr[2] * LIGHT[2]
      if (nr[2] <= 0.02) continue   // facing away
      const poly = [front[i], front[(i + 1) % n], back[(i + 1) % n], back[i]]
      faces.push({ z: zc(poly), poly, fill: rgb(color, 0.3 + 0.55 * Math.max(0, lam)), cap: false })
    }
  })
  faces.sort((a, b) => a.z - b.z)
  faces.forEach(({ poly, fill, cap }) => {
    ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath()
    ctx.fillStyle = fill; ctx.fill()
    if (cap) {
      const g = ctx.createLinearGradient(W * (0.2 + 0.3 * Math.sin(theta)), 0, W * (0.8 + 0.3 * Math.sin(theta)), H)
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g; ctx.fill()
    }
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = Math.max(0.6, W / 420); ctx.stroke()
  })
}

export default function Logo({ mood = 'idle', size = 72, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return undefined
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = size * dpr; cv.height = size * dpr
    const ctx = cv.getContext('2d')
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const per = (SPEED[mood] || 9) * 1000
    const tilt = mood === 'think' ? 0.2 : 0.08
    let raf = 0, t0 = performance.now()
    const frame = (now) => {
      const theta = reduced ? 0.45 : ((now - t0) / per) * Math.PI * 2 + 0.45
      draw(ctx, cv.width, cv.height, theta, tilt)
      if (!reduced) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [mood, size])
  const glow = mood === 'fire' ? d5.coinFire : mood === 'happy' ? d5.coinHappy : mood === 'oops' ? d5.coinOops : mood === 'think' ? d5.coinThink : ''
  return (
    <div key={mood} className={`${d5.coinWrap} ${glow} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <div className={d5.coinBob}><canvas ref={ref} style={{ width: size, height: size, display: 'block' }} /></div>
      {mood === 'fire' ? <><i className={d5.spark} style={{ '--d': '0s', '--x': '18%' }} /><i className={d5.spark} style={{ '--d': '.5s', '--x': '70%' }} /><i className={d5.spark} style={{ '--d': '.9s', '--x': '44%' }} /></> : null}
    </div>
  )
}
