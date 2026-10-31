// app/src/components/chart/engine/__tests__/objectRenderDrops.test.jsx
//
// ─── ⭐⭐ P2b — A DRAWING THE PROGRAM HOLDS AND THE CHART CANNOT PLACE IS SAID ────
//
// Two halves, each with its control:
//
//   1. THE BAR CLOCK PLACES AN INSTANT ON THE BAR WHOSE SPAN HOLDS IT
//      (`objectRenderState.js::makeBarClock`, `timeAtInstant`): [open, next open),
//      the last bar's span one measured step — on intraday, daily, weekly and monthly
//      series. Outside the loaded bars the old rules stand (an instant-keyed series
//      passes the instant through; a date-keyed one places only a session open; a
//      weekly / monthly one places nothing).
//   2. EVERY RENDER-STAGE DROP REACHES THE MEMBER'S DRAWING NOTE. The binder
//      publishes what the render state dropped (`objectRenderNotice.js`) and the
//      disclosure strip folds it into the document's drawing note, or writes one of
//      its own (`objectLoss.js::withRenderDrops`). ⛔ A translation that reads clean
//      can no longer be drawn as less than it holds with nothing said.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { toRenderState, makeBarClock } from '../objectRenderState'
import { barOpenInstant } from '../../indicators.js'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from './fakeChart'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import {
  setObjectRenderDrops, objectRenderDropsFor, resetObjectRenderDrops, renderDroppedCount, renderHeldCount,
} from '../objectRenderNotice'
import { withRenderDrops, DRAWING_NOTE_NAME } from '../ast/objectLoss'
import AttachedPineDisclosures, { attachedDisclosures } from '../../pane/AttachedPineDisclosures'

const REPO = path.resolve(process.cwd(), '..')
const load = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', name), 'utf8'))
const RDDT = load('poor-man039s-volume-profile-rddt-1d-2026-09-28.json')
const label = (x, id = 1) => ({ id, family: 'label', props: { x, y: 10, xloc: 'bar_time', text: 't' } })

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })
beforeEach(() => { resetObjectRenderDrops() })
afterEach(() => { cleanup(); registry.uninstallUserDefinition(HARNESS_DEF_ID); resetObjectRenderDrops() })

// ─── 1. the bar clock ────────────────────────────────────────────────────────

describe('⭐ 1. an instant inside a loaded bar\'s span is that bar', () => {
  it('intraday (seconds-keyed): mid-bar ⇒ the bar; past the last bar\'s span ⇒ passed through', () => {
    const T0 = 1785249000 // 2026-07-28 09:30 New York
    const M5 = Array.from({ length: 12 }, (_, i) => ({ t: T0 + i * 300 }))
    const c = makeBarClock(M5, '5')
    expect(c.timeAtInstant(M5[4].t)).toBe(M5[4].t)
    expect(c.timeAtInstant(M5[4].t + 299)).toBe(M5[4].t)
    expect(c.timeAtInstant(M5[4].t + 300)).toBe(M5[5].t)
    expect(c.timeAtInstant(M5[11].t + 150)).toBe(M5[11].t)        // inside the last bar's step
    expect(c.timeAtInstant(M5[11].t + 600)).toBe(M5[11].t + 600)  // ⛔ CONTROL: a projection is untouched
    expect(c.timeAtInstant(T0 - 60)).toBe(T0 - 60)                // ⛔ before the first bar: untouched
  })

  it('daily (date-keyed): 16:00 and a weekend instant land on their session; outside, the old rules', () => {
    const bars = toProductBars(RDDT)
    const n = bars.length
    const c = makeBarClock(bars, 'D')
    const open = (i) => barOpenInstant(bars[i].t, 'D')
    expect(c.timeAtInstant(open(n - 1) + 6.5 * 3600)).toBe(bars[n - 1].t)   // the last close
    expect(c.timeAtInstant(open(100) + 3 * 3600)).toBe(bars[100].t)
    // a Friday bar's span runs to Monday's open
    const fri = bars.findIndex((b, i) => i > 0 && i < n - 1 && new Date(`${b.t}T12:00:00Z`).getUTCDay() === 5)
    expect(fri).toBeGreaterThan(0)
    expect(c.timeAtInstant(open(fri) + 36 * 3600)).toBe(bars[fri].t)       // Saturday 21:30
    // ⛔ outside the loaded bars: a future session open still places, a future noon does not
    expect(c.timeAtInstant(open(n - 1) + 86400 * 3 + 7200)).toBe(null)
    expect(c.timeAtInstant(open(0) - 3600)).toBe(null)
  })

  it('weekly and monthly (date-keyed): inside a loaded period ⇒ that bar; a future period still nothing', () => {
    const W = ['2026-08-07', '2026-08-14', '2026-08-21'].map((t) => ({ t }))
    const cw = makeBarClock(W, 'W')
    const wopen = barOpenInstant('2026-08-14', 'W')
    expect(cw.timeAtInstant(wopen + 3 * 86400)).toBe('2026-08-14')
    expect(cw.timeAtInstant(barOpenInstant('2026-08-21', 'W') + 86400)).toBe('2026-08-21') // the last week's step
    expect(cw.timeAtInstant(barOpenInstant('2026-08-28', 'W') + 8 * 86400)).toBe(null)
    const M = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03'].map((t) => ({ t }))
    const cm = makeBarClock(M, 'M')
    const mopen = barOpenInstant('2026-06-01', 'M')
    expect(cm.timeAtInstant(mopen + 10 * 86400)).toBe('2026-06-01')
  })
})

// ─── 2. the drawing note ─────────────────────────────────────────────────────

