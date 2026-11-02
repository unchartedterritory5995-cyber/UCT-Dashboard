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
