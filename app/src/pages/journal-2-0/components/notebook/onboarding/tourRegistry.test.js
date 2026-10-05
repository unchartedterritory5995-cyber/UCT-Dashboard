// @vitest-environment node
// The tour registry (wave 14, lane W14-0): shape, the base entry's zero-drift
// contract, and the two lookup helpers Help and the generic engine use.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_STEP_COPY } from './tourCopy'
import { TOUR_START_STATE } from './tourControl'
import {
  BASE_TOUR_ID, ENTRY_FIELDS, NOTEBOOK_ROOT, OPTIONAL_FIELDS, TOUR_REGISTRY, assembleRegistry, getTourEntry, replayableTours,
  startPath, startState,
} from './tourRegistry'
import { TRACK_TOURS } from './tours'

describe('the registry itself', () => {
  it('is frozen, non-empty, and every entry has exactly these fields', () => {
    expect(Object.isFrozen(TOUR_REGISTRY)).toBe(true)
    expect(TOUR_REGISTRY.length).toBeGreaterThan(0)
    for (const t of TOUR_REGISTRY) {
      expect(Object.isFrozen(t), `${t.id} is not frozen`).toBe(true)
      // the five required fields, plus `start` where an entry declares one (tours/index.js)
      expect(Object.keys(t).filter((k) => !OPTIONAL_FIELDS.includes(k)).sort())
        .toEqual(['flag', 'id', 'load', 'replayable', 'title'])
      expect(typeof t.id).toBe('string')
      expect(typeof t.flag).toBe('string')
      expect(typeof t.title).toBe('string')
      expect(typeof t.replayable).toBe('boolean')
      expect(typeof t.load).toBe('function')
    }
  })

  it('ids are unique', () => {
    const ids = TOUR_REGISTRY.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('the base tour is entry 1, pointed at the real, unchanged flag and title', () => {
    const base = TOUR_REGISTRY[0]
    expect(base.id).toBe(BASE_TOUR_ID)
    expect(base.id).toBe('notebook-basics')
    expect(base.flag).toBe('notebook_onboarding_enabled')
    expect(base.replayable).toBe(true)
  })
})

describe('the base entry describes the real tour WITHOUT reimplementing it (zero drift)', () => {
  it('load() resolves to the SAME TOUR_STEPS and TOUR_STEP_COPY exports the real tour reads', async () => {
    const base = getTourEntry(BASE_TOUR_ID)
    const { steps, copy } = await base.load()
    // reference equality, not a deep-equal copy -- a change to tourSteps.js/tourCopy.js
    // is seen here automatically; nothing here can go stale on its own
    expect(steps).toBe(TOUR_STEPS)
    expect(copy).toBe(TOUR_STEP_COPY)
  })
})

describe('getTourEntry', () => {
  it('finds an entry by id, in a registry handed in (so a test never touches the real one)', () => {
    const fake = Object.freeze([{ id: 'x', flag: 'f', title: 'X', replayable: true, load: async () => ({}) }])
    expect(getTourEntry('x', fake)).toBe(fake[0])
    expect(getTourEntry('nope', fake)).toBeNull()
  })

  it('defaults to the real TOUR_REGISTRY', () => {
    expect(getTourEntry(BASE_TOUR_ID)?.id).toBe(BASE_TOUR_ID)
  })
})

describe('replayableTours', () => {
  it('returns only replayable entries, in registry order', () => {
    const fake = Object.freeze([
      { id: 'a', replayable: true },
      { id: 'b', replayable: false },
      { id: 'c', replayable: true },
    ])
    expect(replayableTours(fake).map((t) => t.id)).toEqual(['a', 'c'])
  })

  it('the real registry: every entry is replayable except a passive explainer of 1 to 2 steps', async () => {
    // Plan 4.2 row 21 (W14-B3): `note-resurfaces` is the one passive explainer, not a
    // stepper, so it is the one entry Help does not list. Any other non-replayable
    // entry is a stepper Help would silently hide.
    const hidden = TOUR_REGISTRY.filter((t) => !t.replayable)
    expect(hidden.map((t) => t.id)).toEqual(['note-resurfaces'])
    for (const t of hidden) {
      const { steps } = await t.load()
      expect(steps.length, `${t.id} is not a 1-2 step explainer`).toBeGreaterThanOrEqual(1)
      expect(steps.length, `${t.id} is not a 1-2 step explainer`).toBeLessThanOrEqual(2)
    }
    expect(replayableTours().length).toBe(TOUR_REGISTRY.length - hidden.length)
  })
})

describe('startState', () => {
  it('the base tour resolves to the SAME TOUR_START_STATE the existing "Take the tour" link uses', () => {
    expect(startState(BASE_TOUR_ID)).toBe(TOUR_START_STATE)
    expect(startState(getTourEntry(BASE_TOUR_ID))).toBe(TOUR_START_STATE)
  })

  it('any other tour resolves to a startRegistryTourId state, frozen', () => {
    const s = startState('some-other-tour')
    expect(s).toEqual({ startRegistryTourId: 'some-other-tour' })
    expect(Object.isFrozen(s)).toBe(true)
  })

  it('accepts an entry object OR a bare id', () => {
    expect(startState({ id: 'z' })).toEqual({ startRegistryTourId: 'z' })
    expect(startState('z')).toEqual({ startRegistryTourId: 'z' })
  })
})

// ── the per-track seam (tours/index.js) ─────────────────────────────────────
// Example-free: every case below hands assembleRegistry its OWN track lists, so
// no example tour is added to the product to prove the seam works.
const tour = (id, extra = {}) => ({ id, flag: 'some_flag', title: id, replayable: true, load: async () => ({ steps: [], copy: {} }), ...extra })

describe('assembleRegistry: track files feed the registry', () => {
  it("a track list's entries appear in the registry, after the base entry, in order", () => {
    const base = [tour('base')]
    const trackA = [tour('a-1'), tour('a-2')]
    const trackB = [tour('b-1')]
    const reg = assembleRegistry(base, trackA, trackB)
    expect(reg.map((t) => t.id)).toEqual(['base', 'a-1', 'a-2', 'b-1'])
    expect(Object.isFrozen(reg)).toBe(true)
    expect(reg.every((t) => Object.isFrozen(t))).toBe(true)
    expect(getTourEntry('a-2', reg)?.title).toBe('a-2')
  })

  it('the REAL registry is exactly the base entry followed by tours/index.js TRACK_TOURS', () => {
    expect(TOUR_REGISTRY[0].id).toBe(BASE_TOUR_ID)
    expect(TOUR_REGISTRY.slice(1).map((t) => t.id)).toEqual(TRACK_TOURS.map((t) => t.id))
  })
})

describe('assembleRegistry: the duplicate-id rail', () => {
  it('two tracks claiming one id fail BY NAME', () => {
    expect(() => assembleRegistry([tour('base')], [tour('dup')], [tour('dup')]))
      .toThrow(/duplicate tour id "dup" \(track list 1, entry 0 and track list 2, entry 0\)/)
  })

  it("a track reusing the base tour's id fails by name too", () => {
    expect(() => assembleRegistry([tour(BASE_TOUR_ID)], [tour(BASE_TOUR_ID)]))
      .toThrow(new RegExp(`duplicate tour id "${BASE_TOUR_ID}"`))
  })

  it('one track listing the same id twice fails', () => {
    expect(() => assembleRegistry([tour('base')], [tour('x'), tour('x')])).toThrow(/duplicate tour id "x"/)
  })

  it('CONTROL: distinct ids pass (the rail is not "always throw")', () => {
    expect(() => assembleRegistry([tour('base')], [tour('x')], [tour('y')])).not.toThrow()
  })
})

describe('assembleRegistry: the entry shape', () => {
  it('refuses an entry with an extra field, naming its id', () => {
    expect(() => assembleRegistry([tour('base')], [tour('extra', { steps: [] })])).toThrow(/"extra".*exactly the fields/)
  })

  it('refuses an entry missing load, naming its id', () => {
    const { load, ...noLoad } = tour('noload')
    expect(load).toBeTypeOf('function')
    expect(() => assembleRegistry([tour('base')], [noLoad])).toThrow(/"noload"/)
  })

  it('refuses a wrongly typed field', () => {
    expect(() => assembleRegistry([tour('base')], [tour('bad', { replayable: 'yes' })])).toThrow(/"bad".*wrong type/)
  })

  it('ENTRY_FIELDS is the five-field contract tours/index.js documents', () => {
    expect([...ENTRY_FIELDS]).toEqual(['flag', 'id', 'load', 'replayable', 'title'])
    const doc = fs.readFileSync(INDEX, 'utf8')
    for (const f of ENTRY_FIELDS) expect(doc, `tours/index.js does not document ${f}`).toContain(`\`${f}\``)
  })
})

// tours/index.js is the only shared file: every track it imports must be SPREAD
// into TRACK_TOURS (an import nobody spreads is a track silently missing from
// the registry), and every spread must name an import. Read by AST, never grep.
const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tours', 'index.js')

function indexWiring(src) {
  const ast = Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const imported = []
  const staticSources = []
  let spreads = null
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      staticSources.push(n.source.value)
      for (const sp of n.specifiers) imported.push(sp.local.name)
    }
    if (n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration') {
      for (const d of n.declaration.declarations) {
        if (d.id.name !== 'TRACK_TOURS') continue
        let arr = d.init
        if (arr?.type === 'CallExpression') arr = arr.arguments[0]
        spreads = arr?.type === 'ArrayExpression'
          ? arr.elements.map((el) => (el?.type === 'SpreadElement' && el.argument.type === 'Identifier' ? el.argument.name : '<not a spread of an import>'))
          : null
      }
    }
  }
  return { imported, spreads, staticSources }
}

