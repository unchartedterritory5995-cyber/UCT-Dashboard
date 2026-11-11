// The Share sheet's content (wave 8 lane 8B; audit 2026-11-05, S19 "Share in two clicks"). A LAZY chunk: the editor
// carries only the Share button (NoteShareControls.jsx), and this file is fetched the first time the sheet opens.
//
// ⛔ TWO TABS (M5): "Private link" first and by default, "Publish to the web" second. A private link and a public
// page are different things, so they are never two stacked lists of buttons again.
//   * Private link: what a link does, the expiry (7 days by default, 30 days, Never), "Hide my P&L and position
//     size" (ON by default: the server then shows every account figure as the private line, whatever the widget's
//     own share switch says -- api/services/journal_two/note_shares.py `hide_pnl`), a preview of exactly what a
//     reader will see (the server's own share reducer over this note, GET .../share/preview), then Cancel and
//     "Create link and copy". Two clicks: Share, then Create link and copy.
//   * ⛔ NO "Show live charts" SWITCH. M5 draws one; the server cannot honour it -- a price chart on a public page is
//     a Massive-sourced item, and the owner's vendor ruling (public_note_payload.VENDOR_VERDICT, L3) keeps it the
//     neutral line on every share link. A switch that does nothing is never shown; the line under the lede says so.
//   * Publish to the web: unchanged from Tier 0 -- the first press only ASKS (S1's PublishConfirmSheet, below).
//
// ⛔ THE PUBLISH CALL LIVES IN lib/notePublishLink.js (wave 9, lane 9D, ruling D-9D2): this door and the sidebar's
// folder door (PublishFolderSheet) publish through the ONE `publishTarget`, find an existing page with the ONE
// `findLivePublication`, and say what becomes public in the SAME sentences. Nothing here restates them.
import { Component, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'
import { lazyLeaf } from '../../lib/lazyChunk'
import { noteShareEndpoint, noteSharePreviewEndpoint, sharedNoteUrl } from '../../lib/noteShareLink'
import {
  FOLDER_PUBLISH_SCOPE_SENTENCE, PUBLISH_CONFIRM_NOTE_TITLE, PUBLISH_ENDPOINT, PUBLISH_FAILED_SENTENCE,
  PUBLISH_PUBLIC_SENTENCE, copyText, findLivePublication, pageCopiedSentence, publishConfirmFolderTitle,
  publishConfirmNoteSentence, publishTarget, publishedSentence, publishedUrl, publishUndoneMs, requestJson,
} from '../../lib/notePublishLink'
import LoadFailed from '../LoadFailed'
import styles from './NoteShareControls.module.css'

// The preview renders with the public pages' own renderer, fetched only when the member asks for a preview.
// lazyLeaf, never lazyChunk: it sits inside its own boundary (PreviewCatch), so a stale chunk costs the preview, never a reload.
const ReadOnlyNote = lazyLeaf(() => import('../../public/ReadOnlyNote'))

/** M5's words, verbatim. */
export const SHARE_COPY = Object.freeze({
  privateTab: 'Private link',
  publishTab: 'Publish to the web',
  lede: "Anyone with the link can read this note. They don't need an account.",
  charts: 'Price charts are not shown on a shared page.',
  expiresIn: 'Expires in',
  // Tier 3a fix round 1 (review I2): the switch names exactly what it hides -- P&L widgets (every account figure a
  // widget carries) and images (a broker screenshot is the obvious leak). Text the member typed is never rewritten.
  hidePnl: 'Hide P&L widgets and images',
  typed: 'Text you typed is shared as written.',
  preview: "Preview: see exactly what they'll see →",
  previewHide: 'Hide the preview',
  previewLabel: 'Preview of the shared page',
  previewLoading: 'Loading the preview…',
  previewFailed: "Couldn't load the preview. Try again.",
  cancel: 'Cancel',
  create: 'Create link and copy',
  hidden: 'P&L widgets and images are hidden on this link.',
  // Review minor 11: a link that shows them says so, plainly.
  shown: 'P&L widgets you switched to share, and your images, are shown on this link.',
  // Ruling I1: a request to show over a link that already hides is answered with the link as it is.
  kept: 'This link already hides P&L. Make a new link to change it.',
})

/** The expiry choices this sheet offers (M5), in order; the first is the default. The server accepts these and 90. */
export const SHARE_EXPIRY_OPTIONS = Object.freeze([
  { value: '7', days: 7, label: '7 days' },
  { value: '30', days: 30, label: '30 days' },
  { value: 'never', days: null, label: 'Never' },
])

// ⛔ Wave 10 F7 (Part A, voice): a server's `detail` is shown only for a REFUSAL (4xx), which
// the server writes for members ("needs a paid plan"). A fault (5xx) or a dropped connection
// carries whatever the server raised, so those read the fixed sentence instead.
function memberDetail(e, fallback) {
  const status = Number(e?.status)
  return (status >= 400 && status < 500 && e?.detail) ? e.detail : fallback
}

function whenText(expiresAt) {
  if (!expiresAt) return 'It never expires.'
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) return 'It never expires.'
  return `It stops working on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`
}

