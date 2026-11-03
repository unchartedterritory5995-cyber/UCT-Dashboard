import { useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import UIcon from '../../components/ui/UIcon'
import StartCard, { StartButton } from '../StartCard'
import SandboxSignIn from '../SandboxSignIn'
import { Stamp } from '../bits'
import { useSample } from '../Lab'
import { fetchSpotPool, fetchRecallPool, scoreAttempt, SETUP_SKILLS } from '../bank'
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
const NAMES = Object.values(SETUP_SKILLS)

/** Round 11, piece 2: BLITZ V4, A MIX OF QUICK-RECOGNITION QUESTIONS (owner ruling 2026-11-03: "Both, and possibly
 *  a variety of other questions that are quick recognition style ones"). Every chart is an approved item from the
 *  Study bank. Five question kinds, shuffled:
 *   NAME IT      a setup chart: "What fired on the last candle?" four setup names. Keyed on the item's skill (the
 *                bank's chart items are all positive examples; the skill id is already in the payload).
 *   FIRES?       the bank's own Yes/No on a named setup, scored on the server.
 *   CANDLE NAME  the bank's candle item: "which name fits the last N bars?" four names, scored on the server.
 *   CHART WORD   the bank's chart-word item, four words, scored on the server.
 *   GREEN OR RED / OVER YESTERDAY'S HIGH  one-tap facts measured from the bars.
 *  Nothing here invents a market fact: names come from the bank's skill, verdicts from the server or the bars. */
function pick(arr, n, rnd) { const a = [...arr]; const out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out }
function buildQuestions(spots, recalls) {
  let seed = Date.now() % 2147483647 || 1
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 }
  const qs = []
  spots.forEach((it, k) => {
    const n = it.bars.length, b = it.bars[n - 1], p = it.bars[n - 2]
    const r = k % 4
    if (r === 0 || r === 1) {
      const others = pick(NAMES.filter((x) => x !== it.name), 3, rnd)
      const choices = pick([it.name, ...others], 4, rnd)
      qs.push({ kind: 'name', tag: 'Name it', q: 'What setup fired on the last candle?', choices, keys: choices.length, item: it, answer: it.name, server: false })
    } else if (r === 2) {
      qs.push({ kind: 'fires', tag: it.name, q: it.q, choices: it.choices, item: it, server: true })
    } else if (p) {
      const up = b.c > b.o
      const overHigh = b.c > p.h
      qs.push(rnd() < 0.5
        ? { kind: 'fact', tag: 'Quick read', q: 'The last candle: did it close green or red?', choices: ['Green', 'Red'], item: it, answer: up ? 'Green' : 'Red', server: false }
        : { kind: 'fact', tag: 'Quick read', q: "Did the last candle close over yesterday's high?", choices: ['Yes', 'No'], item: it, answer: overHigh ? 'Yes' : 'No', server: false })
    }
  })
  recalls.forEach((it) => qs.push({ kind: 'recall', tag: it.name, q: it.q, choices: it.choices, item: it, server: true, highlight: it.highlight }))
  // shuffle so kinds interleave
  for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]] }
  return qs
}

function Chart({ qn, onAnswer }) {
  const it = qn.item
  const n = it.bars.length
  const ann = useMemo(() => {
    if (!n) return null
    if (qn.kind === 'recall' && qn.highlight > 1) return [{ id: 'hl', type: 'rect', points: [{ time: it.bars[Math.max(0, n - qn.highlight)].t, price: Math.max(...it.bars.slice(-qn.highlight).map((b) => b.h)) * 1.004 }, { time: it.bars[n - 1].t, price: Math.min(...it.bars.slice(-qn.highlight).map((b) => b.l)) * 0.996 }], color: '#dcbb5e', lineWidth: 1.5, locked: true }]
    return spot(it.bars, n - 1, { label: qn.kind === 'fact' && /yesterday/.test(qn.q) ? 'this candle · yesterday is to its left' : 'this candle', id: 'b', halo: false })
  }, [it, n, qn])
  useEffect(() => { const k = (e) => { const i = +e.key - 1; if (i >= 0 && i < qn.choices.length) onAnswer(qn.choices[i]) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) })
  return (
    <>
      <div className={d5.qLine}><span className={d5.qSetup}>{qn.tag}</span><span className={d5.qText}>{qn.q}</span></div>
      <div className={s.chartBox}><WidgetChart sym={it.id} bars={it.bars} annotations={ann} height={400} density="mini" defaultBars={qn.kind === 'recall' ? Math.min(60, n) : 80} hideTicker /></div>
      <div className={`${d5.cards} ${d5.cascade} ${qn.choices.length > 2 ? '' : d5.two}`}>{qn.choices.map((c, i) => <button key={c} type="button" className={d5.card} style={{ '--i': i }} onClick={() => onAnswer(c)}><span className={d5.key}>{i + 1}</span>{c}</button>)}</div>
    </>
  )
}

