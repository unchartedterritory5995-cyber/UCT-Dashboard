/**
 * Filters Panel — Journal 2.0.
 * Spec §12.
 *
 * Desktop (≥1025px): left-drawer / popover, anchored to the ☰ Filters ▾ button.
 *   AND across sections, OR within groups. Esc / outside-click dismiss.
 * Touch (≤1024px / coarse pointer): the same filter content rendered inside a
 *   full-width bottom Sheet (tall, scrollable, safe-area aware) so the primary
 *   trade-filtering flow isn't a cramped 320px floating box on a phone.
 *
 * The form markup lives once in <FiltersContent> and is shared by both surfaces.
 *
 * Controlled by useJ2Filters (hook owns state + URL sync).
 */

import { useEffect, useMemo, useRef } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import { useIsTouch } from '../../../hooks/useBreakpoint'
import styles from './FiltersPanel.module.css'

/* Shared filter form — used by both the desktop popover and the mobile Sheet. */
function FiltersContent({ filters, setFilter, toggleSetMember, settings, trades }) {
  // Setup options: settings.setups ∪ setups observed on loaded trades.
  // So setups removed from settings but still attached to historical
  // trades remain filterable (§5.5 contract + §12.1 note).
  const setupOptions = useMemo(() => {
    const known = new Set(settings?.setups ?? [])
    for (const t of trades) {
      if (t.setup) known.add(t.setup)
    }
    return Array.from(known).sort()
  }, [settings, trades])

  return (
    <>
      {/* Date Range */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Date Range</h4>
        <div className={styles.row}>
          <label className={styles.inline}>
            <span className={styles.miniLabel}>From</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilter('dateFrom', e.target.value)}
              className={styles.input}
            />
          </label>
          <label className={styles.inline}>
            <span className={styles.miniLabel}>To</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilter('dateTo', e.target.value)}
              className={styles.input}
            />
          </label>
        </div>
      </section>

      {/* Symbol */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Symbol</h4>
        <input
          type="text"
          value={filters.symbol}
          onChange={(e) => setFilter('symbol', e.target.value)}
          placeholder="starts with…"
          className={styles.input}
          aria-label="Symbol starts-with filter"
        />
      </section>

      {/* Side */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Side</h4>
        <div className={styles.checkList}>
          {['Long', 'Short'].map((s) => (
            <label key={s} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={filters.sides.has(s)}
                onChange={() => toggleSetMember('sides', s)}
              />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Setup */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Setup</h4>
        {setupOptions.length === 0 ? (
          <p className={styles.hint}>No setups defined.</p>
        ) : (
          <div className={styles.checkList}>
            {setupOptions.map((s) => (
              <label key={s} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={filters.setups.has(s)}
                  onChange={() => toggleSetMember('setups', s)}
                />
                <span>{s}</span>
              </label>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

export default function FiltersPanel({
  open,
  anchorRef,
  filters,
  setFilter,
  toggleSetMember,
  resetFilters,
  activeCount,
  onClose,
  settings,
  trades,
}) {
  const isTouch = useIsTouch()
  const panelRef = useRef(null)

  // Desktop popover: outside-click + Esc dismiss. The mobile Sheet handles its
  // own backdrop/Esc dismissal, so skip these listeners on touch.
  useEffect(() => {
    if (!open || isTouch) return
    const onDocClick = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, isTouch, anchorRef, onClose])

  const content = (
    <FiltersContent
      filters={filters}
      setFilter={setFilter}
      toggleSetMember={toggleSetMember}
      settings={settings}
      trades={trades}
    />
  )

  // Touch → full-width bottom sheet (tall, scrollable, safe-area aware).
  if (isTouch) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        variant="bottom-sheet"
        title="Filters"
        ariaLabel={`Journal filters (${activeCount} active)`}
        footer={
          activeCount > 0 ? (
            <button
              type="button"
              className={styles.sheetClearAll}
              onClick={resetFilters}
            >
              Clear all filters
            </button>
          ) : null
        }
      >
        <div className={styles.sheetBody}>{content}</div>
      </Sheet>
    )
  }

  if (!open) return null

  // Desktop → anchored popover (unchanged).
  return (
    <div
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-label={`Journal filters (${activeCount} active)`}
    >
      <div className={styles.header}>
        <span className={styles.title}>Filters</span>
        {activeCount > 0 && (
          <button
            type="button"
            className={styles.clearAll}
            onClick={resetFilters}
          >
            Clear all
          </button>
        )}
      </div>

      <div className={styles.body}>{content}</div>
    </div>
  )
}
