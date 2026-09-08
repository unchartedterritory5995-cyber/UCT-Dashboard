// tools/c3b_object_census.mjs
//
// ─── C3B PHASE 0 — THE EXACT OBJECT CENSUS, TWICE ───────────────────────────
//
//   node tools/c3b_object_census.mjs            # report + write tools/c3b_out/census.json
//   node tools/c3b_object_census.mjs --json     # JSON only
//
// ⛔⛔ TWO DENOMINATORS, NEVER MIXED. The owner's correction to the C3B premise
// is the whole reason this file exists:
//
//   A. ALL 46 object-demand scripts        — what Pine authors WRITE
//   B. THE 27 execution-reachable ones     — what an object model can actually
//                                            serve while RISK-043 stands
//
// A headline that quotes 46 while the architecture serves 27 is the exact
// optimism this wave was corrected for. Every aggregate below is emitted for
// BOTH populations, labelled, and the report refuses to print a bare total.
//
// ⚠️ THIS IS A SOURCE-TEXT CENSUS AND IT SAYS SO. It counts what authors wrote,
// after stripping comments and string literals. It cannot know that a branch is
// dead. Where a heuristic is used (loop bodies, conditional blocks) it is named
// and its discrimination is asserted by `objectCensusExact.test.js` — a
// heuristic that answered "yes" for every script would be reporting its own bug
// rather than the corpus.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OOS = path.join(ROOT, 'tests', 'fixtures', 'pine_oos')
const OUT_DIR = path.join(ROOT, 'tools', 'c3b_out')

export const FAMILIES = ['line', 'label', 'box', 'table', 'polyline', 'linefill']

