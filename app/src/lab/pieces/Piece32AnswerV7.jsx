import { useEffect, useMemo, useState } from 'react'
import WidgetChart from '../WidgetChart'
import { useSample } from '../Lab'
import { spot, pct } from '../pointers'
import { regularSession, etLabel } from '../intraday'
import s from '../lab.module.css'
import d5 from '../duo.module.css'

const ACCOUNT = 25000, RISK_PCT = 0.5, CAP_PCT = 25, MAX_STOP_PCT = 3.5
const money = (v) => `$${v.toFixed(2)}`

function useJson(name) {
  const [d, setD] = useState(null)
  useEffect(() => { let on = true; fetch(`/labdata/${name}.json`).then((r) => r.json()).then((j) => on && setD(j)).catch(() => on && setD({ error: true })); return () => { on = false } }, [name])
  return d
}

/** Round 7, piece 2: the answer, corrected and dressed (owner: "the entry should be 11.05 over THE previous day high,
 *  or on DAY 1 of the kicker candle on a 30 min ORB"; "check mark and the answer more of a production"; "arrow and
 *  kicker label a lot better"). The previous day is the RED day: entry 1 is a stop-buy one cent over the red day's
 *  high, triggered on day 1 when price crosses it; entry 2 is the day-1 30-minute opening range break. Both on day 1.
 *  Stop per the house rule. Verdict header redesigned; the pointer is the new chip + halo. */
