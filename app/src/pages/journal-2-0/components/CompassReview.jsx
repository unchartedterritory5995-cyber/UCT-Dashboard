/**
 * Single Compass review render — markdown body + action bar.
 *
 * Props:
 *   review: { id, body, summary, metadata, feedback, created_at, week_start }
 *   onFeedback(value: 'helpful'|'unhelpful'): void
 *   onRegenerate(): void
 *   onForget(): void
 *
 * Markdown rendering: minimal naive parser (headings + bullets + bold +
 * paragraphs). Avoids adding a heavy markdown lib for v1.
 */

import { useMemo } from 'react'
import { renderMarkdown } from '../lib/coachMarkdown'
import CompassAssistButton from '../../../components/voice/CompassAssistButton'
import { formatETFull } from '../../../utils/timeAgo'

export default function CompassReview({ review, onFeedback, onRegenerate, onForget }) {
  const body = useMemo(() => renderMarkdown(review?.body), [review?.body])
  if (!review) return null

  const feedback = review.feedback

  return (
    <article
      style={{
        background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '16px 20px',
        margin: '12px 0',
      }}
    >
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, marginBottom: 8, paddingBottom: 8,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Week of <strong>{review.week_start || review.metadata?.week_start || '—'}</strong>
          {review.created_at && (
            <> · written {formatETFull(review.created_at)}</>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            aria-label="helpful"
            onClick={() => onFeedback('helpful')}
            style={chipStyle(feedback === 'helpful', '#22c55e')}
          >👍 Helpful</button>
          <button
            type="button"
            aria-label="thumbs down"
            onClick={() => onFeedback('unhelpful')}
            style={chipStyle(feedback === 'unhelpful', '#ef4444')}
          >👎 Unhelpful</button>
          <button type="button" onClick={onRegenerate} style={ghostBtn()}>Regenerate</button>
          <button type="button" onClick={onForget} style={ghostBtn()}>Forget</button>
          <CompassAssistButton
            pageHint={`Weekly Review · week of ${
              review.week_start || review.metadata?.week_start || 'unknown'
            }`}
            label="🎙️ Discuss"
          />
        </div>
      </header>
      <div>{body}</div>
    </article>
  )
}

function chipStyle(active, color) {
  return {
    padding: '4px 10px',
    fontSize: 11,
    background: active ? color : 'transparent',
    color: active ? '#000' : 'var(--text-bright)',
    border: `1px solid ${active ? color : 'var(--border)'}`,
    borderRadius: 999,
    cursor: 'pointer',
  }
}

function ghostBtn() {
  return {
    padding: '4px 10px',
    fontSize: 11,
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
  }
}
