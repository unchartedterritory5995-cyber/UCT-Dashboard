// DRAW IT, in the product (2026-11-08; the owner's notes on the lab's draw game: "Show the entry as a line and explain
// why and where and how simply and easily" · "the ease of placement and adjustment for stop can be easier" · "the
// drawing tool ... placing it properly in the right spot" · "i dont like the throbbing gold around the chart"). A real
// setup chart (the Spot the Setup pool: its last candle is the setup and nothing else); tap the chart at your entry, then
// at your stop; tap a chip to move that line again. Check scores both on the server against the setup's own plan
// (POST /api/study/draw/score, study_trade.plan); the review draws the plan's levels beside yours, the chart key says why
// each sits there, and the chart runs on. On the shared design: the arena start, the status line, the question header,
// one Check bar, the full-screen verdict, the coin end screen.
import { useEffect, useMemo, useRef, useState } from 'react'
import StudyButton from '../ui/StudyButton'
import { HudCombo } from '../ui/HudLooks'
import { EndHard } from '../ui/EndLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import VerdictTakeover from '../ui/VerdictTakeover'
import Prompt from '../ui/Prompt'
import UiStamp from '../ui/Stamp'
import ChartKey from '../ui/ChartKey'
import ReplayClock from '../ui/ReplayClock'
import ReplayPause from '../ui/ReplayPause'
import s2 from '../ui/study.module.css'
import sa from '../ui/answerLooks.module.css'
import lab from '../../../lab/lab.module.css'
import { useRunOnTicks } from '../../../lab/fx'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { replayView, reviewTrade, withArticle } from './hardMode'
import { tradeAnnotations, tradeMarkers } from './tradeMarks'
import { alignTicks, developing, dueCheck, keyDays, replayChecks, showChart } from './replayTicks'
import { setupName } from './challengeBank'
import { normalizeBars, studyFetch } from '../useStudySession'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'

const ROUNDS = 6
const NO_PLAN = new Set(['setup.family3.bear_gap'])   // no trade is defined for the Bear gap (docs/study/TRADE_PLANS.md)
const r2 = (v) => Math.round(v * 100) / 100

async function loadPool(fetcher) {
  const set = await fetcher('/api/study/spot-setup', { method: 'POST', body: { rounds: ROUNDS + 4, view: 90, seed: `draw-${Date.now()}`, need_plan: true } })
  return (set?.items || []).filter((it) => it.bars?.bars?.length && !NO_PLAN.has(it.skill_id)).slice(0, ROUNDS)
    .map((it) => ({ id: it.id, skill: it.skill_id, name: setupName(it.skill_id), bars: normalizeBars(it.bars) }))
}

