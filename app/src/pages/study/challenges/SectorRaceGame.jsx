// SECTOR RACE (docs/study/GAMES.md §3, kind 'sectors'; built on the contract in §1). Which group led? Sixty seconds on a
// track. The approved questions of our Sector leadership course (F7.09: which of the 11 sectors led or lagged in a
// documented year, how to read a group's strength against the S&P 500, defensive against cyclical) come as one skill
// session (POST /api/study/sessions {kind: 'skill', skill_id: 'history.sectors', size: 10}); each is a leg of 100 m.
// A right answer runs the member's runner one leg up the track, flashes, and brings the next question at once, the
// multiplier climbing as in Blitz (HudClock). A miss leaves the leg unrun and takes over the screen (rule 15): the
// verdict, the right answer, why (the unit's note on the tile they picked, when it wrote one) and the lesson line, with
// the cited page its figures come from (games/sectorRace.sourceFor); it moves on by itself after the time it takes to
// read or on a tap (a stray second tap in its first
// TAKEOVER_GUARD_MS never skips it). Every answer right crosses the line, and each second left on the clock there is a
// bonus. The clock waits while a miss shows and while an answer is on the wire, so the member is timed on their thinking
// only. Every answer is scored on the server (POST /api/study/attempts), which also grants the XP, so this game never
// posts a game run; the end screen's level bar shows what the attempts earned. The end screen (EndHard) shows the
// distance run on the track, the answers right and the log: every question with its answer, the member's call, why,
// the lesson line and the source. A draw under RACE_MIN questions says so honestly; a draw that fails offers a retry
// and a way back; an answer the server does not score is not counted and the race goes on (RACE_MAX_FAILS in a row stop
// it). Every number is games/sectorRace.js's or the server's. The best score lives on this device.
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
import g from './SectorRaceGame.module.css'
import ChallengeError, { isSignedOut } from './ChallengeError'
import { beginRunXp, runXp, scoreAttempt } from './challengeBank'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback } from '../studyFeedback'
import { SESSIONS_URL, studyFetch } from '../useStudySession'
import {
  EMPTY_LINE, EMPTY_RUN, FINISH_POINTS_PER_SEC, LEG_M, LOST_LINE, RACE_ATTEMPT_TIMEOUT_MS, RACE_BEST_KEY, RACE_CROSS_MS,
  RACE_MAX_FAILS, RACE_MIN, RACE_POOL_TIMEOUT_MS, RACE_SECS, RACE_SIZE, RACE_TICK_MS, SECTORS_COURSE, TAKEOVER_GUARD_MS, applyCall,
  applyLost, deckOf, distanceLine, distanceOf, endOf, finishBonus, keyIndex, metres, missLine, missWhy, progressPct,
  questionsOf, raceMult, raceVerdict, rowOf, secsOf, sessionBody, startRun, takeoverMs, tickClock, topMult, trackLabel,
  trackOf, verdictOf, verdictTitle,
} from './games/sectorRace'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: 'sectors', title: 'Sector Race', sub: 'Which group led? Sixty seconds on the track: every right answer runs a leg.', icon: 'flag', plate: 'Sectors', accent: 'amber', group: 'skill' }

