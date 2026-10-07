// app/src/pages/terminal/a11y/__tests__/reachableContrast.js
//
// Test support (nothing in the app imports it): the SAME contrast audit as terminalContrast.js,
// pointed at the stylesheets the terminal can MOUNT but does not own — every `.css` the import
// walk in pages/terminal/__tests__/themeScope.js reaches from pages/terminal (static imports,
// lazy `import()`, `composes … from`) that is NOT already under pages/terminal or
// components/terminal. A Research tab, a tile, a sheet opened from a panel: the member reads
// them inside the terminal, so their red and green numbers are terminal text.
//
// ONE formula and ONE reader: `auditCss` from ./terminalContrast. The only thing added here is
// that a rule the reader cannot resolve (a component-local token, a gradient ink) is recorded as
// `unreadable` instead of throwing for the whole file — 800+ stylesheets owned by other lanes are
// not this lane's to make parseable, and one exotic rule must not hide the rest of its file.
// An unreadable rule still COUNTS against the file's baseline, so it is never silently skipped.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminalScope } from '../../__tests__/themeScope'
import { allThemes, auditCss, parseRules, terminalCss } from './terminalContrast'

const SRC = join(process.cwd(), 'src')

/** Terminal-reachable stylesheets outside the two directories terminalContrast already audits. */
export function reachableCss() {
  const own = new Set(terminalCss())
  return terminalScope().filter((f) => f.endsWith('.css') && !own.has(f))
}

/**
 * Every failing or unreadable TEXT rule of one stylesheet, as
 * `{ file, selector, line, prop, worst, theme, surface, bar, unreadable? }` — one entry per
 * rule+prop (its worst theme/surface pair), never one per theme, so a count is a count of rules.
 */
export function failingTextRules(file, css = readFileSync(join(SRC, file), 'utf8'), themes = allThemes()) {
  const out = []
  for (const rule of parseRules(css)) {
    if (rule.selector.startsWith('@')) continue
    let rows
    try {
      rows = auditCss(file, `${rule.selector}{${rule.body}}`, themes)
    } catch (e) {
      out.push({ file, selector: rule.selector.replace(/\s+/g, ' '), line: rule.line, prop: '?', unreadable: String(e.message || e) })
      continue
    }
    const byProp = new Map()
    for (const r of rows) {
      if (r.pass) continue
      const cur = byProp.get(r.prop)
      if (!cur || r.ratio < cur.ratio) byProp.set(r.prop, r)
    }
    for (const r of byProp.values()) {
      out.push({ file, selector: r.selector, line: rule.line, prop: r.prop, worst: r.ratio, theme: r.theme, surface: r.surface, bar: r.bar })
    }
  }
  return out
}

/** `{ file: [failing rules] }` over every reachable stylesheet with at least one. */
export function reachableFailures(files = reachableCss(), themes = allThemes()) {
  const out = {}
  for (const f of files) {
    const rules = failingTextRules(f, undefined, themes)
    if (rules.length) out[f] = rules
  }
  return out
}

/** The chart-candle tokens used as TEXT: `color:` anywhere, or `fill:` on an SVG text class. */
const TEXT_LOSS_GAIN = /(?:^|[\s;{])(color|fill)\s*:\s*[^;{}]*var\(\s*--(?:loss|gain)\s*[,)]/g
export function lossGainTextUses(file, css = readFileSync(join(SRC, file), 'utf8')) {
  const out = []
  for (const rule of parseRules(css)) {
    for (const m of rule.body.matchAll(TEXT_LOSS_GAIN)) {
      if (m[1] === 'fill' && !/(Text|Label|val|value|Value)\w*\b[^,]*$/.test(rule.selector)) continue
      out.push({ file, selector: rule.selector.replace(/\s+/g, ' '), line: rule.line, prop: m[1] })
    }
  }
  return out
}

/** The same question of a JS/JSX module, by line: an inline `color`/`fill` that names --loss/--gain. */
const JS_LOSS_GAIN = /\b(?:color|fill)\s*[:=]\s*[^\n]*var\(\s*--(?:loss|gain)\s*[,)]/
export function lossGainJsLines(file, text = readFileSync(join(SRC, file), 'utf8')) {
  const out = []
  text.split('\n').forEach((line, i) => {
    if (JS_LOSS_GAIN.test(line)) out.push({ file, line: i + 1, text: line.trim().slice(0, 160) })
  })
  return out
}

/** Every terminal-mounted JS/JSX module (the import walk), outside test infrastructure. */
export const reachableJs = () => terminalScope().filter((f) => /\.jsx?$/.test(f))
