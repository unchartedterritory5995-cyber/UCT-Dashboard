// @vitest-environment node
/**
 * Wave 11 (lane 11B), controller ruling (3): computed values never reach the
 * offline working copy.
 *
 * A formula or rollup value is computed by the server from inputs that can
 * change on another device. Kept on this device it would be shown later as if
 * current. The finding (2026-10-01) is that nothing stores one:
 *   1. the IndexedDB records in lib/offline/ are written from object literals that
 *      name the editor's fields only (noteId, title, subtitle, bodyJson, the
 *      baseline and outbox bookkeeping). None names `computed` or
 *      `propertiesJson`;
 *   2. the list rows that carry `computed` live in SWR's cache, and the app's one
 *      <SWRConfig> (App.jsx) passes no `provider`, so that cache is an in-memory
 *      Map that dies with the tab.
 * This rail keeps both true: it fails if a record literal in lib/offline/ gains
 * either key, or if a production <SWRConfig> gains a persistent provider. Each
 * check has a CONTROL proving it can fail.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const SRC_ROOT = join(__dirname, '..', '..', '..', '..')          // app/src
const OFFLINE = join(__dirname, '..', 'offline')
const FORBIDDEN_RECORD_KEYS = ['computed', 'propertiesJson']

function parse(text) {
  return JsxParser.parse(text, { ecmaVersion: 'latest', sourceType: 'module' })
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    const v = node[key]
    if (Array.isArray(v)) v.forEach((child) => walk(child, visit))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, visit)
  }
}

function keyName(prop) {
  if (prop.type !== 'Property') return null
  return prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value)
}

/** Every object-literal key in FORBIDDEN_RECORD_KEYS, with its offset. */
function forbiddenKeys(text) {
  const hits = []
  walk(parse(text), (n) => {
    if (n.type !== 'ObjectExpression') return
    for (const p of n.properties) {
      const k = keyName(p)
      if (k && FORBIDDEN_RECORD_KEYS.includes(k)) hits.push(`${k}@${p.start}`)
    }
  })
  return hits
}

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__fixtures__') continue
      out.push(...sourceFiles(p))
    } else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) {
      out.push(p)
    }
  }
  return out
}

/** Top-level `const NAME = { ... }` objects of one module, by name. */
function topLevelObjects(ast) {
  const out = {}
  for (const st of ast.body) {
    if (st.type !== 'VariableDeclaration') continue
    for (const d of st.declarations) {
      if (d.id.type === 'Identifier' && d.init?.type === 'ObjectExpression') out[d.id.name] = d.init
    }
  }
  return out
}

/** For every <SWRConfig value={...}> in a module: whether it passes a provider. */
function swrConfigMounts(text) {
  const ast = parse(text)
  const consts = topLevelObjects(ast)
  const mounts = []
  walk(ast, (n) => {
    if (n.type !== 'JSXOpeningElement' || n.name.name !== 'SWRConfig') return
    const attr = n.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'value')
    const expr = attr?.value?.expression
    const obj = expr?.type === 'ObjectExpression' ? expr
      : expr?.type === 'Identifier' ? consts[expr.name] : null
    mounts.push({
      resolved: Boolean(obj),
      provider: obj ? obj.properties.some((p) => keyName(p) === 'provider') : null,
    })
  })
  return mounts
}

describe('the offline working copy never stores a computed value', () => {
  const files = sourceFiles(OFFLINE)

  it('reads the offline modules (non-vacuity)', () => {
    const names = files.map((f) => relative(OFFLINE, f).replace(/\\/g, '/'))
    expect(names).toContain('useDurableNote.js')
    expect(names).toContain('outboxDrain.js')
    expect(names).toContain('notebookDb.js')
  })

  it('no object literal in lib/offline/ names `computed` or `propertiesJson`', () => {
    const found = {}
    for (const f of files) {
      const hits = forbiddenKeys(readFileSync(f, 'utf8'))
      if (hits.length) found[relative(OFFLINE, f)] = hits
    }
    expect(found).toEqual({})
  })

  it('CONTROL: a record literal carrying either key is caught', () => {
    expect(forbiddenKeys('const r = { noteId, bodyJson, computed: row.computed }')).toHaveLength(1)
    expect(forbiddenKeys("put({ noteId, 'propertiesJson': p })")).toHaveLength(1)
    expect(forbiddenKeys('const r = { noteId, bodyJson }')).toEqual([])
  })
})

describe("the list's SWR cache stays in memory", () => {
  const mounting = sourceFiles(SRC_ROOT)
    // Test harnesses, never mounted by the app: the a11y fixture and src/testing/.
    .filter((f) => !/[\\/]a11y[\\/]fixtures\.jsx$/.test(f))
    .filter((f) => !relative(SRC_ROOT, f).replace(/\\/g, '/').startsWith('testing/'))
    .filter((f) => readFileSync(f, 'utf8').includes('<SWRConfig'))

  it('App.jsx is the one production <SWRConfig>', () => {
    expect(mounting.map((f) => relative(SRC_ROOT, f).replace(/\\/g, '/'))).toEqual(['App.jsx'])
  })

  it('it passes no provider, so the cache is a Map that dies with the tab', () => {
    const mounts = swrConfigMounts(readFileSync(join(SRC_ROOT, 'App.jsx'), 'utf8'))
    expect(mounts.length).toBeGreaterThan(0)
    for (const m of mounts) {
      expect(m.resolved).toBe(true)            // an unresolvable value is not a pass
      expect(m.provider).toBe(false)
    }
  })

  it('CONTROL: a provider is caught, inline or through a const', () => {
    const viaConst = "const C = { dedupingInterval: 1, provider: () => new Map() }\nexport default () => <SWRConfig value={C}><a/></SWRConfig>"
    expect(swrConfigMounts(viaConst)).toEqual([{ resolved: true, provider: true }])
    const inline = 'export default () => <SWRConfig value={{ provider: localStorageProvider }}><a/></SWRConfig>'
    expect(swrConfigMounts(inline)).toEqual([{ resolved: true, provider: true }])
  })
})
