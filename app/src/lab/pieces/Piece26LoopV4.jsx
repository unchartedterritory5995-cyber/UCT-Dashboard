import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt } from '../pointers'
import coach from '../../components/intro/assets/compass-mark.png'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

/** Round 6, piece 1: the loop (50: "widget slightly too small; bubbles can be better; no cool looking arrows pointed
 *  to where we should be looking"). Bigger widget, the gold arrow back on the candle in question, the bubble and the
 *  cards in the brand's gold and black. Same hearts, keys, sheet, sound. */
const QUESTIONS = [
  { kind: 'name', sample: 'JBI_2023-12-14', q: 'What setup, if any, just fired on this candle?', choices: ['Launchpad', 'Kicker', 'Slingshot', 'None of these'], answer: 1,
    why: 'Kicker. The day before closed weak and red. This candle opened above that red body and closed near its high.' },
  { kind: 'tap', sample: 'HAS_2023-02-02', q: 'Tap the candle that triggered the trade.', why: 'That close is the Slingshot trigger: the first decisive close back above the 4-day average of the highs.' },
  { kind: 'name', sample: 'MSTR_2023-10-23', q: 'What setup, if any, just fired on this candle?', choices: ['None of these', 'Kicker', 'Launchpad', 'Slingshot'], answer: 2,
    why: 'Launchpad. Weeks under the averages, then the first candle to close above every one of them.' },
  { kind: 'entry', sample: 'JBI_2023-12-14', q: 'It is a Kicker. How does the house enter it?',
    choices: ['Wait for a pullback to the 20 EMA', 'The 30-minute opening range break on day 1, or over the previous day\'s high', 'A limit order at the red day\'s close', 'Buy the close of the Kicker itself'], answer: 1,
    why: 'On a Kicker you buy the opening range break on the 30-minute chart on day 1, or a stop-buy over the previous day\'s high.' },
]

let actx = null
function tone(ok) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)()
    const notes = ok ? [523, 659, 784] : [220, 180]
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain()
      o.type = ok ? 'triangle' : 'square'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, actx.currentTime + i * 0.09)
      g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + i * 0.09 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + i * 0.09 + 0.18)
      o.connect(g).connect(actx.destination); o.start(actx.currentTime + i * 0.09); o.stop(actx.currentTime + i * 0.09 + 0.2)
    })
  } catch { /* no audio */ }
}

