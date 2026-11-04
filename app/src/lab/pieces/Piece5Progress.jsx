import { useState } from 'react'
import s from '../lab.module.css'

/** Piece 5: progress inside a lesson and the finish card. Two states, no chart: the strip while answering, then the end. */
export default function Piece5Progress() {
  const [done, setDone] = useState(false)
  const results = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1]
  const right = results.filter(Boolean).length
  return (
    <div className={s.col}>
      {!done ? (
        <>
          <div className={s.top}>
            <span>Question 7 of 10</span>
            <span className={s.strip}>{results.map((r, i) => <i key={i} className={i < 6 ? (r ? s.ok : s.bad) : i === 6 ? s.cur : ''} />)}</span>
            <span>🔥 4 in a row</span>
          </div>
          <h1 className={s.h1}>The strip at the top is the whole progress story.</h1>
          <p className={s.sub}>Green is right, red is wrong, gold is where you are. The streak counter lives at the right. Nothing else moves while you answer.</p>
          <div className={s.card}>
            <p className={s.hint}>Imagine the question and chart here. This piece is only about the strip and the finish.</p>
          </div>
          <div className={s.foot}><button type="button" className={s.cta} onClick={() => setDone(true)}>Skip to the finish card</button></div>
        </>
      ) : (
        <>
          <div className={s.top}><span>Lesson · Kicker</span><span className={s.strip}>{results.map((r, i) => <i key={i} className={r ? s.ok : s.bad} />)}</span><span>Done</span></div>
          <div className={s.card}>
            <div className={s.ring} style={{ '--p': `${right * 10}%` }}><span>{right}/10</span></div>
            <h1 className={s.h1} style={{ textAlign: 'center' }}>Kicker: you can see it now.</h1>
            <p className={s.sub} style={{ textAlign: 'center' }}>Two misses, both on the red day being too small. That is the one thing to look at next time.</p>
            <div className={s.stats}>
              <div className={s.stat}><div className={s.v}>+80</div><div className={s.k}>XP</div></div>
              <div className={s.stat}><div className={s.v}>🔥 3</div><div className={s.k}>day streak</div></div>
              <div className={s.stat}><div className={s.v}>2 / 3</div><div className={s.k}>Kicker level</div></div>
            </div>
          </div>
          <div className={s.pills}>
            <button type="button" className={s.pill} onClick={() => setDone(false)}>Back to the strip</button>
          </div>
          <div className={s.foot}><button type="button" className={s.cta}>Next lesson: Oops reversal</button></div>
        </>
      )}
    </div>
  )
}
