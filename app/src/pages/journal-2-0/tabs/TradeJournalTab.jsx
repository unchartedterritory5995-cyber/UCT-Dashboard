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
import { summaryStats } from '../../../lib/journal-2-0'
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

export default function TradeJournalTab({ settings }) {
  const { trades, isLoading, error, refresh } = useJ2Trades()
  const { mutate } = useSWRConfig()

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

  const filteredTrades = useMemo(
    () => applyFilters(trades, filters),
    [trades, filters],
  )

  const summary = useMemo(() => summaryStats(filteredTrades), [filteredTrades])

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
    const res = await jsonFetch('/api/j2/trades', 'POST', payload)
    await refresh()
    showToast(
      `Added ${res.symbol} ${res.side.toLowerCase()} — ${res.result} (${res.shares} shares)`,
      'success',
    )
  }, [refresh, showToast])

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

  return (
    <div className={styles.wrap}>
      <StatsGrid summary={summary} />

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
              ☰ Filters ▾
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
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => setDeleteAllOpen(true)}
            disabled={trades.length === 0}
            title={trades.length === 0 ? 'No trades to delete' : 'Delete all trades'}
          >
            🗑 Delete All
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => setImportOpen(true)}
          >
            ⬆ Import CSV
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setAddOpen(true)}
          >
            + Add Trade
          </button>
        </div>
      </div>

      {isLoading && trades.length === 0 ? (
        <div className={styles.loading}>Loading trades…</div>
      ) : (
        <TradesTable trades={filteredTrades} visibleColumns={visibleColumns} />
      )}

      {addOpen && (
        <AddTradeModal
          settings={settings}
          onSave={handleAdd}
          onClose={() => setAddOpen(false)}
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
    </div>
  )
}
