// VIS-6 (audit 2026-11-05): the scanner behind notebookTokens.lint.test.js.
//
// It reads the Notebook's styles and inline style objects and reports every OFF-TOKEN literal under four
// rules. A token (`var(--x)`) is never a literal: everything inside `var(...)`, fallbacks included, is
// stripped before a value is read, so `var(--radius-md, 6px)` is a token use.
//
//   font-size     a px size not on the Notebook scale (11 12 13 14 17 20 24 36)
//   border-radius a px radius not on the scale (0 4 6 8 12 999)
//   transition-all  `transition: all` / `transition-property: all`
//   raw-duration  a duration written as a number (`120ms`, `.15s`) in a transition
//
// Pure: no fs. The test hands it file text.

export const FONT_SCALE = Object.freeze([11, 12, 13, 14, 17, 20, 24, 36])
export const RADIUS_SCALE = Object.freeze([0, 4, 6, 8, 12, 999])
export const RULES = Object.freeze(['font-size', 'border-radius', 'transition-all', 'raw-duration'])

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

/** Findings for one declaration `prop: value`. Each finding is `{rule, value}` (value is a short literal). */
export function checkDeclaration(prop, value) {
  const p = String(prop).trim().toLowerCase()
  const v = String(value)
  const out = []
  if (p === 'font-size' || p === 'font') {
    for (const n of pxValues(v)) if (!FONT_SCALE.includes(n)) out.push({ rule: 'font-size', value: `${n}px` })
  }
  if (p === 'border-radius' || /^border-(top|bottom)-(left|right)-radius$/.test(p)) {
    for (const n of pxValues(v)) if (!RADIUS_SCALE.includes(n)) out.push({ rule: 'border-radius', value: `${n}px` })
  }
  if (p === 'transition' || p === 'transition-property') {
    if (/(^|[\s,])all(\s|,|$)/.test(stripVars(v).trim())) out.push({ rule: 'transition-all', value: 'all' })
  }
  if (p === 'transition' || p === 'transition-duration') {
    for (const m of stripVars(v).matchAll(DURATION)) out.push({ rule: 'raw-duration', value: `${m[1]}${m[2]}` })
  }
  return out
}

/** Every declaration in a stylesheet (comments stripped). */
export function scanCss(text) {
  const css = String(text).replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of css.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    out.push(...checkDeclaration(m[1], m[2]))
  }
  return out
}

const CAMEL = { fontSize: 'font-size', borderRadius: 'border-radius', transition: 'transition',
  transitionDuration: 'transition-duration', transitionProperty: 'transition-property' }

/** Inline style objects in JSX/JS: `fontSize: 13`, `borderRadius: '6px'`, `transition: 'all .15s'`. */
export function scanJs(text) {
  const src = String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const out = []
  for (const m of src.matchAll(/\b(fontSize|borderRadius|transitionDuration|transitionProperty|transition)\s*:\s*(-?\d*\.?\d+(?![\w.])|'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)/g)) {
    let v = m[2]
    if (/^-?\d/.test(v)) v = `${v}px` // a bare number in a React style is px
    else v = v.slice(1, -1)
    out.push(...checkDeclaration(CAMEL[m[1]], v))
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
