import { chipLabel } from './chipLabel'
import ScanFilterChip from './ScanFilterChip'
import styles from './ScannerPro.module.css'

// Removable chips for every active filter + a Clear all. Returns null when empty.
// `scanJoins` (per-request truth) and `onReplace` (key, nextSpecOrNull) are
// only consulted by the `scan` branch — every other chip is unaffected.
export default function FilterChips({ meta, activeFilters, onRemove, onClear, scanJoins, onReplace }) {
  if (!meta) return null
  const entries = Object.entries(activeFilters).filter(([, v]) => v)
  if (!entries.length) return null
  const byKey = Object.fromEntries((meta.filters || []).map(f => [f.key, f]))
  return (
    <div className={styles.chipRow}>
      {entries.map(([key, spec]) => (
        key === 'scan' ? (
          <ScanFilterChip key={key} spec={spec} scanJoins={scanJoins}
            scans={(byKey.scan?.scans) || []}
            onRemoveHash={h => {
              const arr = (Array.isArray(spec.value) ? spec.value : [spec.value])
                .filter(x => x !== h)
              onReplace(key, arr.length ? { ...spec, value: arr } : null)
            }} />
        ) : (
          <span key={key} className={styles.chip}>
            {/* Unknown keys (e.g. a stale saved screen) fall back to the raw key so
                the chip is never blank and stays removable. */}
            {chipLabel(byKey[key] || { label: key, presets: [] }, spec)}
            <button type="button" className={styles.chipX}
              aria-label={`Remove ${byKey[key]?.label || key} filter`}
              onClick={() => onRemove(key)}>×</button>
          </span>
        )
      ))}
      <button type="button" className={styles.chipClear} onClick={onClear}>Clear all</button>
    </div>
  )
}
