/**
 * ⭐⭐ I-A FIX ROUND 3 — A `(conflicted copy)` THE SERVER REFUSED TO CREATE.
 *
 * A queued copy (`noteCopy.js`) is words a member's own swap pushed out of a
 * note's durable record. The sweep turns it into a NEW note with
 * `forkConflictedCopy`. When the server refuses that create FOR GOOD, the words
 * stay on this device and the member decides what happens to them. This module
 * is the ONE place that decides "refused for good", writes that decision, and
 * carries out the member's choice. The drain (`outboxDrain.js`) and the editor
 * (`NoteEditorPage.jsx`) both call it.
 *
 * ⛔⛔ REVIEW C-3: A REFUSED COPY IS NEVER RESTORED INTO ITS SOURCE NOTE. Round
 * 2 offered it through the crash-draft Restore, and that PUT the copy over the
 * note's current server text, which no layer kept. Its only offers are:
 *   · "Save as a separate note": the same create again, as a new note;
 *   · "Discard": delete it from this device, after an in-page confirm.
 *
 * ⛔ REVIEW I-3: REFUSED FOR GOOD MEANS 400, 413 OR 422 FROM THE CREATE ITSELF.
 * Every failure of the source-note read, and 403/404/405/409 from anywhere,
 * describes the request (an edge, a session, a missing route, a switch), not
 * the copy. Those are transient and the next sweep tries again.
 *
 * ⛔ REVIEW I-4: A REFUSED COPY IS NOT A BLOCKED NOTE. Its source note's own
 * writes sync normally. It is not in `listBlockedNoteIds` and gets none of the
 * blocked surfaces; it is its own offer on that note.
 *
 * ⭐⭐ I-A FIX ROUND 4 (review I-6, I-7): THE OFFER SHOWS THE WORDS AND SPEAKS FOR ITSELF.
 *   · The view carries the copy's words as plain text (`bodyText`), so the offer and the
 *     Discard confirm can show them and "Copy text" can put them on the clipboard.
 *     Nobody is asked to delete words they cannot see.
 *   · After a CONTENT refusal (413, or a 400/422 whose reason is the body) the create
 *     can never succeed as it is, so the offer is "Save as plain text": the same fork,
 *     the same title and subtitle, the body flattened to plain paragraphs. The stored
 *     copy keeps its ORIGINAL words until a create lands.
 *   · The server's refusal sentence is never shown. It was written for the note's own
 *     editor ("Move part of it out a level", "it wasn't saved"). The offer picks its own
 *     sentence by refusal class; the server's detail stays in the stored record only,
 *     for diagnosis.
 */
import { clearOutboxEntry, getOutboxEntry, putOutboxEntryIfPresent } from './notebookDb'
import { isNoteCopy } from './noteCopy'

/** Which request of the fork failed: the source-note read or the create. */
export const READ_PHASE = 'read'
export const CREATE_PHASE = 'create'
export const COPY_REFUSED_STATUSES = Object.freeze([400, 413, 422])

/** The one predicate. Anything else is transient and retried. */
export const copyRefusedForGood = (err) => (
  err?.phase === CREATE_PHASE && COPY_REFUSED_STATUSES.includes(err?.status)
)

/** `plain`: the refused create was the plain-text one ("Save as plain text"). */
function refusalOf(err, { plain = false } = {}) {
  // ⛔ Review I-7: the server's sentence is kept HERE, for diagnosis, and never shown.
  const detail = typeof err?.detail === 'string' && err.detail.trim() ? err.detail.trim() : null
  return {
    status: err?.status ?? null, error: String(err?.message || err), detail, at: Date.now(),
    ...(plain ? { plain: true } : {}),
  }
}

/**
 * Mark a copy refused, keeping every word. ⛔ Only if it is still there (one
 * transaction): a refusal coming back after a Discard must not resurrect it.
 * `permanent` stays so a bundle that predates copies skips it instead of
 * sending it as a note update. ⛔ `entry` is the STORED copy: a refused plain-text
 * create re-marks the copy with its original words, never the flattened ones.
 */
export async function holdRefusedCopy(db, entry, err, { plain = false } = {}) {
  const message = String(err?.message || err)
  return putOutboxEntryIfPresent(db, {
    ...entry,
    permanent: true,
    copyRefused: refusalOf(err, { plain }),
    lastError: message,
    lastStatus: err?.status ?? null,
    attempts: (entry.attempts || 0) + 1,
  })
}

