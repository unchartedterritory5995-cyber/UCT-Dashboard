/**
 * Derive the sidebar's nav entries and the app's registered routes — from ACORN parse
 * trees, never from a regex.
 *
 * ⛔ CLAUDE.md's "Nav Tabs" section is a hand-typed list beside the array it describes,
 * which is the defect that file records over and over (the writer-index FOUR, the COT
 * router's "4 routes", the setup catalog's "24"). This is the generator that lets the
 * section say what `NAV_ITEMS` says.
 *
 * ⛔ A REGEX WAS REFUSED. The hub's surface-matrix generator was regex-based twice and
 * wrong twice (D-42, D-44); CLAUDE.md's own reachability guidance says an AST, never a
 * grep. An object literal spanning lines, a trailing comment, a `to:` inside a string —
 * each breaks a regex and none breaks a parse tree.
 *
 * Usage:
 *   node tools/nav_manifest.mjs            # human-readable
 *   node tools/nav_manifest.mjs --json     # machine-readable
 *   node tools/nav_manifest.mjs --self-check
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// acorn lives in app/node_modules, not at the repo root. ESM ignores NODE_PATH, so the
// resolution is anchored to app/package.json exactly as tools/hub_surface_matrix.mjs
// does it - the established idiom in this repo for a root-level .mjs reading app deps.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
const { Parser } = appRequire('acorn')
const jsx = appRequire('acorn-jsx')

const JsxParser = Parser.extend(jsx())

const NAV_FILE = 'app/src/components/NavBar.jsx'
const APP_FILE = 'app/src/App.jsx'

function parse(src) {
  return JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
}

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}

/** Every `{ to: '…', label: '…' }` in the exported NAV_ITEMS array. */
export function navItems(src) {
  const tree = parse(src)
  let arr = null
  let line = null
  walk(tree, (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'NAV_ITEMS'
        && n.init?.type === 'ArrayExpression') {
      arr = n.init
      line = n.loc.start.line
    }
  })
  if (!arr) throw new Error('NAV_ITEMS array not found in ' + NAV_FILE)
  const out = []
  for (const el of arr.elements) {
    if (!el || el.type !== 'ObjectExpression') continue
    const row = {}
    for (const p of el.properties) {
      if (p.type !== 'Property') continue
      const key = p.key.name ?? p.key.value
      if (p.value.type === 'Literal') row[key] = p.value.value
    }
    if (row.to) out.push({ to: row.to, label: row.label ?? null, icon: row.icon ?? null })
  }
  return { line, items: out }
}

/** The component name a Route's `element={<X .../>}` renders, or null. */
function elementName(attr) {
  const ex = attr?.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null
  if (!ex || ex.type !== 'JSXElement') return null
  const n = ex.openingElement?.name
  return n?.name ?? (n?.property?.name ?? null)
}

/** Every `<Route path="…">` the app registers, WITH what it renders.
 *
 * ⛔ Reading only `path` is what made `/live-flow` look like an orphan page. It renders
 * `<Navigate to="/live-massive" replace />` — a redirect INTO a nav entry. A route's
 * element is part of the fact "is this a page a member can land on and get stuck".
 */
export function routes(src) {
  const tree = parse(src)
  const out = []
  walk(tree, (n) => {
    if (n.type !== 'JSXOpeningElement') return
    if ((n.name?.name ?? '') !== 'Route') return
    let path = null
    let renders = null
    for (const a of n.attributes) {
      if (a.type !== 'JSXAttribute') continue
      if (a.name?.name === 'path' && a.value?.type === 'Literal'
          && typeof a.value.value === 'string') path = a.value.value
      if (a.name?.name === 'element') renders = elementName(a)
    }
    if (path !== null) out.push({ path, line: n.loc.start.line, renders })
  })
  return out
}

/** A route matches a nav entry if the nav target is the route or lies under it. */
function covers(routePath, navTo) {
  if (routePath === navTo) return true
  const base = routePath.replace(/\/\*$/, '').replace(/\/:.*$/, '')
  return base !== '' && base !== '/' && (navTo === base || navTo.startsWith(base + '/'))
}

function selfCheck() {
  let ok = true
  const show = (label, got, want) => {
    const good = JSON.stringify(got) === JSON.stringify(want)
    ok &&= good
    console.log(`  ${label.padEnd(58)} -> ${String(got).padEnd(10)} ${good ? 'ok' : `WRONG (want ${want})`}`)
  }

  // CLEAN fixture: a well-formed array, including a multi-line entry and a comment.
  const clean = `
export const NAV_ITEMS = [
  // HOME
  { to: '/a', label: 'Alpha', icon: 'x' },
  {
    to: '/b',
    label: 'Beta',
  },
]
`
  show('CLEAN fixture: entries found', navItems(clean).items.length, 2)
  show('CLEAN fixture: a multi-line entry is read', navItems(clean).items[1].to, '/b')

  // ⛔ THE CASE A REGEX GETS WRONG: a `to:` inside a string is not an entry.
  const decoy = `
export const NAV_ITEMS = [
  { to: '/real', label: 'Real' },
]
const HELP = "write { to: '/fake', label: 'Fake' } in the array"
`
  show('DECOY: a to: inside a string literal is NOT an entry',
    navItems(decoy).items.map((i) => i.to).join(','), '/real')

  // DIRTY fixture: the array is missing entirely -> throw, never silently empty.
  let threw = false
  try { navItems('export const OTHER = []') } catch { threw = true }
  show('DIRTY fixture: a missing array THROWS, never returns []', threw, true)

  // EMPTY input
  let threwEmpty = false
  try { navItems('') } catch { threwEmpty = true }
  show('EMPTY input: throws rather than reporting zero entries', threwEmpty, true)

  // routes
  const rsrc = `const A = () => <Routes><Route path="/x" element={<X/>} /><Route path="/y/:id" element={<Y/>} /></Routes>`
  show('routes: both registered paths are seen', routes(rsrc).map((r) => r.path).join(','), '/x,/y/:id')

  // ⛔ the element is read, and a redirect is distinguishable from a page
  const relem = `const A = () => <Routes>
    <Route path="/page" element={<RealPage/>} />
    <Route path="/old" element={<Navigate to="/page" replace />} />
  </Routes>`
  const parsed = routes(relem)
  show('CLEAN: a real page reports its component',
    parsed.find((r) => r.path === '/page').renders, 'RealPage')
  show('DIRTY: a redirect reports <Navigate>, not a page',
    parsed.find((r) => r.path === '/old').renders, 'Navigate')
  show('CONTROL: a route with no element reports null',
    routes('const A = () => <Route path="/bare" />')[0].renders, null)
  show('covers(): a param route covers its base', covers('/y/:id', '/y'), true)
  show('covers(): an unrelated route does not', covers('/x', '/y'), false)

  console.log(`SELF-CHECK: ${ok ? 'PASS' : 'FAIL'}`)
  return ok ? 0 : 1
}

