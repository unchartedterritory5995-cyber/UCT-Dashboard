// WEEKEND WATCHLIST (docs/study/GAMES.md §3, kind 'watchlist'; built on the contract in §1). A Sunday scan: eight real
// charts from the UCT bank laid out as a board of small multiples (two across in the challenge's lesson column on a
// desktop or a tablet, four across only where a column is wider than 1040px, a stacked list on a phone), tickers hidden,
// the last candle ringed on each. The member flags every chart where one of our setups fired on the last candle and
// passes on the rest, then locks the list.
// THE SPEC'S "PICK THE THREE" cannot be kept honestly: the bank's key never reaches the browser before an answer, so no
// board can know how many of its charts fired, and a prompt that said "three" would be a guess (rule 6). The prompt says
// there is no set number and names the setups it means; the count is told after the lock.
//
// THE POOL is Hard mode's (challengeBank.fetchSpotPool with `hard: true`): charts the server swept so that on a Yes chart
// only its own setup fires on the last bar and on a No chart nothing fires at all (api/services/study_hard.py), so "a
// setup fired here" always has one right answer. The bank's key never reaches the browser before an answer, so the
// board cannot know how many of its charts fired, and the prompt says so plainly: there is no set number (the owner,
// batch 21: "We cannot have incorrect examples and explanations!"). See games/watchlist.js.
//
// SCORED ON THE SERVER, one chart at a time (one SQLite file: never eight writes at once): a flag posts Hard mode's
// answer naming the chart's own setup (the bank's Yes), a pass posts "Nothing fired" (its No). The XP is what those
// attempts earn (no game run is posted); the end screen's level bar reads the server's totals (challengeBank.runXp).
//
// AFTER THE LOCK the verdict takes over the screen (rule 15): a chip per chart, the list and the board counted, and on a
// miss each miss named. On a miss its button opens the first missed chart (the lesson first); otherwise the board.
// The board then plays out what came next: each chart, one after another, runs on through the sessions after its last
// candle, and shows what fired (or that nothing did), the ticker and the date from the reveal, the move in the same
// numbers the focused review draws, and the bank's own line about it. Any checked chart opens on its own: the chart runs
// on tick by tick through its days (the replay within the day), with the trade drawn on it, the chart key and the coach's
// lesson card, as in Hard mode; Escape goes back to the board, the arrows walk the checked charts.
// When every post fails there is no run to show: the board offers a second try, never a "0 of 0" end screen.
// No hearts; one board per run; "Another weekend" deals a fresh one.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import useMediaQuery from '../../../hooks/useMediaQuery'
import { useRunOnTicks } from '../../../lab/fx'   // pure motion (bars running on, tick by tick); no styling rides in
import ChallengeError, { isSignedOut } from './ChallengeError'
import { beginRunXp, fetchForwardRest, fetchSpotPool, runXp, scoreAttempt } from './challengeBank'
import { yesNo } from './SpotSetupChallenge'
import { RUN_ON_MS, culmination, replayView, tradeOf } from './hardMode'
import { alignTicks, developing, fetchIntraday, keyDays } from './replayTicks'
import { tradeAnnotations, tradeMarkers } from './tradeMarks'
import {
  WATCH_KIND, WATCH_PER_SKILL, WATCH_TOTAL, WATCH_VIEW, WATCH_VIEW_PHONE, WAVE_MS, bankLine, boardCounts, boardPrompt, boardVerdict,
  callLine, cardRun, chartHead, chartNote, dealBoard, endNote, firstMiss, focusPeak, focusTitle, isShort, logRows, missLines, moveLine,
  moveOf, openLabel, perChartMs, readChart, scoredStep, startLead, summaryLines, takeoverLabel, tally, watchAnswer, whereLabel,
} from './games/watchlist'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import VerdictTakeover from '../ui/VerdictTakeover'
import Prompt from '../ui/Prompt'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import Tile from '../ui/Tile'
import StudyChart from '../ui/StudyChart'
import ChartKey from '../ui/ChartKey'
import ReplayClock from '../ui/ReplayClock'
import LessonCard from '../ui/LessonCard'
import { EndHard } from '../ui/EndLooks'
import { Confetti } from '../ui/Stage'
import { calloutLook, hardCallouts } from '../ui/callout'
import s from '../ui/study.module.css'
import sa from '../ui/answerLooks.module.css'
import h from '../ui/hudLooks.module.css'
import w from './WatchlistGame.module.css'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: WATCH_KIND, title: 'Weekend Watchlist', sub: 'A Sunday scan: eight real charts, tickers hidden. Flag the ones where one of our setups fired on the last candle.', icon: 'bookmark', plate: 'Watchlist', accent: 'gold', group: 'chart' }

