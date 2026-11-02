// app/src/components/chart/engine/ast/pineW1DrawingHeld.test.js
//
// ─── W1 REVIEW (2026-11-02) — THE RUNNING TOTALS ARE HELD FROM DRAWINGS ───────
//
// `ta.obv`, `ta.pvt` and `ta.wad` (and their v1–v4 bare spellings) are served to a
// PANE as TradingView's published `cum(…)` bodies, and a pane plot of one raises the
// `window_dependent` disclosure (`memberPaneDefinition.js::requirementTagsRaised`).
// A drawing raises nothing — the tags are read off the plot trees — so a table cell
// or a label would print a level that moves with where the chart's history starts,
// unmarked. Both drawing doors refuse them BY NAME (`pine.js::seriesTreeOf`,
// `PINE_DRAWING_HELD_SERIES`):
//   · the host object pass (`translatePine`'s object program; `objectPass`);
//   · the runtime lane's object door (`runtimeColumns.js::probeObjectRuntime`, which
//     builds with `objectDoor`, as `runtimeObjectValues` does).
// The member door end to end is `vendorHarness.h5MulticatorValues.test.js` (OBV in
// multicator-table's cells, RDDT and SPY); this rail holds all three names at each door.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine, Resolver } from './pine'
import { TABLE } from './parse'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { probeObjectRuntime } from '../runtime/runtimeColumns.js'
import { requirementTagsRaised, memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

afterEach(() => { vi.unstubAllEnvs() })

const NL = String.fromCharCode(10)
const WD = 'pine:window-dependent'
const v6 = (...lines) => ['//@version=6', 'indicator("p", overlay = true)', ...lines].join(NL)
const HELD = ['ta.obv', 'ta.pvt', 'ta.wad']
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pane = { strict: true }

/** A script that PLOTS the value (the pane's) and prints it in a label on the last bar. */
const plotAndLabel = (expr) => v6(`plot(${expr})`, 'if barstate.islast',
  `    label.new(bar_index, high, str.tostring(${expr}))`)

/** Every call name in a translation's object program. */
const objectCalls = (t) => {
  const names = new Set()
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 400) return
    if (Array.isArray(n)) { n.forEach((x) => walk(x, depth + 1)); return }
    if (n.type === 'call' && typeof n.name === 'string') names.add(n.name)
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, depth + 1)
  }
  walk((t.objects && t.objects.trees) || [], 0)
  return names
}

