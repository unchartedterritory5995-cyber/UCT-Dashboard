// "New since your last visit" (wave 3 lane 13, product item #7) for the CN, FEED, CF and CATS
// panels -- MOVE's since-last-visit, generalised. The panel hands the keys of the items it SHOWS
// (each prefixed with the item's own YYYY-MM-DD so the server ages them out); the server answers
// which are new since this member's previous visit to this panel for this ticker, and when that was
// (POST /api/terminal/seen/{code}, api/services/terminal_grammar.seen_since_last_visit).
//
// ⛔ The server THROTTLES the visit write (once a minute per member, code and ticker) and answers a
// repeat from a snapshot, so re-posting when the list changes is cheap; this hook still posts only
// when the SET of keys changes, never on a re-render. Terminal-only: outside a panel it is off.
// A 404 (the grammar routes' dark flag) or any failure is "unavailable": no tags, no line.
import { useEffect, useMemo, useState } from 'react'
import { useInTerminalPanel } from './terminalPanel'

export const SEEN_URL = '/api/terminal/seen'
const MAX_KEYS = 200
const MAX_KEY_LEN = 160

/** Pure: a dated item key (`YYYY-MM-DD|id`), length-capped; an undated item is keyed `undated|id`. */
export function seenKey(date, id) {
  const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : 'undated'
  return `${d}|${String(id ?? '')}`.slice(0, MAX_KEY_LEN)
}

/** Pure: "Tue 3:12 PM ET" for an epoch-seconds instant. */
export function etVisitLabel(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return null
  const t = new Date(epochSeconds * 1000)
  if (Number.isNaN(t.getTime())) return null
  const s = t.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return `${s.replace(',', '')} ET`
}

/**
 * `keys`: the shown items' keys (seenKey), or null while the list has not loaded.
 * Returns { status: 'off'|'pending'|'first'|'ok'|'unavailable', lastVisitAt, isNew(key), count }.
 */
export default function useSinceLastVisit(code, sym, keys, { enabled = true } = {}) {
  const inPanel = useInTerminalPanel()
  const on = !!inPanel && enabled && Array.isArray(keys)
  const list = useMemo(() => (Array.isArray(keys) ? [...new Set(keys)].slice(0, MAX_KEYS) : []), [keys])
  const signature = `${code}|${sym || ''}|${list.join('\n')}`
  const [answer, setAnswer] = useState({ sig: null, status: 'pending', lastVisitAt: null, fresh: new Set() })

  useEffect(() => {
    if (!on) return undefined
    let live = true
    fetch(`${SEEN_URL}/${encodeURIComponent(code)}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym: (sym || '').toUpperCase(), keys: list }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return
        setAnswer({
          sig: signature,
          status: d.first_visit ? 'first' : 'ok',
          lastVisitAt: typeof d.last_visit_at === 'number' ? d.last_visit_at : null,
          fresh: new Set(Array.isArray(d.new) ? d.new : []),
        })
      })
      .catch(() => { if (live) setAnswer({ sig: signature, status: 'unavailable', lastVisitAt: null, fresh: new Set() }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, signature])

  return useMemo(() => {
    if (!on) return { status: 'off', lastVisitAt: null, count: 0, isNew: () => false }
    // Before this key set's answer lands, keep the previous marks (no flicker on a refresh).
    const a = answer
    const status = a.sig === signature ? a.status : (a.sig ? a.status : 'pending')
    const count = list.filter((k) => a.fresh.has(k)).length
    return { status, lastVisitAt: a.lastVisitAt, count, isNew: (k) => a.fresh.has(k) }
  }, [on, answer, signature, list])
}
