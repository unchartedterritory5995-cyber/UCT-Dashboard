// Audit 2026-11-05, S16 + S17: the member's "My names" watchlist -- the names their daily plan, earnings and setups
// follow. Every write goes through the EXISTING watchlist API (api/routers/watchlists.py); nothing here is new on
// the server. The widgets read every one of the member's own lists (member_interest.interest_for), so a name added
// here reaches My watchlist today, Reporting soon, Passed setups and the prep blocks.
//
// ⛔ ONE LIST, NEVER TWO. A "My names" list that already exists is added to; it is never created again. Two presses
// (a double click on Build, two empty widgets on one page) run through ONE queue in this tab, so the second press
// finds the list the first one made. Adding is idempotent on the server too (bulk add skips a name already there).

export const MY_NAMES_LIST = 'My names'

/** M7's three suggestions, in order. */
export const SUGGESTED_NAMES = Object.freeze(['NVDA', 'SPY', 'QQQ'])

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/

/** Upper-cased, `$` and spaces dropped, invalid ones out, each once, in order. */
export function cleanSymbols(list) {
  const out = []
  for (const raw of Array.isArray(list) ? list : [list]) {
    const s = String(raw ?? '').trim().replace(/^\$/, '').toUpperCase()
    if (SYMBOL.test(s) && !out.includes(s)) out.push(s)
  }
  return out
}

async function call(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.detail || '' } catch { /* not JSON */ }
    const err = new Error(typeof detail === 'string' && detail ? detail : `${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** The member's own lists (never the prebuilt index lists, which are not theirs). */
export async function ownLists({ items = false } = {}) {
  const got = await call(`/api/watchlists?include_items=${items ? 1 : 0}&include_prebuilt=0`)
  return Array.isArray(got) ? got : []
}

/** The "My names" list, or null. */
export function findMyNames(lists) {
  // The OLDEST, when a race ever made two (review minor 6): every tab then agrees on one.
  const all = (lists || []).filter((l) => l && l.name === MY_NAMES_LIST && !l.is_flagged_list && !l.is_prebuilt)
  return all.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null
}

let queue = Promise.resolve()

/** Tests only. */
export function __resetMyNamesQueue() { queue = Promise.resolve(); importRead = null }

/**
 * Add `symbols` to "My names", creating the list the first time. Resolves `{listId, added, created}`; rejects with
 * the server's error when a write was refused (nothing is said to have been added that was not).
 * Calls are queued one after another in this tab, so two at once never make two lists.
 */
export function addMyNames(symbols) {
  const names = cleanSymbols(symbols)
  const run = async () => {
    if (!names.length) return { listId: null, added: 0, created: false }
    let list = findMyNames(await ownLists())
    let created = false
    if (!list) {
      list = await call('/api/watchlists', { method: 'POST', body: JSON.stringify({ name: MY_NAMES_LIST }) })
      created = true
      // Review minor 6: another tab or device may have made one in the same moment. Read again and add to the OLDEST
      // "My names", so every write from here on lands in one list (an empty twin, if one was made, is left alone:
      // nothing here ever deletes a list).
      const all = (await ownLists()).filter((l) => l && l.name === MY_NAMES_LIST && !l.is_flagged_list && !l.is_prebuilt)
      if (all.length > 1) {
        const oldest = [...all].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0]
        if (oldest.id !== list.id) { list = oldest; created = false }
      }
    }
    const out = await call(`/api/watchlists/${encodeURIComponent(list.id)}/items/bulk`, {
      method: 'POST', body: JSON.stringify({ symbols: names }),
    })
    importRead = null                       // what is left to import has changed
    return { listId: list.id, added: Number(out?.added) || 0, created }
  }
  const next = queue.then(run, run)
  queue = next.catch(() => {})
  return next
}

// One read shared by every empty widget on the page (Home can show two at once): never N calls on mount.
const IMPORT_READ_MS = 60_000
let importRead = null   // { at, promise }

/** The names on the member's OTHER lists (the Charts watchlists) that are not on "My names" yet, or []. Used by
 *  "Import from Charts watchlist", which is offered only when this has something in it. One read per minute per
 *  tab, forgotten after any add. */
export function chartsWatchlistNames({ now = Date.now() } = {}) {
  if (importRead && now - importRead.at < IMPORT_READ_MS) return importRead.promise
  const promise = readChartsWatchlistNames()
  importRead = { at: now, promise }
  promise.catch(() => { if (importRead?.promise === promise) importRead = null })
  return promise
}

async function readChartsWatchlistNames() {
  const lists = await ownLists({ items: true })
  const mine = new Set((findMyNames(lists)?.items || []).map((i) => String(i?.sym || '').toUpperCase()))
  const out = []
  for (const l of lists) {
    if (!l || l.name === MY_NAMES_LIST || l.is_flagged_list || l.is_prebuilt) continue
    for (const it of l.items || []) {
      const s = String(it?.sym || '').toUpperCase()
      if (s && !mine.has(s) && !out.includes(s)) out.push(s)
    }
  }
  return out
}
