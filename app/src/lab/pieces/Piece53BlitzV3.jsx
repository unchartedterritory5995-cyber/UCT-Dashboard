import { useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import StartCard, { StartButton } from '../StartCard'
import { Stamp } from '../bits'
import { useSample } from '../Lab'
import { fetchSpotPool, scoreAttempt } from '../bank'
import { spot, rayAt } from '../pointers'
import { useRunOn } from '../fx'
import { sfx } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { BLITZ, XP } from '../rewards'

const SECS = BLITZ.SECS
const mult = BLITZ.MULT
const SEEN_KEY = 'study.blitz.tutorialSeen'
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false } }
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, '1') } catch { /* no storage */ } }

/** Round 11, piece 2: BLITZ V3, FED BY THE BANK (owner, batch 10: "it cycled through the same 3 examples. We will
 *  need hundreds if not thousands of examples"; "the whole style can be improved, the size, the font"). Every chart
 *  is an approved item from the Study bank, pooled across every setup that has chart items; the question is the
 *  bank's own ("Does the firm's Kicker fire on the last bar?") and the answer is scored on the server, so the key
 *  never reaches the browser and the run counts toward the member's real progress. Keys 1 and 2 answer. */
function Chart({ item, onAnswer }) {
  const n = item.bars.length
  const ann = useMemo(() => (n ? spot(item.bars, n - 1, { label: 'this candle', id: 'b', halo: false }) : null), [item, n])
  useEffect(() => { const k = (e) => { const i = +e.key - 1; if (i >= 0 && i < item.choices.length) onAnswer(item.choices[i]) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) })
  return (
    <>
      <div className={d5.qLine}><span className={d5.qSetup}>{item.name}</span><span className={d5.qText}>{item.q}</span></div>
      <div className={s.chartBox}><WidgetChart sym={item.id} bars={item.bars} annotations={ann} height={400} density="mini" defaultBars={80} hideTicker /></div>
      <div className={`${d5.cards} ${d5.cascade}`}>{item.choices.map((c, i) => <button key={c} type="button" className={d5.card} style={{ '--i': i }} onClick={() => onAnswer(c)}><span className={d5.key}>{i + 1}</span>{c}</button>)}</div>
    </>
  )
}

function Tutorial({ onDone, onSkip }) {
  return (
    <StartCard eyebrow="Blitz · how it works" title="Sixty seconds" lead="A chart from the firm's bank, a setup named, one question: does it fire on the last bar? Answer fast. Here is the whole game."
      button={<StartButton icon="play" label="Try one, no clock" sub="one practice chart, then the real thing" onClick={onDone} />}
      below={<button type="button" className={d5.linkBtn} onClick={onSkip}>Skip, I know it</button>}>
      <div className={d5.tutSteps}>
        <div className={d5.tutStep} style={{ '--i': 0 }}><span className={d5.tutNum}>1</span><b>Read the last candle</b><span>The gold arrow points at it. The setup is named above the chart. Decide: does it fire here, yes or no?</span></div>
        <div className={d5.tutStep} style={{ '--i': 1 }}><span className={d5.tutNum}>2</span><b>Answer instantly</b><span>Tap a card or press its key. The clock never waits and the next chart loads at once.</span><div className={d5.tutMini}><i className={d5.k}>1</i><i className={d5.k}>2</i></div></div>
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
  const all = useRunOn(bars, d?.forward, pick != null, 120)
  const ok = pick === 'Yes'
  const ann = useMemo(() => (!n || !all ? null : pick == null ? spot(all, n - 1, { label: 'this candle', id: 'p' }) : [...spot(all, n - 1, { label: 'the trigger', id: 'p', color: ok ? '#2faf68' : '#df4646' }), ...rayAt(bars[n - 1], 'l', { id: 'pl', label: 'the line' })]), [all, bars, n, pick, ok])
  useEffect(() => { const k = (e) => { if (pick == null && /^[12]$/.test(e.key)) setPick(e.key === '1' ? 'Yes' : 'No') }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [pick])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><span className={d5.practiceTag}>Practice · no clock</span><div className={d5.prog} /><Logo mood={pick == null ? 'idle' : ok ? 'happy' : 'oops'} size={36} /></div>
      <div className={d5.ask}><Logo mood={pick == null ? 'think' : ok ? 'happy' : 'oops'} size={60} /><div className={d5.bubble}>{pick == null ? 'Kicker. Does it fire on the last candle? Tap Yes or No, or press 1 or 2.' : ok ? 'Yes. A real red day, an open above its body, a close near the high. In the real Blitz the next chart is already loading.' : 'It does fire: a real red day, then an open above its body and a strong close.'}</div></div>
      <div className={d5.qLine}><span className={d5.qSetup}>Kicker</span><span className={d5.qText}>Does the firm's Kicker Candle setup fire on the last bar of this chart?</span></div>
      <div className={s.chartBox}>{pick != null ? <Stamp ok={ok} /> : null}<WidgetChart sym={d.sym} bars={all} annotations={ann} height={400} density="mini" defaultBars={80} /></div>
      <div className={`${d5.cards} ${d5.cascade}`}>{['Yes', 'No'].map((c, i) => { let cls = d5.card; if (pick != null && c === 'Yes') cls += ` ${d5.right}`; if (pick != null && pick === c && !ok) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} style={{ '--i': i }} disabled={pick != null} onClick={() => { setPick(c); sfx(c === 'Yes' ? 'right' : 'wrong') }}><span className={d5.key}>{i + 1}</span>{c}</button> })}</div>
      {pick != null ? <div className={d5.centerRow}><StartButton icon="timer" label="Start the clock" sub="60 seconds · no hearts" onClick={onDone} /></div> : null}
    </div>
  )
}

