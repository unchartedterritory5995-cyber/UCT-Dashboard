import { useEffect, useMemo, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt, pct } from '../pointers'
import s from '../lab.module.css'

/** Round 2, piece 2: the whole question-to-answer loop, three real questions on three real charts, built to
 *  FEEL like a game: pick, Check, a sheet slides up green or red with a pop and an XP burst, the bar fills,
 *  the combo counts, Continue. Wrong answers shake and show the right one. Ends on a finish card. */
const QUESTIONS = [
  { sample: 'JBI_2023-12-14', setup: 'Kicker', q: 'A real red day, then this. Is the candle the arrow points at a Kicker?',
    choices: ['Yes, that is a Kicker', 'No, it is just a green day', 'No, the red day before it is not weak enough'], answer: 0,
    why: 'The day before closed weak and red. This one opened above that red body and closed near its high. Yesterday\'s sellers are trapped.' },
  { sample: 'HAS_2023-02-02', setup: 'Slingshot', q: 'A drive, a tight pullback, then this close. Does the Slingshot fire on the arrowed candle?',
    choices: ['Yes, it closes back above the 4-day average of the highs', 'No, the pullback was too deep', 'No, the drive never happened'], answer: 0,
    why: 'A drive first, then a tight orderly pullback with closes under the 4-day average of the highs, then the first decisive close back above it. That close is the trigger.' },
  { sample: 'MSTR_2023-10-23', setup: 'Launchpad', q: 'Weeks under the averages, then this candle closes above all of them. Is it the Launchpad?',
    choices: ['Yes, the first close above every average after a long flat base', 'No, it is a breakout from a high base', 'No, the averages are not stacked yet'], answer: 0,
    why: 'Price lived under and through the 9, 20 and 50 for weeks in a flat base. The first candle to close above every one of them, with the averages starting to stack, is the Launchpad.' },
]

