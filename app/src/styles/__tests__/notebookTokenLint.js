// VIS-6 (audit 2026-11-05): the scanner behind notebookTokens.lint.test.js.
//
// It reads the Notebook's styles and inline style objects and reports every OFF-TOKEN literal. A token
// (`var(--x)`) is never a literal: everything inside `var(...)`, fallbacks included, is stripped before a value is
// read, so `var(--radius-md, 6px)` is a token use -- except an OFF-SCALE token (`--text-xs`, the 10 px V1 says
// never to use), which is reported like a literal.
//
//   font-size       a px size not on the Notebook scale (11 12 13 14 17 20 24 36), any rem/em size, --text-xs;
//                   in the `font` shorthand only the part before `/` (the line height is not a size)
//   border-radius   a px radius not on the scale (0 4 6 8 12 999)
//   transition-all  `transition: all` / `transition-property: all`
//   raw-duration    a duration written as a number (`120ms`, `.15s`) in a transition or its delay
//   spacing         a padding / margin / gap px value off the 4 px steps (0 4 8 12 16 24 32 48, and 2 for
//                   icon-text pairs); negative margins read by their size
//   icon-size       a `<UIcon size={n}>` that is not 16 (toolbar) or 20 (nav) -- lib/notebookIcons.js
//
// Vendor prefixes are normalised (`-webkit-transition` is `transition`). Pure: no fs.
//
// ⛔ KNOWN GAPS (fix round 1, review 7, left open on purpose): a custom property holding a px length used as a
// size (`--fs: 15px; font-size: var(--fs)`), a ternary in a React style (`fontSize: big ? 15 : 13`) and a
// kebab-case style STRING in JS. The ratchet still holds what exists; these are where a new literal could hide.

export const FONT_SCALE = Object.freeze([11, 12, 13, 14, 17, 20, 24, 36])
export const RADIUS_SCALE = Object.freeze([0, 4, 6, 8, 12, 999])
export const SPACE_SCALE = Object.freeze([0, 2, 4, 8, 12, 16, 24, 32, 48])
export const ICON_SIZES = Object.freeze([16, 20])
/** Tokens that exist but are OFF the Notebook scale: a use is reported as a literal. */
export const OFF_SCALE_TOKENS = Object.freeze({ 'font-size': ['--text-xs'] })
export const RULES = Object.freeze(['font-size', 'border-radius', 'transition-all', 'raw-duration', 'spacing', 'icon-size'])

/** Remove every var(...) (nested parens included), so a token's fallback is never read as a literal. */
export function stripVars(value) {
  let out = ''
  let i = 0
  while (i < value.length) {
    if (value.startsWith('var(', i)) {
      let depth = 0
      let j = i + 3
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++
        else if (value[j] === ')') { depth--; if (depth === 0) break }
      }
      out += ' '
      i = j + 1
      continue
    }
    out += value[i]
    i++
  }
  return out
}

