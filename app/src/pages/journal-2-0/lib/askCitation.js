// Wave K Slice 6 — the citation contract, client side.
//
// The server sends a numbered evidence packet BEFORE the answer streams, and
// the model cites [n]. This module does two things with that:
//
//   splitAnswer()        — turn answer text into text + validated handles
//   resolveNoteCitation() — decide whether a note citation may navigate
//
// ⛔ THIS REPLACES THE DOUBLE-QUOTE REGEX. The Wave 2 panel applied
// /"([^"]{3,200})"/g to the ANSWER and made every quoted span a chip, so "is
// this a citation?" was decided by punctuation in model output and "did it
// resolve?" was never asked — jumpToNoteText's return value was discarded.
// A handle here resolves against the packet that was actually sent, or it is
// not a citation at all.
//
// ⛔ VERIFY, DON'T TRUST THE POSITION. A note's ProseMirror positions do not
// survive an edit. The server's fingerprint is a fast path; the GUARANTEE is
// re-reading the text at the destination before navigating. This mirrors
// api/services/journal_two/note_citation_text.py::resolve_note_citation, and
// deliberately mirrors the VERIFY half rather than the hash half: sha256 in
// the browser is async (crypto.subtle), and a click handler that must await a
// digest before it can decide is a worse contract than one that reads the text
// it is about to jump to. An ATOM (a chip, an excerpt, an embed) is the one
// exception: its text is a placeholder look-alikes share, so an atom is
// verified by an identity attr instead (citationAtomIdentity), never by text.
//
// NEVER JUMP TO THE WRONG PASSAGE. A failed precise citation is preferable to
// a confident mis-navigation, so an AMBIGUOUS re-resolution opens the note
// without claiming a passage rather than picking the first occurrence.

export const VALID_EXACT = 'valid_exact'          // text at [from,to] still matches
export const RERESOLVED_EXACT = 'reresolved_exact' // note changed; found uniquely
export const VALID_NOTE_ONLY = 'valid_note_only'  // can open the note, not the passage
export const DEGRADED = 'degraded'                // gone; no passage claim

export const PRECISE_STATES = new Set([VALID_EXACT, RERESOLVED_EXACT])

/**
 * G-064 fix round 1 (Finding F5) — degradation is stated in WORDS, never by
 * colour alone, and it must read the same word whether it is an askCitation
 * chip inside a note or a Sources row inside the live AskPanel. This was
 * defined twice (AskCitationView.jsx's own copy, and an inline ternary in
 * AskPanel.jsx) — the second-authority-over-one-value shape this repo keeps
 * paying for. ONE export, both surfaces read it.
 */
export const PRECISION_WORDS = Object.freeze({
  page_only: 'page only', note_only: 'note only', record_only: 'record', unavailable: 'unavailable',
})

/**
 * The words for a citation's precision, or `'unavailable'` for anything this
 * map does not own. ⛔ An OWN key only (`Object.hasOwn`): a value that names a
 * prototype member (`'constructor'`, `'toString'`) would otherwise look up a
 * truthy FUNCTION and render it. The one lookup both surfaces call, so the
 * guard exists once.
 */
export function precisionWords(citation) {
  return (Object.hasOwn(PRECISION_WORDS, citation) && PRECISION_WORDS[citation]) || 'unavailable'
}

const BLOCK_SEPARATOR = '\n'
const HANDLE_RE = /\[(\d{1,3})\]/g

/**
 * Split answer text into renderable parts.
 *
 * A handle only becomes a citation if `sources` actually contains that index.
 * An out-of-range [9] stays literal text — the model inventing a source must
 * never look like a source (§23).
 *
 * @returns {Array<{text: string, source?: object}>}
 */
export function splitAnswer(answer, sources) {
  const byIndex = new Map((sources || []).map((s) => [s.n, s]))
  const parts = []
  let last = 0
  let m
  HANDLE_RE.lastIndex = 0
  while ((m = HANDLE_RE.exec(answer || ''))) {
    const source = byIndex.get(Number(m[1]))
    if (!source) continue // an invented handle is not a citation
    if (m.index > last) parts.push({ text: answer.slice(last, m.index) })
    parts.push({ text: m[0], source })
    last = m.index + m[0].length
  }
  if (last < (answer || '').length) parts.push({ text: answer.slice(last) })
  return parts
}

