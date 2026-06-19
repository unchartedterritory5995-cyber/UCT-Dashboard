// app/src/components/chart/PatternToolbarButton.jsx — toolbar toggle that flips
// the pattern overlay on/off. Re-uses the global toolbar `.btn` / `.active`
// styling so spacing + hover states match peers (extended, replay, etc).
//
// Phase 5 Task 4: ships the toggle alone. Filter dropdown (category multi-select
// + min-confidence slider) is a polish-pass deliverable.
import styles from './ChartToolbar.module.css'
import UIcon from '../ui/UIcon'

export default function PatternToolbarButton({ active, onToggle }) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${active ? styles.active : ''}`}
      onClick={() => onToggle?.(!active)}
      title={active ? 'Patterns: ON (click to hide)' : 'Patterns: OFF (click to show)'}
      aria-label="Toggle chart patterns overlay"
      aria-pressed={active}
      style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, padding: '2px 6px' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <span style={{ fontSize: 12, lineHeight: 1 }}><UIcon name="patterns" size={12} /></span>
        <span>Patterns</span>
      </span>
    </button>
  )
}