function Confetti() {
  const bits = useMemo(() => Array.from({ length: 60 }, (_, i) => ({ l: Math.random() * 100, d: Math.random() * 0.8, c: ['#d9b84a', '#1ae51a', '#ffffff', '#ff6b6b'][i % 4], r: 0.6 + Math.random() })), [])
  return <div className={s.confetti}>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${1.6 + b.r}s` }} />)}</div>
}

function Question({ idx, total, score, combo, onDone }) {
  const Q = QUESTIONS[idx]
  const d = useSample(Q.sample)
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask') // ask | ok | bad
  const [xp, setXp] = useState(false)
  const bars = d?.visible
  const n = bars?.length || 0
  const all = useMemo(() => (bars && d?.forward && state !== 'ask' ? [...bars, ...d.forward] : bars), [bars, d, state])
  const annotations = useMemo(() => {
    if (!n) return null
    const a = arrowAt(bars, n - 1, { label: Q.setup, id: `f${idx}` })
    if (state !== 'ask') a.push(...rayAt(bars[n - 1], 'l', { id: `f${idx}-low`, label: 'the line' }))
    return a
  }, [bars, n, state, Q.setup, idx])
  const check = () => {
    const ok = pick === Q.answer
    setState(ok ? 'ok' : 'bad')
    if (ok) { setXp(true); setTimeout(() => setXp(false), 1100) }
  }
  const fwd = d?.forward
  const after = fwd?.length && bars?.length ? pct(bars[n - 1].c, fwd[fwd.length - 1].c) : null
  return (
    <div className={`${s.col} ${state === 'bad' ? s.shake : ''}`}>
      <div className={s.top}>
        <span>{idx + 1} of {total}</span>
        <span className={s.bar}><i style={{ width: `${((idx + (state === 'ask' ? 0 : 1)) / total) * 100}%` }} /></span>
        <span className={s.combo}>{combo > 1 ? `🔥 ${combo} in a row` : `${score} XP`}</span>
      </div>
      <h1 className={s.h1}>{Q.q}</h1>
      <div className={s.chartBox}><StudyChart bars={all} annotations={annotations} height={340} rightPadBars={4} /></div>
      <div className={s.choices}>
        {Q.choices.map((c, i) => {
          let cls = s.choice
          if (state === 'ask' && pick === i) cls += ' ' + s.on
          if (state !== 'ask' && i === Q.answer) cls += ' ' + s.right
          if (state === 'bad' && pick === i && i !== Q.answer) cls += ' ' + s.wrong
          return <button key={c} type="button" className={cls} onClick={() => state === 'ask' && setPick(i)}><span className={s.n}>{i + 1}</span>{c}</button>
        })}
      </div>
      {state === 'ask' ? <div className={s.foot}><button type="button" className={s.cta} disabled={pick == null} onClick={check}>Check</button></div> : null}
      {xp ? <div className={s.xp}>+10 XP</div> : null}
      {state === 'ok' && combo >= 2 ? <Confetti /> : null}
      <div className={`${s.sheet} ${state !== 'ask' ? s.open : ''} ${state === 'ok' ? s.ok : state === 'bad' ? s.bad : ''}`}>
        <div className={s.sheetIn}>
          <div className={`${s.big} ${state === 'ok' ? s.ok : s.bad}`}><span className={`${s.badge} ${state === 'bad' ? s.bad : ''}`}>{state === 'ok' ? '✓' : '✗'}</span>{state === 'ok' ? 'Nice. That is it.' : `Not quite. It is a ${Q.setup}.`}</div>
          <div className={s.meta}>{d?.sym} · {d?.asof} · {after != null ? `${after >= 0 ? '+' : ''}${after.toFixed(1)}% over the next ${fwd.length} sessions` : ''}</div>
          <p className={s.lesson}>{Q.why}</p>
          <button type="button" className={s.cta} onClick={() => onDone(state === 'ok')}>{idx + 1 < total ? 'Continue' : 'See your result'}</button>
        </div>
      </div>
    </div>
  )
}

export default function Piece7Flow() {
  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState([])
  const [combo, setCombo] = useState(0)
  const [key, setKey] = useState(0)
  const score = results.filter(Boolean).length * 10
  const done = idx >= QUESTIONS.length
  const onDone = (ok) => { setResults((r) => [...r, ok]); setCombo(ok ? combo + 1 : 0); setIdx(idx + 1) }
  useEffect(() => { setCombo(0) }, [key])
  if (done) {
    const right = results.filter(Boolean).length
    return (
      <div className={s.col}>
        {right === QUESTIONS.length ? <Confetti /> : null}
        <div className={s.card}>
          <div className={s.ring2} style={{ '--p': `${(right / QUESTIONS.length) * 100}%` }}><div><b>{right}/{QUESTIONS.length}</b><small>right</small></div></div>
          <h1 className={s.h1} style={{ textAlign: 'center' }}>{right === QUESTIONS.length ? 'Three setups, three reads. Clean.' : right >= 2 ? 'Two of three. One more look.' : 'A rough one. Worth the replay.'}</h1>
          <div className={s.stats}>
            <div className={s.stat}><div className={s.v}>+{score}</div><div className={s.k}>XP</div></div>
            <div className={s.stat}><div className={s.v}>🔥 {Math.max(...results.map((r, i) => results.slice(0, i + 1).reverse().findIndex((x) => !x) === -1 ? i + 1 : results.slice(0, i + 1).reverse().findIndex((x) => !x)), 0)}</div><div className={s.k}>best run</div></div>
          </div>
          <div className={s.chips}>{QUESTIONS.map((q, i) => <span key={q.setup} className={s.chip} style={{ opacity: results[i] ? 1 : 0.45 }}>{results[i] ? '✓' : '✗'} {q.setup}</span>)}</div>
          {results.some((r) => !r) ? (
            <div>{QUESTIONS.map((q, i) => (!results[i] ? <div key={q.setup} className={s.miss}><span className={s.q}>{q.setup}: {q.why}</span><span className={s.fix}>review</span></div> : null))}</div>
          ) : null}
        </div>
        <div className={s.foot}><button type="button" className={s.cta} onClick={() => { setIdx(0); setResults([]); setKey((k) => k + 1) }}>Play it again</button></div>
      </div>
    )
  }
  return <Question key={`${key}-${idx}`} idx={idx} total={QUESTIONS.length} score={score} combo={combo} onDone={onDone} />
}
