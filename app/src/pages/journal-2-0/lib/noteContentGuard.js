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

export const UNREADABLE_NOTE_MESSAGE = 'This note has content from a newer version of the app. Reload to edit it.'

const unreadable = new WeakSet()
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

export function isUnreadable(editor) {
  return Boolean(editor) && unreadable.has(editor)
}

/** Lock `editor`: read-only, and every write path's `isUnreadable` answers true. */
export function markUnreadable(editor) {
  if (!editor || unreadable.has(editor)) return
  unreadable.add(editor)
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
      if (!canReadDocument(editor.schema, editor.options.content)) markUnreadable(editor)
    },
  }
}

/**
 * Replace the whole document, or lock the editor when `json` cannot be read.
 * Returns true when the document was replaced. `errorOnInvalidContent: false`
 * keeps the pre-guard tolerance for a document that builds but is loose — a
 * blank note is `{doc, content: []}`, which ProseMirror's check calls invalid.
 */
export function replaceDocument(editor, json, options) {
  if (!editor || editor.isDestroyed) return false
  if (!canReadDocument(editor.schema, json)) {
    markUnreadable(editor)
    return false
  }
  return editor.commands.setContent(json, { ...(options || {}), errorOnInvalidContent: false })
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
