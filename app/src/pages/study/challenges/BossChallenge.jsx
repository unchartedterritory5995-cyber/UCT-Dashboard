// BOSS (ported from the workbench's Boss V3 under the owner's delegation, 2026-11-03). Ten charts from the bank,
// one heart: miss once and it ends. Every chart is scored on the server (and earns XP like any attempt); the
// follow-through runs on from the item's own forward bars. The XP shown at the end is what the attempts earned,
// never a number invented here; a boss bonus is a server decision for later.
import { useEffect, useMemo, useRef, useState } from 'react'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import { Medal } from '../ui/Medal'
import { Confetti } from '../../../lab/bits'
import { useRunOnTicks } from '../../../lab/fx'
import { rayAt } from '../../../lab/pointers'
import { calloutLook, hardCallouts } from '../ui/callout'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudCombo } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import Prompt from '../ui/Prompt'
import VerdictTakeover from '../ui/VerdictTakeover'
import UiStamp from '../ui/Stamp'
import LessonCard from '../ui/LessonCard'
import { replayView, reviewTrade } from './hardMode'
import { tradeAnnotations, tradeMarkers } from './tradeMarks'
import ChartKey from '../ui/ChartKey'
import ReplayClock from '../ui/ReplayClock'
import ReplayPause from '../ui/ReplayPause'
import s2 from '../ui/study.module.css'
import d5 from '../../../lab/duo.module.css'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { BOSS_TOTAL, beginRunXp, fetchSpotPool, runXp, scoreAttempt } from './challengeBank'
import { alignTicks, developing, dueCheck, fetchIntraday, keyDays, replayChecks, showChart } from './replayTicks'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'