function Tutorial({ onDone, onSkip }) {
  return (
    <StartCard eyebrow="Blitz · how it works" title="Sixty seconds" lead="Real charts from the firm's bank, a quick question on each. Here is the whole game."
      button={<StartButton icon="play" label="Try one, no clock" sub="one practice chart, then the real thing" onClick={onDone} />}
      below={<button type="button" className={d5.linkBtn} onClick={onSkip}>Skip, I know it</button>}>
      <div className={d5.tutSteps}>
        <div className={d5.tutStep} style={{ '--i': 0 }}><span className={d5.tutNum}>1</span><b>Read the chart</b><span>The question changes: name the setup, does it fire, which candle name fits, green or red, over yesterday's high. The arrow or the box shows where to look.</span></div>
        <div className={d5.tutStep} style={{ '--i': 1 }}><span className={d5.tutNum}>2</span><b>Answer instantly</b><span>Tap a card or press its number. The clock never waits and the next chart loads at once.</span><div className={d5.tutMini}><i className={d5.k}>1</i><i className={d5.k}>2</i><i className={d5.k}>3</i><i className={d5.k}>4</i></div></div>
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
  const ok = pick === 'Kicker'
  const choices = ['Launchpad', 'Kicker', 'Slingshot', 'Oops Reversal']
  const ann = useMemo(() => (!n || !all ? null : pick == null ? spot(all, n - 1, { label: 'this candle', id: 'p' }) : [...spot(all, n - 1, { label: 'the trigger', id: 'p', color: ok ? '#2faf68' : '#df4646' }), ...rayAt(bars[n - 1], 'l', { id: 'pl', label: 'the line' })]), [all, bars, n, pick, ok])
  useEffect(() => { const k = (e) => { if (pick == null && /^[1-4]$/.test(e.key)) setPick(choices[+e.key - 1]) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) })
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><span className={d5.practiceTag}>Practice · no clock</span><div className={d5.prog} /><Logo mood={pick == null ? 'idle' : ok ? 'happy' : 'oops'} size={36} /></div>
      <div className={d5.ask}><Logo mood={pick == null ? 'think' : ok ? 'happy' : 'oops'} size={60} /><div className={d5.bubble}>{pick == null ? 'What setup fired on the last candle? Tap a card or press 1 to 4.' : ok ? 'Kicker. In the real Blitz the next chart is already loading.' : 'It was the Kicker: a real red day, then an open above its body and a strong close.'}</div></div>
      <div className={d5.qLine}><span className={d5.qSetup}>Name it</span><span className={d5.qText}>What setup fired on the last candle?</span></div>
      <div className={s.chartBox}>{pick != null ? <Stamp ok={ok} /> : null}<WidgetChart sym={d.sym} bars={all} annotations={ann} height={400} density="mini" defaultBars={80} /></div>
      <div className={`${d5.cards} ${d5.cascade}`}>{choices.map((c, i) => { let cls = d5.card; if (pick != null && c === 'Kicker') cls += ` ${d5.right}`; if (pick != null && pick === c && !ok) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} style={{ '--i': i }} disabled={pick != null} onClick={() => { setPick(c); sfx(c === 'Kicker' ? 'right' : 'wrong') }}><span className={d5.key}>{i + 1}</span>{c}</button> })}</div>
      {pick != null ? <div className={d5.centerRow}><StartButton icon="timer" label="Start the clock" sub="60 seconds · no hearts" onClick={onDone} /></div> : null}
    </div>
  )
}

