// app/src/components/chart/builder/memberPane/partialDrawing.census.measure.test.js
//
// ─── THE PARTIAL-DRAWING CENSUS — opt-in, never part of an ordinary run ─────
//
// What the member door does with every committed corpus script, flag OFF and
// flag ON: attached or refused, and — for an attached script whose object
// program lost operations — whether it carries the partial-drawing disclosure.
//
// ⛔ OPT-IN. It translates 266 scripts twice; an ordinary run skips it.
//   cd app && PARTIAL_CENSUS=1 node node_modules/vitest/vitest.mjs run \
//     src/components/chart/builder/memberPane/partialDrawing.census.measure.test.js
// Output: `$PARTIAL_CENSUS_OUT` (default: tools/partial_drawing_census.json
// under the repo root is NOT written — pass a path; the scratch default is the
// OS temp dir).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { memberPaneDefinition } from './memberPaneDefinition'
import { assessObjectLoss, DRAWING_NOTE_NAME } from '../../engine/ast/objectLoss'

const RUN = process.env.PARTIAL_CENSUS === '1'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const OUT = process.env.PARTIAL_CENSUS_OUT
  || path.join(os.tmpdir(), 'partial_drawing_census.json')

afterEach(() => { vi.unstubAllEnvs() })

/** Op kinds the CONVERTED program carries, loop bodies included. */
function carriedKinds(program) {
  const out = {}
  const walk = (ops) => {
    for (const op of ops || []) {
      if (!op) continue
      out[op.k] = (out[op.k] || 0) + 1
      if (op.k === 'loop') walk(op.body)
    }
  }
  walk(program && program.ops)
  return out
}

function row(file, flag) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', flag ? '1' : '')
  const source = fs.readFileSync(path.join(CORPUS, file), 'utf8')
  let d
  try { d = memberPaneDefinition({ source, id: 'u_census', name: 'C' }) } catch (err) {
    return { name: file, threw: String((err && err.message) || err) }
  }
  const t = d.translation || {}
  const diag = t.objectDiagnostics || {}
  const drawingNote = (d.notes || []).find((n) => n && n.name === DRAWING_NOTE_NAME) || null
  return {
    name: file.replace(/\.pine$/, ''),
    attached: d.ok === true,
    guard: d.guard || null,
    reason: d.ok ? null : d.reason,
    plots: (d.rows || []).length,
    objectsCarried: !!(d.definition && d.definition.objects),
    droppedOps: diag.droppedOps || 0,
    collectedOps: diag.collectedOps || 0,
    dropReasons: diag.dropReasons || {},
    carriedKinds: carriedKinds(t.objects),
    attemptedOps: diag.attemptedOps,
    unconvertedLoopOps: diag.unconvertedLoopOps || {},
    // ⚠️ LOSSES THE READER COUNTS BEFORE THE CONVERTER EVER SEES AN OP — never in
    // `droppedOps`, so recorded beside it rather than folded in.
    loopBlocked: diag.loopBlocked || 0,
    loopBlockedCalls: diag.loopBlockedCalls || [],
    unsupported: diag.unsupported || [],
    getters: diag.getters || [],
    outOfScope: diag.outOfScope || [],
    // withheld = the plots drew and the drawing did not; partial = drawn, disclosed.
    lossVerdict: assessObjectLoss(t).verdict,
    drawingNoteKind: !drawingNote ? null
      : assessObjectLoss(t).verdict === 'removes' ? 'object-withheld' : 'object-partial',
    drawingNote: drawingNote ? drawingNote.note : null,
    notes: (d.notes || []).map((n) => n.note),
  }
}

describe.skipIf(!RUN)('partial-drawing census (opt-in)', () => {
  it('measures every committed corpus script, flag off and on', () => {
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200) // non-vacuity: the corpus was found
    const off = files.map((f) => row(f, false))
    const on = files.map((f) => row(f, true))
    const keys = {}
    for (const r of [...off, ...on]) {
      for (const [k, n] of Object.entries(r.dropReasons || {})) {
        keys[k] = keys[k] || { scripts: new Set(), ops: 0 }
        keys[k].scripts.add(r.name)
      }
    }
    for (const r of on) for (const [k, n] of Object.entries(r.dropReasons || {})) keys[k].ops += n
    const keyTable = Object.fromEntries(Object.entries(keys).sort()
      .map(([k, v]) => [k, { scripts: v.scripts.size, ops: v.ops }]))
    fs.writeFileSync(OUT, JSON.stringify({ files: files.length, keyTable, off, on }, null, 1))
    // eslint-disable-next-line no-console
    console.log(`partial-drawing census -> ${OUT}`)
  }, 600000)
})
