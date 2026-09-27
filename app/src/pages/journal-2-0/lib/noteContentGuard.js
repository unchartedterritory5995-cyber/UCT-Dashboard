/**
 * ⛔⛔ AN EDITOR NEVER BLANKS A NOTE IT CANNOT READ — the ONE guard every editor
 * built from `buildExtensions()` shares (S1 / H14, wave 5 final round).
 *
 * TipTap reads a document whole or not at all. One node or mark type the schema
 * lacks — a type a NEWER bundle wrote — and `createNodeFromContent` catches the
 * `nodeFromJSON` error and hands back an EMPTY document. Left alone, that editor
 * shows "Start writing…", and its next save writes the empty document over the
 * note. This module turns that into a LOCKED editor that says why:
 *
 *   - `noteContentGuardOptions()` — spread into every `useEditor` call. It sets
 *     `enableContentCheck: true`, and its `onContentError` locks the editor when
 *     (and only when) the schema cannot BUILD the loaded document — exactly the
 *     case TipTap would blank. A document that builds but is structurally loose
 *     (a blank note's `{doc, content: []}`) loads as it always has.
 *   - `replaceDocument()` — every whole-document swap after load (a server
 *     refresh, a restore, a conflict reconcile) goes through it, so newer content
 *     arriving mid-session locks the editor instead of blanking it.
 *   - `isUnreadable()` / `useUnreadableNote()` — what every write path asks
 *     before it saves, persists, queues or drafts anything.
 *
 * ⛔ LOCKING NEVER GOES THROUGH `editor.setEditable()`: that emits an `update`,
 * and `onUpdate` is every editor's autosave — the lock would schedule the very
 * write it exists to stop.
 *
 * The server half (the write refused even from a bundle that predates this
 * file) is `api/services/journal_two/notebook_schema.py`.
 */
import { useLayoutEffect, useSyncExternalStore } from 'react'
import { SCHEMA_REFUSAL_DETAIL } from './notebookSchema'

/**
 * ⛔ N2 (wave 5 final review): ONE sentence, derived — the locked editor says
 * exactly what the server's refusal says (`notebook_schema.py::REFUSAL_DETAIL`,
 * pinned equal to `SCHEMA_REFUSAL_DETAIL` by tests/test_notebook_schema_guard.py).
 * It was a second hand-typed copy here, and nothing held the two together.
 */
export const UNREADABLE_NOTE_MESSAGE = SCHEMA_REFUSAL_DETAIL

/**
 * ⛔⛔ WAVE 10 (lane 10C) — A NOTE THAT IS MERELY MALFORMED IS NOT "NEWER".
 * The lock fires whenever the schema cannot BUILD the stored body, and two very
 * different bodies do that: one holding a TYPE this bundle does not know (a newer
 * bundle wrote it — reloading may fix it), and one whose every type is known but
 * which is malformed (an empty text node, the wave-5 walk's case — reloading
 * fixes nothing). The notice said "newer version of the app" for both, which sent
 * a member with a damaged note to reload forever. The server now refuses such a
 * body at the door (notes._body_build_problem); this is the sentence for the
 * ones already stored.
 */
export const MALFORMED_NOTE_MESSAGE =
  "Part of this note is stored in a form the editor can't open, so it is read-only to keep it safe. Nothing in it has been changed."

/** Why a lock fired: a type this bundle does not know, or a body that is malformed. */
export const UNREADABLE_NEWER = 'newer'
export const UNREADABLE_MALFORMED = 'malformed'

const unreadable = new WeakMap()   // editor -> reason
const lockedLive = new Set()       // editors currently locked (pruned when destroyed)
const listeners = new Set()
let version = 0

/** Can `schema` build `content`? Only a JSON document can be unreadable. */
export function canReadDocument(schema, content) {
  if (!schema || !content || typeof content !== 'object') return true
  try {
    if (Array.isArray(content)) content.forEach((node) => schema.nodeFromJSON(node))
    else schema.nodeFromJSON(content)
    return true
  } catch {
    return false
  }
}

/**
 * WHY `schema` cannot build `content`: `UNREADABLE_NEWER` when any node or mark
 * TYPE in it is one the schema does not register, else `UNREADABLE_MALFORMED`.
 * ⛔ Only meaningful once `canReadDocument` has answered false. Iterative — a
 * stored body can be nested deeper than a recursive walk survives.
 */
export function unreadableReason(schema, content) {
  const knownNode = (t) => Boolean(schema?.nodes?.[t])
  const knownMark = (t) => Boolean(schema?.marks?.[t])
  const stack = Array.isArray(content) ? [...content] : [content]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (typeof node.type === 'string' && node.type && !knownNode(node.type)) return UNREADABLE_NEWER
    if (Array.isArray(node.marks)) {
      for (const m of node.marks) {
        if (m && typeof m.type === 'string' && m.type && !knownMark(m.type)) return UNREADABLE_NEWER
      }
    }
    if (Array.isArray(node.content)) stack.push(...node.content)
  }
  return UNREADABLE_MALFORMED
}

