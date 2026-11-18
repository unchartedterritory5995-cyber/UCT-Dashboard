// app/src/components/chart/builder/memberPane/runHalfDisclosure.test.jsx
//
// ─── ⭐⭐ THE DRAWING NOTE IS THIS CHART'S TRUTH (coordinator ruling 2026-11-17) ──────────────────
//
// ⚰️ ON PRODUCTION (smoke@, RS Rating on AGL): the pane said "This script's plots are shown, but its
// drawings are not ... where this chart can run the script bar by bar, ... made by that run instead",
// directly under the rating label the run half HAD drawn. That note is the HOST lane's, stamped on the
// document (`meta.disclosures`), and it did not know what this chart did. Now:
//   * where the binder drew an instance's drawings from the run half (`servedByRun`, published by the
//     binder itself: one authority, never a second evaluation of the gates), the note is left out;
//   * where the run half is refused, the note stands with the refusal sentence (RUN_HALF_WHY);
//   * a run half refused LATER (the kill list latched after the chart drew) brings the note back;
//   * ⛔ CONTROL: a document with no run half keeps its note.
// The binder rails use the run-half fixture `runHalf.test.jsx` proves served; RS Rating's own document
// (whose run needs index data this unit cannot supply) is held at the pane on the binder's own entries.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { DRAWING_NOTE_NAME, RUN_HALF_DRAWING_SENTENCE, runHalfRefusedSentence, RUN_HALF_WHY_KEY } from '../../engine/ast/objectLoss'
import { carriesRunHalf } from '../../engine/runtime/runtimeObjects'
import { runtimeColumnsFor } from '../../engine/runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from '../../engine/runtimeKill'
import { objectRenderDropsFor, resetObjectRenderDrops } from '../../engine/objectRenderNotice'
import AttachedPineDisclosures, { attachedDisclosures } from '../../pane/AttachedPineDisclosures'
import { setRunHalfObjectEvidence } from '../../engine/runHalfRailSeam'

const LF = String.fromCharCode(10)
const SRC = ['//@version=5', 'indicator("run half", overlay = true)', 'len = input.int(5, "len")',
  'm = ta.sma(close, len)', 'plot(m, "m")', 'plot(m * 2, "m2")', 'if barstate.islast',
  '    line.new(bar_index - 1, low, bar_index, high)', '    for i = 0 to 4',
  '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
const BARS = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 8 * Math.sin(i / 9) + i * 0.02
  return { t: 1420156800 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1e6 }
})
const CTX = Object.freeze({ tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false, historyFromListing: true })
const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const HOST_NOTE = /plots are shown, but its drawings are not/

let seq = 0
const door = (source = SRC, opts = {}) => memberPaneDefinition({ source, name: 'rh', ...opts, id: opts.id || `u_member-pane-rhd${++seq}` })
function install(def) {
  const { installed, errors } = registry.installUserDefinitions([def])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(SRC), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
})
afterEach(() => {
  setRunHalfObjectEvidence([])
  cleanup()
  resetObjectRenderDrops()
  setRuntimeKillList([])
  for (const d of registry.listUserDefinitions()) {
    if (d && typeof d.id === 'string' && d.id.startsWith('u_member-pane-rhd')) registry.uninstallUserDefinition(d.id)
  }
  vi.unstubAllEnvs()
})

