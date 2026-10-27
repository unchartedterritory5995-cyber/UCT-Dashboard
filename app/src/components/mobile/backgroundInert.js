// The page behind an open Sheet is `inert` (11.20 walk D6). ONE owner: Sheet.jsx calls `inertBackground` once per open.
//
// What it does: every child of <body> that exists when the sheet opens, except the sheet's own backdrop, gets the
// `inert` attribute, so it leaves the accessibility tree (a screen reader's virtual cursor and axe, which honours
// `inert`), the Tab order and the pointer. `aria-modal` alone constrains none of those for a <div role="dialog">.
//   * Snapshot at open: what mounts LATER (a nested sheet, a menu or picker the sheet's own content portals to <body>,
//     a toast) is untouched, so a sheet never disables its own children.
//   * Nested sheets: the inner one's snapshot holds the outer one's backdrop, so only the topmost sheet is live.
//   * Ref-counted per element, and an element that was inert before any sheet touched it is never touched at all,
//     so closing never un-inerts something another owner made inert.
// The returned release must run BEFORE focus is restored to the opener (an inert element cannot take focus): Sheet
// declares this effect before its focus effect, and React runs cleanups in declaration order.
//
// ⛔ W11-R80 (review I-1): two layers stay LIVE, because the app draws them ABOVE every modal and `inert` hit-tests
// like `pointer-events: none` (a tap on them would fall through to the sheet's backdrop and close it):
//   * a <body> child marked `data-sheet-keep-live` (GlobalVideoLayer's player host, z 8500, a portal for this reason:
//     inert is inherited, so nothing INSIDE an inert #root can be exempted);
//   * the opener's own layer (`openerLayer`): the <body> portal the sheet was opened from, when that is neither the
//     app root nor another sheet (TickerPopup's modal, z 8600). A nested sheet's outer sheet is still made inert.
const held = new WeakMap()   // element -> how many open sheets hold it inert
const KEEP_LIVE = 'data-sheet-keep-live'

/** The <body> portal `opener` sits in, when it is a layer of its own (not #root, not a sheet), with the highest
 *  numeric z-index on the way up to it; null otherwise. */
export function openerLayer(opener) {
  if (typeof document === 'undefined' || !opener || !opener.isConnected || !document.body) return null
  let host = opener
  let z = null
  while (host && host.parentElement && host.parentElement !== document.body) {
    const n = parseInt(getComputedStyle(host).zIndex, 10)
    if (Number.isFinite(n)) z = z === null ? n : Math.max(z, n)
    host = host.parentElement
  }
  if (!host || host.parentElement !== document.body) return null
  if (host.id === 'root' || host.querySelector('[data-sheet-panel]')) return null
  const n = parseInt(getComputedStyle(host).zIndex, 10)
  if (Number.isFinite(n)) z = z === null ? n : Math.max(z, n)
  return { el: host, z }
}

export function inertBackground(own, opener = null) {
  if (typeof document === 'undefined' || !document.body) return () => {}
  const mine = []
  const layer = openerLayer(opener)?.el || null
  for (const el of [...document.body.children]) {
    if (el === own || (own && el.contains(own)) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
    if (el === layer || el.hasAttribute(KEEP_LIVE)) continue      // W11-R80: drawn above the modal, kept live
    const n = held.get(el)
    if (n === undefined) {
      if (el.hasAttribute('inert')) continue        // somebody else's: leave it exactly as it is
      el.setAttribute('inert', '')
      held.set(el, 1)
    } else {
      held.set(el, n + 1)
    }
    mine.push(el)
  }
  return () => {
    for (const el of mine) {
      const n = held.get(el)
      if (n === undefined) continue
      if (n <= 1) {
        held.delete(el)
        el.removeAttribute('inert')
      } else {
        held.set(el, n - 1)
      }
    }
  }
}
