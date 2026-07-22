// Pure positioning math for the fixed video host. Both modes return
// {top,left,width,height} so the CSS transition animates the same four props
// for a smooth dock<->mini shrink/grow. Responsive sizing reads the passed-in
// viewport (caller uses window.innerWidth/Height, correct at first paint — we
// deliberately avoid useMediaQuery, which is stale at first paint).
import { clampMiniPos } from './playerUtils'

export const MINI = {
  desktopW: 360,
  desktopMargin: 18,
  mobileMaxW: 240,
  mobileMargin: 12,
  mobileBottomClear: 80, // ~58px tab bar + safe-area + gap, also clears the orb
  breakpoint: 640,
}

function miniSize(vw) {
  const mobile = vw < MINI.breakpoint
  const w = mobile ? Math.min(MINI.mobileMaxW, vw - 2 * MINI.mobileMargin) : MINI.desktopW
  return { w, h: Math.round((w * 9) / 16), mobile }
}

// mode: 'docked' → fill the slot rect. Otherwise the floating mini, placed at
// the user's saved free-drag `pos` (clamped on screen) or, if none, bottom-right.
export function computeHostStyle(mode, dockRect, vw, vh, pos) {
  if (mode === 'docked' && dockRect) {
    return {
      top: dockRect.top,
      left: dockRect.left,
      width: dockRect.width,
      height: dockRect.height,
    }
  }
  const { w, h, mobile } = miniSize(vw)
  const bottomClear = mobile ? MINI.mobileBottomClear : MINI.desktopMargin
  if (pos) {
    const c = clampMiniPos(pos, w, h, vw, vh, bottomClear)
    return { top: c.top, left: c.left, width: w, height: h }
  }
  const margin = mobile ? MINI.mobileMargin : MINI.desktopMargin
  return { top: vh - h - bottomClear, left: vw - w - margin, width: w, height: h }
}

// The per-frame scroll pin. The docked host's top/left come from React (the last
// reported slot rect = `baseRect`); this returns the GPU transform that offsets
// it to the slot's LIVE on-screen rect so it tracks native scroll 1:1 with no
// React round-trip. Empty string (identity) when already aligned, when the slot
// has no size yet, or when either rect is missing.
export function dockPinTransform(liveRect, baseRect) {
  if (!liveRect || !baseRect) return ''
  if (!(liveRect.width > 0 || liveRect.height > 0)) return ''
  const dx = liveRect.left - baseRect.left
  const dy = liveRect.top - baseRect.top
  return dx || dy ? `translate3d(${dx}px, ${dy}px, 0)` : ''
}
