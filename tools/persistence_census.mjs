/**
 * TERM-076 (FB-A12-02) — the census of every member-persisted setting in `app/src`, and which
 * ones follow the ACCOUNT (cross-device) versus the BROWSER (device-local).
 *
 * ⛔ WHY THIS EXISTS. Some of a member's work follows the account and some follows the browser,
 * and the boundary was never decided — it is "an accident of implementation order, not a
 * decision" (D-11 §4.1, quoted by F-01 PROD-C3). FB-A12-02 asks for the rule to be PUBLISHED,
 * and its anti-pattern note is the whole design constraint of this file:
 *
 *   > DOC-1 on the publication: the matrix must be DERIVED FROM THE STORE EACH KEY ACTUALLY
 *   > USES, never typed.  …  The published matrix changes when a key's store changes, with no
 *   > content edit — that is the whole test.
 *
 * So `store` and `scope` on every manifest entry are computed here from the call site, and the
 * Settings card that tells a member "this syncs / this stays on this device" reads them from the
 * manifest. A key that moves from `localStorage.setItem` to `setPref` moves its row from one list
 * to the other with no edit to any copy. What a human DOES declare per entry is only what the
 * code cannot know: the member-facing `surface` and `label`, and a `kind` (setting / work /
 * state / cache / internal).
 *
 * ⛔ AN AST, NEVER A GREP. The repo's comments are full of storage calls quoted as prose
 * (`localStorage['uct.chartTiming']`, "`setPrefMerged` (same module)") — a text search reports
 * those as keys, which is the vacuous-pass `lesson_probe_names_must_be_derived_not_typed`
 * records. Comments and string contents are not nodes here, so they cannot lie.
 *
 * WHAT IS COUNTED (non-test sources under app/src only — tests persist fixtures, not members):
 *   localStorage / sessionStorage — every `.getItem/.setItem/.removeItem` on a storage object.
 *   IndexedDB                      — every `createObjectStore(name)`, qualified by the database
 *                                    its file opens.
 *   server preferences             — every `setPref / setPrefMerged / deletePref` key the client
 *                                    writes (the `/api/auth/preferences` store, which is per
 *                                    ACCOUNT and therefore cross-device), UNIONED with the
 *                                    server's own allow-list `_PREFERENCE_KEYS`, which is read by
 *                                    PYTHON'S `ast` — some keys are written server-side only.
 *
 * KEY RESOLUTION. A key argument is resolved through literals, template literals and `+`
 * concatenation (an unresolvable part becomes `*`), module and block constants, imported
 * constants (followed across files), object-literal members, `Object.keys/values`, loop
 * variables over constant arrays, small key-builder functions (`posKey(id)` → `uct.pos.*`), and
 * WRAPPERS: when the key is a parameter of the enclosing function, every call of that function
 * is resolved instead. What still cannot be resolved is reported by file, line and function, and
 * must be made resolvable or declared — silence is never a pass.
 *
 * Usage:
 *   node tools/persistence_census.mjs              # summary
 *   node tools/persistence_census.mjs --json       # the raw census
 *   node tools/persistence_census.mjs --write      # regenerate the manifest (keeps labels/kinds)
 *   node tools/persistence_census.mjs --check      # exit 1 if the manifest is not current
 *   node tools/persistence_census.mjs --self-check # prove the census can fail
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// acorn lives in app/node_modules; anchor resolution to app/package.json exactly as
// tools/nav_manifest.mjs and tools/hub_surface_matrix.mjs do.
const appRequire = createRequire(pathToFileURL(path.join(REPO, 'app', 'package.json')))
const { Parser } = appRequire('acorn')
const jsx = appRequire('acorn-jsx')
const JsxParser = Parser.extend(jsx())

export const SRC_ROOT = 'app/src'
export const MANIFEST_PATH = 'app/src/lib/persistence/persistenceManifest.json'
export const AUTH_ROUTER = 'api/routers/auth.py'
export const FIX_LINE = 'node tools/persistence_census.mjs --write'

export const KINDS = ['setting', 'work', 'state', 'cache', 'internal']

/** The store a key lives in decides where it goes. This is the ONE place that says so. */
export const STORE_SCOPE = {
  'server-preference': 'cross-device',
  localStorage: 'device-local',
  sessionStorage: 'device-local',
  indexedDB: 'device-local',
}

const STORAGE_METHODS = new Set(['getItem', 'setItem', 'removeItem'])
const PREF_WRITERS = new Set(['setPref', 'setPrefMerged', 'deletePref'])
const ARRAY_ITERATORS = new Set(['forEach', 'map', 'filter', 'some', 'every', 'find', 'flatMap'])
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', '__fixtures__', '__snapshots__', 'dist'])
const MAX_DEPTH = 6

/** Test and test-infrastructure files persist FIXTURES, never a member's setting. A key planted
 *  by a test must not become a manifest obligation for every other lane. */
export function isTestFile(rel) {
  // app/src/testing/** is the dev-harness pages (`*-harness.html` entry points) — "never ships".
  if (rel.startsWith(`${SRC_ROOT}/testing/`)) return true
  const base = rel.split('/').pop()
  if (/\.(test|spec)\.[jt]sx?$/.test(base)) return true
  if (/^test-setup\.[jt]sx?$/.test(base) || /^setupTests\.[jt]sx?$/.test(base)) return true
  return rel.split('/').some((seg) => SKIP_DIRS.has(seg))
}

function listSources(absDir, relDir, out) {
  for (const ent of readdirSync(absDir, { withFileTypes: true })) {
    const rel = `${relDir}/${ent.name}`
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) listSources(path.join(absDir, ent.name), rel, out)
    } else if (/\.(jsx?|mjs)$/.test(ent.name) && !isTestFile(rel)) {
      out.push(rel)
    }
  }
  return out
}

export function repoSources(repo = REPO) {
  return listSources(path.join(repo, SRC_ROOT), SRC_ROOT, []).sort().map((rel) => ({
    path: rel,
    src: readFileSync(path.join(repo, rel), 'utf8'),
  }))
}

// ── Parse + module tables ──────────────────────────────────────────────────────────────────────

function parse(src) {
  return JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true })
}

const isFn = (n) => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')

function walk(node, parent, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node, parent)
  for (const k of Object.keys(node)) {
    if (k === 'loc') continue
    const v = node[k]
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, node, fn)
    } else if (v && typeof v.type === 'string') walk(v, node, fn)
  }
}

