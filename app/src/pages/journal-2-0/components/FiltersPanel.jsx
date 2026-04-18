/**
 * Filters Panel — Journal 2.0.
 * Spec §12.
 *
 * Left-drawer / popover, ~320px wide, anchored to the ☰ Filters ▾ button.
 * 9 filter sections per §12.1. AND across sections, OR within groups.
 * Clear all in footer. Esc / outside-click dismiss.
 *
 * Controlled by useJ2Filters (hook owns state + URL sync).
 */

import { useEffect, useMemo, useRef } from 'react'
import styles from './FiltersPanel.module.css'

const NAV_OPTIONS = [
  { key: 'light', label: '0–2 (light)' },
  { key: 'moderate', label: '3–4 (moderate)' },
  { key: 'heavy', label: '5+ (heavy)' },
]

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
  const panelRef = useRef(null)

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

  useEffect(() => {
    if (!open) return
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
  }, [open, anchorRef, onClose])

  if (!open) return null

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

      <div className={styles.body}>
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

        {/* RS Rating Minimum (at entry) */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>RS Rating Minimum (at entry)</h4>
          <input
            type="number"
            min="0"
            max="99"
            step="1"
            value={filters.rsMin}
            onChange={(e) => setFilter('rsMin', e.target.value)}
            placeholder="e.g. 80"
            className={styles.input}
          />
          <p className={styles.hint}>Trades without an RS rating are excluded.</p>
        </section>

        {/* NASI RSI */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>
            {settings?.journalColumns?.breadthMetric || 'Breadth'} (at entry)
          </h4>
          <div className={styles.row}>
            <div className={styles.pillToggle} role="radiogroup" aria-label="Direction">
              {['Above', 'Below'].map((dir) => (
                <button
                  key={dir}
                  type="button"
                  className={`${styles.pill} ${filters.nasiDir === dir ? styles.pillActive : ''}`}
                  onClick={() =>
                    setFilter('nasiDir', filters.nasiDir === dir ? '' : dir)
                  }
                  aria-pressed={filters.nasiDir === dir}
                >
                  {dir}
                </button>
              ))}
            </div>
            <input
              type="number"
              step="any"
              value={filters.nasiThreshold}
              onChange={(e) => setFilter('nasiThreshold', e.target.value)}
              placeholder="threshold"
              className={styles.input}
            />
          </div>
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

        {/* Nav Count */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Nav Count (market exposure)</h4>
          <div className={styles.checkList}>
            {NAV_OPTIONS.map((opt) => (
              <label key={opt.key} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={filters.navBuckets.has(opt.key)}
                  onChange={() => toggleSetMember('navBuckets', opt.key)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Power Trend */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Power Trend</h4>
          <div className={styles.checkList}>
            {['On', 'Off'].map((v) => (
              <label key={v} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={filters.powerTrends.has(v)}
                  onChange={() => toggleSetMember('powerTrends', v)}
                />
                <span>{v}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Rally Day */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Rally Day</h4>
          <input
            type="text"
            value={filters.rallyDay}
            onChange={(e) => setFilter('rallyDay', e.target.value)}
            placeholder="e.g. D7"
            className={styles.input}
          />
        </section>
      </div>
    </div>
  )
}