describe('⭐⭐ 2. every render-stage drop counts into the member\'s drawing note', () => {
  it('the render state counts what it drops, and what it was handed', () => {
    const bars = toProductBars(RDDT)
    const future = (barOpenInstant(bars[bars.length - 1].t, 'D') + 86400 * 3 + 7200) * 1000
    const rs = toRenderState([label(future, 1), label(barOpenInstant(bars[5].t, 'D') * 1000, 2)], { bars, tf: 'D' })
    expect(renderDroppedCount(rs)).toBe(1)
    expect(renderHeldCount(rs)).toBe(2)
  })

  it('⛔ an `na` coordinate is the SCRIPT\'s (TradingView draws nothing there either): dropped, never disclosed', () => {
    const bars = toProductBars(RDDT)
    const rs = toRenderState([
      { id: 1, family: 'box', props: { left: 3, right: 9, top: NaN, bottom: 1, xloc: 'bar_index' } },
      { id: 2, family: 'line', props: { x1: NaN, y1: 1, x2: 5, y2: 2, xloc: 'bar_index' } },
      { id: 3, family: 'label', props: { x: 4, y: 2, xloc: 'bar_index', text: null } },   // a withheld text IS ours
    ], { bars, tf: 'D' })
    expect(rs.dropped).toMatchObject({ box: 1, line: 1, label: 1 })
    expect(renderDroppedCount(rs)).toBe(1)
  })

  it('withRenderDrops: a clean document gets a note of its own; a partial one, the count added', () => {
    expect(withRenderDrops(null, null)).toBe(null)
    expect(withRenderDrops(null, { dropped: 0, held: 3 })).toBe(null)
    const own = withRenderDrops(null, { dropped: 2, held: 5 })
    expect(own.name).toBe(DRAWING_NOTE_NAME)
    expect(own.note).toMatch(/^2 of the 5 drawings this script holds on this chart could not be placed/)
    const doc = { name: DRAWING_NOTE_NAME, note: '3 of 9 drawing elements in this script aren\'t supported yet.' }
    const merged = withRenderDrops(doc, { dropped: 1, held: 6 })
    expect(merged.note.startsWith(doc.note)).toBe(true)
    expect(merged.note).toMatch(/On this chart, 1 of the 6 drawings/)
  })

  it('the strip folds an instance\'s drops into its note, and only that instance\'s', () => {
    const defs = {
      a: { meta: { disclosures: [{ name: DRAWING_NOTE_NAME, note: 'A partial.' }] } },
      b: { meta: { disclosures: [] } },
    }
    const reg = { getDefinition: (id) => defs[id] }
    const settings = { indicatorInstances: [{ instanceId: 'ia', defId: 'a' }, { instanceId: 'ib', defId: 'b' }] }
    const dropsFor = (id) => ({ ia: { dropped: 1, held: 4 }, ib: { dropped: 3, held: 3 } }[id] || null)
    const rows = attachedDisclosures(settings, reg, null, dropsFor)
    expect(rows).toHaveLength(2)
    expect(rows[0].note).toMatch(/^A partial\. On this chart, 1 of the 4 drawings/)
    expect(rows[1].note).toMatch(/^3 of the 3 drawings this script holds on this chart could not be placed/)
    // ⛔ CONTROL: no drops ⇒ the document's own rows, untouched
    expect(attachedDisclosures(settings, reg, null, () => null)).toEqual([{ name: DRAWING_NOTE_NAME, note: 'A partial.' }])
  })
})

describe('⭐⭐ 2b. the binder publishes them, and the member reads them', () => {
  const SRC = (x) => ['//@version=6', 'indicator("p2b", overlay=true)',
    'if barstate.islast',
    '    label.new(bar_index, high, "placed")',
    `    label.new(${x}, low, "where", xloc = xloc.bar_time)`].join('\n')
  /** The real binder over the recording chart, on RDDT's daily bars. */
  function mount(source) {
    const door = enterMemberDoor(source)
    if (!door.def) throw new Error(door.refusal)
    const def = door.def
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
    const sync = (over = {}) => binder.sync({
      enabled: true, cs, instances, registry,
      bars: toProductBars(RDDT), tf: 'D',
      symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: () => {}, clear: () => {} }),
      ...over,
    })
    return { binder, cs, instances, sync, id: instances[0].instanceId }
  }

  it('a label at a future noon (no bar can hold it) is counted and said; the placed one is not', () => {
    const m = mount(SRC('time + 3 * 86400000 + 9000000'))
    m.sync()
    expect(m.binder && objectRenderDropsFor(m.id)).toEqual({ dropped: 1, held: 2 })
    render(<AttachedPineDisclosures settings={m.cs} registry={registry} />)
    const text = screen.getByTestId('pine-attached-disclosures').textContent
    expect(text).toMatch(/1 of the 2 drawings this script holds on this chart could not be placed/)
    // ⛔ the indicator leaves the chart ⇒ its sentence goes with it
    act(() => { m.sync({ instances: [] }) })
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })

  it('⛔ CONTROL — `time_close` on the last bar is placed now, so nothing is counted', () => {
    const m = mount(SRC('time_close'))
    m.sync()
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })

  it('the store ignores a zero and clears on one', () => {
    setObjectRenderDrops('x', 0, 4)
    expect(objectRenderDropsFor('x')).toBe(null)
    setObjectRenderDrops('x', 2, 4)
    expect(objectRenderDropsFor('x')).toEqual({ dropped: 2, held: 4 })
    setObjectRenderDrops('x', 0, 4)
    expect(objectRenderDropsFor('x')).toBe(null)
  })
})
