// The sample notebook's client side (wave 8, lane 8C, C3; ruling D-C6): the routes, the
// preference it leaves, and every sentence a member reads about it.
//
// The server (`api/routers/notebook_onboarding.py`) writes five notes into a folder named
// "Sample notebook" for a paid member with no notes at all, records their ids in the
// preference `notebook_sample` ({v:1, ids, at}), and trashes exactly those ids on remove.
// A dismissed strip adds `dismissedAt` to the same value (the whole value is written back —
// `usePreferences().setPref` replaces it — so the ids travel with it).
//
// ⛔ Wave 8 final review, fix I-3: "Remove it" is a TRASH door, so before the DELETE it runs
// the bulk trash's own pre-check (lib/noteBatch.js `precheckNoteBatch`) over the sample's
// active ids. The DELETE trashes every recorded id at once, so a sample note still holding
// words this device has not sent refuses the WHOLE removal and is named (`describeSampleHold`);
// a device that could not be asked is offered a confirmed "Remove anyway", as bulk trash
// offers "Trash anyway" -- and the confirmed re-run still refuses a note it finds unsent.

import { FAILURE_WORDS, UNCHECKED_SENTENCE } from '../../../lib/noteBatch'

export const SAMPLE_URL = '/api/j2/onboarding/sample-notebook'
export const SAMPLE_PREF = 'notebook_sample'

export const SAMPLE_COPY = Object.freeze({
  add: 'Add a sample notebook',
  adding: 'Adding the sample…',
  tour: 'Take the tour',
  addFailed: "We couldn't add the sample notebook. Try again in a moment.",
  // M-13: the first-run screen shows while a member has no ACTIVE notes, so the server's
  // refusal ("you already have notes") has to say where they are.
  refused: "You already have notes, so we didn't add the sample. If you can't see them, look in Trash or Archive.",
  strip: "You're looking at the sample notebook",
  remove: 'Remove it',
  removing: 'Removing…',
  removed: 'The sample notes are in Trash. You can restore them from there.',
  removeFailed: "We couldn't remove the sample notebook. Try again in a moment.",
  notRemoved: 'The sample was not removed:',
  uncheckedNotRemoved: `${UNCHECKED_SENTENCE} The sample was not removed:`,
  removeAnyway: 'Remove anyway',
  removeAnywayConfirm: 'Remove the sample notebook without checking this device? Words typed here that have not reached the server may not be kept.',
  removeAnywayYes: 'Yes, remove anyway',
  cancel: 'Cancel',
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

/** POST: `{ok: true, folderId, welcomeNoteId}` or `{ok: false, message}`. Never throws.
 *  A 409 (the member has notes -- active, archived OR trashed) is said in OUR words, which name
 *  Trash and Archive (M-13); any other refusal keeps the server's own sentence. */
export async function addSampleNotebook() {
  try {
    const res = await fetch(SAMPLE_URL, { method: 'POST', credentials: 'include' })
    if (res.status === 409) return { ok: false, message: SAMPLE_COPY.refused }
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

const named = (ids, words, titleOf) => ids.map((id) => {
  const t = titleOf(id)
  return `${t ? `"${t}"` : 'A note'} ${words}`
})

/**
 * The sentence -- and, for a device that could not be asked, the offer -- when the pre-check
 * holds the sample back (fix I-3). Null when nothing is held. Every held note is NAMED (up to
 * three, then a count), in the bulk trash's own words (`FAILURE_WORDS`).
 * @param hold  precheckNoteBatch's answer: { blocked, unsent, unchecked }
 */
export function describeSampleHold(hold, { titleOf = () => null } = {}) {
  const blocked = hold?.blocked || []
  const unsent = hold?.unsent || []
  const unchecked = hold?.unchecked || []
  const list = (parts) => {
    const shown = parts.slice(0, 3).join('; ')
    return parts.length > 3 ? `${shown} and ${parts.length - 3} more` : shown
  }
  if (blocked.length || unsent.length) {
    const parts = [
      ...named(unsent, FAILURE_WORDS.unsent, titleOf),
      ...named(blocked, FAILURE_WORDS.blocked, titleOf),
    ]
    return { message: `${SAMPLE_COPY.notRemoved} ${list(parts)}.` }
  }
  if (unchecked.length) {
    const parts = unchecked.map((id) => {
      const t = titleOf(id)
      return t ? `"${t}"` : 'a note'
    })
    return {
      message: `${SAMPLE_COPY.uncheckedNotRemoved} ${list(parts)}.`,
      anyway: {
        label: SAMPLE_COPY.removeAnyway,
        confirm: SAMPLE_COPY.removeAnywayConfirm,
        confirmLabel: SAMPLE_COPY.removeAnywayYes,
      },
    }
  }
  return null
}

/** The SWR keys whose data a sample write changes: the note lists and tree, the folders,
 *  Research Home, the preferences and the sample's own status. */
export function isNotebookKey(key) {
  return typeof key === 'string' && (
    key.startsWith('/api/j2/notes') || key.startsWith('/api/j2/note-folders')
    || key === '/api/j2/notebook/home' || key === '/api/auth/preferences' || key === SAMPLE_URL)
}
