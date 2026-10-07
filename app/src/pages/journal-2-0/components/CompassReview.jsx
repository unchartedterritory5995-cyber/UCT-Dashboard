/**
 * Single Compass review render — markdown body + action bar.
 *
 * Props:
 *   review: { id, body, summary, metadata, feedback, created_at, week_start }
 *   onFeedback(value: 'helpful'|'unhelpful'): void
 *   onRegenerate(): void
 *   onForget(): void
 *   accountId: the J2 selected account (or null for unified) — wave 13 lane 13F's
 *     "Draft weekly review note" door reads the same week this review covers
 *
 * Markdown rendering: minimal naive parser (headings + bullets + bold +
 * paragraphs). Avoids adding a heavy markdown lib for v1.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../components/ui/UIcon'
import { renderMarkdown } from '../lib/coachMarkdown'
import CompassAssistButton from '../../../components/voice/CompassAssistButton'
import { formatETFull } from '../../../utils/timeAgo'
import { reviewDraftsEnabled, draftWeeklyReview } from '../lib/reviewDrafts'
import { compassScope } from '../hooks/compassScope'

export default function CompassReview({ review, onFeedback, onRegenerate, onForget, accountId }) {
  const body = useMemo(() => renderMarkdown(review?.body), [review?.body])
  const navigate = useNavigate()
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState(null)
  if (!review) return null

  const weekStart = review.week_start || review.metadata?.week_start
  const handleDraft = async () => {
    if (drafting || !weekStart) return
    setDrafting(true)
    setDraftError(null)
    try {
      const { note } = await draftWeeklyReview({ accountId: compassScope(accountId), weekStart })
      navigate(`/journal/notebook?note=${encodeURIComponent(note.id)}`)
    } catch {
      setDraftError('Could not draft this week’s review note — try again.')
    } finally {
      setDrafting(false)
    }
  }

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
          ><UIcon name="thumbsUp" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Helpful</button>
          <button
            type="button"
            aria-label="thumbs down"
            onClick={() => onFeedback('unhelpful')}
            style={chipStyle(feedback === 'unhelpful', '#ef4444')}
          ><UIcon name="thumbsDown" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Unhelpful</button>
          <button type="button" onClick={onRegenerate} style={ghostBtn()}>Regenerate</button>
          <button type="button" onClick={onForget} style={ghostBtn()}>Forget</button>
          {reviewDraftsEnabled() && (
            <button
              type="button"
              className="touchTarget"
              onClick={handleDraft}
              disabled={drafting}
              style={ghostBtn()}
            >
              {drafting ? 'Drafting…' : 'Draft weekly review note'}
            </button>
          )}
          <CompassAssistButton
            pageHint={`Weekly Review · week of ${
              review.week_start || review.metadata?.week_start || 'unknown'
            }`}
            label="🎙️ Discuss"
          />
        </div>
      </header>
      {draftError && (
        <p role="alert" style={{ color: 'var(--danger-ink)', fontSize: 11, margin: '0 0 8px' }}>
          {draftError}
        </p>
      )}
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
