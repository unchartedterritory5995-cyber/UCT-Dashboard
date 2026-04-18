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
import useJ2ColumnPrefs from '../hooks/useJ2ColumnPrefs'
import useLivePrices from '../../../hooks/useLivePrices'
import PositionsTable, { POSITIONS_COLUMNS } from '../components/PositionsTable'
import ColumnsPicker from '../components/ColumnsPicker'
import AddPositionModal from '../components/AddPositionModal'
import EditPositionModal from '../components/EditPositionModal'
import ClosePositionModal from '../components/ClosePositionModal'
import ChartModal from '../components/ChartModal'
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
  const [chartSymbol, setChartSymbol] = useState(null)
  const [toast, setToast] = useState(null)  // { message, tone }

  // Tab-scoped shortcuts. react-hotkeys-hook skips input/textarea/
  // contenteditable by default — matches the cheat sheet's note.
  useHotkeys('a', () => setAddOpen(true))
  useHotkeys('c', () => setPickerOpen((x) => !x))

  const showToast = useCallback((message, tone = 'info') => {
    setToast({ message, tone })
  }, [])

  const handleCreate = useCallback(async (payload) => {
    await jsonFetch('/api/j2/positions', 'POST', payload)
    await refreshPositions()
    showToast(`Added ${payload.symbol} ${payload.side.toLowerCase()} — ${payload.shares} @ ${money(payload.entryPrice)}`, 'success')
  }, [refreshPositions, showToast])

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
          onChart={(p) => setChartSymbol(p.symbol)}
        />
      )}

      {(addOpen || addPrefill) && (
        <AddPositionModal
          settings={settings}
          prefill={addPrefill || undefined}
          onSave={handleCreate}
          onClose={() => { setAddOpen(false); setAddPrefill(null) }}
        />
      )}

      {chartSymbol && (
        <ChartModal
          symbol={chartSymbol}
          onAddFromBar={({ symbol, price, date }) => {
            setAddPrefill({ symbol, entryPrice: price, entryDate: date })
            setChartSymbol(null)  // close chart; AddPositionModal opens
          }}
          onClose={() => setChartSymbol(null)}
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
              <p style={{ fontSize: 12, color: '#7c8290', marginTop: 8 }}>
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
