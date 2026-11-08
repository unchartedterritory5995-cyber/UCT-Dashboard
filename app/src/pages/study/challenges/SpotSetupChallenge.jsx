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
import StudyMark from '../../../components/study/StudyMark'
import StartCard, { StartButton } from '../../../lab/StartCard'
import { Stamp } from '../../../lab/bits'
import { useRunOn } from '../../../lab/fx'
import { boxAt, rayAt } from '../../../lab/pointers'
import StudyButton from '../ui/StudyButton'
import { HudCombo } from '../ui/HudLooks'
import { EndHard } from '../ui/EndLooks'
import s2 from '../ui/study.module.css'
import { brandWords } from '../drills/types'
import d5 from '../../../lab/duo.module.css'
import lab from '../../../lab/lab.module.css'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError from './ChallengeError'
import ChallengeChart from './ChallengeChart'
import { SETUP_SKILLS, fetchSpotPool, scoreAttempt, setupName } from './challengeBank'
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
  const [fwd, setFwd] = useState(null)
  const [lesson, setLesson] = useState('')
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
  const all = useRunOn(vis, fwd, state !== 'ask', 200)
  const highlight = useMemo(() => (state === 'ask' ? cands.map((c) => vis[c.i].t) : null), [cands, vis, state])
  const extra = useMemo(() => (highlight ? { highlightBarTime: highlight, highlightColor: GOLD } : null), [highlight])
  const word = name.toUpperCase()
  const annotations = useMemo(() => {
    if (!n || !all) return null
    const a = []
    cands.forEach((c, k) => {
      const letter = String.fromCharCode(65 + k)
      const sel = pick === c.i
      const real = c.kind === 'real'
      const b = all[c.i], first = Math.max(0, n - view), left = c.i - 4 >= first + 3, at = left ? all[c.i - 4] : all[Math.min(all.length - 1, c.i + 2)]
      const color = state === 'ask' ? (sel ? '#fff1c2' : GOLD) : real ? '#2faf68' : '#df4646'
      // neighbours alternate above and below the candle so two chips never sit on each other
      const chipPrice = (b.o + b.c) / 2 + (b.h - b.l) * (k % 2 ? -0.9 : 0.9)
      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: chipPrice }], text: ` ${state === 'ask' ? letter : real ? word : 'NOT IT'} `, color: sel || state !== 'ask' ? '#111' : color, fontSize: sel ? 14 : 12, bgEnabled: true, bgColor: sel || state !== 'ask' ? color : 'rgba(11,11,11,.88)', borderEnabled: true, borderColor: color, locked: true })
      if (sel || state !== 'ask') {
        if (c.i + 1 < all.length) a.push(...boxAt(all, c.i, { id: `x${k}`, color }))
        else a.push({ id: `v${k}`, type: 'vertical', points: [{ time: b.t, price: b.c }], color, lineWidth: 2, lineStyle: 'dashed', locked: true })
      }
    })
    if (state !== 'ask') a.push(...rayAt(vis[n - 1], 'l', { id: 'l', label: '' }))
    return a
  }, [cands, all, vis, n, state, pick, view, word])
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
    if (near && near.dd <= (phone ? 5 : 4)) { setPick(near.c.i); tapFeedback(prefs) }
  }
  const real = cands.find((c) => c.kind === 'real')
  return (
    <div className={state === 'bad' ? d5.shakeHard : ''} data-testid="spot-round">
      <HudCombo label="Spot the Setup" step={idx} total={total} results={state === 'ask' ? results : [...results, ok]} live={state === 'ask'} stepTestId="spot-step" />
      <div className={d5.ask}><StudyMark mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : ok ? 'happy' : 'oops'} size={60} /><div className={d5.bubble}>
        {state === 'ask'
          ? <><b>Spot the {name}.</b> {cands.length} gold candles look alike; only one is the real {name}. Tap it.</>
          : ok ? `That is the ${name}. The cards measure the others against it.` : `Not that one. The ${name} is the green one; the cards say why the others are not.`}
      </div></div>
      <div className={lab.chartBox}>
        {state === 'ask' && pick == null ? <span className={lab.tapHint}>spot the {name}</span> : null}
        {state !== 'ask' ? <Stamp ok={ok} /> : null}
        <ChallengeChart id={item.id} bars={all} view={view} height={phone ? 340 : 440} annotations={annotations} extra={extra} onBarTap={state === 'ask' ? tapBar : null} fetcher={fetcher} />
      </div>
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
      {state !== 'ask' && lesson ? <details className={d5.whyCard} open><summary>The lesson</summary><p>{brandWords(lesson)}</p></details> : null}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" disabled={pick == null} onClick={check} testId="spot-check">Check</StudyButton>
          : <StudyButton kind={ok ? 'good' : 'bad'} size="xl" arrow wide hotkey="Enter" onClick={() => onDone(ok, name)} testId="spot-next">{idx + 1 < total ? 'Next' : 'Finish'}</StudyButton>}
      </div></div>
    </div>
  )
}

/** Charts that can play, mixed across the setups: the bank's swept pool, each chart's look-alikes from the server, a
 *  round-robin by setup so a run is not eight of one kind. */
async function loadPool(fetcher, view) {
  const pool = await fetchSpotPool(Object.keys(SETUP_SKILLS), 6, fetcher, undefined, { hard: true })
  const looked = await Promise.all(pool.slice(0, 24).map((it) => fetcher(`/api/study/items/${encodeURIComponent(it.id)}/lookalikes?view=${view}`)
    .then((look) => (look?.lookalikes?.length ? { ...it, name: setupName(it.skill), look } : null)).catch(() => null)))
  const by = new Map()
  for (const it of looked.filter(Boolean)) { if (!by.has(it.skill)) by.set(it.skill, []); by.get(it.skill).push(it) }
  const out = []
  for (let k = 0; out.length < ROUNDS && [...by.values()].some((l) => l.length > k); k++) {
    for (const list of by.values()) { if (list[k] && out.length < ROUNDS) out.push(list[k]) }
  }
  return out
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
      <StartCard eyebrow="Challenge" title="Spot the Setup" art={<StudyMark mood="think" size={116} />}
        lead="One chart, a few gold candles that look alike. Only one is the real setup named at the top. Tap it, then read how the others measure up against it."
        button={<StartButton icon="eye" label={pool == null ? 'Loading the bank' : total ? 'Start' : 'No charts yet'} sub={pool == null ? 'a second or two' : total ? `${total} charts · ${setups.length} setup${setups.length === 1 ? '' : 's'}` : 'come back after a new import'} disabled={!total} onClick={() => total && setPhase('play')} />} />
    )
  }
  if (phase === 'done') {
    const again = () => { setPool(null); setError(null); setReload((r) => r + 1); setI(0); setRight(0); setResults([]); setLog([]); setPhase('start') }
    return (
      <div className={s2.kit}>
        <EndHard right={right} total={total} xp={0} results={results} log={log}
          unit="setups spotted" againLabel="Again" testIdPrefix="spot" onAgain={again} onBack={onClose} />
      </div>
    )
  }
  const item = pool?.[i]
  if (!item) return <p className={d5.startLead}>No charts in the bank yet.</p>
  return <Round key={item.id} idx={i} item={item} total={total} prefs={prefs} fetcher={fetcher} results={results}
    onDone={(ok, name) => { if (ok) setRight((v) => v + 1); setResults((r) => [...r, !!ok]); setLog((l) => [...l, { name, ticker: '', ok }]); if (i + 1 >= total) { setPhase('done'); endFeedback(prefs) } else setI(i + 1) }} />
}
