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
import useJ2Trades from '../hooks/useJ2Trades'
import useJ2ColumnPrefs from '../hooks/useJ2ColumnPrefs'
import StatsGrid from '../components/StatsGrid'
import TradesTable, { buildTradesColumns } from '../components/TradesTable'
import ColumnsPicker from '../components/ColumnsPicker'
import AddTradeModal from '../components/AddTradeModal'
import DeleteAllModal from '../components/DeleteAllModal'
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

  // Build columns with the live breadth metric label so settings changes
  // flow into the header immediately. Hide `originalStop` by default.
  const defaultColumns = useMemo(() => {
    const cols = buildTradesColumns(settings)
    // Apply the hiddenByDefault flag by pre-seeding the column prefs hook's
    // hidden set only on first mount — done inline below via initial filter.
    return cols
  }, [settings])

  // One-time seed of the default-hidden columns (e.g. Stop).
  // We pass defaultColumns to useJ2ColumnPrefs; the hook itself doesn't
  // support per-column default-hidden, so we post-filter visibleColumns.
  const {
    columns,
    visibleColumns: rawVisibleColumns,
    hiddenKeys,
    toggleColumn,
    reorderColumns,
    resetColumns,
  } = useJ2ColumnPrefs(COLUMN_STORAGE_KEY, defaultColumns)

  // Apply hiddenByDefault on first visit (no stored prefs yet).
  const [defaultHiddenApplied, setDefaultHiddenApplied] = useState(false)
  useMemo(() => {
    if (defaultHiddenApplied) return
    try {
      const stored = localStorage.getItem(COLUMN_STORAGE_KEY)
      if (stored) { setDefaultHiddenApplied(true); return }
    } catch { /* private mode */ }
    // First visit: hide columns flagged hiddenByDefault
    defaultColumns.forEach((c) => {
      if (c.hiddenByDefault && !hiddenKeys.has(c.key)) {
        toggleColumn(c.key)
      }
    })
    setDefaultHiddenApplied(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultHiddenApplied])

  const visibleColumns = rawVisibleColumns

  const summary = useMemo(() => summaryStats(trades), [trades])

  // Toolbar modals
  const [addOpen, setAddOpen] = useState(false)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const pickerBtnRef = useRef(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [toast, setToast] = useState(null)

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
          <button
            type="button"
            className={styles.ghostBtn}
            disabled
            title="Arrives in Phase 6"
          >
            ☰ Filters ▾
          </button>
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
            disabled
            title="Arrives in Phase 7"
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
        <TradesTable trades={trades} visibleColumns={visibleColumns} />
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

      <Toast
        message={toast?.message}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />
    </div>
  )
}
