// Small pieces both the chat and History draw with: icons, the two avatars, the
// "Name  time" sender line, and gold match highlighting.
import { useState } from 'react'
import compassMark from '../components/intro/assets/compass-mark.png'
import { stampText } from './chatTime'
import { highlightRuns } from './chatSearch'
import styles from './AgentPanel.module.css'

// Header icons: one stroke family (1.7 on a 24 grid), so the three read as a set.
const HEAD_ICON = {
  new: <><path d="M12 20h8" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" /></>,
  history: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" /><path d="M12 7.5V12l3 2" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  pin: <><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z" /><path d="M12 14v6" /></>,
  unpin: <><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z" /><path d="M12 14v6" /><path d="M4 4l16 16" /></>,
  edit: <><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4h6v3" /></>,
}

export function HeadIcon({ name }) {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{HEAD_ICON[name]}</svg>
}

// The UCT compass — the same artwork as the sidebar logo.
export function AgentAvatar() {
  return <span className={styles.avatar} aria-hidden="true"><img src={compassMark} alt="" /></span>
}

export function MemberAvatar({ id }) {
  const [photo, setPhoto] = useState(false)
  return (
    <span className={`${styles.avatar} ${styles.memberAvatar}`} aria-hidden="true">
      {id != null && (
        <img src={`/api/auth/avatar/${id}`} alt="" className={photo ? styles.photo : styles.photoHidden}
          onLoad={(e) => setPhoto(e.currentTarget.naturalWidth > 2)} onError={() => setPhoto(false)} />
      )}
      {!photo && (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
        </svg>
      )}
    </span>
  )
}

export function SenderLine({ name, at, right }) {
  return (
    <span className={`${styles.senderLine} ${right ? styles.senderRight : ''}`}>
      <span className={styles.sender}>{name}</span>
      {at != null && <time className={styles.stamp} dateTime={new Date(at).toISOString()}>{stampText(at)}</time>}
    </span>
  )
}

// A search match, in gold.
export function Hl({ text, query }) {
  return highlightRuns(text, query).map((r, i) => (r.hit ? <mark key={i} className={styles.hit}>{r.text}</mark> : <span key={i}>{r.text}</span>))
}
