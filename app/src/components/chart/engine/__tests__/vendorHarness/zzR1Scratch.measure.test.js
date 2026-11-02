// SCRATCH — never committed (lane W19-R1 probe)
import { it, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { enterDoorState } from './harness'
import { probeRuntimeProgram } from '../../runtime/runtimeColumns'
import { loadPineLibraryStoreFromEnv } from '../../ast/__tests__/pineLibraryStoreLoader.js'
loadPineLibraryStoreFromEnv()
afterEach(() => { vi.unstubAllEnvs() })
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const SPEC = process.env.R1_SPEC ? JSON.parse(fs.readFileSync(process.env.R1_SPEC, 'utf8')) : []
it('r1 scratch probe', () => {
  const files = fs.readdirSync(CORPUS)
  for (const s of SPEC) {
    let src
    if (s.file) src = fs.readFileSync(s.file, 'utf8')
    else { const f = files.find((x) => x.startsWith(s.slug + '__')); src = fs.readFileSync(path.join(CORPUS, f), 'utf8') }
    for (const [a, b] of (s.subs || [])) { if (!src.includes(a)) console.log(`  !! sub not found: ${a}`); src = src.split(a).join(b) }
    enterDoorState('runtime')
    const p = probeRuntimeProgram(src)
    const p2 = probeRuntimeProgram(src, { objectsInRun: true })
    let door
    try { door = enterMemberDoor(src) } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
    const lane = door.def ? (door.def.runtime || door.def.lane || door.def.kind || '?') : '-'
    console.log(`### ${s.slug}${s.tag ? ' [' + s.tag + ']' : ''}\n  probe: ${p.ok ? 'OK outputs=' + p.outputs.length : JSON.stringify(p.refusal).slice(0, 400)}\n  probeObj: ${p2.ok ? 'OK' : JSON.stringify(p2.refusal).slice(0, 300)}\n  door: ${door.refusal ? door.refusal.slice(0, 400) : 'ATTACHED ' + Object.keys(door.def).join(',').slice(0, 200)}`)
  }
})
