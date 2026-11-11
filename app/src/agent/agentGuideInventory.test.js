// ⭐ TEACH COVERAGE PROBE: the Charts inventory (docs/agent/CHARTS_COVERAGE_MATRIX.md), asked as a teaching question.
//
// Every inventory row is asked twice through the guide's instant path, in words this file does not choose:
//   A  "how do I " + the row's own Human action              ("how do I close a widget")
//   B  "show me how to " + the row's own Example phrase       ("show me how to close the news widget")
// and the walkthrough each reaches (feature, and the family row it picked) is written to GUIDE_PROBE_OUT when set.
//
// ⛔ This measures ROUTING ONLY: that the words reach a walkthrough and which one. Whether that walkthrough rings the
// right control is judged by hand from the report and in the browser — a probe hit is not VERIFIED. The phrasings are the
// inventory's own, so this is the TUNING set; the held-out set is agentGuideHeldOut*.test.js.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { guideFeature } from './guide/registry'
import { stepsFor, titleFor } from './guide/slots'

beforeAll(() => { registerBuiltins() })

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8') } catch { return '' } }

/** The inventory's rows: { id, area, action, example } from each part's own header (the parts order columns differently). */
export function inventoryRows() {
  const out = []
  let head = null
  for (const line of read('docs/agent/CHARTS_COVERAGE_MATRIX.md').split(/\r?\n/)) {
    if (!line.startsWith('|')) { head = null; continue }
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells[0] === 'ID') { head = cells.map(c => c.toLowerCase()); continue }
    if (!head || !/^C\d-\d{3}$/.test(cells[0])) continue
    const col = (name) => cells[head.indexOf(name)] || ''
    out.push({ id: cells[0], area: col('area'), action: col('human action'), example: col('example phrase').replace(/^["“]|["”]$/g, '') })
  }
  return out
}
/** The teach status file's verdict per row. */
function teachStatus() {
  const m = new Map()
  for (const line of read('docs/agent/CHARTS_TEACH_STATUS.md').split(/\r?\n/)) {
    const c = line.split('|').slice(1, -1).map(x => x.trim())
    if (/^C\d-\d{3}$/.test(c[0] || '')) m.set(c[0], c[3])
  }
  return m
}

const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1)
function probe(q) {
  const got = route(q)
  if (!got) return null
  const f = guideFeature(got.feature)
  const steps = f ? stepsFor(f, got.detail || q) : []
  return { feature: got.feature, title: f ? titleFor(f, got.detail || q) : null, ask: !!got.ask, last: JSON.stringify(steps[steps.length - 1]?.target ?? null) }
}

describe('teach coverage probe (inventory phrasings, routing only)', () => {
  it('asks every inventory row and reports what it reaches', () => {
    const rows = inventoryRows()
    const status = teachStatus()
    expect(rows.length).toBeGreaterThan(400)
    const report = rows.map(r => ({
      ...r,
      teach: status.get(r.id) || null,
      a: probe(`how do I ${lower(r.action)}`),
      b: r.example && r.example !== 'none' ? probe(`show me how to ${lower(r.example)}`) : null,
    }))
    const reached = report.filter(r => r.a || r.b).length
    const byStatus = {}
    for (const r of report) {
      const k = r.teach || 'none'
      byStatus[k] = byStatus[k] || { rows: 0, reached: 0 }
      byStatus[k].rows++
      if (r.a || r.b) byStatus[k].reached++
    }
    if (process.env.GUIDE_PROBE_OUT) fs.writeFileSync(process.env.GUIDE_PROBE_OUT, JSON.stringify({ reached, total: rows.length, byStatus, report }, null, 1))
    // ⭐ the browser runner's cases (app/src/testing/agent/guide/teach.mjs). A row is a case only when one of its two phrasings
    // reaches the walkthrough a PERSON decided is right for it (testing/agent/guide/expected.json: the 11-05 matrix's "Guide
    // feature" column, and catalog controls reviewed by hand 2026-11-07). The browser then has to ring its last control.
    if (process.env.GUIDE_CASES_OUT) {
      const want = JSON.parse(read('app/src/testing/agent/guide/expected.json'))
      const cases = []
      for (const r of report) {
        const exp = want[r.id]
        if (!exp) continue
        for (const [k, say] of [['a', `how do I ${lower(r.action)}`], ['b', r.example && r.example !== 'none' ? `show me how to ${lower(r.example)}` : null]]) {
          const got = r[k]
          if (!say || !got || got.feature !== exp.feature || (exp.title && got.title !== exp.title)) continue
          cases.push({ id: r.id, say, feature: got.feature, title: got.title })
          break
        }
      }
      fs.writeFileSync(process.env.GUIDE_CASES_OUT, JSON.stringify(cases, null, 1))
    }
    console.log(`teach probe: ${reached}/${rows.length} rows reach a walkthrough`, JSON.stringify(byStatus))
  })
})
