// UCT Agent closure shadow — JS/CSS reference extractor (helper for tools/agent_closure_shadow.py).
//
// SHADOW ONLY. Gates nothing. AUDIT-owned.
//
// stdin : {"files":[{"path":"app/src/x.js","content":"..."}], "cwd":"app"}
// stdout: {"results":{"<path>":{"refs":[...], "uncertain":[...]}}}
//
// A ref is {kind, spec?, pattern?, line}:
//   kind = import | dynamic | reexport | require | mock | glob | url | read | exec | css
//   spec    = a module specifier as written (resolved by the Python side against the tree)
//   pattern = a path pattern rooted at "/R" (the repo root); "\u0001" marks an unknown hole
// An uncertain entry is {why, line}: something the extractor cannot bound (fail-closed: the Python side
// turns any uncertain file on a seed's path into a `full` verdict).
//
// The parser is @babel/parser (already in app/node_modules via @vitejs/plugin-react); there are no regexes
// over JS source here except for CSS. Resolved from the app's own node_modules so no new dependency.

import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'

const HOLE = '\u0001'
const UNSET = '\u0004UNSET'
const TMP = '\u0003TMP'
const R = '/R'
const MAXV = 64

function loadParser(appDir) {
  const req = createRequire(path.join(appDir, 'package.json'))
  return req('@babel/parser')
}

const READ_FNS = new Set([
  'readFileSync', 'readFile', 'readdirSync', 'readdir', 'existsSync', 'exists', 'statSync', 'stat',
  'lstatSync', 'lstat', 'opendirSync', 'opendir', 'globSync', 'createReadStream', 'accessSync', 'access',
  'realpathSync', 'readJsonSync', 'readJSONSync', 'readJson',
])
const EXEC_FNS = new Set(['execSync', 'execFileSync', 'spawnSync', 'spawn', 'exec', 'execFile', 'fork', 'execa', 'execaSync'])
const ITER_FNS = new Set(['map', 'forEach', 'filter', 'flatMap', 'find', 'some', 'every', 'findIndex', 'reduce', 'sort', 'toSorted', 'findLast'])
const PASS_FNS = new Set(['filter', 'sort', 'toSorted', 'slice', 'reverse', 'toReversed', 'concat', 'flat', 'find', 'findLast', 'at'])

function lineOf(n) { return n && n.loc ? n.loc.start.line : 0 }

function posixNorm(p) {
  const abs = p.startsWith('/')
  const out = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { if (out.length && out[out.length - 1] !== '..' && !out[out.length - 1].includes(HOLE)) out.pop(); else if (!abs) out.push('..'); continue }
    out.push(seg)
  }
  return (abs ? '/' : '') + out.join('/')
}
function pjoin(...parts) {
  let acc = ''
  for (const p of parts) { if (p === '') continue; acc = acc ? acc + '/' + p : p }
  return posixNorm(acc)
}
function presolve(cwdAbs, ...parts) {
  let acc = cwdAbs
  for (const p of parts) { if (p.startsWith('/') || p.startsWith(TMP)) acc = p; else acc = acc + '/' + p }
  return acc.startsWith(TMP) ? acc : posixNorm(acc)
}
function pdirname(p) {
  if (p.startsWith(TMP)) return TMP
  const n = posixNorm(p); const i = n.lastIndexOf('/')
  if (i <= 0) return n.startsWith('/') ? '/' : '.'
  return n.slice(0, i)
}

// ---- values ---------------------------------------------------------------------------------------------
// V = {t:'s', v} | {t:'arr', els:[V]} | {t:'obj', props:{k:[V]}} | {t:'h'}
const H = { t: 'h' }
const S = (v) => ({ t: 's', v })
function strsOrHole(vals) { const s = strs(vals); return s.length ? s : [HOLE] }
function strs(vals) { // -> list of strings (holes allowed)
  const out = []
  for (const v of vals) {
    if (v.t === 's') out.push(v.v)
    else out.push(HOLE)
  }
  return uniq(out)
}
function uniq(a) { return [...new Set(a)] }
function cap(vals) {
  if (vals.length > 1) {
    const seen = new Set(); const out = []
    for (const v of vals) { const k = JSON.stringify(v); if (!seen.has(k)) { seen.add(k); out.push(v) } }
    vals = out
  }
  return vals.length > MAXV ? [H] : vals
}
function cross(lists, fn) {
  let acc = [[]]
  for (const l of lists) {
    const next = []
    for (const a of acc) for (const x of l) next.push([...a, x])
    acc = next
    if (acc.length > MAXV) return [HOLE]
  }
  return uniq(acc.map(fn))
}
function elementsOf(vals) {
  const out = []
  for (const v of vals) {
    if (v.t === 'arr') out.push(...v.els)
    else if (v.t === 'obj') out.push(H)
    else out.push(H)
  }
  return cap(out)
}