const EMPTY_LINE = 'No questions in this game yet. They arrive as the courses are approved.'
const FAILED_LINE = 'The charts did not load. Check your connection and try again.'
const NONE = []
const CARD_LOOK = calloutLook(true)   // a board chart is small: the pointer wears the compact look on every screen

/** Scroll an element's top into view (a runner without layout has no scrollIntoView). */
function toTop(el, smooth = false) {
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', ...(smooth ? { behavior: 'smooth' } : {}) })
}

/** The status line, Hard mode's combined line (ui/hudLooks.module.css) laid out for a board: a pip per chart that lights
 *  gold with its number while it is flagged, then, once the list is checked, Hard mode's gold check for a call right and
 *  its red cross for a miss; the score is the flags, then the calls right. */
function WatchHud({ flags, rows, live }) {
  const c = boardCounts(flags)
  const t = rows ? tally(rows) : null
  const seg = (i) => ((i + 0.5) / Math.max(1, c.charts)) * 100
  return (
    <div className={`${h.hud} ${h.combo}`} role="group" data-testid="watch-hud"
      aria-label={t ? `Weekend Watchlist, ${t.right} of ${t.total} called right` : `Weekend Watchlist, ${c.charts} charts, ${c.flagged} flagged`}>
      <span className={`${h.badge} ${live ? h.live : ''}`}><UIcon name="bookmark" size={14} gold={false} /><span className={h.badgeText}>Watchlist</span></span>
      <div className={h.cTrack} aria-hidden="true">
        {flags.map((f, i) => {
          const r = rows?.[i]
          const st = t ? (r?.scored ? (r.right ? h.done : h.miss) : '') : f ? h.done : ''
          return (
            <span key={i} className={`${h.cPip} ${st}`} style={{ left: `${seg(i)}%` }} data-testid={`watch-pip-${i}`}>
              {t ? (r?.scored ? (r.right ? <UIcon name="check" size={10} gold={false} /> : <b>×</b>) : null) : f ? <i className={w.pipNum}>{i + 1}</i> : null}
            </span>
          )
        })}
      </div>
      <span className={h.cScore}>
        <b data-testid="watch-score">{t ? t.right : c.flagged}</b><small>{t ? 'right' : 'flagged'}</small>
        <em>{t ? `of ${t.total} checked` : `${c.charts} charts · ${c.passed} passed`}</em>
      </span>
    </div>
  )
}

/** The forward strip a chart has: the reveal's first bars and, once fetched, the rest. */
function useForward(attempt, rest) {
  return useMemo(() => {
    const first = attempt?.forward || NONE
    return rest?.length ? [...first, ...rest] : first
  }, [attempt, rest])
}

/** The trade a checked chart reviews, on Hard mode's rules: the setup's own plan from the reveal when it fired (the
 *  detector's entry and stop, the trims at 3R and 5R), otherwise the move measured from the signal candle. */
