// THE LEGENDARY MEDAL and THE SCORE RING (round 21; the owner ranked the round-20 laurel medal Weak on the start stage
// and Cut on the end stage, after cutting the crowns twice). The medal is now a struck coin: a milled edge, a raised
// rim, a star in the field and two ribbon tails in Hard mode's red. Waiting, it is dark steel with a gold rim and a lock
// on its edge; earned, it is gold with a shine that sweeps across it once, and `ignite` bursts rays behind it (the end
// stage only). The SCORE RING is the end of an imperfect run: the charts named out of the total as a gold arc with the
// count in its centre, so the end stage leads with what the member did instead of a medal they did not win.
// The medal keeps the test id and `data-lit` the rails read.
import { useId } from 'react'
import s from './study.module.css'

const TEETH = 36

export function Medal({ lit = false, size = 72, ignite = false, testId = 'legend-medal' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const face = `mf${uid}`
  const rim = `mr${uid}`
  const ribbon = `mb${uid}`
  const shine = `ms${uid}`
  const rays = Array.from({ length: 12 }, (_, i) => i * 30)
  const teeth = Array.from({ length: TEETH }, (_, i) => (i * 360) / TEETH)
  return (
    <span className={`${s.medalWrap} ${lit && ignite ? s.lit : ''}`} data-testid={testId || undefined} data-lit={lit ? '1' : '0'} aria-label={lit ? 'Legendary: a perfect run' : 'Legendary waits for a perfect run'}>
      {lit && ignite ? <span className={s.burst} aria-hidden="true">{rays.map((a) => <i key={a} style={{ '--a': `${a}deg` }} />)}</span> : null}
      <svg className={`${s.medal} ${lit ? s.medalLit : s.medalDark}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={face} cx="38%" cy="30%" r="75%">
            {lit
              ? <><stop offset="0" stopColor="#fff4cc" /><stop offset=".4" stopColor="#ecd07a" /><stop offset=".78" stopColor="#c49a3a" /><stop offset="1" stopColor="#7e621f" /></>
              : <><stop offset="0" stopColor="#3a3c44" /><stop offset=".55" stopColor="#24252b" /><stop offset="1" stopColor="#141519" /></>}
          </radialGradient>
          <linearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
            {lit
              ? <><stop offset="0" stopColor="#fff1c2" /><stop offset=".5" stopColor="#b8902f" /><stop offset="1" stopColor="#5e4813" /></>
              : <><stop offset="0" stopColor="#c9a548" stopOpacity=".85" /><stop offset=".5" stopColor="#6d5822" stopOpacity=".8" /><stop offset="1" stopColor="#2a2410" /></>}
          </linearGradient>
          <linearGradient id={ribbon} x1="0" y1="0" x2="0" y2="1">
            {lit
              ? <><stop offset="0" stopColor="#c23a3a" /><stop offset="1" stopColor="#6e1518" /></>
              : <><stop offset="0" stopColor="#3a1d20" /><stop offset="1" stopColor="#1c0e10" /></>}
          </linearGradient>
          <linearGradient id={shine} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${shine}c`}><circle cx="50" cy="42" r="30" /></clipPath>
        </defs>
        {/* the ribbon tails */}
        <path d="M37 60 L28 95 L37 89 L43 97 L50 64 Z" fill={`url(#${ribbon})`} stroke={lit ? '#e9cd77' : '#4a3d1c'} strokeWidth=".8" />
        <path d="M63 60 L72 95 L63 89 L57 97 L50 64 Z" fill={`url(#${ribbon})`} stroke={lit ? '#e9cd77' : '#4a3d1c'} strokeWidth=".8" />
        {/* the milled edge, the rim, the field */}
        <g transform="translate(50 42)">
          {teeth.map((a) => <rect key={a} x="-1.6" y="-36.5" width="3.2" height="4.5" rx="1" fill={`url(#${rim})`} transform={`rotate(${a})`} />)}
        </g>
        <circle cx="50" cy="42" r="33" fill={`url(#${rim})`} />
        <circle cx="50" cy="42" r="29.5" fill={`url(#${face})`} stroke={lit ? '#7c6220' : '#0b0b0d'} strokeWidth="1" />
        <circle cx="50" cy="42" r="25" fill="none" stroke={lit ? '#fff6d8' : '#c9a548'} strokeOpacity={lit ? '.5' : '.28'} strokeWidth=".9" strokeDasharray="1.6 2.2" />
        <path d="M50 26.5l4.7 9.6 10.6 1.5-7.7 7.5 1.8 10.5L50 50.6l-9.4 5 1.8-10.5-7.7-7.5 10.6-1.5z"
          fill={lit ? '#fff8de' : '#2e3037'} stroke={lit ? '#9b7a24' : '#c9a548'} strokeOpacity={lit ? '1' : '.45'} strokeWidth="1" strokeLinejoin="round" />
        {/* a highlight on the upper left of the field */}
        <path d="M30 34 A22 22 0 0 1 46 21" fill="none" stroke="#fff" strokeOpacity={lit ? '.55' : '.12'} strokeWidth="2.2" strokeLinecap="round" />
        {lit ? <rect className={s.medalShine} x="-30" y="10" width="26" height="64" fill={`url(#${shine})`} clipPath={`url(#${shine}c)`} transform="skewX(-18)" /> : null}
        {!lit ? (
          <g transform="translate(73 62)">
            <circle r="9.5" fill="#101114" stroke="#c9a548" strokeOpacity=".75" strokeWidth="1.2" />
            <rect x="-4.2" y="-1.2" width="8.4" height="6.4" rx="1.4" fill="#c9a548" />
            <path d="M-2.6 -1.2v-2.2a2.6 2.6 0 0 1 5.2 0v2.2" fill="none" stroke="#c9a548" strokeWidth="1.5" />
          </g>
        ) : null}
      </svg>
    </span>
  )
}

/** The run so far, small (the status line's old ring; kept for any caller): `value` of `total` as a thin gold arc. */
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

/** THE SCORE RING: the end of an imperfect run. A gold arc for the charts named, drawn on once; the count in the centre. */
export function ScoreRing({ value = 0, total = 8, size = 148, testId = 'hard-score' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const stroke = 11
  const r = (size - stroke) / 2 - 2
  const c = 2 * Math.PI * r
  const done = total ? Math.min(1, value / total) : 0
  return (
    <span className={s.scoreRing} style={{ width: size, height: size, '--arc': `${c}`, '--fill': `${c * (1 - done)}` }} data-testid={testId || undefined} aria-label={`${value} of ${total} named`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`sr${uid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff1c2" /><stop offset=".45" stopColor="#e9cd77" /><stop offset="1" stopColor="#b8902f" /></linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="rgba(255,255,255,.02)" stroke="#1f2025" strokeWidth={stroke} />
        <circle className={s.scoreArc} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#sr${uid})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className={s.scoreNum}><b>{value}</b><i>of {total}</i></span>
    </span>
  )
}
