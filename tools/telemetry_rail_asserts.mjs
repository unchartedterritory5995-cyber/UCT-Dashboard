// Which tests ASSERT a telemetry event -- by AST, never by grep (F3 fix round 3, review R12-M2).
//
// The parity scorecard's clause 15b counts a core-action event as railed only when a rail file ASSERTS it:
// the event's name reaches an `expect(...)` chain in executable code (a comment is not a node, so a
// `// TODO cover 'ask_used'` cannot count), inside a test that is not statically skipped. The scorecard then
// requires that test, by its full title, to show a green tick in the vitest log -- so a test skipped at run
// time does not count either.
//
// What "reaches an expect chain" means, exactly:
//   * the argument of `expect(...)`, or an argument of a matcher called on it (`expect(a).not.toEqual(b)`),
//     contains a string that IS the event name or contains it double-quoted (a JSON body: '"ask_used"');
//   * or it contains an identifier whose declaration in the same file (a helper function, a local const)
//     contains such a string -- followed through at most MAX_HOPS declarations.
// It does not judge polarity: `expect(sent('ask_used')).toHaveLength(0)` asserts the event too. The
// mutation proofs are what show a rail's polarity is right; this proves the rail is about the event at all.
//
//   node tools/telemetry_rail_asserts.mjs < {"events": [...], "files": {"<path>": "<source>"}}
//   -> {"<path>": {"error": null | "<parse error>", "tests": [{"titles": [...] | null, "line": n,
//                  "skipped": bool, "asserts": ["<event>", ...]}]}}
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// acorn lives in app/node_modules; anchored to app/package.json as tools/nav_manifest.mjs does it.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
const { Parser } = appRequire('acorn')
const jsx = appRequire('acorn-jsx')
const JsxParser = Parser.extend(jsx())

const MAX_HOPS = 3
const TEST_FNS = new Set(['it', 'test'])
const SKIP_PROPS = new Set(['skip', 'todo', 'skipIf', 'runIf', 'fails'])

function isNode(v) { return v && typeof v.type === 'string' }

function walk(node, fn, parent = null) {
  if (!isNode(node)) return
  fn(node, parent)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => isNode(c) && walk(c, fn, node))
    else if (isNode(v)) walk(v, fn, node)
  }
}

/** `it` / `it.skip` / `it.each(t)` / `xit` ... -> {base, skipped, each} or null. */
function testCallee(callee) {
  let skipped = false
  let each = false
  let c = callee
  if (c.type === 'CallExpression') { each = true; c = c.callee }          // it.each(table)(...) / it.skipIf(x)(...)
  const props = []
  while (c.type === 'MemberExpression' && !c.computed) { props.unshift(c.property.name); c = c.object }
  if (c.type !== 'Identifier') return null
  let base = c.name
  if (base === 'xit' || base === 'xtest' || base === 'xdescribe') { skipped = true; base = base.slice(1) === 'describe' ? 'describe' : base.slice(1) }
  for (const p of props) {
    if (SKIP_PROPS.has(p)) skipped = true
    if (p === 'each') each = true
  }
  if (!TEST_FNS.has(base) && base !== 'describe') return null
  return { base, skipped, each }
}

function title(arg) {
  if (!arg) return null
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) return arg.quasis.map((q) => q.value.cooked).join('')
  return null
}

function lastFn(args) {
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i]
    if (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression') return a
  }
  return null
}

/** Every declaration in the file, by name: function bodies and variable initialisers. */
function declarations(tree) {
  const decl = new Map()
  const add = (name, node) => { if (!decl.has(name)) decl.set(name, []); decl.get(name).push(node) }
  walk(tree, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) add(n.id.name, n.body)
    else if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) add(n.id.name, n.init)
  })
  return decl
}

/** The strings and referenced identifiers inside `node`, skipping property keys and member names. */
function scan(node) {
  const strings = []
  const idents = new Set()
  walk(node, (n, parent) => {
    if (n.type === 'Literal' && typeof n.value === 'string') strings.push(n.value)
    else if (n.type === 'TemplateLiteral') n.quasis.forEach((q) => strings.push(q.value.cooked))
    else if (n.type === 'Identifier') {
      if (parent && parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return
      if (parent && parent.type === 'Property' && parent.key === n && !parent.computed && !parent.shorthand) return
      idents.add(n.name)
    }
  })
  return { strings, idents }
}

function names(strings, events) {
  const hit = new Set()
  for (const s of strings) for (const ev of events) if (s === ev || s.includes(`"${ev}"`)) hit.add(ev)
  return hit
}

/** The events that flow into an expect chain inside `body`. */
function assertedIn(body, events, decl) {
  const roots = []
  walk(body, (n) => {
    if (n.type !== 'CallExpression') return
    let c = n.callee
    if (c.type === 'Identifier' && c.name === 'expect') { roots.push(...n.arguments); return }
    // a matcher: its callee is a member chain whose object bottoms out in an expect(...) call
    if (c.type !== 'MemberExpression') return
    while (c.type === 'MemberExpression') c = c.object
    if (c.type === 'CallExpression' && c.callee.type === 'Identifier' && c.callee.name === 'expect') roots.push(...n.arguments)
  })
  const hit = new Set()
  const seen = new Set()
  let frontier = []
  for (const r of roots) {
    const { strings, idents } = scan(r)
    names(strings, events).forEach((e) => hit.add(e))
    frontier.push(...idents)
  }
  for (let hop = 0; hop < MAX_HOPS && frontier.length; hop++) {
    const next = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      for (const d of decl.get(id) || []) {
        const { strings, idents } = scan(d)
        names(strings, events).forEach((e) => hit.add(e))
        next.push(...idents)
      }
    }
    frontier = next
  }
  return [...hit].sort()
}

export function railAsserts(src, events) {
  let tree
  try {
    tree = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  } catch (e) {
    return { error: String(e.message || e), tests: [] }
  }
  const decl = declarations(tree)
  const tests = []
  const visit = (node, titles, skipped) => {
    if (!isNode(node)) return
    if (node.type === 'CallExpression') {
      const t = testCallee(node.callee)
      if (t) {
        const name = t.each ? null : title(node.arguments[0])
        const fn = lastFn(node.arguments)
        const here = titles === null || name === null ? null : [...titles, name]
        if (t.base === 'describe') {
          if (fn) visit(fn.body, here, skipped || t.skipped)
          return
        }
        tests.push({ titles: here, line: node.loc.start.line, skipped: skipped || t.skipped,
                     asserts: fn ? assertedIn(fn.body, events, decl) : [] })
        return
      }
    }
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (Array.isArray(v)) v.forEach((c) => visit(c, titles, skipped))
      else if (isNode(v)) visit(v, titles, skipped)
    }
  }
  visit(tree, [], false)
  return { error: null, tests }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const chunks = []
  process.stdin.on('data', (c) => chunks.push(c))
  process.stdin.on('end', () => {
    const { events, files } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const out = {}
    for (const [p, src] of Object.entries(files)) out[p] = railAsserts(src, events)
    process.stdout.write(JSON.stringify(out))
  })
}
