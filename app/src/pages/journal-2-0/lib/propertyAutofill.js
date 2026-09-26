/**
 * Wave 10 lane 10B — G-165 "autofill properties", the client half (ruling R-3,
 * narrow). The server (`api/services/journal_two/property_autofill.py`, route
 * `POST /api/j2/notes/{id}/writing-help/autofill`) reads the note and answers
 * SUGGESTIONS for its empty member-set properties; it writes nothing.
 *
 * ⛔⛔ THIS FILE WRITES NOTHING EITHER. Its one request asks for suggestions.
 * A suggestion reaches the note only when the member ACCEPTS it, one at a time,
 * and then through the existing property door (PropertiesSection's `setValue`
 * -> `useJ2Note().update({properties})`, which lands its revision with
 * `settleNoteWrite` -- the door ledger's rail ③ covers that PUT). No second
 * write path, nothing for the offline layer to learn.
 */

// ⛔ ONE FACT IN TWO FILES with `property_autofill.AUTOFILL_TYPES`, pinned by
// tests/test_property_autofill.py (it PARSES this array). Keep it a literal.
export const AUTOFILL_TYPES = ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url']

/** The provenance label every suggestion carries until the member accepts it. */
export const AUTOFILL_SOURCE_LABEL = 'Suggested by Compass from this note'
export const AUTOFILL_NOT_SAVED = 'Nothing is saved until you accept a value.'
export const AUTOFILL_NOTHING_SENTENCE = 'Compass found nothing in this note to fill in.'
export const AUTOFILL_FAILED_SENTENCE = "Couldn't reach Compass. Nothing was changed in your note."

/** The properties a suggestion may be offered for: member-set, empty, of a
 *  type Compass can fill -- the server's own rule, so the button is only
 *  offered when the server would have something to try. */
export function autofillCandidates(properties) {
  return (Array.isArray(properties) ? properties : []).filter((p) => (
    p && p.source === 'user_set' && p.value == null && AUTOFILL_TYPES.includes(p.type)
    && !((p.type === 'select' || p.type === 'multi_select') && !(p.options || []).length)
  ))
}

/**
 * Ask for suggestions. → `{ suggestions, model }`; throws an Error whose
 * message is the sentence to show (the server's own, or ours when the server
 * never answered). An abort rethrows as-is.
 */
export async function requestAutofill(noteId, { signal } = {}) {
  let res
  try {
    res = await fetch(`/api/j2/notes/${encodeURIComponent(noteId)}/writing-help/autofill`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new Error(AUTOFILL_FAILED_SENTENCE)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(typeof body?.detail === 'string' && body.detail ? body.detail : AUTOFILL_FAILED_SENTENCE)
    err.status = res.status
    throw err
  }
  return {
    suggestions: Array.isArray(body?.suggestions) ? body.suggestions : [],
    model: typeof body?.model === 'string' ? body.model : null,
  }
}
