// app/src/components/chart/engine/__truth__/p2x.objects.truth.test.js
//
// ─── ⭐⭐ P2X (owner decision 3) — OBJECT PROGRAMS SURVIVE EDITING, OR THE LOSS IS
//     EXPLICIT ───────────────────────────────────────────────────────────────────
//
// The fixtures are REAL Pine scripts from the c3b live corpus, saved through the
// member-pane door (`memberPaneDefinition`) — the documents a member's Pine pane
// actually stores. The UI half (reopen → edit → Save / the lossy confirmation)
// is `builder/BuilderSheet.objectProgram.test.jsx`; this file pins the pure
// verdict (`objectCarry`), the store round trip, the object lane's output, and
// the conversational path.
//
// Each case: ASKED / CLAIMED / DID, and its class.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { validateDefinition } from '../defSchema'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toGraphDocument } from '../ast/graphDocument'
import {
  objectCarry, objectProgramCensus, objectLossSentence, storedObjectProgram, carriableObjectProgram,
  carryProgramMeta,
} from '../../builder/objectProgramCarry'
import { preservePresentation } from '../../builder/presentationPreserve'
import { openAuthoringState, applyTurn, parameterSlots } from '../../builder/authoring'

const FIX = path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/c3b_live')
const DEF_ID = 'u_0b1ec7000002'
const C = 'uct.authoring.patch/1'
const env = (state, ops) => ({ contract: C, baseRevision: state.revision, ops })

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}
const cache = new Map()
/** The member-pane document, as saved (and as the store hands it back). */
function paneDoc(file) {
  if (!cache.has(file)) {
    const built = memberPaneDefinition({ source: fs.readFileSync(path.join(FIX, file), 'utf8'), id: DEF_ID })
    if (!built.ok) throw new Error(`${file}: ${built.reason}`)
    cache.set(file, JSON.stringify(built.definition))
  }
  return JSON.parse(cache.get(file))
}

const N = 260
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100 + Math.sin(i / 9) * 6, h: 106 + Math.sin(i / 9) * 6,
  l: 94 + Math.sin(i / 9) * 6, c: 100 + Math.sin(i / 7) * 8, v: 1_000_000 + i,
}))
function drawn(def) {
  const reader = objectReaderFor(def, BARS, { tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false })
  if (!reader) return null
  const run = evaluateObjects(reader.program, { barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t })
  return JSON.stringify(run.live)
}

/** A TWO-plot member pane (a graph needs a forest) whose label reads the MA the
 *  plot draws, reduced to the V2 graph form: the program is then BOUND to the
 *  graph's node indexes. */
const GRAPH_SRC = `//@version=5
indicator("P2X graph labels", overlay = true)
ma = ta.sma(close, 20)
if ta.crossover(close, ma)
    label.new(bar_index, ma, "X")
plot(ma, title = "MA20")
plot(close, title = "C")
`
function graphPrior() {
  const built = memberPaneDefinition({ source: GRAPH_SRC, id: DEF_ID })
  if (!built.ok) throw new Error(built.reason)
  const g = toGraphDocument(JSON.parse(JSON.stringify(built.definition)))
  if (!g.ok) throw new Error(g.reason)
  return { v1: built.definition, graph: JSON.parse(JSON.stringify(g.definition)) }
}

const FILES = ['c3b_02_label_text.pine', 'c3b_04_table_dash.pine', 'c3b_09_param_object.pine', 'c3b_03_box_zone.pine']

describe('(1)(2) a definition with an object program saves and reloads unchanged', () => {
  for (const f of FILES) {
    it(`ASKED save ${f} as a member pane · CLAIMED the program is stored and reloads byte-identical · DID — EXACT`, () => {
      const d = paneDoc(f)
      expect(storedObjectProgram(d), 'the fixture draws no objects — vacuous').toBeTruthy()
      expect(validateDefinition(d).ok).toBe(true)
      const reloaded = JSON.parse(JSON.stringify(d))
      expect(JSON.stringify(reloaded.objects)).toBe(JSON.stringify(d.objects))
      const out = drawn(d)
      expect(out && out.length > 2).toBe(true)
      expect(drawn(reloaded)).toBe(out)
    })
  }
})

