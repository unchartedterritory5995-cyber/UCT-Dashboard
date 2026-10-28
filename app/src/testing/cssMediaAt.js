// app/src/testing/cssMediaAt.js
//
// "Which @media blocks of this stylesheet APPLY on this device?" for structural CSS rails.
// jsdom evaluates no media queries, so the rails parse the conditions themselves.
//
// A device is `{ width, pointer }` (`pointer` is 'fine' | 'coarse', default 'fine': a mouse).
// A media query LIST (comma-separated) applies when ANY of its queries does; a query applies
// when EVERY feature in it holds. Understood: `max-width` / `min-width` in px and
// `pointer: coarse|fine`. ⛔ Any other feature (orientation, hover, prefers-*) makes that
// query NOT apply -- an unknown condition is never assumed true, so a rail cannot pass on a
// block this parser did not actually evaluate.
//
// ⚰️ The two TickerPopup rails each carried a width-only copy of this, so a
// `(pointer: coarse)` block (the touch iPad in landscape, 1194px) could never count.

/** Does one media query (no commas) hold on `device`? */
export function queryApplies(query, { width, pointer = 'fine' }) {
  const features = [...query.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim())
  if (!features.length) return false
  for (const f of features) {
    let m
    if ((m = /^max-width:\s*(\d+)px$/.exec(f))) { if (width > Number(m[1])) return false; continue }
    if ((m = /^min-width:\s*(\d+)px$/.exec(f))) { if (width < Number(m[1])) return false; continue }
    if ((m = /^pointer:\s*(coarse|fine)$/.exec(f))) { if (pointer !== m[1]) return false; continue }
    return false
  }
  return true
}

/** Does a media query LIST hold on `device`? */
export function mediaApplies(list, device) {
  return list.split(',').some((q) => queryApplies(q, device))
}

/** Bodies of the @media blocks of `css` that apply on `device`, joined. */
export function mediaBodiesOn(css, device) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    let depth = 1
    let i = re.lastIndex
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
    }
    if (mediaApplies(m[1], device)) out.push(css.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}
