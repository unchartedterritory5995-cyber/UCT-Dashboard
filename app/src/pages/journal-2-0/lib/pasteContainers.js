import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'

/**
 * Paste/copy normalisation for the Notebook's own three container nodes —
 * askInsert, callout, toggle: the three `defining` CONTAINERS this plugin
 * unwraps. They are not the only `defining` nodes in the roster: blockquote,
 * heading, codeBlock and the list items declare `defining` too (their upstream
 * TipTap extensions), and are deliberately NOT unwrapped -- they keep
 * ProseMirror's own wrap-on-paste behaviour. ONE helper, ONE plugin, both
 * edges, the whole open spine (see unwrapOpenContainers below). The same
 * plugin also owns pastes into a toggle's one-line title (pasteIntoSummary).
 *
 * The rule (G-064's I4 rule, first written for askInsert alone, generalised):
 * a container that is OPEN at an edge of a copied or pasted slice was only
 * partly selected, so its content travels as plain content; a CLOSED container
 * (the whole block, copied as a node or sitting wholly inside a larger
 * selection) keeps its wrapper.
 *
 * Why each container needs it:
 *  - `defining` makes prosemirror-transform's replaceRange rebuild an OPEN
 *    container around the paste target (the "back up preferredDepth to cover
 *    defining textblocks" loop), so a partial callout copy pasted at the start
 *    of a member paragraph wrapped THAT paragraph in a new callout, and a
 *    toggle-summary copy created a new toggle (askInsert's I4 was the same;
 *    inside an answer the same shape was refused by askInsertNode.jsx's
 *    filterTransaction, so the paste was silently lost).
 *  - Toggle's content is `toggleSummary toggleContent`, and neither child is
 *    placeable outside a toggle. When a slice opens a toggle at its start (a
 *    selection beginning inside the summary) the Fitter moves the summary's
 *    text into the target textblock and is left holding a toggle whose content
 *    starts with `toggleContent`; for an open end it then asks that remnant for
 *    `contentMatchAt(childCount)`, which matches from the expression's START,
 *    finds `toggleContent` where `toggleSummary` is required, and throws
 *    "Called contentMatchAt on a node with invalid content" — the paste is lost.
 *    Unwrapping the toggle before the Fitter sees it removes that shape.
 *
 * `transformCopied` keeps the clipboard itself well-formed: a copy that opens a
 * toggle past its summary serialises as `<details>` with no `<summary>`, and
 * prosemirror-view's closeSlice (inside parseFromClipboard, BEFORE any
 * transformPasted runs) throws the same error re-reading it. It also means a
 * partial copy pasted into another app arrives as paragraphs, not a stray
 * `<details>`. `transformPasted` covers what the copy side never saw: foreign
 * HTML (`<details>`/`<aside>` from another page) and a clipboard written by an
 * older bundle. prosemirror-view applies `transformPasted` to in-editor drags
 * too, and a drag's slice comes from serializeForClipboard, so both apply.
 */
export const PASTE_CONTAINERS = new Set(['askInsert', 'callout', 'toggle'])

// The blocks a container stands for once its wrapper is gone, with the open
// depth of the first and last of them. `inner` is the container's content
// AFTER the recursion (so a container nested inside it is already handled).
function spill(node, inner) {
  if (node.type.name !== 'toggle') {
    return { nodes: childrenOf(inner.fragment), head: inner.openStart, tail: inner.openEnd }
  }
  // A toggle's summary is inline content in a node that cannot live outside a
  // toggle: it becomes an ordinary paragraph AT THE SAME DEPTH. Its body's
  // blocks are spliced in place of `toggleContent`, which removes one level.
  const paragraph = node.type.schema.nodes.paragraph
  const nodes = []
  let head = 0
  let tail = 0
  const kids = childrenOf(inner.fragment)
  kids.forEach((kid, i) => {
    const first = i === 0
    const last = i === kids.length - 1
    if (kid.type.name === 'toggleSummary') {
      nodes.push(paragraph.create(null, kid.content))
      if (first) head = inner.openStart
      if (last) tail = inner.openEnd
    } else if (kid.type.name === 'toggleContent') {
      const blocks = childrenOf(kid.content)
      if (blocks.length) {
        if (first) head = Math.max(inner.openStart - 1, 0)
        if (last) tail = Math.max(inner.openEnd - 1, 0)
      }
      // An EMPTY body contributes nothing; whatever precedes it (the summary
      // paragraph) was closed at its end, so `tail` stays 0.
      nodes.push(...blocks)
    } else {
      nodes.push(kid) // not reachable with this schema; kept rather than dropped
    }
  })
  return { nodes, head, tail }
}

function childrenOf(fragment) {
  const out = []
  fragment.forEach((child) => out.push(child))
  return out
}