const readBest = () => { try { return Number(localStorage.getItem(RACE_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(RACE_BEST_KEY, String(v)) } catch { /* no storage */ } }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const LONG_Q = 90          // a question longer than this reads at a smaller size
const WIDE_TILE = 26       // a tile label longer than this, or an odd count, stacks the tiles in one column

const KIND_WORD = { mcq: 'pick one', tf: 'true or false', fill: 'fill the blank', scenario: 'your call' }

/** The track: one lane, a leg mark every 100 m, the gold trail behind the runner, the line at the end, and a split for
 *  every answer under it. `final` draws it still, for the end screen. */
function Track({ legs, right, results, final = false, testId = 'sectors-track' }) {
  const pct = progressPct(right, legs)
  const misses = results.filter((r) => r === false).length
  const across = legs > 0 && right >= legs
  return (
    <div className={`${g.track} ${final ? g.still : ''} ${across ? g.across : ''}`} data-testid={testId} role="img" aria-label={trackLabel(right, legs, misses)}>
      <div className={g.trackHead} aria-hidden="true">
        <span className={g.trackTag}><UIcon name="flag" size={14} gold={false} />{across ? 'Across the line' : 'The track'}</span>
        <span className={g.trackRan}><b data-testid={`${testId}-ran`}>{metres(distanceOf(right))}</b><small>of {metres(trackOf(legs))}</small></span>
      </div>
      <div className={g.lane} aria-hidden="true">
        <div className={g.rail}>
          <i className={g.trail} style={{ width: `${pct}%` }} />
          {Array.from({ length: Math.max(0, legs - 1) }, (_, k) => (
            <i key={k} className={`${g.tick} ${k + 1 <= right ? g.passed : ''}`} style={{ left: `${((k + 1) / legs) * 100}%` }} />
          ))}
          <i className={g.start} />
          <i className={g.finish} />
          <span className={g.runner} style={{ left: `${pct}%` }} data-testid={`${testId}-runner`} data-at={pct}>
            <UIcon name="user" size={16} gold={false} />
            {!final && right > 0 ? <em key={right} className={`${g.gain} ${pct > 60 ? g.behind : ''}`} data-testid={`${testId}-gain`}>+{LEG_M} m</em> : null}
          </span>
        </div>
      </div>
      <div className={g.splits} aria-hidden="true">
        {Array.from({ length: legs }, (_, k) => {
          const r = results[k]
          return (
            <span key={k} className={`${g.split} ${r === true ? g.ok : r === false ? g.miss : ''}`}>
              {r === true ? <UIcon name="check" size={10} gold={false} /> : r === false ? <UIcon name="x" size={10} gold={false} /> : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** A scenario's situation, read before its question. */
function Situation({ story }) {
  return (
    <figure className={g.situation} data-testid="sectors-story">
      <span className={g.plate}>The situation</span>
      <p className={g.story}>{story}</p>
    </figure>
  )
}

/** A fill-in's sentence, its blank drawn as a gold slot. */
function FillSentence({ sentence }) {
  const parts = String(sentence || '').split(/_{3,}/)
  return (
    <span data-testid="sectors-sentence">
      {parts.map((p, k) => (
        <span key={k}>{p}{k < parts.length - 1 ? <span className={g.slot} role="img" aria-label="blank">{'\u00a0'}</span> : null}</span>
      ))}
    </span>
  )
}

/** One answer on the end screen, under its question: the answer, the member's call, why, the lesson line, the source. */
function Review({ row }) {
  const src = row.source
  return (
    <span className={g.review}>
      <span className={g.calls}>
        {row.truth ? <span className={`${g.call} ${g.truth}`}>Answer <b>{row.truth}</b></span> : null}
        <span className={`${g.call} ${row.ok ? g.mine : g.wrong}`}>You said <b>{row.said}</b></span>
      </span>
      {!row.ok && row.wrong ? <span className={g.why} data-testid="sectors-log-wrong">{row.wrong}</span> : null}
      {row.reason ? <span className={g.why} data-testid="sectors-log-why">{row.reason}</span> : null}
      {row.line ? <span className={g.line} data-testid="sectors-log-line">{row.line}</span> : null}
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

export default function SectorRaceGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const phone = useIsPhone()
  const [phase, setPhase] = useState('start')      // start | play | done
  const [pool, setPool] = useState(null)            // the playable questions; null while the draw loads
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [run, setRun] = useState(EMPTY_RUN)
  const [left, setLeft] = useState(RACE_SECS)
  const [busy, setBusy] = useState(null)            // the tile on the wire (its index); the clock waits
  const [miss, setMiss] = useState(null)            // the missed answer's row while its takeover holds the screen
  const [crossing, setCrossing] = useState(false)   // the last leg is run: the runner crosses before the end screen
  const [note, setNote] = useState(null)            // an answer that never reached the server
  const [flash, setFlash] = useState(null)
  const [end, setEnd] = useState(null)              // { stop, secsLeft, bonus }: why and how the race ended
  const [bestEver, setBestEver] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0)
  const runRef = useRef(EMPTY_RUN)
  const msRef = useRef(RACE_SECS * 1000)
  const pausedRef = useRef(true)
  const busyRef = useRef(false)
  const missRef = useRef(null)
  const crossRef = useRef(false)                    // the last leg is run: nothing more is answered
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

  // the draw: a fresh skill session each time the start screen opens; one that never answers fails honestly, never spins
  useEffect(() => {
    let on = true
    const t = setTimeout(() => {
      if (!on) return
      on = false
      setError(new Error('The questions took too long to load.')); setPool([])
    }, RACE_POOL_TIMEOUT_MS)
    Promise.resolve()
      .then(() => fetcher(SESSIONS_URL, { method: 'POST', body: sessionBody() }))
      .then((res) => { if (!on) return; on = false; clearTimeout(t); setPool(questionsOf(res)) })
      .catch((e) => { if (!on) return; on = false; clearTimeout(t); setError(e || new Error('The questions did not load.')); setPool([]) })
    return () => { on = false; clearTimeout(t) }
  }, [reload, fetcher])

  /** A timer cleared on unmount. */
  const later = useCallback((fn, ms) => {
    const set = timers.current || (timers.current = new Set())
    const t = setTimeout(() => { set.delete(t); fn() }, ms)
    set.add(t)
    return t
  }, [])

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

  // the end of a race: once, from the clock's last tick, the last question of the draw, or a server that stopped answering
  const finish = useCallback((stop) => {
    const r = runRef.current
    if (r.done) return
    runRef.current = { ...r, done: true }
    pausedRef.current = true; busyRef.current = false; missRef.current = null; crossRef.current = false
    const secsLeft = stop === 'line' ? secsOf(msRef.current) : 0
    const bonus = stop === 'line' ? finishBonus(secsLeft) : 0
    const total = r.score + bonus
    setRun(runRef.current); setBusy(null); setMiss(null); setNote(null); setCrossing(false)
    setEnd({ stop: stop || null, secsLeft, bonus }); setPhase('done')
    endFeedback(prefs)
    const prev = readBest()
    if (total > prev) writeBest(total)
    setBestEver(Math.max(prev, total))
  }, [prefs])
  const finishRef = useRef(finish)
  useEffect(() => { finishRef.current = finish }, [finish])

  // the clock: a short step that only counts while a question waits for the member
  useEffect(() => {
    if (phase !== 'play') return undefined
    const t = setInterval(() => {
      const next = tickClock(msRef.current, pausedRef.current)
      if (next === msRef.current) return
      msRef.current = next
      setLeft(secsOf(next))
      if (next === 0) { clearInterval(t); finishRef.current('time') }
    }, RACE_TICK_MS)
    return () => clearInterval(t)
  }, [phase])

  const advance = useCallback(() => {
    const r = runRef.current
    if (r.done) return
    if (r.i + 1 >= r.deck.length) {
      const stop = endOf(r)
      if (stop === 'line') {
        // the last leg: the clock stops where it stands, the runner crosses, then the end screen
        pausedRef.current = true; crossRef.current = true
        setCrossing(true)
        later(() => finishRef.current('line'), RACE_CROSS_MS)
        return
      }
      finishRef.current(stop)
      return
    }
    runRef.current = { ...r, i: r.i + 1 }
    setRun(runRef.current)
    pausedRef.current = false
    shownAt.current = Date.now()
  }, [later])

  const answer = useCallback(async (k) => {
    const r = runRef.current
    const qn = r.deck[r.i]
    const choice = qn?.choices?.[k]
    if (phase !== 'play' || r.done || !qn || !choice || busyRef.current || missRef.current || crossRef.current) return
    busyRef.current = true; pausedRef.current = true
    setBusy(k); setNote(null)
    let a = null
    let err = null
    try {
      a = await within(scoreAttempt({ id: qn.id, sessionId: qn.sessionId || undefined }, { choice: choice.value }, Date.now() - shownAt.current, fetcher), RACE_ATTEMPT_TIMEOUT_MS)
      // a reply with no verdict is not a score: read as a miss, it would teach an answer the server never gave
      if (verdictOf(a) == null) throw new Error('The answer came back without a verdict.')
    } catch (e) { err = e || new Error('The answer was not checked.') }
    // a late answer lands only on its own race, never on one started after it or after the sheet closed
    if (!live.current || runRef.current.token !== r.token || runRef.current.done) return
    busyRef.current = false
    setBusy(null)
    if (err) {
      if (isSignedOut(err)) { finishRef.current('signedOut'); return }
      runRef.current = applyLost(runRef.current)
      setRun(runRef.current)
      if (runRef.current.fails >= RACE_MAX_FAILS) { finishRef.current('offline'); return }
      setNote(LOST_LINE)
      advance()
      return
    }
    const row = rowOf({ question: qn, said: choice.value, correct: verdictOf(a), reveal: a.reveal || null })
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
  // a tap or Enter in the first moments is a second tap meant for the next question: it never skips the lesson
  const tapOn = useCallback(() => { if (Date.now() - missAt.current >= TAKEOVER_GUARD_MS) moveOn() }, [moveOn])
  const missMs = miss ? takeoverMs(missWhy(miss), miss.line) : 0
  useEffect(() => {
    if (!miss) return undefined
    const t = setTimeout(moveOn, missMs)
    return () => clearTimeout(t)
  }, [miss, missMs, moveOn])

  // 1 to 4 pick a tile (T or F on a statement), while a question waits for the member
  useEffect(() => {
    if (phase !== 'play' || miss || busy != null || crossing) return undefined
    const k = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const r = runRef.current
      const at = keyIndex(r.deck[r.i], e.key)
      if (at < 0) return
      e.preventDefault()
      answer(at)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [phase, miss, busy, crossing, answer])

  const ready = !!pool && pool.length >= RACE_MIN
  const start = useCallback(() => {
    if (!pool || pool.length < RACE_MIN) return
    const fresh = startRun(deckOf(pool, Date.now()), runRef.current.token + 1)
    runRef.current = fresh; msRef.current = RACE_SECS * 1000; pausedRef.current = false; busyRef.current = false; missRef.current = null; crossRef.current = false
    shownAt.current = Date.now()
    beginRunXp()
    setRun(fresh); setLeft(RACE_SECS); setBusy(null); setMiss(null); setNote(null); setEnd(null); setFlash(null); setCrossing(false)
    setBestBefore(readBest()); setPhase('play')
  }, [pool])
  const again = () => { setPool(null); setError(null); setReload((n) => n + 1); setPhase('start') }
  const back = onClose ? <StudyButton kind="ghost" onClick={onClose} testId="sectors-back">Back to Study</StudyButton> : null

  if (error) {
    return (
      <div className={`${s2.kit} ${g.failed}`} data-testid="sectors-failed">
        <ChallengeError what="the Sector Race questions" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((n) => n + 1) }} />
        {back}
      </div>
    )
  }

  if (phase === 'start') {
    const empty = !!pool && pool.length < RACE_MIN
    // the stakes are this draw's track; while it loads, or when it is too thin to run, the full race it will be
    const legs = pool && pool.length >= RACE_MIN ? pool.length : RACE_SIZE
    const top = topMult(legs)
    return (
      <div className={s2.kit}>
        <StartArena plate={GAME.plate} title={GAME.title} caption="Which group led?" testId={empty ? 'sectors-empty' : 'sectors-intro'} startTestId="sectors-start" hotkey
          stakes={[{ v: RACE_SECS, l: 'seconds', icon: 'clock' }, { v: metres(trackOf(legs)), l: 'track', icon: 'flag' }, { v: `x${top}`, l: 'top multiplier', icon: 'bolt' }]}
          ready={ready} onStart={start}
          label={ready ? 'Start the race' : pool == null ? 'Loading the questions' : 'No questions yet'}
          lead={empty
            ? <span data-testid="sectors-empty-line">{EMPTY_LINE}</span>
            : <>Questions from our {SECTORS_COURSE} course: which groups led, which lagged, and how to tell. Each one is checked against its source.</>}
          reward={empty ? null : <><UIcon name="star" size={22} /><span>Your best <b data-testid="sectors-best">{bestEver}</b> points</span></>}
          howTo={empty ? null : <HowItPlays mode="sectors" testId="sectors-howto" steps={[
            { icon: 'book', title: 'Read the question', body: 'Which sector led a real year, which lagged, and how you read a group against the S&P 500.' },
            { icon: 'flag', title: 'Run a leg', body: `Tap an answer or press its number. A right one runs you ${LEG_M} m up the track. A miss shows the answer and the lesson, and the clock waits while you read.` },
            { icon: 'bolt', title: 'Build the multiplier', body: `Right answers in a row climb it, up to x${top}. A miss resets it. Get every one right to cross the line: each second left there is worth ${FINISH_POINTS_PER_SEC} points.` },
          ]} />}>
          {empty ? back : <span data-testid="sectors-pool-line">{pool == null ? 'Drawing the questions' : `${plural(pool.length, 'question', 'questions')} in this draw · ${plural(pool.length, 'leg', 'legs')} of ${LEG_M} m`}</span>}
        </StartArena>
      </div>
    )
  }

  if (phase === 'done') {
    const rows = run.log.map((r) => ({ name: r.title, ticker: <Review row={r} />, ok: r.ok, said: null, was: '' }))
    const total = run.score + (end?.bonus || 0)
    const newBest = total > 0 && total > bestBefore
    const across = end?.stop === 'line'
    const misses = missLine(run.log)
    return (
      <>
        {across ? <Confetti /> : null}
        <div className={`${s2.kit} ${g.end}`}>
          <EndHard right={run.right} total={run.answered} xp={total} xpLabel="points" results={run.results} log={rows} level={runXp()}
            title={raceVerdict(run.right, run.answered, run.legs)} unit="answered right" doneWord="right" medal={false} showSetups={false}
            againLabel="Race again" testIdPrefix="sectors" onAgain={again} onBack={onClose}>
            <Track legs={run.legs} right={run.right} results={run.results} final testId="sectors-final" />
            <span className={g.endNote} data-testid="sectors-distance">{distanceLine({ right: run.right, legs: run.legs, stop: end?.stop, secsLeft: end?.secsLeft })}</span>
            <span className={g.endNote} data-testid="sectors-best-line">
              {newBest ? <><b>A new best.</b> Top multiplier x{raceMult(run.best)}.</> : <>Your best stands at <b>{bestEver}</b>. Top multiplier this run x{raceMult(run.best)}.</>}
            </span>
            {misses ? <span className={g.endNote} data-testid="sectors-misses">{misses}</span> : null}
            {end?.stop === 'deck' ? <span className={g.endNote} data-testid="sectors-deck-out">You answered every question in this draw. Race again deals a fresh one.</span> : null}
            {end?.stop === 'offline' ? <span className={g.endNote} data-testid="sectors-offline">The server stopped answering, so the race ended early.</span> : null}
            {end?.stop === 'signedOut' ? <span className={g.endNote} data-testid="sectors-signed-out">You are signed out, so the race stopped there.</span> : null}
            {run.lost && end?.stop !== 'offline' ? <span className={g.endNote} data-testid="sectors-lost">{plural(run.lost, 'answer', 'answers')} could not be checked, so {run.lost === 1 ? 'it does' : 'they do'} not count.</span> : null}
          </EndHard>
          {end?.stop === 'signedOut' && signedOut ? <div className={g.signIn}>{signedOut}</div> : null}
        </div>
      </>
    )
  }

  const qn = run.deck[run.i]
  if (!qn) return null
  const n = run.i + 1
  const last = run.i + 1 >= run.deck.length
  const labels = qn.choices.map((c) => c.label)
  const kindWord = qn.scenario ? KIND_WORD.scenario : KIND_WORD[qn.kind] || KIND_WORD.mcq
  const question = qn.kind === 'fill' ? <FillSentence sentence={qn.sentence} /> : qn.q
  const qText = qn.kind === 'fill' ? qn.sentence : qn.q
  const stack = qn.kind !== 'tf' && (labels.length % 2 === 1 || labels.some((l) => l.length > WIDE_TILE))
  const hint = qn.kind === 'tf'
    ? <>Tap one, or press <b>T</b> or <b>F</b>. The keys <b>1</b> and <b>2</b> work too.</>
    : <>Tap an answer, or press its number.</>
  return (
    <div className={`${s2.kit} ${s2.screen}`} data-testid="sectors-play" data-state={miss ? 'bad' : busy != null ? 'checking' : crossing ? 'crossing' : 'ask'}>
      {flash ? <span className={`${s2.flash} ${flash === 'ok' ? s2.ok : s2.bad}`} aria-hidden="true" /> : null}
      {miss ? (
        // a tap anywhere on the takeover moves on (its button does too; moveOn runs once)
        <div className={g.tapAway} onClick={tapOn}>
          <VerdictTakeover ok={false} title={verdictTitle(miss)} answer={miss.kind === 'tf' ? null : miss.truth}
            label={last ? 'See the race' : 'Next question'} onContinue={tapOn} testId="sectors-takeover"
            sub={(
              <>
                {missWhy(miss) ? <span className={g.tkWhy} data-testid="sectors-takeover-why">{missWhy(miss)}</span> : null}
                {miss.line ? <span className={g.tkLine} data-testid="sectors-takeover-line">{miss.line}</span> : null}
                {miss.source ? <span className={g.from} data-testid="sectors-takeover-source"><UIcon name="book" size={14} gold={false} />{miss.source.name}</span> : null}
                <span className={g.timer} style={{ '--ms': `${missMs}ms` }} aria-hidden="true"><i /></span>
              </>
            )} />
        </div>
      ) : null}
      <HudClock left={left} secs={RACE_SECS} score={run.score} combo={run.combo} mult={raceMult(run.combo)} label="Sector Race" live={!miss && busy == null && !crossing} />
      <Track legs={run.legs} right={run.right} results={run.results} />
      <div key={`q-${run.token}-${run.i}`} className={g.deal}>
        {qn.story ? <Situation story={qn.story} /> : null}
        <div className={g.ask} data-kind={qn.kind} data-long={qText.length > LONG_Q || undefined} data-stack={stack || undefined}>
          <AnswerLessonApp instant choices={labels} pick={busy} onPick={(k) => answer(k)}
            eyebrow={<>Question {n} of {run.legs} · {kindWord}</>} question={question}
            detail={phone ? null : hint} cardsTestId="sectors-choices" />
        </div>
        {note ? <p className={g.note} role="status" data-testid="sectors-note">{note}</p> : null}
      </div>
    </div>
  )
}
