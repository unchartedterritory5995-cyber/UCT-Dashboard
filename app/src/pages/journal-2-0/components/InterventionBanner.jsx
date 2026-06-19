/**
 * InterventionBanner — renders active Compass interventions as colored banners.
 *
 * Props:
 *   interventions: [{id, rule, severity, message}]
 *   onDismiss?(id): void
 */

import UIcon from '../../../components/ui/UIcon'

const STYLES = {
  info: { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.5)', icon: 'sparkle' },
  warning: { bg: 'rgba(201,168,76,0.12)', border: 'rgba(201,168,76,0.55)', icon: 'warning' },
  danger: { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.55)', icon: 'noEntry' },
}

export default function InterventionBanner({ interventions = [], onDismiss }) {
  if (!Array.isArray(interventions) || interventions.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
      {interventions.map((i) => {
        const s = STYLES[i.severity] || STYLES.warning
        return (
          <div key={i.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '8px 12px', background: s.bg, border: `1px solid ${s.border}`,
            borderRadius: 6,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1.2 }}><UIcon name={s.icon} size={16} /></span>
            <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: 'var(--text-bright)' }}>
              <strong style={{ color: 'var(--ut-gold, #c9a84c)', fontSize: 10 }}><UIcon name="compass" size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />Compass heads-up</strong>
              <div>{i.message}</div>
            </div>
            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss(i.id)}
                aria-label="Dismiss"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: 11, padding: '2px 6px', textDecoration: 'underline',
                }}
              >Dismiss</button>
            )}
          </div>
        )
      })}
    </div>
  )
}
