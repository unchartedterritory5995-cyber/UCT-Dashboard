/**
 * Where the voice first-run hint sits (VoiceInputButton) -- wave 10 follow-up F1.
 *
 * The hint hangs above the mic, and it used to start at the mic's LEFT edge
 * whatever was to its right: 230 px from a mic right of centre -- the Notebook
 * toolbar on a 390 px phone puts it at x 263 -- ran to x 493, and the app's own
 * scroller (<main>, which scrolls instead of the window) grew sideways to 496 px.
 * Measured in real Chromium by walk row B9d (tools/notebook_wave10b_walk.py).
 *
 * The hint now starts at the mic when it fits and slides left just enough to end
 * HINT_GUTTER short of the viewport's right edge; it never starts left of the
 * gutter either. Its width is capped at the viewport less both gutters, so it
 * always fits. Pure, so it is unit-tested without layout
 * (VoiceInputButton.placement.test.jsx).
 */
export const HINT_GUTTER = 16

/** The hint's `left`, in px, relative to the mic's wrapper (its containing block). */
export function placeHint({ anchorLeft, hintWidth, viewportWidth }) {
  const maxLeft = viewportWidth - HINT_GUTTER - hintWidth
  const left = Math.max(HINT_GUTTER, Math.min(anchorLeft, maxLeft))
  return left - anchorLeft
}
