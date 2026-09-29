// app/src/components/chart/engine/ast/varSeed.measure.test.js
//
// ─── ⭐⭐ WHICH SCRIPTS' OUTPUTS MOVE WHEN A HISTORY SELF-READ SEEDS `na` — opt-in census ──
//
// `var x = init` + `x := … x[1] …` folds to `accum(seed, …self…, 250)`. In Pine
// `x[1]` on bar 0 is `na` — history before bar 0 does not exist — so a `var`
// whose update reads itself ONLY through `x[k]` never observes its initializer;
// the fold seeded it with `init` anyway (2026-09-28, PARITY-PROGRAMME). This file
// is the before/after instrument for that change: it writes a per-output value
// fingerprint for every script, and two runs (translator at HEAD, translator
// with the change) are diffed output by output.
//
//   cd app && VAR_SEED_CENSUS=1 VAR_SEED_CENSUS_OUT=<path.json> \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/ast/varSeed.measure.test.js
//
// ⛔ THE DIFF IS OF VALUES, NOT OF FORMULA TEXT. A seed that moves from `0` to
// `0 / 0` changes the formula of every such script; whether it changes a single
// NUMBER a member sees depends on whether the recurrence ever reads the seed on
// a computed bar. Only the evaluated column answers that, so both are recorded
// and the report counts the second.
//
// Bars: SPY 60m regular hours, SPY 60m EXTENDED hours (a grid on which a
// 09:30 session never opens — the case that exposed this), and SPY 1D; each
// translated in both lanes (host = strict, screener = lenient).
//
// ⛔ IT ASSERTS NO COUNT. It prints and writes.
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
/** ⭐ EVERY PINE CORPUS ON DISK, not only `corpus/committed`: the older public
 *  fixture set (`tests/fixtures/pine`, snapshotted by `pine.corpus.test.js`) and
 *  the member fixtures carry the same idiom and would otherwise move unseen. */
const DIRS = [
  path.join(REPO, 'corpus', 'committed'),
  path.join(REPO, 'tests', 'fixtures', 'pine_oos'),
  path.join(REPO, 'tests', 'fixtures', 'pine'),
  path.join(REPO, 'tests', 'fixtures', 'member'),
]
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const BAR_SETS = [
  { label: '60rth', base: '60', file: 'harness/vw-time-session-spy-60-rth-2026-09-28.json' },
  { label: '60ext', base: '60', file: 'harness/vw-time-session-spy-60-ext-2026-09-28.json' },
  { label: 'D', base: 'D', file: 'harness/vw-time-session-spy-1d-2026-09-28.json' },
]

const RUN = process.env.VAR_SEED_CENSUS === '1'
const OUT = process.env.VAR_SEED_CENSUS_OUT || path.join(os.tmpdir(), 'var_seed_census.json')

function scripts() {
  const out = []
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith('.pine') || name.endsWith('.txt')) {
        out.push({ dir: path.relative(REPO, dir).split(path.sep).join('/'), name, file: path.join(dir, name) })
      }
    }
  }
  return out
}

function barsOf(rel) {
  const d = JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))
  const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  return { bars, forming: d.newestBarIsForming === true ? true : d.newestBarIsForming === false ? false : null }
}

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
  const zeros = values.filter((v) => v === 0).length
  const h = crypto.createHash('sha1')
  h.update(values.map((v) => (Number.isFinite(v) ? v.toPrecision(12) : 'na')).join(','))
  return { finite, zeros, n: values.length, sha: h.digest('hex').slice(0, 12) }
}

const textSha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12)

afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!RUN)('var-seed census (opt-in)', () => {
  it('fingerprints every output over corpus/committed and pine_oos', () => {
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const barSets = BAR_SETS.map((b) => ({ ...b, ...barsOf(b.file) }))
    const all = scripts()
    expect(all.length).toBeGreaterThan(200) // the corpus was found

    const rows = []
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
      const perBase = {}
      // ⭐ BOTH LANES: the host lane (strict — the chart pane) and the screener
      // lane (lenient). They fold `barstate.*` differently, so one `var` can read
      // itself differently in each, and a value that moves in only one is a
      // finding about lane agreement, not noise.
      for (const b of barSets) for (const strict of [true, false]) {
        const key = `${b.label}:${strict ? 'host' : 'screener'}`
        let t
        try {
          t = translatePine(source, { strict, basePeriod: b.base })
        } catch (err) {
          perBase[key] = { threw: String(err && err.message).slice(0, 60) }
          continue
        }
        const outputs = (t.outputs || []).map((o) => (o.formula
          ? { title: o.title, text: textSha(o.formula), fp: fingerprint(evalTree(o.formula, b)) }
          : { title: o.title, refused: o.refusal && o.refusal.guard }))
        const objectTrees = ((t.objects && t.objects.trees) || [])
          .map((tree) => ({ text: textSha(JSON.stringify(tree)), fp: fingerprint(evalTree(tree, b)) }))
        perBase[key] = { ok: t.ok, refusals: (t.refusals || []).map((r) => r.guard), outputs, objectTrees }
      }
      rows.push({ dir: s.dir, name: s.name, attaches, doorGuard, perBase })
    }
    fs.writeFileSync(OUT, JSON.stringify({ scripts: rows.length, rows }, null, 1))
    // eslint-disable-next-line no-console
    console.log(`var-seed census -> ${OUT} (${rows.length} scripts)`)
  }, 900000)
})
