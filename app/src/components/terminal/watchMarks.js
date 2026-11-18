// UCT Terminal — watchlist marks: which names in a list are the member's own (owner request
// 2026-11-17). A member's watchlist names carry ONE small mark in every Terminal list, so they
// spot their own names at a glance.
//
// ⭐ ONE SOURCE, ONE MARK.
//   • The names come from `WatchMarksProvider` (mounted once around the shell): the member's own
//     watchlists plus their Flagged list — the same set, under the same SWR key, as the catalyst
//     table's star (hooks/useUserTickerSet). Nothing here fetches.
//   • The mark is drawn by the kit's symbol cell (`PanelSymbol`, so `PanelTicker` too). A panel
//     that draws its own row button places `<WatchMark sym />` instead. No panel builds its own.
//
// Outside the provider (every page that is not the Terminal, and most unit tests) the context is
// `null`: every hook below answers "not marked" and nothing renders.
import { createContext, useContext } from 'react'
import { usePanelRun } from './terminalPanel'

/** `Map<SYM, { lists: string[], flagged: boolean }>` inside the Terminal, `null` everywhere else. */
export const WatchMarksContext = createContext(null)

const upper = (s) => String(s || '').trim().toUpperCase()
const NAME_MAX = 40
const NAMES_SHOWN = 3

/**
 * Pure: the marks for a member. `lists` is the body of `GET /api/watchlists?include_prebuilt=0`
 * (each `{ name, items: [{ sym }], is_flagged_list?, is_prebuilt? }`); `flagged` is the Flagged
 * set this browser holds (hooks/flaggedStore). Never throws on a shape it did not expect: a list
 * that is not a list, or an item with no symbol, is skipped.
 * ⛔ A prebuilt (index) list is never the member's own names, whoever owns the row.
 */
export function buildWatchMarks(lists, flagged) {
  const out = new Map()
  const at = (sym) => {
    let m = out.get(sym)
    if (!m) { m = { lists: [], flagged: false }; out.set(sym, m) }
    return m
  }
  for (const wl of Array.isArray(lists) ? lists : []) {
    if (!wl || typeof wl !== 'object' || wl.is_prebuilt) continue
    const listName = String(wl.name || '').trim().slice(0, NAME_MAX) || 'Untitled list'
    for (const it of Array.isArray(wl.items) ? wl.items : []) {
      const sym = upper(typeof it === 'string' ? it : it?.sym || it?.ticker)
      if (!sym) continue
      const m = at(sym)
      if (wl.is_flagged_list) m.flagged = true
      else if (!m.lists.includes(listName)) m.lists.push(listName)
    }
  }
  for (const s of Array.isArray(flagged) ? flagged : []) {
    const sym = upper(s)
    if (sym) at(sym).flagged = true
  }
  return out
}

/** Pure: a string that changes exactly when the marks change, so a refresh that brings the same
 *  names back re-renders no list. */
export function watchMarksSignature(marks) {
  if (!marks || !marks.size) return ''
  return JSON.stringify([...marks].map(([sym, m]) => [sym, m.flagged ? 1 : 0, m.lists]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}

/**
 * Pure: the words for one mark. `short` is the accessible name's clause ("on your watchlist");
 * `title` is the hover line, which also names the lists when the data carries them.
 */
export function watchMarkWords(mark) {
  if (!mark) return null
  const names = Array.isArray(mark.lists) ? mark.lists : []
  if (!names.length) {
    return mark.flagged ? { short: 'on your Flagged list', title: 'On your Flagged list' } : null
  }
  const shown = names.slice(0, NAMES_SHOWN).join(', ')
  const more = names.length - NAMES_SHOWN
  const where = `On your ${names.length > 1 ? 'watchlists' : 'watchlist'}: ${shown}${more > 0 ? ` and ${more} more` : ''}`
  return mark.flagged
    ? { short: 'on your watchlist and flagged', title: `${where}. Also flagged` }
    : { short: 'on your watchlist', title: where }
}

/** The mark for one name, or `null` (not the member's, still loading, or outside the Terminal). */
export function useWatchMark(sym) {
  const marks = useContext(WatchMarksContext)
  if (!marks) return null
  return marks.get(upper(sym)) || null
}

/** True where `PanelTicker` / `PanelSymbol` will draw the mark themselves, so a page that has its
 *  own "on your list" star (the catalyst table) can leave it to the kit and never show two. */
export function usePanelDrawsWatchMark() {
  const run = usePanelRun()
  const marks = useContext(WatchMarksContext)
  return !!run && marks != null
}