export const isRefusedCopy = (entry) => isNoteCopy(entry) && Boolean(entry?.copyRefused)

/**
 * ⭐ I-A fix round 4 (review I-7): the CLASS of a refusal, which picks the offer's own
 * sentence and its buttons. The server's words decide nothing a member reads.
 *   · `too-large`: 413, or a 400/422 that says the body is too long or too large;
 *   · `content`:   any other 400/422 about the body (too deeply nested, a piece the
 *                  editor cannot build, a body that is not a valid document);
 *   · `other`:     a refusal that names another field of the copy (its title or
 *                  subtitle, its folder or tags), or any other status.
 * ⛔ `noteCopy.test.js` reads the server's sentences out of `notes.py` and checks
 * each lands in its class, so a reworded server sentence cannot move one silently.
 */
export const COPY_TOO_LARGE = 'too-large'
export const COPY_CONTENT = 'content'
export const COPY_OTHER = 'other'
const NAMES_ANOTHER_FIELD = /\b(?:sub)?title\b|\bfolder\b|\btags?\b|\bticker\b/i
const SAYS_TOO_BIG = /\btoo (?:long|large|big)\b/i

export function copyRefusalClass(refusal) {
  const status = refusal?.status
  if (status === 413) return COPY_TOO_LARGE
  if (status !== 400 && status !== 422) return COPY_OTHER
  const detail = typeof refusal?.detail === 'string' ? refusal.detail : ''
  if (NAMES_ANOTHER_FIELD.test(detail)) return COPY_OTHER
  return SAYS_TOO_BIG.test(detail) ? COPY_TOO_LARGE : COPY_CONTENT
}

/** A content refusal: the create can never succeed with this body as it is. */
export const isContentRefusal = (kind) => kind === COPY_TOO_LARGE || kind === COPY_CONTENT

/** A failure of the network itself (offline, the request never reached the server). */
export function isOfflineFailure(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (err?.status != null) return false
  return /failed to fetch|network|load failed/i.test(String(err?.message || err))
}

// ── the copy's words as plain text ────────────────────────────────────────────
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])
function leafLabel(node) {
  const attrs = node?.attrs && typeof node.attrs === 'object' ? node.attrs : {}
  for (const key of ['label', 'text']) {
    if (typeof attrs[key] === 'string' && attrs[key].trim()) return attrs[key]
  }
  return ''
}
function inlineText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (node.type === 'hardBreak') return '\n'
  if (Array.isArray(node.content)) return node.content.map(inlineText).join('')
  return leafLabel(node)
}
/** One string per text block, in document order. A container adds nothing. */
function bodyBlocks(bodyJson) {
  const blocks = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    const kids = Array.isArray(node.content) ? node.content : []
    if (kids.some((k) => k?.type === 'text' || k?.type === 'hardBreak')) {
      blocks.push(kids.map(inlineText).join(''))
      return
    }
    if (kids.length) { kids.forEach(walk); return }
    if (TEXTBLOCKS.has(node.type)) { blocks.push(''); return }
    const leaf = leafLabel(node)
    if (leaf) blocks.push(leaf)
  }
  for (const child of Array.isArray(bodyJson?.content) ? bodyJson.content : []) walk(child)
  while (blocks.length && !blocks[0].trim()) blocks.shift()
  while (blocks.length && !blocks[blocks.length - 1].trim()) blocks.pop()
  return blocks
}

/** The copy's body as plain text: one line per text block. */
export function copyBodyText(bodyJson) {
  return bodyBlocks(bodyJson).join('\n')
}

/**
 * The body flattened to plain paragraphs, for "Save as plain text". ⛔ Every line is
 * one paragraph of one text node, and a blank line is an EMPTY paragraph, never an
 * empty text node (the server's create guard refuses those).
 */
export function plainParagraphsDoc(bodyJson) {
  const text = copyBodyText(bodyJson)
  const content = text
    ? text.split('\n').map((line) => (line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }))
    : [{ type: 'paragraph' }]
  return { type: 'doc', content }
}

/** What "Copy text" puts on the clipboard: title, subtitle, then the body. */
export function copyClipboardText(view) {
  const head = [view?.title, view?.subtitle].map((s) => String(s ?? '').trim()).filter(Boolean)
  const body = view?.bodyText ?? copyBodyText(view?.bodyJson)
  return [...head, ...(body ? [...(head.length ? [''] : []), body] : [])].join('\n')
}

