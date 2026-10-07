// app/src/pages/terminal/__tests__/themeScope.js — test infrastructure, never imported by the app.
//
// ⭐ THE TERMINAL HAS NO LOOK OF ITS OWN (owner ruling, 2026-10-06): every panel follows the
// member's app theme — dark, light, oled and the catalog themes in styles/appThemes.js. This
// module answers the two questions the theme rails ask of the code the terminal can mount:
//
//   1. which files ARE terminal-mounted?  `terminalScope()` — an import walk from every
//      non-test module under pages/terminal/ (static imports, re-exports, lazy `import()`,
//      CSS `composes … from`), so a page promoted to a panel tomorrow is in scope the day it
//      lands. Never a typed directory list.
//   2. where does such a file paint a colour the theme cannot reach?  `colourLiteralsIn()`.
//
// The walk does NOT descend into files other lanes own (the chart engine and StockChart, the
// Options Flow page, Journal 2.0, useTapeFeed): their theming is their owners' work, and a rail
// that reds on a file this lane may not edit is a rail somebody mutes. Theme DEFINITIONS
// (tokens.css, appThemes.js, lib/theme) are walked through but not scanned — a palette has to
// spell its colours somewhere.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SRC = path.resolve(HERE, '..', '..', '..')
const rel = (abs) => path.relative(SRC, abs).split(path.sep).join('/')

/** Not descended into and not scanned: files other lanes own. */
export const NOT_WALKED = [
  /^components\/chart\//, /^components\/StockChart\./,
  /^pages\/OptionsFlow\./, /^pages\/optionsFlow\//,
  /^pages\/journal-2-0\//, /^hooks\/useTapeFeed\./,
]
/** Walked through, never scanned: the theme's own definitions. */
export const NOT_SCANNED = [/^styles\/tokens\.css$/, /^styles\/appThemes\.js$/, /^lib\/theme\//]

const TEST_FILE = /\.(test|spec)\.[jt]sx?$|(^|\/)(__tests__|__fixtures__|__mocks__)\//
const EXTS = ['', '.js', '.jsx', '/index.js', '/index.jsx']
const EDGE = /(?:^|[^\w.])(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^\w.])import\s+['"]([^'"]+)['"]|composes:[^;]*\bfrom\s+['"]([^'"]+)['"]/g

