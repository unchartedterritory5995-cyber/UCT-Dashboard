// app/src/pages/terminal/a11y/__tests__/terminalContrast.js
//
// Test support (nothing in the app imports it): every TEXT colour the terminal's own
// stylesheets declare, measured against the surfaces it can sit on, in EVERY app theme —
// the three base themes (dark = tokens.css :root, oled, light) AND the 18 catalog themes in
// styles/appThemes.js, which layer inline token overrides over the oled or light base exactly
// as `applyAppTheme` does at runtime. The rail is terminalContrast.test.js; the findings
// table in docs/terminal-research/14-visual/a11y-audit-2026-10-06.md is written from the
// same rows.
//
// ONE formula: styles/__tests__/contrastMath.js (`contrast`, `composite`). The CSS reading
// here is deliberately small — the terminal's stylesheets only use tokens, hex, rgba and
// color-mix(in srgb, …) — and THROWS on anything it cannot read, so a pair is never
// silently skipped.
//
// What becomes a pair, per rule:
//   · `color:` — and `fill:` on an SVG text class (selector ends in Text/Label) — against
//     the rule's own opaque `background`, or, with none of its own, against --bg,
//     --bg-surface, --bg-elevated AND --bg-hover (a terminal row can be hovered/selected,
//     and the sheets/menus sit on the elevated ramp). A translucent text colour, or one
//     under `opacity:`, is composited onto the surface first.
//   · Bar 4.5:1. 3:1 only for large text (>= 24px, or >= 18.66px at weight 700+), read from
//     the same rule's font-size / font-weight.
//   · A keyword (inherit, currentColor, transparent…) is not a pair.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { contrast, composite } from '../../../../styles/__tests__/contrastMath'
import { APP_THEMES } from '../../../../styles/appThemes'

const SRC = join(process.cwd(), 'src')
export const TOKENS_CSS = join(SRC, 'styles', 'tokens.css')
const posix = (p) => p.split(sep).join('/')

/** The stylesheets the terminal owns: everything under pages/terminal and components/terminal. */
export function terminalCss() {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.css')) out.push(posix(relative(SRC, p)))
    }
  }
  walk(join(SRC, 'pages', 'terminal'))
  walk(join(SRC, 'components', 'terminal'))
  return out.sort()
}

export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''))

/** Innermost rules `{ selector, body, line }` (rules inside @media are found too). */
export function parseRules(css) {
  const text = stripComments(css)
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    const raw = m[1]
    const start = m.index + (raw.length - raw.trimStart().length)
    out.push({ selector: raw.trim(), body: m[2], line: text.slice(0, start).split('\n').length })
  }
  return out
}

export function declarations(body) {
  const out = new Map()
  const re = /([-a-zA-Z]+)\s*:\s*([^;]+?)\s*(?:;|$)/g
  let m
  while ((m = re.exec(body))) out.set(m[1].toLowerCase(), m[2].replace(/!important/, '').trim())
  return out
}

// ── themes ────────────────────────────────────────────────────────────────

function blockBody(css, header) {
  const at = css.indexOf(header)
  if (at < 0) throw new Error(`tokens.css has no "${header}" block`)
  let depth = 1
  let i = css.indexOf('{', at) + 1
  const open = i
  while (i < css.length && depth) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') depth -= 1
    i += 1
  }
  return css.slice(open, i - 1)
}

function customProps(body) {
  const map = new Map()
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(body))) map.set(m[1], m[2].trim())
  return map
}

/** name -> custom-property Map, for all 21 themes. Catalog themes = base + inline tokens. */
export function allThemes(css = readFileSync(TOKENS_CSS, 'utf8')) {
  const text = stripComments(css)
  const root = customProps(blockBody(text, ':root {'))
  const oled = new Map([...root, ...customProps(blockBody(text, '[data-theme="oled"] {'))])
  const light = new Map([...root, ...customProps(blockBody(text, '[data-theme="light"] {'))])
  const themes = { dark: root, oled, light }
  for (const t of APP_THEMES) {
    themes[`uct:${t.id}`] = new Map([...(t.family === 'light' ? light : oled), ...Object.entries(t.tokens)])
  }
  return themes
}

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
export const KEYWORD = /^(inherit|currentcolor|initial|unset|revert|transparent|none)$/i

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

