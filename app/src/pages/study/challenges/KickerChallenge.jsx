// SPOT THE KICKER (ported from the workbench's piece under the owner's delegation, 2026-11-03; his name for it).
// A Kicker chart from the bank with two look-alikes found by his own three rules; the candidates are painted gold
// with a letter each. Tap the real one (on the chart or its card), Check, and every candidate opens a rule card:
// the red day, the gap over its close, the strong close above its high, each ticked or crossed from the bars. The
// bank item is a Yes/No "does the Kicker fire on the last candle" question; the answer posted is Yes when the member
// picked the real candle and No otherwise, with the picked bar recorded beside it, so the attempt is scored on the
// server and counts like any other.
import { useEffect, useMemo, useRef, useState } from 'react'
import StudyMark from '../../../components/study/StudyMark'
import StartCard, { StartButton } from '../../../lab/StartCard'
import { Stamp } from '../../../lab/bits'
import { useRunOn } from '../../../lab/fx'
import { boxAt, rayAt } from '../../../lab/pointers'
import d5 from '../../../lab/duo.module.css'
import lab from '../../../lab/lab.module.css'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import LoadFailed from '../../journal-2-0/components/LoadFailed'
import ChallengeChart from './ChallengeChart'
import { fetchSpotPool, scoreAttempt } from './challengeBank'
import { KIND_WORD, candidates, rules } from './kickerRules'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'

export const KICKER_SKILL = 'setup.family3.kicker'
const GOLD = '#dcbb5e'

/** The bank's Yes / No for this item (its choices), by meaning, never by position. */
export function yesNo(choices) {
  const list = Array.isArray(choices) ? choices : []
  const yes = list.find((c) => /^y(es)?$/i.test(String(c).trim())) ?? list[0] ?? 'Yes'
  const no = list.find((c) => /^no?$/i.test(String(c).trim())) ?? list.find((c) => c !== yes) ?? 'No'
  return { yes, no }
}

function Round({ idx, item, total, prefs, fetcher, onDone }) {
  const phone = useIsPhone()
  const VIEW = phone ? 55 : 90
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const [fwd, setFwd] = useState(null)
  const [lesson, setLesson] = useState('')
  const shownAt = useRef(0)
  useEffect(() => { shownAt.current = performance.now() }, [])
  const vis = item.bars
  const n = vis.length
  const cands = useMemo(() => candidates(vis, VIEW), [vis, VIEW])
  const view = useMemo(() => (cands.length ? Math.min(n, Math.max(50, n - cands[0].i + 24)) : Math.min(n, 70)), [cands, n])
  const all = useRunOn(vis, fwd, state !== 'ask', 200)
  const highlight = useMemo(() => (state === 'ask' ? cands.map((c) => vis[c.i].t) : null), [cands, vis, state])
  const extra = useMemo(() => (highlight ? { highlightBarTime: highlight, highlightColor: GOLD } : null), [highlight])
  const annotations = useMemo(() => {
    if (!n || !all) return null
    const a = []
    cands.forEach((c, k) => {
      const letter = String.fromCharCode(65 + k)
      const b = all[c.i], first = Math.max(0, n - view), left = c.i - 4 >= first + 3, at = left ? all[c.i - 4] : all[Math.min(all.length - 1, c.i + 2)]
      const sel = pick === c.i
      const real = c.kind === 'real'
      const color = state === 'ask' ? (sel ? '#fff1c2' : GOLD) : real ? '#2faf68' : '#df4646'
      // neighbours alternate above and below the candle so two chips never sit on each other
      const chipPrice = (b.o + b.c) / 2 + (b.h - b.l) * (k % 2 ? -0.9 : 0.9)
      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: chipPrice }], text: ` ${state === 'ask' ? letter : KIND_WORD[c.kind]} `, color: sel || state !== 'ask' ? '#111' : color, fontSize: sel ? 14 : 12, bgEnabled: true, bgColor: sel || state !== 'ask' ? color : 'rgba(11,11,11,.88)', borderEnabled: true, borderColor: color, locked: true })
      if (sel || state !== 'ask') {
        if (c.i + 1 < all.length) a.push(...boxAt(all, c.i, { id: `x${k}`, color }))
        else a.push({ id: `v${k}`, type: 'vertical', points: [{ time: b.t, price: b.c }], color, lineWidth: 2, lineStyle: 'dashed', locked: true })
      }
    })
    if (state !== 'ask') a.push(...rayAt(vis[n - 1], 'l', { id: 'l', label: '' }))
    return a
  }, [cands, all, vis, n, state, pick, view])
  const ok = pick === n - 1
  const check = async () => {
    if (pick == null || state !== 'ask') return
    const { yes, no } = yesNo(item.choices)
    const picked = cands.find((c) => c.i === pick)
    let right = ok
    try {
      const a = await scoreAttempt(item, { choice: ok ? yes : no, picked_bar: vis[pick]?.t ?? null, picked_kind: picked?.kind || null }, performance.now() - shownAt.current, fetcher)
      right = !!a.correct; setFwd(a.forward); setLesson(a.reveal?.lesson || '')
    } catch { /* the verdict stays the local one; the attempt is not recorded */ }
    setState(right ? 'ok' : 'bad'); revealFeedback(right, prefs)
  }
  const tapBar = ({ index }) => {
    if (state !== 'ask' || index < 0) return
    const near = cands.map((c) => ({ c, dd: Math.abs(c.i - index) })).sort((p, q) => p.dd - q.dd)[0]
    if (near && near.dd <= (phone ? 5 : 3)) { setPick(near.c.i); tapFeedback(prefs) }
  }
  return (
    <div className={state === 'bad' ? d5.shakeHard : ''} data-testid="kicker-round">
      <div className={d5.topbar}><span className={d5.bossLabel}>Spot the Kicker · {idx + 1} of {total}</span><div className={d5.prog}>{Array.from({ length: total }, (_, k) => <i key={k} className={k < idx ? d5.on : k === idx ? d5.cur : ''} />)}</div></div>
      <div className={d5.ask}><StudyMark mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : ok ? 'happy' : 'oops'} size={60} /><div className={d5.bubble}>{state === 'ask' ? `Spot the Kicker. ${cands.length} gold candles each gapped up after a red day; only one is the real thing. Tap it.` : ok ? 'That is the Kicker. The cards say why the others fail.' : 'That one fails a rule. The Kicker is the green one.'}</div></div>
      <div className={lab.chartBox}>
        {state === 'ask' && pick == null ? <span className={lab.tapHint}>spot the Kicker</span> : null}
        {state !== 'ask' ? <Stamp ok={ok} /> : null}
        <ChallengeChart id={item.id} bars={all} view={view} height={phone ? 340 : 440} annotations={annotations} extra={extra} onBarTap={state === 'ask' ? tapBar : null} fetcher={fetcher} />
      </div>
      <div className={`${d5.candRow} ${d5.cascade}`} style={phone ? undefined : { gridTemplateColumns: `repeat(${Math.max(1, cands.length)}, 1fr)` }} data-testid="kicker-cards">{cands.map((c, k) => {
        const rs = state !== 'ask' ? rules(vis, c.i) : null
        return (
          <button key={c.i} type="button" style={{ '--i': k }} className={`${d5.cand} ${pick === c.i ? d5.sel : ''} ${state !== 'ask' ? (c.kind === 'real' ? d5.right : d5.wrong) : ''}`} disabled={state !== 'ask'} onClick={() => { setPick(c.i); tapFeedback(prefs) }} aria-label={`Candle ${String.fromCharCode(65 + k)}, ${vis[c.i].t}`}>
            <span className={d5.candHead}><span className={d5.letter}>{String.fromCharCode(65 + k)}</span><span>{vis[c.i].t}</span></span>
            {rs ? <span className={d5.ruleList}>{rs.map((r) => <span key={r.k} className={r.ok ? d5.ruleOk : d5.ruleBad}><b>{r.ok ? '✓' : '✕'}</b><span>{r.label}</span><small>{r.value}</small></span>)}</span> : <small>{pick === c.i ? 'your pick' : 'tap to pick'}</small>}
          </button>
        )
      })}</div>
      {state !== 'ask' && lesson ? <details className={d5.whyCard} open><summary>The lesson</summary><p>{lesson}</p></details> : null}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={check} data-testid="kicker-check">Check</button>
          : <button type="button" className={`${d5.btn} ${ok ? d5.live : d5.red}`} onClick={() => onDone(ok)} data-testid="kicker-next">{idx + 1 < total ? 'Next' : 'Finish'}</button>}
      </div></div>
    </div>
  )
}

