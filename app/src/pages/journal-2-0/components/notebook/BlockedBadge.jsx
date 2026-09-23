import UIcon from '../../../../components/ui/UIcon'
import { BLOCKED_BADGE, BLOCKED_TITLE } from '../../lib/offline/unsyncedCopy'
import styles from './BlockedBadge.module.css'

/**
 * Wave Q1's "this note has unsent words, edit it again to sync" signal --
 * ONE shared component so the four note-list views (Card, Table, Board,
 * Calendar) render the same icon and the same words, not four independent
 * guesses at the same fact. Competitive audit finding UX #15, 2026-09-22:
 * before this, Card and Table each had their own icon+text (agreeing by
 * coincidence, not by sharing code), Board had text only (no icon), and
 * Calendar rendered NOTHING -- only a native `title` hover attribute, which
 * is unreachable on touch (this app's touch tier is <=1024px, the majority
 * of mobile/tablet sessions per CLAUDE.md).
 *
 * `compact` (icon only, no visible text) exists for Calendar's chip
 * specifically -- a single-line, ellipsis-truncating pill with no room for
 * "Edit again to sync" beside a note title. The full sentence still rides
 * in `title` (hover) either way; `compact` additionally needs its own
 * `aria-label`, because an icon with no visible text content otherwise has
 * NO accessible name at all (the non-compact form gets one for free from
 * its own visible text).
 *
 * `className` is for the CALLER's own positioning only (e.g. Table's
 * left margin after the title) -- the badge's color/background/border/
 * font size are owned entirely here, once, so a future copy or color change
 * cannot land in three of the four views and miss the fourth.
 */
export default function BlockedBadge({ compact = false, className = '' }) {
  return (
    <span
      className={`${styles.badge} ${className}`}
      title={BLOCKED_TITLE}
      {...(compact ? { role: 'img', 'aria-label': BLOCKED_TITLE } : {})}
    >
      <UIcon name="warning" size={11} style={{ verticalAlign: '-1px', marginRight: compact ? 0 : 3 }} />
      {!compact && BLOCKED_BADGE}
    </span>
  )
}
