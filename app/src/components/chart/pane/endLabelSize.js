// ⚡ THE LINE-END TAG'S BOX, MEASURED ONCE PER TEXT (2026-11-26, the 4h board's switch).
//
// `pinEndLabel` (StockChart) places each tag from its own box (`endLabel.endLabelPlacement` needs its width and height).
// It read `offsetWidth` / `offsetHeight` on EVERY pin, and a pin runs inside the commit that has just changed the DOM,
// so each read forced a layout of the page in the middle of the key task: 1.46 ms of the 4h board's switch (production
// build, flip proof, sampled under `pinEndLabel`), before the layout the frame itself does.
//
// The tag's box depends on its TEXT only: `PlotEndLabel.module.css` fixes its type (11 px, 600, the mono face), its
// padding, borders and height (16 px, border-box). So the box is read once per element and text and kept; it is read
// again when the text changes, when the fonts finish loading (the mono face arriving changes every width), and after a
// window resize (a browser zoom). A box read as zero (an element not laid out: a hidden board) is never kept.

let sizeEpoch = 0
const bump = () => { sizeEpoch += 1 }
try {
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.addEventListener === 'function') {
    document.fonts.addEventListener('loadingdone', bump)
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', bump)
  // (review of #2831, LOW) a document-level token change: a theme that repointed `--font-mono` (set on the root's style,
  // class or data-theme) to a font already loaded fires no 'loadingdone'; any such change reads every box again
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
    new MutationObserver(bump).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
  }
} catch { /* no font or window events: every read is kept until the text changes */ }

/** Every kept box is read again from here on (tests; a style change a caller knows of). */
export function invalidateEndLabelSizes() { bump() }

/** A sizer for one chart: `(el, text) => { w, h }`, the element's box for that text. */
export function createEndLabelSizer() {
  const kept = new WeakMap()
  return (el, text) => {
    const k = kept.get(el)
    if (k && k.text === text && k.epoch === sizeEpoch) return k
    const box = { text, w: el.offsetWidth, h: el.offsetHeight, epoch: sizeEpoch }
    if (box.w > 0 && box.h > 0) kept.set(el, box)
    else kept.delete(el)
    return box
  }
}
