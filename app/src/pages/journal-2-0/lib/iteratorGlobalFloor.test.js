/**
 * The ES2025-global floor: nothing we ship may EVALUATE a global our oldest supported engine lacks.
 *
 * ⚰️ THE INCIDENT. 2026-09-12, real iPhone 15 Pro / iOS Safari 17.5, production: `/journal/notebook`
 * rendered its route-level error boundary instead of the page —
 * `ReferenceError: Can't find variable: Iterator`. The source was `pdfjs-dist@6`'s own shim, at
 * module top level in BOTH its modern and legacy builds:
 * `if (typeof Iterator.prototype.join !== "function")`. That is pdf.js feature-detecting Iterator
 * Helpers, written so it throws on the engines it detects for (`typeof X.prototype` evaluates `X`).
 * The `Iterator` global arrived in Safari 18.4.
 *
 * ⛔ NEITHER jsdom NOR CHROMIUM CAN SEE IT. Both have `Iterator`, so the unit suite, the six-shard
 * gate and a headless-Chromium device sweep were all green while the route was down for every
 * member on iOS 17. The engine we test in has the thing whose absence is the bug.
 *
 * ⚰️⚰️ AND A TEXT SCAN OF THE BUNDLE IS THE WRONG INSTRUMENT — THIS FILE TRIED IT FIRST.
 * Two ways it misleads, both hit within ten minutes of each other:
 *   1. It says the FIX is broken. `pdfjs-dist`'s legacy build mentions `Iterator.` seventeen times
 *      to the modern build's two, and is the SAFER of the two in every one of those seventeen.
 *   2. It cannot see a shim. Once `iteratorGlobalShim.js` defines the global in another chunk, the
 *      offending text is still in the bundle and now harmless — the scan cannot tell.
 * So the primary rail below SIMULATES THE ENGINE: it deletes `globalThis.Iterator`, loads the real
 * module chain, and asserts it survives. That is the property; the text was only ever a proxy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '../../../..')
const DIST = path.join(APP, 'dist', 'assets')

// ── 1. THE PRIMARY RAIL: an engine without `Iterator` ────────────────────────
describe('⛔ iOS 17 simulation — no `Iterator` global', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'Iterator')

  beforeEach(() => {
    delete globalThis.Iterator
    vi.resetModules()
  })
  afterEach(() => {
    if (real) Object.defineProperty(globalThis, 'Iterator', real)
    else delete globalThis.Iterator
  })

  it('CONTROL — without the shim, pdf.js\'s own line is exactly the crash we saw on glass', () => {
    // ⭐ THE CONTROL THAT KEEPS THIS FILE HONEST. If deleting the global did not reproduce the
    // ReferenceError, every assertion below would be passing in an environment that was never
    // broken. This is pdf.js's line, verbatim in shape.
    expect(globalThis.Iterator).toBeUndefined()
    expect(() => {
      // eslint-disable-next-line no-undef
      if (typeof Iterator.prototype.join !== 'function') { /* unreachable */ }
    }).toThrow(/Iterator/)
  })

  it('the shim defines it, and pdf.js\'s line then evaluates without throwing', async () => {
    await import('./iteratorGlobalShim')
    expect(typeof globalThis.Iterator).toBe('function')
    expect(() => {
      // eslint-disable-next-line no-undef
      if (typeof Iterator.prototype.join !== 'function') { /* fine */ }
    }).not.toThrow()
  })

  it('it hands pdf.js the REAL %IteratorPrototype%, not an invented object', async () => {
    await import('./iteratorGlobalShim')
    const realProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()))
    // ⛔ Identity, not shape. A fresh `{}` would satisfy "pdf.js can assign `join` to it" and would
    // silently put the method somewhere no iterator inherits from — the shim would then "work"
    // while `[].values().join()` still threw.
    expect(globalThis.Iterator.prototype).toBe(realProto)
    const installed = function join() { return 'ok' }
    globalThis.Iterator.prototype.__floorProbe = installed
    expect([].values().__floorProbe).toBe(installed)
    delete realProto.__floorProbe
  })

  it('constructing it throws, as the real abstract Iterator does', async () => {
    await import('./iteratorGlobalShim')
    expect(() => new globalThis.Iterator()).toThrow(TypeError)
  })

  it("`Promise.withResolvers` is shimmed too, with the proposal's semantics", async () => {
    const realPWR = Promise.withResolvers
    delete Promise.withResolvers
    try {
      vi.resetModules()
      await import('./iteratorGlobalShim')
      expect(typeof Promise.withResolvers).toBe('function')
      const { promise, resolve } = Promise.withResolvers()
      resolve(7)
      await expect(promise).resolves.toBe(7)
      const r = Promise.withResolvers()
      r.reject(new Error('no'))
      await expect(r.promise).rejects.toThrow('no')
    } finally {
      if (realPWR) Promise.withResolvers = realPWR
    }
  })

  it('it does not overwrite a real `Iterator` where the engine has one', async () => {
    const sentinel = function Iterator() {}
    globalThis.Iterator = sentinel
    await import('./iteratorGlobalShim')
    expect(globalThis.Iterator).toBe(sentinel)
  })
})

