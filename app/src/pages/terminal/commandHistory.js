// UCT Terminal — the command line's ↑ history, PER MEMBER (daily-use leftover #1, 2026-10-06).
//
// What was typed follows the member to every device: it is a server preference
// (`terminal_command_history`, allow-listed in `api/routers/auth.py::_PREFERENCE_KEYS`), a JSON
// array of command lines, newest first, at most COMMAND_HISTORY_MAX.
//
// ⛔ `POST /api/auth/preferences` REPLACES the whole value. Every write therefore goes through
// `setPrefMerged`, whose updater runs on the freshest cached value inside the SWR cache update
// and whose POSTs are queued per key: two quick commands (or two tabs' worth of a cache) never
// write a list that is missing the other's line.
//
// ⭐ GRACEFUL FALLBACK. localStorage keeps a mirror (every access wrapped: private windows throw).
//   * while the preferences are loading, or could not be read at all, ↑ walks the mirror;
//   * a member with NO server history yet starts from this browser's mirror (a one-time carry
//     of the per-browser history they already had), and their first command saves both;
//   * a stored value that is not a list is NEVER saved over (the board's own rule, IA §2 #7):
//     ↑ walks the mirror and only the mirror is written, until something readable is stored.
import { useCallback, useMemo, useRef, useState } from 'react'
import usePreferences from '../../hooks/usePreferences'

/** The per-browser mirror (and, before this change, the only copy). */
export const HISTORY_KEY = 'uct.terminal.history'
/** Lines kept, newest first. */
export const COMMAND_HISTORY_MAX = 100
export const HISTORY_MAX = COMMAND_HISTORY_MAX

/** Pure: a stored value as a clean history — strings only, trimmed, no blanks, no line twice in
 *  a row, capped. Anything that is not a list is `null` (unreadable), never `[]`. */
export function normalizeHistory(v) {
  if (!Array.isArray(v)) return null
  const out = []
  for (const s of v) {
    if (typeof s !== 'string') continue
    const t = s.trim()
    if (!t || out[out.length - 1] === t) continue
    out.push(t)
    if (out.length >= COMMAND_HISTORY_MAX) break
  }
  return out
}

/** Pure: the history after running `text`. The newest line goes first; a line run again moves
 *  to the front instead of appearing twice (so a repeat is never stored twice in a row, and ↑
 *  never steps through the same line twice); capped at COMMAND_HISTORY_MAX. */
export function pushCommand(history, text) {
  const t = String(text || '').trim()
  const h = normalizeHistory(history) || []
  if (!t) return h
  if (h[0] === t) return h
  return [t, ...h.filter((x) => x !== t)].slice(0, COMMAND_HISTORY_MAX)
}

/** The browser mirror, or [] when storage is off or holds something else. */
export function readHistory() {
  try {
    return normalizeHistory(JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]')) || []
  } catch { return [] }
}

export function writeHistory(list) {
  try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list)) } catch { /* storage off */ }
}

/** Push onto the browser mirror only (the command line's standalone fallback). */
export function pushHistory(text) {
  const next = pushCommand(readHistory(), text)
  writeHistory(next)
  return next
}

/** Pure: how the stored preference reads. `empty` = the member has none yet; `unreadable` = a
 *  value is there but is not a list (it is left alone). */
export function readStoredHistory(raw) {
  if (raw == null || raw === '') return { status: 'empty', history: null }
  let v = raw
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw) } catch { return { status: 'unreadable', history: null } }
  }
  const h = normalizeHistory(v)
  return h ? { status: 'ok', history: h } : { status: 'unreadable', history: null }
}

/**
 * The member's command history: `{ history, push, source }`.
 * `source` says which copy ↑ is walking: 'server' or 'local' (loading / unreadable / signed out).
 */
export default function useCommandHistory() {
  const { prefs, setPrefMerged, loading } = usePreferences()
  const raw = prefs?.terminal_command_history
  const stored = useMemo(() => readStoredHistory(raw), [raw])
  const source = !loading && stored.status !== 'unreadable' ? 'server' : 'local'
  // Bumped on every push so a walk of the browser copy (no server answer to re-render on) is current.
  const [localTick, setLocalTick] = useState(0)
  const history = useMemo(() => {
    if (source === 'server' && stored.status === 'ok') return stored.history
    return readHistory()
  // `raw` changes whenever the stored list does; the mirror is re-read with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, stored, raw, localTick])

  const stateRef = useRef({ source, status: stored.status })
  stateRef.current = { source, status: stored.status }

  const push = useCallback((text) => {
    const t = String(text || '').trim()
    if (!t) return
    const local = pushHistory(t)
    setLocalTick((n) => n + 1)
    const { source: src } = stateRef.current
    if (src !== 'server' || typeof setPrefMerged !== 'function') return
    const p = setPrefMerged('terminal_command_history', (cur) => {
      if (cur === undefined || cur === null || cur === '') return pushCommand(local.slice(1), t)
      const base = normalizeHistory(cur)
      if (!base) return undefined                // not a list: never saved over
      const next = pushCommand(base, t)
      return next.length === base.length && next.every((x, i) => x === base[i]) ? undefined : next
    })
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }, [setPrefMerged])

  return { history, push, source }
}
