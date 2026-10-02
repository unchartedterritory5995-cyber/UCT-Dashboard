/**
 * Wave 10 (lane TY7, "whose caller" perf pass).
 *
 * TipTap's `editor.isActive(nodeType, attrs)` (for a NODE type, not a mark)
 * always calls `state.doc.nodesBetween(from, to, callback)` -- `@tiptap/core`'s
 * own `isNodeActive` helper, read directly from the installed package (not
 * assumed): https://github.com/ueberdosis/tiptap `packages/core/src/helpers/isNodeActive.ts`.
 * `Fragment.prototype.nodesBetween` (prosemirror-model) iterates its children
 * from index 0 up to wherever `to` lands --
 * `for (let i = 0, pos = 0; pos < to; i++) ...` -- REGARDLESS of `from`. So
 * resolving a position near the END of a flat, 2,000-top-level-paragraph note
 * costs O(preceding siblings), every time, for EVERY node-type check.
 * `readToolbarFormatState` (NoteEditorPage.jsx) makes 6 of these every
 * keystroke (heading x2, bulletList, orderedList, blockquote, codeBlock) --
 * confirmed the #2 size-scaling caller in a CPU-profile call-tree walk
 * (docs/notebook/perf-runs/ty7/ty7-caller-table.json,
 * `isNodeActive@askInsert:12893`, +0.418 ms/key at 2,000 paragraphs, ahead of
 * every prosemirror-model function it calls into).
 *
 * `editor.can().toggleBlockquote()` (the G-131 `canBlockquote` probe) is the
 * SAME shape through a different door: it dry-runs `wrapIn`, whose
 * `findWrapping` asks the PARENT's `canReplaceWith`, which needs
 * `contentMatchAt(index)` -- walking the parent's PRECEDING children to build
 * the content-match state. For a top-level paragraph near the end of a flat
 * 2,000-paragraph doc, the parent IS the doc, so this is the same O(index)
 * cost one level up (`findWrappingOutside` + `canReplaceWith` in the same
 * table, +0.213 ms/key combined).
 *
 * Both are TipTap/prosemirror-level machinery, not an unconditionally
 * unfixable framework cost: the EXPENSIVE part (walking from the document's
 * start) exists to answer a question this app already has the answer to for
 * free. `editor.state.selection.$from` is a ResolvedPos -- ProseMirror built
 * it ONCE, walking down from the root, when it applied the transaction -- and
 * it already holds the full ancestor chain. Reading `$from.node(d)` for each
 * depth is an O(1) array index; nothing here asks the document to resolve a
 * position a second time.
 */
import { objectIncludes } from '@tiptap/core'

/**
 * `editor.isActive(typeOrName, attrs)`'s own EMPTY-selection branch asks
 * exactly one question: does ANY node CONTAINING the cursor match
 * `typeOrName` + `attrs`? That is precisely `$from`'s own ancestor chain,
 * depth down to 1 (never 0 -- the doc node itself is never a "node containing
 * the cursor" in `isNodeActive`'s own traversal, which visits the doc's
 * CHILDREN, never the doc). `fastToolbarProbes.equivalence.test.js` proves
 * this against the REAL `editor.isActive` over a real editor, not asserted
 * from reading the library alone.
 *
 * Falls back to the real `editor.isActive(...)` whenever the fast path cannot
 * answer safely: a non-empty selection (continuous typing never produces
 * one -- see `toolbarStateReducer`'s own header comment in NoteEditorPage.jsx),
 * or an `editor` that does not expose a resolved `$from` (a test double, for
 * instance) -- so this is a strict performance optimization with no
 * behavioural surface of its own; a caller that cannot use the fast path sees
 * exactly what it saw before this file existed.
 */
export function nodeActiveAtCursor(editor, typeOrName, attributes = {}) {
  const selection = editor?.state?.selection
  const $from = selection?.$from
  if (!selection || !$from || typeof $from.node !== 'function' || !selection.empty) {
    return editor.isActive(typeOrName, attributes)
  }
  for (let d = $from.depth; d >= 1; d -= 1) {
    const node = $from.node(d)
    if (node.type.name === typeOrName && objectIncludes(node.attrs, attributes, { strict: false })) return true
  }
  return false
}

/**
 * A cheap, O(depth) stand-in for "has the local block context changed since
 * last time", so `canBlockquoteFast` below can skip re-running
 * `editor.can().toggleBlockquote()` -- O(doc size), per the header comment --
 * on a keystroke that cannot have changed the answer. Depth + each ancestor's
 * TYPE NAME (never attrs -- `findWrapping`'s schema-level answer does not
 * depend on an ancestor's attrs, only its node type and position among
 * siblings, and plain typing never changes a node's index among its own
 * siblings or any ancestor's type).
 */
function blockContextSignature($from) {
  let sig = String($from.depth)
  for (let d = 1; d <= $from.depth; d += 1) sig += `|${$from.node(d).type.name}`
  return sig
}

// editor instance -> { sig, value }. Keyed on the EDITOR INSTANCE, never a
// module-global single slot: each note gets its own editor (NoteEditorPage
// recreates it per `note?.id`), so a cache hit can never answer for the wrong
// note, and the WeakMap entry is dropped automatically once that editor is
// garbage collected after `destroy()` -- no explicit cleanup needed.
const canBlockquoteCache = new WeakMap()

/**
 * `canRunHistory(editor, 'toggleBlockquote')`, memoized on the cheap
 * structural signature above. Recomputes the real (expensive) answer only
 * when the signature changed since the last call for THIS editor -- which,
 * for continuous typing inside one paragraph (the common case the 16 ms/char
 * budget measures), is never: the ancestor chain's types and depth are
 * unchanged by typing more characters into the same block.
 *
 * `canRunHistory` is passed in rather than imported, to avoid a circular
 * import (it is defined in NoteEditorPage.jsx, which imports this file).
 *
 * Falls back to the direct, uncached `canRunHistory` call whenever `$from` is
 * unavailable (same test-double case as `nodeActiveAtCursor` above) --
 * `canRunHistory` already handles a destroyed/non-editable editor safely, so
 * this adds no new failure mode, only a cache in front of it.
 */
export function canBlockquoteFast(editor, canRunHistory) {
  const $from = editor?.state?.selection?.$from
  if (!$from || typeof $from.node !== 'function') return canRunHistory(editor, 'toggleBlockquote')
  const sig = blockContextSignature($from)
  const cached = canBlockquoteCache.get(editor)
  if (cached && cached.sig === sig) return cached.value
  const value = canRunHistory(editor, 'toggleBlockquote')
  canBlockquoteCache.set(editor, { sig, value })
  return value
}

// Exported for the cache-behaviour unit test only (never for app call sites --
// everything a caller needs goes through `canBlockquoteFast`).
export const __test__ = { blockContextSignature, canBlockquoteCache }
