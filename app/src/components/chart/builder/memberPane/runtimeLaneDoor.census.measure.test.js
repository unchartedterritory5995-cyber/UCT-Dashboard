// app/src/components/chart/builder/memberPane/runtimeLaneDoor.census.measure.test.js
//
// ─── THE RUNTIME-LANE DOOR CENSUS — opt-in, never part of an ordinary run ────
//
// What the member door (`memberPaneDefinition`, the call `MemberPane` makes) does
// with every committed corpus script under the four flag combinations
// (objects-only × runtime-lane), plus — for every script the fallback was ALLOWED
// to try and could not build — the walls standing between it and the pane, ranked
// by how many scripts clearing ONE wall would complete.
//
//   cd app && RUNTIME_CENSUS=1 node node_modules/vitest/vitest.mjs run \
//     src/components/chart/builder/memberPane/runtimeLaneDoor.census.measure.test.js
// Output: `$RUNTIME_CENSUS_OUT` (default: the OS temp dir).
//
// ⚠️ THE WALL RANKING IS AN ESTIMATE, AND SAYS SO. It peels a script line by line
// with `peelToBuilding.js::bindingNameOf` (a failing binding is replaced by `= 0.0`,
// any other failing line is blanked) through the RUNTIME DOOR's own build
// (`runtimeLaneDefinition`), so a wall is a wall the door itself hits. The peel
// has that instrument's recorded bias: `0.0` keeps a name and loses its type.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { memberPaneDefinition } from './memberPaneDefinition'
import { runtimeLaneDefinition } from './runtimeLaneDefinition'
import { isRuntimeFallbackGuard } from '../../engine/pineRuntimeLane'
import { translatePine } from '../../engine/ast/pine'
import { bindingNameOf } from '../../engine/ast/peelToBuilding'

const RUN = process.env.RUNTIME_CENSUS === '1'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const OUT = process.env.RUNTIME_CENSUS_OUT || path.join(os.tmpdir(), 'runtime_lane_door_census.json')
const LF = String.fromCharCode(10)
const CAP = 20

afterEach(() => { vi.unstubAllEnvs() })

function door(source, objectsOnly, runtimeLane) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', objectsOnly ? '1' : '')
  vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', runtimeLane ? '1' : '')
  try {
    return memberPaneDefinition({ source, id: 'u_member-pane-census', name: 'C' })
  } catch (err) {
    return { ok: false, guard: 'THREW', reason: String((err && err.message) || err) }
  }
}

/** Was the fallback allowed to try? The door's own rule, re-asked here. */
function admissible(source) {
  let t
  try { t = translatePine(source, { strict: true }) } catch { return false }
  const guards = [(t.refusal || null), ...(t.refusals || [])].filter(Boolean).map((r) => r.guard)
  return guards.length > 0 && guards.every(isRuntimeFallbackGuard)
}

/** Peel through the runtime door. → {reached, path: [guard…]} */
function peel(source) {
  vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
  const work = source.split(LF)
  const walls = []
  for (let step = 0; step < CAP; step += 1) {
    let r
    try {
      r = runtimeLaneDefinition({ source: work.join(LF), id: 'u_member-pane-peel', carryMax: 12, docCarryMax: 36, paneHeight: 0.25 })
    } catch (err) {
      return { reached: false, walls, stuck: `threw:${String(err && err.message).slice(0, 40)}` }
    }
    if (r.ok) return { reached: true, walls }
    walls.push(r.guard || 'unnamed')
    const idx = (Number.isInteger(r.line) ? r.line : 0) - 1
    if (!(idx >= 0 && idx < work.length)) return { reached: false, walls, stuck: r.guard }
    const bound = bindingNameOf(work[idx])
    const next = bound ? `${bound.indent}${bound.name} = 0.0` : ''
    if (work[idx] === next) return { reached: false, walls, stuck: r.guard }
    work[idx] = next
  }
  return { reached: false, walls, stuck: 'cap' }
}

describe.skipIf(!RUN)('runtime-lane door census (opt-in)', () => {
  it('measures every committed corpus script under the four flag combinations', () => {
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200)                    // non-vacuity: the corpus was found
    const combos = [[false, false], [true, false], [false, true], [true, true]]
    const rows = []
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      const row = { name: f.replace(/\.pine$/, '') }
      for (const [o, r] of combos) {
        const d = door(source, o, r)
        row[`o${o ? 1 : 0}r${r ? 1 : 0}`] = d.ok ? (d.lane === 'runtime' ? 'runtime' : 'host')
          : { guard: d.guard || null, runtimeGuard: d.runtimeRefusal ? d.runtimeRefusal.guard : null }
      }
      row.admissible = admissible(source)
      rows.push(row)
    }
    const table = {}
    for (const [o, r] of combos) {
      const k = `o${o ? 1 : 0}r${r ? 1 : 0}`
      table[k] = {
        attached: rows.filter((x) => typeof x[k] === 'string').length,
        viaRuntime: rows.filter((x) => x[k] === 'runtime').map((x) => x.name),
      }
    }
    // ⛔ THE HOST STAYS AUTHORITATIVE: nothing the host attaches may change lanes.
    for (const x of rows) {
      if (x.o0r0 === 'host') expect(x.o0r1, x.name).toBe('host')
      if (x.o1r0 === 'host') expect(x.o1r1, x.name).toBe('host')
    }
    // Walls: every script the fallback was allowed to try and could not build.
    const tried = rows.filter((x) => x.admissible && typeof x.o1r1 !== 'string')
    const peeled = tried.map((x) => ({ name: x.name, first: x.o1r1.runtimeGuard,
      ...peel(fs.readFileSync(path.join(CORPUS, `${x.name}.pine`), 'utf8')) }))
    const firstWall = {}
    const completes = {}
    for (const p of peeled) {
      firstWall[p.first] = (firstWall[p.first] || 0) + 1
      if (p.reached && p.walls.length) {
        const fam = [...new Set(p.walls)]
        if (fam.length === 1) (completes[fam[0]] = completes[fam[0]] || []).push(p.name)
      }
    }
    fs.writeFileSync(OUT, JSON.stringify({ files: files.length, table, firstWall, completes, peeled, rows }, null, 1))
    // eslint-disable-next-line no-console
    console.log(`runtime-lane door census -> ${OUT}\n${JSON.stringify(Object.fromEntries(Object.entries(table)
      .map(([k, v]) => [k, v.attached])))}`)
  }, 1800000)
})
