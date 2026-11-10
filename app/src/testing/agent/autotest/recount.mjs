// UCT Agent AUTOTEST: recount Charts coverage from evidence that was RUN. Read-only: it writes no pin, no doc, no baseline.
//
//   node src/testing/agent/autotest/recount.mjs --vitest <vitest json> [--acceptance <json>]... [--autotest <results json>]... [--selection <results json>]... [--raises <json>] --out <file>
//
// A row counts only with evidence from this run:
//   panel     VERIFIED in docs/agent/CHARTS_EXECUTION_STATUS.md and every test it cites passed in --vitest, or a --raises entry whose
//             named test passed (a raise is {id: {file, title}}: the file must mount the real panel, and the title must be a passed test)
//   browser   every browser scenario or request naming the row passed. One failure takes the row out: a row with any failed
//             scenario does not count, even when another passed
//   teaching  VERIFIED in docs/agent/CHARTS_TEACH_STATUS.md. Those runs live outside this repository, so this reports the document and
//             whether the code they ran on has moved; it cannot re-prove a walkthrough
// The denominator comes from the documents' own tables, never from a constant here.
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { values: A } = parseArgs({ options: {
  vitest: { type: 'string' }, acceptance: { type: 'string', multiple: true, default: [] }, autotest: { type: 'string', multiple: true, default: [] }, selection: { type: 'string', multiple: true, default: [] },
  raises: { type: 'string', default: '' }, source: { type: 'string', default: '' }, 'teach-repo': { type: 'string', default: '' }, retag: { type: 'boolean', default: false }, exclude: { type: 'string', default: '' }, out: { type: 'string', default: '' }, repo: { type: 'string', default: '..' },
} })
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))
const doc = (f) => readFileSync(join(A.repo, 'docs', 'agent', f), 'utf8').split(/\r?\n/)
const cells = (l) => l.split('|').map(x => x.trim())
const isRow = (c) => /^C[123]-\d+$/.test(c[1] || '')

// the three inventory documents
const execLines = doc('CHARTS_EXECUTION_STATUS.md')
const start = execLines.findIndex(l => l.startsWith('## All actions'))
const rows = {}
for (const l of execLines.slice(start)) { const c = cells(l); if (isRow(c)) rows[c[1]] = { area: c[2], action: c[3], state: c[4], evidence: c[5] } }
for (const l of doc('CHARTS_COVERAGE_MATRIX.md')) { const c = cells(l); if (isRow(c) && rows[c[1]]) rows[c[1]].pri = c.at(-2) }
const teach = {}
// walkthroughs may be developed on another tree than execution: --teach-repo reads that tree's teach document
const teachLines = A['teach-repo'] ? readFileSync(join(A['teach-repo'], 'docs', 'agent', 'CHARTS_TEACH_STATUS.md'), 'utf8').split(/\r?\n/) : doc('CHARTS_TEACH_STATUS.md')
for (const l of teachLines) { const c = cells(l); if (isRow(c)) teach[c[1]] = c[4] }
const scope = Object.keys(rows).filter(id => rows[id].state !== 'NOT ON /CHARTS')

// what really passed
const V = json(A.vitest)
const files = V.testResults.map(f => ({ name: f.name.replace(/\\/g, '/'), tests: f.assertionResults }))
const passed = files.flatMap(f => f.tests.filter(t => t.status === 'passed').map(t => ({ file: f.name, name: t.fullName, title: t.title })))
const fileOf = (stem) => files.filter(f => f.name.split('/').pop().startsWith(`${stem}.`) || f.name.endsWith(`/${stem}`))
const hasPass = (fn) => passed.some(fn)
const FAILED = new Set(files.flatMap(f => f.tests.filter(t => t.status === 'failed').map(() => f.name)))