// `fragment`'s first child is open `openStart` levels deep and its last child
// `openEnd` levels deep (Slice semantics). Returns the rewritten fragment, its
// open depths, and whether anything changed.
function unwrapEdges(fragment, openStart, openEnd) {
  const count = fragment.childCount
  if (!count) return { fragment, openStart: 0, openEnd: 0, changed: false }
  const out = []
  let start = 0
  let end = 0
  let changed = false
  for (let i = 0; i < count; i += 1) {
    const child = fragment.child(i)
    const atStart = i === 0 && openStart > 0
    const atEnd = i === count - 1 && openEnd > 0
    if (!atStart && !atEnd) { out.push(child); continue }
    // Recurse along the open edge(s) first, so a container anywhere on the
    // spine is handled whatever wraps it (askInsert > callout > toggle, or a
    // callout inside a blockquote).
    const inner = unwrapEdges(child.content, atStart ? openStart - 1 : 0, atEnd ? openEnd - 1 : 0)
    if (!PASTE_CONTAINERS.has(child.type.name)) {
      out.push(inner.changed ? child.copy(inner.fragment) : child)
      if (atStart) start = inner.openStart + 1
      if (atEnd) end = inner.openEnd + 1
      changed = changed || inner.changed
      continue
    }
    const { nodes, head, tail } = spill(child, inner)
    changed = true
    // An empty spill hands the edge to the neighbour, which was closed.
    if (atStart) start = nodes.length ? head : 0
    if (atEnd) end = nodes.length ? tail : 0
    out.push(...nodes)
  }
  if (!out.length) return { fragment: Fragment.empty, openStart: 0, openEnd: 0, changed }
  return { fragment: Fragment.fromArray(out), openStart: start, openEnd: end, changed }
}

/**
 * Strip every askInsert / callout / toggle that is OPEN at an edge of `slice`,
 * anywhere down that edge's open spine. Returns the SAME slice object when
 * nothing was open, so an ordinary paste is provably untouched.
 */
export function unwrapOpenContainers(slice) {
  if (!slice || !slice.size || (!slice.openStart && !slice.openEnd)) return slice
  const r = unwrapEdges(slice.content, slice.openStart, slice.openEnd)
  return r.changed ? new Slice(r.fragment, r.openStart, r.openEnd) : slice
}

// True when `slice` merges into the target textblock as inline content: inline
// nodes at the top, or ONE textblock -- alone at every level above it -- that
// is open at both ends (a word copied from a paragraph, a list item, a body).
function mergesInline(slice) {
  let fragment = slice.content
  for (let depth = 0; ; depth += 1) {
    if (depth === slice.openStart && depth === slice.openEnd) {
      let inline = fragment.childCount > 0
      fragment.forEach((node) => { if (!node.isInline) inline = false })
      return inline
    }
    if (depth >= slice.openStart || depth >= slice.openEnd || fragment.childCount !== 1) return false
    fragment = fragment.firstChild.content
  }
}

// Rule 1's content: every textblock's INLINE content, joined with one space
// between blocks. Marks and inline atoms (a note link, a citation chip) travel
// as they are; a hard break, and a newline inside a code block, become a space,
// because a title is one line. An empty block contributes nothing, so a slice
// of nothing but empty lines comes back empty.
function joinedInline(slice, schema) {
  const out = []
  slice.content.forEach((block) => {
    const line = []
    block.forEach((child) => {
      if (child.isText) {
        const text = child.text.replace(/[\r\n]+/g, ' ')
        line.push(text === child.text ? child : schema.text(text, child.marks))
      } else if (child.type === schema.linebreakReplacement || child.type.name === 'hardBreak') {
        line.push(schema.text(' '))
      } else {
        line.push(child)
      }
    })
    if (!line.length) return
    if (out.length) out.push(schema.text(' '))
    out.push(...line)
  })
  return Fragment.fromArray(out)
}

const pasteMeta = (tr) => tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste')

// Rules 2 and 3: the whole slice as blocks at `at` -- a position just outside
// the toggle -- in ONE transaction (one undo step), with the caret left at the
// end of what was inserted. The TITLE IS NEVER TOUCHED, even when the member
// had text selected in it (ruling (b)): the content lands outside the title,
// so deleting a word from it would be a change the member was not looking at.
// The slice is tried CLOSED first (exactly the nodes that were copied, a list
// keeping its nesting), then as it came, letting ProseMirror's Fitter close
// whatever a cut left invalid; each result must pass `check()`. If neither
// places, false: the belt and ProseMirror get the paste.
function pasteBlocks(view, slice, at) {
  const { state } = view
  for (const candidate of [new Slice(slice.content, 0, 0), slice]) {
    try {
      const tr = state.tr
      const size = tr.doc.content.size
      tr.replace(at, at, candidate)
      tr.doc.check()
      const end = at + (tr.doc.content.size - size)
      tr.setSelection(Selection.near(tr.doc.resolve(end), -1))
      view.dispatch(pasteMeta(tr))
      return true
    } catch {
      // try the next shape
    }
  }
  return false
}

