import { useEffect, useState } from 'react'
import styles from './ChartHealth.module.css'

export default function ChartHealth() {
  const [report, setReport] = useState(null)
  const [quarantineCount, setQuarantineCount] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [liveness, setLiveness] = useState({})
  const [sourceHealth, setSourceHealth] = useState({ sources: {}, by_source: {} })
  const [provLookup, setProvLookup] = useState({ ticker: '', tf: '30', barTime: '' })
  const [provResult, setProvResult] = useState(null)
  const [provError, setProvError] = useState(null)
  const [quality, setQuality] = useState({})
  const [alerts, setAlerts] = useState([])
  const [hotTier, setHotTier] = useState({ size: 0, capacity: 500 })

  async function loadStatus() {
    try {
      const [a, q] = await Promise.all([
        fetch('/api/admin/bars/audit/latest', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/admin/bars/quarantine/count', { credentials: 'include' }).then(r => r.json()),
      ])
      setReport(a.report)
      setQuarantineCount(q.count)
    } catch (e) {
      setError(String(e))
    }
  }

  async function loadLiveness() {
    try {
      const r = await fetch('/api/admin/bars/liveness', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setLiveness(data.ages || {})
      }
    } catch {}
  }

  async function loadSourceHealth() {
    try {
      const r = await fetch('/api/admin/bars/source-health', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setSourceHealth({
          sources: data.sources || {},
          by_source: data.by_source || {},
        })
      }
    } catch {}
  }

  async function loadQuality() {
    try {
      const r = await fetch('/api/admin/bars/quality', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setQuality(data.scores || {})
      }
    } catch {}
  }

  async function loadAlerts() {
    try {
      const r = await fetch('/api/admin/bars/alerts', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setAlerts(data.alerts || [])
      }
    } catch {}
  }

  async function loadHotTier() {
    try {
      const r = await fetch('/api/admin/bars/hot-tier', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setHotTier(data || { size: 0, capacity: 500 })
      }
    } catch {}
  }

  async function runSmokeAudit() {
    try {
      const r = await fetch('/api/admin/bars/smoke', {
        method: 'POST',
        credentials: 'include',
      })
      if (r.ok) {
        setTimeout(() => { loadStatus(); loadAlerts() }, 3000)
      }
    } catch {}
  }

  async function lookupProvenance(e) {
    e?.preventDefault()
    setProvError(null)
    setProvResult(null)
    if (!provLookup.ticker || !provLookup.barTime) {
      setProvError('Ticker and bar_time required')
      return
    }
    try {
      const params = new URLSearchParams({
        ticker: provLookup.ticker,
        tf: provLookup.tf,
        bar_time: provLookup.barTime,
      })
      const r = await fetch(`/api/admin/bars/provenance?${params}`, { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setProvResult(data.provenance)
      } else {
        setProvError(`HTTP ${r.status}`)
      }
    } catch (e) {
      setProvError(String(e))
    }
  }

  useEffect(() => {
    loadStatus()
    const id = setInterval(loadStatus, 10000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    loadLiveness()
    const id = setInterval(loadLiveness, 5000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    loadSourceHealth()
    const id = setInterval(loadSourceHealth, 10000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    loadQuality()
    loadAlerts()
    loadHotTier()
    const id = setInterval(() => {
      loadQuality()
      loadAlerts()
      loadHotTier()
    }, 30000)
    return () => clearInterval(id)
  }, [])

  async function runAudit(scope = 'priority') {
    setRunning(true)
    setError(null)
    try {
      const body = scope === 'priority'
        ? { tickers: [], tfs: ['5', '30', '60', 'D'], bars_counts: [5000], parallelism: 4, scope: 'priority' }
        : { tickers: [], tfs: ['1', '5', '15', '30', '60', 'D', 'W', 'M'], bars_counts: [5000], parallelism: 4, scope: 'universe' }
      const r = await fetch('/api/admin/bars/audit/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await loadStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Chart Health</h1>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.summary}>
        <div className={styles.metric}>
          <div className={styles.label}>Quarantined bars</div>
          <div className={styles.value}>{quarantineCount ?? '—'}</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.label}>Last audit</div>
          <div className={styles.value}>
            {report ? new Date(report.started_at * 1000).toLocaleString() : 'Never'}
          </div>
        </div>
        <div className={styles.metric}>
          <div className={styles.label}>Issues found (last run)</div>
          <div className={styles.value}>{report ? report.issues_found : '—'}</div>
        </div>
      </div>

      <div className={styles.actions}>
        <button onClick={() => runAudit('priority')} disabled={running}>
          {running ? 'Running…' : 'Run Priority Audit (UCT20 + watchlists)'}
        </button>
        <button onClick={() => runAudit('universe')} disabled={running}>
          {running ? 'Running…' : 'Run Full Universe Audit (3,685 tickers × 8 TFs)'}
        </button>
        <button onClick={runSmokeAudit} disabled={running}>
          Run Smoke Audit (20 tickers)
        </button>
      </div>

      {report && (
        <div className={styles.reportCard}>
          <h2 className={styles.subheading}>Last Audit Report</h2>
          <div className={styles.kv}>
            <div>Tickers scanned</div><div>{report.tickers_scanned}</div>
            <div>Bars scanned</div><div>{report.bars_scanned}</div>
            <div>Issues found</div><div>{report.issues_found}</div>
          </div>
          <h3 className={styles.sectionHeading}>Failure type breakdown</h3>
          <table className={styles.table}>
            <thead><tr><th>Reason</th><th>Count</th></tr></thead>
            <tbody>
              {Object.entries(report.by_failure_type || {})
                .sort((a, b) => b[1] - a[1])
                .map(([reason, n]) => (
                  <tr key={reason}><td>{reason}</td><td>{n}</td></tr>
                ))}
            </tbody>
          </table>
          <h3 className={styles.sectionHeading}>Sample issues (first 50)</h3>
          <table className={styles.table}>
            <thead>
              <tr><th>Ticker</th><th>TF</th><th>Bar time</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {(report.issues || []).slice(0, 50).map((i, idx) => (
                <tr key={idx}>
                  <td>{i.ticker}</td>
                  <td>{i.tf}</td>
                  <td>{i.bar_time ? new Date(i.bar_time * 1000).toISOString() : '—'}</td>
                  <td>{i.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.livenessSection}>
        <h2 className={styles.subheading}>Real-Time Feed Liveness</h2>
        <p className={styles.muted}>Top 50 most-stale subscribed tickers. Red = &gt;60s old (potential stall during RTH).</p>
        {Object.keys(liveness).length === 0 ? (
          <p className={styles.muted}>No tickers subscribed yet.</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Ticker</th><th>Last Tick (s ago)</th></tr></thead>
            <tbody>
              {Object.entries(liveness)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 50)
                .map(([sym, age]) => (
                  <tr key={sym} className={age > 60 ? styles.staleRow : undefined}>
                    <td>{sym}</td>
                    <td>{age}s</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.livenessSection}>
        <h2 className={styles.subheading}>Source Health</h2>
        <p className={styles.muted}>Per-source pass rate (1hr rolling). Below 95% with 20+ attempts → degraded.</p>
        {Object.keys(sourceHealth.sources).length === 0 ? (
          <p className={styles.muted}>No source attempts recorded yet.</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Source</th><th>State</th><th>Attempts</th><th>Pass Rate</th><th>Bars Cached</th></tr></thead>
            <tbody>
              {Object.entries(sourceHealth.sources).map(([source, info]) => (
                <tr key={source} className={info.state === 'degraded' ? styles.staleRow : undefined}>
                  <td>{source}</td>
                  <td>{info.state}</td>
                  <td>{info.attempts}</td>
                  <td>{(info.pass_rate * 100).toFixed(1)}%</td>
                  <td>{sourceHealth.by_source[source] || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.livenessSection}>
        <h2 className={styles.subheading}>Provenance Lookup</h2>
        <p className={styles.muted}>Find the source that produced a specific cached bar.</p>
        <form onSubmit={lookupProvenance} className={styles.provForm}>
          <input
            type="text"
            placeholder="Ticker"
            value={provLookup.ticker}
            onChange={e => setProvLookup({...provLookup, ticker: e.target.value.toUpperCase()})}
          />
          <select value={provLookup.tf} onChange={e => setProvLookup({...provLookup, tf: e.target.value})}>
            <option value="1">1m</option>
            <option value="5">5m</option>
            <option value="15">15m</option>
            <option value="30">30m</option>
            <option value="60">1h</option>
            <option value="D">D</option>
            <option value="W">W</option>
            <option value="M">M</option>
          </select>
          <input
            type="number"
            placeholder="Bar time (epoch s)"
            value={provLookup.barTime}
            onChange={e => setProvLookup({...provLookup, barTime: e.target.value})}
          />
          <button type="submit">Lookup</button>
        </form>
        {provError && <p className={styles.error}>{provError}</p>}
        {provResult === null && !provError && <p className={styles.muted}>No record yet.</p>}
        {provResult && (
          <div className={styles.kv}>
            <div>Source</div><div>{provResult.source}</div>
            <div>Validated at</div><div>{new Date(provResult.validated_at * 1000).toLocaleString()}</div>
            <div>Verified at</div><div>{provResult.verified_at ? new Date(provResult.verified_at * 1000).toLocaleString() : 'not yet reconciled'}</div>
          </div>
        )}
      </div>

      {/* Quality Heatmap */}
      <div className={styles.livenessSection}>
        <h2 className={styles.subheading}>Per-Ticker Quality Score</h2>
        <p className={styles.muted}>0-100 composite. Red = &lt;50, Amber = 50-69, Olive = 70-89, Green = 90+.</p>
        {Object.keys(quality).length === 0 ? (
          <p className={styles.muted}>No quality data yet — run an audit to populate.</p>
        ) : (
          <div className={styles.heatmap}>
            {Object.entries(quality).sort((a, b) => a[1] - b[1]).map(([sym, score]) => (
              <div key={sym} className={styles.qualityCell} style={{
                background: score >= 90 ? '#1d6f3f'
                          : score >= 70 ? '#7a6614'
                          : score >= 50 ? '#8b3a16'
                          : '#5a1414',
              }}>
                <div>{sym}</div>
                <div className={styles.qualityScore}>{score}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alerts Feed */}
      <div className={styles.livenessSection}>
        <h2 className={styles.subheading}>Recent Alerts</h2>
        <p className={styles.muted}>In-memory queue of operator alerts (10min throttle per key).</p>
        {alerts.length === 0 ? (
          <p className={styles.muted}>No alerts.</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Time</th><th>Severity</th><th>Key</th><th>Message</th></tr></thead>
            <tbody>
              {alerts.slice(0, 25).map((a, idx) => (
                <tr key={idx} className={a.severity === 'warning' || a.severity === 'error' ? styles.staleRow : undefined}>
                  <td>{new Date(a.emitted_at * 1000).toLocaleString()}</td>
                  <td>{a.severity}</td>
                  <td>{a.alert_key}</td>
                  <td>{a.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Hot Tier Status */}
      <div className={styles.livenessSection}>
        <h2 className={styles.subheading}>Hot Tier Cache</h2>
        <p className={styles.muted}>Top-priority tickers served from RAM (LRU, capacity 500).</p>
        <div className={styles.kv}>
          <div>Size</div><div>{hotTier.size}</div>
          <div>Capacity</div><div>{hotTier.capacity}</div>
          <div>Utilization</div><div>{((hotTier.size / hotTier.capacity) * 100).toFixed(0)}%</div>
        </div>
      </div>
    </div>
  )
}
