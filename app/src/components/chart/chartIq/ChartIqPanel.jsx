// app/src/components/chart/chartIq/ChartIqPanel.jsx — Chart IQ's read of the chart, beside the drawing.
//
// Collapsed (the default) it is one line: the first sentence of the thesis. Open: the thesis and plan, the context line (RS,
// group, weekly), what is setting up (trigger / stop), the read box and one switch per drawing layer. It sits top-right,
// clear of the OHLC legend (top-left) and the lookback bar (bottom-left), and scrolls inside itself.
import { useEffect, useState } from 'react'
import { mutate } from 'swr'
import { LAYERS } from './chartIqPlan'

export const VOTES = [['useful', 'Useful'], ['partly', 'Partly'], ['noise', 'Noise']]

// One vote and a note per member, per chart, per day (POST /api/chart-iq/{sym}/feedback). The note is the most valuable part,
// so it is a real box, not a one-line field. Saving updates the cached read so reopening the chart shows the saved vote.
export function ChartIqFeedback({ data }) {
  const [vote, setVote] = useState(data?.my_feedback?.vote || '')
  const [note, setNote] = useState(data?.my_feedback?.note || '')
  const [state, setState] = useState('')
  useEffect(() => {
    setVote(data?.my_feedback?.vote || ''); setNote(data?.my_feedback?.note || ''); setState('')
  }, [data?.ticker, data?.asof]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (v) => {
    const pick = v || vote
    if (!pick) { setState('Pick Useful, Partly or Noise first'); return }
    setVote(pick); setState('Saving...')
    try {
      const r = await fetch(`/api/chart-iq/${encodeURIComponent(data.ticker)}/feedback`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asof: data.asof, vote: pick, note, version: data.version || '' }),
      })
      if (!r.ok) throw new Error(r.status === 429 ? 'Daily limit reached' : `HTTP ${r.status}`)
      const saved = await r.json()
      mutate(`/api/chart-iq/${encodeURIComponent(data.ticker)}`, (d) => (d ? { ...d, my_feedback: saved } : d), { revalidate: false })
      setState('Saved, thank you')
    } catch (e) {
      setState(`Not saved: ${e.message}`)
    }
  }
  const btn = (on) => ({
    flex: 1, minHeight: 34, borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    border: `1px solid ${on ? 'var(--gold, #e3b341)' : 'var(--border, #2a2f36)'}`,
    background: on ? 'rgba(227,179,65,0.15)' : 'transparent', color: on ? 'var(--gold, #e3b341)' : 'inherit',
  })
  return (
    <div data-testid="chart-iq-feedback" style={{ borderTop: '1px solid var(--border, #2a2f36)', margin: '6px 0 0', paddingTop: 6 }}>
      <div style={{ ...tag, fontSize: 11, marginBottom: 4 }}>Was this read right?</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {VOTES.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={vote === id} style={btn(vote === id)} onClick={() => save(id)}>{label}</button>
        ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} aria-label="What did Chart IQ get wrong or miss?"
        placeholder="What did it get wrong or miss? A level, a candle, the setup, the plan..."
        style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, resize: 'vertical', fontSize: 12, padding: 6, borderRadius: 4,
          background: 'var(--bg, #0d1117)', color: 'inherit', border: '1px solid var(--border, #2a2f36)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <button type="button" onClick={() => save('')} style={{ ...btn(false), flex: '0 0 auto', padding: '0 12px' }}>Save note</button>
        <span style={sub} role="status">{state}</span>
      </div>
    </div>
  )
}

const box = {
  position: 'absolute', top: 30, right: 72, zIndex: 6, maxWidth: 380, maxHeight: '62%', overflowY: 'auto',
  background: 'var(--bg-elevated, #161a1f)', border: '1px solid var(--border, #2a2f36)', borderRadius: 6,
  color: 'var(--text, #c9d1d9)', fontSize: 12, lineHeight: 1.4, boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
}
const head = { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', userSelect: 'none' }
const tag = { fontWeight: 700, color: 'var(--gold, #e3b341)', whiteSpace: 'nowrap' }
const sub = { color: 'var(--text-muted, #8b949e)', fontSize: 11 }

export function firstSentence(s) {
  const t = String(s || '')
  const k = t.search(/\.\s/)
  return k > 0 ? t.slice(0, k + 1) : t
}

export default function ChartIqPanel({ data, loading, error, layers, onLayer, onClose }) {
  const [open, setOpen] = useState(false)
  const status = error ? 'Chart IQ could not read this chart' : loading && !data ? 'Chart IQ is reading the chart...' : ''
  return (
    <div style={box} data-testid="chart-iq-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div style={head} onClick={() => setOpen((v) => !v)} role="button" aria-expanded={open} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}>
        <span style={tag}>Chart IQ</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: open ? 'normal' : 'nowrap' }}>
          {status || (open ? '' : firstSentence(data?.thesis))}
        </span>
        <span style={sub} aria-hidden="true">{open ? 'less' : 'more'}</span>
        {onClose ? (
          <button type="button" aria-label="Turn Chart IQ off" onClick={(e) => { e.stopPropagation(); onClose() }}
            style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>×</button>
        ) : null}
      </div>
      {open && data ? (
        <div style={{ padding: '0 10px 8px' }}>
          <p style={{ margin: '2px 0 6px' }} data-testid="chart-iq-thesis">{data.thesis}</p>
          {data.context ? <p style={{ ...sub, margin: '0 0 6px' }}>{data.context}</p> : null}
          {data.watches?.length ? (
            <div style={{ margin: '0 0 6px' }}>
              <div style={{ ...tag, fontSize: 11 }}>Setting up (not a buy until it triggers)</div>
              {data.watches.map((w, k) => (
                <div key={k} style={{ margin: '2px 0' }}>
                  <b>{w.kind}</b>: {w.text}
                  <div style={sub}>trigger {w.trigger} · stop {w.stop} ({w.risk_pct}% risk) · {w.dist_atr} ATR away</div>
                </div>
              ))}
            </div>
          ) : null}
          {data.card?.length ? (
            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '2px 8px', margin: '0 0 6px' }}>
              {data.card.map(([k, v]) => [
                <dt key={`k${k}`} style={{ color: 'var(--gold, #e3b341)' }}>{k}</dt>,
                <dd key={`v${k}`} style={{ margin: 0 }}>{v}</dd>,
              ])}
            </dl>
          ) : null}
          {data.market ? <p style={{ ...sub, margin: '0 0 6px' }}>Market: {data.market}</p> : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            {LAYERS.map((l) => (
              <label key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!layers[l.id]} onChange={(e) => onLayer(l.id, e.target.checked)} />
                {l.label}
              </label>
            ))}
          </div>
          <ChartIqFeedback data={data} />
          <p style={{ ...sub, margin: '6px 0 0' }}>Engine read as of {data.asof}. Automated pattern recognition for education only: not
            investment advice and not a recommendation to buy or sell.</p>
        </div>
      ) : null}
    </div>
  )
}
