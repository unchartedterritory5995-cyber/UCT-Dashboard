// app/src/components/chart/engine/__tests__/vendorHarness/objectsV2Regrade.measure.test.js
//
// ─── OBJECTS v2 — EVERY CAPTURE WITH OBJECT RECORDS, GRADED UNDER v1 AND v2 ──
//
// The list this exists to print: captures whose objects v1 grades MATCH and v2
// grades DIVERGE — drawings we call correct that are in the wrong place, or
// drawn with the wrong style, width or size. Per family it counts MATCH /
// DIVERGE under both grades, and for every enumerated field it tallies which
// of our values each vendor code met (so a code mapping in `OBJECTS_V2_FIELDS`
// is checked against the captures, not assumed).
//
// ⛔ OPT-IN, and IT ASSERTS NO COUNT (a pinned divergence count goes red on the
// progress it measures). It asserts only that it measured something.
//   cd app && PINE_OBJECTS_V2=1 PINE_OBJECTS_V2_OUT=<dir> \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/__tests__/vendorHarness/objectsV2Regrade.measure.test.js --maxWorkers=1
// The lane is production's: the objects-only pane armed, the runtime pane dark
// (`vendorHarness.corpus.test.js`, VENDOR_HARNESS_RUNTIME_ON=0).

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, gradeCapture, VENDOR_DIR, REPO } from './harness'
import { pairRecords } from './objectRecords'
import { OBJECTS_V2_FIELDS } from '../../../../../../../tools/vendor_harness/compare.mjs'

const RUN = process.env.PINE_OBJECTS_V2 === '1'
const OUT = process.env.PINE_OBJECTS_V2_OUT ? path.resolve(process.cwd(), process.env.PINE_OBJECTS_V2_OUT) : null

/** The flag NAMES are read off their gate modules, never typed. */
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
if (RUN) {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '')
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out.sort()
}

const V1_FAMILY_ROWS = Object.freeze({
  lines: ['lines', 'lines colour'],
  labels: ['labels', 'labels text', 'labels colour'],
  boxes: ['boxes', 'boxes colour'],
  tables: ['tables', 'tables colour'],
  tableCells: ['tableCells', 'tableCells text', 'tableCells colour'],
})

/** v1's per-family answer, off the rows its verdict carries. */
function v1Family(objects, family) {
  if (!objects || objects.verdict === 'INCONCLUSIVE') return null
  const names = V1_FAMILY_ROWS[family]
  if (!names) return null
  const rows = [...(objects.counts || []), ...(objects.texts || []), ...(objects.colours || [])]
    .filter((r) => names.includes(r.family))
  if (rows.some((r) => r.withheld)) return null
  if (rows.some((r) => r.agree === false)) return 'DIVERGE'
  if (rows.some((r) => r.agree === true)) return 'MATCH'
  return null
}

