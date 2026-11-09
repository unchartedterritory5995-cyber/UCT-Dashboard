// SPOT THE SETUP (the owner, 2026-11-08: "SPOT THE KICKER SHOULD be SPOT THE SETUP"; it was "Trap", then "Spot the
// Kicker"). One chart from the bank whose last candle is a setup and nothing else, named at the top ("Spot the Oops
// Reversal"), with the candles in view that look most like it: the server finds them with the setup's own detectors and
// offers only candles where those rules do NOT fire (GET /api/study/items/{id}/lookalikes, api/services/
// study_spot_setup.py), so a fake is never secretly the real thing. The candidates are painted gold with a letter each.
// Tap the real one (on the chart or its card), Check, and every card opens: the real one says it is the setup; each fake
// is measured beside it (the gap, the day's change, where it closed in its range, its volume against its average) and
// says the setup's rules do not fire there. On a Kicker the owner's own three rules are ticked or crossed as well. The
// bank item is a Yes/No "does the setup fire on the last candle" question; the answer posted is Yes when the member
// picked the real candle and No otherwise, so the attempt is scored on the server like any other.
import { useEffect, useMemo, useRef, useState } from 'react'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { Stamp } from '../../../lab/bits'
import { useRunOnTicks } from '../../../lab/fx'
import { rayAt } from '../../../lab/pointers'
import { POINTER, calloutLook } from '../ui/callout'
import StudyButton from '../ui/StudyButton'
import { HudCombo } from '../ui/HudLooks'
import { EndHard } from '../ui/EndLooks'
import s2 from '../ui/study.module.css'
import Prompt from '../ui/Prompt'
import VerdictTakeover from '../ui/VerdictTakeover'
import UiStamp from '../ui/Stamp'
import LessonCard from '../ui/LessonCard'
import sa from '../ui/answerLooks.module.css'
import { reviewTrade } from './hardMode'
import { tradeAnnotations, tradeMarkers } from './tradeMarks'
import ChartKey from '../ui/ChartKey'
import ReplayClock from '../ui/ReplayClock'
import ReplayPause from '../ui/ReplayPause'
import d5 from '../../../lab/duo.module.css'
import lab from '../../../lab/lab.module.css'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { beginRunXp, runXp, scoreAttempt, setupName } from './challengeBank'
import { alignTicks, developing, dueCheck, fetchIntraday, keyDays, replayChecks, showChart } from './replayTicks'
import { normalizeBars } from '../useStudySession'
import { rules } from './kickerRules'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'

const GOLD = '#dcbb5e'
export const KICKER_SKILL = 'setup.family3.kicker'
const ROUNDS = 8

/** The bank's Yes / No for this item (its choices), by meaning, never by position. */
export function yesNo(choices) {
  const list = Array.isArray(choices) ? choices : []
  const yes = list.find((c) => /^y(es)?$/i.test(String(c).trim())) ?? list[0] ?? 'Yes'
  const no = list.find((c) => /^no?$/i.test(String(c).trim())) ?? list.find((c) => c !== yes) ?? 'No'
  return { yes, no }
}

