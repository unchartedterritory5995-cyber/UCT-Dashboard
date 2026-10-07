/**
 * Single EOD recap render — body + actions + optional unverified-claims badge.
 *
 * Props:
 *   recap: { id, body, day, metadata, feedback, created_at, validation }
 *   onFeedback(value: 'helpful'|'unhelpful'): void
 *   onRegenerate(): void
 *   onForget(): void
 *   accountId: the J2 selected account (or null for unified) — wave 13 lane 13F's
 *     "Draft in today's note" door reads the same period the recap itself covers
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { renderMarkdown } from '../lib/coachMarkdown'
import { formatETFull } from '../../../utils/timeAgo'
import UIcon from '../../../components/ui/UIcon'
import { reviewDraftsEnabled, draftDailyReview, todayDayIso } from '../lib/reviewDrafts'
import { compassScope } from '../hooks/compassScope'

export default function EODRecap({ recap, onFeedback, onRegenerate, onForget, accountId }) {
  const body = useMemo(() => renderMarkdown(recap?.body), [recap?.body])
  const navigate = useNavigate()
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState(null)
  if (!recap) return null

  const day = recap.day || recap.metadata?.day
  const handleDraft = async () => {
    if (drafting || !day) return
    setDrafting(true)
    setDraftError(null)
    try {
      const { note } = await draftDailyReview({ accountId: compassScope(accountId), day })
      navigate(`/journal/notebook?note=${encodeURIComponent(note.id)}`)
    } catch (e) {
      // `memberMessage` is a sentence the door wrote for the member (the note is still syncing).
      setDraftError(e?.memberMessage || 'Could not draft this recap into your daily note — try again.')
    } finally {
      setDrafting(false)
    }
  }

  const feedback = recap.feedback
  const validationPassed = recap.validation?.passed !== false
  const flags = recap.validation?.flags || []

  return (
    <article
      style={{
        background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 16px',
        margin: '8px 0',
      }}
    >
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, marginBottom: 6, paddingBottom: 6,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {recap.day || recap.metadata?.day || '—'}
          {recap.created_at && (
            <> · written {formatETFull(recap.created_at)}</>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button" aria-label="helpful"
            onClick={() => onFeedback('helpful')}
            style={chip(feedback === 'helpful', '#22c55e')}
          ><UIcon name="thumbsUp" size={11} /></button>
          <button
            type="button" aria-label="thumbs down"
            onClick={() => onFeedback('unhelpful')}
            style={chip(feedback === 'unhelpful', '#ef4444')}
          ><UIcon name="thumbsDown" size={11} /></button>
          <button type="button" onClick={onRegenerate} style={ghost()}>Regen</button>
          <button type="button" onClick={onForget} style={ghost()}>Forget</button>
          {reviewDraftsEnabled() && (
            <button
              type="button"
              className="touchTarget"
              onClick={handleDraft}
              disabled={drafting}
              style={ghost()}
            >
              {/* The draft lands in the daily note OF THE RECAP'S OWN DAY (fin-data M1). */}
              {drafting ? 'Drafting…' : (day === todayDayIso() ? 'Draft in today’s note' : 'Draft in that day’s note')}
            </button>
          )}
        </div>
      </header>
      {draftError && (
        <p role="alert" style={{ color: 'var(--danger-ink)', fontSize: 11, margin: '4px 0 8px' }}>
          {draftError}
        </p>
      )}
      {!validationPassed && (
        <div
          role="alert"
          style={{
            margin: '4px 0 8px',
            padding: '6px 10px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 6,
            color: 'var(--danger-ink)',
            fontSize: 11,
          }}
        >
          <UIcon name="warning" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />Compass made unverified claims — review carefully.
          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
            ({flags.length} flag{flags.length === 1 ? '' : 's'})
          </span>
        </div>
      )}
      <div>{body}</div>
    </article>
  )
}

function chip(active, color) {
  return {
    padding: '3px 8px', fontSize: 11,
    background: active ? color : 'transparent',
    color: active ? '#000' : 'var(--text-bright)',
    border: `1px solid ${active ? color : 'var(--border)'}`,
    borderRadius: 999, cursor: 'pointer',
  }
}

function ghost() {
  return {
    padding: '3px 8px', fontSize: 11,
    background: 'transparent', color: 'var(--text-muted)',
    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
  }
}
