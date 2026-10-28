// app/src/testing/cssMediaAt.js
//
// "Which @media blocks of this stylesheet APPLY on this device?" for structural CSS rails.
// jsdom evaluates no media queries, so the rails parse the conditions themselves.
//
// A device is `{ width, pointer }` (`pointer` is 'fine' | 'coarse', default 'fine': a mouse).
// A media query LIST (comma-separated) applies when ANY of its queries does; a query applies
// when EVERY feature in it holds. Understood: `max-width` / `min-width` in px,
// `pointer: coarse|fine`, the `screen`/`all` media types and the `only` prefix.
// ⛔ Anything else makes that query NOT apply -- an unknown feature (orientation, hover,
// prefers-*), a `not` query, a `print` type. An unknown condition is never assumed true, so a
// rail cannot pass on a block this parser did not actually evaluate.
// ⛔ A NESTED @media applies only when its parent does too, and its rules are never counted as
// part of the parent's body.
//
// ⚰️ The two TickerPopup rails each carried a width-only copy of this, so a
// `(pointer: coarse)` block (the touch iPad in landscape, 1194px) could never count.

/** Does one media query (no commas) hold on `device`? */
export function queryApplies(query, { width, pointer = 'fine' }) {
  const q = query.trim()
  if (/^not\b/i.test(q)) return false
  // the part outside parentheses: an optional `only`, an optional media type, `and`s
  const bare = q.replace(/\([^)]*\)/g, ' ').replace(/\band\b/gi, ' ').trim().split(/\s+/).filter(Boolean)
  const words = bare[0] && bare[0].toLowerCase() === 'only' ? bare.slice(1) : bare
  if (words.length > 1 || (words.length === 1 && !/^(screen|all)$/i.test(words[0]))) return false
  const features = [...q.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim())
  if (!features.length) return words.length === 1
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

/** Top-level @media blocks of `css`: [{ cond, body }] (body still holds any nested blocks). */
function topLevelMedia(css) {
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
    out.push({ cond: m[1], body: css.slice(re.lastIndex, i - 1), start: m.index, end: i })
    re.lastIndex = i   // never re-enter this block: its nested @media are its own
  }
  return out
}

/** Remove every @media block from `css`, leaving its plain rules. */
function withoutMedia(css) {
  let out = ''
  let at = 0
  for (const b of topLevelMedia(css)) { out += css.slice(at, b.start); at = b.end }
  return out + css.slice(at)
}

/** Bodies of the @media blocks of `css` that apply on `device`, joined (nested ones included
 *  only when every enclosing block applies too). */
export function mediaBodiesOn(css, device) {
  const out = []
  for (const b of topLevelMedia(css)) {
    if (!mediaApplies(b.cond, device)) continue
    out.push(withoutMedia(b.body))
    const nested = mediaBodiesOn(b.body, device)
    if (nested) out.push(nested)
  }
  return out.join('\n')
}
