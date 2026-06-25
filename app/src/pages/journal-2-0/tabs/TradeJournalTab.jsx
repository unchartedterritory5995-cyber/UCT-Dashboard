/**
 * Trade Journal tab — Journal 2.0.
 * Spec §11.
 *
 * Stats grid (6×2) + toolbar + trades table + columns picker.
 * `+ Add Trade` and `Delete All` are live; `☰ Filters` opens in Phase 6;
 * `Import CSV` opens in Phase 7.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { useHotkeys } from 'react-hotkeys-hook'
import useJ2Trades from '../hooks/useJ2Trades'
import useJ2OptionStrategies from '../hooks/useJ2OptionStrategies'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useReviewedTradeIds from '../hooks/useReviewedTradeIds'
import TradeDrawer from '../components/TradeDrawer'
import useJ2ColumnPrefs from '../hooks/useJ2ColumnPrefs'
import useJ2Filters from '../hooks/useJ2Filters'
import { applyFilters } from '../hooks/useJ2Filters'
import StatsGrid from '../components/StatsGrid'
import TradesTable, { buildTradesColumns } from '../components/TradesTable'
import ColumnsPicker from '../components/ColumnsPicker'
import FiltersPanel from '../components/FiltersPanel'
import AddTradeModal from '../components/AddTradeModal'
import DeleteAllModal from '../components/DeleteAllModal'
import ImportCsvModal from '../components/ImportCsvModal'
import Toast from '../components/Toast'
import BrokerImportingBanner from '../components/BrokerImportingBanner'
import useBrokerWarming from '../hooks/useBrokerWarming'
import { summaryStats } from '../../../lib/journal-2-0'
import UIcon from '../../../components/ui/UIcon'
import styles from './TradeJournalTab.module.css'

const COLUMN_STORAGE_KEY = 'uct.j2.tradeJournal.columns'

async function jsonFetch(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) msg = data.detail
    } catch { /* non-JSON body */ }
    throw new Error(msg)
  }
  return res.json()
}

// Normalize a CLOSED option strategy into a trade-table row so options sit in
// the same closed-trades table as shares (Symbol "CRWV Oct 16 $110C", Side
// "Long Call"). Field shape matches TradesTable/summaryStats/applyFilters
// exactly (pnlPercent is a fraction, like share trades), so no table changes.
function optionClosedToRow(s) {
  const leg = (s.legs && s.legs[0]) || {}
  const isLong = s.strategyType === 'long_call' || s.strategyType === 'long_put'
  const isCall = (s.strategyType || '').endsWith('call')
  let when = ''
  if (leg.expiration) {
    const d = new Date(`${leg.expiration}T00:00:00`)
    if (!Number.isNaN(d.getTime())) {
      when = `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`
    }
  }
  let holdDays = null
  if (s.entryDate && s.closedAt) {
    const dd = (new Date(s.closedAt) - new Date(s.entryDate)) / 86_400_000
    if (Number.isFinite(dd)) holdDays = Math.max(0, Math.round(dd))
  }
  return {
    id: s.id,
    isOption: true,
    symbol: `${s.underlying}${when ? ` ${when}` : ''} $${leg.strike}${isCall ? 'C' : 'P'}`,
    side: `${isLong ? 'Long' : 'Short'} ${isCall ? 'Call' : 'Put'}`,
    result: s.result,
    shares: leg.qty,                          // contracts
    entryPrice: leg.entryPrice,               // premium per contract
    entryDate: s.entryDate,
    exitPrice: leg.exitPrice,                 // exit premium per contract
    exitDate: s.closedAt,
    pnlDollar: s.pnlDollar,
    pnlDollarNet: s.pnlDollar,                // options P&L is already net of fees
    fees: (s.fees || 0) + (s.exitFees || 0),
    pnlPercent: s.pnlPercent,                 // fraction (same as share trades)
    rMultiple: s.rMultiple,
    holdDays,
    setup: s.setup,
    originalStop: null,
    source: s.source,
  }
}

