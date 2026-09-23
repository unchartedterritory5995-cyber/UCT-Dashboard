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
 * ⛔ A BLOCKED NOTE IS NEVER SENT. A note holding words the server does not
 * have yet is the one a member must not be told they filed, tagged or
 * trashed (the board refuses it for the same reason). It is reported back as
 * `blocked`, with the wave's own sentence, not silently dropped.
 */
import { settleNoteWrites } from './offline/settleNoteWrite'
import { BLOCKED_TITLE } from './offline/unsyncedCopy'

/** Ops that write the note row — refused for a blocked note. Favourites live
 *  in their own table and never touch the note, so they are allowed. */
export const NOTE_WRITING_OPS = new Set(['move', 'addTag', 'removeTag', 'trash', 'restore'])

export { BLOCKED_TITLE }

/**
 * @returns {Promise<{op, results: Array<{id, status, updatedAt?, error?}>,
 *                    changed: number, unchanged: number, failed: number}>}
 * @throws Error(message) when the request itself was refused (a 400/401/5xx):
 *         nothing was written, so there is nothing to land.
 */
export async function runNoteBatch({ ids, op, args = {}, blockedNoteIds = null }) {
  const blocked = []
  const send = []
  for (const id of ids || []) {
    if (NOTE_WRITING_OPS.has(op) && blockedNoteIds?.has?.(id)) blocked.push(id)
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

const FAILURE_WORDS = {
  blocked: 'is waiting to sync (edit it again first)',
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
 * @param ctx      { folderName, tag, titleOf(id) }
 */
export function describeBatch(outcome, { folderName, tag, titleOf = () => null } = {}) {
  const { op, changed, unchanged } = outcome
  const n = plural(changed, 'note')
  const done = {
    move: `Moved ${n} to ${folderName || 'Unfiled'}.`,
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
