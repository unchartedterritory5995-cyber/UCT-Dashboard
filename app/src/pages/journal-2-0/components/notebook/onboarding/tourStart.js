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
import { NEEDS_NOTES, NOTEBOOK_ROOT, startKind } from './tourRegistry'

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

/** Whether the member has NO note at all (one unfiltered, limit-1 read). Only `true` when the read
 *  succeeded and came back empty: a read that fails answers `false`, so the card never offers the
 *  sample on a guess. It is asked only once a chart tour has found nothing to open, and it can
 *  never turn the card into an error card. (The list shows active notes; a member whose only notes
 *  are archived or trashed is offered the sample and gets the server's own refusal sentence.) */
async function hasNoNotes(fetchImpl) {
  try {
    return !(await recentNoteId(fetchImpl, null))
  } catch {
    return false
  }
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
 *   { none: 'note' | 'trade' | 'chart' | 'chartNoNotes' }  nothing to open; the card says so
 *                               (never creates one). `chart`: a tour that needs a chart in a note,
 *                               and the member has notes but none holds one. `chartNoNotes`: the
 *                               same, and the member has no note at all
 *   { none: 'firstNote' }       a tour whose first anchor exists only once the member has a note
 *                               (NEEDS_NOTES), and the member has none: the card says to make one
 *   { none: 'error' }           the lookup failed; the card says so
 * Never throws.
 */
export async function resolveStart(entry, location, { fetchImpl = globalThis.fetch } = {}) {
  // D (polish round): asked only when the first anchor is NOT on screen. For a NEEDS_NOTES tour
  // with no note at all it can never appear, so waiting for it would end in "start it again", and
  // starting it again ends the same way. One read (the same unfiltered limit-1 read the chart card
  // uses); a read that fails answers "has notes", so the tour goes on exactly as before.
  if (NEEDS_NOTES.includes(entry?.id) && (await hasNoNotes(fetchImpl))) return { none: 'firstNote' }
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
    // A chart tour that finds no note holding a chart says THAT, not "no note": the member may
    // well have notes (P0.3), and the way out is a chart (`/chart` in a note).
    if (!id && embed === 'chart') return { none: (await hasNoNotes(fetchImpl)) ? 'chartNoNotes' : 'chart' }
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
    body: 'You do not have a note it can open yet. Write a note, or add the sample notebook from Learn, then start it again from Learn.',
    exitLabel: 'Go to the Notebook',
    exitPath: NOTEBOOK_ROOT,
  }),
  // P0.3: a chart walkthrough, a member who has notes but no chart. The way out is `/chart` in a
  // note. NO sample action here: the server refuses the sample (409) to a member with ANY note,
  // active, archived or trashed, because their own work never shares a notebook with practice
  // notes they did not ask for (sample_notebook.py, ruling D-C6; R15).
  chart: Object.freeze({
    title: 'This walkthrough needs a chart in a note',
    body: 'None of your notes has a chart yet. Type /chart in any note to add one, then start this walkthrough again from Learn.',
    exitLabel: 'Go to my notes',
    exitPath: NOTEBOOK_ROOT,
  }),
  // The same walkthrough for a member with NO note at all (rare: the lookup found nothing to open).
  // The sample is allowed for exactly this member, so the card carries ONE action, `add-sample`
  // (GenericTourEngine.jsx adds it through sampleNotebook.js, then restarts the tour).
  chartNoNotes: Object.freeze({
    title: 'This walkthrough needs a chart in a note',
    body: 'None of your notes has a chart yet. Add the sample notebook, which has one, or type /chart in any note to add your own. Then start the walkthrough again from Learn.',
    action: 'add-sample',
    actionLabel: 'Add the sample notebook',
    exitLabel: 'Go to my notes',
    exitPath: NOTEBOOK_ROOT,
  }),
  // D (polish round): a tour that starts on a control drawn only once the member has a note (the
  // voice tour's "New note" arrow), for a member with none. One way out: the Notebook, to write one.
  // Started ON Home (the exit path is the page already shown), the button does the useful thing in
  // place instead (polish review nit): with the "Start a note" control there (`hereFocus`), it closes
  // the card and puts focus on that control, labelled `hereLabel`; with no such control, the card
  // offers only Close. From anywhere else (Help > Walkthroughs) it goes to the Notebook as before.
  firstNote: Object.freeze({
    title: 'Make a note first',
    body: 'Make your first note, then come back to this tour.',
    exitLabel: 'Go to the Notebook',
    exitPath: NOTEBOOK_ROOT,
    hereFocus: '[data-start-note]',
    hereLabel: 'Show me where',
  }),
  trade: Object.freeze({
    title: 'This walkthrough runs on a closed trade',
    body: 'You do not have a trade in your journal yet. Once you log or import one, start it again from Learn.',
    exitLabel: 'Go to your trades',
    exitPath: '/journal/trades',
  }),
  error: Object.freeze({
    title: 'This walkthrough could not start',
    body: 'We could not look up where it starts. Check your connection and start it again from Learn.',
    exitLabel: null,
    exitPath: null,
  }),
})
