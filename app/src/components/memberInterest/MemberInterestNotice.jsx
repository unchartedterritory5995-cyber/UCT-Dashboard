// D-9 (Personalization PRD UC-1): one line on a list surface that names the tickers
// in it the member already follows, and why, in the route's own words. Shared by
// the Breadth drill, the Screener results and the Morning Wire Top picks.
//
// ⛔ PRESENCE ONLY: renders nothing when no ticker matches, the read failed or the
//    member is not paid. It never says "not on your watchlist".
// ⛔ NO RE-ORDERING: tickers are named in the order the surface already shows them.
// ⛔ `enabled` false => no request to /api/member/interest at all (the SWR key is null).
import { followedAmong, useMemberInterest } from '../../lib/memberInterest'
import styles from '../../pages/research/notices/Notices.module.css'

export const NOTICE_MAX_NAMED = 5

export default function MemberInterestNotice({ enabled, syms, where = 'here', testId = 'member-interest-notice' }) {
  const data = useMemberInterest(enabled === true)
  if (enabled !== true || !data) return null
  const hits = followedAmong(data.entities, syms)
  if (hits.length === 0) return null
  const shown = hits.slice(0, NOTICE_MAX_NAMED)
  const more = hits.length - shown.length
  return (
    <div className={styles.line} data-testid={testId}
      title="From your watchlists, your flags, your open Journal 2.0 positions and the UCT 20. Nothing here re-orders this list.">
      <span className={styles.chip}>Already on your radar</span>
      {`You follow ${hits.length === 1 ? 'one name' : `${hits.length} names`} ${where}: `}
      {shown.map((h, i) => (
        <span key={h.sym} data-testid="member-interest-hit">
          {i > 0 ? '; ' : ''}<strong>{h.sym}</strong> ({h.reasons.join(' · ')})
        </span>
      ))}
      {more > 0 ? `; and ${more} more` : ''}.
    </div>
  )
}