const pxValues = (value) => [...stripVars(value).matchAll(/(-?\d*\.?\d+)px\b/g)].map((m) => Number(m[1]))
const DURATION = /(?<![\w-])(\d*\.?\d+)(ms|s)\b/g
const SPACING_PROP = /^(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/

/** Findings for one declaration `prop: value`. Each finding is `{rule, value}` (value is a short literal). */
export function checkDeclaration(prop, value) {
  const p = String(prop).trim().toLowerCase().replace(/^-(webkit|moz|ms|o)-/, '')
  const v = String(value)
  const out = []
  if (p === 'font-size' || p === 'font') {
    // In the shorthand only what comes before `/` is a size (`font: 13px/18px` has an 18 px LINE HEIGHT).
    const size = p === 'font' ? v.split('/')[0] : v
    for (const n of pxValues(size)) if (!FONT_SCALE.includes(n)) out.push({ rule: 'font-size', value: `${n}px` })
    for (const m of stripVars(size).matchAll(/(?<![\w.-])(\d*\.?\d+)(rem|em)\b/g)) out.push({ rule: 'font-size', value: `${m[1]}${m[2]}` })
    for (const t of OFF_SCALE_TOKENS['font-size']) if (new RegExp(`var\\(\\s*${t}\\b`).test(size)) out.push({ rule: 'font-size', value: `var(${t})` })
  }
  if (p === 'border-radius' || /^border-(top|bottom)-(left|right)-radius$/.test(p)) {
    for (const n of pxValues(v)) if (!RADIUS_SCALE.includes(n)) out.push({ rule: 'border-radius', value: `${n}px` })
  }
  if (p === 'transition' || p === 'transition-property') {
    if (/(^|[\s,])all(\s|,|$)/.test(stripVars(v).trim())) out.push({ rule: 'transition-all', value: 'all' })
  }
  if (p === 'transition' || p === 'transition-duration' || p === 'transition-delay') {
    for (const m of stripVars(v).matchAll(DURATION)) out.push({ rule: 'raw-duration', value: `${m[1]}${m[2]}` })
  }
  if (SPACING_PROP.test(p)) {
    for (const n of pxValues(v)) if (!SPACE_SCALE.includes(Math.abs(n))) out.push({ rule: 'spacing', value: `${n}px` })
  }
  return out
}

/** Every declaration in a stylesheet (comments stripped). */
export function scanCss(text) {
  const css = String(text).replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of css.matchAll(/(?:^|[;{\s])(-?[a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    out.push(...checkDeclaration(m[1], m[2]))
  }
  return out
}

const camelToKebab = (k) => k.replace(/^(Webkit|Moz|ms)(?=[A-Z])/, (x) => `-${x.toLowerCase()}`).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const JS_PROPS = /\b((?:Webkit|Moz)?(?:fontSize|borderRadius|transitionDuration|transitionProperty|transitionDelay|transition|Transition)|(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?|gap|rowGap|columnGap)\s*:\s*(-?\d*\.?\d+(?![\w.])|'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)/g

/** Inline style objects in JSX/JS (`fontSize: 13`, `borderRadius: '6px'`, `transition: 'all .15s'`, `padding: 6`)
 *  and every `<UIcon ... size={n}>`. */
export function scanJs(text) {
  const src = String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const out = []
  for (const m of src.matchAll(JS_PROPS)) {
    let v = m[2]
    if (/^-?\d/.test(v)) v = `${v}px` // a bare number in a React style is px
    else v = v.slice(1, -1)
    out.push(...checkDeclaration(camelToKebab(m[1]), v))
  }
  for (const m of src.matchAll(/<UIcon\b[^>]*?\bsize=\{\s*(\d+(?:\.\d+)?)\s*\}/g)) {
    const n = Number(m[1])
    if (!ICON_SIZES.includes(n)) out.push({ rule: 'icon-size', value: `${n}px` })
  }
  return out
}
/** `{ "rule value": count }` for one file's findings. */
export function tally(findings) {
  const t = {}
  for (const f of findings) {
    const k = `${f.rule} ${f.value}`
    t[k] = (t[k] || 0) + 1
  }
  return t
}

/** What `current` has beyond `baseline` (additions) and what `baseline` still claims that is gone (stale). */
export function compareToBaseline(current, baseline) {
  const added = []
  const stale = []
  const files = new Set([...Object.keys(current), ...Object.keys(baseline)])
  for (const f of [...files].sort()) {
    const c = current[f] || {}
    const b = baseline[f] || {}
    for (const k of new Set([...Object.keys(c), ...Object.keys(b)])) {
      const n = c[k] || 0
      const was = b[k] || 0
      if (n > was) added.push(`${f}: ${k} (${n}, baseline ${was})`)
      else if (n < was) stale.push(`${f}: ${k} (${n}, baseline ${was})`)
    }
  }
  return { added, stale }
}

/** Tier 4 fix round 1 (review 2): the baseline WRITER may only remove entries. `{next}` is what to write, or
 *  `{refused}` lists every entry the tree has beyond the baseline (a new literal must be fixed, never absorbed). */
export function planBaselineWrite(current, baseline) {
  const { added } = compareToBaseline(current, baseline)
  return added.length ? { refused: added } : { next: current }
}

/** Per-rule totals of a baseline: `{ rule: count }`. */
export function ruleTotals(baseline) {
  const t = Object.fromEntries(RULES.map((r) => [r, 0]))
  for (const entries of Object.values(baseline)) {
    for (const [k, n] of Object.entries(entries)) { const r = k.split(' ')[0]; t[r] = (t[r] || 0) + n }
  }
  return t
}