// UCT Agent AUTOTEST: the runner. Local harness by default, free by default.
//
//   node src/testing/agent/autotest/run.mjs --mode browser-mock [--sample 2] [--ids regex] [--set public|heldout|unseen|unseen2|unseen3|unseen4|unseen5|unseen6|unseen7|unseen8|unseen9|unseen10|unseen11|unseen12|unseen13|unseen14|unseen15|unseen16|unseen17|unseen18|followup3|all] [--env VITE_FLAG=1]... [--out dir] [--cache dir] [--port 5303]
//     BROWSER-MOCK-MODEL owns its dev server (selectionServe.mjs) unless BA_BASE is set: it starts here and dies with the process
//   node src/testing/agent/autotest/run.mjs --mode real-model --target local|production --stage <name>
//   node src/testing/agent/autotest/run.mjs --lint          the set's own checks, sizes and hash (free)
//   node src/testing/agent/autotest/run.mjs --guard-check   exercise the REAL-MODEL guard only: prints why it refuses
//
// SIMULATED runs under vitest: AGENT_AUTOTEST=1 npx vitest run src/testing/agent/autotest/simulated.test.jsx
// ⛔ REAL-MODEL: `authorize()` runs FIRST, before a browser or a socket exists, and refuses without the owner's file.
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { publicRequests, unseenRequests, unseen2Requests, unseen3Requests, followup3Requests, unseen4Requests, unseen5Requests, unseen6Requests, unseen7Requests, unseen8Requests, unseen9Requests, unseen10Requests, unseen11Requests, unseen12Requests, unseen13Requests, unseen14Requests, unseen15Requests, unseen16Requests, unseen17Requests, unseen18Requests, sample, setHash } from './requests.mjs'
import { lint, summarize, loadManifest } from './lint.mjs'
import { blobInfo, loadHeldout } from './heldout.mjs'
import { say, rowOf, writeFailure, finish } from './report.mjs'
import { authorize, MAX_AUTHORIZED_USD } from './realGuard.mjs'
import { stageList } from './stages.mjs'

const { values: A } = parseArgs({ options: {
  mode: { type: 'string', default: '' }, target: { type: 'string', default: 'local' }, set: { type: 'string', default: 'public' }, sample: { type: 'string', default: '' },
  ids: { type: 'string', default: '' }, cache: { type: 'string', default: '' }, port: { type: 'string', default: '5303' }, env: { type: 'string', multiple: true, default: [] }, out: { type: 'string', default: 'autotest-out' }, stage: { type: 'string', default: '' }, lint: { type: 'boolean', default: false }, 'guard-check': { type: 'boolean', default: false },
} })

const pub = publicRequests()
if (A.lint) {
  const errs = lint(pub)
  let held = null
  try { held = loadHeldout() } catch { /* the key is not on this machine */ }
  const heldErrs = held ? lint(held, { other: pub }).map(e => e.replace(/:.*/, ': lint error (text withheld)')) : []
  console.log(JSON.stringify({ lintErrors: errs.length, public: summarize(pub), publicHash: setHash(pub), heldout: blobInfo(), heldoutLintErrors: held ? heldErrs.length : 'key absent' }, null, 1))
  for (const e of [...errs, ...heldErrs].slice(0, 80)) console.log(`  ${e}`)
  process.exit(errs.length + heldErrs.length ? 1 : 0)
}
const MODE = A.mode === 'real-model' ? 'REAL-MODEL' : 'BROWSER-MOCK-MODEL'

// the guard is the first thing a real run does, and the guard check does nothing else
if (A['guard-check'] || A.mode === 'real-model') {
  const verdict = authorize({ target: A.target, stage: A.stage, setHashes: { public: setHash(pub), heldout: blobInfo()?.sha256 ?? null } })
  if (!verdict.ok) {
    say('REAL-MODEL', `REFUSED: ${verdict.reason}. No browser was started, no socket was opened, no model was called. Limit: authorization of at most $${MAX_AUTHORIZED_USD}.`)
    process.exit(3)
  }
  if (A['guard-check']) { say('REAL-MODEL', `the authorization file holds (max $${verdict.maxUsd}, target ${A.target}). Nothing was run.`); process.exit(0) }
}

const list = (() => {
  if (MODE === 'REAL-MODEL') return stageList(A.stage, pub, A.stage === 'heldout' ? loadHeldout() : [])
  let L = A.set === 'heldout' ? loadHeldout() : A.set === 'unseen' ? unseenRequests() : A.set === 'unseen2' ? unseen2Requests() : A.set === 'unseen3' ? unseen3Requests() : A.set === 'followup3' ? followup3Requests() : A.set === 'unseen4' ? unseen4Requests() : A.set === 'unseen5' ? unseen5Requests() : A.set === 'unseen6' ? unseen6Requests() : A.set === 'unseen7' ? unseen7Requests() : A.set === 'unseen8' ? unseen8Requests() : A.set === 'unseen9' ? unseen9Requests() : A.set === 'unseen10' ? unseen10Requests() : A.set === 'unseen11' ? unseen11Requests() : A.set === 'unseen12' ? unseen12Requests() : A.set === 'unseen13' ? unseen13Requests() : A.set === 'unseen14' ? unseen14Requests() : A.set === 'unseen15' ? unseen15Requests() : A.set === 'unseen16' ? unseen16Requests() : A.set === 'unseen17' ? unseen17Requests() : A.set === 'unseen18' ? unseen18Requests() : A.set === 'all' ? [...pub, ...loadHeldout()] : pub
  if (A.ids) { const re = new RegExp(A.ids); L = L.filter(r => re.test(r.id)) }
  if (A.sample) L = sample(L, Number(A.sample))
  return L
})()

