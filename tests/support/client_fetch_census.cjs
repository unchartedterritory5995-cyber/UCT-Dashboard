// Census of the requests the client BUILDS for one API family, read from the
// parse tree (never a text search, so a URL in a comment or a string that is
// never sent cannot appear here).
//
//   node client_fetch_census.cjs <app dir> <url prefix> [--file <one file>]
//
// Prints JSON: { calls: [...], unattributed: [...] }
//
// A "call" is any call expression whose first argument is a string or template
// literal starting with the prefix. For each one it reports the method, the
// Content-Type the client sets, and the body it sends:
//
//   kind "json"      JSON.stringify(<object>)   -> always / sometimes keys
//   kind "formdata"  a FormData the function fills with .append(name, ...)
//   kind "none"      no body
//   kind "unresolved" a body this reader could not follow (reported, never guessed)
//
// "unattributed" lists every prefix literal that is NOT the first argument of a
// call, so a URL built in one place and sent from another is visible rather
// than silently missing from the census.
'use strict'
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const [appDir, prefix, ...rest] = process.argv.slice(2)
if (!appDir || !prefix) {
  console.error('usage: client_fetch_census.cjs <app dir> <url prefix> [--file <path>]')
  process.exit(2)
}
const onlyFile = rest[0] === '--file' ? path.resolve(rest[1]) : null
const requireFromApp = createRequire(path.join(path.resolve(appDir), 'package.json'))
const parser = requireFromApp('@babel/parser')

function sourceFiles(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue
      sourceFiles(p, out)
    } else if (/\.(js|jsx|ts|tsx|mjs)$/.test(ent.name) && !/\.test\.[jt]sx?$/.test(ent.name)) {
      out.push(p)
    }
  }
  return out
}

function literalUrl(node) {
  // Returns the URL with every interpolation replaced by "{}", or null.
  if (!node) return null
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map((q) => q.value.cooked).join('{}')
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = literalUrl(node.left)
    if (left === null) return null
    const right = literalUrl(node.right)
    return left + (right === null ? '{}' : right)
  }
  return null
}

function isFn(node) {
  return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' || node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod'
}

function walk(node, visit, ancestors) {
  if (!node || typeof node.type !== 'string') return
  visit(node, ancestors)
  ancestors.push(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
    const v = node[key]
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, ancestors)
    } else if (v && typeof v.type === 'string') {
      walk(v, visit, ancestors)
    }
  }
  ancestors.pop()
}

function enclosingNames(ancestors) {
  // Names of the functions a node sits inside, outermost first. An arrow or
  // function expression takes the name it is bound to (const x = () => ..., key: () => ...).
  const names = []
  for (let i = 0; i < ancestors.length; i++) {
    const n = ancestors[i]
    if (!isFn(n)) continue
    if (n.id && n.id.name) { names.push(n.id.name); continue }
    if (n.key && n.key.name) { names.push(n.key.name); continue }
    const parent = ancestors[i - 1]
    if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') names.push(parent.id.name)
    else if (parent && parent.type === 'ObjectProperty' && parent.key.type === 'Identifier') names.push(parent.key.name)
    else if (parent && parent.type === 'CallExpression' && ancestors[i - 2] &&
             ancestors[i - 2].type === 'VariableDeclarator' && ancestors[i - 2].id.type === 'Identifier') {
      names.push(ancestors[i - 2].id.name)   // const x = useCallback(() => ...)
    }
  }
  return names
}

function propName(p) {
  if (p.type !== 'ObjectProperty' && p.type !== 'ObjectMethod') return null
  if (p.computed) return null
  if (p.key.type === 'Identifier') return p.key.name
  if (p.key.type === 'StringLiteral') return p.key.value
  return null
}

function literalValue(node) {
  // The value a literal expression evaluates to, or undefined when it is not one.
  if (!node) return undefined
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') return node.value
  if (node.type === 'NullLiteral') return null
  if (node.type === 'ObjectExpression') {
    const out = {}
    for (const p of node.properties) {
      const name = propName(p)
      if (name === null || p.type !== 'ObjectProperty') return undefined
      const v = literalValue(p.value)
      if (v === undefined) return undefined
      out[name] = v
    }
    return out
  }
  if (node.type === 'ArrayExpression') {
    const out = []
    for (const el of node.elements) {
      const v = literalValue(el)
      if (v === undefined) return undefined
      out.push(v)
    }
    return out
  }
  return undefined
}

