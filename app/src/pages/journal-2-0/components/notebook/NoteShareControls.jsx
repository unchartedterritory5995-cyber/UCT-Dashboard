// The editor's share-link controls: Share / Copy link / Unshare (wave 8 seam S8-3).
//
// ⛔ MOVED, NOT CHANGED. Everything below stood inside NoteEditorPage.jsx — the admin
// gate, the status read, the mint-then-copy, the revoke and every `onMessage` sentence —
// and was lifted out so lane 8B can build the member door (ruling D-B8: note share and
// publish live HERE) without editing the editor, which is lane 8A's file this wave.
// `onMessage` is the editor's `setChromeMsg`, so the sentences land where they always did.
//
// ⚠️ Still ADMIN-ONLY, exactly as before: the server gate (`J2_SHARE_LINKS_ENABLED`, ruling
// D-B9) stays off, and replacing `isAdmin` with the payload flag is lane 8B's change.
//
// ⚠️ It borrows NoteEditorPage.module.css's `.chromeBtn` so the buttons render exactly as
// before. A rename of that class in the editor's stylesheet reaches these buttons too.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../../context/AuthContext'
import { sharedNoteUrl } from '../../lib/noteShareLink'
import styles from './NoteEditorPage.module.css'

export default function NoteShareControls({ noteId, onMessage }) {
  const { user } = useAuth()
  // Share links: admin-only surface while the owner evaluates (the server
  // pair is additionally flag-gated). One active token per note; Unshare
  // revokes it — a leaked link dies instantly.
  const isAdmin = user?.role === 'admin'
  const [share, setShare] = useState(null)
  useEffect(() => {
    if (!isAdmin || !noteId) return undefined
    let alive = true
    fetch(`/api/j2/notes/${noteId}/share`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { share: null }))
      .then((b) => { if (alive) setShare(b.share) })
      .catch(() => {})
    return () => { alive = false }
  }, [isAdmin, noteId])
  const copyShareLink = async () => {
    try {
      let s = share
      if (!s) {
        const res = await fetch(`/api/j2/notes/${noteId}/share`, { method: 'POST', credentials: 'include' })
        if (!res.ok) throw new Error(String(res.status))
        s = (await res.json()).share
        setShare(s)
      }
      await navigator.clipboard.writeText(sharedNoteUrl(s.token))
      onMessage('Share link copied')
    } catch {
      onMessage('share failed')
    }
  }
  const unshare = async () => {
    await fetch(`/api/j2/notes/${noteId}/share`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
    setShare(null)
    onMessage('Link revoked')
  }
  if (!isAdmin) return null
  return (
    <>
      <button type="button" className={styles.chromeBtn} onClick={copyShareLink}
        title={share ? 'Copy the public link to this note' : 'Create a public read-only link and copy it'}>
        {share ? 'Copy link' : 'Share'}
      </button>
      {share && (
        <button type="button" className={styles.chromeBtn} onClick={unshare}
          title="Revoke the public link — it stops working immediately">
          Unshare
        </button>
      )}
    </>
  )
}