export default function Piece53BlitzV3() {
  const [phase, setPhase] = useState(seen() ? 'start' : 'tutorial')
  const [pool, setPool] = useState(null)
  const [signedOut, setSignedOut] = useState(false)
  const [reload, setReload] = useState(0)
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
  useEffect(() => {
    let on = true
    Promise.all([fetchSpotPool(), fetchRecallPool()]).then(([sp, rc]) => on && setPool(buildQuestions(sp, rc))).catch((e) => { if (!on) return; if (e?.name === 'SignedOut') setSignedOut(true); setPool([]) })
    return () => { on = false }
  }, [reload])
  useEffect(() => {
    if (phase !== 'play') return undefined
    const t = setInterval(() => setLeft((v) => { if (v <= 1) { clearInterval(t); setPhase('done'); sfx('levelup'); return 0 } return v - 1 }), 1000)
    return () => clearInterval(t)
  }, [phase])
  useEffect(() => { shownAt.current = performance.now() }, [i])
  const qn = pool && pool.length ? pool[i % pool.length] : null
  const answer = async (choice) => {
    if (!qn || phase !== 'play') return
    const ms = performance.now() - shownAt.current
    setI((v) => v + 1); setAnswered((v) => v + 1)
    let ok = false, reveal = null
    if (qn.server) { try { const a = await scoreAttempt(qn.item, choice, ms); ok = !!a.correct; reveal = a.reveal } catch { ok = false } }
    else ok = choice === qn.answer
    if (ok) { const c = combo + 1; setCombo(c); setBest((b) => Math.max(b, c)); setRight((v) => v + 1); setScore((v) => v + XP.RIGHT * mult(c)); sfx(c >= 3 && c % 3 === 0 ? 'combo' : 'right') } else { setCombo(0); sfx('wrong') }
    setFlash(ok ? 'ok' : 'bad'); setTimeout(() => setFlash(null), 220)
    setLog((l) => [...l, { tag: qn.tag, q: qn.q, choice, ok, answer: qn.server ? (reveal?.answer?.answer ?? reveal?.answer ?? '') : qn.answer, ticker: reveal?.ticker || reveal?.symbol || '' }])
  }
  const start = () => { markSeen(); setPhase('play'); setLeft(SECS); setI(0); setScore(0); setCombo(0); setBest(0); setAnswered(0); setRight(0); setLog([]) }
  const kinds = useMemo(() => { if (!pool) return null; const c = {}; pool.forEach((q) => { c[q.kind] = (c[q.kind] || 0) + 1 }); return c }, [pool])
  const bankLine = pool == null ? 'loading the bank' : `${pool.length} questions in today's pool`
  if (signedOut) return <div className={d5.lesson}><SandboxSignIn onDone={() => { setPool(null); setSignedOut(false); setReload((r) => r + 1) }} /></div>
  if (phase === 'tutorial') return <div className={d5.lesson}><Tutorial onDone={() => setPhase('practice')} onSkip={() => { markSeen(); setPhase('start') }} /></div>
  if (phase === 'practice') return <Practice onDone={start} />
  if (phase === 'start') {
    return (
      <div className={d5.lesson}>
        <StartCard eyebrow="Challenge" title="Blitz" art={<Logo mood="fire" size={116} />}
          lead="Sixty seconds. No hearts. Real charts from the firm's bank and a quick question on each: name the setup, does it fire, which candle name fits, green or red, over yesterday's high. The multiplier climbs with your combo and resets on a miss."
          button={<StartButton icon="timer" label="Start the clock" sub={`60 seconds · no hearts · ${bankLine}`} onClick={start} />}
          below={<><button type="button" className={d5.linkBtn} onClick={() => setPhase('tutorial')}>How it works</button>{kinds ? <span>{Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(' · ')}</span> : null}</>}>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>Your best</small><b>310</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="bolt" size={20} /></span><small>Multiplier up to</small><b>x5</b></div></div></div>
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
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>Right</small><b>{right}/{answered}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="bolt" size={20} /></span><small>Best combo</small><b>{best}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="sparkle" size={20} /></span><small>Top multiplier</small><b>x{mult(best)}</b></div></div></div>
          {log.length ? <div className={d5.runLog}>{log.map((r, k) => <div key={k} className={r.ok ? d5.runOk : d5.runBad}><b>{r.ok ? '✓' : '✕'}</b><span>{r.tag} · {r.q}</span><small>{r.ok ? `you said ${r.choice}` : `you said ${r.choice}${r.answer ? `, it was ${r.answer}` : ''}`}{r.ticker ? ` · ${r.ticker}` : ''}</small></div>)}</div> : null}
        </StartCard>
      </div>
    )
  }
  if (!qn) return <div className={d5.lesson}><div className={d5.topbar}><span className={d5.clock}>⏱ {left}</span></div><p className={s.hint}>{pool == null ? 'Loading the bank' : 'The bank returned no chart items.'}</p></div>
  return (
    <div className={`${d5.lesson} ${flash === 'ok' ? d5.flashOk : flash === 'bad' ? d5.flashBad : ''}`}>
      <div className={d5.topbar}><span className={`${d5.clock} ${left <= 10 ? d5.hot : ''}`} style={{ textAlign: 'left', fontSize: 22 }}>⏱ {left}</span><div className={d5.blitzMid}><b>{score}</b><small>points</small></div><span className={`${d5.multi} ${mult(combo) >= 3 ? d5.hotM : ''}`}>x{mult(combo)}{combo ? ` · ${combo} in a row` : ''}</span></div>
      <Chart key={qn.item.id + i} qn={qn} onAnswer={answer} />
    </div>
  )
}
