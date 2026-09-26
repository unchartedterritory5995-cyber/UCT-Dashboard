// The sample notebook's client side (wave 8, lane 8C, C3; ruling D-C6): the routes, the
// preference it leaves, and every sentence a member reads about it.
//
// The server (`api/routers/notebook_onboarding.py`) writes five notes into a folder named
// "Sample notebook" for a paid member with no notes at all, records their ids in the
// preference `notebook_sample` ({v:1, ids, at}), and trashes exactly those ids on remove.
// A dismissed strip adds `dismissedAt` to the same value (the whole value is written back —
// `usePreferences().setPref` replaces it — so the ids travel with it).

export const SAMPLE_URL = '/api/j2/onboarding/sample-notebook'
export const SAMPLE_PREF = 'notebook_sample'

export const SAMPLE_COPY = Object.freeze({
  add: 'Add a sample notebook',
  adding: 'Adding the sample…',
  tour: 'Take the tour',
  addFailed: "We couldn't add the sample notebook. Try again in a moment.",
  strip: "You're looking at the sample notebook",
  remove: 'Remove it',
  removing: 'Removing…',
  removed: 'The sample notes are in Trash. You can restore them from there.',
  removeFailed: "We couldn't remove the sample notebook. Try again in a moment.",
  dismiss: 'Hide this message',
})

/** The recorded sample, or null. Tolerates a string (the server's TEXT) or an object. */
export function readSamplePref(raw) {
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return null }
  }
  if (!v || typeof v !== 'object' || !Array.isArray(v.ids)) return null
  const ids = v.ids.filter((i) => typeof i === 'string' && i)
  return ids.length ? { ...v, ids } : null
}

async function detail(res, fallback) {
  try {
    const body = await res.json()
    if (body && typeof body.detail === 'string' && body.detail) return body.detail
  } catch {
    // not JSON
  }
  return fallback
}

/** POST: `{ok: true, folderId, welcomeNoteId}` or `{ok: false, message}` (the server's own
 *  409 sentence when it refuses). Never throws. */
export async function addSampleNotebook() {
  try {
    const res = await fetch(SAMPLE_URL, { method: 'POST', credentials: 'include' })
    if (!res.ok) return { ok: false, message: await detail(res, SAMPLE_COPY.addFailed) }
    const body = await res.json()
    return { ok: true, folderId: body.folderId ?? null, welcomeNoteId: body.welcomeNoteId ?? null }
  } catch {
    return { ok: false, message: SAMPLE_COPY.addFailed }
  }
}

/** DELETE: `{ok: true, trashed}` or `{ok: false, message}`. Never throws. */
export async function removeSampleNotebook() {
  try {
    const res = await fetch(SAMPLE_URL, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) return { ok: false, message: await detail(res, SAMPLE_COPY.removeFailed) }
    const body = await res.json()
    return { ok: true, trashed: Array.isArray(body.trashed) ? body.trashed : [] }
  } catch {
    return { ok: false, message: SAMPLE_COPY.removeFailed }
  }
}

/** The SWR keys whose data a sample write changes: the note lists and tree, the folders,
 *  Research Home, the preferences and the sample's own status. */
export function isNotebookKey(key) {
  return typeof key === 'string' && (
    key.startsWith('/api/j2/notes') || key.startsWith('/api/j2/note-folders')
    || key === '/api/j2/notebook/home' || key === '/api/auth/preferences' || key === SAMPLE_URL)
}
