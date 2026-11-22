import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { useSample } from '../Lab'
import { spot, rayAt, pct } from '../pointers'
import { sfx } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

/** Round 9, piece 5: SPOT THE TRAP. Three candles pulse on the chart; one is the Kicker, two are look-alikes that
 *  fail a rule the owner has stated: the red day before was not real (under 1%), or the candle did not close
 *  strong (in the lower half of its range). The look-alikes are FOUND in the bars by those rules, never invented;
 *  if the chart holds none, fewer candidates show. Tap one, then Check; every candidate gets its reason. */
function findTraps(bars, n) {
  const out = []
  for (let i = n - 2; i >= 2 && out.length < 2; i--) {
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

export default function Piece45Trap() {
  const d = useSample()
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const vis = d?.visible
  const n = vis?.length || 0
  const traps = useMemo(() => (n ? findTraps(vis, n) : []), [vis, n])
  const cands = useMemo(() => (n ? [...traps.map((t) => ({ ...t })), { i: n - 1, kind: 'real', why: 'A real red day, an open above its body, a close near the high. The Kicker.' }].sort((a, b) => a.i - b.i) : []), [traps, n])
  const annotations = useMemo(() => {
    if (!n) return null
    const a = []
    cands.forEach((c, k) => {
      const label = state === 'ask' ? (pick === c.i ? 'YOUR PICK' : String.fromCharCode(65 + k)) : c.kind === 'real' ? 'THE KICKER' : c.kind === 'baby' ? 'BABY RED DAY' : 'WEAK CLOSE'
      const color = state === 'ask' ? (pick === c.i ? '#dcbb5e' : '#9a958a') : c.kind === 'real' ? '#2faf68' : '#df4646'
      a.push(...spot(vis, c.i, { label, id: `c${k}`, gap: 6, color, halo: c.i + 1 < n }))
    })
    if (state !== 'ask') a.push(...rayAt(vis[n - 1], 'l', { id: 'l', label: 'the line' }))
    return a
  }, [cands, vis, n, state, pick])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const ok = pick === n - 1
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, k) => <i key={k} className={k < 7 ? d5.on : k === 7 ? d5.cur : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : ok ? 'happy' : 'oops'} size={72} /><div className={d5.bubble}>{state === 'ask' ? `${cands.length} candles are marked. Only one is a Kicker. Tap the real one.` : ok ? 'That is the Kicker. The others fail a rule.' : 'That one fails a rule. The Kicker is the green one.'}</div></div>
      <div className={`${s.chartBox} `}>
        {state === 'ask' && pick == null ? <span className={s.tapHint}>tap a marked candle</span> : null}
        <WidgetChart sym={d.sym} bars={vis} annotations={annotations} height={460} density="compact" defaultBars={70} onBarTap={state === 'ask' ? ({ index }) => { const c = cands.find((x) => Math.abs(x.i - index) <= 1); if (c) setPick(c.i) } : null} />
      </div>
      <div className={d5.candRow}>{cands.map((c, k) => <button key={c.i} type="button" className={`${d5.cand} ${pick === c.i ? d5.sel : ''} ${state !== 'ask' ? (c.kind === 'real' ? d5.right : d5.wrong) : ''}`} disabled={state !== 'ask'} onClick={() => setPick(c.i)}><b>{String.fromCharCode(65 + k)}</b><span>{vis[c.i].t}</span>{state !== 'ask' ? <small>{c.why}</small> : null}</button>)}</div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={() => { setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong') }}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => { setState('ask'); setPick(null) }}>Again</button>}
      </div></div>
    </div>
  )
}
