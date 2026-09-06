import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import CompanyLogo from './CompanyLogo'
import UIcon from './ui/UIcon'
import { useJ2Favorites, useJ2Recents } from '../pages/journal-2-0/hooks/useJ2Notes'
import styles from './CommandPalette.module.css'

const TICKER_LIKE = /^[A-Z0-9.\-]{1,10}$/

// Wave B: Notebook joins the ONE existing command palette rather than
// growing a second, Notebook-specific one (directive §12) — a small static
// action list matched against the same query box a ticker search uses.
// Every `to` is a route that genuinely exists today (verified against
// App.jsx's route table + NotebookTab.jsx's deep-link handling — no
// dead/future commands per §13). "Create Thesis" was evaluated and dropped:
// with no trade/strategy already in context, there is no genuine
// context-free destination for it yet.
const NOTEBOOK_COMMANDS = [
  { id: 'nb-new', kind: 'command', label: 'New Note', icon: 'document',
    to: '/journal/notebook?new=blank', keywords: ['note', 'notebook', 'new', 'create'] },
  { id: 'nb-open', kind: 'command', label: 'Open Notebook', icon: 'library',
    to: '/journal/notebook', keywords: ['notebook', 'note', 'research', 'open'] },
  { id: 'nb-search', kind: 'command', label: 'Search Notebook', icon: 'search',
    to: '/journal/notebook', keywords: ['notebook', 'search', 'find', 'note'] },
  { id: 'nb-trash', kind: 'command', label: 'Open Trash', icon: 'trash',
    to: '/journal/notebook?folder=__trash__', keywords: ['trash', 'deleted', 'notebook', 'note'] },
]
// Natural-terminology matching (§14): a 2-character floor avoids a bare
// letter matching half the keyword list, and `.includes()` (not an exact
// match) lets a partial word like "note" or "thesis" surface the right
// command without requiring the user to type the full label.
function commandMatches(cmd, q) {
  if (q.length < 2) return false
  if (cmd.label.toLowerCase().includes(q)) return true
  return cmd.keywords.some((k) => k.includes(q))
}
const RECENT_FAVORITE_KEYWORDS = ['recent', 'favorite', 'favourite']
function notebookNoteRowsMatch(q) {
  return q.length >= 2 && RECENT_FAVORITE_KEYWORDS.some((k) => k.startsWith(q))
}

/**
 * Global Ctrl/Cmd+K command palette — S2's first slice (security/company
 * discovery + navigation only; see the 2026-09-03 narrow-slice authorization).
 * Mounted once in Layout.jsx so it works from anywhere in the authed shell.
 *
 * Settings.jsx already owns a PAGE-SCOPED ⌘K ("jump to any setting") via a
 * bubble-phase window listener. This one listens on the CAPTURE phase and
 * stops propagation on match, so it wins the shortcut everywhere including
 * /settings — mirroring SymbolSearch.jsx's own capture-phase Escape handling,
 * the codebase's existing pattern for exactly this kind of precedence.
 *
 * Exposes an imperative `open()` via ref so the visible NavBar/MobileNav
 * triggers (2026-09-03 discoverability slice) can open the SAME palette a
 * click/tap invokes — the component stays otherwise fully self-contained
 * (no controlled open/onClose props), preserving the original architecture.
 */
