// app/src/pages/desk/scrollContainer.js
//
// Find the element that actually scrolls, by MEASURING — never by name.
//
// ⛔ `document.querySelector('.main')` DOES NOT WORK IN THIS APP. Layout's
// scroller is a CSS Module (`Layout.module.css`), so the class in the DOM is
// hashed — `_main_l3b5w_13` today, something else after the next build. A
// literal `.main` silently matches nothing, the code falls back to `window`,
// and `window` does not scroll here (`.shell` is overflow:hidden). Everything
// downstream then reads a scrollTop that is permanently 0: a reading-progress
// bar that never moves, a scroll-spy that never highlights, a saved position
// that is always the top.
//
// That failure is invisible to jsdom, which has no such layout — so this walks
// the ancestors and asks each one whether it scrolls, which is true regardless
// of what anything is called.

/** The nearest scrolling ancestor of `el`, or `window` if nothing scrolls. */
export function findScrollContainer(el) {
  let node = el?.parentElement || null
  while (node && node !== document.body && node !== document.documentElement) {
    if (isScrollable(node)) return node
    node = node.parentElement
  }
  // Some layouts really do scroll the document.
  const doc = document.scrollingElement || document.documentElement
  if (doc && doc.scrollHeight > doc.clientHeight + 1) return doc
  return window
}

function isScrollable(node) {
  let overflowY = ''
  try {
    overflowY = getComputedStyle(node).overflowY || ''
  } catch {
    return false
  }
  if (!/(auto|scroll|overlay)/.test(overflowY)) return false
  return node.scrollHeight > node.clientHeight + 1
}

/** The element whose scrollTop/scrollHeight to read, for either kind of target. */
export function scrollMetrics(container) {
  if (container === window || !container) {
    return document.scrollingElement || document.documentElement
  }
  return container
}