/** Comments blanked (newlines kept, so line numbers survive). `//` only in code, never in CSS. */
export function stripComments(text, css) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  if (!css) t = t.replace(/(^|[^:'"`\\/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
  return t
}

let SCOPE
/** Every terminal-mounted source file, as a src-relative path (sorted). */
export function terminalScope() {
  if (SCOPE) return SCOPE
  const termDir = path.join(SRC, 'pages', 'terminal')
  const roots = fs.readdirSync(termDir, { recursive: true })
    .map((f) => path.join(termDir, String(f)))
    .filter((f) => /\.(jsx?|css)$/.test(f) && !TEST_FILE.test(rel(f)))
  const seen = new Set()
  const queue = [...roots]
  while (queue.length) {
    const f = path.normalize(queue.pop())
    if (seen.has(f) || !fs.existsSync(f) || !fs.statSync(f).isFile()) continue
    const r = rel(f)
    if (NOT_WALKED.some((re) => re.test(r))) continue
    seen.add(f)
    const text = stripComments(fs.readFileSync(f, 'utf8'), f.endsWith('.css'))
    for (const m of text.matchAll(EDGE)) {
      const spec = m[1] || m[2] || m[3] || m[4]
      if (!spec || !spec.startsWith('.')) continue
      const base = path.resolve(path.dirname(f), spec.split('?')[0])
      const hit = EXTS.map((e) => base + e).find((p) => fs.existsSync(p) && fs.statSync(p).isFile())
      if (hit) queue.push(hit)
    }
  }
  SCOPE = [...seen].map(rel).filter((r) => !TEST_FILE.test(r)).sort()
  return SCOPE
}

export const scannedFiles = () => terminalScope().filter((r) => !NOT_SCANNED.some((re) => re.test(r)))
export const readSrc = (r) => fs.readFileSync(path.join(SRC, r), 'utf8')

/** `[selector, body]` for every rule of a stylesheet with no nesting (the token file). */
export function cssBlocks(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
}
export const declsOf = (body) => Object.fromEntries(
  [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))

/** Every custom property tokens.css declares in any block. */
export function tokenNames() {
  const css = stripComments(readSrc('styles/tokens.css'), true)
  const out = new Set()
  for (const [, body] of cssBlocks(css)) for (const k of Object.keys(declsOf(body))) out.add(k)
  return out
}

/** Custom properties a scoped file DECLARES itself (a CSS declaration, or a JS style key /
 *  setProperty) — a component-local token such as `--hero-hue` or a widget's `--wl-bg`. */
export function locallyDeclared(files = terminalScope()) {
  const out = new Set()
  for (const f of files) {
    const t = stripComments(readSrc(f), f.endsWith('.css'))
    for (const m of t.matchAll(/(?:^|[\s;{(])(--[\w-]+)\s*:/gm)) out.add(m[1])
    for (const m of t.matchAll(/['"`](--[\w-]+)['"`]\s*:/g)) out.add(m[1])
    for (const m of t.matchAll(/setProperty\(\s*['"`](--[\w-]+)['"`]/g)) out.add(m[1])
    for (const m of t.matchAll(/\[\s*`(--[\w-]+)`\s*\]\s*:/g)) out.add(m[1])
  }
  return out
}

const HEX = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])'
const FN = '(?:rgba?|hsla?)\\(\\s*[\\d.]'
const LIT = new RegExp(`(?<![&\\w])${HEX}|\\b${FN}`, 'g')
const LIT_VALUE = `(?:${HEX}|(?:rgba?|hsla?)\\([^()]*\\))`
const CSS_COLOUR_PROP = /(?:^|[\s;{])(?:color|background(?:-color)?|border(?:-[a-z]+)*-color|border(?:-[a-z]+)?|fill|stroke|outline(?:-color)?|caret-color|accent-color)\s*:\s*[^;]*?\b(white|black)\b/g
const JS_COLOUR_PROP = /\b(?:color|background|backgroundColor|borderColor|fill|stroke|fillStyle|strokeStyle|stopColor)\s*[:=]\s*['"`](white|black)['"`]/g

/**
 * The colour literals in `text` that do NOT follow the theme, as `{ line, lit }`.
 *
 * Sanctioned (not reported), each because the theme still decides the colour:
 *   • `var(--token, #hex)` when `--token` is a real token (tokens.css) or one the file's scope
 *     declares — the literal is only a fallback. A fallback behind a token NOBODY declares is
 *     the colour itself and IS reported (`var(--gold, #c9a84c)` never followed any theme).
 *   • `['--token', '#hex']` / `('--token', '#hex')` / `token: '--token', fallback: '#hex'` —
 *     lib/theme's canvas specs, whose literal is the jsdom fallback. tokens.css tokens only.
 *   • a translucent black (`rgba(0,0,0,a)`) — a shadow or a scrim, black in every theme.
 *   • the colour stops of a `mask` / `mask-image` — coverage, not paint.
 */
export function colourLiteralsIn(file, text, known = tokenNames()) {
  const css = file.endsWith('.css')
  let t = stripComments(text, css)
  t = t.replace(new RegExp(`var\\(\\s*(--[\\w-]+)\\s*,\\s*${LIT_VALUE}\\s*\\)`, 'g'),
    (m, k) => (known.has(k) ? 'var(--sanctioned)' : m))
  t = t.replace(new RegExp(`(['"\`])(--[\\w-]+)\\1(\\s*,\\s*)(['"\`])${LIT_VALUE}\\4`, 'g'),
    (m, q, k, sep) => (known.has(k) ? `'${k}'${sep}'FALLBACK'` : m))
  t = t.replace(new RegExp(`(token:\\s*(['"\`])(--[\\w-]+)\\2\\s*,\\s*fallback:\\s*)(['"\`])${LIT_VALUE}\\4`, 'g'),
    (m, head, q, k) => (known.has(k) ? `${head}'FALLBACK'` : m))
  // A translucent black is a shadow or a scrim, and both are black in every theme.
  t = t.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(?:0?\.\d+|0)\s*\)/g, 'SCRIM')
  // A mask paints nothing: its "colour" is only coverage (#000 = opaque).
  t = t.replace(/(?:-webkit-)?mask(?:-image)?\s*:[^;]*/g, 'mask: SANCTIONED')
  const out = []
  t.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(LIT)) out.push({ line: i + 1, lit: m[0] })
    for (const m of line.matchAll(css ? CSS_COLOUR_PROP : JS_COLOUR_PROP)) out.push({ line: i + 1, lit: m[1] })
  })
  return out
}

/** `{ file: count }` over every scanned terminal-mounted file with at least one literal. */
export function literalCounts() {
  const known = new Set([...tokenNames(), ...locallyDeclared()])
  const out = {}
  for (const f of scannedFiles()) {
    const n = colourLiteralsIn(f, readSrc(f), known).length
    if (n) out[f] = n
  }
  return out
}
