/**
 * "The pixels in this box are not the artifact."
 *
 * One attribute, spread onto every frame a component renders INSTEAD of its
 * real content — a loading skeleton, a placeholder chip, an error card, an
 * empty-range notice. Anything that rasterizes a subtree as durable evidence
 * (today: the journal's widget-embed self-archive) refuses to capture a box
 * that contains one.
 *
 * ⛔ ONE constant, imported by both sides. The producer (StockChart, the
 * notebook's WidgetEmbedView) and the consumer (embed self-archive) must never
 * hand-hold the same attribute string in two files — that is the drift this
 * repo keeps paying for, and the failure is silent: the guard simply stops
 * matching and the next bad frame is archived as evidence.
 *
 * Why an attribute on the MARKUP rather than a component-state check: every
 * route to a non-content frame (a lazy chunk still loading, a thrown render
 * caught by an error boundary, an off-screen node view, a failed bars fetch)
 * lands in the DOM the same way, so the consumer never has to enumerate them.
 */
export const RENDER_UNAVAILABLE_ATTR = 'data-render-unavailable'

/** Spread onto the element that stands in for the real content:
 *  `<div className={styles.error} {...RENDER_UNAVAILABLE}>` */
export const RENDER_UNAVAILABLE = { [RENDER_UNAVAILABLE_ATTR]: '' }

/** What a capture routine queries before rasterizing. Derived from the
 *  attribute above so the two can never disagree. */
export const RENDER_UNAVAILABLE_SELECTOR = `[${RENDER_UNAVAILABLE_ATTR}]`

/** True when `el` is showing a stand-in rather than its real content, and so
 *  must not be rasterized as evidence. Null/absent element → treated as
 *  unsafe: there is nothing to capture. */
export function showsUnavailableFrame(el) {
  return !el || !!el.querySelector(RENDER_UNAVAILABLE_SELECTOR)
}
