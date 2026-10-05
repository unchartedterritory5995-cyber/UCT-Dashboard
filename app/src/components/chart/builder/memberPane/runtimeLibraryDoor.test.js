// app/src/components/chart/builder/memberPane/runtimeLibraryDoor.test.js
//
// ─── ⭐ RT3 — `import Author/Lib/N` THROUGH THE MEMBER DOOR'S RUNTIME FALLBACK ──
//
// `runtime:library` is the largest wall the runtime fallback reports in the
// member-door census (33 of 266 with the runtime pane on). RT3 asked whether the
// runtime lane can link a library the way L1 links one for the host lane. It
// already does: `buildRuntimeIr` calls the SAME linker (`pineLibraries.js::
// linkLibraries`) after `lexPine`, and with no `opts.libraries` the linker reads
// the client registry the doors fill (`pineLibraryStore.js`, `ensurePineLibraries`)
// — so the fallback's probe and its run both see a library the member's door
// fetched. What the census measures is the REGISTRY, which starts empty in every
// process and holds third-party code only from the server's store; the wall is
// content, not code.
//
// This rail proves that at the door, end to end, on a fixture library written
// for it: a script the host lane refuses and the runtime lane can draw, with an
// import, is drawn by the runtime lane, and its rows equal the same script with
// the library's function pasted in. With the registry empty it declines by name.

import { describe, it, expect, vi, afterEach } from 'vitest'

import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { registerPineLibrary, clearPineLibraries } from '../../engine/ast/pineLibraryStore'

const FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'
const DEF_ID = 'u_member-pane-rt3-lib'
const MPL = '// This Pine Script code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/'
const LIB = `${MPL}
//@version=5
library("rt3lib")
export mid(float h, float l) => (h + l) / 2
`
const BODY = `var float x = 0.0
x := MID
s = 0.0
for i = 0 to 2
    s := s + x[i]
plot(s, "S")
`
const HEAD = '//@version=5\nindicator("t")\n'
const IMPORTED = `${HEAD}import tester/rt3lib/1 as fx\n${BODY.replace('MID', 'fx.mid(high, low)')}`
const PASTED = `${HEAD}mid(float h, float l) => (h + l) / 2\n${BODY.replace('MID', 'mid(high, low)')}`

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 104 + Math.sin(i), l: 96 - (i % 5), c: 100 + i * 0.2, v: 1000,
}))

afterEach(() => {
  registry.uninstallUserDefinition(DEF_ID)
  clearPineLibraries()
  vi.unstubAllEnvs()
})

const columnsOf = (built) => {
  const cols = computeRuntimeColumns(built.definition, BARS,
    { tf: 'D', newestBarIsForming: false, historyFromListing: true })
  return built.rows.map((r) => Array.from(cols[r.key]))
}

describe('RT3 — a library import through the runtime fallback', () => {
  it('⭐ with the library registered, the runtime lane draws it, equal to the function pasted in', () => {
    registerPineLibrary({ path: 'tester/rt3lib/1', source: LIB, licence: 'MPL-2.0', attribution: 'rt3lib (test fixture)' })
    vi.stubEnv(FLAG, '1')
    const imported = memberPaneDefinition({ source: IMPORTED, id: DEF_ID })
    expect(imported.ok, imported.reason).toBe(true)
    expect(imported.lane).toBe('runtime')
    const pasted = memberPaneDefinition({ source: PASTED, id: DEF_ID })
    expect(pasted.ok, pasted.reason).toBe(true)
    expect(pasted.lane).toBe('runtime')
    const a = columnsOf(imported)
    const b = columnsOf(pasted)
    expect(a).toEqual(b)
    expect(a[0].filter((v) => Number.isFinite(v)).length).toBe(N - 2) // non-vacuity: numbers after warm-up
  })

  it('⛔ control: the host lane refuses this script, so it is the runtime lane that drew it', () => {
    registerPineLibrary({ path: 'tester/rt3lib/1', source: LIB, licence: 'MPL-2.0', attribution: 'rt3lib (test fixture)' })
    vi.stubEnv(FLAG, '')
    expect(memberPaneDefinition({ source: IMPORTED, id: DEF_ID }).ok).toBe(false)
  })

  it('⛔ with the registry empty (every process as it starts), it declines by name', () => {
    vi.stubEnv(FLAG, '1')
    const built = memberPaneDefinition({ source: IMPORTED, id: DEF_ID })
    expect(built.ok).toBe(false)
    expect(built.runtimeDeclined && built.runtimeDeclined.code).toBe('runtime:library')
    expect(built.runtimeDeclined.why).toMatch(/tester\/rt3lib\/1/)
  })
})
