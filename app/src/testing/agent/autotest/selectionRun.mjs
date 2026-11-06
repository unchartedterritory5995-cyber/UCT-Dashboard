// UCT Agent AUTOTEST: the selection oracle's runner. BROWSER-MOCK-MODEL, free, never a paid call. The real Charts and Agent panel in
// isolated headless Chrome, on a dev server this process owns: it starts here and dies with the process, so nothing is left listening.
//
//   node src/testing/agent/autotest/selectionRun.mjs --set public|heldout|negative [--ids regex] [--mutate first-chart|first-click] --out dir --cache dir
//
// Run it from app/. `--cache` must be a scratch folder of this run's own. A held-out result leaves as id, family, pass, layer only.
// A negative case passes the run only when its named target check FAILED: a green negative case means the oracle is blind.
// --mutate serves the app with a wrong-chart bug patched in at transform time (no file changes): the set must go red.
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { startServer } from './selectionServe.mjs'

const { values: A } = parseArgs({ options: {
  set: { type: 'string', default: 'public' }, ids: { type: 'string', default: '' }, mutate: { type: 'string', default: '' },
  from: { type: 'string', default: '' }, out: { type: 'string', default: 'selection-out' }, cache: { type: 'string', default: '' }, port: { type: 'string', default: '5993' },
} })
if (!A.cache) throw new Error('--cache: a scratch folder outside every shared folder')
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'UCT_AGENT_EVAL_API_KEY']) delete process.env[k]

const MODE = 'BROWSER-MOCK-MODEL'
const server = await startServer({ port: Number(A.port), cacheDir: A.cache, mutate: A.mutate || null })
process.env.BA_BASE = server.base
const { startRelay, sleep } = await import('../acceptance/lib.mjs')
const { runRequest } = await import('./driver.mjs')
const { BOARDS } = await import('./boards.mjs')
const { rowOf, writeFailure, finish, say } = await import('./report.mjs')
const { loadManifest } = await import('./lint.mjs')
const { selectionRequests, negativeRequests } = await import('./selectionCases.mjs')
const { runProfile } = await import('../../../econHarness/cdp.mjs')
const { groupOfAction } = await import(pathToFileURL(server.routing).href)

