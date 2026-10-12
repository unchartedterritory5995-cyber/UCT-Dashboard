/**
 * ⛔⛔ SPEC §P2 INTEGRITY RULE, CLIENT HALF — "No block may own a second write door."
 *
 * Every file under components/notebook/blocks/ and lib/blocks/, plus components/LogTradeChecklist.jsx
 * (tests excluded), is parsed with acorn:
 *   ① every request is a GET unless it matches a NAMED method+URL exception below (IR-I b): a fetch
 *     whose options are not an object literal with a literal `method` reads as method '?', which is
 *     never exempt (IR-I a); navigator.sendBeacon, XMLHttpRequest and the json(Post|Put|Patch|Delete)
 *     helpers are writes too. The door census (doorEnumeration.test.js ①/②) still pins the server to
 *     seven note-advancing functions, so a note door cannot hide behind an exception;
 *   ② no block file imports the offline write layer (lib/offline/*) or the styles writes
 *     (lib/journalStyles.js), and no allow-list entry can lift that ban;
 *   ③ `updateAttributes(` is called in exactly ONE block file, useBlockParams.js, and that file
 *     still calls it (a renamed door would otherwise leave this rail guarding nothing);
 *   ④ (ruling R-RC-6) a block file imports only another block file or a module NAMED in
 *     IMPORT_ALLOW below. Anything else, including an `import()` whose source cannot be read,
 *     fails by name.
 * ⛔ IR-B5: WRITE_EXCEPTIONS starts EMPTY. The task that creates a writing file adds its own entry in
 * the same commit, so this rail is green at every task boundary. IMPORT_ALLOW works the same way.
 * ⛔ CODE, NEVER PROSE: every check reads the parse tree, so a comment or a string that SAYS
 * `updateAttributes(` or `method: 'PUT'` is never a match. The controls prove both directions:
 * each failure planted in memory is seen, and the same text inside a comment is not.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep, posix } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const DIRS = [join(REPO, 'app/src/pages/journal-2-0/components/notebook/blocks'),
  join(REPO, 'app/src/pages/journal-2-0/lib/blocks')]
const EXTRA = [join(REPO, 'app/src/pages/journal-2-0/components/LogTradeChecklist.jsx')]
const rel = (p) => relative(REPO, p).split(sep).join('/')
const P = Parser.extend(jsx())
const BLOCK_DIR_RELS = DIRS.map((d) => `${rel(d)}/`)

/**
 * file -> [{ method, url, why }]. `url` is a LITERAL template, compared for equality with the call's
 * URL (`{}` standing for each ${…}); it is never a regular expression (fix round 1, M-1), and an
 * entry `exceptionProblems` refuses exempts nothing.
 * ⛔ IR-B5: empty until a task ships a file that writes. Each task adds EXACTLY its own entry, in the
 * commit that creates the call, and nothing else:
 *   · Task 8  — components/LogTradeChecklist.jsx, its one named write;
 *   · Task 10 — its block body's one named write.
 * Never a whole file, never a note URL (the last case below refuses both).
 */
export const WRITE_EXCEPTIONS = {}

/**
 * ④ (R-RC-6) module id -> why. A package by its own name; a source file by its repo-relative path
 * WITHOUT extension. Another file inside the block directories needs no entry: it is scanned itself.
 * Task 6's entries are below; a task whose body READS data adds the one module it reads through,
 * with the reason, in the same commit (Tasks 7, 10, 11).
 */
export const IMPORT_ALLOW = {
  react: 'components and hooks; no network',
  '@tiptap/react': "NodeViewWrapper, the editor host's node-view frame; no network",
  'app/src/pages/journal-2-0/lib/lazyChunk': "lazyLeaf: fetches the block's own CODE chunk, never data",
  'app/src/pages/journal-2-0/lib/journalBlocks': 'the block catalog (labels, search lines); a module with no imports',
  'app/src/widgets/registry': 'metadata only (paramsPlainText); imports no component and no network code',
  // R-T6-3 (fix round 2): the app's ONE chunk-load-error predicate, so a block's Reload escalation
  // never restates it. The module also reloads the page for a ROUTE's stale chunk; no data, no writes.
  'app/src/utils/lazyWithRetry': "isChunkLoadError: the app's own stale-chunk predicate; no data, no writes",
  // Task 11 (position sizing): the ONE in-repo house sizing table (IR-S10), a JSON file with no code,
  // and the two hooks the body READS through. The body takes `settings`/`isLoading` and `regime` from
  // them and never calls useJ2Settings' `save` (PositionSizingBlock.test.jsx pins that).
  'app/src/constants/houseSizing.json': 'the house sizing table (IR-S10): plain JSON data, no code, no network',
  'app/src/pages/journal-2-0/hooks/useJ2Settings': 'READ only: settings.accountSize (a GET); the body never calls its save',
  'app/src/pages/journal-2-0/hooks/useJ2CurrentRegime': "READ only: today's regime id and its date (GET /api/j2/regime)",
  // R-T11-2 N-2: the accounts list's state picks the sentence when no specific account is selected.
  'app/src/pages/journal-2-0/hooks/useJ2Accounts': 'READ only: the accounts list, its loading and error state, and refresh (a re-read)',
}

