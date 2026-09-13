/**
 * Wave Q1 — WHAT DID THE SERVER ACTUALLY CHANGE? Classified from the DIFF of
 * the returned note against the last-known one, never from which endpoint was
 * called.
 *
 * ⛔⛔ WHY THE DIFF AND NOT THE CALLER. An endpoint's shape can change in a
 * later wave; a diff of two documents cannot lie about what is in them. Wave Q1
 * enumerated its "doors" from what a canary happened to drive and missed three
 * whole families of them; classifying by caller would repeat that error one
 * layer down, and the failure would be silent.
 *
 * THE THREE SHAPES, and what a caller must do with each:
 *
 *   METADATA_ONLY  body, title and subtitle are byte-identical; only
 *                  folder/ticker/tags/hero moved. The member's queued body is
 *                  still the only authority on the body.
 *                  ⇒ REBASE onto the new revision and send. NEVER fork.
 *
 *   APPEND_ONLY    the server's body is the last-known body with whole blocks
 *                  appended at the end, and every appended block is one the
 *                  SERVER appends on its own behalf: `widgetEmbed` (Send to
 *                  Journal), `financialFact` (a saved price), `documentExcerpt`
 *                  (an excerpt capture).
 *                  ⇒ MERGE those blocks into the queued body and send. No fork.
 *
 *   BODY_REWRITE   anything else — prose changed, a block was removed or moved,
 *                  a title changed, or an unrecognised node appeared.
 *                  ⇒ FORK-NEVER-CLOBBER, unchanged. Preserve both copies.
 *
 * ⛔⛔ THE DEFAULT IS BODY_REWRITE. Every shape this file cannot PROVE falls
 * through to the safe answer, including missing evidence. A classifier that
 * guesses "probably fine" is how a member's words get overwritten, and the
 * whole reason forking exists is that a duplicate is recoverable and an
 * overwrite is not. §6: preserve both when safe reconciliation cannot be
 * PROVEN.
 *
 * ⭐ THIS IS THE GENERALISATION OF `serverChangeIsAppendOnlyEmbeds`, which
 * lived in `NoteEditorPage` and knew about ONE of the three node types. That
 * function is gone; the editor calls this. A guard repeated is a guard
 * unproved, and two copies of this decision would drift the day a fourth
 * server-side append lands.
 */

/**
 * The ONLY blocks the server appends on its own behalf, and the identity that
 * says two of them are the same block.
 *
 * ⛔ IDENTITY IS A NAMED SUBSET OF `attrs`, NEVER THE WHOLE OBJECT. A live
 * ProseMirror node carries every attr the schema declares, defaults included;
 * the JSON the server stores carries only what was written. Keying on the whole
 * `attrs` would make every embed look "missing" when compared against the
 * editor's own document, and the merge would insert a duplicate of every one.
 */
import { usableBaseline } from './baseline'

export const SERVER_APPENDED_TYPES = Object.freeze({
  widgetEmbed: (a) => `${a?.widgetId}|${a?.capturedAt}|${a?.searchText}`,
  financialFact: (a) => `${a?.factId}`,
  documentExcerpt: (a) => `${a?.excerptId}`,
})

export const METADATA_ONLY = 'metadata-only'
export const APPEND_ONLY = 'append-only'
export const BODY_REWRITE = 'body-rewrite'

const str = (v) => (v == null ? '' : String(v))
const json = (v) => JSON.stringify(v ?? null)

/** Is this a block the server appends by itself? */
export const isServerAppendedType = (type) => Object.hasOwn(SERVER_APPENDED_TYPES, str(type))

/**
 * Stable identity for one server-appended block, comparable across the wire
 * format and a live editor document. Returns null for anything else.
 */
export function nodeKeyOf(node) {
  const type = node?.type
  const key = SERVER_APPENDED_TYPES[str(type)]
  return key ? `${type}:${key(node?.attrs)}` : null
}

/** Top-level blocks of a ProseMirror doc, or null when it is not one. */
function blocksOf(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) return null
  return doc.content
}

/**
 * PROVE that `fresh` is `base` with server-appended blocks added at the end,
 * and return those blocks.
 *
 * @returns Node[] when proven (possibly empty, when the bodies are identical),
 *          or null when it is NOT proven — which every caller must read as
 *          "cannot merge", never as "nothing to merge".
 *
 * ⛔ THE PROOF IS POSITIONAL. Every pre-existing block must still be there, in
 * place, byte-identical; the extras must all be at the tail. The three server
 * appenders all push onto the end of the top-level content array (see
 * `append_widget_embed`, `append_financial_fact`, `append_document_excerpt` in
 * `api/services/journal_two/notes.py`), so a block that moved, or an append in
 * the MIDDLE of the document, was not one of theirs and is not safe to treat as
 * one.
 */
