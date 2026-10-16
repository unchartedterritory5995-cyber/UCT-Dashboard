// app/src/pages/traderArchive/ArchiveThumbs.jsx
//
// The charts a trader posted with an archive post. Ids come from the server (`images` on a
// record row); the bytes come from GET /api/wisdom/archive/image/{id}, which is require_paid,
// so an <img> on this same-origin page carries the session cookie and nothing is public.
// Thumbnails load lazily; a click opens the full image, Escape or a click closes it.
import { useEffect, useState } from 'react'

import { ARCHIVE_API } from '../../utils/traderArchive'
import styles from './TraderArchive.module.css'

export const imageUrl = (id) => `${ARCHIVE_API}/image/${encodeURIComponent(id)}`

export default function ArchiveThumbs({ ids, max = 4, label = 'Chart' }) {
  const [open, setOpen] = useState(null)
  const shown = (Array.isArray(ids) ? ids : []).slice(0, max)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!shown.length) return null
  return (
    <div className={styles.thumbs}>
      {shown.map((id, i) => (
        <button key={id} type="button" className={styles.thumb} onClick={() => setOpen(id)}
          aria-label={`Open ${label.toLowerCase()} ${i + 1} of ${shown.length}`}>
          <img className={styles.thumbImg} src={imageUrl(id)} alt={`${label} ${i + 1}`} loading="lazy" decoding="async" />
        </button>
      ))}
      {open && (
        <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={label}
          data-testid="archive-lightbox" onClick={() => setOpen(null)}>
          <img className={styles.lightboxImg} src={imageUrl(open)} alt={label} />
        </div>
      )}
    </div>
  )
}
