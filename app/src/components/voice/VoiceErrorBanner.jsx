import { useVoice } from '../../context/VoiceContext'

/**
 * Visible, retryable voice error surface. Renders (bottom-right, above the orb)
 * whenever the voice store is in `status: 'error'` — replacing the old jarring
 * native alert()s and silent console errors. Every voice failure (paid-gate,
 * usage cap, mic denied, connection lost, mint failed) now lands here with a
 * plain-language message + a "Try again" button, so a failure is never a
 * dead-end and never invisible.
 *
 * Presentational only: the parent (GlobalVoiceLayer) wires onRetry/onDismiss to
 * the realtime session's connect/disconnect so this component owns no session.
 */
export default function VoiceErrorBanner({ onRetry, onDismiss }) {
  const { status, errorMessage } = useVoice()
  if (status !== 'error') return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 96, // sit just above the floating orb
        zIndex: 1200,
        maxWidth: 320,
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(20,20,24,0.97)',
        border: '1px solid rgba(248,113,113,0.55)',
        borderLeft: '3px solid #f87171',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        color: '#f4f4f5',
        font: '13px/1.5 Instrument Sans, system-ui, sans-serif',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2, color: '#fca5a5' }}>
        Voice hiccup
      </div>
      <div style={{ marginBottom: 10 }}>
        {errorMessage || 'Something interrupted the voice session.'}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onRetry}
          style={{
            flex: 1,
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid #c9a84c',
            background: 'rgba(201,168,76,0.16)',
            color: '#e8d59a',
            fontWeight: 600,
            cursor: 'pointer',
            minHeight: 36,
          }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: '7px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'transparent',
            color: '#a1a1aa',
            cursor: 'pointer',
            minHeight: 36,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
