// app/src/pages/community/components/FloorAvatar.jsx
// Discord-style chat avatar: real uploaded avatar when one exists
// (/api/auth/avatar/{id} serves a 1x1 transparent pixel when missing — detected
// via naturalWidth<=2, same trick as CompanyLogo), otherwise a colored initial
// monogram. UCT Mentor (authorId null) gets the gold compass mark.
import { useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import styles from '../Community.module.css'

const MONO_COLORS = [
  '#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e',
  '#9b59b6', '#3498db', '#1abc9c', '#e67e22', '#607d8b',
]

function colorFor(seed) {
  let h = 0
  const s = String(seed || 'member')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return MONO_COLORS[h % MONO_COLORS.length]
}

export default function FloorAvatar({ authorId, name, isMentor, size = 40 }) {
  const [hasImage, setHasImage] = useState(false)

  if (!authorId && isMentor) {
    return (
      <span className={`${styles.floorAvatar} ${styles.floorAvatarMentor}`}
        style={{ width: size, height: size }} aria-hidden="true">
        <UIcon name="compass" size={Math.round(size * 0.55)} />
      </span>
    )
  }

  const initial = (name || 'M').trim().charAt(0).toUpperCase()
  return (
    <span className={styles.floorAvatar}
      style={{ width: size, height: size, background: hasImage ? 'transparent' : colorFor(authorId || name) }}
      aria-hidden="true">
      {!hasImage && <span className={styles.floorAvatarInitial} style={{ fontSize: Math.round(size * 0.42) }}>{initial}</span>}
      {authorId && (
        <img
          src={`/api/auth/avatar/${authorId}`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          style={{ display: hasImage ? 'block' : 'none' }}
          onLoad={(e) => { if (e.target.naturalWidth > 2) setHasImage(true) }}
          onError={() => setHasImage(false)}
        />
      )}
    </span>
  )
}
