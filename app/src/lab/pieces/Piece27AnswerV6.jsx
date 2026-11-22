import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { arrowAt, pct } from '../pointers'
import { regularSession, byDay, etLabel } from '../intraday'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

const ACCOUNT = 25000, RISK_PCT = 0.5, CAP_PCT = 25, MAX_STOP_PCT = 3.5
const money = (v) => `$${v.toFixed(2)}`

function useJson(name) {
  const [d, setD] = useState(null)
  useEffect(() => { let on = true; fetch(`/labdata/${name}.json`).then((r) => r.json()).then((j) => on && setD(j)).catch(() => on && setD({ error: true })); return () => { on = false } }, [name])
  return d
}

/** Round 6, piece 2: the answer, again (owner: "chart failed to load; don't like how it is presented; the entry is
 *  supposed to trigger OVER previous day high, not at market close"). No fetch now: the widget carries its own bars
 *  for 30m, 1h and 1D (hourly from the site's bars route), so the timeframe bar always works. The chart shows the
 *  sessions AFTER the Kicker so the trigger is visible: the entry is a stop-buy OVER the day-1 high, filled on day 2
 *  where price crossed it, marked with an arrow. Two tactics in one table; click a row to draw it. */
export default function Piece27AnswerV6() {
  const d = useSample()
  const m30 = useJson('JBI_2023-12-14_30m')
  const h60 = useJson('JBI_60m')
  const [tactic, setTactic] = useState('pdh')
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const kick = n ? vis[n - 1] : null
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  // hourly ends five sessions after the Kicker, so the 1h frame opens on the trigger instead of weeks later
  const hourly = useMemo(() => {
    if (!h60?.bars) return null
    const cut = fwd?.[5]?.t
    const lim = cut ? Math.floor(new Date(`${cut}T23:59:59-05:00`).getTime() / 1000) : Infinity
    return regularSession(h60.bars).filter((b) => b.t <= lim)
  }, [h60, fwd])
  const bars30 = useMemo(() => (m30?.bars ? regularSession(m30.bars) : null), [m30])
  const barsByTf = useMemo(() => (all ? { D: all, ...(hourly ? { 60: hourly } : {}), ...(bars30 ? { 30: bars30 } : {}) } : null), [all, hourly, bars30])
  const orb = useMemo(() => {
    if (!bars30 || !m30?.session_open) return null
    const or = bars30.find((b) => b.t >= m30.session_open); if (!or) return null
    const day = bars30.filter((b) => b.t >= m30.session_open && b.t <= m30.session_close)
    const trig = day.find((b) => b.t > or.t && b.h > or.h) || null
    return { or, trig, dayClose: day[day.length - 1]?.c }
  }, [bars30, m30])
  const pdhFill = useMemo(() => {
    if (!kick || !fwd?.length) return null
    const i = fwd.findIndex((b) => b.h > kick.h)
    if (i < 0) return { i: -1 }
    const day = fwd[i].t
    const hb = hourly ? (byDay(hourly)[day] || []).find((b) => b.h > kick.h) : null
    return { i, day, when: hb ? etLabel(hb.t) : null }
  }, [kick, fwd, hourly])
  const rows = useMemo(() => {
    if (!kick || !fwd?.length) return null
    // THE HOUSE STOP (owner, 2026-11-02): "under the kicker candle low or entry with a 3.5% stop, but we should get
    // these with smaller than 3.5% stop usually" -> the Kicker's low when it is within 3.5% of the entry, else 3.5%
    // under the entry; a setup whose Kicker-low stop is wider than 3.5% is flagged as wide.
    const mk = (key, name, sub, entry, structLow, fill, day1) => {
      const lowDist = pct(entry, structLow) * -1
      const wide = lowDist > MAX_STOP_PCT
      const stop = wide ? entry * (1 - MAX_STOP_PCT / 100) : structLow
      const stopWhy = wide ? `${MAX_STOP_PCT}% under entry (the Kicker's low is ${lowDist.toFixed(1)}% away: wide)` : 'the Kicker\'s low'
      const dist = pct(entry, stop) * -1, posPct = Math.min(RISK_PCT / (dist / 100), CAP_PCT), shares = Math.floor((ACCOUNT * posPct / 100) / entry)
      return { key, name, sub, entry, stop, stopWhy, wide, dist, posPct, shares, riskUsd: Math.round(shares * (entry - stop)), fill, day1, held: Math.min(...fwd.map((b) => b.l)) >= stop, hi: pct(entry, Math.max(...fwd.map((b) => b.h))), end: pct(entry, fwd[fwd.length - 1].c) }
    }
    const out = [mk('pdh', 'Over the day-1 high', 'stop-buy, day 2', kick.h, kick.l, pdhFill?.i >= 0 ? `day 2${pdhFill.when ? ` · ${pdhFill.when} ET` : ''}` : 'not filled', null)]
    if (orb?.trig) out.unshift(mk('orb', '30-min opening range break', 'day 1', orb.or.h, kick.l, `day 1 · ${etLabel(orb.trig.t)} ET`, pct(orb.or.h, orb.dayClose)))
    return out
  }, [kick, fwd, orb, pdhFill])
  const row = rows?.find((r) => r.key === tactic) || rows?.[0]
  const extra = useMemo(() => (row ? {
    priceLines: [
      { price: row.entry, color: '#2faf68', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: tactic === 'orb' ? 'ENTRY · over the opening range high' : 'ENTRY · stop-buy over the day-1 high' },
      { price: row.stop, color: '#df4646', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'STOP · house rule' },
    ],
  } : null), [row, tactic])
  const [tf, setTf] = useState('D')
  // the entry and stop as rays anchored in whichever timeframe is on screen (a price line alone did not survive the
  // bars-override path), the Kicker pointed at on the daily, the fill marked under the bar that crossed the line
  const annotations = useMemo(() => {
    if (!all || !kick || !row) return null
    const series = tf === 'D' ? all : tf === '60' ? hourly : bars30
    if (!series?.length) return null
    const kickDay = String(kick.t)
    const anchor = tf === 'D' ? kick : (series.find((b) => new Date(b.t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) >= kickDay) || series[0])
    const a = [
      { id: 'e', type: 'hray', points: [{ time: anchor.t, price: row.entry }], color: '#2faf68', lineWidth: 1.5, lineStyle: 'dashed', label: tactic === 'orb' ? 'ENTRY · over the opening range high' : 'ENTRY · stop-buy over the day-1 high' },
      { id: 's', type: 'hray', points: [{ time: anchor.t, price: row.stop }], color: '#df4646', lineWidth: 1, lineStyle: 'dashed', label: `STOP · ${row.stopWhy}` },
    ]
    if (tf === 'D') a.push(...arrowAt(all, n - 1, { label: 'the Kicker · day 1', id: 'k', gap: 12 }))
    return a
  }, [all, kick, n, tactic, row, tf, hourly, bars30])
  const markers = useMemo(() => (tf === 'D' && tactic === 'pdh' && pdhFill?.i >= 0 && all ? [{ time: all[n + pdhFill.i].t, position: 'belowBar', color: '#2faf68', shape: 'arrowUp', text: `filled over $${kick.h.toFixed(2)}`, id: 'fill' }] : null), [tf, tactic, pdhFill, all, n, kick])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < 3 ? d5.on : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.answerHead}><span className={d5.check}>✓</span><div><b>Kicker</b><small>{d.sym} · {d.asof} · red day, then a candle that opens above the red body and closes near its high</small></div></div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} barsByTf={barsByTf} annotations={annotations} markers={markers} height={500} extra={extra} defaultBars={60} onTfChange={setTf} /></div>
      <p className={s.hint}>Switch 30m / 1h / 1D on the chart. The entry and stop lines stay. The entry is a stop-buy that triggers when price trades OVER the line, never at a close. The stop is the house rule: under the Kicker's low, or {MAX_STOP_PCT}% under the entry when that low is further away; a setup should usually allow a stop smaller than {MAX_STOP_PCT}%.</p>
      {rows ? (
        <table className={d5.tactTable}>
          <thead><tr><th>Entry</th><th>Trigger</th><th>Stop · house rule</th><th>Risk</th><th>Size</th><th>$25k</th><th>Filled</th><th>Best 20</th><th>Close 20</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`${d5.row} ${tactic === r.key ? d5.on : ''}`} onClick={() => setTactic(r.key)}>
                <td><span className={d5.tname}>{r.name}</span><span className={d5.tsub}>{r.sub}</span></td>
                <td><b>over {money(r.entry)}</b></td>
                <td className={s.red}>under {money(r.stop)}<span className={d5.tsub}>{r.stopWhy}</span></td>
                <td>{r.dist.toFixed(1)}%</td>
                <td>{r.posPct.toFixed(0)}%</td>
                <td>{r.shares} sh · ${r.riskUsd}</td>
                <td>{r.fill}{r.day1 != null ? <span className={d5.tsub}>day-1 close {r.day1 >= 0 ? '+' : ''}{r.day1.toFixed(1)}%</span> : null}</td>
                <td className={s.green}>+{r.hi.toFixed(1)}%</td>
                <td className={r.end >= 0 ? s.green : s.red}>{r.end >= 0 ? '+' : ''}{r.end.toFixed(1)}% · stop {r.held ? 'held' : 'hit'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className={s.hint}>Measuring</p>}
      <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`}>Continue</button></div></div>
    </div>
  )
}
