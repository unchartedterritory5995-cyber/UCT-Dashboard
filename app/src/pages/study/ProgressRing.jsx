// Study — the nine-rung progress ring (spec §13.7 D17): nine arc segments
// grouped 3-3-3 (the three levels of a unit), 2px stroke, gold fill for a
// lit rung, no gradient. Sizes 24 (the panel's Up-next row), 40, 56 (a
// trail node). Pure SVG, no animation — the trail's reveal is CSS on the
// node, never a JS timer.
import { RUNGS } from './studyMap'
import s from './ProgressRing.module.css'

const STROKE = 2
const RUNG_GAP = 6      // degrees between rungs inside a level
const LEVEL_GAP = 16    // degrees between levels — the 3-3-3 grouping reads at 24px
const SPAN = (360 - 3 * LEVEL_GAP - 6 * RUNG_GAP) / RUNGS

const rad = (deg) => ((deg - 90) * Math.PI) / 180

function arc(cx, cy, r, a0, a1) {
  const x0 = cx + r * Math.cos(rad(a0))
  const y0 = cy + r * Math.sin(rad(a0))
  const x1 = cx + r * Math.cos(rad(a1))
  const y1 = cy + r * Math.sin(rad(a1))
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** The nine [start, end] angles, grouped 3-3-3. Exported for the test. */
export function rungAngles() {
  const out = []
  let a = 0
  for (let i = 0; i < RUNGS; i += 1) {
    out.push([a, a + SPAN])
    a += SPAN + (i % 3 === 2 ? LEVEL_GAP : RUNG_GAP)
  }
  return out
}

export default function ProgressRing({ size = 24, done = 0, label, className = '', children }) {
  const lit = Math.max(0, Math.min(RUNGS, Math.floor(Number(done) || 0)))
  const c = size / 2
  const r = c - STROKE
  const name = label ?? `${lit} of ${RUNGS} rungs`
  return (
    <span
      className={`${s.ring} ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name}
      data-rungs={lit}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        {rungAngles().map(([a0, a1], i) => (
          <path
            key={i}
            d={arc(c, c, r, a0, a1)}
            className={i < lit ? s.lit : s.unlit}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="butt"
          />
        ))}
      </svg>
      {children != null && <span className={s.center}>{children}</span>}
    </span>
  )
}
