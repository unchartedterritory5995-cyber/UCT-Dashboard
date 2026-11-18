import { useEffect, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { spot } from '../pointers'
import coach from '../../components/intro/assets/compass-mark.webp'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

function Confetti() {
  const bits = Array.from({ length: 90 }, (_, i) => ({ l: (i * 37) % 100, d: (i % 7) * 0.12, c: ['#dcbb5e', '#2faf68', '#ffffff', '#e9cd77'][i % 4], r: 1.4 + (i % 5) * 0.25 }))
  return <div className={s.confetti}>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${b.r}s` }} />)}</div>
}
function useCount(target, on, ms = 40) {
  const [v, setV] = useState(0)
  const [was, setWas] = useState(on)
  if (on !== was) { setWas(on); setV(0) }   // reset on the way in and out, the React way (derived from the previous render)
  useEffect(() => { if (!on) return undefined; let i = 0; const t = setInterval(() => { i += 1; setV(Math.min(i, target)); if (i >= target) clearInterval(t) }, ms); return () => clearInterval(t) }, [target, on, ms])
  return on ? v : 0
}
function Gem({ icon, label, value, tone = 'gold', delay = 0 }) {
  return (
    <div className={`${d5.gem} ${d5[tone]}`} style={{ animationDelay: `${delay}ms` }}>
      <div className={d5.gemIn}><span className={d5.gemIcon}>{icon}</span><small>{label}</small><b>{value}</b></div>
    </div>
  )
}
function MissChart() {
  const d = useSample('MSTR_2023-10-23')
  const bars = d?.visible
  const ann = bars ? spot(bars, bars.length - 1, { label: 'the one you missed', color: '#df4646', id: 'm', halo: false }) : null
  return <div className={s.chartBox} style={{ width: '100%', maxWidth: 520 }}><StudyChart bars={bars} annotations={ann} height={220} /></div>
}

/** Round 7, piece 4: the end-of-lesson screens with the cards redone (owner: "those boxes A LOT better, much more of a
 *  high quality production and visual"): a gold metallic frame, dark glass inside, an icon, the number counting up, a
 *  shine that sweeps across, a glow, each card arriving a beat after the last. Same four screens. */
export default function Piece34FinishV3() {
  const [step, setStep] = useState(0)
  const xp = useCount(96, step === 0, 18)
  const streak = useCount(4, step === 1, 350)
  const goal = useCount(5, step === 2, 220)
  return (
    <div className={d5.lesson}>
      {step === 0 ? (
        <div className={d5.screen}><Confetti /><img src={coach} alt="" className={d5.coachBig} />
          <div className={d5.heroWord}>Lesson complete</div>
          <div className={d5.gems}><Gem icon="◆" label="Total XP" value={xp} delay={0} /><Gem icon="★" label="Sharp" value="8/10" tone="green" delay={150} /><Gem icon="🔥" label="Best run" value="5" tone="ember" delay={300} /></div>
          <p className={d5.screenSub}>+30 for a clean run, +15 from combos, no hearts lost.</p>
        </div>
      ) : step === 1 ? (
        <div className={d5.screen}><div className={`${d5.flameBig} ${streak >= 4 ? d5.lit : ''}`}>🔥</div><div className={d5.streakNum}>{streak}</div><div className={d5.screenH}>day streak</div>
          <div className={d5.gems}><Gem icon="🗓" label="This week" value={<span className={d5.week}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => <span key={i} className={i < 3 || (i === 3 && streak >= 4) ? d5.on : ''}>{w}</span>)}</span>} tone="ember" /></div>
          <p className={d5.screenSub}>One lesson a day keeps it alive.</p></div>
      ) : step === 2 ? (
        <div className={d5.screen}><div className={d5.goalRing} style={{ '--p': `${(goal / 5) * 100}%` }}><div><b>{goal}</b><small>/ 5</small></div></div>
          <div className={d5.screenH}>{goal >= 5 ? 'Daily goal met' : 'Daily goal'}</div>
          <div className={d5.gems}><Gem icon="🎁" label="Chest" value={goal >= 5 ? 'Unlocked' : 'Locked'} tone={goal >= 5 ? 'gold' : 'dim'} /><Gem icon="♛" label="Crowns · Kicker 2" value="2 of 3" tone="green" delay={150} /></div>
          <p className={d5.screenSub}>{goal >= 5 ? 'Five right today. Come back tomorrow.' : 'Counting up'}</p></div>
      ) : (
        <div className={d5.screen}><div className={d5.screenH}>One thing to fix</div><MissChart />
          <div className={d5.fixCard}><b>The red day must be real.</b><span>Q3 · you called a 0.3% red day a setup. One to five percent down, sellers in charge.</span></div>
          <div className={d5.nextCard}><small>NEXT UP</small><b>Oops Reversal</b><span>the red day that fails to follow through</span></div></div>
      )}
      <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => setStep((v) => (v < 3 ? v + 1 : 0))}>{step < 3 ? 'Continue' : 'Back to the path'}</button></div></div>
    </div>
  )
}