/** Strip `//` comments without eating a `//` inside a string literal. */
export function stripComments(src) {
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

const all = (s, re) => [...s.matchAll(re)]
const n = (s, re) => all(s, re).length
const callRe = (name) => new RegExp(`(^|[^A-Za-z0-9_.])${name.replace('.', '\\.')}\\s*\\(`, 'g')

/** `line.set_xy1(` → tally by METHOD NAME, because "12 set_* calls" cannot tell
 *  you whether to implement `set_xy1` or `set_color`. */
function methodTally(s, ns, kind) {
  const re = new RegExp(`(^|[^A-Za-z0-9_.])${ns}\\.(${kind}_[a-z_0-9]+)\\s*\\(`, 'g')
  const t = {}
  for (const m of all(s, re)) t[m[2]] = (t[m[2]] || 0) + 1
  return t
}

const indentOf = (l) => (l.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length
const OBJ_OP = /(^|[^A-Za-z0-9_.])(line|label|box|table|polyline|linefill)\.(new|set_[a-z_0-9]+|get_[a-z_0-9]+|delete|cell|cell_set_[a-z_0-9]+|clear)\s*\(/

/**
 * Lines carrying an object op that sit inside a `for`/`while` BODY.
 *
 * ⛔⛔ THE MOST DECISION-RELEVANT HEURISTIC IN THIS FILE. RISK-043 keeps
 * generalized loop execution unsupported and C3B may not reopen it, so a script
 * that builds its objects inside a loop stays BLOCKED however good the object
 * model is. This is what separates population A from population B.
 *
 * ⚠️ Pine blocks are INDENTATION. Walks down from each header while the indent
 * stays deeper. Known limits, stated rather than hidden: a one-line body on the
 * header itself is handled separately, and a deeper-indented `if` inside a loop
 * counts as inside the loop — which is correct.
 */
export function objectOpLinesInLoops(src) {
  const lines = src.split(/\r?\n/)
  const hit = new Set()
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    if (!/(^|[^A-Za-z0-9_])(for|while)[\s(\[]/.test(l)) continue
    const base = indentOf(l)
    if (OBJ_OP.test(l.replace(/^[^=]*\b(for|while)\b/, ''))) hit.add(i)
    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j]
      if (!b.trim()) continue
      if (indentOf(b) <= base) break
      if (OBJ_OP.test(b)) hit.add(j)
    }
  }
  return hit
}

/** Object ops that sit under an `if`/`else`/`switch` header, or inside a
 *  ternary. CONDITIONAL LIFECYCLE is the reason identity cannot be inferred
 *  from position: the same source line runs on some bars and not others. */
export function conditionalObjectOps(src) {
  const lines = src.split(/\r?\n/)
  let create = 0; let update = 0; let del = 0
  const bump = (line) => {
    if (/(line|label|box|table|polyline|linefill)\.new\s*\(/.test(line)) create += 1
    if (/(line|label|box|table)\.(set_[a-z_0-9]+|cell|cell_set_[a-z_0-9]+)\s*\(/.test(line)) update += 1
    if (/(line|label|box|table|polyline|linefill)\.(delete|clear)\s*\(/.test(line)) del += 1
  }
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    // a ternary on this very line
    if (/\?/.test(l) && OBJ_OP.test(l)) { bump(l); continue }
    if (!/(^|[^A-Za-z0-9_])(if|else|switch)[\s(:]/.test(l)) continue
    const base = indentOf(l)
    if (OBJ_OP.test(l)) bump(l)
    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j]
      if (!b.trim()) continue
      if (indentOf(b) <= base) break
      if (OBJ_OP.test(b)) bump(b)
    }
  }
  return { create, update, del }
}

/** Variables that hold an object-reference COLLECTION, and the operations
 *  actually applied to them. ⛔ `array.new<UserType>()` is NOT one of these —
 *  a UDT array is a different (unsupported) demand and counting it here would
 *  inflate the collection case that decides part of the architecture. */
export function collectionDemand(s) {
  const vars = new Set()
  for (const m of all(s, /\b(?:var\s+)?(?:array\s*<\s*(line|label|box|table|polyline|linefill)\s*>\s*)?([A-Za-z_]\w*)\s*=\s*array\.new_(line|label|box|table|polyline|linefill)\s*\(/g)) {
    vars.add(m[2])
  }
  for (const m of all(s, /\b(?:var\s+)?array\s*<\s*(line|label|box|table|polyline|linefill)\s*>\s*([A-Za-z_]\w*)/g)) {
    vars.add(m[2])
  }
  for (const m of all(s, /\b(?:var\s+)?(line|label|box|table)\s*\[\s*\]\s*([A-Za-z_]\w*)/g)) {
    vars.add(m[2])
  }
  const ops = {}
  let opTotal = 0
  if (vars.size) {
    const names = [...vars].map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const re = new RegExp(`array\\.([a-z_0-9]+)\\s*\\(\\s*(?:${names})\\b`, 'g')
    for (const m of all(s, re)) { ops[m[1]] = (ops[m[1]] || 0) + 1; opTotal += 1 }
  }
  return { vars: [...vars].sort(), ops, opTotal }
}

/** `var line l = na` — a reference that must SURVIVE the bar it was made on. */
export function varHeldRefs(s) {
  const t = {}
  for (const m of all(s, /\bvar(?:ip)?\s+(line|label|box|table|polyline|linefill)\s+([A-Za-z_]\w*)/g)) {
    t[m[2]] = m[1]
  }
  return t
}

export function censusOf(raw) {
  const s = stripComments(raw)
  const lines = s.split(/\r?\n/)
  const loopLines = objectOpLinesInLoops(s)

  const fam = {}
  for (const ns of FAMILIES) {
    fam[ns] = {
      new: n(s, callRe(`${ns}.new`)),
      set: methodTally(s, ns, 'set'),
      get: methodTally(s, ns, 'get'),
      delete: n(s, callRe(`${ns}.delete`)),
    }
  }
  fam.table.cell = n(s, callRe('table.cell'))
  fam.table.cell_set = methodTally(s, 'table', 'cell_set')
  fam.table.clear = n(s, callRe('table.clear'))

  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
  const creates = FAMILIES.reduce((a, ns) => a + fam[ns].new, 0)
  const updates = FAMILIES.reduce((a, ns) => a + sum(fam[ns].set), 0)
    + fam.table.cell + sum(fam.table.cell_set)
  const deletes = FAMILIES.reduce((a, ns) => a + fam[ns].delete, 0) + fam.table.clear
  const gets = FAMILIES.reduce((a, ns) => a + sum(fam[ns].get), 0)

  const maxCounts = {}
  for (const m of all(s, /max_([a-z_]+)_count\s*=\s*(\d+)/g)) maxCounts[m[1]] = Number(m[2])

  const collections = collectionDemand(s)
  const varRefs = varHeldRefs(s)
  const cond = conditionalObjectOps(s)

  // object ops that are NOT inside any loop body
  let opsOutsideLoops = 0
  let opsInsideLoops = 0
  lines.forEach((l, i) => {
    if (!OBJ_OP.test(l)) return
    if (loopLines.has(i)) opsInsideLoops += 1
    else opsOutsideLoops += 1
  })

  const familiesUsed = FAMILIES.filter((ns) => fam[ns].new > 0
    || sum(fam[ns].set) > 0 || fam[ns].delete > 0
    || (ns === 'table' && (fam.table.cell > 0 || sum(fam.table.cell_set) > 0)))

  return {
    fam,
    familiesUsed,
    creates,
    updates,
    deletes,
    gets,
    maxCounts,
    collections,
    varRefs,
    reassign: n(s, /\b\w+\s*:=\s*(line|label|box|table|polyline|linefill)\.new\s*\(/g),
    conditional: cond,
    loops: n(s, /(^|[^A-Za-z0-9_])for\s+\w+\s*=/g) + n(s, /(^|[^A-Za-z0-9_])for\s*\[/g)
      + n(s, /(^|[^A-Za-z0-9_])while\s+/g),
    opsInsideLoops,
    opsOutsideLoops,
    histIndex: n(s, /\b(line|label|box)\w*\s*\[\s*\d+\s*\]/g),
  }
}

/** ⛔ THE LIFECYCLE TIER IS THE STRONGEST THING THE SCRIPT NEEDS, and the
 *  REQUIREMENT FLAGS are orthogonal to it. Collapsing both into one label would
 *  lose exactly the fact the architecture needs — a CREATE_UPDATE_DELETE script
 *  that also needs a collection is a different build than one that does not. */
export function classify(c) {
  if (!c.creates && !c.fam.table.cell) return { tier: 'NONE', flags: [] }
  const tier = c.deletes ? 'CREATE_UPDATE_DELETE' : (c.updates ? 'CREATE_UPDATE' : 'CREATE_ONLY')
  const flags = []
  if (Object.keys(c.varRefs).length || c.reassign) flags.push('VAR_REFERENCE_REQUIRED')
  if (c.collections.vars.length) flags.push('COLLECTION_REQUIRED')
  if (c.fam.table.new || c.fam.table.cell) flags.push('TABLE_REQUIRED')
  if (c.familiesUsed.length > 1) flags.push('MULTI_FAMILY')
  return { tier, flags }
}

export function loadRows() {
  const files = fs.readdirSync(OOS).filter((f) => f.endsWith('.pine')).sort()
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(OOS, f), 'utf8')
    const c = censusOf(raw)
    const k = classify(c)
    return {
      name: f.replace(/\.pine$/, ''),
      c,
      tier: k.tier,
      flags: k.flags,
      hasObjects: k.tier !== 'NONE',
      // ⛔ REACHABLE means: uses objects AND builds none of them inside a loop.
      reachable: k.tier !== 'NONE' && c.opsInsideLoops === 0,
    }
  })
}

/** Aggregate one population. Every caller must name which one it is. */
export function aggregate(rows, label) {
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
  const famScripts = {}
  const famCalls = {}
  const setMethods = {}
  const getMethods = {}
  for (const ns of FAMILIES) {
    famScripts[ns] = rows.filter((r) => r.c.fam[ns].new > 0
      || (ns === 'table' && r.c.fam.table.cell > 0)).length
    famCalls[ns] = {
      new: rows.reduce((a, r) => a + r.c.fam[ns].new, 0),
      set: rows.reduce((a, r) => a + sum(r.c.fam[ns].set), 0),
      get: rows.reduce((a, r) => a + sum(r.c.fam[ns].get), 0),
      delete: rows.reduce((a, r) => a + r.c.fam[ns].delete, 0),
    }
    for (const r of rows) {
      for (const [k, v] of Object.entries(r.c.fam[ns].set)) {
        const key = `${ns}.${k}`
        setMethods[key] = (setMethods[key] || 0) + v
      }
      for (const [k, v] of Object.entries(r.c.fam[ns].get)) {
        const key = `${ns}.${k}`
        getMethods[key] = (getMethods[key] || 0) + v
      }
    }
  }
  const cellSet = {}
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.c.fam.table.cell_set)) {
      cellSet[`table.${k}`] = (cellSet[`table.${k}`] || 0) + v
    }
  }
  const collOps = {}
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.c.collections.ops)) collOps[k] = (collOps[k] || 0) + v
  }
  const maxDecls = {}
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.c.maxCounts)) {
      (maxDecls[k] = maxDecls[k] || []).push(v)
    }
  }
  const has = (p) => rows.filter(p).length
  const tiers = {}
  for (const r of rows) tiers[r.tier] = (tiers[r.tier] || 0) + 1
  const flagCounts = {}
  for (const r of rows) for (const f of r.flags) flagCounts[f] = (flagCounts[f] || 0) + 1

  return {
    label,
    scripts: rows.length,
    famScripts,
    famCalls,
    setMethods,
    getMethods,
    cellSet,
    tableCell: rows.reduce((a, r) => a + r.c.fam.table.cell, 0),
    tableClear: rows.reduce((a, r) => a + r.c.fam.table.clear, 0),
    tiers,
    flagCounts,
    needUpdate: has((r) => r.c.updates > 0),
    needDelete: has((r) => r.c.deletes > 0),
    needVarRef: has((r) => Object.keys(r.c.varRefs).length > 0),
    needReassign: has((r) => r.c.reassign > 0),
    needCollection: has((r) => r.c.collections.vars.length > 0),
    collectionOps: collOps,
    needTable: has((r) => r.c.fam.table.new > 0 || r.c.fam.table.cell > 0),
    multiFamily: has((r) => r.c.familiesUsed.length > 1),
    conditionalCreate: has((r) => r.c.conditional.create > 0),
    conditionalUpdate: has((r) => r.c.conditional.update > 0),
    conditionalDelete: has((r) => r.c.conditional.del > 0),
    declaresMax: has((r) => Object.keys(r.c.maxCounts).length > 0),
    maxDeclarations: Object.fromEntries(Object.entries(maxDecls).map(([k, v]) => [k, {
      scripts: v.length, min: Math.min(...v), max: Math.max(...v),
      median: v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)],
    }])),
    histIndex: has((r) => r.c.histIndex > 0),
  }
}

