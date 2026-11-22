import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { arrowAt } from '../pointers'
import s from '../lab.module.css'

/** Round 3, piece 1: the question card on THE FULL UCT CHART WIDGET (ChartPane: identity row, timeframe bar,
 *  toolbar, legend, the member's saved look, real data path, cut off at the question date). Right gap of two
 *  candles. Density switch: full / compact / mini; mini can hide the ticker. */
export default function Piece11Widget() {
  const d = useSample()
  const [density, setDensity] = useState('full')
  const [hideTicker, setHideTicker] = useState(false)
  const [arrow, setArrow] = useState(true)
  const [pad, setPad] = useState(2)
  const vis = d?.visible
  const n = vis?.length || 0
  const annotations = useMemo(() => (arrow && n ? arrowAt(vis, n - 1, { label: 'this candle', id: 'w' }) : null), [arrow, vis, n])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={s.col}>
      <div className={s.top}><span>Question 3 of 10</span><span className={s.bar}><i style={{ width: '30%' }} /></span><span>Setup · ?</span></div>
      <h1 className={s.h1}>What setup, if any, just fired?</h1>
      <div className={s.chartBox}>
        <WidgetChart sym={d.sym} cutoff={d.asof} density={density} hideTicker={hideTicker && density === 'mini'} annotations={annotations} rightPadBars={pad} height={density === 'full' ? 520 : density === 'compact' ? 440 : 380} />
      </div>
      <div className={s.pills}>
        {['full', 'compact', 'mini'].map((k) => <button key={k} type="button" className={`${s.pill} ${density === k ? s.on : ''}`} onClick={() => setDensity(k)}>{k === 'full' ? 'Full widget' : k === 'compact' ? 'Compact' : 'Mini (chart only)'}</button>)}
        <button type="button" className={`${s.pill} ${hideTicker ? s.on : ''}`} disabled={density !== 'mini'} onClick={() => setHideTicker((v) => !v)}>Hide the ticker (mini only)</button>
        <button type="button" className={`${s.pill} ${arrow ? s.on : ''}`} onClick={() => setArrow((v) => !v)}>Arrow</button>
        {[1, 2, 3].map((p) => <button key={p} type="button" className={`${s.pill} ${pad === p ? s.on : ''}`} onClick={() => setPad(p)}>{p} candle gap</button>)}
      </div>
      <div className={s.choices}>
        {['Launchpad', 'Kicker', 'Slingshot', 'None of these'].map((c, i) => <button key={c} type="button" className={s.choice}><span className={s.n}>{i + 1}</span>{c}</button>)}
      </div>
      <div className={s.foot}><button type="button" className={s.cta}>Check</button></div>
    </div>
  )
}