function Round({ idx, total, item, results, prefs, fetcher, onDone }) {
  const phone = useIsPhone()
  const vis = item.bars
  const n = vis.length
  const [entry, setEntry] = useState(null)
  const [stop, setStop] = useState(null)
  const [active, setActive] = useState('entry')
  const [state, setState] = useState('ask')          // ask | ok | bad
  const [takeover, setTakeover] = useState(false)
  const chartBox = useRef(null)   // the review brings the chart into view (showChart)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const fwd = useMemo(() => (res ? normalizeBars(res.forward_bars || []) : []), [res])
  const trade = useMemo(() => (res?.plan ? reviewTrade(res.plan, vis[n - 1], fwd) : null), [res, vis, n, fwd])
  // the replay within the day: each forward day grows through its real 30-minute closes; slow on the trade's key days
  const intraday = useMemo(() => (res?.forward_intraday?.days ? { tf: Number(res.forward_intraday.tf) || 30, days: res.forward_intraday.days } : null), [res])
  const ticks = useMemo(() => alignTicks(fwd, intraday), [fwd, intraday])
  const keys = useMemo(() => (ticks ? keyDays(trade) : null), [ticks, trade])
  // the replay stops and asks at 2R and 3R (N033; the plan's own questions, api/services/study_trade.replay_checks)
  const [answered, setAnswered] = useState(() => new Set())
  const checks = useMemo(() => (state === 'ask' ? [] : replayChecks(trade)), [state, trade])
  const holdAt = useMemo(() => new Set(checks.filter((c) => !answered.has(c.at)).map((c) => c.session)), [checks, answered])
  const { bars: all, k, clock } = useRunOnTicks(vis, fwd, fwd.length, state !== 'ask' && !takeover,
    { slowMs: 200, fastMs: 200, ticks, keys, develop: developing, holdAt })
  const due = dueCheck(checks, k, answered)

  const tap = ({ price }) => {
    if (state !== 'ask' || !Number.isFinite(price)) return
    const p = r2(price)
    if (active === 'entry') { setEntry(p); if (stop == null) setActive('stop') } else { setStop(p); setActive(entry == null ? 'entry' : 'stop') }
    tapFeedback(prefs)
  }
  const shownView = state === 'ask' ? Math.min(all.length, 80) : replayView(all.length, n)
  const annotations = useMemo(() => {
    const t0 = vis[n - 1]?.t
    const mine = []
    if (entry != null) mine.push({ id: 'my-entry', type: 'hray', points: [{ time: t0, price: entry }], color: '#f6e2a0', lineWidth: 2, lineStyle: 'dashed', showPriceLabel: true })
    if (stop != null) mine.push({ id: 'my-stop', type: 'hray', points: [{ time: t0, price: stop }], color: '#ff8a7a', lineWidth: 2, lineStyle: 'dashed', showPriceLabel: true })
    const plan = state !== 'ask' && trade ? (tradeAnnotations(trade, vis[n - 1], all) || []) : []
    return [...plan, ...mine]
  }, [entry, stop, state, trade, vis, n, all])
  const actions = useMemo(() => (state === 'ask' ? null : tradeMarkers(trade, all, n)), [state, trade, all, n])

  const check = async () => {
    if (entry == null || stop == null || busy || state !== 'ask') return
    setBusy(true)
    let r = null
    try { r = await fetcher('/api/study/draw/score', { method: 'POST', body: { item_id: item.id, entry, stop } }) } catch { r = null }
    if (!live.current) return
    setBusy(false)
    if (!r) { setFailed(true); return }
    setRes(r); setState(r.correct ? 'ok' : 'bad'); setTakeover(true); revealFeedback(!!r.correct, prefs)
  }
  const ok = state === 'ok'
  const offLine = res ? <>Entry <b>{res.entry.off_pct}%</b> off · Stop <b>{res.stop.off_pct}%</b> off{res.sym ? <> · <b>{res.sym}</b></> : null}</> : null
  const title = ok ? 'Right on the plan.' : res && (res.entry.ok || res.stop.ok) ? (res.entry.ok ? 'Entry right, stop off.' : 'Stop right, entry off.') : 'Not quite the plan.'
  const chip = (which, label, value) => (
    <button type="button" className={`${s2.drawChip} ${active === which && state === 'ask' ? s2.drawChipOn : ''} ${which === 'stop' ? s2.drawChipStop : ''}`}
      onClick={() => state === 'ask' && setActive(which)} data-testid={`draw-${which}`} aria-pressed={active === which}>
      <small>{label}</small><b>{value == null ? 'tap the chart' : value.toFixed(2)}</b>
      {state === 'ask' ? <em>{active === which ? 'placing' : value == null ? '' : 'tap to move'}</em> : null}
    </button>
  )
  return (
    <div className={`${s2.kit} ${s2.screen}`} data-testid="draw-round">
      {state !== 'ask' && takeover ? <VerdictTakeover ok={ok} title={title} sub={offLine} label={trade ? 'See the trade' : 'See why'} onContinue={() => { setTakeover(false); showChart(chartBox.current) }} testId="draw-takeover" /> : null}
      <HudCombo label="Draw it" step={idx} total={total} results={state === 'ask' ? results : [...results, ok]} live={state === 'ask'} stepTestId="draw-step" />
      <div className={`${lab.chartBox} ${s2.heroChart}`} ref={chartBox}>
        <ChallengeChart id={item.id} bars={all} view={shownView} height={phone ? 340 : 480} annotations={annotations} markers={actions} onBarTap={state === 'ask' ? tap : null} fetcher={fetcher}
          frameEnd={state === 'ask' ? null : all?.[all.length - 1]?.t} />
        <ReplayClock clock={clock} tfMin={intraday?.tf || 30} testId="draw-clock" />
      </div>
      {due ? <ReplayPause key={due.at} check={due} onDone={() => { setAnswered((a) => new Set([...a, due.at])); showChart(chartBox.current) }} testId="draw-pause" /> : null}
      {state !== 'ask' && trade ? <ChartKey trade={trade} testId="draw-key" /> : null}
      {state === 'ask'
        ? <div className={sa.area}><div className={sa.lHead}><span className={sa.lEyebrow}>Draw it · chart {idx + 1} of {total}</span><h2 className={sa.lQ}>{withArticle(item.name).replace(/^./, (c) => c.toUpperCase())} fired on the last candle. Where do you buy, and where does the stop go?</h2>
            <p className={sa.lDetail}>Tap the chart at your entry price, then at your stop. Tap a line's chip to move it.</p></div></div>
        : <Prompt mood={ok ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={title} sub={offLine} seal={<UiStamp ok={ok} inline />} />}
      {failed ? (
        <p className={s2.drawFail} role="alert" data-testid="draw-failed">This chart could not be scored. Skip it and the next one loads.
          <button type="button" onClick={() => onDone(false, item.name, '')} data-testid="draw-skip">Skip</button></p>
      ) : null}
      <div className={s2.drawChips}>{chip('entry', 'Your entry', entry)}{chip('stop', 'Your stop', stop)}</div>
      <div className={sa.area}><div className={`${sa.lFoot} ${state === 'ok' ? sa.footOk : state === 'bad' ? sa.footBad : ''}`}>
        {state === 'ask'
          ? <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" busy={busy} disabled={entry == null || stop == null} onClick={check} testId="draw-check">{busy ? 'Checking' : 'Check'}</StudyButton>
          : <StudyButton kind={ok ? 'good' : 'bad'} size="xl" arrow wide hotkey={takeover || due ? null : 'Enter'} onClick={() => onDone(ok, item.name, res?.sym || '')} testId="draw-next">{idx + 1 < total ? 'Next' : 'Finish'}</StudyButton>}
      </div></div>
    </div>
  )
}

export default function DrawItChallenge({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [i, setI] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  useEffect(() => {
    let on = true
    loadPool(fetcher).then((p) => { if (on) setPool(p) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])
  const total = pool?.length || 0
  if (error) return <ChallengeError what="the Draw it charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'start') {
    return (
      <div className={s2.kit}>
        <StartArena plate="Draw" title="Draw it" caption="Where do you buy? Where is the stop?" testId="draw-intro" startTestId="draw-start" hotkey
          total={total || ROUNDS} stakes={[{ v: total || ROUNDS, l: 'charts', icon: 'play' }, { v: 2, l: 'lines each', icon: 'shield' }, { v: 1, l: 'try each', icon: 'check' }]}
          ready={!!total} onStart={() => total && setPhase('play')} label={pool == null ? 'Loading the charts' : total ? 'Start' : 'No charts yet'}
          reward={null}
          howTo={<HowItPlays mode="draw" testId="draw-howto" steps={[
            { icon: 'eye', title: 'A setup fired', body: 'Each chart is a real setup on its last candle, named at the top.' },
            { icon: 'play', title: 'Place two lines', body: 'Tap the chart at your entry, then at your stop. Tap a chip to move that line.' },
            { icon: 'shield', title: 'See the plan', body: "Check shows the setup's own entry and stop beside yours, why each sits there, and what followed." },
          ]} />} />
      </div>
    )
  }
  if (phase === 'done') {
    const right = results.filter(Boolean).length
    return (
      <div className={s2.kit}>
        <EndHard right={right} total={total} xp={0} results={results} log={log} unit="drawn on the plan" doneWord="on plan" medal={false}
          againLabel="Draw again" testIdPrefix="draw" onAgain={() => { setPool(null); setError(null); setReload((r) => r + 1); setI(0); setResults([]); setLog([]); setPhase('start') }} onBack={onClose} />
      </div>
    )
  }
  const item = pool?.[i]
  if (!item) return null
  return <Round key={item.id} idx={i} total={total} item={item} results={results} prefs={prefs} fetcher={fetcher}
    onDone={(ok, name, sym) => { setResults((r) => [...r, !!ok]); setLog((l) => [...l, { name, ticker: sym, ok }]); if (i + 1 >= total) { setPhase('done'); endFeedback(prefs) } else setI(i + 1) }} />
}
