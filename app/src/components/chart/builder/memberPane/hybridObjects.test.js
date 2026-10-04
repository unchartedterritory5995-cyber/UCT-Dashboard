// app/src/components/chart/builder/memberPane/hybridObjects.test.js
//
// ─── RT9 — ONE DOCUMENT, TWO SOURCES: HOST PLOTS, AND DRAWINGS FROM A RUN ──────
//
// atr-support-and-resistance attaches on the HOST lane (its nine plots translate)
// and the host object program loses every zone (four extend/break loops over a
// float array, `guard:loop` `pine:block`): TradingView draws 20 lines and 20 boxes
// on NYSE:RDDT 1D, the host lane draws none. The runtime lane builds the same
// script with every drawing (RT5). Since RT9 the host document carries the script
// beside its trees (`objectsRun`) and its drawings come from ONE run of it where
// that run computes — and from the host program exactly as before everywhere else.
//
// Rails: the document's shape and that its plots are the host's byte for byte; the
// runtime document's gates (stage, kill list, allowlist) each decline it by name;
// the reader (`objectsRunFor`) — the run's drawings from the listing, the host's
// off it, the host's once a setting moved or the install door stamped the run; and
// the schema refuses a malformed run. Controls: a script whose host drawing is
// complete carries no run; runtime pane off, nothing changes.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from './memberPaneDefinition'
import { hostDrawingLoss } from './runtimeObjectsDoor'
import * as registry from '../../engine/nativeRegistry'
import { validateDefinition } from '../../engine/defSchema'
import { objectsRunOf, objectsRunWithheldOn } from '../../engine/runtime/runtimeObjects'
import { setRuntimeKillList, runtimeSourceHash, __resetRuntimeAllowList, setRuntimeAllowList } from '../../engine/runtimeKill'
import { __resetRuntimePanePermission, __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { loadCapture, HARNESS_DIR } from '../../engine/__tests__/vendorHarness/harness'
import { toProductBars } from '../../engine/__tests__/vendorHarness/ourSide'
import { reduceIfOversized, hydrateGraphDocument } from '../../engine/ast/graphDocument'
import { createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'

const REPO = path.resolve(process.cwd(), '..')
const ATR_SR = fs.readFileSync(path.join(REPO, 'corpus/committed/atr-support-and-resistance__3e9ddb38c4.pine'), 'utf8')
const ID = 'u_rt9hybrid01'
// a plot and a label the host lane follows: its drawing picture is complete
const HOST_COMPLETE = '//@version=5\nindicator("t", overlay = true)\nplot(close)\n'
  + 'if bar_index % 50 == 0\n    label.new(bar_index, close, "x")\n'

const flags = (runtime) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', runtime ? '1' : '')
}
const build = (source) => memberPaneDefinition({ source, id: ID, name: 'T' })
const rddt = () => loadCapture(path.join(HARNESS_DIR, 'atr-support-and-resistance-rddt-1d-2026-09-28.json')).capture
const ctxOf = (listing) => ({ tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: listing })
const install = (def) => {
  const { installed, errors } = registry.installUserDefinitions([def])
  expect(errors).toEqual([])
  return installed[0]
}
const families = (payload) => {
  const n = { line: 0, label: 0, box: 0 }
  for (const o of payload.live) if (o.family in n) n[o.family] += 1
  return n
}

afterEach(() => {
  registry.uninstallUserDefinition(ID)
  setRuntimeKillList([])
  vi.unstubAllEnvs()
})

describe('RT9 — the door mints a hybrid document', () => {
  it('atr-support-and-resistance: the host lane LOST its creates, and the run is carried', () => {
    flags(true)
    const r = build(ATR_SR)
    expect(r.ok).toBe(true)
    expect(r.lane).toBeUndefined() // a HOST document
    expect(hostDrawingLoss(r.translation)).toBe('lost-creates')
    expect(r.objectsRun).toBe('served')
    const run = r.definition.objectsRun
    expect(run).toMatchObject({ kind: 'runtime', source: ATR_SR, repaint: 'non-repainting' })
    expect(run.trees).toBe(r.definition.compute.treesHash || r.definition.compute.fn)
    expect(run.inputs).toEqual((r.definition.inputs || []).filter((i) => run.inputs.includes(i.key)).map((i) => i.key))
    expect(run.inputs.length).toBeGreaterThan(0)
    expect(r.definition.meta.runtimeSourceHash).toBe(runtimeSourceHash(ATR_SR))
    expect(r.notes.map((n) => n.name)).toContain('Drawings')
    expect(validateDefinition(r.definition).ok).toBe(true)
  })

  it('⛔ the plots are the host\'s, byte for byte: the document is the runtime-off one plus the run', () => {
    flags(false)
    const before = build(ATR_SR)
    flags(true)
    const after = build(ATR_SR)
    expect(before.definition.objectsRun).toBeUndefined()
    const strip = (d) => {
      const c = JSON.parse(JSON.stringify(d))
      delete c.objectsRun
      delete c.meta.runtimeSourceHash
      delete c.meta.disclosures
      return c
    }
    expect(strip(after.definition)).toEqual(strip(before.definition))
    // the host's own disclosures lead, unchanged; the run's are appended
    expect(after.notes.slice(0, before.notes.length)).toEqual(before.notes)
  })

  it('CONTROL: a host drawing that is complete carries no run', () => {
    flags(true)
    const r = build(HOST_COMPLETE)
    expect(r.ok).toBe(true)
    expect(hostDrawingLoss(r.translation)).toBeNull()
    expect(r.objectsRun).toBeNull()
    expect(r.definition.objectsRun).toBeUndefined()
  })

  it('CONTROL: runtime pane off — not asked', () => {
    flags(false)
    const r = build(ATR_SR)
    expect(r.objectsRun).toBeNull()
    expect(r.definition.objectsRun).toBeUndefined()
  })

  it('⛔ GATES: the member stage, the kill list and the allowlist each decline the run by name — the plots still attach', () => {
    flags(true)
    __resetRuntimePanePermission()
    let r = build(ATR_SR)
    expect(r.ok).toBe(true)
    expect(r.objectsRun).toBeNull()
    expect(r.definition.objectsRun).toBeUndefined()

    __permitRuntimePaneForTests()
    setRuntimeKillList([runtimeSourceHash(ATR_SR).slice(0, 16)])
    r = build(ATR_SR)
    expect(r.ok).toBe(true)
    expect(r.objectsRun).toBe('runtime:killed')
    expect(r.definition.objectsRun).toBeUndefined()
    setRuntimeKillList([])

    __resetRuntimeAllowList()
    r = build(ATR_SR)
    expect(r.ok).toBe(true)
    expect(r.objectsRun).toBe('runtime:not-yet-graded')
    setRuntimeAllowList([runtimeSourceHash(ATR_SR)])
    expect(build(ATR_SR).objectsRun).toBe('served')
  })
})

describe('RT9 — whose drawings a chart draws (`objectsRunFor`)', () => {
  it('⭐ from the listing: the run\'s own — 20 lines and 20 boxes, TradingView\'s counts on RDDT', () => {
    flags(true)
    const def = install(build(ATR_SR).definition)
    const c = rddt()
    const got = registry.objectsRunFor(def, toProductBars(c), undefined, ctxOf(true))
    expect(got.withheld).toBeNull()
    expect(families(got.payload)).toEqual({ line: 20, label: 0, box: 20 })
    // the vendor's own counts, read off the capture (non-vacuity)
    expect((c.objects.records.lines || []).length).toBe(20)
    expect((c.objects.records.boxes || []).length).toBe(20)
  })

  it('off the listing: runtime:history-start, and the host program draws as before', () => {
    flags(true)
    const def = install(build(ATR_SR).definition)
    const got = registry.objectsRunFor(def, toProductBars(rddt()), undefined, ctxOf(false))
    expect(got.payload).toBeNull()
    expect(got.withheld.guard).toBe('runtime:history-start')
  })

  it('a SCRIPT setting moved from its default: withheld by name; a plot\'s STYLE knob moves nothing', () => {
    flags(true)
    const def = install(build(ATR_SR).definition)
    const key = def.objectsRun.inputs[0]
    const dflt = def.inputs.find((i) => i.key === key).default
    const bars = toProductBars(rddt())
    const moved = registry.objectsRunFor(def, bars, { [key]: typeof dflt === 'number' ? dflt + 1 : !dflt }, ctxOf(true))
    expect(moved.payload).toBeNull()
    expect(moved.withheld.guard).toBe('runtime:objects-settings')
    // the default itself, and a style input (not the script's), keep the run
    const style = def.inputs.find((i) => !def.objectsRun.inputs.includes(i.key))
    expect(style).toBeTruthy()
    expect(objectsRunWithheldOn(def, { [key]: dflt, [style.key]: '#123456' })).toBeNull()
  })

  it('a PARAMETER edit (the trees moved): withheld by name', () => {
    flags(true)
    const def = build(ATR_SR).definition
    const edited = { ...def, compute: { ...def.compute, treesHash: 'sha256:moved', fn: 'sha256:moved' } }
    expect(objectsRunWithheldOn(edited, {}).guard).toBe('runtime:objects-settings')
    expect(objectsRunWithheldOn(def, {})).toBeNull()
  })

  it('⛔ the install door: a kill-listed or server-stamped run installs WITHOUT the run\'s drawings, plots intact', () => {
    flags(true)
    const built = build(ATR_SR).definition
    setRuntimeKillList([runtimeSourceHash(ATR_SR)])
    let def = install(built)
    expect(def.meta.objectsRunWithheld).toMatch(/kill list/)
    expect(registry.objectsRunFor(def, toProductBars(rddt()), undefined, ctxOf(true)).withheld.guard)
      .toBe('runtime:objects-run')
    setRuntimeKillList([])
    registry.uninstallUserDefinition(ID)
    def = install({ ...built, meta: { ...built.meta, runtimeNotGraded: 'not graded (server stamp)' } })
    expect(def.meta.objectsRunWithheld).toBe('not graded (server stamp)')
    expect(def.plots.map((p) => p.key)).toEqual(built.plots.map((p) => p.key))
  })

  it('⛔ the member\'s stage switched off: the run\'s drawings are not drawn', () => {
    flags(true)
    const def = install(build(ATR_SR).definition)
    __resetRuntimePanePermission()
    const got = registry.objectsRunFor(def, toProductBars(rddt()), undefined, ctxOf(true))
    expect(got.payload).toBeNull()
    expect(got.withheld.guard).toBe('runtime:objects-run')
  })

  it('CONTROL: a document with no run answers null', () => {
    flags(true)
    const def = install(build(HOST_COMPLETE).definition)
    expect(objectsRunOf(def)).toBeNull()
    expect(registry.objectsRunFor(def, toProductBars(rddt()), undefined, ctxOf(true))).toBeNull()
  })
})

describe('RT9 — the schema fails closed on a malformed run', () => {
  it('refuses each malformed field, and a run on a runtime document', () => {
    flags(true)
    const d = build(ATR_SR).definition
    expect(validateDefinition(d).ok).toBe(true)
    const bad = (patch) => {
      const v = validateDefinition({ ...d, objectsRun: { ...d.objectsRun, ...patch } })
      expect(v.ok).toBe(false)
      return v.errors.join(' | ')
    }
    expect(bad({ kind: 'ast' })).toMatch(/objectsRun\.kind/)
    expect(bad({ source: '' })).toMatch(/objectsRun\.source/)
    expect(bad({ repaint: 'clean' })).toMatch(/objectsRun\.repaint/)
    expect(bad({ trees: null })).toMatch(/objectsRun\.trees/)
    expect(bad({ inputs: [3] })).toMatch(/objectsRun\.inputs/)
    expect(validateDefinition({ ...d, objectsRun: 'yes' }).ok).toBe(false)
  })
})

// ─── the server's half reads THESE documents, as the door mints them ───────────
const HYBRID_FIXTURE = path.join(REPO, 'tests', 'fixtures', 'runtime_documents', 'hybrid_documents.json')
const HYBRID_SCRIPTS = [
  ['atr-support-and-resistance', 'atr-support-and-resistance__3e9ddb38c4.pine', 'u_0000000009a1'],
  ['poor-man039s-volume-profile', 'poor-man039s-volume-profile__ZnFTCYyvGJ.pine', 'u_0000000009a2'],
]

describe('RT9 — the hybrid documents the server rails read', () => {
  it('⭐ the fixture is exactly what the save door sends (RT9_WRITE_FIXTURE=1 rewrites it)', () => {
    flags(true)
    const docs = HYBRID_SCRIPTS.map(([slug, file, id]) => {
      const source = fs.readFileSync(path.join(REPO, 'corpus/committed', file), 'utf8')
      const built = memberPaneDefinition({ source, id, name: slug })
      expect(built.ok, `${slug}: ${built.reason}`).toBe(true)
      expect(built.objectsRun, slug).toBe('served')
      // ⭐ what the SAVE door sends (`useUserDefinitions` → `reduceIfOversized`), not the
      // in-memory document: the server judges the wire form.
      const sent = JSON.parse(JSON.stringify(reduceIfOversized(built.definition)))
      // a graph-form document hydrates back to the SAME host compute identity, so the
      // reloaded document's run is not mistaken for a changed setting
      expect(objectsRunWithheldOn(hydrateGraphDocument(JSON.parse(JSON.stringify(sent))), {}), slug).toBeNull()
      return { slug, file: `corpus/committed/${file}`, definition: sent }
    })
    if (process.env.RT9_WRITE_FIXTURE === '1') {
      fs.writeFileSync(HYBRID_FIXTURE, `${JSON.stringify({
        generatedBy: 'app/src/components/chart/builder/memberPane/hybridObjects.test.js (RT9_WRITE_FIXTURE=1)',
        documents: docs,
      }, null, 1)}\n`)
    }
    const fixture = JSON.parse(fs.readFileSync(HYBRID_FIXTURE, 'utf8'))
    expect(fixture.documents.map((d) => d.slug)).toEqual(HYBRID_SCRIPTS.map(([s]) => s))
    for (let k = 0; k < docs.length; k += 1) expect(fixture.documents[k].definition, docs[k].slug).toEqual(docs[k].definition)
  }, 120000)
})

describe('RT9 — the CHART binding asks the same reader', () => {
  /** What the binder hands the object layer for atr-s&r over RDDT's bars:
   *  `{state, opts}` of the LAST set, so the lane that drew it is visible. */
  const layer = ({ listing, inputs } = {}) => {
    flags(true)
    const def = install(build(ATR_SR).definition)
    const c = rddt()
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
      .map((i) => (inputs ? { ...i, inputs: { ...(i.inputs || {}), ...inputs } } : i))
    let last = null
    binder.sync({
      enabled: true, cs, instances, registry, bars: toProductBars(c), tf: 'D',
      symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false,
      ...(listing ? { historyFromListing: true } : {}),
      adjustTime: (t) => t,
      applyData: (series, data) => series.setData(data),
      plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: {} }),
      createObjectLayer: () => ({ set: (state, sig, opts) => { last = { state, opts: opts || {} } }, clear: () => {} }),
    })
    binder.teardown()
    return last
  }

  it("⭐⭐ from the listing: the layer is the run's own: 20 lines and 20 boxes", () => {
    const got = layer({ listing: true })
    expect(got && got.opts.lane).toBe('runtime')
    expect(got.state.lines).toHaveLength(20)
    expect(got.state.boxes).toHaveLength(20)
  })

  it('⭐ off the listing: the HOST program draws, as it did before RT9', () => {
    const got = layer({ listing: false })
    expect(got).toBeTruthy()
    expect(got.opts.lane).not.toBe('runtime')
  })

  it('⭐ a script setting moved: the HOST program draws, never the run at its defaults', () => {
    flags(true)
    const d = build(ATR_SR).definition
    const key = d.objectsRun.inputs[0]
    const dflt = d.inputs.find((i) => i.key === key).default
    registry.uninstallUserDefinition(ID)
    const got = layer({ listing: true, inputs: { [key]: typeof dflt === 'number' ? dflt + 1 : !dflt } })
    expect(got).toBeTruthy()
    expect(got.opts.lane).not.toBe('runtime')
  })
})
