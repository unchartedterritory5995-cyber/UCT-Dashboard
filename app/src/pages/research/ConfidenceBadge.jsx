// app/src/pages/research/ConfidenceBadge.jsx
// Packet J CP1 (signed 2026-09-22, fingerprint d3e86c615) -- "what is UCT's own
// computed confidence score for this ticker?"
//
// GET /api/confidence-scores/{symbol} already computed this (real 6-component
// breakdown against the confidence_scores table, populated by the autonomous-
// brain scoring pipeline) -- it just had zero frontend callers anywhere in the
// app until this component. Modeled directly on LeadershipBadge.jsx's idiom:
// one self-contained card, one inline fetch, renders null when there is
// nothing to show, so a ticker that has never been scored (the common case)
// sees no empty box.
//
// Unlike leader-persistence, this endpoint's two "no answer" cases (engine
// unavailable, never scored) share ONE identical shape -- {symbol, score:
// null} -- verified in tests/test_confidence_score_endpoint.py. No defensive
// shape-tolerance needed here the way LeadershipBadge.jsx needs it.
import useSWR from 'swr'
import styles from './ResearchPage.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const SUB_SCORES = [
  ['base_score', 'Base'],
  ['regime_fit', 'Regime fit'],
  ['volume_confirm', 'Volume'],
  ['rs_confirm', 'RS'],
  ['sector_fit', 'Sector fit'],
  ['catalyst_score', 'Catalyst'],
]

export default function ConfidenceBadge({ sym }) {
  const { data } = useSWR(
    sym ? `/api/confidence-scores/${encodeURIComponent(sym)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const score = data?.score
  // Never scored, or the engine isn't installed -- both read as `score: null`.
  // The common case for most tickers; render nothing rather than a permanent
  // "not yet scored" note.
  if (!score) return null

  return (
    <section className={styles.card} data-testid="confidence-badge">
      <div className={styles.ct}>UCT Confidence Score</div>
      <div>
        <span className={styles.gold}>Grade {score.grade}</span>
        <span className={styles.muted}> · {score.total_score} total</span>
      </div>
      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {SUB_SCORES.map(([key, label]) => (
          typeof score[key] === 'number' && (
            <span key={key} className={styles.muted}>
              {label} {score[key]}
            </span>
          )
        ))}
      </div>
      {Array.isArray(score.qualifying) && score.qualifying.length > 0 && (
        <div className={styles.muted} style={{ marginTop: 4 }}>
          Qualifying: {score.qualifying.join(', ')}
        </div>
      )}
      {Array.isArray(score.invalidating) && score.invalidating.length > 0 && (
        <div className={styles.muted} style={{ marginTop: 4 }}>
          Invalidating: {score.invalidating.join(', ')}
        </div>
      )}
    </section>
  )
}
