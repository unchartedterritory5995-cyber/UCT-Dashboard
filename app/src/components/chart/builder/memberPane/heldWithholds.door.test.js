// @vitest-environment node
// app/src/components/chart/builder/memberPane/heldWithholds.door.test.js
//
// ─── ⭐⭐ THE MEMBER DOOR HONOURS THE NARROW WITHHOLDS, AND THE REGRADE SEES THROUGH THEM (coordinator rulings 2026-11-19)
//
// `engine/heldWithholds.json` (derived from licence-held captures' ledger rows) names the narrowest element a comparison
// found wrong: a row by title, a row's colour, a paint, a drawing family, each for the door that drew it. Two rails:
//   · AS A MEMBER (the list applied): the door withholds exactly that element, names it, and keeps every other one;
//   · AS THE REGRADE (the list ignored, `src/test-setup.js`, as the known-divergence list is): the document is the one
//     the engine draws, so a re-grade sees the underlying picture and can lift the withhold when it matches.
// Mutation-proved: `ci/mutants/held-withholds-door.json`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { sha256Hex } from '../../engine/ast/parse.js'
import {
  __setHeldWithholdsForTests, __ignoreHeldWithholdsForTests, HELD_DIVERGENCE_GUARD,
} from '../../engine/heldWithholds'
import { memberPaneDefinition } from './memberPaneDefinition'

const REPO = path.resolve(process.cwd(), '..')
const corpus = (slug) => {
  const f = fs.readdirSync(path.join(REPO, 'corpus', 'committed')).find((x) => x.startsWith(`${slug}__`))
  return fs.readFileSync(path.join(REPO, 'corpus', 'committed', f), 'utf8')
}
// runtime-lane documents (the round-trip fixture's own scripts): one with paints and its own drawings, and the first
// of them whose drawn rows carry a title (a row is withheld BY TITLE)
const RUNTIME = corpus('inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat')
const RUNTIME_ONLY = ['adx-and-di-for-v4', 'delta-rsi-oscillator-strategy', 'fibonacci-dolphintradebot',
  'trend-targets-algoalpha', 'wyckoff-accumulation-distribution']
const titledRows = (d) => (d.ok ? d.rows.filter((r) => !r.hidden && r.label) : [])
let TITLED = null
const titled = () => {
  if (TITLED) return TITLED
  for (const slug of RUNTIME_ONLY) {
    const source = corpus(slug)
    const d = memberPaneDefinition({ source, id: 'u_held_door', name: 'held' })
    if (d.ok && d.lane === 'runtime' && titledRows(d).length > 1) { TITLED = source; return source }
  }
  throw new Error('no runtime-only corpus script draws two titled rows')
}
// a host-lane document with plots and labels
const HOST = '//@version=5\nindicator("held host", overlay = true)\nm = ta.sma(close, 10)\nplot(m, "Mean")\n'
  + 'if barstate.islast\n    label.new(bar_index, high, "top")\n'

const asMember = (source, withholds) => __setHeldWithholdsForTests({ scripts: [{ sha256: sha256Hex(source), withholds }] })
const mint = (source) => memberPaneDefinition({ source, id: 'u_held_door', name: 'held' })
const notesOf = (d) => (d.notes || []).map((n) => `${n.name} :: ${n.note}`)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
})
afterEach(() => { __ignoreHeldWithholdsForTests(); vi.unstubAllEnvs() })

