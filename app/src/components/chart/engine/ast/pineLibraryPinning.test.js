// app/src/components/chart/engine/ast/pineLibraryPinning.test.js
//
// ─── ⭐⭐ U15 PHASE A — A LIBRARY IS PINNED BY THE sha256 OF ITS OWN SOURCE ─────────
//
// Coordinator rulings 2026-11-15 (U15): a library version is served only with the sha256 of
// its own source (`pine:library-no-sha` otherwise), every document records the versions it
// linked as `meta.libraries = [{path, sha256}]`, and a lane that links the source AGAIN is held
// to those pins (`pine:library-changed` when the store now holds other code under the same
// version). One rule in both lanes (`pineLibraries.js`), one registry (`pineLibraryStore.js`).
//
// Every library here is written from scratch for this file (no third-party code).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { sha256Hex } from './parse.js'
import { LIBRARY_CHANGED, LIBRARY_NO_SHA, LIBRARY_LICENCE, LIBRARY_DENIED } from './pineLibraries.js'
import {
  registerPineLibrary, clearPineLibraries, pineLibraryUnservable, libraryEntryProblem, ensurePineLibraries,
  markPineLibraryUnservable, libraryLicenceProblem, libraryDenied, denyTableOf, LIBRARY_DENIED_SENTENCE,
} from './pineLibraryStore.js'
import { fixtureLibrary } from './__tests__/libraryFixture.js'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns } from '../runtime/runtimeColumns'

const PATH = 'tester/pinlib/1'
const LIB = '//@version=5\nlibrary("pinlib")\nexport twice(float x) => x * 2\n'
const LIB_OTHER = '//@version=5\nlibrary("pinlib")\nexport twice(float x) => x * 3\n'
const HEAD = '//@version=5\nindicator("pin")\n'
const SRC = `${HEAD}import ${PATH} as p\nplot(p.twice(close), "T")\n`
const raw = (source = LIB) => ({ path: PATH, source, licence: 'MPL-2.0', attribution: 'pinlib (test fixture)' })
const ENTRY = fixtureLibrary(raw())
const OTHER = fixtureLibrary(raw(LIB_OTHER))

const host = (opts) => translatePine(SRC, { mode: 'host', ...opts })
const runtime = (opts) => buildRuntimeIr(SRC, { ...runtimeClockOpts(false), inputs: {}, ...opts })
const said = (x) => JSON.stringify(x)

afterEach(() => {
  clearPineLibraries()
  vi.unstubAllEnvs()
})

describe('U15 — no sha256, not served', () => {
  it('⭐ the registry refuses an entry without a sha256, or with one that is not its source\'s, and remembers why', () => {
    expect(libraryEntryProblem(ENTRY)).toBe(null)
    expect(registerPineLibrary(raw())).toBe(null)
    expect(pineLibraryUnservable(PATH)).toMatch(/no sha256/)
    expect(registerPineLibrary({ ...raw(), sha256: OTHER.sha256 })).toBe(null)
    expect(pineLibraryUnservable(PATH)).toMatch(/does not match/)
    // control: the same entry WITH its own sha is served, and the reason is forgotten
    const stored = registerPineLibrary(ENTRY)
    expect(stored && stored.sha256).toBe(sha256Hex(LIB))
    expect(pineLibraryUnservable(PATH)).toBe(null)
  })

  it('⭐ both lanes refuse an entry without a verified sha by name (pine:library-no-sha)', () => {
    for (const bad of [raw(), { ...raw(), sha256: OTHER.sha256 }, { ...raw(), sha256: 'abc' }]) {
      const t = host({ libraries: { [PATH]: bad } })
      expect(said(t.refusal || t.refusals), said(bad.sha256)).toContain(LIBRARY_NO_SHA)
      const b = runtime({ libraries: { [PATH]: bad } })
      expect(b.ok).toBe(false)
      expect(said(b.refusal)).toContain(LIBRARY_NO_SHA)
    }
  })

  it('⭐ a version the store HOLDS but will not serve (409) is refused with the store\'s reason', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: { code: 'library:no-sha', reason: 'the library store holds tester/pinlib/1 but does not serve it (missing sha256)' } }) }))
    await ensurePineLibraries(SRC, { fetchImpl })
    expect(pineLibraryUnservable(PATH)).toMatch(/does not serve it/)
    const t = host({})
    expect(said(t.refusal || t.refusals)).toContain(LIBRARY_NO_SHA)
    expect(said(t.refusal || t.refusals)).toMatch(/does not serve it/)
    const b = runtime({})
    expect(said(b.refusal)).toContain(LIBRARY_NO_SHA)
  })

  it('⛔ CONTROL — a version the store does not hold keeps the generic import refusal', () => {
    expect(said(host({}).refusal)).toContain('pine:module')
    markPineLibraryUnservable('tester/other/1', 'x')
    expect(said(host({}).refusal)).not.toContain(LIBRARY_NO_SHA)
  })
})

