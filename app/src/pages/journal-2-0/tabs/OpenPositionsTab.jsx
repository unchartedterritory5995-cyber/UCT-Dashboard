/**
 * Open Positions tab — Journal 2.0.
 * Spec §7.
 *
 * Stats header + positions table + columns picker + Add Position
 * button. Phase 3 is read-only; Add/Edit/Close arrive in Phase 4,
 * so those buttons are disabled stubs here.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { useHotkeys } from 'react-hotkeys-hook'
import useJ2Positions from '../hooks/useJ2Positions'
import useJ2OptionStrategies from '../hooks/useJ2OptionStrategies'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useJ2ColumnPrefs from '../hooks/useJ2ColumnPrefs'
import OptionStrategiesSection from '../components/options/OptionStrategiesSection'
import AddOptionStrategyModal from '../components/options/AddOptionStrategyModal'
import CloseOptionStrategyModal from '../components/options/CloseOptionStrategyModal'
import ExpiredBanner from '../components/options/ExpiredBanner'
import useLivePrices from '../../../hooks/useLivePrices'
import PositionsTable, { POSITIONS_COLUMNS } from '../components/PositionsTable'
import ColumnsPicker from '../components/ColumnsPicker'
import AddPositionModal from '../components/AddPositionModal'
import EditPositionModal from '../components/EditPositionModal'
import ClosePositionModal from '../components/ClosePositionModal'
import ConfirmModal from '../components/ConfirmModal'
import Toast from '../components/Toast'
import {
  portfolioAggregates,
  money,
  moneySigned,
  percent,
} from '../../../lib/journal-2-0'
import styles from './OpenPositionsTab.module.css'

const COLUMN_STORAGE_KEY = 'uct.j2.openPositions.columns'

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

export default function OpenPositionsTab({ settings, onTradeWritten }) {
  const { positions, isLoading, error, refresh: refreshPositions } = useJ2Positions()
  const {
    strategies: optionStrategies,
    isLoading: optionsLoading,
    error: optionsError,
    refresh: refreshOptions,
  } = useJ2OptionStrategies({ status: 'open' })
  const { accountId: selectedAccountId, account: selectedAccount, accounts } = useJ2SelectedAccount()
  const {
    columns,
    visibleColumns,
    hiddenKeys,
    toggleColumn,
    reorderColumns,
    resetColumns,
  } = useJ2ColumnPrefs(COLUMN_STORAGE_KEY, POSITIONS_COLUMNS)

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const { prices } = useLivePrices(symbols)
  const { mutate } = useSWRConfig()

  const accountSize = settings?.accountSize ?? 0

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

  const aggregates = useMemo(() => {
    const priceMap = Object.fromEntries(
      Object.entries(prices).map(([sym, v]) => [sym, v?.price]),
    )
    return portfolioAggregates(positions, priceMap, accountSize)
  }, [positions, prices, accountSize])

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
            className={styles.primaryBtn}
            onClick={() => setAddOpen(true)}
          >
            + Add Position
          </button>
        </div>
      </div>

      {isLoading && positions.length === 0 ? (
        <div className={styles.loading}>Loading positions…</div>
      ) : (
        <PositionsTable
          positions={positions}
          prices={prices}
          accountSize={accountSize}
          visibleColumns={visibleColumns}
          onEdit={(p) => setEditTarget(p)}
          onClose={(p) => setCloseTarget(p)}
          onDelete={handleDeleteRequest}
        />
      )}

      {!expiredBannerDismissed && (
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

      <OptionStrategiesSection
        strategies={optionStrategies}
        variant="open"
        isLoading={optionsLoading}
        error={optionsError}
        onAddClick={() => setOptionsAddOpen(true)}
        onExpire={async (s) => {
          try {
            await jsonFetch(`/api/j2/options/${s.id}/expire`, 'POST')
            refreshOptions()
            mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/analytics'))
            mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/calendar'))
            setToast({ message: `Marked ${s.underlying} expired.`, tone: 'success' })
          } catch (e) {
            setToast({ message: `Couldn't expire: ${e.message}`, tone: 'error' })
          }
        }}
        onClose={(s) => setOptionsCloseTarget(s)}
        onDelete={(s) => setOptionsDeleteTarget(s)}
      />


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
