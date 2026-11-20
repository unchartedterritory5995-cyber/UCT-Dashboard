// The one-row header ladder (owner 11-14): how it FITS. The /charts chart header stays ONE row at every width and
// sheds in steps as the pane narrows (ChartPane's ladder levels). Each step is one more render, taken synchronously
// before paint until the row stops clipping. The level itself is ChartPane state (the levels shape the very
// content whose change re-fits it); this hook owns the effects that move it.
//
// ⚡ A SYMBOL SWITCH NO LONGER CLIMBS THE WHOLE LADDER (2026-11-19). A new symbol / header text / info row reset
// the row to level 0 at once and re-climbed it before paint: up to ~10 synchronous re-renders of the pane (and of
// StockChart under it) plus a forced layout read per step, 24-35 ms of layout and ~70 ms of a daily switch's path
// to the screen (production CPU profiles, 2026-11-19). Between two stocks of one list the fit is almost always the
// same level. Now a CONTENT change keeps the level it has (the climb still takes a step if the new text clips),
// and the re-fit from the full row runs once the content has rested REFIT_REST_MS: a member scanning never pays
// it, one who stops sees the header take back any room it can. A WIDER pane or the mode turning on still resets at
// once, as before.
import { useEffect, useLayoutEffect, useRef } from 'react'

/** How long the header content must stay the same before the row re-fits from its full width. */
export const REFIT_REST_MS = 1500

/**
 * @param {object} o
 * @param {boolean} o.on        one-row mode
 * @param {number}  o.width     the pane width (a wider pane re-fits at once)
 * @param {string}  o.content   what is shown (symbol, label, info fields...): a change re-fits once it rests
 * @param {number}  o.level     the current level (ChartPane state)
 * @param {(fn: (l: number) => number) => void} o.setLevel
 * @param {number}  o.max       the last level
 * @param {() => boolean} o.isClipped  is anything in the row clipped right now (read in a layout effect)
 */
export default function useRowLadder({ on, width, content, level, setLevel, max, isClipped }) {
  const widthRef = useRef(null)
  // a wider pane (or the first measure) re-fits from the full row at once; narrowing keeps the steps taken
  useLayoutEffect(() => {
    if (!on) return
    const prev = widthRef.current
    widthRef.current = width
    if (prev == null || !Number.isFinite(width) || width > prev) setLevel(() => 0)
  }, [on, width, setLevel])
  // the mode turning on starts from the full row
  useLayoutEffect(() => { if (on) setLevel(() => 0) }, [on, setLevel])
  // new content: re-fit only once it has rested (a scan never pays the climb)
  useEffect(() => {
    if (!on) return undefined
    const t = setTimeout(() => setLevel((l) => (l === 0 ? l : 0)), REFIT_REST_MS)
    return () => clearTimeout(t)
  }, [on, content, setLevel])
  // one more step while anything is clipped, synchronously before paint
  useLayoutEffect(() => {
    if (!on || level >= max) return
    if (isClipped()) setLevel((l) => Math.min(max, l + 1))
  })
}