describe('U15 — a non-commercial library is never served on this paid product', () => {
  const TABLE = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', 'tests/fixtures/ast/library_licence_cases.json'), 'utf8')).cases

  it('⭐ the licence rule is the shared table\'s (the store\'s twin reads the same file)', () => {
    expect(TABLE.length).toBeGreaterThan(8)
    for (const c of TABLE) {
      const e = { licence: c.licence, ...(c.nonCommercial ? { nonCommercial: true } : {}) }
      expect(!!libraryLicenceProblem(e), JSON.stringify(c)).toBe(c.nonCommercialExpected)
    }
  })

  it('⭐ both lanes refuse a non-commercial library by name, naming its licence (pine:library-licence)', () => {
    const nc = fixtureLibrary({ ...raw(), licence: 'CC-BY-NC-SA' })
    expect(registerPineLibrary(nc)).toBe(null)
    expect(pineLibraryUnservable(PATH)).toMatch(/CC-BY-NC-SA, is non-commercial/)
    for (const t of [host({}), host({ libraries: { [PATH]: nc } })]) {
      expect(said(t.refusal)).toContain(LIBRARY_LICENCE)
      expect(said(t.refusal)).toContain('CC-BY-NC-SA')
    }
    const b = runtime({ libraries: { [PATH]: nc } })
    expect(b.ok).toBe(false)
    expect(said(b.refusal)).toContain(LIBRARY_LICENCE)
  })

  it('⭐ the store\'s 409 `library:licence` is remembered under the licence refusal', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: { code: 'library:licence', reason: 'its licence, CC-BY-NC-SA, is non-commercial' } }) }))
    await ensurePineLibraries(SRC, { fetchImpl })
    expect(said(host({}).refusal)).toContain(LIBRARY_LICENCE)
    // control: the same 409 without the licence code stays the no-sha refusal
    clearPineLibraries()
    const noSha = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: { code: 'library:no-sha', reason: 'x' } }) }))
    await ensurePineLibraries(SRC, { fetchImpl: noSha })
    expect(said(host({}).refusal)).toContain(LIBRARY_NO_SHA)
  })
})

describe('U15 — the deny list (pineLibraryDeny.json): withheld until verified against TradingView', () => {
  const DENIED_PATH = 'Fontiramisu/fontilab/11'
  const DENIED_SRC = `${HEAD}import ${DENIED_PATH} as fl\nplot(fl.f(), "F")\n`
  const LIBF = fixtureLibrary({ path: DENIED_PATH, source: '//@version=5\nlibrary("fontilab")\nexport f() => close\n', licence: 'MPL-2.0', attribution: 'stand-in (test fixture)' })

  it('⭐ a denied version is refused in both lanes by name, whatever is handed in, with the member sentence', () => {
    expect(libraryDenied(DENIED_PATH)).toBe('this library version is withheld until its drawing is verified against TradingView')
    expect(registerPineLibrary(LIBF)).toBe(null)
    const t = translatePine(DENIED_SRC, { mode: 'host', libraries: { [DENIED_PATH]: LIBF } })
    expect(said(t.refusal)).toContain(LIBRARY_DENIED)
    expect(said(t.refusal)).toContain('withheld until its drawing is verified against TradingView')
    const b = buildRuntimeIr(DENIED_SRC, { ...runtimeClockOpts(false), inputs: {}, libraries: { [DENIED_PATH]: LIBF } })
    expect(b.ok).toBe(false)
    expect(said(b.refusal)).toContain(LIBRARY_DENIED)
  })

  it('⛔ CONTROL — ruled off the list: TradingView/ta/11 and PineCoders/VisibleChart/3 are not denied', () => {
    expect(libraryDenied('TradingView/ta/11')).toBe(null)
    expect(libraryDenied('PineCoders/VisibleChart/3')).toBe(null)
    expect(libraryDenied(PATH)).toBe(null)
  })

  it('⛔ FAIL CLOSED — a deny document that cannot be read as a list denies EVERY version', () => {
    const unreadable = [
      null, undefined, 'x', [], {}, { deny: 'Fontiramisu/fontilab/11' },
      { deny: [{ reason: 'a row that names no path' }] },
      { deny: [{ path: DENIED_PATH }, 5] },
      { deny: [{ path: '' }] }, { deny: [{ path: 11 }] }, { deny: [null] },
    ]
    for (const doc of unreadable) {
      expect(denyTableOf(doc), JSON.stringify(doc)).toBe(null)
      expect(libraryDenied(PATH, denyTableOf(doc)), JSON.stringify(doc)).toBe(LIBRARY_DENIED_SENTENCE)
    }
    // control: a readable list denies only what it names, and an empty list denies nothing
    const one = denyTableOf({ deny: [{ path: 'tester/other/2' }] })
    expect(libraryDenied('tester/other/2', one)).toBe(LIBRARY_DENIED_SENTENCE)
    expect(libraryDenied(PATH, one)).toBe(null)
    expect(libraryDenied(PATH, denyTableOf({ deny: [] }))).toBe(null)
    // the committed list is readable (so the controls above it are not denied by accident)
    expect(denyTableOf(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'pineLibraryDeny.json'), 'utf8'))).size).toBe(3)
  })

  it('⭐ the store\'s 409 `library:denied` is remembered under the deny refusal', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: { code: 'library:denied', reason: 'withheld' } }) }))
    await ensurePineLibraries(SRC, { fetchImpl })
    expect(said(host({}).refusal)).toContain(LIBRARY_DENIED)
  })
})

