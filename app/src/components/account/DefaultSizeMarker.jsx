// A short marker for a number computed on the default account size (Round B fix 2, finding 9).
// The server says when the size is the default (settings.accountSizeIsDefault); the hover text is
// the Portfolio Risk page's own sentence (PortfolioHeat.jsx), so no new copy.
const SENTENCE = 'No account size on file — these numbers use a default account size, not your real one.'

export default function DefaultSizeMarker({ settings, style }) {
  if (settings?.accountSizeIsDefault !== true) return null
  return (
    <span
      data-testid="default-size-marker"
      title={SENTENCE}
      style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-muted)', ...style }}
    >
      Default size
    </span>
  )
}
