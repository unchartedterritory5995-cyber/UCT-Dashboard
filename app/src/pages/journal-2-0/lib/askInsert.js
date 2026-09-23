/**
 * G-064 — insert an Ask Notebook answer into a note.
 * Spec: docs/superpowers/specs/2026-09-22-ask-notebook-insert-design.md
 *
 * ⛔ EVERY INSERT IS AN EDITOR TRANSACTION (spec §5). A server-side append of a
 * new block type forks any open or offline-queued copy of the note
 * (serverChange.js merges only three types) and skips version history. So a note
 * that is not open is OPENED first, and the answer rides the hand-off below.
 */
import { splitAnswer } from './askCitation'

export const ASK_INSERT_TYPE = 'askInsert'
export const ASK_CITATION_TYPE = 'askCitation'

// ── The claim: ONE normalization, used at insert AND at render (spec §6.4) ──

/** Whitespace runs collapse to one space; the ends are trimmed. */
export function normalizeClaim(texts) {
  return (texts || []).join('').replace(/\s+/g, ' ').trim()
}

/** The claim of a JSON paragraph's content array (insert time). */
export function claimFromJson(content) {
  return normalizeClaim((content || [])
    .filter((n) => n && n.type === 'text' && typeof n.text === 'string')
    .map((n) => n.text))
}

/** The claim of a live ProseMirror textblock (render time). */
export function claimFromBlock(block) {
  const texts = []
  block.forEach((child) => { if (child.isText) texts.push(child.text) })
  return normalizeClaim(texts)
}

// ── Building the node: exactly what the panel showed (spec §3.5, §5.1) ──

/**
 * @returns the `askInsert` JSON node, or null when nothing survives.
 */
export function buildAskInsertNode({
  answer, sources, question = '', scope = null, insertedAt = new Date().toISOString(),
}) {
  const paragraphs = [[]]
  for (const part of splitAnswer(answer || '', sources || [])) {
    if (part.source) {
      const s = part.source
      const nav = s.navigation && typeof s.navigation === 'object' ? { ...s.navigation } : null
      paragraphs[paragraphs.length - 1].push({
        type: ASK_CITATION_TYPE,
        attrs: { n: s.n, label: s.label || '', nav, citation: s.citation || null, claim: '' },
      })
      continue
    }
    part.text.split(/\r?\n/).forEach((line, i) => {
      if (i > 0) paragraphs.push([])
      // ⛔ ProseMirror rejects an empty text node.
      if (line) paragraphs[paragraphs.length - 1].push({ type: 'text', text: line })
    })
  }
  const kept = paragraphs.filter((content) => content.some(
    (n) => n.type === ASK_CITATION_TYPE || (n.type === 'text' && n.text.trim())))
  if (!kept.length) return null
  for (const content of kept) {
    const claim = claimFromJson(content)
    for (const n of content) if (n.type === ASK_CITATION_TYPE) n.attrs.claim = claim
  }
  return {
    type: ASK_INSERT_TYPE,
    attrs: { insertedAt, scope, question: question || '' },
    content: kept.map((content) => ({ type: 'paragraph', content })),
  }
}

// ── The pending hand-off to a note that is not open (spec §5.2) ──
//
// ⭐ The writePendingShare/takePendingShare pattern (shareTarget.js): MEMORY
// carries the in-app route change even where storage is refused;
// sessionStorage carries a full reload. One entry at a time.

export const PENDING_ASK_INSERT_KEY = 'uct.j2.askInsert.pending'
export const PENDING_ASK_INSERT_TTL_MS = 15 * 60 * 1000

let _pending = null

export function writePendingAskInsert(noteId, node, now = Date.now()) {
  const entry = { noteId, node, createdAt: now }
  _pending = entry
  try {
    sessionStorage.setItem(PENDING_ASK_INSERT_KEY, JSON.stringify(entry))
    return true
  } catch {
    // One entry at a time (spec §5.2): a newer write REPLACES the older one.
    // A failed sessionStorage.setItem must not leave a STALE entry sitting in
    // storage while memory has already moved on to a different note — that
    // would let a later reload resurrect an answer that was already replaced.
    // Storage can therefore never hold anything memory has moved past.
    try { sessionStorage.removeItem(PENDING_ASK_INSERT_KEY) } catch { /* refused too */ }
    return false
  }
}

export function clearPendingAskInsert() {
  _pending = null
  try { sessionStorage.removeItem(PENDING_ASK_INSERT_KEY) } catch { /* refused */ }
}

/**
 * The entry for THIS note, removed before it is returned, or null.
 *
 * ⛔ REMOVED FIRST: the caller inserts after this returns, so a StrictMode
 * double effect or a reload can never insert the same answer twice. Another
 * note's entry is LEFT for that note; an expired or malformed one is dropped.
 */
export function takePendingAskInsert(noteId, now = Date.now()) {
  let entry = _pending
  if (!entry) {
    let raw = null
    try { raw = sessionStorage.getItem(PENDING_ASK_INSERT_KEY) } catch { raw = null }
    if (raw) {
      try { entry = JSON.parse(raw) } catch { entry = null }
    }
  }
  if (!entry || typeof entry !== 'object') { clearPendingAskInsert(); return null }
  const age = now - Number(entry.createdAt)
  if (!(age >= 0 && age < PENDING_ASK_INSERT_TTL_MS)) { clearPendingAskInsert(); return null }
  if (entry.noteId !== noteId) return null
  clearPendingAskInsert()
  if (!entry.node || entry.node.type !== ASK_INSERT_TYPE) return null
  return entry
}
