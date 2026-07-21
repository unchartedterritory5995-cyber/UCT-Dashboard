// app/src/components/community/ShareToFloor.jsx
// Reusable "Share to The Floor" action — drops a rich card into the live chat from
// anywhere in the dashboard (chart / journal trade / flow alert). The client sends
// only a REFERENCE; the server builds+redacts the card_json (community_cards.py).
// Renders nothing when the viewer has no live-chat access.
import { useState } from 'react'
import useSWR from 'swr'
import UIcon from '../ui/UIcon'
import styles from './ShareToFloor.module.css'

const fetcher = (u) => fetch(u, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))
const CHANNEL = 'trading-floor'

function noteDoc(text) {
  const t = (text || '').trim()
  if (!t) return ''
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
}

export default function ShareToFloor({ card, label = 'Share to Floor', compact = false, direct = false, onShared = null }) {
  const { data: status } = useSWR('/api/community/status', fetcher)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [state, setState] = useState('idle') // idle | sending | done | error
  const [err, setErr] = useState(null)

  if (!status?.chat_enabled || !card) return null

  const share = async () => {
    setState('sending'); setErr(null)
    try {
      const r = await fetch(`/api/community/chat/channels/${CHANNEL}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteDoc(note), card }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.detail || `Error ${r.status}`)
      setState('done')
      try { onShared?.() } catch { /* callback must never break the share */ }
      setTimeout(() => { setOpen(false); setState('idle'); setNote('') }, 1400)
    } catch (e) {
      setState('error'); setErr(e.message)
    }
  }

  // direct mode: no note popover — one click shares (for tight spaces like table rows).
  if (direct) {
    return (
      <button className={compact ? styles.btnCompact : styles.btn}
        onClick={share} disabled={state === 'sending' || state === 'done'}
        title={err || 'Share to The Floor'}>
        <UIcon name="community" size={compact ? 13 : 14} />
        {!compact && <span>{state === 'done' ? 'Shared' : state === 'sending' ? 'Sharing…' : label}</span>}
      </button>
    )
  }

  return (
    <div className={styles.wrap}>
      <button className={compact ? styles.btnCompact : styles.btn} onClick={() => setOpen((o) => !o)}
        title="Share to The Floor">
        <UIcon name="community" size={compact ? 13 : 14} />
        {!compact && <span>{label}</span>}
      </button>
      {open && (
        <div className={styles.pop}>
          <div className={styles.popHead}>Share to <b>#{CHANNEL}</b></div>
          <textarea className={styles.note} placeholder="Add a note (optional)…"
            maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          {err && <div className={styles.err}>{err}</div>}
          <div className={styles.foot}>
            <button className={styles.cancel} onClick={() => setOpen(false)}>Cancel</button>
            <button className={styles.send} onClick={share} disabled={state === 'sending' || state === 'done'}>
              {state === 'done' ? 'Shared ✓' : state === 'sending' ? 'Sharing…' : 'Share'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
