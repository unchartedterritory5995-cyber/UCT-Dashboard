// FlowExplainButton — PACKET-AA CP1 (fingerprint f7fb7c477).
//
// A complete, cost-guarded, paid-gated "explain this print" backend
// (api/flow_explain.py, POST /api/flow-explain) has existed with zero
// frontend caller. This is the standalone UI door: a small tap-to-open
// trigger + its own modal, self-contained, calling the endpoint directly.
//
// ⛔ NOT MOUNTED ANYWHERE YET. This file does not import from, and is not
// imported by, OptionsFlow.jsx. CP2 (a separate, partner-ack-gated
// checkpoint) is the only piece that inserts a trigger for this component
// into that file, via one additive className hook — never an inline
// style={{}} edit. See the gate packet for the full reasoning.
//
// A print row passes its own fields straight through as `print` (matching
// the backend's FlowPrint shape); the caller supplies `spot` (the live
// price) and `dte` since those aren't always already on a print's own row
// object the same way.

import { useEffect, useState } from 'react'
import FlowIcon from './FlowIcon'

const COLORS = {
  bg: '#0a0f1c',
  panel: '#0e1526',
  border: '#2a3548',
  borderGold: '#dcbb5e55',
  gold: '#dcbb5e',
  text: '#e8ecf3',
  muted: '#8b96a8',
  danger: '#e05d5d',
}

/** One tap-to-open icon button. Renders inline; the caller places it in a row/cell. */
export default function FlowExplainButton({ print, size = 11, style }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Explain this print"
        title="Explain this print"
        data-testid="flow-explain-trigger"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 2, display: 'inline-flex', alignItems: 'center', ...style,
        }}
      >
        <FlowIcon name="sparkle" size={size} />
      </button>
      {open && <FlowExplainModal print={print} onClose={() => setOpen(false)} />}
    </>
  )
}

function fmtRequestBody(print) {
  return {
    ticker: print.ticker,
    cp: print.cp,
    strike: print.strike,
    exp: print.exp,
    dte: print.dte,
    premium: print.premium,
    volume: print.volume,
    oi: print.oi,
    side: print.side || '',
    spot: print.spot,
    order_type: print.order_type || '',
    color: print.color || '',
    grade: print.grade ?? null,
    tier: print.tier ?? null,
  }
}

/** The modal itself, exported separately so it can be tested / reused without
 * the trigger button (e.g. a caller that already has its own open/close
 * state can render just this). */
export function FlowExplainModal({ print, onClose }) {
  const [state, setState] = useState('idle') // idle | loading | done | error | capped
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  async function fetchExplanation() {
    setState('loading')
    setErrorMsg(null)
    try {
      const res = await fetch('/api/flow-explain/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fmtRequestBody(print)),
      })
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}))
        setErrorMsg(body.detail || 'Daily explain limit reached. Resets at midnight ET.')
        setState('capped')
        return
      }
      if (res.status === 402) {
        setErrorMsg('Flow explanations require a paid plan.')
        setState('error')
        return
      }
      if (!res.ok) {
        let detail = `Could not explain this print (${res.status}).`
        try { detail = (await res.json())?.detail || detail } catch { /* keep default */ }
        setErrorMsg(detail)
        setState('error')
        return
      }
      const json = await res.json()
      setResult(json)
      setState('done')
    } catch {
      setErrorMsg('Could not reach the explain service — try again.')
      setState('error')
    }
  }

  // Fetch once, on mount.
  useEffect(() => { fetchExplanation() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isDeterministic = result?.model === 'deterministic-fallback'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Explain this print"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: '#000000aa', zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 8, padding: 20, maxWidth: 420, width: '90%',
          fontFamily: 'inherit', color: COLORS.text,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.gold, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FlowIcon name="sparkle" size={13} />
            Explain this print
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: COLORS.muted }}>
            <FlowIcon name="x" size={13} semantic />
          </button>
        </div>

        {print && (
          <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 12 }}>
            {print.ticker} {print.strike}{print.cp} {print.exp}
          </div>
        )}

        {state === 'loading' && (
          <div style={{ fontSize: 12, color: COLORS.muted }}>Explaining…</div>
        )}

        {state === 'capped' && (
          <div style={{ fontSize: 12, color: COLORS.gold }}>{errorMsg}</div>
        )}

        {state === 'error' && (
          <div style={{ fontSize: 12, color: COLORS.danger }} role="alert">{errorMsg}</div>
        )}

        {state === 'done' && result && (
          <div>
            {isDeterministic && (
              <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 8, fontStyle: 'italic' }}>
                Plain-English read from the print's own numbers (not AI-generated right now).
              </div>
            )}
            <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>{result.explanation}</div>
            {result.signals?.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: COLORS.muted }}>
                {result.signals.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
            {result.cached && (
              <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 10 }}>Cached read.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
