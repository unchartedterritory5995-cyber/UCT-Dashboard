// tools/pine_survey/translate_batch.mjs
//
// ─── RUN THE TRANSLATOR OVER A CORPUS WITHOUT LETTING ONE SCRIPT TAKE THE RUN ──
//
// ⛔⛔ THE IN-PROCESS GUARD IS NOT ENOUGH, AND THIS IS THE MEASUREMENT THAT SAYS SO.
// `pine:timeout` (wall clock + step cap, in `pine.js`) catches every shape where
// JS keeps executing. It does NOT catch the one that started all this: on
// `parabolic-sar__xoeoPMOWGJ.pine`, `resolve` is entered ~130,000 times in 134ms
// and then STOPS being entered at all, while the process spends the next 150
// seconds in native GC — profiled at 47% node.exe, 36% ntdll, ~2% JS, with no OOM
// even at a 1 GB heap cap. A guard written in JS cannot fire in a process that has
// stopped running JS.
//
// ⭐ SO THE BATCH GUARD IS A PROCESS BOUNDARY. Each script is translated in a
// child process with a kill timeout. A child that never answers is killed and
// recorded as a `pine:timeout` refusal NAMING THE FILE — which is exactly what the
// in-process guard would have produced, arrived at from the outside.
//
// ⚠️ THE TWO ARE NOT REDUNDANT. The in-process guard gives a real refusal inside a
// single translation (a member pasting a script gets an answer, not a spinner);
// the process boundary is what makes a 4,898-script run finish. Neither replaces
// the other.
//
// Usage
// -----
//   node tools/pine_survey/translate_batch.mjs <dir> [--out FILE] [--timeout-ms N]
//                                                    [--src ROOT] [--jobs N]

import fs from 'node:fs'
import path from 'node:path'
import { fork } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const REPO = path.resolve(HERE, '..', '..')

function arg(name, dflt) {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

const DIR = process.argv[2]
if (!DIR || DIR.startsWith('--')) {
  console.error('usage: translate_batch.mjs <dir> [--out FILE] [--timeout-ms N] [--src ROOT] [--jobs N]')
  process.exit(2)
}
const OUT = arg('--out', path.join(REPO, 'tools', 'pine_survey', 'translate_batch.json'))
// ⚠️ Generously above the in-process budget (10s), so a child that is merely slow
// is answered by the REFUSAL rather than by the axe — a kill loses the guard's
// own message and the line number with it.
const TIMEOUT_MS = Number(arg('--timeout-ms', 30000))
const SRC_ROOT = arg('--src', path.join(REPO, 'app', 'src'))
const JOBS = Math.max(1, Number(arg('--jobs', 1)))

// ── the child: translate exactly one file and answer once ──────────────────
if (process.env.UCT_TRANSLATE_CHILD === '1') {
  const { translatePine } = await import(
    pathToFileURL(path.join(process.env.UCT_SRC_ROOT, 'components', 'chart', 'engine', 'ast', 'pine.js')).href)
  process.on('message', (m) => {
    const src = fs.readFileSync(m.file, 'utf8')
    let out
    try {
      const strict = translatePine(src, { strict: true, sourcePath: m.rel })
      const lenient = translatePine(src, { sourcePath: m.rel })
      out = {
        rel: m.rel,
        okStrict: !!strict.ok,
        okLenient: !!lenient.ok,
        refusals: (strict.refusals || []).map((r) => ({ guard: r.guard, token: r.token || null, line: r.line ?? null })),
      }
    } catch (e) {
      out = { rel: m.rel, okStrict: false, okLenient: false, threw: String((e && e.message) || e).slice(0, 200), refusals: [] }
    }
    process.send(out)
  })
  process.send({ ready: true })
} else {
  // ── the parent ────────────────────────────────────────────────────────────
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  const results = []
  let killed = 0

  async function runOne(file) {
    const full = path.join(DIR, file)
    const rel = path.relative(REPO, full).replace(/\\/g, '/')
    return new Promise((resolve) => {
      const child = fork(new URL(import.meta.url).pathname.replace(/^\//, ''), [DIR], {
        env: { ...process.env, UCT_TRANSLATE_CHILD: '1', UCT_SRC_ROOT: SRC_ROOT },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      })
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        killed += 1
        child.kill('SIGKILL')
        // ⭐ THE FILE IS NAMED. A batch that says "something hung" is a batch that
        // has to be re-run by hand to find out what.
        resolve({
          rel,
          okStrict: false,
          okLenient: false,
          refusals: [{ guard: 'pine:timeout', token: null, line: null }],
          killedAfterMs: TIMEOUT_MS,
          note: 'child did not answer; killed from the parent',
        })
      }, TIMEOUT_MS)
      child.on('message', (m) => {
        if (m && m.ready) { child.send({ file: full, rel }); return }
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill()
        resolve(m)
      })
      child.on('exit', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ rel, okStrict: false, okLenient: false, refusals: [], note: 'child exited without answering' })
      })
    })
  }

  const queue = [...files]
  async function worker() {
    while (queue.length) {
      const f = queue.shift()
      const r = await runOne(f)
      results.push(r)
      if (results.length % 25 === 0) console.log(`  ... ${results.length}/${files.length}`)
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker))

  const guards = {}
  const names = {}
  for (const r of results) {
    for (const ref of r.refusals || []) {
      guards[ref.guard] = (guards[ref.guard] || 0) + 1
      if (!ref.token) continue
      names[ref.guard] = names[ref.guard] || {}
      names[ref.guard][ref.token] = names[ref.guard][ref.token] || { scripts: new Set(), sites: 0 }
      names[ref.guard][ref.token].scripts.add(r.rel)
      names[ref.guard][ref.token].sites += 1
    }
  }
  const summary = {
    dir: path.relative(REPO, DIR).replace(/\\/g, '/'),
    scripts: results.length,
    okStrict: results.filter((r) => r.okStrict).length,
    okLenient: results.filter((r) => r.okLenient).length,
    threw: results.filter((r) => r.threw).length,
    killed,
    timeoutMs: TIMEOUT_MS,
    guards: Object.entries(guards).sort((a, b) => b[1] - a[1]).map(([g, c]) => ({ guard: g, refusals: c })),
    names: Object.fromEntries(Object.entries(names).map(([g, m]) => [g,
      Object.entries(m).map(([n, v]) => ({ name: n, scripts: v.scripts.size, sites: v.sites }))
        .sort((a, b) => b.scripts - a.scripts || a.name.localeCompare(b.name))])),
    killedFiles: results.filter((r) => r.killedAfterMs).map((r) => r.rel),
  }
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 1) + '\n')
  console.log('ALL_DONE ' + JSON.stringify({
    scripts: summary.scripts, okStrict: summary.okStrict, okLenient: summary.okLenient,
    threw: summary.threw, killed: summary.killed, killedFiles: summary.killedFiles,
    topGuards: summary.guards.slice(0, 10),
  }, null, 1))
}
