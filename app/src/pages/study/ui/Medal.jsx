// THE LEGENDARY MEDAL and THE RUN RING (round 19; the owner Cut the crowns twice: the glyph in batch 18 and the drawn
// crowns in batch 19). The reward for a perfect run is one medal: a laurel around a disc with a star, in gold when it is
// earned, in charcoal while it waits; `ignite` plays the moment it lights (the end card only). The ring is the run so
// far: a thin gold arc for the charts named out of the total, which the HUD carries in place of the old crown row.
// The medal carries the test id and `data-lit` the rails read (the fourth crown's old contract).
import { useId } from 'react'
import s from './study.module.css'

const LEAF = 'M0 0c6-6 14-6 18 0-6 4-12 4-18 0z'

export function Medal({ lit = false, size = 72, ignite = false, testId = 'legend-medal' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const g = `m${uid}`
  const gold = lit
  const disc = gold ? `url(#${g})` : '#26272e'
  const stroke = gold ? '#7c6220' : '#3b3c45'
  const leaf = gold ? '#c9a548' : '#2f3036'
  const star = gold ? '#fff7dc' : '#3a3b44'
  const rays = Array.from({ length: 12 }, (_, i) => i * 30)
  return (
    <span className={`${s.medalWrap} ${lit && ignite ? s.lit : ''}`} data-testid={testId || undefined} data-lit={lit ? '1' : '0'} aria-label={lit ? 'Legendary: a perfect run' : 'Legendary waits for a perfect run'}>
      {lit && ignite ? <span className={s.burst} aria-hidden="true">{rays.map((a) => <i key={a} style={{ '--a': `${a}deg` }} />)}</span> : null}
      <svg className={`${s.medal} ${gold ? '' : s.dim}`} width={size} height={size} viewBox="0 0 80 80" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={g} cx="40%" cy="32%" r="70%">
            <stop offset="0" stopColor="#fff1c2" /><stop offset=".45" stopColor="#e9cd77" /><stop offset=".8" stopColor="#c9a548" /><stop offset="1" stopColor="#8a6f22" />
          </radialGradient>
        </defs>
        {/* the laurel: six leaves a side, mirrored */}
        {[0, 1].map((side) => (
          <g key={side} transform={side ? 'translate(80 0) scale(-1 1)' : undefined}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = -100 + i * 28
              return <path key={i} d={LEAF} fill={leaf} stroke={stroke} strokeWidth=".8" transform={`translate(40 42) rotate(${a}) translate(0 -30) rotate(${-70})`} />
            })}
          </g>
        ))}
        <circle cx="40" cy="40" r="19" fill={disc} stroke={stroke} strokeWidth="1.6" />
        <circle cx="40" cy="40" r="15" fill="none" stroke={gold ? '#fff7dc' : '#3a3b44'} strokeOpacity=".55" strokeWidth="1" strokeDasharray="2 2" />
        <path d="M40 29.5l3.1 6.4 7 1-5 4.9 1.2 7-6.3-3.3-6.3 3.3 1.2-7-5-4.9 7-1z" fill={star} />
      </svg>
    </span>
  )
}

/** The run so far: `value` of `total` as a thin gold arc; full and perfect, it turns bright. */
export function Ring({ value = 0, total = 8, size = 30, missed = 0 }) {
  const r = (size - 4) / 2
  const c = 2 * Math.PI * r
  const done = total ? Math.min(1, value / total) : 0
  const perfect = total > 0 && value === total
  return (
    <span className={s.ringWrap} style={{ width: size, height: size }} aria-label={`${value} of ${total} named`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2b30" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={perfect ? '#fff1c2' : '#dcbb5e'} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${c * done} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .5s cubic-bezier(.2,.9,.2,1.08)' }} />
        {missed > 0 ? <circle cx={size / 2} cy={size / 2} r={3} fill="#df4646" /> : null}
      </svg>
      <span className={s.ringNum}>{value}</span>
    </span>
  )
}