/** One citation in the evidence column. → true when it was run and passed. */
function citation(tok) {
  const t = tok.replace(/†/g, '').trim()
  if (!t || t === 'none') return null
  let m
  if ((m = /^c:(\S+)/.exec(t))) return hasPass(p => p.name.includes(`final state · ${m[1]} `) || p.name.includes(` ${m[1]} `) || p.name.endsWith(` ${m[1]}`))
  if ((m = /^g:(GW-\d+)/.exec(t))) return hasPass(p => p.name.includes(`golden workflows ${m[1]}`))
  if ((m = /^GW-\d+/.exec(t))) return hasPass(p => p.name.includes(`golden workflows ${m[0]}`))
  if ((m = /^([A-Za-z0-9_.-]+\.test\.jsx?)(?::\d+)?/.exec(t))) { const f = fileOf(m[1]); return f.length > 0 && f.every(x => !FAILED.has(x.name) && x.tests.some(y => y.status === 'passed')) }
  if ((m = /^([A-Za-z][A-Za-z0-9]*(?:\.outcome)?)(?: \(.*?\))?: *(.+)$/.exec(t))) {
    const f = fileOf(m[1]); if (!f.length) return false
    const label = m[2].replace(/^"|"$/g, '')
    return f.some(x => x.tests.some(y => y.status === 'passed' && y.fullName.toLowerCase().includes(label.toLowerCase())))
  }
  return undefined          // a citation this reader cannot parse: reported, never counted as a pass
}

const panel = new Set(), unproved = {}
for (const id of scope) {
  const r = rows[id]
  if (!r.state.startsWith('VERIFIED')) continue
  const toks = r.evidence.split(';').map(x => x.trim()).filter(Boolean)
  const res = toks.map(citation)
  if (res.length && res.every(x => x === true)) panel.add(id)
  else unproved[id] = toks.filter((_, i) => res[i] !== true)
}
const raises = A.raises ? json(A.raises) : {}
const raised = {}, refused = {}
for (const [id, e] of Object.entries(raises)) {
  const f = fileOf(e.file)
  const hit = f.flatMap(x => x.tests).some(t => t.status === 'passed' && t.title === e.title)
  const mounts = f.some(x => /AgentPanel|panelHarness|outcomeHarness|agentMount|openPanel|mountPanel/.test(readFileSync(x.name, 'utf8')))
  if (hit && mounts && rows[id] && rows[id].state !== 'NOT ON /CHARTS') { if (!panel.has(id)) raised[id] = e; panel.add(id) } else refused[id] = { ...e, hit, mounts }
}

// browser evidence: a row passes only if nothing naming it failed
const seen = {}
const note = (id, pass, by) => { (seen[id] = seen[id] || { pass: [], fail: [] })[pass ? 'pass' : 'fail'].push(by) }
for (const p of A.acceptance) for (const s of json(p)) for (const id of s.rows || []) note(id, s.pass, `acceptance:${s.id}`)
// a refusal, a how-to or an unsupported request executes nothing: it is not execution coverage of its row (teaching stays separate).
// --retag reads each request's rows from the current definitions, so a run made before a tag fix counts under the fixed tags.
const NOT_EXECUTION = new Set(['unsupported', 'invalid', 'howto'])
const tagOf = A.retag ? await (async () => {
  const m = await import('./requests.mjs')
  const all = [...m.publicRequests(), ...m.unseenRequests(), ...(m.unseen2Requests ? m.unseen2Requests() : []), ...(m.unseen3Requests ? m.unseen3Requests() : []), ...(m.unseen4Requests ? m.unseen4Requests() : []), ...(m.unseen5Requests ? m.unseen5Requests() : []), ...(m.unseen6Requests ? m.unseen6Requests() : []), ...(m.unseen7Requests ? m.unseen7Requests() : []), ...(m.unseen8Requests ? m.unseen8Requests() : []), ...(m.unseen9Requests ? m.unseen9Requests() : []), ...(m.unseen10Requests ? m.unseen10Requests() : []), ...(m.unseen11Requests ? m.unseen11Requests() : []), ...(m.unseen12Requests ? m.unseen12Requests() : []), ...(m.unseen13Requests ? m.unseen13Requests() : []), ...(m.unseen14Requests ? m.unseen14Requests() : []), ...(m.unseen15Requests ? m.unseen15Requests() : []), ...(m.unseen16Requests ? m.unseen16Requests() : []), ...(m.unseen17Requests ? m.unseen17Requests() : []), ...(m.unseen18Requests ? m.unseen18Requests() : []), ...(m.followup3Requests ? m.followup3Requests() : [])]
  return new Map(all.map(r => [r.id, r.inventory]))
})() : null
const skippedRows = { notExecution: 0 }
for (const p of A.autotest) for (const r of json(p).rows) {
  if (r.pass === null || !r.inventory) continue
  if (NOT_EXECUTION.has(r.kind) || r.family === 'explain') { skippedRows.notExecution++; continue }
  for (const id of (tagOf?.get(r.id) ?? r.inventory)) note(id, r.pass === true, `${r.set}:${r.id}`)
}
// a selection case with a deliberately wrong plan tests the guard, not the row: its failure is a defect report, not a row that does not execute.
// The same goes for a generated row-level case whose only failure is a request on a board or capability pairing outside the row (see `--exclude`).
const excluded = (id) => /-bad(Deictic|Named|Bare)$/.test(id) || (A.exclude && new RegExp(A.exclude).test(id))
for (const p of A.selection) for (const r of json(p).rows) if (r.pass !== null && r.inventory && !excluded(r.id)) for (const id of r.inventory) note(id, r.pass === true, `selection:${r.id}`)
const browser = Object.keys(seen).filter(id => seen[id].pass.length && !seen[id].fail.length && rows[id] && rows[id].state !== 'NOT ON /CHARTS')
const browserFailed = Object.keys(seen).filter(id => seen[id].fail.length)
const inP0 = (list) => list.filter(id => rows[id]?.pri === 'P0' && rows[id].state !== 'NOT ON /CHARTS').length
const P0 = scope.filter(id => rows[id].pri === 'P0')
for (const id of browser) panel.add(id)      // a real component in a browser, Agent executing, is stronger than the panel level
const executed = scope.filter(id => panel.has(id))

