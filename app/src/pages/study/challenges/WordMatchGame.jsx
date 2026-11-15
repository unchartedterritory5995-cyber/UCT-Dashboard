// WORD MATCH (docs/study/GAMES.md §3, kind 'match'; built on the contract in §1). Three rounds of five: the words of our
// vocabulary courses in one column, their meanings shuffled in the other (stacked on a phone). Tap a word then its
// meaning, or a meaning then its word, by tap or by key (1 to 5 a word, A to E a meaning). A right pair locks gold and
// fades to an empty slot; a wrong pair flashes red, adds three seconds to the clock, and then the lesson takes over the
// screen (rule 15): the pair the member started from, whole, and the one they mixed it up with, whole, with the unit it
// comes from. The clock counts up and holds while the lesson and the break between rounds show, so reading costs no
// time; the best time for the board's size lives on this device. A pair right on the first try counts as right. The
// end screen (EndHard) gives the time, the misses, the best, and every pair with its meaning and what it was mixed up
// with; the run reports {right, total} once to POST /api/study/game-runs and the level bar shows what the server
// granted (a failed report leaves the end screen whole and says the XP did not save).
// THE DRAW (rule 6): the pool's pairs are checked against their own questions before any is dealt (games/wordMatch.js
// explains why: the pool can hold "timeframe" paired with "True"); a draw that leaves the three rounds short asks the
// pool again (up to three times, no pair checked twice); a draw too thin for one round of five says so honestly with a
// way back, a failed one offers a retry, and one that never answers fails instead of spinning. Every number is
// games/wordMatch.js's or the server's.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudCombo } from '../ui/HudLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import VerdictTakeover from '../ui/VerdictTakeover'
import StudyButton from '../ui/StudyButton'
import Tile from '../ui/Tile'
import { Confetti } from '../ui/Stage'
import s2 from '../ui/study.module.css'
import sa from '../ui/answerLooks.module.css'
import g from './WordMatchGame.module.css'
import ChallengeError, { isSignedOut } from './ChallengeError'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import {
  CLOCK0, EMPTY_LINE, EMPTY_RUN, MATCH_END_BEAT_MS, MATCH_ITEM_URL, MATCH_KIND, MATCH_LOCK_MS, MATCH_MISS_FLASH_MS,
  MATCH_PENALTY_MS, MATCH_PER_ROUND, MATCH_POOL_SIZE, MATCH_POOL_TIMEOUT_MS, MATCH_POOL_URL, MATCH_ROUNDS, MATCH_ROUND_GAP_MS,
  MATCH_RUNS_URL, MATCH_TAKEOVER_GUARD_MS, MATCH_TICK_MS, MEANING_KEYS, WORD_KEYS, bestKeyOf, bestLine, bestOf, clockAt,
  clockText, clockWords, drawPairs, holdClock, isNewBest, keyPick, levelOf, missLesson, missLine, nextRound, paceOf, pairOf,
  penalize, pick, planRounds, roundsWord, runClock, startRun, streakOf, tallyOf, totalOf,
} from './games/wordMatch'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: 'match', title: 'Word Match', sub: 'Three rounds of five. Pair each word with its meaning against the clock.', icon: 'link', plate: 'Match', accent: 'amber', group: 'skill' }

const readBest = (total) => { try { return bestOf(localStorage.getItem(bestKeyOf(total))) } catch { return null } }
const writeBest = (total, ms) => { try { localStorage.setItem(bestKeyOf(total), String(Math.round(ms))) } catch { /* no storage */ } }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const PENALTY_SECS = MATCH_PENALTY_MS / 1000

/** The clock: it counts up; the best for this board on this device beside it; a pace line under it that runs to the
 *  best and turns red past it; a "+3s" that rises off it on each miss. */
function Stopwatch({ ms, best, pop }) {
  const pace = paceOf(ms, best)
  return (
    <div className={`${g.watch} ${pace?.over ? g.over : ''}`} role="timer" aria-label={`Time ${clockWords(ms)}`} data-testid="match-watch">
      <span className={g.watchIcon} aria-hidden="true"><UIcon name="clock" size={18} gold={false} /></span>
      <span className={g.watchMain}><small>Time</small><b data-testid="match-clock">{clockText(ms)}</b></span>
      {pop ? <span key={pop} className={g.pop} aria-hidden="true" data-testid="match-penalty">+{PENALTY_SECS}s</span> : null}
      <span className={g.watchBest}>{best ? <>Best <b data-testid="match-watch-best">{clockText(best)}</b></> : 'No best yet'}</span>
      {pace ? <i className={g.pace} aria-hidden="true"><i style={{ width: `${pace.pct}%` }} /></i> : null}
    </div>
  )
}

