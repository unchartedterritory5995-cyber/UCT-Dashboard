// HARD MODE (production plan piece 43, built 2026-11-05 while the drill's batch 17 waits on the owner's ranks).
// Eight charts from the bank with nothing to lean on: no ticker, no averages, no volume, candles only. On each the
// member names what fired (or says nothing did); the answer is scored on the server against the bank's own key
// (hardMode.js), the lesson and the ticker come back with the verdict, and the forward bars run on slowly. No
// hearts: a miss is a miss and the run goes on. Eight for eight lights the fourth crown on the end card, for this
// run. Every XP number shown is what the attempts earned; nothing here invents one.
import { useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import StudyMark from '../../../components/study/StudyMark'
import StartCard, { StartButton } from '../../../lab/StartCard'
import { Confetti, Stamp } from '../../../lab/bits'
import { useCountUp, useRunOn } from '../../../lab/fx'
import { spot } from '../../../lab/pointers'
import d5 from '../../../lab/duo.module.css'
import lab from '../../../lab/lab.module.css'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { fetchSpotPool, scoreAttempt } from './challengeBank'
import { yesNo } from './KickerChallenge'
import { HARD_CHART, HARD_TOTAL, NOTHING, RUN_ON_MS, hardAnswer, hardChoices, hardRight, idSeed, setupFired } from './hardMode'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'

/** Three crowns and the dark fourth; `lit` lights it (a perfect run). */
export function Crowns({ lit = false, size = 44 }) {
  return (
    <div className={d5.crownRow} style={{ fontSize: size }} aria-label={lit ? 'four crowns, the fourth lit' : 'three crowns and a dark fourth'}>
      <span>♛</span><span>♛</span><span>♛</span>
      <span className={`${d5.dimC} ${lit ? d5.lit : ''}`} data-testid="fourth-crown" data-lit={lit ? '1' : '0'}>♛</span>
    </div>
  )
}

function Q({ idx, item, total, prefs, fetcher, onDone }) {
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')      // ask | ok | bad
  const [fwd, setFwd] = useState(null)
  const [lesson, setLesson] = useState('')
  const [ticker, setTicker] = useState('')
  const [fired, setFired] = useState(null)
  const [xp, setXp] = useState(0)
  const shownAt = useRef(0)
  useEffect(() => { shownAt.current = performance.now() }, [])
  const [busy, setBusy] = useState(false)   // the attempt is on the wire: Check reads Checking and a second tap posts nothing
  const bars = item.bars
  const n = bars.length
  const choices = useMemo(() => hardChoices(item, idSeed(item.id)), [item])
  const all = useRunOn(bars, fwd, state !== 'ask', RUN_ON_MS)
  const ann = useMemo(() => (!n || !all ? null : spot(all, n - 1, {
    label: state === 'ask' ? 'this candle' : state === 'ok' ? 'you were right' : 'the answer',
    id: `h${idx}`, color: state === 'ask' ? '#dcbb5e' : state === 'ok' ? '#2faf68' : '#df4646', halo: state === 'ask',
  })), [all, n, state, idx])
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
  useEffect(() => {
    const k = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (state !== 'ask') { if (e.key === 'Enter') onDone(state === 'ok', xp); return }
      const i = +e.key - 1; if (i >= 0 && i < choices.length) setPick(i)
      if (e.key === 'Enter' && pick != null) check()
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  const picked = pick == null ? null : choices[pick]
  const bubble = state === 'ask' ? 'Candles only. What fired on the last candle?'
    : state === 'ok' ? (fired ? 'Named it with nothing to lean on.' : 'Right. Nothing fired here.')
      : fired ? `It was the ${item.name}.` : `Nothing fired here${picked && picked !== NOTHING ? `, and it was not a ${picked}` : ''}.`
  const rightCard = (c) => state === 'bad' && fired != null && ((fired && c === item.name) || (!fired && c === NOTHING))
  const last = idx + 1 >= total
  return (
    <div className={`${d5.slideIn} ${state === 'bad' ? d5.shakeHard : ''}`} data-testid="hard-question">
      <div className={d5.topbar}>
        <span className={`${d5.hardTag} ${state === 'ask' ? d5.pulse : ''}`}>HARD</span>
        <div className={d5.stepsCompact}><span className={`${d5.stepPill} ${d5.now}`} data-testid="hard-step">{idx + 1} of {total}</span></div>
        <span className={d5.legend} aria-hidden="true">♛♛♛<b>♛</b></span>
      </div>
      <div className={d5.ask}>
        <StudyMark mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={60} />
        <div className={d5.bubble}>{bubble}</div>
      </div>
      <div className={d5.qLine}>
        <span className={d5.qSetup}>{state === 'ask' ? 'Name it' : ticker || item.name}</span>
        <span className={d5.qText}>{state === 'ask' ? 'No ticker, no averages, no volume. Which setup, if any, fired on the last candle?' : `A ${item.name} question from the bank${ticker ? `, on ${ticker}` : ''}.`}</span>
      </div>
      <div className={lab.chartBox}>
        {state !== 'ask' ? <Stamp ok={state === 'ok'} /> : null}
        <ChallengeChart id={item.id} bars={all} view={Math.min(90, all?.length || 0)} height={320} annotations={ann} chartOpts={HARD_CHART} fetcher={fetcher} />
      </div>
      <div className={`${d5.cards} ${d5.cascade}`} data-testid="hard-cards">
        {choices.map((c, k) => {
          let cls = d5.card
          if (state === 'ask' && pick === k) cls += ` ${d5.sel}`
          if (state !== 'ask' && pick === k) cls += state === 'ok' ? ` ${d5.right}` : ` ${d5.wrong}`
          if (rightCard(c)) cls += ` ${d5.right}`
          return <button key={c} type="button" className={cls} style={{ '--i': k }} disabled={state !== 'ask'} onClick={() => { setPick(k); tapFeedback(prefs) }}><span className={d5.key}>{k + 1}</span>{c}</button>
        })}
      </div>
      {state !== 'ask' && lesson ? <details className={d5.whyCard} open><summary>The lesson</summary><p>{lesson}</p></details> : null}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask'
          ? <button type="button" className={`${d5.btn} ${pick != null && !busy ? d5.live : ''}`} disabled={pick == null || busy} onClick={check} data-testid="hard-check">{busy ? 'Checking' : 'Check'}</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok', xp)} data-testid="hard-next">{last ? 'See the run' : 'Next'}</button>}
      </div></div>
    </div>
  )
}

function Done({ right, total, xp, onBack, onAgain }) {
  const perfect = total > 0 && right === total
  const shown = useCountUp(xp, true, 28)
  return (
    <>
      {perfect ? <Confetti /> : null}
      <StartCard tone="dark" eyebrow="Hard mode" title={perfect ? 'Legendary' : `${right} of ${total}`} art={<Crowns lit={perfect} size={54} />}
        lead={perfect ? `${total} for ${total} with nothing to lean on. The fourth crown is lit for this run.` : `${right} named with nothing to lean on. ${total} for ${total} lights the fourth crown.`}
        button={<StartButton tone="dark" icon="crown" label="Again" sub="new charts · candles only" onClick={onAgain} />}
        below={<button type="button" className={d5.linkBtn} onClick={onBack}>Back to Study</button>}>
        <div className={d5.gems}>
          <div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="check" size={20} /></span><small>Right</small><b data-testid="hard-right">{right}/{total}</b></div></div>
          <div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>XP earned</small><b data-testid="hard-xp">+{shown}</b></div></div>
        </div>
      </StartCard>
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
  const [xp, setXp] = useState(0)
  const [run, setRun] = useState(0)
  useEffect(() => {
    let on = true
    fetchSpotPool(undefined, 4, fetcher).then((p) => { if (on) setPool(p) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])
  const total = Math.min(HARD_TOTAL, pool?.length || 0)
  const items = useMemo(() => (pool ? pool.slice(0, HARD_TOTAL) : []), [pool, run])   // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { setPhase('play'); setI(0); setRight(0); setXp(0); setRun((r) => r + 1); if (pool) setPool((p) => [...p.slice(HARD_TOTAL), ...p.slice(0, HARD_TOTAL)]) }
  const again = () => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('intro') }

  if (error) return <ChallengeError what="the hard-mode charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'intro') {
    const count = total || 'Eight'
    return (
      <StartCard tone="dark" eyebrow="Challenge" title="Hard mode" art={<Crowns size={44} />}
        lead={`${count} charts from the bank with nothing to lean on: no ticker, no averages, no volume. Candles only. Name what fired, or say nothing did. ${count} for ${String(count).toLowerCase()} lights the fourth crown.${pool ? '' : ' Loading the bank.'}`}
        button={<StartButton tone="dark" icon="crown" label={pool == null ? 'Loading the bank' : pool.length ? 'Start hard mode' : 'No charts yet'} sub={pool == null ? 'a second or two' : pool.length ? `${total} charts · candles only` : 'come back after a new import'} onClick={() => pool?.length && start()} />}>
        <div className={d5.gems}>
          <div className={`${d5.gem} ${d5.dim}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="eyeOff" size={20} /></span><small>Hidden</small><b>ticker · averages · volume</b></div></div>
          <div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>On a perfect run</small><b>Legendary</b></div></div>
        </div>
      </StartCard>
    )
  }
  if (phase === 'done') return <Done right={right} total={total} xp={xp} onBack={onClose} onAgain={again} />
  const item = items[i]
  if (!item) return <p className={d5.startLead}>No charts in the bank yet.</p>
  return <Q key={`${run}-${i}`} idx={i} item={item} total={total} prefs={prefs} fetcher={fetcher} onDone={(ok, gained) => { setXp((v) => v + (gained || 0)); if (ok) setRight((v) => v + 1); if (i + 1 >= total) { setPhase('done'); endFeedback(prefs) } else setI(i + 1) }} />
}