/**
 * N-4 (R-T6-4): modules a block file may take only NAMED exports from. `utils/lazyWithRetry`'s default
 * export reloads the page on a stale chunk, which lib/lazyChunk.js rules out for a leaf view ("NEVER A
 * PAGE RELOAD"); a block gets the predicate and nothing else. A default, a namespace, an `import()`,
 * a re-export or any other name fails by name.
 */
export const IMPORT_NAMES = {
  'app/src/utils/lazyWithRetry': ['isChunkLoadError'],
}

const HELPER_METHOD = { jsonPost: 'POST', jsonPut: 'PUT', jsonPatch: 'PATCH', jsonDelete: 'DELETE' }
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
const BANNED_IMPORT = /(^|\/)lib\/offline(\/|$)|journalStyles(\.js)?$/

function urlOf(arg) {
  if (!arg) return '?'
  if (arg.type === 'Literal') return String(arg.value)
  if (arg.type === 'TemplateLiteral') return arg.quasis.map((q) => q.value.cooked).join('{}')
  return '?'
}

function methodOf(opts) {
  if (!opts) return 'GET'
  if (opts.type !== 'ObjectExpression') return '?'                       // IR-I a: a variable, a call, …
  if (opts.properties.some((p) => p.type === 'SpreadElement')) return '?'
  const m = opts.properties.find((p) => (p.key?.name || p.key?.value) === 'method')
  if (!m) return 'GET'
  return m.value?.type === 'Literal' ? String(m.value.value).toUpperCase() : '?'
}

// A literal path template: /api/… segments of plain characters, `{}` standing for each ${…}.
// No '?' (the reading of a URL that could not be read), no regex metacharacter, no query string.
const LITERAL_URL = /^\/api\/(?:[A-Za-z0-9_.-]|\{\}|\/)+$/
const NOTE_URL = /^\/api\/j2\/notes(\/|$)/
// N-2 (R-T6-4): a template must not step around NOTE_URL (dot segments, empty segments) and must not
// open with a hole: `{}` stands for a whole path tail, so `/api/j2/{}` is `/api/j2/notes/1` at run time.
const DOT_OR_EMPTY = /\.\.|\/\/|\/\.(\/|$)/
const OPENS_WITH_HOLE = /^\/api\/(j2\/)?\{\}/

/** Every reason a write exception is refused ([] when it may exempt its own call). */
export function exceptionProblems(e) {
  const out = []
  if (!WRITE_METHODS.includes(e?.method)) out.push(`${e?.method} is not a write method`)
  if (typeof e?.url !== 'string' || !LITERAL_URL.test(e.url)) out.push(`${JSON.stringify(e?.url)} is not a literal URL template`)
  else {
    if (DOT_OR_EMPTY.test(e.url)) out.push(`${JSON.stringify(e.url)} has a dot segment or an empty segment`)
    if (OPENS_WITH_HOLE.test(e.url)) out.push(`${e.url} opens with {} (a whole path)`)
    if (NOTE_URL.test(e.url) || NOTE_URL.test(posix.normalize(e.url))) out.push(`${e.url} is a note URL`)
  }
  if (String(e?.why || '').length <= 20) out.push('the reason is missing or too short')
  return out
}

function exempt(exceptions, file, method, url) {
  return (exceptions[file] || []).some((e) => exceptionProblems(e).length === 0 && e.method === method && e.url === url)
}

// M-2 (fix round 1): the names that ARE a request. Each is decided only as the direct callee of a
// call (fetch, sendBeacon, the helpers) or of `new` (XMLHttpRequest, Request); any other reference
// (an alias, `.call` / `.apply`, a destructuring) cannot be decided statically and fails closed.
// N-3 (R-T6-4): WebSocket joins them (a socket can send), judged at `new` like XMLHttpRequest.
const DOOR_NAMES = new Set(['fetch', 'sendBeacon', 'XMLHttpRequest', 'Request', 'WebSocket', ...Object.keys(HELPER_METHOD)])
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self'])

