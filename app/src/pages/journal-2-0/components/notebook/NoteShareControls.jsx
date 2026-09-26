// The editor's Share door: share links and publish-to-web for this note (wave 8, lane 8B).
//
// ⛔ ONE DOOR IN THE EDITOR (ruling D-B8): a share link, the note's published page, and the
// folder's published page all live in this one popover. There is no FolderSidebar door; the
// folder is published from here, from a note inside it, and managed in Settings → Sharing &
// publishing (SharingCard.jsx).
//
// ⛔ WHO SEES IT: a PAID member, and only while a gate is on. `j2_share_links_enabled` shows the
// share-link section, `notebook_publish_enabled` the publish section; both are latched from the
// auth payload for the life of the tab (lib/offline/notebookFlags.js). The admin special case
// that stood here is GONE (finding F-ADMIN-GATE): admins follow the flags like everyone else.
// A member whose plan lapsed still sees and revokes every link in Settings, which is not
// plan-gated (ruling D-B3).
//
// It opens a `Sheet` (a centered dialog on desktop, a bottom sheet on touch), which owns focus
// trapping, Escape and focus return. Nothing is fetched until it opens: the editor already
// makes enough requests on mount.
//
// ⚠️ The trigger borrows NoteEditorPage.module.css's `.chromeBtn` so it sits in the editor's
// header row like its neighbours (lane 8A owns that stylesheet; do not rename the class).
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../../../../context/AuthContext'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { noteShareEndpoint, sharedNoteUrl, SHARE_EXPIRY_CHOICES } from '../../lib/noteShareLink'
import { PUBLISH_ENDPOINT, publishedUrl } from '../../lib/notePublishLink'
import editorStyles from './NoteEditorPage.module.css'
import styles from './NoteShareControls.module.css'

/** The server's sentence when it sent one, else ours. */
async function requestJson(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
  })
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok) {
    const detail = body && typeof body.detail === 'string' ? body.detail : null
    const err = new Error(detail || String(res.status))
    err.detail = detail
    err.status = res.status
    throw err
  }
  return body || {}
}

