// The sample notebook's client side (wave 8, lane 8C, C3; ruling D-C6): the routes, the
// preference it leaves, and every sentence a member reads about it.
//
// The server (`api/routers/notebook_onboarding.py`) writes five notes into a folder named
// "Sample notebook" for a paid member with no notes at all, records their ids in the
// preference `notebook_sample` ({v:1, ids, at}), and trashes exactly those ids on remove.
// (Research home's strip could add `dismissedAt` to that value; go-live wave 1 retired the strip, and
// the removal door is now the notes list's ⋯ row "Remove the sample notebook", tabs/NotebookTab.jsx.)
//
// ⛔ Wave 8 final review, fix I-3: "Remove it" is a TRASH door, so before the DELETE it runs
// the bulk trash's own pre-check (lib/noteBatch.js `precheckNoteBatch`) over the sample's
// active ids. The DELETE trashes every recorded id at once, so a sample note still holding
// words this device has not sent refuses the WHOLE removal and is named (`describeSampleHold`);
// a device that could not be asked is offered a confirmed "Remove anyway", as bulk trash
// offers "Trash anyway" -- and the confirmed re-run still refuses a note it finds unsent.

import { UNCHECKED_SENTENCE } from '../../../lib/noteBatch'
import { SAMPLE_ADD_FAILED, SAMPLE_ROW_COPY, SAMPLE_URL, SAMPLE_PREF, readSamplePref } from './sampleNotebookKeys'

// Fix round 1: the route, the key, its reader and the More menu row's words are sampleNotebookKeys.js (on the
// Notebook's first open); re-exported so every import from here keeps working.
export { SAMPLE_URL, SAMPLE_PREF, readSamplePref }
// The two WRITES below name their route as a literal of this file, because the door rail
// (lib/offline/doorEnumeration.test.js) reads every note-touching write's URL from the file it is in and does not
// follow an import. sampleNotebook.test.js pins it to sampleNotebookKeys.js's SAMPLE_URL, the one authority.
export const SAMPLE_WRITE_URL = '/api/j2/onboarding/sample-notebook'

export const SAMPLE_COPY = Object.freeze({
  add: 'Add a sample notebook',
  adding: 'Adding the sample…',
  addFailed: SAMPLE_ADD_FAILED,
  // M-13: the first-run screen shows while a member has no ACTIVE notes, so the server's
  // refusal ("you already have notes") has to say where they are.
  refused: "You already have notes, so we didn't add the sample. If you can't see them, look in Trash or Archive.",
  // (Go-live wave 2: the strip's `strip`, `remove` and `tour` words left with it; tools/notebook_wave8_walk.py now walks
  // the More menu row below and reads the tour doors from Support.jsx and gettingStarted.js.)
  // Go-live wave 1 (A7): the notes list's ⋯ row, and its status line while it runs (sampleNotebookKeys.js).
  ...SAMPLE_ROW_COPY,
  removed: 'Sample notebook moved to Trash. You can restore it from there.',
  removeFailed: "We couldn't remove the sample notebook. Try again in a moment.",
  notRemoved: 'The sample was not removed:',
  // Final fix (C1): what THIS door says about a held note (the bulk trash's shared "is still syncing -- try again in a
  // moment" is not always true here: a save whose answer was lost is not re-sent by waiting). Says what works.
  heldOne: 'has changes that have not finished saving. Open it so it can finish saving, then remove the sample again.',
  heldMany: 'have changes that have not finished saving. Open them so they can finish saving, then remove the sample again.',
  // Simplify pass 2 (D2): a BLOCKED note (its last save was refused, so waiting or opening it does not send it) keeps
  // the older remedy, in a sentence of its own: edit it once more.
  blockedOne: 'is waiting to sync. Edit it once more so it can save, then remove the sample again.',
  blockedMany: 'are waiting to sync. Edit them once more so they can save, then remove the sample again.',
  uncheckedNotRemoved: `${UNCHECKED_SENTENCE} The sample was not removed:`,
  removeAnyway: 'Remove anyway',
  removeAnywayConfirm: 'Remove the sample notebook without checking this device? Words typed here that have not reached the server may not be kept.',
  removeAnywayYes: 'Yes, remove anyway',
})

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
    const res = await fetch(SAMPLE_WRITE_URL, { method: 'POST', credentials: 'include' })
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
    const res = await fetch(SAMPLE_WRITE_URL, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) return { ok: false, message: await detail(res, SAMPLE_COPY.removeFailed) }
    const body = await res.json()
    return {
      ok: true,
      trashed: Array.isArray(body.trashed) ? body.trashed : [],
      foldersKept: Array.isArray(body.foldersKept) ? body.foldersKept : [],
      foldersOlder: Array.isArray(body.foldersOlder) ? body.foldersOlder : [],
      foldersRemoved: Array.isArray(body.foldersRemoved) ? body.foldersRemoved : [],
    }
  } catch {
    return { ok: false, message: SAMPLE_COPY.removeFailed }
  }
}

