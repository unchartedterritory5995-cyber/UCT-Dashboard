// Small drawn pieces of chrome the challenge modes share: confetti, the verdict stamp, the beating heart and its
// crack, the boss bar, the medallion, the chest. All CSS and SVG, no image files, no emoji.
import d5 from './duo.module.css'
import s from './lab.module.css'

export function Confetti({ n = 90 }) {
  const bits = Array.from({ length: n }, (_, i) => ({ l: (i * 37) % 100, d: (i % 7) * 0.12, c: ['#dcbb5e', '#2faf68', '#ffffff', '#e9cd77'][i % 4], r: 1.4 + (i % 5) * 0.25 }))
  return <div className={s.confetti}>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${b.r}s` }} />)}</div>
}

/** The verdict stamp that pops over the chart on Check. */
export function Stamp({ ok }) {
  return (
    <div className={`${d5.stamp} ${ok ? d5.stampOk : d5.stampBad}`}>
      <svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        {ok ? <path d="M4 12.5l5 5L20 7" /> : <path d="M6 6l12 12M18 6L6 18" />}
      </svg>
    </div>
  )
}

/** A heart that BEATS. `bpm` sets the tempo; `cracked` splits it and drops the halves. */
export function Heart({ size = 28, bpm = 60, cracked = false, broken = false, dim = false }) {
  const path = 'M12 21s-7.5-4.6-9.5-9.2C1 8 3.4 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.3C19.5 16.4 12 21 12 21z'
  return (
    <span className={`${d5.heart} ${cracked ? d5.heartCracked : ''} ${broken ? d5.heartBroken : ''} ${dim ? d5.heartDim : ''}`} style={{ width: size, height: size, '--beat': `${60 / Math.max(30, bpm)}s` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size} height={size} className={d5.heartL}><path d={path} fill="currentColor" /></svg>
      <svg viewBox="0 0 24 24" width={size} height={size} className={d5.heartR}><path d={path} fill="currentColor" /></svg>
    </span>
  )
}

/** The boss bar: `total` segments, `gone` of them already knocked out (the newest one flashes). */
export function BossBar({ total = 10, gone = 0 }) {
  return (
    <div className={d5.bossBar} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={total - gone}>
      {Array.from({ length: total }, (_, i) => <i key={i} className={i < gone ? (i === gone - 1 ? `${d5.segGone} ${d5.segJust}` : d5.segGone) : ''} />)}
    </div>
  )
}

/** The unit medallion. `won` lights it and flips it in 3D. */
export function Medal({ size = 120, won = false, label = '2' }) {
  return (
    <div className={`${d5.medal} ${won ? d5.medalWon : ''}`} style={{ width: size, height: size, '--ms': `${size}px` }} aria-hidden="true">
      <div className={d5.medalFace}><div className={d5.medalRing}><svg viewBox="0 0 24 24" width={size * 0.42} height={size * 0.42} fill="currentColor"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17l-6.1 3.5 1.5-6.8L2.2 9l6.9-.7z" /></svg><b>{label}</b></div></div>
    </div>
  )
}

/** The chest. `open` lifts the lid and lights the inside. */
export function Chest({ open = false, size = 120 }) {
  return (
    <div className={`${d5.chest} ${open ? d5.chestOpen : ''}`} style={{ width: size, height: size * 0.8 }} aria-hidden="true">
      <div className={d5.chestGlow} />
      <div className={d5.chestLid}><i /></div>
      <div className={d5.chestBody}><i /></div>
    </div>
  )
}
