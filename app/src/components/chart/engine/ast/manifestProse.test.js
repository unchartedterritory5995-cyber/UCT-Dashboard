// app/src/components/chart/engine/ast/manifestProse.test.js

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { stripProse, KEEP, STRUCTURAL } from './manifestProse.js'
import TABLE from './closedTable.json'

const ROOT = path.resolve(process.cwd(), '..')

/** Every non-test source file in BOTH lanes. */
function sources() {
  const out = []
  for (const base of ['app/src', 'api']) {
    const stack = [path.join(ROOT, base)]
    while (stack.length) {
      const dir = stack.pop()
      let entries = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { continue }
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { stack.push(p); continue }
        if (!/\.(js|jsx|py)$/.test(e.name)) continue
        if (e.name.includes('.test.') || e.name.endsWith('_test.py')) continue
        if (e.name === 'manifestProse.js') continue
        try { out.push(fs.readFileSync(p, 'utf8')) } catch (err) { /* unreadable */ }
      }
    }
  }
  return out
}

/** ⛔ COMMENTS STRIPPED FIRST, AND THAT IS THE WHOLE DIFFICULTY. These keys are
 *  NAMED in prose constantly — `_functions_cumulative` is cited in a dozen
 *  comments across both lanes — so a bare substring search reports every one of
 *  them as "used" and the strip becomes a no-op that looks like it works. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '')
}

/** Which `_` keys does the running product READ, as data? */
function accessedKeys() {
  const bodies = sources().map(withoutComments)
  const found = new Set()
  for (const key of Object.keys(TABLE).filter((k) => k.startsWith('_'))) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\.\\s*${esc}\\b|\\[\\s*['"]${esc}['"]\\s*\\]|get\\(\\s*['"]${esc}['"]`)
    if (bodies.some((b) => re.test(b))) found.add(key)
  }
  return found
}

describe('the strip is safe, and the rail derives what safe means', () => {
  it('⛔⛔ every key the product READS survives the strip', () => {
    // ⭐ THE LOAD-BEARING ONE. A build step that dropped a key the code reads
    // would fail in a browser, at runtime, as `undefined` rather than a refusal —
    // the single worst way for this to go wrong. So the keep list is checked
    // against a walk of the real source, not against memory.
    const accessed = accessedKeys()
    expect(accessed.size, 'the walk found no property access at all — it is broken')
      .toBeGreaterThan(0)
    const missing = [...accessed].filter((k) => !KEEP.includes(k))
    expect(missing, `these manifest keys are READ but would be stripped:\n${missing.join('\n')}`)
      .toEqual([])
  })

  it('⛔ the keep list has no passengers — every entry is really read', () => {
    // ⚰️ THE OTHER DIRECTION, and it is what stops `KEEP` becoming a place to file
    // anything somebody was unsure about, which would quietly return the 68KB.
    const accessed = accessedKeys()
    const passengers = KEEP.filter((k) => !accessed.has(k))
    expect(passengers, `kept but never read — remove or justify:\n${passengers.join('\n')}`)
      .toEqual([])
  })

  it('⭐ the strip actually saves something worth doing', () => {
    const { dropped, savedBytes } = stripProse(TABLE)
    expect(dropped.length).toBeGreaterThan(20)
    expect(savedBytes).toBeGreaterThan(50 * 1024)
  })

  it('⛔ the grammar itself is untouched — this may only ever remove prose', () => {
    // ⭐ THE NON-NEGOTIABLE. Everything a formula is made of must survive byte for
    // byte, or the engine in the browser is a different engine from the one on the
    // server and the two-lane conformance guarantee is void.
    const { table } = stripProse(TABLE)
    for (const section of STRUCTURAL) {
      if (TABLE[section] === undefined) continue
      expect(table[section], `${section} was stripped`).toEqual(TABLE[section])
    }
    // and per-entry sentences ride along inside those sections
    expect(table.functions.rsi.sentence).toBe(TABLE.functions.rsi.sentence)
  })

  it('⛔ nothing that survives begins with `_` unless it was kept deliberately', () => {
    const { table } = stripProse(TABLE)
    const survivors = Object.keys(table).filter((k) => k.startsWith('_'))
    expect(survivors.sort()).toEqual([...KEEP].sort())
  })

  it('⛔ it is a pure function — the original document is not mutated', () => {
    const before = JSON.stringify(TABLE)
    stripProse(TABLE)
    expect(JSON.stringify(TABLE)).toBe(before)
  })
})
