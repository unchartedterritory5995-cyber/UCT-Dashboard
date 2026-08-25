/**
 * ConnectTokenModal — paste-token connect for roam/craft (spec §7, Task 12).
 *
 * roam: graph name + read-scoped API token. Helper text points at the exact
 * Roam menu path ("Settings → Graph → API tokens") per the task brief.
 * craft: capability URL + Bearer key. Craft only shows the key once, so the
 * warning tells the user to copy-paste it immediately.
 *
 * POSTs to `connectToken(provider, payload)` (from useNoteConnectors) and
 * renders a 400's `detail` inline rather than a toast/alert — the user needs
 * to see it right next to the field they can fix.
 *
 * Consent (fix-round 1, finding #1): spec §8 requires "Paid-plan gate mirrors
 * broker connect; consent checkbox required" — mirrors
 * BrokerConnectionsCard's consent panel. A required checkbox gates
 * `canSubmit` alongside the credential fields, and `consent: true` rides in
 * the connect POST body — the backend router 400s a connect without it.
 */
import { useEffect, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import styles from './ConnectTokenModal.module.css'

export default function ConnectTokenModal({ open, provider, providerLabel, connectToken, onClose, onConnected }) {
  const isRoam = provider === 'roam'

  const [graphName, setGraphName] = useState('')
  const [token, setToken] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorDetail, setErrorDetail] = useState(null)

  // Fresh fields every time the modal opens (or the target provider changes).
  useEffect(() => {
    if (!open) return
    setGraphName('')
    setToken('')
    setApiUrl('')
    setApiKey('')
    setConsentChecked(false)
    setErrorDetail(null)
    setBusy(false)
  }, [open, provider])

  const fieldsFilled = isRoam
    ? graphName.trim().length > 0 && token.trim().length > 0
    : apiUrl.trim().length > 0 && apiKey.trim().length > 0
  const canSubmit = fieldsFilled && consentChecked

  const handleClose = () => {
    if (busy) return
    onClose?.()
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    setErrorDetail(null)
    try {
      const payload = isRoam
        ? { graphName: graphName.trim(), token: token.trim(), consent: true }
        : { apiUrl: apiUrl.trim(), apiKey: apiKey.trim(), consent: true }
      await connectToken(provider, payload)
      onConnected?.()
      onClose?.()
    } catch (err) {
      setErrorDetail(err?.detail || err?.message || 'Could not connect. Check your credentials and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      variant="auto"
      title={`Connect ${providerLabel || ''}`}
      maxWidth={440}
      dismissOnBackdrop={!busy}
    >
      <form className={styles.form} onSubmit={submit}>
        {isRoam ? (
          <>
            <label className={styles.fieldLabel} htmlFor="note-conn-roam-graph">Graph name</label>
            <input
              id="note-conn-roam-graph"
              className={styles.textInput}
              value={graphName}
              onChange={(e) => setGraphName(e.target.value)}
              placeholder="my-graph"
              autoFocus
              autoComplete="off"
            />
            <label className={styles.fieldLabel} htmlFor="note-conn-roam-token">API token</label>
            <input
              id="note-conn-roam-token"
              className={styles.textInput}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="roam-graph-token-..."
              autoComplete="off"
            />
            <p className={styles.helpText}>
              Find your read-scoped token in Roam under Settings → Graph → API tokens, then paste it here with your graph's name.
            </p>
          </>
        ) : (
          <>
            <label className={styles.fieldLabel} htmlFor="note-conn-craft-url">API URL</label>
            <input
              id="note-conn-craft-url"
              className={styles.textInput}
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://connect.craft.do/..."
              autoFocus
              autoComplete="off"
            />
            <label className={styles.fieldLabel} htmlFor="note-conn-craft-key">API key</label>
            <input
              id="note-conn-craft-key"
              className={styles.textInput}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your key"
              autoComplete="off"
            />
            <p className={styles.warnText}>
              Craft's API key is shown once when you create the connection — copy it now and paste it here immediately, or you'll need to generate a new one.
            </p>
          </>
        )}

        <label className={styles.consentCheck}>
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
          />
          I authorize UCT Intelligence to access my {providerLabel} account to import my notes.
        </label>

        {errorDetail && <div className={styles.error} role="alert">{errorDetail}</div>}

        <div className={styles.row}>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={handleClose}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  )
}