const sgn = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`
/** A fake measured beside the real candle, in the numbers a trader reads (each value from the bars). */
function compare(f, r) {
  const out = [
    { k: 'gap', label: 'Gap', v: sgn(f.gap_pct), real: sgn(r.gap_pct) },
    { k: 'chg', label: 'The day', v: sgn(f.chg_pct), real: sgn(r.chg_pct) },
    { k: 'close', label: 'Closed', v: `${Math.round(f.close_pos)}% up its range`, real: `${Math.round(r.close_pos)}%` },
  ]
  if (f.rvol != null && r.rvol != null) out.push({ k: 'vol', label: 'Volume', v: `${f.rvol.toFixed(1)}x its average`, real: `${r.rvol.toFixed(1)}x` })
  return out
}

function Round({ idx, item, total, prefs, fetcher, onDone, results = [] }) {
  const phone = useIsPhone()
  const VIEW = phone ? 55 : 90
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const [takeover, setTakeover] = useState(false)
  const chartBox = useRef(null)   // the review brings the chart into view (showChart)
  const [fwd, setFwd] = useState(null)
  const [intraday, setIntraday] = useState(null)   // the forward days' 30-minute bars, when the server stored them
  const [lesson, setLesson] = useState('')
  const [plan, setPlan] = useState(null)
  const shownAt = useRef(0)
  useEffect(() => { shownAt.current = performance.now() }, [])
  const vis = item.bars
  const n = vis.length
  const name = item.name
  const kicker = item.skill === KICKER_SKILL
  // the look-alikes the server measured (only those in this screen's view) and the real candle, by position
  const cands = useMemo(() => {
    const first = n - VIEW
    const fakes = (item.look?.lookalikes || []).filter((x) => x.i >= first && x.i < n - 1).map((x) => ({ i: x.i, kind: 'fake', f: x.features }))
    return [...fakes, { i: n - 1, kind: 'real', f: item.look?.real_features }].sort((a, b) => a.i - b.i)
  }, [item, n, VIEW])
  const view = useMemo(() => (cands.length ? Math.min(n, Math.max(50, n - cands[0].i + 24)) : Math.min(n, 70)), [cands, n])
  const trade = useMemo(() => (plan && state !== 'ask' ? reviewTrade(plan, vis[n - 1], fwd) : null), [plan, state, vis, n, fwd])
  // the replay within the day: each forward day grows through its real 30-minute closes; slow on the trade's key days
  const ticks = useMemo(() => alignTicks(fwd, intraday), [fwd, intraday])
  const keys = useMemo(() => (ticks ? keyDays(trade) : null), [ticks, trade])
  // the replay stops and asks at 2R and 3R (N033; the plan's own questions, api/services/study_trade.replay_checks)
  const [answered, setAnswered] = useState(() => new Set())
  const checks = useMemo(() => (state === 'ask' ? [] : replayChecks(trade)), [state, trade])
  const holdAt = useMemo(() => new Set(checks.filter((c) => !answered.has(c.at)).map((c) => c.session)), [checks, answered])
  const { bars: all, k, clock } = useRunOnTicks(vis, fwd, fwd?.length || 0, state !== 'ask' && !takeover,
    { slowMs: 200, fastMs: 200, ticks, keys, develop: developing, holdAt })
  const due = dueCheck(checks, k, answered)
  const highlight = useMemo(() => (state === 'ask' ? cands.map((c) => vis[c.i].t) : null), [cands, vis, state])
  const extra = useMemo(() => (highlight ? { highlightBarTime: highlight, highlightColor: GOLD } : null), [highlight])
  const word = name.toUpperCase()
  // the candidates carry Hard mode's pointer (rule 4, one designed pointer everywhere): a pill in open space, never over
  // a candle, a leader and a ring round the candle; gold while you choose, green for the setup and red for the rest after
  const callouts = useMemo(() => {
    if (!n || !all) return []
    return cands.map((c, k) => {
      const letter = String.fromCharCode(65 + k)
      const sel = pick === c.i
      const tone = state === 'ask' ? POINTER.ask : c.kind === 'real' ? POINTER.ok : POINTER.bad
      const text = state === 'ask' ? (sel ? `${letter} · your pick` : letter) : c.kind === 'real' ? word : 'not it'
      return { index: c.i, text, ...tone, ...(sel && state === 'ask' ? { color: '#f6e2a0', textColor: '#fff6d6' } : null) }
    })
  }, [cands, all, n, state, pick, word])
  const look = useMemo(() => ({ ...calloutLook(phone), fadeIn: true }), [phone])
  const ok = pick === n - 1
  const check = async () => {
    if (pick == null || state !== 'ask') return
    const { yes, no } = yesNo(item.choices)
    const picked = cands.find((c) => c.i === pick)
    let right = ok
    try {
      const a = await scoreAttempt(item, { choice: ok ? yes : no, picked_bar: vis[pick]?.t ?? null, picked_kind: picked?.kind || null }, performance.now() - shownAt.current, fetcher)
      right = !!a.correct; setFwd(a.forward); setLesson(a.reveal?.lesson || ''); setPlan(a.reveal?.trade || null)
      fetchIntraday(a, fetcher).then((d) => { if (d) setIntraday(d) })
    } catch { /* the verdict stays the local one; the attempt is not recorded */ }
    setState(right ? 'ok' : 'bad'); setTakeover(true); revealFeedback(right, prefs)
  }
  const tapBar = ({ index }) => {
    if (state !== 'ask' || index < 0) return
    const near = cands.map((c) => ({ c, dd: Math.abs(c.i - index) })).sort((p, q) => p.dd - q.dd)[0]
    if (near && near.dd <= (phone ? 5 : 4)) { setPick(near.c.i); tapFeedback(prefs) }
  }
  const real = cands.find((c) => c.kind === 'real')
  // the trade on the chart and its key, as in Hard mode; a setup with no trade keeps the line at its close
  const shownView = state === 'ask' ? view : Math.min(all.length, view + (all.length - n))
  const annotations = useMemo(() => {
    if (state === 'ask' || !n) return null
    return (trade && tradeAnnotations(trade, vis[n - 1], all)) || rayAt(vis[n - 1], 'l', { id: 'l', label: '' })
  }, [state, trade, vis, all, n])
  const actions = useMemo(() => (state === 'ask' ? null : tradeMarkers(trade, all, n)), [state, trade, all, n])
  // Hard mode's design (the owner, 2026-11-08: one design for every mode): the status line, the chart as the hero, the
  // question header, the cards, the verdict line, one Check bar, the coach's card
  return (
    <div className={`${s2.kit} ${s2.screen} ${state === 'bad' ? d5.shakeHard : ''}`} data-testid="spot-round">
      {state !== 'ask' ? <span className={`${s2.flash} ${ok ? s2.ok : s2.bad}`} aria-hidden="true" /> : null}
      {state !== 'ask' && takeover ? <VerdictTakeover ok={ok} title={ok ? `That is the ${name}.` : 'Not that one.'}
        answer={ok ? null : `${name}, candle ${String.fromCharCode(65 + Math.max(0, cands.findIndex((c) => c.kind === 'real')))}`}
        sub={ok ? 'The cards measure the others against it.' : <>The <b>{name}</b> is the green one on the chart; the cards say why the others are not.</>}
        label={trade ? 'See the trade' : 'See why'} onContinue={() => { setTakeover(false); showChart(chartBox.current) }} testId="spot-takeover" /> : null}
      <HudCombo label="Spot the Setup" step={idx} total={total} results={state === 'ask' ? results : [...results, ok]} live={state === 'ask'} stepTestId="spot-step" />
      <div className={`${lab.chartBox} ${s2.heroChart}`} ref={chartBox}>
        {state === 'ask' && pick == null ? <span className={lab.tapHint}>spot the {name}</span> : null}
        <ChallengeChart id={item.id} bars={all} view={shownView} height={phone ? 340 : 480} annotations={annotations} markers={actions} callouts={callouts} calloutLook={look} extra={extra} onBarTap={state === 'ask' ? tapBar : null} fetcher={fetcher}
          frameEnd={state === 'ask' ? null : all?.[all.length - 1]?.t} />
        <ReplayClock clock={clock} tfMin={intraday?.tf || 30} testId="spot-clock" />
      </div>
      {due ? <ReplayPause key={due.at} check={due} onDone={() => { setAnswered((a) => new Set([...a, due.at])); showChart(chartBox.current) }} testId="spot-pause" /> : null}
      {trade ? <ChartKey trade={trade} testId="spot-key" /> : null}
      {state === 'ask'
        ? <div className={sa.area}><div className={sa.lHead}><span className={sa.lEyebrow}>Spot the Setup · chart {idx + 1} of {total}</span><h2 className={sa.lQ}>Spot the {name}</h2><p className={sa.lDetail}>{cands.length} gold candles look alike; only one is the real {name}. Tap it on the chart or pick its card.</p></div></div>
        : <Prompt mood={ok ? 'happy' : 'oops'} tone={ok ? 'ok' : 'bad'} size={phone ? 40 : 48} title={ok ? `That is the ${name}.` : `Not that one.`}
            sub={ok ? 'The cards measure the others against it.' : <>The {name} is the green one; the cards say why the others are not.</>} seal={<UiStamp ok={ok} inline />} />}
      <div className={`${d5.candRow} ${d5.cascade}`} style={phone ? undefined : { gridTemplateColumns: `repeat(${Math.max(1, cands.length)}, 1fr)` }} data-testid="spot-cards">{cands.map((c, k) => {
        const open = state !== 'ask'
        const rs = open && kicker ? rules(vis, c.i) : null
        const cmp = open && c.kind === 'fake' && c.f && real?.f ? compare(c.f, real.f) : null
        return (
          <button key={c.i} type="button" style={{ '--i': k }} className={`${d5.cand} ${pick === c.i ? d5.sel : ''} ${open ? (c.kind === 'real' ? d5.right : d5.wrong) : ''}`} disabled={open} onClick={() => { setPick(c.i); tapFeedback(prefs) }} aria-label={`Candle ${String.fromCharCode(65 + k)}, ${vis[c.i].t}`}>
            <span className={d5.candHead}><span className={d5.letter}>{String.fromCharCode(65 + k)}</span><span>{vis[c.i].t}</span></span>
            {!open ? <small>{pick === c.i ? 'your pick' : 'tap to pick'}</small> : null}
            {open && c.kind === 'real' ? <small>{`The ${name}: its rules fire on this candle and no other setup's do.`}</small> : null}
            {cmp ? <span className={d5.ruleList}>{cmp.map((r) => <span key={r.k} className={d5.ruleBad}><b>·</b><span>{r.label} {r.v}</span><small>the {name}: {r.real}</small></span>)}</span> : null}
            {rs ? <span className={d5.ruleList}>{rs.map((r) => <span key={r.k} className={r.ok ? d5.ruleOk : d5.ruleBad}><b>{r.ok ? '✓' : '✕'}</b><span>{r.label}</span><small>{r.value}</small></span>)}</span> : null}
            {open && c.kind === 'fake' ? <small>{`The ${name} rules do not fire here.`}</small> : null}
          </button>
        )
      })}</div>
      <div className={sa.area}><div className={`${sa.lFoot} ${state === 'ok' ? sa.footOk : state === 'bad' ? sa.footBad : ''}`}>
        {state === 'ask' ? <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" disabled={pick == null} onClick={check} testId="spot-check">Check</StudyButton>
          : <StudyButton kind={ok ? 'good' : 'bad'} size="xl" arrow wide hotkey={takeover || due ? null : 'Enter'} onClick={() => onDone(ok, name)} testId="spot-next">{idx + 1 < total ? 'Next' : 'Finish'}</StudyButton>}
      </div></div>
      {state !== 'ask' && (lesson || trade) ? <LessonCard text={lesson} setup={name} skillId={item.skill_id || item.skill || null} fired={true} trade={trade} showReads={false} testId="spot-lesson" /> : null}
    </div>
  )
}

