/**
 * TradeReviewCard — Compass's post-mortem for one specific trade.
 *
 * Props:
 *   review: null | { id, body, feedback, created_at }
 *   isLoading: bool
 *   onFeedback?(value: 'helpful'|'unhelpful'): void
 *   onRegenerate?(): void
 *   onForget?(): void
 */

export default function TradeReviewCard({ review, isLoading, onFeedback, onRegenerate, onForget }) {
  if (isLoading) {
    return (
      <div style={cardStyle()}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          🧭 Compass is writing the post-mortem…
        </div>
      </div>
    )
  }
  if (!review) return null
  const fb = review.feedback
  return (
    <article style={cardStyle()}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 10, marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 10, color: 'var(--ut-gold, #c9a84c)' }}>
          🧭 Compass review
          {review.created_at && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              · {new Date(review.created_at).toLocaleString()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" aria-label="helpful"
            onClick={() => onFeedback && onFeedback('helpful')}
            style={chipStyle(fb === 'helpful', '#22c55e')}>👍</button>
          <button type="button" aria-label="thumbs down"
            onClick={() => onFeedback && onFeedback('unhelpful')}
            style={chipStyle(fb === 'unhelpful', '#ef4444')}>👎</button>
          <button type="button" onClick={() => onRegenerate && onRegenerate()} style={ghostBtn()}>Regen</button>
          <button type="button" onClick={() => onForget && onForget()} style={ghostBtn()}>Forget</button>
        </div>
      </header>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-bright)', whiteSpace: 'pre-wrap' }}>
        {review.body}
      </div>
    </article>
  )
}

function cardStyle() {
  return {
    background: 'rgba(201,168,76,0.05)',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 8,
    padding: '10px 14px',
    margin: '8px 0',
  }
}

function chipStyle(active, color) {
  return {
    padding: '3px 8px', fontSize: 11,
    background: active ? color : 'transparent',
    color: active ? '#000' : 'var(--text-bright)',
    border: `1px solid ${active ? color : 'var(--border)'}`,
    borderRadius: 999, cursor: 'pointer',
  }
}

function ghostBtn() {
  return {
    padding: '3px 8px', fontSize: 11,
    background: 'transparent', color: 'var(--text-muted)',
    border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
  }
}