function useTrade(item, result, attempt, fwd) {
  const n = item.bars.length
  const signal = item.bars[n - 1]
  const fired = result?.fired === true
  const short = isShort(item)
  const culm = useMemo(() => (fired ? culmination(signal, fwd, short) : null), [fired, signal, fwd, short])
  const plan = attempt?.reveal?.trade || null
  const trade = useMemo(() => (fired ? tradeOf(item.name, signal, fwd, culm, true, plan) : null), [fired, item.name, signal, fwd, culm, plan])
  const runN = result?.scored ? cardRun(fwd.length, { fired, trade, culm }) : 0
  return { n, signal, fired, short, culm, trade, runN }
}

/** One chart on the board. Before the lock: the chart, its number and a flag. After: the chart runs on through what
 *  came next once its turn in the wave comes, the head says what fired, and the reveal gives the ticker and date, the
 *  move and the bank's line; the flag says the member's call, green or red. */
const Card = memo(function Card({ i, item, flagged, stage, result, attempt, rest, running, phone, onToggle, onOpen }) {
  const asking = stage !== 'review'
  const fwd = useForward(attempt, rest)
  const { n, signal, fired, short, culm, trade, runN } = useTrade(item, result, attempt, fwd)
  const { bars: all } = useRunOnTicks(item.bars, fwd, runN, running, { slowMs: 120, fastMs: 50, slowN: 2 })
  const view = asking ? Math.min(phone ? WATCH_VIEW_PHONE : WATCH_VIEW, n) : replayView(all?.length || n, n)
  const checked = !asking && !!result?.scored
  const tone = checked ? (result.right ? 'ok' : 'bad') : 'ask'
  const label = asking ? 'Last candle' : chartHead(result, item.name)
  const callouts = useMemo(() => hardCallouts({ index: n - 1, label, tone }), [n, label, tone])
  const drift = useMemo(() => (checked && result.fired === false ? moveOf(signal, fwd.slice(0, runN)) : null), [checked, result, signal, fwd, runN])
  const line = checked ? moveLine({ fired: result.fired, trade, culm, short, drift }) : ''
  const note = checked ? chartNote(result, attempt?.reveal?.lesson, item.name) : ''
  const tile = asking ? (flagged ? 'sel' : 'idle') : checked ? (result.right ? 'right' : 'wrong') : 'quiet'
  const edge = checked ? (result.right ? w.right : w.wrong) : asking && flagged ? w.flagged : ''
  return (
    <article className={`${w.card} ${edge}`} style={{ '--i': i }} data-testid={`watch-card-${i}`} data-flagged={flagged ? '1' : '0'}
      data-result={checked ? (result.right ? 'right' : 'wrong') : asking ? 'open' : 'unchecked'} aria-label={`Chart ${i + 1}`}>
      <div className={w.cardHead}>
        <span className={w.num} aria-hidden="true">{i + 1}</span>
        {asking
          ? <span className={`${w.chip} ${w.flagChip}`}>{flagged ? <UIcon name="bookmark" size={12} gold={false} /> : null}<span className={w.chipText}>{flagged ? 'On your list' : 'Not flagged'}</span></span>
          : <span className={`${w.chip} ${fired ? w.fired : w.none}`} data-testid={`watch-truth-${i}`}><span className={w.chipText}>{chartHead(result, item.name)}</span></span>}
      </div>
      <StudyChart id={item.id} bars={all} view={view} height={phone ? 236 : 248} callouts={callouts} calloutLook={CARD_LOOK}
        symbol={checked ? result.ticker || null : null} masked={!checked || !result.ticker} frameEnd={asking ? null : all?.[all.length - 1]?.t} />
      {checked ? (
        <div className={w.reveal} style={{ '--i': i }}>
          <span className={w.where} data-testid={`watch-where-${i}`}>{whereLabel(result) || 'Ticker and date not sent'}</span>
          {line ? <p className={w.move} data-testid={`watch-move-${i}`}>{line}</p> : null}
          {note ? <p className={w.note} data-testid={`watch-note-${i}`}>{note}</p> : null}
          <button type="button" className={w.open} onClick={() => onOpen(i)} data-testid={`watch-open-${i}`}>
            {openLabel(result)}<UIcon name="chevronRight" size={15} gold={false} />
          </button>
        </div>
      ) : !asking ? <p className={w.note} data-testid={`watch-unchecked-${i}`}>{callLine(result)}</p> : null}
      <Tile n={i + 1} i={i} label={asking ? (flagged ? 'On my watchlist' : 'Flag it') : flagged ? 'You flagged it' : 'You passed'} state={tile}
        role="checkbox" checked={flagged} disabled={stage !== 'pick'} onClick={() => onToggle(i)} testId={`watch-flag-${i}`} className={w.flagTile} />
    </article>
  )
})

