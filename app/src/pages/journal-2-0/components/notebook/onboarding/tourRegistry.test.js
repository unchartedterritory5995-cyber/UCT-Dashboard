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
  START_ROUTES, OTHER_TOURS, startKind, startPath, startProblem, startState,
} from './tourRegistry'
import { TRACK_TOURS } from './tours'

describe('the registry itself', () => {
  it('is frozen, non-empty, and every entry has exactly these fields (plus the optional `start`)', () => {
    expect(Object.isFrozen(TOUR_REGISTRY)).toBe(true)
    expect(TOUR_REGISTRY.length).toBeGreaterThan(0)
    for (const t of TOUR_REGISTRY) {
      expect(Object.isFrozen(t), `${t.id} is not frozen`).toBe(true)
      // The five required fields, plus `start` where an entry declares one (tours/index.js;
      // W14-B1, B2 and B3 each wrote this exception; reconciled at integration). The list
      // of optional fields is read from the module AND pinned below, so widening it is a
      // visible edit here, never a silent way to let an unknown key through.
      expect(Object.keys(t).filter((k) => !OPTIONAL_FIELDS.includes(k)).sort(), `${t.id} fields`)
        .toEqual(['flag', 'id', 'load', 'replayable', 'title'])
      if ('start' in t) {
        // W14-C1: one validator, the module's own (`startProblem`), never a restated rule.
        expect(startProblem(t.start), `${t.id} start ${JSON.stringify(t.start)}`).toBeNull()
        if (typeof t.start === 'object') expect(Object.isFrozen(t.start), `${t.id} start is not frozen`).toBe(true)
      }
      expect(typeof t.id).toBe('string')
      expect(typeof t.flag).toBe('string')
      expect(typeof t.title).toBe('string')
      expect(typeof t.replayable).toBe('boolean')
      expect(typeof t.load).toBe('function')
    }
  })

  it('`start` is the ONLY optional field', () => {
    expect([...OPTIONAL_FIELDS]).toEqual(['start'])
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

  it('the real registry: an entry Help does not list is a 1-2 step passive explainer, never a stepper', async () => {
    // Plan 4.2 row 21 (W14-B3): `note-resurfaces` is a passive explainer, not a stepper, so
    // Help does not list it. Any non-replayable entry must be such an explainer; a hidden
    // 3+ step tour is a stepper Help would silently hide (the step budget below fails it by
    // name too). Non-vacuity: today exactly one such entry exists.
    const hidden = TOUR_REGISTRY.filter((t) => !t.replayable)
    expect(hidden.map((t) => t.id)).toEqual(['note-resurfaces'])
    expect(replayableTours().length).toBe(TOUR_REGISTRY.length - hidden.length)
  })
})

// ── the step budget (plan G2 + section 4.2 row 21; added at integration) ──────────────
// A capability tour is 3 to 6 steps; a `replayable: false` passive explainer is 1 to 2.
// The base tour (wave 8, `notebook-basics`) predates the budget and is held to zero drift
// by reference equality above, so it is the ONE exception, and only by its id.
function stepBudgetViolation(entry, steps) {
  const n = Array.isArray(steps) ? steps.length : 0
  const [lo, hi, kind] = entry.replayable ? [3, 6, 'a replayable tour'] : [1, 2, 'a replayable:false explainer']
  return n >= lo && n <= hi ? null : `${entry.id}: ${n} steps; ${kind} must have ${lo}-${hi}`
}

describe('every registered tour keeps the step budget', () => {
  const budgeted = TOUR_REGISTRY.filter((t) => t.id !== BASE_TOUR_ID)

  it('NON-VACUITY: the wave-14 tours are in the registry, both kinds', () => {
    expect(budgeted.length).toBeGreaterThanOrEqual(20)
    expect(budgeted.some((t) => t.replayable)).toBe(true)
    expect(budgeted.some((t) => !t.replayable)).toBe(true)
  })

  it('all tours: no violations (failing lists every offender by name)', async () => {
    const bad = []
    for (const t of budgeted) {
      const { steps } = await t.load()
      const v = stepBudgetViolation(t, steps)
      if (v) bad.push(v)
    }
    expect(bad, `step budget broken: ${bad.join('; ')}`).toEqual([])
  })

  it('CONTROLS: the rule fails on each edge, by name', () => {
    const steps = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }))
    const rep = { id: 'ctl-tour', replayable: true }
    const exp = { id: 'ctl-explainer', replayable: false }
    expect(stepBudgetViolation(rep, steps(2))).toMatch(/^ctl-tour: 2 steps/)
    expect(stepBudgetViolation(rep, steps(3))).toBeNull()
    expect(stepBudgetViolation(rep, steps(6))).toBeNull()
    expect(stepBudgetViolation(rep, steps(7))).toMatch(/^ctl-tour: 7 steps/)
    expect(stepBudgetViolation(exp, steps(0))).toMatch(/^ctl-explainer: 0 steps/)
    expect(stepBudgetViolation(exp, steps(2))).toBeNull()
    expect(stepBudgetViolation(exp, steps(3))).toMatch(/^ctl-explainer: 3 steps/)
    expect(stepBudgetViolation(rep, undefined)).toMatch(/^ctl-tour: 0 steps/)
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
const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX = path.join(HERE, 'tours', 'index.js')

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

  // W14-C1: a start may name any KNOWN in-app page (START_ROUTES), or a note or a trade.
  it.each([
    ['/support'], ['/journal'], ['/journal/notebookx'], ['journal/notebook'], [42], [null],
    ['/journal-2-0/trade/7'], ['/journal-2-0/position/AAPL'], ['https://example.com/journal/notebook'],
    [{ note: 'someone-else' }], [{ note: 'sample:' }], [{ note: 'sample:Plan' }], [{ note: 'recent', embed: '' }],
    [{ note: 'recent', extra: 1 }], [{ trade: 'oldest' }], [{ trade: 'recent', note: 'recent' }], [{}], [[]],
  ])('refuses an unknown start (%j), naming the tour', (start) => {
    expect(() => assembleRegistry([tour('base')], [tour('far', { start })])).toThrow(/"far"\) start is not a known start/)
  })

  it.each([
    ...START_ROUTES.map((r) => [r]),
    ['/journal/notebook?view=tasks'], ['/journal-2-0/playbook?x=1'],
    [{ note: 'recent' }], [{ note: 'sample:plan' }], [{ note: 'sample:active_setup', embed: 'chart' }], [{ trade: 'recent' }],
  ])('accepts a known start (%j)', (start) => {
    expect(startProblem(start)).toBeNull()
    const reg = assembleRegistry([tour('base')], [tour('ok', { start })])
    expect(getTourEntry('ok', reg).start).toEqual(start)
  })

  it('startPath: a path start links to itself; a note start to the Notebook; a trade start to the trades list', () => {
    const reg = assembleRegistry([tour('base')], [
      tour('p', { start: '/journal-2-0/playbook' }),
      tour('n', { start: { note: 'sample:plan', embed: 'chart' } }),
      tour('t', { start: { trade: 'recent' } }),
    ])
    expect(startPath('p', reg)).toBe('/journal-2-0/playbook')
    expect(startPath('n', reg)).toBe(NOTEBOOK_ROOT)
    expect(startPath('t', reg)).toBe('/journal/trades')
    expect(['p', 'n', 't'].map((id) => startKind(getTourEntry(id, reg)))).toEqual(['path', 'note', 'trade'])
    expect(startKind(getTourEntry(BASE_TOUR_ID))).toBeNull()
  })

  it('every START_ROUTES page is a route App.jsx registers inside the authenticated Layout', () => {
    // Read from the router, never restated: a route renamed in App.jsx turns this red.
    const app = fs.readFileSync(path.resolve(HERE, '../../../../../App.jsx'), 'utf8')
    const layoutAt = app.indexOf('<Route element={<Layout />}>')
    expect(layoutAt, 'App.jsx no longer mounts Layout as a route element').toBeGreaterThan(0)
    const inside = app.slice(layoutAt)
    const journalNested = (p) => p.startsWith('/journal/') && inside.includes(`<Route path="${p.slice('/journal/'.length)}"`)
      && inside.includes('<Route path="/journal" element={<JournalShellSelector />}>')
    for (const r of START_ROUTES) {
      const direct = inside.includes(`<Route path="${r}"`)
      expect(direct || journalNested(r), `${r} is not a route inside Layout`).toBe(true)
    }
  })

  it('OTHER_TOURS is the registry without the base tour, frozen, one array', () => {
    expect(OTHER_TOURS.map((t) => t.id)).toEqual(TOUR_REGISTRY.filter((t) => t.id !== BASE_TOUR_ID).map((t) => t.id))
    expect(Object.isFrozen(OTHER_TOURS)).toBe(true)
  })

  it('any OTHER extra field is still refused', () => {
    expect(() => assembleRegistry([tour('base')], [tour('x', { route: '/journal/notebook' })])).toThrow(/exactly the fields/)
  })
})

