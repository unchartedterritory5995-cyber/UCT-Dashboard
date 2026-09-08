// tools/c4_pine_surface_census.mjs
//
// C4 PHASE 1 — THE DEMAND CENSUS. What Pine surface do REAL scripts actually
// use? The corpora are validation instruments, not the specification; this tool
// exists so the completion matrix is anchored to measured demand rather than to
// a feature list somebody wrote from memory.
//
// ⛔ THIS IS A SOURCE-TOKEN CENSUS, NOT A PARSE. It runs on comment- and
// string-stripped source, so it can be fooled by a token inside a construct it
// does not model. It is therefore an inventory of DEMAND, never a claim about
// what the engine does with that demand — the harness measures that. Two things
// keep it honest: `--self-test` runs it over a fixture whose counts are stated
// in this file, so a broken matcher fails loudly rather than reporting a clean
// zero; and the JSON keeps per-script rows, so any number walks back to source.
//
// ⚠️ A ZERO HERE IS A CLAIM. `lesson_a_saturated_instrument_reports_zero` — if a
// family reports 0 across 169 real scripts, suspect the matcher before believing
// the corpus. Zero-demand families are printed separately for exactly that
// reason.
//
//   node tools/c4_pine_surface_census.mjs [--json <out>] [--self-test]

import fs from 'node:fs'
import path from 'node:path'

const CORPORA = [
  ['oos60', 'tests/fixtures/pine_oos'],
  ['blind48', 'tests/fixtures/pine_blind'],
  ['community30', 'tests/fixtures/pine_community'],
  ['parity10', 'tests/fixtures/oos2_parity'],
  ['curated21', 'tests/fixtures/pine'],
]

/** Strip strings FIRST (so a `//` inside a string cannot eat the line), then
 *  block comments, then line comments. Strings come back as `""` because a
 *  ticker name inside one is not a builtin reference. */
export function strip(src) {
  const holes = []
  let s = src.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => {
    holes.push(m)
    return '\u0000S' + (holes.length - 1) + '\u0000'
  })
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  return s.replace(/\u0000S(\d+)\u0000/g, '""')
}

const n = (s, p) => (s.match(new RegExp(p, 'g')) || []).length

/** ⭐ FAMILIES ARE THE MATRIX ROWS, IN MATRIX ORDER, so the two cannot drift.
 *  Each returns a COUNT of uses; the caller turns non-zero into "this script
 *  demands this family". */
