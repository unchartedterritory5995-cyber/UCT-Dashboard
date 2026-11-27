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
//
// ⚡ AND THE RESTED RE-FIT TAKES BACK ROOM FROM WHERE IT IS (2026-11-26, the #2801 capture: a 30 ms task with 24 forced
// layouts ~1.5 s after every switch, on every board). It reset the row to level 0 and climbed back, one render and one
// forced layout per level. Each level only sheds from the one before (a narrower row), so the levels that fit are a
// run from the fitted level up: walking DOWN from the level the row has until one clips, then stepping back up one,
// lands on exactly the level the climb from 0 finds. When the fit is unchanged (two stocks of one list, almost always)
// that is two renders, not one per level; the header ends on the same level, so it looks the same.
//
// ⚡ AND A REMOUNTED PANE STARTS AT ITS LAST FIT (2026-11-26, the board switch: every chart pane mounts anew and climbed
// from the full row, one render of the pane and StockChart plus one forced layout per level: 4.7 ms of a two-chart board
// switch). `startLevelFor(width)` names the level this pane last fitted at that width (ChartPane remembers it per chart);
// the pane starts there and checks it as the rested re-fit does: one step down, and back up one at the first that clips.
// Too high (a shorter header) walks on down; too low climbs on up: either way the level the climb from 0 finds.
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
 * @param {(width: number) => number} [o.startLevelFor]  the level this pane last fitted at `width` (0: none)
 * @param {(level: number) => void} [o.onSettled]  the row fits at `level` (no step pending)
 */
export default function useRowLadder({ on, width, content, level, setLevel, max, isClipped, startLevelFor = null, onSettled = null }) {
  const widthRef = useRef(null)
  const levelRef = useRef(level)
  levelRef.current = level
  // a rested re-fit walking down: the content it started on (a new switch, a wider pane or the mode ends it)
  const descentRef = useRef(null)
  // a start at a remembered level, set this commit: the fit is checked from the render that shows it
  const pendingStartRef = useRef(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const startFrom = () => {
    const l = startLevelFor ? Math.min(max, Math.max(0, Math.floor(startLevelFor(width) || 0))) : 0
    if (l > 0) { descentRef.current = contentRef.current; pendingStartRef.current = l; setLevel(() => l) }
    else { descentRef.current = null; pendingStartRef.current = null; setLevel(() => 0) }
  }
  // a wider pane (or the first measure) re-fits at once, from the level it last fitted at this width (else the full
  // row); narrowing keeps the steps taken
  useLayoutEffect(() => {
    if (!on) return
    const prev = widthRef.current
    widthRef.current = width
    if (prev == null || !Number.isFinite(width) || width > prev) startFrom()
  }, [on, width, setLevel])   // eslint-disable-line react-hooks/exhaustive-deps
  // the mode turning on starts the same way
  useLayoutEffect(() => { if (on) startFrom() }, [on, setLevel])   // eslint-disable-line react-hooks/exhaustive-deps
  // new content: re-fit only once it has rested (a scan never pays it), walking down from the level it has
  useEffect(() => {
    if (!on) return undefined
    const t = setTimeout(() => {
      if (levelRef.current <= 0) return
      descentRef.current = content
      setLevel((l) => Math.max(0, l - 1))
    }, REFIT_REST_MS)
    return () => clearTimeout(t)
  }, [on, content, setLevel])
  // synchronously before paint: on a re-fit's way down, one more level while the row fits and back up one at the first
  // that clips; otherwise one more step up while anything is clipped
  useLayoutEffect(() => {
    if (!on) return
    // a start at a remembered level was set this commit: the check runs on the render that shows that level
    if (pendingStartRef.current !== null) {
      if (level !== pendingStartRef.current) return
      pendingStartRef.current = null
    }
    if (descentRef.current !== null && descentRef.current !== content) descentRef.current = null
    if (descentRef.current !== null) {
      if (isClipped()) { descentRef.current = null; setLevel((l) => Math.min(max, l + 1)); return }
      if (level > 0) { setLevel((l) => Math.max(0, l - 1)); return }
      descentRef.current = null
      onSettled?.(level)
      return
    }
    if (level >= max) { onSettled?.(level); return }
    if (isClipped()) setLevel((l) => Math.min(max, l + 1))
    else onSettled?.(level)
  })
}
