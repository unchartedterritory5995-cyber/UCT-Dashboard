import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

/**
 * Wave 6 item 3 — an image's CAPTION, and where the image sits.
 *
 * ⛔ THE CAPTION IS THE MEMBER'S TEXT, SO IT IS REAL TEXT. It lives in its own
 * textblock (`imageCaption`) beside the image inside an `imageFigure`, never in
 * an attribute: an attribute would be invisible to find and replace, to the
 * word count, to Ask's citation text and to History's diff — each of which
 * reads TEXT NODES. As a textblock it reaches all of them with no code of their
 * own (the citation tables list both types; the fixtures pin them).
 *
 * ⛔ AND THAT IS WHY THE CAPTION IS A NEW NODE TYPE, NOT AN ATTR. A new type is
 * registered at schema 2 (docs/notebook/wave5-rollback.md; the schema map on
 * feat/notebook-10), so a client too old to read it is REFUSED a write by the
 * server instead of silently dropping the member's caption on its next save —
 * which is exactly what an unknown ATTRIBUTE would suffer.
 *
 * Alignment (`align` on the image: left | center | right | full) is an attr on
 * the EXISTING `image` node: an older client drops it and the image shows at
 * its default place — a lost style, never lost words. No bump.
 *
 * Shapes:
 *   imageFigure   block container, content `image imageCaption`
 *   imageCaption  textblock, `inline*` — a one-line title, like toggleSummary:
 *                 Enter leaves it (a new paragraph after the figure), and a
 *                 paste of blocks lands after the figure (pasteContainers.js).
 */
export const IMAGE_ALIGNS = Object.freeze(['left', 'center', 'right', 'full'])
export const normalizeImageAlign = (v) => (IMAGE_ALIGNS.includes(v) ? v : null)

export const ImageCaption = Node.create({
  name: 'imageCaption',
  content: 'inline*',
  // A caption is its figure's: it never splits, and never merges out of it.
  defining: true,
  parseHTML() {
    return [{ tag: 'figcaption' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['figcaption', mergeAttributes(HTMLAttributes, { class: 'uctImageCaption' }), 0]
  },
})

export const ImageFigure = Node.create({
  name: 'imageFigure',
  group: 'block',
  content: 'image imageCaption',
  defining: true,
  isolating: true,
  parseHTML() {
    // Our own output, and a web page's <figure><img><figcaption> — but only a
    // figure that actually holds an image, or its content could never fit.
    return [{ tag: 'figure', getAttrs: (el) => (el.querySelector && el.querySelector('img') ? {} : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-type': 'image-figure' }), 0]
  },
  addKeyboardShortcuts() {
    return {
      // Enter in a caption leaves it: a new paragraph after the figure.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if ($from.parent.type.name !== 'imageCaption' || !empty) return false
        const after = $from.after($from.depth - 1)
        const para = editor.schema.nodes.paragraph.create()
        const tr = editor.state.tr.insert(after, para)
        tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView()
        editor.view.dispatch(tr)
        return true
      },
      // Backspace at the start of an EMPTY caption removes the caption (the
      // image stays). At the start of a caption WITH words, ProseMirror's own
      // Backspace selects the image — it cannot join words into a leaf.
      Backspace: ({ editor }) => {
        if (deleteSelectedFigureImage(editor)) return true
        const { $from, empty } = editor.state.selection
        if ($from.parent.type.name !== 'imageCaption' || !empty || $from.parentOffset !== 0) return false
        if ($from.parent.content.size > 0) return false
        return removeImageCaption(editor, $from.before($from.depth - 1) + 1)
      },
      // Deleting the IMAGE of a captioned figure keeps the caption's words, as
      // a paragraph where the figure was.
      Delete: ({ editor }) => deleteSelectedFigureImage(editor),
      'Mod-Backspace': ({ editor }) => deleteSelectedFigureImage(editor),
    }
  },
})

/** The image node at `pos`, and whether it sits in a figure. */
function imageAt(state, pos) {
  if (typeof pos !== 'number') return null
  const node = state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'image') return null
  const $pos = state.doc.resolve(pos)
  const inFigure = $pos.parent.type.name === 'imageFigure'
  return { node, inFigure, figurePos: inFigure ? $pos.before($pos.depth) : null }
}

/** Set the image's alignment (null = the default place). One transaction. */
export function setImageAlign(editor, pos, align) {
  const at = imageAt(editor.state, pos)
  if (!at || !editor.isEditable) return false
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...at.node.attrs, align: normalizeImageAlign(align) }))
  return true
}

/**
 * Give the image at `pos` a caption: it is wrapped in a figure with an empty
 * caption, and the caret is put in the caption so the member can type. One
 * transaction, so one undo takes it back.
 */
export function addImageCaption(editor, pos) {
  const at = imageAt(editor.state, pos)
  if (!at || at.inFigure || !editor.isEditable) return false
  const { schema } = editor.state
  const figure = schema.nodes.imageFigure.create(null, [at.node, schema.nodes.imageCaption.create()])
  const tr = editor.state.tr.replaceWith(pos, pos + at.node.nodeSize, figure)
  // figure open (1) + image + caption open (1)
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + at.node.nodeSize + 1)).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
  return true
}

/**
 * Remove the caption of the image at `pos` (which must sit in a figure): the
 * figure becomes the bare image again. The caption's text goes with it — the
 * member asked for exactly that, and one undo brings it back.
 */
export function removeImageCaption(editor, pos) {
  const at = imageAt(editor.state, pos)
  if (!at || !at.inFigure || !editor.isEditable) return false
  const figure = editor.state.doc.nodeAt(at.figurePos)
  const tr = editor.state.tr.replaceWith(at.figurePos, at.figurePos + figure.nodeSize, at.node)
  tr.setSelection(NodeSelection.create(tr.doc, at.figurePos))
  editor.view.dispatch(tr)
  return true
}

/** Delete a SELECTED image that has a caption, keeping the caption's words. */
export function deleteSelectedFigureImage(editor) {
  const sel = editor.state.selection
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'image') return false
  const at = imageAt(editor.state, sel.from)
  if (!at || !at.inFigure) return false
  const figure = editor.state.doc.nodeAt(at.figurePos)
  const caption = figure.lastChild
  const { schema } = editor.state
  const tr = editor.state.tr
  if (caption && caption.content.size) {
    tr.replaceWith(at.figurePos, at.figurePos + figure.nodeSize, schema.nodes.paragraph.create(null, caption.content))
    tr.setSelection(TextSelection.create(tr.doc, at.figurePos + 1))
  } else {
    tr.delete(at.figurePos, at.figurePos + figure.nodeSize)
  }
  editor.view.dispatch(tr.scrollIntoView())
  return true
}
