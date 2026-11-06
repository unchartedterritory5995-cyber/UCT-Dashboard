// HARD MODE (production plan piece 43; round 20 look, 2026-11-06 — the owner, before ranking round 19: "I can already
// tell it needs a revamp and improvements"; "figure it out to get it all done". Round 19 had applied his batch-19 words:
// the real widget, his black-glass buttons, a spotlight, a medal, "the firm" gone, blank indicators gone).
// THE REVAMP: the chart is the hero and nothing else is a box. One status line, the member's own widget full width, one
// question line in display type beside the mark, four pills, one action, the lesson as a plain block under a hairline,
// a verdict flash. The start and the end are a full stage on a dim chart. The references are lesson screens with nothing
// boxed around the question (Duolingo, Brilliant) and our own Charts tab.
// THE MODE: eight charts from the bank; the TICKER is hidden and the member names what fired on the last candle, or says
// nothing did; the chart is otherwise their own (their averages, their volume). The answer is scored on the server
// against the bank's own key (hardMode.js); the lesson and the ticker come back with the verdict; the forward bars run
// on slowly. No hearts. Eight for eight earns Legendary, for this run. Every XP number shown is what the attempts earned.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCountUp, useRunOn } from '../../../lab/fx'   // pure motion (bars running on, a count-up); no styling rides in
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError from './ChallengeError'
import { fetchSpotPool, scoreAttempt } from './challengeBank'
import { yesNo } from './KickerChallenge'
import { HARD_CHART, HARD_TOTAL, NOTHING, RUN_ON_MS, hardAnswer, hardChoices, hardRight, idSeed, setupFired } from './hardMode'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import { Medal, Ring } from '../ui/Medal'
import Hud from '../ui/Hud'
import Prompt from '../ui/Prompt'
import Choice, { ChoiceGrid } from '../ui/Choice'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import StudyChart from '../ui/StudyChart'
import LessonCard from '../ui/LessonCard'
import Stage, { Confetti, Gem, RunLog } from '../ui/Stage'
import { spotlight } from '../ui/pointer'
import s from '../ui/study.module.css'

const HIDDEN = ['ticker']
const COLOR = { ask: '#dcbb5e', ok: '#2faf68', bad: '#df4646' }

