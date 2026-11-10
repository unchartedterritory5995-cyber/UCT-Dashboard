// DAILY CHART (docs/study/GAMES.md §3, kind 'daily'; built on the contract in §1). A daily habit: three real charts a day,
// the same three for every member, one go, and a score line to share.
//
// THE CHARTS come from POST /api/study/spot-setup {rounds: 3, shared: true, view: 90}: the server draws them with the ET
// day as the seed, so every member gets the same three, and only charts whose last candle is their setup and nothing else
// among the setups we teach (study_spot_setup.lookalikes on a Yes item). The view is fixed so a phone and a desktop are
// dealt the same draw.
//
// THE PLAY is Hard mode's (one design, rule 21): the member's own chart with the ticker hidden, the last candle pointed at,
// "What fired on the last candle?" and four setup names, dealt from the day and the chart so every member sees the same
// tiles. Something always fired here, so there is no "Nothing fired" tile (Trade Story asks it the same way). The pick is
// posted the way Hard mode posts it (the chart's own setup is the bank's Yes, another name is posted as itself) and scored
// on the server by POST /api/study/attempts, which is where the XP comes from: this game never posts a game run. The
// verdict takes over the screen (rule 15); on a miss it names the setup, what was said, and the setup's rule in the bank's
// own words. Then the chart runs on with the trade drawn, the chart key and the coach's lesson card, as in Hard mode.
//
// ONE GO A DAY. The day's result is written on the device after every answer (study.daily.YYYY-MM-DD, the ET day), so
// closing the sheet mid-run never buys a second look: the next open picks up at the next chart, and once the day is
// answered every open that day shows the result. Each write reads the device first (mergeDay), so a second tab on the
// same day never overwrites an answer given in the first. An answer that does not come back is not a miss: the game
// could not score it, the pick stays and Check sends it again. The result: the score out of three, the share line
// copied with the Clipboard API (plain
// characters: "UCT Daily Chart 2026-11-09: 2/3 X - X"), each chart's ticker, date and what fired in the run log, the
// streak of days played on this device and a countdown to the next charts at midnight New York time. Every number on it is
// counted in games/dailyChart.js or read from the server.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { useRunOnTicks } from '../../../lab/fx'   // pure motion (bars running on, tick by tick); no styling rides in
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError, { isSignedOut } from './ChallengeError'
import { beginRunXp, fetchForwardRest, runXp, scoreAttempt } from './challengeBank'
import { yesNo } from './SpotSetupChallenge'
import { HARD_CHART, RUN_ON_MS, SHORT_SETUPS, culmination, replayView, tradeOf } from './hardMode'
import { alignTicks, developing, dueCheck, fetchIntraday, keyDays, replayChecks, showChart } from './replayTicks'
import { tradeAnnotations, tradeMarkers } from './tradeMarks'
import {
  ANSWER_FAILED, ANSWER_SIGNED_OUT, DAILY_KIND, DAILY_TOTAL, DAILY_URL, DAILY_VIEW, QUESTION, STREAK_KEY, addRow, clockText, copyNote,
  dailyAnswer, dailyChoices, dayKey, dayLabel, emptyRecord, etDay, headline, howSteps, logRows, mergeDay, msToNextDay, nextStreak, peakOf,
  planRun, poolItems, readAnswer, readSaved, readStreak, ruleLabel, ruleParts, runOf, shareLine, shownStreak, staleKeys, startLabel, startLead,
  streakText, tally, whereText, withTotal,
} from './games/dailyChart'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { normalizeBars, studyFetch } from '../useStudySession'
import { HudCombo } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { EndHard } from '../ui/EndLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import Prompt from '../ui/Prompt'
import VerdictTakeover from '../ui/VerdictTakeover'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import StudyChart from '../ui/StudyChart'
import ChartKey from '../ui/ChartKey'
import ReplayClock from '../ui/ReplayClock'
import ReplayPause from '../ui/ReplayPause'
import LessonCard from '../ui/LessonCard'
import { Confetti } from '../ui/Stage'
import { calloutLook, hardCallouts } from '../ui/callout'
import s from '../ui/study.module.css'
import d from './DailyChartGame.module.css'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: DAILY_KIND, title: 'Daily Chart', sub: 'Three real charts a day, the same for every member. Name what fired on each, then share your score.', icon: 'calendar', plate: 'Daily', accent: 'amber', group: 'chart' }

