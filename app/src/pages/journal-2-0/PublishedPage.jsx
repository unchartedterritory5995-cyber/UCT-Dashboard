import styles from './SharedNotePage.module.css'

/**
 * The far end of a PUBLISHED note or folder — a STUB (wave 8 seam S8-4). Lane 8B builds it.
 *
 * Routed now (App.jsx, both PUBLISHED_ROUTE and PUBLISHED_NOTE_ROUTE, lazily, outside
 * AuthGuard like a share link) so the lane fills this file without touching App.jsx.
 * Until then it shows the same "no longer available" state a revoked share link shows —
 * true for every URL under `/p/` today, since nothing can be published while
 * NOTEBOOK_PUBLISH_ENABLED is dark (ruling D-B9).
 *
 * ⛔ The server marks these URLs noindex + no-referrer by PATH (api/main.py,
 * PUBLIC_NOTE_PATH_PREFIXES); lane 8B adds the in-page robots/referrer meta too.
 * ⚠️ It borrows SharedNotePage.module.css for the gone state — both are 8B's files.
 */
export default function PublishedPage() {
  return (
    <div className={styles.page}>
      <div className={styles.centered} data-testid="published-page-gone">
        <div className={styles.goneTitle}>This page is no longer available.</div>
        <div className={styles.goneWhy}>It may have been unpublished or removed.</div>
      </div>
    </div>
  )
}
