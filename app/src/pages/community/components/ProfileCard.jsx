// app/src/pages/community/components/ProfileCard.jsx
// Discord-style mini profile popover — opens when an avatar or author name is
// clicked. Shows the avatar, verified journal badges, member-since, and floor
// activity from GET /api/community/members/{id}. UCT Mentor gets a static card.
import { useEffect, useMemo, useRef } from 'react'
import useSWR from 'swr'
import UIcon from '../../../components/ui/UIcon'
import FloorAvatar from './FloorAvatar'
import styles from '../Community.module.css'

const CARD_W = 260
const CARD_H = 190

function sinceLabel(joinedAt) {
  if (!joinedAt) return null
  try {
    const d = new Date(String(joinedAt).replace(' ', 'T'))
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString([], { month: 'long', year: 'numeric' })
  } catch (_) { return null }
}

export default function ProfileCard({ profile, onClose }) {
  // profile: { userId|null, name, isMentor, x, y }
  const ref = useRef(null)
  const { data } = useSWR(
    profile?.userId ? `/api/community/members/${profile.userId}` : null,
    (u) => fetch(u, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
  )

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const pos = useMemo(() => {
    const x = Math.min(Math.max(8, profile.x), window.innerWidth - CARD_W - 8)
    const y = Math.min(Math.max(8, profile.y), window.innerHeight - CARD_H - 8)
    return { left: x, top: y }
  }, [profile.x, profile.y])

  const name = data?.name || profile.name || 'member'
  const mentor = profile.isMentor || data?.is_mentor
  const badges = data?.badges || []
  const since = sinceLabel(data?.joined_at)

  return (
    <div ref={ref} className={styles.profileCard} style={pos} role="dialog" aria-label={`${name} profile`}>
      <div className={styles.profileHead}>
        <FloorAvatar authorId={profile.userId} name={name} isMentor={mentor && !profile.userId} size={56} />
        <div className={styles.profileId}>
          <span className={mentor ? styles.mentorBadge : styles.profileName}>{name}</span>
          {mentor && <span className={styles.mentorTag}>MENTOR</span>}
          {(badges.includes('green_week') || badges.includes('hot_hand')) && (
            <div className={styles.profileBadges}>
              {badges.includes('green_week') && (
                <span className={styles.badgeGreen} title="Net positive R this week (verified from journal)">green wk</span>
              )}
              {badges.includes('hot_hand') && (
                <span className={styles.badgeHot} title="Last 3 closed trades were wins (verified from journal)">
                  <UIcon name="flame" size={10} /> hot hand
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {profile.userId ? (
        <div className={styles.profileStats}>
          {since && <div className={styles.profileStat}>On the floor since <b>{since}</b></div>}
          {data && (
            <div className={styles.profileStat}>
              <b>{data.messages ?? 0}</b> floor messages · <b>{data.board_posts ?? 0}</b> board posts
            </div>
          )}
          {!data && <div className={styles.profileStat}>Loading…</div>}
        </div>
      ) : (
        <div className={styles.profileStats}>
          <div className={styles.profileStat}>The desk's mentor — market signals, briefs, and answers, live on the floor.</div>
        </div>
      )}
    </div>
  )
}
