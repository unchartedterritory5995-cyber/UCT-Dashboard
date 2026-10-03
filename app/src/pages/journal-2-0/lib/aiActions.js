/**
 * Wave 11 lane 11C — "Ask Notebook to do something", the client half.
 *
 * The server (`api/routers/notebook_ai_actions.py`) PLANS a change set from the
 * member's request and writes nothing; the member reviews every change
 * (AiActionsPanel.jsx) and only the ones they leave checked are applied, note by
 * note, through the member's own write paths on the server.
 *
 * ⛔⛔ EVERY REVISION THE APPLY OR UNDO MOVES IS LANDED. Both routes return
 * `revisions: [{noteId, updatedAt}]` — the last revision each note reached — and
 * `settleNoteWrites` lands them, sequentially, before anything else happens, so
 * this browser never reads its own AI change as a stranger's write and forks the
 * note (the door-enumeration rail's rule, lib/offline/doorEnumeration.test.js).
 *
 * ⛔ A BODY BLOCK WAITS FOR UNSENT WORDS. Tags, properties and moves are
 * metadata — a queued offline edit rebases over them. An added block is a body
 * change: sent onto a note whose words are still syncing from this device it
 * would fork that note. So a note that is BLOCKED keeps all its changes back, and
 * a note with unsent (or uncheckable) words keeps its added blocks back, each
 * named with its reason — the bulk bar's pre-check (`lib/noteBatch.js`), reused.
 */
import { settleNoteWrites } from './offline/settleNoteWrite'
import { checkUnsentWork, BLOCKED_TITLE, UNCHECKED_SENTENCE } from './noteBatch'

export const AI_ACTIONS_EXAMPLES = Object.freeze([
  'Tag every note that mentions NVDA earnings with earnings-nvda',
  "Add a 'Next earnings' line to each thesis note for the tickers reporting this week",
  'Set Thesis Status to Closed on every thesis whose ticker I no longer hold',
  'Move my 2024 trade reviews into a folder called 2024 Reviews',
])

export const UNSENT_BLOCK_SENTENCE = 'This note has words still syncing on this device — the added block was held back.'
export const BLOCKED_SENTENCE = `${BLOCKED_TITLE} — nothing was changed on it.`
export const REQUEST_FAILED_SENTENCE = "That didn't go through. Nothing was changed."

async function readError(res, fallback) {
  // The request already FAILED; this only reads its reason. An unreadable error body keeps
  // the fallback sentence -- it is never turned into an empty success.
  let detail = null
  try { detail = (await res.json())?.detail } catch { detail = null }
  const err = new Error(typeof detail === 'string' && detail ? detail : fallback)
  err.status = res.status
  return err
}

/** POST /plan → the change set (nothing written yet). Throws Error(sentence). */
export async function planAiChanges(request, { signal } = {}) {
  const res = await fetch('/api/j2/ai-actions/plan', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request }),
    signal,
  })
  if (!res.ok) throw await readError(res, "Notebook couldn't plan that just now. Nothing was changed in your notes.")
  return res.json()
}

/** The changes, grouped by the note they change, in plan order. A new note is
 *  its own group. → [{key, noteId, noteTitle, isNew, changes:[...]}] */
export function groupChangesByNote(changes) {
  const groups = []
  const byKey = new Map()
  for (const c of changes || []) {
    const isNew = c.op === 'create_note' && !c.noteId
    const key = isNew ? `new:${c.id}` : c.noteId
    let g = byKey.get(key)
    if (!g) {
      g = { key, noteId: isNew ? null : c.noteId, noteTitle: c.noteTitle || 'Untitled', isNew, changes: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.changes.push(c)
  }
  return groups
}

const ADDS_A_BLOCK = (c) => c.op === 'append'

/**
 * Which approved changes this device must HOLD BACK, and why.
 * → Map<changeId, sentence>
 */
export async function heldBackChanges(changes, { blockedNoteIds = null, connect, timeoutMs } = {}) {
  const held = new Map()
  const blocked = (id) => Boolean(id && blockedNoteIds?.has?.(id))
  for (const c of changes) if (blocked(c.noteId)) held.set(c.id, BLOCKED_SENTENCE)
  const blockNotes = [...new Set(changes.filter((c) => ADDS_A_BLOCK(c) && c.noteId && !held.has(c.id))
    .map((c) => c.noteId))]
  if (blockNotes.length) {
    const { unsent, unchecked } = await checkUnsentWork(blockNotes, {
      ...(connect ? { connect } : {}), ...(timeoutMs != null ? { timeoutMs } : {}),
    })
    for (const c of changes) {
      if (!ADDS_A_BLOCK(c) || held.has(c.id)) continue
      if (unsent.has(c.noteId)) held.set(c.id, UNSENT_BLOCK_SENTENCE)
      else if (unchecked.has(c.noteId)) held.set(c.id, `${UNCHECKED_SENTENCE} The added block was held back.`)
    }
  }
  return held
}

/** POST /{id}/apply for ONE note's approved changes. Lands the revisions. */
export async function applyAiChanges(setId, changeIds, declinedIds = []) {
  const res = await fetch(`/api/j2/ai-actions/${encodeURIComponent(setId)}/apply`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changeIds, declinedIds }),
  })
  if (!res.ok) throw await readError(res, REQUEST_FAILED_SENTENCE)
  const body = await res.json()
  // ⛔⛔ THE LINE THAT STOPS A FORK — before any caller refreshes or renders.
  await settleNoteWrites(body.revisions || [])
  return body
}