function chart(def) {
  const fakeChart = createFakeChart()
  const binder = createBinder({ chart: fakeChart.chart, LWC: fakeChart.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const states = []
  const sync = () => binder.sync({
    enabled: true, cs, instances, registry, bars: BARS, tf: 'D', symbol: CTX.symbol, newestBarIsForming: false,
    historyFromListing: true, adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
    createObjectLayer: () => ({ set: (state) => { states.push(state) }, clear: () => { states.push(null) } }),
  })
  const text = () => {
    cleanup()
    render(<AttachedPineDisclosures settings={cs} registry={registry} />)
    return screen.queryByTestId('pine-attached-disclosures')?.textContent || ''
  }
  return { binder, states, sync, text, id: instances[0].instanceId }
}
const labels = (s) => (s && Array.isArray(s.labels) ? s.labels.length : null)

describe('⭐⭐ the binder says when it drew the run half, and the pane believes it', () => {
  // the host lane's drawing note this document carries (its wording is the fixture's own loss)
  const hostNoteOf = (def) => {
    const note = (def.meta.disclosures || []).find((n) => n.name === DRAWING_NOTE_NAME)
    return note && note.note
  }
  const head = (def) => hostNoteOf(def).slice(0, 48)

  it('the fixture\'s document carries the host lane\'s drawing note, with the run-half sentence', () => {
    const def = install(door().definition)
    expect(carriesRunHalf(def)).toBe(true)
    expect(hostNoteOf(def)).toContain(RUN_HALF_DRAWING_SENTENCE)
  })

  it('SERVED: the run\'s labels are drawn, the binder publishes servedByRun, and the host note is left out', () => {
    const def = install(door().definition)
    const c = chart(def)
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(5)
    expect(objectRenderDropsFor(c.id)).toMatchObject({ servedByRun: true })
    expect(c.text()).not.toContain(head(def))
    c.binder.teardown()
  })

  it('⛔ REFUSED (the kill list): no servedByRun, and the note stands with the refusal sentence', () => {
    const def = install(door().definition)
    setRuntimeKillList([runtimeSourceHash(SRC)])
    const c = chart(def)
    c.sync()
    const d = objectRenderDropsFor(c.id)
    expect(d && d.servedByRun).not.toBe(true)
    const t = c.text()
    expect(t).toContain(head(def))
    expect(t).toContain(runHalfRefusedSentence('pane:killed'))
    c.binder.teardown()
  })

  it('⛔ REFUSED LATER: served first, then the kill list lands; the note comes back with its reason', () => {
    const def = install(door().definition)
    const c = chart(def)
    c.sync()
    expect(c.text()).not.toContain(head(def))
    setRuntimeKillList([runtimeSourceHash(SRC)])
    c.sync()
    expect(objectRenderDropsFor(c.id) && objectRenderDropsFor(c.id).servedByRun).not.toBe(true)
    const t = c.text()
    expect(t).toContain(head(def))
    expect(t).toContain(runHalfRefusedSentence('pane:killed'))
    c.binder.teardown()
  })

  it('⛔ CONTROL: a document with NO run half keeps its note (nothing here can say the run drew it)', () => {
    const def = install(door(SRC, { routeHostPartial: false }).definition)
    expect(carriesRunHalf(def)).toBe(false)
    const c = chart(def)
    c.sync()
    expect(objectRenderDropsFor(c.id) && objectRenderDropsFor(c.id).servedByRun).not.toBe(true)
    expect(c.text()).toMatch(/drawing/i)
    c.binder.teardown()
  })
})

describe('⭐⭐ RS Rating\'s own document, on the entries the binder publishes', () => {
  const rsDoc = () => {
    const built = memberPaneDefinition({ source: RS, id: 'u_member-pane-rhdrs', name: 'RS Rating' })
    expect(built.ok, built.reason).toBe(true)
    expect(built.definition.compute.runtimeObjects, 'RS Rating carries a run half').toBeTruthy()
    return install(built.definition)
  }
  const settingsFor = (def) => addInstance(mergeChartSettings({}), def.id, registry)
  const idOf = (cs, def) => cs.indicatorInstances.find((i) => i.defId === def.id).instanceId
  const notes = (cs, entry) => attachedDisclosures(cs, registry, null, () => entry)
    .filter((n) => n.name === DRAWING_NOTE_NAME).map((n) => n.note).join(' ')

  it('its document carries the host lane\'s note (the sentence production showed)', () => {
    const def = rsDoc()
    expect((def.meta.disclosures || []).some((n) => n.name === DRAWING_NOTE_NAME && HOST_NOTE.test(n.note))).toBe(true)
  })
  it('served by the run: the note is left out', () => {
    const def = rsDoc()
    const cs = settingsFor(def)
    expect(idOf(cs, def)).toBeTruthy()
    expect(notes(cs, { dropped: 0, held: 0, servedByRun: true })).toBe('')
  })
  it('refused (not graded): the note stands, with the refusal sentence', () => {
    const def = rsDoc()
    const cs = settingsFor(def)
    const t = notes(cs, { dropped: 0, held: 0, why: { [RUN_HALF_WHY_KEY]: runHalfRefusedSentence('pane:not-graded') } })
    expect(t).toMatch(HOST_NOTE)
    expect(t).toContain(runHalfRefusedSentence('pane:not-graded'))
  })
  it('served, but the run itself could not place a drawing: THAT is still said, in a note of its own', () => {
    const def = rsDoc()
    const cs = settingsFor(def)
    const t = notes(cs, { dropped: 1, held: 3, servedByRun: true })
    expect(t).not.toMatch(HOST_NOTE)
    expect(t).toMatch(/1 of the 3 drawings/)
  })
})

describe('⛔ the store keeps servedByRun exactly as last published (never a stale serve)', () => {
  it('served, then the same counts without it: the flag is gone', async () => {
    const { setObjectRenderDrops } = await import('../../engine/objectRenderNotice')
    setObjectRenderDrops('i_store', 1, 2, '', { servedByRun: true })
    expect(objectRenderDropsFor('i_store')).toMatchObject({ servedByRun: true })
    setObjectRenderDrops('i_store', 1, 2, '', {})
    expect(objectRenderDropsFor('i_store').servedByRun).toBeUndefined()
    setObjectRenderDrops('i_store', 0, 0, '', { servedByRun: true })
    expect(objectRenderDropsFor('i_store'), 'a clean serve is still recorded').toMatchObject({ servedByRun: true, dropped: 0 })
    setObjectRenderDrops('i_store', 0, 0, '', {})
    expect(objectRenderDropsFor('i_store')).toBeNull()
  })
})