export default function Piece53BlitzV3() {
  const [phase, setPhase] = useState(seen() ? 'start' : 'tutorial')
  const [pool, setPool] = useState(null)
  const [left, setLeft] = useState(SECS)
  const [i, setI] = useState(0)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [best, setBest] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [right, setRight] = useState(0)
  const [flash, setFlash] = useState(null)
  const [log, setLog] = useState([])
  const shownAt = useRef(0)
  useEffect(() => { let on = true; fetchSpotPool().then((p) => on && setPool(p)).catch(() => on && setPool([])); return () => { on = false } }, [])
  useEffect(() => {
    if (phase !== 'play') return undefined
    const t = setInterval(() => setLeft((v) => { if (v <= 1) { clearInterval(t); setPhase('done'); sfx('levelup'); return 0 } return v - 1 }), 1000)
    return () => clearInterval(t)
  }, [phase])
  useEffect(() => { shownAt.current = performance.now() }, [i])
  const item = pool && pool.length ? pool[i % pool.length] : null
  const answer = async (choice) => {
    if (!item || phase !== 'play') return
    const ms = performance.now() - shownAt.current
    setI((v) => v + 1); setAnswered((v) => v + 1)
    let ok = false, reveal = null
    try { const a = await scoreAttempt(item, choice, ms); ok = !!a.correct; reveal = a.reveal } catch { ok = false }
    if (ok) { const c = combo + 1; setCombo(c); setBest((b) => Math.max(b, c)); setRight((v) => v + 1); setScore((v) => v + XP.RIGHT * mult(c)); sfx(c >= 3 && c % 3 === 0 ? 'combo' : 'right') } else { setCombo(0); sfx('wrong') }
    setFlash(ok ? 'ok' : 'bad'); setTimeout(() => setFlash(null), 220)
    setLog((l) => [...l, { item, choice, ok, ticker: reveal?.ticker || reveal?.symbol || '', date: reveal?.date || reveal?.asof || '' }])
  }
  const start = () => { markSeen(); setPhase('play'); setLeft(SECS); setI(0); setScore(0); setCombo(0); setBest(0); setAnswered(0); setRight(0); setLog([]) }
  const bankLine = pool == null ? 'loading the bank' : `${pool.length} charts in the pool today`
  if (phase === 'tutorial') return <div className={d5.lesson}><Tutorial onDone={() => setPhase('practice')} onSkip={() => { markSeen(); setPhase('start') }} /></div>
  if (phase === 'practice') return <Practice onDone={start} />
  if (phase === 'start') {
    return (
      <div className={d5.lesson}>
        <StartCard eyebrow="Challenge" title="Blitz" art={<Logo mood="fire" size={116} />}
          lead="Sixty seconds. No hearts. Real charts from the firm's bank, a setup named on each, one question: does it fire? The multiplier climbs with your combo and resets on a miss."
          button={<StartButton icon="timer" label="Start the clock" sub={`60 seconds · no hearts · ${bankLine}`} onClick={start} />}
          below={<button type="button" className={d5.linkBtn} onClick={() => setPhase('tutorial')}>How it works</button>}>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Your best</small><b>310</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>⚡</span><small>Multiplier up to</small><b>x5</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  if (phase === 'done') {
    return (
      <div className={d5.lesson}>
        <StartCard eyebrow="Blitz · time" title={`${score} points`} art={<Logo mood={score >= 200 ? 'fire' : 'happy'} size={116} />}
          lead={score > 310 ? 'A new best.' : 'Your best stands at 310.'}
          button={<StartButton icon="timer" label="Again" sub="another sixty seconds" onClick={start} />}
          below={<button type="button" className={d5.linkBtn} onClick={() => setPhase('tutorial')}>How it works</button>}>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}>◆</span><small>Right</small><b>{right}/{answered}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}>⚡</span><small>Best combo</small><b>{best}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}>×</span><small>Top multiplier</small><b>x{mult(best)}</b></div></div></div>
          {log.length ? <div className={d5.runLog}>{log.map((r, k) => <div key={k} className={r.ok ? d5.runOk : d5.runBad}><b>{r.ok ? '✓' : '✕'}</b><span>{r.item.name}</span><small>{r.ticker}{r.date ? ` · ${r.date}` : ''} · you said {r.choice}</small></div>)}</div> : null}
        </StartCard>
      </div>
    )
  }
  if (!item) return <div className={d5.lesson}><div className={d5.topbar}><span className={d5.clock}>⏱ {left}</span></div><p className={s.hint}>{pool == null ? 'Loading the bank' : 'The bank returned no chart items. Is the sandbox signed in?'}</p></div>
  return (
    <div className={`${d5.lesson} ${flash === 'ok' ? d5.flashOk : flash === 'bad' ? d5.flashBad : ''}`}>
      <div className={d5.topbar}><span className={`${d5.clock} ${left <= 10 ? d5.hot : ''}`} style={{ textAlign: 'left', fontSize: 22 }}>⏱ {left}</span><div className={d5.blitzMid}><b>{score}</b><small>points</small></div><span className={`${d5.multi} ${mult(combo) >= 3 ? d5.hotM : ''}`}>x{mult(combo)}{combo ? ` · ${combo} in a row` : ''}</span></div>
      <Chart key={item.id + i} item={item} onAnswer={answer} />
    </div>
  )
}
