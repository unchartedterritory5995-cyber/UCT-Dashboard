import { useId } from 'react'
import styles from './UTMark.module.css'

/* ── The Uncharted Territory mark ───────────────────────────────────────────
   A compass rose whose needle is a candlestick: four cardinal points, a broken
   bearing ring in bull/bear quadrants, and a split candle at the centre.

   This is a VECTOR trace of the real logo, not a redraw. Every coordinate below
   was measured off `components/intro/assets/compass-mark.png` (the same artwork
   as public/UCT_logo_512_Discord.png and the whop.com lockup) and scaled into a
   100×100 box centred on 50,50:

     ring     mid radius 27.5, stroke 11  → inner 22, outer 33
     arcs     four spans with ~9° gaps where the cardinal points pass through.
              The gaps sit ~10° off the cardinals in the original art — that
              slight rotation is what gives the mark its wound-spring feel, so
              it is preserved rather than "corrected" to a tidy 90°.
     points   tip at r 48.25, base at r 22 (the ring's inner edge)
     candle   body x 42.9–57.1, y 33.5–67.7; wick y 30–71
     colours  #67DB44 / #E23E23, sampled from the source PNG

   Why vector and not the PNG: the PNG is 60 KB and goes soft above ~200 px,
   and this mark now has to render at 22 px in a header AND as a half-screen
   watermark. It also lets the bearing ring turn on its own (see `spin`) and
   lets the whole thing restate itself in gold for premium surfaces. */

// Bull/bear, straight off the artwork.
const GREEN = '#67DB44'
const RED = '#E23E23'

/* Gold restatement for premium surfaces (per the brand rule: red/green is
   primary, gold-embossed is for premium contexts). The two roles stay distinct
   so the candle keeps its diagonal split instead of flattening to a blob. */
const GOLD_HI = '#d6ba69'
const GOLD_LO = '#9a7a2c'

// Ring arcs, measured span by span. Order: SE, SW, NW, NE.
const ARCS = [
  { d: 'M 77.43 48.08 A 27.5 27.5 0 0 1 57.12 76.56', role: 'bear' },
  { d: 'M 52.4 77.4 A 27.5 27.5 0 0 1 23.57 57.58', role: 'bull' },
  { d: 'M 22.7 53.35 A 27.5 27.5 0 0 1 42.88 23.44', role: 'bear' },
  { d: 'M 48.08 22.57 A 27.5 27.5 0 0 1 76.68 43.35', role: 'bull' },
]

// One cardinal point, pointing north; the other three are this, rotated.
// Quadratic sides give the slight concave sweep the original has.
const POINT = 'M 50 1.75 Q 51.8 22 53.6 28 L 46.4 28 Q 48.2 22 50 1.75 Z'

const POINTS = [
  { rot: 0, role: 'bull' },    // N
  { rot: 90, role: 'bear' },   // E
  { rot: 180, role: 'bull' },  // S
  { rot: 270, role: 'bear' },  // W
]

/**
 * @param {number}  size   rendered px (square)
 * @param {'brand'|'gold'} tone  real logo colours, or the gold restatement
 * @param {boolean} spin   turn the bearing ring only — the needle holds north
 * @param {string}  title  set for a standalone logo; omit to mark decorative
 */
export default function UTMark({
  size = 24,
  tone = 'brand',
  spin = false,
  title,
  className = '',
}) {
  // Scoped so several marks on one page can't collide over a gradient id.
  const uid = useId().replace(/:/g, '')
  const gold = tone === 'gold'

  const bull = gold ? `url(#${uid}-hi)` : GREEN
  const bear = gold ? `url(#${uid}-lo)` : RED

  return (
    <svg
      className={`${styles.mark} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      {...(title
        ? { role: 'img', 'aria-label': title }
        : { 'aria-hidden': 'true', focusable: 'false' })}
    >
      {title && <title>{title}</title>}

      {gold && (
        <defs>
          {/* Raking light across the mark, so gold reads as struck metal
              rather than as a flat tint. */}
          <linearGradient id={`${uid}-hi`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e8d08a" />
            <stop offset="100%" stopColor={GOLD_HI} />
          </linearGradient>
          <linearGradient id={`${uid}-lo`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={GOLD_HI} />
            <stop offset="100%" stopColor={GOLD_LO} />
          </linearGradient>
        </defs>
      )}

      {/* Bearing ring. Its own group so it can turn independently. */}
      <g className={spin ? styles.ring : undefined}>
        {ARCS.map(({ d, role }) => (
          <path
            key={d}
            d={d}
            stroke={role === 'bull' ? bull : bear}
            strokeWidth="11"
          />
        ))}
      </g>

      {/* Cardinal points — these hold still even while the ring turns.
          A compass needle that spun with its bezel would be a broken compass. */}
      <g>
        {POINTS.map(({ rot, role }) => (
          <path
            key={rot}
            d={POINT}
            fill={role === 'bull' ? bull : bear}
            transform={rot ? `rotate(${rot} 50 50)` : undefined}
          />
        ))}
      </g>

      {/* The candle at the centre: wick, then a body split corner to corner —
          bull above the diagonal, bear below it. */}
      <g>
        <rect x="48.75" y="30" width="2.5" height="20.6" fill={bull} />
        <rect x="48.75" y="50.6" width="2.5" height="20.4" fill={bear} />
        <path d="M 42.9 33.5 L 57.1 33.5 L 42.9 67.7 Z" fill={bull} />
        <path d="M 57.1 33.5 L 57.1 67.7 L 42.9 67.7 Z" fill={bear} />
      </g>
    </svg>
  )
}
