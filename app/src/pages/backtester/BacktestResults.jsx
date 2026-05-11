import { useEffect, useRef } from 'react'
import { mountEquityChart } from './equityChart'
import styles from '../Backtester.module.css'

function fmtNum(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—'
  return Number(v).toFixed(digits)
}

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return '—'
  const s = v >= 0 ? '+' : ''
  return `${s}${Number(v).toFixed(2)}%`
}

function fmtCurrency(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(unix) {
  if (!unix && unix !== 0) return '—'
  try {
    return new Date(unix * 1000).toLocaleDateString()
  } catch {
    return '—'
  }
}

function pnlClass(v) {
  if (v == null || Number.isNaN(v)) return ''
  return v > 0 ? styles.gainPos : styles.gainNeg
}

const STAT_DEFS = [
  { key: 'n_trades',         label: 'Trades',          fmt: v => v ?? '—' },
  { key: 'win_rate',         label: 'Win Rate',        fmt: v => v == null ? '—' : `${fmtNum(v)}%`, color: v => v == null ? '' : (v >= 50 ? styles.gainPos : styles.gainNeg) },
  { key: 'profit_factor',    label: 'Profit Factor',   fmt: v => fmtNum(v), color: v => v == null ? '' : (v >= 1 ? styles.gainPos : styles.gainNeg) },
  { key: 'avg_pnl_pct',      label: 'Avg P&L',         fmt: fmtPct, color: v => v == null ? '' : (v >= 0 ? styles.gainPos : styles.gainNeg) },
  { key: 'avg_win_pct',      label: 'Avg Win',         fmt: fmtPct, color: () => styles.gainPos },
  { key: 'avg_loss_pct',     label: 'Avg Loss',        fmt: fmtPct, color: () => styles.gainNeg },
  { key: 'best_trade_pct',   label: 'Best Trade',      fmt: fmtPct, color: () => styles.gainPos },
  { key: 'worst_trade_pct',  label: 'Worst Trade',     fmt: fmtPct, color: () => styles.gainNeg },
  { key: 'max_drawdown_pct', label: 'Max Drawdown',    fmt: v => v == null ? '—' : `${fmtNum(v)}%`, color: () => styles.gainNeg },
  { key: 'sharpe',           label: 'Sharpe',          fmt: v => fmtNum(v) },
]

export default function BacktestResults({ result, loading, error, hasRun }) {
  const chartContainerRef = useRef(null)
  const chartHandleRef = useRef(null)

  // Mount / remount chart whenever the equity_curve changes
  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return
    // Tear down any previous chart
    if (chartHandleRef.current) {
      chartHandleRef.current.destroy()
      chartHandleRef.current = null
    }
    const curve = result?.equity_curve
    if (!curve || curve.length === 0) return
    const initialCapital = curve[0]?.equity ?? 0
    chartHandleRef.current = mountEquityChart(container, curve, initialCapital)
    return () => {
      if (chartHandleRef.current) {
        chartHandleRef.current.destroy()
        chartHandleRef.current = null
      }
    }
  }, [result])

  if (loading) {
    return <div className={styles.placeholder}>Running backtest…</div>
  }

  if (error) {
    return <div className={styles.errorBox}>{error}</div>
  }

  if (!hasRun || !result) {
    return (
      <div className={styles.placeholder}>
        Configure a strategy on the left and click <strong>Run Backtest</strong> to see results.
      </div>
    )
  }

  const stats = result.stats || {}
  const trades = result.trades || []
  const finalEquity = result.final_equity
  const totalReturn = result.total_return_pct

  return (
    <div className={styles.resultsWrap}>
      <div className={styles.resultsHeader}>
        <div className={styles.resultsTitle}>
          {result.strategy} · {result.sym} · {result.tf}
        </div>
        <div className={styles.resultsSummary}>
          <span className={styles.summaryLabel}>Final Equity</span>
          <span className={styles.summaryValue}>{fmtCurrency(finalEquity)}</span>
          <span className={`${styles.summaryReturn} ${totalReturn >= 0 ? styles.gainPos : styles.gainNeg}`}>
            {fmtPct(totalReturn)}
          </span>
        </div>
      </div>

      <div className={styles.statsGrid}>
        {STAT_DEFS.map(def => {
          const val = stats[def.key]
          const cls = def.color ? def.color(val) : ''
          return (
            <div key={def.key} className={styles.statCard}>
              <div className={styles.statLabel}>{def.label}</div>
              <div className={`${styles.statValue} ${cls}`}>{def.fmt(val)}</div>
            </div>
          )
        })}
      </div>

      <div className={styles.chartSection}>
        <div className={styles.sectionTitle}>Equity Curve</div>
        <div ref={chartContainerRef} className={styles.chartContainer} />
        <div className={styles.metaRow}>
          <span>Signals: {result.n_signals ?? '—'}</span>
          <span>Bars: {result.n_bars ?? '—'}</span>
        </div>
      </div>

      <div className={styles.tradesSection}>
        <div className={styles.sectionTitle}>Trades ({trades.length})</div>
        {trades.length === 0 ? (
          <div className={styles.emptyTrades}>
            No trades — strategy generated no signals on this data.
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tradesTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entry Date</th>
                  <th>Exit Date</th>
                  <th>Side</th>
                  <th>Entry $</th>
                  <th>Exit $</th>
                  <th>Shares</th>
                  <th>P&L $</th>
                  <th>P&L %</th>
                  <th>Reason Exit</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{fmtDate(t.entry_t)}</td>
                    <td>{fmtDate(t.exit_t)}</td>
                    <td>{t.side || '—'}</td>
                    <td>{fmtNum(t.entry_price)}</td>
                    <td>{fmtNum(t.exit_price)}</td>
                    <td>{t.shares ?? '—'}</td>
                    <td className={pnlClass(t.pnl_$)}>{fmtCurrency(t.pnl_$)}</td>
                    <td className={pnlClass(t.pnl_pct)}>{fmtPct(t.pnl_pct)}</td>
                    <td className={styles.reasonCell}>{t.reason_exit || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
