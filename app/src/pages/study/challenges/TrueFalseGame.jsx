// TRUE OR FALSE (docs/study/GAMES.md §3, kind 'tf'; built on the contract in §1). Forty-five seconds of approved
// true/false statements from every course (POST /api/study/game-pool {kind: 'tf'}). The statement is the hero, where a
// chart sits in the chart games; two big tiles answer it, True and False, by tap or by key (T or F, 1 or 2). Every call
// is scored on the server (POST /api/study/attempts), which also grants the XP, so this game never posts a game run. A
// right call flashes and the next statement comes at once, the multiplier climbing as in Blitz (HudClock). A miss takes
// over the screen (rule 15): the verdict, the reason in the bank's own words and the source it comes from; it moves on
// by itself after takeoverMs (2.5 s, longer for a longer reason) or on a tap (a stray second tap in its first TF_TAKEOVER_GUARD_MS never skips it). The
// clock waits while a miss shows and while an answer is on the wire, so the member is timed on their thinking only. The
// end screen (EndHard) lists every statement with the answer, the member's call, the lesson line and the source, and its
// level bar shows the XP the attempts earned. A pool under TF_MIN statements says so honestly; a pool that fails offers a
// retry and a way back; an answer the server does not score (no reply in time, a refusal, a reply with no verdict) is not
// counted and the run goes on (TF_MAX_FAILS in a row stop it). Every number is games/trueFalse.js's or the server's. The
// best score lives on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudClock } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import VerdictTakeover from '../ui/VerdictTakeover'
import StudyButton from '../ui/StudyButton'
import { Confetti } from '../ui/Stage'
import s2 from '../ui/study.module.css'
import g from './TrueFalseGame.module.css'
import ChallengeError, { isSignedOut } from './ChallengeError'
import { beginRunXp, runXp, scoreAttempt } from './challengeBank'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import {
  EMPTY_RUN, TF_ATTEMPT_TIMEOUT_MS, TF_BEST_KEY, TF_CHOICES, TF_KIND, TF_MAX_FAILS, TF_MIN, TF_POOL_SIZE, TF_POOL_TIMEOUT_MS,
  TF_POOL_URL, TF_SECS, TF_TAKEOVER_GUARD_MS, TF_TICK_MS, applyCall, applyLost, deckOf, keyChoice, leanLine, rowOf,
  secsOf, statementsOf, takeoverMs, tfMult, tfVerdict, tickClock, verdictOf, verdictTitle,
} from './games/trueFalse'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: 'tf', title: 'True or False', sub: 'Forty-five seconds of statements from every course. Call each one true or false.', icon: 'check', plate: 'True/False', accent: 'green', group: 'skill' }

