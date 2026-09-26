// ⛔ NO REGEX LOOKBEHIND IN PRODUCT CODE — the declared floor is iOS 16.
//
// Safari only learned `(?<=…)` / `(?<!…)` in 16.4. On 16.0–16.3 a regex LITERAL
// with a lookbehind is a SyntaxError when the chunk is parsed, and a bundler that
// lowers it to `new RegExp(…)` moves the throw to the moment the code runs. Either
// way the member gets an error screen. Found 2026-09-23 in
// `pages/desk/TeamSection.jsx`, live since at least 2026-08-24.
//
// ⭐ PARSED, never grepped: a text scan matches comments and prose that NAME the
// construct (this file, mathNodes.js's header). acorn + acorn-jsx is the parser
// `components/screener/reachable.test.js` already uses over the same tree.
// Tests are exempt — they run in Node, never on a phone.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const SRC = path.resolve(__dirname)
const JsxParser = Parser.extend(jsx())
const LOOKBEHIND = /\(\?<[=!]/

function productFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      productFiles(p, out)
    } else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.|\.spec\.|^setupTests|^test-utils/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit))
    else if (v && typeof v.type === 'string') walk(v, visit)
  }
}

export function lookbehindSites(code) {
  const ast = JsxParser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const hits = []
  walk(ast, (n) => {
    if (n.type === 'Literal' && n.regex && LOOKBEHIND.test(n.regex.pattern)) hits.push(n.loc.start.line)
    // new RegExp('…') / RegExp('…') with a static pattern
    if ((n.type === 'NewExpression' || n.type === 'CallExpression') && n.callee?.name === 'RegExp') {
      const a = n.arguments?.[0]
      if (a?.type === 'Literal' && typeof a.value === 'string' && LOOKBEHIND.test(a.value)) hits.push(n.loc.start.line)
      if (a?.type === 'TemplateLiteral' && a.quasis.some((q) => LOOKBEHIND.test(q.value.cooked ?? ''))) hits.push(n.loc.start.line)
    }
  })
  return hits
}

describe('no regex lookbehind in product code (iOS 16 floor)', () => {
  it('the detector fires on every form it guards (control)', () => {
    expect(lookbehindSites("const a = 'x'.split(/(?<=[.!?])\\s/)")).toEqual([1])
    expect(lookbehindSites("const b = new RegExp('(?<!x)y')")).toEqual([1])
    expect(lookbehindSites('const c = RegExp(`(?<=${"a"})b`)')).toEqual([1])
    expect(lookbehindSites('// (?<= a comment naming it\nconst d = /(?=x)y/')).toEqual([])
  })

  it('no product file under app/src uses one', () => {
    const files = productFiles(SRC)
    expect(files.length).toBeGreaterThan(500) // non-vacuity: the walk found the app
    const offenders = []
    for (const f of files) {
      const lines = lookbehindSites(fs.readFileSync(f, 'utf8'))
      for (const l of lines) offenders.push(`${path.relative(SRC, f)}:${l}`)
    }
    expect(offenders).toEqual([])
  })
})

// ── Bundled THIRD-PARTY code that can carry a regex (wave 5 review N11) ─────
//
// The walk above skips node_modules, so a grammar added to CODE_LANGUAGES
// tomorrow would ship unchecked. highlight.js grammars also hand hljs STRING
// patterns it compiles with `new RegExp` at run time, so here every string and
// template literal is scanned too, not only regex literals and RegExp() calls.
// ⭐ Comments are never scanned: the AST has none. (highlight.js carries four
// commented `(?<` today -- r.js, scala.js, haskell.js, gcode.js -- which a text
// scan would report.)
// ⛔ The module list is DERIVED from the files that import them
// (codeHighlight.js, katexRender.js), never retyped, and each is resolved to the
// file the bundler actually ships: the package's own `exports` "import" target.
const THIRD_PARTY_IMPORTERS = ['pages/journal-2-0/lib/codeHighlight.js', 'pages/journal-2-0/lib/katexRender.js']

export function anyLiteralLookbehindSites(code) {
  const ast = JsxParser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const hits = []
  walk(ast, (n) => {
    if (n.type === 'Literal' && n.regex && LOOKBEHIND.test(n.regex.pattern)) hits.push(n.loc.start.line)
    else if (n.type === 'Literal' && typeof n.value === 'string' && LOOKBEHIND.test(n.value)) hits.push(n.loc.start.line)
    else if (n.type === 'TemplateLiteral' && n.quasis.some((q) => LOOKBEHIND.test(q.value.cooked ?? ''))) hits.push(n.loc.start.line)
  })
  return hits
}

