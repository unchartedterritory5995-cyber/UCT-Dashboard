// node recount-widget-actions.mjs <status doc> [--write] : apply the pl-widget row changes (data-widget actions + watchlist
// groups A–D) to the "All actions" table, recount it into "Counts by area", "The number" and the runtime-only bullet, add the combined-
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
const J = 'widgetJournal.outcome.test.jsx'; const JR = 'pass 7/7'
const A = 'widgetActions.outcome.test.jsx'; const AR = 'pass 24/24'
const W = 'watchlistLook.outcome.test.jsx'; const WR = 'pass 18/18'
const LC = 'listControl.outcome.test.jsx'; const LR = 'pass 114/114 (1 known gap pinned both ways)'
const S = 'agentWatchlistShow.test.jsx'; const SR = 'pass 35/35'
const O = 'agentWatchlistOut.test.jsx + Watchlists.listout.test.jsx'; const OR = 'pass 29/29 + 7/7'
const ROWS = {
  'C3-132': [V, `${J}: C3-132 "drop my alerts into the journal" (the real Alerts widget's capture door; shown first; the other widget untouched)`, JR],
  'C3-137': [V, `${J}: C3-137 "put the news and catalysts feed in a fresh journal note"`, JR],
  'C3-186': [V, `${J}: C3-186 "save the market context panel to my notebook inbox"; NEGATIVE Dismiss`, JR],
  'C3-200': [V, `${J}: C3-200 "journal this ai search conversation" (the conversation is seeded through the widget's own initialThread prop: fixture data, no paid stream); NEGATIVE no conversation → refused`, JR],
  'C3-180': ['PARTIAL (SIMULATED) — covered: send the fundamentals to the Journal (the real widget\'s capture door); not covered: its appearance (a global pref, no door row)', `${J}: C3-180 "send the fundamentals table to a new journal note"`, JR],
  'C3-112': [V, `${A}: C3-112 x8 held-out ("refresh the scanner", "rerun the scanner now", …): the widget's own SWR mutate runs once, the receipt only after it resolves, a failed re-read claims nothing, two scanners told apart by position`, AR],
  'C3-208': [V, `${A}: C3-208 x6 held-out ("refresh the period sort", "reload the period sort ranking", …)`, AR],
  'C3-108': [V, `${A}: C3-108 x4 held-out ("leave this scan in the scanner", "take the scanner back to its picker", …): scanKey / scanName cleared as its own "change scan" does, Undo exact; NEGATIVE already on the picker`, AR],
  'C3-103': ['PARTIAL (SIMULATED) — covered: logos, tick-flash tint, solid canvas, text, gain and loss colours through the ⚙ panel\'s own writer (this widget\'s opts.settings), the other widget untouched, Undo exact; not covered: gradient canvas, fonts, grid colour, tint colours', `${W}: C3-103 x6 held-out; NEGATIVE "sort of bluish" (#rrggbb)`, WR],
  'C3-104': [V, `${W}: C3-104 x5 held-out: save the look under a name (shown first; the look the widget had), apply a saved look (Undo exact), delete one (shown first); NEGATIVE unknown look, no name`, WR],
  'C3-074': [V, `${W}: C3-074 "rename my flagged list to Hot Hands", "call the flagged watchlist A-List" (the title menu's renameFlagged; Undo renames back); NEGATIVE not showing Flagged`, WR],
  'C3-085': [V, `${LC}: C3-085 x4 held-out (move a column before / after another, as the header drop does: the stored order and the header follow; Undo exact); NEGATIVE a hidden or unknown column`, LR],
  'C3-086': [V, `${LC}: C3-086 2 of 3 held-out (a width as the gridline sets it; Undo exact); NEGATIVE under the minimum, over 600; KNOWN GAP "narrow the price column to 50" answered by the quote fast path before the model (pinned it.fails + today's output)`, LR],
  'C3-063': [V, `${S}: C3-063 held-out x6 (own lists, as the picker writes them; Undo restores the previous watchKey exactly)`, SR],
  'C3-064': [V, `${S}: C3-064 held-out x12 (prebuilt and community); NEGATIVE near names`, SR],
  'C3-065': [V, `${S}: C3-065 held-out x3 (Flagged)`, SR],
  'C3-067': [V, `${S}: C3-067 held-out x3 (back to the picker)`, SR],
  'C3-094': [V, `${O}: C3-094 copied only once the clipboard write resolved (a refused write says so); the door reaches exactly the list menu's Copy (real Watchlists)`, OR],
  'C3-095': [V, `${O}: C3-095 CSV at once, Excel always proposed first (a quota); own lists only; the door reaches exactly the menu's Export CSV / Excel (real Watchlists)`, OR],
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
  (_m, _v, why) => `**${T.VERIFIED} of 484 actions, ${pct}%, are VERIFIED at panel level with a scripted model** (${why.replace(/plus (\d+) on 2026-11-10/, (_x, n) => `plus ${Number(n) + T.VERIFIED - B.VERIFIED} on 2026-11-10`)}, ${T.VERIFIED - B.VERIFIED} from the data-widget actions and watchlist groups A–D). A further ${T.PARTIAL} are PARTIAL (SIMULATED)`)
