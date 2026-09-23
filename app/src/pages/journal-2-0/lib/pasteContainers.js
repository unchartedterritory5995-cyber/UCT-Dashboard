import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import { dropPoint } from '@tiptap/pm/transform'
import { newEmbedId } from './widgetEmbedCore'

/**
 * Paste/copy normalisation for the Notebook's own three container nodes —
 * askInsert, callout, toggle: the three `defining` CONTAINERS this plugin
 * unwraps. They are not the only `defining` nodes in the roster: blockquote,
 * heading, codeBlock and the list items declare `defining` too (their upstream
 * TipTap extensions), and are deliberately NOT unwrapped -- they keep
 * ProseMirror's own wrap-on-paste behaviour. ONE helper, ONE plugin, both
 * edges, the whole open spine (see unwrapOpenContainers below). The same
 * plugin also owns pastes into a toggle's one-line title (pasteIntoSummary),
 * drops, which never reach handlePaste (handleDrop; see Drops below), and a
 * pasted chart's identity (freshEmbedIds).
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

// A chart pasted into the note it was copied from would carry its source's
// `embedId`, and Ask cites a chart precisely only while that identity is
// UNIQUE in the note (askCitation.js::citationAtomIdentity; the server does the
// same) -- so both copies fell back to note-level citations. A widgetEmbed
// whose embedId is already TAKEN in the doc it lands in (or earlier in the
// same slice) gets a fresh one from widgetEmbedCore's own generator; the one
// already in the doc keeps its own. "The doc it lands in" is the doc AFTER
// whatever the paste or drop removes: a cut, or a drag that moves, lands in a
// doc its source has already left, and a chart pasted over itself (or a
// select-all + paste of the note's own content) replaces the chart its id
// belongs to -- none of them collides, so each keeps its id and an Ask
// citation naming it stays exact. So does a paste into another note. An
// embed with NO embedId (stored before ids existed) stays without one -- a
// legacy embed is never minted one here.
// `docOf` is called only when the slice holds an embed with an id. Returns the
// SAME slice when nothing changes.
export function freshEmbedIds(slice, docOf) {
  let carries = false
  slice.content.descendants((n) => { if (n.type.name === 'widgetEmbed' && n.attrs.embedId) carries = true })
  if (!carries) return slice
  const taken = new Set()
  docOf().descendants((n) => { if (n.type.name === 'widgetEmbed' && n.attrs.embedId) taken.add(n.attrs.embedId) })
  const walk = (fragment) => {
    let changed = false
    const out = []
    fragment.forEach((node) => {
      let next = node
      if (node.type.name === 'widgetEmbed' && node.attrs.embedId) {
        if (taken.has(node.attrs.embedId)) next = node.type.create({ ...node.attrs, embedId: newEmbedId() }, node.content, node.marks)
        taken.add(next.attrs.embedId)
      } else if (node.childCount) {
        const inner = walk(node.content)
        if (inner !== node.content) next = node.copy(inner)
      }
      if (next !== node) changed = true
      out.push(next)
    })
    return changed ? Fragment.fromArray(out) : fragment
  }
  const content = walk(slice.content)
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd)
}

const pasteMeta = (tr) => tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste')

// The one closed node a slice consists of, or null -- the slice ProseMirror
// places with replaceSelectionWith (a paste) / replaceRangeWith (a drop).
const closedSingle = (slice) => (slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
  ? slice.content.firstChild : null)

// A toggle's summary is its one-line title (`toggleSummary` is `inline*`), so
// it cannot hold a block. Before this path a multi-block paste made the Fitter
// close the summary mid-paste and split the toggle in two (measured: plain
// two-line text left `toggle(summary "plain words", empty body)`,
// `paragraph("second lineSummary line")`, `toggle(empty summary, original
// body)`); a drop did the same. The ruling (fix round 1 + final wave + wave
// 4), in the order it is applied:
//  4. An inline paste -- inline content, or ONE textblock open at both ends
//     (a word from a paragraph, a list item, a body; mergesInline) -- is
//     ProseMirror's own and keeps its marks: null, untouched.
//  0. Nothing but EMPTY LINES (a text-only slice whose joined inline content
//     is empty) is a no-op at EVERY position in the title, its start included
//     (ruling (a)): the title has nowhere to put them and nothing is lost.
//  3. Caret at the START of a non-empty title (an empty target, offset 0):
//     every other slice goes in as blocks immediately BEFORE the toggle, where
//     ProseMirror used to put it; now explicit.
//  1. TEXT-ONLY (every top-level node is a textblock -- paragraph, heading,
//     code block): the blocks' inline content joins into the title at the
//     target (joinedInline), replacing a selected range as any inline paste
//     does.
//  2. STRUCTURE (anything else -- a block atom such as a file chip, an image, a
//     rule, a chart; a closed callout, toggle or Ask answer; a list, table,
//     blockquote or task list): never flattened, never dropped, the toggle
//     never split, the title never touched -- a selection in it stays as it
//     was (ruling (b)). The whole slice goes in as blocks immediately AFTER
//     the toggle, visible even when it is collapsed. A whole Ask answer keeps
//     its wrapper, attrs and chips -- the I4 closed-block rule above.
// It is written ONCE, as a plan over positions in the current doc, and both
// doors ask it: a paste targets the selection (`$from`..`$to`), a drop targets
// the drop point (`$from` === `$to`, since a drop replaces nothing). Ranges
// that start or end OUTSIDE the title (sameParent false) are left to
// ProseMirror, as before (review M-5, out of scope).
function titlePlan(schema, slice, $from, $to) {
  if (!slice || !slice.size) return null
  if ($from.parent.type.name !== 'toggleSummary' || !$from.sameParent($to)) return null
  if (mergesInline(slice)) return null // rule 4
  const toggleDepth = $from.depth - 1
  let textOnly = true
  slice.content.forEach((node) => { if (!node.isTextblock) textOnly = false })
  const inline = textOnly ? joinedInline(slice, schema) : null
  if (textOnly && !inline.size) return { rule: 0 } // nothing but empty lines
  if ($from.pos === $to.pos && $from.parentOffset === 0 && $from.parent.content.size > 0) {
    return { rule: 3, at: $from.before(toggleDepth) }
  }
  const after = $from.after(toggleDepth)
  if (!textOnly) return { rule: 2, at: after }
  return { rule: 1, from: $from.pos, to: $to.pos, inline, at: after }
}

// Places a plan in a transaction from `begin()` -- a bare `state.tr` for a
// paste; for a MOVED drag, one that has already removed the dragged source.
// The plan was made on the doc that transaction starts from (`begin().doc`),
// so its positions are used as they are; each attempt starts a fresh
// transaction. Returns { tr, from, to, placed } -- the span inserted and the
// slice actually placed -- or null when nothing places (the belt and
// ProseMirror then get it).
function placePlan(begin, plan, slice) {
  if (plan.rule === 1) {
    try {
      const tr = begin()
      tr.replaceWith(plan.from, plan.to, plan.inline)
      tr.doc.check()
      return { tr, from: plan.from, to: plan.from + plan.inline.size, placed: null }
    } catch {
      // The title refused something (no current schema shape does): the
      // blocks go after the toggle whole rather than lose anything.
    }
  }
  return placeBlocks(begin, slice, plan.at)
}

// Rules 2 and 3: the whole slice as blocks at `at` -- a position just outside
// the toggle -- in ONE transaction (one undo step). The TITLE IS NEVER
// TOUCHED, even when the member had text selected in it (ruling (b)): the
// content lands outside the title, so deleting a word from it would be a
// change the member was not looking at. The slice is tried CLOSED first
// (exactly the nodes that were copied, a list keeping its nesting), then as it
// came, letting ProseMirror's Fitter close whatever a cut left invalid; each
// result must pass `check()`.
function placeBlocks(begin, slice, at) {
  for (const candidate of [new Slice(slice.content, 0, 0), slice]) {
    try {
      const tr = begin()
      const size = tr.doc.content.size
      tr.replace(at, at, candidate)
      tr.doc.check()
      return { tr, from: at, to: at + (tr.doc.content.size - size), placed: candidate }
    } catch {
      // try the next shape
    }
  }
  return null
}

// The PASTE door into a title: the plan at the selection, the caret left at
// the end of what was inserted.
export function pasteIntoSummary(view, slice) {
  const { state } = view
  const { $from, $to } = state.selection
  const plan = titlePlan(state.schema, slice, $from, $to)
  if (!plan) return false
  if (plan.rule === 0) return true
  const done = placePlan(() => state.tr, plan, slice)
  if (!done) return false
  const { tr } = done
  tr.setSelection(done.placed ? Selection.near(tr.doc.resolve(done.to), -1) : TextSelection.create(tr.doc, done.to))
  view.dispatch(pasteMeta(tr))
  return true
}

// The belt's last resort, shared by the paste and the drop: the slice's TEXT
// as plain paragraphs, one per line, placed by `put`; if even that will not
// place, the text as one line (`putLine`). Nothing copied is lost to an
// uncaught error.
function textInstead(schema, slice, put, putLine) {
  const lines = slice.content.textBetween(0, slice.content.size, '\n', ' ').split('\n')
  try {
    const blocks = lines.map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null))
    return put(new Slice(Fragment.fromArray(blocks), 1, 1))
  } catch {
    return putLine(lines.join(' '))
  }
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
  const single = closedSingle(slice)
  try {
    if (single) view.state.tr.replaceSelectionWith(single)
    else view.state.tr.replaceSelection(slice)
    return false
  } catch (err) {
    console.warn('[pasteContainers] paste fell back to plain text:', err && err.message)
    const tr = textInstead(view.state.schema, slice,
      (blocks) => view.state.tr.replaceSelection(blocks),
      (line) => view.state.tr.insertText(line))
    view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
    return true
  }
}

// ── Drops ───────────────────────────────────────────────────────────────────
// prosemirror-view runs transformPasted on a drag's slice but NEVER
// handlePaste: a drop goes through its own editHandlers.drop, which asks the
// handleDrop props and otherwise inserts at `dropPoint`. So the title rules
// and the belt are entered a second time here, reproducing what that handler
// does wherever this plugin takes the drop over (prosemirror-view 1.x,
// `handleDrop` in dist/index.js).

// The drop point, as editHandlers.drop finds it: posAtCoords at the event's
// client coordinates. null off the document (it then drops nothing either).
function dropTarget(view, event) {
  const found = event ? view.posAtCoords({ left: event.clientX, top: event.clientY }) : null
  return found ? view.state.doc.resolve(found.pos) : null
}

// A drop's transaction starts the way editHandlers.drop starts it: for a
// MOVED drag (not a copy -- `moved` is its dragMoves verdict), the dragged
// source is removed FIRST, in the same transaction, so one undo restores both
// -- a node drag replaces its NodeSelection, a text drag deletes the
// selection it began from. `view.dragging` is still set while handleDrop runs.
function dropBegin(view, moved) {
  const { state } = view
  const node = moved && view.dragging ? view.dragging.node : null
  return () => {
    const tr = state.tr
    if (moved) {
      if (node) node.replace(tr)
      else tr.deleteSelection()
    }
    return tr
  }
}

// The end of what a drop inserted, found the way editHandlers.drop finds it:
// the new end of the last step's range.
function insertedEnd(tr, insertPos) {
  let end = tr.mapping.map(insertPos)
  tr.mapping.maps[tr.mapping.maps.length - 1].forEach((_f, _t, _nf, newTo) => { end = newTo })
  return end
}

// editHandlers.drop's ending, verbatim in effect: what was dropped is
// selected -- one selectable closed node as a NodeSelection, anything else as
// the range between its ends (through createSelectionBetween, as it asks) --
// then focus, and `uiEvent: 'drop'` (which TipTap's paste rules read).
function finishDrop(view, tr, from, to, placed) {
  const $pos = tr.doc.resolve(from)
  const single = placed ? closedSingle(placed) : null
  if (single && NodeSelection.isSelectable(single) && $pos.nodeAfter && $pos.nodeAfter.sameMarkup(single)) {
    tr.setSelection(new NodeSelection($pos))
  } else {
    const $to = tr.doc.resolve(to)
    tr.setSelection(view.someProp('createSelectionBetween', (f) => f(view, $pos, $to)) || TextSelection.between($pos, $to))
  }
  view.focus()
  view.dispatch(tr.setMeta('uiEvent', 'drop'))
}

// The DROP door into a title: the same plan as a paste, at the drop point --
// judged on the doc the drop's transaction starts from, i.e. after a moved
// drag's source is gone, with the drop point mapped past that removal as
// editHandlers.drop maps its insert position. A drop point the removal itself
// consumes is a drop onto the dragged content: CANCELLED, nothing moves.
// (Measured by the drop sweep: a title's whole text dragged out and let go at
// the title's own start -- ProseMirror rebuilds the emptied toggle in the
// removal, its forward mapping lands between the new title and the body, and
// its own insert there split the toggle.) A drag out of a title's own text back
// onto the rest of it is judged where the drop actually lands.
export function dropIntoSummary(view, event, slice, moved) {
  const $mouse = dropTarget(view, event)
  if (!$mouse || $mouse.parent.type.name !== 'toggleSummary') return false
  const begin = dropBegin(view, moved)
  const start = begin()
  const mapped = start.mapping.mapResult($mouse.pos)
  if (mapped.deleted) return true
  const $at = start.doc.resolve(mapped.pos)
  const plan = titlePlan(view.state.schema, slice, $at, $at)
  if (!plan) return false
  if (plan.rule === 0) return true // nothing to drop: the source stays too
  const done = placePlan(begin, plan, slice)
  if (!done) return false
  finishDrop(view, done.tr, done.from, done.to, done.placed)
  return true
}

// The drop belt, the paste belt's twin: a dry run of the drop editHandlers.drop
// is about to make -- the same dropPoint, the same source removal, the same
// replaceRangeWith / replaceRange -- and, ONLY if that would throw, the slice's
// text dropped as plain paragraphs at the same point instead (warned once).
// Otherwise false: ProseMirror's own drop runs, unchanged -- except when
// `take` says the slice here is not the one ProseMirror holds (fresh embed
// ids, see handleDrop), and then the dry run IS that drop, dispatched with its
// ending; a drop that inserts nothing dispatches nothing, as editHandlers.drop.
export function dropOrFallBack(view, event, slice, moved, take = false) {
  if (!slice || !slice.size) return false
  const $mouse = dropTarget(view, event)
  if (!$mouse) return false
  const begin = dropBegin(view, moved)
  let insertPos = $mouse.pos
  try {
    const found = dropPoint(view.state.doc, $mouse.pos, slice)
    if (found != null) insertPos = found
    const tr = begin()
    const pos = tr.mapping.map(insertPos)
    const single = closedSingle(slice)
    const beforeInsert = tr.doc
    if (single) tr.replaceRangeWith(pos, pos, single)
    else tr.replaceRange(pos, pos, slice)
    if (!take) return false
    if (!tr.doc.eq(beforeInsert)) finishDrop(view, tr, pos, insertedEnd(tr, insertPos), slice)
    return true
  } catch (err) {
    console.warn('[pasteContainers] drop fell back to plain text:', err && err.message)
    try {
      let from = 0
      const tr = textInstead(view.state.schema, slice,
        (blocks) => { const t = begin(); from = t.mapping.map(insertPos); return t.replaceRange(from, from, blocks) },
        (line) => { const t = begin(); from = t.mapping.map(insertPos); return t.insertText(line, from) })
      finishDrop(view, tr, from, insertedEnd(tr, insertPos), null)
      return true
    } catch {
      return false // not even the text would place: ProseMirror's drop, as before
    }
  }
}

export const PasteContainers = Extension.create({
  name: 'pasteContainers',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('pasteContainers'),
      props: {
        transformCopied: (slice) => unwrapOpenContainers(slice),
        // A drag's slice comes through here too, BEFORE editHandlers.drop knows
        // whether it moves: `view.dragging.move` is dragstart's verdict, and the
        // drop recomputes it from its own event after this runs. So a drag's
        // embed ids are left to handleDrop, which is handed the final answer.
        // A paste replaces the selection, so its ids are judged against the
        // doc with the selection already gone.
        transformPasted: (slice, view) => {
          const out = unwrapOpenContainers(slice)
          return view && !view.dragging ? freshEmbedIds(out, () => view.state.tr.deleteSelection().doc) : out
        },
        // The title first (a paste ProseMirror would complete wrongly -- a
        // split toggle), then the belt for one it would throw on.
        handlePaste: (view, _event, slice) => pasteIntoSummary(view, slice) || pasteOrFallBack(view, slice),
        // A drop never reaches handlePaste (see Drops above): the same two, in
        // the same order. `slice` has already been through transformPasted. A
        // drag's embed ids are judged here, against the doc the drop lands in
        // (after a move's source is gone); a slice that changes must then be
        // placed by this plugin, since ProseMirror would place its own copy.
        handleDrop: (view, event, slice, moved) => {
          const own = view.dragging ? freshEmbedIds(slice, () => dropBegin(view, moved)().doc) : slice
          return dropIntoSummary(view, event, own, moved) || dropOrFallBack(view, event, own, moved, own !== slice)
        },
      },
    })]
  },
})