function resolveSpecifier(fromRel, spec, known) {
  if (!spec.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  for (const cand of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}/index.js`, `${base}/index.jsx`]) {
    if (known.has(cand)) return cand
  }
  return null
}

function buildModule(file, known) {
  const tree = parse(file.src)
  const parents = new Map()
  walk(tree, null, (n, p) => parents.set(n, p))
  const mod = { path: file.path, tree, parents, imports: new Map(), exports: new Map(), reexportAll: [] }
  for (const st of tree.body) {
    if (st.type === 'ImportDeclaration') {
      const from = resolveSpecifier(file.path, st.source.value, known)
      for (const sp of st.specifiers) {
        const imported = sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value)
          : sp.type === 'ImportDefaultSpecifier' ? 'default' : '*'
        mod.imports.set(sp.local.name, { from, imported })
      }
    } else if (st.type === 'ExportNamedDeclaration') {
      if (st.source) {
        const from = resolveSpecifier(file.path, st.source.value, known)
        for (const sp of st.specifiers) {
          mod.exports.set(sp.exported.name ?? sp.exported.value, { reexport: { from, imported: sp.local.name ?? sp.local.value } })
        }
      } else if (st.declaration) {
        const d = st.declaration
        if (d.type === 'VariableDeclaration') {
          for (const dc of d.declarations) if (dc.id.type === 'Identifier') mod.exports.set(dc.id.name, { local: dc.id.name })
        } else if (d.id) mod.exports.set(d.id.name, { local: d.id.name })
      } else {
        for (const sp of st.specifiers) mod.exports.set(sp.exported.name ?? sp.exported.value, { local: sp.local.name })
      }
    } else if (st.type === 'ExportDefaultDeclaration') {
      const d = st.declaration
      if (d.type === 'Identifier') mod.exports.set('default', { local: d.name })
      else mod.exports.set('default', { node: d })
    } else if (st.type === 'ExportAllDeclaration' && !st.exported) {
      const from = resolveSpecifier(file.path, st.source.value, known)
      if (from) mod.reexportAll.push(from)
    }
  }
  return mod
}

// ── Binding lookup ─────────────────────────────────────────────────────────────────────────────

/** Declarations directly inside a statement list (not nested blocks). */
function declIn(statements, name) {
  for (const st of statements || []) {
    const decl = st.type === 'ExportNamedDeclaration' ? st.declaration : st
    if (!decl) continue
    if (decl.type === 'VariableDeclaration') {
      for (const dc of decl.declarations) {
        if (dc.id.type === 'Identifier' && dc.id.name === name) return { kind: 'var', node: dc.init, decl: dc }
        if (dc.id.type === 'ObjectPattern' && dc.init) {
          for (const pr of dc.id.properties) {
            if (pr.type !== 'Property') continue
            const local = pr.value.type === 'AssignmentPattern' ? pr.value.left : pr.value
            if (local.type === 'Identifier' && local.name === name) {
              return { kind: 'destructured', from: dc.init, prop: pr.key.name ?? pr.key.value, decl: dc }
            }
          }
        }
      }
    } else if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id?.name === name) {
      return { kind: 'fn', node: decl }
    }
  }
  return null
}

function paramIndex(fnNode, name) {
  for (let i = 0; i < fnNode.params.length; i++) {
    let p = fnNode.params[i]
    if (p.type === 'AssignmentPattern') p = p.left
    if (p.type === 'Identifier' && p.name === name) return { index: i }
    if (p.type === 'ObjectPattern') {
      for (const pr of p.properties) {
        if (pr.type !== 'Property') continue
        const local = pr.value.type === 'AssignmentPattern' ? pr.value.left : pr.value
        if (local.type === 'Identifier' && local.name === name) return { index: i, prop: pr.key.name ?? pr.key.value, dflt: pr.value.type === 'AssignmentPattern' ? pr.value.right : null }
      }
    }
  }
  return null
}

/** Find what `name` means at `node` inside module `mod`. */
function lookup(mod, node, name) {
  let cur = node
  let prev = null
  while (cur) {
    if (isFn(cur) && prev !== null) {
      const pi = paramIndex(cur, name)
      if (pi) return { kind: 'param', fn: cur, mod, ...pi }
      if (cur.type === 'FunctionExpression' && cur.id?.name === name) return { kind: 'fn', node: cur, mod }
    }
    if (cur.type === 'BlockStatement' || cur.type === 'Program' || cur.type === 'StaticBlock') {
      const d = declIn(cur.body, name)
      if (d) return { ...d, mod }
    }
    if (cur.type === 'SwitchCase') {
      const d = declIn(cur.consequent, name)
      if (d) return { ...d, mod }
    }
    if ((cur.type === 'ForOfStatement' || cur.type === 'ForInStatement') && cur.left.type === 'VariableDeclaration') {
      const id = cur.left.declarations[0].id
      if (id.type === 'Identifier' && id.name === name) return { kind: cur.type === 'ForOfStatement' ? 'forOf' : 'forIn', over: cur.right, mod }
      // `for (const [k, v] of Object.entries(X))`
      if (id.type === 'ArrayPattern' && cur.type === 'ForOfStatement') {
        const i = id.elements.findIndex((e) => e?.type === 'Identifier' && e.name === name)
        if (i >= 0) return { kind: 'forOfEntry', index: i, over: cur.right, mod }
      }
    }
    if (cur.type === 'ForStatement' && cur.init?.type === 'VariableDeclaration') {
      const d = declIn([cur.init], name)
      if (d) return { ...d, mod }
    }
    if (cur.type === 'CatchClause' && cur.param?.type === 'Identifier' && cur.param.name === name) return { kind: 'unknown', mod }
    prev = cur
    cur = mod.parents.get(cur)
  }
  if (mod.imports.has(name)) return { kind: 'import', ...mod.imports.get(name), mod }
  return { kind: 'global', name, mod }
}

// ── Values ─────────────────────────────────────────────────────────────────────────────────────
// A resolved value is { s: string, exact: bool } — `*` marks a part that could not be resolved.
// A key that is ONLY `*` is unresolved.

const STAR = { s: '*', exact: false }
const combine = (lists) => lists.reduce(
  (acc, list) => acc.flatMap((a) => list.map((b) => ({ s: a.s + b.s, exact: a.exact && b.exact }))),
  [{ s: '', exact: true }],
)
const collapseStars = (v) => ({ ...v, s: v.s.replace(/\*+/g, '*') })
/** Inside a concatenation an absent part is still SOME text, so it becomes `*`, never nothing. */
const nonEmpty = (list) => (list.length ? list : [STAR])

class Resolver {
  constructor(modules) {
    this.modules = modules
    this.callIndex = null
  }

  exportedBinding(fromPath, name, depth = 0) {
    if (!fromPath || depth > MAX_DEPTH) return null
    const mod = this.modules.get(fromPath)
    if (!mod) return null
    const ex = mod.exports.get(name)
    if (ex?.reexport) return this.exportedBinding(ex.reexport.from, ex.reexport.imported, depth + 1)
    if (ex?.local) return lookup(mod, mod.tree, ex.local)
    if (ex?.node) return { kind: 'var', node: ex.node, mod }
    for (const star of mod.reexportAll) {
      const b = this.exportedBinding(star, name, depth + 1)
      if (b) return b
    }
    return null
  }

  /** Follow a binding to the expression it holds (through imports), or return it as-is. */
  deref(b, depth = 0) {
    if (!b || depth > MAX_DEPTH) return b
    if (b.kind === 'import') {
      if (b.imported === '*') return { kind: 'namespace', path: b.from }
      const t = this.exportedBinding(b.from, b.imported, depth + 1)
      return t ? this.deref(t, depth + 1) : { kind: 'unknown' }
    }
    return b
  }

  /** Every object literal an expression may denote — both arms of a conditional, the value a
   *  `useMemo(() => …)` holds, what a local function returns — or null if any arm is opaque. */
  objectsOf(node, mod, depth = 0) {
    if (!node || depth > MAX_DEPTH) return null
    if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
      const a = this.objectsOf(node.consequent ?? node.left, mod, depth + 1)
      const b = this.objectsOf(node.alternate ?? node.right, mod, depth + 1)
      return a && b ? [...a, ...b] : null
    }
    if (node.type === 'Identifier') {
      const b = this.deref(lookup(mod, node, node.name))
      if (b?.kind === 'var' && b.node) return this.objectsOf(b.node, b.mod, depth + 1)
      return null
    }
    if (node.type === 'CallExpression') {
      const c = node.callee
      let fnNode = null
      let fnMod = mod
      if (c.type === 'Identifier' && c.name === 'useMemo' && isFn(node.arguments[0])) fnNode = node.arguments[0]
      else if (!(c.type === 'MemberExpression' && c.object.name === 'Object')) {
        const t = this.calleeFn(c, mod, depth + 1)
        if (t) { fnNode = t.fn; fnMod = t.mod }
      }
      if (fnNode) {
        const returns = fnNode.body.type === 'BlockStatement' ? this.returnsOf(fnNode, fnMod) : [fnNode.body]
        if (!returns.length) return null
        const all = []
        for (const r of returns) {
          const o = this.objectsOf(r, fnMod, depth + 1)
          if (!o) return null
          all.push(...o)
        }
        return all
      }
    }
    const one = this.objectOf(node, mod, depth + 1)
    return one ? [one] : null
  }

  returnsOf(fnNode, mod) {
    const out = []
    walk(fnNode.body, null, (n) => {
      if (n.type === 'ReturnStatement' && n.argument) {
        let p = mod.parents.get(n)
        while (p && !isFn(p)) p = mod.parents.get(p)
        if (p === fnNode) out.push(n.argument)
      }
    })
    return out
  }

  /** Resolve an expression to the object literal it denotes, if any. */
  objectOf(node, mod, depth = 0) {
    if (!node || depth > MAX_DEPTH) return null
    if (node.type === 'ObjectExpression') return { node, mod }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && node.callee.object.name === 'Object' && node.callee.property.name === 'freeze') {
      return this.objectOf(node.arguments[0], mod, depth + 1)
    }
    if (node.type === 'Identifier') {
      const b = this.deref(lookup(mod, node, node.name))
      if (b?.kind === 'var' && b.node) return this.objectOf(b.node, b.mod, depth + 1)
    }
    if (node.type === 'MemberExpression') {
      const prop = this.propValueNode(node, mod, depth + 1)
      if (prop) return this.objectOf(prop.node, prop.mod, depth + 1)
    }
    return null
  }

  propName(member, mod, depth) {
    if (!member.computed) return member.property.name
    const vals = this.values(member.property, mod, depth + 1, new Map())
    return vals.length === 1 && vals[0].exact ? vals[0].s : null
  }

  /** `X.prop` where X is an object literal (or a namespace import) → the property's value node. */
  propValueNode(member, mod, depth = 0) {
    if (depth > MAX_DEPTH) return null
    const name = this.propName(member, mod, depth)
    if (name == null) return null
    if (member.object.type === 'Identifier') {
      const b = this.deref(lookup(mod, member.object, member.object.name))
      if (b?.kind === 'namespace') {
        const t = this.deref(this.exportedBinding(b.path, name))
        if (t?.kind === 'var' && t.node) return { node: t.node, mod: t.mod }
        return null
      }
    }
    const obj = this.objectOf(member.object, mod, depth + 1)
    if (!obj) return null
    for (const p of obj.node.properties) {
      if (p.type !== 'Property') continue
      const k = p.computed ? null : (p.key.name ?? p.key.value)
      if (k === name) return { node: p.value, mod: obj.mod }
    }
    return null
  }

  /** Elements an iterable expression yields (arrays, Object.keys/values of a literal). */
  elements(node, mod, depth, env) {
    if (!node || depth > MAX_DEPTH) return null
    if (node.type === 'ArrayExpression') {
      return node.elements.flatMap((e) => (e && e.type !== 'SpreadElement' ? this.values(e, mod, depth + 1, env)
        : e?.type === 'SpreadElement' ? (this.elements(e.argument, mod, depth + 1, env) || [STAR]) : []))
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        && node.callee.object.name === 'Object' && ['keys', 'values'].includes(node.callee.property.name)) {
      const obj = this.objectOf(node.arguments[0], mod, depth + 1)
      if (!obj) return null
      return obj.node.properties.flatMap((p) => {
        if (p.type !== 'Property') return [STAR]
        if (node.callee.property.name === 'keys') return p.computed ? [STAR] : [{ s: String(p.key.name ?? p.key.value), exact: true }]
        return this.values(p.value, obj.mod, depth + 1, env)
      })
    }
    if (node.type === 'Identifier') {
      const b = this.deref(lookup(mod, node, node.name))
      if (b?.kind === 'var' && b.node) return this.elements(b.node, b.mod, depth + 1, env)
    }
    if (node.type === 'MemberExpression') {
      const pv = this.propValueNode(node, mod, depth + 1)
      if (pv) return this.elements(pv.node, pv.mod, depth + 1, env)
    }
    return null
  }

  /** Every string value `node` can take. `env` maps a function node → the call whose arguments
   *  stand in for its parameters (key-builder functions). A parameter with no stand-in comes
   *  back as { param } so the caller can resolve it through the function's call sites. */
  values(node, mod, depth = 0, env = new Map()) {
    if (!node || depth > MAX_DEPTH) return [STAR]
    switch (node.type) {
      case 'Literal':
        // `null` is "no key here" (a prop's `= null` default, an unset ref) — it adds nothing.
        if (node.value === null && !node.regex) return []
        return [{ s: String(node.value), exact: true }]
      case 'TemplateLiteral': {
        const parts = []
        node.quasis.forEach((q, i) => {
          parts.push([{ s: q.value.cooked ?? q.value.raw, exact: true }])
          if (i < node.expressions.length) parts.push(nonEmpty(this.values(node.expressions[i], mod, depth + 1, env).map((v) => (v.param ? STAR : v))))
        })
        return combine(parts).map(collapseStars)
      }
      case 'BinaryExpression':
        if (node.operator !== '+') return [STAR]
        return combine([
          nonEmpty(this.values(node.left, mod, depth + 1, env).map((v) => (v.param ? STAR : v))),
          nonEmpty(this.values(node.right, mod, depth + 1, env).map((v) => (v.param ? STAR : v))),
        ]).map(collapseStars)
      case 'ConditionalExpression':
        return [...this.values(node.consequent, mod, depth + 1, env), ...this.values(node.alternate, mod, depth + 1, env)]
      case 'LogicalExpression':
        return [...this.values(node.left, mod, depth + 1, env), ...this.values(node.right, mod, depth + 1, env)]
      case 'ChainExpression':
        return this.values(node.expression, mod, depth + 1, env)
      case 'MemberExpression':
        return this.memberValues(node, mod, depth, env)
      case 'CallExpression':
        return this.callValues(node, mod, depth, env)
      case 'Identifier':
        return this.identValues(node, mod, depth, env)
      default:
        return [STAR]
    }
  }

  memberValues(node, mod, depth, env) {
    const obj = node.object
    // `ref.current` where `const ref = useRef(x)` — the value the ref was seeded with.
    if (!node.computed && node.property.name === 'current' && obj.type === 'Identifier') {
      const b = this.deref(lookup(mod, obj, obj.name))
      if (b?.kind === 'var' && b.node?.type === 'CallExpression' && b.node.callee.type === 'Identifier'
          && b.node.callee.name === 'useRef') return this.values(b.node.arguments[0], b.mod, depth + 1, env)
    }
    const pv = this.propValueNode(node, mod, depth + 1)
    if (pv) return this.values(pv.node, pv.mod, depth + 1, env)
    // `cfg.versionKey` / `props.storageKey` where the object is a parameter: the member of
    // whatever each caller passes.
    if (obj.type === 'Identifier') {
      const name = this.propName(node, mod, depth)
      const b = lookup(mod, obj, obj.name)
      if (name != null && b?.kind === 'param' && !b.prop) {
        const call = env.get(b.fn)
        if (call && !call.jsx) {
          const o = this.objectOf(call.node.arguments[b.index], call.mod, depth + 1)
          const p = o?.node.properties.find((q) => q.type === 'Property' && !q.computed && (q.key.name ?? q.key.value) === name)
          return p ? this.values(p.value, o.mod, depth + 1, env) : [STAR]
        }
        if (!call) return [{ s: '*', exact: false, param: { ...b, prop: name } }]
      }
    }
    return [STAR]
  }

  identValues(node, mod, depth, env) {
    if (node.name === 'undefined') return []
    const b = this.deref(lookup(mod, node, node.name))
    if (!b) return [STAR]
    if (b.kind === 'var') return b.node ? this.values(b.node, b.mod, depth + 1, env) : [STAR]
    if (b.kind === 'destructured') {
      const obj = this.objectOf(b.from, b.mod, depth + 1)
      if (!obj) return [STAR]
      const p = obj.node.properties.find((q) => q.type === 'Property' && !q.computed && (q.key.name ?? q.key.value) === b.prop)
      return p ? this.values(p.value, obj.mod, depth + 1, env) : [STAR]
    }
    if (b.kind === 'forOf') return this.elements(b.over, b.mod, depth + 1, env) || [STAR]
    if (b.kind === 'forOfEntry') {
      const o = b.over
      if (b.index > 1 || o.type !== 'CallExpression' || o.callee.type !== 'MemberExpression'
          || o.callee.object.name !== 'Object' || o.callee.property.name !== 'entries') return [STAR]
      const obj = this.objectOf(o.arguments[0], b.mod, depth + 1)
      if (!obj) return [STAR]
      return obj.node.properties.flatMap((p) => {
        if (p.type !== 'Property') return [STAR]
        if (b.index === 0) return p.computed ? [STAR] : [{ s: String(p.key.name ?? p.key.value), exact: true }]
        return this.values(p.value, obj.mod, depth + 1, env)
      })
    }
    if (b.kind === 'forIn') {
      const obj = this.objectOf(b.over, b.mod, depth + 1)
      return obj ? obj.node.properties.map((p) => (p.type === 'Property' && !p.computed ? { s: String(p.key.name ?? p.key.value), exact: true } : STAR)) : [STAR]
    }
    if (b.kind === 'param') {
      const call = env.get(b.fn)
      if (call) {
        const arg = call.node.arguments[b.index]
        if (!arg) return b.prop ? [STAR] : (b.fn.params[b.index]?.type === 'AssignmentPattern' ? this.values(b.fn.params[b.index].right, b.mod, depth + 1, env) : [STAR])
        if (b.prop) {
          const obj = this.objectOf(arg, call.mod, depth + 1)
          const p = obj?.node.properties.find((q) => q.type === 'Property' && !q.computed && (q.key.name ?? q.key.value) === b.prop)
          if (p) return this.values(p.value, obj.mod, depth + 1, env)
          return b.dflt ? this.values(b.dflt, b.mod, depth + 1, env) : [STAR]
        }
        return this.values(arg, call.mod, depth + 1, env)
      }
      // A callback of `ARRAY.forEach(k => …)` — the parameter ranges over the array.
      const parent = b.mod.parents.get(b.fn)
      if (b.index === 0 && !b.prop && parent?.type === 'CallExpression' && parent.arguments[0] === b.fn
          && parent.callee.type === 'MemberExpression' && ARRAY_ITERATORS.has(parent.callee.property.name)) {
        const els = this.elements(parent.callee.object, b.mod, depth + 1, env)
        if (els) return els
      }
      return [{ s: '*', exact: false, param: b }]
    }
    return [STAR]
  }

  /** The function a callee denotes, if it is one we can see. */
  calleeFn(callee, mod, depth = 0) {
    if (depth > MAX_DEPTH) return null
    if (callee.type === 'Identifier' || callee.type === 'JSXIdentifier') {
      const b = this.deref(lookup(mod, callee, callee.name))
      if (!b) return null
      if (b.kind === 'fn') return { fn: b.node, mod: b.mod }
      if (b.kind === 'var' && b.node) return this.fnOf(b.node, b.mod, depth + 1)
      return null
    }
    if (callee.type === 'MemberExpression') {
      const pv = this.propValueNode(callee, mod, depth + 1)
      if (pv) return this.fnOf(pv.node, pv.mod, depth + 1)
    }
    return null
  }

  fnOf(node, mod, depth) {
    if (!node) return null
    if (isFn(node)) return { fn: node, mod }
    // `useCallback(fn, deps)` / `useMemo(() => fn)` hold a function too.
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'useCallback' && isFn(node.arguments[0])) {
      return { fn: node.arguments[0], mod }
    }
    // `memo(Component)` / `forwardRef(fn)` / `React.memo(…)` hold the component.
    if (node.type === 'CallExpression' && node.arguments[0]) {
      const c = node.callee
      const n = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : ''
      if (n === 'memo' || n === 'forwardRef') return this.fnOf(node.arguments[0], mod, depth + 1)
    }
    if (node.type === 'Identifier') return this.calleeFn(node, mod, depth + 1)
    return null
  }

  callValues(node, mod, depth, env) {
    const callee = node.callee
    if (callee.type === 'MemberExpression' && !callee.computed) {
      const m = callee.property.name
      if (['toLowerCase', 'toUpperCase', 'trim'].includes(m)) return this.values(callee.object, mod, depth + 1, env)
      if (m === 'join' || m === 'concat') return [STAR]
    }
    if (callee.type === 'Identifier' && callee.name === 'String') return this.values(node.arguments[0], mod, depth + 1, env)
    const target = this.calleeFn(callee, mod, depth + 1)
    if (!target) return [STAR]
    const returns = []
    const fnNode = target.fn
    if (fnNode.body.type !== 'BlockStatement') returns.push(fnNode.body)
    else {
      walk(fnNode.body, null, (n) => {
        if (n.type === 'ReturnStatement' && n.argument) {
          // only returns belonging to THIS function, not to a nested one
          let p = target.mod.parents.get(n)
          while (p && !isFn(p)) p = target.mod.parents.get(p)
          if (p === fnNode) returns.push(n.argument)
        }
      })
    }
    if (!returns.length) return [STAR]
    const inner = new Map(env)
    inner.set(fnNode, { node, mod })
    return returns.flatMap((r) => this.values(r, target.mod, depth + 1, inner).map((v) => (v.param ? STAR : v)))
  }

  // ── Wrapper resolution ──

  indexCalls() {
    if (this.callIndex) return this.callIndex
    this.callIndex = new Map()
    for (const mod of this.modules.values()) {
      walk(mod.tree, null, (n) => {
        // `<Component prop={…}>` is a call of Component whose first argument is the props.
        if (n.type === 'JSXOpeningElement' && n.name.type === 'JSXIdentifier' && /^[A-Z]/.test(n.name.name)) {
          const t = this.calleeFn(n.name, mod)
          if (!t) return
          if (!this.callIndex.has(t.fn)) this.callIndex.set(t.fn, [])
          this.callIndex.get(t.fn).push({ node: n, mod, jsx: true })
          return
        }
        if (n.type !== 'CallExpression') return
        const t = this.calleeFn(n.callee, mod)
        if (!t) return
        if (!this.callIndex.has(t.fn)) this.callIndex.set(t.fn, [])
        this.callIndex.get(t.fn).push({ node: n, mod })
      })
    }
    return this.callIndex
  }

  /** Resolve a key expression at a site; parameters are chased through the function's callers. */
  resolveKey(node, mod, depth = 0, seen = new Set()) {
    const out = []
    const unresolved = []
    for (const v of this.values(node, mod, 0)) {
      if (!v.param) { out.push(v); continue }
      const { fn, index, prop } = v.param
      const calls = depth < 4 && !seen.has(fn) ? (this.indexCalls().get(fn) || []) : []
      if (!calls.length) { unresolved.push(v.param); continue }
      const nextSeen = new Set(seen).add(fn)
      for (const c of calls) {
        if (c.jsx) {
          if (index !== 0 || !prop) { unresolved.push({ fn, index, via: c }); continue }
          const attr = c.node.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === prop)
          if (!attr) {
            // An absent prop is `undefined` — it contributes no key — unless a spread may carry
            // it. A spread of an object literal is read like any other object.
            let carried = null
            let opaque = false
            for (const a of c.node.attributes) {
              if (a.type !== 'JSXSpreadAttribute') continue
              const objs = this.objectsOf(a.argument, c.mod)
              if (!objs) { opaque = true; continue }
              for (const obj of objs) {
                if (obj.node.properties.some((q) => q.type !== 'Property')) { opaque = true; continue }
                const p = obj.node.properties.find((q) => !q.computed && (q.key.name ?? q.key.value) === prop)
                if (p) (carried ||= []).push({ node: p.value, mod: obj.mod })
              }
            }
            if (carried) {
              for (const cv of carried) {
                const r = this.resolveKey(cv.node, cv.mod, depth + 1, nextSeen)
                out.push(...r.values)
                unresolved.push(...r.unresolved)
              }
            }
            if (opaque) unresolved.push({ fn, index, prop, via: c })
            else if (!carried && v.param.dflt) out.push(...this.values(v.param.dflt, v.param.mod, 0).filter((x) => !x.param))
            continue
          }
          if (!attr.value) continue
          const expr = attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value
          const r = this.resolveKey(expr, c.mod, depth + 1, nextSeen)
          out.push(...r.values)
          unresolved.push(...r.unresolved)
          continue
        }
        let arg = c.node.arguments[index]
        if (arg && prop) {
          const obj = this.objectOf(arg, c.mod)
          const p = obj?.node.properties.find((q) => q.type === 'Property' && !q.computed && (q.key.name ?? q.key.value) === prop)
          arg = p ? p.value : null
          if (!p) { unresolved.push({ fn, index, prop, via: c }); continue }
          const r = this.resolveKey(arg, obj.mod, depth + 1, nextSeen)
          out.push(...r.values)
          unresolved.push(...r.unresolved)
          continue
        }
        if (!arg) { unresolved.push({ fn, index, via: c }); continue }
        const r = this.resolveKey(arg, c.mod, depth + 1, nextSeen)
        out.push(...r.values)
        unresolved.push(...r.unresolved)
      }
    }
    return { values: out, unresolved }
  }
}

// ── Site detection ─────────────────────────────────────────────────────────────────────────────

/** Which web storage an object expression denotes: 'localStorage' | 'sessionStorage' | null. */
function storageOf(resolver, node, mod, depth = 0) {
  if (!node || depth > MAX_DEPTH) return null
  if (node.type === 'ChainExpression') return storageOf(resolver, node.expression, mod, depth + 1)
  if (node.type === 'Identifier') {
    if (node.name === 'localStorage' || node.name === 'sessionStorage') {
      const b = lookup(mod, node, node.name)
      if (b.kind === 'global') return node.name
    }
    const b = resolver.deref(lookup(mod, node, node.name))
    if (b?.kind === 'var' && b.node) return storageOf(resolver, b.node, b.mod, depth + 1)
    if (b?.kind === 'param') {
      const p = b.fn.params[b.index]
      if (b.prop) return b.dflt ? storageOf(resolver, b.dflt, b.mod, depth + 1) : null
      if (p?.type === 'AssignmentPattern') {
        const s = storageOf(resolver, p.right, b.mod, depth + 1)
        if (s) return s
      }
      // A storage handed in by the callers (`read(storage, key)`).
      for (const c of resolver.indexCalls().get(b.fn) || []) {
        if (c.jsx) continue
        const s = storageOf(resolver, c.node.arguments[b.index], c.mod, depth + 1)
        if (s) return s
      }
    }
    return null
  }
  if (node.type === 'MemberExpression' && !node.computed) {
    const n = node.property.name
    if (n === 'localStorage' || n === 'sessionStorage') return n
    return null
  }
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
    const a = storageOf(resolver, node.consequent ?? node.left, mod, depth + 1)
    const b = storageOf(resolver, node.alternate ?? node.right, mod, depth + 1)
    return a || b
  }
  if (node.type === 'CallExpression') {
    const t = resolver.calleeFn(node.callee, mod, depth + 1)
    if (!t) return null
    let found = null
    const body = t.fn.body
    if (body.type !== 'BlockStatement') return storageOf(resolver, body, t.mod, depth + 1)
    walk(body, null, (n) => {
      if (!found && n.type === 'ReturnStatement' && n.argument) found = storageOf(resolver, n.argument, t.mod, depth + 1)
    })
    return found
  }
  return null
}

function enclosingFnName(mod, node) {
  let cur = mod.parents.get(node)
  while (cur) {
    if (isFn(cur)) {
      if (cur.id?.name) return cur.id.name
      const p = mod.parents.get(cur)
      if (p?.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name
      if (p?.type === 'Property' && !p.computed) return p.key.name ?? p.key.value
      if (p?.type === 'MethodDefinition') return p.key.name
      if (p?.type === 'CallExpression') {
        const gp = mod.parents.get(p)
        if (gp?.type === 'VariableDeclarator' && gp.id.type === 'Identifier') return gp.id.name
      }
    }
    cur = mod.parents.get(cur)
  }
  return '(module)'
}

function isPrefWriterCallee(mod, callee) {
  if (callee.type === 'MemberExpression' && !callee.computed) return PREF_WRITERS.has(callee.property.name)
  if (callee.type !== 'Identifier') return false
  if (PREF_WRITERS.has(callee.name)) return true
  // `const { setPref: setPrefRaw } = usePreferences()` — an alias of a writer.
  const b = lookup(mod, callee, callee.name)
  return b?.kind === 'destructured' && PREF_WRITERS.has(b.prop)
    && b.from?.type === 'CallExpression' && b.from.callee.name === 'usePreferences'
}

/**
 * The census over a list of `{path, src}` sources. Returns every resolved (key, store) with the
 * files and lines that touch it, every site whose key could not be resolved, and every file that
 * could not be parsed (a file we cannot read cannot be trusted to hold no key).
 */
export function census(files) {
  const known = new Set(files.map((f) => f.path))
  const modules = new Map()
  const parseErrors = []
  for (const f of files) {
    try { modules.set(f.path, buildModule(f, known)) } catch (e) { parseErrors.push({ file: f.path, message: e.message }) }
  }
  const resolver = new Resolver(modules)
  const keys = new Map()
  const unresolved = []
  const unclassified = []
  const sites = []

  const add = (store, v, mod, node) => {
    const key = v.s
    const id = `${store}\u0000${key}`
    if (!keys.has(id)) keys.set(id, { key, store, pattern: !v.exact, sites: [] })
    keys.get(id).sites.push({ file: mod.path, line: node.loc.start.line })
  }
  const record = (store, keyNode, mod, node, prefix = '') => {
    const r = resolver.resolveKey(keyNode, mod)
    const fn = enclosingFnName(mod, node)
    sites.push({ store, file: mod.path, line: node.loc.start.line, fn })
    for (const v of r.values) {
      const full = prefix ? { s: prefix + v.s, exact: v.exact } : v
      if (full.s.replace(/\*/g, '').replace(/[/.:_-]/g, '') === '' || full.s === prefix + '*') {
        unresolved.push({ store, file: mod.path, line: node.loc.start.line, fn, why: `key resolves to '${full.s}'` })
      } else add(store, full, mod, node)
    }
    for (const u of r.unresolved) {
      const via = u.via ? ` (via ${u.via.mod.path}:${u.via.node.loc.start.line})` : ''
      unresolved.push({ store, file: mod.path, line: node.loc.start.line, fn, why: `key is a parameter nobody resolvably passes${via}` })
    }
  }

  for (const mod of modules.values()) {
    const idbStores = []
    const idbNames = []
    walk(mod.tree, null, (n) => {
      if (n.type !== 'CallExpression') return
      const c = n.callee.type === 'ChainExpression' ? n.callee.expression : n.callee
      if (c.type === 'MemberExpression' && !c.computed) {
        const m = c.property.name
        if (STORAGE_METHODS.has(m) && n.arguments[0]) {
          const store = storageOf(resolver, c.object, mod)
          if (store) record(store, n.arguments[0], mod, n)
          else unclassified.push({ file: mod.path, line: n.loc.start.line, fn: enclosingFnName(mod, n), call: m })
          return
        }
        if (m === 'createObjectStore' && n.arguments[0]) { idbStores.push(n); return }
        if (m === 'open' && n.arguments[0]) {
          const o = c.object
          const oname = o.type === 'Identifier' ? o.name : o.type === 'MemberExpression' && !o.computed ? o.property.name : ''
          if (/indexeddb|idbfactory/i.test(oname)) idbNames.push(n)
          return
        }
      }
      if (isPrefWriterCallee(mod, c) && n.arguments[0]) record('server-preference', n.arguments[0], mod, n)
    })
    if (idbStores.length) {
      const dbs = idbNames.flatMap((n) => resolver.values(n.arguments[0], mod).map((v) => (v.param ? STAR : v)))
      const dbName = dbs.length === 1 ? collapseStars(dbs[0]).s : dbs.length ? dbs.map((d) => d.s).sort().join('|') : '(unnamed db)'
      for (const n of idbStores) record('indexedDB', n.arguments[0], mod, n, `${dbName}/`)
    }
  }

  const entries = [...keys.values()].map((e) => ({
    ...e,
    files: [...new Set(e.sites.map((s) => s.file))].sort(),
  })).sort((a, b) => (a.store + a.key).localeCompare(b.store + b.key))
  const seenU = new Set()
  const uniqueUnresolved = unresolved.filter((u) => {
    const id = `${u.file}:${u.line}:${u.why}`
    return seenU.has(id) ? false : (seenU.add(id), true)
  })
  return { files: files.length, parseErrors, entries, unresolved: uniqueUnresolved, unclassified, sites }
}

// ── The server's own allow-list, read by PYTHON's ast ──────────────────────────────────────────

/** `_PREFERENCE_KEYS` from `api/routers/auth.py`, parsed with Python's `ast` — never a regex.
 *  Some preference keys are written server-side only (`shared_tag_colors`), so a client-only
 *  census would miss them; they are per-account all the same. */
export function serverPreferenceKeys(repo = REPO) {
  const script = [
    'import ast, json, sys',
    'tree = ast.parse(open(sys.argv[1], encoding="utf-8").read())',
    'keys = None',
    'for node in ast.walk(tree):',
    '    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_PREFERENCE_KEYS" for t in node.targets):',
    '        keys = [k.value for k in node.value.keys]',
    'print(json.dumps(sorted(keys) if keys is not None else None))',
  ].join('\n')
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const out = execFileSync(py, ['-c', script, path.join(repo, AUTH_ROUTER)], { encoding: 'utf8' })
  const keys = JSON.parse(out)
  if (!Array.isArray(keys) || keys.length === 0) throw new Error(`could not read _PREFERENCE_KEYS from ${AUTH_ROUTER}`)
  return keys
}

// ── The manifest ───────────────────────────────────────────────────────────────────────────────

const entryId = (e) => `${e.store}\u0000${e.key}`

/** Merge a fresh census with the previous manifest: DERIVED fields are recomputed, DECLARED fields
 *  (surface, kind, label) are carried over for keys that still exist. A new key gets them as
 *  `null`, which the rail refuses until someone names it. */
export function buildManifest(result, serverKeys, prior) {
  const priorById = new Map((prior?.entries || []).map((e) => [entryId(e), e]))
  const byId = new Map()
  for (const e of result.entries) byId.set(entryId(e), { key: e.key, store: e.store, files: e.files, pattern: e.pattern })
  for (const k of serverKeys) {
    const id = `server-preference\u0000${k}`
    if (!byId.has(id)) byId.set(id, { key: k, store: 'server-preference', files: [], pattern: false })
  }
  const entries = [...byId.values()].map((e) => {
    const p = priorById.get(entryId(e))
    return {
      key: e.key,
      store: e.store,
      scope: STORE_SCOPE[e.store],
      surface: p?.surface ?? null,
      kind: p?.kind ?? null,
      label: p?.label ?? null,
      ...(e.pattern ? { pattern: true } : {}),
      ...(e.store === 'server-preference' ? { serverAllowlisted: serverKeys.includes(e.key) } : {}),
      files: e.files,
    }
  }).sort((a, b) => (a.scope + a.store + a.key).localeCompare(b.scope + b.store + b.key))
  return {
    '//': [
      'GENERATED by `node tools/persistence_census.mjs --write` (TERM-076 / FB-A12-02).',
      'key, store, scope, files and serverAllowlisted are DERIVED from app/src by AST and from',
      '_PREFERENCE_KEYS by Python ast. Only `surface`, `kind` and `label` are yours to edit.',
      'The Settings card "What syncs across your devices" renders FROM this file.',
    ],
    kinds: KINDS,
    notWebStorage: prior?.notWebStorage ?? [],
    entries,
  }
}

export function serializeManifest(m) {
  return `${JSON.stringify(m, null, 2)}\n`
}

export function readManifest(repo = REPO) {
  const p = path.join(repo, MANIFEST_PATH)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

/**
 * Compare a census with a manifest. Returns human-readable problems, each naming the key and the
 * one-line fix. `checkServer` is false inside vitest (no Python there); server-only rows are then
 * trusted to the pytest rail that parses `_PREFERENCE_KEYS` itself.
 */
export function diffManifest(result, manifest, { serverKeys = null } = {}) {
  const problems = { undeclared: [], stale: [], drifted: [], unnamed: [], unresolved: [], unclassified: [], parseErrors: [] }
  const declared = new Map((manifest?.entries || []).map((e) => [entryId(e), e]))
  const derived = new Map(result.entries.map((e) => [entryId(e), e]))
  for (const [id, e] of derived) {
    const d = declared.get(id)
    if (!d) {
      const s = e.sites[0]
      problems.undeclared.push(`undeclared persisted key '${e.key}' (${e.store}) at ${s.file}:${s.line} — declare it: ${FIX_LINE}, then give it a surface, label and kind in ${MANIFEST_PATH}`)
      continue
    }
    if (JSON.stringify(d.files) !== JSON.stringify(e.files) || d.scope !== STORE_SCOPE[e.store]) {
      problems.drifted.push(`'${e.key}' (${e.store}) moved: manifest says ${JSON.stringify(d.files)}, code says ${JSON.stringify(e.files)} — ${FIX_LINE}`)
    }
  }
  for (const [id, d] of declared) {
    if (derived.has(id)) continue
    const serverOnly = d.store === 'server-preference' && d.files.length === 0
    if (serverOnly && !serverKeys) continue
    if (serverOnly && serverKeys.includes(d.key)) continue
    problems.stale.push(`stale manifest entry '${d.key}' (${d.store}) — nothing in app/src persists it any more: ${FIX_LINE}`)
  }
  if (serverKeys) {
    for (const k of serverKeys) {
      if (!declared.has(`server-preference\u0000${k}`)) problems.undeclared.push(`undeclared server preference '${k}' (${AUTH_ROUTER} _PREFERENCE_KEYS) — ${FIX_LINE}`)
    }
  }
  for (const d of declared.values()) {
    if (!d.label || !d.surface || !KINDS.includes(d.kind)) {
      problems.unnamed.push(`'${d.key}' (${d.store}) is not named for members — set "surface", "label" and "kind" (one of ${KINDS.join('|')}) in ${MANIFEST_PATH}`)
    }
    if (STORE_SCOPE[d.store] !== d.scope) problems.drifted.push(`'${d.key}' scope '${d.scope}' is not what store '${d.store}' implies — ${FIX_LINE}`)
  }
  for (const u of result.unresolved) {
    problems.unresolved.push(`unresolvable ${u.store} key at ${u.file}:${u.line} in ${u.fn}() — ${u.why}; name the key with a module-level constant so the census can read it`)
  }
  const notWeb = new Set(manifest?.notWebStorage || [])
  for (const u of result.unclassified || []) {
    if (notWeb.has(`${u.file}#${u.fn}`)) continue
    problems.unclassified.push(`.${u.call}() at ${u.file}:${u.line} in ${u.fn}() is on an object the census cannot identify as localStorage/sessionStorage — pass the storage explicitly (or default a parameter to it); if it is NOT web storage, add "${u.file}#${u.fn}" to notWebStorage in ${MANIFEST_PATH}`)
  }
  for (const p of result.parseErrors) problems.parseErrors.push(`could not parse ${p.file}: ${p.message}`)
  return problems
}

