import { useState, useRef, useEffect } from 'react'
import { Avatar } from './util'
import { IconTop, IconClose } from './icons'
import ChartCard from './ChartCard'
import ChartAttach from './ChartAttach'

// Inline reply / top-level comment composer. Enter to send, Shift+Enter newline.
// Supports attaching a chart (ticker + timeframe).
export default function ReplyBox({ placeholder, onSubmit, onCancel, autoFocus, me }) {
  const [text, setText] = useState('')
  const [chart, setChart] = useState(null)
  const [attaching, setAttaching] = useState(false)
  const ref = useRef(null)
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus() }, [autoFocus])

  const submit = () => {
    const t = text.trim()
    if (!t && !chart) return
    onSubmit(t, chart)
    setText(''); setChart(null); setAttaching(false)
  }
  return (
    <div className="inline-reply">
      <div style={{ display: 'flex', gap: 10 }}>
        <Avatar id={me?.id} info={me} size={28} />
        <textarea
          ref={ref} className="reply-box" value={text}
          placeholder={placeholder || 'Add a comment…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            if (e.key === 'Escape' && onCancel) onCancel()
          }}
        />
      </div>

      <div style={{ marginLeft: 38 }}>
        {chart && (
          <div className="attach-preview">
            <ChartCard {...chart} caption={null} height={150} />
            <button className="attach-remove" onClick={() => setChart(null)}><IconClose size={13} /> Remove chart</button>
          </div>
        )}
        {attaching && !chart && (
          <ChartAttach onDone={(c) => { setChart(c); setAttaching(false) }} onCancel={() => setAttaching(false)} />
        )}
        <div className="reply-row">
          <button className="btn-primary" disabled={!text.trim() && !chart} onClick={submit}>Reply</button>
          {!chart && !attaching && (
            <button className="btn-ghost" onClick={() => setAttaching(true)}><IconTop size={15} /> Chart</button>
          )}
          {onCancel && <button className="btn-ghost" onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </div>
  )
}
