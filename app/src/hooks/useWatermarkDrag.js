import { useEffect, useRef } from 'react'

const THRESHOLD = 4 // px before a press becomes a drag

// Direct grab-drag + hover-arm for the watermark primitive. Pointer-events
// stay on the chart canvas (crosshair unaffected); we only intercept a press
// that starts inside the watermark rect while in cursor mode.
export default function useWatermarkDrag({ containerRef, controllerRef, getActiveTool, onCommit, mediaSize }) {
  const drag = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const toolActive = () => {
      const t = getActiveTool && getActiveTool()
      return t && t !== 'cursor'
    }
    const local = (e) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const inRect = (p) => {
      const c = controllerRef.current
      const rect = c && c.getRect && c.getRect()
      return rect && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h
    }

    const onMove = (e) => {
      const c = controllerRef.current
      if (!c) return
      if (drag.current) {
        const p = local(e)
        if (!drag.current.moved) {
          if (Math.abs(p.x - drag.current.sx) + Math.abs(p.y - drag.current.sy) < THRESHOLD) return
          drag.current.moved = true
        }
        const ms = mediaSize || { width: el.clientWidth, height: el.clientHeight }
        const nx = Math.max(0, Math.min(1, p.x / ms.width))
        const ny = Math.max(0, Math.min(1, p.y / ms.height))
        drag.current.nx = nx
        drag.current.ny = ny
        c.setOptions({ x: nx, y: ny })
        e.preventDefault()
        return
      }
      if (toolActive()) { c.setArmed(false); return }
      c.setArmed(inRect(local(e)))
    }

    const onDown = (e) => {
      if (toolActive()) return
      const p = local(e)
      if (!inRect(p)) return
      drag.current = { sx: p.x, sy: p.y, moved: false, nx: null, ny: null }
      try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }

    const onUp = (e) => {
      const c = controllerRef.current
      const d = drag.current
      drag.current = null
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      if (d && d.moved && d.nx != null && c) onCommit({ x: d.nx, y: d.ny })
    }

    el.addEventListener('pointermove', onMove, true)
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp, true)
    return () => {
      el.removeEventListener('pointermove', onMove, true)
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp, true)
    }
  }, [containerRef, controllerRef, getActiveTool, onCommit, mediaSize])
}
