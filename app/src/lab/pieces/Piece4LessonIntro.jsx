import { useMemo, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import s from '../lab.module.css'

const GOLD = '#d9b84a'

/** Piece 4: teach first, then test. Three screens: SHOW it, SAY what makes it one, then FIND it yourself (tap the candle). */
export default function Piece4LessonIntro() {
  const d = useSample()
  const [step, setStep] = useState(0)
  const [tap, setTap] = useState(null)
  const bars = d?.visible
  const bar = bars?.length ? bars[bars.length - 1] : null
  const prior = bars?.length > 1 ? bars[bars.length - 2] : null
  const markers = useMemo(() => {
    if (!bar) return null
    if (step === 0) return [{ time: bar.t, position: 'aboveBar', color: GOLD, shape: 'arrowDown', text: 'a Kicker', id: 'l-a' }]
    if (step === 1) return [
      { time: prior.t, position: 'belowBar', color: '#ff6b6b', shape: 'circle', text: '1 · red, weak close', id: 'l-1' },
      { time: bar.t, position: 'aboveBar', color: GOLD, shape: 'arrowDown', text: '2 · opens above, never looks back', id: 'l-2' },
    ]
    if (tap) return [{ time: tap.time, position: 'aboveBar', color: tap.ok ? '#1ae51a' : '#ff6b6b', shape: 'arrowDown', text: tap.ok ? 'that is it' : 'not that one', id: 'l-t' }]
    return null
  }, [step, bar, prior, tap])
  const highlight = step === 0 && bar ? [bar.t] : step === 1 && bar ? [bar.t, prior.t] : tap?.ok ? [bar.t] : null
  const onBarTap = step === 2 ? ({ time }) => setTap({ time, ok: String(time) === String(bar.t) }) : null
  const titles = ['This is a Kicker.', 'What makes it one.', 'Now you find it.']
  return (
    <div className={s.col}>
      <div className={s.top}><span>Lesson · Kicker</span><span className={s.steps}>{[0, 1, 2].map((i) => <i key={i} className={i <= step ? s.on : ''} />)}</span><span>Learn</span></div>
      <h1 className={s.h1}>{titles[step]}</h1>
      <div className={s.chartBox}>
        {step === 2 && !tap ? <span className={s.tapHint}>tap the candle</span> : null}
        <StudyChart bars={bars} markers={markers} highlightBarTime={highlight} highlightColor={GOLD} height={360} onBarTap={onBarTap} />
      </div>
      {step === 0 ? (
        <p className={s.teach}>A stock in an uptrend has a <b>real red day</b>. The next day it opens <b>above</b> that red body and closes strong.
          Yesterday's sellers are trapped. That is the Kicker.</p>
      ) : null}
      {step === 1 ? (
        <ul className={s.bullets}>
          <li><b>The red day is real.</b> It closes weak, body one to five percent of price. Not a baby red candle.</li>
          <li><b>The next day opens above the red body</b> and closes near its high. No gap-and-fade.</li>
          <li><b>It lives in a clean base or uptrend.</b> Not a bounce inside a crash.</li>
          <li><b>The low of the Kicker day is the line.</b> If price closes below it, the trap failed.</li>
        </ul>
      ) : null}
      {step === 2 ? (
        <p className={s.teach}>{tap ? (tap.ok ? 'Yes. The red day before it, then the open above and the strong close.' : 'Look for the red day first, then the candle that opens above it.') : 'Find the Kicker on this chart and tap it.'}</p>
      ) : null}
      <div className={s.foot}>
        <button type="button" className={s.cta} onClick={() => { if (step < 2) setStep(step + 1); else { setStep(0); setTap(null) } }}>
          {step < 2 ? 'Next' : tap?.ok ? 'Start the questions' : 'Start over'}
        </button>
      </div>
    </div>
  )
}
