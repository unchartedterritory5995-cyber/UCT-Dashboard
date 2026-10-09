// Lane w9-10 (terminal load performance): the app ENTRY chunk must not carry the terminal's
// function registry. `/calendar`'s route wrapper (TerminalRoutes.jsx) sits in App.jsx's static
// graph, and it used to reach `boardModel.js` -> `functions.js`, so every route on the site paid
// for the terminal vocabulary on first open. This walks App.jsx's STATIC imports with an AST
// (never a grep), following re-exports, and fails by name if a heavy terminal module is reached.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const SRC = path.resolve(__dirname, '../..')
const P = Parser.extend(jsx())
const EXT = ['', '.js', '.jsx', '/index.js', '/index.jsx']

function resolve(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec)
  for (const e of EXT) {
    const f = base + e
    if (fs.existsSync(f) && fs.statSync(f).isFile() && /\.jsx?$/.test(f)) return f
  }
  return null
}

function staticSpecs(file) {
  const ast = P.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  const out = []
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') out.push(n.source.value)
    else if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) out.push(n.source.value)
  }
  return out
}

/** Every local file reachable from `root` through static imports and re-exports. */
function staticClosure(root) {
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    for (const s of staticSpecs(f)) {
      const r = resolve(f, s)
      if (r) stack.push(r)
    }
  }
  return seen
}

const rel = (f) => path.relative(SRC, f).split(path.sep).join('/')
const HEAVY = [
  'pages/terminal/functions.js',
  'pages/terminal/boardModel.js',
  'pages/terminal/useTerminalLayout.js',
  'pages/terminal/parseCommand.js',
  'pages/terminal/TerminalShell.jsx',
  'pages/terminal/panels.jsx',
]

describe('the app entry does not statically reach the terminal registry', () => {
  const closure = new Set([...staticClosure(path.join(SRC, 'App.jsx'))].map(rel))

  it('App.jsx static graph holds none of the heavy terminal modules', () => {
    expect(HEAVY.filter((f) => closure.has(f))).toEqual([])
  })

  it('control: the walk sees the route wrapper and its light prefs module', () => {
    expect(closure.has('pages/terminal/TerminalRoutes.jsx')).toBe(true)
    expect(closure.has('pages/terminal/boardPrefs.js')).toBe(true)
    expect(closure.size).toBeGreaterThan(50)
  })

  it('control: the same walk from the shell DOES reach the registry (the probe can fail)', () => {
    const shell = new Set([...staticClosure(path.join(SRC, 'pages/terminal/TerminalShell.jsx'))].map(rel))
    expect(shell.has('pages/terminal/functions.js')).toBe(true)
    expect(shell.has('pages/terminal/boardModel.js')).toBe(true)
  })
})