function objectKeys(obj, always, maybe, problems, literals) {
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') {
      // ...(cond ? {a} : {})  or  ...(cond && {a})  -> keys that are sometimes sent
      const arg = p.argument
      const lits = []
      if (arg.type === 'ConditionalExpression') lits.push(arg.consequent, arg.alternate)
      else if (arg.type === 'LogicalExpression') lits.push(arg.right)
      else if (arg.type === 'ObjectExpression') lits.push(arg)
      else { problems.push('spread of a non-literal'); continue }
      for (const l of lits) {
        if (l.type === 'ObjectExpression') objectKeys(l, maybe, maybe, problems)
        else problems.push('spread branch is not an object literal')
      }
      continue
    }
    const name = propName(p)
    if (name === null) problems.push('computed key')
    else {
      always.add(name)
      if (literals && p.type === 'ObjectProperty') {
        const v = literalValue(p.value)
        if (v !== undefined) literals[name] = v
      }
    }
  }
}

function findInScope(scopeFns, visit) {
  // Innermost enclosing function first, then outwards, then the program.
  for (let i = scopeFns.length - 1; i >= 0; i--) {
    let hit = false
    walk(scopeFns[i], (n, anc) => { if (visit(n, anc)) hit = true }, [])
    if (hit) return true
  }
  return false
}

function resolveJsonArg(arg, scopeFns, body) {
  const always = new Set()
  const maybe = new Set()
  const problems = []
  const literals = {}
  if (arg.type === 'ObjectExpression') {
    objectKeys(arg, always, maybe, problems, literals)
  } else if (arg.type === 'Identifier') {
    const name = arg.name
    const found = findInScope(scopeFns, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === name &&
          n.init && n.init.type === 'ObjectExpression') {
        objectKeys(n.init, always, maybe, problems, literals)
        return true
      }
      return false
    })
    if (!found) problems.push(`identifier ${name} is not an object literal in scope`)
    findInScope(scopeFns, (n) => {
      if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' &&
          n.left.object.type === 'Identifier' && n.left.object.name === name && !n.left.computed) {
        maybe.add(n.left.property.name)
      }
      return false
    })
  } else {
    problems.push(`JSON.stringify of a ${arg.type}`)
  }
  for (const k of always) maybe.delete(k)
  body.kind = problems.length ? 'unresolved' : 'json'
  body.always = [...always].sort()
  body.maybe = [...maybe].sort()
  body.problems = problems
  // The keys whose VALUE is written as a literal at the call site. The rest are
  // computed at run time and are absent here on purpose.
  body.literals = literals
}

function isJsonStringify(node) {
  return node && node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' && node.callee.object.name === 'JSON' &&
    node.callee.property.name === 'stringify' && node.arguments.length >= 1
}

function resolveBody(node, scopeFns) {
  const body = { kind: 'none', always: [], maybe: [], fields: [], problems: [], literals: {} }
  if (!node) return body
  if (isJsonStringify(node)) {
    resolveJsonArg(node.arguments[0], scopeFns, body)
    return body
  }
  // new Blob([JSON.stringify({...})], {type})  -- the sendBeacon form
  if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'Blob' &&
      node.arguments[0] && node.arguments[0].type === 'ArrayExpression' &&
      isJsonStringify(node.arguments[0].elements[0])) {
    resolveJsonArg(node.arguments[0].elements[0].arguments[0], scopeFns, body)
    return body
  }
  if (node.type === 'Identifier') {
    const name = node.name
    let isForm = false
    let jsonInit = null
    findInScope(scopeFns, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === name && n.init) {
        if (n.init.type === 'NewExpression' && n.init.callee.type === 'Identifier' &&
            n.init.callee.name === 'FormData') { isForm = true; return true }
        if (isJsonStringify(n.init)) { jsonInit = n.init; return true }
      }
      return false
    })
    if (jsonInit) { resolveJsonArg(jsonInit.arguments[0], scopeFns, body); return body }
    if (isForm) {
      const fields = new Set()
      findInScope(scopeFns, (n) => {
        if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' &&
            n.callee.object.type === 'Identifier' && n.callee.object.name === name &&
            n.callee.property.name === 'append' && n.arguments[0]) {
          if (n.arguments[0].type === 'StringLiteral') fields.add(n.arguments[0].value)
          else body.problems.push('FormData.append with a non-literal name')
        }
        return false
      })
      body.kind = body.problems.length ? 'unresolved' : 'formdata'
      body.fields = [...fields].sort()
      return body
    }
    body.kind = 'unresolved'
    body.problems.push(`body identifier ${name} is neither a FormData nor JSON.stringify(...) in scope`)
    return body
  }
  body.kind = 'unresolved'
  body.problems.push(`body is a ${node.type}`)
  return body
}