/** A preview that fails to render says one line; it never takes the sheet down. */
class PreviewCatch extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p className={styles.caption}>{SHARE_COPY.previewFailed}</p> : this.props.children }
}

export default function SharePanel({ noteId, noteTitle, shareOn, publishOn, onMessage, onClose }) {
  const [loading, setLoading] = useState(true)
  const [share, setShare] = useState(null)
  const [pubs, setPubs] = useState([])
  const [ctx, setCtx] = useState(null)
  const [tab, setTab] = useState(shareOn ? 'link' : 'publish')
  const [expiry, setExpiry] = useState(SHARE_EXPIRY_OPTIONS[0].value)
  const [hidePnl, setHidePnl] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState({ status: 'idle', note: null })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  // ⛔ Audit 2026-11-05, spec S1 (bug: one press published). "Publish this note" and "Publish
  // folder" each open a confirm step -- a nested Sheet, the same component the sidebar uses, which owns Escape (the
  // topmost sheet answers, and only it), the Tab trap and focus return -- and nothing is sent until its Publish
  // button. `confirm` is 'note' | 'folder' | null; `confirmStatus` is the step's own line (busy, refusal).
  const [confirm, setConfirm] = useState(null)
  const [confirmStatus, setConfirmStatus] = useState('')
  // Wave 10 F7 (Part A, 5d): the two reads that fill this panel. A failed one used to be
  // swallowed, and the panel then offered "Create link" as if no link existed.
  const [shareLoadError, setShareLoadError] = useState(null)
  const [publishLoadError, setPublishLoadError] = useState(null)
  const [reload, setReload] = useState(0)
  // M-3: ids from useId, never fixed strings -- split view mounts two editors, so two of these
  // popovers can exist at once, and a fixed id would be a duplicate the moment both open.
  const uid = useId()
  const ids = {
    linkTab: `${uid}-tab-link`,
    publishTab: `${uid}-tab-publish`,
    linkPanel: `${uid}-panel-link`,
    publishPanel: `${uid}-panel-publish`,
    expiry: `${uid}-expiry`,
    hide: `${uid}-hide`,
    preview: `${uid}-preview`,
    revokeCaption: `${uid}-revoke-caption`,
  }
  // ⛔ Final review M-1: every action below swaps the control that was pressed for another
  // (Create link -> the address and Copy link; Revoke -> Create link; Publish -> Copy page link;
  // Unpublish -> Publish). The pressed button leaves the DOM, and focus with it. So the action names where focus goes
  // NEXT, and once the busy state has cleared that control takes it.
  const focusRefs = {
    create: useRef(null),
    copyLink: useRef(null),
    publishNote: useRef(null),
    copyPage: useRef(null),
    publishFolder: useRef(null),
    copyFolder: useRef(null),
  }
  const tabRefs = { link: useRef(null), publish: useRef(null) }
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
    setShareLoadError(null)
    setPublishLoadError(null)
    if (shareOn) {
      jobs.push(requestJson(noteShareEndpoint(noteId))
        .then((b) => { if (alive) setShare(b.share || null) })
        .catch((e) => { if (alive) setShareLoadError(e || new Error('share')) }))
    }
    if (publishOn) {
      jobs.push(requestJson(`${PUBLISH_ENDPOINT}?note_id=${encodeURIComponent(noteId)}`)
        .then((b) => {
          if (!alive) return
          setPubs(Array.isArray(b.publications) ? b.publications : [])
          setCtx(b.note || null)
        })
        .catch((e) => { if (alive) setPublishLoadError(e || new Error('publish')) }))
    }
    Promise.all(jobs).then(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [noteId, shareOn, publishOn, reload])

  // The preview follows the switch: it is the server's answer for exactly the link "Create link and copy" would make.
  useEffect(() => {
    if (!previewOpen) return undefined
    let alive = true
    setPreview({ status: 'loading', note: null })
    requestJson(noteSharePreviewEndpoint(noteId, hidePnl))
      .then((b) => { if (alive) setPreview({ status: b?.note ? 'ok' : 'failed', note: b?.note || null }) })
      .catch(() => { if (alive) setPreview({ status: 'failed', note: null }) })
    return () => { alive = false }
  }, [previewOpen, hidePnl, noteId])

  const notePub = findLivePublication(pubs, 'note', noteId)
  const folderPub = ctx?.folderId ? findLivePublication(pubs, 'folder', ctx.folderId) : null

  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const createLink = () => run(async () => {
    try {
      const choice = SHARE_EXPIRY_OPTIONS.find((c) => c.value === expiry) || SHARE_EXPIRY_OPTIONS[0]
      const b = await requestJson(noteShareEndpoint(noteId), {
        method: 'POST', body: JSON.stringify({ expiresInDays: choice.days, hidePnl }),
      })
      setShare(b.share)
      setPreviewOpen(false)
      // Ruling I1: the sentence states the link's REAL setting, read from the answer -- never the switch's. An existing
      // link that showed is tightened by the server when Hide was asked; one that hides stays hidden.
      trackNotebookEvent(NOTEBOOK_EVENTS.SHARE_USED, { action: 'create' })
      focusNextRef.current = 'copyLink'
      const copied = await copyText(sharedNoteUrl(b.share.token))
      const hides = b.share.hidePnl === true
      const head = b.share.reused === true
        ? (copied ? 'Share link copied.' : 'Copy the address above.')
        : (copied ? 'Share link created and copied.' : 'Share link created. Copy the address above.')
      const kept = hides && !hidePnl ? ` ${SHARE_COPY.kept}` : ''
      say(`${head} ${hides ? SHARE_COPY.hidden : SHARE_COPY.shown}${kept}`)
    } catch (e) {
      say(memberDetail(e, 'Could not create the link. Try again.'))
    }
  })

  const copyLink = () => run(async () => {
    const copied = await copyText(sharedNoteUrl(share.token))
    if (copied) trackNotebookEvent(NOTEBOOK_EVENTS.SHARE_USED, { action: 'copy' })
    say(copied ? 'Share link copied.' : 'Copy the address above.')
  })

  const revokeLink = () => run(async () => {
    try {
      await requestJson(noteShareEndpoint(noteId), { method: 'DELETE' })
      setShare(null)
      trackNotebookEvent(NOTEBOOK_EVENTS.SHARE_USED, { action: 'revoke' })
      focusNextRef.current = 'create'
      say('Link revoked. It no longer works.')
    } catch (e) {
      say(memberDetail(e, 'Could not revoke the link. Try again.'))
    }
  })

  // S1: the first press only ASKS. The confirm step's Publish is what publishes.
  const askPublish = (kind) => {
    if (busy) return
    setConfirmStatus('')
    setConfirm(kind)
  }
  const cancelPublish = () => {
    if (busy) return
    setConfirm(null)
    setConfirmStatus('')
  }

  const publish = (kind) => run(async () => {
    try {
      const pub = await publishTarget(kind, kind === 'note' ? noteId : ctx.folderId)
      setPubs((prev) => [pub, ...prev.filter((p) => p.slug !== pub.slug)])
      trackNotebookEvent(NOTEBOOK_EVENTS.PUBLISH_USED, { action: 'publish', kind, door: 'editor' })
      focusNextRef.current = kind === 'note' ? 'copyPage' : 'copyFolder'
      setConfirm(null)
      setConfirmStatus('')
      const copied = await copyText(publishedUrl(pub.slug))
      say(publishedSentence(kind === 'note' ? null : ctx.folderName, copied))
    } catch (e) {
      // A refusal keeps the step open with its sentence, so the member can retry or cancel.
      const msg = memberDetail(e, PUBLISH_FAILED_SENTENCE)
      setConfirmStatus(msg)
      say(msg)
    }
  })

  const copyPage = (pub) => run(async () => {
    const copied = await copyText(publishedUrl(pub.slug))
    if (copied) trackNotebookEvent(NOTEBOOK_EVENTS.PUBLISH_USED, { action: 'copy', kind: pub.kind, door: 'editor' })
    say(pageCopiedSentence(copied))
  })

  const unpublish = (pub) => run(async () => {
    try {
      await requestJson(`${PUBLISH_ENDPOINT}/${encodeURIComponent(pub.slug)}`, { method: 'DELETE' })
      setPubs((prev) => prev.filter((p) => p.slug !== pub.slug))
      trackNotebookEvent(NOTEBOOK_EVENTS.PUBLISH_USED, { action: 'unpublish', kind: pub.kind, door: 'editor' })
      // S20: a publish undone within 10 minutes is a trust incident.
      const undoneMs = publishUndoneMs(pub)
      if (undoneMs != null) trackNotebookEvent(NOTEBOOK_EVENTS.TRUST_INCIDENT, { kind: 'publish_undone', ms: undoneMs })
      focusNextRef.current = pub.kind === 'folder' ? 'publishFolder' : 'publishNote'
      say('Unpublished. The page no longer works.')
    } catch (e) {
      say(memberDetail(e, 'Could not unpublish. Try again.'))
    }
  })

  // The ARIA tabs pattern: arrows move between the two tabs, and the selected one takes focus.
  const tabs = [shareOn && 'link', publishOn && 'publish'].filter(Boolean)
  const onTabKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const at = tabs.indexOf(tab)
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1]
      : tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    setTab(next)
    tabRefs[next]?.current?.focus()
  }

  if (loading) {
    return <div className={styles.panel} role="status" aria-live="polite">Loading…</div>
  }

  return (
    <div className={styles.panel}>
      <LoadFailed compact failures={[
        { what: "this note's share link", error: shareLoadError, retry: () => setReload((n) => n + 1) },
        { what: "this note's published pages", error: publishLoadError, retry: () => setReload((n) => n + 1) },
      ]} />
      {tabs.length > 1 && (
        <div className={styles.tabs} role="tablist" aria-label="How to share">
          <button type="button" role="tab" id={ids.linkTab} ref={tabRefs.link} className={styles.tab}
            aria-selected={tab === 'link'} aria-controls={tab === 'link' ? ids.linkPanel : undefined} tabIndex={tab === 'link' ? 0 : -1}
            onClick={() => setTab('link')} onKeyDown={onTabKey}>{SHARE_COPY.privateTab}</button>
          <button type="button" role="tab" id={ids.publishTab} ref={tabRefs.publish} className={styles.tab}
            aria-selected={tab === 'publish'} aria-controls={tab === 'publish' ? ids.publishPanel : undefined} tabIndex={tab === 'publish' ? 0 : -1}
            onClick={() => setTab('publish')} onKeyDown={onTabKey}>{SHARE_COPY.publishTab}</button>
        </div>
      )}

      {shareOn && tab === 'link' && (
        <section className={styles.section} id={ids.linkPanel}
          {...(tabs.length > 1 ? { role: 'tabpanel', 'aria-labelledby': ids.linkTab } : { 'aria-label': SHARE_COPY.privateTab })}>
          {!share ? (
            <>
              <p className={styles.lede}>{SHARE_COPY.lede}</p>
              <fieldset className={styles.choices}>
                <legend className={styles.label}>{SHARE_COPY.expiresIn}</legend>
                {SHARE_EXPIRY_OPTIONS.map((c) => (
                  <label key={c.value} className={styles.choice}>
                    <input type="radio" name={ids.expiry} value={c.value} checked={expiry === c.value}
                      onChange={() => setExpiry(c.value)} disabled={busy} />
                    {c.label}
                  </label>
                ))}
              </fieldset>
              <div className={styles.switchRow}>
                <label htmlFor={ids.hide}>{SHARE_COPY.hidePnl}</label>
                <input id={ids.hide} type="checkbox" role="switch" className={styles.switch}
                  checked={hidePnl} onChange={(e) => setHidePnl(e.target.checked)} disabled={busy} />
                <span className={styles.switchState} aria-hidden="true">{hidePnl ? 'On' : 'Off'}</span>
              </div>
              <p className={styles.caption}>{SHARE_COPY.typed} {SHARE_COPY.charts}</p>
              <div className={styles.row}>
                <button type="button" className={styles.link} aria-expanded={previewOpen} aria-controls={ids.preview}
                  onClick={() => setPreviewOpen((v) => !v)}>
                  {previewOpen ? SHARE_COPY.previewHide : SHARE_COPY.preview}
                </button>
              </div>
              <div id={ids.preview}>
                {previewOpen && (
                  <div className={styles.preview} role="region" aria-label={SHARE_COPY.previewLabel}>
                    {preview.status === 'loading' && <p className={styles.caption} role="status">{SHARE_COPY.previewLoading}</p>}
                    {preview.status === 'failed' && <p className={styles.caption}>{SHARE_COPY.previewFailed}</p>}
                    {preview.status === 'ok' && (
                      <PreviewCatch>
                        <Suspense fallback={<p className={styles.caption}>{SHARE_COPY.previewLoading}</p>}>
                          <ReadOnlyNote note={preview.note} />
                        </Suspense>
                      </PreviewCatch>
                    )}
                  </div>
                )}
              </div>
              <div className={styles.row}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onClose?.()} disabled={busy}>
                  {SHARE_COPY.cancel}
                </button>
                <button type="button" ref={focusRefs.create} className="btn btn-primary btn-sm" onClick={createLink} disabled={busy}>{SHARE_COPY.create}</button>
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
              <p className={styles.caption}>{share.hidePnl === true ? SHARE_COPY.hidden : SHARE_COPY.shown}</p>
              <div className={styles.row}>
                <button type="button" ref={focusRefs.copyLink} className="btn btn-secondary btn-sm" onClick={copyLink} disabled={busy}>Copy link</button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
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

      {publishOn && tab === 'publish' && (
        <section className={styles.section} id={ids.publishPanel}
          {...(tabs.length > 1 ? { role: 'tabpanel', 'aria-labelledby': ids.publishTab } : { 'aria-label': SHARE_COPY.publishTab })}>
          <p className={styles.lede}>{PUBLISH_PUBLIC_SENTENCE}</p>
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
                <button type="button" ref={focusRefs.copyPage} className="btn btn-secondary btn-sm" onClick={() => copyPage(notePub)} disabled={busy}>Copy page link</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => unpublish(notePub)} disabled={busy}>
                  Unpublish
                </button>
              </div>
            </>
          ) : ctx?.publishable === false && ctx?.exists ? (
            // Wave-8 backend M-3: the server refuses to publish an ARCHIVED note, and says so in
            // `publishable`. `=== false` on purpose: a server that predates the field sends nothing, and
            // the button stays (its refusal sentence still reaches the member).
            <p className={styles.caption}>This note is archived. Unarchive it from the note menu to publish it.</p>
          ) : (
            <div className={styles.row}>
              <button type="button" ref={focusRefs.publishNote} className="btn btn-outline btn-sm" onClick={() => askPublish('note')} disabled={busy}>Publish this note</button>
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
                  <button type="button" ref={focusRefs.copyFolder} className="btn btn-secondary btn-sm" onClick={() => copyPage(folderPub)} disabled={busy}>Copy folder link</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => unpublish(folderPub)} disabled={busy}>
                    Unpublish folder
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.row}>
                  <button type="button" ref={focusRefs.publishFolder} className="btn btn-outline btn-sm" onClick={() => askPublish('folder')} disabled={busy}>
                    {`Publish folder "${ctx.folderName}"`}
                  </button>
                </div>
                <p className={styles.caption}>{FOLDER_PUBLISH_SCOPE_SENTENCE}</p>
              </>
            )
          )}
        </section>
      )}

      <p className={styles.status} role="status" aria-live="polite">{status}</p>
      {publishOn && (
        <PublishConfirmSheet
          kind={confirm}
          noteTitle={noteTitle}
          folderName={ctx?.folderName}
          folderNoteCount={ctx?.folderNoteCount}
          busy={busy}
          status={confirmStatus}
          onCancel={cancelPublish}
          onPublish={() => publish(confirm)}
        />
      )}
    </div>
  )
}