describe('tours/index.js wiring (AST)', () => {
  it('TRACK_TOURS is an array of spreads, one per imported track, and nothing else', () => {
    const { imported, spreads } = indexWiring(fs.readFileSync(INDEX, 'utf8'))
    expect(spreads, 'TRACK_TOURS must be an array literal (optionally Object.freeze-d)').not.toBeNull()
    expect([...spreads].sort()).toEqual([...imported].sort())
  })

  it('a track is imported from a sibling file in tours/, never from a steps module', () => {
    const { staticSources } = indexWiring(fs.readFileSync(INDEX, 'utf8'))
    for (const s of staticSources) expect(s, `${s}: tracks are ./<track>.js siblings`).toMatch(/^\.\/[\w-]+(\.js)?$/)
  })

  it('CONTROL: an imported track that is never spread is caught', () => {
    const src = "import { TOURS as a } from './a'\nimport { TOURS as b } from './b'\nexport const TRACK_TOURS = Object.freeze([...a])\n"
    const { imported, spreads } = indexWiring(src)
    expect([...spreads].sort()).not.toEqual([...imported].sort())
  })

  it('CONTROL: a wired file reads as wired', () => {
    const src = "import { TOURS as a } from './a'\nexport const TRACK_TOURS = Object.freeze([...a])\n"
    const { imported, spreads } = indexWiring(src)
    expect(spreads).toEqual(imported)
  })
})