/**
 * Apply the approved changes note by note, so progress is real.
 * `onProgress({done, total})` after each note. → {results, changeSet}
 * A note's request that fails is reported for each of its changes; the rest go on.
 */
export async function applyApproved({ changeSet, approvedIds, blockedNoteIds = null, onProgress, connect, timeoutMs }) {
  const approved = new Set(approvedIds)
  const all = changeSet.changes || []
  const chosen = all.filter((c) => approved.has(c.id))
  const declined = all.filter((c) => !approved.has(c.id) && c.status === 'planned').map((c) => c.id)
  const held = await heldBackChanges(chosen, { blockedNoteIds, connect, timeoutMs })
  const groups = groupChangesByNote(chosen)
  const results = []
  let latest = changeSet
  let first = true
  const total = groups.length
  onProgress?.({ done: 0, total })
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i]
    const send = g.changes.filter((c) => !held.has(c.id))
    for (const c of g.changes) {
      if (held.has(c.id)) results.push({ id: c.id, noteId: c.noteId, status: 'held', message: held.get(c.id) })
    }
    if (send.length || (first && declined.length)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const body = await applyAiChanges(changeSet.id, send.map((c) => c.id), first ? declined : [])
        first = false
        results.push(...(body.results || []))
        if (body.changeSet) latest = body.changeSet
      } catch (e) {
        for (const c of send) results.push({ id: c.id, noteId: c.noteId, status: 'failed', message: e.message })
      }
    }
    onProgress?.({ done: i + 1, total })
  }
  return { results, changeSet: latest }
}

/** POST /{id}/undo — the whole set, in one click. Lands the revisions. */
export async function undoAiChangeSet(setId) {
  const res = await fetch(`/api/j2/ai-actions/${encodeURIComponent(setId)}/undo`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw await readError(res, "Couldn't undo that just now. Nothing was changed.")
  const body = await res.json()
  await settleNoteWrites(body.revisions || [])
  return body
}

/** GET the change sets that changed one note (its version history shows them). */
export async function listAiChangeSets(noteId) {
  const q = noteId ? `?noteId=${encodeURIComponent(noteId)}` : ''
  const res = await fetch(`/api/j2/ai-actions${q}`, { credentials: 'include' })
  if (!res.ok) throw await readError(res, "Couldn't load the AI change sets.")
  return (await res.json()).changeSets || []
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The sentence after an apply. */
export function describeApply(results) {
  const applied = results.filter((r) => r.status === 'applied').length
  const notApplied = results.length - applied
  if (!results.length) return 'Nothing was applied.'
  return notApplied
    ? `Applied ${plural(applied, 'change')}. ${plural(notApplied, 'change')} could not be applied — listed below.`
    : `Applied ${plural(applied, 'change')}.`
}

/** The sentence after an undo. */
export function describeUndo(body) {
  const results = body?.results || []
  if (!results.length) return body?.message || 'Nothing to undo.'
  const undone = results.filter((r) => r.status === 'undone').length
  const left = results.length - undone
  return left
    ? `Undid ${plural(undone, 'change')}. ${plural(left, 'change')} ${left === 1 ? 'was left as it is' : 'were left as they are'} — listed below.`
    : `Undid ${plural(undone, 'change')}. Your notes are back as they were.`
}