// the steps a person takes between sentences, all real input
const roleBox = (p, role, req) => p.b.evaluate(`(() => { const e = document.querySelector('[data-widget-id=${JSON.stringify(BOARDS[req.board].roles[role].id)}]'); const c = [...e.querySelectorAll('canvas')].sort((a, z) => z.width * z.height - a.width * a.height)[0]; const w = e.getBoundingClientRect(), r = c ? c.getBoundingClientRect() : w; return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right, bottom: r.bottom, left: w.left, top: w.top } })()`)
const acts = {
  click: async (p, req, t) => {
    if (!t.where) return p.select(BOARDS[req.board].roles[t.role].id)
    const r = await roleBox(p, t.role, req)
    if (t.where === 'edge') await p.b.click(r.left + 3, r.top + 3)
    if (t.where === 'axis') await p.b.click(r.right - 20, r.y)
    await p.b.hover(2, 2)
    await sleep(300)
  },
  hover: async (p, req, t) => { const r = await roleBox(p, t.role, req); await p.b.hover(r.x, r.y); await sleep(300); await p.b.hover(2, 2) },
  clickWidget: async (p, req, t) => {
    const c = await p.b.evaluate(`(() => { const r = document.querySelector('[data-widget-id=${JSON.stringify(t.id)}]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 10 } })()`)
    await p.b.click(c.x, c.y)
    await sleep(300)
  },
  close: async (p, req, t) => {
    const c = await p.b.evaluate(`(() => { const e = document.querySelector('[data-widget-id=${JSON.stringify(BOARDS[req.board].roles[t.role].id)}] [aria-label="Close widget"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    if (!c) throw new Error(`no close button on ${t.role}`)
    await p.b.click(c.x, c.y)
    await sleep(600)
    await p.settle()
  },
  // a real click on a chart's own scale button, by a person, after the Agent has finished
  humanScale: async (p, req, t) => {
    const id = BOARDS[req.board].roles[t.role].id
    const c = await p.b.evaluate(`(() => { const e = [...document.querySelectorAll('[data-widget-id=${JSON.stringify(id)}] [class*="scaleToggleBtn"]')].find(b => !/[Aa]ctive/.test(b.className)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    if (!c) throw new Error('no scale button')
    await p.b.click(c.x, c.y)
    await sleep(500)
    await p.settle()
    await p.b.hover(2, 2)
  },
}

const list = (() => {
  let L
  if (A.set === 'negative') L = negativeRequests()
  else if (A.set === 'heldout') L = null
  else L = selectionRequests()
  return L
})()
const requests = list ?? (await import('./selectionHeldout.mjs')).loadSealed()
const chosen = A.ids ? requests.filter(r => new RegExp(A.ids).test(r.id)) : requests
const picked = A.from ? chosen.slice(chosen.findIndex(r => r.id === A.from)) : chosen

const dir = A.out
mkdirSync(join(dir, 'shots'), { recursive: true })
const known = new Set(loadManifest().map(c => c.name))
const R = await startRelay({ groupOfAction })
let page = null
const ctx = { R, mock: true, acts, profile: runProfile(), onPage: (p) => { page = p } }
const label = A.mutate ? `${MODE} MUTANT ${A.mutate}` : MODE
say(label, `${picked.length} requests, set ${A.set}, out ${dir}, ${server.base}`)

const rows = [], records = []
for (const req of picked) {
  const held = req.set === 'heldout'
  const shotPath = held ? null : join(dir, 'shots', `${req.id}.png`)
  // a page that stops answering (a native dialog, a hung tab) fails its one request, never the run
  let timer
  const hung = new Promise((resolve) => { timer = setTimeout(() => { page?.close().catch(() => {}); resolve({ evidence: { turns: [], crash: 'the page stopped answering' }, result: { pass: false, graded: 0, na: 0, checks: [{ name: 'the run reached the end', pass: false, detail: 'the page stopped answering', tag: 'crash' }] } }) }, 150000) })
  const { evidence, result } = await Promise.race([runRequest({ ...ctx, shotPath }, req), hung])
  clearTimeout(timer)
  const row = rowOf(req, evidence, result, { mode: MODE, known })
  const rec = evidence.target ? { clicked: evidence.target.clicked, intended: evidence.target.intended, landed: evidence.target.landed, told: evidence.target.told, modelCalls: evidence.target.modelCalls } : null
  if (req.negative) {
    const caught = result.checks.some(c => c.pass === false && c.tag === 'target' && c.name.includes(req.negative))
    row.negative = { wants: req.negative, caught }
    row.pass = caught               // a negative case passes by its check failing
    if (caught) { delete row.failed; delete row.layer }
  }
  rows.push(row)
  records.push(held ? { id: req.id, family: req.family, pass: row.pass } : { id: req.id, board: req.board, family: req.family, pass: row.pass, ...rec, firstCheck: row.firstCheck })
  say(label, `${row.pass ? 'PASS' : 'FAIL'} ${req.id} ${row.path}${held ? '' : ` ${rec ? `clicked=${rec.clicked} intended=${rec.intended} landed=${rec.landed} told=${rec.told}` : ''}${row.pass === false ? ` [${row.layer}] ${row.firstCheck}: ${String(row.failed?.[0]?.detail || '').slice(0, 200)}` : ''}`}`)
  if (row.pass === false) writeFailure(dir, req, evidence, row, MODE)
  writeFileSync(join(dir, `records.${A.set}${A.mutate ? `.${A.mutate}` : ''}.json`), JSON.stringify(records, null, 1))
  finish(dir, MODE, rows, { partial: true, set: A.set, mutant: A.mutate || null })
}
const out = finish(dir, MODE, rows, { partial: false, set: A.set, mutant: A.mutate || null })
writeFileSync(join(dir, `families.${A.set}${A.mutate ? `.${A.mutate}` : ''}.json`), JSON.stringify(out.failureFamilies, null, 1))
R.close?.()
await server.close()
process.exit(0)
