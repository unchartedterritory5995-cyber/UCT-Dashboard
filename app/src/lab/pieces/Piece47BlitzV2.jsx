import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import StartCard, { StartButton } from '../StartCard'
import { Stamp } from '../bits'
import { useRunOn } from '../fx'
import { useSample } from '../Lab'
import { spot, rayAt } from '../pointers'
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
const SEEN_KEY = 'study.blitz.tutorialSeen'
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false } }
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1') } catch { /* no storage */ } }

/** Round 10, piece 2: BLITZ V2 (owner, batch 9: "too much space from the page to the START THE CLOCK button",
 *  "it should begin with a tutorial imo", the logo instead of the character). A three-step HOW IT WORKS on the
 *  first run, one untimed practice chart, then the start card with the button right under the words. */
function Chart({ sample, order, onAnswer, mini = true }) {
  const d = useSample(sample)
  const bars = d?.visible
  const n = bars?.length || 0
  const ann = useMemo(() => (n ? spot(bars, n - 1, { label: 'this candle', id: 'b', halo: false }) : null), [bars, n])
  useEffect(() => { const k = (e) => { if (/^[1-4]$/.test(e.key)) onAnswer(order[+e.key - 1]) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) })
  if (!d) return <div style={{ height: 380, display: 'grid', placeItems: 'center', color: '#9a958a' }}>Loading</div>
  return (
    <>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={bars} annotations={ann} height={380} density={mini ? 'mini' : 'compact'} defaultBars={80} /></div>
      <div className={`${d5.cards} ${d5.cascade}`}>{order.map((c, i) => <button key={c} type="button" className={d5.card} style={{ '--i': i }} onClick={() => onAnswer(c)}><span className={d5.key}>{i + 1}</span>{c}</button>)}</div>
    </>
  )
}

function Tutorial({ onDone, onSkip }) {
  return (
    <StartCard eyebrow="Blitz · how it works" title="Sixty seconds" lead="Name the setup on each marked candle as fast as you can. Here is the whole game."
      button={<StartButton icon="play" label="Try one, no clock" sub="one practice chart, then the real thing" onClick={onDone} />}
      below={<button type="button" className={d5.linkBtn} onClick={onSkip}>Skip, I know it</button>}>
      <div className={d5.tutSteps}>
        <div className={d5.tutStep} style={{ '--i': 0 }}><span className={d5.tutNum}>1</span><b>A candle is marked</b><span>The gold arrow and chip point at ONE candle. Decide what fired on it: Kicker, Slingshot, Launchpad, or none of these.</span></div>
        <div className={d5.tutStep} style={{ '--i': 1 }}><span className={d5.tutNum}>2</span><b>Answer instantly</b><span>Tap a card or press its key. The clock never waits and the next chart loads at once.</span><div className={d5.tutMini}><i className={d5.k}>1</i><i className={d5.k}>2</i><i className={d5.k}>3</i><i className={d5.k}>4</i></div></div>
        <div className={d5.tutStep} style={{ '--i': 2 }}><span className={d5.tutNum}>3</span><b>Build the multiplier</b><span>Every right answer in a row climbs it. One miss resets it to x1.</span><div className={d5.multRow}><i>x2</i><i>x3</i><i>x4</i><i>x5</i></div></div>
      </div>
    </StartCard>
  )
}

