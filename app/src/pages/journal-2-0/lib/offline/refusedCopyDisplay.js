/**
 * ⭐⭐ I-A BYTES — THE DISPLAY HALF OF A REFUSED COPY (`refusedCopy.js` is the decision half).
 *
 * Everything here is reached ONLY from the offer a note shows for a copy of its words the
 * server refused to create (`components/notebook/RefusedCopyOffer.jsx`): the plain-text walk
 * (preview, "Copy text", the plain body), the refusal class and the offer's own sentence, the
 * view the offer renders, and the member's two choices (Save, Discard). A refused copy is rare
 * (a create refused FOR GOOD), so none of it belongs in the Notebook's first-open bytes
 * (`docs/notebook/perf-budgets.json`): this module rides in the offer's own chunk, which the
 * editor loads through `lib/lazyChunk.importWithOneRetry` only when an offer exists.
 *
 * ⛔⛔ WORD SAFETY DOES NOT LIVE HERE. Whether a copy is held, and that it is held with every
 * word, is decided by the STATIC half (`copyRefusedForGood`, `holdRefusedCopy`,
 * `refusedCopiesOf`), which the drain and the durable layer run on every open. Loading this
 * module late changes WHEN the offer appears, never whether the copy is kept; when it cannot
 * load, the editor says so in a fixed sentence and nothing is discarded.
 * Rail: `components/notebook/RefusedCopyOffer.lazy.test.js` (no static importer of this module
 * outside the offer's chunk).
 *
 * The history of each rule below (fix rounds 3-5, reviews C-3, C-4, I-6, I-7, I-8, M-18) is in
 * `refusedCopy.js`'s header; the rules are unchanged by the split.
 */
import { clearOutboxEntry, getOutboxEntry, putOutboxEntryIfPresent } from './notebookDb'
import { conflictedCopyTitle, isNoteCopy } from './noteCopy'
import {
  COPY_CONTENT, COPY_OTHER, COPY_TOO_LARGE, copyRefusedForGood, holdRefusedCopy, refusedCopiesOf,
} from './refusedCopy'
import { citationLeafText } from '../askCitation'
import { fmtTime } from '../../../../components/video/playerUtils'

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
const NAMES_ANOTHER_FIELD = /\b(?:sub)?title\b|\bfolder\b|\btags?\b|\bticker\b/i
const SAYS_TOO_BIG = /\btoo (?:long|large|big)\b/i

export function copyRefusalClass(refusal) {
  const status = refusal?.status
  if (status === 413) return COPY_TOO_LARGE
  if (status !== 400 && status !== 422) return COPY_OTHER
  const detail = typeof refusal?.detail === 'string' ? refusal.detail.trim() : ''
  // ⛔ Fix round 5 (review M-18): a refusal that names NO reason (an edge's 400,
  // FastAPI's list-shaped 422) is not known to be about the body, so it never takes
  // the plain-text path.
  if (!detail) return COPY_OTHER
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
// ⭐ Fix round 5 (review C-4, I-8): ONE walk feeds the preview, "Copy text" and the
// plain body, and it carries every word, those held in node attributes included.
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'imageCaption', 'toggleSummary'])
const INLINE_LEAVES = new Set(['hardBreak', 'dateMention', 'inlineMath', 'videoTimestamp', 'noteLink', 'askCitation'])
// Leaves that hold no words by design: a rule, a contents list (it lists the headings,
// which are read where they are).
const NO_WORDS_BY_DESIGN = new Set(['horizontalRule', 'tableOfContents', 'hardBreak'])
const str = (v) => (typeof v === 'string' ? v.trim() : '')
const attrsOf = (node) => (node?.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs) ? node.attrs : {})

/**
 * What a LEAF node reads as. First the app's own leaf text, `citationLeafText` (the
 * table the search text and Ask read, pinned to the server: a date mention's date, a
 * formula's LaTeX, "[file: name]", a widget's or trade canvas's search text). Then,
 * for the words that table does not read, a per-type list. A type this bundle does not
 * know falls back to the `label` / `text` it names.
 */