function whenText(expiresAt) {
  if (!expiresAt) return 'It never expires.'
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) return 'It never expires.'
  return `It stops working on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through: the address is on screen to copy by hand */ }
  return false
}

export default function NoteShareControls({ noteId, onMessage }) {
  const { isPaid } = useAuth()
  const [open, setOpen] = useState(false)
  const shareOn = notebookFlag('j2_share_links_enabled') === true
  const publishOn = notebookFlag('notebook_publish_enabled') === true
  if (!noteId || isPaid !== true || (!shareOn && !publishOn)) return null
  return (
    <>
      <button
        type="button"
        className={editorStyles.chromeBtn}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={publishOn ? 'Share a link to this note or publish it to the web' : 'Share a read-only link to this note'}
        onClick={() => setOpen(true)}
      >
        <UIcon name="link" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Share
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Share this note" ariaLabel="Share this note" maxWidth={460}>
        {open && (
          <SharePanel noteId={noteId} shareOn={shareOn} publishOn={publishOn} onMessage={onMessage} />
        )}
      </Sheet>
    </>
  )
}

function SharePanel({ noteId, shareOn, publishOn, onMessage }) {
  const [loading, setLoading] = useState(true)
  const [share, setShare] = useState(null)
  const [pubs, setPubs] = useState([])
  const [ctx, setCtx] = useState(null)
  const [expiry, setExpiry] = useState('never')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  // M-3: ids from useId, never fixed strings -- split view mounts two editors, so two of these
  // popovers can exist at once, and a fixed id would be a duplicate the moment both open.
  const uid = useId()
  const ids = {
    shareHeading: `${uid}-share-heading`,
    expiry: `${uid}-expiry`,
    revokeCaption: `${uid}-revoke-caption`,
    publishHeading: `${uid}-publish-heading`,
  }
  // ⛔ Final review M-1: every action below swaps the control that was pressed for another
  // (Create link -> the address and Copy link; Revoke -> Create link; Publish -> Copy page link;
  // Unpublish -> Publish). The pressed button leaves the DOM, and focus with it -- a keyboard
  // member was dropped on <body> with the status line announcing a result they could no longer
  // act from. So the action names where focus goes NEXT, and once the busy state has cleared
  // (the new control is disabled until then, and a disabled button cannot take focus) that
  // control takes it.
  const focusRefs = {
    create: useRef(null),
    copyLink: useRef(null),
    publishNote: useRef(null),
    copyPage: useRef(null),
    publishFolder: useRef(null),
    copyFolder: useRef(null),
  }
  const focusNextRef = useRef(null)
  useEffect(() => {
    if (busy || !focusNextRef.current) return
    const target = focusRefs[focusNextRef.current]?.current
    focusNextRef.current = null
    target?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, share, pubs])

  const say = useCallback((msg) => {
    setStatus(msg)
    onMessage?.(msg)
  }, [onMessage])

  useEffect(() => {
    let alive = true
    const jobs = []
    if (shareOn) {
      jobs.push(requestJson(noteShareEndpoint(noteId))
        .then((b) => { if (alive) setShare(b.share || null) }).catch(() => {}))
    }
    if (publishOn) {
      jobs.push(requestJson(`${PUBLISH_ENDPOINT}?note_id=${encodeURIComponent(noteId)}`)
        .then((b) => {
          if (!alive) return
          setPubs(Array.isArray(b.publications) ? b.publications : [])
          setCtx(b.note || null)
        }).catch(() => {}))
    }
    Promise.all(jobs).then(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [noteId, shareOn, publishOn])

  const livePub = (kind, targetId) => pubs.find((p) => p.kind === kind && p.targetId === targetId && p.state === 'active') || null
  const notePub = livePub('note', noteId)
  const folderPub = ctx?.folderId ? livePub('folder', ctx.folderId) : null

  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const createLink = () => run(async () => {
    try {
      const choice = SHARE_EXPIRY_CHOICES.find((c) => String(c.days ?? 'never') === expiry)
      const b = await requestJson(noteShareEndpoint(noteId), {
        method: 'POST', body: JSON.stringify({ expiresInDays: choice ? choice.days : null }),
      })
      setShare(b.share)
      focusNextRef.current = 'copyLink'
      const copied = await copyText(sharedNoteUrl(b.share.token))
      say(copied ? 'Share link created and copied.' : 'Share link created. Copy the address above.')
    } catch (e) {
      say(e.detail || 'Could not create the link. Try again.')
    }
  })

  const copyLink = () => run(async () => {
    const copied = await copyText(sharedNoteUrl(share.token))
    say(copied ? 'Share link copied.' : 'Copy the address above.')
  })

  const revokeLink = () => run(async () => {
    try {
      await requestJson(noteShareEndpoint(noteId), { method: 'DELETE' })
      setShare(null)
      focusNextRef.current = 'create'
      say('Link revoked. It no longer works.')
    } catch (e) {
      say(e.detail || 'Could not revoke the link. Try again.')
    }
  })

  const publish = (kind) => run(async () => {
    const url = kind === 'note'
      ? `${PUBLISH_ENDPOINT}/notes/${encodeURIComponent(noteId)}`
      : `${PUBLISH_ENDPOINT}/folders/${encodeURIComponent(ctx.folderId)}`
    try {
      const b = await requestJson(url, { method: 'POST', body: JSON.stringify({ expiresInDays: null }) })
      const pub = { ...b.publication, state: 'active' }
      setPubs((prev) => [pub, ...prev.filter((p) => p.slug !== pub.slug)])
      focusNextRef.current = kind === 'note' ? 'copyPage' : 'copyFolder'
      const copied = await copyText(publishedUrl(pub.slug))
      const what = kind === 'note' ? 'Published' : `Published "${ctx.folderName}"`
      say(copied ? `${what}. Page link copied.` : `${what}. Copy the address above.`)
    } catch (e) {
      say(e.detail || 'Could not publish. Try again.')
    }
  })

  const copyPage = (pub) => run(async () => {
    const copied = await copyText(publishedUrl(pub.slug))
    say(copied ? 'Page link copied.' : 'Copy the address above.')
  })

  const unpublish = (pub) => run(async () => {
    try {
      await requestJson(`${PUBLISH_ENDPOINT}/${encodeURIComponent(pub.slug)}`, { method: 'DELETE' })
      setPubs((prev) => prev.filter((p) => p.slug !== pub.slug))
      focusNextRef.current = pub.kind === 'folder' ? 'publishFolder' : 'publishNote'
      say('Unpublished. The page no longer works.')
    } catch (e) {
      say(e.detail || 'Could not unpublish. Try again.')
    }
  })

  if (loading) {
    return <div className={styles.panel} role="status" aria-live="polite">Loading…</div>
  }

  return (
    <div className={styles.panel}>
      {shareOn && (
        <section className={styles.section} aria-labelledby={ids.shareHeading}>
          <h3 id={ids.shareHeading} className={styles.heading}>Share link</h3>
          {!share ? (
            <>
              <p className={styles.lede}>
                Anyone with the link can read this note without signing in. Price charts are not shown.
              </p>
              <div className={styles.row}>
                <label className={styles.label} htmlFor={ids.expiry}>Link stops working</label>
                <select
                  id={ids.expiry}
                  className={styles.select}
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  disabled={busy}
                >
                  {SHARE_EXPIRY_CHOICES.map((c) => (
                    <option key={String(c.days)} value={String(c.days ?? 'never')}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className={styles.row}>
                <button type="button" ref={focusRefs.create} className={styles.action} onClick={createLink} disabled={busy}>Create link</button>
              </div>
            </>
          ) : (
            <>
              <input
                className={styles.field}
                readOnly
                value={sharedNoteUrl(share.token)}
                aria-label="Share link address"
                onFocus={(e) => e.target.select()}
              />
              <p className={styles.caption}>{whenText(share.expiresAt)}</p>
              <div className={styles.row}>
                <button type="button" ref={focusRefs.copyLink} className={styles.action} onClick={copyLink} disabled={busy}>Copy link</button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.danger}`}
                  onClick={revokeLink}
                  disabled={busy}
                  aria-describedby={ids.revokeCaption}
                >
                  Revoke link
                </button>
              </div>
              <p id={ids.revokeCaption} className={styles.caption}>It stops working immediately.</p>
            </>
          )}
        </section>
      )}

      {publishOn && (
        <section className={styles.section} aria-labelledby={ids.publishHeading}>
          <h3 id={ids.publishHeading} className={styles.heading}>Publish to the web</h3>
          <p className={styles.lede}>
            A published page can be read by anyone with its address, without signing in. Search engines are asked not to index it.
          </p>
          {notePub ? (
            <>
              <input
                className={styles.field}
                readOnly
                value={publishedUrl(notePub.slug)}
                aria-label="Published page address"
                onFocus={(e) => e.target.select()}
              />
              <div className={styles.row}>
                <button type="button" ref={focusRefs.copyPage} className={styles.action} onClick={() => copyPage(notePub)} disabled={busy}>Copy page link</button>
                <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => unpublish(notePub)} disabled={busy}>
                  Unpublish
                </button>
              </div>
            </>
          ) : ctx?.publishable === false && ctx?.exists ? (
            // Wave-8 backend M-3: the server refuses to publish an ARCHIVED note, and says so in
            // `publishable`. Say why here instead of offering a button whose only result is an
            // error. `=== false` on purpose: a server that predates the field sends nothing, and
            // the button stays (its refusal sentence still reaches the member).
            <p className={styles.caption}>This note is archived. Unarchive it from the note menu to publish it.</p>
          ) : (
            <div className={styles.row}>
              <button type="button" ref={focusRefs.publishNote} className={styles.action} onClick={() => publish('note')} disabled={busy}>Publish this note</button>
            </div>
          )}
          {ctx?.folderId && (
            folderPub ? (
              <>
                <input
                  className={styles.field}
                  readOnly
                  value={publishedUrl(folderPub.slug)}
                  aria-label={`Published folder address, ${ctx.folderName}`}
                  onFocus={(e) => e.target.select()}
                />
                <div className={styles.row}>
                  <button type="button" ref={focusRefs.copyFolder} className={styles.action} onClick={() => copyPage(folderPub)} disabled={busy}>Copy folder link</button>
                  <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => unpublish(folderPub)} disabled={busy}>
                    Unpublish folder
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.row}>
                  <button type="button" ref={focusRefs.publishFolder} className={styles.action} onClick={() => publish('folder')} disabled={busy}>
                    {`Publish folder "${ctx.folderName}"`}
                  </button>
                </div>
                <p className={styles.caption}>
                  Publishes up to 500 notes in this folder and the folders inside it. A note added later appears when you update the page in Settings.
                </p>
              </>
            )
          )}
        </section>
      )}

      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </div>
  )
}
