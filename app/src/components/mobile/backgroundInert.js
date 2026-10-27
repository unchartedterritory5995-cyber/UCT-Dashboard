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
const held = new WeakMap()   // element -> how many open sheets hold it inert

export function inertBackground(own) {
  if (typeof document === 'undefined' || !document.body) return () => {}
  const mine = []
  for (const el of [...document.body.children]) {
    if (el === own || (own && el.contains(own)) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
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
