// Built widget views (wave 8, Task 8.14): what every inline-SVG view shares.
//
// Ruling R-31: a chart is laid out in REAL pixels. Its container's width is measured (ResizeObserver) and the SVG's
// viewBox is exactly that wide, so 12 px text is 12 px on a phone and on a wide desktop alike, and a 44 px hit area
// is 44 px. Where nothing can be measured (jsdom, a first render) the width is `W`. A test injects a width with the
// view's `width` prop.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsTouch } from '../../../../../../hooks/useBreakpoint'

export const W = 600
/** The touch tier's finger floor (tokens.css --tap-min), and the desktop mark size. */
export const TAP = 44
export const MARK = 28

/** How far (px) a width may flip back to one seen recently and still count as a flip, how many reads are kept,
 *  how long a read is remembered, and how long after the last observer event the box is read once more. */
export const FLIP_PX = 20
export const FLIP_READS = 4
export const SEEN_MS = 1000
export const SETTLE_MS = 400

/**
 * `[ref, width]`: put `ref` on the box the chart fills; `width` is its measured width in px (or `forced`, or W).
 *
 * ⛔ A CALLBACK ref, so a view that first renders empty (no box) and later gets rows still measures its box the
 * moment the box exists. ⛔ It reads `contentRect.width` / `clientWidth` (the box's own content width, never the
 * transformed rect).
 *
 * ⛔ HYSTERESIS (rule H14, a ResizeObserver loop). A scrollbar that appears narrows the box, the narrower chart can
 * make the scrollbar go, the box widens, and so on forever. The built widget's frame reserves its scrollbar gutter
 * (SnapshotFrame `frameGutter`), which removes the usual cause; this guards every other one. A FLIP is a change of
 * FLIP_PX or less to a width seen in the last FLIP_READS reads (each remembered SEEN_MS). On a flip the NARROWER
 * width wins (it fits whether or not the scrollbar is there) and a widen is ignored. Because an ignored widen may
 * have been real (the scrollbar went for good, or the member is dragging the box), the box is read once more
 * SETTLE_MS after the last observer event, and that reading is taken if no flip happened in that window. Every
 * ignored widen arms that read, even in a pair that has had one already, but a PAIR gets at most one trailing read
 * per SEEN_MS: a read asked for sooner waits until the pair's window opens. So a real drag always ends at the box's
 * clientWidth, and a loop the gutter did not remove can cost at most one re-measure a second, never a storm.
 */
export function useChartWidth(forced) {
  const [measured, setMeasured] = useState(0)
  const current = useRef(0)
  const seen = useRef([])          // [{w, t}]
  const ro = useRef(null)
  const box = useRef(null)
  const timer = useRef(null)
  const lastFlip = useRef(0)
  const trailed = useRef(new Map()) // flip pair -> when it last had a trailing read
  const pending = useRef(null)      // the flip pair a trailing read is for
  const take = useCallback((w) => {
    if (w <= 0 || w === current.current) return
    current.current = w
    setMeasured(w)
  }, [])
  const read = useCallback((raw) => {
    const w = Math.floor(raw || 0)
    if (w <= 0) return
    const now = Date.now()
    seen.current = seen.current.filter((e) => now - e.t < SEEN_MS)
    const cur = current.current
    const flip = cur > 0 && w !== cur && Math.abs(w - cur) <= FLIP_PX && seen.current.some((e) => e.w === w)
    seen.current = [...seen.current, { w, t: now }].slice(-FLIP_READS)
    // Any observer event pushes the trailing read back (it comes SETTLE_MS after the LAST one).
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (flip) {
      lastFlip.current = now
      const pair = `${Math.min(w, cur)}:${Math.max(w, cur)}`
      if (w < cur) take(w)                         // the narrower width fits either way
      else pending.current = pair                  // an ignored widen: read the box again once it settles
    }
    if (pending.current) {
      // SETTLE_MS after this event, or later if the pair had its trailing read under SEEN_MS ago.
      const last = trailed.current.get(pending.current)
      const wait = Math.max(SETTLE_MS, typeof last === 'number' ? last + SEEN_MS - now : 0)
      timer.current = setTimeout(() => {
        timer.current = null
        const pair = pending.current
        pending.current = null
        if (!pair || !box.current || Date.now() - lastFlip.current < SETTLE_MS) return
        trailed.current.set(pair, Date.now())
        take(Math.floor(box.current.clientWidth || 0))
      }, wait)
    }
    if (!flip) take(w)
  }, [take])
  const ref = useCallback((el) => {
    if (ro.current) { ro.current.disconnect(); ro.current = null }
    box.current = el
    if (!el || forced > 0) return
    read(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    ro.current = new ResizeObserver((entries) => {
      const e = entries && entries[0]
      read(e && e.contentRect ? e.contentRect.width : el.clientWidth)
    })
    ro.current.observe(el)
  }, [forced, read])
  useEffect(() => () => {
    if (ro.current) ro.current.disconnect()
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const width = forced > 0 ? forced : (measured > 0 ? measured : W)
  return [ref, width]
}

/** The smallest hit area a mark may have on this device: 44 px on the touch tier, 28 px with a mouse. */
export function useHitFloor() {
  return useIsTouch() ? TAP : MARK
}

/**
 * Was the last input a key (Tab, an arrow, Escape) rather than a pointer? A view shows a mark's readout on FOCUS only
 * then: focus that comes back to a mark after a mouse click (a drill panel's Close button) must not leave a readout
 * standing after the pointer has gone. The listeners go on once, in the capture phase, so nothing can stop them.
 */
let lastInput = 'key'
let tracking = false
export function trackInputKind() {
  if (tracking || typeof document === 'undefined') return
  tracking = true
  const pointer = () => { lastInput = 'pointer' }
  document.addEventListener('keydown', () => { lastInput = 'key' }, true)
  document.addEventListener('pointerdown', pointer, true)
  document.addEventListener('mousedown', pointer, true)
  document.addEventListener('touchstart', pointer, { capture: true, passive: true })
}
export const lastInputWasKey = () => lastInput === 'key'

/** The rough width of `text` at `px` (average glyph 0.6 em), for laying out columns before paint. */
export const textW = (text, px = 12) => String(text ?? '').length * px * 0.6

/** A label short enough for `maxW` px, with an ellipsis; the full label stays in the mark's name and title. */
export function clipText(text, maxW, px = 12) {
  const t = String(text ?? '')
  const max = Math.max(3, Math.floor(maxW / (px * 0.6)))
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** `n` evenly spaced positions across [a, b] (one in the middle when there is one). */
export function spread(n, a, b) {
  if (n <= 1) return [(a + b) / 2]
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

/** A scale from [lo, hi] onto [a, b]; a flat range maps to the middle. */
export function scale(lo, hi, a, b) {
  const span = hi - lo
  return (v) => (span ? a + ((v - lo) / span) * (b - a) : (a + b) / 2)
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** An id safe inside `url(#...)` (React's useId carries colons). */
export const svgId = (raw) => String(raw).replace(/[^A-Za-z0-9_-]/g, '')

/** Line dash patterns, one per measure, so lines never differ by colour alone. */
export const DASHES = ['', '7 4', '2 3']