function Q({ idx, item, total, onDone, prefs, fetcher }) {
  const phone = useIsPhone()
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const [takeover, setTakeover] = useState(false)
  const chartBox = useRef(null)   // the review brings the chart into view (showChart)
  const [fwd, setFwd] = useState(null)
  const [intraday, setIntraday] = useState(null)   // the forward days' 30-minute bars, when the server stored them
  const [why, setWhy] = useState('')
  const [plan, setPlan] = useState(null)
  const [xp, setXp] = useState(0)
  const [sym, setSym] = useState('')
  const shownAt = useRef(0)
  useEffect(() => { shownAt.current = performance.now() }, [])
  const bars = item.bars
  const n = bars.length
  const signal = bars[n - 1]
  const trade = useMemo(() => (plan && state !== 'ask' ? reviewTrade(plan, signal, fwd) : null), [plan, state, signal, fwd])
  // the replay within the day: each forward day grows through its real 30-minute closes; slow on the trade's key days
  const ticks = useMemo(() => alignTicks(fwd, intraday), [fwd, intraday])
  const keys = useMemo(() => (ticks ? keyDays(trade) : null), [ticks, trade])
  // the replay stops and asks at 2R and 3R (N033; the plan's own questions, api/services/study_trade.replay_checks)
  const [answered, setAnswered] = useState(() => new Set())
  const checks = useMemo(() => (state === 'ask' ? [] : replayChecks(trade)), [state, trade])
  const holdAt = useMemo(() => new Set(checks.filter((c) => !answered.has(c.at)).map((c) => c.session)), [checks, answered])
  const { bars: all, k, clock } = useRunOnTicks(bars, fwd, fwd?.length || 0, state !== 'ask' && !takeover,
    { slowMs: 160, fastMs: 160, ticks, keys, develop: developing, holdAt })
  const due = dueCheck(checks, k, answered)
  // the pointer is the one Hard mode uses (the owner's rule 4: a designed arrow and label in open space, never over a
  // candle); after the verdict the close stays marked with a ray
  const ann = useMemo(() => (!n || !all || state === 'ask' ? null : rayAt(bars[n - 1], 'l', { id: `b${idx}l`, label: '' })), [all, bars, n, state, idx])
  // N068 ("detailing the question much more"): the pointer asks about the setup at the candle
  const callouts = useMemo(() => (n ? hardCallouts({ index: n - 1, label: state === 'ask' ? `${item.name} here?` : state === 'ok' ? 'You were right' : 'The answer', tone: state }) : []), [n, state, item.name])
  const look = useMemo(() => calloutLook(phone), [phone])
  const check = async () => {
    if (pick == null || state !== 'ask') return
    const choice = item.choices[pick]
    let ok = false
    try {
      const a = await scoreAttempt(item, { choice }, performance.now() - shownAt.current, fetcher)
      ok = !!a.correct; setFwd(a.forward); fetchIntraday(a, fetcher).then((d) => { if (d) setIntraday(d) }); setWhy(a.reveal?.lesson || ''); setPlan(a.reveal?.trade || null); setXp(Number(a.progress?.xp_gained || 0)); setSym(a.reveal?.sym || a.reveal?.ticker || '')
    } catch { ok = false }
    setState(ok ? 'ok' : 'bad'); setTakeover(true); revealFeedback(ok, prefs)
  }
  useEffect(() => {
    const k = (e) => {
      if (state !== 'ask' || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const i = +e.key - 1; if (i >= 0 && i < item.choices.length) setPick(i)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [state, item.choices.length])
  // one heart: every chart before this one was named, so the status line's marks are gold up to here
  const results = [...Array(idx).fill(true), ...(state === 'ask' ? [] : [state === 'ok'])]
  const picked = pick == null ? null : item.choices[pick]
  const answer = state === 'ask' ? null : state === 'ok' ? picked : (item.choices.find((c) => c !== picked) ?? null)
  // the trade on the chart and its key, as in Hard mode (the levels, BOUGHT, the targets, STOPPED OUT)
  const view = state === 'ask' ? Math.min(90, all?.length || 0) : replayView(all?.length || 0, n)
  const marks = useMemo(() => (trade ? tradeAnnotations(trade, signal, all) : null), [trade, signal, all])
  const actions = useMemo(() => (trade ? tradeMarkers(trade, all, n) : null), [trade, all, n])
  return (
    <div className={`${s2.kit} ${s2.screen}`} data-testid="boss-question">
      {state !== 'ask' ? <span className={`${s2.flash} ${state === 'ok' ? s2.ok : s2.bad}`} aria-hidden="true" /> : null}
      {state === 'bad' ? <div className={d5.vignetteRed} /> : null}
      {state !== 'ask' && takeover ? <VerdictTakeover ok={state === 'ok'} title={state === 'ok' ? 'Still standing.' : 'That was the heart.'}
        answer={answer} sub={<>{item.name}{sym ? <> · <b>{sym}</b></> : null}</>} xp={xp} label={trade ? 'See the trade' : 'See why'} onContinue={() => { setTakeover(false); showChart(chartBox.current) }} testId="boss-takeover" /> : null}
      <HudCombo label="Boss" step={idx} total={total} results={results} live={state === 'ask'} stepTestId="boss-step" />
      <div className={`${s2.heroChart} ${state === 'bad' ? s2.shake : ''}`} ref={chartBox}>
        <ChallengeChart id={item.id} bars={all} view={view} height={phone ? 340 : 480} annotations={marks || ann} markers={actions} callouts={callouts} calloutLook={look} fetcher={fetcher}
          frameEnd={state === 'ask' ? null : all?.[all.length - 1]?.t} />
        <ReplayClock clock={clock} tfMin={intraday?.tf || 30} testId="boss-clock" />
      </div>
      {due ? <ReplayPause key={due.at} check={due} onDone={() => { setAnswered((a) => new Set([...a, due.at])); showChart(chartBox.current) }} testId="boss-pause" /> : null}
      {trade ? <ChartKey trade={trade} testId="boss-key" /> : null}
      <AnswerLessonApp choices={item.choices} pick={pick} state={state} answer={answer} step={idx} total={total} hotkey={!takeover && !due}
        eyebrow={<>Boss · chart {idx + 1} of {total} · one heart</>}
        question={item.q}
        detail={<>The ringed candle is the last bar on this chart. Say <b>Yes</b> if the {item.name} fires on it, <b>No</b> if it does not. One miss ends the run.</>}
        onPick={(i) => { if (state === 'ask') { setPick(i); tapFeedback(prefs) } }} onCheck={check}
        onNext={() => onDone(state === 'ok', item, xp, picked, sym)} nextLabel={state === 'ok' ? (idx + 1 < total ? 'Next' : 'Claim the trophy') : 'See what to review'}
        head={<Prompt mood={state === 'ok' ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={state === 'ok' ? 'Still standing.' : 'That was the heart.'}
          sub={<>{item.name} · the answer was <b>{answer}</b>{xp > 0 ? ` · +${xp} XP` : ''}</>} seal={<UiStamp ok={state === 'ok'} inline />} />}
        cardsTestId="boss-cards" checkTestId="boss-check" nextTestId="boss-next" />
      {state !== 'ask' && (why || trade) ? <LessonCard text={why} setup={item.name} skillId={item.skill_id || item.skill || null} fired={null} trade={trade} showReads={false} testId="boss-lesson" /> : null}
    </div>
  )
}

export default function BossChallenge({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('intro')    // intro | play | win | fail
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [i, setI] = useState(0)
  const [missed, setMissed] = useState(null)
  const [run, setRun] = useState(0)
  const [xp, setXp] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  useEffect(() => {
    let on = true
    fetchSpotPool(undefined, 4, fetcher).then((p) => { if (on) setPool(p) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])
  const total = Math.min(BOSS_TOTAL, pool?.length || 0)
  const items = useMemo(() => (pool ? pool.slice(0, BOSS_TOTAL) : []), [pool, run])   // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { beginRunXp(); setPhase('play'); setI(0); setMissed(null); setXp(0); setResults([]); setLog([]); setRun((r) => r + 1); if (pool) setPool((p) => [...p.slice(BOSS_TOTAL), ...p.slice(0, BOSS_TOTAL)]) }

  if (error) return <ChallengeError what="the boss charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  const again = () => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('intro') }
  // one design for every mode (the owner, 2026-11-08): Hard mode's start and end screens, the Boss's own words on them
  if (phase === 'intro') {
    return (
      <div className={s2.kit}>
        <StartArena plate="Boss" title="Boss" caption="Does it fire on the last candle?" testId="boss-intro" startTestId="boss-start" hotkey
          total={total || BOSS_TOTAL} stakes={[{ v: total || BOSS_TOTAL, l: 'charts', icon: 'play' }, { v: 1, l: 'heart', icon: 'shield' }, { v: 1, l: 'miss ends it', icon: 'flame' }]} ready={!!pool?.length} onStart={() => pool?.length && start()}
          label={pool == null ? 'Loading the bank' : pool.length ? 'Face the boss' : 'No charts yet'}
          reward={<><Medal size={40} testId={null} /><span><b>{total || BOSS_TOTAL} for {total || BOSS_TOTAL}</b> wins the trophy</span></>}
          howTo={<HowItPlays mode="boss" testId="boss-howto" steps={[
            { icon: 'eye', title: 'A setup is named', body: 'Each chart comes with a setup. Read it and its last candle.' },
            { icon: 'check', title: 'Yes or No', body: 'Yes if the setup fires on the last candle, No if it does not.' },
            { icon: 'flame', title: 'One heart', body: 'One miss ends the run. Clear every chart and the trophy is yours.' },
          ]} />} />
      </div>
    )
  }
  if (phase === 'win' || phase === 'fail') {
    const won = phase === 'win'
    return (
      <div className={s2.kit}>
        {won ? <Confetti /> : null}
        <EndHard right={won ? total : i} total={total} xp={xp} results={results} log={log} level={runXp()}
          title={won ? 'Boss cleared' : 'Not yet'} unit="read with one heart" doneWord="read" medal={false}
          againLabel={won ? 'Face the boss again' : 'Try the boss again'} testIdPrefix="boss" onAgain={again} onBack={onClose}>
          {won ? <>Every chart read with one heart. <b>That is a trader.</b></> : <>The heart went on chart {i + 1}, a <b>{missed?.name || 'setup'}</b> chart. A boss needs every rule cold.</>}
        </EndHard>
      </div>
    )
  }
  const item = items[i]
  if (!item) return <p className={d5.startLead}>No charts in the bank yet.</p>
  return <Q key={`${run}-${i}`} idx={i} item={item} total={total} prefs={prefs} fetcher={fetcher} onDone={(ok, it, gained, said, ticker) => { setXp((v) => v + (gained || 0)); setResults((r) => [...r, !!ok]); setLog((l) => [...l, { name: it.name, ticker: ticker || '', ok, said: said ?? '', was: ok ? '' : (it.choices.find((c) => c !== said) ?? '') }]); if (!ok) { setMissed(it); setPhase('fail'); return } if (i + 1 >= total) { setPhase('win'); endFeedback(prefs) } else setI(i + 1) }} />
}