function leafText(node) {
  const type = node?.type
  const attrs = attrsOf(node)
  switch (type) {
    case 'hardBreak': return '\n'
    // tiptap.js `plainLeafText`: the one leaf the search text reads beyond the table.
    case 'videoTimestamp': return `[${fmtTime(attrs.seconds || 0)}]`
    case 'image': {
      const alt = str(attrs.alt) || str(attrs.title)
      return alt ? `[image: ${alt}]` : ''
    }
    case 'linkPreview': {
      const head = [str(attrs.title), str(attrs.description)].filter(Boolean).join(' — ')
      const url = str(attrs.url) || str(attrs.domain)
      return head && url ? `${head} (${url})` : head || url
    }
    case 'webEmbed': return str(attrs.url)
    case 'askCitation': return str(attrs.label)
    case 'widgetEmbed':
      return [str(citationLeafText({ type: { name: type }, attrs })), str(attrs.caption)].filter(Boolean).join(' — ')
    default: break
  }
  const own = citationLeafText({ type: { name: type }, attrs })
  if (own) return own
  for (const key of ['label', 'text']) if (str(attrs[key])) return attrs[key]
  return ''
}
const linkOf = (node) => {
  const mark = (Array.isArray(node?.marks) ? node.marks : []).find((m) => m?.type === 'link')
  return mark ? str(mark.attrs?.href) || null : null
}
function inlineText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (Array.isArray(node.content) && node.content.length) return lineText(node.content)
  return leafText(node)
}
/** A text block's words. A link reads "text (url)", once per run of its text. */
function lineText(kids) {
  let out = ''
  let run = ''
  let href = null
  const flush = () => {
    if (run) out += href && run.trim() !== href ? `${run} (${href})` : run
    run = ''
  }
  for (const kid of kids) {
    const next = kid?.type === 'text' ? linkOf(kid) : null
    if (next !== href) { flush(); href = next }
    run += inlineText(kid)
  }
  flush()
  return out
}
const isInlineChild = (k) => k?.type === 'text' || INLINE_LEAVES.has(k?.type)
/** One string per text block or leaf, in document order. A container adds nothing. */
function bodyBlocks(bodyJson) {
  const blocks = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    const kids = Array.isArray(node.content) ? node.content : []
    if (TEXTBLOCKS.has(node.type) || kids.some(isInlineChild)) { blocks.push(lineText(kids)); return }
    // An Ask answer keeps its question in an attribute.
    if (node.type === 'askInsert' && str(attrsOf(node).question)) blocks.push(str(attrsOf(node).question))
    if (kids.length) { kids.forEach(walk); return }
    const leaf = leafText(node)
    if (leaf) blocks.push(leaf)
  }
  for (const child of Array.isArray(bodyJson?.content) ? bodyJson.content : []) walk(child)
  while (blocks.length && !blocks[0].trim()) blocks.shift()
  while (blocks.length && !blocks[blocks.length - 1].trim()) blocks.pop()
  return blocks
}

/**
 * Does the body hold an item the walk cannot show as words (a picture with no
 * description, say)? The offer then says so, so nobody discards what they cannot see.
 */
export function copyHasHiddenItems(bodyJson) {
  let hidden = false
  const walk = (node) => {
    if (hidden || !node || typeof node !== 'object') return
    const kids = Array.isArray(node.content) ? node.content : []
    if (kids.length) { kids.forEach(walk); return }
    if (node.type === 'text' || TEXTBLOCKS.has(node.type) || NO_WORDS_BY_DESIGN.has(node.type)) return
    if (!str(leafText(node))) hidden = true
  }
  for (const child of Array.isArray(bodyJson?.content) ? bodyJson.content : []) walk(child)
  return hidden
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
  // ⛔ Fix round 5 (C-4): a plain save landed, and the copy is still kept.
  if (refusal?.plainSaved) {
    const title = refusal.plainSaved.title || conflictedCopyTitle(entry?.patch?.title)
    return `A plain-text version of this copy is now its own note, “${title}”. `
      + 'The original copy, with everything plain text can’t hold, is still kept on this device until you discard it. '
      + `${COPY_TEXT_DOES} ${DISCARD_DOES}`
  }
  if (refusal?.plain) {
    return `A copy of this note’s words couldn’t be saved as a note, even as plain text, ${KEPT} `
      + `${COPY_TEXT_DOES} ${DISCARD_DOES}`
  }
  // Fix round 5 (C-4): true now in both halves — the walk carries every word, and the
  // copy stays until the member discards it.
  const plainDoes = 'Save as plain text saves its words as a separate note without their formatting, '
    + 'and keeps this copy.'
  if (kind === COPY_TOO_LARGE) {
    return `A copy of this note’s words is too large to be saved as its own note, ${KEPT} `
      + `${plainDoes} ${COPY_TEXT_DOES} ${DISCARD_DOES}`
  }
  if (kind === COPY_CONTENT) {
    return `A copy of this note’s words has content the server can’t store as a note, ${KEPT} `
      + `${plainDoes} ${COPY_TEXT_DOES} ${DISCARD_DOES}`
  }
  // ⛔ Fix round 5 (wording ruling): never "tries again" for a refusal a retry cannot
  // fix (its title, subtitle, folder or tags); say what the member can do instead.
  const detail = typeof refusal?.detail === 'string' ? refusal.detail : ''
  if (NAMES_ANOTHER_FIELD.test(detail)) {
    return 'A copy of this note’s words couldn’t be saved as a separate note because of its title, '
      + `subtitle, folder or tags, ${KEPT} Copy text puts its words on your clipboard, so you can paste them `
      + `into a new note. ${DISCARD_DOES}`
  }
  return `A copy of this note’s words couldn’t be saved as a separate note, ${KEPT} `
    + 'Save as a separate note sends it to the server once more. If that is refused too, Copy text puts '
    + `its words on your clipboard, so you can paste them into a new note. ${DISCARD_DOES}`
}

