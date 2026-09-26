/**
 * Resizable image node — the base TipTap Image plus a bottom-right drag handle
 * (the same "L" corner the chart embeds use), storing an explicit pixel width in
 * the node's `width` attr. `max-width: 100%` keeps it responsive (never wider
 * than the column).
 *
 * Wave 6 item 3: an `align` attr (left / center / right / full width — an attr
 * on this EXISTING node, so no schema bump: an older client drops it and the
 * image sits at its default place) and, while the image is selected in an
 * editable note, a small bar to set it and to add or remove a CAPTION. The
 * caption is real text in an `imageFigure` (imageFigureNode.js explains why it
 * is a node, not an attr).
 */
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { useRef, useState } from 'react'
import {
  IMAGE_ALIGNS, normalizeImageAlign, setImageAlign, addImageCaption, removeImageCaption,
} from './imageFigureNode'
import styles from './resizableImage.module.css'

export const IMAGE_BAR_LABEL = 'Image'
const ALIGN_LABELS = { left: 'Left', center: 'Center', right: 'Right', full: 'Full width' }
const ALIGN_NAMES = {
  left: 'Align the image left', center: 'Center the image', right: 'Align the image right', full: 'Make the image full width',
}

function ResizableImageView({ node, updateAttributes, editor, selected, getPos }) {
  const { src, alt, width } = node.attrs
  const align = normalizeImageAlign(node.attrs.align)
  const imgRef = useRef(null)
  const [resizing, setResizing] = useState(false)
  const editable = editor?.isEditable !== false

  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    const startW = img.getBoundingClientRect().width
    const startX = e.clientX
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'nwse-resize'
    setResizing(true)
    let liveW = startW
    const onMove = (ev) => {
      liveW = Math.max(80, Math.min(3200, startW + (ev.clientX - startX)))
      img.style.width = `${liveW}px`
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = prevCursor
      setResizing(false)
      updateAttributes?.({ width: Math.round(liveW) })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Where the image sits decides what the caption control does. Read at render:
  // the view re-renders whenever the node or its selection changes.
  const pos = typeof getPos === 'function' ? getPos() : null
  let inFigure = false
  try {
    inFigure = typeof pos === 'number' && editor.state.doc.resolve(pos).parent.type.name === 'imageFigure'
  } catch { inFigure = false }
  const keep = (e) => e.preventDefault()

  return (
    <NodeViewWrapper
      data-uct-image=""
      data-align={align || undefined}
      className={`${styles.wrap} ${selected ? styles.selected : ''} ${resizing ? styles.resizing : ''}`}
    >
      <img
        ref={imgRef}
        className={styles.img}
        src={src}
        alt={alt || ''}
        style={width && align !== 'full' ? { width: `${width}px` } : undefined}
        draggable={false}
      />
      {editable && align !== 'full' && (
        <span className={`${styles.handle} ${styles.hSE}`} onPointerDown={startResize} aria-hidden="true" />
      )}
      {editable && selected && (
        <div className={styles.bar} role="toolbar" aria-label={IMAGE_BAR_LABEL} contentEditable={false}>
          {IMAGE_ALIGNS.map((a) => (
            <button
              key={a}
              type="button"
              className={styles.barBtn}
              aria-pressed={align === a}
              aria-label={ALIGN_NAMES[a]}
              title={ALIGN_NAMES[a]}
              onMouseDown={keep}
              // A second press on the current alignment returns it to the default.
              onClick={() => setImageAlign(editor, getPos(), align === a ? null : a)}
            >
              {ALIGN_LABELS[a]}
            </button>
          ))}
          <button
            type="button"
            className={styles.barBtn}
            onMouseDown={keep}
            onClick={() => (inFigure ? removeImageCaption(editor, getPos()) : addImageCaption(editor, getPos()))}
          >
            {inFigure ? 'Remove caption' : 'Add caption'}
          </button>
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('width') || (el.style && el.style.width) || ''
          const n = parseInt(raw, 10)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
      align: {
        default: null,
        parseHTML: (el) => normalizeImageAlign(el.getAttribute('data-align')),
        renderHTML: (attrs) => (normalizeImageAlign(attrs.align) ? { 'data-align': attrs.align } : {}),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})

export default ResizableImage
