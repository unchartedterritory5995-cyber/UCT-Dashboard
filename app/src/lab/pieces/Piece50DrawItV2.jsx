import { useCallback, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { Stamp } from '../bits'
import { useRunOn } from '../fx'
import { useSample } from '../Lab'
import { spot, pct } from '../pointers'
import { sfx, voice } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

const MAX_STOP_PCT = 3.5
const r2 = (v) => Math.round(v * 100) / 100

/** Round 10, piece 5: DRAW IT V2 (owner, batch 9: "some issues with the drawing tool and placing it properly in
 *  the right spot"). Measured causes: two toolbars stacked on each other (the top one drew into the chart's own
 *  saved-drawings layer, invisible to the grader); the pointer drawings were movable; the ray reverted to the
 *  cursor after one line so a second click did nothing. Now: ONE toolbar; the pointer is locked; TAP TO PLACE is
 *  the first path (tap the chart where the stop goes), the ray tool still works, and a typed price or the nudge
 *  buttons move it by a cent or a tenth of a percent. Only the newest line counts, so every new click MOVES the
 *  stop. The line is drawn thick and red with its price on it. */
export default function Piece50DrawItV2() {
  const d = useSample()
  const [myPrice, setMyPrice] = useState(null)
  const [state, setState] = useState('ask')
  const [tool, setTool] = useState(false)   // false = tap to place (default, works on a phone); true = the chart's ray toolbar
  const vis = d?.visible
  const n = vis?.length || 0
  const kick = n ? vis[n - 1] : null
  const red = n > 1 ? vis[n - 2] : null
  const entry = red ? r2(red.h + 0.01) : null
  const house = useMemo(() => { if (!kick || !entry) return null; const lowDist = pct(entry, kick.l) * -1; return lowDist > MAX_STOP_PCT ? r2(entry * (1 - MAX_STOP_PCT / 100)) : kick.l }, [kick, entry])
  const all = useRunOn(vis, d?.forward, state !== 'ask', 60)
  // the chart's own ray tool: keep only the member's newest horizontal line, ignore everything locked (the pointer)
  const onChange = useCallback((arr) => {
    const mine = (arr || []).filter((x) => x && !x.locked && (x.type === 'hray' || x.type === 'horizontal') && x.points?.[0]?.price != null)
    if (mine.length) setMyPrice(r2(Number(mine[mine.length - 1].points[0].price)))
  }, [])
  const extra = useMemo(() => ({ annotationsEditable: tool && state === 'ask', showDrawingTools: false, onAnnotationsChange: onChange }), [onChange, state, tool])
  const onTap = useCallback(({ price }) => { if (state === 'ask' && !tool && Number.isFinite(price)) setMyPrice(r2(price)) }, [state, tool])
  const grade = useMemo(() => {
    if (myPrice == null || house == null) return null
    const off = Math.abs(pct(house, myPrice))
    return { off, usd: Math.abs(myPrice - house), kind: off <= 0.5 ? 'perfect' : off <= 1.5 ? 'close' : 'off', xp: off <= 0.5 ? XP.DRAW_PERFECT : off <= 1.5 ? XP.DRAW_CLOSE : 0 }
  }, [myPrice, house])
  const shown = useMemo(() => {
    if (!all || !red) return null
    const a = [...spot(all, n - 1, { label: 'the Kicker', id: 'k', gap: 8, halo: state !== 'ask' })]
    if (myPrice != null) {
      a.push({ id: 'mine', type: 'hray', points: [{ time: vis[Math.max(0, n - 34)].t, price: myPrice }], color: '#ff6b6b', lineWidth: 2.5, lineStyle: 'dashed' })
      a.push({ id: 'mine-chip', type: 'text', points: [{ time: vis[Math.max(0, n - 34)].t, price: myPrice }], text: `  YOUR STOP $${myPrice.toFixed(2)}  `, color: '#ffffff', fontSize: 12, bgEnabled: true, bgColor: '#df4646', locked: true })
    }
    if (state !== 'ask' && house != null) {
      a.push({ id: 'house', type: 'hray', points: [{ time: vis[Math.max(0, n - 18)].t, price: house }], color: '#2faf68', lineWidth: 2, lineStyle: 'solid', locked: true })
      a.push({ id: 'house-chip', type: 'text', points: [{ time: vis[Math.max(0, n - 18)].t, price: house }], text: `  HOUSE STOP $${house.toFixed(2)}  `, color: '#ffffff', fontSize: 12, bgEnabled: true, bgColor: '#2faf68', locked: true })
    }
    return a
  }, [all, vis, n, state, house, red, myPrice])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const mood = state === 'ask' ? (myPrice != null ? 'think' : 'idle') : grade?.kind === 'perfect' ? 'fire' : grade?.kind === 'close' ? 'happy' : 'oops'
  const nudge = (dv) => setMyPrice((v) => r2((v ?? entry) + dv))
  const risk = myPrice != null && entry ? (pct(entry, myPrice) * -1) : null
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, k) => <i key={k} className={k < 6 ? d5.on : k === 6 ? d5.cur : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.ask}><Logo mood={mood} size={64} /><div className={d5.bubble}>{state === 'ask' ? `A Kicker. You are in over $${entry?.toFixed(2)}. Where is your stop? ${tool ? 'Pick the horizontal ray in the toolbar and click where it goes.' : 'Tap the chart where it goes.'}` : grade.kind === 'perfect' ? `On the house line. ${grade.off.toFixed(2)}% off.` : grade.kind === 'close' ? `Close. $${grade.usd.toFixed(2)} (${grade.off.toFixed(1)}%) from the house stop.` : `$${grade.usd.toFixed(2)} (${grade.off.toFixed(1)}%) away. The house stop is the Kicker's low, or ${MAX_STOP_PCT}% under the entry when that low is further.`}</div></div>
      <div className={`${s.chartBox} `}>
        {state === 'ask' && myPrice == null ? <span className={s.tapHint}>{tool ? 'pick the horizontal ray, then click' : 'tap where the stop goes'}</span> : null}
        {state !== 'ask' ? <Stamp ok={state === 'ok'} /> : null}
        <WidgetChart sym={d.sym} bars={all} annotations={shown} height={460} density="compact" defaultBars={80} extra={extra} onBarTap={onTap} />
      </div>
      {state === 'ask' ? (
        <div className={d5.stopRow}>
          <div className={d5.live}>
            <div><small>Entry</small><b>${entry?.toFixed(2)}</b></div>
            <div><small>Your stop</small><input className={d5.priceIn} type="number" step="0.01" min="0" placeholder="tap the chart or type" value={myPrice ?? ''} onChange={(e) => setMyPrice(e.target.value === '' ? null : r2(Number(e.target.value)))} /></div>
          </div>
          <div className={d5.nudge}><button type="button" onClick={() => nudge(0.01)} title="up a cent">▲ 1¢</button><button type="button" onClick={() => nudge(-0.01)} title="down a cent">▼ 1¢</button><button type="button" onClick={() => nudge(r2((myPrice ?? entry) * 0.001))} title="up a tenth of a percent">▲ 0.1%</button><button type="button" onClick={() => nudge(-r2((myPrice ?? entry) * 0.001))} title="down a tenth of a percent">▼ 0.1%</button></div>
        </div>
      ) : (
        <div className={`${d5.live} ${d5.four}`}>
          <div><small>Entry</small><b>${entry?.toFixed(2)}</b></div>
          <div><small>Your stop</small><b>${myPrice.toFixed(2)}</b></div>
          <div><small>House stop</small><b>${house.toFixed(2)}</b></div>
          <div><small>Risk at yours</small><b>{risk.toFixed(1)}%</b></div>
        </div>
      )}
      {state === 'ask' ? <div className={d5.howRow}><b>Three ways:</b><button type="button" className={`${d5.wayBtn} ${!tool ? d5.on : ''}`} onClick={() => setTool(false)}>tap the chart</button><button type="button" className={`${d5.wayBtn} ${tool ? d5.on : ''}`} onClick={() => setTool(true)}>draw a ray with the toolbar</button><span>or type the price</span>{risk != null ? <span style={{ marginLeft: 'auto' }}>risk at this stop <b>{risk.toFixed(1)}%</b></span> : null}</div> : null}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${myPrice != null ? d5.live : ''}`} disabled={myPrice == null} onClick={() => { const ok = grade.kind !== 'off'; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong'); if (ok) voice('line') }}>Check my stop</button>
          : <><div className={d5.verdictRow}><Logo mood={mood} size={44} /><div><div className={d5.verdictBig}>{grade.kind === 'perfect' ? `Perfect · +${XP.DRAW_PERFECT} XP` : grade.kind === 'close' ? `Close · +${XP.DRAW_CLOSE} XP` : 'Off'}</div><div className={d5.verdictWhy}>The stop is the house rule: under the Kicker's low, or {MAX_STOP_PCT}% under the entry when that low is further away. The chart ran on so you can see whether yours held.</div></div></div>
            <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => { setState('ask'); setMyPrice(null) }}>Draw again</button></>}
      </div></div>
    </div>
  )
}