/** The game's charts in one request (POST /api/study/spot-setup): charts whose last candle is their setup and nothing
 *  else, each with its measured look-alikes, mixed across the setups, in one scored session. */
async function loadPool(fetcher, view) {
  const set = await fetcher('/api/study/spot-setup', { method: 'POST', body: { view, rounds: ROUNDS } })
  return (set?.items || []).filter((it) => it.look?.lookalikes?.length && it.bars?.bars?.length).map((it) => ({
    id: it.id, skill: it.skill_id, name: setupName(it.skill_id), choices: it.prompt_json?.choices || ['Yes', 'No'],
    bars: normalizeBars(it.bars), sessionId: set.session_id, look: it.look,
  }))
}

export default function SpotSetupChallenge({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const phone = useIsPhone()
  const [phase, setPhase] = useState('start')    // start | play | done
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [i, setI] = useState(0)
  const [right, setRight] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  useEffect(() => {
    let on = true
    loadPool(fetcher, phone ? 55 : 90).then((p) => { if (on) setPool(p) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher, phone])
  const total = Math.min(ROUNDS, pool?.length || 0)
  const setups = pool ? [...new Set(pool.map((p) => p.name))] : []
  if (error) return <ChallengeError what="the Spot the Setup charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'start') {
    return (
      <div className={s2.kit}>
        <StartArena plate="Spot" title="Spot the Setup" caption="Which candle is the real one?" testId="spot-intro" startTestId="spot-start" hotkey
          total={total || ROUNDS} stakes={[{ v: total || ROUNDS, l: 'charts', icon: 'play' }, { v: setups.length || 'All', l: setups.length === 1 ? 'setup' : 'setups', icon: 'eye' }, { v: 3, l: 'candles each', icon: 'star' }]}
          ready={!!total} onStart={() => { if (total) { beginRunXp(); setPhase('play') } }} label={pool == null ? 'Loading the bank' : total ? 'Start' : 'No charts yet'}
          howTo={<HowItPlays mode="spot" testId="spot-howto" steps={[
            { icon: 'eye', title: 'A setup is named', body: 'The chart has three gold candles that look alike. Only one is that setup.' },
            { icon: 'check', title: 'Tap the real one', body: 'Tap it on the chart or pick its card, then Check.' },
            { icon: 'info', title: 'See why', body: 'The cards measure each look-alike against the real one: the gap, the day, the close, the volume.' },
          ]} />} />
      </div>
    )
  }
  if (phase === 'done') {
    const again = () => { setPool(null); setError(null); setReload((r) => r + 1); setI(0); setRight(0); setResults([]); setLog([]); setPhase('start') }
    return (
      <div className={s2.kit}>
        <EndHard right={right} total={total} xp={0} results={results} log={log} level={runXp()}
          unit="setups spotted" againLabel="Again" testIdPrefix="spot" onAgain={again} onBack={onClose} />
      </div>
    )
  }
  const item = pool?.[i]
  if (!item) return <p className={d5.startLead}>No charts in the bank yet.</p>
  return <Round key={item.id} idx={i} item={item} total={total} prefs={prefs} fetcher={fetcher} results={results}
    onDone={(ok, name) => { if (ok) setRight((v) => v + 1); setResults((r) => [...r, !!ok]); setLog((l) => [...l, { name, ticker: '', ok }]); if (i + 1 >= total) { setPhase('done'); endFeedback(prefs) } else setI(i + 1) }} />
}
