import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { Stamp } from '../bits'
import { useBreath, useRunOn } from '../fx'
import { useSample } from '../Lab'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { rayAt, pct, haloAt, boxAt } from '../pointers'
import { sfx } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

/** Round 10, piece 6: SPOT THE TRAP V2 (owner, batch 9: "very very buggy ... should be able to be highlighted and
 *  have candles be slightly animated to show which selections are choosable"). Measured causes: a look-alike sat
 *  outside the visible window; the Kicker's chip clipped above the range; a tap had to land on the exact bar with
 *  no feedback until Check. Now the look-alikes are searched only inside the window that will be on screen (90
 *  bars on a desktop, 55 on a phone) and the window is sized to show them all; every candidate BREATHES (the
 *  arrow swells and the chip brightens on a slow cycle, plus a halo where a bar follows); a tap near one snaps to
 *  it, the arrow turns bright and solid and the candle is boxed or struck through; the matching card lights; on
 *  Check the reasons show and the chart runs on. The look-alikes are still FOUND by the owner's rules. */
function findTraps(bars, n, view) {
  const out = []
  for (let i = n - 2; i >= Math.max(2, n - view) && out.length < 2; i--) {
    const b = bars[i], r = bars[i - 1], rr = bars[i - 2]
    const redChg = pct(rr.c, r.c)
    const redIsRed = r.c < r.o
    const opensAbove = b.o > Math.max(r.o, r.c)
    const green = b.c > b.o
    const closePos = (b.c - b.l) / ((b.h - b.l) || 1)
    if (redIsRed && Math.abs(redChg) < 1 && opensAbove && green && closePos >= 0.5 && !out.some((x) => x.kind === 'baby')) out.push({ i, kind: 'baby', why: `The red day before it was only ${Math.abs(redChg).toFixed(1)}%. Not a real red day.` })
    else if (redIsRed && Math.abs(redChg) >= 1 && opensAbove && closePos < 0.5 && !out.some((x) => x.kind === 'weak')) out.push({ i, kind: 'weak', why: 'It opened above the red body but closed in the lower half of its range. Not a strong close.' })
  }
  return out
}
const SWELL = [0, 0.5, 1, 0.5]
const GOLD = '#dcbb5e', BRIGHT = '#fff1c2'

/** A breathing pointer: the arrow swells and the chip brightens with `swell`; `solid` is the selected state. */
function breathe(bars, i, { letter, swell = 0, solid = false, color = GOLD, id }) {
  const b = bars[i]
  const price = (b.o + b.c) / 2
  const from = bars[Math.max(0, i - 5)], to = bars[Math.max(0, i - 1)], at = bars[Math.max(0, i - 8)]
  const lift = Math.max(b.h - b.l, Math.abs(b.c) * 0.012) * 0.46
  const chipBg = solid ? BRIGHT : swell > 0.6 ? '#efd98a' : color
  return [
    { id: `${id}-arrow`, type: 'arrow', points: [{ time: from.t, price }, { time: to.t, price }], color: solid ? BRIGHT : color, lineWidth: solid ? 4.5 : 3 + swell * 1.5, arrowSize: solid ? 26 : 20 + swell * 6, locked: true },
    { id: `${id}-chip`, type: 'text', points: [{ time: at.t, price: price + lift }], text: `  ${letter}  `, color: '#111111', fontSize: solid ? 15 : 13, bgEnabled: true, bgColor: chipBg, locked: true },
  ]
}

