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
// it is about to jump to.
//
// NEVER JUMP TO THE WRONG PASSAGE. A failed precise citation is preferable to
// a confident mis-navigation, so an AMBIGUOUS re-resolution opens the note
// without claiming a passage rather than picking the first occurrence.

export const VALID_EXACT = 'valid_exact'          // text at [from,to] still matches
export const RERESOLVED_EXACT = 'reresolved_exact' // note changed; found uniquely
export const VALID_NOTE_ONLY = 'valid_note_only'  // can open the note, not the passage
export const DEGRADED = 'degraded'                // gone; no passage claim

export const PRECISE_STATES = new Set([VALID_EXACT, RERESOLVED_EXACT])

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
 * Canonical citation text for a live ProseMirror doc.
 *
 * `textBetween(from, to, '\n')` is the same contract the Python side flattens
 * to: marks contribute nothing, block boundaries become a newline. Keeping the
 * two in one shape is what lets a server-computed range mean anything here.
 */
export function citationText(doc, from, to) {
  if (!doc || typeof doc.textBetween !== 'function') return ''
  const size = doc.content?.size ?? 0
  if (from == null || to == null || from < 0 || to > size || to < from) return ''
  try {
    return doc.textBetween(from, to, BLOCK_SEPARATOR)
  } catch {
    return ''
  }
}

/**
 * Decide whether a note citation may navigate, and to where.
 *
 * @param {object} doc  the LIVE ProseMirror doc (unsaved edits included — it is
 *                      where the member would actually land)
 * @param {object} loc  {from, to} from the evidence packet
 * @param {string} snippet  the text the server cited
 */
export function resolveNoteCitation(doc, loc, snippet) {
  const needle = (snippet || '').trim()
  if (!doc || !needle) return { state: DEGRADED }

  const from = loc?.from
  const to = loc?.to
  if (citationText(doc, from, to).trim() === needle) {
    return { state: VALID_EXACT, from, to }
  }

  // The note changed under the citation. Re-find the passage — but only
  // navigate if it is UNAMBIGUOUS.
  const full = citationText(doc, 0, doc.content?.size ?? 0)
  const hits = []
  let idx = full.indexOf(needle)
  while (idx !== -1 && hits.length < 3) {
    hits.push(idx)
    idx = full.indexOf(needle, idx + 1)
  }
  if (hits.length === 1) {
    const range = flatToPmRange(doc, hits[0], hits[0] + needle.length)
    if (range) return { state: RERESOLVED_EXACT, ...range }
    return { state: VALID_NOTE_ONLY }
  }
  // ⛔ Two or more occurrences: choosing the first is a coin flip that LOOKS
  // authoritative. Open the note instead and claim nothing about the passage.
  if (hits.length > 1) return { state: VALID_NOTE_ONLY, ambiguous: true }
  return { state: DEGRADED }
}

/**
 * Map a flat-text offset range onto ProseMirror positions by walking the doc
 * exactly as citationText builds the flat string.
 */
export function flatToPmRange(doc, flatStart, flatEnd) {
  if (!doc || typeof doc.descendants !== 'function') return null
  let flat = 0
  let pendingSep = false
  let started = false
  let from = null
  let to = null

  doc.descendants((node, pos) => {
    if (node.isText) {
      if (pendingSep && started !== null && flat > 0) {
        flat += BLOCK_SEPARATOR.length
        pendingSep = false
      }
      const len = node.text.length
      const start = flat
      const end = flat + len
      if (from === null && flatStart >= start && flatStart <= end) {
        from = pos + (flatStart - start)
        started = true
      }
      if (to === null && flatEnd >= start && flatEnd <= end) {
        to = pos + (flatEnd - start)
      }
      flat = end
      return false
    }
    if (node.isBlock && flat > 0) pendingSep = true
    return true
  })
  if (from === null || to === null || to < from) return null
  return { from, to }
}