describe('the runtime door, as a member: each withhold removes exactly its element, by name', () => {
  it('non-vacuity: the runtime document draws rows, paints and its own drawings', () => {
    const d = mint(RUNTIME)
    expect(d.ok && d.lane).toBe('runtime')
    expect(d.rows.filter((r) => !r.hidden).length).toBeGreaterThan(1)
    expect((d.definition.paints || []).length).toBeGreaterThan(0)
    expect(d.definition.compute.objects === true || !!d.definition.objects).toBe(true)
  })

  it('a row by title is withheld and named; every other row stays', () => {
    const src = titled()
    const base = mint(src)
    const shown = titledRows(base)
    const victim = shown[0].label
    asMember(src, [{ door: 'runtime', scope: 'output', title: victim, evidence: ['cap-a'] }])
    const d = mint(src)
    expect(d.rows.map((r) => r.label)).not.toContain(victim)
    for (const r of shown.slice(1)) expect(d.rows.map((x) => x.label)).toContain(r.label)
    expect(notesOf(d).some((n) => n.startsWith(`${victim} :: \`${victim}\` is not drawn: it differs from TradingView`))).toBe(true)
  })

  it('a row\'s COLOUR is withheld: the row is drawn, in the neutral ink, its colour named', () => {
    const src = titled()
    const row = titledRows(mint(src))[0]
    asMember(src, [{ door: 'runtime', scope: 'outputColour', title: row.label, evidence: ['cap-a', 'cap-b'] }])
    const d = mint(src)
    const drawn = d.definition.plots.find((p) => p.label === row.label)
    expect(drawn && drawn.colorWithheld && drawn.colorWithheld.code).toBe(HELD_DIVERGENCE_GUARD)
    expect(drawn.colorMode).toBeUndefined()
    expect(notesOf(d).some((n) => n.includes('colour not reproduced: its colour differs from TradingView') && n.includes('2 captured charts'))).toBe(true)
  })

  it('a paint by kind and line is withheld and named; the other paints stay', () => {
    const base = mint(RUNTIME)
    const [p0, ...rest] = base.definition.paints
    asMember(RUNTIME, [{ door: 'runtime', scope: 'paint', kind: p0.kind, line: p0.line, evidence: ['cap-a'] }])
    const d = mint(RUNTIME)
    expect((d.definition.paints || []).map((p) => `${p.kind}@${p.line}`)).toEqual(rest.map((p) => `${p.kind}@${p.line}`))
    expect(notesOf(d).some((n) => n.startsWith(`\`${p0.kind}\` (line ${p0.line}) :: `) && n.includes('differs from TradingView'))).toBe(true)
  })

  it('a drawing family is withheld: no drawings, the family named; rows and paints stay', () => {
    const base = mint(RUNTIME)
    asMember(RUNTIME, [{ door: 'runtime', scope: 'objectFamily', family: 'line', evidence: ['cap-a'] }])
    const d = mint(RUNTIME)
    expect(d.definition.compute.objects).toBeUndefined()
    expect(d.definition.objects || null).toBeNull()
    expect(notesOf(d).some((n) => n.startsWith('Drawings :: Its lines are not drawn: they differ from TradingView'))).toBe(true)
    expect(d.rows.filter((r) => !r.hidden).length).toBe(base.rows.filter((r) => !r.hidden).length)
    expect((d.definition.paints || []).length).toBe(base.definition.paints.length)
  })

  it('the document stamps the withholds it honours (the server half tells a saved copy minted before them apart)', () => {
    const base = mint(RUNTIME)
    expect(base.definition.meta.heldWithholds).toBeUndefined()
    const [p0] = base.definition.paints
    asMember(RUNTIME, [{ door: 'runtime', scope: 'paint', kind: p0.kind, line: p0.line, evidence: ['cap-a'] },
      { door: 'runtime', scope: 'objectFamily', family: 'line', evidence: ['cap-a'] }])
    expect(mint(RUNTIME).definition.meta.heldWithholds).toEqual([`runtime:objectFamily:line`, `runtime:paint:${p0.kind}@${p0.line}`])
  })

  it('a withhold for the OTHER door changes nothing here', () => {
    const base = mint(RUNTIME)
    asMember(RUNTIME, [{ door: 'host', scope: 'objectFamily', family: 'line', evidence: ['cap-a'] }])
    expect(mint(RUNTIME).definition).toEqual(base.definition)
  })
})

describe('the host door, as a member', () => {
  it('a drawing family is withheld, named, and the plots stay', () => {
    const base = mint(HOST)
    expect(base.ok && !!base.definition.objects).toBe(true)              // non-vacuity: the host draws the label
    asMember(HOST, [{ door: 'host', scope: 'objectFamily', family: 'label', evidence: ['cap-a'] }])
    const d = mint(HOST)
    expect(d.ok).toBe(true)
    expect(d.definition.objects || null).toBeNull()
    expect(notesOf(d).some((n) => n.startsWith('Drawings :: Its labels are not drawn: they differ from TradingView'))).toBe(true)
    expect(d.rows.map((r) => r.label)).toEqual(base.rows.map((r) => r.label))
  })

  it('a withhold the host door cannot yet hold back alone refuses the script by name (never the wrong element drawn)', () => {
    asMember(HOST, [{ door: 'host', scope: 'output', title: 'Mean', evidence: ['cap-a'] }])
    const d = mint(HOST)
    expect(d.ok).toBe(false)
    expect(d.guard).toBe(HELD_DIVERGENCE_GUARD)
    expect(d.reason).toMatch(/`Mean` it differs from TradingView/)
  })
})

describe('the REGRADE sees through the list (the measuring suites ignore it by name)', () => {
  it('ignored, every withhold above leaves the document exactly as the engine draws it', () => {
    const src = titled()
    const base = mint(src)
    asMember(src, [{ door: 'runtime', scope: 'output', title: titledRows(base)[0].label, evidence: ['c'] }])
    expect(mint(src).definition).not.toEqual(base.definition)            // CONTROL: applied, it changes the document
    __ignoreHeldWithholdsForTests()
    expect(mint(src).definition).toEqual(base.definition)
  })
})
