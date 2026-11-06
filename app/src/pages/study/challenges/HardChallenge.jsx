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
import { useCountUp, useRunOnTo } from '../../../lab/fx'   // pure motion (bars running on, a count-up); no styling rides in
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError from './ChallengeError'
import { fetchForwardRest, fetchSpotPool, scoreAttempt } from './challengeBank'
import { yesNo } from './KickerChallenge'
import {
  HARD_CHART, HARD_TOTAL, NOTHING, RUN_ON_MS, SHORT_SETUPS, culmination, culminationLabel, hardAnswer, hardChoices, hardRight,
  idSeed, runLength, setupFired, withArticle,
} from './hardMode'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import { Medal, ScoreRing } from '../ui/Medal'
import Hud from '../ui/Hud'
import Prompt from '../ui/Prompt'
import Choice, { ChoiceGrid } from '../ui/Choice'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import StudyChart from '../ui/StudyChart'
import LessonCard from '../ui/LessonCard'
import Stage, { Confetti, Rules, RunLog, StatCard } from '../ui/Stage'
import { calloutLook, hardCallouts } from '../ui/callout'
import s from '../ui/study.module.css'

const RULES = [
  { icon: 'lock', title: 'No ticker', text: 'The name stays hidden until you answer.' },
  { icon: 'chart', title: 'Your chart', text: 'Your own averages and your own volume.' },
  { icon: 'flag', title: 'Name it', text: 'What fired on the last candle, or nothing did.' },
]

function Q({ idx, item, total, results, prefs, fetcher, onDone }) {
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')      // ask | ok | bad
  const [fwd, setFwd] = useState(null)
  const [lesson, setLesson] = useState('')
  const [rule, setRule] = useState(null)
  const [ticker, setTicker] = useState('')
  const [fired, setFired] = useState(null)
  const [xp, setXp] = useState(0)
  const [busy, setBusy] = useState(false)   // the attempt is on the wire: Check reads Checking and a second tap posts nothing
  const [restDone, setRestDone] = useState(false)   // the rest of the forward strip has come back (or there was none)
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
  const { bars: all, k } = useRunOnTo(bars, fwd, runN, state !== 'ask', { slowMs: RUN_ON_MS })
  const view = Math.min(90, all?.length || 0)
  const look = useMemo(() => calloutLook(phone), [phone])
  const truth = fired === true ? item.name : fired === false ? NOTHING : 'The answer'
  const callouts = useMemo(() => hardCallouts({
    index: n - 1,
    label: state === 'ask' ? 'Last candle' : truth,
    tone: state,
    peak: culm && k > culm.offset ? { index: n + culm.offset, text: culminationLabel(culm) } : null,
  }), [n, state, truth, culm, k])
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
      setFwd(attempt.forward); setLesson(attempt.reveal?.lesson || ''); setRule(attempt.reveal?.setup_rule || null)
      setTicker(attempt.reveal?.sym || attempt.reveal?.ticker || ''); setXp(Number(attempt.progress?.xp_gained || 0))
    } catch { right = false }
    if (!live.current) return
    setBusy(false); setFired(wasFired); setState(right ? 'ok' : 'bad'); revealFeedback(right, prefs)
    // the rest of the forward strip, so the run-on can reach the move's culmination
    if (attempt) {
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
  const rightCard = (c) => state === 'bad' && fired != null && ((fired && c === item.name) || (!fired && c === NOTHING))
  const cardState = (c, i) => {
    if (state === 'ask') return pick === i ? 'sel' : 'idle'
    if (pick === i) return state === 'ok' ? 'right' : 'wrong'
    if (rightCard(c)) return 'right'
    return 'quiet'
  }
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
      {state !== 'ask' ? <Stamp ok={state === 'ok'} word={state === 'ok' && fired === false ? 'Right' : null} pop /> : null}
      <Hud mode="hard" step={idx} total={total} results={results} live={state === 'ask'} />
      <div className={`${s.heroChart} ${state === 'bad' ? s.shake : ''}`}>
        <StudyChart id={item.id} bars={all} view={view} height={phone ? 340 : 520} chartOpts={HARD_CHART}
          callouts={callouts} calloutLook={look} symbol={ticker || null} masked={state === 'ask' || !ticker} />
      </div>
      <Prompt mood={mood} tone={state} size={phone ? 40 : 48}
        title={state === 'ask' ? 'What fired on the last candle?' : headline}
        sub={state === 'ask' ? <>Your chart, without its name. <b>Name it</b>, or say nothing did.</> : detail}
        seal={state !== 'ask' ? <Stamp ok={state === 'ok'} word={state === 'ok' && fired === false ? 'Right' : null} inline /> : null} />
      <ChoiceGrid row testId="hard-cards" label="Your answer">
        {choices.map((c, i) => (
          <Choice key={c} pill n={i + 1} i={i} label={c} state={cardState(c, i)} disabled={state !== 'ask'} onClick={() => { setPick(i); tapFeedback(prefs) }} />
        ))}
      </ChoiceGrid>
      <div className={s.actionBar}>
        {state === 'ask'
          ? <StudyButton kind="primary" size="xl" arrow wide={phone} hotkey="Enter" busy={busy} disabled={pick == null} onClick={check} testId="hard-check">{busy ? 'Checking' : 'Check'}</StudyButton>
          : <StudyButton kind={state === 'ok' ? 'good' : 'bad'} size="xl" arrow wide={phone} hotkey="Enter" onClick={() => onDone(state === 'ok', xp, ticker, fired === false ? NOTHING : item.name, picked)} testId="hard-next">{last ? 'See the run' : 'Next'}</StudyButton>}
      </div>
      {state !== 'ask' && (lesson || rule) ? (
        <LessonCard text={lesson} ticker={ticker || null} setup={item.name} fired={fired} bars={bars} setupRule={rule} />
      ) : null}
    </div>
  )
}

