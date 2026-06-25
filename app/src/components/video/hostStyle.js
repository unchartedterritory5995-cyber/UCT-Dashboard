// Pure positioning math for the fixed video host. Both modes return
// {top,left,width,height} so the CSS transition animates the same four props
// for a smooth dock<->mini shrink/grow. Responsive sizing reads the passed-in
// viewport (caller uses window.innerWidth/Height, correct at first paint — we
// deliberately avoid useMediaQuery, which is stale at first paint).
export const MINI = {
  desktopW: 360,
  desktopMargin: 18,
  mobileMaxW: 220,
  mobileMargin: 12,
  mobileBottomClear: 80, // ~58px tab bar + safe-area + gap, also clears the orb
  breakpoint: 640,
}

function miniRect(corner, vw, vh) {
  const mobile = vw < MINI.breakpoint
  const w = mobile ? Math.min(MINI.mobileMaxW, vw - 2 * MINI.mobileMargin) : MINI.desktopW
  const h = Math.round((w * 9) / 16)
  const sideMargin = mobile ? MINI.mobileMargin : MINI.desktopMargin
  const topMargin = mobile ? MINI.mobileMargin : MINI.desktopMargin
  const bottomMargin = mobile ? MINI.mobileBottomClear : MINI.desktopMargin
  const left = corner.includes('l') ? sideMargin : vw - w - sideMargin
  const top = corner.includes('t') ? topMargin : vh - h - bottomMargin
  return { top, left, width: w, height: h }
}

export function computeHostStyle(mode, corner, dockRect, vw, vh) {
  if (mode === 'docked' && dockRect) {
    return {
      top: dockRect.top,
      left: dockRect.left,
      width: dockRect.width,
      height: dockRect.height,
    }
  }
  return miniRect(corner, vw, vh)
}

// Map a point (e.g. a drag-drop position) to the nearest screen corner.
export function nearestCorner(x, y, vw, vh) {
  const v = y < vh / 2 ? 't' : 'b'
  const h = x < vw / 2 ? 'l' : 'r'
  return `${v}${h}`
}
