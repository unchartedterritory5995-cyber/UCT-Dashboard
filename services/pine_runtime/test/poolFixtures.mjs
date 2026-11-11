// Shared fixtures for the W5-T7 pool / sandbox rails. Pools here are SMALL (1-3 workers) and the
// tests close every pool they start (the shared-PC rule); no key is committed (helpers.mjs).
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPineRuntime } from '../../../app/scripts/build-pine-runtime.mjs'
import { BAR_COLUMNS, barsSha256 } from '../protocol.mjs'
import { f64b64 } from './helpers.mjs'

export const FAKE_BUNDLE = fileURLToPath(new URL('./fixtures/fakeBundle.mjs', import.meta.url))

/** Build the real server bundle once into a temp dir; `cleanup()` removes it. */
export async function buildRealBundle() {
  const dir = mkdtempSync(join(tmpdir(), 'pine-rt-t7-'))
  const outfile = join(dir, 'pine-runtime.mjs')
  await buildPineRuntime({ outfile, logLevel: 'silent', env: {} })
  return { dir, outfile, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** `n` daily bars as plain columns (oldest first), with a small wave so indicators move. */
export function barColumns(n = 300, seed = 0) {
  return {
    t: Array.from({ length: n }, (_, i) => 1_600_000_000_000 + i * 86_400_000),
    o: Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 7 + seed)),
    h: Array.from({ length: n }, (_, i) => 101 + Math.sin(i / 7 + seed)),
    l: Array.from({ length: n }, (_, i) => 99 + Math.sin(i / 7 + seed)),
    c: Array.from({ length: n }, (_, i) => 100.5 + Math.sin(i / 5 + seed) + seed),
    v: Array.from({ length: n }, (_, i) => 1000 + i),
  }
}

/** A job as protocol.parseRunRequest hands it to the runner (Float64 columns, hash checked). */
export function parsedJob(name, { n = 3, seed = 0, want = [], cols = barColumns(n, seed) } = {}) {
  const bars = { n, sha256: 'x'.repeat(64) }
  for (const k of BAR_COLUMNS) bars[k] = Float64Array.from(cols[k])
  return {
    job: name, symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, tf: 'D', bars,
    ctx: { newestBarIsForming: false, historyFromListing: true, runtimeInputs: {} }, want,
  }
}

export const docOf = (source, outputs = { value: 0 }) => ({
  id: 'u_0123456789ab', compute: { kind: 'runtime', fn: 'runtime:t7', outputs, source }, meta: {},
})

/** A request as the runner receives it. `jobs` are parsed jobs (or names, made with defaults). */
export function parsedRequest({ profile = 'alert', owner = 'hmac:00000000000000aa', source = 'echo', doc = docOf(source), jobs = ['J0'] } = {}) {
  return {
    protocol: 1, profile, owner, engine: {},
    definition: { def_id: 'u_0123456789ab', version: 1, doc_sha256: 'x'.repeat(64), doc },
    jobs: jobs.map((j) => (typeof j === 'string' ? parsedJob(j) : j)),
  }
}

/** The signed-wire body of one request for `identity` (the HTTP rails). */
export function wireRequest(identity, { profile = 'alert', owner = 'hmac:00000000000000aa', doc, jobs }) {
  const docText = JSON.stringify(doc)
  return {
    protocol: 1, profile, engine: { ...identity },
    definition: { def_id: 'u_0123456789ab', version: 1, doc_sha256: createHash('sha256').update(Buffer.from(docText, 'utf8')).digest('hex'), doc: docText },
    owner,
    jobs: jobs.map(({ name, n = 300, seed = 0, want = [] }) => {
      const cols = barColumns(n, seed)
      const bars = { n }
      const bytes = {}
      for (const k of BAR_COLUMNS) { bars[k] = f64b64(cols[k]); bytes[k] = Buffer.from(bars[k], 'base64') }
      bars.sha256 = barsSha256(n, bytes)
      return { job: name, symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, tf: 'D', bars,
        ctx: { newestBarIsForming: false, historyFromListing: true }, want }
    }),
  }
}

/** Decode a canonical base64 Float64 column. */
export function decodeColumn(b64) {
  const b = Buffer.from(b64, 'base64')
  return Array.from({ length: b.length / 8 }, (_, i) => b.readDoubleLE(i * 8))
}

/** The most jobs whose [start, end] spans overlap at one instant. */
export function maxOverlap(spans) {
  const ev = spans.flatMap(([s, e]) => [[s, 1], [e, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let cur = 0
  let max = 0
  for (const [, d] of ev) { cur += d; max = Math.max(max, cur) }
  return max
}

export const spanOf = (r) => [decodeColumn(r.columns.start)[0], decodeColumn(r.columns.end)[0]]