const VERDICT_WORD = (right, total) => {
  const r = total ? right / total : 0
  if (total > 0 && right === total) return 'Legendary'
  if (r >= 0.75) return 'Sharp eyes'
  if (r >= 0.5) return 'Getting there'
  return 'Tough run'
}

function bestStreak(results) {
  let best = 0, run = 0
  for (const r of results) { run = r ? run + 1 : 0; if (run > best) best = run }
  return best
}

function Done({ right, total, xp, log, results, onBack, onAgain }) {
  const perfect = total > 0 && right === total
  const shown = useCountUp(xp, true, 28)
  const acc = total ? Math.round((right / total) * 100) : 0
  return (
    <>
      {perfect ? <Confetti /> : null}
      <Stage full hero legend={perfect} rays={perfect} eyebrow="Hard mode · the run" title={VERDICT_WORD(right, total)} titleClass={perfect ? s.titleMetal : s.titleRun}
        sub={perfect ? `${total} for ${total} without a ticker. Legendary, for this run.` : `${right} of ${total} named without a ticker.`}
        art={perfect ? <Medal lit ignite size={112} /> : <ScoreRing value={right} total={total} />} testId="hard-done"
        actions={<>
          <StudyButton kind="primary" size="xl" arrow hotkey="Enter" onClick={onAgain} testId="hard-again">Run it again</StudyButton>
          <StudyButton kind="ghost" onClick={onBack}>Back to Study</StudyButton>
        </>}>
        {perfect ? null : <span className={s.legendHint}><Medal size={22} testId="legend-medal" /> {total} for {total} lights the Legendary medal</span>}
        <div className={s.stats}>
          <StatCard i={0} icon="star" label="XP earned" value={`+${shown}`} tone="gold" testId="hard-xp" />
          <StatCard i={1} icon="check" label="Named" value={`${right}/${total}`} tone="green" testId="hard-right" />
          <StatCard i={2} icon="flame" label="Best streak" value={bestStreak(results)} tone="flame" testId="hard-streak" />
        </div>
        <span className={s.accuracy}>{acc}% accuracy</span>
        <RunLog rows={log} />
      </Stage>
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
  const start = () => { setPhase('play'); setI(0); setRight(0); setResults([]); setLog([]); setXp(0); setRun((r) => r + 1); if (pool) setPool((p) => [...p.slice(HARD_TOTAL), ...p.slice(0, HARD_TOTAL)]) }
  const again = () => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('intro') }

  if (error) return <ChallengeError what="the hard-mode charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'intro') {
    const count = total || HARD_TOTAL
    return (
      <Stage full hero eyebrow={`Challenge · ${count} charts`} title="Hard mode" titleClass={s.titleMetal} art={<Medal size={92} />} testId="hard-intro"
        actions={<StudyButton kind="primary" size="xl" arrow hotkey="Enter" disabled={!pool?.length} onClick={() => pool?.length && start()} testId="hard-start">
          {pool == null ? 'Loading the bank' : pool.length ? 'Start' : 'No charts yet'}
        </StudyButton>}
        below={<span className={s.reward}><b>{count} for {count}</b> · lights the Legendary medal</span>}>
        <Rules items={RULES} />
      </Stage>
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
