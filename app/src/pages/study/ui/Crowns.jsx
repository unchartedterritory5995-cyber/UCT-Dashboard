// THE CROWNS (round 18; owner, batch 18: the three crowns and the dark fourth "want this changed somehow and improved";
// the fourth crown on the end card Cut). A drawn crown instead of a text glyph: three peaks, a jewelled band, a metal
// gradient with a highlight; the dark fourth is the same crown in charcoal. `lit` turns it gold; `ignite` plays the
// moment it lights (a ray burst, once) — the end card after a perfect run, never a HUD. The fourth carries the test id
// and `data-lit` the Hard mode rails read.
import { useId } from 'react'
import s from './study.module.css'

const BODY = 'M7 31 L4 11 L15.5 20.5 L24 4 L32.5 20.5 L44 11 L41 31 Z'
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth']

export function Crown({ lit = true, size = 40, className = '' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const g = `g${uid}`, b = `b${uid}`
  const stroke = lit ? '#7c6220' : '#3b3c45'
  const jewel = lit ? '#fff7dc' : '#2a2b33'
  return (
    <svg className={`${s.crown} ${lit ? '' : s.dim} ${className}`} width={size} height={Math.round(size * 0.84)} viewBox="0 0 48 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          {lit
            ? <><stop offset="0" stopColor="#fff1c2" /><stop offset=".35" stopColor="#e9cd77" /><stop offset=".7" stopColor="#dcbb5e" /><stop offset="1" stopColor="#a8862a" /></>
            : <><stop offset="0" stopColor="#30313a" /><stop offset="1" stopColor="#1b1c21" /></>}
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="0">
          {lit
            ? <><stop offset="0" stopColor="#b8942e" /><stop offset=".5" stopColor="#f3dc8e" /><stop offset="1" stopColor="#b8942e" /></>
            : <><stop offset="0" stopColor="#262730" /><stop offset="1" stopColor="#1b1c21" /></>}
        </linearGradient>
      </defs>
      <path d={BODY} fill={`url(#${g})`} stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="6" y="30" width="36" height="7" rx="2.5" fill={`url(#${b})`} stroke={stroke} strokeWidth="1.4" />
      <circle cx="24" cy="23" r="2.6" fill={jewel} />
      <circle cx="14.5" cy="26" r="1.9" fill={jewel} />
      <circle cx="33.5" cy="26" r="1.9" fill={jewel} />
      {lit ? <path d="M10 14 L13 24" stroke="#fff7dc" strokeOpacity=".55" strokeWidth="1.2" strokeLinecap="round" /> : null}
    </svg>
  )
}

/** `count - 1` gold crowns and the last one: dark until `lit`. `testId` names the last crown (null for a HUD copy). */
export default function Crowns({ lit = false, size = 44, count = 4, ignite = false, testId = 'fourth-crown' }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30)
  const last = ORD[count] || `${count}th`
  return (
    <div className={s.crowns} style={{ gap: Math.max(6, Math.round(size * 0.22)) }} aria-label={lit ? `${count} crowns, the ${last} lit` : `${count - 1} crowns and a dark ${last}`}>
      {Array.from({ length: Math.max(0, count - 1) }, (_, i) => <Crown key={i} size={size} />)}
      <span className={`${s.crownWrap} ${lit && ignite ? s.lit : ''}`} data-testid={testId || undefined} data-lit={lit ? '1' : '0'}>
        {lit && ignite ? <span className={s.burst} aria-hidden="true">{rays.map((a) => <i key={a} style={{ '--a': `${a}deg` }} />)}</span> : null}
        <Crown size={size} lit={lit} />
      </span>
    </div>
  )
}