export const problemCount = (p) => Object.values(p).reduce((n, l) => n + l.length, 0)

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────

function summary(result, manifest) {
  const by = {}
  for (const e of manifest?.entries || result.entries.map((x) => ({ ...x, scope: STORE_SCOPE[x.store] }))) {
    const k = `${e.scope} / ${e.store}`
    by[k] = (by[k] || 0) + 1
  }
  return by
}

function selfCheck() {
  const fixture = [
    { path: 'app/src/a.js', src: [
      "export const K = 'uct.probe.alpha'",
      "localStorage.setItem(K, '1')",
      "// localStorage.setItem('uct.probe.comment', '1')",
      "const s = \"localStorage.setItem('uct.probe.string', '1')\"",
      'export function posKey(id) { return `uct.probe.pos.${id}` }',
      "export function readPos(id) { return window.sessionStorage.getItem(posKey(id)) }",
      "function lsGet(k) { try { return localStorage.getItem(k) } catch { return null } }",
      "lsGet('uct.probe.wrapped')",
    ].join('\n') },
    { path: 'app/src/b.jsx', src: "import { K } from './a'\nexport default function B({ setPref }) { setPref('probe_pref', 1); return window.localStorage.getItem(K) }" },
    { path: 'app/src/b.test.jsx', src: "localStorage.setItem('uct.probe.test', '1')" },
  ]
  const r = census(fixture.filter((f) => !isTestFile(f.path)))
  const got = r.entries.map((e) => `${e.store}:${e.key}`).sort()
  const want = ['localStorage:uct.probe.alpha', 'localStorage:uct.probe.wrapped', 'server-preference:probe_pref', 'sessionStorage:uct.probe.pos.*'].sort()
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(ok ? 'self-check: OK' : `self-check: FAIL\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
  // …and the check must be able to fail: a manifest missing a key reports it BY NAME.
  const p = diffManifest(r, { entries: [] })
  const named = p.undeclared.some((l) => l.includes("'uct.probe.alpha'"))
  console.log(named ? 'self-check: undeclared key is reported by name — OK' : 'self-check: FAIL — an undeclared key went unreported')
  return ok && named
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = new Set(process.argv.slice(2))
  if (args.has('--self-check')) process.exit(selfCheck() ? 0 : 1)
  const result = census(repoSources())
  if (args.has('--json')) {
    console.log(JSON.stringify({ ...result, sites: undefined }, null, 2))
    process.exit(0)
  }
  const serverKeys = serverPreferenceKeys()
  if (args.has('--write')) {
    const m = buildManifest(result, serverKeys, readManifest())
    writeFileSync(path.join(REPO, MANIFEST_PATH), serializeManifest(m))
    console.log(`wrote ${MANIFEST_PATH}: ${m.entries.length} entries`, summary(result, m))
  }
  const manifest = readManifest()
  const problems = diffManifest(result, manifest, { serverKeys })
  console.log(`scanned ${result.files} files · ${result.entries.length} client keys · ${serverKeys.length} server preference keys`)
  console.log(summary(result, manifest))
  for (const [k, list] of Object.entries(problems)) for (const l of list) console.log(`${k}: ${l}`)
  if (args.has('--check')) process.exit(problemCount(problems) ? 1 : 0)
}
