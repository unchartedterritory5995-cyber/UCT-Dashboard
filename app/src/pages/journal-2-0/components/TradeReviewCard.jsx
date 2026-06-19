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
import { useEffect, useRef, useContext } from 'react'
import { VoiceContext } from '../../../context/VoiceContext'
import UIcon from '../../../components/ui/UIcon'
import { formatETFull } from '../../../utils/timeAgo'


export default function TradeReviewCard({ review, isLoading, onFeedback, onRegenerate, onForget }) {
  // P5-J: when a fresh review lands AND proactive_speak is ON, speak it
  // through Compass. Localstorage-gated per review_id so revisits to
  // an already-heard review don't replay.
  const voice = useContext(VoiceContext)
  const spokenForRef = useRef(null)
  useEffect(() => {
    if (!voice) return
    if (!review?.id || !review?.body) return
    if (spokenForRef.current === review.id) return
    const lsKey = `compass.tradereview_spoken.${review.id}`
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(lsKey)) {
        spokenForRef.current = review.id
        return
      }
    } catch { /* ignore */ }
    spokenForRef.current = review.id
    let cancelled = false
    const run = async () => {
      try {
        const settingsResp = await fetch('/api/voice/settings', {
          credentials: 'include',
        })
        if (!settingsResp.ok) return
        const settings = await settingsResp.json()
        if (!settings.proactive_speak || !settings.enabled) return
        if (voice.status === 'playing' || voice.status === 'loading') return
        if (voice.mode === 'c'
            && voice.status !== 'idle'
            && voice.status !== 'error') return

        const text = `Trade post-mortem. ${(review.body || '').slice(0, 2500)}`
        const ttsResp = await fetch('/api/voice/tts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (!ttsResp.ok || cancelled) return
        const blob = await ttsResp.blob()
        const url = URL.createObjectURL(blob)
        if (cancelled) { URL.revokeObjectURL(url); return }
        await voice.playUrl({
          url,
          trackId: `compass-tradereview-${review.id}`,
          trackLabel: 'Compass — Trade post-mortem',
        })
        try { localStorage.setItem(lsKey, '1') } catch { /* ignore */ }
      } catch { /* swallow */ }
    }
    run()
    return () => { cancelled = true }
  }, [review?.id, review?.body, voice])

  if (isLoading) {
    return (
      <div style={cardStyle()}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          <UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Compass is writing the post-mortem…
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
          <UIcon name="compass" size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />Compass review
          {review.created_at && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              · {formatETFull(review.created_at)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" aria-label="helpful"
            onClick={() => onFeedback && onFeedback('helpful')}
            style={chipStyle(fb === 'helpful', '#22c55e')}><UIcon name="thumbsUp" size={13} /></button>
          <button type="button" aria-label="thumbs down"
            onClick={() => onFeedback && onFeedback('unhelpful')}
            style={chipStyle(fb === 'unhelpful', '#ef4444')}><UIcon name="thumbsDown" size={13} /></button>
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
