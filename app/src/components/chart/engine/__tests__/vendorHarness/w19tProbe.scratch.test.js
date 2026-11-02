// SCRATCH — never committed (lane W19-T substitution probe).
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

// SPEC: JSON [{slug, tag, file?, subs?: [[from, to]...], source?}]
it('w19t probe', () => {
  const spec = JSON.parse(fs.readFileSync(process.env.W19T_SPEC, 'utf8'))
  const REPO = path.resolve(process.cwd(), '..')
  const out = []
  for (const s of spec) {
    let src = s.source
    if (!src) {
      const dir = path.join(REPO, 'corpus', 'committed')
      const f = fs.readdirSync(dir).find((x) => x.startsWith(s.slug + '__'))
      src = fs.readFileSync(path.join(dir, f), 'utf8')
    }
    for (const [a, b] of s.subs || []) {
      if (!src.includes(a)) { out.push({ slug: s.slug, tag: s.tag, threw: 'SUB NOT FOUND: ' + a }); src = null; break }
      src = src.split(a).join(b)
    }
    if (src == null) continue
    for (const state of s.states || ['runtime']) {
      enterDoorState(state)
      let r
      try {
        const door = enterMemberDoor(src)
        const b = door.built || {}
        const tr = b.translation || {}
        r = {
          slug: s.slug, tag: s.tag, state, attached: !!door.def, refusal: door.refusal, lane: b.lane || (door.def ? 'host' : null),
          withheld: b.withheld || [], runtimeDeclined: b.runtimeDeclined || null,
          hostRefusals: (tr.refusals || []).slice(0, 4).map((x) => ({ g: x.guard, l: x.line, m: String(x.message || '').slice(0, 160) })),
          outRefusals: (tr.outputs || []).filter((o) => o && o.refusal).slice(0, 4).map((o) => ({ t: o.title, g: o.refusal.guard, l: o.refusal.line, m: String(o.refusal.message || '').slice(0, 160) })),
        }
        if (!door.def && state === 'runtime') {
          const p1 = probeRuntimeProgram(src)
          const p2 = probeRuntimeProgram(src, { objectsInRun: true })
          r.rt = p1.ok ? 'ok' : { g: p1.refusal.guard, l: p1.refusal.line, m: String(p1.refusal.message || '').slice(0, 200) }
          r.rtObj = p2.ok ? 'ok' : { g: p2.refusal.guard, l: p2.refusal.line, m: String(p2.refusal.message || '').slice(0, 200) }
        }
      } catch (e) {
        r = { slug: s.slug, tag: s.tag, state, threw: String((e && e.stack) || e).slice(0, 600) }
      } finally {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
        vi.unstubAllEnvs()
      }
      out.push(r)
    }
  }
  fs.writeFileSync(process.env.W19T_OUT, JSON.stringify(out, null, 1))
}, 1800000)