/** Every source the answer actually cited, in first-cited order (§18). */
export function citedSources(answer, sources) {
  const seen = new Set()
  const out = []
  for (const part of splitAnswer(answer, sources)) {
    if (part.source && !seen.has(part.source.n)) {
      seen.add(part.source.n)
      out.push(part.source)
    }
  }
  return out
}

/**
 * What a LEAF node reads as in citation text.
 *
 * ⛔ ONE TABLE IN TWO RUNTIMES: this mirrors `_ATOM_TEXT` in
 * api/services/journal_two/note_citation_text.py, and the two are pinned
 * together through tests/fixtures_pm_citation_text.json, which
 * tools/gen_pm_citation_fixtures.cjs computes by calling THIS function.
 *
 * Passed as textBetween's own `leafText` ARGUMENT, never set as a schema
 * `leafText`: the argument changes citation text and nothing else, while a
 * schema leafText would also change `doc.textContent` and the plain-text
 * clipboard of a selected chip (measured, closeout-parity 2026-09-23).
 */
export function citationLeafText(node) {
  const attrs = node?.attrs || {}
  switch (node?.type?.name) {
    case 'attachmentChip': return `[file: ${attrs.name || 'file'}]`
    case 'documentExcerpt': return '[excerpt]'
    case 'widgetEmbed':
      return typeof attrs.searchText === 'string' && attrs.searchText ? attrs.searchText : '[widget]'
    default: return ''
  }
}

const nonEmpty = (v) => (typeof v === 'string' && v ? v : null)

/**
 * An atom's identity attr, or null when it carries none.
 *
 * ⛔ AN ATOM IS CITED BY IDENTITY, NEVER BY ITS PLACEHOLDER (review-parity N1).
 * Every excerpt reads "[excerpt]" and two chips of one file read alike, so no
 * text can say WHICH atom a citation meant — after one delete, a text match
 * lands on a look-alike. These attrs survive edits and saves:
 *   documentExcerpt  excerptId            the immutable j2_note_excerpts row
 *   attachmentChip   href                 the upload URL, minted with a uuid4
 *   widgetEmbed      widgetId|capturedAt  the kind, and the instant it was
 *                                         captured (stamped once per node build)
 * ⛔ SURVIVING IS NOT NAMING ONE ATOM (rereview2 R2-1). Every chart of one /mtf
 * or /compare insert is built in the same millisecond and shares its stamp,
 * and a copy/paste duplicates any of these attrs. So the SERVER issues
 * `location.atom` only when exactly one atom of the note carries it at issue
 * time (note_citation_text.py::atom_at); otherwise the citation carries none
 * and opens the note only. A copy made AFTER issue shares the identity:
 * resolveNoteCitation then finds it twice and opens the note only — unless
 * the cited position still holds one of the copies, or the original is
 * deleted and only the copy is left, when it opens the copy.
 * Mirrors `_ATOM_IDENTITY` in api/services/journal_two/note_citation_text.py;
 * the two are pinned together through tests/fixtures_pm_citation_text.json,
 * which tools/gen_pm_citation_fixtures.cjs computes by calling THIS function.
 */
export function citationAtomIdentity(node) {
  const attrs = node?.attrs || {}
  switch (node?.type?.name) {
    case 'documentExcerpt': return nonEmpty(attrs.excerptId)
    case 'attachmentChip': return nonEmpty(attrs.href)
    case 'widgetEmbed': {
      const kind = nonEmpty(attrs.widgetId)
      const at = nonEmpty(attrs.capturedAt)
      return kind && at ? `${kind}|${at}` : null
    }
    default: return null
  }
}

/**
 * Canonical citation text for a live ProseMirror doc.
 *
 * `textBetween(from, to, '\n', citationLeafText)` is the same contract the
 * Python side flattens to: marks contribute nothing, and every textblock (an
 * EMPTY one included) and every block leaf that reads as text is preceded by
 * a newline, except the first such node. Keeping the two in one shape is what
 * lets a server-computed range mean anything here.
 */
