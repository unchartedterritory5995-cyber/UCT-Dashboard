// Rails for the refusal FAMILIES (spec section 4).
//
// ⭐ The guard roster is READ from the engine's own source, never typed here: a
// guard literal the translator or the runtime can emit that falls to `unknown`
// fails BY NAME, so a new guard ships with a family or not at all.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAMILIES, UNKNOWN_FAMILY, familyOf } from './editorStatus'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENGINE = path.join(HERE, '..', 'engine')

function sourcesIn(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\./.test(f))
    .map((f) => path.join(dir, f))
}

const FILES = [
  path.join(ENGINE, 'ast', 'pine.js'),
  // the runtime lane's front end throws most `runtime:*` guards (`runtime:udt-method`,
  // `runtime:call-*-state`, the history guards), so its literals are in the roster too
  path.join(ENGINE, 'ast', 'pineRuntimeFrontend.js'),
  ...sourcesIn(path.join(ENGINE, 'runtime')),
  path.join(HERE, 'memberPane', 'memberPaneDefinition.js'),
  path.join(HERE, 'memberPane', 'runtimeObjectsDoor.js'),
]

function guardLiterals() {
  const out = new Map()
  for (const f of FILES) {
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/'((?:pine|runtime):[a-z0-9-]+)'/g)) {
      if (!out.has(m[1])) out.set(m[1], path.basename(f))
    }
  }
  return out
}

