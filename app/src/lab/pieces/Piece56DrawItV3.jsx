import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { Stamp } from '../bits'
import { useRunOn } from '../fx'
import { useSample } from '../Lab'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { spot, pct, tag } from '../pointers'
import { sfx, voice } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'
import { XP } from '../rewards'

const MAX_STOP_PCT = 3.5
const r2 = (v) => Math.round(v * 100) / 100
const money = (v) => `$${v.toFixed(2)}`
const QUIET = { hideWatermark: true, hideLegend: true, showDrawingTools: false, showRangeSelector: false, hideScaleToggle: true, hideCountdown: true }

/** Round 11, piece 5: DRAW IT V3 (owner, batch 10: "show the entry as a line and explain why and where and how
 *  simply and easily"; "I don't like the throbbing gold around the chart at all"; "the chart widget can be sized
 *  better"; "the ease of placement and adjustment for stop can be easier"). The ENTRY is drawn from the start with
 *  its reason in plain words. No pulsing border. The chart is taller and quiet (no toolbar, legend or range bar),
 *  with fewer, bigger candles. The stop: tap to place; tap again to move; hold an arrow to slide it; type it. */
function useHold(fn) {
  const t = useRef(null), k = useRef(0)
  const stop = useCallback(() => { clearInterval(t.current); clearTimeout(t.current); t.current = null; k.current = 0 }, [])
  const start = useCallback((dir) => {
    fn(dir); k.current = 0
    t.current = setTimeout(() => { t.current = setInterval(() => { k.current += 1; fn(dir, k.current > 12 ? 5 : 1) }, 70) }, 320)
  }, [fn])
  useEffect(() => stop, [stop])
  return { start, stop }
}