export const FAMILIES = {
  // ── language core ────────────────────────────────────────────────────────
  'op:modulo': (s) => n(s, '[\\w)\\]]\\s*%\\s*[\\w(]'),
  'op:ternary': (s) => n(s, '\\?[^?.]'),
  'history:subscript': (s) => n(s, '\\w\\s*\\[\\s*[^\\]]+\\]'),
  'na:handling': (s) => n(s, '\\bna\\b|\\bnz\\s*\\('),
  // ── state ────────────────────────────────────────────────────────────────
  'state:var': (s) => n(s, '(^|\\n)\\s*var\\s+\\w'),
  'state:varip': (s) => n(s, '(^|\\n)\\s*varip\\s+\\w'),
  'state:reassign': (s) => n(s, ':='),
  // ── control flow ─────────────────────────────────────────────────────────
  'ctrl:if': (s) => n(s, '(^|\\n)\\s*if\\s+'),
  'ctrl:else': (s) => n(s, '(^|\\n)\\s*else\\b'),
  'ctrl:switch': (s) => n(s, '\\bswitch\\b'),
  'loop:for': (s) => n(s, '(^|\\n)\\s*for\\s+'),
  'loop:forin': (s) => n(s, '\\bfor\\s+\\[?\\w[\\w,\\s\\]]*\\s+in\\s+'),
  'loop:while': (s) => n(s, '(^|\\n)\\s*while\\s+'),
  'loop:breakcont': (s) => n(s, '\\bbreak\\b|\\bcontinue\\b'),
  // ── functions / tuples ───────────────────────────────────────────────────
  'udf:def': (s) => n(s, '(^|\\n)\\s*\\w+\\s*\\([^)]*\\)\\s*=>'),
  'udf:method': (s) => n(s, '(^|\\n)\\s*method\\s+\\w+'),
  'tuple:destructure': (s) => n(s, '(^|\\n)\\s*\\[\\s*\\w[\\w,\\s]*\\]\\s*='),
  'tuple:return': (s) => n(s, '=>\\s*\\['),
  // ── collections ──────────────────────────────────────────────────────────
  'array:use': (s) => n(s, '\\barray\\s*\\.\\s*\\w+|\\barray<'),
  'array:new': (s) => n(s, '\\barray\\s*\\.\\s*new'),
  'matrix:use': (s) => n(s, '\\bmatrix\\s*\\.\\s*\\w+|\\bmatrix<'),
  'map:use': (s) => n(s, '\\bmap\\s*\\.\\s*\\w+|\\bmap<'),
  // ── user-defined types ───────────────────────────────────────────────────
  'udt:type': (s) => n(s, '(^|\\n)\\s*type\\s+\\w+'),
  'udt:new': (s) => n(s, '\\w\\s*\\.\\s*new\\s*\\('),
  // ── objects ──────────────────────────────────────────────────────────────
  'obj:line': (s) => n(s, '\\bline\\s*\\.\\s*\\w+'),
  'obj:label': (s) => n(s, '\\blabel\\s*\\.\\s*\\w+'),
  'obj:box': (s) => n(s, '\\bbox\\s*\\.\\s*\\w+'),
  'obj:table': (s) => n(s, '\\btable\\s*\\.\\s*\\w+'),
  'obj:polyline': (s) => n(s, '\\bpolyline\\s*\\.\\s*\\w+'),
  'obj:linefill': (s) => n(s, '\\blinefill\\s*\\.\\s*\\w+'),
  // ── context ──────────────────────────────────────────────────────────────
  'ctx:bar_index': (s) => n(s, '\\bbar_index\\b'),
  'ctx:last_bar_index': (s) => n(s, '\\blast_bar_index\\b'),
  'ctx:barstate': (s) => n(s, '\\bbarstate\\s*\\.\\s*\\w+'),
  'ctx:timeframe': (s) => n(s, '\\btimeframe\\s*\\.\\s*\\w+'),
  'ctx:session': (s) => n(s, '\\bsession\\s*\\.\\s*\\w+|\\bis_session\\b'),
  'ctx:syminfo': (s) => n(s, '\\bsyminfo\\s*\\.\\s*\\w+'),
  'ctx:calendar': (s) => n(s, '\\bdayofweek\\b|\\bhour\\b|\\bminute\\b|\\bmonth\\b|\\byear\\b'),
  // ── multi-timeframe / data request ───────────────────────────────────────
  'mtf:security': (s) => n(s, '\\brequest\\s*\\.\\s*security\\b'),
  'mtf:lower_tf': (s) => n(s, '\\brequest\\s*\\.\\s*security_lower_tf\\b'),
  'mtf:other_request': (s) => n(s, '\\brequest\\s*\\.\\s*(?!security)\\w+'),
  // ── inputs ───────────────────────────────────────────────────────────────
  'input:int': (s) => n(s, '\\binput\\s*\\.\\s*int\\b'),
  'input:float': (s) => n(s, '\\binput\\s*\\.\\s*float\\b'),
  'input:bool': (s) => n(s, '\\binput\\s*\\.\\s*bool\\b'),
  'input:string': (s) => n(s, '\\binput\\s*\\.\\s*string\\b'),
  'input:source': (s) => n(s, '\\binput\\s*\\.\\s*source\\b'),
  'input:color': (s) => n(s, '\\binput\\s*\\.\\s*color\\b'),
  'input:timeframe': (s) => n(s, '\\binput\\s*\\.\\s*timeframe\\b'),
  'input:session': (s) => n(s, '\\binput\\s*\\.\\s*session\\b'),
  'input:time': (s) => n(s, '\\binput\\s*\\.\\s*time\\b'),
  'input:symbol': (s) => n(s, '\\binput\\s*\\.\\s*symbol\\b'),
  'input:price': (s) => n(s, '\\binput\\s*\\.\\s*price\\b'),
  'input:enum': (s) => n(s, '\\binput\\s*\\.\\s*enum\\b'),
  'input:bare': (s) => n(s, '\\binput\\s*\\('),
  // ── outputs / visuals ────────────────────────────────────────────────────
  'vis:plot': (s) => n(s, '\\bplot\\s*\\('),
  'vis:hline': (s) => n(s, '\\bhline\\s*\\('),
  'vis:fill': (s) => n(s, '\\bfill\\s*\\('),
  'vis:bgcolor': (s) => n(s, '\\bbgcolor\\s*\\('),
  'vis:barcolor': (s) => n(s, '\\bbarcolor\\s*\\('),
  'vis:plotshape': (s) => n(s, '\\bplotshape\\s*\\('),
  'vis:plotchar': (s) => n(s, '\\bplotchar\\s*\\('),
  'vis:plotarrow': (s) => n(s, '\\bplotarrow\\s*\\('),
  'vis:plotcandle': (s) => n(s, '\\bplotcandle\\s*\\('),
  'vis:plotbar': (s) => n(s, '\\bplotbar\\s*\\('),
  'vis:dynamic_color': (s) => n(s, 'color\\s*=\\s*[^,)\\n]*\\?'),
  'vis:alert': (s) => n(s, '\\balert(condition)?\\s*\\('),
  // ── builtin namespaces ───────────────────────────────────────────────────
  'ns:ta': (s) => n(s, '\\bta\\s*\\.\\s*\\w+'),
  'ns:math': (s) => n(s, '\\bmath\\s*\\.\\s*\\w+'),
  'ns:str': (s) => n(s, '\\bstr\\s*\\.\\s*\\w+'),
  'ns:color': (s) => n(s, '\\bcolor\\s*\\.\\s*\\w+'),
  'ns:ticker': (s) => n(s, '\\bticker\\s*\\.\\s*\\w+'),
  'ns:chart': (s) => n(s, '\\bchart\\s*\\.\\s*\\w+'),
  'ns:runtime': (s) => n(s, '\\bruntime\\s*\\.\\s*\\w+'),
  // ── stateful builtins ────────────────────────────────────────────────────
  'sb:valuewhen': (s) => n(s, '\\bta\\s*\\.\\s*valuewhen\\b|\\bvaluewhen\\s*\\('),
  'sb:barssince': (s) => n(s, '\\bta\\s*\\.\\s*barssince\\b|\\bbarssince\\s*\\('),
  'sb:cum': (s) => n(s, '\\bta\\s*\\.\\s*cum\\b'),
  'sb:pivot': (s) => n(s, '\\bta\\s*\\.\\s*pivot(high|low)\\b|\\bpivot(high|low)\\s*\\('),
  'sb:cross': (s) => n(s, '\\bta\\s*\\.\\s*cross(over|under)?\\b|\\bcross(over|under)\\s*\\('),
}

