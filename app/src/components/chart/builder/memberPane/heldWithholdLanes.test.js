// @vitest-environment node
// app/src/components/chart/builder/memberPane/heldWithholdLanes.test.js
//
// ─── ⭐⭐ A HELD WITHHOLD NEVER PUSHES A SCRIPT ONTO A DOCUMENT THAT DRAWS THE HELD ELEMENT (e89) ─────────────────────
//
// THE CLASS RAIL (the e88 train's 101-case synthetic sweep, committed): over every committed corpus script the member
// door draws on the RUNTIME lane with the list ignored, ONE synthetic held withhold at a time is applied AS A MEMBER, for
// each scope the document can carry (the first titled row, that row's colour, the first paint with a line, the first
// declared drawing family the document draws). Every case must end in exactly one of two outcomes:
//   · it STAYS on the runtime lane with the element withheld (not drawn, named once, the family ledger whole); or
//   · it is REFUSED BY NAME, `pine:held-divergence`, the sentence naming the element.
// NEVER a document that draws the held element: ⚰️ on the e88 train 22 of the 101 left the runtime lane, 10 SERVED ON
// THE HOST LANE drawing the very element held (a cost-routed script: `routeByCost` compared the host document with the
// NARROWED run, the surfaces differed by the held element, and the host document was kept; a row held until nothing was
// drawn: `runtime:withheld-all`), and 12 refused by the host's own unrelated reason (`pine:no-output`, `pine:tuple`, ...)
// instead of the held one (the run's own drawing build dropped for the held family, the value build failing).
// Read off the document and the notes the member gets; the controls prove each "drawn" check sees its element on the
// document minted with the list ignored. Mutation-proved: `ci/mutants/held-withhold-lanes.json`.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { sha256Hex } from '../../engine/ast/parse.js'
import { DRAWING_NOTE_NAME } from '../../engine/ast/objectLoss'
import { OHLC_DEF_STYLES } from '../../engine/defSchema'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'
import { __admitEveryRunHalfForTests } from '../../engine/runHalfRailSeam'
import { STRATEGY_WINDOW_HISTORY } from '../../engine/runtime/strategyRecord'
import {
  __setHeldWithholdsForTests, __ignoreHeldWithholdsForTests, HELD_DIVERGENCE_GUARD, objectFamiliesOf, heldWithholdKey,
} from '../../engine/heldWithholds'
import { OBJECT_DRAWING_FAMILIES, declaredFamiliesOf } from './runtimeFamilyLedger'
import { memberPaneDefinition, familyWord } from './memberPaneDefinition'

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const candleKindOf = (style) => (style === OHLC_DEF_STYLES[0] ? 'plotcandle' : style === OHLC_DEF_STYLES[1] ? 'plotbar' : null)

