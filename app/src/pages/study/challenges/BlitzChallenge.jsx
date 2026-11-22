// BLITZ (ported from the workbench's Blitz V4 under the owner's delegation, 2026-11-03). Sixty seconds, no hearts.
// Real charts from the Study bank and a quick question on each: name the setup, does it fire, which candle name
// fits, green or red, over yesterday's high. The multiplier climbs with the combo and resets on a miss. Server
// kinds are scored by POST /api/study/attempts (and count toward the member's XP like any attempt); the two
// quick-read facts are measured from the bars on screen. The best score lives on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { calloutLook, hardCallouts } from '../ui/callout'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudClock } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import s2 from '../ui/study.module.css'
import lab from '../../../lab/lab.module.css'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { BLITZ_BEST_KEY, BLITZ_POINTS, BLITZ_SECS, blitzMult, beginRunXp, buildBlitzQuestions, fetchNamedPool, fetchRecallPool, fetchSpotPool, runXp, scoreAttempt } from './challengeBank'
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
  // Hard mode's design (the owner, 2026-11-08: "Need all the design templates and graphics to be uniform throughout each
  // section!"): the chart as the hero, the question header, the answer tiles; Blitz answers on the tap, so no Check bar
  return (
    <>
      <div className={`${lab.chartBox} ${s2.heroChart}`}>
        <ChallengeChart id={it.id} bars={it.bars} view={qn.kind === 'recall' ? Math.min(60, n) : Math.min(80, n)} height={phone ? 320 : 420} annotations={ann} callouts={callouts} calloutLook={look} fetcher={fetcher} />
      </div>
      <AnswerLessonApp instant choices={qn.choices} onPick={(i) => onAnswer(qn.choices[i])} eyebrow={<>Blitz · {qn.tag}</>} question={qn.q} detail={null} cardsTestId="blitz-choices" />
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
    // a deeper pool (the owner, batch 10: "We will need hundreds if not thousands of examples"): every run draws fresh
    // charts from the bank; "name it" comes only from charts the detectors verified (fetchNamedPool)
    Promise.all([fetchSpotPool(undefined, 8, fetcher), fetchRecallPool(undefined, 16, fetcher), fetchNamedPool(20, fetcher).catch(() => [])])
      .then(([sp, rc, nm]) => { if (on) setPool(buildBlitzQuestions(sp, rc, Date.now(), nm)) })
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

  const start = () => { beginRunXp(); setPhase('play'); setLeft(BLITZ_SECS); setI(0); setScore(0); setCombo(0); setBest(0); setAnswered(0); setRight(0); setLog([]) }
  const kinds = useMemo(() => { if (!pool) return null; const c = {}; pool.forEach((q) => { c[q.kind] = (c[q.kind] || 0) + 1 }); return c }, [pool])
  const bankLine = pool == null ? 'loading the bank' : pool.length ? `${pool.length} questions in today's pool` : 'no charts in the bank yet'

  if (error) return <ChallengeError what="the Blitz pool" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />

  if (phase === 'start') {
    return (
      <div className={s2.kit}>
        <StartArena plate="Blitz" title="Blitz" caption="Read the chart, answer, next" testId="blitz-intro" startTestId="blitz-start" hotkey
          stakes={[{ v: 60, l: 'seconds', icon: 'clock' }, { v: 0, l: 'hearts', icon: 'x' }, { v: 'x5', l: 'top multiplier', icon: 'bolt' }]} ready={!!pool?.length} onStart={() => pool?.length && start()}
          label={pool?.length ? 'Start the clock' : pool == null ? 'Loading the bank' : 'Nothing to play yet'}
          reward={<><UIcon name="star" size={22} /><span>Your best <b data-testid="blitz-best">{bestEver}</b> points</span></>}
          howTo={<HowItPlays mode="blitz" testId="blitz-howto" steps={[
            { icon: 'eye', title: 'Read the chart', body: 'Each question is a real chart and a quick question: name the setup, does it fire, which candle name fits, green or red.' },
            { icon: 'play', title: 'Answer at once', body: 'Tap an answer or press its number. The next chart comes straight away; the clock never waits.' },
            { icon: 'bolt', title: 'Build the multiplier', body: 'Every right answer in a row climbs it, up to x5. A miss resets it to x1.' },
          ]} />}>
          <span>{bankLine}{kinds ? ` · ${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(' · ')}` : ''}</span>
        </StartArena>
      </div>
    )
  }
  if (phase === 'done') {
    const rows = log.map((r) => ({ name: r.tag, ticker: r.ticker, ok: r.ok, said: r.choice, was: r.answer }))
    return (
      <div className={s2.kit}>
        <EndHard right={right} total={answered} xp={score} xpLabel="points" results={log.map((r) => r.ok)} log={rows} level={runXp()}
          unit="right in sixty seconds" doneWord="right" medal={false} showSetups={false} againLabel="Again" testIdPrefix="blitz"
          onAgain={() => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('start') }} onBack={onClose}>
          {score > 0 && score >= bestEver ? <><b>A new best.</b> Top multiplier x{blitzMult(best)}.</> : <>Your best stands at <b>{bestEver}</b>. Top multiplier this run x{blitzMult(best)}.</>}
        </EndHard>
      </div>
    )
  }
  if (!qn) return <p className={s2.kit}>{pool == null ? 'Loading the bank' : 'No charts in the bank yet.'}</p>
  return (
    <div className={`${s2.kit} ${s2.screen}`} data-testid="blitz-play">
      {flash ? <span className={`${s2.flash} ${flash === 'ok' ? s2.ok : s2.bad}`} aria-hidden="true" /> : null}
      <HudClock left={left} secs={BLITZ_SECS} score={score} combo={combo} mult={blitzMult(combo)} />
      <Question key={qn.item.id + i} qn={qn} onAnswer={answer} fetcher={fetcher} />
    </div>
  )
}