function version(src) {
  const m = src.match(/\/\/\s*@version\s*=\s*(\d+)/)
  return m ? 'v' + m[1] : null
}
function declaration(s) {
  if (/\blibrary\s*\(/.test(s)) return 'library'
  if (/\bstrategy\s*\(/.test(s)) return 'strategy'
  if (/\bindicator\s*\(/.test(s)) return 'indicator'
  if (/\bstudy\s*\(/.test(s)) return 'study'
  return null
}

export function censusOne(src) {
  const s = strip(src)
  const out = { version: version(src), declaration: declaration(s), families: {} }
  for (const [k, f] of Object.entries(FAMILIES)) {
    const c = f(s)
    if (c > 0) out.families[k] = c
  }
  return out
}

// ─── self-test: a fixture whose expected counts are stated HERE ─────────────
const SELF = [
  '//@version=5',
  'indicator("t", overlay=true)',
  'var float acc = 0.0',
  'len = input.int(14, "Len")',
  'f(x, y) => [x + y, x - y]',
  '[a, b] = f(close, open)',
  'for i = 0 to 5',
  '    acc := acc + close[i] % 3',
  'arr = array.new_float(0)',
  'array.push(arr, acc)',
  'l = line.new(bar_index, high, bar_index, low)',
  'plot(a, color = close > open ? color.red : color.blue)',
].join('\n')

const SELF_EXPECT = {
  'state:var': 1, 'state:reassign': 1, 'loop:for': 1, 'udf:def': 1,
  'tuple:destructure': 1, 'tuple:return': 1, 'array:use': 2, 'array:new': 1,
  'obj:line': 1, 'op:modulo': 1, 'op:ternary': 1, 'input:int': 1, 'vis:plot': 1,
  // ⚠️ TWO, not one — the fixture's `line.new` names `bar_index` twice, and the
  // first draft of this expectation said 1. The self-test caught the AUTHOR, not
  // the matcher, which is the only reason it is worth having.
  'vis:dynamic_color': 1, 'history:subscript': 1, 'ctx:bar_index': 2,
}

function selfTest(loud) {
  const c = censusOne(SELF)
  let bad = 0
  if (c.version !== 'v5') { console.log('  FAIL version ' + c.version); bad += 1 }
  for (const [k, v] of Object.entries(SELF_EXPECT)) {
    const got = c.families[k] || 0
    if (got !== v) { console.log('  FAIL ' + k + ': want ' + v + ' got ' + got); bad += 1 }
  }
  if (loud || bad) {
    console.log(bad === 0
      ? 'SELF-TEST OK — every modelled family fired on the fixture'
      : 'SELF-TEST FAILED (' + bad + ') — the census cannot be trusted')
  }
  return bad === 0
}

// ─── main ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
if (args.includes('--self-test')) process.exit(selfTest(true) ? 0 : 1)
if (!selfTest(true)) {
  console.error('refusing to report a census whose matchers are broken')
  process.exit(1)
}

const rows = []
for (const [corpus, dir] of CORPORA) {
  const abs = path.resolve(process.cwd(), dir)
  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.pine')).sort()) {
    const c = censusOne(fs.readFileSync(path.join(abs, f), 'utf8'))
    rows.push(Object.assign({ corpus, name: f.replace(/\.pine$/, '') }, c))
  }
}
// parity10 members are drawn FROM oos60 — count unique scripts for totals.
const uniq = new Map()
for (const r of rows) if (!uniq.has(r.name)) uniq.set(r.name, r)
const U = [...uniq.values()]

const table = Object.keys(FAMILIES).map((f) => ({
  family: f,
  scripts: U.filter((r) => r.families[f]).length,
  uses: U.reduce((a, r) => a + (r.families[f] || 0), 0),
})).sort((a, b) => b.scripts - a.scripts)

console.log('\nROWS ' + rows.length + ' · UNIQUE SCRIPTS ' + U.length)
const vers = {}
for (const r of U) vers[r.version || 'none'] = (vers[r.version || 'none'] || 0) + 1
console.log('VERSIONS ' + JSON.stringify(vers))
const decl = {}
for (const r of U) decl[r.declaration || 'none'] = (decl[r.declaration || 'none'] || 0) + 1
console.log('DECLARATIONS ' + JSON.stringify(decl))

console.log('\n' + 'family'.padEnd(22) + 'scripts'.padStart(8) + 'pct'.padStart(7) + 'uses'.padStart(8))
for (const t of table) {
  if (t.scripts === 0) continue
  const pct = ((t.scripts / U.length) * 100).toFixed(0) + '%'
  console.log(t.family.padEnd(22) + String(t.scripts).padStart(8) + pct.padStart(7) + String(t.uses).padStart(8))
}
const zero = table.filter((t) => t.scripts === 0).map((t) => t.family)
if (zero.length) console.log('\nZERO-DEMAND FAMILIES (suspect the matcher first): ' + zero.join(', '))

const outIdx = args.indexOf('--json')
if (outIdx >= 0 && args[outIdx + 1]) {
  fs.writeFileSync(args[outIdx + 1], JSON.stringify({ rows, unique: U.length, table }, null, 2))
  console.log('\nwrote ' + args[outIdx + 1])
}
