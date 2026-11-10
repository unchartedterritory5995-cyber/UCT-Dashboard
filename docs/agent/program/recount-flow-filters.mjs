// node recount-flow-filters.mjs <status doc> [--write] : apply the F-16 widened row change (C3-166, the Options Flow
// widget's chips) to the "All actions" table, recount it into "Counts by area", "The number" and the runtime-only bullet, add the combined-
// counts row and the update section. The recount is first checked to reproduce the CURRENT "Counts by area" table exactly from the
// CURRENT rows (else it stops), so it can be re-run on top of any later master. Line endings are kept per line. Dry run without --write.
import fs from 'node:fs'
const [file, flag] = process.argv.slice(2)
const raw = fs.readFileSync(file, 'utf8')
const parts = raw.split(/(\r?\n)/)
const L = []; for (let i = 0; i < parts.length; i += 2) L.push({ t: parts[i], e: parts[i + 1] ?? '' })
const cells = (t) => t.split('|').map((x) => x.trim())
const allStart = L.findIndex((l) => l.t.startsWith('## All actions'))
const isRow = (t) => /^\| C[123]-\d+ \|/.test(t)
const cat = (s) => s.startsWith('VERIFIED') ? 'VERIFIED' : s.startsWith('PARTIAL') ? 'PARTIAL' : s === 'IMPLEMENTED / UNVERIFIED' ? 'IMPL' : s === 'MISSING' ? 'MISSING'
  : s === 'BLOCKED' ? 'BLOCKED' : s === 'UNMAPPED' ? 'UNMAPPED' : s === 'NOT ON /CHARTS' ? 'EXCL' : `?${s}`
const COLS = ['VERIFIED', 'PARTIAL', 'IMPL', 'MISSING', 'BLOCKED', 'UNMAPPED']
const zero = () => Object.fromEntries([...COLS, 'EXCL'].map((x) => [x, 0]))
function recount() {
  const by = new Map(); let runtime = 0
  for (let i = allStart; i < L.length; i++) {
    if (!isRow(L[i].t)) continue
    const c = cells(L[i].t); const k = `${c[1].slice(0, 2)}|${c[2]}`; const s = cat(c[4])
    if (s.startsWith('?')) throw new Error(`unknown state on ${c[1]}: ${c[4]}`)
    if (!by.has(k)) by.set(k, zero())
    by.get(k)[s]++
    if (s === 'IMPL' && c[7] === 'runtime, no panel') runtime++
  }
  return { by, runtime }
}
const areaStart = L.findIndex((l) => l.t.startsWith('## Counts by area'))
function areaTable({ by }) {
  const out = []; const sums = {}; const total = zero()
  for (let i = areaStart; i < allStart; i++) {
    const t = L[i].t
    if (!/^\| C[123] \| /.test(t) || t.includes('**all**')) continue
    const c = cells(t); const n = by.get(`${c[1]}|${c[2]}`) || zero()
    out.push([i, `| ${c[1]} | ${c[2]} | ${COLS.map((x) => n[x]).join(' | ')} | ${COLS.reduce((a, x) => a + n[x], 0)} | ${n.EXCL} |`])
    sums[c[1]] ||= zero()
    for (const x of [...COLS, 'EXCL']) { sums[c[1]][x] += n[x]; total[x] += n[x] }
  }
  for (const [k] of by) if (!out.some(([, t]) => t.startsWith(`| ${k.split('|')[0]} | ${k.split('|')[1]} |`))) throw new Error(`area ${k} not in the table`)
  for (let i = areaStart; i < allStart; i++) {
    const t = L[i].t
    const m = /^\| (C[123]) \| \*\*all\*\* \|/.exec(t)
    if (m) { const n = sums[m[1]]; out.push([i, `| ${m[1]} | **all** | ${COLS.map((x) => n[x]).join(' | ')} | ${COLS.reduce((a, x) => a + n[x], 0)} | ${n.EXCL} |`]) }
    if (/^\| \| \*\*Total\*\* \|/.test(t)) out.push([i, `| | **Total** | ${COLS.map((x) => total[x]).join(' | ')} | ${COLS.reduce((a, x) => a + total[x], 0)} | ${total.EXCL} |`])
  }
  return { out, total }
}
const before = recount(); const tb = areaTable(before)
const mismatch = tb.out.filter(([i, t]) => L[i].t !== t)
if (mismatch.length) { console.error('recount does not reproduce the current table:', mismatch.slice(0, 5).map(([i, t]) => [L[i].t, t])); process.exit(2) }
console.log('recount reproduces the current table; before:', JSON.stringify(tb.total), 'runtime-only IMPL:', before.runtime)

