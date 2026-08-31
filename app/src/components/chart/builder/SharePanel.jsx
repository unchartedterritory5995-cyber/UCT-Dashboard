// app/src/components/chart/builder/SharePanel.jsx
//
// ─── THE DOOR ONTO W5b ───────────────────────────────────────────────────────
//
// Sharing exists in the store and on six routes. Without this panel none of it
// is reachable by a member, which is the shape this repo hunts hardest: built,
// tested, green, and connected to nothing.
//
// ⛔⛔ THE PANEL NEVER MINTS ON OPEN. It READS the current state when it mounts
// and only creates a link when the member presses the button — because a panel
// that minted on open would publish a formula as a side effect of curiosity. The
// server enforces the same split (`GET {id}/share` is read-only); this is the
// second lock, not the only one.
import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'

import UIcon from '../../ui/UIcon'
import {
  readShareLink, createShareLink, revokeShareLink,
  previewSharedDefinition, installSharedDefinition,
  fetchDefinitionHistory,
  readListing, publishToLibrary, withdrawFromLibrary,
} from '../../../hooks/useUserDefinitions'
import {
  sharedFormulaUrl, tokenFromShareInput,
} from '../../../pages/formulas/formulaShareLink'
import { WHAT_TO_DO } from '../../../pages/formulas/shareRefusal'
import styles from './SharePanel.module.css'

/** A share token → the URL a member actually pastes to somebody.
 *
 *  ⚰️⚰️ THIS FUNCTION USED TO HAND-TYPE `${origin}/formulas/shared/${token}`
 *  AND NOTHING ROUTED IT. `App.jsx` carried no `/formulas` path at all, so every
 *  link this button ever produced resolved to the catch-all 404 — a complete
 *  six-route sharing backend reachable from nothing on the recipient's side.
 *  It is kept as a named export because callers and tests already import it, but
 *  the path itself now comes from `pages/formulas/formulaShareLink.js`, which
 *  `App.jsx` routes on. One authority: the link and the route cannot disagree,
 *  because there is no longer a second place to disagree in. */
export const shareUrlFor = sharedFormulaUrl