const NONE = []
const DETAIL = <>One of our setups fired on the ringed last candle, and only one. Pick it from the four. One try, and it counts for today.</>

// ── the device: every read and write survives a browser that refuses storage ────────────────────────────────────────
function store() { try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null } }
function loadDay(day) { try { return readSaved(store()?.getItem(dayKey(day)) ?? null, day) } catch { return null } }
function saveDay(rec) { try { if (rec?.day) store()?.setItem(dayKey(rec.day), JSON.stringify(rec)) } catch { /* no storage: the day lives in this screen only */ } }
function loadStreak() { try { return readStreak(store()?.getItem(STREAK_KEY) ?? null) } catch { return null } }
function saveStreak(v) { try { if (v) store()?.setItem(STREAK_KEY, JSON.stringify(v)) } catch { /* no storage */ } }
function pruneDays(today) {
  try {
    const st = store()
    if (!st) return
    const keys = []
    for (let i = 0; i < st.length; i++) keys.push(st.key(i))
    for (const k of staleKeys(keys, today)) st.removeItem(k)
  } catch { /* no storage */ }
}

/** Copy the share line: the Clipboard API, then the older copy command, else false (the line stays selectable). */
async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* blocked: try the older way */ }
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const ta = document.createElement('textarea')
  try {
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.setAttribute('aria-hidden', 'true')
    Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' })
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)              // iOS Safari selects nothing on select() alone
    return !!document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()                                       // never left behind, whether the copy worked or threw
  }
}

/** The verdict's line under the headline: the setup and where (a right answer), or where and what was said (a miss). */
function Where({ row }) {
  const where = whereText(row)
  if (row.ok) return <><b>{row.name}</b> on {where || 'this chart'}</>
  return <>{where ? <><b>{where}</b> · </> : null}you said {row.said}</>
}

