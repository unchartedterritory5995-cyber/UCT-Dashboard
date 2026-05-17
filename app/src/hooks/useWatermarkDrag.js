import { useEffect, useRef } from 'react'

const THRESHOLD = 4 // px before a press becomes a drag

// Direct grab-drag + hover-arm for the watermark primitive. Pointer-events
// stay on the chart canvas (crosshair unaffected); we only intercept a press
// that starts inside the watermark rect while in cursor mode.
//
// getActiveTool / onCommit / mediaSize are read through refs so the listener
// effect depends only on the (stable) container/controller refs and never
// re-binds listeners when the parent (StockChart) re-renders mid-gesture.
export default function useWatermarkDrag({ containerRef, controllerRef, getActiveTool, onCommit, mediaSize }) {
  const drag = useRef(null)
  const getActiveToolRef = useRef(getActiveTool)
  const onCommitRef = useRef(onCommit)
  const mediaSizeRef = useRef(mediaSize)
  getActiveToolRef.current = getActiveTool
  onCommitRef.current = onCommit
  mediaSizeRef.current = mediaSize

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const toolActive = () => {
      const fn = getActiveToolRef.current
      const t = fn && fn()
      return t && t !== 'cursor'
    }
    const local = (e) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const inRect = (p) => {
      const c = controllerRef.current
      const rect = c && c.getRect && c.getRect()
      return !!(rect && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h)
    }

    const onMove = (e) => {
      const c = controllerRef.current
      if (!c) return
      const p = local(e)
      if (drag.current) {
        if (!drag.current.moved) {
          if (Math.abs(p.x - drag.current.sx) + Math.abs(p.y - drag.current.sy) < THRESHOLD) return
          drag.current.moved = true
        }
        const ms = mediaSizeRef.current || { width: el.clientWidth, height: el.clientHeight }
        const w = ms.width || 1
        const h = ms.height || 1
        const nx = Math.max(0, Math.min(1, p.x / w))
        const ny = Math.max(0, Math.min(1, p.y / h))
        drag.current.nx = nx
        drag.current.ny = ny
        c.setOptions({ x: nx, y: ny })
        e.preventDefault()
        return
      }
      if (toolActive()) { c.setArmed(false); return }
      c.setArmed(inRect(p))
    }

    const onDown = (e) => {
      if (toolActive()) return
      const p = local(e)
      if (!inRect(p)) return
      drag.current = { sx: p.x, sy: p.y, moved: false, nx: null, ny: null }
      try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }

    const finishDrag = (commit, e) => {
      const c = controllerRef.current
      const d = drag.current
      drag.current = null
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      if (commit && d && d.moved && d.nx != null && c) onCommitRef.current({ x: d.nx, y: d.ny })
    }
    const onUp = (e) => finishDrag(true, e)
    const onCancel = (e) => finishDrag(false, e)

    el.addEventListener('pointermove', onMove, true)
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp, true)
    el.addEventListener('pointercancel', onCancel, true)
    return () => {
      el.removeEventListener('pointermove', onMove, true)
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp, true)
      el.removeEventListener('pointercancel', onCancel, true)
    }
  }, [containerRef, controllerRef])
}
