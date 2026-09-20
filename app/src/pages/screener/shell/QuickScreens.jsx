import useSavedScreens from '../hooks/useSavedScreens'
import styles from './ScannerShell.module.css'

// ── QuickScreens — one-click preset scans, from the SAME starters the
// Screens ▾ menu (ScreensManager) already serves. This is a faster, always-
// visible surface for them, not a second source: both read
// `useSavedScreens().starters` and both apply through the shell's `applySpec`,
// so they can never disagree about what a starter is.
//
// Applying a starter REPLACES the working spec (filters + view + sort), exactly
// as picking it from the menu does. The active chip is detected by matching the
// current baseSpec against each starter's spec — filters (order-independent),
// view and sort — so a chip lights up when the member is on that screen and
// clears the moment they hand-edit a filter.

// Canonical, order-independent key for one filter clause.
const filtKey = f =>
  `${f.key}:${f.op ?? ''}:${f.min ?? ''}:${f.max ?? ''}:${JSON.stringify(f.value ?? null)}`

// A stable identity for a spec's ROW-shaping parts (columns are display-only and
// deliberately excluded — two screens with the same rows but different columns
// are the same screen for this purpose).
const specKey = spec => JSON.stringify({
  f: (spec?.filters || []).map(filtKey).sort(),
  v: spec?.view ?? null,
  s: spec?.sort ? `${spec.sort.key}:${spec.sort.dir || 'desc'}` : null,
  // A ranked scan (e.g. UCT 50) is identified by its criteria + cap, not a sort.
  r: spec?.rank ? JSON.stringify({
    c: (spec.rank.criteria || []).map(x => `${x.key}:${x.ascending ? 'a' : 'd'}:${x.weight ?? 1}`).sort(),
    n: spec.rank.top_n ?? null,
  }) : null,
})

export default function QuickScreens({ baseSpec, onApply }) {
  const { starters } = useSavedScreens()
  if (!starters?.length) return null
  const activeKey = specKey(baseSpec)

  return (
    <div className={styles.quickRow}>
      <span className={styles.uEyebrow} title="One-click preset scans. Save your own from Screens ▾.">Screens</span>
      <div className={styles.qScroll}>
        {starters.map(s => (
          <button type="button" key={s.id} className={styles.qChip}
            aria-pressed={specKey(s.spec) === activeKey}
            onClick={() => onApply(s.spec)}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}