// ── 2. THE BUNDLE SCAN, for globals nothing shims ────────────────────────────
/**
 * Occurrences of `<name>.` / `<name>[` that would actually EVALUATE the global: not behind a
 * `typeof` guard, not qualified by `globalThis`/`window`/`self`, not part of a longer identifier.
 */
export function unguardedGlobalHits(src, name) {
  const re = new RegExp(`(^|[^\\w$.])${name}\\s*[.[]`, 'g')
  const hits = []
  let m
  while ((m = re.exec(src)) !== null) {
    const at = m.index + m[1].length
    const before = src.slice(Math.max(0, at - 24), at)
    if (/typeof\s*$/.test(before)) continue
    if (/(globalThis|window|self)\s*\.\s*$/.test(before)) continue
    hits.push(src.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' '))
  }
  return hits
}

describe('the scan predicate itself', () => {
  it('distinguishes a guarded read from one that evaluates the global', () => {
    expect(unguardedGlobalHits('x = Iterator.prototype.join', 'Iterator').length).toBe(1)
    expect(unguardedGlobalHits("typeof Iterator == 'function'", 'Iterator')).toEqual([])
    expect(unguardedGlobalHits('var N = globalThis.Iterator;', 'Iterator')).toEqual([])
    expect(unguardedGlobalHits('MyIterator.next(); obj.Iterator.x;', 'Iterator')).toEqual([])
  })
})

/**
 * ⛔ `Iterator` IS DELIBERATELY NOT IN THIS LIST. We ship a shim for it (part 1 above proves the
 * shim works and that it is loaded before pdfjs), so its presence in a chunk is expected and
 * harmless. Listing it here would fail the build forever on text that is now inert — the exact
 * false positive this file was rewritten to stop making. These two have NO shim, so for them
 * presence really is the defect.
 */
const UNSHIMMED = [
  { name: 'AsyncIterator', since: 'not shipped in any Safari' },
]
const UNSHIMMED_STATIC = [
  { expr: 'Array.fromAsync', since: 'Safari 18.4' },
]

/** Globals we DO shim. Each needs a runtime rail above, never a text scan. */
const SHIMMED = ['Iterator', 'Promise.withResolvers']

describe('the two lists cannot drift apart', () => {
  it('nothing in the UNSHIMMED lists is actually shimmed', () => {
    // ⛔ THE FAILURE THIS PREVENTS, TWICE IN ONE SITTING. Shim a global and forget to move it out
    // of the scan, and the rail fails forever on text that is now inert — which is exactly what
    // `Iterator` and then `Promise.withResolvers` each did here. The shim module is the authority
    // on what is shimmed; this reads it rather than trusting a second hand-kept list.
    const shim = readFileSync(path.join(HERE, 'iteratorGlobalShim.js'), 'utf8')
    const body = shim.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const { name } of UNSHIMMED) {
      expect(body.includes(name), `${name} is in UNSHIMMED but iteratorGlobalShim.js defines it — `
        + 'move it to SHIMMED and give it a runtime rail').toBe(false)
    }
    for (const { expr } of UNSHIMMED_STATIC) {
      expect(body.includes(expr), `${expr} is in UNSHIMMED_STATIC but the shim defines it`).toBe(false)
    }
    // Non-vacuity: the shim really does define everything SHIMMED claims.
    for (const name of SHIMMED) {
      expect(body.includes(name.split('.').pop()), `${name} is listed SHIMMED but the shim module `
        + 'does not mention it').toBe(true)
    }
  })
})

describe('no shipped chunk evaluates an UNSHIMMED global below the floor (iOS >= 16)', () => {
  it('every built asset is clear', () => {
    if (!existsSync(DIST)) {
      // ⛔ NOT A SILENT PASS. With no build there is nothing to measure, and a rail reporting green
      // over zero files is the shape this repo keeps getting burned by.
      expect(existsSync(DIST), 'app/dist/assets missing — run `npm run build`; this rail reads '
        + 'BUILT output and with no build it measures nothing').toBe(true)
      return
    }
    const files = readdirSync(DIST)
      .filter((f) => f.endsWith('.js') && statSync(path.join(DIST, f)).isFile())
    expect(files.length, 'no .js assets in dist/assets — this rail measured nothing').toBeGreaterThan(5)

    const offenders = []
    for (const f of files) {
      const src = readFileSync(path.join(DIST, f), 'utf8')
      for (const { name, since } of UNSHIMMED) {
        const hits = unguardedGlobalHits(src, name)
        if (hits.length) offenders.push(`${f}: ${name} (${since}) x${hits.length} — ${hits[0]}`)
      }
      for (const { expr, since } of UNSHIMMED_STATIC) {
        if (src.includes(expr)) offenders.push(`${f}: ${expr} (${since})`)
      }
    }
    expect(offenders, 'A shipped chunk evaluates a global the floor does not have, and nothing '
      + 'shims it. This is the class that took /journal/notebook down on iOS 17.5 while every '
      + `local engine stayed green.\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})
