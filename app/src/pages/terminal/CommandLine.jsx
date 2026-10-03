// UCT Terminal — the ONE command line. Autocomplete from three sources, history on ↑/↓.
//
//   1. the function registry (functions.js) — synchronous, always;
//   2. the ticker search (`GET /api/ticker-search`, the palette's own endpoint) — for the
//      FIRST token, debounced;
//   3. the address space (`GET /api/address/search`, TERM-038) — only for a `X:` token and
//      only while `addressSpaceEnabled` rides the auth payload (a dark deploy asks nothing).
//
// ⛔ History is a per-viewer convenience, so it lives in localStorage, every access wrapped:
// private windows and blocked storage throw, and the command line must work without it.
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import jsonFetcher from '../../utils/jsonFetcher'
import { AuthContext } from '../../context/AuthContext'
import { FUNCTIONS } from './functions'
import styles from './TerminalShell.module.css'

export const HISTORY_KEY = 'uct.terminal.history'
export const HISTORY_MAX = 50

export function readHistory() {
  try {
    const v = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []
  } catch { return [] }
}

export function pushHistory(text) {
  const t = String(text || '').trim()
  if (!t) return readHistory()
  const next = [t, ...readHistory().filter((h) => h !== t)].slice(0, HISTORY_MAX)
  try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* storage off */ }
  return next
}

/** Pure: registry suggestions for what is typed. The token being completed is the LAST one;
 *  in first position a code competes with tickers, in second position only codes complete. */
export function registrySuggestions(text, limit = 6) {
  const tokens = String(text || '').trimStart().split(/\s+/)
  const last = (tokens[tokens.length - 1] || '').toUpperCase()
  if (!last) return []
  return FUNCTIONS.filter((f) => f.code.startsWith(last)).slice(0, limit)
    .map((f) => ({ kind: 'function', value: f.code, label: f.label, replaceLast: true }))
}

export default function CommandLine({ onSubmit, inputRef: externalRef, placeholder }) {
  const addressSpaceEnabled = useContext(AuthContext)?.addressSpaceEnabled === true
  const [text, setText] = useState('')
  const [remote, setRemote] = useState([])
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)
  const historyIdx = useRef(-1)
  const localRef = useRef(null)
  const ref = externalRef || localRef
  const listId = useId()

  const tokens = text.trimStart().split(/\s+/)
  const firstOnly = tokens.length === 1
  const last = tokens[tokens.length - 1] || ''

  useEffect(() => {
    const q = last.trim()
    setRemote([])
    if (!q) return undefined
    const ac = new AbortController()
    const t = setTimeout(() => {
      if (/^[A-Za-z]:\S*$/.test(q)) {
        if (!addressSpaceEnabled || q.length < 3) return
        jsonFetcher(`/api/address/search?q=${encodeURIComponent(q.slice(2))}`, { signal: ac.signal })
          .then((d) => setRemote((Array.isArray(d?.results) ? d.results : []).slice(0, 6).map((r) => ({
            kind: 'address', value: r.address, label: `${r.kind_label || 'Saved'} · ${r.name || ''}`,
            replaceLast: true,
          }))))
          .catch(() => {})
        return
      }
      if (!firstOnly || q.startsWith('$') && q.length < 2) return
      const sq = q.replace(/^\$/, '')
      if (!/^[A-Za-z][A-Za-z.-]{0,6}$/.test(sq)) return
      jsonFetcher(`/api/ticker-search?q=${encodeURIComponent(sq)}&limit=6`, { signal: ac.signal })
        .then((d) => setRemote((Array.isArray(d?.results) ? d.results : []).slice(0, 6).map((r) => ({
          kind: 'ticker', value: String(r.ticker || '').toUpperCase(), label: r.name || '',
          replaceLast: true,
        })).filter((r) => r.value)))
        .catch(() => {})
    }, 150)
    return () => { clearTimeout(t); ac.abort() }
  }, [last, firstOnly, addressSpaceEnabled])

  const suggestions = useMemo(() => {
    const reg = registrySuggestions(text)
    const seen = new Set()
    return [...reg, ...remote].filter((s) => {
      const k = `${s.kind}:${s.value}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 10)
  }, [text, remote])

  const accept = (s) => {
    const parts = text.trimStart().split(/\s+/)
    parts[parts.length - 1] = s.value
    setText(`${parts.join(' ')} `)
    setActive(-1)
    ref.current?.focus()
  }

  const submit = (value) => {
    const v = String(value ?? text).trim()
    if (!v) return
    pushHistory(v)
    historyIdx.current = -1
    setText('')
    setOpen(false)
    setActive(-1)
    onSubmit?.(v)
  }

  const onKeyDown = (e) => {
    const showing = open && suggestions.length > 0
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showing && active >= 0) { accept(suggestions[active]); return }
      submit()
    } else if (e.key === 'Tab' && showing) {
      e.preventDefault()
      accept(suggestions[Math.max(0, active)])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (showing) setActive((i) => Math.min(suggestions.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (showing && active >= 0) { setActive((i) => i - 1); return }
      const h = readHistory()
      if (!h.length) return
      historyIdx.current = Math.min(h.length - 1, historyIdx.current + 1)
      setText(h[historyIdx.current])
      setOpen(false)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className={styles.cmdWrap}>
      <span className={styles.cmdPrompt} aria-hidden="true">&gt;</span>
      <input
        ref={ref}
        className={styles.cmdInput}
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); historyIdx.current = -1 }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder || 'NVDA GP · AAPL FA · CAL · HELP'}
        aria-label="UCT Terminal command"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        data-testid="terminal-command"
      />
      <button type="button" className={styles.cmdGo} onClick={() => submit()} aria-label="Run command">Go</button>
      {open && suggestions.length > 0 && (
        <ul id={listId} role="listbox" className={styles.suggest} data-testid="terminal-suggestions">
          {suggestions.map((s, i) => (
            <li key={`${s.kind}:${s.value}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`${styles.suggestRow} ${i === active ? styles.suggestOn : ''}`}
                onMouseDown={(e) => { e.preventDefault(); accept(s) }}
              >
                <span className={styles.code}>{s.value}</span>
                <span className={styles.suggestLabel}>{s.label}</span>
                <span className={styles.suggestKind}>{s.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