export function citationText(doc, from, to) {
  if (!doc || typeof doc.textBetween !== 'function') return ''
  const size = doc.content?.size ?? 0
  if (from == null || to == null || from < 0 || to > size || to < from) return ''
  try {
    return doc.textBetween(from, to, BLOCK_SEPARATOR, citationLeafText)
  } catch {
    return ''
  }
}

/**
 * Is a verified citation range exactly one BLOCK atom (a chip, an excerpt, an
 * embed)? Such a range must be selected as a NodeSelection: a TextSelection
 * cannot sit around a block leaf (measured: ProseMirror warns "TextSelection
 * endpoint not pointing into a node with inline content" and selects nothing
 * a member can see). A range outside the doc answers false: `nodeAt` throws a
 * RangeError there, and a yes/no helper must not.
 */
export function isBlockAtomRange(doc, from, to) {
  if (typeof doc?.nodeAt !== 'function') return false
  const size = doc.content?.size ?? 0
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > size || from >= to) return false
  const node = doc.nodeAt(from)
  return Boolean(node && node.isAtom && node.isBlock && from + node.nodeSize === to)
}

// A text-verified range that turns out to be ONE atom proves only that some
// atom reads like the cited one — never that it IS the cited one.
const NO_IDENTITY = Object.freeze({
  state: VALID_NOTE_ONLY, reason: 'an atom is cited by identity, and this citation carries none',
})

/**
 * Resolve a citation to ONE atom by its identity (`loc.atom = {type, id}`,
 * set by the server for a single-atom passage whose identity no other atom of
 * the note carried at issue). Placeholder text is never consulted: it is
 * exactly what cannot tell two atoms apart.
 *   the atom at [from,to) carries that identity -> VALID_EXACT, in place
 *   exactly one atom elsewhere carries it       -> RERESOLVED_EXACT, there
 *   none, or several                            -> VALID_NOTE_ONLY
 * Mirrors step 0 of note_citation_text.py::resolve_note_citation.
 */
function resolveAtomCitation(doc, loc, atom) {
  const matches = (node) => Boolean(node) && node.type?.name === atom.type
    && citationAtomIdentity(node) === atom.id
  const from = loc?.from
  const to = loc?.to
  if (isBlockAtomRange(doc, from, to) && matches(doc.nodeAt(from))) {
    return { state: VALID_EXACT, from, to }
  }
  const found = []
  doc.descendants((node, pos) => {
    if (node.isAtom && matches(node)) found.push({ from: pos, to: pos + node.nodeSize })
    return true
  })
  if (found.length === 1) return { state: RERESOLVED_EXACT, ...found[0] }
  return found.length > 1
    ? { state: VALID_NOTE_ONLY, ambiguous: true, reason: 'several atoms carry this identity' }
    : { state: VALID_NOTE_ONLY, reason: 'the cited atom is no longer in this note' }
}

/**
 * Decide whether a note citation may navigate, and to where.
 *
 * @param {object} doc  the LIVE ProseMirror doc (unsaved edits included — it is
 *                      where the member would actually land)
 * @param {object} loc  {from, to} from the evidence packet, plus
 *                      `atom: {type, id}` when the passage is one atom
 * @param {string} snippet  the text the server cited
 */