const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
// a call the server never scored (no answer in time, a refusal, a reply with no verdict): said plainly, never guessed at
const LOST_LINE = 'We could not check that one, so it does not count. Here is the next.'
const readBest = () => { try { return Number(localStorage.getItem(TF_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(TF_BEST_KEY, String(v)) } catch { /* no storage */ } }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** The hero in place of a chart: the statement, in big type, on a plate that counts the run. */
function StatementCard({ statement, n, checking }) {
  return (
    <figure className={g.card} data-testid="tf-card" aria-busy={checking || undefined}>
      <span className={g.plate}>Statement {n}</span>
      <span className={g.mark} aria-hidden="true"><UIcon name="quote" size={30} gold={false} /></span>
      <p className={g.statement} data-testid="tf-statement">{statement.q}</p>
      {checking ? <figcaption className={g.checking} aria-hidden="true">Checking</figcaption> : null}
    </figure>
  )
}

/** One call on the end screen, under its statement: the answer, the member's call, the lesson line and the source. */
function Review({ row }) {
  const src = row.source
  return (
    <span className={g.review}>
      <span className={g.calls}>
        <span className={`${g.call} ${g.truth}`}>Answer <b>{row.truth}</b></span>
        <span className={`${g.call} ${row.ok ? g.mine : g.wrong}`}>You said <b>{row.said}</b></span>
      </span>
      {row.line ? <span className={g.line} data-testid="tf-line">{row.line}</span> : null}
      {src ? (
        <span className={g.src}>
          <UIcon name="book" size={13} gold={false} />
          {src.url
            ? <a href={src.url} target="_blank" rel="noopener noreferrer" title={src.full}>{src.name}</a>
            : <span title={src.full}>{src.name}</span>}
        </span>
      ) : null}
    </span>
  )
}

export default function TrueFalseGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const phone = useIsPhone()
  const [phase, setPhase] = useState('start')      // start | play | done
  const [pool, setPool] = useState(null)            // the usable statements; null while the draw loads
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [run, setRun] = useState(EMPTY_RUN)
  const [left, setLeft] = useState(TF_SECS)
  const [busy, setBusy] = useState(null)            // the call on the wire ('True' | 'False'); the clock waits
  const [miss, setMiss] = useState(null)            // the missed call's row while its takeover holds the screen
  const [note, setNote] = useState(null)            // a call that never reached the server
  const [flash, setFlash] = useState(null)
  const [stop, setStop] = useState(null)            // why a run ended before the clock: deck | offline | signedOut
  const [bestEver, setBestEver] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0)
  const runRef = useRef(EMPTY_RUN)
  const msRef = useRef(TF_SECS * 1000)
  const pausedRef = useRef(true)
  const busyRef = useRef(false)
  const missRef = useRef(null)
  const missAt = useRef(0)                          // when the takeover came up (a tap too soon after is a stray second tap)
  const shownAt = useRef(0)
  const flashT = useRef(null)
  const timers = useRef(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    if (!timers.current) timers.current = new Set()
    const pending = timers.current
    return () => {
      live.current = false
      clearTimeout(flashT.current)
      pending.forEach((t) => clearTimeout(t))
      pending.clear()
    }
  }, [])

  // the draw: a fresh one each time the start screen opens; a draw that never answers fails honestly, never spins
  useEffect(() => {
    let on = true
    const t = setTimeout(() => {
      if (!on) return
      on = false
      const e = new Error('The statements took too long to load.')
      setError(e); setPool([])
    }, TF_POOL_TIMEOUT_MS)
    Promise.resolve()
      .then(() => fetcher(TF_POOL_URL, { method: 'POST', body: { kind: TF_KIND, size: TF_POOL_SIZE } }))
      .then((res) => { if (!on) return; on = false; clearTimeout(t); setPool(statementsOf(res?.items)) })
      .catch((e) => { if (!on) return; on = false; clearTimeout(t); setError(e || new Error('The statements did not load.')); setPool([]) })
    return () => { on = false; clearTimeout(t) }
  }, [reload, fetcher])

  /** A promise that gives up after `ms`, its timer cleared on unmount. */
  const within = useCallback((p, ms) => new Promise((resolve, reject) => {
    const set = timers.current || (timers.current = new Set())
    const t = setTimeout(() => { set.delete(t); const e = new Error('The answer took too long to check.'); e.timeout = true; reject(e) }, ms)
    set.add(t)
    Promise.resolve(p).then((v) => { clearTimeout(t); set.delete(t); resolve(v) }, (e) => { clearTimeout(t); set.delete(t); reject(e) })
  }), [])

  const flashNow = useCallback((ok) => {
    clearTimeout(flashT.current)
    setFlash(ok ? 'ok' : 'bad')
    flashT.current = setTimeout(() => setFlash(null), 220)
  }, [])

  // the end of a run: once, from the clock's last tick, the last statement of the draw, or a server that stopped answering
  const finish = useCallback((reason) => {
    const r = runRef.current
    if (r.done) return
    runRef.current = { ...r, done: true }
    pausedRef.current = true; busyRef.current = false; missRef.current = null
    setRun(runRef.current); setBusy(null); setMiss(null); setNote(null); setStop(reason || null); setPhase('done')
    endFeedback(prefs)
    const prev = readBest()
    if (r.score > prev) writeBest(r.score)
    setBestEver(Math.max(prev, r.score))
  }, [prefs])
  const finishRef = useRef(finish)
  useEffect(() => { finishRef.current = finish }, [finish])

  // the clock: a short step that only counts while a statement waits for the member
  useEffect(() => {
    if (phase !== 'play') return undefined
    const t = setInterval(() => {
      const next = tickClock(msRef.current, pausedRef.current)
      if (next === msRef.current) return
      msRef.current = next
      setLeft(secsOf(next))
      if (next === 0) { clearInterval(t); finishRef.current(null) }
    }, TF_TICK_MS)
    return () => clearInterval(t)
  }, [phase])

  const advance = useCallback(() => {
    const r = runRef.current
    if (r.done) return
    if (r.i + 1 >= r.deck.length) { finishRef.current('deck'); return }
    runRef.current = { ...r, i: r.i + 1 }
    setRun(runRef.current)
    pausedRef.current = false
    shownAt.current = Date.now()
  }, [])

  const answer = useCallback(async (choice) => {
    const r = runRef.current
    const st = r.deck[r.i]
    if (phase !== 'play' || r.done || !st || busyRef.current || missRef.current) return
    busyRef.current = true; pausedRef.current = true
    setBusy(choice); setNote(null)
    let a = null
    let err = null
    try {
      a = await within(scoreAttempt({ id: st.id }, { choice }, Date.now() - shownAt.current, fetcher), TF_ATTEMPT_TIMEOUT_MS)
      // a reply with no verdict is not a score: read as a miss, it would show the opposite of the answer as the answer
      if (verdictOf(a) == null) throw new Error('The answer came back without a verdict.')
    } catch (e) { err = e || new Error('The answer was not checked.') }
    // a late answer lands only on its own run, never on a run started after it or after the sheet closed
    if (!live.current || runRef.current.token !== r.token || runRef.current.done) return
    busyRef.current = false
    setBusy(null)
    if (err) {
      if (isSignedOut(err)) { finishRef.current('signedOut'); return }
      runRef.current = applyLost(runRef.current)
      setRun(runRef.current)
      if (runRef.current.fails >= TF_MAX_FAILS) { finishRef.current('offline'); return }
      setNote(LOST_LINE)
      advance()
      return
    }
    const row = rowOf({ statement: st, said: choice, correct: verdictOf(a), reveal: a.reveal || null })
    runRef.current = applyCall(runRef.current, row)
    setRun(runRef.current)
    revealFeedback(row.ok, prefs)
    flashNow(row.ok)
    if (row.ok) { comboFeedback(runRef.current.combo, prefs); advance() } else { missRef.current = row; missAt.current = Date.now(); setMiss(row) }   // the clock stays paused
  }, [phase, fetcher, prefs, within, flashNow, advance])

  // the takeover moves on by a tap, by Enter (its button's own key) or by itself; whichever comes first, once
  const moveOn = useCallback(() => {
    if (!missRef.current) return
    missRef.current = null
    setMiss(null)
    advance()
  }, [advance])
  // a tap or Enter in the first moments is a second tap meant for the next statement: it never skips the lesson
  const tapOn = useCallback(() => { if (Date.now() - missAt.current >= TF_TAKEOVER_GUARD_MS) moveOn() }, [moveOn])
  useEffect(() => {
    if (!miss) return undefined
    const t = setTimeout(moveOn, takeoverMs(miss.reason))
    return () => clearTimeout(t)
  }, [miss, moveOn])

  // T or 1 calls True, F or 2 calls False, while a statement waits for the member
  useEffect(() => {
    if (phase !== 'play' || miss || busy) return undefined
    const k = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const c = keyChoice(e.key)
      if (!c) return
      e.preventDefault()
      answer(c)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [phase, miss, busy, answer])

  const ready = !!pool && pool.length >= TF_MIN
  const start = useCallback(() => {
    if (!pool || pool.length < TF_MIN) return
    const fresh = { ...EMPTY_RUN, token: runRef.current.token + 1, deck: deckOf(pool, Date.now()) }
    runRef.current = fresh; msRef.current = TF_SECS * 1000; pausedRef.current = false; busyRef.current = false; missRef.current = null
    shownAt.current = Date.now()
    beginRunXp()
    setRun(fresh); setLeft(TF_SECS); setBusy(null); setMiss(null); setNote(null); setStop(null); setFlash(null)
    setBestBefore(readBest()); setPhase('play')
  }, [pool])
  const again = () => { setPool(null); setError(null); setReload((n) => n + 1); setPhase('start') }
  const back = onClose ? <StudyButton kind="ghost" onClick={onClose} testId="tf-back">Back to Study</StudyButton> : null

  if (error) {
    return (
      <div className={`${s2.kit} ${g.failed}`} data-testid="tf-failed">
        <ChallengeError what="the True or False statements" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((n) => n + 1) }} />
        {back}
      </div>
    )
  }

  if (phase === 'start') {
    const empty = !!pool && pool.length < TF_MIN
    return (
      <div className={s2.kit}>
        <StartArena plate={GAME.plate} title={GAME.title} caption="True or false?" testId={empty ? 'tf-empty' : 'tf-intro'} startTestId="tf-start" hotkey
          stakes={[{ v: TF_SECS, l: 'seconds', icon: 'clock' }, { v: 'All', l: 'courses', icon: 'book' }, { v: 'x5', l: 'top multiplier', icon: 'bolt' }]}
          ready={ready} onStart={start}
          label={ready ? 'Start the clock' : pool == null ? 'Loading the statements' : 'No statements yet'}
          lead={empty ? <span data-testid="tf-empty-line">{EMPTY_LINE}</span> : <>Statements from our courses, each one checked against its source. Call it before the clock runs out.</>}
          reward={empty ? null : <><UIcon name="star" size={22} /><span>Your best <b data-testid="tf-best">{bestEver}</b> points</span></>}
          howTo={empty ? null : <HowItPlays mode="tf" testId="tf-howto" steps={[
            { icon: 'quote', title: 'Read the statement', body: 'Each one comes from a course unit and the source it cites. Read every word.' },
            { icon: 'check', title: 'Call it', body: 'Tap True or False, or press T or F (1 or 2 work too). A right call brings the next one at once.' },
            { icon: 'bolt', title: 'Build the multiplier', body: 'Right calls in a row climb it to x5. A miss shows the answer, why, and where it comes from; the clock waits while it shows.' },
          ]} />}>
          {empty ? back : <span data-testid="tf-pool-line">{pool == null ? 'Drawing the statements' : `${plural(pool.length, 'statement', 'statements')} in this draw`}</span>}
        </StartArena>
      </div>
    )
  }

  if (phase === 'done') {
    const rows = run.log.map((r) => ({ name: r.q, ticker: <Review row={r} />, ok: r.ok, said: null, was: '' }))
    const newBest = run.score > 0 && run.score > bestBefore
    const perfect = run.answered >= TF_MIN && run.right === run.answered
    const lean = leanLine(run.log)
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s2.kit} ${g.end}`}>
          <EndHard right={run.right} total={run.answered} xp={run.score} xpLabel="points" results={run.results} log={rows} level={runXp()}
            title={tfVerdict(run.right, run.answered)} unit="called right" doneWord="right" medal={false} showSetups={false}
            againLabel="Again" testIdPrefix="tf" onAgain={again} onBack={onClose}>
            <span className={g.endNote} data-testid="tf-best-line">
              {newBest ? <><b>A new best.</b> Top multiplier x{tfMult(run.best)}.</> : <>Your best stands at <b>{bestEver}</b>. Top multiplier this run x{tfMult(run.best)}.</>}
            </span>
            {lean ? <span className={g.endNote} data-testid="tf-lean">{lean}</span> : null}
            {stop === 'deck' ? <span className={g.endNote} data-testid="tf-deck-out">You called every statement in this draw. Again deals a fresh one.</span> : null}
            {stop === 'offline' ? <span className={g.endNote} data-testid="tf-offline">The server stopped answering, so the run ended early.</span> : null}
            {stop === 'signedOut' ? <span className={g.endNote} data-testid="tf-signed-out">You are signed out, so the run stopped there.</span> : null}
            {run.lost && stop !== 'offline' ? <span className={g.endNote} data-testid="tf-lost">{plural(run.lost, 'call', 'calls')} could not be checked, so {run.lost === 1 ? 'it does' : 'they do'} not count.</span> : null}
          </EndHard>
          {stop === 'signedOut' && signedOut ? <div className={g.signIn}>{signedOut}</div> : null}
        </div>
      </>
    )
  }

  const st = run.deck[run.i]
  if (!st) return null
  const n = run.i + 1
  const last = run.i + 1 >= run.deck.length
  return (
    <div className={`${s2.kit} ${s2.screen}`} data-testid="tf-play" data-state={miss ? 'bad' : busy ? 'checking' : 'ask'}>
      {flash ? <span className={`${s2.flash} ${flash === 'ok' ? s2.ok : s2.bad}`} aria-hidden="true" /> : null}
      {miss ? (
        // a tap anywhere on the takeover moves on (its button does too; moveOn runs once)
        <div className={g.tapAway} onClick={tapOn}>
          <VerdictTakeover ok={false} title={verdictTitle(miss.truth)} label={last ? 'See the run' : 'Next statement'} onContinue={tapOn} testId="tf-takeover"
            sub={(
              <>
                {miss.reason ? <span className={g.why} data-testid="tf-takeover-why">{miss.reason}</span> : null}
                {miss.source ? <span className={g.from} data-testid="tf-takeover-source"><UIcon name="book" size={14} gold={false} />{miss.source.name}</span> : null}
                <span className={g.timer} style={{ '--ms': `${takeoverMs(miss.reason)}ms` }} aria-hidden="true"><i /></span>
              </>
            )} />
        </div>
      ) : null}
      <HudClock left={left} secs={TF_SECS} score={run.score} combo={run.combo} mult={tfMult(run.combo)} label="True or False" live={!miss && !busy} />
      <div key={`st-${run.token}-${run.i}`} className={g.deal}>
        <StatementCard statement={st} n={n} checking={!!busy} />
        <div className={g.pair}>
          <AnswerLessonApp instant choices={TF_CHOICES} pick={busy ? TF_CHOICES.indexOf(busy) : null} onPick={(k) => answer(TF_CHOICES[k])}
            eyebrow={<>True or False · your call</>} question="True or false?"
            detail={phone ? null : <>Pick one, or press <b>T</b> or <b>F</b>. The keys <b>1</b> and <b>2</b> work too.</>} cardsTestId="tf-choices" />
        </div>
        {note ? <p className={g.note} role="status" data-testid="tf-note">{note}</p> : null}
      </div>
    </div>
  )
}
