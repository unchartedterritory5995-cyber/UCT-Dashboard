import { useEffect, useState } from 'react'
import coach from '../../components/intro/assets/compass-mark.png'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

function Confetti() {
  const bits = Array.from({ length: 80 }, (_, i) => ({ l: (i * 37) % 100, d: (i % 7) * 0.12, c: ['#ffc800', '#58cc02', '#1cb0f6', '#ff4b4b'][i % 4], r: 1.4 + (i % 5) * 0.25 }))
  return <div className={s.confetti}>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${b.r}s` }} />)}</div>
}

function useCount(target, on, ms = 40) {
  const [v, setV] = useState(0)
  useEffect(() => { if (!on) { setV(0); return undefined } let i = 0; const t = setInterval(() => { i += 1; setV(Math.min(i, target)); if (i >= target) clearInterval(t) }, ms); return () => clearInterval(t) }, [target, on, ms])
  return v
}

/** Round 5, piece 4: the end of a lesson the way the apps do it (owner: "still don't see how this isn't the same
 *  thing"). Not one card: a SEQUENCE of full screens, one big thing each, tap to go on. 1 Lesson complete + XP
 *  cards. 2 The streak screen: the flame, the number ticking up, this week's days. 3 The daily goal ring filling
 *  to Goal met. 4 What to fix, with the next lesson. */
export default function Piece24FinishSeq() {
  const [step, setStep] = useState(0)
  const xp = useCount(96, step === 0, 18)
  const streak = useCount(4, step === 1, 350)
  const goal = useCount(5, step === 2, 220)
  const next = () => setStep((v) => Math.min(3, v + 1))
  return (
    <div className={d5.lesson}>
      {step === 0 ? (
        <div className={d5.screen}>
          <Confetti />
          <img src={coach} alt="" className={d5.coachBig} />
          <div className={d5.screenH} style={{ color: '#ffc800' }}>Lesson complete!</div>
          <div className={d5.xpRow}>
            <div className={`${d5.xpCard} ${d5.gold}`}><small>TOTAL XP</small><b>{xp}</b></div>
            <div className={`${d5.xpCard} ${d5.green}`}><small>AMAZING</small><b>8/10</b></div>
            <div className={`${d5.xpCard} ${d5.blue}`}><small>BEST RUN</small><b>🔥 5</b></div>
          </div>
        </div>
      ) : step === 1 ? (
        <div className={d5.screen}>
          <div className={`${d5.flameBig} ${streak >= 4 ? d5.lit : ''}`}>🔥</div>
          <div className={d5.streakNum}>{streak}</div>
          <div className={d5.screenH}>day streak</div>
          <div className={d5.week}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => <span key={i} className={i < 3 || (i === 3 && streak >= 4) ? d5.on : ''}>{w}</span>)}</div>
          <p className={d5.screenSub}>Practice each day so your streak won't reset.</p>
        </div>
      ) : step === 2 ? (
        <div className={d5.screen}>
          <div className={d5.goalRing} style={{ '--p': `${(goal / 5) * 100}%` }}><div><b>{goal}</b><small>/ 5</small></div></div>
          <div className={d5.screenH}>{goal >= 5 ? 'Daily goal met!' : 'Daily goal'}</div>
          <p className={d5.screenSub}>{goal >= 5 ? 'Five questions right today. Come back tomorrow.' : 'Counting up'}</p>
        </div>
      ) : (
        <div className={d5.screen}>
          <div className={d5.screenH}>One thing to fix</div>
          <div className={d5.fixCard}><b>The red day must be real.</b><span>Q3 · you called a 0.3% red day a setup. One to five percent down, sellers in charge.</span></div>
          <div className={d5.nextCard}><small>NEXT UP</small><b>Oops Reversal</b><span>the red day that fails to follow through</span></div>
        </div>
      )}
      <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={step < 3 ? next : () => setStep(0)}>{step < 3 ? 'Continue' : 'Back to the path'}</button></div></div>
    </div>
  )
}
