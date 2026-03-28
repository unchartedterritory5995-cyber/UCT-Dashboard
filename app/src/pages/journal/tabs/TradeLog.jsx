// app/src/pages/journal/tabs/TradeLog.jsx
import { useState, useCallback, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import StatCard from '../components/StatCard'
import FilterBar from '../components/FilterBar'
import ImportWizard from '../components/ImportWizard'
import styles from './TradeLog.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const EMPTY_FILTERS = {
  date_from: '', date_to: '', symbol: '', direction: '',
  setup: '', status: '', review_status: '',
  has_screenshots: false, has_notes: false,
}

const PAGE_SIZE = 50

const SORTABLE_COLS = {
  entry_date: 'Date',
  sym: 'Symbol',
  direction: 'Dir',
  setup: 'Setup',
  entry_price: 'Entry',
  exit_price: 'Exit',
  stop_price: 'Stop',
  realized_r: 'R',
  pnl_pct: 'P&L%',
  pnl_dollar: 'P&L$',
  process_score: 'Process',
  review_status: 'Review',
}

const REVIEW_COLORS = {
  draft: { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)', border: 'var(--border)' },
  logged: { bg: 'rgba(107,163,190,0.12)', color: 'var(--info)', border: 'var(--info-border)' },
  partial: { bg: 'var(--warn-bg)', color: 'var(--warn)', border: 'var(--warn-border)' },
  reviewed: { bg: 'var(--gain-bg)', color: 'var(--gain)', border: 'var(--gain-border)' },
  flagged: { bg: 'var(--loss-bg)', color: 'var(--loss)', border: 'var(--loss-border)' },
  follow_up: { bg: 'var(--warn-bg)', color: 'var(--ut-gold)', border: 'var(--warn-border)' },
}

function ReviewPill({ status }) {
  const style = REVIEW_COLORS[status] || REVIEW_COLORS.draft
  const label = status === 'follow_up' ? 'FOLLOW-UP' : (status || 'DRAFT').toUpperCase()
  return (
    <span
      className={styles.reviewPill}
      style={{ background: style.bg, color: style.color, borderColor: style.border }}
    >
      {label}
    </span>
  )
}

