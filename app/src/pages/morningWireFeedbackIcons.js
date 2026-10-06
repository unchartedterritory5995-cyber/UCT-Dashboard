// Static SVG markup for the Morning Wire feedback controls.
//
// The rundown is `dangerouslySetInnerHTML`, so its 👍 / 👎 / ✎ controls are injected as
// HTML strings, not React elements — a `<UIcon>` cannot be mounted there. These strings
// carry the SAME path data as `UIcon`'s `thumbsUp`, `thumbsDown` and `edit` glyphs, drawn
// in `currentColor` (UIcon's `gold={false}` form) so the injected button's CSS colour
// themes them like every other icon.
//
// ⛔ Copied path data is a second authority, so it is railed:
// `morningWireFeedbackIcons.test.jsx` renders the real UIcon glyphs and fails if these
// paths drift from them. If UIcon ever exports a static-markup helper, use that instead.

const PATHS = {
  thumbsUp: [
    'M4.5 11h2.5v9H4.5z',
    'M7 11l3.4-6.6a2 2 0 0 1 1.9 2.6L11.5 11h5.6a1.8 1.8 0 0 1 1.8 2.2l-1.3 5.5a2 2 0 0 1-2 1.3H7',
  ],
  thumbsDown: [
    'M19.5 13H17V4h2.5z',
    'M17 13l-3.4 6.6a2 2 0 0 1-1.9-2.6L12.5 13H6.9a1.8 1.8 0 0 1-1.8-2.2l1.3-5.5a2 2 0 0 1 2-1.3H17',
  ],
  edit: ['M14 4.8l5.2 5.2M4 20l1-4.2L16 4.8a2.1 2.1 0 0 1 3 3L8 19z'],
}

export const FEEDBACK_ICON_PATHS = PATHS

/** `<svg>` markup for one feedback glyph, sized in px, stroked in currentColor. */
export function feedbackIconSvg(name, size = 14) {
  const paths = PATHS[name]
  if (!paths) return ''
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
    ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    paths.map((d) => `<path d="${d}"></path>`).join('') +
    '</svg>'
  )
}