const KEPT = 'so it’s kept on this device.'
const COPY_TEXT_DOES = 'Copy text puts its words on your clipboard.'
const DISCARD_DOES = 'Discard deletes the copy from this device.'

/**
 * The offer's own sentence (sentence case, no server prose): what happened, that the
 * words are kept on this device, and what each button does.
 */
export function refusedCopyReason(entry) {
  const refusal = entry?.copyRefused
  const kind = copyRefusalClass(refusal)
  if (refusal?.plain) {
    return `A copy of this note’s words couldn’t be saved as a note, even as plain text, ${KEPT} `
      + `${COPY_TEXT_DOES} ${DISCARD_DOES}`
  }
  const plainDoes = 'Save as plain text saves its words as a separate note without their formatting.'
  if (kind === COPY_TOO_LARGE) {
    return `A copy of this note’s words is too large to be saved as its own note, ${KEPT} `
      + `${plainDoes} ${COPY_TEXT_DOES} ${DISCARD_DOES}`
  }
  if (kind === COPY_CONTENT) {
    return `A copy of this note’s words has content the server can’t store as a note, ${KEPT} `
      + `${plainDoes} ${COPY_TEXT_DOES} ${DISCARD_DOES}`
  }
  return `A copy of this note’s words couldn’t be saved as a separate note, ${KEPT} `
    + `Save as a separate note tries again. ${COPY_TEXT_DOES} ${DISCARD_DOES}`
}

/** What the editor needs to offer one refused copy. */
export function refusedCopyView(entry) {
  const refusal = entry.copyRefused || null
  const kind = copyRefusalClass(refusal)
  const plainRefused = Boolean(refusal?.plain)
  const bodyJson = entry.patch?.bodyJson ?? null
  return {
    mutationId: entry.mutationId,
    title: entry.patch?.title ?? '',
    subtitle: entry.patch?.subtitle ?? '',
    bodyJson,
    bodyText: copyBodyText(bodyJson),
    kind,
    // ⛔ After a content refusal the plain create is the one that can succeed; after a
    // refused plain create, nothing the offer can send will, so only Copy text and
    // Discard remain.
    offerPlain: !plainRefused && isContentRefusal(kind),
    offerSeparate: !plainRefused && !isContentRefusal(kind),
    reason: refusedCopyReason(entry),
  }
}

/** The refused copies of `noteId`, newest refusal first. */
export function refusedCopiesOf(entries, noteId) {
  return (entries || [])
    .filter((e) => isRefusedCopy(e) && e.copyOf === noteId)
    .sort((a, b) => (b.copyRefused?.at || b.queuedAt || 0) - (a.copyRefused?.at || a.queuedAt || 0))
    .map(refusedCopyView)
}

/**
 * "Save as a separate note": the create again, through the same `fork`. With
 * `plain`, "Save as plain text": the same create with the body flattened to plain
 * paragraphs (same title and subtitle rules, same fork, never a PUT to the source).
 * @returns {Promise<{outcome: 'saved'|'refused'|'failed'|'gone', copy?: object, offline?: boolean}>}
 *   saved   — the new note exists and the copy is gone from this device;
 *   refused — refused for good again: kept with its ORIGINAL words, re-marked,
 *             still offered (`copy`);
 *   failed  — a transient failure: kept exactly as it was (`offline` when the
 *             network itself failed);
 *   gone    — it was no longer on this device.
 */
export async function saveRefusedCopy(db, mutationId, { fork, plain = false }) {
  const entry = await getOutboxEntry(db, mutationId)
  if (!isNoteCopy(entry)) return { outcome: 'gone' }
  const sent = plain
    ? { ...entry, patch: { ...entry.patch, bodyJson: plainParagraphsDoc(entry.patch?.bodyJson) } }
    : entry
  try {
    await fork({ ...sent, noteId: entry.copyOf })
  } catch (err) {
    if (!copyRefusedForGood(err)) return { outcome: 'failed', offline: isOfflineFailure(err) }
    await holdRefusedCopy(db, entry, err, { plain })
    const now = await getOutboxEntry(db, mutationId)
    return { outcome: 'refused', copy: now ? refusedCopyView(now) : null }
  }
  await clearOutboxEntry(db, mutationId)
  return { outcome: 'saved' }
}

/** "Discard", confirmed: the copy is deleted from this device. */
export async function discardRefusedCopy(db, mutationId) {
  await clearOutboxEntry(db, mutationId)
}