function report(rows) {
  const objects = rows.filter((r) => r.hasObjects)
  const reachable = rows.filter((r) => r.reachable)
  const blocked = objects.filter((r) => !r.reachable)
  const A = aggregate(objects, 'A · ALL OBJECT-DEMAND SCRIPTS')
  const B = aggregate(reachable, 'B · EXECUTION-REACHABLE OBJECT SCRIPTS')

  const pad = (v, w) => String(v).padStart(w)
  const L = []
  L.push('')
  L.push('=== C3B PHASE 0 — EXACT OBJECT CENSUS ===')
  L.push('')
  L.push(`  corpus                      ${rows.length} OOS scripts (frozen)`)
  L.push(`  A · object demand           ${objects.length}/${rows.length}`)
  L.push(`  B · execution-reachable     ${reachable.length}/${objects.length}  ⭐ C3B TARGETS THIS`)
  L.push(`      loop-blocked            ${blocked.length}/${objects.length}  (RISK-043 stands)`)
  L.push('')
  for (const agg of [A, B]) {
    L.push(`  ── ${agg.label} (n=${agg.scripts}) ─────────────────────────`)
    L.push('     family     scripts     new    set_*   get_*  delete')
    for (const ns of FAMILIES) {
      const f = agg.famCalls[ns]
      if (!agg.famScripts[ns] && !f.new && !f.set && !f.delete) continue
      L.push(`       ${ns.padEnd(9)}${pad(agg.famScripts[ns], 6)}${pad(f.new, 9)}${pad(f.set, 8)}${pad(f.get, 8)}${pad(f.delete, 8)}`)
    }
    L.push(`       table.cell ${pad(agg.tableCell, 5)} call sites   ·  cell_set_* ${Object.values(agg.cellSet).reduce((a, b) => a + b, 0)}  ·  clear/delete ${agg.tableClear}`)
    L.push('')
    L.push('     LIFECYCLE TIER (strongest thing the script needs)')
    for (const [k, v] of Object.entries(agg.tiers).sort((a, b) => b[1] - a[1])) {
      L.push(`       ${pad(v, 3)}/${agg.scripts}  ${k}`)
    }
    L.push('     REQUIREMENT FLAGS (orthogonal to tier; a script can carry several)')
    for (const [k, v] of Object.entries(agg.flagCounts).sort((a, b) => b[1] - a[1])) {
      L.push(`       ${pad(v, 3)}/${agg.scripts}  ${k}`)
    }
    L.push('')
    L.push(`       needs UPDATE            ${pad(agg.needUpdate, 3)}/${agg.scripts}`)
    L.push(`       needs DELETE            ${pad(agg.needDelete, 3)}/${agg.scripts}`)
    L.push(`       var-held object ref     ${pad(agg.needVarRef, 3)}/${agg.scripts}`)
    L.push(`       reassigns a ref (:=)    ${pad(agg.needReassign, 3)}/${agg.scripts}`)
    L.push(`       object COLLECTION       ${pad(agg.needCollection, 3)}/${agg.scripts}`)
    L.push(`       TABLE                   ${pad(agg.needTable, 3)}/${agg.scripts}`)
    L.push(`       MULTI-FAMILY            ${pad(agg.multiFamily, 3)}/${agg.scripts}`)
    L.push(`       conditional CREATE      ${pad(agg.conditionalCreate, 3)}/${agg.scripts}`)
    L.push(`       conditional UPDATE      ${pad(agg.conditionalUpdate, 3)}/${agg.scripts}`)
    L.push(`       conditional DELETE      ${pad(agg.conditionalDelete, 3)}/${agg.scripts}`)
    L.push(`       declares max_*_count    ${pad(agg.declaresMax, 3)}/${agg.scripts}`)
    L.push(`       historical ref index    ${pad(agg.histIndex, 3)}/${agg.scripts}`)
    if (Object.keys(agg.collectionOps).length) {
      L.push(`       collection ops: ${Object.entries(agg.collectionOps).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' ')}`)
    }
    if (Object.keys(agg.maxDeclarations).length) {
      L.push('       author-declared ceilings:')
      for (const [k, v] of Object.entries(agg.maxDeclarations).sort()) {
        L.push(`         max_${k}_count  ${v.scripts} scripts  min ${v.min} · median ${v.median} · max ${v.max}`)
      }
    }
    L.push('')
  }
  L.push('  ── THE SETTERS THAT ACTUALLY HAVE TO EXIST (population B) ─────────')
  const bSet = Object.entries(B.setMethods).sort((a, b) => b[1] - a[1])
  L.push(bSet.length
    ? bSet.map(([k, v]) => `       ${k.padEnd(28)} ${v}`).join('\n')
    : '       (none)')
  if (Object.keys(B.cellSet).length) {
    L.push(Object.entries(B.cellSet).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `       ${k.padEnd(28)} ${v}`).join('\n'))
  }
  const bGet = Object.entries(B.getMethods).sort((a, b) => b[1] - a[1])
  L.push(`     getters in population B: ${bGet.length ? bGet.map(([k, v]) => `${k}×${v}`).join(' ') : 'NONE'}`)
  L.push('')
  L.push('  ── THE REACHABLE 27, ONE LINE EACH ────────────────────────────────')
  for (const r of reachable.sort((a, b) => (b.c.creates + b.c.updates + b.c.deletes)
    - (a.c.creates + a.c.updates + a.c.deletes))) {
    L.push(`     ${pad(r.c.creates, 3)}n ${pad(r.c.updates, 4)}u ${pad(r.c.deletes, 4)}d  `
      + `${r.tier.padEnd(21)} ${(r.flags.join('+') || '—').padEnd(52)} ${r.name}`)
  }
  L.push('')
  L.push('  ── LOOP-BLOCKED OBJECT SCRIPTS ────────────────────────────────────')
  for (const r of blocked.sort((a, b) => b.c.opsInsideLoops - a.c.opsInsideLoops)) {
    L.push(`     ${pad(r.c.opsInsideLoops, 3)} object ops in loop bodies   ${r.name}`)
  }
  L.push('')
  return L.join('\n')
}