function readOptions(opts) {
  const out = { method: null, contentType: null, bodyNode: null, opaque: false }
  if (!opts) return out
  if (opts.type !== 'ObjectExpression') { out.opaque = true; return out }
  for (const p of opts.properties) {
    const name = propName(p)
    if (name === 'method' && p.value.type === 'StringLiteral') out.method = p.value.value.toUpperCase()
    else if (name === 'body') out.bodyNode = p.value
    else if (name === 'headers' && p.value.type === 'ObjectExpression') {
      for (const h of p.value.properties) {
        const hn = propName(h)
        if (hn && hn.toLowerCase() === 'content-type' && h.value.type === 'StringLiteral') {
          out.contentType = h.value.value
        }
      }
    } else if (p.type === 'SpreadElement') out.opaque = true
  }
  return out
}

const files = onlyFile ? [onlyFile] : sourceFiles(path.join(path.resolve(appDir), 'src'), [])
const calls = []
const unattributed = []
let parsed = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  if (!src.includes(prefix)) continue
  let ast
  try {
    ast = parser.parse(src, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'].filter((p) => p !== 'typescript' || /\.tsx?$/.test(file)),
      errorRecovery: false,
    })
  } catch (e) {
    console.error(`could not parse ${file}: ${e.message}`)
    process.exit(3)
  }
  parsed++
  const rel = path.relative(path.resolve(appDir), file).split(path.sep).join('/')
  const claimed = new Set()
  walk(ast.program, (node, ancestors) => {
    if (node.type !== 'CallExpression' || !node.arguments.length) return
    const url = literalUrl(node.arguments[0])
    if (url === null || !url.startsWith(prefix)) return
    // A string TEST is not a request. `path.startsWith('/api/voice/transcribe')` is how a fetch
    // stand-in decides what to answer (master's agent harness, src/testing/agent/agentHarness.jsx);
    // read as a call it became "GET /api/voice/transcribe", a door that does not exist. The
    // literal is left unclaimed, so it is reported as unattributed and must be declared by name.
    if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier'
      && ['startsWith', 'endsWith', 'includes', 'indexOf', 'match', 'test'].includes(node.callee.property.name)) return
    claimed.add(node.arguments[0])
    const scopeFns = ancestors.filter(isFn)
    scopeFns.unshift(ast.program)
    let callee = '?'
    if (node.callee.type === 'Identifier') callee = node.callee.name
    else if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
      callee = node.callee.property.name
    }
    let opts
    let body
    if (callee === 'sendBeacon') {
      opts = { method: 'POST', contentType: null, opaque: false }
      body = resolveBody(node.arguments[1], scopeFns)
      const blob = node.arguments[1]
      if (blob && blob.type === 'NewExpression' && blob.arguments[1] && blob.arguments[1].type === 'ObjectExpression') {
        for (const p of blob.arguments[1].properties) {
          if (propName(p) === 'type' && p.value.type === 'StringLiteral') opts.contentType = p.value.value
        }
      }
    } else {
      opts = readOptions(node.arguments[1])
      body = resolveBody(opts.bodyNode, scopeFns)
    }
    calls.push({
      file: rel,
      line: node.loc.start.line,
      callee,
      url,
      path: url.split('?')[0],
      method: opts.method || (body.kind === 'none' ? 'GET' : 'POST'),
      methodExplicit: opts.method !== null,
      contentType: opts.contentType,
      optionsOpaque: opts.opaque,
      fns: enclosingNames(ancestors),
      body: { kind: body.kind, always: body.always, maybe: body.maybe, fields: body.fields,
        problems: body.problems, literals: body.literals },
    })
  }, [])
  walk(ast.program, (node) => {
    if (node.type !== 'StringLiteral' && node.type !== 'TemplateLiteral') return
    if (claimed.has(node)) return
    const url = literalUrl(node)
    if (url !== null && url.startsWith(prefix)) {
      unattributed.push({ file: rel, line: node.loc.start.line, url })
    }
  }, [])
}

process.stdout.write(JSON.stringify({ parsed, calls, unattributed }, null, 1))