describe('refusal families', () => {
  it('reads a real guard roster (control: the census is not empty)', () => {
    const g = guardLiterals()
    expect(g.size).toBeGreaterThan(60)
    expect(g.has('pine:request')).toBe(true)
  })

  it('every guard the engine can emit has a family (none falls to unknown)', () => {
    const unclassified = [...guardLiterals()].filter(([g]) => familyOf(g).id === UNKNOWN_FAMILY.id)
      .map(([g, f]) => `${g} (${f})`)
    expect(unclassified).toEqual([])
  })

  it('an unmatched guard is unknown, honest and generic (control)', () => {
    expect(familyOf('pine:a-guard-that-does-not-exist').id).toBe('unknown')
    expect(familyOf(null)).toBe(UNKNOWN_FAMILY)
  })

  it('exact names win over prefixes', () => {
    expect(familyOf('pine:offset-literal').id).toBe('language')
    expect(familyOf('pine:offset-negative').id).toBe('presentation')
    expect(familyOf('pine:block').id).toBe('block')
    expect(familyOf('other-symbol:unsupplied').id).toBe('request')
    // `runtime:object-tree-outputs` is exact under shape, ahead of the `runtime:object` prefix
    expect(familyOf('runtime:object-tree-outputs').id).toBe('shape')
  })

  it('the chart door\'s own guards have the families chosen for them (spec section 4)', () => {
    expect(familyOf('pine:paint-pane').id).toBe('presentation')
    expect(familyOf('runtime:na-test').id).toBe('state')
    expect(familyOf('runtime:withheld-all').id).toBe('shape')
    expect(familyOf('runtime:nothing-drawn').id).toBe('shape')
    expect(familyOf('runtime:output-map').id).toBe('fault')
    expect(familyOf('runtime:document').id).toBe('fault')
    expect(familyOf('pine:enum-na').id).toBe('drawing')
    expect(familyOf('pine:enum-named-call').id).toBe('drawing')
    for (const g of ['runtime:killed', 'runtime:not-yet-graded', 'runtime:repaint-unstated']) {
      expect(familyOf(g).id, g).toBe('unverified')
    }
    // a screening fact, not a drawing: the script draws, a screen has nothing to filter on
    expect(familyOf('pine:objects-only').id).toBe('shape')
    // a chart-period read is not data from another symbol
    expect(familyOf('bind:period-reads').id).toBe('period')
  })

  it('pine:function is a built-in refusal (every throw site is a TradingView built-in), not your own function', () => {
    expect(familyOf('pine:function').id).toBe('builtin')
    expect(familyOf('pine:function-def').id).toBe('function')
  })

  it('every family has its row in the spec\'s section 4 table', () => {
    const spec = fs.readFileSync(path.join(HERE, '..', '..', '..', '..', '..', 'docs', 'pine', 'EDITOR-STATUS-PANEL-SPEC.md'), 'utf8')
    const section = spec.slice(spec.indexOf('## 4.'), spec.indexOf('## 5.'))
    expect(section.length).toBeGreaterThan(100) // non-vacuity: the section was found
    for (const f of [...FAMILIES, UNKNOWN_FAMILY]) {
      expect(section, f.id).toContain(`| \`${f.id}\` |`)
    }
  })

  it('no family copy, and no panel source, contains an em dash', () => {
    for (const f of [...FAMILIES, UNKNOWN_FAMILY]) {
      expect(f.label).not.toMatch(/—/)
      expect(f.why).not.toMatch(/—/)
    }
    for (const file of ['editorStatus.js', 'PineEditorStatus.jsx']) {
      expect(fs.readFileSync(path.join(HERE, file), 'utf8')).not.toMatch(/—/)
    }
  })

  it('family ids are unique', () => {
    const ids = FAMILIES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ⭐ SPEC SECTION 4 IS READ, NOT RETYPED: every guard its table lists is asked of
// `familyOf`, so the table and `FAMILIES` cannot drift. An exact listing beats a
// glob (as an exact entry beats a prefix in `familyOf`); a glob is checked through
// every real guard literal it matches that no row lists exactly, or through a probe
// name when it matches none.
function specRows() {
  const spec = fs.readFileSync(path.join(HERE, '..', '..', '..', '..', '..', 'docs', 'pine', 'EDITOR-STATUS-PANEL-SPEC.md'), 'utf8')
    .replace(/\r\n/g, '\n')
  const section = spec.slice(spec.indexOf('## 4.'), spec.indexOf('## 5.'))
  const rows = []
  for (const line of section.split('\n')) {
    const m = /^\| `([a-z]+)` \| ([^|]*) \|/.exec(line)
    if (!m) continue
    const guards = [...m[2].matchAll(/`([^`]+)`/g)].map((g) => g[1]).filter((g) => g.includes(':') && /^[a-z0-9:*-]+$/.test(g))
    rows.push({ family: m[1], guards })
  }
  return rows
}
// a guard (and so a glob) is spelled in `[a-z0-9:-]` only (`specRows` keeps no other token),
// so a glob needs no escaping: `*` stands for the rest of one guard name
const globRe = (glob) => new RegExp('^' + glob.split('*').join('[a-z0-9-]*') + '$')

describe('spec section 4 is the same table as FAMILIES', () => {
  const rows = specRows()
  const exact = new Map()
  for (const r of rows) for (const g of r.guards) if (!g.includes('*')) exact.set(g, r.family)

  it('reads the table (control: every family row, and the guards they list)', () => {
    expect(rows.map((r) => r.family).sort()).toEqual([...FAMILIES.map((f) => f.id), UNKNOWN_FAMILY.id].sort())
    expect(exact.get('pine:request')).toBe('request')
    expect(exact.size).toBeGreaterThan(80)
  })

  it('every guard the table lists exactly has that family in familyOf', () => {
    const wrong = [...exact].filter(([g, fam]) => familyOf(g).id !== fam)
      .map(([g, fam]) => `${g}: spec ${fam}, familyOf ${familyOf(g).id}`)
    expect(wrong).toEqual([])
  })

  it('every glob the table lists answers its family for the guards it covers', () => {
    const roster = [...new Set([...guardLiterals().keys(), ...exact.keys()])]
    const wrong = []
    for (const r of rows) {
      for (const glob of r.guards.filter((g) => g.includes('*'))) {
        const re = globRe(glob)
        const covered = roster.filter((g) => re.test(g) && !exact.has(g))
        const probes = covered.length ? covered : [glob.replace(/\*/g, 'probe')]
        for (const g of probes) if (familyOf(g).id !== r.family) wrong.push(`${g} (${glob}): spec ${r.family}, familyOf ${familyOf(g).id}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('every exact guard in FAMILIES is listed in its own row (exactly, or by a glob of that row)', () => {
    const missing = []
    for (const f of FAMILIES) {
      const row = rows.find((r) => r.family === f.id)
      for (const g of f.exact || []) {
        const listed = !!row && (row.guards.includes(g) || row.guards.some((x) => x.includes('*') && globRe(x).test(g)))
        if (!listed) missing.push(`${g} (${f.id})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('the guards the round-1 review found split between the two now agree', () => {
    expect(familyOf('runtime:udt-method').id).toBe('language')
    expect(familyOf('runtime:call-text-state').id).toBe('language')
    expect(familyOf('runtime:call-undeclared-builtin-state').id).toBe('builtin')
    // control: the prefixes they used to fall to still answer for their siblings
    expect(familyOf('runtime:udt-field').id).toBe('collection')
    expect(familyOf('runtime:call-windowed-state').id).toBe('state')
  })
})
