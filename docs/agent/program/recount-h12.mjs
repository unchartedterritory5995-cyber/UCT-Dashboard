// node recount-h12.mjs <status doc> [--write] : apply the held-out-12 row changes to the "All actions" table, recount it into
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

// 2. the row changes
const F = 'heldout12.outcome.test.jsx'; const RES = 'pass 33/33 (4 todo)'; const EV = 'panel, scripted model'
const V = 'VERIFIED (SIMULATED outcome test, scripted model, jsdom)'
const ROWS = {
  'C1-065': [V, `${F}: C1-065 "I don't need the open price in the bar readout"; "show the percent change in the OHLC strip"; "drop the date from the bar info"`],
  'C1-066': [V, `${F}: C1-066 "put the dollar volume in the info row"; "take market cap off the header stats"; "remove the UCT rating from the info row"; "info row: add 30 day change"; "add RVOL to the stat strip above the chart"`],
  'C3-125': [V, `${F}: C3-125 "show logos in the volume surge"; "volume-surge logos on"`],
  'C3-133': [V, `${F}: C3-133 "news widget: only bullish catalysts"`],
  'C3-151': ['PARTIAL (SIMULATED) — covered: econStars set, read back and undone, from "change the calendar widget filter to 3 stars" (tune phrasing); not covered: both held-out phrasings ("show only 3 star economic events", "calendar widget: only 3 star economic events") reach the model without widget.setOption (calendar.day only), a KNOWN GAP pinned',
    `${F}: C3-151 "change the calendar widget filter to 3 stars"; KNOWN GAP (routed) x2`],
  'C3-159': [V, `${F}: C3-159 "show the ratio view on breadth"; "switch the breadth widget back to the heatmap"`],
  'C3-164': [V, `${F}: C3-164 "switch options flow to just this symbol"; "put the options flow back on the whole market"`],
  'C3-165': [V, `${F}: C3-165 "lead with the biggest trades in options flow"`],
  'C3-166': ['PARTIAL (SIMULATED) — covered: call/put ("options flow: puts only", "options-flow: calls only"), print type ("options flow: sweeps only"), premium floor and direction (tune phrasings), each read back from opts.filters and undone; not covered: the held-out "only show sweeps in the options flow" is refused before the model by the stale FLOW_WIDGET_REFUSAL (useAgent.js:2299-2305), a KNOWN GAP pinned (product fix for pl-exec)',
    `${F}: C3-166 x5; KNOWN GAP (refused) x1`],
  'C3-194': [V, `${F}: C3-194 "have the market map follow my watchlist"`],
  'C3-195': ['PARTIAL (SIMULATED) — covered: labels off / all (labelMode read back, Undo); not covered: zoom in / out / reset, an echarts dataZoom with no capability (it.todo)',
    `${F}: C3-195 "turn off labels on the market map"; "set the market-map labels off"; "label every dot on the market map"`],
  'C3-206': ['PARTIAL (SIMULATED) — covered: grouping by theme / sector / industry (group read back, Undo); not covered: replay to the end date, the start mark, and ungrouping back to stocks (it.todo each)',
    `${F}: C3-206 "group period sort by industry"`],
}
const changed = []
for (let i = allStart; i < L.length; i++) {
  if (!isRow(L[i].t)) continue
  const c = cells(L[i].t); const r = ROWS[c[1]]; if (!r) continue
  changed.push([c[1], c[4]])
  L[i].t = `| ${c[1]} | ${c[2]} | ${c[3]} | ${r[0]} | ${r[1]} | ${RES} | ${EV} |`
}
if (changed.length !== 12) throw new Error(`changed ${changed.length} rows`)
console.log('was:', JSON.stringify(changed))
const after = recount(); const ta = areaTable(after)
for (const [i, t] of ta.out) L[i].t = t
console.log('after:', JSON.stringify(ta.total), 'runtime-only IMPL:', after.runtime)

