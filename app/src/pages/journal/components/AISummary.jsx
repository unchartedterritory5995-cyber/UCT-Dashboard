// app/src/pages/journal/components/AISummary.jsx
import { useState, useCallback } from 'react'
import styles from './AISummary.module.css'

export default function AISummary({ tradeId, aiSummary, onUpdated }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [localSummary, setLocalSummary] = useState(null)

  const summary = localSummary || aiSummary

  const handleGenerate = useCallback(async (force = false) => {
    if (!tradeId) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/journal/${tradeId}/ai-summary?force=${force}`, {
        method: 'POST',
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || errData.error || `Failed (${res.status})`)
      }

      const data = await res.json()
      if (data.error) {
        throw new Error(data.error)
      }

      setLocalSummary(data.summary)
      if (onUpdated) onUpdated()
    } catch (err) {
      setError(err.message || 'Failed to generate summary.')
    } finally {
      setLoading(false)
    }
  }, [tradeId, onUpdated])

  // Parse summary into sections if it contains structured content
  const parsed = parseSummary(summary)

  if (!summary && !loading && !error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.generateWrap}>
          <button
            className={styles.generateBtn}
            onClick={() => handleGenerate(false)}
            disabled={loading}
          >
            Generate AI Summary
          </button>
          <span className={styles.generateHint}>
            Uses Claude to analyze this trade and provide actionable feedback.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Loading state */}
      {loading && (
        <div className={styles.loadingWrap}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>Analyzing trade...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className={styles.errorBox}>
          <span>{error}</span>
          <button
            className={styles.retryBtn}
            onClick={() => handleGenerate(false)}
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary content */}
      {summary && !loading && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>AI Summary</span>
            <button
              className={styles.regenBtn}
              onClick={() => handleGenerate(true)}
              disabled={loading}
              title="Regenerate summary"
            >
              Regenerate
            </button>
          </div>

          {/* Summary section */}
          {parsed.recap && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Summary</div>
              <div className={styles.sectionText}>{parsed.recap}</div>
            </div>
          )}

          {/* Key Takeaway */}
          {parsed.takeaway && (
            <div className={`${styles.section} ${styles.sectionTakeaway}`}>
              <div className={styles.sectionLabel}>Key Takeaway</div>
              <div className={styles.sectionText}>{parsed.takeaway}</div>
            </div>
          )}

          {/* Suggested Improvement */}
          {parsed.improvement && (
            <div className={`${styles.section} ${styles.sectionImprovement}`}>
              <div className={styles.sectionLabel}>Suggested Improvement</div>
              <div className={styles.sectionText}>{parsed.improvement}</div>
            </div>
          )}

          {/* Fallback: raw text if parsing failed */}
          {!parsed.recap && !parsed.takeaway && !parsed.improvement && (
            <div className={styles.rawText}>{summary}</div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Attempt to parse the AI summary into structured sections.
 * The AI is prompted to give 3 parts: recap, takeaway, improvement.
 * Look for numbered sections or keyword markers.
 */
function parseSummary(text) {
  if (!text) return { recap: null, takeaway: null, improvement: null }

  // Try to split by numbered sections (1. 2. 3.)
  const lines = text.split('\n').filter(l => l.trim())

  let recap = ''
  let takeaway = ''
  let improvement = ''
  let currentSection = 'recap'

  for (const line of lines) {
    const trimmed = line.trim()
    const lower = trimmed.toLowerCase()

    // Detect section transitions
    if (/^(2\.|key\s*takeaway|takeaway)/i.test(trimmed)) {
      currentSection = 'takeaway'
      // Remove the label prefix
      const cleaned = trimmed.replace(/^(2\.\s*|key\s*takeaway[:\s]*|takeaway[:\s]*)/i, '').trim()
      if (cleaned) takeaway += (takeaway ? ' ' : '') + cleaned
      continue
    }
    if (/^(3\.|improvement|suggestion|suggested\s*improvement)/i.test(trimmed)) {
      currentSection = 'improvement'
      const cleaned = trimmed.replace(/^(3\.\s*|improvement[:\s]*|suggestion[:\s]*|suggested\s*improvement[:\s]*)/i, '').trim()
      if (cleaned) improvement += (improvement ? ' ' : '') + cleaned
      continue
    }
    if (/^(1\.|recap|summary)/i.test(trimmed) && !recap) {
      currentSection = 'recap'
      const cleaned = trimmed.replace(/^(1\.\s*|recap[:\s]*|summary[:\s]*)/i, '').trim()
      if (cleaned) recap += (recap ? ' ' : '') + cleaned
      continue
    }

    // Append to current section
    if (currentSection === 'recap') {
      recap += (recap ? ' ' : '') + trimmed
    } else if (currentSection === 'takeaway') {
      takeaway += (takeaway ? ' ' : '') + trimmed
    } else if (currentSection === 'improvement') {
      improvement += (improvement ? ' ' : '') + trimmed
    }
  }

  return {
    recap: recap || null,
    takeaway: takeaway || null,
    improvement: improvement || null,
  }
}
