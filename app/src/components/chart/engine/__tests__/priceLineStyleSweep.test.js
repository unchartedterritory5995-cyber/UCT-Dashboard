// app/src/components/chart/engine/__tests__/priceLineStyleSweep.test.js
//
// ─── H1 — EVERY createPriceLine CALL SITE NAMES ITS lineStyle ───────────────
//
// lightweight-charts' `createPriceLine` defaults `lineStyle` to **Dashed**, not
// solid. Omit it and the line renders dashed, with no error. It cost 379 px on
// RSI's 50 line (`binder.js` guideSpecs, Task 8 rehearsal), and four files carry
// a comment warning about it. Comments do not enforce anything; this sweep does.
// It reads every `createPriceLine(` call site out of `app/src` and fails by name.
//
// ⚰️ REHOMED 2026-10-24 from `lwcHazards.test.js`. That file tested
// `engine/lwcHazards.js`, an R0.4 primitive with no production importer, which
// was deleted when its parking note in `reachable.test.js` lapsed (recover it
// from `678ca039a1` / `e855f62cdb`). The sweep was the part of that file that
// guarded production code, so it stays, and it imports no module: it reads
// source text only.
//
// It carries controls proving it can see a call site that omits the option.
// Without them, a sweep whose regex has rotted reports a clean pass forever
// (`lesson_gate_that_cannot_fail`).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LineStyle } from 'lightweight-charts'

const SRC = path.resolve(__dirname, '../../../..')            // app/src
const REPO = path.resolve(SRC, '../..')
const MAP = fs.readFileSync(path.join(REPO, 'docs/pine/lwc5-capability-map.md'), 'utf8').replace(/\r\n/g, '\n')

/** Every `.js`/`.jsx` under app/src, tests excluded. */
function sourceFiles(dir = SRC, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '__fixtures__') continue
      sourceFiles(p, acc)
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
      acc.push(p)
    }
  }
  return acc
}

/**
 * Find `createPriceLine( ... )` calls and report whether each names `lineStyle`.
 *
 * ⚠️ Brace-matched, not regex-to-the-closing-paren: a spec object can contain
 * nested braces and a ternary, and a lazy `\)` stops at the first one it meets,
 * which truncates the text the check runs on and passes for the wrong reason.
 */
function priceLineCallSites(src, file) {
  const out = []
  const rx = /createPriceLine\s*\(/g
  let m
  while ((m = rx.exec(src))) {
    let i = m.index + m[0].length
    let depth = 1
    while (i < src.length && depth > 0) {
      const ch = src[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      i += 1
    }
    const args = src.slice(m.index + m[0].length, i - 1)
    const line = src.slice(0, m.index).split('\n').length
    out.push({ file, line, args, namesLineStyle: /\blineStyle\s*:/.test(args) })
  }
  return out
}

describe('H1 — createPriceLine must always name lineStyle', () => {
  const files = sourceFiles()
  const sites = files.flatMap((f) => priceLineCallSites(fs.readFileSync(f, 'utf8'), path.relative(SRC, f)))

  it('the sweep can see the codebase at all', () => {
    // ⭐ NON-VACUITY. Zero files or zero call sites means the sweep proves nothing.
    expect(files.length).toBeGreaterThan(100)
    expect(sites.length).toBeGreaterThan(0)
  })

  it('⛔ every call site that passes an object literal names lineStyle', () => {
    // A call passing a prebuilt variable (`createPriceLine(spec)`) is checked
    // where that spec is BUILT (e.g. `binder.js` guideSpecs, which maps the
    // style through `pool.lineStyleValue` and has its own rails).
    const literals = sites.filter((s) => s.args.includes(':'))
    const offenders = literals.filter((s) => !s.namesLineStyle)
    expect(offenders.map((o) => `${o.file}:${o.line}`)).toEqual([])
    expect(literals.length).toBeGreaterThan(0)     // the filter must not empty the set
  })

  it('THE CONTROL: the sweep catches a call site that omits it', () => {
    const planted = `series.createPriceLine({ price: 50, color: '#fff', lineWidth: 1 })`
    const found = priceLineCallSites(planted, 'planted.js')
    expect(found).toHaveLength(1)
    expect(found[0].namesLineStyle).toBe(false)
  })

  it('THE CONTROL: and passes one that names it, even with nested braces', () => {
    const planted = `s.createPriceLine({ price: p, title: fmt({ a: 1 }), lineStyle: LineStyle.Solid })`
    const found = priceLineCallSites(planted, 'planted.js')
    expect(found).toHaveLength(1)
    expect(found[0].namesLineStyle).toBe(true)
  })

  it('the default really is Dashed, and the capability map still says so', () => {
    // LWC's price-line default is `LineStyle.Dashed` (2), per the capability map
    // (§2, read off the 5.x bundle). The enum is read from the library itself so
    // a renumbering cannot leave this asserting a stale integer.
    expect(LineStyle.Dashed).toBe(2)
    expect(LineStyle.Solid).not.toBe(LineStyle.Dashed)
    expect(MAP).toMatch(/is `Dashed`, not solid/)
    expect(MAP).toMatch(/379 px/)
  })
})
