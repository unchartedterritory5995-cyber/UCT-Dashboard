/**
 * ConnectConsentPanel — shared consent gate for the OAuth connect flows
 * (notion/dropbox), used by both ConnectedAppsCard (Settings) and
 * ConnectTilesCompact (ImportWizard drop step) so there is one copy of the
 * consent copy + checkbox + Continue/Cancel controls, not two.
 *
 * Fix-round 1, finding #1: spec §8 requires "Paid-plan gate mirrors broker
 * connect; consent checkbox required" — this mirrors BrokerConnectionsCard's
 * consent panel (checklist + required checkbox before the connect POST
 * fires) for the OAuth half of note connectors. The token half (roam/craft)
 * gets its own checkbox inline in ConnectTokenModal.
 */
import styles from './ConnectConsentPanel.module.css'

export default function ConnectConsentPanel({ providerLabel, checked, onCheck, onConfirm, onCancel, busy }) {
  return (
    <div className={styles.consent} role="group" aria-label={`Consent to connect ${providerLabel}`}>
      <p className={styles.consentLead}>
        We pull your {providerLabel} notes (and attachments where supported) into the Notebook —
        one-way, nothing is ever written back to {providerLabel}. Disconnect anytime; imported notes stay.
      </p>
      <label className={styles.consentCheck}>
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} />
        I authorize UCT Intelligence to access my {providerLabel} account to import my notes.
      </label>
      <div className={styles.row}>
        <button type="button" className="btn btn-primary" disabled={!checked || busy} onClick={onConfirm}>
          {busy ? 'Opening…' : 'Continue'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
