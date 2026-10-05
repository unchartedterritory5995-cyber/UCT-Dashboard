// app/src/components/research/fmpDepth/SourceLine.jsx
//
// Which vendor stands behind the block below it, on screen, in words. A
// fallback says it is one ("Fallback: Yahoo Finance") and why, so a member
// never mistakes five yfinance quarters for the deep FMP history.
import Provenance from '../../provenance/Provenance'
import styles from './FmpDepth.module.css'

export default function SourceLine({ vendor, detail = null, activity = null, fetchedAt = null,
  fallback = false, reason = null, testId = 'depth-source' }) {
  const label = fallback ? `Fallback: ${vendor}` : `Source: ${vendor}`
  return (
    <div className={styles.source} data-testid={testId} data-vendor={vendor} data-fallback={fallback ? 'true' : 'false'}>
      <Provenance
        value={<span className={fallback ? styles.fallback : undefined}>{label}</span>}
        provenance={{
          sourceActivity: activity || vendor,
          // The server stamps epoch SECONDS; the primitive reads what Date reads.
          timestamp: Number.isFinite(fetchedAt) ? fetchedAt * 1000 : null,
        }}
      />
      {detail && <span>{detail}</span>}
      {reason && <span className={styles.fallback}>{reason}</span>}
    </div>
  )
}
