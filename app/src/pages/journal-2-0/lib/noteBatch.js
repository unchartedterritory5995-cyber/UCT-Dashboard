/**
 * Bulk operations on notes — the client half of `POST /api/j2/notes/batch`.
 *
 * ⛔⛔ EVERY NOTE A BATCH CHANGES HAS ITS REVISION LANDED. A move, a tag or a
 * restore advances each note's `updatedAt` on the server; a browser that is
 * not told reads its own write as a stranger's the next time an open editor
 * or the durable working copy saves, and FORKS the note. The server returns
 * `updatedAt` for exactly the notes whose revision moved, and
 * `settleNoteWrites` lands them — sequentially, into the one ring — before
 * anything else happens. Same rule as the board's drag (NoteBoardView) and the
 * folder delete (useJ2NoteFolders), and the door-enumeration rail
 * (lib/offline/doorEnumeration.test.js) demands the settle beside the fetch.
 *
 * ⛔ UNSENT WORDS: TWO SIGNALS, AND WHICH OPS READ WHICH (review S1).
 *
 *  · BLOCKED (`useBlockedNotes`) — an outbox entry the drain has RETIRED from
 *    retrying. Every note-writing op refuses it: the member must not be told
 *    they filed, tagged or trashed a note whose words the server never took
 *    (the board refuses it for the same reason).
 *
 *  · STILL SENDING (`noteHasUnsentWork`) — a dirty durable record, or a queued
 *    entry the drain has NOT retired (it has not run yet, or a 5xx made it
 *    retry). `blocked` cannot see either. TRASH and EXPORT refuse these too:
 *      – trash: the queued PUT then meets a trashed note, gets a 404 (not
 *        transient), and is retired as blocked ON A NOTE IN THE TRASH — where a
 *        card never shows the blocked badge — and the 30-day purge strands it;
 *      – export: the zip would carry the server's older text while the member
 *        is told it holds the note.
 *    ⛔ They read the RAW signal whatever the door-guard mode: in
 *    DOOR_GUARD_UNKNOWN_ONLY the predicate answers "no unsent work" for
 *    dirty/queued (fix 6 closed the CLEAN-WRITE path), but the 404 after a
 *    trash is not that writer. `holdsUnsentWork` reads the verdict's `why`.
 *
 *    MOVE, TAG and RESTORE stay on `blocked` only, deliberately: the outbox PUT
 *    carries title, subtitle and body — never folder or tags — and after a
 *    batch a queued entry 409s, finds the batch's revision in the landed ring
 *    and REBASES rather than forking. It cannot undo a batch's folder or tag
 *    change, and the member's words still arrive.
 *
 *  · UNCHECKED (review R1-S1) — the device could not be asked at all: the
 *    durable store would not open or read (`why: 'unreadable'`), or the open
 *    did not settle within UNSENT_CHECK_TIMEOUT_MS (`openNotebookDb` waits
 *    forever while another tab blocks a version upgrade). That is NOT "still
 *    syncing": saying so told a member whose store can never open to "try
 *    again" forever. It is said as what it is — "Can't check this device for
 *    unsent words." — and offered as an explicit, CONFIRMED "Trash anyway" /
 *    "Export anyway" (`acceptUnchecked`). ⛔ Never a silent proceed: without
 *    the member's confirmation an unchecked note is held back like an unsent
 *    one. ⛔ And "anyway" waives only the check that could not run — a note
 *    the re-check DOES find unsent is still refused.
 *
 * All three are reported back, each with its own sentence, never silently
 * dropped.
 */
import { settleNoteWrites } from './offline/settleNoteWrite'
import { BLOCKED_TITLE } from './offline/unsyncedCopy'
import { noteHasUnsentWork } from './offline/noteHasUnsentWork'
import { openNotebookDb } from './offline/notebookDb'

/** Ops that write the note row — refused for a blocked note. Favourites live
 *  in their own table and never touch the note, so they are allowed. */
export const NOTE_WRITING_OPS = new Set(['move', 'addTag', 'removeTag', 'trash', 'restore'])

/** Ops that also refuse a note whose words are still being sent (see above). */
export const UNSENT_REFUSED_OPS = new Set(['trash'])

