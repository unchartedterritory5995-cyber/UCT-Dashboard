// HARD MODE (production plan piece 43; round 18 look, 2026-11-05: the owner's batch-18 verdict was "needs dramatic
// production, graphic, layout improvement on brand", with Check, Next, the end card and the fourth crown Cut).
// Eight charts from the bank with nothing to lean on: no ticker, no averages, no volume, candles only. On each the
// member names what fired (or says nothing did); the answer is scored on the server against the bank's own key
// (hardMode.js), the lesson and the ticker come back with the verdict, and the forward bars run on slowly. No hearts:
// a miss is a miss and the run goes on. Eight for eight lights the fourth crown on the end card, for this run.
//
// THE SCREEN is the Study UI kit (pages/study/ui): a HUD with the run's segments; the member's OWN Charts-tab widget as
// the chart, its ticker masked until the verdict and its watermark the ticker after; a callout that never crosses a
// candle; numbered answer cards; one gold Check; a lesson card that leads with this chart's own sentence; a stage for
// the start and the end. Every XP number shown is what the attempts earned; nothing here invents one.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCountUp, useRunOn } from '../../../lab/fx'   // pure motion (bars running on, a count-up); no styling rides in
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { fetchSpotPool, scoreAttempt } from './challengeBank'
import { yesNo } from './KickerChallenge'
import { HARD_CHART, HARD_TOTAL, NOTHING, RUN_ON_MS, hardAnswer, hardChoices, hardRight, idSeed, setupFired } from './hardMode'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import Crowns from '../ui/Crowns'
import Hud from '../ui/Hud'
import MarkBubble from '../ui/MarkBubble'
import Choice, { ChoiceGrid } from '../ui/Choice'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import StudyChartFrame from '../ui/StudyChartFrame'
import LessonCard from '../ui/LessonCard'
import Stage, { Confetti, Gem, Toggles } from '../ui/Stage'
import { callout } from '../ui/pointer'
import s from '../ui/study.module.css'

export { default as Crowns } from '../ui/Crowns'

