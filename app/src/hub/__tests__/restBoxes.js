// app/src/hub/__tests__/restBoxes.js
//
// ONE implementation of "where does this hub element sit at rest, and do two of them collide",
// shared by every rail that asks. Nothing in the app imports this — it is test support, and it
// lives beside the components it measures for the same reason `styles/__tests__/contrastMath.js`
// lives beside `tokens.css`.
//
// ⛔ WHY IT IS A MODULE AND NOT A COPY IN EACH TEST. `feedbackIsOneTap.test.jsx` carried a private
// `sumPx`/`boxOf`/`overlaps` and pointed them at ONE element — the feedback button — against every
// other. The machinery was therefore already capable of catching the chip sitting under the
// Actions button, and did not, because nothing asked it that pair
// (`lesson_a_guard_that_tests_the_adjacent_thing`). G3-15 was then found on real glass instead, at
// the cost of a device session. The fix is not a second copy of this arithmetic in a second file;
// it is one copy that both files point at whichever pair they care about.
//
// ⚠️ WHAT THIS CANNOT PROVE. jsdom performs no layout, so every rectangle here comes from the
// DECLARED inline style, never from `getBoundingClientRect()` — the same convention as
// `hubChipCollision.test.js`. `env(safe-area-inset-*)` reads as 0, the bare non-notched floor,
// which is the conservative case for a collision check: a real safe area only pushes the hub
// further from the bottom edge and can never hide an overlap that this reports as absent.

/** `calc(env(safe-area-inset-bottom) + 68px + 84px)` -> 152. env() reads as 0 (see the header). */
export const sumPx = (value) => [...String(value ?? '').matchAll(/(-?\d+(?:\.\d+)?)px/g)]
  .reduce((a, m) => a + Number(m[1]), 0)

/**
 * ⭐ AN AUTO-WIDTH ELEMENT EXTENDS INWARD WITHOUT LIMIT, and treating it that way is what makes
 * this rail conservative. The hub chip is `width: auto; white-space: nowrap` and grows away from
 * its anchored edge, so no declared number bounds it; assuming a width would be assuming the
 * answer. The guarantee for such an element is therefore its ANCHOR (or vertical separation),
 * never its extent — which is exactly the property G3-15 turned out to violate.
 */
export const INWARD_UNBOUNDED = 10000
/** A content-sized element may grow away from its anchored edge; assume generously. */
export const UNKNOWN_HEIGHT = 200

/**
 * The rest-state box of one element, in (inward-from-its-edge, up-from-the-bottom) space.
 * Elements anchored to the SAME edge are the only ones that can collide horizontally, and in this
 * hub every anchored element is on the same edge by construction (`mirrorsAsAUnit.test.jsx`).
 */
export function boxOf(el) {
  const s = el.style
  const edge = s.right && s.right !== 'auto' ? sumPx(s.right) : sumPx(s.left)
  const width = sumPx(s.width) || sumPx(s.minWidth) || INWARD_UNBOUNDED
  const bottom = sumPx(s.bottom)
  const height = sumPx(s.height) || sumPx(s.minHeight) || UNKNOWN_HEIGHT
  return { x0: edge, x1: edge + width, y0: bottom, y1: bottom + height }
}

/** Do two rest-state boxes intersect? Touching edges do not count as an overlap. */
export const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** A readable name for an element, for failure messages. */
export const nameOf = (el) => el.getAttribute('data-testid') || el.getAttribute('aria-label')
  || `<${el.tagName.toLowerCase()} class="${el.className}">`
