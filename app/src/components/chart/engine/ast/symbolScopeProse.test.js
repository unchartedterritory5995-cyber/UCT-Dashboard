// ⭐ The rail for `symbolScopeProse.js`: the bundle's copy of `symbolScope.json`
// keeps exactly what the runtime reads, and the engine builds the SAME tables
// from it as from the full file. See that module's header for why it exists.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import FULL from './symbolScope.json'
import { KEEP, stripSymbolScope } from './symbolScopeProse'

const SRC = path.resolve(__dirname, '../../../..')

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') sourceFiles(p, out) }
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.|\.measure\./.test(e.name)) out.push(p)
  }
  return out
}

// ⛔ CODE, NEVER PROSE: comments are stripped before any match, so a comment
// naming `SYMBOL_SCOPE.something` can never count as a read.
const withoutComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

const ACCESS = /SYMBOL_SCOPE(?:\s*&&\s*SYMBOL_SCOPE)?\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])/g
function accessedKeys(text) {
  const keys = new Set()
  for (const m of withoutComments(text).matchAll(ACCESS)) keys.add(m[1] || m[2])
  return keys
}

describe('symbolScope.json in the bundle — the data the runtime reads, and no prose', () => {
  const importers = sourceFiles(SRC).filter((f) => /from\s+['"][^'"]*symbolScope\.json['"]/.test(fs.readFileSync(f, 'utf8')))

  it('every importer binds it as SYMBOL_SCOPE (so the access scan below sees every read)', () => {
    // non-vacuity: the engine really does import it
    expect(importers.length).toBeGreaterThanOrEqual(2)
    for (const f of importers) {
      expect(fs.readFileSync(f, 'utf8'), path.relative(SRC, f)).toMatch(/import\s+SYMBOL_SCOPE\s+from\s+['"][^'"]*symbolScope\.json['"]/)
    }
  })

  it('KEEP is exactly the set of top-level keys the running product reads', () => {
    const read = new Set()
    for (const f of importers) for (const k of accessedKeys(fs.readFileSync(f, 'utf8'))) read.add(k)
    expect([...read].sort()).toEqual([...KEEP].sort())
  })

  it('⛔ CONTROL — the scan sees a real read and ignores the same text in a comment', () => {
    expect([...accessedKeys('x = SYMBOL_SCOPE && SYMBOL_SCOPE.tick_size')]).toEqual(['tick_size'])
    expect([...accessedKeys('// SYMBOL_SCOPE.not_read\n/* SYMBOL_SCOPE.nor_this */')]).toEqual([])
  })

  it('drops only `_` entries inside a kept key, and every key the runtime does not read', () => {
    const { doc, dropped, savedBytes } = stripSymbolScope({
      tick_size: { _: 'why', NYSE: { minmov: 1, pricescale: 100, _note: 'kept inside a row' } },
      pending_measurement: { tickerid: 'unwitnessed' },
      _header: 'prose',
      store_to_pine: { NYSE: 'NYSE' },
    })
    expect(doc).toEqual({
      tick_size: { NYSE: { minmov: 1, pricescale: 100, _note: 'kept inside a row' } },
      pending_measurement: { tickerid: 'unwitnessed' },
    })
    expect(dropped.sort()).toEqual(['_header', 'store_to_pine', 'tick_size._'].sort())
    expect(savedBytes).toBeGreaterThan(0)
  })

  it('the real file actually shrinks (the build step is not a no-op)', () => {
    const { savedBytes } = stripSymbolScope(FULL)
    expect(savedBytes).toBeGreaterThan(JSON.stringify(FULL).length / 3)
  })

  it('⭐⭐ the engine builds the SAME tables from the stripped document', async () => {
    const full = {
      bind: await import('./bind.js'),
      pine: await import('./pine.js'),
    }
    const snapshot = ({ bind, pine }) => ({
      tick: bind.SYMBOL_TICK_SIZE,
      confirmed: bind.SYMBOL_EXCHANGE_CONFIRMED,
      unserved: pine.BUILTIN_SYMBOL_UNSERVED,
      screen: pine.BUILTIN_SYMBOL_SCREEN_UNSERVED,
      pending: Object.fromEntries(Object.keys(FULL.pending_measurement || {})
        .filter((k) => !k.startsWith('_'))
        .map((k) => {
          try { bind.foldText({ type: 'symtext', name: k }, {}); return [k, null] }
          catch (e) { return [k, e.message] }
        })),
    })
    const want = snapshot(full)
    // non-vacuity: every table the engine builds from this file is populated
    expect(Object.keys(want.tick).length).toBeGreaterThan(0)
    expect(Object.keys(want.unserved).length + Object.keys(want.screen).length).toBeGreaterThan(0)

    vi.resetModules()
    vi.doMock('./symbolScope.json', () => ({ default: stripSymbolScope(FULL).doc }))
    const stripped = { bind: await import('./bind.js'), pine: await import('./pine.js') }
    vi.doUnmock('./symbolScope.json')
    expect(snapshot(stripped)).toEqual(want)
  }, 120000)
})