/** The board: the words and the meanings of one round, a Tile each. A picked tile wears the kit's gold; a pair that
 *  just matched locks gold, then fades to an empty slot that keeps its place (nothing moves under a finger); a wrong
 *  pair's two tiles shake red. */
const Board = memo(function Board({ pairs, order, sel, matched, fresh, flash, phone, busy, onPick }) {
  const tile = (side, id, i) => {
    const p = pairs.get(id)
    if (!p) return null
    const done = matched.includes(id)
    const lit = fresh === id
    const wrong = !!flash && flash[side] === id
    const picked = !!sel && sel.side === side && sel.id === id
    const state = wrong ? 'wrong' : lit || picked ? 'sel' : done ? 'quiet' : 'idle'
    const keys = side === 'word' ? WORD_KEYS : MEANING_KEYS
    const cls = lit ? g.locked : done ? g.gone : ''
    return (
      <Tile key={id} n={phone ? null : keys[i]} i={side === 'word' ? i : i + 2} state={state} className={cls} disabled={done || busy}
        label={<span className={side === 'word' ? g.termText : g.meaningText}>{side === 'word' ? p.term : p.meaning}{done ? <span className={g.sr}> (matched)</span> : null}</span>}
        onClick={() => onPick(side, id)} testId={side === 'word' ? 'match-word' : 'match-meaning'} dataIndex={i} />
    )
  }
  return (
    <div className={g.board} data-testid="match-board">
      <div className={g.cols}>
        <div className={`${g.col} ${g.words}`} role="group" aria-label="Words" data-testid="match-words">
          <span className={`${g.colHead} ${sel?.side === 'meaning' ? g.cue : ''}`}>{sel?.side === 'meaning' ? 'Now its word' : 'Words'}</span>
          {order.words.map((id, i) => tile('word', id, i))}
        </div>
        <div className={`${g.col} ${g.meanings}`} role="group" aria-label="Meanings" data-testid="match-meanings">
          <span className={`${g.colHead} ${sel?.side === 'word' ? g.cue : ''}`}>{sel?.side === 'word' ? 'Now its meaning' : 'Meanings'}</span>
          {order.meanings.map((id, i) => tile('meaning', id, i))}
        </div>
      </div>
    </div>
  )
})

/** The lesson a miss teaches, in the takeover: why, the right pair whole, the one it was mixed up with whole, the cost
 *  and the unit it comes from. Spans only: the takeover sets it inside a paragraph. */
function MissLesson({ lesson }) {
  return (
    <span className={g.lesson} data-testid="match-lesson">
      <span className={g.why} data-testid="match-why">{lesson.why}</span>
      <span className={`${g.pairCard} ${g.truth}`} data-testid="match-lesson-right">
        <span className={g.cardLabel}><UIcon name="check" size={13} gold={false} />The pair</span>
        <span className={g.cardTerm}>{lesson.right.term}</span>
        <span className={g.cardMeaning}>{lesson.right.meaning}</span>
      </span>
      <span className={`${g.pairCard} ${g.mixed}`} data-testid="match-lesson-mixed">
        <span className={g.cardLabel}><UIcon name="x" size={13} gold={false} />You mixed it up with</span>
        <span className={g.cardTerm}>{lesson.mixed.term}</span>
        <span className={g.cardMeaning}>{lesson.mixed.meaning}</span>
      </span>
      <span className={g.foot}>
        <span className={g.cost} data-testid="match-cost"><UIcon name="clock" size={13} gold={false} />{lesson.cost} on the clock</span>
        <span>The clock waits while you read.</span>
        {lesson.from ? <span className={g.from} data-testid="match-from"><UIcon name="book" size={13} gold={false} />From our {lesson.from} unit</span> : null}
      </span>
    </span>
  )
}

/** One pair on the end screen, under its word: the meaning, and what it was mixed up with when it was. */
function PairNote({ row }) {
  return (
    <span className={g.note}>
      <span className={g.noteMeaning}>{row.meaning}</span>
      {row.mixed.length ? <span className={g.noteMiss} data-testid="match-mixed">Mixed up with {row.mixed.join(', then ')}</span> : null}
    </span>
  )
}