/** What the editor needs to offer one refused copy. */
export function refusedCopyView(entry) {
  const refusal = entry.copyRefused || null
  const kind = copyRefusalClass(refusal)
  const plainSaved = refusal?.plainSaved || null
  // After a refused plain create, or once a plain one landed, nothing more is sent.
  const done = Boolean(refusal?.plain) || Boolean(plainSaved)
  const bodyJson = entry.patch?.bodyJson ?? null
  return {
    mutationId: entry.mutationId,
    title: entry.patch?.title ?? '',
    subtitle: entry.patch?.subtitle ?? '',
    bodyJson,
    bodyText: copyBodyText(bodyJson),
    // Fix round 5 (I-8): an item the walk cannot show as words is said to be there.
    hiddenItems: copyHasHiddenItems(bodyJson),
    kind,
    plainSaved,
    // ⛔ After a content refusal the plain create is the one that can succeed; after a
    // refused plain create, nothing the offer can send will, so only Copy text and
    // Discard remain. ⛔ Fix round 5 (C-4): after a plain create LANDED, the same: a
    // second one would only make a duplicate note.
    offerPlain: !done && isContentRefusal(kind),
    offerSeparate: !done && !isContentRefusal(kind),
    reason: refusedCopyReason(entry),
  }
}

/** The offer views of `noteId`'s refused copies, newest refusal first (`refusedCopiesOf`). */
export function refusedCopyViewsOf(entries, noteId) {
  return refusedCopiesOf(entries, noteId).map(refusedCopyView)
}

/**
 * "Save as a separate note": the create again, through the same `fork`. With
 * `plain`, "Save as plain text": the same create with the body flattened to plain
 * paragraphs (same title and subtitle rules, same fork, never a PUT to the source).
 * @returns {Promise<{outcome: 'saved'|'plain-saved'|'refused'|'failed'|'gone', copy?: object, entry?: object, offline?: boolean}>}
 *   saved       — the new note exists and the copy is gone from this device (the
 *                 FULL body was sent);
 *   plain-saved — ⛔ fix round 5 (C-4): the plain-text note exists and the copy is
 *                 KEPT, original words and all, marked `plainSaved` (`copy`, `entry`);
 *   refused     — refused for good again: kept with its ORIGINAL words, re-marked,
 *                 still offered (`copy`, `entry`);
 *   failed      — a transient failure: kept exactly as it was (`offline` when the
 *                 network itself failed);
 *   gone        — it was no longer on this device.
 * `copy` is the offer's view; `entry` is the stored record it was built from (the editor
 * keeps records, and builds views only in the offer's chunk).
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
    return { outcome: 'refused', copy: now ? refusedCopyView(now) : null, entry: now || null }
  }
  if (plain) return markPlainSaved(db, entry)
  await clearOutboxEntry(db, mutationId)
  return { outcome: 'saved' }
}

/**
 * ⛔⛔ Fix round 5 (C-4): a plain save LANDED. The copy is never deleted for it: it is
 * re-marked (its ORIGINAL words untouched, still `copyRefused`, so the sweep keeps
 * holding it) and offered for Copy text and Discard only. Only if the copy is still
 * there (one transaction): a Discard meanwhile is not undone.
 * ⛔ A mark that cannot be WRITTEN still reports the save landed — saying "try again"
 * for a note that exists makes a duplicate — and the copy is still on this device.
 */
async function markPlainSaved(db, entry) {
  const marked = {
    ...entry,
    copyRefused: { ...(entry.copyRefused || {}), plainSaved: { title: conflictedCopyTitle(entry.patch?.title), at: Date.now() } },
  }
  let present = true
  try {
    present = await putOutboxEntryIfPresent(db, marked)
  } catch {
    present = true
  }
  return present
    ? { outcome: 'plain-saved', copy: refusedCopyView(marked), entry: marked }
    : { outcome: 'saved', plain: true }
}

/** "Discard", confirmed: the copy is deleted from this device. */
export async function discardRefusedCopy(db, mutationId) {
  await clearOutboxEntry(db, mutationId)
}
