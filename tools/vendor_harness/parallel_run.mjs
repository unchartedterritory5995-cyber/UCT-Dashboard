// tools/vendor_harness/parallel_run.mjs
//
// ─── THE CENSUS AND THE HARNESS, N SHARDS AT ONCE, ONE OUTPUT ────────────────
//
// The member-door census and the vendor harness each ran as ONE vitest process,
// one script / capture at a time, on a 24-thread box. This runs N shard
// processes at once (`shard.mjs`: membership is a stable hash of the file id)
// and merges their outputs into EXACTLY the files a single run writes — the same
// writer functions (`harness_output.mjs`, `census_output.mjs`), the same order.
// `parallel_rail.mjs` proves the bytes are identical on a fixed subset.
//
// ⛔ RUN IT INSIDE ONE HEAVY-LOCK HOLD. It is the parallelism INSIDE the hold,
// never a way around it:
//
//   cd app
//   VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR=../tests/fixtures/vendor VENDOR_HARNESS_OUT=<dir> \
//     python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --label X --timeout 21600 run -- \
//     node ../tools/vendor_harness/parallel_run.mjs harness
//
//   VENDOR_BATCH_CENSUS_RUNTIME=1 VENDOR_BATCH_CENSUS_OUT=<file.json> \
//     python .../heavy_lock.py --label X --timeout 21600 run -- \
//     node ../tools/vendor_harness/parallel_run.mjs census
//
// Every env variable the test reads today is read the same way; the wrapper only
// adds the shard spec and points each shard's OUT at its own scratch file.
//
// ⭐ N IS RAM-AWARE AND MEASURED: N = clamp(floor((freeGB - 6) / perWorkerGB), 1, 6).
// perWorkerGB is the largest per-shard process-tree peak this wrapper has
// MEASURED (`proc_tree_memory.mjs`) over the last runs of that kind, stored in
// the footprint file. With no measurement yet, N is 1 — and that run measures.
// `--n K` overrides (K=1 is the plain single run, no shard env at all).
//
// Flags: --n auto|K · --keep-shards · --footprint <file> · --dry (print N, run nothing)

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startTreeSampler, toGB } from './proc_tree_memory.mjs'
import {
  HARNESS_SHARD_FILE, CENSUS_SHARD_KIND, mergeLaneEvidence, laneReport, consoleBlock, writeHarnessOutputs, orderByIds,
} from './harness_output.mjs'
import { censusDocument, censusLine } from './census_output.mjs'
import { HARNESS_SHARD_ENV, CENSUS_SHARD_ENV } from './shard.mjs'

export const RAM_RESERVE_GB = 6
export const MAX_SHARDS = 6
const PEAKS_KEPT = 5

export const KINDS = {
  harness: {
    test: 'src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js',
    shardEnv: HARNESS_SHARD_ENV,
    outEnv: 'VENDOR_HARNESS_OUT',
  },
  census: {
    test: 'src/components/chart/engine/__tests__/vendorHarness/memberDoorCensus.measure.test.js',
    shardEnv: CENSUS_SHARD_ENV,
    outEnv: 'VENDOR_BATCH_CENSUS_OUT',
  },
}

/** N = clamp(floor((free - reserve) / perWorker), 1, max); no measurement => 1. */
export function chooseN({ freeGB, perWorkerGB, reserveGB = RAM_RESERVE_GB, max = MAX_SHARDS }) {
  if (!(perWorkerGB > 0)) return 1
  return Math.max(1, Math.min(max, Math.floor((freeGB - reserveGB) / perWorkerGB)))
}

export function defaultFootprintFile() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache')
  return path.join(base, 'uct-parallel-run', 'footprint.json')
}

function readFootprint(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}

function recordFootprint(file, kind, peakGB, meta) {
  const fp = readFootprint(file)
  const prev = (fp[kind] && fp[kind].peaksGB) || []
  fp[kind] = { peaksGB: [...prev, +peakGB.toFixed(3)].slice(-PEAKS_KEPT), last: { ...meta, at: new Date().toISOString() } }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(fp, null, 1) + '\n')
  fs.renameSync(tmp, file)
}

export function perWorkerGBOf(file, kind) {
  const peaks = (readFootprint(file)[kind] || {}).peaksGB || []
  return peaks.length ? Math.max(...peaks) : null
}

// ── merges (pure over parsed shard files) ────────────────────────────────────

const same = (list, key, what) => {
  const vals = new Set(list.map((s) => JSON.stringify(s[key])))
  if (vals.size !== 1) throw new Error(`merge: shards disagree on ${what || key}`)
  return list[0][key]
}