describe('U15 — the pin', () => {
  it('⭐ the translation records what it compiled, by its sha256, in both lanes', () => {
    const t = host({ libraries: { [PATH]: ENTRY } })
    expect(t.refusal).toBeFalsy()
    expect(t.libraries).toEqual([expect.objectContaining({ path: PATH, sha256: sha256Hex(LIB) })])
    const b = runtime({ libraries: { [PATH]: ENTRY } })
    expect(b.ok).toBe(true)
    expect(b.libraries).toEqual([expect.objectContaining({ path: PATH, sha256: sha256Hex(LIB) })])
  })

  it('⭐ a document pinned to other code is refused by name in both lanes (pine:library-changed); its own pin links', () => {
    const pins = [{ path: PATH, sha256: sha256Hex(LIB) }]
    expect(host({ libraries: { [PATH]: ENTRY }, libraryPins: pins }).refusal).toBeFalsy()
    expect(runtime({ libraries: { [PATH]: ENTRY }, libraryPins: pins }).ok).toBe(true)
    const t = host({ libraries: { [PATH]: OTHER }, libraryPins: pins })
    expect(said(t.refusal)).toContain(LIBRARY_CHANGED)
    expect(said(t.refusal)).toMatch(/has changed since this script was saved/)
    const b = runtime({ libraries: { [PATH]: OTHER }, libraryPins: pins })
    expect(b.ok).toBe(false)
    expect(said(b.refusal)).toContain(LIBRARY_CHANGED)
    // a pin for a library the script does not import changes nothing
    expect(host({ libraries: { [PATH]: OTHER }, libraryPins: [{ path: 'tester/x/1', sha256: sha256Hex(LIB) }] }).refusal).toBeFalsy()
  })

  it('⭐ the member door stamps the pins on the document (host lane)', () => {
    registerPineLibrary(ENTRY)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const built = memberPaneDefinition({ source: SRC, id: 'u_member-pane-u15-pin' })
    try {
      expect(built.ok, built.reason).toBe(true)
      expect(built.definition.meta.libraries).toEqual([{ path: PATH, sha256: sha256Hex(LIB) }])
    } finally {
      registry.uninstallUserDefinition('u_member-pane-u15-pin')
    }
  })

  it('⛔ CONTROL — a script that imports nothing carries no pins', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const built = memberPaneDefinition({ source: `${HEAD}plot(close * 2, "T")\n`, id: 'u_member-pane-u15-none' })
    try {
      expect(built.ok, built.reason).toBe(true)
      expect(built.definition.meta).not.toHaveProperty('libraries')
    } finally {
      registry.uninstallUserDefinition('u_member-pane-u15-none')
    }
  })
})

describe('U15 — a runtime document re-links on every run and is held to its pins', () => {
  // a v5 script the host lane refuses (`var` state read through a loop), so the runtime lane draws it
  const RT = `${HEAD}import ${PATH} as p\nvar float x = 0.0\nx := p.twice(close)\ns = 0.0\nfor i = 0 to 2\n    s := s + x[i]\nplot(s, "S")\n`
  const BARS = Array.from({ length: 20 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 101, l: 99, c: 100 + i, v: 1000 }))
  const run = (def) => {
    try {
      // cold, as the server runs it: a session would reuse the build it linked first
      return { cols: computeRuntimeColumns(def, BARS, { tf: 'D', newestBarIsForming: false, historyFromListing: true }, { incremental: false }) }
    } catch (err) { return { err } }
  }

  it('⭐ drawn against its pinned code; refused by name once the registry holds other code', () => {
    registerPineLibrary(ENTRY)
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const built = memberPaneDefinition({ source: RT, id: 'u_member-pane-u15-rt' })
    try {
      expect(built.ok, built.reason).toBe(true)
      expect(built.lane).toBe('runtime')
      expect(built.definition.meta.libraries).toEqual([{ path: PATH, sha256: sha256Hex(LIB) }])
      const ok = run(built.definition)
      expect(ok.err).toBeUndefined()
      const key = built.rows[0].key
      expect(Array.from(ok.cols[key]).some((v) => Number.isFinite(v))).toBe(true)
      // the store now serves other code under the same version
      clearPineLibraries()
      registerPineLibrary(OTHER)
      const changed = run(built.definition)
      const guard = changed.err ? changed.err.guard : (registry.columnErrors(changed.cols)[key] || {}).guard
      expect(guard).toBe(LIBRARY_CHANGED)
    } finally {
      registry.uninstallUserDefinition('u_member-pane-u15-rt')
    }
  })
})
