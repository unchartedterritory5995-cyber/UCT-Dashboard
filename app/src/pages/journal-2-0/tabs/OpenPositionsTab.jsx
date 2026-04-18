/**
 * Open Positions tab — Journal 2.0.
 * Spec §7.
 *
 * Stats header + positions table + columns picker + Add Position
 * button. Phase 3 is read-only; Add/Edit/Close arrive in Phase 4,
 * so those buttons are disabled stubs here.
 */

import { useMemo, useRef, useState } from 'react'
import useJ2Positions from '../hooks/useJ2Positions'
import useJ2ColumnPrefs from '../hooks/useJ2ColumnPrefs'
import useLivePrices from '../../../hooks/useLivePrices'
import PositionsTable, { POSITIONS_COLUMNS } from '../components/PositionsTable'
import ColumnsPicker from '../components/ColumnsPicker'
import { portfolioAggregates, money, moneySigned, percent } from '../../../lib/journal-2-0'
import styles from './OpenPositionsTab.module.css'

const COLUMN_STORAGE_KEY = 'uct.j2.openPositions.columns'

export default function OpenPositionsTab({ settings }) {
  const { positions, isLoading, error } = useJ2Positions()
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

  const accountSize = settings?.accountSize ?? 0

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
            disabled
            title="Arrives in Phase 4"
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
          // Phase 4 will wire real handlers. Nulls → action buttons disabled.
          onEdit={null}
          onClose={null}
          onDelete={null}
        />
      )}
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