export default function TradeLog({ onOpenTrade, stats, onStatsChange, initialFilter }) {
  const [filters, setFilters] = useState(() => initialFilter ? { ...EMPTY_FILTERS, ...initialFilter } : EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [sortBy, setSortBy] = useState('entry_date')
  const [sortDir, setSortDir] = useState('desc')
  const [showImport, setShowImport] = useState(false)

  // Apply initialFilter when it changes (from Overview shortcuts)
  useEffect(() => {
    if (initialFilter && Object.keys(initialFilter).length > 0) {
      setFilters(prev => ({ ...prev, ...initialFilter }))
      setPage(0)
    }
  }, [initialFilter])

  // Build query string from filters
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    params.set('limit', PAGE_SIZE)
    params.set('offset', page * PAGE_SIZE)
    params.set('sort_by', sortBy)
    params.set('sort_dir', sortDir)
    if (filters.date_from) params.set('date_from', filters.date_from)
    if (filters.date_to) params.set('date_to', filters.date_to)
    if (filters.symbol) params.set('symbol', filters.symbol)
    if (filters.direction) params.set('direction', filters.direction)
    if (filters.setup) params.set('setup', filters.setup)
    if (filters.status) params.set('status', filters.status)
    if (filters.review_status) params.set('review_status', filters.review_status)
    if (filters.has_screenshots === true || filters.has_screenshots === 'true') params.set('has_screenshots', 'true')
    else if (filters.has_screenshots === 'false') params.set('has_screenshots', 'false')
    if (filters.has_notes === true || filters.has_notes === 'true') params.set('has_notes', 'true')
    else if (filters.has_notes === 'false') params.set('has_notes', 'false')
    return params.toString()
  }, [filters, page, sortBy, sortDir])

  const { data, error, isLoading } = useSWR(
    `/api/journal?${queryString}`,
    fetcher,
    { refreshInterval: 60000, dedupingInterval: 15000, revalidateOnFocus: false }
  )

  const trades = data?.trades || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleSort = useCallback((col) => {
    if (sortBy === col) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
    setPage(0)
  }, [sortBy])

  const handleFiltersChange = useCallback((newFilters) => {
    setFilters(newFilters)
    setPage(0)
  }, [])

  function fmtPrice(v) {
    if (v == null) return '--'
    return `$${Number(v).toFixed(2)}`
  }

  function fmtR(v) {
    if (v == null) return '--'
    return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}R`
  }

  function fmtPnl(v) {
    if (v == null) return '--'
    return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`
  }

  function fmtDollar(v) {
    if (v == null) return '--'
    const sign = v >= 0 ? '+' : ''
    return `${sign}$${Math.abs(v).toFixed(0)}`
  }

  function sortIndicator(col) {
    if (sortBy !== col) return ''
    return sortDir === 'desc' ? ' \u25BE' : ' \u25B4'
  }

  return (
    <div className={styles.wrap}>
      {/* Stats strip */}
      {stats && (
        <div className={styles.statsStrip}>
          <StatCard label="Net P&L" value={stats.total_pnl_pct} format="pct" accent="auto" />
          <StatCard label="Win Rate" value={stats.win_rate} format="pct" accent="neutral" />
          <StatCard label="Avg R" value={stats.avg_r} format="r" accent="auto" />
          <StatCard label="Profit Factor" value={stats.profit_factor} format="ratio" accent="neutral" />
          <StatCard label="Expectancy" value={stats.expectancy} format="pct" accent="auto" />
          <StatCard label="Process" value={stats.avg_process_score} format="score" accent="neutral" suffix="/100" />
        </div>
      )}

      {/* Filter bar + Import button */}
      <div className={styles.filterRow}>
        <FilterBar filters={filters} onChange={handleFiltersChange} />
        <button
          className={styles.importBtn}
          onClick={() => setShowImport(true)}
        >
          Import Trades from Broker
        </button>
      </div>

      {/* Import wizard modal */}
      {showImport && (
        <ImportWizard
          onClose={() => setShowImport(false)}
          onComplete={() => {
            if (onStatsChange) onStatsChange()
          }}
        />
      )}

      {/* Table */}
      {isLoading && !data ? (
        <div className={styles.loading}>
          <div className={styles.loadingBar} />
          <span>Loading trades...</span>
        </div>
      ) : error ? (
        <div className={styles.error}>
          <span className={styles.errorIcon}>!</span>
          Failed to load trades. Check your connection.
        </div>
      ) : trades.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>&#x25CB;</div>
          <div className={styles.emptyTitle}>No trades found</div>
          <div className={styles.emptyText}>
            {Object.values(filters).some(v => v)
              ? 'Try adjusting your filters or clearing them.'
              : 'Click "+ New Trade" to log your first trade.'}
          </div>
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {Object.entries(SORTABLE_COLS).map(([key, label]) => (
                    <th
                      key={key}
                      className={`${styles.th} ${sortBy === key ? styles.thActive : ''}`}
                      onClick={() => handleSort(key)}
                    >
                      {label}{sortIndicator(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map(trade => (
                  <tr
                    key={trade.id}
                    className={styles.row}
                    onClick={() => onOpenTrade(trade.id)}
                  >
                    <td className={styles.dateCell}>{trade.entry_date || '--'}</td>
                    <td className={styles.symCell}>{trade.sym || '--'}</td>
                    <td>
                      <span className={trade.direction === 'short' ? styles.shortBadge : styles.longBadge}>
                        {(trade.direction || 'long').toUpperCase()}
                      </span>
                    </td>
                    <td className={styles.setupCell}>{trade.setup || '--'}</td>
                    <td className={styles.numCell}>{fmtPrice(trade.entry_price)}</td>
                    <td className={styles.numCell}>{fmtPrice(trade.exit_price)}</td>
                    <td className={styles.stopCell}>{fmtPrice(trade.stop_price)}</td>
                    <td className={styles.rCell}>
                      {trade.realized_r != null ? (
                        <span className={trade.realized_r >= 0 ? styles.pnlGain : styles.pnlLoss}>
                          {fmtR(trade.realized_r)}
                        </span>
                      ) : '--'}
                    </td>
                    <td>
                      {trade.pnl_pct != null ? (
                        <span className={trade.pnl_pct >= 0 ? styles.pnlGain : styles.pnlLoss}>
                          {fmtPnl(trade.pnl_pct)}
                        </span>
                      ) : '--'}
                    </td>
                    <td>
                      {trade.pnl_dollar != null ? (
                        <span className={trade.pnl_dollar >= 0 ? styles.pnlGain : styles.pnlLoss}>
                          {fmtDollar(trade.pnl_dollar)}
                        </span>
                      ) : '--'}
                    </td>
                    <td className={styles.processCell}>
                      {trade.process_score != null ? (
                        <span className={
                          trade.process_score >= 61 ? styles.processGood :
                          trade.process_score >= 31 ? styles.processOk :
                          styles.processBad
                        }>
                          {trade.process_score}
                        </span>
                      ) : '--'}
                    </td>
                    <td><ReviewPill status={trade.review_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className={styles.pagination}>
            <span className={styles.pageInfo}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className={styles.pageButtons}>
              <button
                className={styles.pageBtn}
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
              >
                Prev
              </button>
              <span className={styles.pageNum}>{page + 1}/{totalPages}</span>
              <button
                className={styles.pageBtn}
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
