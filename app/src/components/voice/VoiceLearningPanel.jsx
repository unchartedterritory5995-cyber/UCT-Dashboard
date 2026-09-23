import { useEffect, useState, useCallback } from 'react'
import styles from './VoiceLearningPanel.module.css'

/**
 * Active-learning panel (Packet AD CP3).
 *
 * Surfaces the assistant's own gaps: knowledge-slot categories it has no
 * saved fact about yet, and tickers the member mentions often with no fact
 * explaining why. Both are read-only here — closing a gap is done through
 * the Voice Memory panel's "add a fact" form, not duplicated in this panel.
 * Also exposes the nightly memory-consolidation pass as a manual trigger.
 *
 * IMPORTANT: `consolidate_memory`'s `summaries_compressed` field is a
 * placeholder COUNT, not an actual compression (the service comment says so
 * explicitly — "actual compression needs an LLM call ... just count how
 * many we'd compress"). This panel must never word that as "compressed".
 */
export default function VoiceLearningPanel() {
  const [gaps, setGaps] = useState([])
  const [obsessions, setObsessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [consolidating, setConsolidating] = useState(false)
  const [consolidateResult, setConsolidateResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [gapsR, obsR] = await Promise.all([
        fetch('/api/voice/learning/gaps', { credentials: 'include' }),
        fetch('/api/voice/learning/ticker-obsessions', { credentials: 'include' }),
      ])
      if (gapsR.ok) {
        const j = await gapsR.json()
        setGaps(j.gaps || [])
      }
      if (obsR.ok) {
        const j = await obsR.json()
        setObsessions(j.obsessions || [])
      }
      if (!gapsR.ok && !obsR.ok) throw new Error('Failed to load')
    } catch (e) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const runConsolidation = useCallback(async () => {
    setConsolidating(true)
    setError(null)
    setConsolidateResult(null)
    try {
      const r = await fetch('/api/voice/learning/consolidate', {
        method: 'POST', credentials: 'include',
      })
      if (r.ok) {
        setConsolidateResult(await r.json())
      } else {
        setError(`Consolidation failed (HTTP ${r.status})`)
      }
    } catch (e) {
      setError(e?.message || 'Consolidation failed')
    } finally {
      setConsolidating(false)
    }
  }, [])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Active learning</h3>
        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={runConsolidation}
            className={styles.consolidateBtn}
            disabled={consolidating}
          >
            {consolidating ? 'Running…' : 'Run consolidation now'}
          </button>
          <button
            type="button"
            onClick={load}
            className={styles.refresh}
            disabled={loading}
            aria-label={loading ? 'Refreshing active learning' : 'Refresh active learning'}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className={styles.subtitle}>
        What Compass has noticed it doesn't know about you yet, plus its
        nightly memory-hygiene pass, on demand.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {consolidateResult && (
        <div className={styles.consolidateResult}>
          {consolidateResult.duplicates_merged} duplicate fact{consolidateResult.duplicates_merged === 1 ? '' : 's'} merged
          {' · '}{consolidateResult.stale_flagged} stale fact{consolidateResult.stale_flagged === 1 ? '' : 's'} flagged for review
          {' · '}{consolidateResult.summaries_compressed} old summar{consolidateResult.summaries_compressed === 1 ? 'y' : 'ies'} flagged for future compression
        </div>
      )}

      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Knowledge gaps</h4>
        <p className={styles.note}>
          Categories Compass has no saved fact about yet — it'll ask about
          these naturally in conversation. To answer one directly, add a
          fact in the Voice Memory panel above rather than here.
        </p>
        {gaps.length === 0 && !loading ? (
          <div className={styles.empty}>No knowledge gaps — every tracked category has a saved fact.</div>
        ) : (
          <ul className={styles.gapList}>
            {gaps.map((g) => (
              <li key={g.slot} className={styles.gapRow}>
                <span className={styles.gapCategory}>{g.category}</span>
                <span className={styles.gapQuestion}>{g.question}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Ticker obsessions</h4>
        <p className={styles.note}>
          Symbols you bring up often with no saved fact explaining why. Add
          one in Voice Memory to close the gap.
        </p>
        {obsessions.length === 0 && !loading ? (
          <div className={styles.empty}>No frequently-mentioned tickers without a saved fact.</div>
        ) : (
          <ul className={styles.obsessionList}>
            {obsessions.map((o) => (
              <li key={o.symbol} className={styles.obsessionRow}>
                <span className={styles.obsessionSymbol}>{o.symbol}</span>
                <span className={styles.obsessionMentions}>{o.mentions} mentions</span>
                <span className={styles.obsessionQuestion}>{o.suggested_question}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
