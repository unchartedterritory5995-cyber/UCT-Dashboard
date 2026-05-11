/**
 * Single EOD recap render — body + actions + optional unverified-claims badge.
 *
 * Props:
 *   recap: { id, body, day, metadata, feedback, created_at, validation }
 *   onFeedback(value: 'helpful'|'unhelpful'): void
 *   onRegenerate(): void
 *   onForget(): void
 */

import { useMemo } from 'react'
import { renderMarkdown } from '../lib/coachMarkdown'

export default function EODRecap({ recap, onFeedback, onRegenerate, onForget }) {
  const body = useMemo(() => renderMarkdown(recap?.body), [recap?.body])
  if (!recap) return null

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
            <> · written {new Date(recap.created_at).toLocaleString()}</>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button" aria-label="helpful"
            onClick={() => onFeedback('helpful')}
            style={chip(feedback === 'helpful', '#22c55e')}
          >👍</button>
          <button
            type="button" aria-label="thumbs down"
            onClick={() => onFeedback('unhelpful')}
            style={chip(feedback === 'unhelpful', '#ef4444')}
          >👎</button>
          <button type="button" onClick={onRegenerate} style={ghost()}>Regen</button>
          <button type="button" onClick={onForget} style={ghost()}>Forget</button>
        </div>
      </header>
      {!validationPassed && (
        <div
          role="alert"
          style={{
            margin: '4px 0 8px',
            padding: '6px 10px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 6,
            color: 'var(--loss, #ef4444)',
            fontSize: 11,
          }}
        >
          ⚠ Compass made unverified claims — review carefully.
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