export default function SharePanel({ defId, defName, onInstalled }) {
  const [token, setToken] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const [incoming, setIncoming] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState(null)

  const [versions, setVersions] = useState(null)

  // ⛔⛔ THE LIBRARY IS A SECOND CONSENT, AND ITS OWN STATE. Sharing sends a link
  // to a person the member chose; listing puts the formula on a page every member
  // can browse. Reading one from the other — "shared, therefore listed" — would
  // have published every link any member ever sent, retroactively, the day this
  // shipped. `listing` is READ on mount and only written by the button.
  const [listing, setListing] = useState(null)

  // ── the current state, READ, never minted ─────────────────────────────────
  useEffect(() => {
    let live = true
    if (!defId) { setToken(null); return undefined }
    readShareLink(defId).then((r) => {
      if (!live) return
      if (r.ok) setToken(r.token)
      else setError(r.error)
    })
    return () => { live = false }
  }, [defId])

  // ⛔ READ, NEVER PUBLISHED ON OPEN — the same split the share state holds one
  // effect up, and for the same reason: a panel that listed on open would publish a
  // formula as a side effect of curiosity. The server enforces it too (`GET
  // {id}/list` is read-only); this is the second lock.
  useEffect(() => {
    let live = true
    if (!defId) { setListing(null); return undefined }
    readListing(defId).then((r) => { if (live && r.ok) setListing(r) })
    return () => { live = false }
  }, [defId])

  const mint = useCallback(async () => {
    setBusy(true); setError('')
    const r = await createShareLink(defId)
    setBusy(false)
    if (r.ok) setToken(r.token)
    else setError(r.error)
  }, [defId])

  const revoke = useCallback(async () => {
    setBusy(true); setError('')
    const r = await revokeShareLink(defId)
    setBusy(false)
    if (r.ok) { setToken(null); setCopied(false) } else setError(r.error)
  }, [defId])

  const publish = useCallback(async () => {
    setBusy(true); setError('')
    const r = await publishToLibrary(defId)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setListing({ listed: true, requested: true, shared: true })
    // ⭐ PUBLISHING MINTS THE LINK WHEN THERE ISN'T ONE — a listing nobody can
    // open is a broken row — so the share half of this panel has to learn about it
    // here, or it would keep saying "This formula is private" about something now
    // on a public page.
    if (r.token) setToken(r.token)
  }, [defId])

  const withdraw = useCallback(async () => {
    setBusy(true); setError('')
    const r = await withdrawFromLibrary(defId)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    // ⛔ THE LINK IS UNTOUCHED. Withdrawing from a directory and revoking a link
    // somebody already saved are different decisions; `token` deliberately stays.
    setListing({ listed: false, requested: false, shared: !!token })
  }, [defId, token])

  const copy = useCallback(async () => {
    // ⚠️ CLIPBOARD ACCESS CAN REFUSE — an insecure origin, a denied permission,
    // an older browser. The link stays selectable on screen either way, so the
    // failure costs the member a keystroke rather than the feature.
    try {
      await navigator.clipboard.writeText(shareUrlFor(token))
      setCopied(true)
    } catch {
      setError('Could not copy automatically — select the link and copy it.')
    }
  }, [token])

  const lookUp = useCallback(async () => {
    const raw = incoming.trim()
    if (!raw) return
    // A member will paste the whole URL far more often than the bare token.
    // ⛔ THE SHAPE IS SPELLED ONCE, in `formulaShareLink.js`. It was inline HERE
    // and inline again in `install` below, so the two could have been edited
    // apart — a member looking a link up under one spelling and installing under
    // another is the same defect class as the link and the route disagreeing.
    const found = tokenFromShareInput(raw)
    setBusy(true); setPreview(null); setPreviewError(null)
    const r = await previewSharedDefinition(found || raw)
    setBusy(false)
    if (r.ok) setPreview(r.shared)
    else setPreviewError({ reason: r.reason, message: r.error })
  }, [incoming])

  const install = useCallback(async () => {
    const found = tokenFromShareInput(incoming)
    setBusy(true)
    const r = await installSharedDefinition(found || incoming.trim())
    setBusy(false)
    if (!r.ok) { setPreviewError({ reason: r.reason, message: r.error }); return }
    setPreview(null); setIncoming('')
    if (onInstalled) onInstalled(r.row)
  }, [incoming, onInstalled])

  const loadHistory = useCallback(async () => {
    const r = await fetchDefinitionHistory(defId)
    setVersions(r.ok ? r.versions : [])
    if (!r.ok) setError(r.error)
  }, [defId])

  return (
    <div className={styles.panel}>
      <section className={styles.block}>
        <h3 className={styles.heading}>Share this formula</h3>
        {token ? (
          <>
            <p className={styles.note}>
              Anyone with this link can install their own copy. Yours stays yours —
              their edits never reach it.
            </p>
            <div className={styles.linkRow}>
              <input
                className={styles.link}
                readOnly
                value={shareUrlFor(token)}
                onFocus={(e) => e.target.select()}
                aria-label="Share link"
              />
              <button type="button" className={styles.btn} onClick={copy}>
                <UIcon name="copy" size={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button type="button" className={styles.quiet} onClick={revoke} disabled={busy}>
              Turn the link off
            </button>
          </>
        ) : (
          <>
            <p className={styles.note}>
              This formula is private. Nothing is shared until you create a link.
            </p>
            <button type="button" className={styles.btn} onClick={mint} disabled={busy || !defId}>
              <UIcon name="link" size={14} /> Create a share link
            </button>
          </>
        )}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>

      <section className={styles.block} data-testid="library-block">
        <h3 className={styles.heading}>Put it in the library</h3>
        {listing && listing.listed ? (
          <>
            <p className={styles.note}>
              This is in the public library, where any member can find and install it.
              {' '}Taking it out leaves your share link working.
            </p>
            <button
              type="button"
              className={styles.quiet}
              data-testid="library-withdraw"
              onClick={withdraw}
              disabled={busy}
            >
              Take it out of the library
            </button>
          </>
        ) : (
          <>
            <p className={styles.note}>
              {/* ⛔⛔ THE SENTENCE THAT MAKES THE CONSENT LEGIBLE. A member who
                  already pressed Share has to be able to see that they are NOT in
                  the library — otherwise "shared" and "published" blur together in
                  their head, which is the same conflation the schema refuses to
                  make. And it says what publishing will do to the link, because
                  publishing mints one. */}
              {listing && listing.requested && !listing.shared
                ? 'This was in the library, but your share link is off — so nothing can open it. Publishing again will turn the link back on.'
                : 'Nothing is listed until you say so. A share link is private to whoever you send it to; the library is public to every member.'}
            </p>
            <button
              type="button"
              className={styles.btn}
              data-testid="library-publish"
              onClick={publish}
              disabled={busy || !defId}
            >
              <UIcon name="upload" size={14} /> Publish to the library
            </button>
          </>
        )}
      </section>

      <section className={styles.block}>
        <h3 className={styles.heading}>Install one you were sent</h3>
        <div className={styles.linkRow}>
          <input
            className={styles.link}
            value={incoming}
            placeholder="Paste a share link"
            onChange={(e) => { setIncoming(e.target.value); setPreviewError(null) }}
            aria-label="Paste a share link"
          />
          <button type="button" className={styles.btn} onClick={lookUp} disabled={busy || !incoming.trim()}>
            Look up
          </button>
        </div>

        {preview ? (
          <div className={styles.preview}>
            <p className={styles.previewName}>{preview.definition?.meta?.name || 'Untitled formula'}</p>
            <p className={styles.note}>
              Version {preview.origin_version} of someone else&rsquo;s formula. Installing
              makes your own copy that you can edit freely.
            </p>
            <button type="button" className={styles.btn} onClick={install} disabled={busy}>
              Install my own copy
            </button>
          </div>
        ) : null}

        {previewError ? (
          <div className={styles.error} role="alert">
            <p>{previewError.message}</p>
            {WHAT_TO_DO[previewError.reason]
              ? <p className={styles.todo}>{WHAT_TO_DO[previewError.reason]}</p>
              : null}
          </div>
        ) : null}
      </section>

      <section className={styles.block}>
        <h3 className={styles.heading}>History</h3>
        {versions === null ? (
          <button type="button" className={styles.quiet} onClick={loadHistory} disabled={!defId}>
            Show every saved version
          </button>
        ) : versions.length === 0 ? (
          <p className={styles.note}>No versions stored yet.</p>
        ) : (
          <ol className={styles.versions}>
            {versions.map((v) => (
              <li key={v.version} className={styles.version}>
                <span className={styles.vNum}>v{v.version}</span>
                <span className={styles.vName}>
                  {v.deleted_at ? 'deleted' : (v.definition?.meta?.name || 'Untitled')}
                </span>
                <span className={styles.vHash}>{String(v.ast_hash || '').slice(7, 15)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {defName ? <p className={styles.footer}>{defName}</p> : null}
    </div>
  )
}

SharePanel.propTypes = {
  defId: PropTypes.string,
  defName: PropTypes.string,
  onInstalled: PropTypes.func,
}
