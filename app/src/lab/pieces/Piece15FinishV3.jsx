import { useEffect, useState } from 'react'
import s from '../lab.module.css'

const RESULTS = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1]
const MISSES = [
  { q: 'Q3', fix: 'the red day must be real' },
  { q: 'Q7', fix: 'a Kicker needs a base or an uptrend' },
]

function Confetti() {
  const bits = Array.from({ length: 70 }, (_, i) => ({ l: (i * 37) % 100, d: (i % 7) * 0.12, c: ['#d9b84a', '#1ae51a', '#ffffff', '#ff6b6b'][i % 4], r: 1.4 + (i % 5) * 0.25 }))
  return <div className={s.confetti}>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${b.r}s` }} />)}</div>
}

/** Round 3, piece 5: the frame and the finish, cut down (owner: "much cleaner and more cool and fun instead of
 *  lame and wordy"). The frame is three things: a bar, a combo, +XP. The finish is one card: the ring counts up,
 *  one word for how you did, three numbers, three chips, one button. Misses are a tap away, not a paragraph. */
export default function Piece15FinishV3() {
  const [done, setDone] = useState(false)
  const [count, setCount] = useState(0)
  const [xp, setXp] = useState(0)
  const [showMiss, setShowMiss] = useState(false)
  const right = RESULTS.filter(Boolean).length
  useEffect(() => {
    if (!done) { setCount(0); setXp(0); setShowMiss(false); return undefined }
    let i = 0
    const t = setInterval(() => { i += 1; setCount(Math.min(i, right)); setXp(Math.min(i * 12, right * 12)); if (i >= right) clearInterval(t) }, 120)
    return () => clearInterval(t)
  }, [done, right])
  if (!done) {
    return (
      <div className={s.col}>
        <div className={s.top}><span>7 / 10</span><span className={s.bar}><i style={{ width: '70%' }} /></span><span className={s.combo}>🔥 4</span></div>
        <div className={s.card} style={{ minHeight: 300, display: 'grid', placeItems: 'center' }}><p className={s.hint}>the question and the chart</p></div>
        <div className={s.foot}><button type="button" className={s.cta} onClick={() => setDone(true)}>Finish the lesson</button></div>
      </div>
    )
  }
  return (
    <div className={s.col}>
      {count >= right && right >= 8 ? <Confetti /> : null}
      <div className={s.finish}>
        <div className={s.eyebrow}>Kicker · lesson complete</div>
        <div className={s.ring2} style={{ '--p': `${(count / 10) * 100}%` }}><div><b>{count}</b><small>of 10</small></div></div>
        <div className={s.rank}>{count >= right ? (right === 10 ? 'Flawless' : right >= 8 ? 'Sharp' : right >= 6 ? 'Solid' : 'Keep going') : ''}</div>
        <div className={s.stats}>
          <div className={s.stat}><div className={s.v}>+{xp}</div><div className={s.k}>XP</div></div>
          <div className={s.stat}><div className={s.v}>🔥 5</div><div className={s.k}>best run</div></div>
          <div className={s.stat}><div className={s.v}>🗓 3</div><div className={s.k}>day streak</div></div>
        </div>
        <div className={s.chips}><span className={s.chip}>the red day is real</span><span className={s.chip}>opens above, closes strong</span><span className={s.chip}>the low is the line</span></div>
        <div className={s.strip}>{RESULTS.map((r, k) => <i key={k} className={r ? s.ok : s.bad} />)}</div>
        <button type="button" className={s.link} onClick={() => setShowMiss((v) => !v)}>{showMiss ? 'Hide the two misses' : 'See the two misses'}</button>
        {showMiss ? MISSES.map((m) => <div key={m.q} className={s.miss}><span className={s.q}>{m.q}</span><span className={s.fix}>{m.fix}</span></div>) : null}
      </div>
      <div className={s.pills}><button type="button" className={s.pill} onClick={() => setDone(false)}>Back to the frame</button></div>
      <div className={s.foot}><button type="button" className={s.cta}>Continue</button></div>
    </div>
  )
}