export function appendedServerNodes(fresh, base) {
  const a = blocksOf(base?.bodyJson)
  const b = blocksOf(fresh?.bodyJson)
  if (!a || !b) return null
  if (b.length < a.length) return null                 // something was removed
  for (let i = 0; i < a.length; i += 1) {
    if (json(a[i]) !== json(b[i])) return null         // something changed in place
  }
  const tail = b.slice(a.length)
  for (const node of tail) {
    if (!isServerAppendedType(node?.type)) return null  // not a block the server appends
  }
  return tail
}

/**
 * @param fresh the note the server returned
 * @param base  the note as this browser last knew it — the LAST-KNOWN SERVER
 *              COPY, never the member's working copy. Diffing against the
 *              working copy would classify the member's own unsent edit as the
 *              server's change.
 * @returns METADATA_ONLY | APPEND_ONLY | BODY_REWRITE
 */
export function classifyServerChange(fresh, base) {
  // ⛔ Missing evidence is never a licence to merge.
  if (!fresh || !base) return BODY_REWRITE

  // ⛔ A title or subtitle change is AUTHORED CONTENT. It is never metadata and
  // never an append — those are words a person wrote, and overwriting them is
  // exactly the clobber this design exists to prevent.
  if (str(fresh.title) !== str(base.title)) return BODY_REWRITE
  if (str(fresh.subtitle) !== str(base.subtitle)) return BODY_REWRITE

  if (json(fresh.bodyJson) === json(base.bodyJson)) return METADATA_ONLY

  const appended = appendedServerNodes(fresh, base)
  if (appended === null || appended.length === 0) return BODY_REWRITE
  return APPEND_ONLY
}

/**
 * The server-appended blocks in `fresh` that a document does not already hold.
 *
 * @param have  an iterable of keys (from `nodeKeyOf`) already present
 *
 * ⭐ Used two ways: the editor passes the keys in its LIVE document, the drain
 * passes the keys in the queued patch. Both ask the same question, so both ask
 * it here.
 */
export function missingServerNodes(appended, have) {
  const held = have instanceof Set ? have : new Set(have || [])
  return (appended || []).filter((n) => {
    const k = nodeKeyOf(n)
    return k && !held.has(k)
  })
}

/** Every server-appended block's key anywhere in a JSON document. */
export function serverAppendedKeysIn(doc) {
  const keys = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    const k = nodeKeyOf(node)
    if (k) keys.add(k)
    for (const child of node.content || []) walk(child)
  }
  walk(doc)
  return keys
}

/**
 * ── THE LAST-KNOWN SERVER COPY ─────────────────────────────────────────────
 *
 * The classifier above needs a BASE, and the base is not the member's working
 * copy — diffing against that would read the member's own unsent edit as the
 * server's change and fork every time.
 *
 * ⛔⛔ A CLEAN RECORD IS ITS OWN BASE. `dirty: 0` means the server already has
 * this content, so the record answers the question by itself and storing a
 * second copy would be a second authority over one value.
 *
 * ⭐ A DIRTY RECORD CARRIES `serverBase`: what the server told us, captured at
 * the clean→dirty transition and moved forward every time the server tells us
 * something newer (an ack, a successful drain send). It costs one extra body
 * per UNSYNCED note — never per note — and it is the only thing on this device
 * that can say what the server held before the member started typing.
 *
 * ⛔ A dirty record with no snapshot answers NULL, not "assume it matches".
 * Null classifies as BODY_REWRITE, which forks, which preserves both copies.
 */
export function snapshotOfServerCopy(note, updatedAt = null) {
  if (!note) return null
  return {
    title: note.title ?? '',
    subtitle: note.subtitle ?? '',
    bodyJson: note.bodyJson ?? null,
    // ⛔ ONE AUTHORITY. `??` would let an empty string survive as a baseline,
    // which reads as present to a producer and absent to a consumer.
    updatedAt: usableBaseline(updatedAt, note.updatedAt),
  }
}

export function lastKnownServerCopy(rec) {
  if (!rec) return null
  if (!rec.dirty) return snapshotOfServerCopy(rec, usableBaseline(rec.baseUpdatedAt))
  return rec.serverBase || null
}
