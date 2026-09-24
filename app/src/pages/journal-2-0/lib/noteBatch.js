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
 * Both are reported back, each with its own sentence, never silently dropped.
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

export { BLOCKED_TITLE }

/** The RAW "words not yet on the server" answer from a `noteHasUnsentWork`
 *  verdict, whatever the door-guard mode: in DOOR_GUARD_UNKNOWN_ONLY a dirty or
 *  queued note answers `unsent: false` with `why: 'guard-unknown-only'`. */
export function holdsUnsentWork(verdict) {
  return Boolean(verdict?.unsent) || verdict?.why === 'guard-unknown-only'
}

/**
 * Which of `ids` still hold words the server does not have. One store
 * connection for the whole selection, closed afterwards. A store that cannot be
 * read answers "yes" for every note (the predicate's own rule: unknown is not
 * safe), so the caller refuses rather than guesses.
 * @returns {Promise<Set<string>>}
 */
export async function notesHoldingUnsentWork(ids, { connect = openNotebookDb } = {}) {
  const list = [...(ids || [])]
  if (!list.length) return new Set()
  let opened = null
  const once = (acct) => {
    if (!opened) opened = Promise.resolve(connect(acct))
    return opened
  }
  try {
    const verdicts = await Promise.all(list.map((id) => noteHasUnsentWork(id, { connect: once })))
    return new Set(list.filter((_, i) => holdsUnsentWork(verdicts[i])))
  } finally {
    if (opened) opened.then((db) => db?.close?.()).catch(() => {})
  }
}

/**
 * @returns {Promise<{op, results: Array<{id, status, updatedAt?, error?}>,
 *                    changed: number, unchanged: number, failed: number}>}
 * @throws Error(message) when the request itself was refused (a 400/401/5xx):
 *         nothing was written, so there is nothing to land.
 */
export async function runNoteBatch({ ids, op, args = {}, blockedNoteIds = null, connect } = {}) {
  const isBlocked = (id) => NOTE_WRITING_OPS.has(op) && Boolean(blockedNoteIds?.has?.(id))
  const holding = UNSENT_REFUSED_OPS.has(op)
    ? await notesHoldingUnsentWork((ids || []).filter((id) => !isBlocked(id)), connect ? { connect } : undefined)
    : new Set()
  const blocked = []
  const unsent = []
  const send = []
  for (const id of ids || []) {
    if (isBlocked(id)) blocked.push(id)
    else if (holding.has(id)) unsent.push(id)
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
  const parts = [changed ? done : 'Nothing changed.']
  if (unchanged) parts.push(`${plural(unchanged, 'was', 'were')} already that way.`)
  const failures = outcome.results.filter((r) => r.status !== 'changed' && r.status !== 'unchanged')
  if (failures.length) {
    const named = failures.slice(0, 3).map((r) => {
      const t = titleOf(r.id)
      const why = r.status === 'invalid' && r.error ? r.error : (FAILURE_WORDS[r.status] || 'could not be changed')
      return `${t ? `"${t}"` : 'A note'} ${why}`
    })
    const more = failures.length > 3 ? ` and ${failures.length - 3} more` : ''
    parts.push(`${plural(failures.length, 'note was', 'notes were')} not changed: ${named.join('; ')}${more}.`)
  }
  return { message: parts.join(' '), tone: failures.length ? (changed ? 'partial' : 'error') : 'ok' }
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