/** How long asking the device may take before its notes count as UNCHECKED.
 *  `openNotebookDb` never settles while a version upgrade is blocked by
 *  another tab, so an unbounded wait would hang the action (review R1-S1). */
export const UNSENT_CHECK_TIMEOUT_MS = 4000

/** The sentence for a device that could not be asked (review R1-S1). */
export const UNCHECKED_SENTENCE = "Can't check this device for unsent words."

export { BLOCKED_TITLE }

/** The RAW "words not yet on the server" answer from a `noteHasUnsentWork`
 *  verdict, whatever the door-guard mode: in DOOR_GUARD_UNKNOWN_ONLY a dirty or
 *  queued note answers `unsent: false` with `why: 'guard-unknown-only'`. */
export function holdsUnsentWork(verdict) {
  return Boolean(verdict?.unsent) || verdict?.why === 'guard-unknown-only'
}

/**
 * Which of `ids` still hold words the server does not have (`unsent`), and
 * which could not be CHECKED (`unchecked`): the store would not open or read,
 * or the open did not settle within `timeoutMs`. One store connection for the
 * whole selection, closed afterwards. Neither answer is a pass — the caller
 * holds both back, and says which is which.
 * @returns {Promise<{unsent: Set<string>, unchecked: Set<string>}>}
 */
export async function checkUnsentWork(ids, { connect = openNotebookDb, timeoutMs = UNSENT_CHECK_TIMEOUT_MS } = {}) {
  const list = [...(ids || [])]
  const out = { unsent: new Set(), unchecked: new Set() }
  if (!list.length) return out
  let opened = null
  const once = (acct) => {
    if (!opened) opened = Promise.resolve(connect(acct))
    return opened
  }
  let timer = null
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) })
  try {
    const verdicts = await Promise.race([
      Promise.all(list.map((id) => noteHasUnsentWork(id, { connect: once }))),
      timedOut,
    ])
    list.forEach((id, i) => {
      const v = verdicts ? verdicts[i] : null
      if (!v || v.why === 'unreadable') out.unchecked.add(id)
      else if (holdsUnsentWork(v)) out.unsent.add(id)
    })
    return out
  } finally {
    clearTimeout(timer)
    if (opened) opened.then((db) => db?.close?.()).catch(() => {})
  }
}

/**
 * @returns {Promise<{op, results: Array<{id, status, updatedAt?, error?}>,
 *                    changed: number, unchanged: number, failed: number}>}
 * @throws Error(message) when the request itself was refused (a 400/401/5xx):
 *         nothing was written, so there is nothing to land.
 */
export async function runNoteBatch({
  ids, op, args = {}, blockedNoteIds = null, connect, timeoutMs, acceptUnchecked = false,
} = {}) {
  const isBlocked = (id) => NOTE_WRITING_OPS.has(op) && Boolean(blockedNoteIds?.has?.(id))
  const checked = UNSENT_REFUSED_OPS.has(op)
    ? await checkUnsentWork((ids || []).filter((id) => !isBlocked(id)), {
      ...(connect ? { connect } : {}), ...(timeoutMs != null ? { timeoutMs } : {}),
    })
    : { unsent: new Set(), unchecked: new Set() }
  const blocked = []
  const unsent = []
  const unchecked = []
  const send = []
  for (const id of ids || []) {
    if (isBlocked(id)) blocked.push(id)
    else if (checked.unsent.has(id)) unsent.push(id)
    // ⛔ Only a member's CONFIRMED "anyway" sends a note the device could not
    // be asked about; otherwise it is held back and offered (R1-S1).
    else if (checked.unchecked.has(id) && !acceptUnchecked) unchecked.push(id)
    else send.push(id)
  }
  let body = { op, results: [] }
  if (send.length) {
    const res = await fetch('/api/j2/notes/batch', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: send, op, args }),
    })
    if (!res.ok) {
      const detail = await res.json().then((b) => b?.detail).catch(() => null)
      throw new Error(detail ? String(detail) : `That did not go through (server answered ${res.status}). Nothing was changed.`)
    }
    body = await res.json()
    // ⛔⛔ THE LINE THAT STOPS A FORK — before any caller refreshes or renders.
    await settleNoteWrites(
      (body.results || [])
        .filter((r) => r.status === 'changed' && r.updatedAt)
        .map((r) => ({ noteId: r.id, updatedAt: r.updatedAt })),
    )
  }
  const results = [
    ...(body.results || []),
    ...blocked.map((id) => ({ id, status: 'blocked', error: BLOCKED_TITLE })),
    ...unsent.map((id) => ({ id, status: 'unsent' })),
    ...unchecked.map((id) => ({ id, status: 'unchecked' })),
  ]
  const count = (pred) => results.filter(pred).length
  return {
    op,
    results,
    changed: count((r) => r.status === 'changed'),
    unchanged: count((r) => r.status === 'unchanged'),
    failed: count((r) => r.status !== 'changed' && r.status !== 'unchanged'),
  }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const FAILURE_WORDS = {
  blocked: 'is waiting to sync (edit it again first)',
  unsent: 'is still syncing — try again in a moment',
  not_found: 'no longer exists',
  in_trash: 'is in the Trash',
  conflict: 'changed while this ran — try again',
  invalid: 'could not take it',
  // R1-N3: only an Undo of a move produces these, and an Undo cannot be
  // retried — so neither says "try again". They say what happened instead.
  moved_since: 'was moved again after this — left where it is',
  folder_gone: (r) => `could not go back: its folder no longer exists — it stayed in ${r.stayedInFolderName || 'Unfiled'}`,
}

