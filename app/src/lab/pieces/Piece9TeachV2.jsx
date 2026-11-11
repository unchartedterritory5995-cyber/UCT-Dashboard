import { useEffect, useMemo, useRef, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt } from '../pointers'
import s from '../lab.module.css'

/** Round 2, piece 4: teach by REPLAY. The chart plays forward bar by bar; it stops on the red day and says why
 *  it matters, then on the Kicker and says what to see. Scrub it yourself. Then the chart runs 20 sessions on
 *  and the member has to find the Kicker by tapping it. */
export default function Piece9TeachV2() {
  const d = useSample()
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const [upto, setUpto] = useState(0)          // how many bars are shown
  const [playing, setPlaying] = useState(false)
  const [phase, setPhase] = useState('replay')  // replay | find
  const [tap, setTap] = useState(null)
  const timer = useRef(null)
  const START = Math.max(1, n - 40)
  useEffect(() => { if (n && upto === 0) setUpto(START) }, [n, upto, START])
  useEffect(() => {
    if (!playing) return undefined
    timer.current = setInterval(() => setUpto((u) => {
      if (u + 1 === n - 1 || u + 1 >= n) { setPlaying(false) }   // pause on the red day, then on the Kicker
      return Math.min(n, u + 1)
    }), 260)
    return () => clearInterval(timer.current)
  }, [playing, n])
  const shown = useMemo(() => (vis ? vis.slice(0, upto) : null), [vis, upto])
  const onRed = upto === n - 1, onKicker = upto === n
  const annotations = useMemo(() => {
    if (!shown?.length) return null
    const a = []
    if (onRed) a.push(...arrowAt(shown, shown.length - 1, { label: '1 · a real red day', color: '#ff6b6b', id: 't1' }))
    if (onKicker) {
      a.push(...arrowAt(shown, shown.length - 2, { label: '1 · real red day', color: '#ff6b6b', gap: 8, id: 't1' }))
      a.push(...arrowAt(shown, shown.length - 1, { label: '2 · opens above it, closes strong', id: 't2' }))
      a.push(...rayAt(shown[shown.length - 1], 'l', { id: 't-low', label: 'its low is the line' }))
    }
    return a.length ? a : null
  }, [shown, onRed, onKicker])
  const findAnn = useMemo(() => {
    if (!tap || !all) return null
    const i = tap.index
    return arrowAt(all, i, { label: tap.ok ? 'that is it' : 'not that one', color: tap.ok ? '#1ae51a' : '#ff6b6b', id: 'find' })
  }, [tap, all])
  if (phase === 'find') {
    return (
      <div className={s.col}>
        <div className={s.top}><span>Lesson · Kicker</span><span className={s.steps}><i className={s.on} /><i className={s.on} /><i className={s.on} /></span><span>Find it</span></div>
        <h1 className={s.h1}>Now you find it. The chart ran on 20 sessions. Tap the Kicker.</h1>
        <div className={`${s.chartBox} ${!tap ? s.pulse : ''}`}>
          {!tap ? <span className={s.tapHint}>tap the candle</span> : null}
          <StudyChart bars={all} annotations={findAnn} height={360} onBarTap={({ index }) => setTap({ index, ok: index === n - 1 })} />
        </div>
        <div className={s.callout}>{!tap ? 'Look for the real red day first. The Kicker is the candle right after it that opens above the red body.' : tap.ok ? <><b>Yes.</b> Red day, then the open above it and the strong close. The low of that candle is the line for the whole trade.</> : <><b>Not that one.</b> Find the red day first, then the candle that opens above its body.</>}</div>
        <div className={s.foot}><button type="button" className={s.cta} onClick={() => { if (tap?.ok) { setPhase('replay'); setUpto(START); setTap(null) } else setTap(null) }}>{tap?.ok ? 'Start the questions' : 'Try again'}</button></div>
      </div>
    )
  }
  return (
    <div className={s.col}>
      <div className={s.top}><span>Lesson · Kicker</span><span className={s.steps}><i className={s.on} /><i className={onRed || onKicker ? s.on : ''} /><i className={onKicker ? s.on : ''} /></span><span>Watch it happen</span></div>
      <h1 className={s.h1}>{onKicker ? 'That is the Kicker.' : onRed ? 'Stop. Look at this red day.' : 'Watch a Kicker form, one day at a time.'}</h1>
      <div className={s.chartBox}><StudyChart bars={shown} annotations={annotations} height={360} rightPadBars={6} /></div>
      <div className={s.replay}>
        <button type="button" className={s.pill} onClick={() => { if (upto >= n) setUpto(START); setPlaying((p) => !p) }}>{playing ? '❚❚ Pause' : upto >= n ? '↺ Replay' : '▶ Play'}</button>
        <input type="range" min={START} max={n} value={upto} onChange={(e) => { setPlaying(false); setUpto(+e.target.value) }} />
        <span className={s.hint}>{shown?.length ? shown[shown.length - 1].t : ''}</span>
      </div>
      {onRed ? <div className={s.callout}><b>1 · The red day is real.</b> It closes weak, with a body of one to five percent. Not a baby red candle. Sellers showed up and finished the day in charge. Press play.</div> : null}
      {onKicker ? <div className={s.callout}><b>2 · The next day opens above the red body and closes near its high.</b> Yesterday's sellers are trapped. That is the Kicker, and <b>its low is the line</b>: a close below it means the trap failed.</div> : null}
      {!onRed && !onKicker ? <p className={s.hint}>Press play, or drag the slider. The replay stops on its own at the two candles that matter.</p> : null}
      <div className={s.foot}><button type="button" className={s.cta} disabled={!onKicker} onClick={() => setPhase('find')}>{onKicker ? 'Now you find it' : 'Play to the end first'}</button></div>
    </div>
  )
}
