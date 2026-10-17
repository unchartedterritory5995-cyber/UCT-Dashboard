// P3a Task 9: one author's page inside the community library (TemplateGallery.jsx opens it from an
// author's name on a style card). Lazy-only, like the gallery that renders it.
//
// It shows the author's display label, how many items they have published, a Follow / Following
// toggle (aria-pressed; not offered on your own page, which the server refuses too), and their listed
// items: StyleLibraryCard for a style, the gallery's own card (via `renderOutline`) for an outline.
// "Back to the library" returns to the list the member came from; its filters live in the gallery
// and were never reset.
// ⛔ The author is the opaque handle (R-P3-2). The page carries a label, never an id or an email.
import { useEffect, useId, useRef, useState } from 'react'
import { followAuthor, useAuthorPage } from '../../lib/styleLibrary'
import StyleLibraryCard, { refusalSentence } from './StyleLibraryCard'
import styles from './TemplateGallery.module.css'

export default function AuthorView({ handle, onBack, onMessage, onPreview, onAdopted, renderOutline, busy = false }) {
  const uid = useId()
  const headingRef = useRef(null)
  const { author, items, error, isLoading } = useAuthorPage(handle)
  const [following, setFollowing] = useState(null)        // null: what the page said
  const [working, setWorking] = useState(false)
  const isFollowing = following ?? Boolean(author?.following)

  useEffect(() => { if (author) headingRef.current?.focus() }, [author])

  const toggleFollow = async () => {
    if (working || !author) return
    setWorking(true)
    try {
      const out = await followAuthor(handle, !isFollowing)
      setFollowing(Boolean(out?.following))
      onMessage?.({ tone: 'ok', text: out?.following
        ? `Following ${author.label}. Their new styles show under Following.`
        : `You no longer follow ${author.label}.` })
    } catch (err) {
      onMessage?.({ tone: 'error', text: refusalSentence(err, `Couldn't change whether you follow ${author.label}. Nothing was changed.`) })
    } finally {
      setWorking(false)
    }
  }

  const back = (
    <button type="button" className={styles.btn} onClick={onBack}>Back to the library</button>
  )

  if (error) {
    return (
      <div className={styles.section}>
        {back}
        <p className={styles.error} role="alert">Couldn't load this author's page.</p>
      </div>
    )
  }
  if (isLoading || !author) {
    return (
      <div className={styles.section}>
        {back}
        <p className={styles.note} role="status">Loading this author's page…</p>
      </div>
    )
  }
  return (
    <section className={styles.section} aria-labelledby={`${uid}-author`} data-library-author={handle}>
      {back}
      <div className={styles.authorHead}>
        <h4 className={styles.heading} id={`${uid}-author`} ref={headingRef} tabIndex={-1}>{author.label}</h4>
        <span className={styles.meta}>{Number(author.itemCount) || 0} published</span>
        {!author.mine && (
          <button type="button" className={`${styles.btn} ${isFollowing ? styles.primary : ''}`}
            onClick={toggleFollow} disabled={working} aria-pressed={isFollowing}
            aria-label={`${isFollowing ? 'Following' : 'Follow'} ${author.label}`}>
            {isFollowing ? 'Following' : 'Follow'}
          </button>
        )}
      </div>
      {items.length ? (
        <ul className={styles.grid} aria-label={`Published by ${author.label}`}>
          {items.map((item) => (item.itemType === 'style' ? (
            <StyleLibraryCard key={item.id} item={item} busy={busy} onPreview={onPreview} onAdopted={onAdopted}
              onMessage={onMessage} />
          ) : (renderOutline ? renderOutline(item) : null)))}
        </ul>
      ) : (
        <p className={styles.note}>Nothing listed yet.</p>
      )}
    </section>
  )
}