export function isUnreadable(editor) {
  return Boolean(editor) && unreadable.has(editor)
}

/** The reason `editor` was locked, or null when it is not locked. */
export function unreadableReasonOf(editor) {
  return (editor && unreadable.get(editor)) || null
}

/** The sentence for a lock `reason`. An unknown reason reads as the newer-version one. */
export function unreadableMessageFor(reason) {
  return reason === UNREADABLE_MALFORMED ? MALFORMED_NOTE_MESSAGE : UNREADABLE_NOTE_MESSAGE
}

/**
 * The reason every LIVE locked editor agrees on, or null when there is none or
 * they disagree. What a notice rendered WITHOUT its editor falls back to — exact
 * on a page with one locked editor, and the newer-version sentence (the pre-wave-10
 * behaviour) whenever it cannot be sure.
 */
export function unanimousUnreadableReason() {
  const reasons = new Set()
  for (const ed of [...lockedLive]) {
    if (!ed || ed.isDestroyed) { lockedLive.delete(ed); continue }
    reasons.add(unreadable.get(ed))
  }
  return reasons.size === 1 ? [...reasons][0] : null
}

/** Lock `editor`: read-only, and every write path's `isUnreadable` answers true. */
export function markUnreadable(editor, reason = UNREADABLE_NEWER) {
  if (!editor || unreadable.has(editor)) return
  unreadable.set(editor, reason === UNREADABLE_MALFORMED ? UNREADABLE_MALFORMED : UNREADABLE_NEWER)
  lockedLive.add(editor)
  // setOptions, NOT setEditable — see the header. Safe inside the constructor:
  // setOptions returns early until the view exists, and the editable plugin
  // reads `options.editable` live.
  editor.setOptions({ editable: false })
  version += 1
  listeners.forEach((fn) => { try { fn() } catch { /* a listener is not the lock */ } })
}

/** The options every editor built from `buildExtensions()` spreads in. */
export function noteContentGuardOptions() {
  return {
    enableContentCheck: true,
    onContentError: ({ editor }) => {
      // Fires for the initial document AND for a later insert that fails the
      // check. Only an initial document the schema cannot BUILD is the blanking
      // case; a failed insert simply does not insert (TipTap returns false).
      const content = editor.options.content
      if (!canReadDocument(editor.schema, content)) {
        markUnreadable(editor, unreadableReason(editor.schema, content))
      }
    },
  }
}

/**
 * The transaction meta every `replaceDocument` swap carries: "this is the note's
 * STORED body arriving (a Restore, a server refresh, an adopted recovery), not
 * the member editing". A guard that exists to stop the member building something
 * (ColumnsGuard's nesting rule) lets a swap through, so a stored body is shown as
 * stored -- the same principle as a note that LOADS that way (wave 6 M7).
 */
export const WHOLE_DOCUMENT_SWAP_META = 'uctWholeDocumentSwap'

/**
 * Replace the whole document, or lock the editor when `json` cannot be read.
 * Returns true when the document was replaced. `errorOnInvalidContent: false`
 * keeps the pre-guard tolerance for a document that builds but is loose — a
 * blank note is `{doc, content: []}`, which ProseMirror's check calls invalid.
 *
 * ⛔ TRUE MEANS THE PAGE MOVED (wave 7, M-4). `setContent` answers true once it
 * has DISPATCHED, and a `filterTransaction` that refuses the transaction leaves
 * the state exactly as it was -- so a refused swap used to answer true over an
 * unchanged page, and every caller that trusts the answer (a Restore resets its
 * carried read, an adoption saves "the adopted words" from the editor) acted on
 * words that were never on screen. A swap that replaces the document always
 * builds a NEW doc node (the replace step exists even for identical words; a
 * doc is never empty), so an unchanged doc object after the dispatch IS a
 * refusal.
 */
export function replaceDocument(editor, json, options) {
  if (!editor || editor.isDestroyed) return false
  if (!canReadDocument(editor.schema, json)) {
    markUnreadable(editor, unreadableReason(editor.schema, json))
    return false
  }
  const before = editor.state.doc
  const ran = editor.chain()
    .command(({ tr }) => { tr.setMeta(WHOLE_DOCUMENT_SWAP_META, true); return true })
    .setContent(json, { ...(options || {}), errorOnInvalidContent: false })
    .run()
  return Boolean(ran) && editor.state.doc !== before
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * True once `editor` is locked, and re-renders the caller when it becomes so
 * (a lock can land mid-session, through `replaceDocument`). Also re-asserts the
 * lock every render: `useEditor` re-applies its options on a re-mount, and an
 * explicit `editable` there would otherwise switch it back on.
 */
export function useUnreadableNote(editor) {
  useSyncExternalStore(subscribe, () => version, () => version)
  const locked = isUnreadable(editor)
  useLayoutEffect(() => {
    if (locked && !editor.isDestroyed && editor.options?.editable) editor.setOptions({ editable: false })
  })
  return locked
}
