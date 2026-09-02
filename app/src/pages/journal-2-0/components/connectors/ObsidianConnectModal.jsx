/**
 * ObsidianConnectModal — mint-a-connect-code flow for Obsidian (spec §7.3,
 * Task 5 of the 2026-09-02-obsidian-ingest-server plan).
 *
 * Obsidian is local-first: there is nothing to paste (no API credential
 * exists) and nothing to redirect to (a plugin cannot host an OAuth browser
 * flow) — `registry.py`'s `connect_kind == "device"` is neither of
 * ConnectTokenModal's or the OAuth consent panel's shapes, so this is a
 * THIRD, purpose-built modal rather than a forced fit into either. Two
 * phases in one sheet:
 *
 *   1. Explanation + a required consent checkbox + "Generate code".
 *   2. The minted code, shown EXACTLY ONCE with copy-to-clipboard. Minting
 *      only ever happens inside the button's own click handler — never in
 *      an effect keyed on `open` — so a parent re-render while this modal
 *      is showing a code can never silently mint (and burn) a second one.
 *      Closing and reopening always starts phase 1 again; generating again
 *      mints a FRESH code (the backend's connect codes are single-use by
 *      design, and reconnecting the same vault ROTATES rather than refuses
 *      — see `obsidian_link.py`'s own module docstring).
 *
 * Honesty requirement (task brief, and the same disclosure standard the
 * Obsidian plugin directory requires of the plugin's own README, spec
 * §7.4): the copy says plainly what leaves the member's machine once the
 * plugin is connected — the markdown TEXT of each note (its vault path,
 * content, and last-modified time) — and what does not: attachments and
 * images stored in the vault (`providers/obsidian.py`'s `fetch_media`
 * refuses local vault attachments outright; only a note that already links
 * to a public `https://` image can carry one across). One-way: nothing is
 * ever written back into the vault.
 */
import { useEffect, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import styles from './ObsidianConnectModal.module.css'

export default function ObsidianConnectModal({ open, providerLabel, mintConnectCode, onClose }) {
  const [consentChecked, setConsentChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorDetail, setErrorDetail] = useState(null)
  const [code, setCode] = useState(null) // minted connect code, or null before generating
  const [expiresInSeconds, setExpiresInSeconds] = useState(null)
  const [copied, setCopied] = useState(false)

  // Fresh state every time the modal opens — a code minted on a PRIOR open
  // must never linger into a new one (see module docstring: reopening
  // always restarts at phase 1).
  useEffect(() => {
    if (!open) return
    setConsentChecked(false)
    setBusy(false)
    setErrorDetail(null)
    setCode(null)
    setExpiresInSeconds(null)
    setCopied(false)
  }, [open])

  const handleClose = () => {
    if (busy) return
    onClose?.()
  }

  // Fires ONLY from this click handler — see module docstring on why that
  // is load-bearing (a re-render must never re-mint).
  const generate = async () => {
    if (!consentChecked || busy) return
    setBusy(true)
    setErrorDetail(null)
    try {
      const result = await mintConnectCode('obsidian')
      setCode(result.connectCode)
      setExpiresInSeconds(result.expiresInSeconds)
    } catch (err) {
      setErrorDetail(err?.detail || err?.message || 'Could not generate a connect code. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard permission denied/unavailable — the code is still visible,
      // selectable text below, so this is a soft failure, not an error state.
    }
  }

  const label = providerLabel || 'Obsidian'
  const expiresLabel = expiresInSeconds ? `${Math.round(expiresInSeconds / 60)} minutes` : 'a short time'

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      variant="auto"
      title={`Connect ${label}`}
      maxWidth={440}
      dismissOnBackdrop={!busy}
    >
      {!code ? (
        <div className={styles.form}>
          <p className={styles.lead}>
            Once connected, the {label} plugin sends the markdown text of your
            notes — file path, content, and last-modified time — into your
            Notebook. It does not upload attachments or images stored in your
            vault, and nothing is ever written back to your vault.
          </p>
          <p className={styles.helpText}>
            Generate a code below, then paste it into the plugin's connect
            screen inside {label}. The code works once and expires quickly,
            so have {label} open before you generate it.
          </p>

          <label className={styles.consentCheck}>
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            />
            I authorize UCT Intelligence to receive my {label} notes' text once
            the plugin is connected.
          </label>

          {errorDetail && <div className={styles.error} role="alert">{errorDetail}</div>}

          <div className={styles.row}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!consentChecked || busy}
              onClick={generate}
            >
              {busy ? 'Generating…' : 'Generate code'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={handleClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.form}>
          <p className={styles.lead}>
            Paste this code into the {label} plugin now — for your security it
            won't be shown again.
          </p>

          <div className={styles.codeRow}>
            <code className={styles.codeBox} data-testid="obsidian-connect-code">{code}</code>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={copyCode}
              aria-label="Copy connect code"
            >
              <UIcon name={copied ? 'check' : 'copy'} size={16} gold={false} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className={styles.helpText}>Expires in {expiresLabel}.</p>

          <div className={styles.row}>
            <button type="button" className="btn btn-primary" onClick={handleClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
