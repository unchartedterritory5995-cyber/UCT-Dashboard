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
} from '../../../hooks/useUserDefinitions'
import styles from './SharePanel.module.css'

/** A share token → the URL a member actually pastes to somebody. */
export function shareUrlFor(token) {
  if (!token) return ''
  const origin = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : ''
  return `${origin}/formulas/shared/${token}`
}

/** ⭐ WHAT A MEMBER CAN DO ABOUT EACH REFUSAL, keyed by the server's own reason.
 *
 *  ⛔ NOT ONE SENTENCE FOR ALL OF THEM. `revoked`, `gone` and `table-version`
 *  are three different situations and only the last has an action the member can
 *  take. Collapsing them would leave somebody re-clicking a link that will never
 *  work, or failing to ask for the one that would. */
const WHAT_TO_DO = Object.freeze({
  revoked: 'Ask them for a new link.',
  gone: 'They have deleted it, so there is nothing to install.',
  'table-version': 'Ask them to open it and share it again — that will re-issue the link against the current engine.',
})

export default function SharePanel({ defId, defName, onInstalled }) {
  const [token, setToken] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const [incoming, setIncoming] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState(null)

  const [versions, setVersions] = useState(null)

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
    const found = raw.match(/sh_[0-9a-f]{32}/i)
    setBusy(true); setPreview(null); setPreviewError(null)
    const r = await previewSharedDefinition(found ? found[0] : raw)
    setBusy(false)
    if (r.ok) setPreview(r.shared)
    else setPreviewError({ reason: r.reason, message: r.error })
  }, [incoming])

  const install = useCallback(async () => {
    const found = incoming.trim().match(/sh_[0-9a-f]{32}/i)
    setBusy(true)
    const r = await installSharedDefinition(found ? found[0] : incoming.trim())
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
