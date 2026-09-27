// app/src/components/chart/engine/ast/objectLoss.test.js
//
// ─── THE DROP-REASON CLASSIFICATION IS DERIVED FROM THE PASS, NEVER TYPED ────
//
// `objectLoss.js` classifies every drop reason `pine.js::buildObjectProgram`
// emits (owner ruling 2026-09-27, option b). A table typed beside the code it
// describes is the drift this repo keeps paying for, so these rails READ the
// `dropped(...)` call sites out of `pine.js` and the op kinds out of
// `pineObjects.js`, and fail by name on a key the table does not classify — or
// on a table entry the pass no longer emits.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  classifyDropKey, classifyReaderName, assessObjectLoss, objectLossNote,
  DROP_KEYS, GUARD_KINDS, DROP_KEY_FAMILIES, LOSS,
} from './objectLoss'
import { translatePine } from './pine'

const HERE = path.resolve(process.cwd(), 'src/components/chart/engine/ast')
const REPO = path.resolve(process.cwd(), '..')
/** Comments stripped, so prose that NAMES a call is never read as the call. */
const code = (f) => fs.readFileSync(path.join(HERE, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const PINE = code('pine.js')
const READER = code('pineObjects.js')

/** Every argument handed to `dropped(...)` in the object pass. */
const DROP_CALLS = [...PINE.matchAll(/\bdropped\(\s*(['`])([^'`]+)\1\s*\)/g)].map((m) => m[2])
const LITERAL_KEYS = [...new Set(DROP_CALLS.filter((k) => !k.includes('${')))].sort()
const TEMPLATE_PREFIXES = [...new Set(DROP_CALLS.filter((k) => k.includes('${'))
  .map((k) => k.slice(0, k.indexOf('${'))))].sort()

/** Every op kind the reader emits: `k: '<kind>'` literals and `coll_<method>`. */
const READER_KINDS = (() => {
  const kinds = new Set([...READER.matchAll(/\bk:\s*'([a-z_]+)'/g)].map((m) => m[1]))
  const calls = READER.match(/COLLECTION_CALLS\s*=\s*Object\.freeze\(new Set\(\[([^\]]+)\]/)
  for (const m of (calls ? calls[1] : '').matchAll(/'([a-z]+)'/g)) kinds.add(`coll_${m[1]}`)
  return [...kinds].sort()
})()

describe('⛔ every drop reason the pass emits is classified', () => {
  it('non-vacuity: the source scan finds the pass\'s real call sites', () => {
    // Named members the pass is known to emit, so an empty scan cannot pass.
    expect(LITERAL_KEYS).toContain('delete:target')
    expect(LITERAL_KEYS).toContain('cell:text')
    expect(TEMPLATE_PREFIXES).toEqual(expect.arrayContaining(['guard:', 'create:', 'coll:']))
    expect(READER_KINDS).toEqual(expect.arrayContaining(['create', 'delete', 'loop', 'coll_push']))
  })

  it('every LITERAL key has its own entry — none falls through to "unclassified"', () => {
    const missing = LITERAL_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(DROP_KEYS, k))
    expect(missing).toEqual([])
  })

  it('and every table entry is a key the pass still emits — no dead rows', () => {
    const dead = Object.keys(DROP_KEYS).filter((k) => !LITERAL_KEYS.includes(k))
    expect(dead).toEqual([])
  })

  it('every TEMPLATED key has a family, and `guard:` covers every reader op kind', () => {
    const families = DROP_KEY_FAMILIES.map((f) => f.prefix)
    const unhandled = TEMPLATE_PREFIXES.filter((p) => p !== 'guard:' && !families.includes(p))
    expect(unhandled).toEqual([])
    const unguarded = READER_KINDS.filter((k) => !Object.prototype.hasOwnProperty.call(GUARD_KINDS, k))
    expect(unguarded).toEqual([])
  })

  it('⛔ an unknown key is REFUSED, never guessed', () => {
    expect(classifyDropKey('something:new').cls).toBe(LOSS.REMOVES)
    expect(classifyDropKey('guard:teleport').cls).toBe(LOSS.REMOVES)
    // CONTROL: a known partial key is not caught by that fallback.
    expect(classifyDropKey('cell:text').cls).toBe(LOSS.PARTIAL)
  })

  it('the classes that decide the ruling, pinned by name', () => {
    for (const k of ['delete:target', 'guard:delete', 'clear:target', 'clear:range', 'guard:clear']) {
      expect(classifyDropKey(k).cls, k).toBe(LOSS.REMOVES)
    }
    for (const k of ['guard:loop', 'loop:bounds']) expect(classifyDropKey(k).cls, k).toBe(LOSS.LOOP)
    for (const k of ['coll:push', 'coll:set', 'coll:remove', 'coll:pop', 'guard:coll_push']) {
      expect(classifyDropKey(k).cls, k).toBe(LOSS.LIST)
    }
    for (const k of ['create:label', 'guard:create', 'update:props', 'update:target', 'cell:text',
      'cellpatch:bgcolor', 'loop:empty']) {
      expect(classifyDropKey(k).cls, k).toBe(LOSS.PARTIAL)
    }
    expect(classifyReaderName('box.delete').cls).toBe(LOSS.REMOVES)
    expect(classifyReaderName('table.clear').cls).toBe(LOSS.REMOVES)
    expect(classifyReaderName('array.remove').cls).toBe(LOSS.LIST)
    expect(classifyReaderName('table.merge_cells').cls).toBe(LOSS.PARTIAL)
  })
})

describe('⭐ the counts are one unit — N of M never reads "62 of 29"', () => {
  const files = fs.readdirSync(path.join(REPO, 'corpus', 'committed'))
    .filter((f) => f.endsWith('.pine')).sort()

  it('droppedOps <= attemptedOps on every committed corpus script', () => {
    expect(files.length).toBeGreaterThan(200)
    const bad = []
    let lossy = 0
    for (const f of files) {
      const src = fs.readFileSync(path.join(REPO, 'corpus', 'committed', f), 'utf8')
      let t
      // A script the translator throws on never reaches a door; nothing to count.
      try { t = translatePine(src, { strict: true }) } catch { continue }
      const d = t.objectDiagnostics || {}
      if (!d.droppedOps) continue
      lossy += 1
      if (!(d.droppedOps <= d.attemptedOps)) bad.push(`${f}: ${d.droppedOps} of ${d.attemptedOps}`)
    }
    expect(lossy).toBeGreaterThan(50) // non-vacuity: the corpus really has losses
    expect(bad).toEqual([])
  }, 120000)
})

describe('⭐ a lost removal only counts when it could remove something DRAWN', () => {
  const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

  it('a lost `label.delete` beside a DRAWN label → removes', () => {
    // `f(...)` is a call this pass cannot read, so the delete's condition drops.
    const t = translatePine(HEAD + [
      'var label lb = na',
      'if close > open',
      '    lb := label.new(bar_index, high, "x")',
      'if weird_unreadable_fn(close)',
      '    label.delete(lb)',
      'plot(close)',
    ].join('\n'), { strict: true })
    const loss = assessObjectLoss(t)
    expect(t.objectDiagnostics.dropReasons['guard:delete']).toBe(1)
    expect(loss.verdict).toBe('removes')
  })

  it('…and beside NO drawn label → partial, because nothing extra stays on screen', () => {
    const t = translatePine(HEAD + [
      'var label lb = na',
      'var box bx = box.new(bar_index, high, bar_index + 1, low)',
      'if weird_unreadable_fn(close)',
      '    label.delete(lb)',
      'plot(close)',
    ].join('\n'), { strict: true })
    const loss = assessObjectLoss(t)
    expect(t.objectDiagnostics.dropReasons['guard:delete']).toBe(1)
    expect(t.objectDiagnostics.lostRemovals).toEqual([
      { via: 'guard:delete', family: 'label', reaches: false },
    ])
    expect(loss.verdict).toBe('partial')
  })

  it('⛔ a translation with no `lostRemovals` record is read as reaching', () => {
    const t = { objectDiagnostics: { droppedOps: 1, attemptedOps: 2, dropReasons: { 'delete:target': 1 } } }
    expect(assessObjectLoss(t).verdict).toBe('removes')
  })
})

describe('the sentences', () => {
  it('partial: the owner\'s words, both counts from the pass, and what M is', () => {
    const n = objectLossNote({ verdict: 'partial', dropped: 3, attempted: 10, removes: [], readerNames: [] })
    expect(n.name).toBe('Drawings')
    expect(n.note).toMatch(/^3 of 10 drawing elements in this script aren't supported yet/)
    expect(n.note).toContain('The 10 are every drawing step this chart tried to carry')
  })

  it('clean: no sentence at all', () => {
    expect(objectLossNote({ verdict: 'clean', dropped: 0, attempted: 4, removes: [], readerNames: [] }))
      .toBe(null)
  })
})