export default function TradeJournalTab({ settings }) {
  const { trades, isLoading, error, refresh, mutate: mutateTrades } = useJ2Trades()
  const {
    strategies: closedStrategies,
    isLoading: stratLoading,
    error: stratError,
  } = useJ2OptionStrategies({ status: 'closed' })
  const { accountId: selectedAccountId, accounts } = useJ2SelectedAccount()
  const { mutate } = useSWRConfig()
  const { reviewedIds } = useReviewedTradeIds(selectedAccountId)
  const { warming, broker: warmingBroker } = useBrokerWarming()

  const tradingMode = settings?.tradingMode ?? 'both'
  const showShares = tradingMode !== 'options'
  const showOptions = tradingMode !== 'shares'

  const defaultColumns = useMemo(() => buildTradesColumns(), [])

  const {
    columns,
    visibleColumns,
    hiddenKeys,
    toggleColumn,
    reorderColumns,
    resetColumns,
  } = useJ2ColumnPrefs(COLUMN_STORAGE_KEY, defaultColumns)

  const { filters, setFilter, toggleSetMember, resetFilters, activeCount } =
    useJ2Filters()

  // Closed shares + closed option strategies (as rows) in one unified list.
  const allClosed = useMemo(
    () => [
      ...(showShares ? trades : []),
      ...(showOptions ? closedStrategies.map(optionClosedToRow) : []),
    ],
    [showShares, showOptions, trades, closedStrategies],
  )

  const filteredTrades = useMemo(
    () => applyFilters(allClosed, filters),
    [allClosed, filters],
  )

  const summary = useMemo(() => summaryStats(filteredTrades), [filteredTrades])

  // Trade detail drawer
  const [drawerTrade, setDrawerTrade] = useState(null)

  // Toolbar modals
  const [addOpen, setAddOpen] = useState(false)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const pickerBtnRef = useRef(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const filtersBtnRef = useRef(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [toast, setToast] = useState(null)

  // Tab-scoped shortcuts. '/' focuses the Symbol filter input — opens
  // the filters panel first if needed.
  useHotkeys('t', () => setAddOpen(true))
  useHotkeys('f', () => setFiltersOpen((x) => !x))
  useHotkeys('c', () => setPickerOpen((x) => !x))
  useHotkeys(
    '/',
    (e) => {
      e.preventDefault()
      setFiltersOpen(true)
      // Defer focusing until the panel mounts
      setTimeout(() => {
        const el = document.querySelector('input[aria-label="Symbol starts-with filter"]')
        if (el) el.focus()
      }, 60)
    },
  )

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ message, tone })
  }, [])

  const handleAdd = useCallback(async (payload) => {
    const acctId = payload.accountId
      || selectedAccountId
      || accounts[0]?.id
      || null
    const res = await jsonFetch('/api/j2/trades', 'POST', { ...payload, accountId: acctId })
    await refresh()
    const acctName = accounts.find((a) => a.id === acctId)?.name
    showToast(
      `Added ${res.symbol} ${res.side.toLowerCase()} — ${res.result}${acctName ? ` (${acctName})` : ''}`,
      'success',
    )
  }, [refresh, showToast, selectedAccountId, accounts])

  // Inline setup tagging from the table (equity trades only — option rows are
  // backed by a strategy id, not a j2_trades row). Optimistic + reconciled.
  const handleUpdateSetup = useCallback(async (trade, setup) => {
    mutateTrades(
      (cur) => (cur
        ? { ...cur, trades: cur.trades.map((t) => (t.id === trade.id ? { ...t, setup } : t)) }
        : cur),
      { revalidate: false },
    )
    try {
      const updated = await jsonFetch(`/api/j2/trades/${trade.id}`, 'PATCH', { setup })
      mutateTrades(
        (cur) => (cur
          ? { ...cur, trades: cur.trades.map((t) => (t.id === trade.id ? updated : t)) }
          : cur),
        { revalidate: false },
      )
      // Setup attribution feeds the Analytics tab — let it recompute.
      mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/analytics'))
      showToast(
        setup ? `Tagged ${trade.symbol} → ${setup}` : `Cleared setup on ${trade.symbol}`,
        'success',
      )
    } catch (e) {
      refresh()  // roll back to server truth
      showToast(`Couldn't update setup: ${String(e.message || e)}`, 'error')
    }
  }, [mutateTrades, mutate, refresh, showToast])

  const handleDeleteAll = useCallback(async () => {
    const res = await jsonFetch('/api/j2/trades', 'DELETE', { confirm: 'DELETE' })
    await refresh()
    // Also invalidate any positions cache just in case future Phase 6 filter
    // relies on shared data.
    await mutate('/api/j2/positions')
    showToast(`Deleted ${res.deleted} trade${res.deleted === 1 ? '' : 's'}.`, 'success')
  }, [refresh, mutate, showToast])

  if (error) {
    return (
      <div className={styles.errorBanner} role="alert">
        Failed to load trades: {String(error.message || error)}
      </div>
    )
  }

  const applyPeriod = (preset) => {
    const now = new Date()
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth()
    const d = now.getUTCDate()
    const iso = (dt) => dt.toISOString().slice(0, 10)
    let from = ''
    let to = iso(now)
    switch (preset) {
      case 'today': from = iso(now); break
      case 'week': {
        const dow = now.getUTCDay()
        from = iso(new Date(Date.UTC(y, m, d - ((dow + 6) % 7))))
        break
      }
      case 'month': from = `${y}-${String(m + 1).padStart(2, '0')}-01`; break
      case 'ytd':   from = `${y}-01-01`; break
      case 'all':   from = ''; to = ''; break
    }
    setFilter('dateFrom', from)
    setFilter('dateTo', to)
  }

  const activePeriod = (() => {
    const now = new Date()
    const iso = (dt) => dt.toISOString().slice(0, 10)
    const today = iso(now)
    const f = filters.dateFrom, t = filters.dateTo
    if (!f && !t) return 'all'
    if (f === today && t === today) return 'today'
    const y = now.getUTCFullYear()
    if (f === `${y}-01-01` && t === today) return 'ytd'
    const m = now.getUTCMonth()
    if (f === `${y}-${String(m + 1).padStart(2, '0')}-01` && t === today) return 'month'
    return null
  })()

  return (
    <div className={styles.wrap}>
      {warming && <BrokerImportingBanner broker={warmingBroker} />}
      <StatsGrid summary={summary} />

      <div className={styles.periodRow}>
        <span className={styles.periodLabel}>Period</span>
        <div className={styles.periodPills}>
          {[
            ['today', 'Today'],
            ['week', 'Week'],
            ['month', 'Month'],
            ['ytd', 'YTD'],
            ['all', 'All'],
          ].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              className={`${styles.periodPill} ${activePeriod === k ? styles.periodPillActive : ''}`}
              onClick={() => applyPeriod(k)}
            >
              {lbl}
            </button>
          ))}
        </div>
        <span className={styles.periodCount}>
          {filteredTrades.length} trade{filteredTrades.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.filtersWrap}>
            <button
              ref={filtersBtnRef}
              type="button"
              className={styles.ghostBtn}
              onClick={() => setFiltersOpen((x) => !x)}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
            >
              <UIcon name="menu" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Filters ▾
              {activeCount > 0 && (
                <span className={styles.activeBadge}>{activeCount}</span>
              )}
            </button>
            <FiltersPanel
              open={filtersOpen}
              anchorRef={filtersBtnRef}
              filters={filters}
              setFilter={setFilter}
              toggleSetMember={toggleSetMember}
              resetFilters={resetFilters}
              activeCount={activeCount}
              settings={settings}
              trades={trades}
              onClose={() => setFiltersOpen(false)}
            />
          </div>
          {activeCount > 0 && trades.length !== filteredTrades.length && (
            <span className={styles.filterCount}>
              {filteredTrades.length} of {trades.length}
            </span>
          )}
        </div>
        <div className={styles.toolbarRight}>
          <div className={styles.pickerWrap}>
            <button
              ref={pickerBtnRef}
              type="button"
              className={styles.ghostBtn}
              onClick={() => setPickerOpen((x) => !x)}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
            >
              ▦ Columns
            </button>
            <ColumnsPicker
              open={pickerOpen}
              anchorRef={pickerBtnRef}
              columns={columns}
              hiddenKeys={hiddenKeys}
              onToggle={toggleColumn}
              onReorder={reorderColumns}
              onReset={resetColumns}
              onClose={() => setPickerOpen(false)}
            />
          </div>
          {showShares && (
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={() => setDeleteAllOpen(true)}
              disabled={trades.length === 0}
              title={trades.length === 0 ? 'No trades to delete' : 'Delete all trades'}
            >
              <UIcon name="trash" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Delete All
            </button>
          )}
          {showShares && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => setImportOpen(true)}
            >
              <UIcon name="plus" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Import CSV
            </button>
          )}
          {showShares && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setAddOpen(true)}
            >
              + Add Trade
            </button>
          )}
        </div>
      </div>

      {(showShares || showOptions) && (
        (isLoading || stratLoading) && filteredTrades.length === 0 ? (
          <div className={styles.loading}>Loading trades…</div>
        ) : (
          <TradesTable
            trades={filteredTrades}
            visibleColumns={visibleColumns}
            reviewedIds={reviewedIds}
            setups={settings?.setups || []}
            onUpdateSetup={handleUpdateSetup}
            onRowAction={(action, trade) => {
              // Option rows have no trade drawer (yet) — only shares open it.
              if (action === 'open' && !trade.isOption) setDrawerTrade(trade)
            }}
          />
        )
      )}


      {addOpen && (
        <AddTradeModal
          settings={settings}
          onSave={handleAdd}
          onClose={() => setAddOpen(false)}
          accountName={accounts.find((a) => a.id === selectedAccountId)?.name || accounts[0]?.name}
        />
      )}
      {deleteAllOpen && (
        <DeleteAllModal
          tradeCount={trades.length}
          onConfirm={handleDeleteAll}
          onClose={() => setDeleteAllOpen(false)}
        />
      )}
      {importOpen && (
        <ImportCsvModal
          onConfirmed={(imported, skipped) => {
            refresh()
            showToast(
              skipped > 0
                ? `Imported ${imported} trade${imported === 1 ? '' : 's'} (${skipped} skipped)`
                : `Imported ${imported} trade${imported === 1 ? '' : 's'}`,
              'success',
            )
          }}
          onClose={() => setImportOpen(false)}
        />
      )}

      <Toast
        message={toast?.message}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />

      <TradeDrawer
        trade={drawerTrade}
        accountId={selectedAccountId}
        onClose={() => setDrawerTrade(null)}
      />
    </div>
  )
}