/** One checked chart on its own: the chart runs on tick by tick through its days (the replay within the day, when the
 *  server stored them) with the trade drawn on it, the chart key under it and the coach's lesson card, Hard mode's
 *  review. The rest of the forward strip is fetched once and kept by the board. */
function Focus({ i, total, item, result, attempt, rest, fetcher, phone, hotkeys = true, onBack, onPrev, onNext }) {
  const box = useRef(null)
  const fwd = useForward(attempt, rest)
  const { n, signal, culm, trade, runN } = useTrade(item, result, attempt, fwd)
  const [intraday, setIntraday] = useState(null)   // the forward days' 30-minute bars, when the server stored them
  useEffect(() => {
    let on = true
    if (attempt) fetchIntraday(attempt, fetcher).then((d) => { if (on && d) setIntraday(d) })
    return () => { on = false }
  }, [attempt, fetcher])
  const ticks = useMemo(() => alignTicks(fwd, intraday), [fwd, intraday])
  const keys = useMemo(() => (ticks ? keyDays(trade, culm) : null), [ticks, trade, culm])
  const { bars: all, k, clock } = useRunOnTicks(item.bars, fwd, runN, true, { slowMs: RUN_ON_MS, ticks, keys, develop: developing })
  const look = useMemo(() => calloutLook(phone), [phone])
  const ok = !!result.right
  const callouts = useMemo(() => hardCallouts({ index: n - 1, label: chartHead(result, item.name), tone: ok ? 'ok' : 'bad', peak: focusPeak(trade, culm, n, k) }),
    [n, result, item.name, ok, trade, culm, k])
  const lines = useMemo(() => tradeAnnotations(trade, signal, all), [trade, signal, all])
  const marks = useMemo(() => tradeMarkers(trade, all, n), [trade, all, n])
  // Escape goes back to the board; the arrows walk the board. On the WINDOW's capture phase: the challenge Sheet closes
  // itself on Escape from a document capture listener that stops the event (components/mobile/Sheet.jsx), so a plain
  // window listener never heard it and Escape closed the whole challenge, board and all. Here it is heard first and
  // stopped, so the first Escape is "back to the board" and the next one closes the sheet as everywhere else. A sheet
  // opened over this one keeps its own keys.
  useEffect(() => {
    if (!hotkeys) return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const panels = typeof document !== 'undefined' ? document.querySelectorAll('[data-sheet-panel]') : []
      if (panels.length && box.current && !panels[panels.length - 1].contains(box.current)) return
      if (e.key === 'Escape') { e.stopPropagation(); onBack() }
      else if (e.key === 'ArrowLeft' && onPrev) onPrev()
      else if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hotkeys, onBack, onPrev, onNext])
  return (
    <section className={s.screen} data-testid="watch-focus" data-chart={i} aria-label={`Chart ${i + 1}`} ref={box}>
      <div className={w.focusBar}>
        <StudyButton kind="ghost" onClick={onBack} testId="watch-back-board">Back to the board</StudyButton>
        <span className={w.focusNav}>
          <button type="button" className={w.navBtn} onClick={onPrev} disabled={!onPrev} aria-label="The chart before"><UIcon name="chevronLeft" size={18} gold={false} /></button>
          <span className={w.focusIdx}>Chart {i + 1} of {total}</span>
          <button type="button" className={w.navBtn} onClick={onNext} disabled={!onNext} aria-label="The next chart" data-testid="watch-focus-next"><UIcon name="chevronRight" size={18} gold={false} /></button>
        </span>
      </div>
      <Prompt mood={ok ? 'happy' : 'oops'} tone={ok ? 'ok' : 'bad'} size={phone ? 40 : 48} title={focusTitle(result, item.name)}
        sub={<>{whereLabel(result) ? <><b>{whereLabel(result)}</b> · </> : null}{callLine(result)}</>}
        seal={<Stamp ok={ok} word={ok ? 'Right' : null} inline />} />
      <div className={s.heroChart}>
        <StudyChart id={item.id} bars={all} view={replayView(all?.length || n, n)} height={phone ? 340 : 480} callouts={callouts} calloutLook={look}
          symbol={result.ticker || null} masked={!result.ticker} annotations={lines} markers={marks} frameEnd={all?.[all.length - 1]?.t} />
        <ReplayClock clock={clock} tfMin={intraday?.tf || 30} testId="watch-clock" />
      </div>
      {trade ? <ChartKey trade={trade} testId="watch-key" /> : null}
      <LessonCard text={attempt?.reveal?.lesson || ''} ticker={result.ticker || null} setup={item.name} skillId={item.skill || null} fired={result.fired}
        bars={item.bars} setupRule={attempt?.reveal?.setup_rule || null} trade={trade} showReads={false} testId="watch-lesson" />
    </section>
  )
}

