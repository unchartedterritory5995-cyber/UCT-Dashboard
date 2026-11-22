// Go-live wave 1, fix round 1 (first-open bytes): what the notes list needs about the sample notebook BEFORE anyone
// presses anything -- the route, the preference key and its reader, and the words of the More menu row -- in a file of
// its own. Everything that runs on a press (add, the removal's pre-check sentences, remove, the refreshed keys) is
// sampleNotebook.js, fetched on that press. sampleNotebook.js re-exports these, so there is one authority for each.

export const SAMPLE_URL = '/api/j2/onboarding/sample-notebook'
export const SAMPLE_PREF = 'notebook_sample'

/** The words the notes list draws before a press: the More menu row and its busy line (SAMPLE_COPY spreads them). */
export const SAMPLE_ROW_COPY = Object.freeze({
  removeRow: 'Remove the sample notebook',
  // Simplify pass 2 (C6): the same row at 640 px and below, where the longer words wrapped to two lines.
  removeRowPhone: 'Remove sample notebook',
  removingLine: 'Removing the sample notebook…',
})

/** Said when the sample cannot be added (the press-time client could not load, or the server refused without a word of
 *  its own). Here, not in sampleNotebook.js, so the add hook can say it without fetching that client. */
export const SAMPLE_ADD_FAILED = "We couldn't add the sample notebook. Try again in a moment."

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
