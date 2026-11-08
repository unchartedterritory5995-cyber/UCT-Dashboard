// BLITZ (ported from the workbench's Blitz V4 under the owner's delegation, 2026-11-03). Sixty seconds, no hearts.
// Real charts from the Study bank and a quick question on each: name the setup, does it fire, which candle name
// fits, green or red, over yesterday's high. The multiplier climbs with the combo and resets on a miss. Server
// kinds are scored by POST /api/study/attempts (and count toward the member's XP like any attempt); the two
// quick-read facts are measured from the bars on screen. The best score lives on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import StudyMark from '../../../components/study/StudyMark'
import StartCard, { StartButton } from '../../../lab/StartCard'
import { calloutLook, hardCallouts } from '../ui/callout'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import Tile from '../ui/Tile'
import StudyButton from '../ui/StudyButton'
import d5 from '../../../lab/duo.module.css'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { BLITZ_BEST_KEY, BLITZ_POINTS, BLITZ_SECS, blitzMult, buildBlitzQuestions, fetchRecallPool, fetchSpotPool, scoreAttempt } from './challengeBank'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'

const readBest = () => { try { return Number(localStorage.getItem(BLITZ_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(BLITZ_BEST_KEY, String(v)) } catch { /* no storage */ } }

function Question({ qn, onAnswer, fetcher }) {
  const it = qn.item
  const n = it.bars.length
  const ann = useMemo(() => {
    if (!n) return null
    if (qn.kind === 'recall' && qn.highlight > 1) return [{ id: 'hl', type: 'rect', points: [{ time: it.bars[Math.max(0, n - qn.highlight)].t, price: Math.max(...it.bars.slice(-qn.highlight).map((b) => b.h)) * 1.004 }, { time: it.bars[n - 1].t, price: Math.min(...it.bars.slice(-qn.highlight).map((b) => b.l)) * 0.996 }], color: '#dcbb5e', lineWidth: 1.5, locked: true }]
    return null   // the pointer is the callout below (Hard mode's: open space, never over a candle)
  }, [it, n, qn])
  const phone = useIsPhone()
  // the owner's rule 4: one designed pointer everywhere (Hard mode's callout); a recall question keeps its highlight box
  const callouts = useMemo(() => (!n || (qn.kind === 'recall' && qn.highlight > 1) ? [] : hardCallouts({ index: n - 1, label: qn.kind === 'fact' && /yesterday/.test(qn.q) ? 'This candle · yesterday is to its left' : 'This candle' })), [n, qn])
  const look = useMemo(() => calloutLook(phone), [phone])
  useEffect(() => {
    const k = (e) => { if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; const i = +e.key - 1; if (i >= 0 && i < qn.choices.length) onAnswer(qn.choices[i]) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [qn, onAnswer])
  return (
    <>
      <div className={d5.qLine}><span className={d5.qSetup}>{qn.tag}</span><span className={d5.qText}>{qn.q}</span></div>
      <ChallengeChart id={it.id} bars={it.bars} view={qn.kind === 'recall' ? Math.min(60, n) : Math.min(80, n)} height={phone ? 300 : 340} annotations={ann} callouts={callouts} calloutLook={look} fetcher={fetcher} />
      <div className={`${d5.cards} ${d5.cascade} ${qn.choices.length > 2 ? '' : d5.two}`} data-testid="blitz-choices">
        {qn.choices.map((c, i) => <Tile key={c} n={i + 1} i={i} label={c} onClick={() => onAnswer(c)} />)}
      </div>
    </>
  )
}

export default function BlitzChallenge({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')     // start | play | done
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [left, setLeft] = useState(BLITZ_SECS)
  const [i, setI] = useState(0)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [best, setBest] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [right, setRight] = useState(0)
  const [flash, setFlash] = useState(null)
  const [log, setLog] = useState([])
  const [bestEver, setBestEver] = useState(readBest)
  const shownAt = useRef(0)

  useEffect(() => {
    let on = true
    Promise.all([fetchSpotPool(undefined, 6, fetcher), fetchRecallPool(undefined, 12, fetcher)])
      .then(([sp, rc]) => { if (on) setPool(buildBlitzQuestions(sp, rc)) })
      .catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])

  const scoreRef = useRef(0)
  useEffect(() => { scoreRef.current = score }, [score])
  useEffect(() => {
    if (phase !== 'play') return undefined
    const t = setInterval(() => setLeft((v) => {
      if (v > 1) return v - 1
      clearInterval(t)
      // time: the clock's own tick finishes the run (never an effect on `phase`, which would set state in an effect)
      setPhase('done'); endFeedback(prefs)
      setBestEver((b) => { const nb = Math.max(b, scoreRef.current); if (nb !== b) writeBest(nb); return nb })
      return 0
    }), 1000)
    return () => clearInterval(t)
  }, [phase, prefs])
  useEffect(() => { shownAt.current = performance.now() }, [i])

  const qn = pool && pool.length ? pool[i % pool.length] : null
  const answer = useCallback(async (choice) => {
    if (!qn || phase !== 'play') return
    const ms = performance.now() - shownAt.current
    setI((v) => v + 1); setAnswered((v) => v + 1)
    let ok = false, reveal = null
    if (qn.server) { try { const a = await scoreAttempt(qn.item, { choice }, ms, fetcher); ok = !!a.correct; reveal = a.reveal } catch { ok = false } }
    else ok = choice === qn.answer
    if (ok) {
      const c = combo + 1
      setCombo(c); setBest((b) => Math.max(b, c)); setRight((v) => v + 1); setScore((v) => v + BLITZ_POINTS * blitzMult(c))
      revealFeedback(true, prefs); comboFeedback(c, prefs)
    } else { setCombo(0); revealFeedback(false, prefs) }
    setFlash(ok ? 'ok' : 'bad'); setTimeout(() => setFlash(null), 220)
    const key = qn.server ? (reveal?.answer?.answer ?? reveal?.answer ?? '') : qn.answer
    setLog((l) => [...l, { tag: qn.tag, q: qn.q, choice, ok, answer: typeof key === 'string' ? key : '', ticker: reveal?.sym || reveal?.ticker || '' }])
  }, [qn, phase, combo, prefs, fetcher])

  const start = () => { setPhase('play'); setLeft(BLITZ_SECS); setI(0); setScore(0); setCombo(0); setBest(0); setAnswered(0); setRight(0); setLog([]) }
  const kinds = useMemo(() => { if (!pool) return null; const c = {}; pool.forEach((q) => { c[q.kind] = (c[q.kind] || 0) + 1 }); return c }, [pool])
  const bankLine = pool == null ? 'loading the bank' : pool.length ? `${pool.length} questions in today's pool` : 'no charts in the bank yet'

  if (error) return <ChallengeError what="the Blitz pool" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />

  if (phase === 'start') {
    return (
      <StartCard eyebrow="Challenge" title="Blitz" art={<StudyMark mood="fire" size={116} />}
        lead="Sixty seconds. No hearts. Real charts from the UCT bank and a quick question on each: name the setup, does it fire, which candle name fits, green or red, over yesterday's high. The multiplier climbs with your combo and resets on a miss."
        button={<StartButton icon="timer" label={pool?.length ? 'Start the clock' : pool == null ? 'Loading the bank' : 'Nothing to play yet'} sub={`60 seconds · no hearts · ${bankLine}`} disabled={!pool?.length} onClick={() => pool?.length && start()} />}
        below={<>
          <details className={d5.whyCard}><summary>How it works</summary>
            <div className={d5.tutSteps}>
              <div className={d5.tutStep} style={{ '--i': 0 }}><span className={d5.tutNum}>1</span><b>Read the chart</b><span>The question changes: name the setup, does it fire, which candle name fits, green or red, over yesterday's high. The arrow or the box shows where to look.</span></div>
              <div className={d5.tutStep} style={{ '--i': 1 }}><span className={d5.tutNum}>2</span><b>Answer instantly</b><span>Tap a card or press its number. The clock never waits and the next chart loads at once.</span></div>
              <div className={d5.tutStep} style={{ '--i': 2 }}><span className={d5.tutNum}>3</span><b>Build the multiplier</b><span>Every right answer in a row climbs it. One miss resets it to x1.</span><div className={d5.multRow}><i>x2</i><i>x3</i><i>x4</i><i>x5</i></div></div>
            </div>
          </details>
          {kinds ? <span>{Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(' · ')}</span> : null}
        </>}>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>Your best</small><b data-testid="blitz-best">{bestEver}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="bolt" size={20} /></span><small>Multiplier up to</small><b>x5</b></div></div></div>
      </StartCard>
    )
  }
  if (phase === 'done') {
    return (
      <StartCard eyebrow="Blitz · time" title={`${score} points`} art={<StudyMark mood={score >= 200 ? 'fire' : 'happy'} size={116} />}
        lead={score > 0 && score >= bestEver ? 'A new best.' : `Your best stands at ${bestEver}.`}
        button={<StartButton icon="timer" label="Again" sub="another sixty seconds" onClick={() => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('start') }} />}
        below={<StudyButton kind="ghost" onClick={onClose}>Back to Study</StudyButton>}>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>Right</small><b data-testid="blitz-right">{right}/{answered}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="bolt" size={20} /></span><small>Best combo</small><b>{best}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="sparkle" size={20} /></span><small>Top multiplier</small><b>x{blitzMult(best)}</b></div></div></div>
        {log.length ? <div className={d5.runLog}>{log.map((r, k) => <div key={k} className={r.ok ? d5.runOk : d5.runBad}><b>{r.ok ? '✓' : '✕'}</b><span>{r.tag} · {r.q}</span><small>{r.ok ? `you said ${r.choice}` : `you said ${r.choice}${r.answer ? `, it was ${r.answer}` : ''}`}{r.ticker ? ` · ${r.ticker}` : ''}</small></div>)}</div> : null}
      </StartCard>
    )
  }
  if (!qn) return <p className={d5.startLead}>{pool == null ? 'Loading the bank' : 'No charts in the bank yet.'}</p>
  return (
    <div className={flash === 'ok' ? d5.flashOk : flash === 'bad' ? d5.flashBad : ''} data-testid="blitz-play">
      <div className={d5.topbar}><span className={`${d5.clock} ${left <= 10 ? d5.hot : ''}`} style={{ textAlign: 'left', fontSize: 22 }} data-testid="blitz-clock">{left}s</span><div className={d5.blitzMid}><b data-testid="blitz-score">{score}</b><small>points</small></div><span className={`${d5.multi} ${blitzMult(combo) >= 3 ? d5.hotM : ''}`}>x{blitzMult(combo)}{combo ? ` · ${combo} in a row` : ''}</span></div>
      <Question key={qn.item.id + i} qn={qn} onAnswer={answer} fetcher={fetcher} />
    </div>
  )
}
