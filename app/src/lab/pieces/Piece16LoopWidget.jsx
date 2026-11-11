import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt } from '../pointers'
import s from '../lab.module.css'

/** Round 4, piece 1: the question loop ON THE REAL WIDGET (round 3: the widget 69/100, the loop 2/100 with no
 *  words). Same three non-leading forms (NAME / FIND / ENTER), now every chart is the Chart widget itself with the
 *  bank's stored bars, so tap-to-find works on it and the answer runs the chart on 20 sessions. */
const QUESTIONS = [
  { kind: 'name', sample: 'JBI_2023-12-14', q: 'What setup, if any, just fired?', choices: ['Launchpad', 'Kicker', 'Slingshot', 'None of these'], answer: 1,
    why: 'Kicker. The day before closed weak and red. This candle opened above that red body and closed near its high: yesterday\'s sellers are trapped.' },
  { kind: 'tap', sample: 'HAS_2023-02-02', q: 'Tap the candle that triggered the trade.',
    why: 'That close is the Slingshot trigger: a drive, a tight pullback under the 4-day average of the highs, then the first decisive close back above it.' },
  { kind: 'name', sample: 'MSTR_2023-10-23', q: 'What setup, if any, just fired?', choices: ['None of these', 'Kicker', 'Launchpad', 'Slingshot'], answer: 2,
    why: 'Launchpad. Price lived under and through the 9, 20 and 50 for weeks. The first candle to close above every one of them is the trigger.' },
  { kind: 'entry', sample: 'JBI_2023-12-14', q: 'It is a Kicker. How does the house enter it?',
    choices: ['Wait for a pullback to the 20 EMA', 'The 30-minute opening range break on day 1, or the break of the previous day\'s high', 'A limit order at the red day\'s close', 'Buy the close of the Kicker itself'], answer: 1,
    why: 'On a Kicker you buy the opening range break (ORB) on the 30-minute chart on day 1, or the break of the previous day\'s high.' },
]

