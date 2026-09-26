// app/src/pages/journal-2-0/a11y/cssAudit.js
//
// Test support for the Notebook's CSS rails (wave 8, lane 8A): the focus-
// suppression rail (A4) and the contrast rail (A5) read the SAME stylesheet set
// and the SAME token values through this one module, so they can never audit
// different files or resolve a token two ways. Nothing in the app imports it.
//
//   · deriveNotebookCss() — the stylesheets the Notebook renders, DERIVED from
//     what its component files import (never typed), plus every .module.css
//     under components/notebook/**.
//   · parseRules()        — the rules of one stylesheet, comments stripped the
//     way styles/tapFloor.test.js strips them, with the line each starts on.
//   · themeVars()         — tokens.css's :root, [data-theme="oled"] and
//     [data-theme="light"] blocks, as the three custom-property maps a page
//     actually resolves against.
//   · resolveVars()       — var() chains, fallbacks included. A token the rail
//     cannot resolve THROWS, by name: a pair is never silently skipped.
//   · parseColor() / colorsIn() / opaque() — hex, rgb(a), transparent and
//     color-mix(in srgb, …), composited onto a surface with contrastMath's own
//     `composite` (never a second formula).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { composite } from '../../../styles/__tests__/contrastMath'
import { derivePopulation, J2_DIR } from './population'
import { OTHER_LANES_OUTSIDE_POPULATION } from './notebookSurfaces'

export const TOKENS_CSS = join(process.cwd(), 'src', 'styles', 'tokens.css')

const posix = (p) => p.split(sep).join('/')

function walkCss(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkCss(p, out)
    else if (name.endsWith('.module.css')) out.push(p)
  }
  return out
}

/**
 * Every .module.css the Notebook renders, relative to journal-2-0/.
 * ⛔ A stylesheet OUTSIDE journal-2-0 is not the Notebook's even when a
 * Notebook-adjacent file imports it: `../Support.jsx` is in the manifest
 * because lane 8C writes a Notebook help article INTO the Support page, and
 * the page's stylesheet belongs to that page (its four findings are reported
 * to the controller, not fixed or exempted here).
 */
export function deriveNotebookCss() {
  const sources = [...derivePopulation(), ...Object.keys(OTHER_LANES_OUTSIDE_POPULATION)]
  const found = new Set()
  for (const rel of sources) {
    const abs = join(J2_DIR, rel)
    if (!existsSync(abs)) continue // coverage rail owns a missing file
    const src = readFileSync(abs, 'utf8')
    const re = /from\s+['"]([^'"]+\.module\.css)['"]/g
    let m
    while ((m = re.exec(src))) {
      const css = posix(relative(J2_DIR, resolve(dirname(abs), m[1])))
      if (!css.startsWith('../')) found.add(css)
    }
  }
  for (const abs of walkCss(join(J2_DIR, 'components', 'notebook'))) found.add(posix(relative(J2_DIR, abs)))
  return [...found].sort()
}

/** Comments out, newlines kept, so a line number still points at the source. */
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))

/**
 * The innermost rules of a stylesheet: `{ selector, body, line }` where `line`
 * is the 1-based line the selector starts on. Rules inside @media blocks are
 * found too (the same `[^{}]` idiom as tapFloor.test.js); the @media header
 * never becomes part of a selector.
 */
export function parseRules(css) {
  const text = stripComments(css)
  const out = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = rule.exec(text))) {
    const raw = m[1]
    const lead = raw.length - raw.trimStart().length
    const start = m.index + lead
    const line = text.slice(0, start).split('\n').length
    out.push({ selector: raw.trim(), body: m[2], line, bodyStart: m.index + m[1].length + 1, text })
  }
  return out
}

/** `prop: value` pairs of a rule body, in order, with the line of each. */
export function declarations(ruleObj) {
  const out = []
  const re = /([-a-zA-Z]+)\s*:\s*([^;]+?)\s*(?:;|$)/g
  let m
  while ((m = re.exec(ruleObj.body))) {
    const at = ruleObj.bodyStart + m.index
    out.push({ prop: m[1].toLowerCase(), value: m[2].trim(), line: ruleObj.text.slice(0, at).split('\n').length })
  }
  return out
}

// ── tokens ────────────────────────────────────────────────────────────────

function blockBody(css, header) {
  const at = css.indexOf(header)
  if (at < 0) throw new Error(`tokens.css has no "${header}" block`)
  const open = css.indexOf('{', at)
  let depth = 1
  let i = open + 1
  while (i < css.length && depth) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') depth -= 1
    i += 1
  }
  return css.slice(open + 1, i - 1)
}

function customProps(body) {
  const map = new Map()
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(body))) map.set(m[1], m[2].trim())
  return map
}

export const THEMES = ['dark', 'oled', 'light']

/** The three custom-property maps: dark is :root; oled and light layer their
 *  block over it, exactly as the cascade does. */
