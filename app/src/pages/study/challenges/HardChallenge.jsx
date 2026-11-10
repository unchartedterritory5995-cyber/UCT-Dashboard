// HARD MODE (production plan piece 43). Round 20 made the chart the hero; round 21 applies the owner's batch-21 ranks
// (2026-11-06), every part:
//   * correctness first: "It says that NOTHING FIRED and AAPL in this example IS an oops reversal! We cannot have
//     incorrect examples and explanations!" The pool is swept on the server (api/services/study_hard.py: a Yes chart
//     nothing else fires on, a No chart nothing fires on at all), the verdict reads the bank's key from the reveal, and
//     another setup's name is posted as itself so the server records the miss;
//   * the pointer (11/100, Cut): the spotlight band and the bottom chip are gone; the chart's own callout layer draws a
//     ring round the candle and a pill in open space with an arrow to it (ui/callout.js);
//   * the run-on (Cut; "why only do like 5-10 days continuation, we should do to the full culmination or maximization
//     of the trade and the opportunity!"): the forward strip runs to the move's furthest point and a few sessions past
//     it, quick after the first few bars, and a gold callout marks the culmination with the measured move;
//   * the ticker (Cut): no watermark across the candles; the badge carries the ticker and the company's name;
//   * the lesson (Okay; "simpler to read and more direct as a teacher and mentor"): a coach's card (ui/LessonCard);
//   * the status line, Check and Next (Weak), the keyboard hint (Cut), the start stage's title, medal, brief and Start
//     button, the end stage's medal and gems: rebuilt in the kit (ui/*, study.module.css "ROUND 21").
// The prompt line and the widget's header (both Good) are kept as they were.
// THE MODE: eight charts from the bank; the TICKER is hidden and the member names what fired on the last candle, or says
// nothing did; the chart is otherwise their own (their averages, their volume). Scored on the server against the bank's
// own key; the lesson and the ticker come back with the verdict. No hearts. Eight for eight earns Legendary, for this
// run. Every XP number shown is what the attempts earned.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRunOnTicks } from '../../../lab/fx'   // pure motion (bars running on, tick by tick); no styling rides in
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError from './ChallengeError'
import { beginRunXp, fetchForwardRest, fetchSpotPool, runXp, scoreAttempt } from './challengeBank'
import { alignTicks, developing, dueCheck, fetchIntraday, keyDays, replayChecks, showChart } from './replayTicks'
import { yesNo } from './SpotSetupChallenge'
import {
  HARD_CHART, HARD_TOTAL, NOTHING, RUN_ON_MS, SHORT_SETUPS, culmination, culminationLabel, hardAnswer, hardChoices, hardRight,
  idSeed, replayView, runLength, setupFired, tradeOf, trimLabels, withArticle,
} from './hardMode'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import { HudCombo } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { EndHard } from '../ui/EndLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import Prompt from '../ui/Prompt'
import VerdictTakeover from '../ui/VerdictTakeover'
import Stamp from '../ui/Stamp'
import StudyChart from '../ui/StudyChart'
import ChartKey from '../ui/ChartKey'
import ReplayClock from '../ui/ReplayClock'
import ReplayPause from '../ui/ReplayPause'
import { tradeAnnotations, tradeMarkers } from './tradeMarks'
import LessonCard from '../ui/LessonCard'
import { Confetti } from '../ui/Stage'
import { calloutLook, hardCallouts } from '../ui/callout'
import s from '../ui/study.module.css'

