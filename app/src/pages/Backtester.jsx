import { useEffect, useState } from 'react'
import StrategyForm from './backtester/StrategyForm'
import BacktestResults from './backtester/BacktestResults'
import styles from './Backtester.module.css'

export default function Backtester() {
  const [strategies, setStrategies] = useState([])
  const [loadingStrategies, setLoadingStrategies] = useState(true)
  const [strategiesError, setStrategiesError] = useState(null)

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [hasRun, setHasRun] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/backtest/strategies', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setStrategies(Array.isArray(data?.strategies) ? data.strategies : [])
        setLoadingStrategies(false)
      })
      .catch(err => {
        if (cancelled) return
        setStrategiesError(err?.message || 'Failed to load strategies')
        setLoadingStrategies(false)
      })
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (payload) => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let msg = `Request failed (HTTP ${res.status})`
        try {
          const body = await res.json()
          if (res.status === 404) {
            msg = `No bars for ${payload.sym} ${payload.tf} — try a different symbol`
          } else if (body?.detail) {
            msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
          }
        } catch {
          /* non-JSON body */
        }
        setError(msg)
        setResult(null)
      } else {
        const data = await res.json()
        setResult(data)
      }
    } catch (err) {
      setError(err?.message || 'Network error')
      setResult(null)
    } finally {
      setRunning(false)
      setHasRun(true)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Backtester</h1>
        <div className={styles.tagline}>Simulate strategies on historical data.</div>
      </div>

      <div className={styles.layout}>
        <aside className={styles.formCol}>
          {strategiesError ? (
            <div className={styles.errorBox}>
              Couldn’t load strategies: {strategiesError}
            </div>
          ) : (
            <StrategyForm
              strategies={strategies}
              loadingStrategies={loadingStrategies}
              onSubmit={handleSubmit}
              running={running}
            />
          )}
        </aside>

        <section className={styles.resultsCol}>
          <BacktestResults
            result={result}
            loading={running}
            error={error}
            hasRun={hasRun}
          />
        </section>
      </div>
    </div>
  )
}
