// app/src/pages/community/AckGate.jsx
import { useState } from 'react'
import { apiCall } from './hooks/useCommunity'
import styles from './Community.module.css'

// Plain-language community disclaimer. Reviewed in the 2026-07 pre-launch legal
// hardening pass; still pending a final read by counsel before broad rollout.
const DISCLAIMER = `The Floor is a member community. Posts and comments are the
personal opinions of individual members and do not represent UCT Intelligence or
Uncharted Territory. Nothing shared here is investment advice, a recommendation, or a
solicitation to buy or sell any security, and no member is acting as your broker or
adviser. Performance claims are self-reported and unverified. Do your own research,
manage your own risk, and never send money or share account credentials with other
members.`

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
          Be constructive. No spam, promotion, paid signals, or soliciting other members,
          and no sharing of other members&apos; information. UCT Intelligence may moderate,
          edit, or remove any content and may suspend accounts that break these rules.
        </p>
        <button className={styles.composerSubmit} disabled={busy} onClick={agree}>
          I understand — this is not financial advice
        </button>
      </div>
    </div>
  )
}