// ── what a document draws, read off the document ─────────────────────────────────────────────────────────────────
function drawnOf(d) {
  const def = d.definition
  const outs = (d.translation && d.translation.outputs) || []
  const shown = new Set((def.plots || []).filter((pl) => pl && !pl.hidden).map((pl) => pl.key))
  const fams = new Set()
  for (const r of d.rows || []) {
    if (!r || r.hidden || !shown.has(r.key)) continue
    const k = candleKindOf(r.style)
    if (k) { fams.add(k); continue }
    if (Number.isInteger(r.output) && outs[r.output]) fams.add(outs[r.output].kind)
  }
  for (const p of def.paints || []) fams.add(p.kind)
  return { fams, objects: !!def.objects || !!(def.compute && (def.compute.objects === true || def.compute.runtimeObjects)) }
}
/** Does this served document DRAW the element `w` holds? (Read off the document: its plots, paints and drawings.) */
function drawsHeld(d, w) {
  const def = d.definition
  const plots = (def.plots || []).filter((p) => p && !p.hidden && !p.fill)
  if (w.scope === 'output') return plots.some((p) => p.label === w.title)
  if (w.scope === 'outputColour') {
    return plots.some((p) => p.label === w.title && !(p.colorWithheld && p.colorWithheld.code === HELD_DIVERGENCE_GUARD))
  }
  if (w.scope === 'paint') return (def.paints || []).some((p) => p.kind === w.kind && p.line === w.line)
  // a drawing family (declared by the source, by construction): ANY drawing the document makes counts, the host
  // program's or the run's own. Conservative on purpose: a register's family is not always the call's (a `line.new`
  // pushed into an array), and the runtime door holds every drawing back with a held family anyway.
  return !!(def.compute && (def.compute.objects === true || def.compute.runtimeObjects))
    || (!!def.objects && (objectFamiliesOf(def.objects).length > 0 || ((def.objects.ops || []).length > 0)))
}
function namedIn(d, f) {
  const notes = d.notes || []
  if (notes.some((n) => String(n.note).includes(familyWord(f)))) return true
  if (OBJECT_DRAWING_FAMILIES.includes(f)) return notes.some((n) => n.name === DRAWING_NOTE_NAME)
  if (notes.some((n) => String(n.name).startsWith(`\`${f}\``))) return true
  const outs = (d.translation && d.translation.outputs) || []
  const titles = new Set(outs.filter((o) => o && o.kind === f && o.title).map((o) => o.title))
  if (f === 'plotcandle' || f === 'plotbar') {
    const others = new Set(outs.filter((o) => o && o.kind !== f && o.title).map((o) => o.title))
    for (const l of d.withheld || []) if (!others.has(l)) titles.add(l)
  }
  return notes.some((n) => (titles.has(n.name) || new RegExp(`^${f} \\d+$`).test(n.name)) && / is not drawn: /.test(n.note))
}
const classGaps = (d, source) => {
  const { fams, objects } = drawnOf(d)
  const hidden = new Set((d.familyLedger && d.familyLedger.hidden) || [])
  return declaredFamiliesOf(source).filter((f) => !fams.has(f) && !hidden.has(f)
    && !(objects && OBJECT_DRAWING_FAMILIES.includes(f)) && !namedIn(d, f))
}
const notDrawnNote = (d) => ((d.notes || []).find((n) => n.name === 'Not drawn by this pane') || {}).note || ''
const heldNamed = (d, w) => {
  const notes = (d.notes || []).map((n) => `${n.name} :: ${n.note}`)
  if (w.scope === 'output') return notes.some((n) => n.startsWith(`${w.title} :: \`${w.title}\` is not drawn: it differs from TradingView`))
  if (w.scope === 'outputColour') {
    const p = (d.definition.plots || []).find((x) => x.label === w.title)
    return !!(p && p.colorWithheld && p.colorWithheld.code === HELD_DIVERGENCE_GUARD) && notes.some((n) => n.includes('colour not reproduced'))
  }
  if (w.scope === 'paint') return notes.some((n) => n.startsWith(`\`${w.kind}\` (line ${w.line}) :: `) && n.includes('differs from TradingView'))
  return notes.some((n) => n.startsWith('Drawings :: Its ') && n.includes('differ from TradingView'))
}
const FAMILY_PLURAL = { line: 'lines', label: 'labels', box: 'boxes', table: 'tables', linefill: 'fills between lines', polyline: 'polylines' }
/** The refusal names the held element and why (the member's sentence, `heldWithholds.js::heldRefusalReason`). */
const refusalNames = (d, w) => {
  const r = String(d.reason || '')
  if (!/differs? from TradingView’s on (one captured chart|\d+ captured charts)/.test(r)) return false
  if (w.scope === 'output' || w.scope === 'outputColour') return r.includes(`\`${w.title}\``)
  if (w.scope === 'paint') return r.includes(`\`${w.kind}\``) && r.includes(`line ${w.line}`)
  return r.includes(FAMILY_PLURAL[w.family] || w.family)
}

const mint = (source) => memberPaneDefinition({ source, id: 'u_e89_lanes', name: 'lanes' })
const asMember = (source, w) => __setHeldWithholdsForTests({ scripts: [{ sha256: sha256Hex(source), withholds: [w] }] })