function bareImports(file) {
  const ast = JsxParser.parse(fs.readFileSync(path.join(SRC, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  const out = []
  walk(ast, (n) => {
    // Code only: a stylesheet import (katex's CSS) carries no regex to run.
    if (n.type === 'ImportDeclaration' && !n.source.value.startsWith('.') && !/\.css$/.test(n.source.value)) out.push(n.source.value)
  })
  return out
}

/** The file the bundler ships for a bare specifier: the package's `exports` "import" target. */
function shippedFile(spec) {
  const parts = spec.split('/')
  const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  // The app's own node_modules (what vite resolves from); a package whose
  // "exports" hides ./package.json (lowlight) cannot be asked through require.
  const pkgJson = path.join(SRC, '..', 'node_modules', pkg, 'package.json')
  const dir = path.dirname(pkgJson)
  const { exports: exp } = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
  const sub = spec === pkg ? '.' : `.${spec.slice(pkg.length)}`
  const pick = (target) => {
    if (typeof target === 'string') return target
    const imp = target?.import ?? target?.default
    return typeof imp === 'string' ? imp : imp?.default
  }
  let rel = null
  if (typeof exp === 'string' && sub === '.') rel = exp
  else if (exp && exp[sub]) rel = pick(exp[sub])
  else if (exp) {
    for (const [key, target] of Object.entries(exp)) {
      if (!key.includes('*')) continue
      const [pre, post] = key.split('*')
      if (sub.startsWith(pre) && sub.endsWith(post)) rel = pick(target).replace('*', sub.slice(pre.length, sub.length - post.length))
    }
  }
  if (!rel) throw new Error(`no "import" export for ${spec}`)
  return path.join(dir, rel)
}

/** An entry that only RE-EXPORTS: add the module each used re-export comes from. */
function withReexportSources(file, names) {
  const ast = JsxParser.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  const out = [file]
  walk(ast, (n) => {
    if (n.type === 'ExportNamedDeclaration' && n.source && n.specifiers.some((s) => names.includes(s.exported.name))) {
      out.push(path.join(path.dirname(file), n.source.value))
    }
  })
  return out
}

describe('no regex lookbehind in the third-party code the Notebook bundles (N11)', () => {
  const specs = [...new Set(THIRD_PARTY_IMPORTERS.flatMap(bareImports))]
  const files = [...new Set(specs.flatMap((s) => (s === 'lowlight'
    ? withReexportSources(shippedFile(s), ['createLowlight'])
    : [shippedFile(s)])))]

  it('the literal detector fires on strings and templates too, and never on a comment (control)', () => {
    expect(anyLiteralLookbehindSites("const g = { begin: '(?<=a)b' }")).toEqual([1])
    expect(anyLiteralLookbehindSites('const g = { begin: `(?<!a)b` }')).toEqual([1])
    expect(anyLiteralLookbehindSites('const g = /(?<=a)b/')).toEqual([1])
    expect(anyLiteralLookbehindSites('// (?<= named in a comment\nconst g = /(?=a)b/')).toEqual([])
  })

  it('covers every CODE_LANGUAGES grammar, plus highlight.js core, lowlight and katex', async () => {
    const { CODE_LANGUAGES } = await import('./pages/journal-2-0/lib/codeHighlight')
    const grammarSpecs = specs.filter((s) => s.startsWith('highlight.js/lib/languages/'))
    expect(grammarSpecs.length).toBe(CODE_LANGUAGES.length)
    const loaded = await Promise.all(grammarSpecs.map((s) => import(/* @vite-ignore */ s).then((m) => m.default)))
    for (const lang of CODE_LANGUAGES) expect(loaded, `${lang.id}'s grammar is not among the scanned modules`).toContain(lang.grammar)
    expect(specs).toEqual(expect.arrayContaining(['highlight.js/lib/core', 'lowlight', 'katex']))
    // Each resolves to the ESM file vite ships, and lowlight's re-export is followed.
    expect(files.some((f) => /highlight\.js[\\/]es[\\/]languages[\\/]python\.js$/.test(f))).toBe(true)
    expect(files.some((f) => /katex[\\/]dist[\\/]katex\.mjs$/.test(f))).toBe(true)
    expect(files.some((f) => /lowlight[\\/]lib[\\/]index\.js$/.test(f))).toBe(true)
  })

  it('reads the REAL bytes: r.js carries a commented (?< the scan must not report (control)', () => {
    const rFile = files.find((f) => /languages[\\/]r\.js$/.test(f))
    const raw = fs.readFileSync(rFile, 'utf8')
    expect(raw.length).toBeGreaterThan(1000)
    expect(raw).toMatch(/\(\?</)                               // present in the text (a comment)...
    expect(anyLiteralLookbehindSites(raw)).toEqual([])           // ...and absent from the code
  })

  it('no bundled grammar, core, lowlight or katex file uses one', () => {
    expect(files.length).toBeGreaterThanOrEqual(23)            // 19 grammars + core + lowlight x2 + katex
    let regexLiterals = 0
    const offenders = []
    for (const f of files) {
      const code = fs.readFileSync(f, 'utf8')
      const ast = JsxParser.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
      walk(ast, (n) => { if (n.type === 'Literal' && n.regex) regexLiterals += 1 })
      for (const l of anyLiteralLookbehindSites(code)) offenders.push(`${path.basename(f)}:${l}`)
    }
    expect(regexLiterals).toBeGreaterThan(200)                 // non-vacuity: it parsed real regex code
    expect(offenders).toEqual([])
  })
})