// ── W14-C1: steps that wait for the member, and sample-note starts ───────────────
describe('`waitFor` and `sample:<key>` are declarative and railed', () => {
  it('a step `waitFor` names the anchor of a LATER step in the same tour (so the anchor rail covers it)', async () => {
    let seen = 0
    for (const t of TOUR_REGISTRY) {
      const { steps } = await t.load()
      steps.forEach((s, i) => {
        expect(Object.keys(s).filter((k) => !['id', 'anchor', 'file', 'waitFor'].includes(k)), `${t.id}.${s.id} fields`).toEqual([])
        if (!('waitFor' in s)) return
        seen += 1
        const later = steps.slice(i + 1).map((x) => x.anchor)
        expect(later, `${t.id}.${s.id} waitFor ${s.waitFor} is not a later step's anchor`).toContain(s.waitFor)
      })
    }
    expect(seen, 'non-vacuity: some tour declares waitFor').toBeGreaterThan(0)
  })

  it('every `sample:<key>` start is a key W14-E actually seeds (sample_examples.py), under its own prefix', () => {
    const py = fs.readFileSync(path.resolve(HERE, '../../../../../../../api/services/journal_two/sample_examples.py'), 'utf8')
    expect(py).toMatch(/^KEY_PREFIX = "sample-example:"$/m)
    const keys = TOUR_REGISTRY.filter((t) => startKind(t) === 'note' && t.start.note.startsWith('sample:'))
      .map((t) => t.start.note.slice('sample:'.length))
    expect(keys.length, 'non-vacuity: some tour starts on a sample note').toBeGreaterThan(0)
    for (const k of keys) expect(py, `sample key ${k} is never seeded`).toMatch(new RegExp(String.raw`_own_import\(\s*user_id, conn, "${k}"`))
  })
})