// S1's confirm step. Initial focus is Cancel, the safe default. Escape closes this sheet only -- the Share sheet underneath
// stays open, because the Sheet answers Escape on the topmost panel alone.
function PublishConfirmSheet({ kind, noteTitle, folderName, folderNoteCount, busy, status, onCancel, onPublish }) {
  const uid = useId()
  const bodyId = `${uid}-body`
  const open = kind === 'note' || kind === 'folder'
  const cancelRef = useRef(null)
  // Cancel takes focus once the sheet has mounted (a frame later: the Sheet focuses its panel
  // on the next frame when nothing inside holds focus, and this must land after that).
  useEffect(() => {
    if (!open) return undefined
    const t = requestAnimationFrame(() => requestAnimationFrame(() => cancelRef.current?.focus()))
    return () => cancelAnimationFrame(t)
  }, [open])
  const title = kind === 'folder'
    ? publishConfirmFolderTitle(folderName || 'this folder', folderNoteCount)
    : PUBLISH_CONFIRM_NOTE_TITLE
  return (
    <Sheet open={open} onClose={onCancel} title={title} ariaLabel={title} maxWidth={420}>
      {open && (
        <div className={styles.panel} data-publish-confirm={kind}>
          <p id={bodyId} className={styles.lede}>
            {kind === 'folder' ? PUBLISH_PUBLIC_SENTENCE : publishConfirmNoteSentence(noteTitle)}
          </p>
          {kind === 'folder' && <p className={styles.caption}>{FOLDER_PUBLISH_SCOPE_SENTENCE}</p>}
          <div className={styles.row}>
            <button type="button" ref={cancelRef} className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onPublish}
              disabled={busy}
              aria-describedby={bodyId}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
          </div>
          <p className={styles.status} role="status" aria-live="polite">{status}</p>
        </div>
      )}
    </Sheet>
  )
}
