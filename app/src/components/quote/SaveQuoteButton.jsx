// app/src/components/quote/SaveQuoteButton.jsx — "Save to Journal" for a quote.
//
// Creates a Journal 2.0 Notebook note (POST /api/j2/notes) holding the quote as
// a blockquote with its attribution line, tagged "quote", then flips into a deep
// link to the note. Same shape as the Desk's "Save session to Journal"
// (components/video/VideoDockSlot.jsx): a 3-state button, no toast component,
// cookie auth with credentials:'include'. Renders nothing when logged out —
// the banner itself is public, the note is not.

import { useContext, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import UIcon from '../ui/UIcon'
import styles from './SaveQuoteButton.module.css'
import { quoteNoteBody, quoteNoteTitle, QUOTE_NOTE_TAGS } from './quoteNote'

export default function SaveQuoteButton({ quote, compact = false }) {
  // Read the context directly rather than useAuth(): that hook THROWS outside
  // AuthProvider, and the quote banners also render in trees without one
  // (tests, embeds). No provider = nobody is signed in = no button.
  const user = useContext(AuthContext)?.user ?? null
  const [state, setState] = useState('idle')   // idle | saving | saved | error
  const [noteId, setNoteId] = useState(null)

  if (!user || !quote?.t) return null

  async function save() {
    if (state === 'saving') return
    setState('saving')
    try {
      const r = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: quoteNoteTitle(quote),
          subtitle: quote.src || '',
          bodyJson: quoteNoteBody(quote),
          tags: QUOTE_NOTE_TAGS,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setNoteId(j?.note?.id ?? null)
      setState('saved')
    } catch {
      setState('error')
    }
  }

  const cls = `${styles.btn} ${compact ? styles.compact : ''}`

  if (state === 'saved') {
    return noteId
      ? <Link className={`${cls} ${styles.saved}`} to={`/journal?j2tab=notebook&note=${noteId}`}>
          <UIcon name="check" size={11} /> Saved · Open
        </Link>
      : <span className={`${cls} ${styles.saved}`}><UIcon name="check" size={11} /> Saved</span>
  }

  const label = state === 'saving' ? 'Saving…' : state === 'error' ? 'Retry save' : 'Save to Journal'
  return (
    <button type="button" className={cls} onClick={save} disabled={state === 'saving'}
      aria-label="Save this quote to your Journal notebook" title="Save to Journal">
      <UIcon name="journal" size={11} /> {label}
    </button>
  )
}
