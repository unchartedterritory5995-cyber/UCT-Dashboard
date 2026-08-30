/**
 * Open Positions tab — Journal 2.0.
 * Spec §7.
 *
 * Stats header + positions table + columns picker + Add Position
 * button. Phase 3 is read-only; Add/Edit/Close arrive in Phase 4,
 * so those buttons are disabled stubs here.
 *
 * Robinhood-style live net-liq (Phase 1a) — build-rev p1a.2
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { useHotkeys } from 'react-hotkeys-hook'
import useJ2Positions from '../hooks/useJ2Positions'
import useJ2OptionStrategies from '../hooks/useJ2OptionStrategies'
import useJ2OptionMarks from '../hooks/useJ2OptionMarks'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useJ2Nudges from '../hooks/useJ2Nudges'
import NudgesBanner from '../components/NudgesBanner'
import useJ2ColumnPrefs from '../hooks/useJ2ColumnPrefs'
import { buildStrategyLabel, classifyDebitCredit } from '../lib/optionCalcs'
import AddOptionStrategyModal from '../components/options/AddOptionStrategyModal'
import CloseOptionStrategyModal from '../components/options/CloseOptionStrategyModal'
import ExpiredBanner from '../components/options/ExpiredBanner'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import useBrokerMarkPreference from '../../../hooks/useBrokerMarkPreference'
import PositionsTable, { POSITIONS_COLUMNS } from '../components/PositionsTable'
import HoldingsList from '../components/HoldingsList'
import HoldingsListSkeleton from '../components/HoldingsListSkeleton'
import BrokerAccountHero from '../components/BrokerAccountHero'
import BrokerEquityCurve from '../components/broker/BrokerEquityCurve'
import BrokerReviewNudge from '../components/BrokerReviewNudge'
import SyncTrustCenter from '../components/trust/SyncTrustCenter'
import BrokerImportingBanner from '../components/BrokerImportingBanner'
import useBrokerWarming from '../hooks/useBrokerWarming'
import ColumnsPicker from '../components/ColumnsPicker'
import AddPositionModal from '../components/AddPositionModal'
import EditPositionModal from '../components/EditPositionModal'
import ClosePositionModal from '../components/ClosePositionModal'
import ConfirmModal from '../components/ConfirmModal'
import Toast from '../components/Toast'
import {
  portfolioAggregates,
  brokerLiveSummary,
  currentPriceFor,
  money,
  moneySigned,
  percent,
} from '../../../lib/journal-2-0'
import styles from './OpenPositionsTab.module.css'

const COLUMN_STORAGE_KEY = 'uct.j2.openPositions.columns'
const VIEW_STORAGE_KEY = 'uct.j2.openPositions.view'

async function jsonFetch(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) msg = data.detail
    } catch {
      // non-JSON error body — use status code
    }
    throw new Error(msg)
  }
  return res.json()
}

// Normalize an OPEN option strategy into a position-table row so options show
// alongside shares. Single-leg types get the compact "CRWV Oct 16 $110C" +
// "Long Call" treatment; MULTI-LEG strategies (verticals, condors, ...) use
// buildStrategyLabel + a debit/credit-derived side — the old first-leg-only
// logic labeled a long call debit spread "Short Call" at the wrong strike.
function optionToRow(s, optionMarks) {
  const leg = (s.legs && s.legs[0]) || {}
  const qty = leg.qty ?? 0
  const type = s.strategyType || ''
  const singleLeg = ['long_call', 'long_put', 'short_call', 'short_put'].includes(type)
  let sideLabel
  let symbol
  let isLong
  if (singleLeg) {
    isLong = type.startsWith('long_')
    const isCall = type.endsWith('call')
    sideLabel = `${isLong ? 'Long' : 'Short'} ${isCall ? 'Call' : 'Put'}`
    let when = ''
    if (leg.expiration) {
      const d = new Date(`${leg.expiration}T00:00:00`)
      if (!Number.isNaN(d.getTime())) {
        when = `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`
      }
    }
    symbol = `${s.underlying}${when ? ` ${when}` : ''} $${leg.strike}${isCall ? 'C' : 'P'}`
  } else {
    // Multi-leg: net debit = you own the structure (long-ish), credit = short-ish.
    isLong = classifyDebitCredit(s.netEntry) !== 'credit'
    sideLabel = isLong ? 'Long' : 'Short'
    symbol = buildStrategyLabel(s)
  }
  // Live mark (Massive option aggs) preferred over the sync-time broker mark.
  const liveCur = optionMarks?.[s.id]?.currentValue
  const bcv = Number.isFinite(liveCur) ? liveCur : s.brokerCurrentValue
  const pnlDollar = bcv == null ? null : bcv - s.netEntry
  return {
    id: s.id,
    isOption: true,
    symbol,
    side: sideLabel,
    sideKind: isLong ? 'long' : 'short',
    underlying: s.underlying,
    entryDate: s.entryDate,
    shares: qty,                                   // contracts
    entryPrice: leg.entryPrice ?? null,            // premium per contract
    optCurrent: (bcv != null && qty) ? Math.abs(bcv) / (qty * 100) : null,  // mark/contract
    optMarketValue: bcv == null ? null : Math.abs(bcv),
    optPnlDollar: pnlDollar,
    optPnlPercent: (bcv != null && s.netEntry) ? pnlDollar / Math.abs(s.netEntry) : null,
    source: s.source,
    strategy: s,
  }
}

export default function OpenPositionsTab({ settings, onTradeWritten }) {
  const { positions, isLoading, error, refresh: refreshPositions } = useJ2Positions()
  const {
    strategies: optionStrategies,
    isLoading: optionsLoading,
    error: optionsError,
    refresh: refreshOptions,
  } = useJ2OptionStrategies({ status: 'open' })
  const { accountId: selectedAccountId, account: selectedAccount, accounts } = useJ2SelectedAccount()
  const { nudges: nudgesState } = useJ2Nudges(selectedAccountId)
  const {
    columns,
    visibleColumns,
    hiddenKeys,
    toggleColumn,
    reorderColumns,
    resetColumns,
  } = useJ2ColumnPrefs(COLUMN_STORAGE_KEY, POSITIONS_COLUMNS)

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const { prices, isStreaming } = useRealtimePrices(symbols)
  const { mutate } = useSWRConfig()
  const { warming, broker: warmingBroker } = useBrokerWarming()

  const accountSize = settings?.accountSize ?? 0
  const tradingMode = settings?.tradingMode ?? 'both'
  const showShares = tradingMode !== 'options'
  const showOptions = tradingMode !== 'shares'

  const [addOpen, setAddOpen] = useState(false)
  const [addPrefill, setAddPrefill] = useState(null)  // chart-driven prefill
  const [editTarget, setEditTarget] = useState(null)
  const [closeTarget, setCloseTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [optionsAddOpen, setOptionsAddOpen] = useState(false)
  const [optionsDeleteTarget, setOptionsDeleteTarget] = useState(null)
  const [optionsCloseTarget, setOptionsCloseTarget] = useState(null)
  const [expiredBannerDismissed, setExpiredBannerDismissed] = useState(false)
  const [toast, setToast] = useState(null)  // { message, tone }
  // RH-style holdings list (default) vs the dense table — persisted choice.
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'table' ? 'table' : 'list'
    } catch {
      return 'list'
    }
  })
  const switchView = (v) => {
    setView(v)
    try { localStorage.setItem(VIEW_STORAGE_KEY, v) } catch { /* private mode */ }
  }

  // Tab-scoped shortcuts. react-hotkeys-hook skips input/textarea/
  // contenteditable by default — matches the cheat sheet's note.
  useHotkeys('a', () => setAddOpen(true))
  useHotkeys('c', () => setPickerOpen((x) => !x))

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ message, tone })
  }, [])

  const handleCreate = useCallback(async (payload) => {
    // Stamp accountId from selector. If All Accounts is selected, use the
    // first account so the write has a valid target (user can pick a
    // specific account first if they want precision).
    const acctId = payload.accountId
      || selectedAccountId
      || accounts[0]?.id
      || null
    await jsonFetch('/api/j2/positions', 'POST', { ...payload, accountId: acctId })
    await refreshPositions()
    const acctName = accounts.find((a) => a.id === acctId)?.name
    showToast(
      `Added ${payload.symbol} ${payload.side.toLowerCase()} to ${acctName || 'account'}`,
      'success',
    )
  }, [refreshPositions, showToast, selectedAccountId, accounts])

  const handleUpdate = useCallback(async (position, patch) => {
    await jsonFetch(`/api/j2/positions/${position.id}`, 'PUT', patch)
    await refreshPositions()
    showToast(`Updated ${position.symbol}`, 'success')
  }, [refreshPositions, showToast])

  // Delete flow: click → open ConfirmModal → confirm → mutation.
  const handleDeleteRequest = useCallback((position) => {
    setDeleteTarget(position)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await jsonFetch(`/api/j2/positions/${deleteTarget.id}`, 'DELETE')
      await refreshPositions()
      showToast(`Deleted ${deleteTarget.symbol}`, 'success')
    } catch (e) {
      showToast(String(e.message || e), 'error')
    }
  }, [deleteTarget, refreshPositions, showToast])

  const handleClose = useCallback(async (position, payload) => {
    const res = await jsonFetch(`/api/j2/positions/${position.id}/close`, 'POST', payload)
    await refreshPositions()
    // Also invalidate the trades cache so Phase 5's Trade Journal tab sees the
    // new row as soon as it opens.
    await mutate('/api/j2/trades')
    const pnlStr = moneySigned(res.trade.pnlDollar)
    showToast(
      `Closed ${payload.shares} of ${position.symbol} @ ${money(payload.exitPrice)} — ${pnlStr}`,
      'success',
    )
    // Spec §10.5: switch to Trade Journal tab on close. Delegated to parent.
    onTradeWritten?.(res.trade)
  }, [refreshPositions, mutate, showToast, onTradeWritten])

  // Live-ish option marks (between-syncs freshness for net-liq/Today/rows).
  const { marks: optionMarks } = useJ2OptionMarks({ enabled: optionStrategies.length > 0 })

  // Option strategies as position-table rows, merged with shares into one list.
  const optionRows = useMemo(
    () => (showOptions ? optionStrategies.map((s) => optionToRow(s, optionMarks)) : []),
    [showOptions, optionStrategies, optionMarks],
  )
  const mergedPositions = useMemo(
    () => [...(showShares ? positions : []), ...optionRows],
    [showShares, positions, optionRows],
  )

  // Current price per position: live tick when present, else the broker's
  // last-synced mark — so broker rows keep a real price + P&L (and the Value/
  // Unrealized stats + reconciled hero stay correct) after hours when the live
  // feed is quiet. Built over positions (not the live feed) so a position with
  // no live entry at all still resolves its broker mark.
  // Once the session is CLOSED and the balance sync covers that close, the
  // broker's own marks win over our live feed — they are what the member's
  // broker app is showing, and a second vendor's closes can only disagree.
  // The hero and every row below it must share this one flag.
  const preferBrokerMarks = useBrokerMarkPreference(selectedAccount)
  const priceMap = useMemo(() => {
    const m = {}
    for (const p of positions) m[p.symbol] = currentPriceFor(p, prices, preferBrokerMarks)
    return m
  }, [positions, prices, preferBrokerMarks])

  const aggregates = useMemo(() => {
    const base = portfolioAggregates(positions, priceMap, accountSize)
    if (optionRows.length === 0) return base
    // Fold options into Value / Unrealized / count (Risk/Heat: options add none).
    const optValue = optionRows.reduce((s, r) => s + (r.optMarketValue || 0), 0)
    const optPnl = optionRows.reduce((s, r) => s + (r.optPnlDollar || 0), 0)
    const value = (base.value || 0) + optValue
    const unrealized = (base.unrealized || 0) + optPnl
    return {
      ...base,
      count: (base.count || 0) + optionRows.length,
      value,
      unrealized,
      invested: accountSize ? value / accountSize : base.invested,
    }
  }, [positions, optionRows, priceMap, accountSize])

  // Net-liq computed the Robinhood way — cash + live market value of holdings —
  // so it matches the broker's real number and reflects today's intraday move,
  // instead of anchoring on the broker-reported total equity (which SnapTrade
  // serves stale/near-previous-close for some brokers, hiding today's move).
  // Single-broker only: `positions` are that account's book. Multi-broker falls
  // back to the portfolio perf base inside BrokerAccountHero.
  const brokerAccountCount = useMemo(
    () => accounts.filter((a) => a?.balanceSource === 'broker' && a?.brokerTotalEquity != null).length,
    [accounts],
  )
  const etToday = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    [],
  )
  const liveSummary = useMemo(
    () => (brokerAccountCount <= 1
      ? brokerLiveSummary(selectedAccount, positions, optionStrategies, prices, etToday,
                          optionMarks, preferBrokerMarks)
      : null),
    [brokerAccountCount, selectedAccount, positions, optionStrategies, prices, etToday,
     optionMarks, preferBrokerMarks],
  )
  // Σ option market value (broker mark) — flat contribution to the intraday curve.
  const optionMarketValue = useMemo(
    () => (optionStrategies || []).reduce(
      (s, o) => {
        const live = optionMarks?.[o?.id]?.currentValue
        const v = Number.isFinite(live) ? live : o?.brokerCurrentValue
        return s + (Number.isFinite(v) ? v : 0)
      }, 0,
    ),
    [optionStrategies, optionMarks],
  )

  const pickerBtnRef = useRef(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  if (error) {
    return (
      <div className={styles.errorBanner} role="alert">
        Failed to load open positions: {String(error.message || error)}
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {warming && <BrokerImportingBanner broker={warmingBroker} />}
      <NudgesBanner accountId={selectedAccountId} state={nudgesState} />
      {/* ONE broker-sync surface — SyncTrustCenter absorbed the slim
          BrokerSyncStatus bar's Sync-now (no stacked chrome bands). */}
      <SyncTrustCenter onSynced={() => { refreshPositions(); refreshOptions() }} />
      <BrokerAccountHero
        preferBrokerMarks={preferBrokerMarks}
        account={selectedAccount}
        aggregates={aggregates}
        liveSummary={liveSummary}
        isLive={isStreaming && liveSummary?.netLiq != null}
        positions={positions}
        prices={prices}
        optionMarketValue={optionMarketValue}
      />
      {/* The REAL account-value chart (daily net-liq snapshots + live point).
          Self-gating: null with <2 snapshot points, so manual accounts see
          nothing extra. */}
      <BrokerEquityCurve liveNetLiq={isStreaming ? liveSummary?.netLiq ?? null : null} />
      <BrokerReviewNudge onReview={() => onTradeWritten?.()} />
      {/* §7.1 — stats header */}
      <div className={styles.statsBar}>
        <div className={styles.statGroup}>
          <StatPill label="Positions" value={aggregates.count} />
          <StatPill label="Value" value={money(aggregates.value)} />
          <StatPill
            label="Invested"
            value={aggregates.invested == null ? '—' : percent(aggregates.invested, { dp: 1 })}
          />
          <StatPill
            label="Risk"
            value={
              <>
                {money(aggregates.risk)}
                <span className={styles.statSub}>
                  ({aggregates.riskPercent == null ? '—' : percent(aggregates.riskPercent, { dp: 2 })})
                </span>
              </>
            }
          />
          <StatPill
            label="Heat"
            value={
              <>
                {money(aggregates.heat)}
                <span className={styles.statSub}>
                  ({aggregates.heatPercent == null ? '—' : percent(aggregates.heatPercent, { dp: 2 })})
                </span>
              </>
            }
          />
          <StatPill
            label="Unrealized"
            value={
              <span
                className={
                  aggregates.unrealized > 0
                    ? styles.pos
                    : aggregates.unrealized < 0
                      ? styles.neg
                      : ''
                }
              >
                {moneySigned(aggregates.unrealized)}
              </span>
            }
          />
        </div>

        <div className={styles.actionGroup}>
          <div className={styles.viewToggle} role="group" aria-label="Positions view">
            <button
              type="button"
              className={view === 'list' ? styles.viewBtnActive : styles.viewBtn}
              onClick={() => switchView('list')}
            >
              List
            </button>
            <button
              type="button"
              className={view === 'table' ? styles.viewBtnActive : styles.viewBtn}
              onClick={() => switchView('table')}
            >
              Table
            </button>
          </div>
          {view === 'table' && (
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
          )}
          {showShares && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAddOpen(true)}
            >
              + Add Position
            </button>
          )}
          {showOptions && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOptionsAddOpen(true)}
            >
              + Option Strategy
            </button>
          )}
        </div>
      </div>

      {(showShares || showOptions) && (
        (isLoading || optionsLoading) && mergedPositions.length === 0 ? (
          <HoldingsListSkeleton />
        ) : view === 'list' ? (
          <HoldingsList
            positions={showShares ? positions : []}
            optionStrategies={showOptions ? optionStrategies : []}
            prices={prices}
            optionMarks={optionMarks}
            preferBrokerMarks={preferBrokerMarks}
          />
        ) : (
          <PositionsTable
            positions={mergedPositions}
            prices={prices}
            preferBrokerMarks={preferBrokerMarks}
            accountSize={accountSize}
            visibleColumns={visibleColumns}
            onEdit={(p) => setEditTarget(p)}
            onClose={(p) => setCloseTarget(p)}
            onDelete={handleDeleteRequest}
            onOptionClose={(s) => setOptionsCloseTarget(s)}
            onOptionDelete={(s) => setOptionsDeleteTarget(s)}
          />
        )
      )}

      {showOptions && !expiredBannerDismissed && (
        <ExpiredBanner
          strategies={optionStrategies}
          onMarkAll={async (expired) => {
            const ids = expired.map((s) => s.id)
            try {
              await jsonFetch('/api/j2/options/mark-expired-batch', 'POST', {
                strategyIds: ids,
              })
              refreshOptions()
              mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/analytics'))
              mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/calendar'))
              setToast({ message: `Marked ${ids.length} strategies expired.`, tone: 'success' })
            } catch (e) {
              setToast({ message: `Batch-expire failed: ${e.message}`, tone: 'error' })
            }
          }}
          onDismiss={() => setExpiredBannerDismissed(true)}
        />
      )}

      {/* Option strategies now render as rows inside PositionsTable above
          (merged with shares). Manual add is the "+ Option Strategy" button;
          expiring/close/delete flow via the row actions + ExpiredBanner. */}


      {(addOpen || addPrefill) && (
        <AddPositionModal
          settings={settings}
          prefill={addPrefill || undefined}
          onSave={handleCreate}
          onClose={() => { setAddOpen(false); setAddPrefill(null) }}
          accountName={selectedAccount?.name || accounts[0]?.name}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Delete ${deleteTarget.symbol}?`}
          body={
            <>
              <p>
                Permanently delete the <strong>{deleteTarget.symbol}</strong> {deleteTarget.side.toLowerCase()} position
                ({deleteTarget.shares} shares @ {money(deleteTarget.entryPrice)})?
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                Trades written from this position stay in the Journal — only
                the open Position row is removed.
              </p>
            </>
          }
          confirmLabel="Delete Position"
          tone="danger"
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {editTarget && (
        <EditPositionModal
          position={editTarget}
          settings={settings}
          onSave={(patch) => handleUpdate(editTarget, patch)}
          onClose={() => setEditTarget(null)}
        />
      )}
      {closeTarget && (
        <ClosePositionModal
          position={closeTarget}
          currentPrice={prices[closeTarget.symbol]?.price}
          onSave={(payload) => handleClose(closeTarget, payload)}
          onClose={() => setCloseTarget(null)}
          settings={settings}
        />
      )}

      {optionsDeleteTarget && (
        <ConfirmModal
          title={`Delete ${optionsDeleteTarget.underlying} strategy?`}
          body={
            <p>
              Permanently delete this option strategy. Only OPEN strategies can be deleted;
              closed strategies are part of your trading history.
            </p>
          }
          confirmLabel="Delete Strategy"
          tone="danger"
          onConfirm={async () => {
            const s = optionsDeleteTarget
            setOptionsDeleteTarget(null)
            try {
              await jsonFetch(`/api/j2/options/${s.id}`, 'DELETE')
              refreshOptions()
              mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/analytics'))
              mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/calendar'))
              setToast({ message: `Deleted ${s.underlying} strategy.`, tone: 'success' })
            } catch (e) {
              setToast({ message: `Couldn't delete: ${e.message}`, tone: 'error' })
            }
          }}
          onClose={() => setOptionsDeleteTarget(null)}
        />
      )}

      {optionsCloseTarget && (
        <CloseOptionStrategyModal
          strategy={optionsCloseTarget}
          defaultFeePerContract={settings?.defaultFeePerContract || 0}
          onSave={async (payload) => {
            const s = optionsCloseTarget
            await jsonFetch(`/api/j2/options/${s.id}/close`, 'POST', payload)
            refreshOptions()
            mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/analytics'))
            mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/calendar'))
            mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/trades'))
            setOptionsCloseTarget(null)
            setToast({
              message: `Closed ${s.underlying} strategy.`,
              tone: 'success',
            })
          }}
          onClose={() => setOptionsCloseTarget(null)}
        />
      )}

      {optionsAddOpen && (
        <AddOptionStrategyModal
          defaultFeePerContract={settings?.defaultFeePerContract || 0}
          setups={settings?.setups || []}
          accountName={selectedAccount?.name || accounts[0]?.name}
          onSave={async (payload) => {
            const body = {
              ...payload,
              accountId: selectedAccountId || accounts[0]?.id,
            }
            await jsonFetch('/api/j2/options', 'POST', body)
            refreshOptions()
            mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/analytics'))
            mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/calendar'))
            setOptionsAddOpen(false)
            setToast({ message: `Created ${payload.underlying} strategy.`, tone: 'success' })
          }}
          onClose={() => setOptionsAddOpen(false)}
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

function StatPill({ label, value }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  )
}