const HIDDEN = ['ticker', 'averages', 'volume']
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
  const ann = useMemo(() => (!n || !all ? null : callout(all, n - 1, {
    label: state === 'ask' ? 'this candle' : state === 'ok' ? 'you were right' : 'the answer',
    id: `h${idx}`, color: COLOR[state], view, barPx: phone ? 3.8 : 6.6,
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
  // the number keys pick a card; Enter is the footer button's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    const k = (e) => {
      if (state !== 'ask' || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const i = +e.key - 1
      if (i >= 0 && i < choices.length) setPick(i)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [state, choices.length])
  const picked = pick == null ? null : choices[pick]
  const bubble = state === 'ask' ? 'Candles only. What fired on the last candle?'
    : state === 'ok' ? (fired ? 'Named it with nothing to lean on.' : 'Right. Nothing fired here.')
      : fired ? `It was the ${item.name}.` : `Nothing fired here${picked && picked !== NOTHING ? `, and it was not a ${picked}` : ''}.`
  const rightCard = (c) => state === 'bad' && fired != null && ((fired && c === item.name) || (!fired && c === NOTHING))
  const cardState = (c, k) => {
    if (state === 'ask') return pick === k ? 'sel' : 'idle'
    if (pick === k) return state === 'ok' ? 'right' : 'wrong'
    if (rightCard(c)) return 'right'
    return 'quiet'
  }
  const last = idx + 1 >= total
  const mood = state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'
  return (
    <div className={`${s.kit} ${s.screen} ${state === 'bad' ? s.shake : ''}`} data-testid="hard-question" data-state={state}>
      <Hud mode="hard" step={idx} total={total} results={results} live={state === 'ask'} hidden={HIDDEN} right={<Crowns size={16} testId={null} />} />
      <div className={s.split}>
        <div className={s.col}>
          <StudyChartFrame masked={state === 'ask' || !ticker} symbol={ticker || null} stamp={state !== 'ask' ? <Stamp ok={state === 'ok'} /> : null}>
            <ChallengeChart look="widget" id={item.id} bars={all} view={view} height={phone ? 300 : 400} annotations={ann} chartOpts={HARD_CHART} watermark={state !== 'ask' ? ticker || null : null} fetcher={fetcher} />
          </StudyChartFrame>
          {state !== 'ask' && lesson ? <LessonCard text={lesson} ticker={ticker || null} setup={item.name} /> : null}
        </div>
        <div className={s.col}>
          <MarkBubble mood={mood} tone={state} size={64}>{bubble}</MarkBubble>
          <div className={s.qLine}>
            {state === 'ask'
              ? <span className={s.chip}>Name it</span>
              : <span className={`${s.chip} ${s.reveal}`}>{item.name}{ticker ? <> on <b>{ticker}</b></> : null}</span>}
            <span className={s.qText}>{state === 'ask' ? 'No ticker, no averages, no volume. Which setup, if any, fired on the last candle?' : `A ${item.name} question from the bank · Daily`}</span>
          </div>
          <ChoiceGrid testId="hard-cards" label="Your answer">
            {choices.map((c, k) => (
              <Choice key={c} n={k + 1} i={k} label={c} state={cardState(c, k)} disabled={state !== 'ask'} onClick={() => { setPick(k); tapFeedback(prefs) }} />
            ))}
          </ChoiceGrid>
        </div>
      </div>
      <div className={`${s.footer} ${state === 'ok' ? s.ok : state === 'bad' ? s.bad : ''}`}>
        <div className={s.footIn}>
          <div className={s.footMsg}>
            {state === 'ask'
              ? <><b>{picked ? picked : 'Pick a card'}</b><span>{picked ? 'Check it, or pick another' : 'Candles only · the last candle is the question'}</span></>
              : state === 'ok'
                ? <><b>{fired ? `${item.name} on ${ticker || 'this chart'}` : `Nothing fired on ${ticker || 'this chart'}`}</b><span>{xp > 0 ? `+${xp} XP` : 'Named it'}</span></>
                : <><b>{fired ? `It was the ${item.name}` : 'Nothing fired here'}</b><span>{ticker ? `${ticker} · ` : ''}the lesson is under the chart</span></>}
          </div>
          {state === 'ask'
            ? <StudyButton kind="primary" hotkey="Enter" busy={busy} disabled={pick == null} onClick={check} testId="hard-check">{busy ? 'Checking' : 'Check'}</StudyButton>
            : <StudyButton kind={state === 'ok' ? 'good' : 'bad'} hotkey="Enter" onClick={() => onDone(state === 'ok', xp)} testId="hard-next">{last ? 'See the run' : 'Next'}</StudyButton>}
        </div>
      </div>
    </div>
  )
}

function Done({ right, total, xp, onBack, onAgain }) {
  const perfect = total > 0 && right === total
  const shown = useCountUp(xp, true, 28)
  return (
    <>
      {perfect ? <Confetti /> : null}
      <Stage legend={perfect} rays={perfect} eyebrow="Hard mode" title={perfect ? 'Legendary' : `${right} of ${total}`} titlePlain={!perfect} titleNote={perfect ? null : 'named'}
        sub={perfect ? `${total} for ${total} with nothing to lean on. The fourth crown is lit for this run.` : `${right} named with nothing to lean on. ${total} for ${total} lights the fourth crown.`}
        art={<Crowns lit={perfect} ignite={perfect} size={56} />} testId="hard-done"
        actions={<>
          <StudyButton kind="primary" hotkey="Enter" sub="new charts · candles only" onClick={onAgain} testId="hard-again">Run it again</StudyButton>
          <StudyButton kind="ghost" onClick={onBack}>Back to Study</StudyButton>
        </>}>
        <div className={s.gems}>
          <Gem i={0} icon="check" label="Named" value={`${right}/${total}`} tone="gold" testId="hard-right" />
          <Gem i={1} icon="star" label="XP earned" value={`+${shown}`} tone="green" testId="hard-xp" />
        </div>
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
  const [xp, setXp] = useState(0)
  const [run, setRun] = useState(0)
  useEffect(() => {
    let on = true
    fetchSpotPool(undefined, 4, fetcher).then((p) => { if (on) setPool(p) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])
  const total = Math.min(HARD_TOTAL, pool?.length || 0)
  const items = useMemo(() => (pool ? pool.slice(0, HARD_TOTAL) : []), [pool, run])   // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { setPhase('play'); setI(0); setRight(0); setResults([]); setXp(0); setRun((r) => r + 1); if (pool) setPool((p) => [...p.slice(HARD_TOTAL), ...p.slice(0, HARD_TOTAL)]) }
  const again = () => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('intro') }

  if (error) return <ChallengeError what="the hard-mode charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'intro') {
    const count = total || 'Eight'
    return (
      <Stage eyebrow="Challenge" title="Hard mode" titlePlain art={<Crowns size={44} />} testId="hard-intro"
        sub={`${count} charts from the bank with nothing to lean on: no ticker, no averages, no volume. Candles only. Name what fired, or say nothing did. ${count} for ${String(count).toLowerCase()} lights the fourth crown.${pool ? '' : ' Loading the bank.'}`}
        actions={<StudyButton kind="primary" hotkey="Enter" disabled={!pool?.length} onClick={() => pool?.length && start()} testId="hard-start"
          sub={pool == null ? 'a second or two' : pool.length ? `${total} charts · candles only` : 'come back after a new import'}>
          {pool == null ? 'Loading the bank' : pool.length ? 'Start hard mode' : 'No charts yet'}
        </StudyButton>}>
        <Toggles items={[{ label: 'Ticker', sub: 'hidden' }, { label: 'Averages', sub: 'hidden' }, { label: 'Volume', sub: 'hidden' }]} />
      </Stage>
    )
  }
  if (phase === 'done') return <Done right={right} total={total} xp={xp} onBack={onClose} onAgain={again} />
  const item = items[i]
  if (!item) return <p className={`${s.kit} ${s.heroSub}`}>No charts in the bank yet.</p>
  return (
    <Q key={`${run}-${i}`} idx={i} item={item} total={total} results={results} prefs={prefs} fetcher={fetcher}
      onDone={(ok, gained) => {
        setXp((v) => v + (gained || 0)); if (ok) setRight((v) => v + 1); setResults((r) => [...r, !!ok])
        if (i + 1 >= total) { setPhase('done'); endFeedback(prefs) } else setI(i + 1)
      }} />
  )
}
