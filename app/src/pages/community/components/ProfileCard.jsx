// app/src/pages/community/components/ProfileCard.jsx
// Discord-style mini profile popover — opens when an avatar or author name is
// clicked. Shows the avatar, verified journal badges, member-since, and floor
// activity from GET /api/community/members/{id}. UCT Mentor gets a static card.
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { AuthContext } from '../../../context/AuthContext'
import UIcon from '../../../components/ui/UIcon'
import FloorAvatar from './FloorAvatar'
import styles from '../Community.module.css'

const CARD_W = 260
const CARD_H = 320  // TERM-009: room for the call record section

function sinceLabel(joinedAt) {
  if (!joinedAt) return null
  try {
    const d = new Date(String(joinedAt).replace(' ', 'T'))
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString([], { month: 'long', year: 'numeric' })
  } catch (_) { return null }
}

// TERM-009 (owner ruling 2026-09-29: OPT-IN PER MEMBER). How each $TICKER a member
// mentioned has moved since -- losses included. Never "wins": a mention has no direction.
// Another member's record appears only while its owner publishes it (the route 404s
// otherwise, and this renders nothing); the owner always sees their own, and a switch.
const moveText = (m) => (m == null ? 'no price now' : `${m >= 0 ? '+' : ''}${m.toFixed(1)}%`)

export function CallRecord({ userId }) {
  const me = useContext(AuthContext)?.user?.id
  const mine = me != null && String(me) === String(userId)
  const [busy, setBusy] = useState(false)
  const { data, mutate } = useSWR(
    userId ? `/api/community/members/${userId}/calls` : null,
    (u) => fetch(u, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
  )
  if (!data) return null
  const s = data.summary || {}
  const toggle = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/community/me/call-record', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !data.public }),
      })
      if (r.ok) await mutate()
    } finally { setBusy(false) }
  }
  return (
    <div className={styles.profileStat} data-testid="call-record">
      <div>
        <b>Call record</b>{!data.public && mine && ' · only you can see this'}
      </div>
      {s.marks ? (
        <>
          <div data-testid="call-record-summary">
            Since each mention: <b>{s.up}</b> up · <b>{s.down}</b> down · <b>{s.flat}</b> flat
            {s.median_move_pct != null && <> · median {moveText(s.median_move_pct)}</>}
            {s.unpriced > 0 && <> · {s.unpriced} not priced now</>}
          </div>
          <ul className={styles.callRecordList}>
            {(data.rows || []).slice(0, 5).map((r) => (
              <li key={`${r.message_id}-${r.ticker}`}>
                ${r.ticker} at ${Number(r.called_price).toFixed(2)} → {moveText(r.move_pct)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div>No $TICKER mentions yet.</div>
      )}
      {mine && (
        <button type="button" className={styles.callRecordToggle} onClick={toggle} disabled={busy}>
          {data.public ? 'Stop sharing my call record' : 'Share my call record publicly'}
        </button>
      )}
    </div>
  )
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
          <CallRecord userId={profile.userId} />
        </div>
      ) : (
        <div className={styles.profileStats}>
          <div className={styles.profileStat}>The desk's mentor — market signals, briefs, and answers, live on the floor.</div>
        </div>
      )}
    </div>
  )
}