/** The cases: every committed corpus script whose document is on the runtime lane with the list ignored, each scope. */
function sweep() {
  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  const out = { files: files.length, docs: 0, tally: { output: 0, outputColour: 0, paint: 0, objectFamily: 0 },
    stayed: [], refused: [], bad: [], controlsBlind: [] }
  for (const f of files) {
    const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
    __ignoreHeldWithholdsForTests()
    const base = mint(source)
    if (!base.ok || base.lane !== 'runtime') continue
    out.docs += 1
    const baseUnnamed = new Set((base.familyLedger && base.familyLedger.unnamed) || [])
    const titled = (base.rows || []).filter((r) => !r.hidden && r.label)
    const ws = []
    if (titled.length) {
      ws.push({ door: 'runtime', scope: 'output', title: titled[0].label, evidence: ['cap-sweep'] })
      ws.push({ door: 'runtime', scope: 'outputColour', title: titled[0].label, evidence: ['cap-sweep'] })
    }
    const p0 = (base.definition.paints || []).find((p) => Number.isInteger(p.line))
    if (p0) ws.push({ door: 'runtime', scope: 'paint', kind: p0.kind, line: p0.line, evidence: ['cap-sweep'] })
    const objFam = declaredFamiliesOf(source).find((x) => OBJECT_DRAWING_FAMILIES.includes(x))
    if (objFam && drawnOf(base).objects) ws.push({ door: 'runtime', scope: 'objectFamily', family: objFam, evidence: ['cap-sweep'] })
    for (const w of ws) {
      const tag = `${f} ${w.scope}:${w.title || w.family || `${w.kind}@${w.line}`}`
      // CONTROL: the "drawn" check SEES the element on the document minted with the list ignored
      if (!drawsHeld(base, w)) out.controlsBlind.push(tag)
      asMember(source, w)
      const d = mint(source)
      __ignoreHeldWithholdsForTests()
      out.tally[w.scope] += 1
      if (!d.ok) {
        if (d.guard !== HELD_DIVERGENCE_GUARD) out.bad.push(`${tag}: refused by ${d.guard}, not ${HELD_DIVERGENCE_GUARD}`)
        else if (!refusalNames(d, w)) out.bad.push(`${tag}: refused ${HELD_DIVERGENCE_GUARD} without naming the element (${d.reason})`)
        else out.refused.push(`${tag} :: ${d.reason}`)
        continue
      }
      if (d.lane !== 'runtime') {
        out.bad.push(`${tag}: SERVED on the ${d.lane || 'host'} lane${d.costRoute ? ` (costRoute moved=${d.costRoute.moved} code=${d.costRoute.code})` : ''}`
          + `${drawsHeld(d, w) ? ', DRAWING the held element' : ''}`)
        continue
      }
      const before = out.bad.length
      if (drawsHeld(d, w)) out.bad.push(`${tag}: the runtime document DRAWS the held element`)
      if (!heldNamed(d, w)) out.bad.push(`${tag}: the held element is not named`)
      if (!((d.definition.meta && d.definition.meta.heldWithholds) || []).includes(heldWithholdKey(w))) out.bad.push(`${tag}: not stamped`)
      const gaps = classGaps(d, source)
      if (gaps.length) out.bad.push(`${tag}: class gaps ${gaps}`)
      const newUnnamed = ((d.familyLedger && d.familyLedger.unnamed) || []).filter((x) => !baseUnnamed.has(x))
      if (newUnnamed.length) out.bad.push(`${tag}: the ledger names a NEW family ${newUnnamed}`)
      if (w.scope === 'objectFamily' && notDrawnNote(d).includes(familyWord(w.family))) out.bad.push(`${tag}: named twice (Drawings + Not drawn)`)
      if (out.bad.length === before) out.stayed.push(tag)
    }
  }
  return out
}

