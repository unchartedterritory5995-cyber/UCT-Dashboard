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
// ⛔ W11-R80 / W11-R82 (review I-1): ONE layer kind stays live, and only while it is drawn ABOVE this sheet: a <body>
// child marked `data-sheet-keep-live="<its z-index>"` (GlobalVideoLayer's player host, a portal for this reason: inert
// is inherited, so nothing INSIDE an inert #root can be exempted). `inert` hit-tests like `pointer-events: none`, so a
// layer above the scrim must stay live or a tap on it falls through to the backdrop. A layer UNDER the scrim (the player
// under a sheet lifted above it, the popup a sheet was opened from once the sheet is lifted above it, a menu portal) is
// covered: nothing can reach it, so it is inert like the rest of the page (R82: the opener-layer skip is gone).
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

/** The z a keep-live layer is drawn at: the higher of its computed z-index and the one its marker declares (the marker
 *  carries the layer's own number, e.g. `data-sheet-keep-live="8500"`, read where CSS cannot be: jsdom, a stylesheet
 *  not yet applied). NaN when neither is a number: such a layer is never kept live. */
function layerZOf(el) {
  const a = parseInt(el.getAttribute(KEEP_LIVE), 10)
  const c = typeof getComputedStyle === 'function' ? parseInt(getComputedStyle(el).zIndex, 10) : NaN
  const zs = [a, c].filter(Number.isFinite)
  return zs.length ? Math.max(...zs) : NaN
}

/** The rung every Sheet backdrop sits on unless lifted (`--z-modal`, tokens.css). */
export const MODAL_Z = 1000

export function inertBackground(own, sheetZ = MODAL_Z) {
  if (typeof document === 'undefined' || !document.body) return () => {}
  const mine = []
  for (const el of [...document.body.children]) {
    if (el === own || (own && el.contains(own)) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
    if (el.hasAttribute(KEEP_LIVE) && layerZOf(el) > sheetZ) continue   // drawn ABOVE this sheet: kept live
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
