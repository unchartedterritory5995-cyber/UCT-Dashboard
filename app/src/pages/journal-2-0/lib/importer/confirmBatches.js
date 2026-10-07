/**
 * Notebook import: how the confirm step is split into requests.
 *
 * `POST /api/j2/notes/import/confirm` takes a batch of whole notes. One process
 * serves every member, so the server holds a single request to 32 MiB
 * (`NOTE_IMPORT_JSON_MAX_BYTES` in api/routers/journal_two.py) and refuses more
 * than 500 notes (`notes.IMPORT_CONFIRM_MAX_NOTES`). The client therefore sends
 * a large import as several requests, each bounded by BYTES and by COUNT, one
 * after another.
 *
 * Splitting is safe because confirm is idempotent per note: the server matches
 * each note by its `importKey`. A note sent twice is `skipped` (same content) or
 * `updated`, never created twice. So a retried request, or a note that lands in
 * a different batch on a second run, cannot duplicate anything.
 *
 * This module imports nothing, on purpose: a backend test runs the planner in
 * plain Node and posts its batches to the real route
 * (tests/test_notebook_body_census.py), which also holds these two numbers
 * under the server's.
 */

/** The most notes in one confirm request. */
export const CONFIRM_BATCH_MAX_NOTES = 200

/** The most bytes in one confirm request: 24 MiB, safely under the server's 32. */
export const CONFIRM_BATCH_MAX_BYTES = 24 * 1024 * 1024

/** Room kept for the request's own wrapper (`source`, `destFolderId`, brackets, commas). */
const ENVELOPE_BYTES = 4096

const encoder = new TextEncoder()
export const utf8Bytes = (text) => encoder.encode(text).length

/** What a member is told about a single note too large to send at all. */
export function noteTooLargeSentence(bytes) {
  const mb = (bytes / (1024 * 1024)).toFixed(1)
  return `This note is too large to import (${mb} MB). Split it into smaller notes and import again.`
}

/**
 * Plan the confirm requests for `items`, in order.
 *
 * @param {Array<T>} items
 * @param {(item: T) => object} toPayload  the note as the server takes it
 * @param {{maxNotes?: number, maxBytes?: number}} [limits]
 * @returns {{batches: Array<{items: T[], parts: string[], bytes: number}>,
 *            tooLarge: Array<{item: T, bytes: number}>}}
 *   `parts` are the notes already serialised, so a body is built without
 *   serialising anything twice. `tooLarge` are notes that cannot fit one request
 *   on their own; they are never sent.
 */
export function planConfirmBatches(items, toPayload, limits = {}) {
  const maxNotes = limits.maxNotes ?? CONFIRM_BATCH_MAX_NOTES
  const maxBytes = limits.maxBytes ?? CONFIRM_BATCH_MAX_BYTES
  const room = maxBytes - ENVELOPE_BYTES
  const batches = []
  const tooLarge = []
  let current = null
  for (const item of items) {
    const part = JSON.stringify(toPayload(item))
    const bytes = utf8Bytes(part)
    if (bytes > room) {
      tooLarge.push({ item, bytes })
      continue
    }
    // +1 for the comma that joins it to the note before
    if (!current || current.items.length >= maxNotes || current.bytes + bytes + 1 > room) {
      current = { items: [], parts: [], bytes: 0 }
      batches.push(current)
    }
    current.items.push(item)
    current.parts.push(part)
    current.bytes += bytes + 1
  }
  return { batches, tooLarge }
}

/** The request body for one planned batch: exactly `{source, destFolderId, notes: [...]}`. */
export function confirmBody({ source, destFolderId }, parts) {
  const envelope = JSON.stringify({ source, destFolderId, notes: [] })
  return `${envelope.slice(0, -2)}${parts.join(',')}]}`
}