describe.skipIf(!RUN)('objects v2 — the re-grade over every capture with object records (opt-in)', () => {
  it('grades every capture under v1 and v2', () => {
    expect(OUT, 'PINE_OBJECTS_V2_OUT must name the output directory').toBeTruthy()
    const rows = []
    const codeMap = {}
    const fieldDiffers = {}
    for (const file of walk(VENDOR_DIR)) {
      const loaded = loadCapture(file)
      const cap = loaded.capture
      const R = cap && cap.objects && cap.objects.records
      if (!R || !Object.values(R).some((x) => Array.isArray(x) && x.length)) continue
      const rel = path.relative(REPO, file).replace(/\\/g, '/')
      let graded
      try { graded = gradeCapture(cap) } catch (err) {
        rows.push({ file: rel, error: String(err && err.message).slice(0, 200) })
        continue
      }
      const { verdict, ours, objectsV2 } = graded
      const v1 = verdict.objects || null
      const fams = {}
      for (const f of Object.keys(OBJECTS_V2_FIELDS)) {
        const v2row = objectsV2 && (objectsV2.families || []).find((x) => x.family === f)
        const v1f = v1Family(v1, f)
        let v2f = v1f
        if (v1 && v1.verdict !== 'INCONCLUSIVE' && v2row && v2row.agree === false) v2f = 'DIVERGE'
        else if (v1 && v1.verdict !== 'INCONCLUSIVE' && v2f === null && v2row && v2row.agree === true) v2f = 'MATCH'
        if (v1f || v2f || (v2row && v2row.paired)) {
          fams[f] = { v1: v1f, v2: v2f, paired: v2row ? v2row.paired : 0, first: v2row ? v2row.first : null,
            undecoded: v2row ? v2row.undecoded : {} }
        }
        if (v2row) {
          for (const [field, c] of Object.entries(v2row.byField)) {
            const k = `${f}.${field}`
            const t = fieldDiffers[k] || (fieldDiffers[k] = { agree: 0, differ: 0, notGraded: 0, captures: 0 })
            t.agree += c.agree; t.differ += c.differ; t.notGraded += c.notGraded
            if (c.differ) t.captures += 1
          }
        }
      }
      // vendor code → our value, per enumerated field (checks the code tables)
      if (ours && ours.ok && ours.objects && ours.objects.ok && Array.isArray(ours.objects.held)) {
        const pairing = pairRecords(cap, ours.objects)
        for (const [f, p] of Object.entries(pairing.families)) {
          for (const pair of p.pairs) {
            for (const r of pair.fields) {
              const spec = OBJECTS_V2_FIELDS[f].fields.find((x) => x.field === r.field)
              if (!spec || spec.kind !== 'enum' || r.state === 'notApplicable') continue
              const key = `${f}.${r.field}`
              const m = codeMap[key] || (codeMap[key] = {})
              const pairKey = `${JSON.stringify(r.vendor)} <- ours ${JSON.stringify(r.ours)} (${r.state === 'undrawn' ? r.wouldBe : r.state})`
              m[pairKey] = (m[pairKey] || 0) + 1
            }
          }
        }
      }
      rows.push({
        file: rel,
        v1: v1 ? v1.verdict : null,
        v2: objectsV2 ? objectsV2.verdict : null,
        first: objectsV2 ? objectsV2.first : null,
        orderOnly: objectsV2 ? !!objectsV2.differsOnlyByCreationOrder : false,
        v1reason: v1 ? v1.reason : null,
        families: fams,
      })
    }
    // ⛔ NON-VACUITY
    expect(rows.length).toBeGreaterThan(50)
    const moved = rows.filter((r) => r.v1 === 'MATCH' && r.v2 === 'DIVERGE')
    const perFamily = {}
    for (const r of rows) {
      for (const [f, x] of Object.entries(r.families || {})) {
        const t = perFamily[f] || (perFamily[f] = { v1: { MATCH: 0, DIVERGE: 0 }, v2: { MATCH: 0, DIVERGE: 0 } })
        if (x.v1) t.v1[x.v1] += 1
        if (x.v2) t.v2[x.v2] += 1
      }
    }
    const totals = { captures: rows.length, errors: rows.filter((r) => r.error).length,
      v1: {}, v2: {} }
    for (const r of rows) { if (r.v1) totals.v1[r.v1] = (totals.v1[r.v1] || 0) + 1; if (r.v2) totals.v2[r.v2] = (totals.v2[r.v2] || 0) + 1 }
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'objects-v2-regrade.json'), JSON.stringify({
      generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/objectsV2Regrade.measure.test.js',
      lane: 'production (objects-only pane armed, runtime pane dark)',
      totals, perFamily, fieldDiffers, codeMap, moved: moved.map((r) => ({ file: r.file, first: r.first, orderOnly: r.orderOnly })), rows,
    }, null, 1) + '\n')
    // eslint-disable-next-line no-console
    console.log('OBJECTS-V2', JSON.stringify({ totals, perFamily, moved: moved.length }))
  }, 3600000)
})
