import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt, pct } from '../pointers'
import s from '../lab.module.css'

const SPEEDS = { slow: 1400, normal: 900, fast: 400 }
const LEAD = 10       // bars shown before the red day when the replay starts (owner: "starts way too far back")

function ema(vals, p) {
  const k = 2 / (p + 1); const out = []; let e = null
  for (const v of vals) { e = e == null ? v : v * k + e * (1 - k); out.push(e) }
  return out
}

/** Round 4, piece 3: the replay on the widget, starting ten bars before the red day, and every bar TEACHES
 *  (owner: "the actual play should be much more educational"). Each candle gets a caption built from measured
 *  facts: the day's change, where it closed against the 9 and 20, whether its range was the widest in ten days,
 *  and the house rule at the red day and the Kicker. Then it runs on and the line is watched. */
export default function Piece18ReplayV4() {
  const d = useSample()
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const total = all?.length || 0
  const START = Math.max(2, n - 1 - LEAD)
  const [upto, setUpto] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('normal')
  const timer = useRef(null)
  useEffect(() => { if (n && upto === 0) setUpto(START) }, [n, upto, START])
  const e9 = useMemo(() => (all ? ema(all.map((b) => b.c), 9) : null), [all])
  const e20 = useMemo(() => (all ? ema(all.map((b) => b.c), 20) : null), [all])
  const onRed = upto === n - 1, onKicker = upto === n, atEnd = upto >= total && total > 0
  useEffect(() => {
    if (!playing) return undefined
    timer.current = setInterval(() => setUpto((u) => {
      const next = Math.min(total, u + 1)
      if (next === n - 1 || next === n || next >= total) setPlaying(false)
      return next
    }), SPEEDS[speed])
    return () => clearInterval(timer.current)
  }, [playing, speed, n, total])
  const step = useCallback((dir) => { setPlaying(false); setUpto((u) => Math.max(START, Math.min(total, u + dir))) }, [START, total])
  const toggle = useCallback(() => { if (upto >= total) setUpto(START); setPlaying((p) => !p) }, [upto, total, START])
  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); toggle() } if (e.code === 'ArrowRight') step(1); if (e.code === 'ArrowLeft') step(-1) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, step])
  const shown = useMemo(() => (all ? all.slice(0, upto) : null), [all, upto])
  // the caption for the bar on screen: measured facts, in plain words
  const caption = useMemo(() => {
    if (!all || upto < 2) return null
    const i = upto - 1, b = all[i], p = all[i - 1]
    const chg = pct(p.c, b.c)
    const range = (b.h - b.l) / b.c * 100
    const widest = all.slice(Math.max(0, i - 10), i).every((x) => (x.h - x.l) / x.c * 100 < range)
    const above9 = b.c > e9[i], above20 = b.c > e20[i]
    const facts = [`${chg >= 0 ? 'Up' : 'Down'} ${Math.abs(chg).toFixed(1)}%`]
    facts.push(above9 && above20 ? 'closes above the 9 and the 20' : !above9 && !above20 ? 'closes under the 9 and the 20' : above9 ? 'above the 9, under the 20' : 'under the 9, above the 20')
    if (widest) facts.push('widest range in ten days')
    if (b.c > b.o && (b.h - b.c) / (b.h - b.l || 1) < 0.15) facts.push('closes at the high')
    if (b.c < b.o && (b.c - b.l) / (b.h - b.l || 1) < 0.15) facts.push('closes at the low')
    return { date: b.t, facts, chg }
  }, [all, upto, e9, e20])
  const annotations = useMemo(() => {
    if (!shown?.length || !n) return null
    const a = []
    if (onRed) a.push(...arrowAt(shown, n - 2, { label: 'a real red day', color: '#ff6b6b', id: 't1', gap: 6 }))
    if (upto >= n) { a.push(...arrowAt(shown, n - 1, { label: 'the Kicker', id: 't2', gap: 6 })); a.push(...rayAt(shown[n - 1], 'l', { id: 't-low', label: 'the line' })) }
    return a.length ? a : null
  }, [shown, n, upto, onRed])
  const after = upto > n && all ? pct(all[n - 1].c, all[upto - 1].c) : null
  const lineHeld = upto > n && all ? all.slice(n, upto).every((b) => b.c >= all[n - 1].l) : null
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const lesson = onRed ? <><b>The red day is real.</b> Down {Math.abs(caption?.chg || 0).toFixed(1)}%, sellers finished the day in charge. The setup needs this. Press play.</>
    : onKicker ? <><b>The Kicker.</b> Opens above the red body, closes near its high. Yesterday's sellers are trapped. <b>Its low is the line</b>: a close below it and the trap failed.</>
    : upto > n ? <><b>{atEnd ? 'Twenty sessions on' : 'Watch the line'}.</b> {after >= 0 ? '+' : ''}{after.toFixed(1)}% from the Kicker's close. {lineHeld ? 'No close below the line.' : 'A close below the line: out.'}</>
    : <>A stock pulling back into its averages. <b>Watch for one weak red day, then the candle that opens above it.</b></>
  return (
    <div className={s.col}>
      <div className={s.top}><span>Lesson · Kicker</span><span className={s.steps}><i className={s.on} /><i className={upto >= n - 1 ? s.on : ''} /><i className={upto >= n ? s.on : ''} /></span><span>Replay</span></div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={shown} annotations={annotations} height={420} density="compact" defaultBars={48} /></div>
      <div className={s.ctl}>
        <button type="button" className={s.ctlBtn} onClick={() => step(-1)} aria-label="Back one day">⏮</button>
        <button type="button" className={`${s.ctlBtn} ${s.play}`} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : upto >= total ? '↺' : '▶'}</button>
        <button type="button" className={s.ctlBtn} onClick={() => step(1)} aria-label="Forward one day">⏭</button>
        <input type="range" min={START} max={total} value={upto} onChange={(e) => { setPlaying(false); setUpto(+e.target.value) }} aria-label="Scrub" />
        <span className={s.speed}>{Object.keys(SPEEDS).map((k) => <button key={k} type="button" className={`${s.pill} ${speed === k ? s.on : ''}`} onClick={() => setSpeed(k)}>{k === 'slow' ? '½×' : k === 'normal' ? '1×' : '2×'}</button>)}</span>
      </div>
      {caption ? (
        <div className={s.cap}>
          <span className={s.capDate}>{caption.date}</span>
          <span className={`${s.capChg} ${caption.chg >= 0 ? s.green : s.red}`}>{caption.facts[0]}</span>
          <span className={s.capFacts}>{caption.facts.slice(1).join(' · ')}</span>
        </div>
      ) : null}
      <div className={`${s.callout} ${onRed || onKicker ? s.hot : ''}`}>{lesson}</div>
      <div className={s.day}><span>day {Math.max(0, upto - START + 1)} of {total - START + 1}</span><span>space · ← →</span></div>
      <div className={s.foot}><button type="button" className={s.cta} disabled={!atEnd}>{atEnd ? 'Now you find it' : 'Play to the end first'}</button></div>
    </div>
  )
}
