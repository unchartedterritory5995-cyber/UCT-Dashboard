// Is a given `<Route path="…">` in `App.jsx` nested inside the guarded block?
//
// ⛔⛔ WHY THIS IS A SHARED MODULE AND NOT A LINE IN EACH TEST. Two rails ask
// this question — the formula library asserts its route IS behind `AuthGuard`,
// the mobile share door asserts its route is NOT — and both used to answer it by
// comparing `APP_SRC.indexOf('<AuthGuard')` against the route's own offset.
//
// That probe broke, silently and repo-wide, the moment a route was added with a
// comment explaining that it sits "OUTSIDE <AuthGuard/>". `indexOf` found the
// PROSE about the guard roughly 8,000 characters before the guard itself, so
// `formulaLibrary.route.test.jsx`'s control assertion inverted and the file went
// red against correct code — in a suite outside the slice that introduced the
// comment, which is why nobody saw it for a day.
//
// It is the same false-positive class `rawErrorSurface.test.js` and
// `captureConvergence.test.js` each warn about in their own headers: a text
// probe matches the sentence that explains the invariant. Two copies of the
// broken idiom is what let it survive one fix, so there is now one copy.
//
// ⭐ AND NESTING IS THE REAL INVARIANT. Source order is a proxy for it that
// happens to hold today; reorder the route table and the proxy lies while the
// nesting is unchanged.
import fs from 'node:fs'
import path from 'node:path'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'

/** `app/src/App.jsx`, resolved from THIS file rather than from `process.cwd()` —
 *  the cwd differs between a normal vitest run and one driven by
 *  `tools/mutation_check.py`, and a rail that answers differently depending on
 *  how it was invoked is untested exactly where it matters. */
export const APP_JSX = path.resolve(__dirname, '..', 'App.jsx')

export function readAppSource() {
  return fs.readFileSync(APP_JSX, 'utf8')
}

const elementName = (el) => el?.openingElement?.name?.name

/**
 * @returns {boolean|null} `true` if the route is inside a `<Route
 *   element={<AuthGuard />}>`, `false` if it is registered outside one, and
 *   `null` if the path is not registered at all — three distinct facts, because
 *   collapsing "not guarded" and "not there" is how a deleted route passes a
 *   test that meant to prove it was public.
 */
export function isInsideAuthGuard(src, routePath, guardName = 'AuthGuard') {
  const Parser = acorn.Parser.extend(jsx())
  const ast = Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

  const attrs = (el) => el?.openingElement?.attributes || []
  const hasPath = (el) => attrs(el).some(
    (a) => a.type === 'JSXAttribute' && a.name?.name === 'path' && matchesPath(a, routePath))

  // Renders the guard through its `element={…}` prop — the react-router idiom
  // for a layout/guard route wrapping its children.
  const isGuardRoute = (el) => attrs(el).some(
    (a) => a.type === 'JSXAttribute' && a.name?.name === 'element'
      && a.value?.type === 'JSXExpressionContainer'
      && elementName(a.value.expression) === guardName)

  let answer = null
  const walk = (n, ancestors) => {
    if (answer !== null || !n || typeof n.type !== 'string') return
    if (n.type === 'JSXElement' && elementName(n) === 'Route' && hasPath(n)) {
      answer = ancestors.some((a) => a.type === 'JSXElement' && isGuardRoute(a))
      return
    }
    const next = n.type === 'JSXElement' ? [...ancestors, n] : ancestors
    for (const k of Object.keys(n)) {
      if (k === 'type') continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach((c) => walk(c, next))
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, next)
    }
  }
  walk(ast, [])
  return answer
}

/** A route path may be a string literal (`path="/dashboard"`) or an identifier
 *  the module imports (`path={FORMULA_LIBRARY_PATH}`). Callers pass whichever
 *  they own — the literal value, or the identifier's NAME — and this accepts
 *  both, so a rail never has to retype a path its own module already exports. */
function matchesPath(attr, wanted) {
  const v = attr.value
  if (v?.type === 'Literal') return v.value === wanted
  if (v?.type === 'JSXExpressionContainer' && v.expression?.type === 'Identifier') {
    return v.expression.name === wanted
  }
  return false
}
