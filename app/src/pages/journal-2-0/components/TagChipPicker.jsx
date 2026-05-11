/**
 * Multi-select chip picker for mistake/emotion taxonomies (Phase E).
 *
 * Fully controlled — parent owns the `selected` array. Each chip toggles
 * membership via onChange(nextArray).
 *
 * Props:
 *   available: string[]
 *   selected:  string[]
 *   onChange(next: string[]): void
 *   placeholder?: string — shown when `available` is empty
 */

export default function TagChipPicker({ available, selected, onChange, placeholder }) {
  if (!available || available.length === 0) {
    return (
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        {placeholder || 'No tags configured. Add some in Settings.'}
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {available.map((t) => {
        const active = selected.includes(t)
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? selected.filter((x) => x !== t) : [...selected, t])}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              background: active ? 'var(--ut-gold, #c9a84c)' : 'transparent',
              color: active ? 'var(--bg, #000)' : 'var(--text-bright)',
              border: `1px solid ${active ? 'var(--ut-gold, #c9a84c)' : 'var(--border)'}`,
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            {active ? '✓ ' : ''}{t}
          </button>
        )
      })}
    </div>
  )
}
