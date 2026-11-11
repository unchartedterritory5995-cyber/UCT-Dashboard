import { useCallback, useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import UIcon from '../../components/ui/UIcon'
import StartCard, { StartButton } from '../StartCard'
import { Confetti, Stamp } from '../bits'
import { useRunOn } from '../fx'
import { useSample } from '../Lab'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { spot, rayAt, pct, tag } from '../pointers'
import { studySettingsOverride } from '../../pages/study/studyChartLook'
import { sfx, voice } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

const HARD = { settingsOverride: studySettingsOverride({ overlays: false, volume: false }), hideWatermark: true, hideLegend: true, showVolume: false }
const MAX_STOP_PCT = 3.5
const r2 = (v) => Math.round(v * 100) / 100
const money = (v) => `$${v.toFixed(2)}`

/** Round 11, piece 4: HARD MODE V3 (owner, batch 10: "show the next candles a bit slower and also give more of an
 *  interactive lesson for the buy day of where and how to enter and where to place your stop"). One chart, three
 *  steps on it: NAME IT (candles only, what fired?) -> ENTER IT (where do you buy? tap the line: the previous day's
 *  high, the house's day-1 trigger) -> STOP IT (tap where the stop goes, graded against the house rule). Then the
 *  next candles arrive slowly, one every third of a second, so the follow-through is watched. */
function Crowns({ lit = false }) {
  return <div className={d5.crownRow}><span>♛</span><span>♛</span><span>♛</span><span className={`${d5.dimC} ${lit ? d5.lit : ''}`}>♛</span></div>
}

const STEPS = ['name', 'enter', 'stop', 'run']

function Lesson({ onDone }) {
  const d = useSample('JBI_2023-12-14')
  const phone = useIsPhone()
  const [step, setStep] = useState('name')
  const [pick, setPick] = useState(null)
  const [verdict, setVerdict] = useState(null)      // per step: 'ok' | 'bad'
  const [entryPick, setEntryPick] = useState(null)  // price tapped for the entry
  const [stopPick, setStopPick] = useState(null)
  const [right, setRight] = useState(0)
  const vis = d?.visible
  const n = vis?.length || 0
  const kick = n ? vis[n - 1] : null
  const red = n > 1 ? vis[n - 2] : null
  const entry = red ? r2(red.h + 0.01) : null
  const house = useMemo(() => { if (!kick || !entry) return null; const lowDist = pct(entry, kick.l) * -1; return lowDist > MAX_STOP_PCT ? r2(entry * (1 - MAX_STOP_PCT / 100)) : kick.l }, [kick, entry])
  const all = useRunOn(vis, d?.forward, step === 'run', 330)
  const ann = useMemo(() => {
    if (!n || !all || !red) return null
    const a = []
    if (step === 'name') a.push(...spot(all, n - 1, { label: verdict ? 'the Kicker' : 'this candle', id: 'k', color: verdict === 'bad' ? '#df4646' : verdict === 'ok' ? '#2faf68' : '#dcbb5e' }))
    else a.push(...spot(all, n - 1, { label: phone ? 'day 1' : 'day 1 · the Kicker', id: 'k', color: '#2faf68', halo: step === 'run' }))
    if (step !== 'name') {
      const e0 = Math.max(0, all.length - (phone ? 38 : 53))
      const edge = all[e0].t, col = (k) => all[Math.min(all.length - 1, e0 + k * (phone ? 12 : 10))].t   // tags in their own columns so close prices never stack
      a.push({ id: 'e', type: 'hray', points: [{ time: edge, price: entry }], color: '#2faf68', lineWidth: 1.5, lineStyle: step === 'enter' && !verdict ? 'dashed' : 'solid' })
      a.push(tag(edge, entry, step === 'enter' && !verdict ? 'the line' : (phone ? `entry ${entry.toFixed(2)}` : `entry ${money(entry)}`), '#2faf68', 'e-tag'))
      if (step === 'enter' && !verdict && !phone) {
        a.push({ id: 'dc', type: 'hray', points: [{ time: edge, price: red.c }], color: '#9a958a', lineWidth: 1, lineStyle: 'dotted' }); a.push(tag(col(2), red.c, "yesterday's close", '#9a958a', 'dc-tag'))
        a.push({ id: 'ko', type: 'hray', points: [{ time: edge, price: kick.o }], color: '#9a958a', lineWidth: 1, lineStyle: 'dotted' }); a.push(tag(col(1), kick.o, "today's open", '#9a958a', 'ko-tag'))
      }
      if (step === 'enter' && entryPick != null) a.push({ id: 'ep', type: 'hray', points: [{ time: all[Math.max(0, n - 10)].t, price: entryPick }], color: verdict === 'ok' ? '#2faf68' : '#dcbb5e', lineWidth: 2, lineStyle: 'dashed' })
      if ((step === 'stop' || step === 'run') && stopPick != null) { a.push({ id: 'sp', type: 'hray', points: [{ time: edge, price: stopPick }], color: '#ff6b6b', lineWidth: 1.5, lineStyle: 'dashed' }); a.push(tag(col(1), stopPick, phone ? `stop ${stopPick.toFixed(2)}` : `your stop ${money(stopPick)}`, '#ff6b6b', 'sp-tag')) }
      if ((step === 'stop' && verdict) || step === 'run') { a.push({ id: 'hs', type: 'hray', points: [{ time: edge, price: house }], color: '#dcbb5e', lineWidth: 1.5 }); a.push(tag(col(2), house, phone ? `house ${house.toFixed(2)}` : `house stop ${money(house)}`, '#dcbb5e', 'hs-tag')) }
    }
    if (step === 'run') a.push(...rayAt(vis[n - 1], 'l', { id: 'l', label: '' }))
    return a
  }, [all, vis, n, red, kick, entry, house, step, verdict, entryPick, stopPick, phone])
  const onTap = useCallback(({ price }) => {
    if (!Number.isFinite(price) || verdict) return
    if (step === 'enter') setEntryPick(r2(price))
    if (step === 'stop') setStopPick(r2(price))
  }, [step, verdict])
  const check = () => {
    let ok = false
    if (step === 'name') ok = pick === 1
    if (step === 'enter') ok = entryPick != null && Math.abs(pct(entry, entryPick)) <= 0.6
    if (step === 'stop') ok = stopPick != null && Math.abs(pct(house, stopPick)) <= 1.5
    setVerdict(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong'); if (ok) setRight((v) => v + 1)
    if (ok && step === 'enter') voice('entry'); if (ok && step === 'stop') voice('line')
  }
  const next = () => { const k = STEPS.indexOf(step); setVerdict(null); setStep(STEPS[k + 1]) }
  useEffect(() => {
    const k = (e) => { if (verdict) { if (e.key === 'Enter') (step === 'stop' ? next() : next()); return } if (step === 'name' && /^[1-4]$/.test(e.key)) setPick(+e.key - 1); if (e.key === 'Enter') check() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const ready = step === 'name' ? pick != null : step === 'enter' ? entryPick != null : step === 'stop' ? stopPick != null : true
  const bubble = step === 'name' ? (verdict == null ? 'Candles only. What setup, if any, just fired?' : verdict === 'ok' ? 'Kicker. Now the buy day.' : 'It was the Kicker. Now the buy day.')
    : step === 'enter' ? (verdict == null ? `Day 1. Yesterday's high was ${money(red.h)}. Tap the line the house buys over.` : verdict === 'ok' ? `Over ${money(entry)}. A stop-buy, one cent above yesterday's high.` : `Not there. The house buys over ${money(entry)}, one cent above yesterday's high.`)
      : step === 'stop' ? (verdict == null ? `You are in over ${money(entry)}. Tap where your stop goes.` : verdict === 'ok' ? `Under the Kicker's low, ${money(house)}.` : `The house stop is ${money(house)}, the Kicker's low. Yours was ${Math.abs(pct(house, stopPick)).toFixed(1)}% off.`)
        : 'Now watch it run, one day at a time. Did your stop hold?'
  const why = step === 'name' ? (verdict ? 'A real red day closes weak near its low. The next day gaps over that close and finishes strong, above the red day\'s high. Yesterday\'s sellers are trapped.' : null)
    : step === 'enter' ? (verdict ? 'Why there: the first trade over yesterday\'s high proves the sellers wrong. How: a stop-buy at that price, so it fills only if price gets there. Never at the open, never at the close.' : 'The dotted lines are yesterday\'s close and today\'s open. The dashed line is yesterday\'s high.')
      : step === 'stop' ? (verdict ? `The stop is the house rule: under the Kicker's low, or ${MAX_STOP_PCT}% under the entry when that low is further away. If the low breaks, the candle failed.` : 'The house rule: under the Kicker\'s low, or 3.5% under the entry when that low is further away.')
        : 'Each new day arrives on its own. Your stop is the red dashed line, the house stop the green one.'
  return (
    <div className={`${d5.lesson} ${d5.slideIn} ${verdict === 'bad' ? d5.shakeHard : ''}`}>
      <div className={d5.topbar}><span className={`${d5.hardTag} ${d5.pulse}`}>HARD</span><div className={d5.stepsCompact}><span className={`${d5.stepPill} ${d5.now}`}>{STEPS.indexOf(step) + 1} of 4 · {['Name it', 'Enter it', 'Stop it', 'Watch it run'][STEPS.indexOf(step)]}</span></div><span className={d5.legend}>♛♛♛<b>♛</b></span></div>
      <div className={d5.ask}><Logo mood={verdict == null ? (ready ? 'think' : 'idle') : verdict === 'ok' ? 'happy' : 'oops'} size={60} /><div className={d5.bubble}>{bubble}</div></div>
      <div className={s.chartBox}>
        {verdict ? <Stamp ok={verdict === 'ok'} /> : null}
        {(step === 'enter' || step === 'stop') && !verdict ? <span className={s.tapHint}>{step === 'enter' ? 'tap the line you buy over' : 'tap where the stop goes'}</span> : null}
        <WidgetChart sym={d.sym} bars={all} annotations={ann} height={460} phoneHeight={320} density="mini" defaultBars={60} hideTicker extra={HARD} onBarTap={step === 'enter' || step === 'stop' ? onTap : null} />
      </div>
      {why ? <details className={d5.whyCard} open={!phone || !!verdict}><summary>Why</summary><p>{why}</p></details> : null}
      {step === 'name' ? <div className={`${d5.cards} ${d5.cascade}`}>{['Launchpad', 'Kicker', 'Slingshot', 'None of these'].map((c, k) => { let cls = d5.card; if (!verdict && pick === k) cls += ` ${d5.sel}`; if (verdict && k === 1) cls += ` ${d5.right}`; if (verdict === 'bad' && pick === k) cls += ` ${d5.wrong}`; return <button key={c} type="button" className={cls} style={{ '--i': k }} disabled={!!verdict} onClick={() => setPick(k)}><span className={d5.key}>{k + 1}</span>{c}</button> })}</div>
        : <div className={d5.liveStrip}><div><small>Yesterday's high</small><b>{money(red.h)}</b></div><div><small>Entry</small><b>{step === 'enter' && !verdict ? (entryPick != null ? money(entryPick) : '—') : money(entry)}</b></div><div><small>Your stop</small><b>{stopPick != null ? money(stopPick) : '—'}</b></div><div><small>House stop</small><b>{(step === 'stop' && verdict) || step === 'run' ? money(house) : '—'}</b></div></div>}
      <div className={`${d5.footer} ${verdict === 'ok' ? d5.good : verdict === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {step === 'run' ? <button type="button" className={`${d5.btn} ${d5.live}`} onClick={() => onDone(right)}>Finish</button>
          : verdict == null ? <button type="button" className={`${d5.btn} ${ready ? d5.live : ''}`} disabled={!ready} onClick={check}>Check</button>
            : <button type="button" className={`${d5.btn} ${verdict === 'ok' ? d5.live : d5.red}`} onClick={next}>{step === 'stop' ? 'Watch it run' : 'Next'}</button>}
      </div></div>
    </div>
  )
}

export default function Piece55HardV3() {
  const [phase, setPhase] = useState('intro')
  const [right, setRight] = useState(0)
  const [run, setRun] = useState(0)
  const start = () => { setPhase('play'); setRight(0); setRun((r) => r + 1) }
  if (phase === 'intro') {
    return (
      <div className={d5.lesson}>
        <StartCard tone="dark" eyebrow="Kicker · Learn 2" title="Hard mode" art={<Crowns />}
          lead="No averages. No volume. Just the candles. Name it, then enter it, then place the stop, on one chart. Three for three earns the legendary fourth crown."
          button={<StartButton icon="crown" label="Start hard mode" sub="candles only · name, enter, stop · x2 XP" onClick={start} />}>
          <div className={d5.gems}><div className={d5.gem}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} gold /></span><small>On a perfect run</small><b>Legendary</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>XP</small><b>x{XP.HARD_MULT}</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  if (phase === 'done') {
    const perfect = right === 3
    return (
      <div className={d5.lesson}>{perfect ? <Confetti /> : null}
        <StartCard tone="dark" eyebrow="Kicker · Learn 2" title={perfect ? 'Legendary' : `${right} of 3`} art={<Crowns lit={perfect} />}
          lead={perfect ? 'Named it, entered it, stopped it, with nothing to lean on. The fourth crown is yours.' : 'Three for three is needed for the fourth crown. Try again.'}
          button={<StartButton icon="crown" label="Again" sub="candles only" onClick={start} />}>
          <div className={d5.gems}><div className={`${d5.gem} ${perfect ? '' : d5.dim}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} gold /></span><small>Kicker · Learn 2</small><b>{perfect ? '4 crowns' : '3 crowns'}</b></div></div><div className={`${d5.gem} ${d5.green}`}><div className={d5.gemIn}><span className={d5.gemIcon}><UIcon name="star" size={20} /></span><small>XP</small><b>+{right * XP.RIGHT * XP.HARD_MULT}</b></div></div></div>
        </StartCard>
      </div>
    )
  }
  return <Lesson key={run} onDone={(r) => { setRight(r); setPhase('done'); sfx(r === 3 ? 'levelup' : 'streak') }} />
}
