import { useCallback, useEffect, useState } from 'react'
import TileCard from '../../../components/TileCard'
import { notebookFlag } from '../lib/offline/notebookFlags'
import { noteShareEndpoint, SHARE_LINKS_ENDPOINT } from '../lib/noteShareLink'
import { PUBLISH_ENDPOINT } from '../lib/notePublishLink'
import styles from './SharingCard.module.css'

/**
 * Settings → Sharing & publishing (wave 8, lane 8B; ruling D-B8's second door).
 *
 * Every share link and every published page the member has not revoked: its note or folder,
 * when it was made, when it stops working, and whether it is serving. **Revoke** on every row,
 * **Update** on a published folder (the only way a folder page GROWS: ruling D-B6).
 *
 * ⛔ DARK MEANS ABSENT: it renders nothing unless the auth payload latched
 * `j2_share_links_enabled` or `notebook_publish_enabled` ON (ruling D-B9); a tab that has not
 * heard from the server reads as off. Each section shows only while its own gate is on.
 *
 * ⛔ NOT PLAN-GATED, ON PURPOSE (ruling D-B3): a member whose plan lapsed can still see and
 * take down every public link here. Creating one is what is paid, in the editor.
 */
async function requestJson(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts })
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok) {
    const err = new Error(body && typeof body.detail === 'string' ? body.detail : String(res.status))
    err.detail = body && typeof body.detail === 'string' ? body.detail : null
    throw err
  }
  return body || {}
}

const day = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATE_TEXT = {
  active: 'Live',
  expired: 'Expired',
  'note in trash': 'Note in trash',
  'note archived': 'Note archived',
  'note deleted': 'Note deleted',
  'folder deleted': 'Folder deleted',
}

export default function SharingCard() {
  const shareOn = notebookFlag('j2_share_links_enabled') === true
  const publishOn = notebookFlag('notebook_publish_enabled') === true
  if (!shareOn && !publishOn) return null
  return (
    <TileCard icon="link" title="Sharing & publishing">
      <SharingList shareOn={shareOn} publishOn={publishOn} />
    </TileCard>
  )
}

function SharingList({ shareOn, publishOn }) {
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [shares, setShares] = useState([])
  const [pubs, setPubs] = useState([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    try {
      const body = await requestJson(publishOn ? PUBLISH_ENDPOINT : SHARE_LINKS_ENDPOINT)
      setShares(shareOn && Array.isArray(body.shares) ? body.shares : [])
      setPubs(publishOn && Array.isArray(body.publications) ? body.publications : [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [shareOn, publishOn])

  useEffect(() => { load() }, [load])

  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const revokeShare = (s) => run(async () => {
    try {
      await requestJson(noteShareEndpoint(s.noteId), { method: 'DELETE' })
      setShares((prev) => prev.filter((x) => x.token !== s.token))
      setStatus(`Link to "${s.title}" revoked. It no longer works.`)
    } catch (e) {
      setStatus(e.detail || 'Could not revoke the link. Try again.')
    }
  })

  const revokePub = (p) => run(async () => {
    try {
      await requestJson(`${PUBLISH_ENDPOINT}/${encodeURIComponent(p.slug)}`, { method: 'DELETE' })
      setPubs((prev) => prev.filter((x) => x.slug !== p.slug))
      setStatus(`"${p.name}" unpublished. The page no longer works.`)
    } catch (e) {
      setStatus(e.detail || 'Could not unpublish. Try again.')
    }
  })

  const updatePub = (p) => run(async () => {
    try {
      const b = await requestJson(`${PUBLISH_ENDPOINT}/${encodeURIComponent(p.slug)}/refresh`, { method: 'POST' })
      const next = b.publication || {}
      setPubs((prev) => prev.map((x) => (x.slug === p.slug ? { ...x, ...next } : x)))
      const n = typeof next.memberCount === 'number' ? next.memberCount : p.memberCount
      setStatus(`"${p.name}" updated. The page now shows ${n} ${n === 1 ? 'note' : 'notes'}.`)
    } catch (e) {
      setStatus(e.detail || 'Could not update the page. Try again.')
    }
  })

  if (loading) return <p className={styles.note} role="status">Loading…</p>
  if (failed) return <p className={styles.note} role="status">Your links could not be loaded. Reload the page to try again.</p>

  const rows = shares.length + pubs.length
  return (
    <div className={styles.wrap}>
      <p className={styles.note}>
        Anyone with one of these addresses can read the note or folder without signing in, until you revoke it.
      </p>
      {rows === 0 ? (
        <p className={styles.empty}>You have no share links or published pages.</p>
      ) : (
        <ul className={styles.list} aria-label="Your share links and published pages">
          {shares.map((s) => (
            <li key={`s:${s.token}`} className={styles.row}>
              <div className={styles.main}>
                <span className={styles.name}>{s.title || 'Untitled'}</span>
                <span className={styles.meta}>
                  {`Share link · created ${day(s.createdAt)} · ${s.expiresAt ? `expires ${day(s.expiresAt)}` : 'never expires'} · ${STATE_TEXT[s.state] || s.state}`}
                </span>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.action} disabled={busy} onClick={() => revokeShare(s)}
                  aria-label={`Revoke the share link to "${s.title || 'Untitled'}"`}>
                  Revoke
                </button>
              </div>
            </li>
          ))}
          {pubs.map((p) => (
            <li key={`p:${p.slug}`} className={styles.row}>
              <div className={styles.main}>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.meta}>
                  {`${p.kind === 'folder' ? 'Published folder' : 'Published note'} · created ${day(p.createdAt)} · ${p.expiresAt ? `expires ${day(p.expiresAt)}` : 'never expires'} · ${STATE_TEXT[p.state] || p.state}`}
                </span>
                {p.kind === 'folder' && typeof p.memberCount === 'number' && (
                  <span className={styles.meta}>
                    {`${p.memberCount} of up to ${p.memberCap || 500} notes. A note added to the folder appears when you update.`}
                  </span>
                )}
              </div>
              <div className={styles.actions}>
                {p.kind === 'folder' && (
                  <button type="button" className={styles.action} disabled={busy} onClick={() => updatePub(p)}
                    aria-label={`Update the published folder "${p.name}"`}>
                    Update
                  </button>
                )}
                <button type="button" className={styles.action} disabled={busy} onClick={() => revokePub(p)}
                  aria-label={`Revoke the published ${p.kind === 'folder' ? 'folder' : 'note'} "${p.name}"`}>
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </div>
  )
}