describe('⛔ W1 review 1 — ta.obv / ta.pvt / ta.wad are refused BY NAME to a drawing, and served to the pane', () => {
  it.each(HELD)('the Resolver, asked for %s as a drawing value at either door, refuses it by name', (name) => {
    for (const door of [{ objectPass: true }, { objectDoor: true }]) {
      for (const [version, spelled] of [[6, name], [4, name.slice('ta.'.length)]]) {
        const r = new Resolver(new Map(), TABLE, new Map(), { strict: true, pineVersion: version, ...door })
        let err = null
        try { r.resolve({ type: 'name', name: spelled, tok: null }) } catch (e) { err = e }
        expect(err && err.guard, `${spelled} at ${JSON.stringify(door)}`).toBe(WD)
        expect(err.message).toMatch(new RegExp(`\`${esc(spelled)}\` is a running total from the first bar the chart loaded`))
      }
    }
    // the same Resolver at neither door (a pane plot) serves the published running total
    const plot = new Resolver(new Map(), TABLE, new Map(), { strict: true, pineVersion: 6 })
    expect(plot.resolve({ type: 'name', name, tok: null }).name).toBe('cum')
  })

  it.each(HELD)('the host object pass: %s plotted is served; printed in a label it is not', (name) => {
    const t = translatePine(plotAndLabel(name), pane)
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    const formulas = (t.outputs || []).filter((o) => o.formula && !o.refusal).map((o) => o.formula)
    expect(formulas.length).toBe(1)
    expect(formulas[0]).toMatch(/^cum\(/)
    // the label's text met the refusal: nothing in the object program sums from the first
    // bar (here the label is lost whole, so there is no program), and the loss is counted
    expect([...objectCalls(t)]).not.toContain('cum')
    const d = t.objectDiagnostics || {}
    expect((d.unresolvedValues || 0) + (d.droppedProps || 0) + (d.droppedOps || 0), JSON.stringify(d))
      .toBeGreaterThan(0)
  })

  it.each(HELD)('the pane plot of %s carries the disclosure a drawing could not', (name) => {
    expect(requirementTagsRaised(translatePine(v6(`plot(${name})`), pane))).toContain('window_dependent')
  })

  it('CONTROL: the bounded rewrites are not these names and keep drawing (obvN, pvtN)', () => {
    for (const [expr, fn] of [['ta.obv - ta.obv[3]', 'obvN'], ['ta.pvt - ta.pvt[4]', 'pvtN']]) {
      const t = translatePine(plotAndLabel(expr), pane)
      expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
      expect([...objectCalls(t)], expr).toContain(fn)
    }
  })

  it.each(HELD)('the runtime lane\'s object door refuses %s by name; the runtime pane still builds it', (name) => {
    const src = v6(`plot(${name})`)
    // the member door's compile check for drawing values read from the runtime lane
    const door = probeObjectRuntime(src, [])
    expect(door.ok).toBe(false)
    expect(door.refusal.guard).toBe(WD)
    expect(door.refusal.message).toMatch(new RegExp(`\`${esc(name)}\` is a running total`))
    // the same build with no object door (the runtime pane) serves the plot
    const built = buildRuntimeIr(src, {
      bars: [], inputs: {}, objectTrees: [], pane: true, symbolAtBind: true, ...runtimeClockOpts(false),
    })
    expect(built.ok, built.refusal && `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  })
})

// ─── the member door, end to end, on RDDT's bars FROM ITS LISTING ────────────────
//
// From the listing a running total is the one place it could even be right, and the
// runtime lane serves a drawing value only there (`runtimeObjectValues`'s
// `fromListing` gate), so this is the case that would draw if a door let it through.
// Two shapes, one per door: a label printing the level directly (the host object
// pass resolves it), and one printing a value computed over runtime state (the host
// pass hands it to the runtime lane's object door, `rtAdmits`).
const REPO = path.resolve(process.cwd(), '..')
const CAP = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/harness/vw-call-site-history-rddt-1d-2026-10-01.json'), 'utf8'))
const BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const STATE = ['k = 0', 'for i = 0 to 1', '    k += 1']
const label = (expr) => ['if barstate.islast', `    label.new(bar_index, high, str.tostring(${expr}))`]

const doorLabels = (src) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const built = memberPaneDefinition({ source: src, id: 'u_w1-drawing-held', name: 'P' })
  if (!built.ok) return []
  const reader = objectReaderFor(built.definition, BARS, { inputs: undefined, tf: 'D', symbol: SYMBOL,
    newestBarIsForming: false, historyFromListing: true })
  if (!reader || !reader.program) return []
  const run = evaluateObjects(reader.program, { barCount: BARS.length, readNode: reader.readNode,
    readTime: reader.readTime, readUnknown: reader.readUnknown, offListing: reader.historyFromListing !== true })
  const state = toRenderState(run.live, { bars: BARS, tf: 'D', pineVersion: reader.program.pineVersion })
  return (state.labels || []).map((l) => String(l.text == null ? '' : l.text))
}

describe('⛔ W1 review 1 — the member door prints none of the three in a drawing, from the listing', () => {
  it.each(HELD)('%s printed in a label directly (the host object pass): no number is drawn', (name) => {
    const texts = doorLabels(v6('plot(close)', ...label(name)))
    expect(texts.filter((t) => /\d/.test(t)), JSON.stringify(texts)).toEqual([])
  })

  it.each(HELD)('%s over runtime state (the runtime lane\'s object door): no number is drawn', (name) => {
    const texts = doorLabels(v6(...STATE, `v = k * 0 + ${name}`, ...label('v')))
    expect(texts.filter((t) => /\d/.test(t)), JSON.stringify(texts)).toEqual([])
  })

  it('CONTROL: both shapes over a value the door always served ARE drawn through it', () => {
    // the door is open for what it always served, so the two rails above cannot pass by
    // a door that draws nothing at all
    for (const src of [v6('plot(close)', ...label('close')), v6(...STATE, 'v = k * 0 + close', ...label('v'))]) {
      const texts = doorLabels(src)
      expect(texts.filter((t) => /\d/.test(t)).length, `${JSON.stringify(texts)} for ${src}`).toBeGreaterThan(0)
    }
  })
})