/** One colour -> { rgb, alpha }. Throws on anything it cannot read. */
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
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: a }
  }
  if (s.startsWith('color-mix(')) {
    const [space, a, b] = splitTopLevel(s.slice('color-mix('.length, -1))
    if (!/^in\s+srgb$/.test(space)) throw new Error(`color-mix space not handled: ${str}`)
    const part = (p) => {
      const pm = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(p)
      return { c: parseColor(pm[1]), pct: pm[2] == null ? null : Number(pm[2]) / 100 }
    }
    const A = part(a)
    const B = part(b)
    let pa = A.pct
    let pb = B.pct
    if (pa == null && pb == null) { pa = 0.5; pb = 0.5 } else if (pa == null) pa = 1 - pb
    else if (pb == null) pb = 1 - pa
    const wa = pa / (pa + pb)
    const wb = pb / (pa + pb)
    const alpha = A.c.alpha * wa + B.c.alpha * wb
    if (alpha === 0) return { rgb: [0, 0, 0], alpha: 0 }
    const rgb = [0, 1, 2].map((k) => (A.c.rgb[k] * A.c.alpha * wa + B.c.rgb[k] * B.c.alpha * wb) / alpha)
    return { rgb, alpha: alpha * Math.min(1, pa + pb) }
  }
  throw new Error(`not a colour: ${str}`)
}

const opaque = (c, under) => (c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, under))

export const SURFACES = ['--bg', '--bg-surface', '--bg-elevated', '--bg-hover']
export const BARS = Object.freeze({ text: 4.5, large: 3 })

function pxOf(value, vars) {
  if (!value) return null
  let v
  try { v = resolveVars(value, vars).trim() } catch { return null }
  let m = /^([\d.]+)px$/.exec(v)
  if (m) return Number(m[1])
  m = /^([\d.]+)rem$/.exec(v)
  return m ? Number(m[1]) * 16 : null
}

/** The background colour a rule paints itself, or null. */
function ownBackground(decls) {
  const v = decls.get('background-color') || decls.get('background')
  if (!v) return null
  if (/gradient|url\(/.test(v)) return null
  return v
}

/**
 * Every text pair, every theme. Row: { file, selector, line, prop, theme, surface, ratio,
 * bar, pass }. `files` defaults to terminalCss().
 */
export function auditTerminalContrast(files = terminalCss(), themes = allThemes()) {
  return files.flatMap((file) => auditCss(file, readFileSync(join(SRC, file), 'utf8'), themes))
}

/** The pairs of ONE stylesheet's text — exported so a rail can feed it a fixture. */
export function auditCss(file, css, themes = allThemes()) {
  const rows = []
  for (const rule of parseRules(css)) {
    if (rule.selector.startsWith('@')) continue
    const decls = declarations(rule.body)
    const props = []
    if (decls.has('color')) props.push('color')
    if (decls.has('fill') && /(Text|Label)\b[^,]*$/.test(rule.selector)) props.push('fill')
    for (const prop of props) {
      const raw = decls.get(prop)
      if (KEYWORD.test(raw.trim())) continue
      for (const [theme, vars] of Object.entries(themes)) {
        const page = opaque(parseColor(resolveVars('var(--bg)', vars)), [0, 0, 0])
        const ink = parseColor(resolveVars(raw, vars))
        const opacity = decls.has('opacity') ? Number(resolveVars(decls.get('opacity'), vars)) : 1
        const size = pxOf(decls.get('font-size'), vars)
        const weight = Number(decls.get('font-weight')) || 400
        const large = size != null && (size >= 24 || (size >= 18.66 && weight >= 700))
        const bar = large ? BARS.large : BARS.text
        const bgRaw = ownBackground(decls)
        const surfaces = bgRaw && !KEYWORD.test(bgRaw) ? [['own', bgRaw]] : SURFACES.map((s) => [s, `var(${s})`])
        for (const [surface, bgValue] of surfaces) {
          const bg = opaque(parseColor(resolveVars(bgValue, vars)), page)
          const fg = opaque({ rgb: ink.rgb, alpha: ink.alpha * opacity }, bg)
          const ratio = contrast(fg, bg)
          rows.push({ file, selector: rule.selector.replace(/\s+/g, ' '), line: rule.line, prop, theme, surface, ratio, bar, pass: ratio >= bar })
        }
      }
    }
  }
  return rows
}
