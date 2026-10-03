// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.o1CommaReassign.test.js
//
// ─── O1 (step 67) G8 — `a := x, b := y` is two statements, on the corpus ──────
//
// The block reader split a comma line only when EVERY segment was a `=` binding,
// so `recent_dn2 := recent_dn1, i_recent_dn2 := i_recent_dn1` stayed one
// statement the walk could not read. Pine runs comma-joined statements left to
// right — what two lines do. Measured at the triage base: the TWO-LINE spelling
// of `auto-trendline-dojiemoji` and of `pa-zigzag-fibonacci-fan` already attached
// through the member door; the comma spelling, as published, did not. G8 makes
// the published spelling the same program.
//
// ⛔ No TradingView capture of either script exists. What grades it here:
//   · the translation of the published source equals the translation of the
//     same source with its comma lines broken onto separate lines (a spelling
//     already admitted), and
//   · for pa-zigzag, the HOST lane and the per-bar RUNTIME lane — two
//     independent evaluators — agree on every bar of NYSE:RDDT 1D vendor bars
//     (a committed capture used for its OHLC, from the listing).
//     auto-trendline-dojiemoji's runtime front end refuses it (`pine:block`), so
//     it has the first half only.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { translatePine } from '../../ast/pine'
import { computeRuntimeColumns, probeRuntimeProgram } from '../../runtime/runtimeColumns'
import { runOurSide, toProductBars, HARNESS_DEF_ID } from './ourSide'
import { REPO } from './harness'

const CORPUS = path.join(REPO, 'corpus/committed')
const CAPTURE = path.join(REPO, 'tests/fixtures/vendor/harness/adx-and-di-for-v4-rddt-1d-2026-09-27.json')
const SCRIPTS = ['auto-trendline-dojiemoji__c21f83602c.pine', 'pa-zigzag-fibonacci-fan__2001.pine']
const LF = String.fromCharCode(10)
const isNa = (v) => v === null || v === undefined || Number.isNaN(v)

afterEach(() => { vi.unstubAllEnvs() })

const read = (f) => fs.readFileSync(path.join(CORPUS, f), 'utf8').replace(/\r\n/g, LF)

/** The same source with each comma line of assignments broken onto lines of its own. */
function splitCommaLines(src) {
  const ASSIGN = /^\s*(var\s+)?([A-Za-z_][\w.]*\s+)?[A-Za-z_][\w.]*\s*(:=|=)/
  let split = 0
  const out = src.split(LF).flatMap((line) => {
    const code = line.split('//')[0]
    if (!code.includes(':=')) return [line]
    const parts = []
    let depth = 0
    let cur = ''
    for (const ch of code) {
      if (ch === '(' || ch === '[') depth += 1
      if (ch === ')' || ch === ']') depth -= 1
      if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
    }
    parts.push(cur)
    if (parts.length < 2 || !parts.every((p) => ASSIGN.test(p))) return [line]
    split += 1
    const indent = line.match(/^\s*/)[0]
    return parts.map((p) => indent + p.trim())
  })
  return { text: out.join(LF), split }
}

const sigOf = (t) => JSON.stringify({
  ok: t.ok, guard: t.refusal && t.refusal.guard,
  outs: (t.outputs || []).map((o) => [o.kind, o.title, o.formula, o.refusal && o.refusal.guard]),
  objs: t.objects ? t.objects.ops : null,
})

describe('O1 G8 — the published comma spelling is the two-line program', () => {
  for (const f of SCRIPTS) {
    it(`${f.split('__')[0]}: same translation as its comma lines broken onto lines`, () => {
      const src = read(f)
      const { text, split } = splitCommaLines(src)
      expect(split, 'non-vacuity: the script has comma-joined reassignments').toBeGreaterThan(0)
      const a = translatePine(src, { strict: true })
      const b = translatePine(text, { strict: true })
      expect(a.ok).toBe(true)
      expect(sigOf(a)).toBe(sigOf(b))
    })
  }

  it('pa-zigzag-fibonacci-fan: the host and runtime lanes agree on every bar of RDDT 1D vendor bars', () => {
    const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
    expect(cap.history && cap.history.startsAtBar0).toBe(true)
    const src = read('pa-zigzag-fibonacci-fan__2001.pine')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const ours = runOurSide({ ...cap, source: { ...cap.source, text: src } })
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    expect(ours.ok, ours.refusal).toBe(true)
    const probe = probeRuntimeProgram(src)
    expect(probe.ok).toBe(true)
    const plotAt = probe.outputs.map((o, i) => (o.call === 'plot' ? i : -1)).filter((i) => i >= 0)
    expect(ours.plots).toHaveLength(plotAt.length)
    let finite = 0
    ours.plots.forEach((p, j) => {
      const rt = computeRuntimeColumns({ id: 'x', compute: { fn: 'x', source: src, outputs: { v: plotAt[j] } } },
        toProductBars(cap), { tf: 'D', newestBarIsForming: false, historyFromListing: true }).v
      const host = p.column || []
      expect(host).toHaveLength(rt.length)
      const differ = []
      rt.forEach((v, i) => {
        const h = host[i]
        if (isNa(v) !== isNa(h)) differ.push(i)
        else if (!isNa(v)) {
          finite += 1
          if (Math.abs(v - h) > 1e-9 * Math.max(1, Math.abs(v))) differ.push(i)
        }
      })
      expect(differ, `${p.title}: bars where the lanes disagree`).toEqual([])
    })
    expect(finite, 'non-vacuity: the lanes were compared on real values').toBeGreaterThan(1000)
  })
})