// The trade drawn on the chart as it runs on (round 23, the owner's rule 3: "they can see it all by looking at the chart
// the why and the what and where"). For a setup with its plan (the detector's own entry and stop, the house trims at 3R
// and 5R, sizing_rule.md §9): dashed rays from the signal candle for ENTRY, STOP, 3R and 5R, each with its price, and the
// action items on the bars where they happened: BOUGHT (or SHORTED), 3R, 5R, STOPPED. Without a plan, the line a close
// must not break. The levels' names come from the plan's trim_r (tradeMarks.js); nothing here hardcodes one.
// The chart's gold label at the move's best point: with a plan, the advance from the entry at the trade's own best bar,
// so the chart and the lesson say the same number; otherwise the culmination measured from the signal close.
function peakOf(trade, culm, n, k) {
  if (trade?.kind === 'plan' && trade.bestSessions) {
    const off = trade.bestSessions - 1
    if (k <= off) return null
    const v = trade.advancePct
    const sess = `${trade.bestSessions} session${trade.bestSessions === 1 ? '' : 's'}`
    // a short's gain is a fall: said as the price's move, so the chart and the lesson read the same way
    return { index: n + off, text: trade.long ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}% from entry in ${sess}` : `fell ${Math.abs(v).toFixed(1)}% from entry in ${sess}` }
  }
  return culm && k > culm.offset ? { index: n + culm.offset, text: culminationLabel(culm) } : null
}

function Q({ idx, item, total, results, prefs, fetcher, onDone }) {
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')      // ask | ok | bad
  const [takeover, setTakeover] = useState(false) // the verdict holds the whole screen until the member opens the review
  const chartBox = useRef(null)   // the review brings the chart into view (showChart)
  const [fwd, setFwd] = useState(null)
  const [lesson, setLesson] = useState('')
  const [rule, setRule] = useState(null)
  const [plan, setPlan] = useState(null)        // the setup's trade plan, from the reveal (api/services/study_trade.py)
  const [ticker, setTicker] = useState('')
  const [fired, setFired] = useState(null)
  const [xp, setXp] = useState(0)
  const [busy, setBusy] = useState(false)   // the attempt is on the wire: Check reads Checking and a second tap posts nothing
  const [restDone, setRestDone] = useState(false)   // the rest of the forward strip has come back (or there was none)
  const [intraday, setIntraday] = useState(null)    // the forward days' 30-minute bars, when the server stored them
  const shownAt = useRef(0)
  const live = useRef(true)
  useEffect(() => { shownAt.current = performance.now(); live.current = true; return () => { live.current = false } }, [])
  const phone = useIsPhone()
  const bars = item.bars
  const n = bars.length
  const choices = useMemo(() => hardChoices(item, idSeed(item.id)), [item])
  const short = SHORT_SETUPS.includes(item.name)
  const culm = useMemo(() => (fired === true ? culmination(bars[n - 1], fwd, short) : null), [fired, fwd, bars, n, short])
  const runN = runLength(fwd?.length || 0, culm, fired === true)
  const trade = useMemo(() => tradeOf(item.name, bars[n - 1], fwd, culm, fired, plan), [item.name, bars, n, fwd, culm, fired, plan])
  // the replay within the day: each forward day grows through its real 30-minute closes; slow on the trade's key days
  const ticks = useMemo(() => alignTicks(fwd, intraday), [fwd, intraday])
  const keys = useMemo(() => (ticks ? keyDays(trade, culm) : null), [ticks, trade, culm])
  // the replay stops and asks at the trims, 3R and 5R (N033; the server's own questions and answers, from the house rules
  // and the plan's words: api/services/study_trade.replay_checks)
  const [answered, setAnswered] = useState(() => new Set())
  const checks = useMemo(() => (state === 'ask' ? [] : replayChecks(trade)), [state, trade])
  const holdAt = useMemo(() => new Set(checks.filter((c) => !answered.has(c.at)).map((c) => c.session)), [checks, answered])
  const { bars: all, k, clock } = useRunOnTicks(bars, fwd, runN, state !== 'ask' && !takeover, { slowMs: RUN_ON_MS, ticks, keys, develop: developing, holdAt })
  const due = dueCheck(checks, k, answered)
  // the question shows 90 sessions; the replay starts closer (the owner: "the replay starts way too far back"), 40
  // sessions of history and the signal, and widens as each day arrives so the whole run stays in view
  const view = state === 'ask' ? Math.min(90, all?.length || 0) : replayView(all?.length || 0, n)
  const look = useMemo(() => calloutLook(phone), [phone])
  const truth = fired === true ? item.name : fired === false ? NOTHING : 'The answer'
  const callouts = useMemo(() => hardCallouts({
    index: n - 1,
    label: state === 'ask' ? 'What fired here?' : truth,   // N068: the pointer carries the question to the candle
    tone: state,
    peak: peakOf(trade, culm, n, k),
  }), [n, state, truth, culm, k, trade])
  // round 22: the trade the lesson reviews, drawn on the chart as it runs on (the Kicker's entry and stop on the owner's
  // rules; for any other setup the line a close must not break)
  const tradeLines = useMemo(() => (state === 'ask' ? null : tradeAnnotations(trade, bars[n - 1], all)), [state, trade, bars, n, all])
  const tradeMarks = useMemo(() => (state === 'ask' ? null : tradeMarkers(trade, all, n)), [state, trade, all, n])
  const check = async () => {
    if (pick == null || state !== 'ask' || busy) return
    setBusy(true)
    const picked = choices[pick]
    const { yes, no } = yesNo(item.choices)
    let right = false
    let wasFired = null
    let attempt = null
    try {
      attempt = await scoreAttempt(item, hardAnswer(picked, item, yes, no), performance.now() - shownAt.current, fetcher)
      right = hardRight(picked, item, attempt.correct)
      wasFired = setupFired(picked, item, attempt.correct, attempt.reveal?.answer)
      setFwd(attempt.forward); setLesson(attempt.reveal?.lesson || ''); setRule(attempt.reveal?.setup_rule || null); setPlan(attempt.reveal?.trade || null)
      setTicker(attempt.reveal?.sym || attempt.reveal?.ticker || ''); setXp(Number(attempt.progress?.xp_gained || 0))
    } catch { right = false }
    if (!live.current) return
    setBusy(false); setFired(wasFired); setState(right ? 'ok' : 'bad'); setTakeover(true); revealFeedback(right, prefs)
    // the rest of the forward strip, so the run-on can reach the move's culmination
    if (attempt) {
      fetchIntraday(attempt, fetcher).then((d) => { if (live.current && d) setIntraday(d) })
      fetchForwardRest(attempt, attempt.forward.length, fetcher).then((more) => {
        if (!live.current) return
        if (more.length) setFwd((f) => [...(f || []), ...more])
        setRestDone(true)
      })
    } else {
      setRestDone(true)
    }
  }
  // the number keys pick a pill; Enter is the action button's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    const onKey = (e) => {
      if (state !== 'ask' || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const i = +e.key - 1
      if (i >= 0 && i < choices.length) setPick(i)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [state, choices.length])
  const picked = pick == null ? null : choices[pick]
  // the tile the verdict lights green: the pick when it was right, else what the bank's key says fired (or nothing)
  const answerLabel = state === 'ok' ? picked : state === 'bad' && fired != null ? (fired ? item.name : NOTHING) : null
  const last = idx + 1 >= total
  const mood = state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'
  const where = ticker || 'this chart'
  const xpNote = xp > 0 ? ` · +${xp} XP` : ''
  const headline = state === 'ok'
    ? (fired === false ? 'Right. Nothing fired.' : 'Named it.')
    : fired === true ? `It was ${withArticle(item.name)}.` : fired === false ? 'Nothing fired here.' : 'Not this one.'
  const detail = state === 'ok'
    ? (fired === false ? <><b>{where}</b> · no setup on the last candle{xpNote}</> : <>{item.name} on <b>{where}</b>{xpNote}</>)
    : fired === true ? <><b>{where}</b> · you said {picked === NOTHING ? 'nothing fired' : picked}</>
      : fired === false ? <><b>{where}</b> · not {withArticle(picked)}</> : <b>{where}</b>
  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="hard-question" data-state={state} data-run={state !== 'ask' && restDone && k >= runN ? 'done' : 'running'}>
      {state !== 'ask' ? <span className={`${s.flash} ${state === 'ok' ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {state !== 'ask' && takeover ? <VerdictTakeover ok={state === 'ok'} title={headline} sub={detail} stampWord={state === 'ok' && fired === false ? 'Right' : null}
        label={trade?.kind === 'plan' ? 'See the trade' : 'See why'} onContinue={() => { setTakeover(false); showChart(chartBox.current) }} testId="hard-takeover" /> : null}
      <HudCombo step={idx} total={total} results={results} live={state === 'ask'} />
      <div className={`${s.heroChart} ${state === 'bad' ? s.shake : ''}`} ref={chartBox}>
        <StudyChart id={item.id} bars={all} view={view} height={phone ? 340 : 520} chartOpts={HARD_CHART}
          callouts={callouts} calloutLook={look} symbol={ticker || null} masked={state === 'ask' || !ticker} annotations={tradeLines} markers={tradeMarks}
          frameEnd={state === 'ask' ? null : all?.[all.length - 1]?.t} />
        <ReplayClock clock={clock} tfMin={intraday?.tf || 30} testId="hard-clock" />
      </div>
      {due ? <ReplayPause key={due.at} check={due} labels={trimLabels(trade)} onDone={() => { setAnswered((a) => new Set([...a, due.at])); showChart(chartBox.current) }} testId="hard-pause" /> : null}
      {state !== 'ask' && trade ? <ChartKey trade={trade} testId="hard-key" /> : null}
      <AnswerLessonApp choices={choices} pick={pick} state={state} answer={answerLabel} step={idx} total={total} busy={busy} hotkey={!takeover && !due}
        onPick={(i) => { if (state === 'ask') { setPick(i); tapFeedback(prefs) } }} onCheck={check}
        onNext={() => onDone(state === 'ok', xp, ticker, fired === false ? NOTHING : item.name, picked)} nextLabel={last ? 'See the run' : 'Next'}
        head={<Prompt mood={mood} tone={state} size={phone ? 40 : 48} title={headline} sub={detail}
          seal={<Stamp ok={state === 'ok'} word={state === 'ok' && fired === false ? 'Right' : null} inline />} />}
        cardsTestId="hard-cards" checkTestId="hard-check" nextTestId="hard-next" />
      {state !== 'ask' && (lesson || rule) ? (
        <LessonCard text={lesson} ticker={ticker || null} setup={item.name} skillId={item.skill_id || item.skill || null} fired={fired} bars={bars} setupRule={rule} trade={trade} showReads={false} />
      ) : null}
    </div>
  )
}

function Done({ right, total, xp, log, results, onBack, onAgain }) {
  const perfect = total > 0 && right === total
  return (
    <>
      {perfect ? <Confetti /> : null}
      <div className={s.kit}><EndHard right={right} total={total} xp={xp} log={log} results={results} onAgain={onAgain} onBack={onBack} level={runXp()} /></div>
    </>
  )
}

export default function HardChallenge({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('intro')    // intro | play | done
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [i, setI] = useState(0)
  const [right, setRight] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  const [xp, setXp] = useState(0)
  const [run, setRun] = useState(0)
  useEffect(() => {
    let on = true
    fetchSpotPool(undefined, 4, fetcher, undefined, { hard: true }).then((p) => { if (on) setPool(p) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])
  const total = Math.min(HARD_TOTAL, pool?.length || 0)
  const items = useMemo(() => (pool ? pool.slice(0, HARD_TOTAL) : []), [pool, run])   // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { beginRunXp(); setPhase('play'); setI(0); setRight(0); setResults([]); setLog([]); setXp(0); setRun((r) => r + 1); if (pool) setPool((p) => [...p.slice(HARD_TOTAL), ...p.slice(0, HARD_TOTAL)]) }
  const again = () => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('intro') }

  if (error) return <ChallengeError what="the hard-mode charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'intro') {
    const count = total || HARD_TOTAL
    return (
      <div className={s.kit} style={{ padding: '26px 0 34px' }}>
        <StartArena total={count} ready={!!pool?.length} hotkey onStart={() => pool?.length && start()} testId="hard-intro" startTestId="hard-start"
          label={pool == null ? 'Loading the bank' : pool.length ? 'Start' : 'No charts yet'}
          howTo={<HowItPlays mode="hard" testId="hard-howto" steps={[
            { icon: 'lock', title: 'Read the chart', body: 'A real chart from the UCT bank with the ticker hidden. The last candle is ringed.' },
            { icon: 'eye', title: 'Name what fired', body: 'Pick the setup that fired on that candle, or Nothing fired. One try each.' },
            { icon: 'play', title: 'Watch the trade', body: 'The chart runs on with the trade drawn: entry, stop, the trims at 3R and 5R, and a key that says why each level sits there.' },
          ]} />} />
      </div>
    )
  }
  if (phase === 'done') return <Done right={right} total={total} xp={xp} log={log} results={results} onBack={onClose} onAgain={again} />
  const item = items[i]
  if (!item) return <p className={`${s.kit} ${s.heroSub}`}>No charts in the bank yet.</p>
  return (
    <Q key={`${run}-${i}`} idx={i} item={item} total={total} results={results} prefs={prefs} fetcher={fetcher}
      onDone={(ok, gained, ticker, truth, said) => {
        setXp((v) => v + (gained || 0)); if (ok) setRight((v) => v + 1); setResults((r) => [...r, !!ok])
        setLog((l) => [...l, { name: truth || item.name, ticker: ticker || '', ok: !!ok, said: ok ? null : said }])
        if (i + 1 >= total) { setPhase('done'); endFeedback(prefs) } else setI(i + 1)
      }} />
  )
}