// ---- per-file analysis ----------------------------------------------------------------------------------
let jsonModules = {}
let envNames = new Set()
function analyze(parser, file, content, cwdRel) {
  const refs = []
  const uncertain = []
  const fileAbs = R + '/' + file
  const dirAbs = pdirname(fileAbs)
  const cwdAbs = R + '/' + cwdRel
  const ext = path.extname(file).toLowerCase()

  if (ext === '.css' || ext === '.scss' || ext === '.less') {
    const re = /@import\s+(?:url\()?\s*['"]([^'"]+)['"]|composes\s*:[^;]*?from\s+['"]([^'"]+)['"]|url\(\s*['"]?([^'")]+)['"]?\s*\)/g
    let m
    while ((m = re.exec(content))) {
      const spec = m[1] || m[2] || m[3]
      if (!spec || /^(data:|https?:|#)/.test(spec)) continue
      refs.push({ kind: 'css', spec, line: content.slice(0, m.index).split('\n').length })
    }
    return { refs, uncertain }
  }

  let ast
  const plugins = ext === '.ts' ? ['typescript'] : ext === '.tsx' ? ['typescript', 'jsx'] : ['jsx']
  try {
    ast = parser.parse(content, { sourceType: 'unambiguous', plugins, errorRecovery: true, allowReturnOutsideFunction: true, allowImportExportEverywhere: true })
  } catch (e) {
    uncertain.push({ why: 'parse-error: ' + String(e.message).slice(0, 120), line: 0 })
    return { refs, uncertain }
  }
  if (ast.errors && ast.errors.length) {
    // errorRecovery parsed it; a recovered error never hides an import, but say so (not fatal).
  }

  // Pass 1: bindings by name (scope-insensitive union — over-approximates, never under-).
  const binds = new Map() // name -> [{kind, node, idx?, fn?}]
  const fnByName = new Map() // name -> function node
  const callsByName = new Map() // name -> [CallExpression]
  const isFn = (x) => x && /Function|Arrow/.test(x.type)
  const scopeIds = new WeakMap(); let nextScope = 1
  const scopeId = (sc) => { if (!sc) return 0; if (!scopeIds.has(sc)) scopeIds.set(sc, nextScope++); return scopeIds.get(sc) }
  const scopeOf = (node) => { let p = parents.get(node); while (p && !isFn(p)) p = parents.get(p); return p || null }
  // a binding remembers the function it lives in, so a use resolves through ITS scope chain first (a `dir` param of
  // one walker is not the `dir` of another)
  const addBind = (name, b, at) => {
    if (!binds.has(name)) binds.set(name, [])
    binds.get(name).push({ ...b, scope: at ? scopeOf(at) : null })
  }
  const bindPattern = (pat, src) => {
    if (!pat) return
    if (pat.type === 'Identifier') addBind(pat.name, src, pat)
    else if (pat.type === 'ObjectPattern') for (const p of pat.properties) {
      if (p.type === 'RestElement') bindPattern(p.argument, { kind: 'hole' })
      else { const key = p.key && (p.key.name || p.key.value); bindPattern(p.value, { kind: 'member', of: src, key }) }
    }
    else if (pat.type === 'ArrayPattern') pat.elements.forEach((e) => bindPattern(e, { kind: 'elem', of: src }))
    else if (pat.type === 'AssignmentPattern') { bindPattern(pat.left, src); bindPattern(pat.left, { kind: 'expr', node: pat.right }) }
    else if (pat.type === 'RestElement') bindPattern(pat.argument, { kind: 'hole' })
  }
  const parents = new WeakMap()
  const all = []
  ;(function walk(node, parent) {
    if (!node || typeof node.type !== 'string') return
    parents.set(node, parent)
    all.push(node)
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments' || k === 'extra') continue
      const v = node[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, node) }
      else if (v && typeof v.type === 'string') walk(v, node)
    }
  })(ast.program, null)

  for (const n of all) {
    if (n.type === 'VariableDeclarator') {
      const p = parents.get(n)
      const gp = p && parents.get(p)
      if (gp && (gp.type === 'ForOfStatement' || gp.type === 'ForInStatement') && gp.left === p) {
        bindPattern(n.id, gp.type === 'ForOfStatement' ? { kind: 'elem', of: { kind: 'expr', node: gp.right } } : { kind: 'hole' })
      } else if (n.init) {
        bindPattern(n.id, { kind: 'expr', node: n.init })
        if (n.id.type === 'Identifier' && /Function|Arrow/.test(n.init.type)) fnByName.set(n.id.name, n.init)
      } else bindPattern(n.id, { kind: 'hole' })
    } else if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') {
      addBind(n.left.name, { kind: 'expr', node: n.right }, n)
    } else if (n.type === 'FunctionDeclaration' && n.id) {
      fnByName.set(n.id.name, n)
    } else if (n.type === 'CallExpression' && n.callee.type === 'Identifier') {
      if (!callsByName.has(n.callee.name)) callsByName.set(n.callee.name, [])
      callsByName.get(n.callee.name).push(n)
    } else if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed &&
               ['push', 'unshift', 'add', 'set'].includes(n.callee.property.name) && n.callee.object.type === 'Identifier') {
      // acc.push(p): acc's elements include p (Set.add / Map.set value too)
      const arg = n.callee.property.name === 'set' ? n.arguments[1] : n.arguments[0]
      if (arg) addBind(n.callee.object.name, { kind: 'pushed', node: arg, site: n }, null)
    } else if (n.type === 'ImportSpecifier' || n.type === 'ImportDefaultSpecifier' || n.type === 'ImportNamespaceSpecifier') {
      const decl = parents.get(n)
      const src = decl && decl.source && decl.source.value
      const jp = src && /\.json$/.test(src) && /^\.\.?\//.test(src) ? pjoin(dirAbs, src).slice(R.length + 1) : null
      if (jp && jsonModules[jp] !== undefined && n.type !== 'ImportNamespaceSpecifier') {
        const key = n.type === 'ImportSpecifier' ? (n.imported.name ?? n.imported.value) : null
        addBind(n.local.name, { kind: 'json', path: jp, key })
      } else addBind(n.local.name, { kind: 'import' })
    } else if (n.type === 'CatchClause' && n.param) bindPattern(n.param, { kind: 'hole' })
  }
  const fnDecls = all.filter((x) => x.type === 'FunctionDeclaration' && x.id)
  function declScope(name, from) {
    // the scope whose declaration of `name` a reference at `from` resolves to (a named function expression's own
    // name resolves to the function itself)
    for (let sc = scopeOf(from); ; sc = scopeOf(sc)) {
      if (sc && sc.type === 'FunctionExpression' && sc.id && sc.id.name === name) return sc
      const bs = (binds.get(name) || []).filter((b) => b.kind !== 'pushed' && b.scope === sc)
      if (bs.length || fnDecls.some((d) => d.id.name === name && scopeOf(d) === sc)) return sc
      if (!sc) return null
    }
  }
  // function params: bound from call sites (named functions) or iterator receivers (callbacks)
  for (const n of all) {
    if (!/Function|Arrow/.test(n.type) || !n.params) continue
    const p = parents.get(n)
    let name = null
    if (n.type === 'FunctionDeclaration' && n.id) name = n.id.name
    else if (p && p.type === 'VariableDeclarator' && p.id.type === 'Identifier') name = p.id.name
    else if (n.type === 'FunctionExpression' && n.id) name = n.id.name
    if (p && p.type === 'CallExpression' && p.callee === n) {
      // IIFE: (function walk(dir) { … })(SRC)
      n.params.forEach((param, i) => { const a = p.arguments[i]; if (a && a.type !== 'SpreadElement') bindPattern(param, { kind: 'expr', node: a }) })
    }
    if (name) {
      // only the calls whose callee resolves (lexically) to THIS function: two helpers both named `read` in
      // different describe blocks do not share arguments
      const home = n.type === 'FunctionDeclaration' ? scopeOf(n) : p && p.type === 'VariableDeclarator' ? scopeOf(p) : n
      const calls = (callsByName.get(name) || []).filter((c) => declScope(name, c) === home)
      n.params.forEach((param, i) => {
        if (!calls.length && !(p && p.type === 'CallExpression' && p.callee === n)) bindPattern(param, { kind: 'param-nocall', fn: name })
        for (const c of calls) {
          const a = c.arguments[i]
          if (a && a.type !== 'SpreadElement') bindPattern(param, { kind: 'expr', node: a })
          // a missing argument is undefined (or the default, already bound): no value
        }
      })
    } else if (p && p.type === 'CallExpression' && p.arguments.includes(n) && p.callee.type === 'MemberExpression') {
      const meth = p.callee.property && (p.callee.property.name || p.callee.property.value)
      if (ITER_FNS.has(meth)) {
        const idx = meth === 'reduce' ? 1 : 0
        n.params.forEach((param, i) => bindPattern(param, i === idx ? { kind: 'elem', of: { kind: 'expr', node: p.callee.object } } : { kind: 'hole' }))
      } else n.params.forEach((param) => bindPattern(param, { kind: 'cbparam' }))
    } else if (p && p.type === 'CallExpression' && p.callee.type === 'CallExpression' && p.callee.callee.type === 'MemberExpression' &&
               p.callee.callee.property && p.callee.callee.property.name === 'each') {
      // it.each(rows)(name, (a, b) => …): bound from the rows below
    } else {
      // test(…, ({ x }) => …), callbacks into other modules
      n.params.forEach((param) => bindPattern(param, { kind: 'cbparam' }))
    }
  }
  // `.each([...])('name', (a, b) => …)` tables: bind callback params to the rows' elements
  for (const n of all) {
    if (n.type !== 'CallExpression' || n.callee.type !== 'CallExpression') continue
    const inner = n.callee
    if (inner.callee.type !== 'MemberExpression') continue
    const meth = inner.callee.property && inner.callee.property.name
    if (meth !== 'each' || !inner.arguments[0]) continue
    const cb = n.arguments.find((a) => /Function|Arrow/.test(a.type))
    if (!cb) continue
    const rows = { kind: 'elem', of: { kind: 'expr', node: inner.arguments[0] } }
    cb.params.forEach((param, i) => {
      bindPattern(param, { kind: 'rowElem', of: rows, i }) // row is an array: [a, b]
      bindPattern(param, rows) // row is a scalar / object
    })
  }

  // Pass 2: evaluator
  const busy = new Set()
  function isEnvObj(o, depth) {
    if (o.type === 'MemberExpression' && !o.computed && o.property.name === 'env') {
      const b = o.object
      if (b.type === 'Identifier' && b.name === 'process') return true
      if (b.type === 'MemberExpression' && !b.computed && b.property.name === 'process') return true
      if (b.type === 'OptionalMemberExpression' || o.type === 'OptionalMemberExpression') return true
    }
    if (o.type === 'OptionalMemberExpression' && !o.computed && o.property.name === 'env') return true
    if (o.type === 'Identifier' && depth < 10) {
      const bs = binds.get(o.name) || []
      return bs.length > 0 && bs.every((b) => b.kind === 'expr' && (isEnvObj(b.node, depth + 1) ||
        (b.node.type === 'LogicalExpression' && isEnvObj(b.node.left, depth + 1))))
    }
    return false
  }
  function evalBind(b, depth) {
    switch (b.kind) {
      case 'expr': return ev(b.node, depth)
      case 'elem': return elementsOf(evalBind(b.of, depth))
      case 'rowElem': { // the i-th cell of each array row; a scalar row has no cells (it binds the param directly)
        const out = []
        for (const r of evalBind(b.of, depth)) if (r.t === 'arr') out.push(...(r.els[b.i] ? [r.els[b.i]] : r.els))
        return cap(out)
      }
      case 'member': {
        const base = evalBind(b.of, depth); const out = []
        for (const v of base) {
          if (v.t === 'obj' && b.key != null && v.props[b.key]) out.push(...v.props[b.key])
          else out.push(H)
        }
        return cap(out)
      }
      case 'pushed': return [{ t: 'arr', els: ev(b.node, depth) }]
      case 'json': {
        try {
          let v = JSON.parse(jsonModules[b.path])
          if (b.key) v = v[b.key]
          return [fromJson(v, 0)]
        } catch { return [H] }
      }
      default: return [H]
    }
  }
  function fromJson(v, d) {
    if (d > 8) return H
    if (typeof v === 'string') return S(v)
    if (Array.isArray(v)) return { t: 'arr', els: cap(v.map((x) => fromJson(x, d + 1))) }
    if (v && typeof v === 'object') { const props = {}; for (const [k, x] of Object.entries(v)) props[k] = [fromJson(x, d + 1)]; return { t: 'obj', props } }
    return H
  }
  function evName(name, depth, use) {
    if (name === '__dirname') return [S(dirAbs)]
    if (name === '__filename') return [S(fileAbs)]
    let bs = binds.get(name)
    let key = name
    if (!bs || !bs.length) return [H]
    if (use) {
      const decl = bs.filter((b) => b.kind !== 'pushed')
      const resolve = (from) => {
        for (let sc = scopeOf(from); ; sc = scopeOf(sc)) {
          const here = decl.filter((b) => b.scope === sc)
          if (here.length) return { sc, here }
          if (!sc) return null
        }
      }
      const r = resolve(use)
      if (r) {
        key = name + '@' + scopeId(r.sc)
        // pushes count when THEIR site resolves the same name to the same declaration scope
        bs = [...r.here, ...bs.filter((b) => b.kind === 'pushed' && (() => { const q = resolve(b.site); return !q || q.sc === r.sc })())]
      }
    }
    if (busy.has(key)) { cuts++; return [] } // least fixpoint: the SAME variable referring back to itself
    busy.add(key)
    try {
      const out = []
      for (const b of bs) out.push(...evalBind(b, depth + 1))
      return out.length ? cap(out) : []
    } finally { busy.delete(key) }
  }
  function calleeName(c) {
    if (c.type === 'Identifier') return c.name
    if (c.type === 'MemberExpression' && !c.computed) return c.property.name
    return null
  }
  const memo = new Map()
  const inflight = new Set()
  let cuts = 0 // a value computed while a cycle was cut is partial: it is never memoised
  function ev(node, depth = 0) {
    if (!node || depth > 14) return [H]
    if (memo.has(node)) return memo.get(node)
    if (inflight.has(node)) { cuts++; return [] } // least fixpoint
    inflight.add(node)
    const before = cuts
    let r
    try { r = ev0(node, depth) } finally { inflight.delete(node) }
    if (cuts === before) memo.set(node, r)
    return r
  }
  function ev0(node, depth) {
    switch (node.type) {
      case 'StringLiteral': return [S(node.value)]
      case 'TemplateLiteral': {
        const lists = [[node.quasis[0].value.cooked ?? '']]
        node.expressions.forEach((e, i) => { lists.push(strs(ev(e, depth + 1))); lists.push([node.quasis[i + 1].value.cooked ?? '']) })
        return cross(lists, (a) => a.join('')).map(S)
      }
      case 'BinaryExpression':
        if (node.operator === '+') return cross([strs(ev(node.left, depth + 1)), strs(ev(node.right, depth + 1))], (a) => a.join('')).map(S)
        return [H]
      case 'ConditionalExpression': return cap([...ev(node.consequent, depth + 1), ...ev(node.alternate, depth + 1)])
      case 'LogicalExpression': return cap([...ev(node.left, depth + 1), ...ev(node.right, depth + 1)])
      case 'Identifier': return evName(node.name, depth, node)
      case 'ArrayExpression': return [{ t: 'arr', els: cap(node.elements.flatMap((e) => (e ? (e.type === 'SpreadElement' ? elementsOf(ev(e.argument, depth + 1)) : ev(e, depth + 1)) : []))) }]
      case 'ObjectExpression': {
        const props = {}
        for (const p of node.properties) {
          if (p.type === 'ObjectProperty' && !p.computed) { const k = p.key.name ?? p.key.value; props[k] = ev(p.value, depth + 1) }
        }
        return [{ t: 'obj', props }]
      }
      case 'OptionalMemberExpression': return ev({ ...node, type: 'MemberExpression' }, depth + 1)
      case 'OptionalCallExpression': return ev({ ...node, type: 'CallExpression' }, depth + 1)
      case 'TSAsExpression': case 'TSNonNullExpression': case 'ParenthesizedExpression': case 'AwaitExpression':
        return ev(node.expression || node.argument, depth + 1)
      case 'MemberExpression': {
        if (node.object.type === 'MetaProperty' && node.property.name === 'url') return [S(fileAbs)]
        if (!node.computed && isEnvObj(node.object, depth)) {
          // an env var the CI workflow does not set is unset in the run (undefined): no repo path
          return envNames.has(node.property.name) ? [H] : [S(UNSET)]
        }
        if (node.object.type === 'MetaProperty' && (node.property.name === 'dirname')) return [S(dirAbs)]
        if (node.object.type === 'MetaProperty' && (node.property.name === 'filename')) return [S(fileAbs)]
        const base = ev(node.object, depth + 1)
        const key = node.computed ? null : node.property.name
        const out = []
        for (const v of base) {
          if (v.t === 'obj' && key != null && v.props[key]) out.push(...v.props[key])
          else if (v.t === 'arr' && node.computed) out.push(...v.els)
          else if (v.t === 's' && (key === 'pathname' || key === 'href')) out.push(v)
          else out.push(H)
        }
        return cap(out)
      }
      case 'NewExpression': {
        const cn = calleeName(node.callee)
        if (cn === 'URL' && node.arguments.length >= 1) {
          if (node.arguments.length === 1) return strs(ev(node.arguments[0], depth + 1)).map((s) => S(s))
          const bases = strs(ev(node.arguments[1], depth + 1))
          const rels = strs(ev(node.arguments[0], depth + 1))
          if (bases.some((b) => /^https?:/.test(b))) return [H]
          return cross([bases, rels], ([b, r]) => (r.startsWith('/') ? r : pjoin(pdirname(b), r))).map(S)
        }
        return [H]
      }
      case 'CallExpression': {
        const c = node.callee
        const cn = calleeName(c)
        const args = node.arguments
        const objName = c.type === 'MemberExpression' && c.object.type === 'Identifier' ? c.object.name : null
        const isPathMod = objName === 'path' || objName === 'posix' || (c.type === 'Identifier')
        if (cn === 'cwd') return [S(cwdAbs)]
        if (cn === 'fileURLToPath' || cn === 'String' || cn === 'normalize' || cn === 'toString' || cn === 'realpathSync' || cn === 'pathToFileURL') {
          if (cn === 'toString' && c.type === 'MemberExpression') return ev(c.object, depth + 1)
          return args[0] ? ev(args[0], depth + 1) : [H]
        }
        if (cn === 'tmpdir' || cn === 'mkdtempSync' || cn === 'mkdtemp') return [S(TMP)]
        if ((cn === 'replace' || cn === 'replaceAll') && c.type === 'MemberExpression' && args.length === 2) {
          // applied exactly when the pattern and replacement are literals (e.g. the Windows drive strip)
          const pat = args[0]; const rp = args[1]
          let re = null
          if (pat.type === 'RegExpLiteral') re = new RegExp(pat.pattern, pat.flags)
          else if (pat.type === 'StringLiteral') re = pat.value
          if (re !== null && rp.type === 'StringLiteral') {
            const base = ev(c.object, depth + 1)
            return base.map((v) => (v.t === 's' ? S(cn === 'replace' ? v.v.replace(re, rp.value) : v.v.replaceAll(re, rp.value)) : H))
          }
          return [H]
        }
        if ((cn === 'join' || cn === 'resolve') && isPathMod && objName !== 'Promise') {
          const lists = args.map((a) => strs(ev(a, depth + 1)))
          if (!lists.length) return cn === 'resolve' ? [S(cwdAbs)] : [S('.')]
          return cross(lists, (parts) => (cn === 'join' ? pjoin(...parts) : presolve(cwdAbs, ...parts))).map(S)
        }
        if (cn === 'dirname' && isPathMod) return strs(ev(args[0], depth + 1)).map((s) => S(pdirname(s)))
        if ((cn === 'relative' || cn === 'basename' || cn === 'extname') && isPathMod) return [H]
        if (cn === 'join' && c.type === 'MemberExpression') return [H] // array.join
        if (c.type === 'MemberExpression' && PASS_FNS.has(cn)) {
          const base = ev(c.object, depth + 1)
          if (cn === 'concat') return [{ t: 'arr', els: cap([...elementsOf(base), ...args.flatMap((a) => elementsOf(ev(a, depth + 1)))]) }]
          if (cn === 'find' || cn === 'findLast' || cn === 'at') return elementsOf(base)
          return base
        }
        if (c.type === 'MemberExpression' && cn === 'map' && args[0] && /Function|Arrow/.test(args[0].type)) {
          const fn = args[0]
          const body = fn.body.type === 'BlockStatement' ? returnsOf(fn.body) : [fn.body]
          return [{ t: 'arr', els: cap(body.flatMap((b) => ev(b, depth + 1))) }]
        }
        if (c.type === 'MemberExpression' && cn === 'flatMap' && args[0] && /Function|Arrow/.test(args[0].type)) {
          const fn = args[0]
          const body = fn.body.type === 'BlockStatement' ? returnsOf(fn.body) : [fn.body]
          return [{ t: 'arr', els: cap(body.flatMap((b) => { const v = ev(b, depth + 1); return v.flatMap((x) => (x.t === 'arr' ? x.els : [x])) })) }]
        }
        if (cn === 'keys' && objName === 'Object') return [{ t: 'arr', els: [H] }]
        if (c.type === 'Identifier' && fnByName.has(c.name)) {
          const fn = fnByName.get(c.name)
          if (busy.has('fn:' + c.name)) { cuts++; return [] }
          busy.add('fn:' + c.name)
          try {
            const body = fn.body.type === 'BlockStatement' ? returnsOf(fn.body) : [fn.body]
            return cap(body.flatMap((b) => ev(b, depth + 1)))
          } finally { busy.delete('fn:' + c.name) }
        }
        if (cn === 'parse' && objName === 'JSON') return [H]
        return [H]
      }
      default: return [H]
    }
  }
  function returnsOf(block) {
    const out = []
    ;(function w(n) {
      if (!n || typeof n.type !== 'string') return
      if (n !== block && /Function|Arrow/.test(n.type)) return
      if (n.type === 'ReturnStatement' && n.argument) out.push(n.argument)
      for (const k of Object.keys(n)) {
        if (k === 'loc') continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && w(x))
        else if (v && typeof v.type === 'string') w(v)
      }
    })(block)
    return out
  }

  // A read pattern: evaluate, then root relative strings at the process cwd.
  const snip = (node) => (node && node.start != null ? content.slice(node.start, Math.min(node.end, node.start + 80)) : '?')
  function readPatterns(node, kind, line) {
    if (process.env.AGENT_CLOSURE_JS_TRACE) fs.appendFileSync(process.env.AGENT_CLOSURE_JS_TRACE, `TRACE ${file}:${line} ${snip(node)} => ${JSON.stringify(ev(node)).replace(/\u0001/g, '<?>').slice(0, 400)}
`)
    for (let s of strsOrHole(ev(node))) {
      if (s.startsWith(TMP) || s.includes(UNSET)) continue
      if (/^https?:|^data:/.test(s)) continue
      if (!s.startsWith('/')) {
        if (s.startsWith(HOLE)) { uncertain.push({ why: `${kind}: path is computed from a value the resolver cannot bound: ${snip(node)}`, line }); continue }
        s = presolve(cwdAbs, s)
      }
      if (!s.startsWith(R + '/') && s !== R) {
        if (s.startsWith(HOLE) || s.startsWith('/' + HOLE)) uncertain.push({ why: `${kind}: path is computed from a value the resolver cannot bound: ${snip(node)}`, line })
        continue // an absolute path outside the repo (e.g. /tmp) is not repo state
      }
      refs.push({ kind, pattern: s, line })
    }
  }
  const specOf = (a) => {
    if (!a) return null
    if (a.type === 'StringLiteral') return { lit: a.value }
    if (a.type === 'TemplateLiteral' && a.expressions.length === 0) return { lit: a.quasis[0].value.cooked }
    return { computed: strs(ev(a)) }
  }

  // fs reads only count in a file that can reach the file system (imports/requires fs or child_process):
  // browser code's own `exists()` / `stat()` helpers are not file reads.
  const FS_MODS = /^(node:)?(fs|fs\/promises|child_process|fs-extra|glob|fast-glob)$/
  const hasFs = all.some((n) => (n.type === 'ImportDeclaration' && FS_MODS.test(n.source.value)) ||
    (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require' && n.arguments[0] &&
      n.arguments[0].type === 'StringLiteral' && FS_MODS.test(n.arguments[0].value)) ||
    ((n.type === 'ImportExpression' || (n.type === 'CallExpression' && n.callee.type === 'Import')) &&
      ((n.source || n.arguments[0]) || {}).type === 'StringLiteral' && FS_MODS.test((n.source || n.arguments[0]).value)))
  for (const n of all) {
    const line = lineOf(n)
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || (n.type === 'ExportNamedDeclaration' && n.source)) {
      if (n.importKind === 'type' || n.exportKind === 'type') { /* still a file edge for tsc; vitest erases it */ }
      refs.push({ kind: n.type === 'ImportDeclaration' ? 'import' : 'reexport', spec: n.source.value, line })
      continue
    }
    if (n.type === 'ImportExpression' || (n.type === 'CallExpression' && n.callee.type === 'Import')) {
      const a = n.type === 'ImportExpression' ? n.source : n.arguments[0]
      const sp = specOf(a)
      if (sp && sp.lit != null) refs.push({ kind: 'dynamic', spec: sp.lit, line })
      else {
        // vite turns `import(\`./dir/${x}.js\`)` into a glob over ./dir; anything else is unbounded
        const cs = (sp && sp.computed) || [HOLE]
        for (const s of cs) {
          if (!s.includes(HOLE)) refs.push({ kind: 'dynamic', spec: s, line })
          else if (/^\.\.?\//.test(s) && s.indexOf(HOLE) > s.indexOf('/')) refs.push({ kind: 'glob', pattern: pjoin(dirAbs, s), line })
          else uncertain.push({ why: 'dynamic import() with a computed specifier', line,
            viteIgnore: /@vite-ignore/.test(content.slice(a ? a.start - 40 : n.start, a ? a.start : n.end)) })
        }
      }
      continue
    }
    if (n.type === 'CallExpression') {
      const c = n.callee
      const cn = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null
      const objName = c.type === 'MemberExpression' && c.object.type === 'Identifier' ? c.object.name : null
      if (cn === 'require' && c.type === 'Identifier') {
        const sp = specOf(n.arguments[0])
        if (sp && sp.lit != null) refs.push({ kind: 'require', spec: sp.lit, line })
        else uncertain.push({ why: 'require() with a computed specifier', line })
        continue
      }
      if (objName === 'vi' && ['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock'].includes(cn)) {
        const a = n.arguments[0]
        if (a && (a.type === 'ImportExpression' || (a.type === 'CallExpression' && a.callee.type === 'Import'))) continue // walked on its own
        const sp = specOf(a)
        if (sp && sp.lit != null) refs.push({ kind: 'mock', spec: sp.lit, line })
        else uncertain.push({ why: `vi.${cn}() with a computed specifier`, line })
        continue
      }
      if (c.type === 'MemberExpression' && c.object.type === 'MetaProperty' && cn === 'glob') {
        const a = n.arguments[0]
        const pats = []
        if (a && a.type === 'StringLiteral') pats.push(a.value)
        else if (a && a.type === 'ArrayExpression' && a.elements.every((e) => e && e.type === 'StringLiteral')) pats.push(...a.elements.map((e) => e.value))
        else { uncertain.push({ why: 'import.meta.glob() with a non-literal pattern', line }); continue }
        for (const p of pats) {
          const neg = p.startsWith('!')
          const body = neg ? p.slice(1) : p
          const abs = body.startsWith('/') ? R + '/' + cwdRel + body : pjoin(dirAbs, body)
          refs.push({ kind: 'glob', pattern: abs, glob: true, negate: neg, line })
        }
        continue
      }
      if (hasFs && cn && READ_FNS.has(cn) && objName !== 'JSON' && n.arguments[0]) {
        readPatterns(n.arguments[0], 'read', line)
        continue
      }
      if (hasFs && cn && EXEC_FNS.has(cn)) {
        for (const a of n.arguments) {
          for (const v of ev(a)) {
            const items = v.t === 'arr' ? strs(v.els) : strs([v])
            for (const s of items) for (const tok of s.split(/\s+/)) {
              if (/\.(py|mjs|cjs|js|sh)$/.test(tok) || tok.includes('tools/')) readPatterns({ type: 'StringLiteral', value: tok }, 'exec', line)
            }
          }
        }
        continue
      }
    }
    if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'URL' && n.arguments.length >= 2) {
      const b = n.arguments[1]
      if (b.type === 'MemberExpression' && b.object.type === 'MetaProperty') {
        const sp = specOf(n.arguments[0])
        if (sp && sp.lit != null) refs.push({ kind: 'url', pattern: sp.lit.startsWith('/') ? R + '/' + cwdRel + sp.lit : pjoin(dirAbs, sp.lit), line })
        else readPatterns(n, 'url', line)
      }
    }
  }
  return { refs, uncertain }
}

