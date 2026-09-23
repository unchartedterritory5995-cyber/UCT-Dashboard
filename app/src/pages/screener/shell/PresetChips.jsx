import useSavedScreens from '../hooks/useSavedScreens'
import styles from './ScannerShell.module.css'

// One-click preset-scan chips from the firm's starters. Clicking a chip applies
// that preset's spec; `applySpec` preserves the chosen pool, so a preset runs
// WITHIN the selected Global / UCT / Watchlist / Combo — not against the whole
// market. The active chip is the one whose conditions are on screen.
//
// ⛔ POOL-BLIND MATCH. A preset is pool-agnostic (it carries RS/price/structure,
// never `universe`/`list`), and the current spec has the member's pool merged in.
// So the active test compares BOTH specs with the pool keys stripped — otherwise
// picking a chip, then a different pool, would drop the chip's highlight.
const POOL = new Set(['universe', 'list', 'scan'])
const keyOf = (spec) => JSON.stringify({
  f: [...(spec?.filters || [])]
    .filter((x) => x && !POOL.has(x.key))
    .map(({ key, op, value, values, min, max }) => ({ key, op, value, values, min, max }))
    .sort((a, b) => (a.key < b.key ? -1 : 1)),
  view: spec?.view ?? null,
  rank: spec?.rank ?? null,
})

export default function PresetChips({ currentSpec, onApply }) {
  const { starters } = useSavedScreens()
  if (!starters?.length) return null
  const cur = keyOf(currentSpec)
  return (
    <div className={styles.presetChips} role="group" aria-label="Preset scans">
      {starters.map((s) => {
        const active = keyOf(s.spec) === cur
        return (
          <button key={s.id} type="button"
            className={`${styles.presetChip} ${active ? styles.presetChipOn : ''}`}
            aria-pressed={active}
            onClick={() => onApply(s.spec)}>
            {s.name}
          </button>
        )
      })}
    </div>
  )
}
