import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { pct } from '../pointers'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

const ACCOUNT = 25000, RISK_PCT = 0.5, CAP_PCT = 25
const money = (v) => `$${v.toFixed(2)}`
const hhmm = (t) => new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

/** Round 5, piece 2: the answer, redone (owner: "looks like shit. Just allow the user to switch timeframes").
 *  ONE Chart widget on the real data path, cut off at the Kicker day; the member switches 1D / 30m / 1h on the
 *  widget's own bar. Entry and stop are price lines, so they stay put on every timeframe. Under it, one strip of
 *  numbers for the tactic that is lit. Nothing else. */
export default function Piece22AnswerV5() {
  const d = useSample()
  const [m, setM] = useState(null)
  const [tactic, setTactic] = useState('pdh')
  useEffect(() => { fetch('/labdata/JBI_2023-12-14_30m.json').then((r) => r.json()).then(setM).catch(() => setM({ error: true })) }, [])
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const kick = n ? vis[n - 1] : null
  const orb = useMemo(() => {
    if (!m?.bars || !m.session_open) return null
    const i0 = m.bars.findIndex((b) => b.t >= m.session_open); if (i0 < 0) return null
    const or = m.bars[i0]
    const day = m.bars.filter((b) => b.t >= m.session_open && b.t <= m.session_close)
    const trig = day.find((b) => b.t > or.t && b.h > or.h) || null
    return { or, trig, dayClose: day[day.length - 1]?.c }
  }, [m])
  const row = useMemo(() => {
    if (!kick || !fwd?.length) return null
    const mk = (entry, stop, fill, extra) => {
      const dist = pct(entry, stop) * -1, posPct = Math.min(RISK_PCT / (dist / 100), CAP_PCT), shares = Math.floor((ACCOUNT * posPct / 100) / entry)
      return { entry, stop, dist, posPct, shares, riskUsd: Math.round(shares * (entry - stop)), fill, held: Math.min(...fwd.map((b) => b.l)) >= stop, hi: pct(entry, Math.max(...fwd.map((b) => b.h))), end: pct(entry, fwd[fwd.length - 1].c), ...extra }
    }
    if (tactic === 'orb') return orb?.trig ? mk(orb.or.h, orb.or.l, `day 1 · ${hhmm(orb.trig.t)} ET`, { day1: pct(orb.or.h, orb.dayClose) }) : null
    const f = fwd.findIndex((b) => b.h > kick.h)
    return mk(kick.h, kick.l, f >= 0 ? `day ${f + 2}` : 'not filled', {})
  }, [kick, fwd, tactic, orb])
  const extra = useMemo(() => (row ? {
    priceLines: [
      { price: row.entry, color: '#58cc02', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: tactic === 'orb' ? 'ENTRY · OR high' : 'ENTRY · day 1 high' },
      { price: row.stop, color: '#ff4b4b', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'STOP · proposed' },
    ],
  } : null), [row, tactic])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < 3 ? d5.on : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.answerHead}><span className={d5.check}>✓</span><div><b>Kicker</b><small>{d.sym} · {d.asof} · red day, then a candle that opens above the red body and closes near its high</small></div></div>
      <div className={d5.tabs}>
        <button type="button" className={`${d5.tab} ${tactic === 'pdh' ? d5.on : ''}`} onClick={() => setTactic('pdh')}>Day 2 · previous day high</button>
        <button type="button" className={`${d5.tab} ${tactic === 'orb' ? d5.on : ''}`} onClick={() => setTactic('orb')}>Day 1 · 30-min ORB</button>
      </div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} cutoff={d.asof} height={460} extra={extra} /></div>
      <p className={s.hint}>Switch 1D / 30m / 1h on the chart. The entry and stop lines stay. {tactic === 'orb' ? 'On 30m the opening range is the first bar of Dec 14; the entry line is its high.' : ''}</p>
      {row ? (
        <div className={d5.strip}>
          <div><small>Entry</small><b>{money(row.entry)}</b></div>
          <div><small>Stop</small><b className={s.red}>{money(row.stop)}</b></div>
          <div><small>Risk</small><b>{row.dist.toFixed(1)}%</b></div>
          <div><small>Size</small><b>{row.posPct.toFixed(0)}%</b></div>
          <div><small>$25k</small><b>{row.shares} sh</b></div>
          <div><small>At risk</small><b>${row.riskUsd}</b></div>
          <div><small>Filled</small><b>{row.fill}</b></div>
          {row.day1 != null ? <div><small>Day 1</small><b className={row.day1 >= 0 ? s.green : s.red}>{row.day1 >= 0 ? '+' : ''}{row.day1.toFixed(1)}%</b></div> : null}
          <div><small>Stop</small><b className={row.held ? s.green : s.red}>{row.held ? 'held' : 'hit'}</b></div>
          <div><small>Best 20</small><b className={s.green}>+{row.hi.toFixed(1)}%</b></div>
          <div><small>Close 20</small><b className={row.end >= 0 ? s.green : s.red}>{row.end >= 0 ? '+' : ''}{row.end.toFixed(1)}%</b></div>
        </div>
      ) : <p className={s.hint}>Measuring</p>}
      <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`}>Continue</button></div></div>
    </div>
  )
}
