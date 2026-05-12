/**
 * Pre-Trade Verdict card — renders verdict label + paragraph + collapsible factors.
 *
 * Props:
 *   verdict: null | { label: 'GO'|'HOLD'|'SKIP'|'ERROR', paragraph: string, factors: string[] }
 *   isLoading: bool
 *   error?: string
 */
import { useState } from 'react'

const LABEL_STYLES = {
  GO: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.5)', text: '#22c55e' },
  HOLD: { bg: 'rgba(201,168,76,0.10)', border: 'rgba(201,168,76,0.5)', text: '#c9a84c' },
  SKIP: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.5)', text: '#ef4444' },
  ERROR: { bg: 'rgba(120,120,120,0.10)', border: 'var(--border)', text: 'var(--text-muted)' },
}

export default function PreTradeVerdictCard({ verdict, isLoading, error }) {
  const [open, setOpen] = useState(false)

  if (isLoading) {
    return (
      <div style={cardStyle('var(--border)', 'rgba(255,255,255,0.02)')}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          🧭 Compass is thinking…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={cardStyle('rgba(239,68,68,0.5)', 'rgba(239,68,68,0.06)')}>
        <div style={{ fontSize: 12, color: '#ef4444' }}>Verdict error: {error}</div>
      </div>
    )
  }

  if (!verdict) return null

  const styles = LABEL_STYLES[verdict.label] || LABEL_STYLES.ERROR
  return (
    <div style={cardStyle(styles.border, styles.bg)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>🧭 Compass</div>
        <div style={{
          padding: '4px 12px', fontSize: 14, fontWeight: 700,
          borderRadius: 4, background: styles.text, color: '#000',
        }}>
          {verdict.label}
        </div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-bright)', marginBottom: 6 }}>
        {verdict.paragraph}
      </div>
      {Array.isArray(verdict.factors) && verdict.factors.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              fontSize: 11, color: 'var(--text-muted)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, textDecoration: 'underline',
            }}
          >
            {open ? '▾ Hide' : '▸ What Compass weighed'}
          </button>
          {open && (
            <ul style={{ margin: '6px 0 0 18px', fontSize: 11, color: 'var(--text-muted)' }}>
              {verdict.factors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function cardStyle(border, bg) {
  return {
    margin: '8px 0',
    padding: '10px 14px',
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 6,
  }
}