const rows = loadRows()
const objects = rows.filter((r) => r.hasObjects)
const reachable = rows.filter((r) => r.reachable)
const payload = {
  generatedAt: new Date().toISOString(),
  corpus: rows.length,
  populations: {
    all60: rows.map((r) => r.name),
    objectDemand: objects.map((r) => r.name),
    reachable: reachable.map((r) => r.name),
    loopBlocked: objects.filter((r) => !r.reachable).map((r) => r.name),
  },
  aggregates: {
    A_allObjectDemand: aggregate(objects, 'A'),
    B_reachable: aggregate(reachable, 'B'),
  },
  scripts: rows.map((r) => ({
    name: r.name,
    hasObjects: r.hasObjects,
    reachable: r.reachable,
    tier: r.tier,
    flags: r.flags,
    familiesUsed: r.c.familiesUsed,
    creates: r.c.creates,
    updates: r.c.updates,
    deletes: r.c.deletes,
    gets: r.c.gets,
    setMethods: Object.fromEntries(FAMILIES.flatMap((ns) => Object.entries(r.c.fam[ns].set)
      .map(([k, v]) => [`${ns}.${k}`, v]))),
    cellSetMethods: Object.fromEntries(Object.entries(r.c.fam.table.cell_set)
      .map(([k, v]) => [`table.${k}`, v])),
    tableCell: r.c.fam.table.cell,
    varRefs: r.c.varRefs,
    reassign: r.c.reassign,
    collections: r.c.collections,
    conditional: r.c.conditional,
    maxCounts: r.c.maxCounts,
    loops: r.c.loops,
    opsInsideLoops: r.c.opsInsideLoops,
    opsOutsideLoops: r.c.opsOutsideLoops,
    histIndex: r.c.histIndex,
  })),
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'census.json'), `${JSON.stringify(payload, null, 2)}\n`)
  process.stdout.write(`${report(rows)}\n  written: tools/c3b_out/census.json\n`)
}