/** An Undo cannot be retried (the member has nothing to press again), so a
 *  note that raced it is reported as left alone, never as "try again". */
export const UNDO_CONFLICT_WORDS = 'was changed again after this — left where it is'

function failureWords(r, { backToOrigin = false } = {}) {
  if (r.status === 'invalid' && r.error) return r.error
  if (r.status === 'conflict' && backToOrigin) return UNDO_CONFLICT_WORDS
  const w = FAILURE_WORDS[r.status]
  if (typeof w === 'function') return w(r)
  return w || 'could not be changed'
}

/**
 * The sentence a member reads after a bulk action: what happened, then what
 * did not and why. Never just a count — "3 failed" tells nobody what to do.
 *
 * @param outcome  runNoteBatch's return value
 * @param ctx      { folderName, tag, backToOrigin, titleOf(id) } — `backToOrigin`
 *                 marks a move that put notes back where they were (Undo).
 */
export function describeBatch(outcome, { folderName, tag, backToOrigin = false, titleOf = () => null } = {}) {
  const { op, changed, unchanged } = outcome
  const n = plural(changed, 'note')
  const done = {
    move: backToOrigin
      ? `Moved ${n} back to where ${changed === 1 ? 'it was' : 'they were'}.`
      : `Moved ${n} to ${folderName || 'Unfiled'}.`,
    addTag: `Tagged ${n} #${tag}.`,
    removeTag: `Removed #${tag} from ${n}.`,
    favorite: `Added ${n} to Favorites.`,
    unfavorite: `Removed ${n} from Favorites.`,
    trash: `Moved ${n} to the Trash.`,
    restore: `Restored ${n}.`,
  }[op] || `Updated ${n}.`
  // An UNCHECKED note is not a failure of this batch: it has its own sentence
  // and its own "anyway" (describeUnchecked), so it is left out of this one.
  const failures = outcome.results.filter((r) => !['changed', 'unchanged', 'unchecked'].includes(r.status))
  const onlyUnchecked = !changed && !unchanged && !failures.length
    && outcome.results.some((r) => r.status === 'unchecked')
  if (onlyUnchecked) return { message: '', tone: 'ok' }
  const parts = [changed ? done : 'Nothing changed.']
  if (unchanged) parts.push(`${plural(unchanged, 'was', 'were')} already that way.`)
  if (failures.length) {
    const named = failures.slice(0, 3).map((r) => {
      const t = titleOf(r.id)
      return `${t ? `"${t}"` : 'A note'} ${failureWords(r, { backToOrigin })}`
    })
    const more = failures.length > 3 ? ` and ${failures.length - 3} more` : ''
    parts.push(`${plural(failures.length, 'note was', 'notes were')} not changed: ${named.join('; ')}${more}.`)
  }
  return { message: parts.join(' '), tone: failures.length ? (changed ? 'partial' : 'error') : 'ok' }
}

/**
 * The sentence and the offer for notes the device could not be ASKED about
 * (review R1-S1) — or null when there are none. The offer is two-step: the
 * member presses `label`, reads `confirm`, and only `confirmLabel` proceeds.
 *
 * @param op   'trash' | 'export'
 * @param ids  the unchecked note ids
 */
