/**
 * S1 / H14 — the schema table covers every type the LIVE editor registers, and
 * the header this bundle sends is derived from that live schema.
 *
 * ⛔ Read from a CONSTRUCTED editor's `schema.nodes` / `schema.marks`, never
 * from a list: a node added to `buildExtensions()` without a table entry reads
 * as 0 on the server ("every client can read this"), which is how a note blanks.
 * The server/client equality is the Python rail
 * (tests/test_notebook_schema_guard.py), which parses notebookSchema.js.
 *
 * ⚠️ Deliberately NOT asserted: "every table entry is registered". A rollback
 * that reverts the features and keeps the guard commit leaves wave-5 entries in
 * the table with no extension behind them — that is correct, and the derived
 * declaration drops below their level (see the unit cases below).
 */
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { Editor } from '@tiptap/core'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildExtensions, editorSchema } from './tiptap'
import {
  NOTEBOOK_SCHEMA_HEADER, NOTEBOOK_TYPE_SCHEMA, deriveDeclaredSchema, notebookSchemaHeaders,
} from './notebookSchema'
import { runImport } from './importer/commit'
import { revertChartEmbed } from './importer/enrichment'
import { sendNoteUpdate } from './offline/useOutboxDrain'
import { useJ2Note } from '../hooks/useJ2Notes'
import { saveEntryBody } from '../../modelbook/builder/UpbEntryPage'

let editor = null
afterEach(() => { editor?.destroy(); editor = null })

describe('the note-type schema table (S1)', () => {
  it('holds every node and mark name the live editor schema registers', () => {
    editor = new Editor({ extensions: buildExtensions() })
    const names = [...Object.keys(editor.schema.nodes), ...Object.keys(editor.schema.marks)]
    // Non-vacuity: an editor that registered nothing would pass any subset test.
    // Named from the PRE-EXISTING (level 0) set on purpose -- a core node, a
    // custom node and a mark, so the walk provably reads both registries.
    // ⛔ Never a wave-5 name here: after a rollback that keeps this commit the
    // editor registers none of them, and a control naming inlineMath/highlight
    // went red in exactly the state the guard exists for (measured in a rollback
    // simulation, docs/notebook/wave5-rollback.md).
    expect(names.length).toBeGreaterThanOrEqual(35)
    expect(names).toContain('paragraph')
    expect(names).toContain('callout')
    expect(names).toContain('bold')
    const missing = names.filter((n) => !Object.hasOwn(NOTEBOOK_TYPE_SCHEMA, n))
    expect(missing).toEqual([])
    // A node and a mark sharing one name would make one table entry answer
    // for two types.
    const both = Object.keys(editor.schema.nodes).filter((n) => editor.schema.marks[n])
    expect(both).toEqual([])
  })

  it('sends the declaration derived from THIS bundle’s editor schema', async () => {
    editor = new Editor({ extensions: buildExtensions() })
    const fromEditor = deriveDeclaredSchema(editor.schema)
    expect(deriveDeclaredSchema(editorSchema())).toBe(fromEditor)
    expect(await notebookSchemaHeaders()).toEqual({ [NOTEBOOK_SCHEMA_HEADER]: String(fromEditor) })
  })
})

