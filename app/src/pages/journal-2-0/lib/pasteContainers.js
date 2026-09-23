import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'

/**
 * Paste/copy normalisation for the Notebook's three `defining` containers —
 * askInsert, callout, toggle. ONE helper, ONE plugin, both edges, the whole
 * open spine (see unwrapOpenContainers below).
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

// A toggle's summary is its one-line title (`toggleSummary` is `inline*`). A
// paste into it that is anything but inline content -- two lines of plain
// text, several paragraphs, a list, a whole block -- made the Fitter close the
// summary mid-paste and split the toggle in two around the pasted blocks
// (measured: plain two-line text left `toggle(summary "plain words", empty
// body)`, `paragraph("second lineSummary line")`, `toggle(empty summary,
// original body)`). Such a paste lands as its TEXT, one line, blocks joined by
// a single space. A single-line paste (mergesInline) is left to ProseMirror,
// which keeps its marks. A slice with no text at all (an image, a rule) is
// left to ProseMirror too: a title cannot hold it, and dropping it would lose
// it silently.
export function pasteIntoSummary(view, slice) {
  if (!slice || !slice.size) return false
  const { $from, $to } = view.state.selection
  if ($from.parent.type.name !== 'toggleSummary' || !$from.sameParent($to)) return false
  if (mergesInline(slice)) return false
  const parts = []
  slice.content.descendants((node) => {
    if (!node.isTextblock) return true
    const line = node.textContent.replace(/[\r\n]+/g, ' ')
    if (line) parts.push(line)
    return false
  })
  const text = parts.join(' ')
  if (!text) return false
  view.dispatch(view.state.tr.insertText(text).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
  return true
}

// Belt-and-braces: if ProseMirror would still throw placing this slice (a
// schema shape nothing above anticipated), paste its TEXT instead of losing it
// to an uncaught error (which also leaves the browser's native paste
// un-prevented). Dry-runs exactly what doPaste will do; on success returns
// false so ProseMirror's own path runs unchanged.
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
        // The summary first (it is a paste ProseMirror would complete, wrongly),
        // then the belt for one it would throw on.
        handlePaste: (view, _event, slice) => pasteIntoSummary(view, slice) || pasteOrFallBack(view, slice),
      },
    })]
  },
})
