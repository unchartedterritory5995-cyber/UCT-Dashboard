// node recount-h12.mjs <status doc> [--write] : apply the C3-080 exclusion to the "All actions" table, recount it into
// "Counts by area", "The number" and the runtime-only bullet, add the update section. The recount is first checked to
// reproduce the CURRENT "Counts by area" table exactly from the CURRENT rows (else it stops). Line endings are kept per line.
import fs from 'node:fs'
const [file, flag] = process.argv.slice(2)
const raw = fs.readFileSync(file, 'utf8')
const parts = raw.split(/(\r?\n)/) // [line, eol, line, eol, ...]
const L = []; for (let i = 0; i < parts.length; i += 2) L.push({ t: parts[i], e: parts[i + 1] ?? '' })
const cells = (t) => t.split('|').map((x) => x.trim())
const allStart = L.findIndex((l) => l.t.startsWith('## All actions'))
const isRow = (t) => /^\| C[123]-\d+ \|/.test(t)
const cat = (s) => s.startsWith('VERIFIED') ? 'VERIFIED' : s.startsWith('PARTIAL') ? 'PARTIAL' : s === 'IMPLEMENTED / UNVERIFIED' ? 'IMPL' : s === 'MISSING' ? 'MISSING'
  : s === 'BLOCKED' ? 'BLOCKED' : s === 'UNMAPPED' ? 'UNMAPPED' : s === 'NOT ON /CHARTS' ? 'EXCL' : `?${s}`
const COLS = ['VERIFIED', 'PARTIAL', 'IMPL', 'MISSING', 'BLOCKED', 'UNMAPPED']

function recount() {
  const by = new Map(); const tot = { runtime: 0 }
  for (let i = allStart; i < L.length; i++) {
    if (!isRow(L[i].t)) continue
    const c = cells(L[i].t); const part = c[1].slice(0, 2); const k = `${part}|${c[2]}`; const s = cat(c[4])
    if (s.startsWith('?')) throw new Error(`unknown state on ${c[1]}: ${c[4]}`)
    if (!by.has(k)) by.set(k, Object.fromEntries([...COLS, 'EXCL'].map((x) => [x, 0])))
    by.get(k)[s]++
    if (s === 'IMPL' && c[7] === 'runtime, no panel') tot.runtime++
  }
  return { by, runtime: tot.runtime }
}
const areaStart = L.findIndex((l) => l.t.startsWith('## Counts by area'))
function areaTable({ by }) {
  // the existing table's row order; each row recomputed
  const out = []; const sums = { C1: null, C2: null, C3: null }; const total = Object.fromEntries([...COLS, 'EXCL'].map((x) => [x, 0]))
  for (let i = areaStart; i < allStart; i++) {
    const t = L[i].t
    if (!/^\| C[123] \| /.test(t) || t.includes('**all**')) continue
    const c = cells(t); const n = by.get(`${c[1]}|${c[2]}`) || Object.fromEntries([...COLS, 'EXCL'].map((x) => [x, 0]))
    const scope = COLS.reduce((a, x) => a + n[x], 0)
    out.push([i, `| ${c[1]} | ${c[2]} | ${COLS.map((x) => n[x]).join(' | ')} | ${scope} | ${n.EXCL} |`])
    sums[c[1]] = sums[c[1]] || Object.fromEntries([...COLS, 'EXCL'].map((x) => [x, 0]))
    for (const x of [...COLS, 'EXCL']) { sums[c[1]][x] += n[x]; total[x] += n[x] }
  }
  const seen = new Set(out.map(([i]) => i))
  for (const [k] of by) if (![...out].some(([, t]) => t.startsWith(`| ${k.split('|')[0]} | ${k.split('|')[1]} |`))) throw new Error(`area ${k} not in the table`)
  for (let i = areaStart; i < allStart; i++) {
    const t = L[i].t
    const m = /^\| (C[123]) \| \*\*all\*\* \|/.exec(t)
    if (m) { const n = sums[m[1]]; out.push([i, `| ${m[1]} | **all** | ${COLS.map((x) => n[x]).join(' | ')} | ${COLS.reduce((a, x) => a + n[x], 0)} | ${n.EXCL} |`]) }
    if (/^\| \| \*\*Total\*\* \|/.test(t)) out.push([i, `| | **Total** | ${COLS.map((x) => total[x]).join(' | ')} | ${COLS.reduce((a, x) => a + total[x], 0)} | ${total.EXCL} |`])
  }
  void seen
  return { out, total }
}
// 1. the recount reproduces today's table
const before = recount(); const tb = areaTable(before)
const mismatch = tb.out.filter(([i, t]) => L[i].t !== t)
if (mismatch.length) { console.error('recount does not reproduce the current table:', mismatch.slice(0, 5).map(([i, t]) => [L[i].t, t])); process.exit(2) }
console.log('recount reproduces the current table; before:', JSON.stringify(tb.total), 'runtime-only IMPL:', before.runtime)

