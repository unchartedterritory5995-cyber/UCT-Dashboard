// ⛔ NO STRING-BUILT REGEX LOOKBEHIND IN THE AGENT (iOS 16 floor) — the gap src/noRegexLookbehind.test.js leaves.
//
// That rail checks regex LITERALS and `RegExp('…')` calls with a static argument. A pattern kept as a STRING and compiled
// elsewhere (scanHidden.js HIDDEN_PHRASES → `new RegExp(p)`; deixis.js REL_ANCHOR, a template spliced into
// `new RegExp(\`…${REL_ANCHOR}\`)`) slipped past it, and esbuild ships such a pattern as `new RegExp("…(?<!…)")`, which
// Safari < 16.4 throws on when the chunk runs (production's AgentPanel chunk, 2026-11-10: 6 sites).
// Two independent checks over app/src/agent's product files (tests and __tests__ exempt — they run in Node):
//   1. PARSED: every regex literal, string literal and template quasi in the source (comments are not in the AST);
//   2. BUILT: every module is imported and everything it exports — RegExp `.source`, strings, and the arrays / objects /
//      Maps / Sets that hold them — is inspected, so a pattern assembled at run time ('(?<' + '!x)') is caught too.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const AGENT = path.resolve(__dirname)
const SRC = path.resolve(__dirname, '..')
const JsxParser = Parser.extend(jsx())
const LOOKBEHIND = /\(\?<[=!]/

const isProduct = (name) => /\.(js|jsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)
function productFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') productFiles(p, out) } else if (isProduct(e.name)) out.push(p)
  }
  return out
}
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit))
    else if (v && typeof v.type === 'string') walk(v, visit)
  }
}
/** Lines of every regex literal, string literal or template quasi carrying a lookbehind. */
export function parsedSites(code) {
  const ast = JsxParser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const hits = new Set()
  walk(ast, (n) => {
    if (n.type === 'Literal' && n.regex && LOOKBEHIND.test(n.regex.pattern)) hits.add(n.loc.start.line)
    else if (n.type === 'Literal' && typeof n.value === 'string' && LOOKBEHIND.test(n.value)) hits.add(n.loc.start.line)
    else if (n.type === 'TemplateLiteral' && n.quasis.some((q) => LOOKBEHIND.test(q.value.cooked ?? q.value.raw))) hits.add(n.loc.start.line)
  })
  return [...hits].sort((a, b) => a - b)
}
/** Paths inside an exported value that hold a lookbehind (RegExp source or string), depth-limited, cycle-safe. */
export function builtSites(value, at = '', seen = new Set(), depth = 0, out = []) {
  if (value == null || depth > 5) return out
  if (typeof value === 'string') { if (LOOKBEHIND.test(value)) out.push(at); return out }
  if (value instanceof RegExp) { if (LOOKBEHIND.test(value.source)) out.push(at); return out }
  if (typeof value !== 'object' || seen.has(value)) return out
  seen.add(value)
  if (value.$$typeof) return out // a React element
  if (Array.isArray(value)) value.forEach((v, i) => builtSites(v, `${at}[${i}]`, seen, depth + 1, out))
  else if (value instanceof Map) for (const [k, v] of value) { builtSites(k, `${at}<key>`, seen, depth + 1, out); builtSites(v, `${at}.get(${String(k)})`, seen, depth + 1, out) }
  else if (value instanceof Set) [...value].forEach((v, i) => builtSites(v, `${at}{${i}}`, seen, depth + 1, out))
  else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null || Object.prototype.toString.call(value) === '[object Module]') {
    for (const k of Object.keys(value)) { let v; try { v = value[k] } catch { continue } builtSites(v, at ? `${at}.${k}` : k, seen, depth + 1, out) }
  }
  return out
}

