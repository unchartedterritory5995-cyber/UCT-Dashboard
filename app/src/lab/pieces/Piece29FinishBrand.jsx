import { useEffect, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { arrowAt } from '../pointers'
import coach from '../../components/intro/assets/compass-mark.webp'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

function Confetti() {
  const bits = Array.from({ length: 80 }, (_, i) => ({ l: (i * 37) % 100, d: (i % 7) * 0.12, c: ['#dcbb5e', '#2faf68', '#ffffff', '#df4646'][i % 4], r: 1.4 + (i % 5) * 0.25 }))
  return <div className={s.confetti}>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${b.r}s` }} />)}</div>
}
function useCount(target, on, ms = 40) {
  const [v, setV] = useState(0)
  useEffect(() => { if (!on) { setV(0); return undefined } let i = 0; const t = setInterval(() => { i += 1; setV(Math.min(i, target)); if (i >= target) clearInterval(t) }, ms); return () => clearInterval(t) }, [target, on, ms])
  return v
}
function MissChart() {
  const d = useSample('MSTR_2023-10-23')
  const bars = d?.visible
  const ann = bars ? arrowAt(bars, bars.length - 1, { label: '', color: '#df4646', id: 'm' }) : null
  return <div className={s.chartBox} style={{ width: '100%', maxWidth: 460 }}><StudyChart bars={bars} annotations={ann} height={200} /></div>
}

/** Round 6, piece 4: the end-of-lesson sequence (owner: "good and better, but more ON BRAND"). Same four screens,
 *  now in the site's gold and black with the compass mark, the candle green and red, and the miss shown on the
 *  firm's chart. */
export default function Piece29FinishBrand() {
  const [step, setStep] = useState(0)
  const xp = useCount(96, step === 0, 18)
  const streak = useCount(4, step === 1, 350)
  const goal = useCount(5, step === 2, 220)
  return (
    <div className={d5.lesson}>
      {step === 0 ? (
        <div className={d5.screen}><Confetti /><img src={coach} alt="" className={d5.coachBig} />
          <div className={d5.screenH} style={{ color: 'var(--g)' }}>Lesson complete</div>
          <div className={d5.xpRow}><div className={d5.xpCard}><small>TOTAL XP</small><b>{xp}</b></div><div className={`${d5.xpCard} ${d5.green}`}><small>SHARP</small><b>8/10</b></div><div className={`${d5.xpCard} ${d5.blue}`}><small>BEST RUN</small><b>5</b></div></div>
        </div>
      ) : step === 1 ? (
        <div className={d5.screen}><div className={`${d5.flameBig} ${streak >= 4 ? d5.lit : ''}`}>🔥</div><div className={d5.streakNum}>{streak}</div><div className={d5.screenH}>day streak</div>
          <div className={d5.week}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => <span key={i} className={i < 3 || (i === 3 && streak >= 4) ? d5.on : ''}>{w}</span>)}</div>
          <p className={d5.screenSub}>One lesson a day keeps it alive.</p></div>
      ) : step === 2 ? (
        <div className={d5.screen}><div className={d5.goalRing} style={{ '--p': `${(goal / 5) * 100}%` }}><div><b>{goal}</b><small>/ 5</small></div></div>
          <div className={d5.screenH}>{goal >= 5 ? 'Daily goal met' : 'Daily goal'}</div><p className={d5.screenSub}>{goal >= 5 ? 'Five right today. Come back tomorrow.' : 'Counting up'}</p></div>
      ) : (
        <div className={d5.screen}><div className={d5.screenH}>One thing to fix</div><MissChart />
          <div className={d5.fixCard}><b>The red day must be real.</b><span>Q3 · you called a 0.3% red day a setup. One to five percent down, sellers in charge.</span></div>
          <div className={d5.nextCard}><small>NEXT UP</small><b>Oops Reversal</b><span>the red day that fails to follow through</span></div></div>
      )}
      <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => setStep((v) => (v < 3 ? v + 1 : 0))}>{step < 3 ? 'Continue' : 'Back to the path'}</button></div></div>
    </div>
  )
}
