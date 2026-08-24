/**
 * Trade Journal tab — Journal 2.0.
 * Spec §11 · P3 §6 (global Scope).
 *
 * Stats grid (6×2) + ScopeBar + trades table + columns picker. Filtering is
 * SERVER-SIDE: the URL-backed `useScope` supplies a snake_case FilterSpec
 * (`apiParams`) that `useJ2Trades` threads into `GET /api/j2/trades`. The old
 * client-side Period pills + `☰ Filters` popover (useJ2Filters/applyFilters)
 * were replaced by `<ScopeBar>` in A9.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import { useHotkeys } from 'react-hotkeys-hook'
import useJ2Trades from '../hooks/useJ2Trades'
import useJ2OptionStrategies from '../hooks/useJ2OptionStrategies'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useReviewedTradeIds from '../hooks/useReviewedTradeIds'
import useScope from '../hooks/useScope'
import TradeDrawer from '../components/TradeDrawer'
import useJ2ColumnPrefs from '../hooks/useJ2ColumnPrefs'
import StatsGrid from '../components/StatsGrid'
import TradesTable, { buildTradesColumns } from '../components/TradesTable'
import ColumnsPicker from '../components/ColumnsPicker'
import ScopeBar from '../components/scope/ScopeBar'
import AddTradeModal from '../components/AddTradeModal'
import DeleteAllModal from '../components/DeleteAllModal'
import ImportCsvModal from '../components/ImportCsvModal'
import Toast from '../components/Toast'
import BrokerImportingBanner from '../components/BrokerImportingBanner'
import useBrokerWarming from '../hooks/useBrokerWarming'
import { summaryStats } from '../../../lib/journal-2-0'
import { DEFAULT_PAGE_SIZE } from '../../../lib/journal-2-0/scope'
import UIcon from '../../../components/ui/UIcon'
import styles from './TradeJournalTab.module.css'

const COLUMN_STORAGE_KEY = 'uct.j2.tradeJournal.columns'

// Empty-state styling — inline (this tab owns no dedicated empty-state class).
const EMPTY_WRAP = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  padding: '48px 24px',
  textAlign: 'center',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
}
const EMPTY_TITLE = {
  margin: 0,
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--text-bright)',
}
const EMPTY_HINT = {
  margin: 0,
  maxWidth: 360,
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--text-muted)',
}

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
// "Long Call"). Field shape matches TradesTable/summaryStats exactly
// (pnlPercent is a fraction, like share trades), so no table changes.
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

// The closed-options union is NOT server-scoped (A9 filters SHARES server-side),
// so each option row is matched against the active Scope client-side. Per the
// A4 LOCKED rule, option STRATEGIES filter by SYMBOL (underlying prefix) ONLY:
// side has no strategy analog, and setups/tags are NOT applied to strategies.
// The Calendar day P&L unions these SAME closed strategies WITHOUT side/setup/
// tag filtering, so honoring those facets here would make option rows VANISH
// from the journal table while still counting in the Calendar day total — a
// cross-surface "numbers disagree / trades vanished" trust violation (the exact
// thing P3 must prevent). Match SYMBOL + the exit-date spine ONLY, and `.trim()`
// the symbol to mirror the backend's `spec.symbol.strip().upper()`.
function optionRowMatchesScope(row, scope) {
  if (scope.symbol) {
    const s = String(scope.symbol).trim().toUpperCase()
    if (s && (!row.symbol || !row.symbol.toUpperCase().startsWith(s))) return false
  }
  if (scope.from || scope.to) {
    const d = (row.exitDate || '').slice(0, 10)
    if (scope.from && d < scope.from) return false
    if (scope.to && d > scope.to) return false
  }
  return true
}

export default function TradeJournalTab({ settings }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { scope, apiParams, clearScope } = useScope()

  // ── Server-side pagination (B5) ────────────────────────────────────────────
  // `apiParams` (from the codec) already carries limit=DEFAULT_PAGE_SIZE + offset=0;
  // this tab owns the PAGE via local `page` state and overrides `offset`. Paging is
  // deliberately NOT scope/URL-backed in v1 (ephemeral local state). Any scope/
  // filter/account change re-keys `filterSig` → reset to page 0 so a narrower
  // result set never strands the user on a now-empty page.
  const [page, setPage] = useState(0)
  const offset = page * DEFAULT_PAGE_SIZE
  const filterSig = JSON.stringify(apiParams)  // stable — offset/limit are constant here
  useEffect(() => { setPage(0) }, [filterSig])
  const pagedParams = useMemo(
    () => ({ ...apiParams, offset }),
    [apiParams, offset],
  )

  const { trades, total, isLoading, error, refresh, mutate: mutateTrades } =
    useJ2Trades(pagedParams)

  // ── Full-book KPI summary (B5 pagination-leak fix) ──────────────────────────
  // The StatsGrid must summarize the ENTIRE filtered closed-trade book — NOT the
  // current 50-row page. `pagedParams` carries limit/offset (correct for the
  // TABLE), but the summary reads the SAME scope with paging STRIPPED, so the
  // backend returns the full filtered match set (spec.limit None → unbounded).
  // Computed CLIENT-side (not a server summary) because the KPI set unions closed
  // OPTION strategies — which live only client-side — and `summaryStats`'
  // max-consecutive scan needs an ORDERED pass over the COMBINED shares+options
  // set, which the server can't reproduce without dropping options (a new
  // cross-surface divergence). Separate SWR key ⇒ a second fetch (the pre-B5 book
  // read, restored for the summary only); the table keeps its paged fetch.
  const summaryParams = useMemo(() => {
    const rest = { ...apiParams }
    delete rest.limit
    delete rest.offset
    return rest
  }, [apiParams])
  const { trades: summaryShares, refresh: refreshSummary } =
    useJ2Trades(summaryParams)

  const {
    strategies: closedStrategies,
    isLoading: stratLoading,
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

  // "Loud active" = any FILTER facet set (EXCLUDING account) — matches ScopeBar.
  const filterActive = !!(
    scope.from || scope.to || scope.symbol ||
    scope.sides.length || scope.setups.length || scope.tags.length
  )

  // Closed shares (server-scoped) + closed option strategies (client-scoped) in
  // one unified list.
  const allClosed = useMemo(
    () => [
      ...(showShares ? trades : []),
      ...(showOptions
        ? closedStrategies
            .map(optionClosedToRow)
            .filter((r) => optionRowMatchesScope(r, scope))
        : []),
    ],
    [showShares, showOptions, trades, closedStrategies, scope],
  )

  // KPI summary set: the FULL (unpaged) filtered share book unioned with the
  // SAME client-scoped closed options as the table. Distinct from `allClosed`
  // (which is the PAGED shares + options that render in the table) so the
  // StatsGrid reflects the whole book while the table still pages.
  const allClosedForSummary = useMemo(
    () => [
      ...(showShares ? summaryShares : []),
      ...(showOptions
        ? closedStrategies
            .map(optionClosedToRow)
            .filter((r) => optionRowMatchesScope(r, scope))
        : []),
    ],
    [showShares, showOptions, summaryShares, closedStrategies, scope],
  )

  const summary = useMemo(() => summaryStats(allClosedForSummary), [allClosedForSummary])

  // Trade detail drawer
  const [drawerTrade, setDrawerTrade] = useState(null)

  // Toolbar modals
  const [addOpen, setAddOpen] = useState(false)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const pickerBtnRef = useRef(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [toast, setToast] = useState(null)

  // Tab-scoped shortcuts. ('/' + symbol focus is owned by the ScopeBar.)
  useHotkeys('t', () => setAddOpen(true))
  useHotkeys('c', () => setPickerOpen((x) => !x))

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
    refreshSummary()  // KPI summary reads a separate (unpaged) key — revalidate it too
    const acctName = accounts.find((a) => a.id === acctId)?.name
    showToast(
      `Added ${res.symbol} ${res.side.toLowerCase()} — ${res.result}${acctName ? ` (${acctName})` : ''}`,
      'success',
    )
  }, [refresh, refreshSummary, showToast, selectedAccountId, accounts])

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
    refreshSummary()  // KPI summary reads a separate (unpaged) key — revalidate it too
    // Also invalidate any positions cache just in case future filter logic
    // relies on shared data.
    await mutate('/api/j2/positions')
    showToast(`Deleted ${res.deleted} trade${res.deleted === 1 ? '' : 's'}.`, 'success')
  }, [refresh, refreshSummary, mutate, showToast])

  if (error) {
    return (
      <div className={styles.errorBanner} role="alert">
        Failed to load trades: {String(error.message || error)}
      </div>
    )
  }

  const loadingTrades = (isLoading || stratLoading) && allClosed.length === 0

  // Pager describes the SERVER (share) trades — the paginated set. Closed option
  // strategies are a client-side union and are NOT server-paged, so the pager is
  // shown only when the shares path spans more than one page.
  const showPager = showShares && total > DEFAULT_PAGE_SIZE
  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = offset + trades.length
  const canPrev = page > 0
  const canNext = pageEnd < total

  return (
    <div className={styles.wrap}>
      {warming && <BrokerImportingBanner broker={warmingBroker} />}
      <StatsGrid summary={summary} />

      <ScopeBar
        surface="journal"
        resultCount={trades.length}
        totalCount={total}
      />

      {showPager && !loadingTrades && (
        <div className={styles.pager} role="navigation" aria-label="Trades pages">
          <span className={styles.pagerInfo}>
            Showing {pageStart}–{pageEnd} of {total}
          </span>
          <div className={styles.pagerBtns}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={!canPrev}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPage((p) => p + 1)}
              disabled={!canNext}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft} />
        <div className={styles.toolbarRight}>
          <div className={styles.pickerWrap}>
            <button
              ref={pickerBtnRef}
              type="button"
              className="btn btn-ghost"
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
              className="btn btn-danger"
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
              className="btn btn-ghost"
              onClick={() => setImportOpen(true)}
            >
              <UIcon name="plus" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Import CSV
            </button>
          )}
          {showShares && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAddOpen(true)}
            >
              + Add Trade
            </button>
          )}
        </div>
      </div>

      {(showShares || showOptions) && (
        loadingTrades ? (
          <div className={styles.loading}>Loading trades…</div>
        ) : allClosed.length === 0 ? (
          filterActive ? (
            // Scoped-empty is a designed state — NEVER a bare empty table (a
            // broker-mirror user concluding trades vanished is a trust incident,
            // P3 Global Constraint).
            <div style={EMPTY_WRAP} role="status">
              <UIcon name="screener" size={22} />
              <p style={EMPTY_TITLE}>No trades match this scope</p>
              <p style={EMPTY_HINT}>
                No closed trades fall inside the active filter. Widen it, or clear
                the filter to see all your trades.
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={clearScope}
              >
                <UIcon name="x" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                Clear filters
              </button>
            </div>
          ) : (
            <div style={EMPTY_WRAP} role="status">
              <p style={EMPTY_TITLE}>No trades yet</p>
              <p style={EMPTY_HINT}>
                Closed trades appear here. Add a trade or import a CSV to get
                started.
              </p>
            </div>
          )
        ) : (
          <TradesTable
            trades={allClosed}
            visibleColumns={visibleColumns}
            reviewedIds={reviewedIds}
            setups={settings?.setups || []}
            onUpdateSetup={handleUpdateSetup}
            onRowAction={(action, trade) => {
              if (action !== 'open') return
              // Option rows keep the quick-peek drawer (their id is a strategy
              // id, not a j2_trades row → the trade page would 404). Equity
              // rows navigate to the full unified detail page, preserving the
              // active scope params so prev/next honors the same set.
              if (trade.isOption) { setDrawerTrade(trade); return }
              navigate(`/journal-2-0/trade/${trade.id}${location.search}`)
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
          accountId={selectedAccountId}
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
            refreshSummary()  // KPI summary reads a separate (unpaged) key
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