/** One chart: Hard mode's screen with four setup names, then the verdict, the run-on and the lesson. */
function Round({ idx, total, day, item, results, prefs, fetcher, signedOut, onScored, onNext }) {
  const phone = useIsPhone()
  const [pick, setPick] = useState(null)
  const [row, setRow] = useState(null)              // the scored answer (games/dailyChart.readAnswer)
  const [reveal, setReveal] = useState(null)        // the attempt's reveal: the lesson, the setup's rule, the trade plan
  const [takeover, setTakeover] = useState(false)   // the verdict holds the whole screen until the member opens the review
  const [busy, setBusy] = useState(false)           // the answer is on the wire: Check reads Checking and a second tap posts nothing
  const [fail, setFail] = useState(null)            // 'net' | 'out': the answer did not land, nothing was recorded
  const [fwd, setFwd] = useState(null)
  const [intraday, setIntraday] = useState(null)    // the forward days' 30-minute bars, when the server stored them
  const [answered, setAnswered] = useState(() => new Set())
  const shownAt = useRef(0)
  const live = useRef(true)
  const chartBox = useRef(null)
  useEffect(() => { shownAt.current = performance.now(); live.current = true; return () => { live.current = false } }, [])
  const bars = item.bars
  const n = bars.length
  const signal = bars[n - 1]
  const state = row ? (row.ok ? 'ok' : 'bad') : 'ask'
  const choices = useMemo(() => dailyChoices(item, day), [item, day])
  const fired = row ? row.fired : null
  const short = SHORT_SETUPS.includes(item.name)
  const culm = useMemo(() => (fired === true ? culmination(signal, fwd, short) : null), [fired, signal, fwd, short])
  const plan = reveal?.trade || null
  const trade = useMemo(() => tradeOf(item.name, signal, fwd, culm, fired, plan), [item.name, signal, fwd, culm, fired, plan])
  const runN = runOf(fwd?.length || 0, { fired: fired === true, trade, culm })
  // the replay within the day: each forward day grows through its real 30-minute closes; slow on the trade's key days
  const ticks = useMemo(() => alignTicks(fwd, intraday), [fwd, intraday])
  const keys = useMemo(() => (ticks ? keyDays(trade, culm) : null), [ticks, trade, culm])
  // the replay stops and asks at the trims, 3R and 5R (the server's own questions, api/services/study_trade.replay_checks)
  const checks = useMemo(() => (state === 'ask' ? NONE : replayChecks(trade)), [state, trade])
  const holdAt = useMemo(() => new Set(checks.filter((c) => !answered.has(c.at)).map((c) => c.session)), [checks, answered])
  const { bars: all, k, clock } = useRunOnTicks(bars, fwd, runN, state !== 'ask' && !takeover, { slowMs: RUN_ON_MS, ticks, keys, develop: developing, holdAt })
  const due = dueCheck(checks, k, answered)
  const view = state === 'ask' ? Math.min(DAILY_VIEW, all?.length || 0) : replayView(all?.length || 0, n)
  const look = useMemo(() => calloutLook(phone), [phone])
  const callouts = useMemo(() => hardCallouts({
    index: n - 1,
    label: state === 'ask' ? 'What fired here?' : fired === false ? 'Nothing fired' : item.name,
    tone: state,
    peak: peakOf(trade, culm, n, k),
  }), [n, state, fired, item.name, trade, culm, k])
  const lines = useMemo(() => (state === 'ask' ? null : tradeAnnotations(trade, signal, all)), [state, trade, signal, all])
  const marks = useMemo(() => (state === 'ask' ? null : tradeMarkers(trade, all, n)), [state, trade, all, n])

  const check = async () => {
    if (pick == null || row || busy) return
    setBusy(true); setFail(null)
    const picked = choices[pick]
    const { yes, no } = yesNo(item.choices)
    let a = null
    try {
      a = await scoreAttempt(item, dailyAnswer(picked, item, yes, no), performance.now() - shownAt.current, fetcher)
    } catch (e) {
      if (live.current) { setBusy(false); setFail(isSignedOut(e) ? 'out' : 'net') }
      return
    }
    const r = readAnswer(item, picked, a)
    onScored(r)          // on the device at once: closing the sheet now never buys a second look
    if (!live.current) return
    setBusy(false); setReveal(a.reveal || {}); setRow(r); setFwd(a.forward); setTakeover(true); revealFeedback(r.ok, prefs)
    // the rest of the forward strip, so the run-on reaches the move's culmination, and the days' 30-minute bars
    fetchIntraday(a, fetcher).then((x) => { if (live.current && x) setIntraday(x) })
    fetchForwardRest(a, a.forward.length, fetcher).then((more) => { if (live.current && more.length) setFwd((f) => [...(f || []), ...more]) })
  }

  // the number keys pick a tile; Enter is Check's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    if (row) return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const i = Number(e.key) - 1
      if (!busy && Number.isInteger(i) && i >= 0 && i < choices.length) { setPick(i); tapFeedback(prefs) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, busy, choices.length, prefs])

  const last = idx + 1 >= total
  const title = headline(row)
  const rule = row && !row.ok ? ruleParts(reveal?.lesson, reveal?.setup_rule, item.name) : null
  const mood = state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'
  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="daily-round" data-state={state}>
      {state !== 'ask' ? <span className={`${s.flash} ${state === 'ok' ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {state !== 'ask' && takeover ? (
        <VerdictTakeover ok={state === 'ok'} title={title} xp={row.xp}
          sub={<>
            <span className={d.tkLine}><Where row={row} /></span>
            {rule?.text ? <span className={d.tkRule} data-testid="daily-takeover-rule"><b>{ruleLabel(item.name, rule.cut)}</b> {rule.text}</span> : null}
          </>}
          label={state === 'bad' ? 'See the lesson' : trade?.kind === 'plan' ? 'See the trade' : 'See why'}
          onContinue={() => { setTakeover(false); showChart(chartBox.current) }} testId="daily-takeover" />
      ) : null}
      <HudCombo label="Daily Chart" step={idx} total={total} results={results} live={state === 'ask'} stepTestId="daily-step" />
      <div className={`${s.heroChart} ${state === 'bad' ? s.shake : ''}`} ref={chartBox}>
        <StudyChart id={item.id} bars={all} view={view} height={phone ? 340 : 520} chartOpts={HARD_CHART}
          callouts={callouts} calloutLook={look} symbol={row?.ticker || null} masked={state === 'ask' || !row?.ticker} annotations={lines} markers={marks}
          frameEnd={state === 'ask' ? null : all?.[all.length - 1]?.t} />
        <ReplayClock clock={clock} tfMin={intraday?.tf || 30} testId="daily-clock" />
      </div>
      {due ? <ReplayPause key={due.at} check={due} onDone={() => { setAnswered((a) => new Set([...a, due.at])); showChart(chartBox.current) }} testId="daily-pause" /> : null}
      {state !== 'ask' && trade ? <ChartKey trade={trade} testId="daily-key" /> : null}
      <AnswerLessonApp choices={choices} pick={pick} state={state} answer={state === 'ask' || fired === false ? null : item.name} step={idx} total={total} busy={busy}
        hotkey={!takeover && !due} eyebrow={<>Daily Chart · {dayLabel(day)} · ticker hidden</>} question={QUESTION} detail={DETAIL}
        onPick={(i) => { if (!row && !busy) { setPick(i); tapFeedback(prefs) } }} onCheck={check}
        onNext={() => onNext(row)} nextLabel={last ? 'See your score' : 'Next chart'}
        head={row ? <Prompt mood={mood} tone={state} size={phone ? 40 : 48} title={title} sub={<Where row={row} />} seal={<Stamp ok={row.ok} inline />} /> : null}
        cardsTestId="daily-cards" checkTestId="daily-check" nextTestId="daily-next" />
      {fail ? (
        <div className={d.fail} role="alert" data-testid="daily-fail">
          {fail === 'out' ? <><p>{ANSWER_SIGNED_OUT}</p>{signedOut}</> : <p>{ANSWER_FAILED}</p>}
        </div>
      ) : null}
      {row ? (
        <LessonCard text={reveal?.lesson || ''} ticker={row.ticker || null} setup={item.name} skillId={item.skill || null} fired={row.fired}
          bars={bars} setupRule={reveal?.setup_rule || null} trade={trade} showReads={false} testId="daily-lesson" />
      ) : null}
    </div>
  )
}

/** The day card's chips and the countdown to the next charts at midnight New York time. The one part of the result that
 *  ticks, so only it renders each second; at midnight it offers the new day's charts. */
function DayClock({ day, onNewDay, children }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const at = new Date(now)
  const ready = etDay(at) > day                    // the next charts have arrived while this screen was open (a clock set back is not a new day)
  return (
    <>
      <span className={d.meta}>
        {children}
        {ready
          ? <span className={`${d.chip} ${d.fresh}`} data-testid="daily-ready"><UIcon name="calendar" size={15} gold={false} /><span>Today&apos;s charts are ready</span></span>
          : <span className={d.chip} data-testid="daily-countdown" aria-live="off"><UIcon name="clock" size={15} gold={false} /><span>Next charts in <b>{clockText(msToNextDay(at))}</b></span></span>}
      </span>
      {ready ? <StudyButton kind="secondary" arrow onClick={onNewDay} testId="daily-new-day">Play today&apos;s charts</StudyButton> : null}
    </>
  )
}

/** The day's result: the end screen (EndHard) with the run log, and the day's card: the share line and its copy, the
 *  streak, the countdown to the next charts. `fresh` is the run just played (the level bar and, on a perfect day, the
 *  confetti); a second open the same day shows the same screen from the device. */
function DailyResult({ rec, streak, level, fresh, onBack, onNewDay }) {
  const rows = rec.charts
  const t = tally(rows)
  const total = rec.total
  const line = shareLine(rec.day, rows, total)
  const [copy, setCopy] = useState('idle')          // idle | copied | failed
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => {
    if (copy !== 'copied') return undefined
    const id = setTimeout(() => setCopy('idle'), 4000)
    return () => clearTimeout(id)
  }, [copy])
  const days = shownStreak(streak, rec.day)
  const best = streak?.best || 0
  const perfect = total > 0 && t.right === total
  const doCopy = async () => {
    const ok = await copyText(line)
    if (live.current) setCopy(ok ? 'copied' : 'failed')
  }
  return (
    <>
      {fresh && perfect ? <Confetti /> : null}
      <div className={`${s.kit} ${d.end}`}>
        <EndHard right={t.right} total={total} xp={t.xp} log={logRows(rows)} results={rows.map((r) => r.ok)} level={level}
          unit={total === 1 ? 'chart named' : 'charts named'} doneWord="named" showSetups={false} testIdPrefix="daily"
          againLabel={copy === 'copied' ? 'Copied' : 'Copy your score'} onAgain={doCopy} onBack={onBack}>
          <div className={d.card} data-testid="daily-card">
            <span className={d.cardHead}><UIcon name="calendar" size={14} gold={false} />{fresh ? "Today's card" : 'You played today'} · {dayLabel(rec.day)}</span>
            <span className={d.share} data-testid="daily-share">{line}</span>
            <span className={`${d.copyNote} ${copy === 'copied' ? d.copied : ''}`} role="status" data-testid="daily-copy-note">{copyNote(copy)}</span>
            <DayClock day={rec.day} onNewDay={onNewDay}>
              <span className={`${d.chip} ${d.flame}`} data-testid="daily-days">
                <UIcon name="flame" size={15} gold={false} /><span>{streakText(days)}{best > days ? ` · best ${best}` : ''}</span>
              </span>
            </DayClock>
          </div>
        </EndHard>
      </div>
    </>
  )
}

export default function DailyChartGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [today, setToday] = useState(() => etDay(new Date()))
  const [rec, setRec] = useState(() => loadDay(today))
  const [streak, setStreak] = useState(loadStreak)
  const [phase, setPhase] = useState(() => (rec?.done ? 'result' : 'start'))   // start | play | done | result
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [run, setRun] = useState(null)              // { items, offset, total }: the charts this run plays, from Start
  const [i, setI] = useState(0)
  const [level, setLevel] = useState(null)
  const recRef = useRef(rec)                        // the day as last written, for the answer handlers
  const streakRef = useRef(streak)
  const alive = useRef(true)                        // an answer can land after the sheet closed: the device takes it, the screen does not
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const done = !!rec?.done

  // the day's charts, once, unless the day is already answered (a second open never draws a new session)
  useEffect(() => {
    if (done) return undefined
    let on = true
    Promise.resolve()
      .then(() => fetcher(DAILY_URL, { method: 'POST', body: { rounds: DAILY_TOTAL, shared: true, view: DAILY_VIEW } }))
      .then((set) => { if (on) setPool(poolItems(set, normalizeBars)) })
      .catch((e) => { if (on) { setError(e); setPool(NONE) } })
    return () => { on = false }
  }, [reload, fetcher, today, done])
  useEffect(() => { pruneDays(today) }, [today])

  /** Write the day (the device and the screen), and count the streak the moment the day is answered. */
  const commit = useCallback((next) => {
    const was = recRef.current
    recRef.current = next
    saveDay(next)
    let s2 = null
    if (next?.done && !was?.done) {
      s2 = nextStreak(loadStreak() || streakRef.current, next.day)
      streakRef.current = s2
      saveStreak(s2)
    }
    if (!alive.current) return
    setRec(next)
    if (s2) setStreak(s2)
  }, [])

  const newDay = useCallback((day) => {
    const r = loadDay(day)
    recRef.current = r
    setToday(day); setRec(r); setPool(null); setError(null); setRun(null); setI(0); setLevel(null)
    setPhase(r?.done ? 'result' : 'start'); setReload((x) => x + 1)
  }, [])

  const plan = useMemo(() => (pool ? planRun(pool, rec, DAILY_TOTAL) : null), [pool, rec])
  const start = useCallback(() => {
    const now = etDay(new Date())
    if (now && now !== today) { newDay(now); return }   // midnight passed with the start screen open: today's charts first
    if (!pool) return
    // the device again: another tab may have played today since this screen opened
    const held = mergeDay(loadDay(today), recRef.current)
    if (held?.done) { commit(held); setPhase('result'); return }
    const p = planRun(pool, held, DAILY_TOTAL)
    if (!p.total) return
    const base = held ? withTotal(held, p.total) : emptyRecord(today, p.total)
    commit(base)
    if (base.done) { setPhase('result'); return }
    beginRunXp()
    setRun({ items: p.todo, offset: p.answered, total: p.total }); setI(0); setLevel(null); setPhase('play')
  }, [today, pool, commit, newDay])
  const retry = () => { setPool(null); setError(null); setReload((x) => x + 1) }

  const onScored = useCallback((row) => {
    // the device first: an answer given in another tab stands, and this one is never written over it
    const base = mergeDay(loadDay(today), recRef.current) || emptyRecord(today, run?.total || DAILY_TOTAL)
    commit(addRow(base, row))
  }, [today, run, commit])
  const finish = useCallback(() => {
    const r = recRef.current
    if (r && !r.done) commit(withTotal(r, r.charts.length))   // a chart left unplayed never holds the day open
    setLevel(runXp()); setPhase('done'); endFeedback(prefs)
  }, [commit, prefs])

  if (error && isSignedOut(error)) return <ChallengeError what="today's charts" error={error} signedOut={signedOut} onRetry={retry} />

  if ((phase === 'done' || phase === 'result') && rec?.done) {
    return <DailyResult rec={rec} streak={streak} level={phase === 'done' ? level : null} fresh={phase === 'done'} onBack={onClose}
      onNewDay={() => newDay(etDay(new Date()))} />
  }

  if (phase !== 'play' || !run) {
    const failed = !!error
    const loading = !failed && pool == null
    const answered = rec?.charts?.length || 0
    const total = plan ? plan.total : rec?.total || DAILY_TOTAL
    const left = plan ? plan.todo.length : null
    const empty = !failed && !loading && !total
    const ready = !failed && !loading && total > 0
    const days = shownStreak(streak, today)
    return (
      <div className={s.kit} style={{ padding: '26px 0 34px' }}>
        <StartArena plate="Daily" title="Daily Chart" caption="What fired today?" testId="daily-intro" startTestId="daily-start" hotkey
          total={total || DAILY_TOTAL} ready={ready} onStart={start}
          label={startLabel({ loading, failed, empty, answered, left })}
          stakes={[
            { v: total || DAILY_TOTAL, l: (total || DAILY_TOTAL) === 1 ? 'chart today' : 'charts today', icon: 'chart' },
            { v: 1, l: 'go a day', icon: 'calendar' },
            { v: days, l: 'day streak', icon: 'flame' },
          ]}
          lead={startLead({ total: total || DAILY_TOTAL, answered, right: tally(rec?.charts).right, empty, failed })}
          reward={failed || empty ? null : undefined}
          howTo={<HowItPlays mode="daily" testId="daily-howto" steps={howSteps(total || DAILY_TOTAL)} />}>
          {failed || empty ? (
            <span className={d.way} data-testid={failed ? 'daily-failed' : 'daily-empty'}>
              {failed ? <StudyButton kind="secondary" onClick={retry} testId="daily-retry">Try again</StudyButton> : null}
              <StudyButton kind="ghost" onClick={onClose} testId="daily-back">Back to Study</StudyButton>
            </span>
          ) : <span data-testid="daily-day">{dayLabel(today)} · new charts every day at midnight New York time</span>}
        </StartArena>
      </div>
    )
  }

  const item = run.items[i]
  if (!item) return null
  return (
    <Round key={item.id} idx={run.offset + i} total={run.total} day={today} item={item} results={(rec?.charts || NONE).map((r) => r.ok)}
      prefs={prefs} fetcher={fetcher} signedOut={signedOut} onScored={onScored}
      onNext={() => { if (i + 1 >= run.items.length) finish(); else setI(i + 1) }} />
  )
}