describe('every body-writing door sends the declaration (S1)', () => {
  const realFetch = globalThis.fetch
  let calls
  beforeEach(() => {
    calls = []
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init })
      return { ok: true, status: 200, json: async () => ({ note: { id: 'n1', updatedAt: 'r2' }, entry: { id: 'e1' } }) }
    })
  })
  afterEach(() => { globalThis.fetch = realFetch })
  const expected = async () => String(deriveDeclaredSchema(editorSchema()))
  const headerOf = (c) => c.init.headers?.[NOTEBOOK_SCHEMA_HEADER]

  // ⛔⛔ B1: the drain FORWARDS a body it never read, so it declares the level
  // of the bundle that WROTE it — the entry's `writtenSchema`, never more than
  // this bundle's own. ⚰️ This case used to send an UNSTAMPED entry and expect
  // this bundle's level: it pinned the hole as correct.
  it('the outbox drain’s PUT declares the WRITER’s level: unstamped ⇒ 0, stamped ⇒ min(stamp, this bundle)', async () => {
    const entry = (extra) => ({ noteId: 'n1', patch: { title: 't', bodyJson: { type: 'doc', content: [] } }, baseUpdatedAt: 'r1', ...extra })
    await sendNoteUpdate(entry({}))
    await sendNoteUpdate(entry({ writtenSchema: Number(await expected()) }))
    await sendNoteUpdate(entry({ writtenSchema: 99 }))
    const puts = calls.filter((c) => c.init.method === 'PUT')
    expect(puts.map((c) => c.url)).toEqual(['/api/j2/notes/n1', '/api/j2/notes/n1', '/api/j2/notes/n1'])
    expect(puts.map(headerOf)).toEqual(['0', await expected(), await expected()])
  })

  it('the shared note PUT when it carries a body — its own read by default, a forwarded body at its stamp', async () => {
    const { result } = renderHook(() => useJ2Note('n1'))
    await act(async () => { await result.current.update({ bodyJson: { type: 'doc', content: [] } }) })
    // The editor forwarding words it recovered from a capture (B1).
    await act(async () => { await result.current.update({ bodyJson: { type: 'doc', content: [] } }, { writtenSchema: 0 }) })
    await act(async () => { await result.current.update({ bodyJson: { type: 'doc', content: [] } }, { writtenSchema: undefined }) })
    const puts = calls.filter((c) => c.init.method === 'PUT')
    expect(puts.map((c) => c.url)).toEqual(['/api/j2/notes/n1', '/api/j2/notes/n1', '/api/j2/notes/n1'])
    // ⛔ An explicit option without a usable stamp is 0 — only OMITTING it is "my own read".
    expect(puts.map(headerOf)).toEqual([await expected(), '0', '0'])
  })

  it('the Model Book playbook entry’s body write', async () => {
    await saveEntryBody('e1', { type: 'doc', content: [] })
    const put = calls.find((c) => c.init.method === 'PUT')
    expect(put.url).toBe('/api/upb/entries/e1')
    expect(headerOf(put)).toBe(await expected())
  })

  // ⚰️ These two shipped WITHOUT the header in the first cut of this guard and
  // were found by enumerating every body writer (H14 step 2). Neither is an
  // editor, so neither can blank a note -- but both PUT a body, so the server
  // read them as the oldest client and refused them on any note carrying a
  // wave-5 type. The importer's own Obsidian adapter turns ==x== into a
  // highlight mark, so an imported note with a highlight AND an image failed
  // its media rewrite with a 409 and kept its import-ref:// placeholder.
  it('the importer’s media-rewrite PUT', async () => {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/import/confirm')) {
        return new Response(JSON.stringify({ created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (String(url) === '/api/j2/notes/n1/images') return new Response(JSON.stringify({ url: '/img/a.png' }))
      return new Response(JSON.stringify({ note: { id: 'n1', updatedAt: 'r2' } }))
    })
    await runImport({
      source: 'file', destFolderId: null, onProgress: () => {},
      docs: [{
        importKey: 'file:a.md', title: 'a', tags: [], folderPath: [], bodyPlain: 'x',
        bodyJson: { type: 'doc', content: [{ type: 'image', attrs: { src: 'import-ref://a.png' } }] },
        media: [{ ref: 'a.png', kind: 'image', name: 'a.png', vfile: { bytes: async () => new Uint8Array([1]), path: 'a.png' } }],
        links: [],
      }],
    })
    const put = calls.find((c) => c.init.method === 'PUT' && c.url === '/api/j2/notes/n1')
    expect(put).toBeTruthy()
    expect(headerOf(put)).toBe(await expected())
  })

  it('the enrichment undo’s PUT (revertChartEmbed)', async () => {
    await revertChartEmbed('n1', { type: 'doc', content: [{ type: 'paragraph' }, { type: 'widgetEmbed', attrs: {} }] })
    const put = calls.find((c) => c.init.method === 'PUT')
    expect(put.url).toBe('/api/j2/notes/n1')
    expect(headerOf(put)).toBe(await expected())
  })
})