function coverExactly(items, allFiles, what) {
  const ordered = orderByIds(items, allFiles)
  if (ordered.length !== allFiles.length) {
    const have = new Set(items.map((i) => i.file))
    const missing = allFiles.filter((f) => !have.has(f))
    throw new Error(`merge: ${what} accounts for ${ordered.length} of ${allFiles.length} files; missing e.g. ${missing.slice(0, 3).join(', ')}`)
  }
  return ordered
}

/** N harness shard files -> the single run's inputs to `writeHarnessOutputs`. */
export function mergeHarnessShards(shards) {
  const count = same(shards.map((s) => ({ c: s.shard.count })), 'c', 'shard count')
  const idx = new Set(shards.map((s) => s.shard.index))
  if (idx.size !== count || shards.length !== count) throw new Error(`merge: have shards ${[...idx].sort().join(',')} of ${count}`)
  const allFiles = same(shards, 'allFiles', 'the file list')
  const dirsRel = same(shards, 'dirsRel', 'the directories')
  const requested = same(shards, 'requested', 'the requested lane')
  const objectsOnly = same(shards, 'objectsOnly', 'the objects-only pane')
  const results = shards.flatMap((s) => s.results)
  const inventory = shards.flatMap((s) => s.inventory)
  coverExactly([...results, ...inventory], allFiles, 'results + inventory')
  const evidence = mergeLaneEvidence(shards.map((s) => s.evidence))
  return {
    dirsRel, requested, objectsOnly, evidence,
    results: orderByIds(results, allFiles),
    inventory: orderByIds(inventory, allFiles),
  }
}

/** N census shard files -> the single run's census document fields. */
export function mergeCensusShards(shards) {
  for (const s of shards) if (s.kind !== CENSUS_SHARD_KIND) throw new Error('merge: not a census shard file')
  const count = shards[0].shard.count
  const idx = new Set(shards.map((s) => s.shard.index))
  if (idx.size !== count || shards.length !== count) throw new Error(`merge: have shards ${[...idx].sort().join(',')} of ${count}`)
  const allFiles = same(shards, 'allFiles', 'the file list')
  const withRuntime = same(shards.map((s) => ({ r: !!s.runtime })), 'r', 'the runtime state')
  const doc = {
    flag: same(shards, 'flag'), runtimeFlag: same(shards, 'runtimeFlag'),
    ambientFlagOn: same(shards, 'ambientFlagOn'), librariesLoaded: same(shards, 'librariesLoaded'),
    files: allFiles.length,
    off: coverExactly(shards.flatMap((s) => s.off), allFiles, 'state off'),
    on: coverExactly(shards.flatMap((s) => s.on), allFiles, 'state on'),
    runtime: withRuntime ? coverExactly(shards.flatMap((s) => s.runtime), allFiles, 'state runtime') : null,
  }
  return doc
}

// ── running ──────────────────────────────────────────────────────────────────

function vitestArgs(kind) {
  return ['node_modules/vitest/vitest.mjs', 'run', KINDS[kind].test, '--maxWorkers=1']
}

function cleanEnv(extra) {
  const env = { ...process.env, ...extra }
  for (const k of Object.keys(extra)) if (extra[k] === undefined) delete env[k]
  return env
}

function runOne({ args, env, logFile }) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const out = logFile ? fs.openSync(logFile, 'w') : 'inherit'
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', out, out] })
    child.on('exit', (code) => {
      if (logFile) fs.closeSync(out)
      resolve({ code: code === null ? 1 : code, wallS: (Date.now() - t0) / 1000, pid: child.pid })
    })
    resolve.child = child
    runOne.last = child
  })
}