rep(/A further (\d+) rows have a passing runtime test \(capability and writer, no panel\)\. They are IMPLEMENTED \/ UNVERIFIED and are not in the (\d+)\./,
  `A further ${after.runtime} rows have a passing runtime test (capability and writer, no panel). They are IMPLEMENTED / UNVERIFIED and are not in the ${T.VERIFIED}.`)
// the combined-counts table: a row after its last row
let cc = L.findIndex((l) => l.t.startsWith('### Combined counts'))
if (cc < 0) throw new Error('combined counts')
while (!L[cc].t.startsWith('| after')) cc++
while (L[cc + 1].t.startsWith('| after')) cc++
L.splice(cc + 1, 0, { t: `| after the data-widget actions + watchlist A–D (agent/pl/exec-widget-actions) | ${COLS.map((x) => T[x]).join(' | ')} | ${COLS.reduce((a, x) => a + T[x], 0)} | ${T.EXCL} |`, e: L[cc].e })
const up = L.findIndex((l) => l.t.startsWith('## Update 2026-11-10'))
const eol = L[up].e
const list = (want) => Object.entries(ROWS).filter(([, r]) => cat(r[0]) === want).map(([k]) => k)
const was = (ids) => { const g = {}; for (const [k, s] of changed) if (ids.includes(k)) (g[s] ||= []).push(k); return Object.entries(g).map(([s, ks]) => `was ${s} (${ks.length}): ${ks.join(', ')}`).join('; ') }
const v = list('VERIFIED'), p = list('PARTIAL')
const sec = [
  '## Update 2026-11-10 (3): data-widget actions and watchlist groups A–D (agent/pl/exec-widget-actions)', '',
  'One widget-action layer: every row is data in `widgets/widgetControls.js` / `agent/widgetNames.js`, run by `widget.setOption` through the widget\'s own door (`pages/charts/widgetDoors.js`). New row types: `action` (a widget\'s own button, `act(key)`; done only once it resolves, nothing to undo) and `color` (#rrggbb). New capability: `watchlist.arrangeColumns` (the header drag\'s and the gridline\'s own results, now shared with the drag). Tests: real Agent panel beside the REAL widgets (Alerts, News, Market Context, AI Search, Fundamentals, Scanner, Period Sort, Watchlist), scripted model, jsdom, SIMULATED. Held-out phrasings were committed before each change and failed before it (48 of 48). PR doc: `docs/agent/program/PR-exec-widget-actions.md`.', '',
  `- VERIFIED (${v.length}): ${v.join(', ')}; ${was(v)}.`,
  `- PARTIAL (SIMULATED) (${p.length}): ${p.join(', ')}; ${was(p)}. C3-103: no gradient, fonts, grid or tint colours. C3-180: the Journal half only.`,
  '- Known gap, pinned both ways: "narrow the price column to 50" (C3-086) is answered by the quote fast path before the model. Not this PR: C3-166 (the Options Flow chips, F-16 widened) is #1029\'s row, VERIFIED there. Deferred: C3-071, C3-072, C3-097 (see the PR doc).',
  '- Recounted from the "All actions" table by `recount-widget-actions.mjs` (it first reproduces the previous "Counts by area" exactly from the previous rows).', '',
].map((t) => ({ t, e: eol }))
L.splice(up, 0, ...sec)
const text = L.map((l) => l.t + l.e).join('')
if (flag === '--write') { fs.writeFileSync(file, text); console.log('written') }
