// app/src/components/chart/engine/__tests__/vendorHarness/startFreeReasons.measure.test.js
// ⭐⭐ E104 — WHY each corpus script the member door puts on the runtime lane is or is not start-free
// (`runtime/startFreeProof.js`), by name: the walker's reason, tallied. A measurement, never a gate.
// ⛔ OPT-IN: RUNTIME_PERF_CENSUS=curtain
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { CURTAIN_CENSUS_ON } from './curtainCensus'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { startFreeProofOf } from '../../runtime/startFreeProof'

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!CURTAIN_CENSUS_ON)('why each runtime-lane corpus script is or is not start-free (opt-in)', () => {
  it('tallies the walker\'s reasons', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const bars = Array.from({ length: 400 }, (_, i) => ({ t: 1500000000 + i * 86400, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 }))
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    const tally = {}
    const rows = []
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      try {
        if (!door.def || !door.built || door.built.lane !== 'runtime' || door.def.compute.kind !== 'runtime') continue
        const built = buildRuntimeIr(String(door.def.compute.source), { bars })
        const p = built.ok ? startFreeProofOf(built.ir) : { startFree: false, why: `build: ${built.refusal && built.refusal.guard}` }
        const key = p.startFree ? 'START-FREE' : p.why.replace(/`[^`]*`/g, '`…`').replace(/\d+/g, 'N')
        tally[key] = (tally[key] || 0) + 1
        rows.push(`${f}: ${p.startFree ? `START-FREE reach ${p.reach}` : p.why}`)
      } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
    }
    console.log(`start-free reasons:\n${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}  ${k}`).join('\n')}\n${rows.join('\n')}`)
    const out = path.join(REPO, 'remote-out', 'start-free')
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'reasons.json'), JSON.stringify({ tally, rows }, null, 1))
    expect(rows.length).toBeGreaterThan(20)
  }, 1200000)
})
