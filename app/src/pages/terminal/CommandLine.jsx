// UCT Terminal — the ONE command line. Autocomplete from four sources, history on ↑/↓, and
// an interpreted-parse ECHO above the input that says what Enter will do (IA §7.4, lane T3).
//
//   1. the function registry (functions.js) — synchronous, always (never while the token
//      starts with `$`: `$` means "this is a ticker", so offering a code there is the bug
//      that turned `$CF` back into the CF function on Tab);
//   2. the member's aliases (server-owned, passed in) — first token only;
//   3. the ticker search (`GET /api/ticker-search`, the palette's own endpoint) — for a token
//      in a TICKER SLOT (the first token, a `$` token, or the token after a security code:
//      `GP NV…`), debounced. The same endpoint answers the echo's "did you mean" when the
//      security a line names is not one it knows;
//   4. the address space (`GET /api/address/search`, TERM-038) — only for a `X:` token and
//      only while `addressSpaceEnabled` rides the auth payload (a dark deploy asks nothing).
//
// Sources 1-3 are ordered by the PUBLISHED ranking (ranking.js / grammar.js RANKING_ORDER),
// personalised by the member's own server-side command counts (`stats`).
//
// ⛔ History is a per-viewer convenience, so it lives in localStorage, every access wrapped:
// private windows and blocked storage throw, and the command line must work without it.
//
// A11y: a real combobox (`aria-activedescendant` names the highlighted option), and the echo
// is announced from a polite region updated only once typing PAUSES — never per keystroke.
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import jsonFetcher from '../../utils/jsonFetcher'
import { AuthContext } from '../../context/AuthContext'
import parseCommand from './parseCommand'
import { describeCommand } from './grammar'
import { rankCandidates } from './ranking'
import { BY_CODE, editDistance } from './functions'
import { BOARD_ADDRESS_RE, findBoard } from './boardModel'
import styles from './TerminalShell.module.css'
import Input from '../../components/ui/Input'

export const HISTORY_KEY = 'uct.terminal.history'
export const HISTORY_MAX = 50
/** How long typing must pause before the echo is announced to a screen reader. */
export const ECHO_ANNOUNCE_MS = 700

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

/** The command line's own keys, as HELP and the keyboard sheet print them. These are the
 *  input's `onKeyDown` below, not registry bindings (they only mean something while the
 *  command line has focus); CommandLine.test.jsx drives every one of them. */
export const COMMAND_LINE_KEYS = Object.freeze([
  { keys: 'Enter', does: 'Run the line (GO). On a highlighted suggestion, fill it in first.' },
  { keys: 'Shift+Enter', does: 'On a bare ticker: load it into the focused panel\'s group and keep every panel\'s function.' },
  { keys: 'Tab', does: 'Accept the top (or highlighted) suggestion.' },
  { keys: '↑ / ↓', does: 'Walk earlier commands. With text typed, only the ones that contain it.' },
  { keys: '↓ on an empty line', does: 'Show your recent commands.' },
  { keys: 'Esc', does: 'Close the list, then clear the line.' },
])

/** Pure: the history entries ↑ walks for what is typed. Typed text narrows the walk to the
 *  entries that CONTAIN it (newest first); when none does, or nothing is typed, it is the whole
 *  history, so ↑ never does nothing on a line that simply has no earlier match. */
export function historyWalk(text, history) {
  const h = Array.isArray(history) ? history : []
  const q = String(text || '').trim().toUpperCase()
  if (!q) return h
  const m = h.filter((x) => { const u = x.toUpperCase(); return u !== q && u.includes(q) })
  return m.length ? m : h
}

/** Pure: earlier commands that match what is typed, for the suggestion list. The letters must
 *  appear in order (`nvgp` finds `NVDA GP W`); a prefix match outranks a substring, which
 *  outranks a scattered match, and recency breaks ties. Two characters at least. */
