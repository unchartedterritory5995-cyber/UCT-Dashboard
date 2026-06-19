/**
 * Cross-tab notification strip — surfaces when the current account has an
 * unviewed EOD recap. Click → routes to Compass tab + marks viewed.
 * Dismiss button also marks viewed.
 *
 * Props:
 *   onClick(): void   // routes to Compass tab (parent supplies)
 *   onDismiss(): void // marks recap viewed (parent supplies)
 *   day: string       // the recap's day, displayed for context
 */

import UIcon from '../../../components/ui/UIcon'

export default function EODRecapBanner({ onClick, onDismiss, day }) {
  return (
    <div
      role="status"
      style={{
        margin: '0 16px 12px',
        padding: '8px 14px',
        background: 'rgba(201,168,76,0.10)',
        border: '1px solid rgba(201,168,76,0.5)',
        borderRadius: 6,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
      }}
    >
      <span>
        <UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Compass wrapped {day === todayISO() ? "today's" : `the ${day}`} session — read it →
      </span>
      <span style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={onClick}
          style={{
            padding: '4px 12px',
            background: 'var(--ut-gold, #c9a84c)',
            color: '#000',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Read
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            padding: '4px 8px',
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ×
        </button>
      </span>
    </div>
  )
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
