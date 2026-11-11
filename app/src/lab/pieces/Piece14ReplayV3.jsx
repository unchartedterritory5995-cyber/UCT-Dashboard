import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt, pct } from '../pointers'
import s from '../lab.module.css'

const SPEEDS = { slow: 650, normal: 380, fast: 160 }

/** Round 3, piece 4: the replay, rebuilt (owner: "this playback was awful, needs to be a lot a lot better").
 *  What was wrong: every bar re-framed the whole chart, so the candles re-zoomed and jumped on each tick. Now
 *  the chart keeps its own default zoom and new bars scroll in from the right, like the chart's own Time
 *  Machine. Play / pause, step a bar either way, three speeds, a scrubber, the space bar and arrow keys. It
 *  stops itself on the red day and on the Kicker, then runs 20 more sessions so you watch the line hold. */
export default function Piece14ReplayV3() {
  const d = useSample()
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const total = all?.length || 0
  const START = Math.max(1, n - 40)
  const [upto, setUpto] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('normal')
  const [phase, setPhase] = useState('replay')
  const [tap, setTap] = useState(null)
  const timer = useRef(null)
  useEffect(() => { if (n && upto === 0) setUpto(START) }, [n, upto, START])
  const onRed = upto === n - 1, onKicker = upto === n, atEnd = upto >= total && total > 0
  useEffect(() => {
    if (!playing) return undefined
    timer.current = setInterval(() => setUpto((u) => {
      const next = Math.min(total, u + 1)
      if (next === n - 1 || next === n || next >= total) setPlaying(false)   // the two candles that matter, then the end
      return next
    }), SPEEDS[speed])
    return () => clearInterval(timer.current)
  }, [playing, speed, n, total])
  const step = useCallback((dir) => { setPlaying(false); setUpto((u) => Math.max(START, Math.min(total, u + dir))) }, [START, total])
  const toggle = useCallback(() => { if (upto >= total) setUpto(START); setPlaying((p) => !p) }, [upto, total, START])
  useEffect(() => {
    const onKey = (e) => {
      if (phase !== 'replay') return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      if (e.code === 'ArrowRight') step(1)
      if (e.code === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, toggle, step])
  const shown = useMemo(() => (all ? all.slice(0, upto) : null), [all, upto])
  const annotations = useMemo(() => {
    if (!shown?.length || !n) return null
    const a = []
    if (onRed) a.push(...arrowAt(shown, n - 2, { label: '1 · a real red day', color: '#ff6b6b', id: 't1' }))
    if (upto >= n) {
      a.push(...arrowAt(shown, n - 1, { label: 'the Kicker', id: 't2' }))
      a.push(...rayAt(shown[n - 1], 'l', { id: 't-low', label: 'its low is the line' }))
    }
    return a.length ? a : null
  }, [shown, n, upto, onRed])
  const after = upto > n && all ? pct(all[n - 1].c, all[upto - 1].c) : null
  // measured, never asserted: has every close since the Kicker stayed above its low?
  const lineHeld = upto > n && all ? all.slice(n, upto).every((b) => b.c >= all[n - 1].l) : null
  const findAnn = useMemo(() => {
    if (!tap || !all) return null
    return arrowAt(all, tap.index, { label: tap.ok ? 'that is it' : 'not that one', color: tap.ok ? '#1ae51a' : '#ff6b6b', id: 'find' })
  }, [tap, all])
  if (!all) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  if (phase === 'find') {
    return (
      <div className={s.col}>
        <div className={s.top}><span>Lesson · Kicker</span><span className={s.steps}><i className={s.on} /><i className={s.on} /><i className={s.on} /></span><span>Find it</span></div>
        <h1 className={s.h1}>Your turn. Tap the Kicker.</h1>
        <div className={`${s.chartBox} ${!tap ? s.pulse : ''}`}>
          {!tap ? <span className={s.tapHint}>tap the candle</span> : null}
          <StudyChart bars={all} annotations={findAnn} height={360} rightPadBars={2} onBarTap={({ index }) => setTap({ index, ok: index === n - 1 })} />
        </div>
        <div className={s.callout}>{!tap ? 'Find the real red day first. The Kicker is the candle right after it.' : tap.ok ? <><b>Yes.</b> Red day, open above it, strong close. Its low is the line.</> : <><b>Not that one.</b> Red day first, then the candle that opens above its body.</>}</div>
        <div className={s.foot}><button type="button" className={s.cta} onClick={() => { if (tap?.ok) { setPhase('replay'); setUpto(START); setTap(null) } else setTap(null) }}>{tap?.ok ? 'Start the questions' : 'Try again'}</button></div>
      </div>
    )
  }
  const title = atEnd ? 'The line held. Twenty sessions on.' : onKicker ? 'That is the Kicker.' : onRed ? 'Stop. A real red day.' : upto > n ? 'Now watch the line.' : 'Watch a Kicker form, one day at a time.'
  return (
    <div className={s.col}>
      <div className={s.top}><span>Lesson · Kicker</span><span className={s.steps}><i className={s.on} /><i className={onRed || upto >= n ? s.on : ''} /><i className={upto >= n ? s.on : ''} /></span><span>Replay</span></div>
      <h1 className={s.h1}>{title}</h1>
      <div className={s.chartBox}><StudyChart bars={shown} annotations={annotations} height={360} rightPadBars={2} frame="default" defaultBars={70} /></div>
      <div className={s.ctl}>
        <button type="button" className={s.ctlBtn} onClick={() => step(-1)} aria-label="Back one day">⏮</button>
        <button type="button" className={`${s.ctlBtn} ${s.play}`} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : upto >= total ? '↺' : '▶'}</button>
        <button type="button" className={s.ctlBtn} onClick={() => step(1)} aria-label="Forward one day">⏭</button>
        <input type="range" min={START} max={total} value={upto} onChange={(e) => { setPlaying(false); setUpto(+e.target.value) }} aria-label="Scrub" />
        <span className={s.speed}>{Object.keys(SPEEDS).map((k) => <button key={k} type="button" className={`${s.pill} ${speed === k ? s.on : ''}`} onClick={() => setSpeed(k)}>{k === 'slow' ? '½×' : k === 'normal' ? '1×' : '2×'}</button>)}</span>
      </div>
      <div className={s.day}><span>{shown?.length ? shown[shown.length - 1].t : ''}</span><span>day {Math.max(0, upto - START + 1)} of {total - START + 1}</span><span>space · ← →</span></div>
      {onRed ? <div className={s.callout}><b>1 · The red day is real.</b> It closed weak, down {all && n > 2 ? `${pct(all[n - 3].c, all[n - 2].c).toFixed(1)}%` : ''}. Sellers showed up and finished the day in charge. Press play.</div> : null}
      {onKicker ? <div className={s.callout}><b>2 · The next day opens above the red body and closes near its high.</b> Yesterday's sellers are trapped. That is the Kicker. <b>Its low is the line.</b> Keep playing.</div> : null}
      {upto > n && after != null ? <div className={s.callout}><b>{atEnd ? '3 · Twenty sessions on' : 'Watch the line'}</b>: {after >= 0 ? '+' : ''}{after.toFixed(1)}% from the Kicker's close. {lineHeld ? 'No close below the line so far.' : 'A close below the line: the trap failed.'}</div> : null}
      {!onRed && !onKicker && upto <= n ? <p className={s.hint}>Play, step, or drag. It stops by itself on the two candles that matter, then runs on.</p> : null}
      <div className={s.foot}><button type="button" className={s.cta} disabled={!atEnd} onClick={() => setPhase('find')}>{atEnd ? 'Now you find it' : 'Play to the end first'}</button></div>
    </div>
  )
}
