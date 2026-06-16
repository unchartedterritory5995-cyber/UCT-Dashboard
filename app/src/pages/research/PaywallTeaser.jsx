import { useNavigate } from 'react-router-dom'
import styles from './ResearchPage.module.css'

export default function PaywallTeaser({ sym }) {
  const navigate = useNavigate()
  return (
    <div className={styles.paywall}>
      <div className={styles.paywallGlass}>
        <h2 className={styles.paywallTitle}>Unlock {sym} Research</h2>
        <p className={styles.paywallSub}>
          Full financial statements, forward estimates, proprietary UCT Ratings,
          ownership &amp; short interest, earnings-call transcripts, and more — the
          complete institutional-grade research dossier.
        </p>
        <ul className={styles.paywallList}>
          <li>📊 5-year &amp; 8-quarter growth, margins, balance sheet &amp; cash flow</li>
          <li>🎯 UCT Composite + EPS / Relative Strength / Growth / Value ratings</li>
          <li>🏦 Institutional ownership, insider activity, short interest</li>
          <li>🎙️ AI call recaps + full transcripts with TTS</li>
        </ul>
        <button className={styles.paywallCta} onClick={() => navigate('/settings')}>
          Upgrade to unlock →
        </button>
      </div>
    </div>
  )
}