function Practice({ onDone }) {
  const d = useSample('JBI_2023-12-14')
  const [pick, setPick] = useState(null)
  const bars = d?.visible
  const n = bars?.length || 0
  const all = useRunOn(bars, d?.forward, pick != null)
  const ok = pick === 'Kicker'
  const ann = useMemo(() => (!n || !all ? null : pick == null ? spot(all, n - 1, { label: 'this candle', id: 'p' }) : [...spot(all, n - 1, { label: 'the trigger', id: 'p', color: ok ? '#2faf68' : '#df4646' }), ...rayAt(bars[n - 1], 'l', { id: 'pl', label: 'the line' })]), [all, bars, n, pick, ok])
  useEffect(() => { const k = (e) => { if (pick == null && /^[1-4]$/.test(e.key)) setPick(NAMES[+e.key - 1]) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [pick])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><span className={d5.practiceTag}>Practice · no clock</span><div className={d5.prog} /><Logo mood={pick == null ? 'idle' : ok ? 'happy' : 'oops'} size={36} /></div>
      <div className={d5.ask}><Logo mood={pick == null ? 'think' : ok ? 'happy' : 'oops'} size={64} /><div className={d5.bubble}>{pick == null ? 'What setup, if any, just fired on this candle? Tap a card or press 1 to 4.' : ok ? 'Kicker. In the real Blitz the next chart is already loading.' : 'It was the Kicker: a real red day, then an open above its body and a strong close.'}</div></div>
      <div className={s.chartBox}>{pick != null ? <Stamp ok={ok} /> : null}<WidgetChart sym={d.sym} bars={all} annotations={ann} height={380} density="mini" defaultBars={80} /></div>
      <div className={`${d5.cards} ${d5.cascade}`}>{NAMES.map((c, i) => { let cls = d5.card; if (pick != null && c === 'Kicker') cls += ` ${d5.right}`; if (pick != null && pick === c && !ok) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} style={{ '--i': i }} disabled={pick != null} onClick={() => { setPick(c); sfx(c === 'Kicker' ? 'right' : 'wrong') }}><span className={d5.key}>{i + 1}</span>{c}</button> })}</div>
      {pick != null ? <div className={d5.centerRow}><StartButton icon="timer" label="Start the clock" sub="60 seconds · no hearts" onClick={onDone} /></div> : null}
    </div>
  )
}

export default function Piece47BlitzV2() {
  const [phase, setPhase] = useState(seen() ? 'start' : 'tutorial')
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
  const start = () => { markSeen(); setPhase('play'); setLeft(SECS); setI(0); setScore(0); setCombo(0); setBest(0); setAnswered(0); setRight(0) }
  if (phase === 'tutorial') return <div className={d5.lesson}><Tutorial onDone={() => setPhase('practice')} onSkip={() => { markSeen(); setPhase('start') }} /></div>
  if (phase === 'practice') return <Practice onDone={start} />
  if (phase === 'start') {
    return (
      <div className={d5.lesson}>
        <StartCard eyebrow="Challenge" title="Blitz" art={<Logo mood="fire" size={120} />}
          lead="Sixty seconds. No hearts. Name the setup on each candle as fast as you can. The multiplier climbs with your combo and resets on a miss."
          button={<StartButton icon="timer" label="Start the clock" sub="60 seconds · no hearts · keys 1 to 4" onClick={start} />}
          below={<button type="button" className={d5.linkBtn} onClick={() => setPhase('tutorial')}>How it works</button>}>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Your best</small><b>310</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>⚡</span><small>Multiplier up to</small><b>x5</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  if (phase === 'done') {
    return (
      <div className={d5.lesson}>
        <StartCard eyebrow="Blitz · time" title={`${score} points`} art={<Logo mood={score >= 200 ? 'fire' : 'happy'} size={120} />}
          lead={score > 310 ? 'A new best.' : 'Your best stands at 310.'}
          button={<StartButton icon="timer" label="Again" sub="another sixty seconds" onClick={start} />}
          below={<button type="button" className={d5.linkBtn} onClick={() => setPhase('tutorial')}>How it works</button>}>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Right</small><b>{right}/{answered}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>⚡</span><small>Best combo</small><b>{best}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>×</span><small>Top multiplier</small><b>x{mult(best)}</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  return (
    <div className={`${d5.lesson} ${flash === 'ok' ? d5.flashOk : flash === 'bad' ? d5.flashBad : ''}`}>
      <div className={d5.topbar}><span className={`${d5.clock} ${left <= 10 ? d5.hot : ''}`} style={{ textAlign: 'left', fontSize: 22 }}>⏱ {left}</span><div className={d5.blitzMid}><b>{score}</b><small>points</small></div><span className={`${d5.multi} ${mult(combo) >= 3 ? d5.hotM : ''}`}>x{mult(combo)}{combo ? ` · ${combo} in a row` : ''}</span></div>
      <Chart key={i} sample={q.sample} order={order} onAnswer={answer} />
    </div>
  )
}