export default function Piece51TrapV2() {
  const d = useSample()
  const phone = useIsPhone()
  const VIEW = phone ? 55 : 90
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const vis = d?.visible
  const n = vis?.length || 0
  const traps = useMemo(() => (n ? findTraps(vis, n, VIEW) : []), [vis, n, VIEW])
  const cands = useMemo(() => (n ? [...traps.map((t) => ({ ...t })), { i: n - 1, kind: 'real', why: 'A real red day, an open above its body, a close near the high. The Kicker.' }].sort((a, b) => a.i - b.i) : []), [traps, n])
  const view = useMemo(() => (cands.length ? Math.max(50, n - cands[0].i + 24) : 70), [cands, n])
  const all = useRunOn(vis, d?.forward, state !== 'ask')
  const phase = useBreath(4, 330, state === 'ask')
  const annotations = useMemo(() => {
    if (!n || !all) return null
    const a = []
    cands.forEach((c, k) => {
      const letter = String.fromCharCode(65 + k)
      const last = c.i === n - 1
      if (state === 'ask') {
        const sel = pick === c.i
        a.push(...breathe(all, c.i, { letter, swell: sel ? 0 : SWELL[phase], solid: sel, id: `c${k}` }))
        if (sel) {
          if (last) a.push({ id: `v${k}`, type: 'vertical', points: [{ time: all[c.i].t, price: all[c.i].c }], color: BRIGHT, lineWidth: 2, lineStyle: 'dashed', locked: true })
          else { a.push(...haloAt(all, c.i, { id: `h${k}`, color: BRIGHT, solid: true })); a.push(...boxAt(all, c.i, { id: `x${k}`, color: GOLD })) }
        } else if (!last) a.push(...haloAt(all, c.i, { id: `h${k}`, color: GOLD, swell: SWELL[phase] }))
      } else {
        const real = c.kind === 'real'
        const color = real ? '#2faf68' : '#df4646'
        a.push(...breathe(all, c.i, { letter: real ? 'the Kicker' : c.kind === 'baby' ? 'baby red day' : 'weak close', solid: false, color, id: `c${k}` }))
        if (c.i + 1 < all.length) a.push(...haloAt(all, c.i, { id: `h${k}`, color, solid: pick === c.i }))
        if (pick === c.i && c.i + 1 < all.length) a.push(...boxAt(all, c.i, { id: `x${k}`, color }))
      }
    })
    if (state !== 'ask') a.push(...rayAt(vis[n - 1], 'l', { id: 'l', label: 'the line' }))
    return a
  }, [cands, all, vis, n, state, pick, phase])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const ok = pick === n - 1
  return (
    <div className={`${d5.lesson} ${state === 'bad' ? d5.shakeHard : ''}`}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, k) => <i key={k} className={k < 7 ? d5.on : k === 7 ? d5.cur : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : ok ? 'happy' : 'oops'} size={64} /><div className={d5.bubble}>{state === 'ask' ? `${cands.length} candles are marked and breathing. Only one is a Kicker. Tap the real one.` : ok ? 'That is the Kicker. The others each fail a rule.' : 'That one fails a rule. The Kicker is the green one.'}</div></div>
      <div className={`${s.chartBox} `}>
        {state === 'ask' && pick == null ? <span className={s.tapHint}>tap a marked candle</span> : null}
        {state !== 'ask' ? <Stamp ok={ok} /> : null}
        <WidgetChart sym={d.sym} bars={all} annotations={annotations} height={460} density="compact" defaultBars={view} exactBars onBarTap={state === 'ask' ? ({ index }) => { if (index < 0) return; const near = cands.map((c) => ({ c, dd: Math.abs(c.i - index) })).sort((p, q) => p.dd - q.dd)[0]; if (near && near.dd <= 3) { setPick(near.c.i); sfx('tick') } } : null} />
      </div>
      <div className={`${d5.candRow} ${d5.cascade}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, cands.length)}, 1fr)` }}>{cands.map((c, k) => <button key={c.i} type="button" style={{ '--i': k }} className={`${d5.cand} ${pick === c.i ? d5.sel : ''} ${state !== 'ask' ? (c.kind === 'real' ? d5.right : d5.wrong) : ''}`} disabled={state !== 'ask'} onClick={() => { setPick(c.i); sfx('tick') }}><span className={d5.candHead}><span className={d5.letter}>{String.fromCharCode(65 + k)}</span><span>{vis[c.i].t}</span></span>{state !== 'ask' ? <small>{c.why}</small> : <small>{pick === c.i ? 'your pick' : 'tap to pick'}</small>}</button>)}</div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={() => { setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong') }}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => { setState('ask'); setPick(null) }}>Again</button>}
      </div></div>
    </div>
  )
}
