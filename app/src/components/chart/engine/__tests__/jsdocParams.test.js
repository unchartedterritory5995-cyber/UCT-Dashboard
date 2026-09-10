// app/src/components/chart/engine/__tests__/jsdocParams.test.js
//
// ─── ⭐⭐ THE JSDoc RAIL — the doc's @param names match the actual signature ──
//
// This exists because of the incident on 2026-09-09: `computeClock` lost the
// `now` and `holidays` parameters in the seam ruling, and the JSDoc kept
// documenting them. The arity rail on the same file (`computeClock.length === 2`)
// could not see it — `Function.prototype.toString()` returns the function's
// source but strips leading comments — so a member reading the doc believed a
// calendar could still be handed in, weeks after the seam ruling forbade it.
//
// ⛔ A DOCUMENTED PARAMETER FOR A REMOVED SEAM IS THE PARTICULAR DEFECT THIS
// REPO KEEPS PAYING FOR — the two-authorities-over-one-value shape, in prose
// against code. This rail parses each exported function's leading JSDoc, reads
// the `@param` names in order, and asserts they match the function's actual
// parameter names in order. It is scoped to `indicators.js` and `interpret.js`
// only, per the seam-work ruling; widening it is a one-line change if a future
// wave has the same class of drift.
//
// ⭐ THE MECHANISM. Parse the SOURCE (not the function value) so leading
// comments are visible; walk `export function <name>(...)` declarations; for
// each, read the closest preceding `/** ... */` block if any and pull its
// `@param {…} [name]` names — bracket-optional and dot-nested (`opts.tf`) are
// stripped to the root identifier; walk the function's own parameter list with
// balanced-paren awareness so default values with commas/parens can't confuse
// it; assert names and order match. Functions with no JSDoc are skipped
// (nothing to check).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const SCOPED = [
  '../../indicators.js',
  '../ast/interpret.js',
].map((p) => path.resolve(HERE, p))

/** Read parameter names off `(...args)` starting at src[start] === '(', with
 *  balanced-paren + string-literal awareness so a default value like
 *  `= { fn: (x) => x }` does not confuse the split. Names include the identifier
 *  only — default values, type annotations, and object-destructure bodies are
 *  discarded down to the root identifier. */
function paramNamesAt(src, openIdx) {
  let depth = 0, i = openIdx, q = null, body = ''
  for (; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      body += ch
      if (ch === '\\' && i + 1 < src.length) { body += src[i + 1]; i += 1; continue }
      if (ch === q) q = null
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') { body += ch; q = ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; if (depth > 1) body += ch; continue }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) return splitTopLevel(body).map((p) => rootIdent(p))
      body += ch; continue
    }
    body += ch
  }
  return null
}

function splitTopLevel(src) {
  const out = []
  let depth = 0, cur = '', q = null
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      cur += ch
      if (ch === '\\' && i + 1 < src.length) { cur += src[i + 1]; i += 1; continue }
      if (ch === q) q = null
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') { q = ch; cur += ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; cur += ch; continue }
    if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; cur += ch; continue }
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function rootIdent(p) {
  // strip default value, whitespace, spread, and destructuring — down to the
  // first identifier. `foo = 3` → `foo`; `{a, b} = {}` → `{a, b}` (kept as-is,
  // since we want a JSDoc mismatch to be loud rather than smoothed over).
  const noDefault = p.replace(/\s*=\s*[\s\S]*$/, '')
  const cleaned = noDefault.replace(/^\.\.\./, '').trim()
  const m = cleaned.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/)
  return m ? m[1] : cleaned
}

/** The @param names in a JSDoc block, in declaration order. Handles `[optional]`
 *  and dot-nested (`opts.tf`) forms — both collapse to the root identifier. */
function docParamNames(block) {
  const out = []
  const re = /@param\s+(?:\{[^}]*\}\s+)?(\[?)([A-Za-z_$][\w$.]*)\]?/g
  let m
  while ((m = re.exec(block)) !== null) {
    const root = m[2].split('.')[0]
    out.push(root)
  }
  return out
}

