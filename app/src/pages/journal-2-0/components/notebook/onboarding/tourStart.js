// Where a registered tour starts, and how the engine gets there (wave 14, lane W14-C1).
//
// Imported ONLY by GenericTourEngine.jsx, which is itself a lazy chunk: none of this reaches
// the Notebook's first-open bytes. The DATA form of a start (a path, `{note}`, `{trade}`) and
// its validation live in tourRegistry.js; this module answers two questions at run time:
//
//   atStart(start, location)  is the member already on the start's screen?
//   resolveStart(entry, ...)  where should the engine navigate to reach it?
//
// ⛔ READ-ONLY. Resolving never creates, edits or seeds anything: it asks the server which
// note or trade already exists and opens it. With nothing to open, it says so (`none`) and
// the engine shows a card with a way out. A tour never invents member data to have something
// to point at.
import { NOTEBOOK_ROOT, startKind } from './tourRegistry'

/** Query parameters that pick a different SCREEN of the same page, not a filter on it. A
 *  member on `/journal/notebook?note=<id>` is in a note, not on Home, even though the
 *  pathname is the same (the W14-B3 finding: Home tours waited on an open note and closed).
 *  A start is reached only when every one of these the location carries is one the start
 *  names too. Filters (`folder`, `ticker`, anything else) never move a member off a start. */
export const SCREEN_PARAMS = Object.freeze(['note', 'view', 'side', 'resurfaceVersion', 'new'])

/** The prefix W14-E gives each example note's import key (sample_examples.py KEY_PREFIX). */
export const SAMPLE_IMPORT_PREFIX = 'sample-example:'

/** Whether the router location already IS the start location (a PATH start): same
 *  pathname; every query parameter the start names present with the same value; and no
 *  screen-picking parameter (SCREEN_PARAMS) present that the start does not name. Extra
 *  filter parameters are fine. No start: anywhere is the start. */
export function atStart(start, location) {
  if (!start || typeof start !== 'string') return true
  const u = new URL(start, 'http://notebook.invalid')
  if (u.pathname !== location.pathname) return false
  const here = new URLSearchParams(location.search || '')
  for (const [k, v] of u.searchParams) if (here.get(k) !== v) return false
  for (const k of SCREEN_PARAMS) if (here.has(k) && !u.searchParams.has(k)) return false
  return true
}

/** The note open at `location`, or null. */
export function openNoteId(location) {
  if (location.pathname !== NOTEBOOK_ROOT) return null
  return new URLSearchParams(location.search || '').get('note') || null
}

export const notePath = (id) => `${NOTEBOOK_ROOT}?note=${encodeURIComponent(id)}`
export const tradePath = (id) => `/journal-2-0/trade/${encodeURIComponent(id)}`

async function getJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, { credentials: 'include', ...init })
  if (!res || !res.ok) throw new Error(`${url} answered ${res ? res.status : 'nothing'}`)
  return res.json()
}

/** The member's W14-E example note for `key`, or null (never seeded, or trashed). */
async function sampleNoteId(fetchImpl, key) {
  const importKey = `${SAMPLE_IMPORT_PREFIX}${key}`
  const body = await getJson(fetchImpl, '/api/j2/notes/import/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ importKeys: [importKey] }),
  })
  return body?.existing?.[importKey]?.id || null
}

/** The member's most recently edited note (holding an `embed` widget when named), or null. */
async function recentNoteId(fetchImpl, embed) {
  const qs = new URLSearchParams({ sort: 'updated', limit: '1' })
  if (embed) qs.set('embed_widget', embed)
  const body = await getJson(fetchImpl, `/api/j2/notes?${qs.toString()}`)
  const list = Array.isArray(body?.notes) ? body.notes : Array.isArray(body) ? body : []
  return list[0]?.id || null
}

async function recentTradeId(fetchImpl) {
  const body = await getJson(fetchImpl, '/api/j2/trades?limit=1')
  const list = Array.isArray(body?.trades) ? body.trades : []
  const t = list.find((x) => x && x.id != null)
  return t ? String(t.id) : null
}

/**
 * Where the engine goes to start `entry`, given where the member is now:
 *   { stay: true }              already there (or no start at all)
 *   { path }                    navigate here, then wait for the first anchor
 *   { none: 'note' | 'trade' }  nothing to open; the card says so (never creates one)
 *   { none: 'error' }           the lookup failed; the card says so
 * Never throws.
 */
export async function resolveStart(entry, location, { fetchImpl = globalThis.fetch } = {}) {
  const kind = startKind(entry)
  if (!kind) return { stay: true }
  if (kind === 'path') return atStart(entry.start, location) ? { stay: true } : { path: entry.start }
  try {
    if (kind === 'trade') {
      const id = await recentTradeId(fetchImpl)
      if (!id) return { none: 'trade' }
      // already on it (a tour carried across the page change goes on from here, W14-Q2)
      return location.pathname === tradePath(id) ? { stay: true } : { path: tradePath(id) }
    }
    const { note, embed } = entry.start
    // `recent` with no widget asked for: any open note is the right screen.
    if (note === 'recent' && !embed && openNoteId(location)) return { stay: true }
    let id = null
    if (note.startsWith('sample:')) id = await sampleNoteId(fetchImpl, note.slice('sample:'.length))
    if (!id) id = await recentNoteId(fetchImpl, embed || null)
    if (!id) return { none: 'note' }
    return openNoteId(location) === id ? { stay: true } : { path: notePath(id) }
  } catch {
    return { none: 'error' }
  }
}

/** What the card says when a start cannot be reached, and where its way out goes. */
export const UNREACHABLE_COPY = Object.freeze({
  note: Object.freeze({
    title: 'This walkthrough runs inside a note',
    body: 'You do not have a note it can open yet. Write a note, or add the sample notebook from the Notebook home, then start it again from Help.',
    exitLabel: 'Go to the Notebook',
    exitPath: NOTEBOOK_ROOT,
  }),
  trade: Object.freeze({
    title: 'This walkthrough runs on a closed trade',
    body: 'You do not have a trade in your journal yet. Once you log or import one, start it again from Help.',
    exitLabel: 'Go to your trades',
    exitPath: '/journal/trades',
  }),
  error: Object.freeze({
    title: 'This walkthrough could not start',
    body: 'We could not look up where it starts. Check your connection and start it again from Help.',
    exitLabel: null,
    exitPath: null,
  }),
})