// 2. C3-080 leaves scope: NOT IN PRODUCT (feature intentionally removed in 72482c8400; dead code deleted 2026-11-10)
const WHY = 'Feature intentionally removed in 72482c8400 (star-as-flag); the unreachable starred code was deleted 2026-11-10 (owner: it stays removed). NOT IN PRODUCT, like inventory v2.'
let hit = 0
for (let i = allStart; i < L.length; i++) {
  if (!isRow(L[i].t)) continue
  const c = cells(L[i].t); if (c[1] !== 'C3-080') continue
  if (c[4] !== 'IMPLEMENTED / UNVERIFIED') throw new Error(`C3-080 is ${c[4]}`)
  L[i].t = `| C3-080 | ${c[2]} | ${c[3]} | NOT ON /CHARTS | none (was IMPLEMENTED / UNVERIFIED): ${WHY} | n/a | n/a |`; hit++
}
if (hit !== 1) throw new Error('C3-080 row')
// the Excluded table, in ID order
const exS = L.findIndex((l) => l.t.startsWith('| Excluded | Action | Was | Why |'))
let at = exS + 2; while (isRow(L[at].t) && cells(L[at].t)[1] < 'C3-080') at++
L.splice(at, 0, { t: `| C3-080 | Remove all starred symbols from a list | IMPLEMENTED / UNVERIFIED | ${WHY} |`, e: L[exS].e })
const after = recount(); const ta = areaTable(after)
for (const [i, t] of ta.out) L[i].t = t
console.log('after:', JSON.stringify(ta.total), 'runtime-only IMPL:', after.runtime)
const T = ta.total; const SC = COLS.reduce((a, x) => a + T[x], 0); const pct = (T.VERIFIED / SC * 100).toFixed(1)
const rep = (re, to) => { const i = L.findIndex((l) => re.test(l.t)); if (i < 0) throw new Error(`not found ${re}`); L[i].t = L[i].t.replace(re, to) }
rep(/\*\*(\d+) of 484 actions, [\d.]+%, are VERIFIED/, `**${T.VERIFIED} of ${SC} actions, ${pct}%, are VERIFIED`)
rep(/^(499 inventory rows, minus 19 with no real control on desktop \/charts, plus 4 real right-click rows the inventory never had, gives 484\.)/,
  `$1 2026-11-10: C3-080 (remove all starred) is NOT IN PRODUCT, so it is excluded too: ${SC} in scope, ${T.EXCL} excluded.`)
const cc = L.findIndex((l) => l.t.startsWith('| after the held-out 12 (agent/pl/exec-heldout12) |'))
if (cc < 0) throw new Error('combined row')
L.splice(cc + 1, 0, { t: `| after C3-080 left scope (NOT IN PRODUCT) | ${COLS.map((x) => T[x]).join(' | ')} | ${SC} | ${T.EXCL} |`, e: L[cc].e })
const up = L.findIndex((l) => l.t.startsWith('## Update 2026-11-10 (2):'))
const eol = L[up].e
L.splice(up, 0, ...['## Update 2026-11-10 (3): C3-080 leaves scope (agent/pl/remove-starred-dead-code)', '',
  `- C3-080 "Remove all starred symbols from a list" is NOT IN PRODUCT: the feature was intentionally removed in 72482c8400 (star-as-flag), and the unreachable starred code left behind (starred state, toggleStar, getStarredSyms, handleRemoveStarred, the "Remove starred (N)" menu row) was deleted on this branch. It is NOT ON /CHARTS (was IMPLEMENTED / UNVERIFIED) and listed in "Denominator", consistent with inventory v2. In scope ${SC}, excluded ${T.EXCL}; VERIFIED ${T.VERIFIED} of ${SC}, ${pct}%.`,
  '- Recounted from the "All actions" table by `docs/agent/program/recount-c3080.mjs` (it first reproduces the previous "Counts by area" exactly from the previous rows).', ''].map((t) => ({ t, e: eol })))
const text = L.map((l) => l.t + l.e).join('')
if (flag === '--write') { fs.writeFileSync(file, text); console.log('written') }
