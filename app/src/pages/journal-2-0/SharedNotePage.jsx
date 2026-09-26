import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { SHARED_NOTE_ENDPOINT } from './lib/noteShareLink'
import { SkeletonLine } from '../../components/Skeleton'
import ReadOnlyNote from './public/ReadOnlyNote'
import PublicPageMeta from './public/PublicPageMeta'
import styles from './SharedNotePage.module.css'

/**
 * 🔴 THE FAR END OF A NOTE SHARE LINK — public, read-only, shell-less.
 *
 * Renders the sanitized payload from `GET /api/j2/shared/{token}` through the ONE public
 * rendering (`public/ReadOnlyNote.jsx`, shared with published pages). What reaches this
 * page was decided by the server's ONE reducer
 * (`api/services/journal_two/public_note_payload.py`, share mode): no note ids, no other
 * notes' titles, no file attachments, and the market-data line where the owner's legal
 * sign-off says a vendor's content may not be shown. Attachment URLs arrive already
 * rewritten to the token-scoped proxy.
 *
 * ⛔ The page makes NO request but the payload (and the payload's own proxied images).
 * A `noteLink` arrives as plain text, which is what keeps `NoteLinkView` — and its
 * `/api/j2/notes/link-targets` read with the VIEWER's cookie — off this page
 * (rail: SharedNotePage.publicRequests.test.jsx).
 */
export default function SharedNotePage() {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading', note: null })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading', note: null })
    fetch(`${SHARED_NOTE_ENDPOINT}/${encodeURIComponent(token || '')}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body) => { if (alive) setState({ status: 'ok', note: body.note }) })
      .catch(() => { if (alive) setState({ status: 'gone', note: null }) })
    return () => { alive = false }
  }, [token])

  if (state.status === 'loading') {
    // G-106 (Wave B lower-frequency sweep): a title-shaped line plus a
    // couple of body-shaped lines, matching the notebook's own note-loading
    // skeleton (NoteEditorPage.jsx) -- this page renders the far end of the
    // same note, so it reuses the same idiom rather than a bare word.
    return (
      <div className={styles.page}>
        <PublicPageMeta />
        <div className={styles.centered} role="status" aria-label="Loading…">
          <SkeletonLine width="55%" height={20} />
          <div style={{ height: 14 }} />
          <SkeletonLine width="90%" height={13} />
          <SkeletonLine width="75%" height={13} />
        </div>
      </div>
    )
  }
  if (state.status !== 'ok' || !state.note) {
    // One sentence for every dead link: unknown, revoked, expired, trashed, archived and
    // switched off all answer the same 404 on the server, so the page cannot (and must
    // not) say which.
    return (
      <div className={styles.page}>
        <PublicPageMeta />
        <main className={styles.centered} data-testid="shared-note-gone">
          <h1 className={styles.goneTitle}>This link is no longer available.</h1>
          <p className={styles.goneWhy}>It may have expired, or the note may have been unshared or removed.</p>
        </main>
      </div>
    )
  }
  return (
    <div className={styles.page} data-testid="shared-note">
      <PublicPageMeta />
      <main>
        <ReadOnlyNote note={state.note} />
      </main>
      <footer className={styles.brandFoot}>
        Written in <span className={styles.brandName}>UCT Intelligence</span> — Navigate the market, effectively.
      </footer>
    </div>
  )
}