export function resolveNoteCitation(doc, loc, snippet) {
  if (!doc) return { state: DEGRADED }
  const atom = loc?.atom
  if (atom && typeof atom.type === 'string' && nonEmpty(atom.id)) {
    return resolveAtomCitation(doc, loc, atom)
  }

  const needle = (snippet || '').trim()
  if (!needle) return { state: DEGRADED }

  const from = loc?.from
  const to = loc?.to
  if (citationText(doc, from, to).trim() === needle) {
    // ⛔ TEXT CANNOT TELL IDENTICAL ATOMS APART. A block atom is ONE position
    // wide and many read the same ("[excerpt]", "[widget]", two chips of one
    // file), so a range verified by TEXT that is one atom may be its sibling
    // — measured after one excerpt of two was deleted before the click. An
    // atom citation that carries no identity (an atom without one, or a
    // citation issued before identities existed) opens the note only.
    if (isBlockAtomRange(doc, from, to)) return NO_IDENTITY
    return { state: VALID_EXACT, from, to }
  }

  // The note changed under the citation. Re-find the passage — but only
  // navigate if it is UNAMBIGUOUS, and never onto an atom: a unique hit on a
  // placeholder may still be a look-alike of an atom that was deleted.
  const full = citationText(doc, 0, doc.content?.size ?? 0)
  const hits = []
  let idx = full.indexOf(needle)
  while (idx !== -1 && hits.length < 3) {
    hits.push(idx)
    idx = full.indexOf(needle, idx + 1)
  }
  if (hits.length === 1) {
    const range = flatToPmRange(doc, hits[0], hits[0] + needle.length)
    // ⛔ VERIFY BEFORE CLAIMING, even though the walker now IS textBetween.
    // This guard was added (G-064 fix round 1, Finding 4) when an empty
    // paragraph made the old look-alike walker land on the WRONG text
    // (measured: "Second." mapped to a range reading "econd.\n"). That cause
    // is fixed -- flatToPmRange now counts separators with textBetween's own
    // predicate (closeout-parity 2026-09-23) -- but the guard stays. It
    // proves the TEXT, never which of two identical nodes holds it; that is
    // why a hit that is one atom is refused here as it is in place above.
    // NEVER jump to the wrong passage -- the file's own contract -- so re-read
    // the text at the computed range and refuse the claim unless it verifies.
    if (range && citationText(doc, range.from, range.to).trim() === needle) {
      if (isBlockAtomRange(doc, range.from, range.to)) return NO_IDENTITY
      return { state: RERESOLVED_EXACT, ...range }
    }
    return { state: VALID_NOTE_ONLY }
  }
  // ⛔ Two or more occurrences: choosing the first is a coin flip that LOOKS
  // authoritative. Open the note instead and claim nothing about the passage.
  if (hits.length > 1) return { state: VALID_NOTE_ONLY, ambiguous: true }
  return { state: DEGRADED }
}

/**
 * Map a flat-text offset range onto ProseMirror positions.
 *
 * ⛔ THE FLAT STRING IS `citationText(doc, 0, size)`, so this walks the doc
 * with prosemirror-model's own Fragment.textBetween predicate, verbatim —
 *   if (node.isBlock && (node.isLeaf && nodeText || node.isTextblock)) sep
 * — rather than a look-alike. The look-alike this replaces set one pending
 * separator per run of blocks, so every EMPTY textblock above a passage
 * (textBetween emits a separator for each) shifted the mapped range left by
 * one; the resolver's verify guard caught it and the citation degraded.
 *
 * `from` is half-open [start, end) and `to` is (start, end] — the Python
 * `pm_range` convention. A flat offset on the boundary between two runs
 * resolves `from` to the NEXT run: an inline atom (askCitation) reads as zero
 * characters yet occupies a position, so runs adjacent in flat text are not
 * adjacent in ProseMirror. A leaf is ONE position however long it reads.
 */
export function flatToPmRange(doc, flatStart, flatEnd) {
  if (!doc || typeof doc.nodesBetween !== 'function') return null
  const size = doc.content?.size ?? 0
  let flat = 0
  let first = true
  let from = null
  let to = null

  doc.nodesBetween(0, size, (node, pos) => {
    const text = node.isText ? node.text : node.isLeaf ? citationLeafText(node) : ''
    if (node.isBlock && ((node.isLeaf && text) || node.isTextblock)) {
      if (first) first = false
      else flat += BLOCK_SEPARATOR.length
    }
    if (!text) return true
    const start = flat
    const end = flat + text.length
    if (from === null && flatStart >= start && flatStart < end) {
      from = node.isText ? pos + (flatStart - start) : pos
    }
    if (to === null && flatEnd > start && flatEnd <= end) {
      to = node.isText ? pos + (flatEnd - start) : pos + node.nodeSize
    }
    flat = end
    return true
  })
  if (from === null || to === null || to <= from) return null
  return { from, to }
}