async function main(argv) {
  const kind = argv[0]
  if (!KINDS[kind]) {
    console.error('usage: node parallel_run.mjs <harness|census> [--n auto|K] [--keep-shards] [--footprint F] [--dry]')
    return 2
  }
  const opt = (name, dflt) => { const i = argv.indexOf(name); return i === -1 ? dflt : argv[i + 1] }
  const nArg = opt('--n', 'auto')
  const keep = argv.includes('--keep-shards')
  const dry = argv.includes('--dry')
  const footprint = opt('--footprint', defaultFootprintFile())
  if (!fs.existsSync(path.join(process.cwd(), 'node_modules/vitest/vitest.mjs'))) {
    console.error('parallel_run: run it from app/ (node_modules/vitest/vitest.mjs not found here)')
    return 2
  }
  const spec = KINDS[kind]
  const outRaw = process.env[spec.outEnv]
  if (!outRaw) { console.error(`parallel_run: ${spec.outEnv} must name the output`); return 2 }
  if (kind === 'census' && process.env.VENDOR_BATCH_CENSUS !== '1') process.env.VENDOR_BATCH_CENSUS = '1'
  const OUT = path.resolve(process.cwd(), outRaw)

  const freeGB = toGB(os.freemem())
  const perWorkerGB = perWorkerGBOf(footprint, kind)
  const N = nArg === 'auto' ? chooseN({ freeGB, perWorkerGB }) : Math.max(1, Math.min(MAX_SHARDS, Number(nArg) | 0))
  console.log(`[parallel_run] ${kind}: N=${N} (${nArg === 'auto' ? 'auto' : 'forced'}; free ${freeGB.toFixed(1)} GB, `
    + `per-worker ${perWorkerGB === null ? 'unmeasured' : `${perWorkerGB.toFixed(2)} GB measured`}, reserve ${RAM_RESERVE_GB} GB)`)
  if (dry) return 0

  const t0 = Date.now()
  const children = []
  const sampler = startTreeSampler(() => children.filter(Boolean).map((c) => c.pid))
  let results
  const shardDir = `${OUT}.shards`
  if (N === 1) {
    // the plain single run: no shard env, the test writes OUT itself
    const p = runOne({ args: vitestArgs(kind), env: cleanEnv({ [spec.shardEnv]: undefined }) })
    children.push(runOne.last)
    results = [await p]
  } else {
    fs.rmSync(shardDir, { recursive: true, force: true })
    fs.mkdirSync(shardDir, { recursive: true })
    const ps = []
    for (let i = 1; i <= N; i += 1) {
      const shardOut = kind === 'harness' ? path.join(shardDir, `shard-${i}`) : path.join(shardDir, `shard-${i}.json`)
      ps.push(runOne({
        args: vitestArgs(kind),
        env: cleanEnv({ [spec.shardEnv]: `${i}/${N}`, [spec.outEnv]: shardOut }),
        logFile: path.join(shardDir, `shard-${i}.log`),
      }))
      children.push(runOne.last)
    }
    results = await Promise.all(ps)
  }
  const mem = await sampler.stop()
  const peaks = children.map((c) => mem.peakByRoot.get(c.pid) || 0)
  const maxPeakGB = toGB(Math.max(...peaks))
  if (mem.ticks > 0 && maxPeakGB > 0) recordFootprint(footprint, kind, maxPeakGB, { n: N, totalPeakGB: +toGB(mem.peakTotal).toFixed(3) })
  results.forEach((r, i) => console.log(`[parallel_run] shard ${i + 1}/${N}: exit ${r.code}, ${r.wallS.toFixed(1)} s, `
    + `peak ${toGB(peaks[i]).toFixed(2)} GB`))
  const failed = results.some((r) => r.code !== 0)

  if (N > 1) {
    const files = []
    for (let i = 1; i <= N; i += 1) {
      files.push(kind === 'harness' ? path.join(shardDir, `shard-${i}`, HARNESS_SHARD_FILE) : path.join(shardDir, `shard-${i}.json`))
    }
    const missing = files.filter((f) => !fs.existsSync(f))
    if (missing.length) {
      console.error(`[parallel_run] ⛔ ${missing.length} shard(s) wrote nothing; NOTHING merged. Logs: ${shardDir}`)
      return 1
    }
    const shards = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
    try {
      if (kind === 'harness') {
        const m = mergeHarnessShards(shards)
        const { lane, laneLine, laneError } = laneReport({ requested: m.requested, evidence: m.evidence, objectsOnly: m.objectsOnly })
        console.log(consoleBlock({ laneLine, results: m.results, inventory: m.inventory }))
        // ⛔ a run that measured the wrong lane writes nothing a later diff could trust
        if (laneError) { console.error(`[parallel_run] ⛔ ${laneError.message}`); return 1 }
        if (!process.env.VENDOR_HARNESS_DIR && !process.env.VENDOR_HARNESS_ONLY) {
          if (!(m.results.length > 5 && m.results.some((r) => r.verdict === 'MATCH') && m.results.some((r) => r.verdict === 'DIVERGE'))) {
            console.error('[parallel_run] ⛔ NON-VACUITY: the default corpus was not really graded'); return 1
          }
        }
        writeHarnessOutputs(OUT, { ...m, lane, laneLine })
      } else {
        const doc = mergeCensusShards(shards)
        fs.mkdirSync(path.dirname(OUT), { recursive: true })
        fs.writeFileSync(OUT, censusDocument(doc))
        console.log(censusLine({ ...doc, out: OUT }))
      }
    } catch (err) {
      console.error(`[parallel_run] ⛔ ${err.message}; NOTHING merged. Logs: ${shardDir}`)
      return 1
    }
    if (!keep && !failed) fs.rmSync(shardDir, { recursive: true, force: true })
  }
  console.log(`[parallel_run] ${kind}: N=${N} wall ${((Date.now() - t0) / 1000).toFixed(1)} s, `
    + `peak total ${toGB(mem.peakTotal).toFixed(2)} GB${failed ? ` · ⛔ a shard FAILED (logs: ${shardDir})` : ''}`)
  return failed ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err); process.exit(1) })
}
