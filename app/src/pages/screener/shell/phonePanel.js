// The phone placement for the screener's two anchored menus (spec A7, 2026-11-07):
// the "Screener" starter menu (ScreensManager) and the Columns picker (ColumnPicker).
// Since B10 (2026-11-07) also the toolbar seal's provenance panel (ShellToolbar): the
// phone toolbar scrolls sideways, and a scroller would clip an absolute popover.
//
// Both are `position: absolute; right: 0` under a trigger that sits at the LEFT of
// the toolbar, so on a phone they ran off the left edge of the screen. At <= 640 px
// they become a panel pinned to the viewport instead: 8 px from each side, under the
// trigger when there is room, max 70vh, scrolling inside. Desktop and tablet keep the
// anchored popover untouched (this returns null there).
//
// Decided when the menu OPENS, from matchMedia read then (never a hook seeded at
// mount, which is stale at first paint on a phone; see CLAUDE.md "useMediaQuery is
// stale at first paint"), and re-read on resize while it is open.
import { useLayoutEffect, useState } from 'react'
import { MQ } from '../../../styles/breakpoints'

export const PANEL_GUTTER = 8
// Below this much room under the trigger the panel docks to the bottom edge instead.
export const PANEL_MIN_ROOM = 240

export const isPhoneViewport = () =>
  typeof window !== 'undefined' && window.matchMedia?.(MQ.phone)?.matches === true

/** The fixed placement for a trigger whose box is `rect`, in a viewport `viewportH` tall.
 *  Pure, so the geometry is testable without layout. */
export function phonePanelStyle(rect, viewportH) {
  const cap = Math.round(viewportH * 0.7)
  const top = Math.round((rect?.bottom ?? 0) + 4)
  const room = viewportH - top - PANEL_GUTTER
  const base = {
    position: 'fixed', left: PANEL_GUTTER, right: PANEL_GUTTER,
    width: 'auto', minWidth: 0, maxWidth: 'none', boxSizing: 'border-box',
  }
  if (room >= Math.min(cap, PANEL_MIN_ROOM)) {
    return { ...base, top, bottom: 'auto', maxHeight: Math.min(cap, room) }
  }
  return { ...base, top: 'auto', bottom: PANEL_GUTTER, maxHeight: cap }
}

/** `style` for an open menu: the phone panel placement, or `undefined` (CSS decides).
 *  `anchorRef` is the element the menu hangs under (its trigger, or the trigger's wrapper). */
export function usePhonePanel(open, anchorRef) {
  const [style, setStyle] = useState(undefined)
  useLayoutEffect(() => {
    if (!open) { setStyle(undefined); return undefined }
    const place = () => {
      if (!isPhoneViewport()) { setStyle(undefined); return }
      const rect = anchorRef.current?.getBoundingClientRect?.()
      setStyle(phonePanelStyle(rect, window.innerHeight))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchorRef])
  return style
}