export default function Piece32AnswerV7() {
  const d = useSample()
  const m30 = useJson('JBI_2023-12-14_30m')
  const h60 = useJson('JBI_60m')
  const [tactic, setTactic] = useState('pdh')
  const [tf, setTf] = useState('D')
  const vis = d?.visible, fwd = d?.forward
  const n = vis?.length || 0
  const kick = n ? vis[n - 1] : null
  const red = n > 1 ? vis[n - 2] : null
  const all = useMemo(() => (vis && fwd ? [...vis, ...fwd] : vis), [vis, fwd])
  const bars30 = useMemo(() => (m30?.bars ? regularSession(m30.bars) : null), [m30])
  const hourly = useMemo(() => {
    if (!h60?.bars) return null
    const cut = fwd?.[5]?.t
    const lim = cut ? Math.floor(new Date(`${cut}T23:59:59-05:00`).getTime() / 1000) : Infinity
    return regularSession(h60.bars).filter((b) => b.t <= lim)
  }, [h60, fwd])
  const barsByTf = useMemo(() => (all ? { D: all, ...(hourly ? { 60: hourly } : {}), ...(bars30 ? { 30: bars30 } : {}) } : null), [all, hourly, bars30])
  const day1 = useMemo(() => (bars30 && m30?.session_open ? bars30.filter((b) => b.t >= m30.session_open) : null), [bars30, m30])
  const rows = useMemo(() => {
    if (!kick || !red || !fwd?.length) return null
    const outcome = (entry) => ({ hi: pct(entry, Math.max(kick.h, ...fwd.map((b) => b.h))), end: pct(entry, fwd[fwd.length - 1].c) })
    const mk = (key, name, sub, entry, fill) => {
      const lowDist = pct(entry, kick.l) * -1
      const wide = lowDist > MAX_STOP_PCT
      const stop = wide ? entry * (1 - MAX_STOP_PCT / 100) : kick.l
      const stopWhy = wide ? `${MAX_STOP_PCT}% under entry (the Kicker's low is ${lowDist.toFixed(1)}% away)` : 'the Kicker\'s low'
      const dist = pct(entry, stop) * -1, posPct = Math.min(RISK_PCT / (dist / 100), CAP_PCT), shares = Math.floor((ACCOUNT * posPct / 100) / entry)
      return { key, name, sub, entry, stop, stopWhy, dist, posPct, shares, riskUsd: Math.round(shares * (entry - stop)), fill, day1: pct(entry, kick.c), held: Math.min(kick.l, ...fwd.map((b) => b.l)) >= stop, ...outcome(entry) }
    }
    const pdhEntry = Math.round((red.h + 0.01) * 100) / 100
    const pdhBar = day1?.find((b) => b.h >= pdhEntry) || null
    const out = [mk('pdh', 'Over the previous day\'s high', 'stop-buy on day 1', pdhEntry, pdhBar ? `day 1 · ${etLabel(pdhBar.t)} ET` : (kick.h >= pdhEntry ? 'day 1' : 'not filled'))]
    if (day1?.length) {
      const or = day1[0]
      const trig = day1.find((b) => b.t > or.t && b.h > or.h) || null
      if (trig) out.push(mk('orb', '30-minute opening range break', 'day 1', or.h, `day 1 · ${etLabel(trig.t)} ET`))
    }
    return out
  }, [kick, red, fwd, day1])
  const row = rows?.find((r) => r.key === tactic) || rows?.[0]
  const annotations = useMemo(() => {
    if (!all || !kick || !row) return null
    const series = tf === 'D' ? all : tf === '60' ? hourly : bars30
    if (!series?.length) return null
    const kickDay = String(kick.t)
    const anchor = tf === 'D' ? red : (series.find((b) => new Date(b.t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) >= kickDay) || series[0])
    const a = [
      { id: 'e', type: 'hray', points: [{ time: anchor.t, price: row.entry }], color: '#2faf68', lineWidth: 1.5, lineStyle: 'dashed', label: tactic === 'orb' ? 'ENTRY · over the opening range high' : 'ENTRY · over the previous day\'s high' },
      { id: 'st', type: 'hray', points: [{ time: anchor.t, price: row.stop }], color: '#df4646', lineWidth: 1, lineStyle: 'dashed', label: `STOP · ${row.stopWhy}` },
    ]
    if (tf === 'D') { a.push(...spot(all, n - 1, { label: 'Kicker · day 1', id: 'k', gap: 9 })); a.push(...spot(all, n - 2, { label: 'red day', id: 'r', gap: 9, color: '#df4646', halo: false, below: true })) }
    return a
  }, [all, kick, red, n, tactic, row, tf, hourly, bars30])
  const markers = useMemo(() => (tf === 'D' && kick ? [{ time: kick.t, position: 'belowBar', color: '#2faf68', shape: 'arrowUp', text: `filled day 1 · over ${money(row?.entry ?? 0)}`, id: 'fill' }] : null), [tf, kick, row])
  if (!d) return <div className={s.col}><p className={s.hint}>Loading</p></div>
  return (
    <div className={d5.lesson}>
      <div className={d5.topbar}><button type="button" className={d5.close} aria-label="Close">✕</button><div className={d5.prog}>{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < 3 ? d5.on : ''} />)}</div><div className={d5.hearts}><span>♥</span><span>♥</span><span>♥</span></div></div>
      <div className={d5.hero}>
        <div className={d5.heroCheck}><span>✓</span></div>
        <div className={d5.heroText}><div className={d5.heroWord}>Kicker</div><div className={d5.heroSub}>{d.sym} · {d.asof}</div></div>
        <div className={d5.heroQuote}>A weak red day, then a candle that opens above the red body and closes near its high. Yesterday's sellers are trapped.</div>
      </div>
      <div className={s.chartBox}><WidgetChart sym={d.sym} barsByTf={barsByTf} annotations={annotations} markers={markers} height={500} defaultBars={60} onTfChange={setTf} /></div>
      <p className={s.hint}>Both entries are on day 1, the Kicker day. Switch 30m / 1h / 1D on the chart; the entry and stop lines stay. A stop-buy fills when price trades OVER the line, never at a close. The stop is the house rule: the Kicker's low when it is within {MAX_STOP_PCT}%, else {MAX_STOP_PCT}% under the entry.</p>
      {rows ? (
        <table className={d5.tactTable}>
          <thead><tr><th>Entry · day 1</th><th>Trigger</th><th>Stop · house rule</th><th>Risk</th><th>Size</th><th>$25k</th><th>Filled</th><th>Day 1 close</th><th>Best</th><th>Close 20</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`${d5.row} ${tactic === r.key ? d5.on : ''}`} onClick={() => setTactic(r.key)}>
                <td><span className={d5.tname}>{r.name}</span><span className={d5.tsub}>{r.sub}</span></td>
                <td data-l="Trigger"><b>over {money(r.entry)}</b></td>
                <td data-l="Stop · house rule" className={s.red}>under {money(r.stop)}<span className={d5.tsub}>{r.stopWhy}</span></td>
                <td data-l="Risk">{r.dist.toFixed(1)}%</td>
                <td data-l="Size">{r.posPct.toFixed(0)}%</td>
                <td data-l="$25k">{r.shares} sh · ${r.riskUsd}</td>
                <td data-l="Filled">{r.fill}</td>
                <td data-l="Day 1 close" className={r.day1 >= 0 ? s.green : s.red}>{r.day1 >= 0 ? '+' : ''}{r.day1.toFixed(1)}%</td>
                <td data-l="Best" className={s.green}>+{r.hi.toFixed(1)}%</td>
                <td data-l="Close 20" className={r.end >= 0 ? s.green : s.red}>{r.end >= 0 ? '+' : ''}{r.end.toFixed(1)}% · stop {r.held ? 'held' : 'hit'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className={s.hint}>Measuring</p>}
      <div className={d5.footer}><div className={d5.footIn}><button type="button" className={`${d5.btn} ${d5.live}`}>Continue</button></div></div>
    </div>
  )
}