export default function Piece56DrawItV3() {
  const d = useSample()
  const phone = useIsPhone()
  const [myPrice, setMyPrice] = useState(null)
  const [state, setState] = useState('ask')
  const [tool, setTool] = useState(false)
  const vis = d?.visible
  const n = vis?.length || 0
  const kick = n ? vis[n - 1] : null
  const red = n > 1 ? vis[n - 2] : null
  const entry = red ? r2(red.h + 0.01) : null
  const house = useMemo(() => { if (!kick || !entry) return null; const lowDist = pct(entry, kick.l) * -1; return lowDist > MAX_STOP_PCT ? r2(entry * (1 - MAX_STOP_PCT / 100)) : kick.l }, [kick, entry])
  const all = useRunOn(vis, d?.forward, state !== 'ask', 200)
  const onChange = useCallback((arr) => {
    const mine = (arr || []).filter((x) => x && !x.locked && (x.type === 'hray' || x.type === 'horizontal') && x.points?.[0]?.price != null)
    if (mine.length) setMyPrice(r2(Number(mine[mine.length - 1].points[0].price)))
  }, [])
  const extra = useMemo(() => ({ ...QUIET, ...(phone ? { showVolume: false } : {}), annotationsEditable: tool && state === 'ask', onAnnotationsChange: onChange, showDrawingTools: false }), [onChange, state, tool, phone])
  const onTap = useCallback(({ price }) => { if (state === 'ask' && !tool && Number.isFinite(price)) setMyPrice(r2(price)) }, [state, tool])
  const nudge = useCallback((dir, mul = 1) => setMyPrice((v) => r2((v ?? entry ?? 0) + dir * 0.01 * mul)), [entry])
  const hold = useHold(nudge)
  const grade = useMemo(() => {
    if (myPrice == null || house == null) return null
    const off = Math.abs(pct(house, myPrice))
    return { off, usd: Math.abs(myPrice - house), kind: off <= 0.5 ? 'perfect' : off <= 1.5 ? 'close' : 'off', xp: off <= 0.5 ? XP.DRAW_PERFECT : off <= 1.5 ? XP.DRAW_CLOSE : 0 }
  }, [myPrice, house])
  const shown = useMemo(() => {
    if (!all || !red) return null
    const a = [...spot(all, n - 1, { label: phone ? 'day 1' : 'day 1 · the Kicker', id: 'k', gap: phone ? 9 : 13, halo: state !== 'ask' })]
    // every level line runs from the LEFT edge of the window and carries its tag there, clear of the candles
    const e0 = Math.max(0, all.length - (phone ? 38 : 55))   // a few bars inside the window: a drawing anchored on the very edge is culled
    const edge = all[e0].t, col = (k) => all[Math.min(all.length - 1, e0 + k * (phone ? 12 : 11))].t   // tags in their own columns so close prices never stack
    a.push({ id: 'e', type: 'hray', points: [{ time: edge, price: entry }], color: '#2faf68', lineWidth: 1.5, lineStyle: 'solid', locked: true })
    a.push(tag(col(0), entry, phone ? `entry ${entry.toFixed(2)}` : `entry ${money(entry)}`, '#2faf68', 'e-tag'))
    if (myPrice != null) {
      a.push({ id: 'mine', type: 'hray', points: [{ time: edge, price: myPrice }], color: '#ff6b6b', lineWidth: 1.5, lineStyle: 'dashed' })
      a.push(tag(col(1), myPrice, phone ? `stop ${myPrice.toFixed(2)}` : `your stop ${money(myPrice)}`, '#ff6b6b', 'mine-tag'))
    }
    if (state !== 'ask' && house != null) {
      a.push({ id: 'house', type: 'hray', points: [{ time: edge, price: house }], color: '#dcbb5e', lineWidth: 1.5, lineStyle: 'solid', locked: true })
      a.push(tag(col(2), house, phone ? `house ${house.toFixed(2)}` : `house stop ${money(house)}`, '#dcbb5e', 'house-tag'))
    }
    return a
  }, [all, n, state, house, red, myPrice, entry, phone])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const mood = state === 'ask' ? (myPrice != null ? 'think' : 'idle') : grade?.kind === 'perfect' ? 'fire' : grade?.kind === 'close' ? 'happy' : 'oops'
  const risk = myPrice != null && entry ? (pct(entry, myPrice) * -1) : null
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, k) => <i key={k} className={k < 6 ? d5.on : k === 6 ? d5.cur : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.ask}><Logo mood={mood} size={60} /><div className={d5.bubble}>{state === 'ask' ? `The green line is the entry, ${money(entry)}. Now place your stop: tap the chart where it goes.` : grade.kind === 'perfect' ? `On the house line. ${grade.off.toFixed(2)}% off.` : grade.kind === 'close' ? `Close. ${money(grade.usd)} (${grade.off.toFixed(1)}%) from the house stop.` : `${money(grade.usd)} (${grade.off.toFixed(1)}%) away. The house stop is the Kicker's low, or ${MAX_STOP_PCT}% under the entry when that low is further.`}</div></div>
      <div className={s.chartBox}>
        {state === 'ask' && myPrice == null ? <span className={s.tapHint}>{tool ? 'pick the horizontal ray, then click' : 'tap where the stop goes'}</span> : null}
        {state !== 'ask' ? <Stamp ok={state === 'ok'} /> : null}
        <WidgetChart sym={d.sym} bars={all} annotations={shown} height={560} phoneHeight={300} density="mini" defaultBars={62} hideTicker extra={extra} onBarTap={onTap} />
      </div>
      {state === 'ask' ? (
        <div className={d5.stopRow}>
          <div className={d5.liveStrip}>
            <div><small>Entry · stop-buy</small><b>{money(entry)}</b></div>
            <div><small>Your stop</small><input type="number" step="0.01" min="0" placeholder="tap the chart or type" value={myPrice ?? ''} onChange={(e) => setMyPrice(e.target.value === '' ? null : r2(Number(e.target.value)))} /></div>
            {risk != null ? <div><small>Risk</small><b>{risk.toFixed(1)}%</b></div> : null}
          </div>
          <div className={d5.nudge}>
            <button type="button" onPointerDown={() => hold.start(1)} onPointerUp={hold.stop} onPointerLeave={hold.stop} onPointerCancel={hold.stop} title="hold to slide up">▲</button>
            <button type="button" onPointerDown={() => hold.start(-1)} onPointerUp={hold.stop} onPointerLeave={hold.stop} onPointerCancel={hold.stop} title="hold to slide down">▼</button>
          </div>
        </div>
      ) : (
        <div className={d5.liveStrip}>
          <div><small>Entry</small><b>{money(entry)}</b></div>
          <div><small>Your stop</small><b>{money(myPrice)}</b></div>
          <div><small>House stop</small><b>{money(house)}</b></div>
          <div><small>Risk at yours</small><b>{risk.toFixed(1)}%</b></div>
        </div>
      )}
      <details className={d5.whyCard} open={!phone}><summary>Why this entry</summary><p><b>Where:</b> one cent over yesterday's high. <b>Why:</b> yesterday's sellers finished in charge, and the first trade over their high proves them wrong. <b>How:</b> a stop-buy at that price, so it fills only if price gets there. Never at the open, never at the close.</p></details>
      {state === 'ask' ? <div className={d5.howRow}><span>Tap again to move it, hold an arrow to slide it, or</span><button type="button" className={`${d5.wayBtn} ${tool ? d5.on : ''}`} onClick={() => setTool((v) => !v)}>{tool ? 'back to tapping' : 'draw it with the ray tool'}</button></div> : null}
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${myPrice != null ? d5.live : ''}`} disabled={myPrice == null} onClick={() => { const ok = grade.kind !== 'off'; setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong'); if (ok) voice('line') }}>Check my stop</button>
          : <><div className={d5.verdictRow}><Logo mood={mood} size={44} /><div><div className={d5.verdictBig}>{grade.kind === 'perfect' ? `Perfect · +${XP.DRAW_PERFECT} XP` : grade.kind === 'close' ? `Close · +${XP.DRAW_CLOSE} XP` : 'Off'}</div><div className={d5.verdictWhy}>The stop is the house rule: under the Kicker's low, or {MAX_STOP_PCT}% under the entry when that low is further away. Watch the days run: did yours hold?</div></div></div>
            <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => { setState('ask'); setMyPrice(null) }}>Draw again</button></>}
      </div></div>
    </div>
  )
}
