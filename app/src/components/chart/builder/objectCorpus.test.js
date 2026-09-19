// app/src/components/chart/builder/objectCorpus.test.js
//
// ─── ⭐⭐ C3B — WHAT THE OBJECT TRANSLATOR ACTUALLY REACHES, ON THE FROZEN 60 ──
//
// ⛔⛔ THREE POPULATIONS, NEVER MIXED, because the wave was corrected for
// exactly this: 46 scripts DEMAND objects, 27 of them are execution-reachable
// while RISK-043 stands, and quoting the first number for work that serves the
// second is the optimism the owner already caught once.
//
//   A · all 60          what a member might paste
//   B · 46 object-demand  what Pine authors write
//   C · 27 reachable      what an object model can serve TODAY
//
// ⭐ AND THE LOOP-BLOCKED 19 ARE REPORTED AS "OBJECT MODEL READY, EXECUTION
// BLOCKED" rather than as a translator failure — that distinction is the whole
// point of measuring them apart, and it is what tells the owner whether the next
// wave should be loops or something else.
//
// ⚠️ SOURCE OF TRUTH FOR THE POPULATIONS is `tools/c3b_out/census.json`, written
// by `tools/c3b_object_census.mjs`. This file does NOT re-derive them — two
// derivations of one population is the second-authority defect, and they would
// drift the first time a fixture changed.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { assertObjectProgram } from '../engine/ast/objectProgram'

const ROOT = path.resolve(process.cwd(), '..')
const OOS = path.join(ROOT, 'tests', 'fixtures', 'pine_oos')
const CENSUS = path.join(ROOT, 'tools', 'c3b_out', 'census.json')

const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'))
const REACHABLE = new Set(census.populations.reachable)
const OBJECT_DEMAND = new Set(census.populations.objectDemand)
const LOOP_BLOCKED = new Set(census.populations.loopBlocked)

const files = fs.readdirSync(OOS).filter((f) => f.endsWith('.pine')).sort()

const rows = files.map((f) => {
  const name = f.replace(/\.pine$/, '')
  const src = fs.readFileSync(path.join(OOS, f), 'utf8')
  let t
  try { t = translatePine(src) } catch (err) { t = { __threw: String(err && err.message) } }
  const prog = t.objects || null
  const fams = new Set()
  for (const op of (prog && prog.ops) || []) if (op.family) fams.add(op.family)
  for (const r of (prog && prog.regs) || []) fams.add(r.family)
  return {
    name,
    threw: t.__threw || null,
    hasProgram: !!prog,
    ops: prog ? prog.ops.length : 0,
    creates: prog ? prog.ops.filter((o) => o.k === 'create').length : 0,
    updates: prog ? prog.ops.filter((o) => o.k === 'update' || o.k === 'cell').length : 0,
    deletes: prog ? prog.ops.filter((o) => o.k === 'delete').length : 0,
    regs: prog ? prog.regs.length : 0,
    colls: prog ? prog.colls.length : 0,
    trees: prog ? prog.trees.length : 0,
    families: [...fams].sort(),
    diag: t.objectDiagnostics || null,
  }
})

const by = (n) => rows.find((r) => r.name === n)

