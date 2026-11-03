import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { useSample } from '../Lab'
import { spot } from '../pointers'
import { sfx } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { BLITZ, XP } from '../rewards'

const SECS = BLITZ.SECS
const POOL = [
  { sample: 'JBI_2023-12-14', answer: 'Kicker' },
  { sample: 'HAS_2023-02-02', answer: 'Slingshot' },
  { sample: 'MSTR_2023-10-23', answer: 'Launchpad' },
]
const NAMES = ['Kicker', 'Slingshot', 'Launchpad', 'None of these']
const mult = BLITZ.MULT

/** Round 9, piece 1: TIMED BLITZ. Sixty seconds, hearts off, name as many setups as you can. The multiplier climbs
 *  with the combo (x2 at one, x3 at three, x4 at six, x5 at nine) and resets on a miss. Keys 1-4 answer instantly;
 *  the next chart loads at once. Charts cycle through the three stored examples with shuffled choices. */
function Chart({ sample, order, onAnswer }) {
  const d = useSample(sample)
  const bars = d?.visible
  const n = bars?.length || 0
  const ann = useMemo(() => (n ? spot(bars, n - 1, { label: 'this candle', id: 'b', halo: false }) : null), [bars, n])
  useEffect(() => { const k = (e) => { if (/^[1-4]$/.test(e.key)) onAnswer(order[+e.key - 1]) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) })
  if (!d) return <div style={{ height: 380, display: 'grid', placeItems: 'center', color: '#9a958a' }}>Loading</div>
  return (
    <>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={bars} annotations={ann} height={380} density="mini" defaultBars={80} /></div>
      <div className={d5.cards}>{order.map((c, i) => <button key={c} type="button" className={d5.card} onClick={() => onAnswer(c)}><span className={d5.key}>{i + 1}</span>{c}</button>)}</div>
    </>
  )
}

export default function Piece41Blitz() {
  const [phase, setPhase] = useState('intro')
  const [left, setLeft] = useState(SECS)
  const [i, setI] = useState(0)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [best, setBest] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [right, setRight] = useState(0)
  const [flash, setFlash] = useState(null)
  useEffect(() => {
    if (phase !== 'play') return undefined
    const t = setInterval(() => setLeft((v) => { if (v <= 1) { clearInterval(t); setPhase('done'); sfx('levelup'); return 0 } return v - 1 }), 1000)
    return () => clearInterval(t)
  }, [phase])
  const q = POOL[i % POOL.length]
  const order = useMemo(() => { const a = [...NAMES]; const r = (i * 7 + 3) % 4; return [...a.slice(r), ...a.slice(0, r)] }, [i])
  const answer = (name) => {
    const ok = name === q.answer
    setAnswered((v) => v + 1)
    if (ok) { const c = combo + 1; setCombo(c); setBest((b) => Math.max(b, c)); setRight((v) => v + 1); setScore((v) => v + XP.RIGHT * mult(c)); sfx(c >= 3 && c % 3 === 0 ? 'combo' : 'right') } else { setCombo(0); sfx('wrong') }
    setFlash(ok ? 'ok' : 'bad'); setTimeout(() => setFlash(null), 220)
    setI((v) => v + 1)
  }
  const start = () => { setPhase('play'); setLeft(SECS); setI(0); setScore(0); setCombo(0); setBest(0); setAnswered(0); setRight(0) }
  if (phase === 'intro') {
    return (
      <div className={d5.lesson}><div className={d5.intro}><Logo mood="fire" size={110} /><div className={d5.eyebrowG}>Challenge</div><div className={d5.heroWord}>Blitz</div>
        <p className={d5.screenSub}>Sixty seconds. No hearts. Name the setup on each candle as fast as you can. The multiplier climbs with your combo and resets on a miss. Keys 1 to 4 answer instantly.</p>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>🏆</span><small>Your best</small><b>310</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>⚡</span><small>Multiplier up to</small><b>x5</b></div></div></div></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={start}>Start the clock</button></div></div></div>
    )
  }
  if (phase === 'done') {
    return (
      <div className={d5.lesson}><div className={d5.screen}><Logo mood={score >= 200 ? 'fire' : 'happy'} size={110} /><div className={d5.heroWord}>{score} points</div>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Right</small><b>{right}/{answered}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>🔥</span><small>Best combo</small><b>{best}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>⚡</span><small>Top multiplier</small><b>x{mult(best)}</b></div></div></div>
        <p className={d5.screenSub}>{score > 310 ? 'A new best.' : 'Your best stands at 310.'}</p></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={start}>Again</button></div></div></div>
    )
  }
  return (
    <div className={`${d5.lesson} ${flash === 'ok' ? d5.flashOk : flash === 'bad' ? d5.flashBad : ''}`}>
      <div className={d5.topbar}><span className={`${d5.clock} ${left <= 10 ? d5.hot : ''}`} style={{ textAlign: 'left', fontSize: 22 }}>⏱ {left}</span><div className={d5.blitzMid}><b>{score}</b><small>points</small></div><span className={`${d5.multi} ${mult(combo) >= 3 ? d5.hotM : ''}`}>x{mult(combo)}{combo ? ` · ${combo} in a row` : ''}</span></div>
      <Chart key={i} sample={q.sample} order={order} onAnswer={answer} />
    </div>
  )
}