describe('the optional `start` location (plan 4.2: a tour starts at its screen)', () => {
  it('an entry may name a start under the Notebook, and Replay links there', () => {
    const reg = assembleRegistry([tour('base')], [tour('s', { start: '/journal/notebook?view=all' })])
    expect(getTourEntry('s', reg).start).toBe('/journal/notebook?view=all')
    expect(startPath('s', reg)).toBe('/journal/notebook?view=all')
  })

  it('without a start, Replay goes to the Notebook root -- the base tour unchanged', () => {
    expect(NOTEBOOK_ROOT).toBe('/journal/notebook')
    expect(startPath(BASE_TOUR_ID)).toBe('/journal/notebook')
    expect(startPath(getTourEntry(BASE_TOUR_ID))).toBe('/journal/notebook')
  })

  it.each([['/support'], ['/journal'], ['/journal/notebookx'], ['journal/notebook'], [42]])(
    'refuses a start outside the Notebook (%s), naming the tour', (start) => {
      expect(() => assembleRegistry([tour('base')], [tour('far', { start })])).toThrow(/"far"\) start must be a path under/)
    },
  )

  it('any OTHER extra field is still refused', () => {
    expect(() => assembleRegistry([tour('base')], [tour('x', { route: '/journal/notebook' })])).toThrow(/exactly the fields/)
  })
})
