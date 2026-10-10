// app/src/components/admin/PanelReadError.jsx
//
// TERM-033: the one line an admin health panel shows when its read FAILED (see
// adminFetcher.js), so a dash is never mistaken for a zero or "no data".

/** One line naming a failed read, with a Retry. Renders nothing when `error` is falsy. */
export default function PanelReadError({ error, what, onRetry, className, style }) {
  if (!error) return null
  return (
    <div role="alert" className={className}
      style={{ color: '#f87171', fontSize: 11, margin: '4px 0 8px', ...style }}>
      Could not load {what}. A dash here is a failed read, not a zero.
      {onRetry && (
        <>
          {' '}
          <button type="button" onClick={() => onRetry()}
            style={{ background: 'none', border: 'none', padding: 0, color: 'inherit',
              textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
            Retry
          </button>
        </>
      )}
    </div>
  )
}
