import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PUBLISHED_ENDPOINT, publishedPath } from './lib/notePublishLink'
import { SkeletonLine } from '../../components/Skeleton'
import ReadOnlyNote from './public/ReadOnlyNote'
import PublicPageMeta from './public/PublicPageMeta'
import styles from './SharedNotePage.module.css'

/**
 * 🔴 THE FAR END OF A PUBLISHED NOTE OR FOLDER — public, read-only, shell-less (wave 8, lane 8B).
 *
 * `/p/:slug` is a published note, or a published folder's index; `/p/:slug/n/:pid` is one note
 * inside a published folder (`pid` is the note's id WITHIN the publication, never a member's
 * note id). Both are routed in App.jsx outside AuthGuard: a stranger is never sent to a login.
 *
 * What reaches this page was decided by the server's ONE reducer
 * (`api/services/journal_two/public_note_payload.py`, publish mode): no Ask answers, no
 * citation chips, no properties, tags or ticker, no file attachments, no other notes' titles or
 * ids (a link to another note of the SAME published folder arrives as a link to its page), the
 * market-data line where the owner's legal sign-off says a vendor's content may not be shown,
 * and no author identity. It renders through the same `public/ReadOnlyNote.jsx` a share link
 * does, so the two public surfaces cannot drift into two renderings.
 *
 * ⛔ The page says `noindex` and `no-referrer` in every state (PublicPageMeta); the server
 * says it too, in headers, on the HTML and on every API response.
 */
export default function PublishedPage() {
  const { slug, pid } = useParams()
  const [state, setState] = useState({ status: 'loading', data: null })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading', data: null })
    const s = encodeURIComponent(slug || '')
    const url = pid ? `${PUBLISHED_ENDPOINT}/${s}/n/${encodeURIComponent(pid)}` : `${PUBLISHED_ENDPOINT}/${s}`
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body) => {
        if (!alive) return
        const valid = (body?.kind === 'note' && body.note) || (body?.kind === 'folder' && Array.isArray(body.notes))
        setState(valid ? { status: 'ok', data: body } : { status: 'gone', data: null })
      })
      .catch(() => { if (alive) setState({ status: 'gone', data: null }) })
    return () => { alive = false }
  }, [slug, pid])

  if (state.status === 'loading') {
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
  if (state.status !== 'ok') {
    // One sentence for every dead page: unknown, unpublished, expired, trashed, archived and
    // switched off all answer the same 404 on the server.
    return (
      <div className={styles.page}>
        <PublicPageMeta />
        <main className={styles.centered} data-testid="published-page-gone">
          <h1 className={styles.goneTitle}>This page is no longer available.</h1>
          <p className={styles.goneWhy}>It may have expired, or been unpublished or removed.</p>
        </main>
      </div>
    )
  }
  const { data } = state
  return (
    <div className={styles.page} data-testid="published-page">
      <PublicPageMeta />
      <main>
        {data.kind === 'folder'
          ? <FolderIndex slug={slug} title={data.title} notes={data.notes} />
          : (
            <>
              {data.folder && (
                <nav className={styles.crumbs} aria-label="Published folder">
                  <Link className={styles.crumbLink} to={data.folder.path || publishedPath(slug)}>
                    ← {data.folder.title}
                  </Link>
                </nav>
              )}
              <ReadOnlyNote note={data.note} />
            </>
          )}
      </main>
      <footer className={styles.brandFoot}>
        Published with <span className={styles.brandName}>UCT Intelligence</span> — Navigate the market, effectively.
      </footer>
    </div>
  )
}

function FolderIndex({ slug, title, notes }) {
  return (
    <div className={styles.column}>
      <h1 className={styles.title}>{title || 'Published notes'}</h1>
      {notes.length === 0 ? (
        <p className={styles.subtitle}>This folder has no published notes yet.</p>
      ) : (
        <ul className={styles.index} aria-label={`Notes in ${title || 'this folder'}`}>
          {notes.map((n) => (
            <li key={n.pid} className={styles.indexItem}>
              <Link className={styles.indexLink} to={publishedPath(slug, n.pid)}>{n.title || 'Untitled'}</Link>
              {n.updatedAt && <span className={styles.indexDate}>{dateText(n.updatedAt)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function dateText(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `Updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}