const dir = A.out
mkdirSync(join(dir, 'shots'), { recursive: true })
const known = new Set(loadManifest().map(c => c.name))
let ctx, server = null
if (MODE === 'REAL-MODEL') {
  if (A.target === 'production') {
    const { runProduction } = await import('./productionTarget.mjs')
    const code = await runProduction({ authorization: authorize.last, list, dir, known })
    process.exit(code)
  }
  const { startRealRelay } = await import('./realRelay.mjs')
  ctx = { R: await startRealRelay(authorize.last, { publicSha: setHash(pub), heldoutSha: blobInfo()?.sha256, spendLog: join(dir, 'spend.jsonl') }), mock: false, turnTimeoutMs: 60000 }
} else {
  const { startMock } = await import('./mockServer.mjs')
  ;({ ctx, server } = await startMock({ port: Number(A.port), cache: A.cache, env: A.env }))
}
const { runRequest } = await import('./driver.mjs')
const { runProfile } = await import('../../../econHarness/cdp.mjs')
const { claimProfile, reapOrphans, freeProfile } = await import('./profileGuard.mjs')
let hungOnce = false
const reaped = reapOrphans()       // profiles a hard-killed earlier run left behind (its owner pid is gone)
if (reaped.length) say(MODE, `reaped ${reaped.length} orphaned Chrome profile(s) from dead runs`)
ctx.profile = claimProfile(runProfile())   // one Chrome profile for the run, removed when the process ends
// a person's own steps between sentences (a request's `{ act }` turns): a real click on a chart
const { BOARDS: ACT_BOARDS } = await import('./boards.mjs')
ctx.acts = { click: (p, req, t) => p.select(ACT_BOARDS[req.board].roles[t.role].id) }

say(MODE, `${list.length} requests, set ${A.set}, out ${dir}`)
const rows = []
for (const req of list) {
  const heldout = req.set === 'heldout'
  const shotPath = heldout ? null : join(dir, 'shots', `${req.id}.png`)
  const from = ctx.R.spend?.length ?? 0
  let page = null, timer
  // a page that stops answering (a native dialog, a hung tab) fails its one request, never the run
  const hung = new Promise((resolve) => { timer = setTimeout(() => { hungOnce = true; page?.close().catch(() => {}); resolve({ evidence: { turns: [], crash: 'the page stopped answering' }, result: { pass: false, graded: 0, na: 0, checks: [{ name: 'the run reached the end', pass: false, detail: 'the page stopped answering', tag: 'crash' }] } }) }, 150000) })
  let { evidence, result } = await Promise.race([runRequest({ ...ctx, shotPath, onPage: (p) => { page = p } }, req), hung])
  clearTimeout(timer)
  if (hungOnce) { hungOnce = false; const k = await freeProfile(ctx.profile); if (k) say(MODE, `killed ${k} stuck Chrome process(es) holding the run profile`) }
  // a launch that failed because a stray Chrome still held the run profile: free it and try that one request once more
  if (/chrome did not come up/.test(evidence.crash || '')) { const k = await freeProfile(ctx.profile); say(MODE, `retrying ${req.id} after "chrome did not come up" (freed ${k} stuck Chrome)`); ({ evidence, result } = await runRequest({ ...ctx, shotPath, onPage: (p) => { page = p } }, req)) }
  if (ctx.R.turnUsd) evidence.usd = Number(ctx.R.turnUsd(from).toFixed(6))
  const row = rowOf(req, evidence, result, { mode: MODE, known })
  rows.push(row)
  say(MODE, `${row.pass ? 'PASS' : row.pass === null ? 'NOT-RUN' : 'FAIL'} ${req.id} ${row.path}${heldout || row.pass !== false ? '' : ` [${row.layer}] ${row.firstCheck}: ${String(row.failed?.[0]?.detail || '').slice(0, 160)}`}`)
  if (row.pass === false) writeFailure(dir, req, evidence, row, MODE)
  finish(dir, MODE, rows, { partial: true, set: A.set, hash: setHash(pub) })
  if (ctx.R.stopped) { say(MODE, `STOPPED: ${ctx.R.stopped}`); break }
}
const out = finish(dir, MODE, rows, { partial: rows.length < list.length, set: A.set, hash: setHash(pub), stopped: ctx.R.stopped || null })
writeFileSync(join(dir, `families.${MODE}.json`), JSON.stringify(out.failureFamilies, null, 1))
ctx.R.close?.()
await server?.close()
process.exit(0)
