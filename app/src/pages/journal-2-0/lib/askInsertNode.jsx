import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
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

const childrenOf = (node) => {
  const out = []
  node.content.forEach((child) => out.push(child))
  return out
}

/**
 * G-064 final fix wave (I4, controller ruling) — strip every askInsert that is
 * OPEN at an edge of a pasted slice, so a PARTIAL copy from inside an answer
 * pastes as plain content, while a CLOSED askInsert (the whole block, copied as
 * a node) keeps its wrapper and its provenance travels with it.
 *
 * Why it is needed: ProseMirror serializes a copy made inside the answer with a
 * `data-pm-slice` context naming the askInsert around it, and the paste
 * rebuilds that wrapper. askInsert is `defining`, so pasting that slice at the
 * START of a member paragraph wrapped the MEMBER'S paragraph in a NEW
 * askInsert: member prose read "From Ask Notebook" and silently dropped out of
 * Ask. The same open wrapper made a paste at the start of a paragraph INSIDE an
 * answer emit a step reaching past the block edge, which the filter below then
 * refused without a word. Reproduced by askInsertNodes.test.js, "pasting answer
 * text never wraps member prose".
 *
 * An open depth counts levels from the slice's top: unwrapping the FIRST node
 * lowers `openStart` by one, and when that node is the ONLY top-level node its
 * end was open too, so `openEnd` drops with it. The end side is symmetrical.
 */
export function unwrapOpenAskInserts(slice) {
  let { openStart, openEnd } = slice
  let nodes = childrenOf(slice.content)
  let changed = false
  while (openStart > 0 && nodes.length && nodes[0].type.name === 'askInsert') {
    const only = nodes.length === 1
    nodes = [...childrenOf(nodes[0]), ...nodes.slice(1)]
    openStart -= 1
    if (only && openEnd > 0) openEnd -= 1
    changed = true
  }
  while (openEnd > 0 && nodes.length && nodes[nodes.length - 1].type.name === 'askInsert') {
    nodes = [...nodes.slice(0, -1), ...childrenOf(nodes[nodes.length - 1])]
    openEnd -= 1
    changed = true
  }
  return changed ? new Slice(Fragment.fromArray(nodes), openStart, openEnd) : slice
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
      // G-064 final fix wave (I4) — see unwrapOpenAskInserts above. Runs for a
      // clipboard paste and for an in-editor drag alike (prosemirror-view
      // applies `transformPasted` to both).
      props: {
        transformPasted: (slice) => unwrapOpenAskInserts(slice),
      },
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
