/**
 * Wave 10 (TY, standard 4 -- typing budget): a cheap, transaction-scoped
 * question -- "could THIS transaction have inserted a node of type `name`?" --
 * for the handful of ProseMirror plugins in this editor that used to answer a
 * relative of it ("does the doc hold one yet") by re-walking the WHOLE
 * document on every keystroke (`codeBlockNode.js`'s highlighter-load gate,
 * `askCitationNode.jsx`'s staleness decorations). Both extensions run
 * unconditionally on every note built from `buildExtensions()`, so that walk
 * used to cost something on every keystroke of every note, whether or not it
 * had ever held the node in question.
 *
 * Proportional to what THIS transaction inserted, never to the document: a
 * paste is the one case this can cost more than O(1) to check, and that is a
 * one-off (the paste itself), never a per-keystroke cost.
 *
 * Sound, not a heuristic: every step that can add a node carries it directly
 * in its own `slice` -- ProseMirror has no other way to create one.
 * `Transform.setNodeMarkup` (what `toggleCodeBlock`/its "```" input rule, and
 * any other "change this block's type" command, use under the hood) puts the
 * NEW node itself in the slice even though the OLD content it wraps rides the
 * step's gap (a `ReplaceAroundStep`), never the slice -- so a bare, childless
 * node of the target type in the slice is exactly the signal this needs, and
 * `fragmentHasNodeType` finds it however deep a paste nested it.
 */

/** Does `fragment` -- a step's inserted slice, or a node's own content -- hold a
 *  `name` node anywhere, however deeply nested? */
export function fragmentHasNodeType(fragment, name) {
  let found = false
  fragment.forEach((node) => {
    if (found) return
    if (node.type.name === name) { found = true; return }
    if (node.content && node.content.childCount && fragmentHasNodeType(node.content, name)) found = true
  })
  return found
}

/** Could `tr` have inserted a `name` node, anywhere? */
export function stepsIntroduceNodeType(tr, name) {
  return tr.steps.some((step) => step.slice && step.slice.content.childCount
    && fragmentHasNodeType(step.slice.content, name))
}
