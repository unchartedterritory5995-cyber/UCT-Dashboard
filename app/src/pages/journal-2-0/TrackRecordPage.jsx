/**
 * TrackRecordPage — the far end of a public track-record share link.
 *
 * OUTSIDE AuthGuard on purpose (a link that only opens for people who
 * already have an account is not sharing); the token is the credential and
 * `GET /api/j2/public/track-record/{token}` 404s identically for unknown,
 * revoked, and kill-switched tokens. Route path derives from
 * lib/trackRecordLink.js — one authority, same posture as the screener and
 * notebook share links.
 *
 * Everything rendered comes from the audited pipeline server-side; this
 * page adds nothing and hides nothing (owner decision: stats + dollars +
 * recent trades).
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import styles from './TrackRecordPage.module.css'

const usd = (v) => (v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
const pct = (v, dp = 1) => (v == null ? '—' : `${(v * 100).toFixed(dp)}%`)
const num = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp))

export default function TrackRecordPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    let dead = false
    fetch(`/api/j2/public/track-record/${encodeURIComponent(token || '')}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => { if (!dead) { setData(d); setState('ok') } })
      .catch(() => { if (!dead) setState('missing') })
    return () => { dead = true }
  }, [token])

  if (state === 'loading') {
    return <div className={styles.page}><p className={styles.centerNote}>Loading…</p></div>
  }
  if (state === 'missing' || !data) {
    return (
      <div className={styles.page}>
        <div className={styles.missing}>
          <h1 className={styles.brand}>UCT INTELLIGENCE</h1>
          <p>This track record link doesn't exist or was revoked by its owner.</p>
          <a className={styles.cta} href="https://uctintelligence.com">uctintelligence.com</a>
        </div>
      </div>
    )
  }

  const s = data.stats || {}
  const up = (s.totalPnl ?? 0) >= 0
  const curve = data.curve || []
  const chartOption = curve.length >= 2 ? {
    grid: { left: 8, right: 12, top: 10, bottom: 22, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: '#101013', borderColor: '#2a2a2e', textStyle: { color: '#e8e6e1', fontSize: 12 } },
    xAxis: { type: 'category', data: curve.map((p) => p.date), boundaryGap: false, axisLabel: { color: '#8a8a8a', fontSize: 10 }, axisLine: { lineStyle: { color: '#2a2a2e' } } },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }, axisLabel: { color: '#8a8a8a', fontSize: 10 } },
    series: [{
      type: 'line', data: curve.map((p) => p.equity), smooth: true, symbol: 'none',
      lineStyle: { color: up ? '#22c55e' : '#ef4444', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: up ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)' }, { offset: 1, color: 'rgba(0,0,0,0)' }] } },
    }],
  } : null

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <span className={styles.brand}>UCT INTELLIGENCE</span>
        <span className={styles.eyebrow}>VERIFIED TRACK RECORD</span>
      </header>

      <section className={styles.hero}>
        <h1 className={styles.name}>{data.displayName}</h1>
        <div className={`${styles.totalPnl} ${up ? styles.pos : styles.neg}`}>
          {s.totalPnl != null && s.totalPnl >= 0 ? '+' : ''}{usd(s.totalPnl)}
        </div>
        <p className={styles.sub}>
          {s.tradeCount} trades · {s.tradingDays ?? '—'} trading days · broker-synced &amp; audit-verified
        </p>
      </section>

      {chartOption && (
        <section className={styles.chartCard}>
          <ReactECharts option={chartOption} style={{ height: 240 }} />
        </section>
      )}

      <section className={styles.statGrid}>
        <Stat label="Win rate" value={pct(s.winRate)} />
        <Stat label="Payoff" value={num(s.payoff)} />
        <Stat label="Avg win" value={usd(s.avgWin)} />
        <Stat label="Avg loss" value={usd(s.avgLoss)} neg />
        <Stat label="Sharpe" value={num(s.sharpe)} />
        <Stat label="Annualized" value={pct(s.annualizedReturn)} />
        <Stat label="Max drawdown" value={pct(s.maxDrawdownPct)} neg />
        <Stat label="Profitable days" value={pct(s.profitableDayPct)} />
      </section>

      {data.recentTrades?.length > 0 && (
        <section className={styles.tradesCard}>
          <h3 className={styles.sectionTitle}>Recent trades</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Date</th><th>Symbol</th><th>Side</th><th>Result</th><th className={styles.right}>Net P&amp;L</th></tr>
              </thead>
              <tbody>
                {data.recentTrades.map((t, i) => (
                  <tr key={`${t.symbol}-${t.date}-${i}`}>
                    <td>{t.date}</td>
                    <td className={styles.sym}>{t.symbol}</td>
                    <td>{t.side}</td>
                    <td className={t.result === 'Win' ? styles.pos : t.result === 'Loss' ? styles.neg : ''}>{t.result}</td>
                    <td className={`${styles.right} ${t.netPnl >= 0 ? styles.pos : styles.neg}`}>
                      {t.netPnl >= 0 ? '+' : ''}{usd(t.netPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className={styles.foot}>
        <span className={styles.brand}>UCT INTELLIGENCE</span>
        <span className={styles.tagline}>Navigate the market, effectively.</span>
        <a className={styles.cta} href="https://uctintelligence.com">
          Track your own — uctintelligence.com
        </a>
      </footer>
    </div>
  )
}

function Stat({ label, value, neg }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${neg ? styles.mutedNeg : ''}`}>{value}</span>
    </div>
  )
}
