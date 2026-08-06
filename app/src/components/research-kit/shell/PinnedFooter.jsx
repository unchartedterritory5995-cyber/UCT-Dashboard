// app/src/components/research-kit/shell/PinnedFooter.jsx
import { Children } from 'react'
import styles from './PinnedFooter.module.css'

/**
 * The pinned action row (spec §4.4 footer: View Chart · Open full report → ·
 * flag-to-watchlist). Pure layout on --glass-chrome; the actions themselves are
 * the caller's, so the modal and the page can pin different verbs into the same
 * chrome.
 *
 * Renders NOTHING when it has no actions — an empty pinned bar is chrome for
 * chrome's sake, and it would still eat vertical space on a phone.
 *
 * `as` (P2 gate b) — same landmark-scope reasoning as `IdentityBanner`'s: a
 * `<footer>` only maps to the `contentinfo` landmark when its nearest
 * sectioning ancestor is the body, and the modal's `role="dialog"` div is not
 * sectioning content — but rendering `<footer>` there anyway would still read
 * as a second page-level `contentinfo` outside the modal. The research page
 * keeps the default; the modal passes `as="div"`.
 */
export default function PinnedFooter({ children, ariaLabel = 'Actions', as: Tag = 'footer', className = '' }) {
  const items = Children.toArray(children).filter(Boolean)
  if (!items.length) return null

  return (
    <Tag className={`${styles.footer} ${className}`} aria-label={ariaLabel}>
      {items}
    </Tag>
  )
}
