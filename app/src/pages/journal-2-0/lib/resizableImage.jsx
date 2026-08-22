/**
 * Resizable image node — the base TipTap Image plus a bottom-right drag handle
 * (the same "L" corner the chart embeds use), storing an explicit pixel width in
 * the node's `width` attr. `max-width: 100%` keeps it responsive (never wider
 * than the column).
 */
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { useRef, useState } from 'react'
import styles from './resizableImage.module.css'

function ResizableImageView({ node, updateAttributes, editor, selected }) {
  const { src, alt, width } = node.attrs
  const imgRef = useRef(null)
  const [resizing, setResizing] = useState(false)

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

  return (
    <NodeViewWrapper className={`${styles.wrap} ${selected ? styles.selected : ''} ${resizing ? styles.resizing : ''}`}>
      <img
        ref={imgRef}
        className={styles.img}
        src={src}
        alt={alt || ''}
        style={width ? { width: `${width}px` } : undefined}
        draggable={false}
      />
      {editor?.isEditable !== false && (
        <span className={`${styles.handle} ${styles.hSE}`} onPointerDown={startResize} aria-hidden="true" />
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
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})

export default ResizableImage