// ── the row changes (state, evidence, result) ──
const V = 'VERIFIED (SIMULATED outcome test, scripted model, jsdom)'
const EV = 'panel, scripted model'
const F = 'flowFilters.outcome.test.jsx'; const FR = process.env.FLOW_RESULT || 'pass ?/?'
const ROWS = {
  'C3-166': [V, `${F}: C3-166 over the real OptionsFlowWidget, every chip group (premium, call/put, type, direction) and AND across groups: 12 held-out set phrasings + 2 resets read back from opts.filters AND the prints drawn, Undo exact; 5 refusals (same-group conflicts, a premium no chip has, an invented filter); two widgets asked or named; approve paths. F-16 widened by the owner 2026-11-10 (from #872)`, FR],
}
const changed = []
for (let i = allStart; i < L.length; i++) {
  if (!isRow(L[i].t)) continue
  const c = cells(L[i].t); const r = ROWS[c[1]]; if (!r) continue
  changed.push([c[1], c[4]])
  L[i].t = `| ${c[1]} | ${c[2]} | ${c[3]} | ${r[0]} | ${r[1]} | ${r[2]} | ${EV} |`
}
if (changed.length !== Object.keys(ROWS).length) throw new Error(`changed ${changed.length} rows of ${Object.keys(ROWS).length}`)
console.log('was:', JSON.stringify(changed))
const after = recount(); const ta = areaTable(after)
for (const [i, t] of ta.out) L[i].t = t
const T = ta.total; const pct = (T.VERIFIED / 484 * 100).toFixed(1)
console.log('after:', JSON.stringify(T), 'runtime-only IMPL:', after.runtime)

// ── "The number", the runtime bullet, the combined-counts row, the update section ──
const B = tb.total
const rep = (re, to) => { const i = L.findIndex((l) => re.test(l.t)); if (i < 0) throw new Error(`not found ${re}`); L[i].t = L[i].t.replace(re, to) }
rep(/\*\*(\d+) of 484 actions, [\d.]+%, are VERIFIED at panel level with a scripted model\*\* \(([^)]*)\)\. A further (\d+) are PARTIAL \(SIMULATED\)/,
  (_m, _v, why) => `**${T.VERIFIED} of 484 actions, ${pct}%, are VERIFIED at panel level with a scripted model** (${why.replace(/plus (\d+) on 2026-11-10/, (_x, n) => `plus ${Number(n) + T.VERIFIED - B.VERIFIED} on 2026-11-10`)}, ${T.VERIFIED - B.VERIFIED} from the Options Flow chips). A further ${T.PARTIAL} are PARTIAL (SIMULATED)`)
rep(/A further (\d+) rows have a passing runtime test \(capability and writer, no panel\)\. They are IMPLEMENTED \/ UNVERIFIED and are not in the (\d+)\./,
  `A further ${after.runtime} rows have a passing runtime test (capability and writer, no panel). They are IMPLEMENTED / UNVERIFIED and are not in the ${T.VERIFIED}.`)
// the combined-counts table: a row after its last row
let cc = L.findIndex((l) => l.t.startsWith('### Combined counts'))
if (cc < 0) throw new Error('combined counts')
while (!L[cc].t.startsWith('| after')) cc++
while (L[cc + 1].t.startsWith('| after')) cc++
L.splice(cc + 1, 0, { t: `| after the Options Flow chips (agent/pl/exec-flow-filters) | ${COLS.map((x) => T[x]).join(' | ')} | ${COLS.reduce((a, x) => a + T[x], 0)} | ${T.EXCL} |`, e: L[cc].e })
const up = L.findIndex((l) => l.t.startsWith('## Update 2026-11-10'))
const eol = L[up].e
const list = (want) => Object.entries(ROWS).filter(([, r]) => cat(r[0]) === want).map(([k]) => k)
const was = (ids) => { const g = {}; for (const [k, s] of changed) if (ids.includes(k)) (g[s] ||= []).push(k); return Object.entries(g).map(([s, ks]) => `was ${s} (${ks.length}): ${ks.join(', ')}`).join('; ') }
const v = list('VERIFIED'), p = list('PARTIAL')
const sec = [
  "## Update 2026-11-10 (4): the Options Flow widget's chips, F-16 widened (agent/pl/exec-flow-filters)", '',
  'The owner widened F-16 to every existing Options Flow widget chip (Calls / Puts, Sweep / Block, Bull / Bear, the premium floor), through the widget’s own control (widget.setOption → opts.filters), never a screen, no hidden field, no data read, no trade. Built on #872 (Calls only). Test: `app/src/agent/qa/chartsOutcome/flowFilters.outcome.test.jsx` over the REAL OptionsFlowWidget beside the real panel (scripted model, jsdom, SIMULATED). PR doc: `docs/agent/program/PR-exec-flow-filters.md`.', '',
  `- VERIFIED (${v.length}): ${v.join(', ')}; ${was(v)}.`,
  '- Recounted from the "All actions" table by `recount-flow-filters.mjs` (it first reproduces the previous "Counts by area" exactly from the previous rows).', '',
].map((t) => ({ t, e: eol }))
L.splice(up, 0, ...sec)
const text = L.map((l) => l.t + l.e).join('')
if (flag === '--write') { fs.writeFileSync(file, text); console.log('written') }
