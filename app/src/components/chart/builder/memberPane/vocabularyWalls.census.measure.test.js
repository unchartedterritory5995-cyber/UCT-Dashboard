// app/src/components/chart/builder/memberPane/vocabularyWalls.census.measure.test.js
//
// ─── WHICH VOCABULARY NAME IS THE *LAST* WALL — opt-in, never an ordinary run ───
//
// For every committed corpus script the member door refuses with a VOCABULARY
// guard (pine:function / pine:builtin / pine:arity / pine:input-kind), flag off
// and on: substitute a CORRECT-TYPE value for the refused name (every occurrence),
// re-run the door, and repeat until it attaches or meets a non-vocabulary wall.
// The chain answers "is this name the last thing between the script and the
// pane", which a first-refusal census cannot: a name masked by another wall, or
// followed by one, is demand without unlock.
//
// ⛔ SUBSTITUTE, NEVER DELETE. Deleting the binding line removes a NAME, and the
// script then meets `pine:undefined` — an inflated, invented wall. Each rule below
// is a value of the type Pine returns there (a timestamp for `time(...)`, a price
// for `ta.nvi`, a number for `syminfo.mintick`), chosen only so the door can
// proceed; it is never a claim about what the name computes.
//
//   cd app && VOCAB_CENSUS=1 VOCAB_CENSUS_OUT=<path> node node_modules/vitest/vitest.mjs run //     src/components/chart/builder/memberPane/vocabularyWalls.census.measure.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { memberPaneDefinition } from './memberPaneDefinition'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const VOCAB = new Set(['pine:function', 'pine:builtin', 'pine:arity', 'pine:input-kind'])

// balanced-paren end index for a call starting at `open` (index of '(')
function closeOf(src, open) {
  let d = 0; let q = null
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === q && src[i - 1] !== '\\') q = null; continue }
    if (c === '"' || c === "'") { q = c; continue }
    if (c === '(') d++
    else if (c === ')') { d--; if (d === 0) return i }
  }
  return -1
}
function args(inner) {
  const out = []; let d = 0; let q = null; let cur = ''
  for (const c of inner) {
    if (q) { cur += c; if (c === q) q = null; continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === '(' || c === '[') d++
    if (c === ')' || c === ']') d--
    if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
// replace every call/ident of `name` via fn(argsArray|null) -> string
function replaceAll(src, name, fn) {
  const esc = name.replace(/\./g, '\\.')
  const re = new RegExp(`(?<![\\w.])${esc}(?![\\w])`, 'g')
  let out = ''; let last = 0; let m
  while ((m = re.exec(src))) {
    let j = m.index + m[0].length
    while (src[j] === ' ') j++
    if (src[j] === '(') {
      const e = closeOf(src, j)
      if (e < 0) break
      out += src.slice(last, m.index) + fn(args(src.slice(j + 1, e)))
      last = e + 1; re.lastIndex = e + 1
    } else {
      out += src.slice(last, m.index) + fn(null)
      last = j; re.lastIndex = j
    }
  }
  return out + src.slice(last)
}
// A substitution is a CORRECT-TYPE VALUE the engine already accepts — never a deletion.
const RULES = {
  time: (a) => (a ? 'time' : null),
  'ta.nvi': () => 'close',
  'timeframe.in_seconds': () => '86400',
  'barstate.isnew': () => 'true',
  vwap: (a) => (a && a.length === 1 ? 'ta.vwap' : null),
  int: (a) => (a ? `math.round(${a[0]})` : null),
  year: (a) => (a ? 'year' : null),
  'syminfo.mintick': () => '0.01',
  'input.time': () => '1652832000000',
  'ta.barssince': () => 'close',
  barssince: () => 'close',
  'ta.alma': () => 'close',
  'chart.leftBarIndex': () => '0',
  'chart.rightBarIndex': () => '0',
  'chart.bars': () => '0',
  month: (a) => (a ? 'month' : null),
  dayofmonth: (a) => (a ? 'dayofmonth' : null),
  dayofweek: (a) => (a ? 'dayofweek' : null),
  hour: (a) => (a ? 'hour' : null),
  minute: (a) => (a ? 'minute' : null),
  'ta.pvi': () => 'close',
  'str.length': () => '1',
  'chart.right_visible_bar_time': () => 'time',
  'chart.left_visible_bar_time': () => 'time',
}
function ruleFor(tok, source) {
  if (tok === 'math.max' && /syminfo\.mintick/.test(source)) return 'syminfo.mintick'
  return RULES[tok] ? tok : null
}
function probe(source) {
  const d = memberPaneDefinition({ source, id: 'u', name: 'C' })
  const r = (d.translation && d.translation.refusal) || null
  return { ok: d.ok, guard: d.guard, tok: r && r.token, line: r && r.line, reason: (d.reason || '').slice(0, 140) }
}
const RUN = process.env.VOCAB_CENSUS === '1'
const OUT = process.env.VOCAB_CENSUS_OUT || path.join(os.tmpdir(), 'vocabulary_walls_census.json')
afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!RUN)('vocabulary last-wall census (opt-in)', () => {
it('chains every vocabulary-refused corpus script, flag off and on', () => {
  const res = {}
  for (const flag of ['', '1']) {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', flag)
    const rows = []
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) {
      let source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      let p = probe(source)
      if (p.ok || !VOCAB.has(p.guard)) continue
      const chain = []
      for (let i = 0; i < 12; i++) {
        if (p.ok || !VOCAB.has(p.guard)) break
        const name = ruleFor(p.tok, source)
        chain.push({ guard: p.guard, tok: p.tok, line: p.line, name })
        if (!name) break
        const next = replaceAll(source, name, RULES[name])
        if (next === source) { chain[chain.length - 1].stuck = true; break }
        source = next
        p = probe(source)
      }
      rows.push({ f, chain, end: { ok: p.ok, guard: p.guard, tok: p.tok, line: p.line, reason: p.reason } })
    }
    res[flag ? 'on' : 'off'] = rows
  }
  expect(res.on.length).toBeGreaterThan(0) // non-vacuity: vocabulary refusals were found
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1))
  // eslint-disable-next-line no-console
  console.log(`vocabulary last-wall census -> ${OUT}`)
}, 600000)
})
