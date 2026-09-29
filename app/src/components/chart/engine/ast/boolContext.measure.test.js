// app/src/components/chart/engine/ast/boolContext.measure.test.js
//
// ─── ⭐⭐ WHERE A NUMBER REACHES A BOOL CONTEXT — opt-in census ──────────────
//
// Pine v5 casts a numeric operand of `and`/`or`/`not`, a `?:`/`if` test, and an
// object guard to bool implicitly: `na` and 0 are false, anything else is true
// (TradingView's v6 migration guide, quoted at `implicitBoolCast` in pine.js).
// This engine's `&&`/`||`/`!`/`?:` PROPAGATE NaN instead, so wherever a v5
// numeric that can be `na` reaches one of those contexts, the answer differed
// from TradingView's on exactly the `na` bars. This file SIZES that class.
//
//   cd app && BOOL_CONTEXT_CENSUS=1 BOOL_CONTEXT_CENSUS_OUT=<path.json> \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/ast/boolContext.measure.test.js
//
// ⛔⛔ THE SITE LIST IS DERIVED, NEVER TYPED. It comes from the translator's own
// decision point — the `onCondition` observer on `Resolver.condition`, which is
// the one function every bool context now funnels through — so this census
// cannot disagree with what the door actually does. A second typer here (a
// regex over `and`, a hand-written Pine type inference) would be a second
// authority over "is this operand a number", and would drift the day the first
// one moved.
//
// For every script in `corpus/committed` and `tests/fixtures/pine_oos` (the
// licence-held members of the latter are absent on most machines and are simply
// not there to read — `oosLocalOnly.js`):
//
//   version      the script's `//@version`
//   attaches     the member door's verdict with BOTH production flags on
//                (`VITE_PINE_MEMBER_PANE_ENABLED=1`, `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`)
//   sites        every bool context the host lane met, deduped by
//                line:column:site, with the operand's kind (`num`/`bool`/`unknown`)
//                and whether the cast was applied
//   naBars       for each NUMERIC operand, evaluated over the SPY 60m and 1D
//                vendor bars: on how many bars it is `na` — the bars on which the
//                cast changes the answer. `null` = the operand could not be
//                evaluated standalone (a `sym`/`tf` read, say), never 0.
//   outputs      a per-output value fingerprint (finite count + digest) over the
//                same bars, so two runs of this census — before and after a
//                translator change — can be diffed output by output; and
//   objectTrees  the same fingerprint for every tree the object program carries
//                (guards and coordinates), where a cast can move a drawing
//                without moving any plot.
//
// ⛔ IT ASSERTS NO COUNT. It prints and writes; the only assertions are the ones
// any honest run must satisfy (the corpus was found; the observer fired at all).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition.js'

const REPO = path.resolve(process.cwd(), '..')
const DIRS = [
  path.join(REPO, 'corpus', 'committed'),
  path.join(REPO, 'tests', 'fixtures', 'pine_oos'),
]
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const BAR_SETS = [
  { label: '60', base: '60', file: 'harness/vw-time-session-spy-60-rth-2026-09-28.json' },
  { label: 'D', base: 'D', file: 'harness/vw-time-session-spy-1d-2026-09-28.json' },
]

const RUN = process.env.BOOL_CONTEXT_CENSUS === '1'
const OUT = process.env.BOOL_CONTEXT_CENSUS_OUT
  || path.join(os.tmpdir(), 'bool_context_census.json')

function scripts() {
  const out = []
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith('.pine') || name.endsWith('.txt')) {
        out.push({ dir: path.basename(dir), name, file: path.join(dir, name) })
      }
    }
  }
  return out
}

function barsOf(rel) {
  const d = JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))
  const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  // ⭐ THE CAPTURE SAYS WHETHER ITS NEWEST BAR WAS STILL FORMING, and the
  // realtime clock columns (`isconfirmed`, …) blank without it — which would
  // read here as an operand that is `na` on every bar, a finding about the
  // harness rather than the script.
  return { bars, forming: d.newestBarIsForming === true ? true : d.newestBarIsForming === false ? false : null }
}

/** Evaluate a canonical tree or a formula string; null when it cannot be. */
function evalTree(treeOrFormula, set) {
  try {
    const ast = typeof treeOrFormula === 'string' ? parseFormula(treeOrFormula).ast : treeOrFormula
    return Array.from(interpret(ast, set.bars, {}, undefined, undefined,
      { tf: set.base, newestBarIsForming: set.forming }))
  } catch {
    return null
  }
}

function fingerprint(values) {
  if (!values) return null
  const finite = values.filter(Number.isFinite).length
  const h = crypto.createHash('sha1')
  h.update(values.map((v) => (Number.isFinite(v) ? v.toPrecision(12) : 'na')).join(','))
  return { finite, n: values.length, sha: h.digest('hex').slice(0, 12) }
}

afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!RUN)('numeric-in-a-bool-context census (opt-in)', () => {
  it('sizes the class over corpus/committed and pine_oos', () => {
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const barSets = BAR_SETS.map((b) => ({ ...b, ...barsOf(b.file) }))
    const all = scripts()
    expect(all.length).toBeGreaterThan(200) // the corpus was found

    const rows = []
    let observed = 0
    for (const s of all) {
      const source = fs.readFileSync(s.file, 'utf8')
      let attaches = null
      let doorGuard = null
      try {
        const door = memberPaneDefinition({ source, id: 'u_census', name: 'census' })
        attaches = door.ok === true
        doorGuard = door.ok ? null : (door.guard || null)
      } catch (err) {
        doorGuard = `threw:${String(err && err.message).slice(0, 40)}`
      }

      const sites = new Map()
      const perBase = {}
      let version = null
      for (const b of barSets) {
        let t
        try {
          t = translatePine(source, {
            strict: true,
            basePeriod: b.base,
            onCondition: (site) => {
              observed += 1
              const key = `${site.line}:${site.column}:${site.site}`
              let row = sites.get(key)
              if (!row) {
                row = { line: site.line, column: site.column, site: site.site,
                  kind: site.kind, cast: site.cast, naBars: {} }
                sites.set(key, row)
              }
              // ⭐ A kind can differ between resolutions of one site (a function
              // body inlined with different arguments); keep the strongest claim.
              if (site.kind === 'num') row.kind = 'num'
              else if (row.kind !== 'num' && site.kind === 'unknown') row.kind = 'unknown'
              row.cast = row.cast || site.cast
              if (site.kind === 'num' && row.naBars[b.label] === undefined) {
                const v = evalTree(site.tree, b)
                row.naBars[b.label] = v ? v.filter((x) => !Number.isFinite(x)).length : null
              }
            },
          })
        } catch (err) {
          perBase[b.label] = { threw: String(err && err.message).slice(0, 60) }
          continue
        }
        version = t.version == null ? version : t.version
        const outputs = []
        for (const o of (t.outputs || [])) {
          if (!o.formula) { outputs.push({ title: o.title, refused: o.refusal && o.refusal.guard }); continue }
          outputs.push({ title: o.title, fp: fingerprint(evalTree(o.formula, b)) })
        }
        // ⭐ THE DRAWINGS TOO. A cast inside an object guard or coordinate moves
        // no plot at all, so a diff of `outputs` alone would miss it; every tree
        // the object program carries is fingerprinted the same way.
        const objectTrees = ((t.objects && t.objects.trees) || []).map((tree) => fingerprint(evalTree(tree, b)))
        perBase[b.label] = { ok: t.ok, outputs, objectTrees }
      }

      const siteRows = [...sites.values()]
      const numeric = siteRows.filter((r) => r.kind === 'num')
      rows.push({
        dir: s.dir,
        name: s.name,
        version,
        attaches,
        doorGuard,
        counts: {
          sites: siteRows.length,
          num: numeric.length,
          unknown: siteRows.filter((r) => r.kind === 'unknown').length,
          bool: siteRows.filter((r) => r.kind === 'bool').length,
          cast: siteRows.filter((r) => r.cast).length,
          numCanBeNa: numeric.filter((r) => Object.values(r.naBars).some((n) => n > 0)).length,
        },
        sites: siteRows,
        perBase,
      })
    }

    const affected = rows.filter((r) => r.counts.num > 0)
    const live = affected.filter((r) => r.attaches)
    const summary = {
      scripts: rows.length,
      withNumericSite: affected.length,
      withNumericSiteByVersion: affected.reduce((m, r) => {
        const k = String(r.version); m[k] = (m[k] || 0) + 1; return m
      }, {}),
      withNumericSiteThatCanBeNa: affected.filter((r) => r.counts.numCanBeNa > 0).length,
      attachInProduction: rows.filter((r) => r.attaches).length,
      affectedAndAttach: live.map((r) => ({ name: r.name, version: r.version, ...r.counts })),
      withUnknownSite: rows.filter((r) => r.counts.unknown > 0).length,
    }
    fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1))
    // eslint-disable-next-line no-console
    console.log(`bool-context census -> ${OUT}\n${JSON.stringify(summary, null, 1)}`)
    // ⭐ ASSERTED AFTER THE WRITE, so a run against a translator WITHOUT the
    // observer (a before/after diff of the `outputs` fingerprints) still leaves
    // its evidence on disk before it goes red.
    expect(observed).toBeGreaterThan(0) // the observer is wired at all
  }, 900000)
})
