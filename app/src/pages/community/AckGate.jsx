// app/src/pages/community/AckGate.jsx
import { useState } from 'react'
import { apiCall } from './hooks/useCommunity'
import styles from './Community.module.css'

// ⚠️ OWNER OPEN ITEM: this wording needs a pass from whoever reviewed the
// existing Terms/disclaimer page before the flag flips on.
const DISCLAIMER = `The Floor is a member community. Posts are the opinions of
individual members — nothing here is financial advice, a recommendation, or a
solicitation to buy or sell any security. Performance claims are unverified.
Do your own research and manage your own risk.`

export default function AckGate({ status, onAcked }) {
  const [busy, setBusy] = useState(false)
  if (!status || status.acked) return null
  const agree = async () => {
    setBusy(true)
    try {
      await apiCall('/api/community/ack')
      onAcked?.()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.ackBackdrop} role="dialog" aria-modal="true">
      <div className={styles.ackCard}>
        <h3 className="t-section-title">Welcome to The Floor</h3>
        <p className={styles.ackText}>{DISCLAIMER}</p>
        <p className={styles.ackText}>
          Be constructive. No spam, no promotion, no sharing other members&apos; info.
          Moderators may remove content that breaks the rules.
        </p>
        <button className={styles.composerSubmit} disabled={busy} onClick={agree}>
          I understand — this is not financial advice
        </button>
      </div>
    </div>
  )
}