describe('e89: a held withhold never pushes a script onto a document that draws the held element', () => {
  let S = null
  beforeAll(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); __admitEveryRunHalfForTests()
    S = sweep()
    console.log('E89LANES', JSON.stringify({ files: S.files, docs: S.docs, ...S.tally, stayed: S.stayed.length,
      refused: S.refused.length, bad: S.bad.length, controlsBlind: S.controlsBlind.length }))
    for (const r of S.refused) console.log('E89LANES REFUSED', r)
    for (const c of S.controlsBlind) console.log('E89LANES BLIND', c)
    for (const b of S.bad) console.log('E89LANES BAD', b)
  }, 900000)
  afterEach(() => { __ignoreHeldWithholdsForTests() })
  afterAll(() => { __ignoreHeldWithholdsForTests(); vi.unstubAllEnvs() })

  it('non-vacuity: the corpus is there, the runtime lane draws it, and every scope is swept', () => {
    expect(S.files).toBeGreaterThan(200)
    expect(S.docs).toBeGreaterThan(30)
    for (const k of ['output', 'outputColour', 'paint', 'objectFamily']) expect(S.tally[k], k).toBeGreaterThan(10)
  })
  it('controls: each "drawn" check sees its element on every document minted with the list ignored', () => {
    expect(S.controlsBlind).toEqual([])
  })
  it('every case stays on the runtime lane with the element withheld, or is refused by name as pine:held-divergence', () => {
    expect(S.bad).toEqual([])
    const total = Object.values(S.tally).reduce((a, b) => a + b, 0)
    expect(S.stayed.length + S.refused.length).toBe(total)
  })
  it('the two outcomes are both reached (a rail where one never happens cannot tell them apart)', () => {
    expect(S.stayed.length).toBeGreaterThan(50)
    expect(S.refused.length).toBeGreaterThan(0)
  })
})

describe('e89: the W9 armed route (broker on) — a held row never hands the member the host document that draws it', () => {
  // a strategy that places orders and plots one row (`w9ArmedRoute.test.js`'s PLOTS): the broker document draws it
  const PLOTS = ['//@version=5', 'strategy("t", overlay = true)', 'if bar_index == 3', '    strategy.entry("L", strategy.long, qty = 1)',
    'if bar_index == 8', '    strategy.close("L")', 'plot(ta.sma(close, 3), "sma")', ''].join('\n')
  const W = { door: 'runtime', scope: 'output', title: 'sma', evidence: ['cap-armed'] }
  const isBrokerDoc = (d) => !!(d.ok && d.definition.compute.kind === 'runtime' && d.definition.meta.runtimeHistory === STRATEGY_WINDOW_HISTORY)
  beforeEach(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests()
  })
  afterEach(() => { __ignoreHeldWithholdsForTests(); vi.unstubAllEnvs() })

  it('control: without the list the member gets the broker document, and it draws the row', () => {
    __ignoreHeldWithholdsForTests()
    const d = mint(PLOTS)
    expect(isBrokerDoc(d), d.reason).toBe(true)
    expect(drawsHeld(d, W)).toBe(true)
  })
  it('with the row held it is still the broker document: the row withheld, named and stamped', () => {
    asMember(PLOTS, W)
    const d = mint(PLOTS)
    expect(isBrokerDoc(d), d.reason).toBe(true)
    expect(drawsHeld(d, W)).toBe(false)
    expect(heldNamed(d, W)).toBe(true)
    expect(d.definition.meta.heldWithholds).toEqual([heldWithholdKey(W)])
  })
  it('where the member keeps the HOST document without the list, the list changes nothing (its note included)', () => {
    // a second row drawn forward (`offset = 3`): the broker document would take it away, so the host document stands
    const TAKES = PLOTS.replace('plot(ta.sma(close, 3), "sma")', 'plot(ta.sma(close, 3), "sma")\nplot(ta.sma(close, 5), "late", offset = 3)')
    __ignoreHeldWithholdsForTests()
    const without = mint(TAKES)
    expect(without.ok, without.reason).toBe(true)
    expect(isBrokerDoc(without)).toBe(false)
    expect((without.notes || []).map((n) => n.note).join(' ')).toMatch(/would leave .*late.* undrawn/)
    asMember(TAKES, W)
    expect(JSON.stringify(mint(TAKES))).toBe(JSON.stringify(without))
  })
})