export function describeUnchecked(op, ids, { titleOf = () => null } = {}) {
  const list = [...(ids || [])]
  if (!list.length) return null
  const what = { trash: 'moved to the Trash', export: 'included' }[op] || 'changed'
  const named = list.slice(0, 3).map((id) => {
    const t = titleOf(id)
    return t ? `"${t}"` : 'a note'
  })
  const more = list.length > 3 ? ` and ${list.length - 3} more` : ''
  const n = plural(list.length, 'note')
  return {
    message: `${UNCHECKED_SENTENCE} ${plural(list.length, 'note was', 'notes were')} not ${what}: ${named.join('; ')}${more}.`,
    tone: 'error',
    anyway: op === 'export'
      ? {
        op, ids: list, label: 'Export anyway', confirmLabel: 'Yes, export anyway',
        confirm: `Export ${n} without checking this device? Words typed here that have not reached the server would be missing from the file.`,
      }
      : {
        op, ids: list, label: 'Trash anyway', confirmLabel: 'Yes, trash anyway',
        confirm: `Move ${n} to the Trash without checking this device? Words typed here that have not reached the server may not be kept.`,
      },
  }
}

/**
 * How to take a batch back, from what the server said it did — or null when it
 * cannot be undone. A trash is undone by restoring exactly the notes it moved to
 * the Trash; a move by putting each note back in the folder it LEFT (the server
 * reports `fromFolderId`), and only while it is still where this batch put it.
 */
export function undoFor(op, outcome, args = {}) {
  const changed = (outcome?.results || []).filter((r) => r.status === 'changed')
  if (!changed.length) return null
  if (op === 'trash') return { op: 'restore', ids: changed.map((r) => r.id), args: {} }
  if (op === 'move' && !args.folders) {
    const back = changed.filter((r) => 'fromFolderId' in r)
    if (!back.length) return null
    return {
      op: 'move',
      ids: back.map((r) => r.id),
      args: {
        folders: Object.fromEntries(back.map((r) => [r.id, r.fromFolderId ?? null])),
        expectFolderId: args.folderId ?? null,
      },
    }
  }
  return null
}

/**
 * The sentence after "Export selected": what went into the zip, and each note
 * that did not, BY NAME and why.
 */
export function describeExport({ count = 0, skipped = 0, blocked = [], unsent = [] }, { titleOf = () => null } = {}) {
  const parts = []
  if (count) parts.push(`Exported ${plural(count, 'note')} as a Markdown zip.`)
  if (skipped) parts.push(`${skipped} could not be exported — they are in the Trash or no longer exist.`)
  const left = [
    ...blocked.map((id) => [id, FAILURE_WORDS.blocked]),
    ...unsent.map((id) => [id, FAILURE_WORDS.unsent]),
  ]
  if (left.length) {
    const named = left.slice(0, 3).map(([id, why]) => {
      const t = titleOf(id)
      return `${t ? `"${t}"` : 'A note'} ${why}`
    })
    const more = left.length > 3 ? ` and ${left.length - 3} more` : ''
    parts.push(`${plural(left.length, 'note was', 'notes were')} not included: ${named.join('; ')}${more}.`)
  }
  if (!parts.length) parts.push('Nothing was exported.')
  return { message: parts.join(' '), tone: left.length ? 'partial' : 'ok' }
}

/**
 * Download the selected notes as one Markdown zip, through the same export
 * the whole-notebook dialog uses (the server gathers per-note exports).
 * @returns {Promise<{count: number, skipped: number}>}
 */
export async function exportSelectedNotes(ids) {
  const res = await fetch('/api/j2/notes/batch/export', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('An export is already running for your account. Please wait a moment and try again.')
    }
    const detail = await res.json().then((b) => b?.detail).catch(() => null)
    throw new Error(detail ? String(detail) : `The export could not be prepared (server answered ${res.status}).`)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  const filename = (/filename="([^"]+)"/.exec(disposition) || [])[1] || 'notebook-selection.zip'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return {
    count: Number(res.headers.get('x-export-count') ?? ids.length),
    skipped: Number(res.headers.get('x-export-skipped') ?? 0),
  }
}