// 3. "The number", the runtime bullet, the combined-counts row and the update section
const T = ta.total; const pct = (T.VERIFIED / 484 * 100).toFixed(1)
const rep = (re, to) => { const i = L.findIndex((l) => re.test(l.t)); if (i < 0) throw new Error(`not found ${re}`); L[i].t = L[i].t.replace(re, to) }
rep(/\*\*225 of 484 actions, 46\.5%, are VERIFIED at panel level with a scripted model\*\* \(158 in the 2026-11-05 run, plus 67 on 2026-11-10: 29 from the chart-settings outcome test, 3 from the Multi Chart outcome test, 35 from the cited-test re-run\)\. A further 9 are PARTIAL \(SIMULATED\)/,
  `**${T.VERIFIED} of 484 actions, ${pct}%, are VERIFIED at panel level with a scripted model** (158 in the 2026-11-05 run, plus ${T.VERIFIED - 158} on 2026-11-10: 29 from the chart-settings outcome test, 3 from the Multi Chart outcome test, 35 from the cited-test re-run, 8 from the held-out-12 outcome test). A further ${T.PARTIAL} are PARTIAL (SIMULATED)`)
rep(/A further 29 rows have a passing runtime test \(capability and writer, no panel\)\. They are IMPLEMENTED \/ UNVERIFIED and are not in the 225\. \(It was 43 on 2026-11-05; 14 of them were raised on 2026-11-10\.\)/,
  `A further ${after.runtime} rows have a passing runtime test (capability and writer, no panel). They are IMPLEMENTED / UNVERIFIED and are not in the ${T.VERIFIED}. (It was 43 on 2026-11-05; ${43 - after.runtime} of them were raised on 2026-11-10.)`)
const cc = L.findIndex((l) => l.t.startsWith('| after chart settings + multichart + cited re-run |'))
if (cc < 0) throw new Error('combined row')
const ccRow = `| after the held-out 12 (agent/pl/exec-heldout12) | ${COLS.map((x) => T[x]).join(' | ')} | ${COLS.reduce((a, x) => a + T[x], 0)} | ${T.EXCL} |`
L.splice(cc + 1, 0, { t: ccRow, e: L[cc].e })
const up = L.findIndex((l) => l.t.startsWith('## Update 2026-11-10: combined execution packets'))
const eol = L[up].e
const sec = [
  '## Update 2026-11-10 (2): the 12 held-out-only rows (agent/pl/exec-heldout12)', '',
  'Test: `app/src/agent/qa/chartsOutcome/heldout12.outcome.test.jsx` (one file, real Agent panel over one fixture board holding the selected chart and one widget of every type the rows name; scripted model, jsdom, SIMULATED). Each case reads the end state back from the stored opts, or the chart blob through `headerFieldKeys` / `barInfoFieldsOf`, checks the chart and every other widget are byte-identical, and checks Undo. Totals: `Tests 33 passed | 4 todo (37)`. Method, per-row table, gaps: `docs/agent/program/EXEC-HELDOUT12.md`.', '',
  '- VERIFIED (8): C1-065, C1-066, C3-125, C3-133, C3-159, C3-164, C3-165, C3-194; was MISSING (4): C1-065, C1-066, C3-159, C3-194; was IMPLEMENTED / UNVERIFIED (4): C3-125, C3-133, C3-164, C3-165.',
  '- PARTIAL (SIMULATED) (4): C3-151, C3-166, C3-195, C3-206; was IMPLEMENTED / UNVERIFIED (1): C3-151; was MISSING (3): C3-166, C3-195, C3-206.',
  '- Known gaps, each an `it.fails` outcome plus a plain `it` pinning today\'s exact output: C3-151 held-out phrasings route without the board-edit group (calendar.day only); C3-166 "only show sweeps in the options flow" is refused pre-model by the stale `FLOW_WIDGET_REFUSAL` (useAgent.js:2299-2305), which `widget.setOption printType` can already do (product fix for pl-exec). it.todo: C3-195 zoom; C3-206 replay, start mark, ungroup.',
  '- Recounted from the "All actions" table by `recount-h12.mjs` (it first reproduces the previous "Counts by area" exactly from the previous rows).', '',
].map((t) => ({ t, e: eol }))
L.splice(up, 0, ...sec)
const text = L.map((l) => l.t + l.e).join('')
if (flag === '--write') { fs.writeFileSync(file, text); console.log('written') }