export function historyMatches(text, history, limit = 2) {
  const q = String(text || '').trim().toUpperCase()
  if (q.length < 2 || !Array.isArray(history)) return []
  const scored = []
  history.forEach((entry, i) => {
    const u = String(entry).toUpperCase()
    if (u === q) return
    let tier = u.startsWith(q) ? 0 : u.includes(q) ? 1 : -1
    if (tier < 0) {
      const letters = q.replace(/\s+/g, '')
      let at = 0
      for (const ch of u) { if (ch === letters[at]) at += 1; if (at === letters.length) break }
      if (at < letters.length) return
      tier = 2
    }
    scored.push({ entry, tier, i })
  })
  scored.sort((a, b) => a.tier - b.tier || a.i - b.i)
  return scored.slice(0, limit).map(({ entry }) => ({ kind: 'history', value: entry, label: 'earlier command' }))
}

/** Pure: the member's boards for a `B:` token, matched on the slug or the name, instantly
 *  (the library is already in memory: no request). */
export function boardSuggestions(text, boards, limit = 6) {
  const raw = String(text || '').trim()
  const m = raw.match(/^B:(\S*)$/i)
  if (!m || !Array.isArray(boards)) return []
  const q = m[1].toLowerCase()
  return boards
    .filter((b) => b?.slug && (!q || b.slug.toLowerCase().startsWith(q) || String(b.name || '').toLowerCase().includes(q)))
    .slice(0, limit)
    .map((b) => ({ kind: 'board', value: `B:${b.slug}`, label: b.name || '' }))
}

/** Pure: is the token being completed in a TICKER SLOT — the first token, a `$` token, or the
 *  token right after a code that takes a security (`GP NV…`)? */
export function inTickerSlot(text) {
  const tokens = String(text || '').trimStart().split(/\s+/)
  const last = tokens[tokens.length - 1] || ''
  if (tokens.length === 1 || last.startsWith('$')) return true
  return tokens.length === 2 && !!BY_CODE[tokens[0].toUpperCase()]?.ticker
}

/** Pure: ranked suggestions for what is typed. The token being completed is the LAST one;
 *  in first position a code competes with aliases and tickers, later codes complete (and
 *  tickers too, in a ticker slot). A `$` token is a ticker: no codes, no aliases. */
export function registrySuggestions(text, { aliases = {}, tickers = [], stats = {}, limit = 6, nowSec, recent = [] } = {}) {
  const tokens = String(text || '').trimStart().split(/\s+/)
  const last = tokens[tokens.length - 1] || ''
  if (!last) return []
  const first = tokens.length === 1
  const forced = last.startsWith('$')
  return rankCandidates(last, {
    aliases: first && !forced ? aliases : {},
    tickers: inTickerSlot(text) ? tickers : [],
    codes: !forced,
    stats, limit, nowSec, recent,
  })
}

/** Pure: the ticker candidates for a token — the search's rows first (they carry the company
 *  name), then any RECENTLY VIEWED ticker the token is a prefix of that the search has not
 *  answered (yet): those are there on the first keystroke, before any request returns. */
export function withRecentTickers(token, searchRows, recent) {
  const t = String(token || '').toUpperCase().replace(/^\$/, '')
  const rows = Array.isArray(searchRows) ? searchRows : []
  if (!t || !Array.isArray(recent)) return rows
  const have = new Set(rows.map((r) => String(r.value || '').toUpperCase()))
  const extra = recent
    .map((s) => String(s || '').toUpperCase())
    .filter((s) => s && s.startsWith(t) && !have.has(s))
    .map((s) => ({ value: s, label: 'recently viewed' }))
  return [...rows, ...extra]
}

/** Pure: replace the last token with a picked suggestion. A `$` the member typed is KEPT on a
 *  ticker (it is what tells the parser "ticker, not code" — `$CF` must stay `$CF`). */
export function acceptSuggestion(text, s) {
  // An earlier command is a whole line: it replaces the line, it is not a token.
  if (s?.kind === 'history') return String(s.value)
  const parts = String(text || '').trimStart().split(/\s+/)
  const last = parts[parts.length - 1] || ''
  const keepDollar = last.startsWith('$') && s.kind === 'ticker'
  parts[parts.length - 1] = `${keepDollar ? '$' : ''}${s.value}`
  return `${parts.join(' ')} `
}

