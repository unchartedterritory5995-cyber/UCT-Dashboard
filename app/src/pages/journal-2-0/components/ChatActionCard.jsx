/**
 * Pending-action card. Confirm / Cancel buttons + optional elevated warning.
 *
 * Props:
 *   pendingAction: { name, args, preview: {narration, contextual_warnings, confirm_label, elevated} }
 *   onConfirm(): void
 *   onCancel(): void
 *   disabled?: bool
 */

import UIcon from '../../../components/ui/UIcon'

export default function ChatActionCard({ pendingAction, onConfirm, onCancel, disabled }) {
  if (!pendingAction) return null
  const { preview } = pendingAction
  const elevated = preview?.elevated
  return (
    <div
      role="region"
      aria-label="Pending Compass action"
      style={{
        margin: '8px 0', padding: '12px 16px',
        background: elevated ? 'rgba(239,68,68,0.06)' : 'rgba(201,168,76,0.06)',
        border: `1px solid ${elevated ? 'rgba(239,68,68,0.5)' : 'rgba(201,168,76,0.5)'}`,
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        <UIcon name="pause" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />Compass wants to:
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
        {preview?.narration}
      </div>
      {Array.isArray(preview?.contextual_warnings) && preview.contextual_warnings.length > 0 && (
        <div style={{
          margin: '6px 0 10px', padding: '6px 10px', fontSize: 11,
          background: 'rgba(239,68,68,0.10)',
          border: '1px solid rgba(239,68,68,0.5)', borderRadius: 4,
          color: 'var(--loss, #ef4444)',
        }}>
          <UIcon name="warning" size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />Heads up:
          <ul style={{ margin: '4px 0 0 18px' }}>
            {preview.contextual_warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button" disabled={disabled} onClick={onConfirm}
          style={{
            padding: '5px 14px', fontSize: 12, fontWeight: 600,
            background: elevated ? '#ef4444' : 'var(--ut-gold, #c9a84c)',
            color: elevated ? '#fff' : '#000',
            border: 'none', borderRadius: 4, cursor: 'pointer',
          }}
        >
          {preview?.confirm_label || 'Confirm'}
        </button>
        <button
          type="button" disabled={disabled} onClick={onCancel}
          style={{
            padding: '5px 14px', fontSize: 12, background: 'transparent',
            color: 'var(--text-muted)', border: '1px solid var(--border)',
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          Keep it
        </button>
      </div>
    </div>
  )
}
