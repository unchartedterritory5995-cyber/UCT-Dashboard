import { useCallback, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { useSample } from '../Lab'
import { spot, pct } from '../pointers'
import { sfx, voice } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

const MAX_STOP_PCT = 3.5

/** Round 9, piece 4: DRAW IT. The member draws the stop with the widget's OWN drawing tools (the horizontal ray
 *  in the toolbar), then Checks. Graded by the distance from the house stop (the Kicker's low when within 3.5% of
 *  the entry, else 3.5% under): within 0.5% perfect, within 1.5% close, else off. The house line is drawn on Check. */
export default function Piece44DrawIt() {
  const d = useSample()
  const [drawings, setDrawings] = useState([])
  const [state, setState] = useState('ask')
  const vis = d?.visible
  const n = vis?.length || 0
  const kick = n ? vis[n - 1] : null
  const red = n > 1 ? vis[n - 2] : null
  const entry = red ? Math.round((red.h + 0.01) * 100) / 100 : null
  const house = useMemo(() => { if (!kick || !entry) return null; const lowDist = pct(entry, kick.l) * -1; return lowDist > MAX_STOP_PCT ? entry * (1 - MAX_STOP_PCT / 100) : kick.l }, [kick, entry])
  const onChange = useCallback((arr) => setDrawings(arr || []), [])
  const extra = useMemo(() => ({ annotationsEditable: true, showDrawingTools: true, onAnnotationsChange: onChange }), [onChange])
  const mine = useMemo(() => [...drawings].reverse().find((x) => x && (x.type === 'hray' || x.type === 'horizontal') && x.points?.[0]?.price), [drawings])
  const myPrice = mine ? Number(mine.points[0].price) : null
  const grade = useMemo(() => {
    if (myPrice == null || house == null) return null
    const off = Math.abs(pct(house, myPrice))
    return { off, kind: off <= 0.5 ? 'perfect' : off <= 1.5 ? 'close' : 'off', xp: off <= 0.5 ? XP.DRAW_PERFECT : off <= 1.5 ? XP.DRAW_CLOSE : 0 }
  }, [myPrice, house])
  const shown = useMemo(() => {
    if (!vis) return null
    const a = [...drawings]
    if (state === 'ask') a.push(...spot(vis, n - 1, { label: 'the Kicker', id: 'k', gap: 8 }))
    else if (house != null) { a.push({ id: 'house', type: 'hray', points: [{ time: red.t, price: house }], color: '#2faf68', lineWidth: 2, lineStyle: 'dashed', label: 'the house stop' }); a.push(...spot(vis, n - 1, { label: 'the Kicker', id: 'k', gap: 8 })) }
    return a
  }, [drawings, vis, n, state, house, red])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const mood = state === 'ask' ? (myPrice ? 'think' : 'idle') : grade?.kind === 'perfect' ? 'fire' : grade?.kind === 'close' ? 'happy' : 'oops'
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, k) => <i key={k} className={k < 6 ? d5.on : k === 6 ? d5.cur : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.ask}><Logo mood={mood} size={72} /><div className={d5.bubble}>{state === 'ask' ? `A Kicker. You are in over $${entry?.toFixed(2)}. Draw your stop: pick the horizontal ray in the toolbar and click the chart where it goes.` : grade.kind === 'perfect' ? `On the house line. ${grade.off.toFixed(2)}% off.` : grade.kind === 'close' ? `Close. ${grade.off.toFixed(1)}% from the house stop.` : `${grade.off.toFixed(1)}% away. The house stop is the Kicker's low, or ${MAX_STOP_PCT}% under the entry when that low is further.`}</div></div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} bars={vis} annotations={shown} height={480} density="compact" defaultBars={90} extra={extra} /></div>
      <div className={d5.live}>
        <div><small>Entry</small><b>${entry?.toFixed(2)}</b></div>
        <div><small>Your stop</small><b>{myPrice != null ? `$${myPrice.toFixed(2)}` : 'draw it'}</b></div>
        {state !== 'ask' ? <><div><small>House stop</small><b>${house.toFixed(2)}</b></div><div><small>Risk at yours</small><b>{myPrice != null ? `${(pct(entry, myPrice) * -1).toFixed(1)}%` : ''}</b></div></> : null}
      </div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${myPrice != null ? d5.live : ''}`} disabled={myPrice == null} onClick={() => { const ok = grade.kind !== 'off'; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong'); if (ok) voice('line') }}>Check my stop</button>
          : <><div className={d5.verdictRow}><div><div className={d5.verdictBig}>{grade.kind === 'perfect' ? `Perfect · +${XP.DRAW_PERFECT} XP` : grade.kind === 'close' ? `Close · +${XP.DRAW_CLOSE} XP` : 'Off'}</div><div className={d5.verdictWhy}>The stop is the house rule: under the Kicker's low, or {MAX_STOP_PCT}% under the entry when that low is further away.</div></div></div>
            <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => { setState('ask'); setDrawings([]) }}>Draw again</button></>}
      </div></div>
    </div>
  )
}
