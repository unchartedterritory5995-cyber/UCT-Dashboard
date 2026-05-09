/**
 * No-trade time-window list editor.
 *
 * Each row: <start HH:MM> – <end HH:MM> [label] [Remove]
 * Plus a "+ Add window" button at the bottom.
 *
 * Fully controlled — no internal state. The parent owns the `value` array
 * and `onChange(nextArray)` fires on any keystroke or button click.
 *
 * NOTE: inputs are `type="text"` (not `type="time"`) so vitest/jsdom can
 * exercise them with userEvent.type. The backend validator enforces the
 * HH:MM format on save (`_HHMM_RE` in settings.py).
 */

export default function NoTradeWindowsEditor({ value = [], onChange }) {
  const updateAt = (idx, patch) => {
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
  }
  const removeAt = (idx) => {
    onChange(value.filter((_, i) => i !== idx))
  }
  const addWindow = () => {
    onChange([...value, { start: '', end: '', label: '' }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((row, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <input
            type="text"
            aria-label={`Window ${idx + 1} start`}
            value={row.start}
            onChange={(e) => updateAt(idx, { start: e.target.value })}
            placeholder="HH:MM"
            pattern="[0-9]{2}:[0-9]{2}"
            style={{ minWidth: 100 }}
          />
          <span style={{ color: 'var(--text-muted)' }}>–</span>
          <input
            type="text"
            aria-label={`Window ${idx + 1} end`}
            value={row.end}
            onChange={(e) => updateAt(idx, { end: e.target.value })}
            placeholder="HH:MM"
            pattern="[0-9]{2}:[0-9]{2}"
            style={{ minWidth: 100 }}
          />
          <input
            type="text"
            aria-label={`Window ${idx + 1} label`}
            value={row.label || ''}
            onChange={(e) => updateAt(idx, { label: e.target.value })}
            placeholder="Label (optional)"
            style={{ flex: 1, minWidth: 140 }}
          />
          <button
            type="button"
            onClick={() => removeAt(idx)}
            aria-label={`Remove window ${idx + 1}`}
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid var(--loss, #ef4444)',
              color: 'var(--loss, #ef4444)',
              borderRadius: 6, fontSize: 12, cursor: 'pointer',
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={addWindow}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-bright)',
            borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}
        >
          + Add window
        </button>
      </div>
    </div>
  )
}