function Question({ idx, total, score, combo, onDone }) {
  const Q = QUESTIONS[idx]
  const d = useSample(Q.sample)
  const [pick, setPick] = useState(null)
  const [tap, setTap] = useState(null)
  const [state, setState] = useState('ask')
  const [xp, setXp] = useState(false)
  const bars = d?.visible
  const n = bars?.length || 0
  const isTap = Q.kind === 'tap'
  const all = useMemo(() => {
    if (!bars) return null
    if (isTap || state !== 'ask') return d?.forward ? [...bars, ...d.forward] : bars
    return bars
  }, [bars, d, state, isTap])
  const annotations = useMemo(() => {
    if (!n || !all) return null
    const a = []
    if (state !== 'ask') {
      a.push(...arrowAt(all, n - 1, { label: Q.kind === 'entry' ? 'the Kicker' : 'the trigger', id: `q${idx}`, color: '#1ae51a' }))
      a.push(...rayAt(bars[n - 1], 'l', { id: `q${idx}-low`, label: 'the line' }))
    }
    if (isTap && tap && tap.index !== n - 1) a.push(...arrowAt(all, tap.index, { label: 'your tap', id: `q${idx}-tap`, color: '#ff6b6b' }))
    return a.length ? a : null
  }, [all, bars, n, state, tap, isTap, idx, Q.kind])
  const check = () => {
    const ok = isTap ? tap?.index === n - 1 : pick === Q.answer
    setState(ok ? 'ok' : 'bad')
    if (ok) { setXp(true); setTimeout(() => setXp(false), 1100) }
  }
  const ready = isTap ? !!tap : pick != null
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={`${s.col} ${state === 'bad' ? s.shake : ''}`}>
      <div className={s.top}>
        <span>{idx + 1} of {total}</span>
        <span className={s.bar}><i style={{ width: `${((idx + (state === 'ask' ? 0 : 1)) / total) * 100}%` }} /></span>
        <span className={s.combo}>{combo > 1 ? `🔥 ${combo} in a row` : `${score} XP`}</span>
      </div>
      <h1 className={s.h1}>{Q.q}</h1>
      <div className={`${s.chartBox} `}>
        {isTap && !tap && state === 'ask' ? <span className={s.tapHint}>tap a candle</span> : null}
        <WidgetChart sym={d.sym} bars={all} annotations={annotations} height={440} onBarTap={isTap && state === 'ask' ? ({ index }) => { if (index >= 0) setTap({ index }) } : null} />
      </div>
      {isTap ? (
        <p className={s.hint}>{tap ? `You picked ${all?.[tap.index]?.t || ''}. Check it, or tap another candle.` : 'The chart ran on past the trigger. Find it.'}</p>
      ) : (
        <div className={s.choices}>
          {Q.choices.map((c, i) => {
            let cls = s.choice
            if (state === 'ask' && pick === i) cls += ` ${s.on}`
            if (state !== 'ask' && i === Q.answer) cls += ` ${s.right}`
            if (state === 'bad' && pick === i) cls += ` ${s.wrong}`
            return <button key={c} type="button" className={cls} disabled={state !== 'ask'} onClick={() => setPick(i)}><span className={s.n}>{i + 1}</span>{c}</button>
          })}
        </div>
      )}
      {xp ? <div className={s.xp}>+10 XP</div> : null}
      {state === 'ask' ? (
        <div className={s.foot}><button type="button" className={s.cta} disabled={!ready} onClick={check}>Check</button></div>
      ) : (
        <div className={`${s.sheet} ${s.open} ${state === 'ok' ? s.ok : s.bad}`}>
          <div className={s.sheetIn}>
            <div className={`${s.big} ${state === 'ok' ? s.ok : s.bad}`}><span className={`${s.badge} ${state === 'bad' ? s.bad : ''}`}>{state === 'ok' ? '✓' : '✕'}</span>{state === 'ok' ? 'Right.' : 'Not this time.'}</div>
            <p className={s.lesson}>{Q.why}</p>
            <button type="button" className={s.cta} onClick={() => onDone(state === 'ok')}>{idx + 1 < total ? 'Continue' : 'See your result'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Piece16LoopWidget() {
  const [i, setI] = useState(0)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [best, setBest] = useState(0)
  const [results, setResults] = useState([])
  const [done, setDone] = useState(false)
  const [run, setRun] = useState(0)
  const total = QUESTIONS.length
  const onDone = (ok) => {
    const c = ok ? combo + 1 : 0
    setCombo(c); setBest((b) => Math.max(b, c)); if (ok) setScore((v) => v + 10 + (c > 1 ? 5 : 0))
    setResults((r) => [...r, ok])
    if (i + 1 < total) setI(i + 1); else setDone(true)
  }
  const reset = () => { setI(0); setScore(0); setCombo(0); setBest(0); setResults([]); setDone(false); setRun((r) => r + 1) }
  if (done) {
    const right = results.filter(Boolean).length
    return (
      <div className={s.col}>
        <div className={s.finish}>
          <div className={s.ring2} style={{ '--p': `${(right / total) * 100}%` }}><div><b>{right}</b><small>of {total}</small></div></div>
          <div className={s.rank}>{right === total ? 'Flawless' : right >= 3 ? 'Sharp' : 'Keep going'}</div>
          <div className={s.stats}><div className={s.stat}><div className={s.v}>+{score}</div><div className={s.k}>XP</div></div><div className={s.stat}><div className={s.v}>🔥 {best}</div><div className={s.k}>best run</div></div></div>
        </div>
        <div className={s.foot}><button type="button" className={s.cta} onClick={reset}>Play it again</button></div>
      </div>
    )
  }
  return <Question key={`${run}-${i}`} idx={i} total={total} score={score} combo={combo} onDone={onDone} />
}