function Q({ idx, item, total, results, prefs, fetcher, onDone }) {
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')      // ask | ok | bad
  const [fwd, setFwd] = useState(null)
  const [lesson, setLesson] = useState('')
  const [ticker, setTicker] = useState('')
  const [fired, setFired] = useState(null)
  const [xp, setXp] = useState(0)
  const [busy, setBusy] = useState(false)   // the attempt is on the wire: Check reads Checking and a second tap posts nothing
  const shownAt = useRef(0)
  useEffect(() => { shownAt.current = performance.now() }, [])
  const phone = useIsPhone()
  const bars = item.bars
  const n = bars.length
  const choices = useMemo(() => hardChoices(item, idSeed(item.id)), [item])
  const all = useRunOn(bars, fwd, state !== 'ask', RUN_ON_MS)
  const view = Math.min(90, all?.length || 0)
  const ann = useMemo(() => (!n || !all ? null : spotlight(all, n - 1, {
    label: state === 'ask' ? 'this candle' : state === 'ok' ? 'you were right' : 'the answer',
    id: `h${idx}`, color: COLOR[state], view, barPx: phone ? 3.8 : 8.5,
  })), [all, n, state, idx, view, phone])
  const check = async () => {
    if (pick == null || state !== 'ask' || busy) return
    setBusy(true)
    const picked = choices[pick]
    const { yes, no } = yesNo(item.choices)
    let right = false
    let wasFired = null
    try {
      const a = await scoreAttempt(item, hardAnswer(picked, item, yes, no), performance.now() - shownAt.current, fetcher)
      right = hardRight(picked, item, a.correct)
      wasFired = setupFired(picked, item, a.correct)
      setFwd(a.forward); setLesson(a.reveal?.lesson || ''); setTicker(a.reveal?.sym || a.reveal?.ticker || ''); setXp(Number(a.progress?.xp_gained || 0))
    } catch { right = false }
    setBusy(false); setFired(wasFired); setState(right ? 'ok' : 'bad'); revealFeedback(right, prefs)
  }
  // the number keys pick a pill; Enter is the action button's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    const k = (e) => {
      if (state !== 'ask' || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const i = +e.key - 1
      if (i >= 0 && i < choices.length) setPick(i)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [state, choices.length])
  const picked = pick == null ? null : choices[pick]
  const rightCard = (c) => state === 'bad' && fired != null && ((fired && c === item.name) || (!fired && c === NOTHING))
  const cardState = (c, k) => {
    if (state === 'ask') return pick === k ? 'sel' : 'idle'
    if (pick === k) return state === 'ok' ? 'right' : 'wrong'
    if (rightCard(c)) return 'right'
    return 'quiet'
  }
  const last = idx + 1 >= total
  const mood = state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'
  const where = ticker || 'this chart'
  const headline = state === 'ok' ? (fired ? 'Named it.' : 'Right. Nothing fired.') : fired ? `It was the ${item.name}.` : 'Nothing fired here.'
  const detail = state === 'ok'
    ? <>{fired ? item.name : 'No setup'} on <b>{where}</b>{xp > 0 ? ` · +${xp} XP` : ''}</>
    : fired ? <><b>{where}</b> · {picked === NOTHING ? 'you said nothing fired' : `not the ${picked}`}</> : <><b>{where}</b> · not a {picked}</>
  const named = results.filter(Boolean).length
  const missed = results.filter((r) => r === false).length
  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="hard-question" data-state={state}>
      {state !== 'ask' ? <span className={`${s.flash} ${state === 'ok' ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      <Hud bare mode="hard" step={idx} total={total} results={results} live={state === 'ask'} hidden={HIDDEN} right={<Ring value={named} total={total} missed={missed} />} />
      <div className={`${s.heroChart} ${state === 'bad' ? s.shake : ''}`}>
        <StudyChart id={item.id} bars={all} view={view} height={phone ? 340 : 480} annotations={ann} chartOpts={HARD_CHART}
          symbol={ticker || null} masked={state === 'ask' || !ticker} watermark={state !== 'ask' ? ticker || null : null} />
      </div>
      <Prompt mood={mood} tone={state} size={phone ? 40 : 48}
        title={state === 'ask' ? 'What fired on the last candle?' : headline}
        sub={state === 'ask' ? <>Your chart, without its name. <b>Name it</b>, or say nothing did.</> : detail}
        seal={state !== 'ask' ? <Stamp ok={state === 'ok'} inline /> : null} />
      <ChoiceGrid row testId="hard-cards" label="Your answer">
        {choices.map((c, k) => (
          <Choice key={c} pill n={k + 1} i={k} label={c} state={cardState(c, k)} disabled={state !== 'ask'} onClick={() => { setPick(k); tapFeedback(prefs) }} />
        ))}
      </ChoiceGrid>
      <div className={s.actionRow}>
        <span className={s.actionNote}>{state === 'ask' ? (picked ? `${picked} picked · Enter checks it` : '1 to 4 picks a pill · Enter checks it') : 'Enter goes on'}</span>
        {state === 'ask'
          ? <StudyButton kind="primary" wide={phone} hotkey="Enter" busy={busy} disabled={pick == null} onClick={check} testId="hard-check">{busy ? 'Checking' : 'Check'}</StudyButton>
          : <StudyButton kind={state === 'ok' ? 'good' : 'bad'} wide={phone} hotkey="Enter" onClick={() => onDone(state === 'ok', xp, ticker)} testId="hard-next">{last ? 'See the run' : 'Next'}</StudyButton>}
      </div>
      {state !== 'ask' && lesson ? <LessonCard plain text={lesson} ticker={ticker || null} setup={item.name} /> : null}
    </div>
  )
}

function Done({ right, total, xp, log, onBack, onAgain }) {
  const perfect = total > 0 && right === total
  const shown = useCountUp(xp, true, 28)
  return (
    <>
      {perfect ? <Confetti /> : null}
      <Stage full hero legend={perfect} rays={perfect} eyebrow="Hard mode" title={perfect ? 'Legendary' : `${right} of ${total}`} titlePlain={!perfect} titleNote={perfect ? null : 'named'}
        sub={perfect ? `${total} for ${total} without a ticker. Legendary, for this run.` : `${right} named without a ticker. ${total} for ${total} is Legendary.`}
        art={<Medal lit={perfect} ignite={perfect} size={96} />} testId="hard-done"
        actions={<>
          <StudyButton kind="primary" hotkey="Enter" sub="new charts" onClick={onAgain} testId="hard-again">Run it again</StudyButton>
          <StudyButton kind="ghost" onClick={onBack}>Back to Study</StudyButton>
        </>}>
        <div className={s.gems}>
          <Gem i={0} icon="check" label="Named" value={`${right}/${total}`} tone="gold" testId="hard-right" />
          <Gem i={1} icon="star" label="XP earned" value={`+${shown}`} tone="green" testId="hard-xp" />
        </div>
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
    fetchSpotPool(undefined, 4, fetcher).then((p) => { if (on) setPool(p) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])
  const total = Math.min(HARD_TOTAL, pool?.length || 0)
  const items = useMemo(() => (pool ? pool.slice(0, HARD_TOTAL) : []), [pool, run])   // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { setPhase('play'); setI(0); setRight(0); setResults([]); setLog([]); setXp(0); setRun((r) => r + 1); if (pool) setPool((p) => [...p.slice(HARD_TOTAL), ...p.slice(0, HARD_TOTAL)]) }
  const again = () => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('intro') }

  if (error) return <ChallengeError what="the hard-mode charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'intro') {
    const count = total || 'Eight'
    return (
      <Stage full hero eyebrow="Challenge" title="Hard mode" art={<Medal size={72} />} testId="hard-intro"
        actions={<StudyButton kind="primary" hotkey="Enter" disabled={!pool?.length} onClick={() => pool?.length && start()} testId="hard-start"
          sub={pool == null ? 'a second or two' : pool.length ? `${total} charts · no ticker` : 'come back after a new import'}>
          {pool == null ? 'Loading the bank' : pool.length ? 'Start hard mode' : 'No charts yet'}
        </StudyButton>}
        below={<span className={s.reward}><b>{count} for {String(count).toLowerCase()}</b> · Legendary</span>}>
        <div className={s.lockup}>
          <b>No ticker</b>
          <span>{count} charts from the bank, on your own chart. Name what fired on the last candle, or say nothing did.{pool ? '' : ' Loading the bank.'}</span>
        </div>
      </Stage>
    )
  }
  if (phase === 'done') return <Done right={right} total={total} xp={xp} log={log} onBack={onClose} onAgain={again} />
  const item = items[i]
  if (!item) return <p className={`${s.kit} ${s.heroSub}`}>No charts in the bank yet.</p>
  return (
    <Q key={`${run}-${i}`} idx={i} item={item} total={total} results={results} prefs={prefs} fetcher={fetcher}
      onDone={(ok, gained, ticker) => {
        setXp((v) => v + (gained || 0)); if (ok) setRight((v) => v + 1); setResults((r) => [...r, !!ok]); setLog((l) => [...l, { name: item.name, ticker: ticker || '', ok: !!ok }])
        if (i + 1 >= total) { setPhase('done'); endFeedback(prefs) } else setI(i + 1)
      }} />
  )
}
