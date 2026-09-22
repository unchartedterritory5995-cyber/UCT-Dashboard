// app/src/components/chart/engine/runtime/__tests__/iteratedTreeReaders.test.js
//
// ─── ⭐⭐ ONE PER-ROW TREE HAS EXACTLY ONE READER ────────────────────────────
//
// `buildObjectLane` pairs each iterated tree with the loop enclosing the op
// that reads it, and takes the FIRST such op. That is only sound while a tree
// cannot be read from two different loops, which would give one iteration
// buffer two candidate ranges.
//
// ⭐ IT IS A PROPERTY OF RAW-TREE MODE, NOT AN ASSUMPTION. `internTree` dedupes
// by `printFormula`, which is handed a raw parse node here and throws, so every
// occurrence interns its own index. Turn dedupe on and one tree could serve two
// loops — silently, because the lane would just keep whichever it walked first.
//
// ⛔ A REFUSAL FOR THAT CASE WAS WRITTEN AND THEN REMOVED. No fixture could
// make it fire: measured over this corpus, ZERO of 218 iterated trees are read
// by more than one op. A guard that cannot fire reads as protection without
// being any (`lesson_gate_that_cannot_fail`), so the invariant is MEASURED here
// instead — if it ever breaks, this names it rather than the lane quietly
// choosing a range.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from '../../ast/pine.js'
import { treeRefsOfOp } from '../../ast/objectProgram.js'
import { buildObjectLane } from '../objectLane.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

/** Every (tree → the ops that read it) pairing one script declares. */
function readersOf(src) {
  let t
  try {
    t = translatePine(src, {
      tf: 'D',
      newestBarIsForming: false,
      strict: true,
      objects: true,
      objectRawTrees: true,
      objectIterTrees: true,
    })
  } catch { return null }
  const objects = t.objects
  if (!objects || !Array.isArray(objects.ops)) return null
  const iterSet = new Set(Object.keys(objects.iteratedTrees || {}).map(Number))
  const byTree = new Map()
  const walk = (list, loop) => {
    for (const op of list || []) {
      if (!op || typeof op !== 'object') continue
      for (const i of treeRefsOfOp(op)) {
        if (!iterSet.has(i)) continue
        if (!byTree.has(i)) byTree.set(i, [])
        byTree.get(i).push(loop)
      }
      if (op.k === 'loop') walk(op.body, op)
    }
  }
  walk(objects.ops, null)
  return { iterSet, byTree }
}

/** ⭐ THE CORPUS IS WALKED ONCE. Every case below reads this. Re-deriving it
 *  per test ran the whole object pass five times and timed the file out at
 *  15s — a red that says nothing about the invariant. */
const ANALYSIS = (() => {
  const rows = []
  for (const name of SCRIPTS) {
    const src = fs.readFileSync(path.join(DIR, name), 'utf8')
    const readers = readersOf(src)
    let lane = null
    try { lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false }) } catch { lane = null }
    rows.push({ name, readers, lane })
  }
  return rows
})()

describe('⭐⭐ the one-reader invariant the per-row scoping rests on', () => {
  it('⛔ CONTROL — the corpus is on disk and actually declares per-row trees', () => {
    // An empty result is a failed invocation until proven otherwise: every
    // assertion below passes trivially over nothing.
    expect(SCRIPTS.length).toBeGreaterThan(200)
    const scanned = ANALYSIS.filter((r) => r.readers).length
    const trees = ANALYSIS.reduce((n, r) => n + (r.readers ? r.readers.iterSet.size : 0), 0)
    expect(scanned).toBeGreaterThan(50)
    expect(trees).toBeGreaterThan(100)
  })

  it('⭐⭐ no iterated tree is read by more than ONE op', () => {
    const offenders = []
    for (const { name, readers } of ANALYSIS) {
      if (!readers) continue
      for (const [tree, loops] of readers.byTree) {
        if (loops.length > 1) offenders.push(`${name} tree ${tree} × ${loops.length}`)
      }
    }
    // ⛔ NAMES, NEVER A COUNT — "3 offenders" cannot tell the next reader
    // whether dedupe was switched on or one script grew a second reader.
    expect(offenders).toEqual([])
  })

  it('⭐ and therefore never from two different LOOPS', () => {
    const offenders = []
    for (const { name, readers } of ANALYSIS) {
      if (!readers) continue
      for (const [tree, loops] of readers.byTree) {
        if (new Set(loops).size > 1) offenders.push(`${name} tree ${tree}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// ─── ⭐⭐ AN ORPHAN IS DROPPED, NOT REFUSED ON ───────────────────────────────
//
// The object pass marks a tree `iterated` at the moment it is interned, and can
// then DROP the op that would have read it — a guard, handle or content it
// cannot read. The tree stays behind with no reader.
//
// ⛔ REFUSING A DRAWING BECAUSE A VALUE NOTHING READS MENTIONS A LOOP COUNTER
// fails a script for a row it does not draw. Stated as an invariant rather than
// against a named script, so it keeps meaning the same thing as the corpus
// moves: a per-row refusal has to be about a per-row value somebody READS.
describe('⭐⭐ a per-row refusal is about a value that is actually read', () => {
  const PER_ROW_REFUSALS = ANALYSIS.filter(({ lane }) => (
    lane && !lane.ok
    && String((lane.refusal && lane.refusal.guard) || '').startsWith('objects:iterated-tree')))

  it('⛔ CONTROL — some script really does refuse this way', () => {
    // Without this, the assertion below is satisfied by a corpus in which the
    // guard never fires at all — which is exactly what a bug that disabled it
    // would look like.
    expect(PER_ROW_REFUSALS.length).toBeGreaterThan(0)
  })

  it('⭐⭐ every one of them has an op that READS a per-row value', () => {
    const orphanRefusals = []
    for (const { name, lane, readers } of PER_ROW_REFUSALS) {
      if (!readers) continue
      if (readers.byTree.size === 0) orphanRefusals.push(`${name} (${lane.refusal.guard})`)
    }
    // ⛔ NAMES, not a count — a count cannot say which script regressed.
    expect(orphanRefusals).toEqual([])
  })
})