/** The name an Identifier or a member access reaches (`a.fetch`, `a['fetch']`), else undefined. */
function nameOf(n) {
  if (!n) return undefined
  if (n.type === 'Identifier') return n.name
  if (n.type === 'MemberExpression') {
    if (!n.computed) return n.property?.name
    if (n.property?.type === 'Literal') return String(n.property.value)
  }
  return undefined
}

/** Is `n` (an Identifier or member access naming a door) used as anything but the direct callee? */
function isLooseDoorReference(n, parent) {
  if (!parent) return true
  if ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.callee === n) return false
  if (n.type === 'Identifier') {
    if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return false   // judged as the member
    if (parent.type === 'Property' && parent.value !== n && parent.key === n && !parent.computed) return false   // a key, not a value
    if (/^(Import|Export)\w*Specifier$/.test(parent.type)) return false                                   // ④ judges imports
    if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key === n) return false
  }
  return true
}

/** The string an import names, or null when it is computed (an `import(x)`). */
function specOf(node) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return null
}

/** A package by name; a relative import as its repo-relative path without extension. */
function moduleIdOf(file, spec) {
  if (!spec.startsWith('.')) return spec
  return posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.(jsx?|mjs)$/, '')
}

function importProblem(file, spec, allow) {
  if (spec == null) return `UNLISTED ${file}: ?`                         // a computed import cannot be checked
  const id = moduleIdOf(file, spec)
  if (BANNED_IMPORT.test(spec) || BANNED_IMPORT.test(id)) return `IMPORT ${file}: ${spec}`
  if (BLOCK_DIR_RELS.some((d) => id.startsWith(d))) return null            // another block file: scanned itself
  if (Object.hasOwn(allow, id)) return null
  return `UNLISTED ${file}: ${spec}`
}

function walk(n, fn, parent = null) {
  if (!n || typeof n.type !== 'string') return
  fn(n, parent)
  for (const k of Object.keys(n)) {
    const v = n[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn, n))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, fn, n)
  }
}

const parse = (src) => P.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

/** N-3: names PROVABLY a local object or array: bound exactly once in the file, by a `const` whose
 *  initialiser is an object or array literal (never a parameter, never re-bound anywhere). A computed
 *  call on anything else (`w[k](...)`) cannot be decided statically and fails closed. */
function literalLocals(ast) {
  const bindings = new Map()                       // name -> [isLiteralConst, ...]
  const bind = (name, literal) => bindings.set(name, [...(bindings.get(name) || []), literal])
  const patternNames = (p, fn) => walk(p, (x, parent) => {
    if (x.type === 'Identifier' && !(parent?.type === 'Property' && parent.key === x && parent.value !== x)
        && !(parent?.type === 'MemberExpression' && parent.property === x)) fn(x.name)
  })
  walk(ast, (n, parent) => {
    if (n.type === 'VariableDeclarator') {
      if (n.id.type === 'Identifier') {
        bind(n.id.name, parent?.kind === 'const' && ['ObjectExpression', 'ArrayExpression'].includes(n.init?.type))
      } else patternNames(n.id, (name) => bind(name, false))
    }
    if (/Function/.test(n.type)) {
      if (n.id) bind(n.id.name, false)
      for (const p of n.params) patternNames(p, (name) => bind(name, false))
    }
    if (n.type === 'CatchClause' && n.param) patternNames(n.param, (name) => bind(name, false))
    if (/^Class/.test(n.type) && n.id) bind(n.id.name, false)
  })
  return new Set([...bindings].filter(([, b]) => b.length === 1 && b[0]).map(([name]) => name))
}

/** N-3: a global object (window / globalThis / self) used as a VALUE (an alias, an argument) rather than
 *  as the object of a member access, which the member rules judge. `typeof window` is a test, not a use. */
function isLooseGlobalReference(n, parent) {
  if (parent?.type === 'MemberExpression' && parent.object === n) return false
  if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') return false
  if (parent?.type === 'CallExpression' && parent.callee === n) return true
  return isLooseDoorReference(n, parent)
}

/** N-4: the names an import / re-export of a name-limited module takes that it may not. */
function forbiddenNames(n, allowed) {
  if (n.type === 'ImportExpression') return ['import()']
  if (n.type === 'ExportAllDeclaration') return ['*']
  const out = []
  for (const s of n.specifiers || []) {
    const name = s.type === 'ImportDefaultSpecifier' ? 'default'
      : s.type === 'ImportNamespaceSpecifier' ? '*'
        : s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value)
          : (s.local.name ?? s.local.value)                                   // ExportSpecifier: the source's name
    if (!allowed.includes(name)) out.push(name)
  }
  return out
}

