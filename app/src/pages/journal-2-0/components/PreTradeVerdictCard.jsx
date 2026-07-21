/**
 * Pre-Trade Verdict card — renders verdict label + paragraph + collapsible factors.
 *
 * Props:
 *   verdict: null | { label: 'GO'|'HOLD'|'SKIP'|'ERROR', paragraph: string, factors: string[] }
 *   isLoading: bool
 *   error?: string
 */
import { useState, useEffect, useRef, useContext } from 'react'
import { VoiceContext } from '../../../context/VoiceContext'
import UIcon from '../../../components/ui/UIcon'

const LABEL_STYLES = {
  GO: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.5)', text: '#22c55e' },
  HOLD: { bg: 'rgba(201,168,76,0.10)', border: 'rgba(201,168,76,0.5)', text: '#c9a84c' },
  SKIP: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.5)', text: '#ef4444' },
  ERROR: { bg: 'rgba(120,120,120,0.10)', border: 'var(--border)', text: 'var(--text-muted)' },
}

export default function PreTradeVerdictCard({ verdict, isLoading, error }) {
  const [open, setOpen] = useState(false)
  const voice = useContext(VoiceContext)
  const spokenForRef = useRef(null)

  // P5-I: When a fresh verdict lands AND proactive_speak is ON, read the
  // label + paragraph aloud. One-shot per verdict — spokenForRef avoids
  // repeats on re-renders or accordion toggles.
  useEffect(() => {
    if (!voice) return
    if (!verdict || !verdict.label || !verdict.paragraph) return
    const id = `${verdict.label}-${(verdict.paragraph || '').slice(0, 40)}`
    if (spokenForRef.current === id) return
    spokenForRef.current = id

    let cancelled = false
    const run = async () => {
      // Snapshot the playback generation BEFORE the async TTS fetch: if the user
      // stops (or another read starts) while this is in flight, playWhenCurrent
      // below no-ops instead of starting audio they already cancelled.
      const _playGen = voice.getPlayGen()
      try {
        const settingsResp = await fetch('/api/voice/settings', {
          credentials: 'include',
        })
        if (!settingsResp.ok) return
        const settings = await settingsResp.json()
        if (!settings.proactive_speak || !settings.enabled) return

        // Don't talk over anything else
        if (voice.status === 'playing' || voice.status === 'loading') return
        if (voice.mode === 'c'
            && voice.status !== 'idle'
            && voice.status !== 'error') return

        // Urgent variant for refusals: distinct prefix + 10% faster delivery
        // (still well inside [0.5, 2.0]). HOLD gets a softer prefix at normal
        // speed. GO stays neutral.
        let prefix
        let speed
        if (verdict.label === 'SKIP') {
          prefix = 'Hold up. Compass says SKIP.'
          speed = 1.1
        } else if (verdict.label === 'HOLD') {
          prefix = 'Heads up. Compass says HOLD.'
          speed = undefined
        } else {
          prefix = `Compass verdict: ${verdict.label}.`
          speed = undefined
        }
        const text = `${prefix} ${verdict.paragraph}`
        const ttsBody = { text }
        if (speed !== undefined) ttsBody.speed = speed
        const ttsResp = await fetch('/api/voice/tts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsBody),
        })
        if (!ttsResp.ok || cancelled) return
        const blob = await ttsResp.blob()
        const url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        await voice.playWhenCurrent(_playGen, {
          url,
          trackId: `compass-verdict-${id}`,
          trackLabel: `Compass — ${verdict.label}`,
        })
      } catch { /* swallow */ }
    }
    run()
    return () => { cancelled = true }
  }, [verdict, voice])

  if (isLoading) {
    return (
      <div style={cardStyle('var(--border)', 'rgba(255,255,255,0.02)')}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          <UIcon name="compass" size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Compass is thinking…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={cardStyle('rgba(239,68,68,0.5)', 'rgba(239,68,68,0.06)')}>
        <div style={{ fontSize: 12, color: '#ef4444' }}>Verdict error: {error}</div>
      </div>
    )
  }

  if (!verdict) return null

  const styles = LABEL_STYLES[verdict.label] || LABEL_STYLES.ERROR
  return (
    <div style={cardStyle(styles.border, styles.bg)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}><UIcon name="compass" size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} />Compass</div>
        <div style={{
          padding: '4px 12px', fontSize: 14, fontWeight: 700,
          borderRadius: 4, background: styles.text, color: '#000',
        }}>
          {verdict.label}
        </div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-bright)', marginBottom: 6 }}>
        {verdict.paragraph}
      </div>
      {Array.isArray(verdict.factors) && verdict.factors.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              fontSize: 11, color: 'var(--text-muted)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, textDecoration: 'underline',
            }}
          >
            {open ? '▾ Hide' : '▸ What Compass weighed'}
          </button>
          {open && (
            <ul style={{ margin: '6px 0 0 18px', fontSize: 11, color: 'var(--text-muted)' }}>
              {verdict.factors.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </>
      )}
      <div style={{
        marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)',
        fontSize: 10, lineHeight: 1.4, color: 'var(--text-muted)',
      }}>
        Educational only — not investment advice. Compass grades setups against the
        firm&apos;s method; you are solely responsible for your own trading decisions.
      </div>
    </div>
  )
}

function cardStyle(border, bg) {
  return {
    margin: '8px 0',
    padding: '10px 14px',
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 6,
  }
}
