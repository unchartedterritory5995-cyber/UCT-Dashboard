/**
 * Wave 10 (lane TY2, standard 4 -- "typing < 16 ms/char up to 2,000 paragraphs").
 *
 * A memoized drop-in for `Node.prototype.toJSON()` -- what `editor.getJSON()`
 * calls (`@tiptap/core`'s `Editor.getJSON()` is `this.state.doc.toJSON()`) --
 * used ONLY by the local-draft snapshot path (`captureLocalState`,
 * NoteEditorPage.jsx). `perf-budgets.md`'s "Typing (clause 4d)" section named
 * this the one cost lane 10A/L12 did NOT touch: "`captureLocalState` takes
 * `getJSON()` of the whole note and writes it to localStorage on EVERY
 * keystroke, by the Wave Q1 durability design -- 'ONE snapshot per keystroke'".
 *
 * ⛔⛔ WHY THIS IS SAFE TO CACHE. ProseMirror nodes are immutable and
 * STRUCTURALLY SHARED: a keystroke at the end of a 2,000-paragraph note
 * replaces only the node objects on the path from the changed leaf to the doc
 * root -- every sibling paragraph keeps the exact same object reference it
 * had before the keystroke. This is not an assumption; it is the guarantee
 * ProseMirror's OWN diffing relies on (`findDiffStart`/`findDiffEnd` in
 * prosemirror-model compare children with `childA == childB`). `Node.
 * prototype.toJSON()` does not exploit this -- it re-walks every node on
 * every call, so `editor.getJSON()` costs O(document size) on every
 * keystroke even though 1,999 of 2,000 paragraphs did not change (attributed
 * at ~1.5-1.7 ms of the ~14-16 ms/key typing cost at 2,000 paragraphs,
 * `docs/notebook/perf-runs/ty2/`).
 *
 * This produces BYTE-IDENTICAL output to `node.toJSON()` for every node type
 * `buildExtensions()` registers -- same shape, same key order (`type`, then
 * `attrs`, `content`, `marks`, `text`, each added only when the native
 * version would add it), same `attrs`/`marks[].attrs` REFERENCE-not-copy
 * aliasing (`obj.attrs = node.attrs`, exactly what `Node.prototype.toJSON()`
 * does) -- proven by `memoDocJSON.test.js`'s differential equivalence suite
 * against a real editor's schema, run against a document built from every
 * node type in `buildExtensions()`'s roster. It changes WHEN the work
 * happens (skip an already-serialized, unchanged subtree), never WHAT is
 * produced -- and it never reduces what is captured or how often: every
 * keystroke still gets a complete, correct snapshot, still synchronous,
 * still written to localStorage the same way.
 *
 * The cache is a WeakMap keyed on the NODE OBJECT itself. Nothing here is
 * ever explicitly cleared or bounded: once no document holds a reference to
 * an old node (the note was edited past it, the note was closed, the editor
 * was destroyed), the entry is ordinary garbage. A fresh editor's nodes are
 * fresh objects, so there is no cross-note or cross-session collision risk
 * in sharing one cache across every call site that wants one.
 *
 * ⛔ MUST STAY IN LOCKSTEP WITH `Node.prototype.toJSON()` / `TextNode.
 * prototype.toJSON()` / `Mark.prototype.toJSON()` (prosemirror-model). No
 * node or mark type in this app's schema overrides `toJSON` today (grepped,
 * wave 10 lane TY2: the only hits for `toJSON` under `journal-2-0/lib` and
 * `journal-2-0/components/notebook` are ordinary USES of the method, never a
 * definition) -- if one ever does, this cache would silently diverge from
 * `editor.getJSON()` for that node, and marks are therefore NOT reimplemented
 * here at all: `node.marks.map((m) => m.toJSON())` calls the real method
 * directly, since marks are few and shallow per node and there is no
 * memoization win to buy with the extra reimplementation risk.
 * `memoDocJSON.test.js`'s equivalence check is the rail that would catch a
 * future divergence in the node/fragment shape.
 */
export function createMemoDocJSON() {
  const cache = new WeakMap()
  function toJSON(node) {
    const hit = cache.get(node)
    if (hit !== undefined) return hit
    const obj = { type: node.type.name }
    // Mirrors `Node.prototype.toJSON()`'s own `for (let _ in this.attrs) {
    // obj.attrs = this.attrs; break }` -- an ENUMERABLE-KEY presence test,
    // not `Object.keys(...).length` or a truthiness check -- and, like the
    // original, assigns the attrs object BY REFERENCE (never a copy).
    // eslint-disable-next-line no-unused-vars
    for (const _k in node.attrs) { obj.attrs = node.attrs; break }
    if (node.content.size) {
      const kids = node.children
      obj.content = kids.length ? kids.map(toJSON) : null
    }
    if (node.marks.length) obj.marks = node.marks.map((m) => m.toJSON())
    if (node.isText) obj.text = node.text
    cache.set(node, obj)
    return obj
  }
  return toJSON
}
