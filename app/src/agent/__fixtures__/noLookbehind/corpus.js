// Test-only phrase corpus for the no-lookbehind equivalence rail (agentNoLookbehindEquivalence.test.js).
// Built from (1) every string / template literal in the Agent's OWN test files — the existing rails' phrase sets
// (routing, screener, scanHidden / W1.1 R-05, deixis / relation rails) are read from the files themselves, never
// retyped — and (2) phrases synthesised around each rewritten site (the words a lookbehind excluded, near-misses,
// punctuation, start-of-text). Pure data; no regex lookbehind here (this file sits in the product scan's tree).
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
export const AGENT_DIR = path.resolve(__dirname, '..', '..')

function walkFiles(dir, keep, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkFiles(p, keep, out) } else if (keep(e.name)) out.push(p)
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

/** Every string literal and template quasi in the Agent's test files (3–400 chars, with a letter), sorted, unique. */
export function testFileLiterals() {
  const files = walkFiles(AGENT_DIR, (n) => /\.test\.(js|jsx)$/.test(n)).sort()
  const out = new Set()
  for (const f of files) {
    let ast
    try { ast = JsxParser.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }) } catch { continue }
    walk(ast, (n) => {
      const vals = n.type === 'Literal' && typeof n.value === 'string' ? [n.value]
        : n.type === 'TemplateLiteral' ? n.quasis.map((q) => q.value.cooked ?? '') : []
      for (const v of vals) if (v.length >= 3 && v.length <= 400 && /[a-z]/i.test(v)) out.add(v)
    })
  }
  return { files: files.length, literals: [...out].sort() }
}

const cross = (as, bs, cs = ['']) => as.flatMap((a) => bs.flatMap((b) => cs.map((c) => a + b + c)))

/** Phrases synthesised around each site. */
export function synthesised() {
  const theme = cross(
    ['', ' ', '  ', 'light ', 'dark ', 'app ', 'uct ', 'site ', 'Light ', 'delight ', 'xlight ', 'lights ', 'darker ', 'apps ', 'cuct ', 'website ',
      'ight ', 'ark ', 'pp ', 'ct ', 'ite ', 'a ', 'my ', 'the light ', 'set the dark ', 'switch to the app ', 'use the site ', 'change my chart ',
      'light-', 'dark.', 'app\t', 'uct\n', 'site  ', 'light  ', '(light) ', 'a light dark ', 'dark light ', '-', '.', 'x', '1 ', 'lightdark '],
    ['theme', 'themes', 'themed', 'Theme', 'theme.', 'themes!', 'thematic'],
    ['', ' please', ' to blue', ' and the light theme', ' or the chart theme', 's'])
  const study = cross(
    ['', ' ', 'case ', 'Case ', 'a case ', 'showcase ', 'cases ', 'ase ', 'se ', 'e ', 'my ', 'which ', 'case  ', 'case-', 'case.', 'xcase ', '1 ', 'in case ', 'case study and the '],
    ['study', 'studies', 'Study', 'studys', 'student', 'studio', 'studies?'],
    ['', ' on here', ' do i have', ' and oscillators', ' and the mas', 's'])
  const sentences = cross(
    ['', 'A.', 'Price: last.', 'Ratio of a to b.', 'One. Two.', 'Note:', 'x.y', 'Ends with a dot.', ' lead.', 'a.\t'],
    [' ', '  ', '\n', '\t', '', ' \n '],
    ['Next sentence.', 'next: thing', 'More text here, long enough to share.', '.', ':', 'tail'])
  const composite = cross(
    ['', ' ', 'nasdaq ', 'nyse ', 'the nasdaq ', 'the nyse ', 'xnasdaq ', 'nyses ', 'nasdaq  ', 'nyse-', 'asdaq ', 'yse ', 'se ', 'a ', 'uct ', 'filter to ',
      'nasdaq composite over 1 and ', 'stocks above the nasdaq ', 'nysenasdaq ', 'nasdaqnyse ', 'nyse\t'],
    ['composite', 'composite score', 'composite rating', 'composites'],
    [' over 85', ' >= 90', '>80', ' at least 70', ' above the line', '', ' of at least 5', ' less than 3', ' and uct composite'])
  const relation = cross(
    ['the chart ', 'the one ', 'whatever is ', ''],
    ['above ', 'to the left of ', 'next to ', 'near ', 'right under '],
    cross(['this', 'THAT'],
      ['', ' one', ' chart', ' to', ' on', ' in', ' and', ' then', ' please', ' for', ' with', ' as', ' into', ' onto', ' now', ' weekly', ' daily',
        ' monthly', ' hourly', ' intraday', ' instead', ' too', ' also', ' here', ' toy', ' into2', ' to-', ' inner', ' candle', ' stock', ' nvda',
        ' TO', ' Here', '-to', '-candle', ' 5', ' heres', ' an', ' tooo', ' onto the', ' in here', ', please'],
      ['', ' chart', ' one', '.']))
  const sentinel = cross(['', ' ', 'a', '1', '_', '.', '-', '$', 'x:'], ['13579.2468', 'ISO-SENTINEL-7y3', '0.000123'], ['', '1', '.5', ' ', 'a', '.'])
  return { theme, study, sentences, composite, relation, sentinel }
}

/** A seeded PRNG (mulberry32) so a fuzz corpus is the same on every run. */
export function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
/** `n` random strings made of `tokens` (1–8 of them). */
export function fuzz(tokens, n, seed) {
  const r = rng(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(r() * 8)
    let s = ''
    for (let j = 0; j < k; j++) s += tokens[Math.floor(r() * tokens.length)]
    out.push(s)
  }
  return out
}
