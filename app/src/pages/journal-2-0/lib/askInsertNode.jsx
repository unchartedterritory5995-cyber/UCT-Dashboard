import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform'
import { isHistoryTransaction } from '@tiptap/pm/history'
import AskInsertView from '../components/notebook/AskInsertView'

/**
 * G-064 fix round 1 (Finding F2, controller ruling) — the nearest askInsert
 * ancestor of a resolved position, identified by `$pos.before(d)` (the
 * position immediately before that ancestor node), or `null` when `$pos` is
 * not inside any askInsert.
 */
function nearestAskInsertBefore($pos) {
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type.name === 'askInsert') return $pos.before(d)
  }
  return null
}

/**
 * The ranges a step DELETES, in the doc it was applied to. `ReplaceAroundStep`
 * (lift/unwrap) removes the two segments OUTSIDE its gap, never the gap
 * itself — that is what makes it catch a lift: one segment's `from` sits
 * outside the block and its `to` sits inside it.
 */
function deletedRangesOf(step) {
  if (step instanceof ReplaceAroundStep) return [[step.from, step.gapFrom], [step.gapTo, step.to]]
  if (step instanceof ReplaceStep) return [[step.from, step.to]]
  return []
}

/**
 * G-064 — an inserted Ask Notebook answer (spec §4.1).
 *
 * `isolating` is P1's mechanism: Backspace at the start and Delete at the end
 * never merge the body out of the block, and `content: 'block+'` keeps the
 * wrapper when every paragraph is deleted. Removing the block is an ordinary
 * node delete; there is no unwrap command.
 *
 * ⛔ G-064 fix round 1 (Finding F2, controller ruling) — `isolating` alone
 * does NOT stop an explicit multi-position SELECTION spanning the block edge:
 * measured, selecting from inside a member paragraph into the answer (or the
 * reverse) and deleting or typing over it moves prose across the wrapper in
 * both directions (reproduced by askInsertNodes.test.js, "a selection cannot
 * delete across the block edge", cases a-c). `filterTransaction` below is the
 * backstop: it rejects any step whose DELETED range crosses from outside an
 * askInsert to inside one (or vice versa), while leaving whole-block deletes,
 * in-block edits, select-all, and a plain append at the doc end untouched —
 * none of those steps have a deleted range with one endpoint on each side.
 *
 * G-064 final fix wave (I4) — a PARTIAL copy from inside an answer pastes as
 * plain content, while the WHOLE block keeps its wrapper and its provenance.
 * That is not done here: askInsert is one of the three `defining` containers
 * `pasteContainers.js` normalises on copy and on paste (the rule, the reason
 * and the rails live there), so this node carries no paste hook of its own.
 *
 * ⚠️ Never remove this extension from buildExtensions(): TipTap drops unknown
 * node types at parse time, so unregistering it would delete every inserted
 * answer from every note the next time one opens.
 */
export const AskInsert = Node.create({
  name: 'askInsert',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  draggable: false,

  addAttributes() {
    return {
      insertedAt: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-inserted-at'),
        renderHTML: (a) => (a.insertedAt ? { 'data-inserted-at': a.insertedAt } : {}),
      },
      scope: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-scope'),
        renderHTML: (a) => (a.scope ? { 'data-scope': a.scope } : {}),
      },
      question: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-question') || '',
        renderHTML: (a) => (a.question ? { 'data-question': a.question } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ask-insert"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ask-insert' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AskInsertView)
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction(tr) {
        // G-064 fix round 2 (R2-1) — undo/redo only ever move the doc between
        // states THIS filter already accepted going forward, so replaying one
        // can never introduce a new cross-block deletion; rejecting it instead
        // discards the transaction while `undo()` still reports success,
        // permanently stranding every earlier entry on the history stack.
        if (isHistoryTransaction(tr)) return true
        if (!tr.docChanged) return true
        for (let i = 0; i < tr.steps.length; i += 1) {
          const doc = tr.docs[i]
          for (const [from, to] of deletedRangesOf(tr.steps[i])) {
            if (from === to) continue
            const startAncestor = nearestAskInsertBefore(doc.resolve(from))
            const endAncestor = nearestAskInsertBefore(doc.resolve(to))
            if (startAncestor !== endAncestor) return false
          }
        }
        return true
      },
    })]
  },
})