const CommandPalette = forwardRef(function CommandPalette(_props, ref) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const inputRef = useRef(null)
  const openerRef = useRef(null)
  const openRef = useRef(false)
  const abortRef = useRef(null)
  const debounceRef = useRef(null)
  const reqIdRef = useRef(0)

  useEffect(() => { openRef.current = open }, [open])

  const close = () => setOpen(false)

  // Visible-trigger open path (NavBar/MobileNav click or tap) — same open
  // logic as the hotkey's "not yet open" branch, exposed for a parent ref.
  useImperativeHandle(ref, () => ({
    open: () => {
      if (openRef.current) { inputRef.current?.focus(); return }
      openerRef.current = document.activeElement
      setOpen(true)
    },
  }), [])

  // ── Global hotkey — registered ONCE for the component's lifetime. ──────
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        if (openRef.current) {
          close()
        } else {
          openerRef.current = document.activeElement
          setOpen(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // ── Focus the input the moment the dialog opens; reset state on close. ──
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    } else {
      setQuery('')
      setResults([])
      setActiveIdx(0)
      setError(false)
      if (abortRef.current) abortRef.current.abort()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const opener = openerRef.current
      if (opener && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus()
      }
    }
  }, [open])

  // ── Escape-closes + Tab-trap, capture phase (mirrors SymbolSearch.jsx). ──
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Tab') {
        // Single-field palette — keep focus pinned to the input rather than
        // leaking Tab through to the page underneath.
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  // ── Debounced search against the existing /api/ticker-search — no new
  //    backend, no chip filter (defaults to all types). ──────────────────
  useEffect(() => {
    if (!open) return undefined
    setActiveIdx(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    // '?' is the in-box help mode (P10, IA §8.3 / §17.4 — "the grammar
    // documents itself from inside the box") — never a search query.
    if (!q || q === '?') {
      setResults([])
      setLoading(false)
      setError(false)
      return undefined
    }
    const myReqId = ++reqIdRef.current
    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setLoading(true)
      setError(false)
      fetch(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=20`, { signal: ac.signal })
        .then(r => r.json())
        .then(data => {
          if (reqIdRef.current !== myReqId) return
          setResults(Array.isArray(data?.results) ? data.results : [])
          setLoading(false)
        })
        .catch(err => {
          if (err?.name === 'AbortError') return
          if (reqIdRef.current !== myReqId) return
          setError(true)
          setLoading(false)
        })
    }, 150)
    return () => clearTimeout(debounceRef.current)
  }, [query, open])

  const trimmedQuery = query.trim()
  const isHelp = trimmedQuery === '?'
  const qUpper = trimmedQuery.toUpperCase()
  const qLower = trimmedQuery.toLowerCase()

  // Wave B: Notebook note rows (Favorites/Recents) only fetch once the
  // query actually asks for them — this component is mounted app-wide for
  // the ENTIRE session, so "the palette is merely open" is not a narrow
  // enough gate (it would fire on every ticker search too, incl. the help
  // ("?") screen, which must stay network-silent — see the existing test
  // for that contract).
  const wantsNoteRows = notebookNoteRowsMatch(qLower)
  const { notes: favoriteNotes } = useJ2Favorites({ enabled: open && wantsNoteRows })
  const { notes: recentNotes } = useJ2Recents({ enabled: open && wantsNoteRows })

  const notebookCommandRows = useMemo(() => {
    if (isHelp || !qLower) return []
    return NOTEBOOK_COMMANDS.filter((cmd) => commandMatches(cmd, qLower))
      .map((cmd) => ({ kind: 'command', ...cmd }))
  }, [isHelp, qLower])

  const notebookNoteRows = useMemo(() => {
    if (isHelp || !wantsNoteRows) return []
    const seen = new Set()
    const rows = []
    for (const n of favoriteNotes) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      rows.push({ kind: 'note', id: n.id, title: n.title?.trim() || 'Untitled', badge: 'Favorite', icon: 'star-fill' })
    }
    for (const n of recentNotes) {
      if (seen.has(n.id)) continue // already listed as a favorite above
      seen.add(n.id)
      rows.push({ kind: 'note', id: n.id, title: n.title?.trim() || 'Untitled', badge: 'Recent', icon: 'clock' })
    }
    return rows.slice(0, 8)
  }, [isHelp, wantsNoteRows, favoriteNotes, recentNotes])

  const tickerRows = useMemo(() => {
    if (!qUpper) return []
    const hasExact = results.some(r => String(r.ticker).toUpperCase() === qUpper)
    const base = (hasExact || !TICKER_LIKE.test(qUpper)) ? results : [...results, { ticker: qUpper, name: null, _typed: true }]
    return base.map((r) => ({ kind: 'ticker', ...r }))
  }, [results, qUpper])

  // Notebook rows first — matching "trash"/"note"/"recent" etc. is a far
  // more deliberate signal than an incidental ticker-name substring match,
  // so a command a member clearly asked for should never be buried below
  // ticker noise.
  const displayRows = useMemo(
    () => [...notebookCommandRows, ...notebookNoteRows, ...tickerRows],
    [notebookCommandRows, notebookNoteRows, tickerRows],
  )

  useEffect(() => {
    setActiveIdx(i => Math.min(i, Math.max(0, displayRows.length - 1)))
  }, [displayRows.length])

  const selectRow = (row) => {
    if (!row) return
    if (row.kind === 'command') {
      navigate(row.to)
    } else if (row.kind === 'note') {
      navigate(`/journal/notebook?note=${encodeURIComponent(row.id)}`)
    } else {
      navigate(`/research/${encodeURIComponent(row.ticker)}`)
    }
    close()
  }

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(displayRows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (isHelp) return
      // The highlighted row wins -- notebook command/note rows render
      // FIRST (see displayRows above) and activeIdx defaults to 0, so a
      // matched command opens on a bare Enter with no arrow-navigation
      // required. This still keeps the original zero-network-wait
      // guarantee for a plain ticker query with no notebook match: before
      // the debounced search even resolves, tickerRows already carries the
      // synthetic `{ticker: qUpper, _typed: true}` row (computed
      // synchronously from `results`, not from a fetch), so
      // `displayRows[0]` IS the typed value in that case -- selecting it
      // produces the identical `/research/<TICKER>` navigation as before.
      // Found live: an earlier version of this logic ignored the
      // highlighted row entirely unless the user had explicitly arrowed,
      // so typing "new note" and pressing Enter 404'd to a literal
      // "/research/NEW NOTE" ticker page instead of opening the command
      // sitting right there, highlighted, at the top of the list.
      if (displayRows[activeIdx]) {
        selectRow(displayRows[activeIdx])
      } else if (qUpper) {
        selectRow({ ticker: qUpper })
      }
    }
  }

  if (!open) return null

  const listboxId = 'uct-cmdk-listbox'
  const activeRowId = displayRows[activeIdx] ? `uct-cmdk-row-${activeIdx}` : undefined

  return createPortal(
    <div className={styles.backdrop} onClick={close}>
      <div
        className={styles.dialog}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className={styles.searchRow}>
          <span className={styles.searchIcon}><UIcon name="search" size={15} /></span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search a security or company…"
            aria-label="Search a security or company"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={displayRows.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeRowId}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className={styles.searchSpinner} aria-hidden="true" />}
          <kbd className={styles.hintKey}>Esc</kbd>
        </div>

        <div className={styles.resultList} id={listboxId} role="listbox" aria-label="Search results">
          {isHelp && (
            <div className={styles.helpPanel}>
              <p>UCT&apos;s global search — type a ticker or company name to jump straight to its research page. Type <strong>note</strong>, <strong>trash</strong>, <strong>recent</strong>, or <strong>favorite</strong> to reach Notebook.</p>
              <ul>
                <li><kbd>↑</kbd><kbd>↓</kbd> navigate results</li>
                <li><kbd>↵</kbd> open the selected or typed symbol</li>
                <li><kbd>Esc</kbd> close</li>
                <li><kbd>Ctrl</kbd>/<kbd>⌘</kbd><kbd>K</kbd> reopen this from anywhere in the Terminal</li>
              </ul>
            </div>
          )}
          {!isHelp && !qUpper && (
            <div className={styles.resultEmpty}>Type a ticker or company name to jump to its research page. Type <strong>?</strong> for help.</div>
          )}
          {!isHelp && qUpper && displayRows.length === 0 && !loading && (
            <div className={styles.resultEmpty}>No matches for &quot;{query.trim()}&quot;.</div>
          )}
          {!isHelp && displayRows.map((r, i) => (
            <button
              key={r.kind === 'ticker' ? `tk-${r.ticker}-${i}` : `${r.kind}-${r.id || r.label}-${i}`}
              id={`uct-cmdk-row-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              className={`${styles.resultRow} ${i === activeIdx ? styles.resultActive : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => selectRow(r)}
            >
              {r.kind === 'command' ? (
                <>
                  <span className={styles.resultLogo}><UIcon name={r.icon} size={16} /></span>
                  <span className={styles.resultMain}>
                    <span className={styles.resultSym}>{r.label}</span>
                  </span>
                </>
              ) : r.kind === 'note' ? (
                <>
                  <span className={styles.resultLogo}><UIcon name={r.icon} size={15} gold={r.badge === 'Favorite'} /></span>
                  <span className={styles.resultMain}>
                    <span className={styles.resultName}>{r.title}</span>
                  </span>
                  <span className={styles.resultExch}>{r.badge}</span>
                </>
              ) : r._typed ? (
                <span className={styles.resultTyped}>Go to <strong>{r.ticker}</strong></span>
              ) : (
                <>
                  <span className={styles.resultLogo}>
                    <CompanyLogo sym={r.ticker} name={r.name || r.ticker} size={22} round />
                  </span>
                  <span className={styles.resultMain}>
                    <span className={styles.resultSym}>{r.ticker}</span>
                    {r.name && <span className={styles.resultName}>{r.name}</span>}
                  </span>
                  {r.exchange && <span className={styles.resultExch}>{r.exchange}</span>}
                </>
              )}
            </button>
          ))}
          {error && <div className={styles.resultError}>Search is briefly unavailable — Enter still opens the typed symbol.</div>}
        </div>

        <div className={styles.dialogFoot}>
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
})

export default CommandPalette
