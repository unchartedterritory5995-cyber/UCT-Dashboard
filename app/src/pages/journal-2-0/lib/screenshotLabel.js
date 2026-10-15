// app/src/pages/journal-2-0/lib/screenshotLabel.js
/**
 * Tier 2 part A, item 10 -- the editor half of "Tag NVDA · Daily": find the pasted image and give
 * it an alt. Pure ProseMirror, no React. Shared by the lazy chip (ScreenshotTagOffer.jsx, which
 * re-exports both for its tests) and the lazy accept decision (lib/screenshotTag.js); the editor page
 * imports neither eagerly (I5).
 *
 * The alt is an editor transaction on the note's own autosave path (R-T2A-8): no new write door,
 * no new node, no new attribute. Every OTHER attribute of the node is kept, so a resized image
 * keeps its width, its alignment and its title.
 */

/** V8: the image node's type name (TipTap's `Image`, extended as ResizableImage in lib/tiptap.js). */
export const IMAGE_NODE = 'image'

/** Position of the first image node whose src is `src`, or null. */
export function findImagePos(doc, src) {
  let at = null
  doc.descendants((n, pos) => {
    if (at != null) return false
    if (n.type.name === IMAGE_NODE && n.attrs.src === src) { at = pos; return false }
    return true
  })
  return at
}

/** True when the node at `pos` is the image with this src (the O(1) check a moved position uses). */
export function isImageAt(doc, pos, src) {
  if (pos == null || pos < 0 || pos > doc.content.size) return false
  const n = doc.nodeAt(pos)
  return !!n && n.type.name === IMAGE_NODE && n.attrs.src === src
}

/** Sets the alt of the image with this src. False when the image is gone or the editor cannot take it. */
export function labelImage(editor, src, alt) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const pos = findImagePos(editor.state.doc, src)
  if (pos == null) return false
  const node = editor.state.doc.nodeAt(pos)
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt }))
  return true
}
