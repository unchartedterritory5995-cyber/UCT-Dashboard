// UCT Agent AUTOTEST: the runner. Local harness by default, free by default.
//
//   node src/testing/agent/autotest/run.mjs --mode browser-mock [--sample 2] [--ids regex] [--set public|heldout|all] [--out dir]
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
import { publicRequests, sample, setHash } from './requests.mjs'
import { lint, summarize, loadManifest } from './lint.mjs'
import { blobInfo, loadHeldout } from './heldout.mjs'
import { say, rowOf, writeFailure, finish } from './report.mjs'
import { authorize, MAX_AUTHORIZED_USD } from './realGuard.mjs'
import { stageList } from './stages.mjs'

const { values: A } = parseArgs({ options: {
  mode: { type: 'string', default: '' }, target: { type: 'string', default: 'local' }, set: { type: 'string', default: 'public' }, sample: { type: 'string', default: '' },
  ids: { type: 'string', default: '' }, out: { type: 'string', default: 'autotest-out' }, stage: { type: 'string', default: '' }, lint: { type: 'boolean', default: false }, 'guard-check': { type: 'boolean', default: false },
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
  let L = A.set === 'heldout' ? loadHeldout() : A.set === 'all' ? [...pub, ...loadHeldout()] : pub
  if (A.ids) { const re = new RegExp(A.ids); L = L.filter(r => re.test(r.id)) }
  if (A.sample) L = sample(L, Number(A.sample))
  return L
})()

const dir = A.out
mkdirSync(join(dir, 'shots'), { recursive: true })
const known = new Set(loadManifest().map(c => c.name))
let ctx
if (MODE === 'REAL-MODEL') {
  if (A.target === 'production') {
    const { runProduction } = await import('./productionTarget.mjs')
    const code = await runProduction({ authorization: authorize.last, list, dir, known })
    process.exit(code)
  }
  const { startRealRelay } = await import('./realRelay.mjs')
  ctx = { R: await startRealRelay(authorize.last, { publicSha: setHash(pub), heldoutSha: blobInfo()?.sha256, spendLog: join(dir, 'spend.jsonl') }), mock: false, turnTimeoutMs: 60000 }
} else {
  const { startRelay } = await import('../acceptance/lib.mjs')
  const { groupOfAction } = await import(pathToFileURL(process.env.BA_ROUTING).href)
  ctx = { R: await startRelay({ groupOfAction }), mock: true }
}
const { runRequest } = await import('./driver.mjs')

say(MODE, `${list.length} requests, set ${A.set}, out ${dir}`)
const rows = []
for (const req of list) {
  const heldout = req.set === 'heldout'
  const shotPath = heldout ? null : join(dir, 'shots', `${req.id}.png`)
  const from = ctx.R.spend?.length ?? 0
  const { evidence, result } = await runRequest({ ...ctx, shotPath }, req)
  if (ctx.R.turnUsd) evidence.usd = Number(ctx.R.turnUsd(from).toFixed(6))
  const row = rowOf(req, evidence, result, { mode: MODE, known })
  rows.push(row)
  say(MODE, `${row.pass ? 'PASS' : 'FAIL'} ${req.id} ${row.path}${heldout || row.pass ? '' : ` [${row.layer}] ${row.firstCheck}: ${String(row.failed?.[0]?.detail || '').slice(0, 160)}`}`)
  if (!row.pass) writeFailure(dir, req, evidence, row, MODE)
  finish(dir, MODE, rows, { partial: true, set: A.set, hash: setHash(pub) })
  if (ctx.R.stopped) { say(MODE, `STOPPED: ${ctx.R.stopped}`); break }
}
const out = finish(dir, MODE, rows, { partial: rows.length < list.length, set: A.set, hash: setHash(pub), stopped: ctx.R.stopped || null })
writeFileSync(join(dir, `families.${MODE}.json`), JSON.stringify(out.failureFamilies, null, 1))
ctx.R.close?.()
process.exit(0)
