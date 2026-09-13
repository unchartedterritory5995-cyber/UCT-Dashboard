/**
 * A module-level lazy shim may only forward identifiers that exist at MODULE scope.
 *
 * ⚰️ THE BUG THIS CLOSES, live in production 2026-09-07 → 2026-09-13. `9e72492d2`
 * moved the recharts charts behind `lazy()` and left three module-level shims that
 * forward a helper down to the lazy component:
 *
 *     function NC(props)                { return <NCLazy {...props} fmt={fmt} /> }
 *     function ContractHistoryChart(p)  { return <…Lazy {...p} fK={fK} /> }
 *     function GexStrikesChart(props)   { return <…Lazy {...props} fmtGex={fmtGex} /> }
 *
 * `fmt` and `fK` are module-level functions, so those two work. `fmtGex` was a
 * `const` declared INSIDE the component body, in the `dataMode==="gex"` render
 * block — so at module scope the name did not exist and the GEX tab threw
 * `ReferenceError: fmtGex is not defined` into the error boundary the moment a
 * member opened it. Every member who clicked GEX for six days got
 * "Something went wrong on this page".
 *
 * ⭐ This asserts the CLASS, not the instance. Pinning `fmtGex` alone would pass
 * the next time somebody adds a fourth shim forwarding a component-local.
 *
 * ⛔ WHY STRUCTURAL AND NOT A RENDER TEST: the failure is a lexical-scope property,
 * which source analysis settles exactly. A render test would have to stand up a
 * ~7,000-line component and its whole dependency graph to observe a ReferenceError
 * that the scope rule already proves — more machinery, more flake, same answer.
 *
 * ⛔ CODE, NEVER PROSE. Comments are stripped before matching, because the fix's own
 * comment block quotes `fmtGex={fmtGex}` verbatim — the needle is inside the file it
 * scans. `it('does not match an occurrence that is only in a comment')` is the
 * control, and without it this test would pass for the wrong reason.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'OptionsFlow.jsx')

/** Remove block comments and comment-only / trailing line comments. */
export function stripComments (src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlocks
    .split('\n')
    .map(line => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*')) return ''
      // strip a trailing // comment only when the slashes are outside quotes
      const i = line.indexOf('//')
      if (i === -1) return line
      const before = line.slice(0, i)
      const odd = ch => (before.split(ch).length - 1) % 2 === 1
      if (odd('"') || odd("'") || odd('`')) return line
      return before
    })
    .join('\n')
}

/** Identifiers forwarded as `name={name}` to a *Lazy component. */
export function forwardedIdentifiers (src) {
  const out = new Set()
  const re = /<\w+Lazy\b[^>]*?>/g
  let m
  while ((m = re.exec(src)) !== null) {
    const tag = m[0]
    let p
    const pr = /(\w+)=\{(\w+)\}/g
    while ((p = pr.exec(tag)) !== null) if (p[1] === p[2]) out.add(p[1])
  }
  return out
}

/** Names bound at MODULE scope (column 0 declarations). */
export function moduleScopeNames (src) {
  const out = new Set()
  const re = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+))/gm
  let m
  while ((m = re.exec(src)) !== null) out.add(m[1] || m[2])
  return out
}

describe('module-level lazy shims forward only module-scope identifiers', () => {
  const code = stripComments(readFileSync(SRC, 'utf8'))

  it('finds the shims at all (non-vacuity control)', () => {
    const fwd = forwardedIdentifiers(code)
    // If this set is empty the assertion below is vacuous — which is the shape
    // this repo has been bitten by more than any other.
    expect(fwd.size).toBeGreaterThanOrEqual(3)
    expect(fwd).toContain('fmtGex')
  })

  it('every forwarded identifier is defined at module scope', () => {
    const fwd = [...forwardedIdentifiers(code)]
    const mod = moduleScopeNames(code)
    const missing = fwd.filter(n => !mod.has(n))
    expect(missing, `forwarded by a module-level shim but NOT defined at module ` +
      `scope: ${missing.join(', ')}. A lazy shim runs at module scope, so a ` +
      `component-local is not in scope there and the render throws ` +
      `ReferenceError into the error boundary.`).toEqual([])
  })

  it('does not match an occurrence that is only in a comment', () => {
    const onlyComment = [
      '// <FooLazy {...props} ghostHelper={ghostHelper} />',
      '/* <BarLazy {...props} alsoGhost={alsoGhost} /> */',
      'function real() {}'
    ].join('\n')
    const fwd = forwardedIdentifiers(stripComments(onlyComment))
    expect([...fwd]).toEqual([])
  })

  it('does flag a real component-local forward (the guard can fail)', () => {
    const bad = [
      'const XLazy = lazy(() => import("./X"))',
      'function X(props) { return <XLazy {...props} localOnly={localOnly} /> }',
      'function Comp() { const localOnly = v => v; return <X /> }'
    ].join('\n')
    const code2 = stripComments(bad)
    const missing = [...forwardedIdentifiers(code2)]
      .filter(n => !moduleScopeNames(code2).has(n))
    expect(missing).toEqual(['localOnly'])
  })
})
