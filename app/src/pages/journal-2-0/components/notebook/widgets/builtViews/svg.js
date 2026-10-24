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

/** How far (px) a width may flip back to one seen recently and still be ignored, and how many reads are kept. */
export const FLIP_PX = 20
export const FLIP_READS = 4

/**
 * `[ref, width]`: put `ref` on the box the chart fills; `width` is its measured width in px (or `forced`, or W).
 *
 * ⛔ A CALLBACK ref, so a view that first renders empty (no box) and later gets rows still measures its box the
 * moment the box exists. ⛔ It reads `contentRect.width` / `clientWidth` (the box's own content width, never the
 * transformed rect). ⛔ HYSTERESIS (rule H14, a ResizeObserver loop): a chart that grows a scrollbar shrinks its
 * box, which can shrink the chart until the scrollbar goes, which grows the box back, forever. A change of
 * FLIP_PX or less back to a width seen in the last FLIP_READS reads is ignored, so the loop settles at once.
 */
export function useChartWidth(forced) {
  const [measured, setMeasured] = useState(0)
  const current = useRef(0)
  const seen = useRef([])
  const ro = useRef(null)
  const accept = useCallback((raw) => {
    const w = Math.floor(raw || 0)
    if (w <= 0) return
    const cur = current.current
    const flipBack = cur > 0 && w !== cur && Math.abs(w - cur) <= FLIP_PX && seen.current.includes(w)
    seen.current = [...seen.current, w].slice(-FLIP_READS)
    if (w === cur || flipBack) return
    current.current = w
    setMeasured(w)
  }, [])
  const ref = useCallback((el) => {
    if (ro.current) { ro.current.disconnect(); ro.current = null }
    if (!el || forced > 0) return
    accept(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    ro.current = new ResizeObserver((entries) => {
      const e = entries && entries[0]
      accept(e && e.contentRect ? e.contentRect.width : el.clientWidth)
    })
    ro.current.observe(el)
  }, [forced, accept])
  useEffect(() => () => { if (ro.current) ro.current.disconnect() }, [])
  const width = forced > 0 ? forced : (measured > 0 ? measured : W)
  return [ref, width]
}

/** The smallest hit area a mark may have on this device: 44 px on the touch tier, 28 px with a mouse. */
export function useHitFloor() {
  return useIsTouch() ? TAP : MARK
}

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