export function themeVars(css = readFileSync(TOKENS_CSS, 'utf8')) {
  const text = stripComments(css)
  const root = customProps(blockBody(text, ':root {'))
  const oled = customProps(blockBody(text, '[data-theme="oled"] {'))
  const light = customProps(blockBody(text, '[data-theme="light"] {'))
  return {
    dark: root,
    oled: new Map([...root, ...oled]),
    light: new Map([...root, ...light]),
  }
}

/** Resolve every var() in `value`. Unknown token with no fallback -> throws. */
export function resolveVars(value, vars, depth = 0) {
  if (depth > 20) throw new Error(`var() chain too deep resolving "${value}"`)
  let out = ''
  let i = 0
  while (i < value.length) {
    const at = value.indexOf('var(', i)
    if (at < 0) { out += value.slice(i); break }
    out += value.slice(i, at)
    let d = 1
    let j = at + 4
    while (j < value.length && d) {
      if (value[j] === '(') d += 1
      else if (value[j] === ')') d -= 1
      j += 1
    }
    const inner = value.slice(at + 4, j - 1)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim()
    if (vars.has(name)) out += resolveVars(vars.get(name), vars, depth + 1)
    else if (fallback != null) out += resolveVars(fallback, vars, depth + 1)
    else throw new Error(`unresolvable token ${name}`)
    i = j
  }
  return out
}

// ── colours ───────────────────────────────────────────────────────────────

const NAMED = { white: [255, 255, 255], black: [0, 0, 0] }

/** One colour -> { rgb:[r,g,b], alpha }. Throws on anything it cannot read. */
export function parseColor(str) {
  const s = str.trim().toLowerCase()
  if (s === 'transparent') return { rgb: [0, 0, 0], alpha: 0 }
  if (NAMED[s]) return { rgb: NAMED[s], alpha: 1 }
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) throw new Error(`not a colour: ${str}`)
    const n = (k) => parseInt(h.slice(k, k + 2), 16)
    return { rgb: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) / 255 : 1 }
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(s)
  if (m) {
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
    if (!Number.isFinite(a)) a = 1
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: a }
  }
  if (s.startsWith('color-mix(')) return parseColorMix(s)
  throw new Error(`not a colour: ${str}`)
}

function splitTopLevel(s) {
  const parts = []
  let d = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') d += 1
    if (ch === ')') d -= 1
    if (ch === ',' && d === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** color-mix(in srgb, A p%, B [q%]) with premultiplied alpha, per CSS Color 5. */
function parseColorMix(s) {
  const inner = s.slice('color-mix('.length, -1)
  const [space, a, b] = splitTopLevel(inner)
  if (!/^in\s+srgb$/.test(space)) throw new Error(`color-mix space not handled: ${s}`)
  const part = (p) => {
    const m = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(p)
    return { color: parseColor(m[1]), pct: m[2] == null ? null : Number(m[2]) / 100 }
  }
  const A = part(a)
  const B = part(b)
  let pa = A.pct
  let pb = B.pct
  if (pa == null && pb == null) { pa = 0.5; pb = 0.5 } else if (pa == null) pa = 1 - pb
  else if (pb == null) pb = 1 - pa
  const sum = pa + pb
  const wa = pa / sum
  const wb = pb / sum
  const alpha = A.color.alpha * wa + B.color.alpha * wb
  const scale = Math.min(1, sum) // a sum under 100% scales the alpha down
  if (alpha === 0) return { rgb: [0, 0, 0], alpha: 0 }
  const rgb = [0, 1, 2].map((k) => (A.color.rgb[k] * A.color.alpha * wa + B.color.rgb[k] * B.color.alpha * wb) / alpha)
  return { rgb, alpha: alpha * scale }
}

/** Every colour literal inside a (resolved) value, in order — for a shorthand
 *  like `box-shadow: 0 0 0 2px rgba(…)` or `border: 1px solid #…`. */
export function colorsIn(value) {
  const out = []
  const re = /#[0-9a-fA-F]{3,8}\b|rgba?\(|color-mix\(|\btransparent\b|\bwhite\b|\bblack\b/g
  let m
  while ((m = re.exec(value))) {
    let token = m[0]
    if (token.endsWith('(')) {
      let d = 1
      let j = m.index + token.length
      while (j < value.length && d) {
        if (value[j] === '(') d += 1
        else if (value[j] === ')') d -= 1
        j += 1
      }
      token = value.slice(m.index, j)
      re.lastIndex = j
    }
    out.push(token)
  }
  return out
}

/** A colour as it actually lands on an opaque surface. */
export function opaque(color, surfaceRgb) {
  if (color.alpha >= 1) return color.rgb.map(Math.round)
  return composite(color.rgb, color.alpha, surfaceRgb)
}

/** The three surfaces a rule with no background of its own may sit on. */
export const SURFACES = ['--bg', '--bg-surface', '--bg-elevated']
