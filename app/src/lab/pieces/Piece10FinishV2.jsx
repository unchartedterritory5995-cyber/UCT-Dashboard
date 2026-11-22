import { useEffect, useState } from 'react'
import s from '../lab.module.css'

const RESULTS = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1]
const MISSES = [
  { q: 'Q3 · you called a 0.3% red body a Kicker', fix: 'the red day must be real: 1 to 5%' },
  { q: 'Q7 · a Kicker inside a crash, not a base', fix: 'it lives in a clean base or uptrend' },
]

function Confetti() {
  const bits = Array.from({ length: 70 }, (_, i) => ({ l: (i * 37) % 100, d: (i % 7) * 0.12, c: ['#d9b84a', '#1ae51a', '#ffffff', '#ff6b6b'][i % 4], r: 1.4 + (i % 5) * 0.25 }))
  return <div className={s.confetti}>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${b.r}s` }} />)}</div>
}

/** Round 2, piece 5: progress while answering (a filling bar that glows, a combo counter, +XP pops), then a
 *  finish that counts up, rains confetti, names what you learned, and shows the two misses with the one-line fix. */
export default function Piece10FinishV2() {
  const [done, setDone] = useState(false)
  const [count, setCount] = useState(0)
  const [xpShown, setXpShown] = useState(0)
  const right = RESULTS.filter(Boolean).length
  useEffect(() => {
    if (!done) { setCount(0); setXpShown(0); return undefined }
    let i = 0
    const t = setInterval(() => { i += 1; setCount(Math.min(i, right)); setXpShown(Math.min(i * 10, right * 10)); if (i >= right) clearInterval(t) }, 140)
    return () => clearInterval(t)
  }, [done, right])
  if (!done) {
    return (
      <div className={s.col}>
        <div className={s.top}><span>7 of 10</span><span className={s.bar}><i style={{ width: '60%' }} /></span><span className={s.combo}>🔥 4 in a row</span></div>
        <h1 className={s.h1}>While you answer, only three things move.</h1>
        <p className={s.sub}>The bar fills and glows. The combo counter at the right climbs with every right answer in a row. A right answer pops +10 XP off the button. Nothing else competes with the chart.</p>
        <div className={s.card}><p className={s.hint}>The question and chart live here. This piece is about the frame around them and the finish.</p></div>
        <div className={s.foot}><button type="button" className={s.cta} onClick={() => setDone(true)}>Finish the lesson</button></div>
      </div>
    )
  }
  return (
    <div className={s.col}>
      {count >= right && right >= 8 ? <Confetti /> : null}
      <div className={s.top}><span>Lesson · Kicker</span><span className={s.bar}><i style={{ width: '100%' }} /></span><span>Done</span></div>
      <div className={s.card}>
        <div className={s.ring2} style={{ '--p': `${(count / 10) * 100}%` }}><div><b>{count}</b><small>of 10</small></div></div>
        <h1 className={s.h1} style={{ textAlign: 'center' }}>Kicker: you can see it now.</h1>
        <div className={s.stats}>
          <div className={s.stat}><div className={s.v}>+{xpShown}</div><div className={s.k}>XP</div></div>
          <div className={s.stat}><div className={s.v}>🔥 5</div><div className={s.k}>best run</div></div>
          <div className={s.stat}><div className={s.v}>Learn 2 / 3</div><div className={s.k}>Kicker level</div></div>
        </div>
        <div className={s.chips}><span className={s.chip}>✓ the red day is real</span><span className={s.chip}>✓ opens above, closes strong</span><span className={s.chip}>✓ the low is the line</span><span className={s.chip} style={{ opacity: .5 }}>○ base or uptrend</span></div>
        <div>
          <label className={s.l}>Your two misses, and the one thing to fix</label>
          {MISSES.map((m) => <div key={m.q} className={s.miss}><span className={s.q}>{m.q}</span><span className={s.fix}>{m.fix}</span></div>)}
        </div>
      </div>
      <div className={s.pills}><button type="button" className={s.pill} onClick={() => setDone(false)}>Back to the frame</button></div>
      <div className={s.foot}><button type="button" className={s.cta}>Next: Oops reversal</button></div>
    </div>
  )
}
