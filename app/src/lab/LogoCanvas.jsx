// THE CANVAS LOGO, kept as the fallback behind the decided three.js mark (StudyMark3D) and as step 0 of the
// ladder. Was lab/Logo.jsx. (owner, batch 10/11: the sideways view and the render quality). The compass mark is authored
// as geometry (four ring arcs, two spikes, two points, the split candle and its wicks) and EXTRUDED with a BEVEL:
// every edge becomes a lit side face, every front edge a chamfer that catches the light, so the mark is a solid,
// machined object from any angle. Drawn on a canvas each frame: a soft shadow on the floor, the faces sorted far to
// near and shaded by one fixed key light plus a rim light, a metallic sheen that slides as it turns, a faint floor
// reflection. It turns slowly; the wrapper throbs and bounces on separate rhythms. `mood` sets tempo, tilt and glow.
import { useEffect, useRef } from 'react'
import d5 from './duo.module.css'

const GREEN = [52, 190, 112], RED = [232, 76, 70]
const DEPTH = 9, BEVEL = 1.7, BEVEL_RISE = 1.3
const SPEED = { idle: 12, think: 18, happy: 6, oops: 22, fire: 3.2 }   // seconds per turn

function arc(cx, cy, r, a0, a1, n = 96) { const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) } return pts }
function ring(a0, a1) { const o = arc(0, 0, 37, a0, a1), i = arc(0, 0, 27, a1, a0); return [...o, ...i] }
const D = Math.PI / 180
const RAW = [
  { pts: ring(-173 * D, -97 * D), color: RED },
  { pts: ring(-83 * D, -7 * D), color: GREEN },
  { pts: ring(97 * D, 173 * D), color: GREEN },
  { pts: ring(7 * D, 83 * D), color: RED },
  { pts: [[-4.5, -19], [4.5, -19], [1.5, -50]], color: GREEN },
  { pts: [[-4.5, 19], [4.5, 19], [-1.5, 50]], color: GREEN },
  { pts: [[-19, -4.5], [-19, 4.5], [-50, 1]], color: RED },
  { pts: [[19, -4.5], [19, 4.5], [50, -1]], color: RED },
  { pts: [[-8, -17], [8, -17], [-8, 17]], color: GREEN },
  { pts: [[8, -17], [8, 17], [-8, 17]], color: RED },
  { pts: [[-1.6, -25], [1.6, -25], [1.6, -17], [-1.6, -17]], color: GREEN },
  { pts: [[-1.6, 17], [1.6, 17], [1.6, 25], [-1.6, 25]], color: GREEN },
]
const area2 = (P) => P.reduce((a, p, i) => { const q = P[(i + 1) % P.length]; return a + (p[0] * q[1] - q[0] * p[1]) }, 0)
// every polygon counter-clockwise (screen space, y down), so an edge's outward normal is consistent
const SHAPES = RAW.map(({ pts, color }) => ({ pts: area2(pts) > 0 ? [...pts].reverse() : pts, color }))
// the inset polygon for the bevel's inner edge: each vertex moved inward along its mitred normal
function inset(P, b) {
  const n = P.length, out = []
  for (let i = 0; i < n; i++) {
    const p = P[i], a = P[(i - 1 + n) % n], c = P[(i + 1) % n]
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [c[0] - p[0], c[1] - p[1]]
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1
    const n1 = [e1[1] / l1, -e1[0] / l1], n2 = [e2[1] / l2, -e2[0] / l2]    // outward normals of a CCW (y-down) polygon
    let mx = n1[0] + n2[0], my = n1[1] + n2[1]; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml
    const k = Math.max(0.45, mx * n1[0] + my * n1[1])
    out.push([p[0] - (mx * b) / k, p[1] - (my * b) / k])
  }
  return out
}
SHAPES.forEach((s) => { s.inner = inset(s.pts, BEVEL) })
const LIGHT = (() => { const v = [-0.5, -0.6, 1]; const l = Math.hypot(...v); return v.map((x) => x / l) })()
const RIM = (() => { const v = [0.7, 0.3, 0.45]; const l = Math.hypot(...v); return v.map((x) => x / l) })()
const rgb = ([r, g, b], k = 1, a = 1) => `rgba(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0},${a})`