export function problemsIn(file, src, exceptions = WRITE_EXCEPTIONS, allow = IMPORT_ALLOW, names = IMPORT_NAMES) {
  const out = []
  const write = (method, url) => { if (!exempt(exceptions, file, method, url)) out.push(`WRITE ${file}: ${method} ${url}`) }
  const imported = (node) => { const p = importProblem(file, specOf(node), allow); if (p) out.push(p) }
  const ast = parse(src)
  const locals = literalLocals(ast)
  walk(ast, (n, parent) => {
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration'
        || (n.type === 'ExportNamedDeclaration' && n.source)) imported(n.source)
    if (n.type === 'ImportExpression') imported(n.source)
    // N-4: a name-limited module gives only its named exports
    if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(n.type) && n.source) {
      const spec = specOf(n.source)
      const limited = spec != null ? names[moduleIdOf(file, spec)] : null
      if (limited) for (const name of forbiddenNames(n, limited)) out.push(`NAMES ${file}: ${spec} (${name})`)
    }
    // N-3: an alias of a global object
    if (n.type === 'Identifier' && GLOBAL_OBJECTS.has(n.name) && isLooseGlobalReference(n, parent)) out.push(`REF ${file}: ${n.name}`)
    if (n.type === 'NewExpression' && nameOf(n.callee) === 'WebSocket') out.push(`SOCKET ${file}`)
    // M-2: a door reached any way but as the direct callee
    if ((n.type === 'Identifier' || n.type === 'MemberExpression') && DOOR_NAMES.has(nameOf(n))
        && isLooseDoorReference(n, parent)) out.push(`REF ${file}: ${nameOf(n)}`)
    if (n.type === 'MemberExpression' && n.computed && n.property?.type !== 'Literal'
        && GLOBAL_OBJECTS.has(n.object?.name)) out.push(`REF ${file}: ${n.object.name}[?]`)
    if (n.type === 'ObjectPattern') {
      for (const p of n.properties) {
        if (p.type === 'Property' && !p.computed && DOOR_NAMES.has(p.key?.name ?? p.key?.value)) out.push(`REF ${file}: ${p.key.name ?? p.key.value}`)
      }
    }
    if (n.type === 'NewExpression' && nameOf(n.callee) === 'XMLHttpRequest') out.push(`XHR ${file}`)
    if (n.type === 'NewExpression' && nameOf(n.callee) === 'Request') {
      const method = methodOf(n.arguments[1])
      if (method !== 'GET') write(method, urlOf(n.arguments[0]))
    }
    if (n.type === 'CallExpression') {
      const callee = nameOf(n.callee)
      const c = n.callee
      // N-3: a computed call (`x[k](...)`) on anything not provably a local literal could be any function,
      // a global's fetch included. (A global object's own `window[k]` is already reported above.)
      if (c.type === 'MemberExpression' && c.computed && c.property?.type !== 'Literal'
          && !GLOBAL_OBJECTS.has(c.object?.name) && !(c.object?.type === 'Identifier' && locals.has(c.object.name))) {
        out.push(`REF ${file}: ${c.object?.type === 'Identifier' ? c.object.name : '?'}[?]()`)
      }
      if (callee === 'updateAttributes' && !file.endsWith('/useBlockParams.js')) out.push(`UPDATE ${file}`)
      if (callee === 'fetch') {
        const [u, init] = n.arguments
        if (!init) {
          // N-3: one argument that is not a URL written here could be a Request built elsewhere
          const decided = u?.type === 'Literal' || u?.type === 'TemplateLiteral'
            || (u?.type === 'NewExpression' && nameOf(u.callee) === 'Request')          // judged at its `new`
          if (!decided) write('?', '?')
        } else {
          const method = methodOf(init)
          if (method !== 'GET') write(method, urlOf(u))
        }
      }
      if (callee === 'sendBeacon') write('POST', urlOf(n.arguments[0]))
      // Own keys only: a bare `HELPER_METHOD[callee]` also answers for Object.prototype's names, so
      // `x.toLocaleString(...)` / `x.toString()` read as writes (found by Task 11's money formatter).
      if (Object.hasOwn(HELPER_METHOD, callee || '')) write(HELPER_METHOD[callee], urlOf(n.arguments[0]))
    }
  })
  return out
}

