// Full-page fallback UI rendered when the app-level ErrorBoundary catches
// a render error in any routed page. Designed to be informative without
// leaking error.message (which can contain user data).
//
// In dev (import.meta.env.DEV) we show the full stack so the engineer
// can debug; in prod we show only error.name to give support tickets
// a usable identifier without spilling sensitive data.

export default function AppErrorFallback({ error }) {
  const isDev = import.meta.env.DEV
  const errorName = error?.name || 'Error'

  const goHome = () => { window.location.href = '/dashboard' }
  const reload = () => { window.location.reload() }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#0e0f0d',
      color: '#e5e1d3',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
      <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px', letterSpacing: '0.5px' }}>
        Something went wrong on this page
      </h1>
      <p style={{ fontSize: '13px', color: '#a8a290', margin: '0 0 24px', maxWidth: '480px' }}>
        Error type: <code style={{ background: '#1a1b18', padding: '2px 6px', borderRadius: '3px' }}>{errorName}</code>
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={reload}
          style={{
            background: '#c9a84c',
            color: '#0e0f0d',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Reload page
        </button>
        <button
          onClick={goHome}
          style={{
            background: 'transparent',
            color: '#e5e1d3',
            border: '1px solid #3a3a36',
            padding: '10px 20px',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Back to dashboard
        </button>
      </div>
      {isDev && error?.stack && (
        <pre style={{
          marginTop: '32px',
          padding: '16px',
          background: '#1a1b18',
          color: '#a8a290',
          fontSize: '11px',
          fontFamily: 'IBM Plex Mono, monospace',
          maxWidth: '90vw',
          overflow: 'auto',
          textAlign: 'left',
          borderRadius: '4px',
        }}>
          {error.stack}
        </pre>
      )}
    </div>
  )
}