// ── EVERY client PUT of a note or playbook-entry BODY declares (S1, H14) ────
//
// ⛔ Enumerated from the AST of every product file under app/src, never from a
// list. The behavioural cases above name the doors known today; this finds the
// one added tomorrow -- the first cut of this guard missed two, and only an
// enumeration found them.
//
// A site is a call to `fetch(<item URL>, { method: 'PUT', body: JSON.stringify(X) })`
// or `upbFetch(<item URL>, 'PUT', X, headers)`, where the item URL is the
// template `/api/j2/notes/${id}` or `/api/upb/entries/${id}` exactly (a
// sub-resource such as `/embeds` is a different route). X is classified:
//   body     -- an object literal naming bodyJson / body_json;
//   metadata -- an object literal naming neither (properties, title, ...);
//   dynamic  -- anything else (`JSON.stringify(patch)`): it MAY carry a body.
// A body or dynamic site must declare: its headers mention
// notebookSchemaHeaders, or spread a variable the enclosing function
// initialises from it.
// ⚠️ STATED LIMITS — all of them known (wave 5 final review, N3: measured with
// this file's own `bodyPutSites` against constructed cases). NOT recognised:
//   · a URL built by concatenation, or held in a variable (`fetch(url, …)`);
//   · anything after the id — a query string (`…/${id}?v=2`, which still routes
//     to update_note) or a trailing slash: the matcher wants exactly two quasis;
//   · an origin-prefixed template (`${API}/api/j2/notes/${id}`, three quasis);
//   · `method: 'put'` in lower case (fetch normalises it; this compares 'PUT');
//   · `window.fetch` / `globalThis.fetch` — a member-expression callee;
//   · the options object passed as a variable (`fetch(url, init)`);
//   · a PUT routed through any wrapper other than `upbFetch`;
//   · `.ts`, `.tsx` and `.mjs` files (not scanned).
//   ⚠️ And `declares` is a SUBSTRING test on the headers expression: a COMMENT
//   naming notebookSchemaHeaders inside `headers: {…}` counts as declaring.
// Each of those fails SAFE: an undeclared body PUT reads as the oldest client
// and is refused on a newer note (over-refusal, the fd87271fd class) — it can
// never blank one. ⛔ ONE LIMIT IS NOT SAFE, and no AST check here can see it:
// this rail asks WHETHER a door declares, not WHOSE level. A door that FORWARDS
// a body it never read (the outbox, recovered words) must declare its WRITER's
// level — `notebookSchemaHeaders({ writtenSchema })` — and a forwarding door that
// declares its own passes this rail. That was B1 (`sendNoteUpdate`). The two
// forwarding doors are pinned by the behavioural cases above and by the B1 rails
// (`offline/writtenSchemaDrain.test.js`, `NoteEditorPage.writtenSchema.test.jsx`).
// The non-vacuity case pins the doors that exist, so a refactor that hides one
// fails there instead.
const SRC_ROOT = path.resolve(__dirname, '../../..')
const JsxParser = Parser.extend(jsx())
const ITEM_URLS = ['/api/j2/notes/', '/api/upb/entries/']
const BODY_KEYS = new Set(['bodyJson', 'body_json'])
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

function productFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      productFiles(p, out)
    } else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.|\.spec\.|^setupTests|^test-utils/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function walkAst(node, visit, stack = []) {
  if (!node || typeof node.type !== 'string') return
  visit(node, stack)
  stack.push(node)
  for (const key of Object.keys(node)) {
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => walkAst(c, visit, stack))
    else if (v && typeof v.type === 'string') walkAst(v, visit, stack)
  }
  stack.pop()
}

const keyName = (p) => p.key?.name ?? p.key?.value
const propOf = (obj, name) => obj.properties.find((p) => p.type === 'Property' && !p.computed && keyName(p) === name)

function isItemUrl(node) {
  if (node?.type !== 'TemplateLiteral') return false
  const q = node.quasis.map((x) => x.value.cooked)
  return q.length === 2 && q[1] === '' && ITEM_URLS.includes(q[0])
}

function payloadKind(arg) {
  if (!arg || arg.type !== 'ObjectExpression') return 'dynamic'
  if (arg.properties.some((p) => p.type !== 'Property' || p.computed)) return 'dynamic'
  return arg.properties.some((p) => BODY_KEYS.has(keyName(p))) ? 'body' : 'metadata'
}

function declares(code, headers, stack) {
  if (!headers) return false
  if (code.slice(headers.start, headers.end).includes('notebookSchemaHeaders')) return true
  const spread = headers.type === 'ObjectExpression'
    ? headers.properties.filter((p) => p.type === 'SpreadElement' && p.argument.type === 'Identifier').map((p) => p.argument.name)
    : []
  const fn = [...stack].reverse().find((a) => FN_TYPES.has(a.type))
  if (!fn || !spread.length) return false
  let found = false
  walkAst(fn.body, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && spread.includes(n.id.name) && n.init
      && code.slice(n.init.start, n.init.end).includes('notebookSchemaHeaders')) found = true
  })
  return found
}

export function bodyPutSites(code, file = '<code>') {
  const ast = JsxParser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const sites = []
  walkAst(ast, (n, stack) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier') return
    const [url, a1, a2, a3] = n.arguments
    if (!isItemUrl(url)) return
    let kind
    let headers
    if (n.callee.name === 'fetch' && a1?.type === 'ObjectExpression') {
      if (propOf(a1, 'method')?.value?.value !== 'PUT') return
      const b = propOf(a1, 'body')?.value
      const stringified = b?.type === 'CallExpression' && b.callee.type === 'MemberExpression'
        && b.callee.object.name === 'JSON' && b.callee.property.name === 'stringify'
      kind = stringified ? payloadKind(b.arguments[0]) : 'dynamic'
      headers = propOf(a1, 'headers')?.value ?? null
    } else if (n.callee.name === 'upbFetch' && a1?.value === 'PUT') {
      kind = payloadKind(a2)
      headers = a3 ?? null
    } else {
      return
    }
    sites.push({ at: `${file}:${n.loc.start.line}`, kind, declares: declares(code, headers, stack) })
  })
  return sites
}

