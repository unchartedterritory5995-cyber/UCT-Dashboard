import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NoteAskPanel.module.css'

// Ask Current Note (Wave 2, P0-5). Bounded-context Q&A over THIS note only —
// see api/routers/journal_two.py::ask_current_note_stream +
// api/services/note_ask.py for the backend contract. Citation affordance:
// the model is instructed (note_ask.SYNTH_SYSTEM) to quote short exact
// phrases from the note in "double quotes" — this panel turns each quoted
// span into a click-to-jump chip that scrolls the editor to that text and
// flashes it, so a citation is independently verifiable against the
// member's own writing (architecture spec §8.5).

const CITATION_RE = /"([^"]{3,200})"/g

function splitAnswerIntoCitations(answer) {
  const parts = []
  let last = 0
  let m
  CITATION_RE.lastIndex = 0
  while ((m = CITATION_RE.exec(answer))) {
    if (m.index > last) parts.push({ text: answer.slice(last, m.index), quote: null })
    parts.push({ text: m[0], quote: m[1] })
    last = m.index + m[0].length
  }
  if (last < answer.length) parts.push({ text: answer.slice(last), quote: null })
  return parts
}

// Finds the first text node under `root` whose text contains `phrase`,
// scrolls its parent element into view, and flashes it briefly. Returns
// true if found. Pure DOM (TreeWalker) — works against TipTap's rendered
// contentEditable without needing ProseMirror position math.
export function jumpToNoteText(root, phrase) {
  if (!root || !phrase) return false
  const needle = phrase.trim()
  if (!needle) return false
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    if (node.textContent && node.textContent.includes(needle)) {
      const el = node.parentElement
      if (!el) continue
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add(styles.citationFlash)
      window.setTimeout(() => el.classList.remove(styles.citationFlash), 1500)
      return true
    }
  }
  return false
}

export default function NoteAskPanel({ noteId, getEditorDom }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState('idle') // idle | asking | done | error | limit
  const [errorMsg, setErrorMsg] = useState('')
  const abortRef = useRef(null)
  const historyRef = useRef([])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function ask() {
    const q = query.trim()
    if (!q || status === 'asking') return
    setStatus('asking'); setAnswer(''); setErrorMsg('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const r = await fetch(`/api/j2/notes/${noteId}/ask/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, history: historyRef.current.slice(-3) }),
        signal: controller.signal,
      })
      if (r.status === 429) {
        const d = await r.json().catch(() => null)
        setStatus('limit')
        setErrorMsg(d?.detail || "You've hit today's Ask Current Note limit — it resets at midnight ET.")
        return
      }
      if (r.status === 402) {
        setStatus('limit')
        setErrorMsg('Ask Current Note requires a paid plan.')
        return
      }
      if (!r.ok || !r.body?.getReader) { setStatus('error'); setErrorMsg('Something went wrong.'); return }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2)
          const line = block.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          let ev
          try { ev = JSON.parse(line.slice(5)) } catch { continue }
          if (ev.type === 'delta' && ev.text) { text += ev.text; setAnswer(text) }
          else if (ev.type === 'final') { text = ev.answer || text; setAnswer(text) }
          else if (ev.type === 'error') { setStatus('error'); setErrorMsg(ev.detail || 'Something went wrong.') }
        }
      }
      if (text.trim()) {
        historyRef.current = [...historyRef.current, { q, a: text }]
        setStatus('done')
      } else if (status !== 'error') {
        setStatus('error'); setErrorMsg('No answer came back.')
      }
    } catch (e) {
      if (e?.name !== 'AbortError') { setStatus('error'); setErrorMsg('Something went wrong.') }
    }
  }

  function onCitationClick(quote) {
    const dom = getEditorDom?.()
    jumpToNoteText(dom, quote)
  }

  const parts = answer ? splitAnswerIntoCitations(answer) : []

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.askToggle}
        onClick={() => setOpen((o) => !o)}
        title="Ask a question about this note"
        aria-label="Ask a question about this note"
      >
        <UIcon name="sparkle" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Ask this note
      </button>
      {open && (
        <div className={styles.panel} role="dialog" aria-label="Ask this note">
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Ask this note</span>
            <button type="button" className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask() }}
              placeholder="What did I say about…"
              disabled={status === 'asking'}
            />
            <button type="button" className={styles.askBtn} onClick={ask} disabled={status === 'asking' || !query.trim()}>
              {status === 'asking' ? 'Asking…' : 'Ask'}
            </button>
          </div>
          {(status === 'error' || status === 'limit') && (
            <div className={styles.errorMsg} role="alert">{errorMsg}</div>
          )}
          {answer && (
            <div className={styles.answer} data-testid="note-ask-answer">
              {parts.length
                ? parts.map((p, i) => p.quote
                    ? (
                      <button
                        key={i}
                        type="button"
                        className={styles.citationChip}
                        onClick={() => onCitationClick(p.quote)}
                        title="Jump to this in the note"
                        aria-label={`Jump to this in the note: ${p.text}`}
                      >
                        {p.text}
                      </button>
                    )
                    : <span key={i}>{p.text}</span>)
                : answer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
