import { useMemo, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { arrowAt } from '../pointers'
import s from '../lab.module.css'

/** Round 2, piece 1: the question card on YOUR chart settings (hollow candles, your colours, your averages), the
 *  candle in question pointed at by an arrow spaced to its left; the candle itself is never recoloured. */
export default function Piece6QuestionV3() {
  const d = useSample()
  const [pick, setPick] = useState(null)
  const [point, setPoint] = useState(true)
  const [redDay, setRedDay] = useState(false)
  const bars = d?.visible
  const n = bars?.length || 0
  const annotations = useMemo(() => {
    if (!n) return null
    const a = []
    if (point) a.push(...arrowAt(bars, n - 1, { label: 'this candle', id: 'q' }))
    if (redDay) a.push(...arrowAt(bars, n - 2, { label: 'the red day before it', color: '#ff6b6b', gap: 7, id: 'r' }))
    return a.length ? a : null
  }, [bars, n, point, redDay])
  return (
    <div className={s.col}>
      <div className={s.top}>
        <span>Question 3 of 10</span>
        <span className={s.bar}><i style={{ width: '30%' }} /></span>
        <span>Setup · Kicker</span>
      </div>
      <h1 className={s.h1}>A real red day, then this. Is the candle the arrow points at a Kicker?</h1>
      <p className={s.sub}>Daily chart, your settings. The ticker stays hidden until you answer.</p>
      <div className={s.chartBox}>
        <StudyChart bars={bars} annotations={annotations} height={380} rightPadBars={4} />
      </div>
      <div className={s.pills}>
        <button type="button" className={`${s.pill} ${point ? s.on : ''}`} onClick={() => setPoint((v) => !v)}>{point ? 'Arrow on' : 'Arrow off'}</button>
        <button type="button" className={`${s.pill} ${redDay ? s.on : ''}`} onClick={() => setRedDay((v) => !v)}>{redDay ? 'Red day marked' : 'Mark the red day too'}</button>
      </div>
      <div className={s.choices}>
        {['Yes, that is a Kicker', 'No, it is just a green day', 'No, the red day before it is not weak enough'].map((c, i) => (
          <button key={c} type="button" className={`${s.choice} ${pick === i ? s.on : ''}`} onClick={() => setPick(i)}>
            <span className={s.n}>{i + 1}</span>{c}
          </button>
        ))}
      </div>
      <div className={s.foot}><button type="button" className={s.cta} disabled={pick == null}>Check</button></div>
    </div>
  )
}
