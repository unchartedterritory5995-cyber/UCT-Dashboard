// The admin pair on a gallery card: Feature/Unfeature and Hide (P5 fix round 1, ruling P5-T9-R1).
// ONE copy, rendered by GalleryCard (outline cards, TemplateGallery.jsx) and by StyleLibraryCard (style
// cards). Before this, style cards had no admin control at all, so featuring a community style or taking
// a listed one down meant a console call.
//   * Each action is the review queue's own PATCH (`reviewGalleryTemplate`, which also refreshes the
//     gallery), then the caller's `onChanged` (the gallery's `refresh`).
//   * Hide is a visibility state: the item leaves the library and stays in the Review queue under Hidden,
//     where Unhide brings it back. Nothing here deletes anything.
//   * The caller renders this only for an admin; the server refuses a member anyway (require_admin).
// Lazy-only: both callers live in the gallery's lazy chunk.
import { useState } from 'react'
import { reviewGalleryTemplate } from '../../lib/templateGallery'
import styles from './TemplateGallery.module.css'

export default function GalleryAdminActions({ item, onChanged, onMessage }) {
  const [working, setWorking] = useState(false)
  const admin = async (action) => {
    setWorking(true)
    try {
      await reviewGalleryTemplate(item.id, action)
      onMessage?.({ tone: 'ok', text: action === 'hide' ? `Hid “${item.title}”. It is still in the Review queue.`
        : action === 'feature' ? `“${item.title}” is now a UCT pick.` : `“${item.title}” is no longer a UCT pick.` })
      onChanged?.()
    } catch (err) {
      onMessage?.({ tone: 'error', text: err?.message || "Couldn't update that template." })
    } finally {
      setWorking(false)
    }
  }
  return (
    <>
      <button type="button" className={styles.btn} disabled={working}
        onClick={() => admin(item.featured ? 'unfeature' : 'feature')}
        aria-label={`${item.featured ? 'Unfeature' : 'Feature'} ${item.title}`}>
        {item.featured ? 'Unfeature' : 'Feature'}
      </button>
      <button type="button" className={styles.btn} disabled={working} onClick={() => admin('hide')}
        aria-label={`Hide ${item.title}`}>
        Hide
      </button>
    </>
  )
}
