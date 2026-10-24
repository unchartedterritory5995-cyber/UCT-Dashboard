// A short marker for a number computed on the default account size (Round B fix 2, finding 9).
// The server says when the size is the default (settings.accountSizeIsDefault); the hover text is
// the server's own sentence (default_size_sentence), read from the one pinned client copy (R2-3).
import { DEFAULT_SIZE_SENTENCE } from '../../lib/accountSize'

export default function DefaultSizeMarker({ settings, style }) {
  if (settings?.accountSizeIsDefault !== true) return null
  return (
    <span
      data-testid="default-size-marker"
      title={DEFAULT_SIZE_SENTENCE}
      style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-muted)', ...style }}
    >
      Default size
    </span>
  )
}
