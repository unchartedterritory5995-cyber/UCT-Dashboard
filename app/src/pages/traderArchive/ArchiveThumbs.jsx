// app/src/pages/traderArchive/ArchiveThumbs.jsx
//
// The charts a trader posted with an archive post. Ids come from the server (`images` on a
// record row); the bytes come from GET /api/wisdom/archive/image/{id}, which is require_paid,
// so an <img> on this same-origin page carries the session cookie and nothing is public.
// Thumbnails load lazily; a click opens the full image, Escape, Close or a click closes it.
// The open image is a real modal: focus moves to its Close button, Tab stays inside, and focus
// returns to the thumb that opened it. Without that, Tab reached the next post's thumb under the
// overlay and Enter opened a second lightbox on top of the first.
import { useEffect, useRef, useState } from 'react'

import { ARCHIVE_API } from '../../utils/traderArchive'
import { registerShortcuts } from '../command/shortcutRegistry'
import useFocusTrap from '../../components/mobile/useFocusTrap'
import styles from './TraderArchive.module.css'

export const imageUrl = (id) => `${ARCHIVE_API}/image/${encodeURIComponent(id)}`

export default function ArchiveThumbs({ ids, max = 4, label = 'Chart' }) {
  const [open, setOpen] = useState(null)
  const shown = (Array.isArray(ids) ? ids : []).slice(0, max)
  const openerRef = useRef(null)
  const boxRef = useRef(null)
  const closeRef = useRef(null)

  useFocusTrap(!!open, boxRef)
  // Focus moves in on open and goes back to the opener on close (or unmount).
  useEffect(() => {
    if (!open) return undefined
    const opener = openerRef.current
    closeRef.current?.focus()
    return () => { if (opener && opener.isConnected) opener.focus() }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    return registerShortcuts({ 'archive.lightboxClose': () => setOpen(null) })
  }, [open])

  if (!shown.length) return null
  return (
    <div className={styles.thumbs}>
      {shown.map((id, i) => (
        <button key={id} type="button" className={styles.thumb} onClick={(e) => { openerRef.current = e.currentTarget; setOpen(id) }}
          aria-label={`Open ${label.toLowerCase()} ${i + 1} of ${shown.length}`}>
          <img className={styles.thumbImg} src={imageUrl(id)} alt={`${label} ${i + 1}`} loading="lazy" decoding="async" />
        </button>
      ))}
      {open && (
        <div ref={boxRef} className={styles.lightbox} role="dialog" aria-modal="true" aria-label={label}
          data-testid="archive-lightbox" tabIndex={-1} onClick={() => setOpen(null)}>
          <button ref={closeRef} type="button" className={styles.lightboxClose}
            aria-label={`Close ${label.toLowerCase()}`} onClick={() => setOpen(null)}>Close</button>
          <img className={styles.lightboxImg} src={imageUrl(open)} alt={label} />
        </div>
      )}
    </div>
  )
}
