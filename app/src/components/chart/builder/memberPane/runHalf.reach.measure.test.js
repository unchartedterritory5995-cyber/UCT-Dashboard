// app/src/components/chart/builder/memberPane/runHalf.reach.measure.test.js
//
// ─── ⭐⭐ ENGINE 53 — THE RUN HALF'S REACH, MEASURED — opt-in, never an ordinary run ──
//
// Every script of the committed corpus (and, given RUN_HALF_SAMPLE, the coverage-map
// sample's `builtin/` and `reference/` scripts) through the member door in three lanes:
//
//   off     the runtime pane DARK (every member without the admin stage)
//   real    the runtime pane ON as a permitted member, with the SERVER'S allowlist
//           (`api/data/pine_runtime_allowlist.json`'s hashes): production for an admin
//   every   the runtime pane ON with the test-only allow-every override: the upper bound
//
// For each it records the door's answer, the run half (minted / declined by code), and
// a digest of the document. In `every`, each minted run half is BOUND over a synthetic
// series that starts at the listing (`nativeRegistry.computeFor`, the binder's call):
// served, pending or refused by code. Synthetic bars prove the column rail and the gates
// run, never parity with TradingView (the vendor harness answers that).
//
// ⛔ IT ASSERTS ONLY WHAT PRODUCTION PROMISES: no run half minted in `off` or `real`.
//   cd app && RUN_HALF_REACH=1 RUN_HALF_OUT=<file.json> [RUN_HALF_SAMPLE=<cache dir>] \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/builder/memberPane/runHalf.reach.measure.test.js --maxWorkers=1
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { runHalfOf, runtimeObjectsOf } from '../../engine/runtime/runtimeObjects'
import { assessObjectLoss } from '../../engine/ast/objectLoss'
import { RUN_HALF_DRAWING_SENTENCE } from '../../engine/ast/objectLoss'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeAllowList } from '../../engine/runtimeKill'

const RUN = process.env.RUN_HALF_REACH === '1'
const OUT = process.env.RUN_HALF_OUT ? path.resolve(process.cwd(), process.env.RUN_HALF_OUT) : null
const SAMPLE = process.env.RUN_HALF_SAMPLE ? path.resolve(process.cwd(), process.env.RUN_HALF_SAMPLE) : null
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const ALLOW = JSON.parse(fs.readFileSync(path.join(REPO, 'api', 'data', 'pine_runtime_allowlist.json'), 'utf8'))
const REAL_HASHES = (ALLOW.scripts || []).map((s) => String(s.sha256).toLowerCase())

afterEach(() => { vi.unstubAllEnvs() })

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16)

/** The document with the run half taken out (its compute key and its note sentence):
 *  what the document would be had the door declined. */
function withoutRunHalf(def) {
  if (!def) return def
  const d = JSON.parse(JSON.stringify(def))
  if (d.compute) delete d.compute.runtimeObjects
  for (const n of (d.meta && d.meta.disclosures) || []) {
    if (n && typeof n.note === 'string') n.note = n.note.replace(` ${RUN_HALF_DRAWING_SENTENCE}`, '')
  }
  return d
}

function syntheticBars(n = 600) {
  const t0 = Date.UTC(2015, 0, 2) / 1000
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 8 * Math.sin(i / 9) + 3 * Math.sin(i / 2.7) + i * 0.02
    const o = c - Math.sin(i / 3)
    return { t: t0 + i * 86400, o, h: Math.max(o, c) + 1 + (i % 5) * 0.1, l: Math.min(o, c) - 1 - (i % 3) * 0.1, c, v: 1e6 + (i % 17) * 1e4 }
  })
}

function lane(mode) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', mode === 'off' ? '' : '1')
  __permitRuntimePaneForTests()
  if (mode === 'real') setRuntimeAllowList(REAL_HASHES)
  else __allowEveryRuntimeScriptForTests()
}

