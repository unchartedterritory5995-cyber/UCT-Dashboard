// The sidebar's folder door to publish-to-web (wave 9, lane 9D, item D2; ruling D-B8's
// wave-9 hand-off). FolderSidebar renders it as an `extraFolderActions` button; NotebookTab
// supplies the action and mounts this sheet. FolderSidebar is not edited (ruling D-9D3).
//
// ⛔⛔ A CONFIRMATION, NOT A ONE-CLICK PUBLISH (ruling D-9D1). Publishing a folder makes up to
// 500 notes public. The editor's per-note door is itself a deliberate popover, so this door must
// not be faster than it: selecting the action opens this sheet, which says what becomes public in
// the SAME sentences the editor's Share door uses (lib/notePublishLink.js — moved there, never
// copied), and nothing is sent until the member presses Publish.
//
// ⛔ ONE PUBLISH CALL (ruling D-9D2): `publishTarget('folder', id)` is the helper the Share door
// uses. It posts ONCE: a second press while the first is in flight is refused here (a ref, not
// state — two clicks can land before a re-render disables the button), and the button is gone
// once the page exists. A folder that already has a live page shows that page's address instead
// of a Publish button (`findLivePublication`); the server keeps one live page per folder anyway.
//
// ⛔ A refusal shows the SERVER's sentence as it stands (a plan, the rate limit, a folder that is
// gone); ours only when the server sent none.
//
// ⛔ FOCUS: the Sheet traps it, closes on Escape and hands it back to whatever was focused when it
// opened. That is the folder's action button after a keyboard press or a Chromium click — but
// Safari does not focus a clicked button, so the caller also passes `returnFocusTo` (the action
// button it found) and this component focuses it once the sheet has closed. After a publish, focus
// goes to Copy link: the Publish button that held it has left the DOM (the Share door's M-1 rule).
import { useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import {
  FOLDER_PUBLISH_SCOPE_SENTENCE, PUBLISH_ENDPOINT, PUBLISH_FAILED_SENTENCE, PUBLISH_PUBLIC_SENTENCE,
  copyText, findLivePublication, pageCopiedSentence, publishTarget, publishedSentence, publishedUrl, requestJson,
} from '../../lib/notePublishLink'
import styles from './PublishFolderSheet.module.css'

/** The sheet's title (and its accessible name). */
const publishFolderTitle = (name) => `Publish folder "${name}"`

/** Said when the folder already has a live page: its address is shown instead of Publish. */
const ALREADY_PUBLISHED_SENTENCE = 'This folder is already published. Anyone with its address can read it.'

/** Where a published page is updated, re-timed or taken down. */
const MANAGE_IN_SETTINGS_SENTENCE = 'Update or unpublish it in Settings → Sharing & publishing.'

export default function PublishFolderSheet({ open, folder, onClose, returnFocusTo = null }) {
  // Focus back to the folder's action once the sheet has closed. This runs AFTER the Sheet's own
  // restore (effect cleanups run before effect bodies in one commit), so it has the last word.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    if (returnFocusTo && returnFocusTo.isConnected && typeof returnFocusTo.focus === 'function') returnFocusTo.focus()
  }, [open, returnFocusTo])

  const name = folder?.name || 'this folder'
  const title = publishFolderTitle(name)
  return (
    <Sheet open={Boolean(open && folder)} onClose={onClose} title={title} ariaLabel={title} maxWidth={460}>
      {open && folder && <PublishFolderPanel key={folder.id} folder={folder} onClose={onClose} />}
    </Sheet>
  )
}

function PublishFolderPanel({ folder, onClose }) {
  const [loading, setLoading] = useState(true)
  const [pub, setPub] = useState(null)
  const [already, setAlready] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const inFlight = useRef(false)
  const copyRef = useRef(null)
  const focusCopy = useRef(false)
  const uid = useId()
  const ids = { public: `${uid}-public`, scope: `${uid}-scope` }

  // Does this folder already have a live page? Read once, when the sheet opens.
  useEffect(() => {
    let alive = true
    requestJson(PUBLISH_ENDPOINT)
      .then((b) => {
        if (!alive) return
        const live = findLivePublication(Array.isArray(b.publications) ? b.publications : [], 'folder', folder.id)
        if (live) {
          setPub(live)
          setAlready(true)
        }
      })
      // A list that would not load is not a reason to hide the door: publishing an already
      // published folder answers its existing page, never a second one.
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [folder.id])

  // After a publish the Publish button has left the DOM; Copy link takes focus once enabled.
  useEffect(() => {
    if (busy || !focusCopy.current || !copyRef.current) return
    focusCopy.current = false
    copyRef.current.focus()
  }, [busy, pub])

  const publish = async () => {
    if (inFlight.current || pub) return
    inFlight.current = true
    setBusy(true)
    try {
      const made = await publishTarget('folder', folder.id)
      setPub(made)
      focusCopy.current = true
      const copied = await copyText(publishedUrl(made.slug))
      setStatus(publishedSentence(folder.name, copied))
    } catch (e) {
      setStatus(e.detail || PUBLISH_FAILED_SENTENCE)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!pub || busy) return
    setStatus(pageCopiedSentence(await copyText(publishedUrl(pub.slug))))
  }

  if (loading) {
    return <div className={styles.panel} role="status" aria-live="polite">Loading…</div>
  }

  return (
    <div className={styles.panel}>
      {pub ? (
        <>
          {already && <p className={styles.lede}>{ALREADY_PUBLISHED_SENTENCE}</p>}
          <input
            className={styles.field}
            readOnly
            value={publishedUrl(pub.slug)}
            aria-label={`Published folder address, ${folder.name}`}
            onFocus={(e) => e.target.select()}
          />
          <div className={styles.row}>
            <button type="button" ref={copyRef} className={styles.action} onClick={copyLink} disabled={busy}>
              Copy link
            </button>
            <button type="button" className={styles.action} onClick={onClose}>Done</button>
          </div>
          <p className={styles.caption}>{MANAGE_IN_SETTINGS_SENTENCE}</p>
        </>
      ) : (
        <>
          <p id={ids.public} className={styles.lede}>{PUBLISH_PUBLIC_SENTENCE}</p>
          <p id={ids.scope} className={styles.caption}>{FOLDER_PUBLISH_SCOPE_SENTENCE}</p>
          <div className={styles.row}>
            <button type="button" className={styles.action} onClick={onClose} disabled={busy}>Cancel</button>
            <button
              type="button"
              className={`${styles.action} ${styles.primary}`}
              onClick={publish}
              disabled={busy}
              aria-describedby={`${ids.public} ${ids.scope}`}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </>
      )}
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </div>
  )
}