/** Pure: the "did you mean" candidate for a security the ticker search does not know — the
 *  closest-spelled result, only when NO result is the symbol itself. */
export function didYouMean(sym, results) {
  const s = String(sym || '').toUpperCase()
  if (!s || !Array.isArray(results) || !results.length) return null
  const vals = results.map((r) => String(r?.ticker || r?.value || '').toUpperCase()).filter(Boolean)
  const canon = (v) => v.replace(/-/g, '.')
  if (vals.some((v) => canon(v) === canon(s))) return null
  const close = vals.filter((v) => editDistance(s, v) <= (s.length >= 4 ? 2 : 1))
  return close[0] || null
}

/** Pure: what the echo says for a line — `B:<board>` is the shell's own address, answered
 *  here exactly as Enter answers it (`run` opens the board before the parser sees it). With
 *  the member's `boards` known, a board they do not have is said BEFORE Enter (round 3). */
export function echoFor(text, aliases = {}, boards = null) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const b = raw.match(BOARD_ADDRESS_RE)
  if (b) {
    if (!Array.isArray(boards)) return { text: `Open your board B:${b[1]}`, tone: 'ok', shape: 'B:name' }
    const board = findBoard({ boards }, raw)
    return board
      ? { text: `Open your board ${board.name} (B:${board.slug})`, tone: 'ok', shape: 'B:name' }
      : { text: `No board at B:${b[1]}. Open Boards to see yours.`, tone: 'error', shape: 'B:name' }
  }
  return describeCommand(parseCommand(raw, { aliases }))
}

/** Pure: is `sym` in the ticker search's answer (share-class spellings are one ticker)? */
export function knownTicker(sym, results) {
  const canon = (v) => String(v || '').toUpperCase().replace(/-/g, '.')
  const s = canon(sym)
  return Array.isArray(results) && results.some((r) => canon(r?.ticker || r?.value) === s)
}