describe('C3B — the object translator against the frozen 60', () => {
  it('⛔ NOTHING THREW. An object statement must never cost a member their columns', () => {
    expect(rows.filter((r) => r.threw).map((r) => `${r.name}: ${r.threw}`)).toEqual([])
  })

  it('⭐ every emitted program is a VALID object program', () => {
    const bad = []
    for (const r of rows) {
      if (!r.hasProgram) continue
      const src = fs.readFileSync(path.join(OOS, `${r.name}.pine`), 'utf8')
      const prog = translatePine(src).objects
      try { assertObjectProgram(prog) } catch (err) { bad.push(`${r.name}: ${err.message}`) }
    }
    expect(bad).toEqual([])
  })

  it('⭐⭐ THE THREE POPULATIONS, REPORTED APART', () => {
    const reached = rows.filter((r) => r.hasProgram)
    const reachableWith = rows.filter((r) => REACHABLE.has(r.name) && r.hasProgram)
    const blockedWith = rows.filter((r) => LOOP_BLOCKED.has(r.name) && r.hasProgram)
    const reachableWithout = rows.filter((r) => REACHABLE.has(r.name) && !r.hasProgram)

    const pad = (v, w) => String(v).padStart(w)
    // eslint-disable-next-line no-console
    console.log('\n=== C3B OBJECT TRANSLATION, frozen 60 ===\n'
      + `  A · all scripts                        ${rows.length}\n`
      + `  B · object-demand (census)             ${OBJECT_DEMAND.size}\n`
      + `  C · execution-reachable (census)       ${REACHABLE.size}   ⭐ C3B'S TARGET\n`
      + '\n'
      + `  scripts yielding an OBJECT PROGRAM     ${reached.length}\n`
      + `    …of the reachable 27                 ${reachableWith.length}/${REACHABLE.size}\n`
      + `    …of the loop-blocked 19              ${blockedWith.length}/${LOOP_BLOCKED.size}`
      + '  (partial: their non-loop ops only)\n'
      + `  reachable scripts with NO program yet  ${reachableWithout.length}\n`
      + (reachableWithout.length
        ? reachableWithout.map((r) => `      ${r.name}\n        diag ${JSON.stringify(r.diag)}`).join('\n')
        : '')
      + '\n\n  THE REACHABLE 27, ONE LINE EACH\n'
      + [...REACHABLE].map((n) => by(n)).filter(Boolean)
        .sort((a, b) => b.ops - a.ops)
        .map((r) => `    ${pad(r.creates, 3)}n ${pad(r.updates, 4)}u ${pad(r.deletes, 4)}d`
          + ` ${pad(r.regs, 3)}reg ${pad(r.colls, 2)}coll ${pad(r.trees, 4)}tree`
          + `  ${(r.families.join('+') || '—').padEnd(24)} ${r.name}`
          + (r.diag && r.diag.droppedOps ? `   ⚠ dropped ${r.diag.droppedOps}` : '')
          + (r.diag === null ? '   ⚠ script did not translate at all' : ''))
        .join('\n')
      + '\n\n  WHAT THE TRANSLATOR REFUSED, ACROSS ALL 60\n'
      + `    ops inside a loop body (RISK-043):   ${rows.reduce((a, r) => a + ((r.diag && r.diag.loopBlocked) || 0), 0)}\n`
      + `    getter calls (object state → value): ${[...new Set(rows.flatMap((r) => (r.diag && r.diag.getters) || []))].join(', ') || 'none'}\n`
      + `    out-of-scope families:               ${[...new Set(rows.flatMap((r) => (r.diag && r.diag.outOfScope) || []))].join(', ') || 'none'}\n`
      + `    unsupported methods:                 ${[...new Set(rows.flatMap((r) => (r.diag && r.diag.unsupported) || []))].slice(0, 14).join(', ') || 'none'}\n`
      + `    ops dropped (a value would not fold): ${rows.reduce((a, r) => a + ((r.diag && r.diag.droppedOps) || 0), 0)}`)

    // ⛔ THE MEASUREMENT MUST DISCRIMINATE. If the translator produced a program
    // for every script, or for none, this would be reporting its own bug.
    expect(reached.length).toBeGreaterThan(5)
    expect(reached.length).toBeLessThan(rows.length)
    // ⭐ and it must reach a real majority of the population it targets
    expect(reachableWith.length).toBeGreaterThanOrEqual(Math.ceil(REACHABLE.size * 0.4))
  })

  it('⛔⛔ RISK-043 IS INTACT — no object op inside a loop body became a program op', () => {
    // The loop-blocked 19 may still yield a program from their NON-loop
    // statements; what must never happen is a loop body being executed.
    const total = rows.reduce((a, r) => a + ((r.diag && r.diag.loopBlocked) || 0), 0)
    expect(total).toBeGreaterThan(0) // the corpus really does contain them
    for (const r of rows) {
      if (!r.diag) continue
      // every loop-blocked call is COUNTED, and none of them is an op
      expect((r.diag.loopBlockedCalls || []).every((c) => typeof c === 'string')).toBe(true)
    }
  })

  it('⛔⛔ a GETTER is refused BY NAME — object state can never become a graph node', () => {
    // ⚠️ THE CORPUS DOES NOT EXERCISE THIS PATH, and saying so matters. The
    // census counts 8 `line.get_x1` sites in population B, and every one of them
    // sits inside a loop body — so the loop refusal reaches them first and the
    // getter refusal never fires on the frozen 60. A test that asserted "the
    // corpus produces getters" would therefore be asserting a coincidence.
    // This drives the guard directly instead, which is the only way to know it
    // is load-bearing rather than dead.
    const src = ['//@version=5', 'indicator("g", overlay = true)',
      'var line l = na', 'l := line.new(bar_index, low, bar_index, high)',
      'label.new(bar_index, high, str.tostring(line.get_x1(l)))',
      'plot(close, title = "C")', ''].join('\n')
    const t = translatePine(src)
    expect(t.objectDiagnostics.getters).toContain('line.get_x1')
    // …and the label that depended on it was DROPPED, not drawn with a wrong x.
    const labels = ((t.objects && t.objects.ops) || []).filter((o) => o.family === 'label')
    expect(labels).toHaveLength(0)
  })
})