export default function WordMatchGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const phone = useIsPhone()
  const [phase, setPhase] = useState('start')      // start | play | done
  const [plan, setPlan] = useState(null)            // the full rounds this draw can play; null while it loads
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [best, setBest] = useState(null)            // the best time for this board's size on this device
  const [run, setRun] = useState(EMPTY_RUN)
  const [shown, setShown] = useState(0)             // the clock as it reads
  const [pop, setPop] = useState(0)                 // one more on each penalty: the "+3s" rises again
  const [fresh, setFresh] = useState(null)          // the pair that just locked gold
  const [flashPair, setFlashPair] = useState(null)  // a wrong pair's two tiles, red for a moment
  const [miss, setMiss] = useState(null)            // the lesson while it holds the screen
  const [banner, setBanner] = useState(null)        // "Round N clear" between rounds, "Board clear" at the end
  const [busy, setBusy] = useState(false)           // the board takes no taps: a flash, a lesson, a break, the end
  const [flash, setFlash] = useState(null)          // the screen's green or red flash
  const [end, setEnd] = useState(null)              // the finished run: { ms, before, right, total, misses }
  const [report, setReport] = useState(null)        // the run's report: { level, gained } once saved, { failed, out } when not
  const [say, setSay] = useState('')                // the polite live line for a screen reader
  const runRef = useRef(EMPTY_RUN)
  const clockRef = useRef(CLOCK0)
  const holdsRef = useRef(null)                     // why the clock is held: miss | gap | end | hidden
  const timersRef = useRef(null)
  const liveRef = useRef(true)
  const missRef = useRef(null)
  const missAt = useRef(0)
  const flashT = useRef(null)
  const checkedRef = useRef(null)                   // each pair's check, kept across draws (games/wordMatch.verifyPairs)
  const endedRef = useRef(0)                        // the run whose end was taken (the report goes out once)
  const runNo = useRef(0)

  useEffect(() => {
    liveRef.current = true
    if (!timersRef.current) timersRef.current = new Set()
    const pending = timersRef.current
    return () => {
      liveRef.current = false
      clearTimeout(flashT.current)
      pending.forEach((t) => clearTimeout(t))
      pending.clear()
    }
  }, [])

  // the draw: the pool, each pair checked against its own question, asked again while the rounds come up short
  // (games/wordMatch.drawPairs), then the rounds it can fill; a fresh one each time the start screen opens. A draw that
  // never answers fails honestly, never spins.
  useEffect(() => {
    let on = true
    let t = null
    const settle = (fn) => { if (!on) return; on = false; clearTimeout(t); fn() }
    t = setTimeout(() => settle(() => { setError(new Error('The words took too long to load.')); setPlan([]) }), MATCH_POOL_TIMEOUT_MS)
    if (!checkedRef.current) checkedRef.current = new Map()
    const cache = checkedRef.current
    const fetchPool = () => Promise.resolve(fetcher(MATCH_POOL_URL, { method: 'POST', body: { kind: MATCH_KIND, size: MATCH_POOL_SIZE } })).then((res) => res?.items)
    const fetchPrompt = (id) => fetcher(`${MATCH_ITEM_URL}/${encodeURIComponent(id)}`, { method: 'GET' })
    Promise.resolve()
      .then(() => drawPairs(fetchPool, fetchPrompt, { cache, alive: () => on }))
      .then((out) => {
        if (!out) return
        settle(() => {
          if (out.fatal) { setError(out.fatal); setPlan([]); return }
          const rounds = planRounds(out.pairs)
          // nothing to deal because the checks themselves failed is a load failure, never "no questions yet"
          if (!rounds.length && out.failed > 0) { setError(new Error('The words could not be checked.')); setPlan([]); return }
          setPlan(rounds)
          setBest(rounds.length ? readBest(rounds.length * MATCH_PER_ROUND) : null)
        })
      })
      .catch((e) => settle(() => { setError(e || new Error('The words did not load.')); setPlan([]) }))
    return () => { on = false; clearTimeout(t) }
  }, [reload, fetcher])

  /** A timer that dies with the sheet and with its run (a late one never touches a run started after it). */
  const later = useCallback((fn, ms) => {
    if (!timersRef.current) timersRef.current = new Set()
    const set = timersRef.current
    const tok = runRef.current.token
    const t = setTimeout(() => { set.delete(t); if (liveRef.current && runRef.current.token === tok) fn() }, ms)
    set.add(t)
  }, [])

  // the clock holds for any reason in the set and runs again when the set is empty
  const hold = useCallback((why) => {
    if (!holdsRef.current) holdsRef.current = new Set()
    const h = holdsRef.current
    const now = Date.now()
    if (!h.size) clockRef.current = holdClock(clockRef.current, now)
    h.add(why)
    setBusy(true)
    setShown(clockAt(clockRef.current, now))
  }, [])
  const release = useCallback((why) => {
    const h = holdsRef.current
    if (!h || !h.has(why)) return
    h.delete(why)
    if (h.size) return
    if (!runRef.current.done) clockRef.current = runClock(clockRef.current, Date.now())
    setBusy(false)
  }, [])

  const flashNow = useCallback((ok) => {
    clearTimeout(flashT.current)
    setFlash(ok ? 'ok' : 'bad')
    flashT.current = setTimeout(() => setFlash(null), 220)
  }, [])

  // the end of the run: once per run, the clock already stopped at the last pair. The best is kept per board size; the
  // report goes out once (the server is idempotent on run_id too) and lands only on its own run's end screen.
  const finish = useCallback((ms) => {
    const r = runRef.current
    if (endedRef.current === r.token) return
    endedRef.current = r.token
    const { right, total, misses } = tallyOf(r)
    const before = readBest(total)
    if (isNewBest(ms, before)) { writeBest(total, ms); setBest(ms) } else setBest(before)
    setEnd({ ms, before, right, total, misses })
    setBanner(null)
    setPhase('done')
    endFeedback(prefs)
    if (!total) return
    const mine = () => liveRef.current && runRef.current.token === r.token
    Promise.resolve()
      .then(() => fetcher(MATCH_RUNS_URL, { method: 'POST', body: { kind: MATCH_KIND, run_id: r.runId, right, total } }))
      .then((res) => {
        if (!mine()) return
        const level = levelOf(res)
        // capped: the server's daily XP for this game is used up (study_store.GAME_XP_PER_KIND_DAY); a resend is not that
        setReport(level ? { level, gained: Math.max(0, Number(res?.xp_gained ?? res?.progress?.xp_gained ?? 0) || 0), capped: !!res?.capped && !res?.duplicate } : { failed: true, out: false })
      })
      .catch((e) => { if (mine()) setReport({ failed: true, out: isSignedOut(e) }) })
  }, [prefs, fetcher])

  const onPick = useCallback((side, id) => {
    if (phase !== 'play' || (holdsRef.current && holdsRef.current.size)) return
    const { run: next, event } = pick(runRef.current, side, id)
    if (event.type === 'none') return
    runRef.current = next
    setRun(next)
    if (event.type === 'select' || event.type === 'deselect') {
      tapFeedback(prefs)
      const p = pairOf(next, id)
      setSay(event.type === 'deselect' ? 'Pick dropped.' : side === 'word' ? `${p.term}. Now its meaning.` : 'Meaning picked. Now its word.')
      return
    }
    if (event.type === 'match') {
      revealFeedback(true, prefs)
      comboFeedback(streakOf(next.results), prefs)
      flashNow(true)
      setFresh(event.id)
      later(() => setFresh((f) => (f === event.id ? null : f)), MATCH_LOCK_MS)
      if (event.finished) {
        hold('end')
        const ms = clockAt(clockRef.current, Date.now())
        setBanner({ last: true, ms })
        setSay(`Board clear in ${clockWords(ms)}.`)
        later(() => finish(ms), MATCH_END_BEAT_MS)
        return
      }
      if (event.roundClear) {
        hold('gap')
        const ms = clockAt(clockRef.current, Date.now())
        setBanner({ round: next.round + 1, ms })
        setSay(`Round ${next.round + 1} clear.`)
        later(() => {
          runRef.current = nextRound(runRef.current)
          setRun(runRef.current); setBanner(null); setFresh(null)
          release('gap')
        }, MATCH_ROUND_GAP_MS)
        return
      }
      setSay(`${pairOf(next, event.id).term} matched.`)
      return
    }
    // a miss: the two tiles shake red, three seconds go on the clock, then the lesson takes the screen; the clock holds
    // from the miss until the member is back on the board
    revealFeedback(false, prefs)
    flashNow(false)
    hold('miss')
    clockRef.current = penalize(clockRef.current)
    setShown(clockAt(clockRef.current, Date.now()))
    setPop((n) => n + 1)
    setFlashPair({ word: event.word, meaning: event.meaning })
    setSay(`Not a pair. Plus ${PENALTY_SECS} seconds.`)
    const lesson = missLesson(next, event)
    later(() => {
      setFlashPair(null)
      if (!lesson) { release('miss'); return }
      missRef.current = lesson
      missAt.current = Date.now()
      setMiss(lesson)
    }, MATCH_MISS_FLASH_MS)
  }, [phase, prefs, hold, release, later, flashNow, finish])

  // the lesson moves on by its button or Enter (the button's own key), once; a tap in its first moments is a second
  // tap meant for the board and never skips it
  const backToBoard = useCallback(() => {
    if (!missRef.current || Date.now() - missAt.current < MATCH_TAKEOVER_GUARD_MS) return
    missRef.current = null
    setMiss(null)
    release('miss')
  }, [release])

  // the clock as it reads, ten times a second while a run is on (an unchanged value renders nothing)
  useEffect(() => {
    if (phase !== 'play') return undefined
    const t = setInterval(() => setShown(clockAt(clockRef.current, Date.now())), MATCH_TICK_MS)
    return () => clearInterval(t)
  }, [phase])

  // a hidden page holds the clock (a call, another app); the board cannot be seen, so nothing is gained by it
  useEffect(() => {
    if (phase !== 'play') return undefined
    const onVis = () => { if (document.hidden) hold('hidden'); else release('hidden') }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [phase, hold, release])

  // 1 to 5 pick a word, A to E a meaning, while the board takes taps (Enter belongs to the lesson's button)
  useEffect(() => {
    if (phase !== 'play' || busy) return undefined
    const k = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const p = keyPick(e.key)
      const now = runRef.current.order[runRef.current.round]
      if (!p || !now) return
      const id = (p.side === 'word' ? now.words : now.meanings)[p.index]
      if (!id) return
      e.preventDefault()
      onPick(p.side, id)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [phase, busy, onPick])

  const start = useCallback(() => {
    if (!plan || !plan.length) return
    const seed = Date.now()
    runNo.current += 1
    const fresh0 = startRun(plan, seed, runNo.current)
    runRef.current = fresh0
    holdsRef.current = new Set()
    clockRef.current = runClock(CLOCK0, seed)
    missRef.current = null
    setRun(fresh0); setShown(0); setPop(0); setFresh(null); setFlashPair(null); setMiss(null); setBanner(null); setBusy(false)
    setEnd(null); setReport(null); setSay('Round 1. Pair each word with its meaning.'); setPhase('play')
  }, [plan])
  const again = useCallback(() => { setPlan(null); setError(null); setReload((n) => n + 1); setPhase('start') }, [])
  const roundPairs = useMemo(() => new Map((run.rounds[run.round] || []).map((p) => [p.id, p])), [run.rounds, run.round])
  const back = onClose ? <StudyButton kind="ghost" onClick={onClose} testId="match-back">Back to Study</StudyButton> : null

  if (error) {
    return (
      <div className={`${s2.kit} ${g.failed}`} data-testid="match-failed">
        <ChallengeError what="the Word Match words" error={error} signedOut={signedOut} onRetry={() => { setPlan(null); setError(null); setReload((n) => n + 1) }} />
        {back}
      </div>
    )
  }

  if (phase === 'start') {
    const ready = !!plan && plan.length > 0
    const empty = !!plan && !plan.length
    const rounds = ready ? plan.length : MATCH_ROUNDS
    const total = rounds * MATCH_PER_ROUND
    return (
      <div className={s2.kit}>
        <StartArena plate={GAME.plate} title={GAME.title} caption="What does it mean?" testId={empty ? 'match-empty' : 'match-intro'} startTestId="match-start" hotkey
          stakes={[{ v: total, l: 'pairs', icon: 'link' }, { v: rounds, l: rounds === 1 ? 'round' : 'rounds', icon: 'columns' }, { v: `+${PENALTY_SECS}s`, l: 'a miss', icon: 'clock' }]}
          ready={ready} onStart={start}
          label={ready ? 'Start the clock' : plan == null ? 'Loading the words' : 'No pairs yet'}
          lead={empty ? <span data-testid="match-empty-line">{EMPTY_LINE}</span> : <>Words from our vocabulary courses. Pair each one with its meaning, as fast as you can.</>}
          reward={empty ? null : <><UIcon name="star" size={22} /><span>{best ? <>Your best <b data-testid="match-best">{clockText(best)}</b></> : 'Set your first time on this board'}</span></>}
          howTo={empty ? null : <HowItPlays mode="match" testId="match-howto" steps={[
            { icon: 'book', title: 'Read the board', body: 'Five words from our vocabulary courses on one side, their meanings shuffled on the other.' },
            { icon: 'link', title: 'Pair them', body: 'Tap a word, then its meaning, or a meaning, then its word. Keys work too: 1 to 5 for words, A to E for meanings.' },
            { icon: 'clock', title: 'Beat your time', body: `${roundsWord(rounds)} against the clock. A wrong pair adds ${PENALTY_SECS} seconds and shows you both meanings; the clock waits while you read.` },
          ]} />}>
          {empty ? back : <span data-testid="match-pool-line">{plan == null ? 'Drawing the words' : `${plural(total, 'pair', 'pairs')} in this draw · ${plural(rounds, 'round', 'rounds')} of ${MATCH_PER_ROUND}`}</span>}
        </StartArena>
      </div>
    )
  }

  if (phase === 'done' && end) {
    const rows = run.log.map((r) => ({ name: r.term, ticker: <PairNote row={r} />, ok: r.ok, said: null, was: '' }))
    const perfect = end.total > 0 && end.right === end.total
    const failed = !!report?.failed
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s2.kit} ${g.end}`}>
          <EndHard right={end.right} total={end.total} xp={report?.gained || 0} xpLabel="XP" results={run.results} log={rows} level={report?.level || null}
            title={<span data-testid="match-time">{clockText(end.ms)}</span>} unit="matched on the first try" doneWord="first try" showSetups={false}
            againLabel="Again" testIdPrefix="match" onAgain={again} onBack={onClose}>
            <span className={g.endNote} data-testid="match-best-line">{bestLine(end.ms, end.before)}</span>
            <span className={g.endNote} data-testid="match-miss-line">{missLine(end.misses)}</span>
            {report?.capped ? <span className={g.saved} data-testid="match-capped">You have earned all of today&apos;s Word Match XP. Your time and your best still count.</span> : null}
            {failed ? (
              <span className={g.saved} data-testid="match-not-saved">
                {report.out ? 'You are signed out, so this run\'s XP did not save.' : 'This run\'s XP did not save. Your time and your best still count here.'}
              </span>
            ) : null}
          </EndHard>
          {failed && report.out && signedOut ? <div className={g.signIn}>{signedOut}</div> : null}
        </div>
      </>
    )
  }

  const now = run.order[run.round]
  if (!now) return null
  const rounds = run.order.length
  const left = now.words.filter((id) => !run.matched.includes(id)).length
  return (
    <div className={`${s2.kit} ${s2.screen} ${g.play}`} data-testid="match-play" data-state={miss ? 'lesson' : flashPair ? 'bad' : banner ? 'clear' : 'ask'}>
      {flash ? <span className={`${s2.flash} ${flash === 'ok' ? s2.ok : s2.bad}`} aria-hidden="true" /> : null}
      {miss ? <VerdictTakeover ok={false} title={miss.title} sub={<MissLesson lesson={miss} />} label="Back to the board" onContinue={backToBoard} testId="match-takeover" /> : null}
      <HudCombo step={run.results.length} total={totalOf(run)} results={run.results} live={!busy} label="Word Match" unit="pair" scoreWord="first try" stepTestId="match-step" />
      <Stopwatch ms={shown} best={best} pop={pop} />
      <div className={`${sa.area} ${g.head}`}>
        <div className={sa.lHead}>
          <span className={sa.lEyebrow} data-testid="match-round">Round {run.round + 1} of {rounds} · {plural(left, 'pair', 'pairs')} left</span>
          <h2 className={sa.lQ}>Pair each word with its meaning.</h2>
          {phone ? null : <p className={sa.lDetail}>Tap a word, then its meaning, or the other way round. Keys work too: <b>1</b> to <b>5</b> for words, <b>A</b> to <b>E</b> for meanings. A wrong pair adds <b>{PENALTY_SECS} seconds</b>.</p>}
        </div>
      </div>
      <div className={g.stage}>
        <Board key={`${run.token}-${run.round}`} pairs={roundPairs} order={now} sel={run.sel} matched={run.matched} fresh={fresh} flash={flashPair} phone={phone} busy={busy} onPick={onPick} />
        {banner ? (
          <div className={g.banner} role="status" data-testid="match-round-clear">
            <div className={g.bannerCard}>
              <b>{banner.last ? 'Board clear' : `Round ${banner.round} clear`}</b>
              <span>{clockText(banner.ms)}</span>
              <small>{banner.last ? 'Every pair matched' : `Round ${banner.round + 1} of ${rounds} next`}</small>
            </div>
          </div>
        ) : null}
      </div>
      <span className={g.sr} aria-live="polite" data-testid="match-live">{say}</span>
    </div>
  )
}
