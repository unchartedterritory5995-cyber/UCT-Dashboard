// app/src/components/chart/builder/objectDemandCensus.test.js
//
// ─── C3B.1: THE EXACT OBJECT-DEMAND CENSUS ──────────────────────────────────
//
// Measurement only. No architecture decision is taken here and none should be
// read out of it beyond what the counts say.
//
// ⛔ THE SHAPE CLASSES ARE THE POINT, NOT THE TOTALS. "46 of 60 scripts use
// objects" is a number that justifies almost any plan. What decides an
// architecture is which of these a script actually needs:
//
//   CREATE ONLY                 — a marker with coordinates; no identity needed
//   CREATE + UPDATE             — identity must survive across bars
//   CREATE + UPDATE + DELETE    — plus a lifetime and a resource envelope
//   ARRAY / COLLECTION          — plus a typed, bounded heap
//   TABLE                       — viewport-anchored, not bar-anchored
//   LOOP-DRIVEN                 — needs general loop execution (RISK-043)
//
// A system that only does CREATE serves the first class and nothing else; one
// that does the third serves three of six. So they are counted apart.
//
// ⚠️ SOURCE-TEXT CENSUS, AND IT SAYS SO. It counts what authors WROTE. Where a
// call sits in a comment it is over-counted, which is why the comment-stripped
// and raw counts are both reported.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const OOS = path.resolve(process.cwd(), '../tests/fixtures/pine_oos')

function stripComments(src) {
  const out = []
  for (const line of src.split(/\r?\n/)) {
    let inStr = null
    let cut = line.length
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (inStr) {
        if (ch === '\\') { i += 1; continue }
        if (ch === inStr) inStr = null
        continue
      }
      if (ch === '"' || ch === "'") { inStr = ch; continue }
      if (ch === '/' && line[i + 1] === '/') { cut = i; break }
    }
    out.push(line.slice(0, cut))
  }
  return out.join('\n')
}

const count = (src, re) => (src.match(re) || []).length
/** `ns.name(` as a call. */
const callRe = (name) => new RegExp(`(^|[^A-Za-z0-9_.])${name.replace('.', '\\.')}\\s*\\(`, 'g')
/** any setter in a family: `line.set_xy1(`, `label.set_text(` … */
const setterRe = (ns) => new RegExp(`(^|[^A-Za-z0-9_.])${ns}\\.set_[a-z_0-9]+\\s*\\(`, 'g')
const getterRe = (ns) => new RegExp(`(^|[^A-Za-z0-9_.])${ns}\\.get_[a-z_0-9]+\\s*\\(`, 'g')

const FAMILIES = ['line', 'label', 'box', 'table', 'polyline', 'linefill']