function Question({ idx, total, hearts, combo, onDone }) {
  const Q = QUESTIONS[idx]
  const d = useSample(Q.sample)
  const [pick, setPick] = useState(null)
  const [tap, setTap] = useState(null)
  const [state, setState] = useState('ask')
  const bars = d?.visible
  const n = bars?.length || 0
  const isTap = Q.kind === 'tap'
  const all = useMemo(() => (!bars ? null : (isTap || state !== 'ask') && d?.forward ? [...bars, ...d.forward] : bars), [bars, d, state, isTap])
  const annotations = useMemo(() => {
    if (!n || !all) return null
    const a = []
    if (!isTap && state === 'ask') a.push(...arrowAt(all, n - 1, { label: 'this candle', id: `q${idx}-ptr` }))
    if (state !== 'ask') { a.push(...arrowAt(all, n - 1, { label: 'the trigger', id: `q${idx}`, color: '#2faf68' })); a.push(...rayAt(bars[n - 1], 'l', { id: `q${idx}-low`, label: 'the line' })) }
    if (isTap && tap && tap.index !== n - 1) a.push(...arrowAt(all, tap.index, { label: 'your tap', id: `q${idx}-tap`, color: '#df4646' }))
    return a.length ? a : null
  }, [all, bars, n, state, tap, isTap, idx])
  const check = () => { const ok = isTap ? tap?.index === n - 1 : pick === Q.answer; setState(ok ? 'ok' : 'bad'); tone(ok) }
  useEffect(() => {
    const onKey = (e) => {
      if (state !== 'ask') { if (e.key === 'Enter') onDone(state === 'ok'); return }
      if (!isTap && /^[1-4]$/.test(e.key) && Q.choices[+e.key - 1]) setPick(+e.key - 1)
      if (e.key === 'Enter' && (isTap ? tap : pick != null)) check()
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  })
  const ready = isTap ? !!tap : pick != null
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={`${d5.lesson} ${state === 'bad' ? s.shake : ''}`}>
      <div className={d5.topbar}>
        <button type="button" className={d5.close} aria-label="Close">✕</button>
        <div className={d5.prog}>{Array.from({ length: total }, (_, i) => <i key={i} className={i < idx || (i === idx && state !== 'ask') ? d5.on : i === idx ? d5.cur : ''} />)}</div>
        <div className={d5.hearts}>{Array.from({ length: 3 }, (_, i) => <span key={i} className={i < hearts ? '' : d5.lost}>♥</span>)}</div>
      </div>
      <div className={d5.ask}><img src={coach} alt="" className={d5.coach} /><div className={d5.bubble}>{Q.q}</div></div>
      <div className={`${s.chartBox} `}>
        {isTap && !tap && state === 'ask' ? <span className={s.tapHint}>tap a candle</span> : null}
        <WidgetChart sym={d.sym} bars={all} annotations={annotations} height={540} density="compact" defaultBars={90} onBarTap={isTap && state === 'ask' ? ({ index }) => { if (index >= 0) setTap({ index }) } : null} />
      </div>
      {isTap ? <p className={s.hint}>{tap ? `You picked ${all?.[tap.index]?.t || ''}.` : 'The chart ran on past the trigger. Find it.'}</p> : (
        <div className={d5.cards}>
          {Q.choices.map((c, i) => {
            let cls = d5.card
            if (state === 'ask' && pick === i) cls += ` ${d5.sel}`
            if (state !== 'ask' && i === Q.answer) cls += ` ${d5.right}`
            if (state === 'bad' && pick === i) cls += ` ${d5.wrong}`
            return <button key={c} type="button" className={cls} disabled={state !== 'ask'} onClick={() => setPick(i)}><span className={d5.key}>{i + 1}</span>{c}</button>
          })}
        </div>
      )}
      {combo > 1 && state === 'ok' ? <div className={d5.toast}>🔥 {combo} in a row · +5 XP</div> : null}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}>
        <div className={d5.footIn}>
          {state === 'ask' ? <button type="button" className={`${d5.btn} ${ready ? d5.live : ''}`} disabled={!ready} onClick={check}>Check</button> : (
            <>
              <div className={d5.verdictRow}><img src={coach} alt="" className={d5.coachSm} /><div><div className={d5.verdictBig}>{state === 'ok' ? 'Nicely done!' : 'Not quite.'}</div><div className={d5.verdictWhy}>{Q.why}</div></div></div>
              <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok')}>Continue</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Piece26LoopV4() {
  const [i, setI] = useState(0)
  const [hearts, setHearts] = useState(3)
  const [combo, setCombo] = useState(0)
  const [results, setResults] = useState([])
  const [run, setRun] = useState(0)
  const total = QUESTIONS.length
  const onDone = (ok) => { setCombo((c) => (ok ? c + 1 : 0)); if (!ok) setHearts((h) => Math.max(0, h - 1)); setResults((r) => [...r, ok]); setI((v) => v + 1) }
  if (i >= total) {
    const right = results.filter(Boolean).length
    return (
      <div className={d5.lesson}>
        <div className={d5.doneScreen}><div className={d5.doneBig}>Lesson complete</div><div className={d5.doneSub}>{right} of {total} · {hearts} hearts left</div><div className={d5.xpCard}><small>TOTAL XP</small><b>{right * 10 + Math.max(0, right - 1) * 5}</b></div></div>
        <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => { setI(0); setHearts(3); setCombo(0); setResults([]); setRun((r) => r + 1) }}>Play again</button></div></div>
      </div>
    )
  }
  return <Question key={`${run}-${i}`} idx={i} total={total} hearts={hearts} combo={combo} onDone={onDone} />
}
