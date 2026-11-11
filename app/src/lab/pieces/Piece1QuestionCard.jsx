import { useMemo, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import s from '../lab.module.css'

const GOLD = '#d9b84a'

/** Piece 1 v2: one question on the firm's chart. The candle in question is pointed at (arrow) and painted (gold);
 *  "Point at it" toggles the pointer so the member can look at the bare chart too. */
export default function Piece1QuestionCard() {
  const d = useSample()
  const [pick, setPick] = useState(null)
  const [point, setPoint] = useState(true)
  const [redDay, setRedDay] = useState(false)
  const [checked, setChecked] = useState(false)
  const bars = d?.visible
  const lastT = bars?.length ? bars[bars.length - 1].t : null
  const priorT = bars?.length > 1 ? bars[bars.length - 2].t : null
  const markers = useMemo(() => {
    const m = []
    if (point && lastT) m.push({ time: lastT, position: 'aboveBar', color: GOLD, shape: 'arrowDown', text: 'this candle', id: 'lab-q' })
    if (redDay && priorT) m.push({ time: priorT, position: 'belowBar', color: '#ff6b6b', shape: 'circle', text: 'the red day', id: 'lab-prior' })
    return m.length ? m : null
  }, [point, redDay, lastT, priorT])
  const highlight = point && lastT ? [lastT] : null
  return (
    <div className={s.col}>
      <div className={s.top}>
        <span>Question 3 of 10</span>
        <span className={s.strip}>{[1, 1, 0, 0, 0, 0, 0, 0, 0, 0].map((x, i) => <i key={i} className={i < 2 ? s.ok : i === 2 ? s.cur : ''} />)}</span>
        <span>Setup · Kicker</span>
      </div>
      <h1 className={s.h1}>A red day, then this. Is the gold candle a Kicker?</h1>
      <p className={s.sub}>Daily chart, 120 bars. The ticker stays hidden until you answer.</p>
      <div className={s.chartBox}>
        <span className={s.tag}>Daily · {bars ? bars.length : ''} bars</span>
        <StudyChart bars={bars} markers={markers} highlightBarTime={highlight} highlightColor={GOLD} height={360} />
      </div>
      <div className={s.pills}>
        <button type="button" className={`${s.pill} ${point ? s.on : ''}`} onClick={() => setPoint((v) => !v)}>{point ? 'Pointer on' : 'Point at it'}</button>
        <button type="button" className={`${s.pill} ${redDay ? s.on : ''}`} onClick={() => setRedDay((v) => !v)}>{redDay ? 'Red day marked' : 'Mark the red day too'}</button>
      </div>
      <div className={s.choices}>
        {['Yes, that is a Kicker', 'No, it is just a green day', 'No, the red day before it is not weak enough'].map((c, i) => (
          <button key={c} type="button" className={`${s.choice} ${pick === i ? s.on : ''}`} onClick={() => !checked && setPick(i)}>
            <span className={s.n}>{i + 1}</span>{c}
          </button>
        ))}
      </div>
      <div className={s.foot}>
        <button type="button" className={s.cta} disabled={pick == null} onClick={() => setChecked(true)}>
          {checked ? 'Checked (the answer card is piece 2)' : 'Check'}
        </button>
      </div>
      {priorT ? null : null}
    </div>
  )
}
