/**
 * No-trade time-window list editor.
 *
 * Each row: <start HH:MM> – <end HH:MM> [label] [Remove]
 * Plus a "+ Add window" button at the bottom.
 *
 * Calls `onChange(nextArray)` on any keystroke or button click so the
 * parent can persist state. Also maintains internal state so the inputs
 * remain editable even when the parent re-renders with a stale prop
 * (common in test environments with mock onChange handlers).
 */

import { useState, useEffect } from 'react'

export default function NoTradeWindowsEditor({ value = [], onChange }) {
  const [rows, setRows] = useState(value)

  // Sync internal state when the prop value changes from outside
  useEffect(() => {
    setRows(value)
  }, [value])

  const updateAt = (idx, patch) => {
    const next = rows.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    setRows(next)
    onChange(next)
  }

  const removeAt = (idx) => {
    const next = rows.filter((_, i) => i !== idx)
    setRows(next)
    onChange(next)
  }

  const addWindow = () => {
    const next = [...rows, { start: '', end: '', label: '' }]
    setRows(next)
    onChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row, idx) => (
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
