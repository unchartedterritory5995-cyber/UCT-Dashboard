import { useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import Logo from '../Logo'
import { Stamp } from '../bits'
import { useRunOn } from '../fx'
import { useSample } from '../Lab'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { rayAt, pct, boxAt } from '../pointers'
import { sfx } from '../sfx'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

/** Round 11, piece 6: SPOT THE TRAP V3 (owner, batch 10: "needs a lot of improvement"). The three choosable candles
 *  are painted GOLD on the chart itself (the widget's own highlight), each with a big letter badge; nothing pulses.
 *  Tap anywhere near one. On Check every candidate opens a RULE CARD: the red day's size, the open above the body,
 *  the close in the upper half, each ticked or crossed from the bars, so the reason is taught, not stated. The
 *  look-alikes are still found by the owner's rules, never invented. */
const QUIET = { hideWatermark: true, hideLegend: true, showDrawingTools: false, showRangeSelector: false }
function rules(bars, i) {
  const b = bars[i], r = bars[i - 1], rr = bars[i - 2]
  const redChg = pct(rr.c, r.c)
  const closePos = (b.c - b.l) / ((b.h - b.l) || 1)
  return [
    { k: 'red', label: 'A real red day before it', value: `${redChg.toFixed(1)}%`, ok: r.c < r.o && Math.abs(redChg) >= 1, rule: 'red, and down 1% or more' },
    { k: 'open', label: 'Opens above the red body', value: `open ${b.o.toFixed(2)} vs body top ${Math.max(r.o, r.c).toFixed(2)}`, ok: b.o > Math.max(r.o, r.c), rule: 'the open clears the body' },
    { k: 'close', label: 'Closes strong', value: `${Math.round(closePos * 100)}% up its range`, ok: b.c > b.o && closePos >= 0.5, rule: 'green, upper half of the range' },
  ]
}
function findTraps(bars, n, view) {
  const out = []
  for (let i = n - 2; i >= Math.max(2, n - view) && out.length < 2; i--) {
    const rs = rules(bars, i)
    const [red, open, close] = rs
    const b = bars[i], r = bars[i - 1]
    if (!(r.c < r.o) || !open.ok) continue
    if (!red.ok && close.ok && b.c > b.o && !out.some((x) => x.kind === 'baby')) out.push({ i, kind: 'baby', why: 'The red day before it was too small. Not a real red day.' })
    else if (red.ok && !close.ok && !out.some((x) => x.kind === 'weak')) out.push({ i, kind: 'weak', why: 'It opened above the red body but did not close strong.' })
  }
  return out
}
const GOLD = '#dcbb5e'

export default function Piece57TrapV3() {
  const d = useSample()
  const phone = useIsPhone()
  const VIEW = phone ? 55 : 90
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')
  const vis = d?.visible
  const n = vis?.length || 0
  const traps = useMemo(() => (n ? findTraps(vis, n, VIEW) : []), [vis, n, VIEW])
  const cands = useMemo(() => (n ? [...traps, { i: n - 1, kind: 'real', why: 'A real red day, an open above its body, a strong close. The Kicker.' }].sort((a, b) => a.i - b.i) : []), [traps, n])
  const view = useMemo(() => (cands.length ? Math.max(50, n - cands[0].i + 24) : 70), [cands, n])
  const all = useRunOn(vis, d?.forward, state !== 'ask', 200)
  const highlight = useMemo(() => (state === 'ask' && vis ? cands.map((c) => vis[c.i].t) : null), [cands, vis, state])
  const extra = useMemo(() => ({ ...QUIET, ...(highlight ? { highlightBarTime: highlight, highlightColor: GOLD } : {}) }), [highlight])
  const annotations = useMemo(() => {
    if (!n || !all) return null
    const a = []
    cands.forEach((c, k) => {
      const letter = String.fromCharCode(65 + k)
      const b = all[c.i], first = Math.max(0, n - view), at = c.i - 3 >= first + 4 ? all[c.i - 3] : all[Math.min(all.length - 1, c.i + 2)]
      const sel = pick === c.i
      const real = c.kind === 'real'
      const color = state === 'ask' ? (sel ? '#fff1c2' : GOLD) : real ? '#2faf68' : '#df4646'
      a.push({ id: `L${k}`, type: 'text', points: [{ time: at.t, price: b.h + (b.h - b.l) * 0.6 }], text: `  ${state === 'ask' ? letter : real ? 'KICKER' : c.kind === 'baby' ? 'BABY RED DAY' : 'WEAK CLOSE'}  `, color: '#111', fontSize: sel ? 16 : 14, bgEnabled: true, bgColor: color, locked: true })
      if (sel || state !== 'ask') {
        if (c.i + 1 < all.length) a.push(...boxAt(all, c.i, { id: `x${k}`, color }))
        else a.push({ id: `v${k}`, type: 'vertical', points: [{ time: b.t, price: b.c }], color, lineWidth: 2, lineStyle: 'dashed', locked: true })
      }
    })
    if (state !== 'ask') a.push(...rayAt(vis[n - 1], 'l', { id: 'l', label: '' }))
    return a
  }, [cands, all, vis, n, state, pick, view])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const ok = pick === n - 1
  return (
    <div className={`${d5.lesson} ${state === 'bad' ? d5.shakeHard : ''}`}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, k) => <i key={k} className={k < 7 ? d5.on : k === 7 ? d5.cur : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.ask}><Logo mood={state === 'ask' ? (pick != null ? 'think' : 'idle') : ok ? 'happy' : 'oops'} size={60} /><div className={d5.bubble}>{state === 'ask' ? `${cands.length} gold candles. Each opened above a red day. Only one is a Kicker. Tap the real one.` : ok ? 'That is the Kicker. Read why the others fail.' : 'That one fails a rule. The Kicker is the green one. Read why.'}</div></div>
      <div className={s.chartBox}>
        {state === 'ask' && pick == null ? <span className={s.tapHint}>tap a gold candle</span> : null}
        {state !== 'ask' ? <Stamp ok={ok} /> : null}
        <WidgetChart sym={d.sym} bars={all} annotations={annotations} height={480} phoneHeight={360} density="mini" defaultBars={view} exactBars hideTicker extra={extra} onBarTap={state === 'ask' ? ({ index }) => { if (index < 0) return; const near = cands.map((c) => ({ c, dd: Math.abs(c.i - index) })).sort((p, q) => p.dd - q.dd)[0]; if (near && near.dd <= 3) { setPick(near.c.i); sfx('tick') } } : null} />
      </div>
      <div className={`${d5.candRow} ${d5.cascade}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, cands.length)}, 1fr)` }}>{cands.map((c, k) => {
        const rs = state !== 'ask' ? rules(vis, c.i) : null
        return (
          <button key={c.i} type="button" style={{ '--i': k }} className={`${d5.cand} ${pick === c.i ? d5.sel : ''} ${state !== 'ask' ? (c.kind === 'real' ? d5.right : d5.wrong) : ''}`} disabled={state !== 'ask'} onClick={() => { setPick(c.i); sfx('tick') }}>
            <span className={d5.candHead}><span className={d5.letter}>{String.fromCharCode(65 + k)}</span><span>{vis[c.i].t}</span></span>
            {rs ? <span className={d5.ruleList}>{rs.map((r) => <span key={r.k} className={r.ok ? d5.ruleOk : d5.ruleBad}><b>{r.ok ? '✓' : '✕'}</b><span>{r.label}</span><small>{r.value}</small></span>)}</span> : <small>{pick === c.i ? 'your pick' : 'tap to pick'}</small>}
          </button>
        )
      })}</div>
      <div className={`${d5.footer} ${state === 'ok' ? d5.good : state === 'bad' ? d5.badF : ''}`}><div className={d5.footIn}>
        {state === 'ask' ? <button type="button" className={`${d5.btn} ${pick != null ? d5.live : ''}`} disabled={pick == null} onClick={() => { setState(ok ? 'ok' : 'bad'); sfx(ok ? 'right' : 'wrong') }}>Check</button>
          : <button type="button" className={`${d5.btn} ${state === 'ok' ? d5.live : d5.red}`} onClick={() => { setState('ask'); setPick(null) }}>Again</button>}
      </div></div>
    </div>
  )
}
