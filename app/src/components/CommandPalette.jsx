import { forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import CompanyLogo from './CompanyLogo'
import UIcon from './ui/UIcon'
import { AuthContext } from '../context/AuthContext'
import { useJ2Favorites, useJ2Recents } from '../pages/journal-2-0/hooks/useJ2Notes'
import { openCapture } from '../pages/journal-2-0/lib/captureBus'
import { destinationFromLocation } from '../pages/journal-2-0/lib/captureContext'
import {
  ENTER_WAIT_MS, NOTE_IN_TEXT_CUE, enterMustWait, extendsExhausted, normalizeSwitcherQuery, noteSwitcherUrl, orderPaletteRows,
  paletteRowKey, pendingEnterTarget,
  splitTitleMatch,
  tickerLeads, toNoteRow,
} from '../pages/journal-2-0/lib/noteSwitcher'
import jsonFetcher from '../utils/jsonFetcher'
import { registerShortcuts } from '../pages/command/shortcutRegistry'
import useTerminalNext, { TERMINAL_PATH } from '../pages/terminal/terminalGate'
import { terminalCommandRow } from '../pages/terminal/paletteGrammar'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../pages/journal-2-0/lib/notebookTelemetry'
import { notebookFlag } from '../pages/journal-2-0/lib/offline/notebookFlags'
import { checklistEnabled } from '../pages/journal-2-0/components/notebook/onboarding/gettingStartedPref'
import { NOTEBOOK_SEARCH_HASH } from '../pages/journal-2-0/lib/notebookSearchDoor'
import {
  NOTEBOOK_DOORS, NOTEBOOK_LIST_TO, NOTEBOOK_PREP_FLAG, NOTEBOOK_PREP_TO, NOTEBOOK_TEMPLATES_TO,
  noteOpenAt, openNotebookDoor,
} from '../pages/journal-2-0/lib/notebookDoors'
import { SETUPS_BOARD_PATH, setupsBoardEnabled } from '../pages/journal-2-0/lib/setupsBoardLink'
import styles from './CommandPalette.module.css'

const TICKER_LIKE = /^[A-Z0-9.\-]{1,10}$/
// One debounced keystroke asks the ticker search and the notes switcher together. Exported
// so a rail counts requests against THIS number (wave 10 F6), never a copy of it.
export const PALETTE_DEBOUNCE_MS = 150

// Wave B: Notebook joins the ONE existing command palette rather than
// growing a second, Notebook-specific one (directive §12) — a small static
// action list matched against the same query box a ticker search uses.
// Every `to` is a route that genuinely exists today (verified against
// App.jsx's route table + NotebookTab.jsx's deep-link handling — no
// dead/future commands per §13). "Create Thesis" was evaluated and dropped:
// with no trade/strategy already in context, there is no genuine
// context-free destination for it yet.
// Lane KEYS3: a Notebook command that names what it does needs SIX typed characters and must
// be the start of one of its own phrases. A command row LEADS the palette (orderPaletteRows)
// and a ticker is five letters at most, so such a row can never sit above a ticker the member
// typed and take its Enter ("expo" stays Exponent; "export" is the command).
const KEYS3_MIN_CHARS = 6
const phraseStart = (...phrases) => (q) => q.length >= KEYS3_MIN_CHARS && phrases.some((p) => p.startsWith(q))

const NOTEBOOK_COMMANDS = [
  { id: 'nb-new', kind: 'command', label: 'New Note', icon: 'document',
    to: '/journal/notebook?new=blank', keywords: ['note', 'notebook', 'new', 'create'] },
  // Wave H checkpoint decision 28: bare `/journal/notebook` now renders
  // Research Home (checkpoint decision 33) -- this command already IS
  // "Open Research Home" by construction, so it gets Home's own keywords
  // rather than a second, redundant command pointing at the identical route.
  { id: 'nb-open', kind: 'command', label: 'Open Notebook', icon: 'library',
    to: '/journal/notebook', keywords: ['notebook', 'note', 'research', 'open', 'home'] },
  // Lane KEYS: this used to open the Notebook and stop, search panel closed. The hash is the
  // Notebook's own door to its search panel (lib/notebookSearchDoor.js).
  { id: 'nb-search', kind: 'command', label: 'Search Notebook', icon: 'search',
    to: `/journal/notebook${NOTEBOOK_SEARCH_HASH}`, keywords: ['notebook', 'search', 'find', 'note'] },
  { id: 'nb-trash', kind: 'command', label: 'Open Trash', icon: 'trash',
    to: '/journal/notebook?folder=__trash__', keywords: ['trash', 'deleted', 'notebook', 'note'] },
  // ⛔ ONE capture command (Wave L §12), not a forest by subtype -- no
  // "Capture Link" / "Capture Passage" / "Capture to NVDA". The single door
  // adapts from context, and `action` (rather than `to`) is what keeps it from
  // navigating away from the research the member is standing in (§5).
  { id: 'nb-capture', kind: 'command', label: 'Quick Capture', icon: 'plus',
    action: 'capture',
    keywords: ['capture', 'save', 'clip', 'link', 'article', 'passage', 'quote', 'notebook'] },
  // Wave 14, lane W14-keys: Help's Walkthroughs from anywhere, for a keyboard member
  // (docs/notebook/wave14-keys.md). Lands on the Walkthroughs heading, whose next Tab stop is
  // Replay. Two guards beyond the shape above:
  //   * `when` -- the wave-14 switch, the same check that renders the section on Help;
  //   * `match` -- only a word that names it. A command row LEADS the palette
  //     (orderPaletteRows), so the label/keyword `.includes()` rule would let "ro", "th" or
  //     "to" put this row above a ticker and take its Enter.
  { id: 'nb-walkthroughs', kind: 'command', label: 'Help: Walkthroughs', icon: 'sparkle',
    to: '/support#walkthroughs', keywords: [],
    match: (q) => q.length >= 5 && ('walkthroughs'.startsWith(q) || q.startsWith('walkthrough')),
    when: () => checklistEnabled(notebookFlag) },
  // -- Lane KEYS3: the keyboard doors of an open note (docs/notebook/fin-clicks.md section 15).
  // `action: 'door'` asks the surface that owns the action to do what its own button does
  // (lib/notebookDoors.js); nothing navigates. Each is offered only where it can work.
  // Q22: the chart's own "Visual playbook", 9 Tab stops below the caret of a note.
  { id: 'nb-visual-playbook', kind: 'command', label: 'Visual playbook', icon: 'library',
    action: 'door', door: NOTEBOOK_DOORS.VISUAL_PLAYBOOK, keywords: [],
    match: phraseStart('visual playbook', 'playbook'),
    when: ({ location }) => notebookFlag('notebook_visual_playbook_enabled') === true && noteOpenAt(location) },
  // Q12: the note's Export menu (Markdown, web page, JSON, Word), inside "More note actions".
  { id: 'nb-export', kind: 'command', label: 'Export this note', icon: 'document',
    action: 'door', door: NOTEBOOK_DOORS.EXPORT, keywords: [],
    match: phraseStart('export this note', 'export note', 'export as word'),
    when: ({ location }) => noteOpenAt(location) },
  // Q9: the note's own Ask panel, with the cursor in its question field.
  { id: 'nb-ask-note', kind: 'command', label: 'Ask about this note', icon: 'sparkle',
    action: 'door', door: NOTEBOOK_DOORS.ASK, keywords: [],
    match: phraseStart('ask about this note', 'ask this note', 'ask note'),
    when: ({ location }) => noteOpenAt(location) },
  // Q2: the New note sheet (the template picker), which Research Home has no door to.
  { id: 'nb-templates', kind: 'command', label: 'New note from a template', icon: 'document',
    to: NOTEBOOK_TEMPLATES_TO, keywords: [],
    match: phraseStart('new note from a template', 'note from a template', 'from a template', 'templates') },
  // Q11: the notes list ("Open Notebook" above is Research Home). Focus lands on its heading.
  { id: 'nb-all-notes', kind: 'command', label: 'All notes', icon: 'library',
    to: NOTEBOOK_LIST_TO, keywords: [],
    match: phraseStart('all notes', 'notes list') },
  // Q15: "Reporting soon" on Research Home, focus on the first name's prep button.
  { id: 'nb-earnings-prep', kind: 'command', label: 'Earnings prep: reporting soon', icon: 'document',
    to: NOTEBOOK_PREP_TO, keywords: [],
    match: phraseStart('earnings prep', 'reporting soon', 'prep note'),
    when: () => notebookFlag(NOTEBOOK_PREP_FLAG) === true },
  // Q23: the active setups board, a plain route. Its link on Research Home is 9 Tab stops in.
  { id: 'nb-active-setups', kind: 'command', label: 'Active setups', icon: 'library',
    to: SETUPS_BOARD_PATH, keywords: [],
    match: phraseStart('active setups', 'setups board', 'setups'),
    when: () => setupsBoardEnabled() },
]
// Natural-terminology matching (§14): a 2-character floor avoids a bare
// letter matching half the keyword list, and `.includes()` (not an exact
// match) lets a partial word like "note" or "thesis" surface the right
// command without requiring the user to type the full label.
function commandMatches(cmd, q, ctx) {
  if (typeof cmd.when === 'function' && !cmd.when(ctx)) return false
  if (typeof cmd.match === 'function') return cmd.match(q)
  if (q.length < 2) return false
  if (cmd.label.toLowerCase().includes(q)) return true
  return cmd.keywords.some((k) => k.includes(q))
}
const RECENT_FAVORITE_KEYWORDS = ['recent', 'favorite', 'favourite']
function notebookNoteRowsMatch(q) {
  return q.length >= 2 && RECENT_FAVORITE_KEYWORDS.some((k) => k.startsWith(q))
}

// ⛔ ONE LABEL PER KIND. This used to be a single ticker template applied to
// every row, so a screen reader announced a note or a command as
// "undefined. Enter for Research…" — invisible on screen, wrong out loud.
function rowAriaLabel(r) {
  if (r._typed) return undefined // the visible "Go to NVDA" text is the name
  if (r.kind === 'saved') return `${r.kindLabel}: ${r.name}. Enter to open.`
  if (r.kind === 'command') return r.label
  if (r.kind === 'terminal') return `Run in UCT Terminal: ${r.command}. ${r.label}.`
  if (r.kind === 'note') {
    const where = r.context ? `, in ${r.context}` : ''
    const badge = r.badge ? ` (${r.badge})` : ''
    // Wave 10 F6: said out loud as well as shown -- the title alone does not explain the row.
    const found = r.inText ? `, found in note text` : ''
    return `Note: ${r.title}${found}${where}${badge}. Enter to open.`
  }
  return `${r.ticker}${r.name ? ` — ${r.name}` : ''}. Enter for Research, Ctrl or Cmd Enter for Ask AI.`
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
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  // The query `results` answers. Until it equals what is typed, the ticker
  // search has not answered THIS query — and an exact note title may not take
  // Enter from the zero-network "Go to X" row (orderPaletteRows).
  const [resultsFor, setResultsFor] = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  // Quick switcher: notes whose TITLE matches, across the whole library. Its
  // own loading/error pair — a notes outage must not read as "no securities"
  // and a ticker outage must not hide the notes that did come back.
  const [noteMatches, setNoteMatches] = useState([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [notesError, setNotesError] = useState(false)
  // The query `noteMatches` answers (an error or a skipped ask answers too:
  // "no note"). R1-N2: Enter waits on it — see enterMustWait.
  const [notesFor, setNotesFor] = useState(null)
  // R1-N2: an Enter pressed before the answers that decide its target are in.
  // { query, ask, at } — it lands once they are, or at ENTER_WAIT_MS.
  const [pendingEnter, setPendingEnter] = useState(null)
  // TERM-038: saved things as names -- chart layouts and watchlists the member owns,
  // from /api/address/search. Asked ONLY while the flag rides the auth payload, so a
  // dark deploy sends no extra request (the palette's request-count rails hold).
  // Notes are left to the quick switcher above, which already searches titles.
  // useContext, not useAuth(): the palette must render (flag off) outside a provider.
  const addressSpaceEnabled = useContext(AuthContext)?.addressSpaceEnabled === true
  const [savedRows, setSavedRows] = useState([])
  const [savedFor, setSavedFor] = useState(null)
  const [savedError, setSavedError] = useState(false)
  const savedAbortRef = useRef(null)

  // Lane T3 (V4): the palette is a second front end of the TERMINAL grammar. Only while
  // the shell is released to this member (the server's cohort answer) — a closed shell
  // would bounce `/terminal?cmd=` back to /calendar, so the palette never offers it.
  const terminalOpen = useTerminalNext()
  const terminalOpenRef = useRef(terminalOpen)
  terminalOpenRef.current = terminalOpen
  const locationRef = useRef(location)
  locationRef.current = location

  const inputRef = useRef(null)
  const openerRef = useRef(null)
  const openRef = useRef(false)
  const abortRef = useRef(null)
  const noteAbortRef = useRef(null)
  const debounceRef = useRef(null)
  // Runs the pending debounced search NOW (Enter must not also wait PALETTE_DEBOUNCE_MS).
  const flushRef = useRef(null)
  const reqIdRef = useRef(0)
  // N1: a query the server said no note can match, however it is extended.
  // Typing onto it skips the notes request; a backspace past it asks again.
  const exhaustedRef = useRef(null)

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
  // TERM-063: the chord (Ctrl/Cmd+K, case-folded), the window-capture phase,
  // "fires inside a text field" and "ignores auto-repeat" are all DECLARED in
  // pages/command/shortcutRegistry.js ('palette.toggle'), which owns the listener.
  useEffect(() => registerShortcuts({
    'palette.toggle': (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (openRef.current) {
        close()
      } else {
        openerRef.current = document.activeElement
        setOpen(true)
      }
    },
    // V4: backtick is the GLOBAL terminal focus key. In the shell it focuses the command
    // line; anywhere else it opens the shell. Never inside a text field (declared), and a
    // member the shell is not released to keeps an ordinary backtick.
    'terminal.focus': (e) => {
      const onShell = String(locationRef.current?.pathname || '').startsWith(TERMINAL_PATH)
      if (onShell) {
        const el = document.querySelector('[data-testid="terminal-command"]')
        if (!el) return
        e.preventDefault()
        el.focus()
        return
      }
      if (!terminalOpenRef.current) return
      e.preventDefault()
      navigate(TERMINAL_PATH)
    },
  }), [])

  // ── Focus the input the moment the dialog opens; reset state on close. ──
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    } else {
      setQuery('')
      setResults([])
      setResultsFor(null)
      setNoteMatches([])
      setNotesFor(null)
      setSavedRows([])
      setSavedFor(null)
      setSavedError(false)
      if (savedAbortRef.current) savedAbortRef.current.abort()
      setPendingEnter(null)
      flushRef.current = null
      exhaustedRef.current = null
      setActiveIdx(0)
      setError(false)
      setNotesError(false)
      if (abortRef.current) abortRef.current.abort()
      if (noteAbortRef.current) noteAbortRef.current.abort()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const opener = openerRef.current
      if (opener && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus()
      }
    }
  }, [open])

  // ── Escape-closes + Tab-trap, capture phase (mirrors SymbolSearch.jsx). ──
  // TERM-063: 'palette.close' + 'palette.trapTab' share ONE document-capture
  // listener, exactly as the single `onKey` did.
  useEffect(() => {
    if (!open) return undefined
    return registerShortcuts({
      'palette.close': (e) => {
        e.preventDefault()
        close()
      },
      'palette.trapTab': (e) => {
        // Single-field palette — keep focus pinned to the input rather than
        // leaking Tab through to the page underneath.
        e.preventDefault()
        inputRef.current?.focus()
      },
    })
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
      setNoteMatches([])
      setLoading(false)
      setNotesLoading(false)
      setError(false)
      setNotesError(false)
      return undefined
    }
    const myReqId = ++reqIdRef.current
    const run = () => {
      flushRef.current = null
      // Quick switcher: the SAME debounced keystroke asks the notes index for
      // titles, in parallel with the ticker search — never a second timer, so
      // the two lists always describe the same query.
      if (noteAbortRef.current) noteAbortRef.current.abort()
      if (extendsExhausted(exhaustedRef.current, q)) {
        // The server already said no longer query can match a note: a ticker
        // search typed past a non-note prefix costs the notes index nothing.
        setNoteMatches([])
        setNotesFor(q)
        setNotesLoading(false)
        setNotesError(false)
      } else {
        const nac = new AbortController()
        noteAbortRef.current = nac
        setNotesLoading(true)
        setNotesError(false)
        jsonFetcher(noteSwitcherUrl(q), { signal: nac.signal })
          .then((data) => {
            if (reqIdRef.current !== myReqId) return
            setNoteMatches(Array.isArray(data?.notes) ? data.notes.map(toNoteRow) : [])
            if (data?.prefixExhausted === true) exhaustedRef.current = normalizeSwitcherQuery(q)
            setNotesFor(q)
            setNotesLoading(false)
          })
          .catch((err) => {
            if (err?.name === 'AbortError') return
            if (reqIdRef.current !== myReqId) return
            setNoteMatches([])
            setNotesFor(q)
            setNotesError(true)
            setNotesLoading(false)
          })
      }

      if (savedAbortRef.current) savedAbortRef.current.abort()
      if (addressSpaceEnabled && q.length >= 2) {
        const sac = new AbortController()
        savedAbortRef.current = sac
        jsonFetcher(`/api/address/search?q=${encodeURIComponent(q)}`, { signal: sac.signal })
          .then((data) => {
            if (reqIdRef.current !== myReqId) return
            const rows = Array.isArray(data?.results) ? data.results : []
            setSavedRows(rows.filter((r) => r.kind !== 'note').slice(0, 6).map((r) => ({
              kind: 'saved', id: r.address, name: r.name, kindLabel: r.kind_label,
              savedKind: r.kind, to: r.to,
            })))
            setSavedError(Array.isArray(data?.unavailable) && data.unavailable.some((k) => k !== 'note'))
            setSavedFor(q)
          })
          .catch((err) => {
            if (err?.name === 'AbortError') return
            if (reqIdRef.current !== myReqId) return
            setSavedRows([])
            setSavedError(true)
            setSavedFor(q)
          })
      } else {
        setSavedRows([])
        setSavedFor(q)
      }

      if (abortRef.current) abortRef.current.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setLoading(true)
      setError(false)
      // jsonFetcher (not a bare fetch().then(r => r.json())): a non-2xx
      // answer is a real error state, not empty data -- see its own header
      // comment for the 402-reads-as-truthy-object failure this exists to
      // prevent. Confirmed pre-existing here by Search/Command Convergence
      // V1's Phase A (2026-09-06) and picked up as its own bounded fix.
      jsonFetcher(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=20`, { signal: ac.signal })
        .then(data => {
          if (reqIdRef.current !== myReqId) return
          setResults(Array.isArray(data?.results) ? data.results : [])
          setResultsFor(q)
          setLoading(false)
        })
        .catch(err => {
          if (err?.name === 'AbortError') return
          if (reqIdRef.current !== myReqId) return
          setError(true)
          setLoading(false)
        })
    }
    debounceRef.current = setTimeout(run, PALETTE_DEBOUNCE_MS)
    flushRef.current = () => { clearTimeout(debounceRef.current); run() }
    return () => { clearTimeout(debounceRef.current); flushRef.current = null }
  }, [query, open, addressSpaceEnabled])

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
    return NOTEBOOK_COMMANDS.filter((cmd) => commandMatches(cmd, qLower, { location }))
      .map((cmd) => ({ kind: 'command', ...cmd }))
  }, [isHelp, qLower, location])

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

  // R4-N2: ticker rows come ONLY from an answer to the query as typed. Until
  // it arrives — and when it fails, which leaves the previous answer in
  // `results` — the rows are the typed "Go to X" alone: a previous prefix's
  // symbols ("ts" -> TSLA) are symbols this query never asked for, and Enter
  // must not open one while the error line says it opens the typed symbol.
  const tickersFresh = resultsFor === trimmedQuery
  const tickerRows = useMemo(() => {
    if (!qUpper) return []
    const fresh = tickersFresh ? results : []
    const hasExact = fresh.some(r => String(r.ticker).toUpperCase() === qUpper)
    const base = (hasExact || !TICKER_LIKE.test(qUpper)) ? fresh : [...fresh, { ticker: qUpper, name: null, _typed: true }]
    return base.map((r) => ({ kind: 'ticker', ...r }))
  }, [results, qUpper, tickersFresh])

  // Notebook COMMAND rows first — matching "trash"/"note"/"recent" etc. is a
  // far more deliberate signal than an incidental ticker-name substring
  // match, so a command a member clearly asked for should never be buried
  // below ticker noise.
  // ⛔ Quick-switcher note matches are placed by `orderPaletteRows`, and the
  // rule is written there, not here: a short ticker-shaped query keeps every
  // ticker row (incl. the zero-network "Go to NVDA") above the notes, so Enter
  // on "nvda" still opens NVDA's research page however fast the notes answer.
  const noteMatchRows = isHelp ? [] : noteMatches
  const tickersSettled = !loading && resultsFor === trimmedQuery
  const notesSettled = !notesLoading && notesFor === trimmedQuery
  const orderedRows = useMemo(
    () => orderPaletteRows({
      commands: notebookCommandRows,
      keywordNotes: notebookNoteRows,
      tickers: tickerRows,
      noteMatches: noteMatchRows,
      qUpper,
      tickerLead: tickerLeads(qUpper, TICKER_LIKE),
      tickersSettled,
    }),
    [notebookCommandRows, notebookNoteRows, tickerRows, noteMatchRows, qUpper, tickersSettled],
  )
  // TERM-038: saved rows go LAST, and only for the query as typed -- they never sit above
  // a ticker or a note, so what a bare Enter opens is decided exactly as before.
  const savedFresh = !isHelp && savedFor === trimmedQuery ? savedRows : []
  // V4: one terminal-command row from the shell's own parser (paletteGrammar.js says where).
  const terminalRow = useMemo(
    () => (terminalOpen && !isHelp ? terminalCommandRow(trimmedQuery) : null),
    [terminalOpen, isHelp, trimmedQuery],
  )
  const displayRows = useMemo(() => {
    if (terminalRow?.placement === 'lead') return [terminalRow.row, ...orderedRows, ...savedFresh]
    if (terminalRow) return [...orderedRows, ...savedFresh, terminalRow.row]
    return [...orderedRows, ...savedFresh]
  }, [orderedRows, savedFresh, terminalRow])
  // R1-N2 / R23-N4: does an Enter on the top row have to wait for the answers
  // first? For a ticker-led query, for BOTH of them.
  const mustWait = enterMustWait({
    hasFixedLeaders: notebookCommandRows.length > 0 || notebookNoteRows.length > 0
      || terminalRow?.placement === 'lead',
    tickerLead: tickerLeads(qUpper, TICKER_LIKE),
    notesSettled,
    tickersSettled,
  })

  useEffect(() => {
    setActiveIdx(i => Math.min(i, Math.max(0, displayRows.length - 1)))
  }, [displayRows.length])

  // Keyboard-first: the highlighted row is always on screen. `scrollIntoView`
  // is optional-called because jsdom does not implement it.
  useEffect(() => {
    if (!open) return
    const el = document.getElementById(`uct-cmdk-row-${activeIdx}`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIdx, open])

  const selectRow = (row) => {
    if (!row) return
    if (row.kind === 'command') {
      if (row.action === 'capture') {
        // Opens the ONE shared capture dialog in place. No route change, so the
        // member keeps the page -- and the research context -- they were in.
        // ⛔ AND THE DIALOG IS TOLD WHERE THAT IS. Keeping the member's page was
        // never the same as keeping their DESTINATION: this passed `{}` until
        // the Slice 5 E2E, so capture opened from inside a note still asked
        // which note. Same derivation as the hotkey, from one module.
        const destination = destinationFromLocation(location, { recents: recentNotes })
        openCapture(destination ? { source: 'palette', destination }
                                : { source: 'palette' })
        close()
        return
      }
      if (row.action === 'door') {
        // Lane KEYS3: a Notebook surface does what its own control does. Asked for AFTER the
        // palette has closed and handed focus back, so a sheet the door opens records the
        // member's own place (the note), not the palette's input, as where focus returns.
        const door = row.door
        close()
        setTimeout(() => openNotebookDoor(door, { source: 'palette' }), 0)
        return
      }
      navigate(row.to)
    } else if (row.kind === 'saved' || row.kind === 'terminal') {
      navigate(row.to)
    } else if (row.kind === 'note') {
      // Wave 10 (10D, R-16, study task T4): `switcher_used` — declared in wave 6, fired from
      // no door until now. How many note rows were offered, where the picked one sat, and
      // which kind of row it was — never the query or the title.
      const offered = displayRows.filter((r) => r.kind === 'note')
      trackNotebookEvent(NOTEBOOK_EVENTS.SWITCHER_USED, {
        results: offered.length,
        rank: offered.indexOf(row) + 1,
        picked: true,
        mode: row.badge === 'Favorite' ? 'favorite' : row.badge === 'Recent' ? 'recent' : 'title',
      })
      navigate(`/journal/notebook?note=${encodeURIComponent(row.id)}`)
    } else {
      navigate(`/research/${encodeURIComponent(row.ticker)}`)
    }
    close()
  }

  // Secondary action (Ctrl/Cmd+Enter or Ctrl/Cmd+click) — the same canonical
  // /research/:sym?section=ai route TickerActions.jsx's "Ask AI about {sym}"
  // already uses (entry-point convergence), closing this palette's own
  // documented gap ("navigation only" — 2026-09-03 narrow-slice
  // authorization) for the single highest-value CONTINUE destination.
  // Strictly additive: bare Enter/click is completely unchanged.
  const goToAskAi = (row) => {
    if (!row) return
    // Ask AI is a ticker-only secondary action -- a Wave B notebook
    // command/note row has no `.ticker`, so Ctrl/Cmd+Enter or Ctrl/Cmd+click
    // on one falls back to its normal action instead of navigating to a
    // broken `/research/undefined?section=ai`.
    if (row.kind !== 'ticker') { selectRow(row); return }
    navigate(`/research/${encodeURIComponent(row.ticker)}?section=ai`)
    close()
  }

  // R1-N2: a pending Enter lands the moment the answers it waits on are in —
  // on the same row a slower Enter would take — or, at the latest,
  // ENTER_WAIT_MS after the press, on whatever is known. R23-N4: a row the
  // member arrows to during the wait is their choice, never overruled by the
  // top row. R4-N1: that choice is kept by IDENTITY (`pendingEnter.chosen`),
  // not by position: the late answer can reorder the rows, and index 1 after
  // it is a row the member never highlighted. A chosen row that is gone falls
  // back to the rule's top row. A different query (typing on) drops it.
  useEffect(() => {
    if (!pendingEnter) return undefined
    if (pendingEnter.query !== trimmedQuery) { setPendingEnter(null); return undefined }
    const land = () => {
      setPendingEnter(null)
      const target = pendingEnterTarget(displayRows, pendingEnter.chosen)
        || (qUpper ? { kind: 'ticker', ticker: qUpper } : null)
      if (!target) return
      if (pendingEnter.ask) goToAskAi(target)
      else selectRow(target)
    }
    if (!mustWait) { land(); return undefined }
    const t = setTimeout(land, Math.max(0, pendingEnter.at + ENTER_WAIT_MS - Date.now()))
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, trimmedQuery, mustWait, displayRows, qUpper])

  // R4-N1: an arrow moves the highlight; during a pending Enter it also names
  // the row the member chose — by identity, so the landing can find it again.
  const moveHighlight = (next) => {
    setActiveIdx(next)
    if (pendingEnter && next !== activeIdx && displayRows[next]) {
      const chosen = paletteRowKey(displayRows[next])
      setPendingEnter((p) => (p ? { ...p, chosen } : p))
    }
  }

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveHighlight(Math.min(displayRows.length - 1, activeIdx + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight(Math.max(0, activeIdx - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (isHelp || pendingEnter) return
      // R1-N2: the top row is still a guess — say so, ask now, and land when
      // the answers are in (bounded). A row arrowed to BEFORE Enter is the
      // member's choice and lands at once; one arrowed to during the wait is
      // where the wait lands, found again by identity (R23-N4, R4-N1).
      if (activeIdx === 0 && mustWait) {
        setPendingEnter({ query: trimmedQuery, ask: e.metaKey || e.ctrlKey, at: Date.now() })
        flushRef.current?.()
        return
      }
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
      const target = displayRows[activeIdx] || (qUpper ? { kind: 'ticker', ticker: qUpper } : null)
      if (!target) return
      if (e.metaKey || e.ctrlKey) {
        goToAskAi(target)
      } else {
        selectRow(target)
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
            placeholder="Search a security, company, or note…"
            aria-label="Search a security, company, or note"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={displayRows.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeRowId}
            autoComplete="off"
            spellCheck={false}
          />
          {(loading || notesLoading) && <span className={styles.searchSpinner} aria-hidden="true" />}
          <kbd className={styles.hintKey}>Esc</kbd>
        </div>

        <div className={styles.resultList} id={listboxId} role="listbox" aria-label="Search results" aria-busy={Boolean(pendingEnter)}>
          {pendingEnter && (
            <div className={styles.resultEmpty} role="status" data-testid="palette-enter-pending">
              Finding the best match for &quot;{pendingEnter.query}&quot;…
            </div>
          )}
          {isHelp && (
            <div className={styles.helpPanel}>
              <p>UCT&apos;s global search — type a ticker or company name to jump straight to its research page, or part of a note&apos;s title to open that note. Type <strong>note</strong>, <strong>trash</strong>, <strong>recent</strong>, or <strong>favorite</strong> to reach Notebook.</p>
              <ul>
                <li><kbd>↑</kbd><kbd>↓</kbd> navigate results</li>
                <li><kbd>↵</kbd> open the selected note, or the selected or typed symbol&apos;s research page</li>
                <li><kbd>Ctrl</kbd>/<kbd>⌘</kbd><kbd>↵</kbd> ask AI about the selected or typed symbol</li>
                <li><kbd>Esc</kbd> close</li>
                <li><kbd>Ctrl</kbd>/<kbd>⌘</kbd><kbd>K</kbd> reopen this from anywhere in the Terminal</li>
                {terminalOpen && <li>Terminal commands work here too: <kbd>NVDA GP</kbd>, <kbd>@B AAPL</kbd>, <kbd>ASK why is SMH down</kbd>. <kbd>`</kbd> jumps to the Terminal command line.</li>}
              </ul>
            </div>
          )}
          {!isHelp && !qUpper && (
            <div className={styles.resultEmpty}>Type a ticker or company name, or part of a note&apos;s title. Type <strong>?</strong> for help.</div>
          )}
          {!isHelp && qUpper && displayRows.length === 0 && !loading && !notesLoading && (
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
              onClick={(e) => { (e.metaKey || e.ctrlKey) ? goToAskAi(r) : selectRow(r) }}
              aria-label={rowAriaLabel(r)}
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
                  {r.context ? (
                    // Quick-switcher row: the title with what matched in bold,
                    // and WHERE the note lives under it (folder · $TICKER) —
                    // two notes both called "Q3 plan" are told apart here.
                    <span className={styles.resultNote}>
                      <span className={styles.resultNoteTitle}>
                        {(() => {
                          const [before, hit, after] = splitTitleMatch(r.title, trimmedQuery)
                          return <>{before}{hit && <strong className={styles.resultHit}>{hit}</strong>}{after}</>
                        })()}
                      </span>
                      <span className={styles.resultNoteContext}>
                        {/* Wave 10 F6: first on the line, so a long folder path truncates, never the reason. */}
                        {r.inText && <span data-note-cue="in-text">{NOTE_IN_TEXT_CUE} · </span>}
                        {r.context}
                      </span>
                    </span>
                  ) : (
                    <span className={styles.resultMain}>
                      <span className={styles.resultName}>{r.title}</span>
                    </span>
                  )}
                  {r.badge && <span className={styles.resultExch}>{r.badge}</span>}
                </>
              ) : r.kind === 'terminal' ? (
                <>
                  <span className={styles.resultLogo}><UIcon name="board" size={15} /></span>
                  <span className={styles.resultMain}>
                    <span className={styles.resultSym}>{r.command}</span>
                    <span className={styles.resultName}>{r.label}</span>
                  </span>
                  <span className={styles.resultExch}>Terminal</span>
                </>
              ) : r.kind === 'saved' ? (
                <>
                  <span className={styles.resultLogo}><UIcon name={r.savedKind === 'watchlist' ? 'eye' : 'board'} size={15} /></span>
                  <span className={styles.resultMain}>
                    <span className={styles.resultName}>{r.name}</span>
                  </span>
                  <span className={styles.resultExch}>{r.kindLabel}</span>
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
          {savedError && !isHelp && <div className={styles.resultError} data-testid="palette-saved-error">Saved layouts and watchlists are briefly unavailable — they are still there.</div>}
          {notesError && !isHelp && <div className={styles.resultError}>Note search is briefly unavailable — your notes are safe; try again in a moment.</div>}
        </div>

        <div className={styles.dialogFoot}>
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Ctrl</kbd>/<kbd>⌘</kbd><kbd>↵</kbd> ask AI</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
})

export default CommandPalette
