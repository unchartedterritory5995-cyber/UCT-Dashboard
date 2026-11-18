// P2c — the prefetch facade is a DROP-IN for utils/prefetchBars.
//
// ⭐ THE NAME LIST IS DERIVED, NOT TYPED. Every module under app/src that imports from
// utils/prefetchBars (tests and the BarStore itself excluded) is parsed with an AST and its
// imported names collected; the facade must export each one, of the same kind, and every
// function with the same declared arity (`fn.length`) as the legacy one. A new legacy import
// in any component turns this red until the facade covers it — so P3 S1 can swap the import
// path behind the BARSTORE switch without touching call sites.
// useSymbolHandoff's own export (`peekDisplayable`) is held to the same rule.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* files(p)
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) yield p
  }
}

/** { name → [importer, …] } of every named import from utils/prefetchBars — and from
 *  utils/barsWarm, the warmers' door (2026-11-17), which forwards each name to one of the two. */
function legacyImports() {
  const out = {}
  const targets = new Set([path.join(SRC, 'utils', 'prefetchBars'), path.join(SRC, 'utils', 'barsWarm')])
  for (const f of files(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join('/')
    if (rel.startsWith('data/barStore/') || /(^|\/)(testing|__mocks__|__fixtures__)\//.test(rel)) continue
    const src = fs.readFileSync(f, 'utf8')
    if (!src.includes('prefetchBars') && !src.includes('barsWarm')) continue
    let ast
    try { ast = parse(src) } catch { continue }
    for (const n of ast.body) {
      if (n.type !== 'ImportDeclaration') continue
      const spec = n.source.value
      if (!spec.startsWith('.')) continue
      if (!targets.has(path.resolve(path.dirname(f), spec).replace(/\.js$/, ''))) continue
      for (const s of n.specifiers) {
        const name = s.type === 'ImportSpecifier' ? s.imported.name : null
        if (name) (out[name] ||= []).push(rel)
      }
    }
  }
  return out
}

describe('prefetch facade — same names and signatures as utils/prefetchBars', () => {
  it('derives a non-trivial import list (the walk works)', () => {
    const names = Object.keys(legacyImports())
    expect(names).toEqual(expect.arrayContaining(['prefetchBars', 'prefetchBarsToIDB', 'prepareForDisplay', 'joinPendingBars']))
  })

  it('exports every name the app imports, same kind, same arity', async () => {
    const legacy = await import('../../utils/prefetchBars')
    const facade = await import('./prefetch')
    const door = await import('../../utils/barsWarm')
    const bad = []
    for (const [name, users] of Object.entries(legacyImports())) {
      if (!(name in facade)) { bad.push(`${name}: missing (imported by ${users.join(', ')})`); continue }
      // A door-only helper (barsWarm.createNeighborHold) is store-side by design: the legacy
      // caches have no LRU to pin against, so it has no legacy twin to match.
      if (!(name in legacy) && typeof door[name] === 'function' && !door.WARMER_NAMES.includes(name)) continue
      if (typeof facade[name] !== typeof legacy[name]) bad.push(`${name}: ${typeof facade[name]} vs ${typeof legacy[name]}`)
      else if (typeof legacy[name] === 'function' && facade[name].length !== legacy[name].length) {
        bad.push(`${name}: arity ${facade[name].length} vs ${legacy[name].length}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('every warmer the barsWarm door forwards exists in BOTH modules', async () => {
    const door = await import('../../utils/barsWarm')
    const legacy = await import('../../utils/prefetchBars')
    const facade = await import('./prefetch')
    const names = door.WARMER_NAMES
    expect(names.length).toBeGreaterThanOrEqual(11)
    const bad = names.filter((n) => typeof legacy[n] !== 'function' || typeof facade[n] !== 'function')
    expect(bad).toEqual([])
  })

  it("useSymbolHandoff's peekDisplayable has its equivalent", async () => {
    const handoff = await import('../../hooks/useSymbolHandoff')
    const facade = await import('./prefetch')
    expect(typeof facade.peekDisplayable).toBe('function')
    expect(facade.peekDisplayable.length).toBe(handoff.peekDisplayable.length)
  })

  // ⛔ ONE RE-ASK WINDOW FOR BOTH TYPED WARMS (2026-11-17). The facade used to declare its own
  // `TYPED_FRESH_MS = 60_000` beside the legacy module's: two authorities over one rule, which
  // agree only until one is edited. It now IMPORTS the legacy `TYPED_REASK_MS` and declares no
  // number of its own; read off the AST, so a comment naming the constant is not a declaration.
  it('the typed warm re-asks on the legacy module\'s window, never a number of its own', async () => {
    const ast = parse(fs.readFileSync(path.join(SRC, 'data', 'barStore', 'prefetch.js'), 'utf8'))
    const imported = ast.body.filter((n) => n.type === 'ImportDeclaration' && n.source.value === '../../utils/prefetchBars')
      .flatMap((n) => n.specifiers.map((s) => s.imported?.name))
    expect(imported).toContain('TYPED_REASK_MS')
    const own = []
    const visit = (n) => {
      if (!n || typeof n.type !== 'string') return
      if (n.type === 'VariableDeclarator' && /^TYPED_/.test(n.id?.name || '')) own.push(n.id.name)
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v.type === 'string') visit(v)
      }
    }
    visit(ast)
    expect(own, 'the facade declares its own typed-warm constant').toEqual([])
    const legacy = await import('../../utils/prefetchBars')
    expect(legacy.TYPED_REASK_MS).toBeGreaterThan(0)
  })
})