// One cached answer per query: the completion list and the echo's "did you mean" ask the
// same endpoint for the same token, and must not each pay for it.
//
// ⛔ The shared request carries NO caller's AbortSignal (round 3). It used to take the first
// caller's: the completion list asked for "NVDQ", the echo's check joined that request, then
// the member typed on, the completion aborted ITS request — and the echo's answer died with
// it, so "did you mean NVDA?" never appeared. Each caller now drops a late answer itself.
const searchCache = new Map()
function searchTickers(q) {
  const key = q.toUpperCase()
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.at < 60000) return hit.promise
  // 20, not 6: the search orders by length then A-Z, so a well-known name (NVDA for "NV") can
  // sit past its sixth row; ranking.js decides what the member sees.
  const promise = jsonFetcher(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=20`)
    .then((d) => (Array.isArray(d?.results) ? d.results : []))
  promise.catch(() => searchCache.delete(key))
  searchCache.set(key, { at: Date.now(), promise })
  if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value)
  return promise
}

export default function CommandLine({
  onSubmit, inputRef: externalRef, placeholder, aliases = {}, stats = {}, boards = null, recentTickers = [],
}) {
  const addressSpaceEnabled = useContext(AuthContext)?.addressSpaceEnabled === true
  const [text, setText] = useState('')
  const [tickers, setTickers] = useState([])
  const [addresses, setAddresses] = useState([])
  const [symCheck, setSymCheck] = useState(null)      // { sym, results } from the ticker search
  const [announce, setAnnounce] = useState('')
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)
  const [recall, setRecall] = useState(false)          // ↓ on an empty line: the recent-commands list
  const historyIdx = useRef(-1)
  const draftRef = useRef('')                          // what was typed before ↑ walked history
  const walkRef = useRef([])                           // the entries this ↑/↓ walk steps through
  const localRef = useRef(null)
  const ref = externalRef || localRef
  const listId = useId()
  const echoId = useId()

  const tokens = text.trimStart().split(/\s+/)
  const last = tokens[tokens.length - 1] || ''
  const tickerSlot = inTickerSlot(text)

  useEffect(() => {
    const q = last.trim()
    setTickers([])
    setAddresses([])
    if (!q) return undefined
    const ac = new AbortController()
    const t = setTimeout(() => {
      if (/^[A-Za-z]:\S*$/.test(q)) {
        // `B:` is the shell's own board address, completed from memory (boardSuggestions).
        if (/^B:/i.test(q) || !addressSpaceEnabled || q.length < 3) return
        jsonFetcher(`/api/address/search?q=${encodeURIComponent(q.slice(2))}`, { signal: ac.signal })
          .then((d) => setAddresses((Array.isArray(d?.results) ? d.results : []).slice(0, 6).map((r) => ({
            kind: 'address', value: r.address, label: `${r.kind_label || 'Saved'} · ${r.name || ''}`,
            replaceLast: true,
          }))))
          .catch(() => {})
        return
      }
      if (!tickerSlot || (q.startsWith('$') && q.length < 2)) return
      const sq = q.replace(/^\$/, '')
      if (!/^[A-Za-z][A-Za-z.-]{0,6}$/.test(sq)) return
      searchTickers(sq)
        .then((rows) => { if (!ac.signal.aborted) setTickers(rows.map((r) => ({
          value: String(r.ticker || '').toUpperCase(), label: r.name || '',
        })).filter((r) => r.value)) })
        .catch(() => {})
    }, 150)
    return () => { clearTimeout(t); ac.abort() }
  }, [last, tickerSlot, addressSpaceEnabled])

  const parsed = useMemo(() => (text.trim() ? parseCommand(text, { aliases }) : null), [text, aliases])
  // Only a security the command will USE is checked (`NVDA DASH` ignores NVDA anyway).
  const parsedSym = parsed?.ok && parsed.type === 'function' && BY_CODE[parsed.code]?.ticker ? parsed.sym : null

  // The echo's "did you mean": does the ticker search know the security this line names?
  useEffect(() => {
    if (!parsedSym) return undefined
    let live = true
    const t = setTimeout(() => {
      searchTickers(parsedSym)
        .then((rows) => { if (live) setSymCheck({ sym: parsedSym, results: rows }) })
        .catch(() => {})            // a failed search proves nothing: say nothing
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [parsedSym])

  const suggestions = useMemo(() => {
    if (!text.trim()) {
      // ↓ on an empty line: the recent commands, newest first.
      return recall ? readHistory().slice(0, 8).map((h) => ({ kind: 'history', value: h, label: 'earlier command' })) : []
    }
    const boardRows = boardSuggestions(text, boards)
    if (boardRows.length) return boardRows
    const candidates = tickerSlot ? withRecentTickers(last, tickers, recentTickers) : tickers
    const ranked = registrySuggestions(text, { aliases, tickers: candidates, stats, limit: 8, recent: recentTickers })
    return [...ranked, ...historyMatches(text, readHistory()), ...addresses].slice(0, 10)
  }, [text, aliases, tickers, stats, addresses, recall, boards, recentTickers, tickerSlot, last])

  // The interpreted-parse echo: what Enter will do, BEFORE Enter (one parser, same answer).
  const echo = useMemo(() => {
    const e = echoFor(text, aliases, boards)
    if (!e || !parsedSym || symCheck?.sym !== parsedSym) return e
    if (knownTicker(parsedSym, symCheck.results)) return e
    // Round 3: a symbol the search has never heard of (`ZZZZQ DES`) is said too, not only one
    // with a close spelling — the line still runs on Enter, but the member is not surprised.
    const cand = didYouMean(parsedSym, symCheck.results)
    const tail = cand ? `did you mean ${cand}?` : 'check the spelling, or press Enter to open it anyway.'
    return { ...e, tone: e.tone === 'error' ? 'error' : 'warn',
      text: `${e.text} ${parsedSym} is not a ticker we know — ${tail}`, didYouMean: cand || undefined }
  }, [text, aliases, boards, parsedSym, symCheck])

  // Announce the echo once typing pauses (a screen reader must not read every keystroke).
  const echoText = echo?.text || ''
  useEffect(() => {
    if (!echoText) { setAnnounce(''); return undefined }
    const t = setTimeout(() => setAnnounce(echoText), ECHO_ANNOUNCE_MS)
    return () => clearTimeout(t)
  }, [echoText])

  const showing = open && suggestions.length > 0
  const optionId = (i) => `${listId}-opt-${i}`

  const accept = (s) => {
    setText(acceptSuggestion(text, s))
    setActive(-1)
    setRecall(false)
    ref.current?.focus()
  }

  const submit = (value, opts) => {
    const v = String(value ?? text).trim()
    if (!v) return
    pushHistory(v)
    historyIdx.current = -1
    draftRef.current = ''
    setText('')
    setOpen(false)
    setRecall(false)
    setActive(-1)
    if (opts) onSubmit?.(v, opts)
    else onSubmit?.(v)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Shift+Enter runs the line AS TYPED, telling the shell to keep the panels' functions.
      if (e.shiftKey) { submit(undefined, { keepFunction: true }); return }
      if (showing && active >= 0) { accept(suggestions[active]); return }
      submit()
    } else if (e.key === 'Tab' && showing) {
      e.preventDefault()
      accept(suggestions[Math.max(0, active)])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (showing) { setActive((i) => Math.min(suggestions.length - 1, i + 1)); return }
      if (historyIdx.current < 0) {
        // ↓ on an empty line opens the recent-commands list (nothing to walk forward to).
        if (!text.trim() && readHistory().length) { setRecall(true); setOpen(true); setActive(0) }
        return
      }
      // ↓ walks history FORWARD after ↑ — back to the newest entry, then to what was typed.
      historyIdx.current -= 1
      setText(historyIdx.current < 0 ? draftRef.current : (walkRef.current[historyIdx.current] ?? ''))
      setOpen(false)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (showing && active >= 0) { setActive((i) => i - 1); return }
      if (historyIdx.current < 0) {
        draftRef.current = text
        walkRef.current = historyWalk(text, readHistory())
      }
      const h = walkRef.current
      if (!h.length) return
      historyIdx.current = Math.min(h.length - 1, historyIdx.current + 1)
      setText(h[historyIdx.current])
      setRecall(false)
      setOpen(false)
    } else if (e.key === 'Escape') {
      // First Esc closes the list; Esc on a line with no list open clears the line.
      if (showing) { setOpen(false); setRecall(false); setActive(-1); return }
      if (text) { setText(''); setActive(-1); historyIdx.current = -1; draftRef.current = '' }
    }
  }

  return (
    <div className={styles.cmdBlock}>
      <div
        id={echoId}
        className={`${styles.echo} ${echo ? styles[`echo_${echo.tone}`] || '' : ''}`}
        data-testid="terminal-echo"
        data-tone={echo?.tone || ''}
      >
        {echo && (
          <>
            <span className={styles.echoText} title={echo.text}>{echo.text}</span>
            {echo.shape && <span className={styles.echoShape} data-testid="terminal-arg-shape">{echo.shape}</span>}
          </>
        )}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="terminal-echo-announce">{announce}</div>
      <div className={styles.cmdWrap}>
        <span className={styles.cmdPrompt} aria-hidden="true">&gt;</span>
        <Input
          ref={ref}
          className={styles.cmdInput}
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); setRecall(false); setActive(-1); historyIdx.current = -1 }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder || 'NVDA GP · AAPL FA · CAL · HELP'}
          aria-label="UCT Terminal command"
          aria-describedby={echoId}
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showing && active >= 0 ? optionId(active) : undefined}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          data-testid="terminal-command"
        />
        <button type="button" className={styles.cmdGo} onClick={() => submit()} aria-label="Run command">Go</button>
        {showing && (
          <ul id={listId} role="listbox" className={styles.suggest} data-testid="terminal-suggestions">
            {suggestions.map((s, i) => (
              <li key={`${s.kind}:${s.value}`} id={optionId(i)} role="option" aria-selected={i === active} data-rank={s.rank || ''}>
                <button
                  type="button"
                  tabIndex={-1}
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
    </div>
  )
}