// A toggle's summary is its one-line title (`toggleSummary` is `inline*`), so
// it cannot hold a block. Before this path a multi-block paste made the Fitter
// close the summary mid-paste and split the toggle in two (measured: plain
// two-line text left `toggle(summary "plain words", empty body)`,
// `paragraph("second lineSummary line")`, `toggle(empty summary, original
// body)`). The ruling (fix round 1 + final wave), in the order it is applied:
//  4. An inline paste -- inline content, or ONE textblock open at both ends
//     (a word from a paragraph, a list item, a body; mergesInline) -- is
//     ProseMirror's own and keeps its marks: returned false, untouched.
//  0. Nothing but EMPTY LINES (a text-only slice whose joined inline content
//     is empty) is a no-op at EVERY position in the title, its start included
//     (ruling (a)): the title has nowhere to put them and nothing is lost.
//  3. Caret at the START of a non-empty title (empty selection, offset 0):
//     every other slice goes in as blocks immediately BEFORE the toggle, where
//     ProseMirror used to put it; now explicit.
//  1. TEXT-ONLY (every top-level node is a textblock -- paragraph, heading,
//     code block): the blocks' inline content joins into the title at the
//     selection (joinedInline), replacing a selected range as any inline
//     paste does.
//  2. STRUCTURE (anything else -- a block atom such as a file chip, an image, a
//     rule, a chart; a closed callout, toggle or Ask answer; a list, table,
//     blockquote or task list): never flattened, never dropped, the toggle
//     never split, the title never touched -- a selection in it stays as it
//     was (ruling (b)). The whole slice goes in as blocks immediately AFTER
//     the toggle, visible even when it is collapsed. A whole Ask answer keeps
//     its wrapper, attrs and chips -- the I4 closed-block rule above.
// Ranges that start or end OUTSIDE the title (sameParent false) are left to
// ProseMirror, as before (review M-5, out of scope).
export function pasteIntoSummary(view, slice) {
  if (!slice || !slice.size) return false
  const { state } = view
  const { selection } = state
  const { $from, $to } = selection
  if ($from.parent.type.name !== 'toggleSummary' || !$from.sameParent($to)) return false
  if (mergesInline(slice)) return false // rule 4
  const toggleDepth = $from.depth - 1
  let textOnly = true
  slice.content.forEach((node) => { if (!node.isTextblock) textOnly = false })
  const inline = textOnly ? joinedInline(slice, state.schema) : null
  if (textOnly && !inline.size) return true // rule 0: nothing but empty lines
  if (selection.empty && $from.parentOffset === 0 && $from.parent.content.size > 0) {
    return pasteBlocks(view, slice, $from.before(toggleDepth)) // rule 3
  }
  if (!textOnly) return pasteBlocks(view, slice, $from.after(toggleDepth)) // rule 2
  const tr = state.tr.replaceWith($from.pos, $to.pos, inline) // rule 1
  try {
    tr.doc.check()
  } catch {
    // The title refused something (no current schema shape does): the blocks
    // go after the toggle whole rather than lose anything.
    return pasteBlocks(view, slice, $from.after(toggleDepth))
  }
  tr.setSelection(TextSelection.create(tr.doc, $from.pos + inline.size))
  view.dispatch(pasteMeta(tr))
  return true
}

// Belt-and-braces: if ProseMirror would still throw placing this slice (a
// schema shape nothing above anticipated), paste its TEXT instead of losing it
// to an uncaught error (which also leaves the browser's native paste
// un-prevented). What it dry-runs APPROXIMATES doPaste's final replace -- the
// replace doPaste would make if no later handlePaste takes the paste -- and is
// not a copy of it: it runs BEFORE three later handlePaste props (prosemirror-
// tables' cell paste, the code block's VS Code handler, TipTap's paste rules),
// so a slice one of those would have placed is judged as if it reached
// doPaste; and for a single closed node it calls replaceSelectionWith with the
// default mark inheritance, where doPaste passes `preferPlain` (the shift key).
// The review measured no divergence (whole blocks pasted into bold text, a
// table cell paste and a VS Code paste all placed normally, belt silent). On
// success it returns false, so every later handler and ProseMirror's own path
// run unchanged.
export function pasteOrFallBack(view, slice) {
  if (!slice || !slice.size) return false
  const single = slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
    ? slice.content.firstChild : null
  try {
    if (single) view.state.tr.replaceSelectionWith(single)
    else view.state.tr.replaceSelection(slice)
    return false
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pasteContainers] paste fell back to plain text:', err && err.message)
    const { schema } = view.state
    const text = slice.content.textBetween(0, slice.content.size, '\n', ' ')
    const lines = text.split('\n')
    let tr
    try {
      const blocks = lines.map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null))
      tr = view.state.tr.replaceSelection(new Slice(Fragment.fromArray(blocks), 1, 1))
    } catch {
      tr = view.state.tr.insertText(lines.join(' '))
    }
    view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
    return true
  }
}

export const PasteContainers = Extension.create({
  name: 'pasteContainers',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('pasteContainers'),
      props: {
        transformCopied: (slice) => unwrapOpenContainers(slice),
        transformPasted: (slice) => unwrapOpenContainers(slice),
        // The title first (a paste ProseMirror would complete wrongly -- a
        // split toggle), then the belt for one it would throw on.
        handlePaste: (view, _event, slice) => pasteIntoSummary(view, slice) || pasteOrFallBack(view, slice),
      },
    })]
  },
})