/** For each `export function` in `src`, return `{ name, params, doc }` where
 *  `doc` is the `@param` roster from its immediately-preceding JSDoc block or
 *  null if none. */
function exportedFunctions(src) {
  const out = []
  const re = /export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g
  let m
  while ((m = re.exec(src)) !== null) {
    const openIdx = m.index + m[0].length - 1
    const params = paramNamesAt(src, openIdx) || []
    // scan backwards for a JSDoc block that ends at the last `*/` before the
    // declaration; skip whitespace but nothing else, so a stray line breaks the
    // pairing and is caught rather than silently associated with something else.
    let i = m.index - 1
    while (i >= 0 && /\s/.test(src[i])) i -= 1
    let doc = null
    if (i >= 1 && src[i] === '/' && src[i - 1] === '*') {
      const closeIdx = i
      const openIdx2 = src.lastIndexOf('/**', closeIdx)
      if (openIdx2 !== -1) {
        const block = src.slice(openIdx2, closeIdx + 1)
        doc = docParamNames(block)
      }
    }
    out.push({ name: m[1], params, doc })
  }
  return out
}

describe('⭐⭐ JSDoc @param names track the actual signature', () => {
  for (const abs of SCOPED) {
    const rel = path.relative(HERE, abs).replace(/\\/g, '/')
    describe(rel, () => {
      const src = fs.readFileSync(abs, 'utf-8')
      const fns = exportedFunctions(src)

      it('⛔ NON-VACUITY — at least one exported function is discovered', () => {
        expect(fns.length, `no exports found in ${rel}`).toBeGreaterThan(0)
      })

      for (const fn of fns) {
        if (fn.doc === null || fn.doc.length === 0) {
          // No JSDoc, or a description-only JSDoc that lists no `@param` at
          // all. Skipped rather than failed: the rail's subject is DRIFT
          // between prose and code, not COVERAGE of documentation. A member
          // adding an `@param` starts being checked the moment they do.
          it.skip(`${fn.name} — no @param entries, nothing to check`, () => {})
          continue
        }
        it(`${fn.name} — @param names match parameters in order`, () => {
          expect(fn.doc, `${fn.name}: JSDoc @params disagree with the function's actual parameters`)
            .toEqual(fn.params)
        })
      }
    })
  }
})

describe('⛔⛔ THE RAIL ITSELF — proved to fire on the exact drift it exists for', () => {
  // The 2026-09-09 incident: `computeClock` lost `now` and `holidays`, JSDoc
  // kept them. This test synthesises that state and confirms the rail catches
  // it. If a future refactor breaks the parser, THIS test goes red first,
  // before a real drift can sneak past.
  it('a JSDoc that lists a removed parameter fails', () => {
    const stale = `
/** ⭐ Do a thing.
 *  @param {Array}  bars a series
 *  @param {string} [tf] a timeframe
 *  @param {number} [now] REMOVED — this parameter no longer exists
 *  @param {Set}    [holidays] REMOVED — this parameter no longer exists
 *  @returns {object}
 */
export function computeClockDrift(bars, tf, newestBarIsForming = null) {
  return { bars, tf, newestBarIsForming }
}
`
    const [fn] = exportedFunctions(stale)
    expect(fn.name).toBe('computeClockDrift')
    expect(fn.params).toEqual(['bars', 'tf', 'newestBarIsForming'])
    expect(fn.doc).toEqual(['bars', 'tf', 'now', 'holidays'])
    expect(fn.doc).not.toEqual(fn.params)
  })

  it('a JSDoc that matches the parameters passes — the control', () => {
    const clean = `
/** @param {Array} bars
 *  @param {string} [tf]
 *  @param {boolean|null} [newestBarIsForming]
 */
export function computeClockClean(bars, tf, newestBarIsForming = null) {}
`
    const [fn] = exportedFunctions(clean)
    expect(fn.params).toEqual(['bars', 'tf', 'newestBarIsForming'])
    expect(fn.doc).toEqual(fn.params)
  })
})