it('RAIL — the server fixture (`tests/fixtures/p2x/object_pane_docs.json`) is what the member-pane door saves today', () => {
  const dump = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/p2x/object_pane_docs.json'), 'utf8'))
  for (const [file, def] of Object.entries(dump)) {
    const live = memberPaneDefinition({ source: fs.readFileSync(path.join(FIX, file), 'utf8'), id: def.id }).definition
    expect(JSON.stringify(def), `${file}: regenerate the dump`).toBe(JSON.stringify(live))
  }
})

describe('the verdict — `objectCarry(prior, doc)`', () => {
  it('ASKED a representable edit (rename, a plot literal) carrying the stored program · CLAIMED kept · DID — EXACT', () => {
    const prior = deepFreeze(paneDoc('c3b_02_label_text.pine'))
    const doc = { ...prior, meta: { ...prior.meta, name: 'x' }, objects: prior.objects }
    const v = objectCarry(prior, doc)
    expect(v.status).toBe('kept')
    // a re-serialised copy of the same program is the same program
    expect(objectCarry(prior, { ...doc, objects: JSON.parse(JSON.stringify(prior.objects)) }).status).toBe('kept')
  })

  it('ASKED an edit that removes the input the program reads · CLAIMED lossy, naming the input · DID — REFUSAL until confirmed', () => {
    const prior = deepFreeze(paneDoc('c3b_09_param_object.pine'))
    const doc = { ...prior, inputs: prior.inputs.filter((s) => s.key !== 'off'), objects: prior.objects }
    const v = objectCarry(prior, doc)
    expect(v.status).toBe('lossy')
    expect(v.reasons.join(' ')).toContain('"off"')
    expect(v.sentence).toBe('This indicator also draws 1 line from its imported script; saving this edit will remove them.')
  })

  it('ASKED an edit whose document lost the program altogether · CLAIMED lossy (never a silent drop) · DID', () => {
    const prior = deepFreeze(paneDoc('c3b_04_table_dash.pine'))
    const { objects: _o, ...bare } = prior
    const v = objectCarry(prior, bare)
    expect(v.status).toBe('lossy')
    expect(v.sentence).toBe('This indicator also draws 1 table from its imported script; saving this edit will remove them.')
  })

  it('ASKED reopen a GRAPH-bound program (V2 document) in an editor that writes no graph · CLAIMED not loaded, reported lossy · DID', () => {
    const { v1, graph } = graphPrior()
    const prior = deepFreeze(graph)
    expect(prior.compute.graph).toBeTruthy()
    expect(storedObjectProgram(prior)).toBeTruthy()
    // the editor does not load a program whose node indexes it cannot write
    expect(carriableObjectProgram(prior)).toBeNull()
    // …and a builder-shaped document (no graph) carrying it is refused by name
    const { graph: _g, ...noGraph } = prior.compute
    const v = objectCarry(prior, { ...prior, compute: { ...noGraph, ast: v1.compute.ast }, objects: prior.objects })
    expect(v.status).toBe('lossy')
    expect(v.reasons[0]).toMatch(/computation graph/)
    expect(objectCarry(prior, { ...v1, objects: undefined }).status).toBe('lossy')
  })

  it('ASKED re-paste a DIFFERENT script with its own drawings · CLAIMED the member\'s replacement, not a loss · DID', () => {
    const prior = paneDoc('c3b_02_label_text.pine')
    const other = paneDoc('c3b_04_table_dash.pine')
    expect(objectCarry(prior, { ...prior, objects: other.objects }).status).toBe('replaced')
  })

  it('ASKED a definition with no program · CLAIMED none (unchanged behaviour) · DID', () => {
    const d = paneDoc('c3b_02_label_text.pine')
    const { objects: _o, ...bare } = d
    expect(objectCarry(bare, bare).status).toBe('none')
    expect(objectCarry(null, d).status).toBe('none')
  })

  it('ASKED the census across families · CLAIMED the sentence names each family it removes · DID', () => {
    const prog = { ops: [
      { k: 'create', family: 'label' }, { k: 'create', family: 'label' },
      { k: 'loop', body: [{ k: 'create', family: 'line' }] }, { k: 'create', family: 'table' }, { k: 'cell' },
    ] }
    expect(objectProgramCensus(prog)).toEqual({ families: { label: 2, line: 1, table: 1 }, total: 4 })
    expect(objectLossSentence(objectProgramCensus(prog)))
      .toBe('This indicator also draws 2 labels, 1 line and 1 table from its imported script; saving this edit will remove them.')
    expect(objectLossSentence(objectProgramCensus(paneDoc('c3b_03_box_zone.pine').objects))).toMatch(/\d+ box(es)? from/)
  })
})

