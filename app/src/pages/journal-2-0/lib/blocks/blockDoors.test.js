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
 * file -> [{ method, url (a RegExp source over the call's URL, `{}` standing for each ${…}), why }]
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

function exempt(exceptions, file, method, url) {
  return (exceptions[file] || []).some((e) => e.method === method && new RegExp(`^${e.url}$`).test(url))
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

function walk(n, fn) {
  if (!n || typeof n.type !== 'string') return
  fn(n)
  for (const k of Object.keys(n)) {
    const v = n[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, fn)
  }
}

const parse = (src) => P.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

export function problemsIn(file, src, exceptions = WRITE_EXCEPTIONS, allow = IMPORT_ALLOW) {
  const out = []
  const write = (method, url) => { if (!exempt(exceptions, file, method, url)) out.push(`WRITE ${file}: ${method} ${url}`) }
  const imported = (node) => { const p = importProblem(file, specOf(node), allow); if (p) out.push(p) }
  walk(parse(src), (n) => {
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration'
        || (n.type === 'ExportNamedDeclaration' && n.source)) imported(n.source)
    if (n.type === 'ImportExpression') imported(n.source)
    if (n.type === 'NewExpression' && n.callee?.name === 'XMLHttpRequest') out.push(`XHR ${file}`)
    if (n.type === 'CallExpression') {
      const callee = n.callee.type === 'Identifier' ? n.callee.name : n.callee.property?.name
      if (callee === 'updateAttributes' && !file.endsWith('/useBlockParams.js')) out.push(`UPDATE ${file}`)
      if (callee === 'fetch') {
        const method = methodOf(n.arguments[1])
        if (method !== 'GET') write(method, urlOf(n.arguments[0]))
      }
      if (callee === 'sendBeacon') write('POST', urlOf(n.arguments[0]))
      if (HELPER_METHOD[callee]) write(HELPER_METHOD[callee], urlOf(n.arguments[0]))
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
  it('every write exception is ONE write method and a URL that is never a note, with a reason', () => {
    for (const [f, list] of Object.entries(WRITE_EXCEPTIONS)) {
      for (const e of list) {
        expect(WRITE_METHODS, `${f}: ${e.method}`).toContain(e.method)
        expect(String(e.why || '').length, `${f}: why`).toBeGreaterThan(20)
        for (const note of ['/api/j2/notes', '/api/j2/notes/{}', '/api/j2/notes/{}/meta']) {
          expect(new RegExp(`^${e.url}$`).test(note), `${f}: ${e.url} exempts a note write`).toBe(false)
        }
      }
    }
  })
  it('④ every IMPORT_ALLOW entry is a real module that a real block file imports, and none lifts the ban', () => {
    const used = new Set(files().flatMap((p) => importedIds(rel(p), readFileSync(p, 'utf8'))))
    for (const [id, why] of Object.entries(IMPORT_ALLOW)) {
      expect(used.has(id), `IMPORT_ALLOW names ${id}, which no block file imports`).toBe(true)
      expect(String(why).length, id).toBeGreaterThan(15)
      expect(BANNED_IMPORT.test(id), `${id} is banned and cannot be allow-listed`).toBe(false)
      if (id.startsWith('app/')) {
        expect(['.js', '.jsx'].some((x) => existsSync(join(REPO, `${id}${x}`))), `${id} is not a file`).toBe(true)
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
  it('CONTROL — an exception is method+URL, never the whole file (IR-I b)', () => {
    const f = 'app/src/pages/journal-2-0/lib/blocks/Y.js'
    const ex = { [f]: [{ method: 'PUT', url: '/api/j2/trades/\\{\\}/adherence', why: 'test' }] }
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'PUT' })", ex)).toEqual([])
    expect(problemsIn(f, "fetch(`/api/j2/notes/${id}`, { method: 'PUT' })", ex)).toEqual([`WRITE ${f}: PUT /api/j2/notes/{}`])
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'DELETE' })", ex)).toHaveLength(1)
  })
})