/** What the member reads after "Remove it": the usual sentence, then one sentence for each
 *  folder that stayed (the server's own words: it holds a note of theirs), so a folder left in
 *  the sidebar is explained and not a leftover. */
export function removedMessage(out) {
  const kept = (Array.isArray(out?.foldersKept) ? out.foldersKept : []).map((f) => f?.sentence).filter(Boolean)
  // ⛔ `foldersOlder` rows are {id, name, sentence} and cover two cases the row cannot tell
  // apart: a folder an old seed made, and the member's OWN folder the seed reused. The server's
  // sentence calls both "an older example folder", which is wrong for a folder that was always
  // the member's. So its sentence is not shown: the folder is named and said to be left in place.
  const older = (Array.isArray(out?.foldersOlder) ? out.foldersOlder : [])
    .map((f) => (f?.name ? `The folder "${f.name}" was left in place.` : 'This folder was left in place.'))
  return [SAMPLE_COPY.removed, ...kept, ...older].join(' ')
}

/**
 * Final fix (C1): a held note is named even when it is not in the list on screen (the old fallback, Research home's
 * `titleOfAnyNote`, went with it). `titleOf` answers for the notes on screen; every held id it cannot name is read
 * from the server (`GET /api/j2/notes/<id>`, a read, at most three: the sentence names three), and a read that fails
 * leaves "A note". Returns the combined `titleOf` for describeSampleHold.
 */
export async function heldTitles(hold, titleOf = () => null) {
  const ids = [...(hold?.unsent || []), ...(hold?.blocked || []), ...(hold?.unchecked || [])].slice(0, 3)
  const found = new Map()
  await Promise.all(ids.filter((id) => !titleOf(id)).map(async (id) => {
    // Final fix residual R1: the removal's busy line waits on these reads, so each gives up after HELD_TITLE_TIMEOUT_MS
    // (aborted, and raced, so a read that ignores the abort cannot hold the door either): not named, "A note".
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
    let timer = null
    const gaveUp = new Promise((resolve) => { timer = setTimeout(() => { ctl?.abort(); resolve(null) }, HELD_TITLE_TIMEOUT_MS) })
    try {
      const read = (async () => {
        const res = await fetch(`/api/j2/notes/${encodeURIComponent(id)}`, { credentials: 'include', ...(ctl ? { signal: ctl.signal } : {}) })
        if (!res.ok) return null
        return (await res.json())?.note?.title
      })().catch(() => null)   // a failed or aborted read (even one that lands after the race) is "A note"
      const title = await Promise.race([read, gaveUp])
      if (typeof title === 'string' && title.trim()) found.set(id, title.trim())
    } catch {
      // not named: "A note"
    } finally {
      clearTimeout(timer)
    }
  }))
  return (id) => titleOf(id) || found.get(id) || null
}

/** How long the removal waits for one held note's title before it says "A note" (final fix residual R1). */
export const HELD_TITLE_TIMEOUT_MS = 3000

/**
 * The sentence -- and, for a device that could not be asked, the offer -- when the pre-check
 * holds the sample back (fix I-3). Null when nothing is held. Every held note is NAMED (up to
 * three, then a count). A note with changes that have not finished saving (unsent) gets THIS door's
 * sentence (final fix C1): what to do, never "try again in a moment". A blocked note gets its own sentence after it
 * (simplify pass 2, D2): it is waiting to sync and needs one more edit.
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
    const said = (ids, one, many) => {
      if (!ids.length) return []
      const names = ids.map((id) => {
        const t = titleOf(id)
        return t ? `"${t}"` : 'A note'
      })
      const shown = names.slice(0, 3).join(', ')
      return [`${names.length > 3 ? `${shown} and ${names.length - 3} more` : shown} ${ids.length === 1 ? one : many}`]
    }
    return {
      message: [SAMPLE_COPY.notRemoved,
        ...said(unsent, SAMPLE_COPY.heldOne, SAMPLE_COPY.heldMany),
        ...said(blocked, SAMPLE_COPY.blockedOne, SAMPLE_COPY.blockedMany)].join(' '),
    }
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