describe('(6) the stamps the program evaluates under ride with it', () => {
  it('ASKED carry the stored program onto a rebuilt document · CLAIMED the Pine meta it reads is carried, the store\'s semantics is not · DID — EXACT', () => {
    const prior = deepFreeze({ ...paneDoc('c3b_09_param_object.pine'), meta: { ...paneDoc('c3b_09_param_object.pine').meta, semantics: 2 } })
    const rebuilt = { ...prior, meta: { name: 'n', shortName: 'n', description: 'd' } }
    const out = carryProgramMeta(rebuilt, prior)
    expect(out.meta.recurrenceOrigin).toBe('pine')
    expect(out.meta.naConditionFalse).toBe(true)
    expect(out.meta.name).toBe('n')            // the builder's own fields win
    expect('semantics' in out.meta).toBe(false)
    expect(carryProgramMeta(out, prior)).toBe(out) // nothing left to carry → identity
  })

  it('ASKED a kept program on the rebuilt document · CLAIMED its evaluation context (the object lane meta reads) is the stored one · DID — EXACT', () => {
    // `objectReaderFor` reads `meta.recurrenceOrigin` (bar_index / listing),
    // `naConditionFalse`, `runtimeErrors`, `lowerTf`, `otherSymbols`,
    // `periodReads`. On THESE bars the c3b fixtures draw the same either way
    // (measured), so the claim is pinned on the context itself, not on a lucky
    // output: every one of those keys the stored document has, the carry keeps.
    const prior = paneDoc('c3b_09_param_object.pine')
    const out = carryProgramMeta({ ...prior, meta: { name: 'n' } }, prior)
    for (const k of ['recurrenceOrigin', 'naConditionFalse', 'runtimeErrors', 'lowerTf', 'otherSymbols', 'periodReads']) {
      expect(out.meta[k]).toEqual(prior.meta[k])
    }
    expect(drawn(out)).toBe(drawn(prior))
  })

  it('ASKED the P2 presentation carrier on its own · CLAIMED it still does not carry `objects` (the BuilderSheet carries the program, gated by `objectCarry`) · DID', () => {
    const prior = paneDoc('c3b_02_label_text.pine')
    const { objects: _o, ...built } = prior
    expect(preservePresentation(built, prior).doc.objects).toBeUndefined()
  })
})

describe('(conversational path) no silent loss there either', () => {
  it('ASKED rename + change the plot\'s literal by conversation · CLAIMED the program rides byte-identically and draws the same · DID — EXACT', () => {
    const prior = deepFreeze(paneDoc('c3b_02_label_text.pine'))
    const s = openAuthoringState(prior, { defId: DEF_ID, version: 1, lineage: 'auth_0000000p2xb1' })
    const t1 = applyTurn(s, env(s, [{ op: 'rename_definition', name: 'Talked labels' }]))
    expect(t1.result.status, JSON.stringify(t1.result.errors || [])).toBe('applied')
    const slot = parameterSlots(t1.state.working).find((x) => x.output === 'value' && x.value === 50)
    expect(slot, 'no 50 slot on the plot').toBeTruthy()
    const t2 = applyTurn(t1.state, env(t1.state, [{ op: 'set_slot', slot: slot.id, value: 40 }]))
    expect(t2.result.status, JSON.stringify(t2.result.errors || [])).toBe('applied')
    const w = t2.state.working
    expect(w.meta.name).toBe('Talked labels')
    expect(JSON.stringify(w.objects)).toBe(JSON.stringify(prior.objects))
    expect(w.meta.recurrenceOrigin).toBe('pine')
    expect(drawn(w)).toBe(drawn(prior))
  })

  it('ASKED edit a GRAPH-bound program by conversation · CLAIMED refused (never rebuilt without it) · DID — REFUSAL', () => {
    const prior = deepFreeze(graphPrior().graph)
    const s = openAuthoringState(prior, { defId: DEF_ID, version: 1, lineage: 'auth_0000000p2xb2' })
    const t = applyTurn(s, env(s, [{ op: 'rename_definition', name: 'x' }]))
    expect(t.result.status).toBe('refused')
    // a graph document carries no per-plot formula text, so the conversation
    // refuses before any rebuild could drop the program
    expect(t.result.errors[0].code).toMatch(/^authoring:(no-source|unrepresentable|kind)$/)
    expect(t.state).toBe(s)
    expect(s.working).toBe(prior)
  })
})
