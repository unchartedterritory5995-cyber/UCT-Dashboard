// app/src/components/chart/builder/memberPane/savedDocumentRoundTrip.test.js
//
// ─── C46 — A DOCUMENT SAVED UNDER THE OLD ASSIGNMENT STILL ROUND-TRIPS ───────
//
// The parameter-id rule changed from "the N-th input the walk resolved" to "the
// input call's place in the source, with the corpus's old ids frozen". A member
// document saved before that change addresses its inputs by the OLD ids. This
// file loads such documents — built by the member-pane door at base `e4e24524ef`
// and committed under `tests/fixtures/pine_param_ids/` — and requires that the
// door, as it translates today, hands back the same ids for the same inputs at
// the same places, so the values a member saved land on the inputs they moved.
//
// ⛔ THE FIXTURES ARE NOT REGENERATED. They are a record of what the old
// assignment produced; rebuilding them from today's translator would turn this
// file into a test that the translator agrees with itself.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { memberPaneDefinition } from './memberPaneDefinition.js'
import { applyParamEdit, reconcileParams } from '../paramEdit.js'
import { treesHash } from '../../engine/ast/trees.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const DIR = path.join(REPO, 'tests/fixtures/pine_param_ids')
const SAVED = JSON.parse(fs.readFileSync(path.join(DIR, 'saved-documents-pre-c46.json'), 'utf8'))
const VOLUME = JSON.parse(fs.readFileSync(path.join(DIR, 'saved-document-volume-v2-pre-c46.json'), 'utf8'))
const VOLUME_SCRIPT = 'tests/fixtures/member/uncharted-volume-v2.pine'

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)
/** Keys sorted at every level — the digest the fixture's locator lists were taken with. */
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}
const valuesOf = (definition) => {
  const state = reconcileParams(definition)
  return Object.fromEntries(Object.keys(state).map((id) => [id, state[id].value]))
}
const build = (script) => memberPaneDefinition({
  source: fs.readFileSync(path.join(REPO, script), 'utf8'), id: 'u_member-pane-c46',
})

/** ⭐ B1 — A PAINT'S COLOUR COLUMN IS AN APPEND (the manifest's own rule, C46 ruling 3 /
 *  R-P, applied to the computation). A `bgcolor` / `barcolor` the door now carries adds a
 *  hidden condition column that ONLY the paint reads; the document a member saved is the
 *  rest of today's computation, byte for byte. So the comparison takes those columns out —
 *  and only those: a column a plot or a fill also reads existed before and stays. */
const paintOnlyKeys = (definition) => {
  const used = new Set()
  for (const p of definition.plots || []) {
    if (typeof p.colorMode === 'string' && p.colorMode.startsWith('column:')) used.add(p.colorMode.slice(7))
    if (p.fill && typeof p.fill.colorMode === 'string') used.add(p.fill.colorMode.slice(7))
  }
  return new Set((definition.paints || [])
    .map((p) => (typeof p.colorMode === 'string' ? p.colorMode.slice(7) : null))
    .filter((k) => k && !used.has(k)))
}
const computeBeforePaints = (definition) => {
  const keys = paintOnlyKeys(definition)
  if (!keys.size) return definition.compute
  const c = JSON.parse(JSON.stringify(definition.compute))
  for (const k of keys) {
    delete c.trees[k]
    if (c.sources) delete c.sources[k]
  }
  c.treesHash = treesHash(c.trees)
  return c
}

const scripts = Object.keys(SAVED).filter((k) => k !== '_about' && fs.existsSync(path.join(REPO, k)))

