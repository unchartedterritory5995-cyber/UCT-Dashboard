// BOSS (ported from the workbench's Boss V3 under the owner's delegation, 2026-11-03). Ten charts from the bank,
// one heart: miss once and it ends. Every chart is scored on the server (and earns XP like any attempt); the
// follow-through runs on from the item's own forward bars. The XP shown at the end is what the attempts earned,
// never a number invented here; a boss bonus is a server decision for later.
import { useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import StudyMark from '../../../components/study/StudyMark'
import StartCard, { StartButton } from '../../../lab/StartCard'
import { BossBar, Chest, Confetti, Heart, Medal, Stamp } from '../../../lab/bits'
import { useCountUp, useRunOn } from '../../../lab/fx'
import { spot, rayAt } from '../../../lab/pointers'
import d5 from '../../../lab/duo.module.css'
import lab from '../../../lab/lab.module.css'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { BOSS_TOTAL, fetchSpotPool, scoreAttempt } from './challengeBank'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'

function Q({ idx, item, total, onDone, prefs, fetcher }) {
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const [fwd, setFwd] = useState(null)
  const [why, setWhy] = useState('')
  const [xp, setXp] = useState(0)
  const shownAt = useRef(0)
  useEffect(() => { shownAt.current = performance.now() }, [])
  const bars = item.bars
  const n = bars.length
  const all = useRunOn(bars, fwd, state !== 'ask', 160)
  const ann = useMemo(() => (!n || !all ? null : state === 'ask' ? spot(all, n - 1, { label: 'this candle', id: `b${idx}` }) : [...spot(all, n - 1, { label: state === 'ok' ? 'you were right' : 'the answer', id: `b${idx}`, color: state === 'ok' ? '#2faf68' : '#df4646' }), ...rayAt(bars[n - 1], 'l', { id: `b${idx}l`, label: '' })]), [all, bars, n, state, idx])
  const check = async () => {
    if (pick == null || state !== 'ask') return
    const choice = item.choices[pick]
    let ok = false
    try {
      const a = await scoreAttempt(item, { choice }, performance.now() - shownAt.current, fetcher)
      ok = !!a.correct; setFwd(a.forward); setWhy(a.reveal?.lesson || ''); setXp(Number(a.progress?.xp_gained || 0))
    } catch { ok = false }
    setState(ok ? 'ok' : 'bad'); revealFeedback(ok, prefs)
  }
  useEffect(() => {
    const k = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (state !== 'ask') { if (e.key === 'Enter') onDone(state === 'ok', item, xp); return }
      const i = +e.key - 1; if (i >= 0 && i < item.choices.length) setPick(i)
      if (e.key === 'Enter' && pick != null) check()
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  const gone = idx + (state === 'ok' ? 1 : 0)
  return (
    <div className={`${d5.slideIn} ${state === 'bad' ? d5.shakeHard : ''}`} data-testid="boss-question">
      {state === 'bad' ? <div className={d5.vignetteRed} /> : null}
      <div className={d5.bossTop}><span className={d5.bossLabel}>Boss · {idx + 1} of {total}</span><BossBar total={total} gone={gone} /><Heart size={30} bpm={56 + idx * 9} cracked={state === 'bad'} /></div>
      <div className={d5.ask}><StudyMark mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : state === 'ok' ? 'happy' : 'oops'} size={60} /><div className={d5.bubble}>{state === 'ask' ? 'One heart. Read the last candle.' : state === 'ok' ? 'Still standing. Watch it run.' : 'That was the heart.'}</div></div>
      <div className={d5.qLine}><span className={d5.qSetup}>{item.name}</span><span className={d5.qText}>{item.q}</span></div>
      <div className={lab.chartBox}>{state !== 'ask' ? <Stamp ok={state === 'ok'} /> : null}<ChallengeChart id={item.id} bars={all} view={Math.min(90, all?.length || 0)} height={320} annotations={ann} fetcher={fetcher} /></div>
      <div className={`${d5.cards} ${d5.cascade}`}>{item.choices.map((c, k) => { let cls = d5.card; if (state === 'ask' && pick === k) cls += ` ${d5.sel}`; if (state !== 'ask' && pick === k) cls += state === 'ok' ? ` ${d5.right}` : ` ${d5.wrong}`; return <button key={c} type="button" className={cls} style={{ '--i': k }} disabled={state !== 'ask'} onClick={() => { setPick(k); tapFeedback(prefs) }}><span className={d5.key}>{k + 1}</span>{c}</button> })}</div>
      {state !== 'ask' && why ? <details className={d5.whyCard} open><summary>The lesson</summary><p>{why}</p></details> : null}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={check} data-testid="boss-check">Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => onDone(state === 'ok', item, xp)} data-testid="boss-next">{state === 'ok' ? (idx + 1 < total ? 'Next' : 'Claim the trophy') : 'See what to review'}</button>}
      </div></div>
    </div>
  )
}

