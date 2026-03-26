import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg, #0e0f0d)',
      color: 'var(--text, #e8e2d4)',
      fontFamily: 'var(--font-body, Inter, system-ui, sans-serif)',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono, IBM Plex Mono, monospace)',
        fontSize: '96px',
        fontWeight: 700,
        color: 'var(--ut-gold, #c9a84c)',
        lineHeight: 1,
        marginBottom: '12px',
        letterSpacing: '4px',
      }}>
        404
      </div>

      <p style={{
        fontSize: '18px',
        color: 'var(--text-muted, #a8a290)',
        marginBottom: '36px',
      }}>
        Page not found
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <Link
          to="/dashboard"
          style={{
            display: 'inline-block',
            padding: '10px 28px',
            background: 'var(--ut-gold, #c9a84c)',
            color: '#0e0f0d',
            borderRadius: '6px',
            fontWeight: 600,
            fontSize: '14px',
            textDecoration: 'none',
            letterSpacing: '0.5px',
          }}
        >
          Go to Dashboard
        </Link>

        <Link
          to="/"
          style={{
            fontSize: '13px',
            color: 'var(--text-muted, #a8a290)',
            textDecoration: 'none',
          }}
        >
          Go to Home
        </Link>
      </div>
    </div>
  )
}