// ---- config: aliases + setupFiles from the vite config --------------------------------------------------
function analyzeConfig(parser, file, content, cwdRel) {
  const out = { aliases: [], setupFiles: [], uncertain: [] }
  let ast
  try { ast = parser.parse(content, { sourceType: 'module', plugins: [] }) } catch (e) { out.uncertain.push('config parse error'); return out }
  // Reuse the evaluator by analyzing the file (gives bindings), then walk alias / setupFiles props.
  const fileAbs = R + '/' + file
  const dirAbs = pdirname(fileAbs)
  const fake = analyzeEval(parser, file, content, cwdRel)
  ;(function walk(n) {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ObjectProperty' && !n.computed) {
      const k = n.key.name ?? n.key.value
      if (k === 'alias') {
        if (n.value.type === 'ObjectExpression') {
          for (const p of n.value.properties) {
            if (p.type !== 'ObjectProperty') { out.uncertain.push('alias spread'); continue }
            const key = p.key.name ?? p.key.value
            const vals = fake(p.value)
            for (const v of vals) out.aliases.push({ find: key, replacement: v })
          }
        } else if (n.value.type === 'ArrayExpression') {
          for (const e of n.value.elements) {
            if (!e || e.type !== 'ObjectExpression') { out.uncertain.push('alias entry'); continue }
            const f = e.properties.find((p) => (p.key.name ?? p.key.value) === 'find')
            const r = e.properties.find((p) => (p.key.name ?? p.key.value) === 'replacement')
            if (!f || !r || f.value.type !== 'StringLiteral') { out.uncertain.push('alias find is not a string'); continue }
            for (const v of fake(r.value)) out.aliases.push({ find: f.value.value, replacement: v })
          }
        } else out.uncertain.push('alias is not a literal object/array')
      }
      if (k === 'setupFiles' || k === 'globalSetup') {
        const vals = n.value.type === 'ArrayExpression' ? n.value.elements : [n.value]
        for (const e of vals) for (const v of fake(e)) out.setupFiles.push(v.startsWith('/') ? v : presolve(R + '/' + cwdRel, v))
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'loc') continue
      const v = n[key]
      if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && walk(x))
      else if (v && typeof v.type === 'string') walk(v)
    }
  })(ast.program)
  void dirAbs
  return out
}
// A tiny closure over analyze()'s evaluator for config files: returns string values of an expression.
function analyzeEval(parser, file, content, cwdRel) {
  // Re-run analyze with a hook: simplest is to embed a marker call. Instead, evaluate common config forms.
  const fileAbs = R + '/' + file
  const dirAbs = pdirname(fileAbs)
  const cwdAbs = R + '/' + cwdRel
  return function evalExpr(node) {
    const e = (n) => {
      if (!n) return [HOLE]
      if (n.type === 'StringLiteral') return [n.value]
      if (n.type === 'TemplateLiteral' && !n.expressions.length) return [n.quasis[0].value.cooked]
      if (n.type === 'Identifier' && n.name === '__dirname') return [dirAbs]
      if (n.type === 'MemberExpression' && n.object.type === 'MetaProperty') return [fileAbs]
      if (n.type === 'NewExpression' && n.callee.name === 'URL' && n.arguments.length === 2) {
        return cross([e(n.arguments[1]), e(n.arguments[0])], ([b, r]) => pjoin(pdirname(b), r))
      }
      if (n.type === 'CallExpression') {
        const cn = n.callee.type === 'Identifier' ? n.callee.name : n.callee.property && n.callee.property.name
        if (cn === 'fileURLToPath') return e(n.arguments[0])
        if (cn === 'resolve' || cn === 'join') return cross(n.arguments.map(e), (p) => (cn === 'join' ? pjoin(...p) : presolve(cwdAbs, ...p)))
        if (cn === 'dirname') return e(n.arguments[0]).map(pdirname)
      }
      return [HOLE]
    }
    return e(node)
  }
}

// ---- main -----------------------------------------------------------------------------------------------
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
jsonModules = input.jsonModules || {}
envNames = new Set(input.envNames || [])
const appDir = input.appDir
const parser = loadParser(appDir)
const results = {}
for (const f of input.files || []) {
  try {
    results[f.path] = analyze(parser, f.path, f.content, input.cwd || 'app')
  } catch (e) {
    results[f.path] = { refs: [], uncertain: [{ why: 'extractor crash: ' + String(e && e.message).slice(0, 160), line: 0 }] }
  }
}
const configs = {}
for (const f of input.configs || []) configs[f.path] = analyzeConfig(parser, f.path, f.content, input.cwd || 'app')
process.stdout.write(JSON.stringify({ results, configs }))