function Win({ xp, onBack, onAgain }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOpen(true), 900); return () => clearTimeout(t) }, [])
  const shown = useCountUp(xp, true, 28)
  return (
    <>
      <Confetti />
      <StartCard eyebrow="Boss" title="Boss cleared" art={<div className={d5.winRow}><Medal size={130} won label="★" /><Chest size={120} open={open} /></div>}
        lead="Ten for ten with one heart. That is a trader."
        button={<StartButton icon="play" label="Back to Study" sub="your trail is waiting" onClick={onBack} />}
        below={<button type="button" className={d5.linkBtn} onClick={onAgain}>Face the boss again</button>}>
        <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>XP earned</small><b data-testid="boss-xp">+{shown}</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="save" size={20} /></span><small>Chest</small><b>{open ? 'Open' : 'Opening'}</b></div></div></div>
      </StartCard>
    </>
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
  useEffect(() => {
    let on = true
    fetchSpotPool(undefined, 4, fetcher).then((p) => { if (on) setPool(p) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher])
  const total = Math.min(BOSS_TOTAL, pool?.length || 0)
  const items = useMemo(() => (pool ? pool.slice(0, BOSS_TOTAL) : []), [pool, run])   // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { setPhase('play'); setI(0); setMissed(null); setXp(0); setRun((r) => r + 1); if (pool) setPool((p) => [...p.slice(BOSS_TOTAL), ...p.slice(0, BOSS_TOTAL)]) }

  if (error) return <ChallengeError what="the boss charts" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'intro') {
    return (
      <>
        <div className={`${d5.vignetteRed} ${d5.soft}`} />
        <StartCard tone="red" eyebrow="Challenge" title="Boss" art={<div className={d5.winRow}><Medal size={110} label="★" /><div className={d5.heartBig}><Heart size={64} bpm={64} /></div></div>}
          lead={`${total || 'Ten'} charts from the bank. One heart. Miss once and it ends. Pass and the trophy and a chest are yours.${pool ? '' : ' Loading the bank.'}`}
          button={<StartButton tone="red" icon="medal" label={pool == null ? 'Loading the bank' : pool.length ? 'Face the boss' : 'No unseen charts left'} sub={pool == null ? 'a second or two' : pool.length ? `${total} charts · one heart` : 'come back after a new import'} onClick={() => pool?.length && start()} />}>
          <div className={d5.gems}><div className={`${d5.gem} ${d5.dim}`}><div className={d5.gemIn}><span className={d5.gemIcon} style={{ color: '#ff6b6b' }}><Heart size={20} bpm={64} /></span><small>Hearts</small><b>1</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>On a pass</small><b>Trophy</b></div></div><div className={`${d5.gem} ${d5.ember}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="save" size={20} /></span><small>Plus</small><b>a chest</b></div></div></div>
        </StartCard>
      </>
    )
  }
  if (phase === 'win') return <Win xp={xp} onBack={onClose} onAgain={() => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('intro') }} />
  if (phase === 'fail') {
    return (
      <>
        <div className={`${d5.vignetteRed} ${d5.soft}`} />
        <StartCard tone="red" eyebrow={`Fell on chart ${i + 1} of ${total}`} title="Not yet" art={<div className={d5.heartBig}><Heart size={84} broken /></div>}
          lead={`The one you missed was a ${missed?.name || 'setup'} chart. A boss needs every rule cold.`}
          button={<StartButton tone="red" icon="medal" label="Try the boss again" sub="new charts · one heart" onClick={() => { setPool(null); setError(null); setReload((r) => r + 1); setPhase('intro') }} />}
          below={<button type="button" className={d5.linkBtn} onClick={onClose}>Back to Study</button>} />
      </>
    )
  }
  const item = items[i]
  if (!item) return <p className={d5.startLead}>No unseen charts left for now.</p>
  return <Q key={`${run}-${i}`} idx={i} item={item} total={total} prefs={prefs} fetcher={fetcher} onDone={(ok, it, gained) => { setXp((v) => v + (gained || 0)); if (!ok) { setMissed(it); setPhase('fail'); return } if (i + 1 >= total) { setPhase('win'); endFeedback(prefs) } else setI(i + 1) }} />
}