/** ③'s other half: does `src` CALL updateAttributes (a call in code, never a word in a comment)? */
export function callsUpdateAttributes(src) {
  let found = false
  walk(parse(src), (n) => {
    if (n.type !== 'CallExpression') return
    const c = n.callee
    if ((c.type === 'Identifier' && c.name === 'updateAttributes')
        || (c.type === 'MemberExpression' && !c.computed && c.property?.name === 'updateAttributes')) found = true
  })
  return found
}

/** Every module id a source imports (static, re-export or a readable `import()`). */
function importedIds(file, src) {
  const ids = []
  walk(parse(src), (n) => {
    const node = n.type === 'ImportExpression' || n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration'
      || (n.type === 'ExportNamedDeclaration' && n.source) ? n.source : null
    const spec = node ? specOf(node) : null
    if (spec != null) ids.push(moduleIdOf(file, spec))
  })
  return ids
}

function files() {
  const out = []
  const walkDir = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walkDir(p); else out.push(p) } }
  for (const d of DIRS) if (existsSync(d)) walkDir(d)
  for (const f of EXTRA) if (existsSync(f)) out.push(f)
  return out.filter((p) => /\.(js|jsx)$/.test(p) && !/\.test\.jsx?$/.test(p))
}

describe('⛔⛔ no block owns a second write door', () => {
  it('the real block files: nothing found, and the rail read them', () => {
    const fs = files()
    expect(fs.map(rel)).toContain('app/src/pages/journal-2-0/components/notebook/blocks/useBlockParams.js')
    const problems = fs.flatMap((p) => problemsIn(rel(p), readFileSync(p, 'utf8')))
    expect(problems).toEqual([])
  })
  it('③ the ONE door still exists: useBlockParams.js calls updateAttributes (in code)', () => {
    const src = readFileSync(join(REPO, 'app/src/pages/journal-2-0/components/notebook/blocks/useBlockParams.js'), 'utf8')
    expect(callsUpdateAttributes(src)).toBe(true)
  })
  it('every write exception names a file that exists AND a call in it that the exception actually exempts', () => {
    const fs = files().map(rel)
    for (const [f, list] of Object.entries(WRITE_EXCEPTIONS)) {
      expect(fs, f).toContain(f)
      const bare = problemsIn(f, readFileSync(join(REPO, f), 'utf8'), {})        // with NO exceptions
      for (const e of list) expect(bare.some((p) => p.startsWith(`WRITE ${f}: ${e.method} `)), `${f} ${e.method}`).toBe(true)
    }
  })
  it('every write exception is ONE write method, a LITERAL URL template that is never a note, with a reason', () => {
    for (const [f, list] of Object.entries(WRITE_EXCEPTIONS)) {
      for (const e of list) expect(exceptionProblems(e), `${f}: ${JSON.stringify(e)}`).toEqual([])
    }
  })
  it('④ every IMPORT_ALLOW entry is a real module that a real block file imports, and none lifts the ban', () => {
    const used = new Set(files().flatMap((p) => importedIds(rel(p), readFileSync(p, 'utf8'))))
    for (const [id, why] of Object.entries(IMPORT_ALLOW)) {
      expect(used.has(id), `IMPORT_ALLOW names ${id}, which no block file imports`).toBe(true)
      expect(String(why).length, id).toBeGreaterThan(15)
      expect(BANNED_IMPORT.test(id), `${id} is banned and cannot be allow-listed`).toBe(false)
      if (id.startsWith('app/')) {
        // a module id carries no extension; a data file (houseSizing.json) is named with its own
        const isFile = (p) => existsSync(p) && statSync(p).isFile()
        expect(isFile(join(REPO, id)) || ['.js', '.jsx'].some((x) => isFile(join(REPO, `${id}${x}`))), `${id} is not a file`).toBe(true)
      }
    }
  })
  it('CONTROL — each kind of write door, an offline import and a stray updateAttributes are each seen', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "fetch('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, 'const opts = { method: "PUT" }; fetch(u, opts)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, "fetch('/x', { ...o })")).toEqual([`WRITE ${f}: ? /x`])
    expect(problemsIn(f, "fetch('/x', { method: m })")).toEqual([`WRITE ${f}: ? /x`])
    expect(problemsIn(f, "navigator.sendBeacon('/api/j2/notes/1', b)")).toEqual([`WRITE ${f}: POST /api/j2/notes/1`])
    expect(problemsIn(f, "jsonPut(`/api/j2/notes/${id}`, b)")).toEqual([`WRITE ${f}: PUT /api/j2/notes/{}`])
    expect(problemsIn(f, 'new XMLHttpRequest()')).toEqual([`XHR ${f}`])
    expect(problemsIn(f, "import { settleNoteWrite } from '../../../lib/offline/settleNoteWrite'")).toHaveLength(1)
    expect(problemsIn(f, 'updateAttributes({ params: {} })')).toEqual([`UPDATE ${f}`])
    expect(problemsIn(f, "fetch('/api/j2/regime')")).toEqual([])
    expect(problemsIn(f, "fetch('/api/j2/regime', { credentials: 'include' })")).toEqual([])
    // Object.prototype's own method names are not helpers (the lookup is own-keys only)
    expect(problemsIn(f, "const s = (1).toLocaleString('en-US'); const t = x.toString(); const v = o.valueOf()")).toEqual([])
    expect(problemsIn(f, "jsonPost('/api/j2/notes', b)")).toEqual([`WRITE ${f}: POST /api/j2/notes`])
  })
  it('CONTROL — the same text inside a comment or a string is NOT a match (code, never prose)', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "// fetch('/api/j2/notes/1', { method: 'PUT' })")).toEqual([])
    expect(problemsIn(f, "/* updateAttributes({ params: {} }) */ const a = 1")).toEqual([])
    expect(problemsIn(f, "// import { x } from '../../../lib/offline/settleNoteWrite'")).toEqual([])
    expect(problemsIn(f, "const s = \"updateAttributes({}) and fetch('/x', { method: 'PUT' })\"")).toEqual([])
    expect(callsUpdateAttributes('// updateAttributes({ params })\nconst a = 1')).toBe(false)
    expect(callsUpdateAttributes('/* updateAttributes(x) */ const s = "updateAttributes(y)"')).toBe(false)
    expect(callsUpdateAttributes('updateAttributes({ params })')).toBe(true)
    expect(callsUpdateAttributes('props.updateAttributes({ params })')).toBe(true)
  })
  it('CONTROL — ④ an import outside the allow-list is seen, by name; a sibling block file and a listed module are not', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "import useSWR from 'swr'")).toEqual([`UNLISTED ${f}: swr`])
    expect(problemsIn(f, "import { jsonGet } from '../../../lib/api'")).toEqual([`UNLISTED ${f}: ../../../lib/api`])
    expect(problemsIn(f, "export { x } from '../../../hooks/useJ2Trades'")).toEqual([`UNLISTED ${f}: ../../../hooks/useJ2Trades`])
    expect(problemsIn(f, "const A = () => import('../SomeEmbed')")).toEqual([`UNLISTED ${f}: ../SomeEmbed`])
    expect(problemsIn(f, 'const A = () => import(where)')).toEqual([`UNLISTED ${f}: ?`])
    expect(problemsIn(f, "import { useState } from 'react'")).toEqual([])
    expect(problemsIn(f, "import { blockLabel } from '../../../lib/journalBlocks'")).toEqual([])
    expect(problemsIn(f, "import { BlockEmpty } from './blockStates'\nimport s from './Blocks.module.css'")).toEqual([])
    expect(problemsIn(f, "const A = () => import('./PriceStampsBlock')")).toEqual([])
    // the ban outranks the allow-list: listing an offline module does not lift it
    const offline = 'app/src/pages/journal-2-0/lib/offline/settleNoteWrite'
    expect(problemsIn(f, "import { s } from '../../../lib/offline/settleNoteWrite'", {}, { [offline]: 'no' }))
      .toEqual([`IMPORT ${f}: ../../../lib/offline/settleNoteWrite`])
    // and lib/blocks files resolve the same way
    const g = 'app/src/pages/journal-2-0/lib/blocks/Y.js'
    expect(problemsIn(g, "import { blockSearch } from '../journalBlocks'")).toEqual([])
    expect(problemsIn(g, "import { patch } from '../notesApi'")).toEqual([`UNLISTED ${g}: ../notesApi`])
  })
  it('CONTROL — M-2: every other shape of a write door is seen, and the same text in a comment is not', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    // a Request object carries its own method
    expect(problemsIn(f, "fetch(new Request('/api/j2/notes/1', { method: 'PUT' }))")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, 'const r = new Request(u, opts)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, "fetch(new Request('/api/j2/regime'))")).toEqual([])            // a GET Request is a read
    // a door that is not the direct callee cannot be decided statically: it fails closed
    expect(problemsIn(f, "fetch.call(null, '/api/j2/notes/1', { method: 'PUT' })")).toEqual([`REF ${f}: fetch`])
    expect(problemsIn(f, "fetch.apply(null, ['/api/j2/notes/1', { method: 'PUT' }])")).toEqual([`REF ${f}: fetch`])
    expect(problemsIn(f, "const g = fetch; g('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`REF ${f}: fetch`])
    expect(problemsIn(f, "const g = window.fetch")).toEqual([`REF ${f}: fetch`])
    // (since N-3 the destructured global is itself a loose global reference, reported beside the door)
    expect(problemsIn(f, "const { fetch: g } = globalThis")).toEqual([`REF ${f}: fetch`, `REF ${f}: globalThis`])
    expect(problemsIn(f, 'const s = navigator.sendBeacon')).toEqual([`REF ${f}: sendBeacon`])
    expect(problemsIn(f, 'const X = XMLHttpRequest')).toEqual([`REF ${f}: XMLHttpRequest`])
    expect(problemsIn(f, "window[name]('/api/j2/notes/1')")).toEqual([`REF ${f}: window[?]`])
    // a computed but LITERAL global member is decided like the plain call
    expect(problemsIn(f, "globalThis['fetch']('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, "window['fetch']('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, "window['fetch']('/api/j2/regime')")).toEqual([])
    expect(problemsIn(f, "window.fetch('/api/j2/regime')")).toEqual([])
    // not references: a property NAMED fetch on an object literal
    expect(problemsIn(f, 'const o = { fetch: 1, sendBeacon: 2 }')).toEqual([])
    // the commented forms are never matches
    expect(problemsIn(f, [
      "// fetch(new Request('/api/j2/notes/1', { method: 'PUT' }))",
      "// fetch.call(null, '/api/j2/notes/1', { method: 'PUT' })",
      "/* fetch.apply(null, ['/x', { method: 'PUT' }]) */",
      '// const g = fetch; g(u, { method: "PUT" })',
      "/* globalThis['fetch']('/api/j2/notes/1', { method: 'PUT' }) */ const k = 1",
      "// window['fetch']('/api/j2/notes/1', { method: 'PUT' })",
    ].join('\n'))).toEqual([])
  })
  it('CONTROL — M-1: an exception URL is a LITERAL template; a broad, regex-shaped or note URL is refused', () => {
    const why = 'a reason long enough to be a reason'
    for (const url of ['\\?', '[^n].*', '.*', '?', '/api/j2/.*', '/api/j2/trades/\\d+', '/api/j2/trades/{}/a|b', '']) {
      expect(exceptionProblems({ method: 'PUT', url, why }), JSON.stringify(url)).not.toEqual([])
    }
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/trades/{}/adherence', why })).toEqual([])
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/notes/{}', why })).toEqual(['/api/j2/notes/{} is a note URL'])
    expect(exceptionProblems({ method: 'GET', url: '/api/j2/trades/{}', why })).toEqual(['GET is not a write method'])
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/trades/{}', why: 'x' })).toEqual(['the reason is missing or too short'])
    // matching is literal: an entry exempts its own template and nothing else
    const f = 'app/src/pages/journal-2-0/lib/blocks/Y.js'
    const ex = { [f]: [{ method: 'PUT', url: '/api/j2/trades/{}/adherence', why }] }
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'PUT' })", ex)).toEqual([])
    expect(problemsIn(f, "fetch('/api/j2/trades/7/adherence', { method: 'PUT' })", ex)).toHaveLength(1)
    // and a broad entry exempts NOTHING, even when a test hands it straight to problemsIn
    const broad = { [f]: [{ method: 'PUT', url: '?', why }] }
    expect(problemsIn(f, "fetch(u, { method: 'PUT' })", broad)).toEqual([`WRITE ${f}: PUT ?`])
  })
  it('CONTROL — N-2: a literal template that is broad, or that steps around the note refusal, is refused', () => {
    const why = 'a reason long enough to be a reason'
    for (const url of ['/api/{}', '/api/j2/{}', '/api/j2/{}/adherence', '/api//j2/notes/{}', '/api/j2/x/../notes/{}',
      '/api/j2/./notes/{}', '/api/j2/trades//{}', '/api/j2/trades/{}/..']) {
      expect(exceptionProblems({ method: 'PUT', url, why }), url).not.toEqual([])
    }
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/x/../notes/{}', why }))
      .toEqual(['"/api/j2/x/../notes/{}" has a dot segment or an empty segment', '/api/j2/x/../notes/{} is a note URL'])
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/{}', why })).toEqual(['/api/j2/{} opens with {} (a whole path)'])
    // control: a narrow template still passes
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/trades/{}/adherence', why })).toEqual([])
  })
  it('CONTROL — N-3: an aliased or passed-in global, a one-argument fetch of a non-literal and a WebSocket fail closed', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "const w = window; w[k]('/api/j2/notes/1', { method: 'PUT' })"))
      .toEqual([`REF ${f}: window`, `REF ${f}: w[?]()`])
    expect(problemsIn(f, 'const g = globalThis')).toEqual([`REF ${f}: globalThis`])
    expect(problemsIn(f, "const run = (w, k) => w[k]('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`REF ${f}: w[?]()`])
    expect(problemsIn(f, 'const run = (o, k) => o?.[k]()')).toEqual([`REF ${f}: o[?]()`])
    expect(problemsIn(f, 'fetch(req)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, 'fetch(props.request)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, "new WebSocket('wss://x')")).toEqual([`SOCKET ${f}`])
    expect(problemsIn(f, 'const S = WebSocket')).toEqual([`REF ${f}: WebSocket`])
    // provably local, and reads, stay clean
    expect(problemsIn(f, "const H = { a: () => 1 }; const run = (k) => H[k]()")).toEqual([])
    expect(problemsIn(f, "const L = [() => 1]; L[i]()")).toEqual([])
    expect(problemsIn(f, "fetch('/api/j2/regime')")).toEqual([])
    expect(problemsIn(f, 'fetch(`/api/j2/trades/${id}`)')).toEqual([])
    expect(problemsIn(f, 'window.location.reload()')).toEqual([])
    expect(problemsIn(f, "const n = window.navigator.onLine; const v = window['innerWidth']")).toEqual([])
    // the near-names a real body uses are not doors
    expect(problemsIn(f, [
      'const { refetch, isFetching, fetchedAt } = q',
      'refetch()',
      'const t = row.fetchedAt; const busy = params.isFetching; const r = q.refetch',
    ].join('\n'))).toEqual([])
    // commented forms are never matches
    expect(problemsIn(f, [
      "// const w = window; w[k]('/api/j2/notes/1', { method: 'PUT' })",
      '/* fetch(req) */',
      "// new WebSocket('wss://x')",
      'const k = 1',
    ].join('\n'))).toEqual([])
  })
  it('CONTROL — N-4: utils/lazyWithRetry gives a block file ONLY the named isChunkLoadError', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    const m = '../../../../../utils/lazyWithRetry'
    expect(problemsIn(f, `import { isChunkLoadError } from '${m}'`)).toEqual([])
    expect(problemsIn(f, `import { isChunkLoadError as isChunk } from '${m}'`)).toEqual([])
    expect(problemsIn(f, `import lazyWithRetry from '${m}'`)).toEqual([`NAMES ${f}: ${m} (default)`])
    expect(problemsIn(f, `import lazyWithRetry, { isChunkLoadError } from '${m}'`)).toEqual([`NAMES ${f}: ${m} (default)`])
    expect(problemsIn(f, `import { isChunkLoadError, RELOAD_FLAG } from '${m}'`)).toEqual([`NAMES ${f}: ${m} (RELOAD_FLAG)`])
    expect(problemsIn(f, `import * as L from '${m}'`)).toEqual([`NAMES ${f}: ${m} (*)`])
    expect(problemsIn(f, `const L = () => import('${m}')`)).toEqual([`NAMES ${f}: ${m} (import())`])
    expect(problemsIn(f, `export { default } from '${m}'`)).toEqual([`NAMES ${f}: ${m} (default)`])
    expect(problemsIn(f, `// import lazyWithRetry from '${m}'\nconst k = 1`)).toEqual([])
    // every name-limited module is also an allow-listed one
    for (const id of Object.keys(IMPORT_NAMES)) expect(Object.hasOwn(IMPORT_ALLOW, id), id).toBe(true)
  })
  it('CONTROL — an exception is method+URL, never the whole file (IR-I b)', () => {
    const f = 'app/src/pages/journal-2-0/lib/blocks/Y.js'
    const ex = { [f]: [{ method: 'PUT', url: '/api/j2/trades/{}/adherence', why: 'a reason long enough to be a reason' }] }
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'PUT' })", ex)).toEqual([])
    expect(problemsIn(f, "fetch(`/api/j2/notes/${id}`, { method: 'PUT' })", ex)).toEqual([`WRITE ${f}: PUT /api/j2/notes/{}`])
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'DELETE' })", ex)).toHaveLength(1)
  })
})