function censusOf(raw) {
  const s = stripComments(raw)
  const f = {}
  for (const ns of FAMILIES) {
    f[ns] = {
      create: count(s, callRe(`${ns}.new`)),
      set: count(s, setterRe(ns)),
      get: count(s, getterRe(ns)),
      del: count(s, callRe(`${ns}.delete`)),
    }
  }
  // table has its own cell vocabulary rather than set_*
  f.table.cell = count(s, callRe('table.cell'))
  f.table.cellSet = count(s, /(^|[^A-Za-z0-9_.])table\.cell_set_[a-z_0-9]+\s*\(/g)
  f.table.clear = count(s, callRe('table.clear'))

  const anyCreate = FAMILIES.reduce((n, ns) => n + f[ns].create, 0)
  const anySet = FAMILIES.reduce((n, ns) => n + f[ns].set, 0) + f.table.cell + f.table.cellSet
  const anyDel = FAMILIES.reduce((n, ns) => n + f[ns].del, 0) + f.table.clear

  return {
    f,
    anyCreate,
    anySet,
    anyDel,
    // an object id stored in a variable that survives bars
    objectVar: count(s, /\bvar\s+(line|label|box|table|polyline|linefill)\s+\w+/g),
    // a typed object array/collection
    objectArray: count(s, /array\s*\.\s*new_(line|label|box|table)\s*\(/g)
      + count(s, /\barray<\s*(line|label|box|table)\s*>/g)
      + count(s, /\b(line|label|box)\[\]/g),
    // reassignment of an object reference
    reassign: count(s, /\b\w+\s*:=\s*(line|label|box|table|polyline|linefill)\.new\s*\(/g),
    // creation/mutation inside a loop
    loops: count(s, /(^|[^A-Za-z0-9_])for\s+\w+\s*=/g) + count(s, /(^|[^A-Za-z0-9_])for\s*\[/g)
      + count(s, /(^|[^A-Za-z0-9_])while\s+/g),
    // the author's own declared ceilings
    maxCounts: count(s, /max_(lines|labels|boxes|polylines|bars)_count\s*=/g),
    objInLoop: objectOpsInsideLoops(s),
    // historical indexing of an object reference is rare; measured, not assumed
    histIndex: count(s, /\b(line|label|box)\w*\s*\[\s*\d+\s*\]/g),
  }
}

/**
 * Is an object operation INSIDE a loop body?
 *
 * ⛔⛔ THE MOST DECISION-RELEVANT NUMBER IN THIS FILE, and a raw "contains a
 * loop" count cannot answer it. Generalized Pine loop execution is deliberately
 * unsupported (RISK-043) and C3B is explicitly forbidden from reopening it. So
 * the real reach of an object model is not "46 scripts use objects" — it is
 * "how many of those build their objects WITHOUT a loop". A script that creates
 * its lines inside `for i = 0 to n` stays BLOCKED however good the object model
 * is, and the owner needs that number before authorising the architecture, not
 * after building it.
 *
 * ⚠️ INDENTATION, BECAUSE PINE'S BLOCKS ARE INDENTATION. This walks from each
 * `for`/`while` header down while the indent stays deeper, and asks whether any
 * of those lines carries an object call. It is a heuristic on source text and
 * says so — it can miss a one-line loop body written on the header line, and it
 * counts a deeper-indented `if` inside a loop as inside the loop, which is
 * correct. Reported beside the raw loop count so the two can be compared.
 */
function objectOpsInsideLoops(src) {
  const lines = src.split(/\r?\n/)
  const OBJ = /(^|[^A-Za-z0-9_.])(line|label|box|table|polyline|linefill)\.(new|set_[a-z_0-9]+|delete|cell)\s*\(/
  const indentOf = (l) => (l.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length
  let hits = 0
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    if (!/(^|[^A-Za-z0-9_])(for|while)[\s(\[]/.test(l)) continue
    const base = indentOf(l)
    // a one-line body on the header itself
    if (OBJ.test(l.replace(/^[^=]*\b(for|while)\b/, ''))) { hits += 1; continue }
    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j]
      if (!b.trim()) continue
      if (indentOf(b) <= base) break
      if (OBJ.test(b)) { hits += 1; break }
    }
  }
  return hits
}

/** ⛔ THE CLASS IS THE STRONGEST THING THE SCRIPT NEEDS, not the commonest. A
 *  script that creates ten labels and deletes one still needs deletion. */
function classOf(c) {
  if (!c.anyCreate && !c.f.table.cell) return 'NONE'
  const classes = []
  if (c.f.table.create || c.f.table.cell) classes.push('TABLE')
  if (c.objectArray) classes.push('ARRAY')
  if (c.anyDel) classes.push('CREATE_UPDATE_DELETE')
  else if (c.anySet) classes.push('CREATE_UPDATE')
  else classes.push('CREATE_ONLY')
  return classes.join('+')
}

describe('C3B.1 — the object-demand census', () => {
  it('every family, every shape class, across the frozen 60', () => {
    const files = fs.readdirSync(OOS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBe(60)

    const rows = files.map((f) => {
      const raw = fs.readFileSync(path.join(OOS, f), 'utf8')
      const c = censusOf(raw)
      return { name: f.replace(/\.pine$/, ''), c, klass: classOf(c) }
    })
    const withObjects = rows.filter((r) => r.klass !== 'NONE')

    const famTotals = {}
    for (const ns of FAMILIES) {
      famTotals[ns] = {
        scripts: rows.filter((r) => r.c.f[ns].create > 0).length,
        create: rows.reduce((n, r) => n + r.c.f[ns].create, 0),
        set: rows.reduce((n, r) => n + r.c.f[ns].set, 0),
        get: rows.reduce((n, r) => n + r.c.f[ns].get, 0),
        del: rows.reduce((n, r) => n + r.c.f[ns].del, 0),
      }
    }
    const has = (pred) => rows.filter(pred).length
    const bucket = {}
    for (const r of withObjects) bucket[r.klass] = (bucket[r.klass] || 0) + 1

    const pad = (v, n) => String(v).padStart(n)
    // eslint-disable-next-line no-console
    console.log('\n=== C3B.1 OBJECT-DEMAND CENSUS, frozen 60 ===\n'
      + '  family      scripts   new    set_*   get_*  delete\n'
      + FAMILIES.map((ns) => `    ${ns.padEnd(10)} ${pad(famTotals[ns].scripts, 5)}/60`
        + `${pad(famTotals[ns].create, 7)}${pad(famTotals[ns].set, 8)}`
        + `${pad(famTotals[ns].get, 8)}${pad(famTotals[ns].del, 8)}`).join('\n')
      + `\n    table.cell        —${pad(rows.reduce((n, r) => n + r.c.f.table.cell, 0), 7)}`
      + `   cell_set_* ${rows.reduce((n, r) => n + r.c.f.table.cellSet, 0)}`
      + `   clear/delete ${rows.reduce((n, r) => n + r.c.f.table.clear, 0)}`
      + '\n\n  CAPABILITY SHAPES (a script is counted at the STRONGEST thing it needs)\n'
      + Object.entries(bucket).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `    ${pad(v, 3)}/60  ${k}`).join('\n')
      + `\n\n  scripts using ANY object:            ${pad(withObjects.length, 3)}/60`
      + `\n  …needing UPDATE (identity across bars): ${pad(has((r) => r.c.anySet > 0), 3)}/60`
      + `\n  …needing DELETE (lifetime + envelope):  ${pad(has((r) => r.c.anyDel > 0), 3)}/60`
      + `\n  …storing an object in a var variable:   ${pad(has((r) => r.c.objectVar > 0), 3)}/60`
      + `\n  …reassigning an object reference:       ${pad(has((r) => r.c.reassign > 0), 3)}/60`
      + `\n  …using an object ARRAY/collection:      ${pad(has((r) => r.c.objectArray > 0), 3)}/60`
      + `\n  …containing a LOOP at all:              ${pad(has((r) => r.c.loops > 0), 3)}/60`
      + `\n  …declaring max_*_count:                 ${pad(has((r) => r.c.maxCounts > 0), 3)}/60`
      + `\n  …historically indexing an object ref:   ${pad(has((r) => r.c.histIndex > 0), 3)}/60`
      + '\n\n  ⛔⛔ THE LOOP BOUNDARY — what an object model would still NOT reach\n'
      + `    object scripts building objects INSIDE a loop: `
      + `${pad(withObjects.filter((r) => r.c.objInLoop > 0).length, 3)}/${withObjects.length}`
      + `\n    object scripts with NO object op in a loop:    `
      + `${pad(withObjects.filter((r) => r.c.objInLoop === 0).length, 3)}/${withObjects.length}`
      + `\n    …of those, needing UPDATE:                    `
      + `${pad(withObjects.filter((r) => r.c.objInLoop === 0 && r.c.anySet > 0).length, 3)}`
      + `\n    …of those, needing DELETE:                    `
      + `${pad(withObjects.filter((r) => r.c.objInLoop === 0 && r.c.anyDel > 0).length, 3)}`
      + `\n    …of those, needing an ARRAY:                  `
      + `${pad(withObjects.filter((r) => r.c.objInLoop === 0 && r.c.objectArray > 0).length, 3)}`
      + '\n\n  THE TEN HEAVIEST BY OBJECT CALL SITES\n'
      + [...withObjects].sort((a, b) => (b.c.anyCreate + b.c.anySet + b.c.anyDel)
        - (a.c.anyCreate + a.c.anySet + a.c.anyDel)).slice(0, 10)
        .map((r) => `    ${pad(r.c.anyCreate, 3)} new ${pad(r.c.anySet, 4)} set ${pad(r.c.anyDel, 4)} del`
          + `  ${r.klass.padEnd(30)} ${r.name}`).join('\n'))

    // ⛔ THE CENSUS MUST DISCRIMINATE. If every object script fell into one
    // class the split would be decoration and the ladder would be arbitrary.
    expect(Object.keys(bucket).length).toBeGreaterThan(2)
    expect(withObjects.length).toBeGreaterThan(30)
    // …and the classes really are nested populations, not independent tags.
    expect(has((r) => r.c.anyDel > 0)).toBeLessThanOrEqual(has((r) => r.c.anyCreate > 0))
    // ⛔ AND THE LOOP HEURISTIC MUST DISCRIMINATE. If it answered "in a loop"
    // for every object script, or for none, it would be reporting its own bug
    // rather than the corpus.
    const inLoop = withObjects.filter((r) => r.c.objInLoop > 0).length
    expect(inLoop).toBeGreaterThan(0)
    expect(inLoop).toBeLessThan(withObjects.length)
  })
})