describe('every client PUT of a note or entry BODY declares its schema (S1, enumerated)', () => {
  const rel = (f) => path.relative(SRC_ROOT, f).split(path.sep).join('/')
  const sites = productFiles(SRC_ROOT).flatMap((f) => bodyPutSites(fs.readFileSync(f, 'utf8'), rel(f)))
  const filesOf = (kind) => sites.filter((s) => s.kind === kind).map((s) => s.at.replace(/:\d+$/, ''))

  it('the classifier tells a body, a metadata write and a declaration apart (control)', () => {
    const put = (headers, payload) => `async function f(id, patch) {\n  const schema = await notebookSchemaHeaders()\n  await fetch(\`/api/j2/notes/\${id}\`, { method: 'PUT', headers: ${headers}, body: JSON.stringify(${payload}) })\n}`
    expect(bodyPutSites(put('{}', '{ bodyJson: b }'))).toEqual([{ at: '<code>:3', kind: 'body', declares: false }])
    expect(bodyPutSites(put('{ ...(await notebookSchemaHeaders()) }', '{ bodyJson: b }'))[0].declares).toBe(true)
    expect(bodyPutSites(put('{ ...schema }', 'patch'))).toEqual([{ at: '<code>:3', kind: 'dynamic', declares: true }])
    expect(bodyPutSites(put('{ ...other }', 'patch'))[0].declares).toBe(false)
    expect(bodyPutSites(put('{}', '{ properties: p }'))[0].kind).toBe('metadata')
    expect(bodyPutSites('fetch(`/api/j2/notes/${id}/embeds`, { method: \'PUT\', body: JSON.stringify({ bodyJson: b }) })')).toEqual([])
    expect(bodyPutSites('upbFetch(`/api/upb/entries/${id}`, \'PUT\', { body_json: b }, await notebookSchemaHeaders())'))
      .toEqual([{ at: '<code>:1', kind: 'body', declares: true }])
  })

  it('finds the doors that exist today (non-vacuity)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10)
    expect(filesOf('body')).toEqual(expect.arrayContaining([
      'pages/journal-2-0/lib/importer/commit.js',
      'pages/journal-2-0/lib/importer/enrichment.js',
      'pages/modelbook/builder/UpbEntryPage.jsx',
    ]))
    expect(filesOf('dynamic')).toEqual(expect.arrayContaining([
      'pages/journal-2-0/hooks/useJ2Notes.js',
      'pages/journal-2-0/lib/offline/useOutboxDrain.js',
    ]))
    expect(filesOf('metadata')).toEqual(expect.arrayContaining(['pages/journal-2-0/lib/noteCreation.js']))
  })

  it('no door PUTs a body without declaring the schema it can read', () => {
    expect(sites.filter((s) => s.kind !== 'metadata' && !s.declares).map((s) => s.at)).toEqual([])
  })
})

describe('deriveDeclaredSchema', () => {
  const fake = (drop = []) => {
    const nodes = {}
    const marks = {}
    for (const name of Object.keys(NOTEBOOK_TYPE_SCHEMA)) {
      if (!drop.includes(name)) (['bold', 'code', 'italic', 'link', 'strike', 'textStyle', 'underline', 'highlight', 'textColor'].includes(name) ? marks : nodes)[name] = {}
    }
    return { nodes, marks }
  }
  const top = Math.max(...Object.values(NOTEBOOK_TYPE_SCHEMA))

  it('declares the newest level when every type is registered', () => {
    expect(top).toBe(1)
    expect(deriveDeclaredSchema(fake())).toBe(top)
  })
  it('drops below a level one of whose types is missing — the rollback case', () => {
    expect(deriveDeclaredSchema(fake(['inlineMath']))).toBe(0)
    expect(deriveDeclaredSchema(fake(['textColor']))).toBe(0)
  })
  it('never declares below 0, and an unreadable schema is the oldest client', () => {
    expect(deriveDeclaredSchema(fake(['paragraph']))).toBe(0)
    expect(deriveDeclaredSchema(null)).toBe(0)
    expect(deriveDeclaredSchema({})).toBe(0)
  })
})
