import { useEffect, useState } from 'react'
import styles from './ChartHealth.module.css'

export default function ChartHealth() {
  const [report, setReport] = useState(null)
  const [quarantineCount, setQuarantineCount] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

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

  useEffect(() => {
    loadStatus()
    const id = setInterval(loadStatus, 10000)
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
    </div>
  )
}