function row(name, source, mode) {
  lane(mode)
  let d
  try { d = memberPaneDefinition({ source, id: 'u_runhalf-reach', name: 'R' }) } catch (err) {
    return { name, mode, threw: String((err && err.message) || err).slice(0, 200) }
  }
  const t = d.translation || {}
  const r = {
    name, mode, ok: d.ok === true, lane: d.ok ? (d.lane || 'host') : null,
    verdict: d.ok && d.lane !== 'runtime' ? assessObjectLoss(t).verdict : null,
    runHalf: d.runHalf ? 'minted' : (d.runHalfDeclined ? 'declined' : null),
    declined: d.runHalfDeclined ? d.runHalfDeclined.code : null,
    columns: d.runHalf ? d.runHalf.columns : null,
    digest: d.ok ? sha(JSON.stringify(d.definition)) : sha(String(d.reason)),
    digestWithout: d.ok ? sha(JSON.stringify(withoutRunHalf(d.definition))) : sha(String(d.reason)),
  }
  if (mode === 'every' && d.runHalf) {
    const { installed, errors } = registry.installUserDefinitions([d.definition])
    r.installs = installed.length === 1
    if (!installed.length) r.installErrors = errors.slice(0, 3)
    else {
      try {
        const cols = registry.computeFor(installed[0], syntheticBars(), undefined,
          { tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false, historyFromListing: true })
        const h = runHalfOf(cols)
        r.bound = h ? h.state : null
        r.boundCode = h ? h.code : null
        const p = runtimeObjectsOf(cols)
        if (p) r.boundLive = p.live.length
      } catch (err) {
        r.bound = 'threw'
        r.boundCode = String((err && err.message) || err).slice(0, 160)
      }
      registry.uninstallUserDefinition(installed[0].id)
    }
  }
  return r
}

function scripts() {
  const out = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    .map((f) => ({ name: `committed:${f.replace(/\.pine$/, '')}`, file: path.join(CORPUS, f) }))
  if (SAMPLE) {
    for (const pop of ['builtin', 'reference']) {
      const dir = path.join(SAMPLE, pop)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pine')).sort()) {
        out.push({ name: `${pop}:${f.replace(/\.pine$/, '')}`, file: path.join(dir, f) })
      }
    }
  }
  return out
}

describe.skipIf(!RUN)('engine 53 — the run half reach (opt-in)', () => {
  it('measures every script in three lanes', () => {
    expect(OUT, 'RUN_HALF_OUT must name the output file').toBeTruthy()
    const list = scripts()
    expect(list.length).toBeGreaterThan(200)
    expect(REAL_HASHES.length).toBeGreaterThan(0)
    const rows = []
    for (const s of list) {
      const source = fs.readFileSync(s.file, 'utf8')
      for (const mode of ['off', 'real', 'every']) rows.push(row(s.name, source, mode))
    }
    const tally = {}
    for (const r of rows) {
      const t = tally[r.mode] || (tally[r.mode] = { scripts: 0, hostOk: 0, hostPartial: 0, minted: 0, declined: {}, bound: {}, boundCodes: {} })
      t.scripts += 1
      if (r.lane === 'host') t.hostOk += 1
      if (r.verdict === 'partial' || r.verdict === 'removes') t.hostPartial += 1
      if (r.runHalf === 'minted') t.minted += 1
      if (r.declined) t.declined[r.declined] = (t.declined[r.declined] || 0) + 1
      if (r.bound) t.bound[r.bound] = (t.bound[r.bound] || 0) + 1
      if (r.boundCode) t.boundCodes[r.boundCode] = (t.boundCodes[r.boundCode] || 0) + 1
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify({ generatedBy: 'runHalf.reach.measure.test.js', realAllowlist: REAL_HASHES, tally, rows }, null, 1) + '\n')
    // eslint-disable-next-line no-console
    console.log('RUN-HALF-REACH', JSON.stringify(tally))
    // ⛔ PRODUCTION'S PROMISE: no member without the pane, and no admin under the server's
    // allowlist, gets a run half.
    expect(tally.off.minted).toBe(0)
    expect(tally.real.minted).toBe(0)
  }, 3600000)
})