const argv = process.argv.slice(2)
if (argv.includes('--self-check')) process.exit(selfCheck())

const nav = navItems(readFileSync(NAV_FILE, 'utf8'))
const reg = routes(readFileSync(APP_FILE, 'utf8'))

const navWithoutRoute = nav.items.filter((i) => !reg.some((r) => covers(r.path, i.to)))

// A route NESTED under a nav target is reachable from that entry; only a route no nav
// entry leads to is unlisted. v1 compared one direction and called /calendar/mystocks
// and every /journal-2-0/* child orphaned - 69 rows where the real answer is far smaller.
// Relative child paths (no leading slash) are resolved by their parent Route and are not
// top-level doors at all.
const under = (routePath) =>
  nav.items.some((i) => routePath === i.to || routePath.startsWith(i.to + '/'))
// Declared classes that are NOT sidebar candidates. Declared rather than guessed, so
// widening the exclusions is a reviewable act and the remainder is a real finding
// instead of a 56-row list nobody reads.
const EXCLUDED = [
  [/^\/(login|signup|subscribe|forgot-password|reset-password|smoke-login|verify-email|verify-pending)$/, 'auth'],
  [/^\/(landing|terms|privacy|methodology|pricing|compare|brokers|provenance-demo)$/, 'marketing/legal'],
  [/^\/r\//, 'headless renderer (bot image path)'],
  [/^\/(theme-tracker|watchlists|multi-chart)$/, 'LegacyRedirect into /charts'],
  [/^\/(admin|alert-tester)/, 'admin-only'],
  [/^\/settings$/, 'pinned to the sidebar bottom, not in NAV_ITEMS'],
  [/:/, 'detail route reached from a list, never a sidebar entry'],
]
const excludedBy = (p) => (EXCLUDED.find(([rx]) => rx.test(p)) || [])[1] || null

const routeWithoutNavRaw = reg.filter(
  (r) => r.path.startsWith('/') && !['*', '/'].includes(r.path)
    && !nav.items.some((i) => covers(r.path, i.to)) && !under(r.path))
// ⛔ DERIVED FROM THE ELEMENT, not from a typed path list: a route that renders
// <Navigate> or a *Redirect component sends the member somewhere, so it is not a page
// with no way in. This is what /live-flow and /educational-videos are.
const isRedirect = (r) => r.renders === 'Navigate' || /Redirect$/.test(r.renders || '')
const routeWithoutNav = routeWithoutNavRaw.filter(
  (r) => !excludedBy(r.path) && !isRedirect(r))

if (argv.includes('--json')) {
  console.log(JSON.stringify({ nav, routes: reg, navWithoutRoute, routeWithoutNav }, null, 2))
} else {
  console.log(`NAV_ITEMS — ${NAV_FILE}:${nav.line} — ${nav.items.length} entries`)
  for (const i of nav.items) console.log(`   ${String(i.label).padEnd(16)} ${i.to}`)
  console.log(`\nregistered routes — ${APP_FILE} — ${reg.length}`)
  console.log(`\nNAV ENTRIES WITH NO ROUTE (the phantom-entry defect): ${navWithoutRoute.length}`)
  for (const i of navWithoutRoute) console.log(`   ⛔ ${i.label}  ${i.to}`)
  console.log(`\nROUTES WITH NO NAV ENTRY: ${routeWithoutNavRaw.length} raw -> ${routeWithoutNav.length} after declared exclusions`)
  const byClass = {}
  for (const r of routeWithoutNavRaw) {
    const c = excludedBy(r.path)
    if (c) byClass[c] = (byClass[c] || 0) + 1
  }
  for (const [c, n] of Object.entries(byClass)) console.log(`   excluded ${String(n).padStart(2)}  ${c}`)
  const redirects = routeWithoutNavRaw.filter((r) => !excludedBy(r.path) && isRedirect(r))
  for (const r of redirects) {
    console.log(`   excluded  1  redirect -> ${r.path} renders <${r.renders}>`)
  }
  console.log('   ---')
  for (const r of routeWithoutNav) {
    console.log(`   UNLISTED ${r.path}   renders <${r.renders}>   (App.jsx:${r.line})`)
  }
}
