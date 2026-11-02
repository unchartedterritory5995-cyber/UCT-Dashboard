import { useMemo, useState } from 'react'
import StudyChart from '../StudyChart'
import { useSample } from '../Lab'
import s from '../lab.module.css'

const GOLD = '#d9b84a'
const WHITE = '#ffffff'

/** Piece 3: the ways a chart can point at something. Toggle each one on the same chart and say which ones read. */
export default function Piece3Highlights() {
  const d = useSample()
  const [on, setOn] = useState({ arrow: true, paint: false, dot: false, ray: false, avwap: false, pair: false })
  const bars = d?.visible
  const bar = bars?.length ? bars[bars.length - 1] : null
  const prior = bars?.length > 1 ? bars[bars.length - 2] : null
  const flip = (k) => setOn((o) => ({ ...o, [k]: !o[k] }))
  const markers = useMemo(() => {
    if (!bar) return null
    const m = []
    if (on.arrow) m.push({ time: bar.t, position: 'aboveBar', color: GOLD, shape: 'arrowDown', text: 'look here', id: 'h-arrow' })
    if (on.dot) m.push({ time: bar.t, position: 'belowBar', color: WHITE, shape: 'circle', text: '', id: 'h-dot' })
    if (on.pair && prior) m.push({ time: prior.t, position: 'belowBar', color: '#ff6b6b', shape: 'circle', text: 'red day', id: 'h-prior' })
    return m.length ? m : null
  }, [on, bar, prior])
  const annotations = useMemo(() => {
    if (!bar) return null
    const a = []
    if (on.ray) a.push({ id: 'h-ray', type: 'hray', points: [{ time: bar.t, price: bar.c }], color: GOLD, label: 'close' })
    if (on.avwap) a.push({ id: 'h-avwap', type: 'avwap', points: [{ time: bar.t }], color: '#ffffff' })
    return a.length ? a : null
  }, [on, bar])
  const highlight = useMemo(() => {
    const h = []
    if (on.paint && bar) h.push(bar.t)
    if (on.pair && prior) h.push(prior.t)
    return h.length ? h : null
  }, [on, bar, prior])
  const OPTS = [
    ['arrow', 'Arrow above the candle'], ['paint', 'Paint the candle gold'], ['dot', 'White dot under it'],
    ['pair', 'Mark the red day too'], ['ray', 'Ray at its close'], ['avwap', 'AVWAP from that day'],
  ]
  return (
    <div className={s.col}>
      <h1 className={s.h1}>How should the chart point at the thing?</h1>
      <p className={s.sub}>Same candle, six ways. Turn them on and off. Tell me which ones a student actually sees.</p>
      <div className={s.chartBox}>
        <StudyChart bars={bars} markers={markers} annotations={annotations} highlightBarTime={highlight} highlightColor={GOLD} height={380} />
      </div>
      <div className={s.pills}>
        {OPTS.map(([k, t]) => <button key={k} type="button" className={`${s.pill} ${on[k] ? s.on : ''}`} onClick={() => flip(k)}>{t}</button>)}
      </div>
      <p className={s.hint}>Everything here is the chart's own layer: markers, rays, anchored VWAP, painted bars. Nothing is drawn on top by hand.</p>
    </div>
  )
}
