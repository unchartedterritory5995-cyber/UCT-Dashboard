/**
 * engine_run.mjs — run OUR Pine translator over the fetched community corpus.
 *
 * READ-ONLY against the repo: imports pine.js from an isolated export of
 * origin/master and writes results ONLY into this scratchpad folder.
 *
 * ⭐ RESUMABLE BY DESIGN, BECAUSE THE TRANSLATOR CAN DIE.
 * At least one published script drives translatePine past a 4 GB heap. An OOM is
 * not catchable in-process, so this script:
 *   1. names the file it is about to translate in engine_current.txt,
 *   2. persists results incrementally,
 *   3. on restart, treats a named-but-unrecorded file as the killer, records it
 *      in engine_killed.json, and skips it.
 * Re-invoke until it prints ALL_DONE. The killed list is itself a finding: a
 * renderer/runtime that must execute the wild has to survive these.
 *
 * ⛔ Do NOT pipe this to `tail` and trust the exit code — the pipeline's status is
 * tail's, not node's (that is how the first full pass looked clean while dying).
 *
 * NOTE ON WHAT THIS MEASURES: this translator yields SCREENABLE COLUMNS, not
 * pixels. "translated" means "offered at least one column" — a strictly narrower
 * question than "would render". Read the refusal histogram as the screener door's
 * blocker map.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const SRC = path.join(HERE, 'sources')
const REPO = path.resolve(HERE, '../enginesrc')
const PINE = pathToFileURL(path.join(REPO, 'app/src/components/chart/engine/ast/pine.js')).href

const F_RESULTS = path.join(HERE, 'engine_status.json')
const F_KILLED = path.join(HERE, 'engine_killed.json')
const F_CURRENT = path.join(HERE, 'engine_current.txt')
const F_AGG = path.join(HERE, 'engine_refusal_agg.json')

const readJson = (p, d) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d)
const out = readJson(F_RESULTS, {})
const killed = readJson(F_KILLED, {})

// ---- attribute the previous death, if there was one
if (fs.existsSync(F_CURRENT)) {
  const line = fs.readFileSync(F_CURRENT, 'utf8').trim()
  const slug = (line.split(/\s+/)[1] || '').replace(/\.pine$/, '')
  if (slug && !out[slug] && !killed[slug]) {
    // Two distinct real-world failure modes produce this state, and neither is
    // catchable in-process: a heap OOM, and a HANG (translatePine not returning).
    // The runner is invoked under an external `timeout`, so a hang lands here too.
    killed[slug] = { reason: 'killed the process — OOM, hang (no return), or hard crash' }
    fs.writeFileSync(F_KILLED, JSON.stringify(killed, null, 1))
    console.log(`RECORDED KILLER: ${slug}`)
  }
}

const { translatePine } = await import(PINE)

const guardOf = (x) =>
  (x && (x.guard || x.code || x.key || x.id || x.name)) || (x ? Object.keys(x).join('|') : null)

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.pine')).sort()
const allTodo = files.filter((f) => {
  const s = f.slice(0, -5)
  return !out[s] && !killed[s]
})
// ⭐ SMALL BATCHES ARE WHAT MAKE THE TIMEOUT AN ACCUSATION. The runner is invoked
// under an external `timeout`. If one invocation tried the whole corpus, a
// timeout would only mean "the batch ran long" and the file named in
// engine_current.txt could be perfectly innocent — blacklisting it would be a
// false accusation. Bounding the batch well under the timeout means a timeout
// implicates the ONE file it was sitting on.
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 250)
const todo = allTodo.slice(0, MAX_PER_RUN)
console.log(`files=${files.length} done=${Object.keys(out).length} killed=${Object.keys(killed).length} remaining=${allTodo.length} thisRun=${todo.length}`)

let n = 0
for (const f of todo) {
  const slug = f.slice(0, -5)
  const src = fs.readFileSync(path.join(SRC, f), 'utf8')
  fs.writeFileSync(F_CURRENT, `${n} ${f}\n`)
  let r
  try {
    r = translatePine(src)
  } catch (err) {
    out[slug] = { ok: false, threw: String(err && err.message).slice(0, 200) }
    n++
    continue
  }
  const outputs = Array.isArray(r.outputs) ? r.outputs : []
  out[slug] = {
    ok: !!r.ok,
    version: r.version ?? null,
    declaration: r.declaration ?? null,
    outputs: outputs.length,
    outputsWithRefusal: outputs.filter((o) => o && o.refusal).length,
    outputKinds: [...new Set(outputs.map((o) => o && o.kind).filter(Boolean))],
    refusal: guardOf(r.refusal),
    refusals: [...new Set((r.refusals || []).map(guardOf).filter(Boolean))],
    notes: (r.notes || []).length,
  }
  n++
  // Flush often: anything since the last flush is lost when the process is killed
  // and has to be re-translated on the next attempt.
  if (n % 10 === 0) fs.writeFileSync(F_RESULTS, JSON.stringify(out, null, 1))
  if (n % 100 === 0) console.log(`  processed ${n}/${todo.length}`)
}

fs.writeFileSync(F_RESULTS, JSON.stringify(out, null, 1))
if (fs.existsSync(F_CURRENT)) fs.unlinkSync(F_CURRENT)

// ---------- aggregate over everything recorded so far ----------
const recs = Object.entries(out)
const N = recs.length
const guardCount = new Map()
const guardExample = new Map()
let okCount = 0
let threw = 0
for (const [slug, r] of recs) {
  if (r.threw) threw++
  // a translated script = ok AND at least one column that is not itself refused
  const columns = (r.outputs || 0) - (r.outputsWithRefusal || 0)
  if (r.ok && columns > 0) okCount++
  const guards = (r.refusals && r.refusals.length) ? r.refusals : r.refusal ? [r.refusal] : []
  for (const g of guards) {
    guardCount.set(g, (guardCount.get(g) || 0) + 1)
    if (!guardExample.has(g)) guardExample.set(g, slug)
  }
}
const agg = [...guardCount.entries()].sort((a, b) => b[1] - a[1]).map(([guard, scripts]) => ({
  guard, scripts, pct_of_corpus: +((100 * scripts) / N).toFixed(1), example: guardExample.get(guard),
}))
fs.writeFileSync(F_AGG, JSON.stringify({
  n_scripts: N, translated: okCount, threw,
  killed_process: Object.keys(killed),
  refusals: agg,
}, null, 1))

console.log(`\nscripts recorded=${N} translated=${okCount} (${((100 * okCount) / N).toFixed(1)}%) threw=${threw} killed=${Object.keys(killed).length}`)
if (allTodo.length === 0) console.log('ALL_DONE')