export default function KickerChallenge({ profile = null, fetcher = studyFetch, onClose }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const phone = useIsPhone()
  const [phase, setPhase] = useState('start')    // start | play | done
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [i, setI] = useState(0)
  const [right, setRight] = useState(0)
  useEffect(() => {
    let on = true
    // only items with at least one look-alike in view make a round
    fetchSpotPool([KICKER_SKILL], 10, fetcher).then((p) => { if (on) setPool(p.filter((it) => candidates(it.bars, phone ? 55 : 90).length >= 2)) }).catch((e) => { if (on) { setError(e); setPool([]) } })
    return () => { on = false }
  }, [reload, fetcher, phone])
  const total = Math.min(8, pool?.length || 0)
  if (error) return <LoadFailed what="the Kicker charts" error={error} onRetry={() => { setPool(null); setError(null); setReload((r) => r + 1) }} />
  if (phase === 'start') {
    return (
      <StartCard eyebrow="Challenge" title="Spot the Kicker" art={<StudyMark mood="think" size={116} />}
        lead="Gold candles that each gapped up after a red day. Only one is the real Kicker: a real red day before it, a gap over that day's close, a strong close above its high. Tap the one you believe, then read the rule cards."
        button={<StartButton icon="eye" label={pool == null ? 'Loading the bank' : total ? 'Start' : 'No unseen charts left'} sub={pool == null ? 'a second or two' : total ? `${total} charts · three rules` : 'come back after a new import'} onClick={() => total && setPhase('play')} />} />
    )
  }
  if (phase === 'done') {
    return (
      <StartCard eyebrow="Spot the Kicker" title={`${right} of ${total}`} art={<StudyMark mood={right === total ? 'fire' : 'happy'} size={116} />}
        lead={right === total ? 'Every Kicker found. The rules are yours.' : 'The rule cards on the misses are the lesson. Run it again.'}
        button={<StartButton icon="play" label="Back to Study" sub="your trail is waiting" onClick={onClose} />}
        below={<button type="button" className={d5.linkBtn} onClick={() => { setPool(null); setError(null); setReload((r) => r + 1); setI(0); setRight(0); setPhase('start') }}>Again</button>} />
    )
  }
  const item = pool?.[i]
  if (!item) return <p className={d5.startLead}>No unseen charts left for now.</p>
  return <Round key={item.id} idx={i} item={item} total={total} prefs={prefs} fetcher={fetcher} onDone={(ok) => { if (ok) setRight((v) => v + 1); if (i + 1 >= total) { setPhase('done'); endFeedback(prefs) } else setI(i + 1) }} />
}
