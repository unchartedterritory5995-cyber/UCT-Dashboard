/**
 * Portfolio Attention banner — Journal 2.0 Open Positions (Portfolio/Position
 * Intelligence Convergence V1, Part B3; click-through added by Attention
 * Signal Propagation V1).
 *
 * Read-only, deterministic. Fetches GET /api/j2/positions/attention (a thin
 * endpoint that reuses watchlist_intelligence.get_intelligence_for_symbols()
 * verbatim over the caller's currently-held symbols) and renders its shape
 * unmodified: per symbol, status / notable / facts / context. No synthesis,
 * no LLM call, no chat/voice integration — see the endpoint's own docstring.
 *
 * Renders nothing when there are no open positions (no empty-state banner
 * for V1) or while the account has no fetched data yet.
 *
 * Each card links to PositionDetailPage (/journal-2-0/position/{sym}), which
 * calls this same hook directly (useJ2PositionsAttention) and renders the
 * identical facts for that symbol — so the loop closes: notable here →
 * click → the same evidence there, no route-state propagation needed.
 */

import { Link } from 'react-router-dom'
import useJ2PositionsAttention from '../hooks/useJ2PositionsAttention'
import UIcon from '../../../components/ui/UIcon'
import styles from './PortfolioAttentionBanner.module.css'

export default function PortfolioAttentionBanner() {
  const { attention, isLoading, error } = useJ2PositionsAttention()
  const symbols = Object.keys(attention || {})

  if (isLoading || error || symbols.length === 0) return null

  return (
    <div className={styles.wrap} role="status" data-testid="portfolio-attention-banner">
      <div className={styles.header}>
        <UIcon name="sparkle" size={12} />
        <span>Portfolio Attention</span>
      </div>
      <div className={styles.grid}>
        {symbols.map((sym) => {
          const entry = attention[sym] || {}
          const facts = entry.facts || []
          const context = entry.context || {}
          const hasContext = context.composite_rating != null || context.rs_rank != null
          return (
            <Link
              key={sym}
              to={`/journal-2-0/position/${encodeURIComponent(sym)}`}
              className={`${styles.card} ${entry.notable ? styles.cardNotable : ''}`}
              data-testid={`attention-card-${sym}`}
            >
              <div className={styles.symRow}>
                <span>{sym}</span>
                {entry.notable && (
                  <span className={styles.notableDot} title="Notable" aria-label={`${sym} notable`} />
                )}
                {entry.status && entry.status !== 'ok' && (
                  <span className={styles.statusPill} title={`Data ${entry.status}`}>{entry.status}</span>
                )}
              </div>
              {facts.length > 0 ? (
                <ul className={styles.factList}>
                  {facts.map((f, i) => (
                    <li key={`${f.kind}-${i}`} className={styles.fact}>
                      {f.label}
                      {/* Evidence timestamp from the fact itself — never a
                          rendered "now"/client clock. */}
                      {f.as_of && <span className={styles.factDate}> · {f.as_of}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.noFacts}>Nothing notable</div>
              )}
              {hasContext && (
                <div className={styles.context}>
                  {context.composite_rating != null && <span>Rating {context.composite_rating}</span>}
                  {context.rs_rank != null && <span>RS {context.rs_rank}</span>}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