describe('no string-built regex lookbehind in app/src/agent (iOS 16 floor)', () => {
  it('the detectors fire on every form they guard, and never on a comment (control)', () => {
    expect(parsedSites("const a = ['\\\\b(?<!x )y', 'k']")).toEqual([1])
    expect(parsedSites('const b = `(?:a(?![\\\\s-]+[a-z]+\\\\b(?<!\\\\b(?:to|on))))`')).toEqual([1])
    expect(parsedSites('const c = /(?<=[.:])\\s+/')).toEqual([1])
    expect(parsedSites('// (?<! named in a comment\nconst d = /(?=x)y/')).toEqual([])
    expect(builtSites({ P: Object.freeze([['(?<' + '!n )c', 'k']]) })).toEqual(['P[0][0]'])
    expect(builtSites({ R: new RegExp('a' + '(?<' + '=b)') })).toEqual(['R'])
    expect(builtSites({ S: new Set(['ok', '(?<' + '!q)']), M: new Map([['x', /(?=ok)/]]) })).toEqual(['S{1}'])
    expect(builtSites({ ok: /(?=a)(?!b)/, s: 'a (?:b)' })).toEqual([])
  })

  it('PARSED: no product file under app/src/agent carries one in a regex, string or template literal', () => {
    const files = productFiles(AGENT)
    expect(files.length).toBeGreaterThan(150) // non-vacuity: the walk found the Agent
    const offenders = []
    for (const f of files) for (const l of parsedSites(fs.readFileSync(f, 'utf8'))) offenders.push(`${path.relative(SRC, f).split(path.sep).join('/')}:${l}`)
    // ...and no JSON data under app/src/agent (a pattern can ship as data compiled with `new RegExp`)
    for (const f of jsonFiles(AGENT)) {
      let data
      try { data = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
      for (const at of builtSites(data)) offenders.push(`${path.relative(SRC, f).split(path.sep).join('/')}#${at}`)
    }
    expect(offenders).toEqual([])
  })

  it('BUILT: no module under app/src/agent exports a pattern or string that carries one', async () => {
    const mods = import.meta.glob(['./**/*.{js,jsx}', '!./**/*.test.*', '!./**/*.spec.*', '!./**/__tests__/**'])
    const offenders = []
    let imported = 0
    let failed = 0
    for (const [p, load] of Object.entries(mods)) {
      let m
      try { m = await load() } catch { failed += 1; continue }
      imported += 1
      for (const at of builtSites(m)) offenders.push(`${p.slice(2)}#${at}`)
    }
    expect(imported).toBeGreaterThan(150) // non-vacuity: the modules were really imported and walked
    expect(failed).toBeLessThan(10)
    expect(offenders).toEqual([])
  }, 120000)
})

// Outside the Agent: REPORTED, not fixed here (other teams' files). The same PARSED scan over the rest of app/src.
const OUTSIDE_AGENT_TODAY = ['components/chart/engine/ast/guardIdText.js:35',
  'components/chart/builder/authoring/preflightRules.json#possessiveTicker', 'components/chart/builder/authoring/preflightRules.json#adjacentTicker',
  'components/chart/builder/authoring/preflightRules.json#tickerToken', 'components/chart/builder/authoring/preflightRules.json#questionShape.clauseSplit']
function jsonFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!['__tests__', '__fixtures__', 'node_modules'].includes(e.name)) jsonFiles(p, out) } else if (/\.json$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
  }
  return out.sort()
}
describe('string-built lookbehind elsewhere in app/src (reported to its owners; not this PR’s files)', () => {
  const outside = () => {
    const out = []
    for (const f of productFiles(SRC)) {
      if (f.startsWith(AGENT + path.sep)) continue
      for (const l of parsedSites(fs.readFileSync(f, 'utf8'))) out.push(`${path.relative(SRC, f).split(path.sep).join('/')}:${l}`)
    }
    // a pattern can also ship as JSON data compiled with `new RegExp` (the built applyPatch chunk carries these four)
    for (const f of jsonFiles(SRC)) {
      if (f.startsWith(AGENT + path.sep)) continue
      let data
      try { data = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
      for (const at of builtSites(data)) out.push(`${path.relative(SRC, f).split(path.sep).join('/')}#${at}`)
    }
    return out
  }
  it.fails('KNOWN GAP: no product file outside app/src/agent carries one', () => { expect(outside()).toEqual([]) })
  it('KNOWN GAP pinned: the sites outside the Agent are exactly these today', () => { expect(outside()).toEqual(OUTSIDE_AGENT_TODAY) })
})
