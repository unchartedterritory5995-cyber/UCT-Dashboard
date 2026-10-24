// Built widget views (wave 8, Task 8.14): what every inline-SVG view shares.
//
// Ruling R-31: a chart is laid out in REAL pixels. Its container's width is measured (ResizeObserver) and the SVG's
// viewBox is exactly that wide, so 12 px text is 12 px on a phone and on a wide desktop alike, and a 44 px hit area
// is 44 px. Where nothing can be measured (jsdom, a first render) the width is `W`. A test injects a width with the
// view's `width` prop.
import { useLayoutEffect, useRef, useState } from 'react'
import { useIsTouch } from '../../../../../../hooks/useBreakpoint'

export const W = 600
/** The touch tier's finger floor (tokens.css --tap-min), and the desktop mark size. */
export const TAP = 44
export const MARK = 28

/** `[ref, width]`: put `ref` on the box the chart fills; `width` is its measured width in px (or `forced`, or W). */
export function useChartWidth(forced) {
  const ref = useRef(null)
  const [measured, setMeasured] = useState(0)
  useLayoutEffect(() => {
    if (forced > 0) return undefined
    const el = ref.current
    if (!el) return undefined
    const read = () => {
      const w = Math.floor(el.getBoundingClientRect?.().width || el.clientWidth || 0)
      if (w > 0) setMeasured((prev) => (prev === w ? prev : w))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [forced])
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