const tc = {}
for (const s of Object.values(teach)) tc[s] = (tc[s] || 0) + 1
const docState = {}
for (const id of scope) { const s = rows[id].state.replace(' †', ''); docState[s] = (docState[s] || 0) + 1 }
const out = {
  note: 'Local harness, scripted model. Nothing here is REAL-MODEL.',
  execution: { inScope: scope.length, documentVerified: docState.VERIFIED, reconfirmedOrRaised: executed.length, stillProvenFromDocument: [...panel].filter(id => rows[id]?.state.startsWith('VERIFIED')).length, raisedByTest: Object.keys(raised), raisedByBrowser: browser.filter(id => !rows[id].state.startsWith('VERIFIED')), documentRowsNotReproved: unproved, raisesRefused: refused, states: docState },
  browserMethod: { autotestRowsNotCountedAsExecution: skippedRows.notExecution, retagged: !!A.retag, tagInflation: 'a request names every row of its family, so one passing request credits each of them: browser counts are an upper bound' },
  browser: { rows: browser.length, p0: inP0(browser), p0Total: P0.length, failedRows: Object.fromEntries(browserFailed.map(id => [id, seen[id].fail])) },
  panelP0: { verified: P0.filter(id => panel.has(id)).length, total: P0.length },
  teaching: { total: Object.keys(teach).length, states: tc },
  tests: { total: V.numTotalTests, passed: V.numPassedTests, failed: V.numFailedTests, skipped: V.numPendingTests, files: V.testResults.length },
}
// the coverage ledger (ledger.mjs) reads each row: its area, P0, whether it counted, and the teach document's state
out.ledger = { source: A.source || '', rows: Object.fromEntries(scope.map(id => [id, { area: rows[id].area, p0: rows[id].pri === 'P0', executed: panel.has(id), browser: browser.includes(id), teach: teach[id] || null }])) }
const text = JSON.stringify(out, null, 1)
if (A.out) writeFileSync(A.out, text)
console.log(JSON.stringify({ execution: { inScope: out.execution.inScope, documentVerified: out.execution.documentVerified, counted: out.execution.reconfirmedOrRaised, raisedByTest: out.execution.raisedByTest.length, raisedByBrowser: out.execution.raisedByBrowser.length, notReproved: Object.keys(unproved).length }, browser: { rows: out.browser.rows, p0: out.browser.p0, p0Total: out.browser.p0Total, failed: browserFailed.length }, panelP0: out.panelP0, teaching: out.teaching, tests: out.tests }, null, 1))