describe('C46 — documents saved under the walk-order ids', () => {
  it('NON-VACUITY — the saved documents are here, and they hold the OLD small-number ids', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(35)
    const ids = scripts.flatMap((s) => Object.keys(SAVED[s].params))
    expect(ids.length).toBeGreaterThanOrEqual(85)
    expect(ids.every((id) => /^__uct_param_\d{1,2}$/.test(id))).toBe(true)
  })

  it('⛔⛔ every saved document: the door still builds the same manifest — same ids, same inputs, same places', () => {
    const moved = []
    for (const script of scripts) {
      const was = SAVED[script]
      const built = build(script)
      if (!built.ok) { moved.push({ script, problem: `the door no longer builds it: ${built.reason}` }); continue }
      const manifest = built.definition.compute.paramManifest || {}
      for (const id of new Set([...Object.keys(was.params), ...Object.keys(manifest)])) {
        const a = was.params[id]
        const b = manifest[id]
        // ⭐ A GAIN IS AN APPEND (C46 ruling 3; R-P 2026-10-01): an id the saved document never
        // held, minted because the door now carries more of the script, moves nothing a member
        // saved. Only an id the saved document HELD and the door no longer builds is a move.
        if (!a && b) continue
        if (!b) { moved.push({ script, id, was: a.sourceName, now: '(absent)' }); continue }
        const same = a.sourceName === b.sourceName && a.title === b.title && a.type === b.type
          && a.default === b.default && a.locators === (b.locators || []).length
          && a.locatorsSha === sha(stable(b.locators))
        if (!same) moved.push({ script, id, was: a.sourceName, now: b.sourceName, locators: [a.locators, (b.locators || []).length] })
      }
      // …and the document around the manifest is the same document.
      if (sha(JSON.stringify(computeBeforePaints(built.definition))) !== was.computeSha) moved.push({ script, problem: 'the saved computation changed' })
    }
    expect(moved, `saved documents no longer round-trip:\n${JSON.stringify(moved, null, 2)}`).toEqual([])
  }, 900000)

  it('⛔⛔ every saved document: the values a member saved, replayed BY ID, land on the same inputs', () => {
    const wrong = []
    for (const script of scripts) {
      const was = SAVED[script]
      const built = build(script)
      if (!built.ok) continue
      let doc = built.definition
      for (const id of Object.keys(was.values)) {
        const applied = applyParamEdit(doc, id, was.values[id])
        if (!applied.ok) { wrong.push({ script, id, problem: applied.error }); continue }
        doc = applied.definition
      }
      // every input the member saved holds the value they saved; an input the door gained
      // since (an append) holds its default and is not part of what was saved
      const nowValues = valuesOf(doc)
      const savedKeys = Object.keys(was.editedState)
      if (JSON.stringify(Object.fromEntries(savedKeys.map((k) => [k, nowValues[k]]))) !== JSON.stringify(was.editedState)) {
        wrong.push({ script, was: was.editedState, now: valuesOf(doc) })
      }
      // the edited document is byte-for-byte the one the old assignment saved
      if (sha(JSON.stringify(computeBeforePaints(doc))) !== was.editedComputeSha) wrong.push({ script, problem: 'the edited document differs' })
    }
    expect(wrong, `saved values landed elsewhere:\n${JSON.stringify(wrong, null, 2)}`).toEqual([])
  }, 900000)

  it('⛔⛔ VOLUME v2, the whole saved document: loaded, read by id, replayed onto today\'s translation', () => {
    // A real pre-C46 document with both lengths moved off their defaults.
    const saved = VOLUME.definition
    const savedValues = valuesOf(saved)
    expect(savedValues).toEqual({ __uct_param_1: 51, __uct_param_2: 51 })
    expect(Object.fromEntries(Object.entries(saved.compute.paramManifest).map(([id, e]) => [id, e.sourceName])))
      .toEqual({ __uct_param_1: 'lenWeekly', __uct_param_2: 'lenDaily' })

    const fresh = build(VOLUME_SCRIPT)
    expect(fresh.ok).toBe(true)
    // the fresh translation still holds the author's defaults…
    expect(valuesOf(fresh.definition)).toEqual({ __uct_param_1: 50, __uct_param_2: 50 })
    // …and the saved values, replayed by the SAVED ids, rebuild the saved document.
    let doc = fresh.definition
    for (const id of Object.keys(savedValues)) {
      const applied = applyParamEdit(doc, id, savedValues[id])
      expect(applied.ok, applied.error).toBe(true)
      doc = applied.definition
    }
    expect(doc.compute).toEqual(saved.compute)
  }, 120000)

  it('⭐ B1 — the paint-column rule is LOAD-BEARING and NARROW: without it a paint script differs; with it, it is the saved document', () => {
    // atr-support-and-resistance carries a `barcolor` the door now draws; its colour column
    // is an append. Without taking it out the computation differs (the rule is not vacuous)…
    const script = 'corpus/committed/atr-support-and-resistance__3e9ddb38c4.pine'
    const built = build(script)
    expect(built.ok).toBe(true)
    expect(paintOnlyKeys(built.definition).size).toBeGreaterThan(0)
    expect(sha(JSON.stringify(built.definition.compute))).not.toBe(SAVED[script].computeSha)
    // …and with it out, the computation is the saved one exactly.
    expect(sha(JSON.stringify(computeBeforePaints(built.definition)))).toBe(SAVED[script].computeSha)
    // a script that writes no paint takes the identity path: nothing is taken out.
    const plain = build('tests/fixtures/member/uncharted-volume-v2.pine')
    expect(plain.ok).toBe(true)
    expect(computeBeforePaints(plain.definition)).toBe(plain.definition.compute)
  }, 120000)

  it('⛔ a value moved on ONE id reaches that input only', () => {
    // The cheap way for an id to "round-trip" while pointing at the wrong input
    // is for both inputs to have been moved to the same value. Move one.
    const fresh = build(VOLUME_SCRIPT)
    const applied = applyParamEdit(fresh.definition, '__uct_param_2', 77)
    expect(applied.ok, applied.error).toBe(true)
    expect(valuesOf(applied.definition)).toEqual({ __uct_param_1: 50, __uct_param_2: 77 })
    const manifest = applied.definition.compute.paramManifest
    expect(manifest.__uct_param_2.sourceName).toBe('lenDaily')
  }, 120000)
})