function draw(ctx, W, H, theta, tilt) {
  ctx.clearRect(0, 0, W, H)
  const s = (Math.min(W, H) / 100) * 0.84, f = 260
  const ct = Math.cos(theta), st = Math.sin(theta), cp = Math.cos(tilt), sp = Math.sin(tilt)
  const rot = (x, y, z) => { const x1 = x * ct + z * st, z1 = -x * st + z * ct; return [x1, y * cp - z1 * sp, y * sp + z1 * cp] }
  const proj = ([x, y], z) => { const [x1, y2, z2] = rot(x, y, z); const k = f / (f - z2); return [W / 2 + x1 * s * k, H / 2 + y2 * s * k, z2] }
  const shade = (nx, ny, nz) => { const [a, b, c] = rot(nx, ny, nz); const key = Math.max(0, a * LIGHT[0] + b * LIGHT[1] + c * LIGHT[2]); const rim = Math.max(0, a * RIM[0] + b * RIM[1] + c * RIM[2]); return 0.28 + 0.62 * key + 0.25 * rim * rim }
  const zc = (P) => P.reduce((a, p) => a + p[2], 0) / P.length
  const faces = []
  const frontZ = DEPTH / 2, backZ = -DEPTH / 2, capZ = frontZ + BEVEL_RISE
  SHAPES.forEach(({ pts, inner, color }) => {
    const n = pts.length
    const outerF = pts.map((p) => proj(p, frontZ)), outerB = pts.map((p) => proj(p, backZ)), cap = inner.map((p) => proj(p, capZ))
    const facing = ct >= 0   // which cap faces the viewer
    if (facing) {
      faces.push({ z: zc(cap) - 60, poly: cap, fill: rgb(color, shade(0, 0, 1)), cap: true })
      for (let i = 0; i < n; i++) {   // the bevel ring: a chamfer between the outer front edge and the raised inner cap
        const a = pts[i], b = pts[(i + 1) % n]
        const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1
        const nx = ey / l, ny = -ex / l                      // outward
        const bl = Math.hypot(BEVEL, BEVEL_RISE)
        const nn = [(nx * BEVEL_RISE) / bl, (ny * BEVEL_RISE) / bl, BEVEL / bl]   // chamfer normal, tilted toward the viewer
        const poly = [outerF[i], outerF[(i + 1) % n], cap[(i + 1) % n], cap[i]]
        faces.push({ z: zc(poly) - 30, poly, fill: rgb(color, 0.55 + 0.75 * shade(...nn)), bevel: true })
      }
    } else {
      faces.push({ z: zc(outerB) - 60, poly: outerB, fill: rgb(color, 0.5), cap: true })
    }
    for (let i = 0; i < n; i++) {   // the sides
      const a = pts[i], b = pts[(i + 1) % n]
      const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1
      const nx = ey / l, ny = -ex / l
      const [, , nz] = rot(nx, ny, 0)
      if (nz <= 0.02) continue
      const poly = [outerF[i], outerF[(i + 1) % n], outerB[(i + 1) % n], outerB[i]]
      faces.push({ z: zc(poly), poly, fill: rgb(color, 0.22 + 0.6 * shade(nx, ny, 0)) })
    }
  })
  faces.sort((a, b) => a.z - b.z)
  const paint = (yShift, alpha) => {
    ctx.save(); ctx.globalAlpha = alpha
    if (yShift) { ctx.translate(0, yShift); ctx.scale(1, -0.32) }
    faces.forEach(({ poly, fill, cap, bevel }) => {
      ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath()
      ctx.lineJoin = 'round'; ctx.fillStyle = fill; ctx.fill()
      if (bevel) { ctx.strokeStyle = fill; ctx.lineWidth = 0.9; ctx.stroke() }   // closes the hairline gaps between neighbouring chamfers
      if (cap) {
        const g = ctx.createLinearGradient(W * (0.1 + 0.3 * Math.sin(theta)), 0, W * (0.9 + 0.3 * Math.sin(theta)), H)
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,.28)'); g.addColorStop(0.58, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(0,0,0,.2)')
        ctx.fillStyle = g; ctx.fill()
      }
      if (!bevel && !cap) { ctx.strokeStyle = fill; ctx.lineWidth = 0.6; ctx.lineJoin = 'round'; ctx.stroke() }   // a hairline in the face's own colour closes the seams between faces
    })
    ctx.restore()
  }
  // the floor: a soft shadow, then the reflection, then the mark
  ctx.save(); ctx.filter = `blur(${Math.max(2, W / 60)}px)`; ctx.fillStyle = 'rgba(0,0,0,.55)'
  ctx.beginPath(); ctx.ellipse(W / 2, H * 0.93, W * 0.28, H * 0.035, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  paint(H * 1.74, 0.14)
  paint(0, 1)
}

export default function LogoCanvas({ mood = 'idle', size = 72, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return undefined
    const dpr = Math.min(2, window.devicePixelRatio || 1) * 2   // supersampled: drawn at twice the device resolution, downscaled by the browser for clean edges
    cv.width = size * dpr; cv.height = size * dpr
    const ctx = cv.getContext('2d')
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const per = (SPEED[mood] || 9) * 1000
    const tilt = mood === 'think' ? 0.22 : 0.1
    let raf = 0, t0 = performance.now(), last = 0, visible = true
    const frame = (now) => {
      if (!reduced) raf = requestAnimationFrame(frame)
      if (!visible || now - last < 15) return
      last = now
      const theta = reduced ? 0.45 : ((now - t0) / per) * Math.PI * 2 + 0.45
      draw(ctx, cv.width, cv.height, theta, tilt)
    }
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting) }) : null
    io?.observe(cv)
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); io?.disconnect() }
  }, [mood, size])
  const glow = mood === 'fire' ? d5.coinFire : mood === 'happy' ? d5.coinHappy : mood === 'oops' ? d5.coinOops : mood === 'think' ? d5.coinThink : ''
  return (
    <div key={mood} className={`${d5.coinWrap} ${glow} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <div className={d5.coinBob}><canvas ref={ref} style={{ width: size, height: size, display: 'block' }} /></div>
      {mood === 'fire' ? <><i className={d5.spark} style={{ '--d': '0s', '--x': '18%' }} /><i className={d5.spark} style={{ '--d': '.5s', '--x': '70%' }} /><i className={d5.spark} style={{ '--d': '.9s', '--x': '44%' }} /></> : null}
    </div>
  )
}
