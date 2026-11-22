import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { arrowAt, rayAt, pct } from '../pointers'
import s from '../lab.module.css'

const ACCOUNT = 25000
const RISK_PCT = 0.5
const CAP_PCT = 25

/** 30-minute bars for the Kicker day, from the site's own bars route (saved in the workbench data folder). */
function use30m(name) {
  const [d, setD] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(`/labdata/${name}.json`).then((r) => r.json()).then((j) => alive && setD(j)).catch(() => alive && setD({ error: true }))
    return () => { alive = false }
  }, [name])
  return d
}

const money = (v) => `$${v.toFixed(2)}`
const hhmm = (t) => new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

/** Round 4, piece 2: the answer card with BOTH house entries and their numbers (owner: "over previous day high or
 *  day 1 Kicker ORB on the 30 minute; want to see the numbers for all of them; simpler, easier"). Two widget charts:
 *  the daily with the Kicker, and the 30-minute chart of day 1 with the opening range. One table, one sentence. The
 *  stops are still the owner's to rule; they are shown as the structure's low and marked proposed. */
export default function Piece17AnswerV4() {
  const d = useSample()
  const m = use30m('JBI_2023-12-14_30m')
  const [tactic, setTactic] = useState('orb')
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const kick = n ? vis[n - 1] : null
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const bars30 = m?.bars || null
  // ORB on the 30-minute: the opening range = the first regular-session bar of day 1; the break = the first later
  // bar that trades above its high. Measured, never asserted.
  const orb = useMemo(() => {
    if (!bars30 || !m?.session_open) return null
    const i0 = bars30.findIndex((b) => b.t >= m.session_open)
    if (i0 < 0) return null
    const or = bars30[i0]
    const day = bars30.filter((b) => b.t >= m.session_open && b.t <= m.session_close)
    const trig = day.find((b) => b.t > or.t && b.h > or.h) || null
    const dayClose = day[day.length - 1]?.c
    return { or, trig, dayClose, orIdx: i0, trigIdx: trig ? bars30.indexOf(trig) : -1 }
  }, [bars30, m])
  const rowFor = (entry, stop, fillLabel, firstDayGain) => {
    if (!fwd?.length || !(entry > stop)) return null
    const dist = pct(entry, stop) * -1
    const posPct = Math.min(RISK_PCT / (dist / 100), CAP_PCT)
    const shares = Math.floor((ACCOUNT * posPct / 100) / entry)
    const lo = Math.min(...fwd.map((b) => b.l)), hi = Math.max(...fwd.map((b) => b.h))
    return { entry, stop, dist, posPct, capped: RISK_PCT / (dist / 100) > CAP_PCT, shares, riskUsd: Math.round(shares * (entry - stop)), fill: fillLabel, firstDayGain, held: lo >= stop, hi: pct(entry, hi), end: pct(entry, fwd[fwd.length - 1].c) }
  }
  const rows = useMemo(() => {
    if (!kick || !fwd?.length) return null
    const pdhFill = fwd.findIndex((b) => b.h > kick.h)
    const pdh = rowFor(kick.h, kick.l, pdhFill >= 0 ? `day 2 (session ${pdhFill + 1})` : 'not filled in 20', null)
    const o = orb && orb.trig ? rowFor(orb.or.h, orb.or.l, `day 1, ${hhmm(orb.trig.t)} ET`, pct(orb.or.h, orb.dayClose)) : null
    return { pdh, orb: o }
  }, [kick, fwd, orb])
  const annDaily = useMemo(() => {
    if (!kick) return null
    const a = arrowAt(vis, n - 1, { label: 'the Kicker · day 1', id: 'a' })
    if (tactic === 'pdh') { a.push(...rayAt(kick, 'h', { id: 'e', label: 'entry · break of day 1 high', color: '#1ae51a' })); a.push(...rayAt(kick, 'l', { id: 's', label: 'stop · proposed', color: '#ff6b6b' })) }
    return a
  }, [vis, n, kick, tactic])
  const ann30 = useMemo(() => {
    if (!orb) return null
    const a = [
      { id: 'or-h', type: 'hray', points: [{ time: orb.or.t, price: orb.or.h }], color: '#1ae51a', lineWidth: 1, lineStyle: 'dashed', label: 'opening range high · entry' },
      { id: 'or-l', type: 'hray', points: [{ time: orb.or.t, price: orb.or.l }], color: '#ff6b6b', lineWidth: 1, lineStyle: 'dashed', label: 'opening range low · stop, proposed' },
    ]
    if (orb.trig) a.push(...arrowAt(bars30, orb.trigIdx, { label: 'break', color: '#1ae51a', gap: 4, id: 'trig' }))
    return a
  }, [orb, bars30])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  const R = rows ? (tactic === 'orb' ? rows.orb : rows.pdh) : null
  return (
    <div className={s.col}>
      <div className={s.top}><span>Question 3 of 10</span><span className={s.bar}><i style={{ width: '30%' }} /></span><span>Setup · Kicker</span></div>
      <div className={`${s.verdict} ${s.ok}`}>✓ Kicker · {d.sym} · {d.asof}</div>
      <p className={s.lesson}>Red day, then a candle that opens above the red body and closes near its high. Sellers trapped. <b>Two ways in.</b></p>
      <div className={s.tactics}>
        <button type="button" className={`${s.tactic} ${tactic === 'orb' ? s.on : ''}`} onClick={() => setTactic('orb')}><b>1 · Day 1 · 30-minute ORB</b><span>Buy the break of the opening range on the Kicker day.</span></button>
        <button type="button" className={`${s.tactic} ${tactic === 'pdh' ? s.on : ''}`} onClick={() => setTactic('pdh')}><b>2 · Day 2 · previous day high</b><span>Buy the break of the Kicker's high next session.</span></button>
      </div>
      <div className={s.chartBox}>
        {tactic === 'orb'
          ? (bars30 ? <WidgetChart sym={d.sym} tf="30" bars={bars30} annotations={ann30} height={400} density="compact" /> : <div style={{ height: 400, display: 'grid', placeItems: 'center', color: '#9a958a' }}>Loading the 30-minute chart</div>)
          : <WidgetChart sym={d.sym} bars={all} annotations={annDaily} height={400} density="compact" />}
      </div>
      {R ? (
        <div className={s.numbers}>
          <div><span>Entry</span><b>{money(R.entry)}</b></div>
          <div><span>Stop · proposed</span><b className={s.red}>{money(R.stop)}</b></div>
          <div><span>Risk</span><b>{R.dist.toFixed(1)}%</b></div>
          <div><span>Size at {RISK_PCT}%</span><b>{R.posPct.toFixed(0)}%{R.capped ? ' cap' : ''}</b></div>
          <div><span>${(ACCOUNT / 1000).toFixed(0)}k account</span><b>{R.shares} sh</b></div>
          <div><span>At risk</span><b>${R.riskUsd}</b></div>
          <div><span>Filled</span><b>{R.fill}</b></div>
          {R.firstDayGain != null ? <div><span>Day 1 close</span><b className={R.firstDayGain >= 0 ? s.green : s.red}>{R.firstDayGain >= 0 ? '+' : ''}{R.firstDayGain.toFixed(1)}%</b></div> : null}
          <div><span>Stop</span><b className={R.held ? s.green : s.red}>{R.held ? 'held' : 'hit'}</b></div>
          <div><span>Best in 20</span><b className={s.green}>+{R.hi.toFixed(1)}%</b></div>
          <div><span>Close of 20</span><b className={R.end >= 0 ? s.green : s.red}>{R.end >= 0 ? '+' : ''}{R.end.toFixed(1)}%</b></div>
        </div>
      ) : <p className={s.hint}>{tactic === 'orb' && orb && !orb.trig ? 'The opening range was never broken on day 1.' : 'Measuring'}</p>}
      <p className={s.hint}>Entries are the house's. Each stop is the structure's low (opening range low, Kicker low), proposed for your ruling. Size = risk % ÷ stop distance %, capped at {CAP_PCT}%. Every number is measured from the bars.</p>
      <div className={s.foot}><button type="button" className={s.cta}>Continue</button></div>
    </div>
  )
}