/** The verdict's body (VerdictTakeover renders it inside a paragraph, so spans only): a chip per chart, the list and the
 *  board counted, the misses named (one on a phone, two on a wider screen, the rest counted). Short enough for a phone:
 *  the takeover cannot scroll. */
function TakeoverBody({ board, rows, max = 2 }) {
  const t = tally(rows)
  return (
    <>
      <span className={w.tkChips} data-testid="watch-takeover-chips">
        {rows.map((r, i) => (
          <span key={i} className={`${w.tkChip} ${r.scored ? (r.right ? w.tkOk : w.tkBad) : ''}`} data-ok={r.scored ? (r.right ? '1' : '0') : ''}>
            {i + 1}{r.scored ? <UIcon name={r.right ? 'check' : 'x'} size={12} gold={false} /> : null}
          </span>
        ))}
      </span>
      {summaryLines(t).map((l) => <span key={l} className={w.tkLine}>{l}</span>)}
      {missLines(board, rows, max).map((l) => <span key={l} className={w.tkMiss} data-testid="watch-takeover-miss">{l}</span>)}
    </>
  )
}

function Board({ board, prefs, fetcher, signedOut, onDone }) {
  const phone = useIsPhone()
  const still = useMediaQuery('(prefers-reduced-motion: reduce)')   // the week arrives at once, every chart together
  const n = board.length
  const [flags, setFlags] = useState(() => board.map(() => false))
  const [stage, setStage] = useState('pick')        // pick | checking | review
  const [checked, setChecked] = useState(0)         // charts posted so far while checking
  const [attempts, setAttempts] = useState(() => board.map(() => null))
  const [rows, setRows] = useState(null)
  const [rest, setRest] = useState({})              // each chart's forward bars past the reveal's first ones
  const [takeover, setTakeover] = useState(false)   // the verdict holds the whole screen until the member opens the review
  const [focus, setFocus] = useState(null)          // a chart opened on its own, or null for the board
  const [wave, setWave] = useState(0)               // how many charts have started playing the week out
  const [out, setOut] = useState(false)             // signed out while checking: the rest were not posted
  const [again, setAgain] = useState(0)             // charts a re-check is posting (the ones a failure left unchecked)
  const shownAt = useRef(0)
  const lockMs = useRef(null)                        // each chart's share of the time the member took, fixed at the lock
  const live = useRef(true)
  const busy = useRef(false)
  const top = useRef(null)
  useEffect(() => { shownAt.current = performance.now(); live.current = true; return () => { live.current = false } }, [])

  const toggle = useCallback((i) => {
    if (stage !== 'pick' || busy.current || i < 0 || i >= n) return
    setFlags((f) => f.map((x, k) => (k === i ? !x : x)))
    tapFeedback(prefs)
  }, [stage, n, prefs])

  // the number keys flag a chart; Enter is Lock's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    if (stage !== 'pick') return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const i = Number(e.key) - 1
      if (Number.isInteger(i) && i >= 0 && i < n) toggle(i)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, n, toggle])

  // each chart starts playing its week a beat after the one before, once the verdict has been read
  useEffect(() => {
    if (still || stage !== 'review' || takeover || focus != null || wave >= n) return undefined
    const t = setTimeout(() => setWave((v) => v + 1), WAVE_MS)
    return () => clearTimeout(t)
  }, [still, stage, takeover, focus, wave, n])

  // the board opens at its top; so does a chart opened on its own, and the board again after it (not while checking:
  // the member is watching the Lock button count)
  useEffect(() => { if (stage !== 'checking') toTop(top.current, focus != null || stage === 'review') }, [focus, stage])

  /** Post the charts one at a time (all of them; or, from the review, the ones a failure left unchecked, the board staying
   *  revealed meanwhile), then hand the verdict the screen, then fetch the rest of each forward strip in the background
   *  so the week can play out to the move's end. */
  const check = async (only = null) => {
    if (busy.current) return
    busy.current = true
    if (only) setAgain(only.length); else setStage('checking')
    setChecked(0)
    // the time on the board ends at the lock: a re-check later posts the same share, never the time spent reviewing
    if (lockMs.current == null) lockMs.current = perChartMs(performance.now() - shownAt.current, n)
    const ms = lockMs.current
    const todo = only || board.map((_, i) => i)
    const got = [...attempts]
    let outNow = false
    for (let j = 0; j < todo.length; j++) {
      const i = todo[j]
      if (!outNow) {
        const it = board[i]
        const { yes, no } = yesNo(it.choices)
        try { got[i] = await scoreAttempt(it, watchAnswer(it, flags[i], yes, no), ms, fetcher) } catch (e) { got[i] = null; if (isSignedOut(e)) outNow = true }
        if (!live.current) return
      }
      setChecked(j + 1)
    }
    busy.current = false
    const r = board.map((it, i) => readChart(it, flags[i], got[i]))
    setAttempts(got); setRows(r); setOut(outNow); setAgain(0); setTakeover(true)
    if (!only) { setStage('review'); setFocus(null); setWave(0) }
    revealFeedback(boardVerdict(tally(r)).ok, prefs)
    for (const i of todo) {
      const a = got[i]
      if (!a || rest[i]) continue
      const more = await fetchForwardRest(a, a.forward.length, fetcher)
      if (!live.current) return
      if (more.length) setRest((x) => ({ ...x, [i]: more }))
    }
  }

  const t = rows ? tally(rows) : null
  const v = t ? boardVerdict(t) : null
  const miss = rows ? firstMiss(rows) : -1
  const c = boardCounts(flags)
  const prompt = boardPrompt(n)
  const asking = stage !== 'review'
  const unchecked = rows ? rows.map((r, i) => (r.scored ? -1 : i)).filter((i) => i >= 0) : NONE
  const nothingChecked = !!t && !t.total    // every post failed: no run to show (never a "0 of 0" end screen)
  const openReview = () => { setTakeover(false); setFocus(miss >= 0 ? miss : null) }
  const finish = () => { if (rows && !nothingChecked) onDone(rows) }
  const prev = focus != null && rows ? scoredStep(rows, focus, -1) : -1
  const next = focus != null && rows ? scoredStep(rows, focus, 1) : -1

  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="watch-board" data-stage={stage} ref={top}>
      {stage === 'review' ? <span className={`${s.flash} ${v.ok ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {stage === 'review' && takeover ? (
        <VerdictTakeover ok={v.ok} title={v.title} sub={<TakeoverBody board={board} rows={rows} max={phone ? 1 : 2} />} xp={t.xp} stampWord={v.stamp}
          label={takeoverLabel(t, miss)} onContinue={openReview} testId="watch-takeover" />
      ) : null}
      <WatchHud flags={flags} rows={rows} live={stage === 'pick'} />
      {asking ? (
        <div className={sa.area}>
          <div className={sa.lHead}>
            <span className={sa.lEyebrow}>{prompt.eyebrow}</span>
            <h2 className={sa.lQ} data-testid="watch-q">{prompt.q}</h2>
            <p className={sa.lDetail} data-testid="watch-detail">{prompt.detail}</p>
          </div>
        </div>
      ) : focus == null ? (
        <Prompt mood={v.ok ? 'happy' : 'oops'} tone={v.ok ? 'ok' : 'bad'} size={phone ? 40 : 48} title={v.title}
          sub={<span data-testid="watch-summary">{summaryLines(t).join(' ')}</span>} seal={<Stamp ok={v.ok} word={v.stamp} inline />} />
      ) : null}
      {stage === 'review' && focus != null && rows[focus] ? (
        <Focus key={focus} i={focus} total={n} item={board[focus]} result={rows[focus]} attempt={attempts[focus]} rest={rest[focus]} fetcher={fetcher} phone={phone}
          hotkeys={!takeover}
          onBack={() => setFocus(null)}
          onPrev={prev >= 0 ? () => setFocus(prev) : null}
          onNext={next >= 0 ? () => setFocus(next) : null} />
      ) : (
        <div className={w.boardWrap}>
          <div className={w.board} data-testid="watch-grid">
            {board.map((it, i) => (
              <Card key={it.id} i={i} item={it} flagged={flags[i]} stage={stage} result={rows?.[i] || null} attempt={attempts[i]} rest={rest[i]}
                running={stage === 'review' && !takeover && (still || i < wave)} phone={phone} onToggle={toggle} onOpen={setFocus} />
            ))}
          </div>
        </div>
      )}
      {out ? (
        <div className={w.way}>
          <p className={w.heldNote} data-testid="watch-signed-out">You are signed out, so the rest of the list was not checked. Sign in again to keep playing.</p>
          {signedOut}
        </div>
      ) : null}
      <div className={w.foot}>
        {asking ? (
          <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" busy={stage === 'checking'} onClick={() => check()} testId="watch-lock"
            sub={stage === 'checking' ? null : `${c.flagged} flagged · ${c.passed} passed`}>
            {stage === 'checking' ? `Checking ${Math.min(checked + 1, n)} of ${n}` : 'Lock the list'}
          </StudyButton>
        ) : (
          <>
            {(unchecked.length && !out) || again ? (
              <StudyButton kind={nothingChecked ? 'primary' : 'secondary'} size={nothingChecked ? 'xl' : null} arrow={nothingChecked} wide={nothingChecked}
                hotkey={nothingChecked && !takeover && !again ? 'Enter' : null} busy={!!again} onClick={() => check(unchecked)} testId="watch-recheck">
                {again ? `Checking ${Math.min(checked + 1, again)} of ${again}` : nothingChecked ? 'Check the list again' : 'Check the rest'}
              </StudyButton>
            ) : null}
            {nothingChecked ? null : (
              <StudyButton kind={v.ok ? 'good' : 'bad'} size="xl" arrow wide hotkey={takeover || focus != null || again ? null : 'Enter'} disabled={!!again} onClick={finish} testId="watch-next">See the run</StudyButton>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function WatchlistGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')   // start | play | done
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [run, setRun] = useState(null)          // { id, board }: the board, dealt once from the seed taken at Start
  const [end, setEnd] = useState(null)          // { board, rows }: the checked board, for the end screen
  useEffect(() => {
    let on = true
    fetchSpotPool(undefined, WATCH_PER_SKILL, fetcher, undefined, { hard: true })
      .then((p) => { if (on) setPool(p) })
      .catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])
  const count = useMemo(() => (pool ? dealBoard(pool, 1).length : WATCH_TOTAL), [pool])

  const start = useCallback(() => {
    if (!pool?.length || !count) return
    const seed = Date.now()   // seeded once; the pure module deals the board from it
    beginRunXp()
    setRun({ id: `watch-${seed}`, board: dealBoard(pool, seed) })
    setEnd(null); setPhase('play')
  }, [pool, count])
  const retry = () => { setPool(null); setError(null); setReload((r) => r + 1) }
  const again = () => { setRun(null); setEnd(null); retry(); setPhase('start') }

  if (error && isSignedOut(error)) return <ChallengeError what="the watchlist charts" error={error} signedOut={signedOut} onRetry={retry} />

  if (phase === 'start' || (phase === 'play' && !run)) {
    const failed = !!error
    const empty = !failed && pool != null && !count
    const ready = !failed && !!pool?.length && count > 0
    return (
      <div className={s.kit} style={{ padding: '26px 0 34px' }}>
        <StartArena plate="Watchlist" title="Weekend Watchlist" caption="Which of these fired?" testId="watch-intro" startTestId="watch-start" hotkey
          total={count || WATCH_TOTAL} ready={ready} onStart={start}
          label={failed ? 'The charts did not load' : pool == null ? 'Loading the bank' : ready ? 'Deal the charts' : 'No charts yet'}
          stakes={[{ v: pool == null ? WATCH_TOTAL : count, l: count === 1 ? 'chart' : 'charts', icon: 'chart' }, { v: 'No', l: 'tickers', icon: 'lock' }, { v: 0, l: 'hearts', icon: 'x' }]}
          lead={failed ? FAILED_LINE : empty ? EMPTY_LINE : startLead(count)}
          reward={failed || empty ? null : undefined}
          howTo={<HowItPlays mode="watchlist" testId="watch-howto" steps={[
            { icon: 'eye', title: 'Scan the board', body: 'Real charts from the UCT bank, tickers hidden, side by side. The last candle on each is ringed.' },
            { icon: 'bookmark', title: 'Flag what fired', body: 'Tap a chart\'s flag, or press its number, when one of our setups fired on its last candle. Pass on the rest. There is no set number.' },
            { icon: 'play', title: 'See what came next', body: 'Lock the list. Each chart shows what fired, its ticker and date, and what the stock did next.' },
          ]} />}>
          {failed || empty ? (
            <span className={w.way} data-testid={failed ? 'watch-failed' : 'watch-empty'}>
              {failed ? <StudyButton kind="secondary" onClick={retry} testId="watch-retry">Try again</StudyButton> : null}
              <StudyButton kind="ghost" onClick={onClose} testId="watch-back">Back to Study</StudyButton>
            </span>
          ) : pool == null ? null : <span data-testid="watch-bank">{bankLine(count)}</span>}
        </StartArena>
      </div>
    )
  }

  if (phase === 'done' && end) {
    const t = tally(end.rows)
    const perfect = t.total > 0 && t.right === t.total
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={s.kit}>
          <EndHard right={t.right} total={t.total} xp={t.xp} log={logRows(end.board, end.rows)} results={end.rows.filter((r) => r.scored).map((r) => r.right)}
            level={runXp()} unit="charts called right" doneWord="called" showSetups={false} againLabel="Another weekend" testIdPrefix="watch" onAgain={again} onBack={onClose}>
            <span data-testid="watch-end-note">{endNote(t)}</span>
          </EndHard>
        </div>
      </>
    )
  }

  return (
    <Board key={run.id} board={run.board} prefs={prefs} fetcher={fetcher} signedOut={signedOut}
      onDone={(rows) => { setEnd({ board: run.board, rows }); setPhase('done'); endFeedback(prefs) }} />
  )
}
