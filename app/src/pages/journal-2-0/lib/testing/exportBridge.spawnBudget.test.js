// @vitest-environment node
// Rail (wave 7 whole-branch fix, tests-shard cross 1): a rail file spawns a Python bridge ONCE,
// inside a `beforeAll` with its own budget -- never once per test.
//
// Every bridge spawn imports the repo-root conftest (the census + tripwire, lane J's J1), measured
// at 7.5-8.9 s on its own. Paid per TEST, that runs each test against vitest's 15 s testTimeout;
// paid in a `beforeAll` WITHOUT a budget, against the 10 s hookTimeout. Lane J's round batched
// calloutNode.variant this way; this rail holds every caller of exportBridge.js to it.
//
// ⭐ The spawners are DERIVED from exportBridge.js, never typed: every exported function whose body
// names a `*_bridge.py` script. `pythonAvailable` (a `python --version`, no census) and
// `importMarkdown` (pure JS) are not spawners and are not counted.
//
// ⛔ WIDENED (wave 7 whole-branch fix, the tooling round's item 12): a Notebook rail file that
// spawns Python DIRECTLY -- `spawnSync('python', ...)` from node:child_process, or through a
// local helper that does -- pays the same per-spawn cost, and this rail could not see it: it
// walked exportBridge.js's callers only. `importer/exportRoundtrip.test.js` spawned its fixture
// in a beforeAll with NO budget and again in three tests (five spawns, one file), unseen. The
// same rule now holds every test file under pages/journal-2-0/ that imports node:child_process.
// SCOPED to the Notebook's tests on purpose: outside them,
// components/chart/engine/ast/symbolFoldParity.test.js spawns python per symbol per test --
// another workstream's file, named in the tooling report rather than changed from here.
// A `python --version` probe is not a fixture spawn and is not counted.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const parse = (src) => JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
const HERE = path.resolve(__dirname)
const SRC = path.resolve(HERE, '..', '..', '..', '..')   // app/src
const BRIDGE = path.join(HERE, 'exportBridge.js')
const MIN_HOOK_BUDGET_MS = 30_000

function visit(n, fn, parents = []) {
  if (!n || typeof n.type !== 'string') return
  fn(n, parents)
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((c) => visit(c, fn, [...parents, n]))
    else if (v && typeof v.type === 'string') visit(v, fn, [...parents, n])
  }
}

/** Exported functions of exportBridge.js whose body names a `*_bridge.py` script. */
function bridgeSpawners(src) {
  const out = []
  for (const n of parse(src).body) {
    if (n.type !== 'ExportNamedDeclaration' || n.declaration?.type !== 'FunctionDeclaration') continue
    const body = src.slice(n.declaration.body.start, n.declaration.body.end)
    if (/_bridge\.py/.test(body)) out.push(n.declaration.id.name)
  }
  return out
}

/** Every call of a spawner in `src`, and whether it sits in a budgeted `beforeAll`. */
function spawnCalls(src, spawners) {
  const tree = parse(src)
  const local = new Map()          // local name -> imported spawner
  for (const n of tree.body) {
    if (n.type !== 'ImportDeclaration' || !/testing\/exportBridge$/.test(n.source.value)) continue
    for (const s of n.specifiers) {
      if (s.type === 'ImportSpecifier' && spawners.includes(s.imported.name)) local.set(s.local.name, s.imported.name)
    }
  }
  const calls = []
  visit(tree, (n, parents) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier' || !local.has(n.callee.name)) return
    const hook = [...parents].reverse().find((p) => p.type === 'CallExpression'
      && p.callee.type === 'Identifier' && p.callee.name === 'beforeAll')
    const budget = hook?.arguments?.[1]
    const budgetMs = budget?.type === 'Literal' && typeof budget.value === 'number' ? budget.value : null
    calls.push({ fn: local.get(n.callee.name), inBeforeAll: Boolean(hook), budgetMs })
  })
  return calls
}

function testFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') testFiles(full, out) }
    else if (/\.test\.(js|jsx)$/.test(e.name)) out.push(full)
  }
  return out
}

const CHILD_PROCESS = new Set(['node:child_process', 'child_process'])
const SPAWN_FNS = new Set(['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec'])
const NOTEBOOK = path.join(SRC, 'pages', 'journal-2-0')

/** Every Python spawn in `src` -- a child_process call whose first argument is the literal
 * `python`/`python3` (never a `--version` probe), or a call of a top-level local function whose
 * body makes one (transitively) -- and whether it sits in a budgeted `beforeAll`. A spawn inside
 * a spawning helper's own body is not counted twice: the helper's CALLS are what count. */
function pythonSpawnCalls(src) {
  const tree = parse(src)
  const named = new Map()                  // local name -> child_process function
  const spaces = new Set()                 // namespace / default imports of child_process
  for (const n of tree.body) {
    if (n.type !== 'ImportDeclaration' || !CHILD_PROCESS.has(n.source.value)) continue
    for (const s of n.specifiers) {
      if (s.type === 'ImportSpecifier' && SPAWN_FNS.has(s.imported.name)) named.set(s.local.name, s.imported.name)
      else if (s.type !== 'ImportSpecifier') spaces.add(s.local.name)
    }
  }
  const versionProbe = (call) => {
    const argv = call.arguments[1]
    const first = argv?.type === 'ArrayExpression' ? argv.elements[0] : null
    return first?.type === 'Literal' && /^(--?version|-V)$/.test(String(first.value))
  }
  const directSpawn = (n) => n.type === 'CallExpression'
    && ((n.callee.type === 'Identifier' && named.has(n.callee.name))
      || (n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier'
        && spaces.has(n.callee.object.name) && SPAWN_FNS.has(n.callee.property.name)))
    && n.arguments[0]?.type === 'Literal' && /^python3?$/.test(String(n.arguments[0].value))
    && !versionProbe(n)
  const helpers = new Map()                // top-level function name -> its node
  for (const n of tree.body) {
    if (n.type === 'FunctionDeclaration' && n.id) helpers.set(n.id.name, n)
    if (n.type === 'VariableDeclaration') {
      for (const dcl of n.declarations) {
        if (dcl.id.type === 'Identifier' && /^(Arrow)?FunctionExpression$/.test(dcl.init?.type || '')) helpers.set(dcl.id.name, dcl.init)
      }
    }
  }
  const spawners = new Set()
  for (let grew = true; grew;) {           // transitively: a helper that calls a spawner spawns
    grew = false
    for (const [name, fn] of helpers) {
      if (spawners.has(name)) continue
      let spawns = false
      visit(fn.body, (n) => {
        if (directSpawn(n) || (n.type === 'CallExpression' && n.callee.type === 'Identifier' && spawners.has(n.callee.name))) spawns = true
      })
      if (spawns) { spawners.add(name); grew = true }
    }
  }
  const spawnerNodes = new Set([...spawners].map((name) => helpers.get(name)))
  const calls = []
  visit(tree, (n, parents) => {
    const viaHelper = n.type === 'CallExpression' && n.callee.type === 'Identifier' && spawners.has(n.callee.name)
    if (!viaHelper && !directSpawn(n)) return
    if (parents.some((p) => spawnerNodes.has(p))) return
    const hook = [...parents].reverse().find((p) => p.type === 'CallExpression'
      && p.callee.type === 'Identifier' && p.callee.name === 'beforeAll')
    const budget = hook?.arguments?.[1]
    const budgetMs = budget?.type === 'Literal' && typeof budget.value === 'number' ? budget.value : null
    calls.push({ fn: viaHelper ? n.callee.name : 'python', inBeforeAll: Boolean(hook), budgetMs })
  })
  return calls
}

const SPAWNERS = bridgeSpawners(fs.readFileSync(BRIDGE, 'utf8'))
const CALLERS = testFiles(SRC)
  .filter((f) => /testing\/exportBridge['"]/.test(fs.readFileSync(f, 'utf8')))
  .map((f) => ({ file: path.relative(SRC, f).split(path.sep).join('/'), calls: spawnCalls(fs.readFileSync(f, 'utf8'), SPAWNERS) }))
const DIRECT = testFiles(NOTEBOOK)
  .filter((f) => /['"](node:)?child_process['"]/.test(fs.readFileSync(f, 'utf8')))
  .map((f) => ({ file: path.relative(SRC, f).split(path.sep).join('/'), calls: pythonSpawnCalls(fs.readFileSync(f, 'utf8')) }))
  .filter((c) => c.calls.length > 0)

describe('exportBridge: one bridge spawn per rail file, in a budgeted beforeAll', () => {
  it('NON-VACUITY — the spawners are derived and the callers are found', () => {
    expect(SPAWNERS).toEqual(expect.arrayContaining(['exportMarkdownMany', 'exportSelection', 'extractTasks']))
    expect(SPAWNERS).not.toContain('pythonAvailable')
    expect(SPAWNERS).not.toContain('importMarkdown')
    const files = CALLERS.map((c) => c.file)
    expect(files).toContain('pages/journal-2-0/lib/calloutNode.variant.test.js')
    expect(files.length).toBeGreaterThanOrEqual(3)
    expect(CALLERS.flatMap((c) => c.calls).length).toBeGreaterThanOrEqual(3)
  })

  it('CONTROL — a per-test spawn and an unbudgeted beforeAll are both seen', () => {
    const perTest = "import { extractTasks } from './testing/exportBridge'\nit('x', () => { extractTasks({}) }, 60_000)"
    expect(spawnCalls(perTest, SPAWNERS)).toEqual([{ fn: 'extractTasks', inBeforeAll: false, budgetMs: null }])
    const noBudget = "import { extractTasks as t } from '../lib/testing/exportBridge'\nbeforeAll(() => { t({}) })"
    expect(spawnCalls(noBudget, SPAWNERS)).toEqual([{ fn: 'extractTasks', inBeforeAll: true, budgetMs: null }])
  })

  it('NON-VACUITY (widened) — the direct Python spawners under journal-2-0 are found', () => {
    const files = DIRECT.map((c) => c.file)
    expect(files).toContain('pages/journal-2-0/lib/importer/exportRoundtrip.test.js')
    expect(DIRECT.find((c) => c.file.endsWith('exportRoundtrip.test.js')).calls)
      .toEqual([{ fn: 'spawnFixtureVariants', inBeforeAll: true, budgetMs: 60_000 }])
  })

  it('CONTROL (widened) — a helper spawn per test, a direct unbudgeted one, a namespace one; a version probe is not a spawn', () => {
    // The shape exportRoundtrip.test.js had before this round: a helper spawned in an unbudgeted
    // beforeAll and again inside tests. Every one of those calls must be seen.
    const before = [
      "import { spawnSync } from 'node:child_process'",
      "function probe() { return spawnSync('python', ['--version']).status === 0 }",
      "function build(args = (s) => [s]) { return spawnSync('python', args('f.py'), {}) }",
      "beforeAll(() => { build() })",
      "it('a', () => { build(); build() })",
      "it('b', () => { build(() => ['-c', 'x']) })",
      "const ok = probe()",
    ].join('\n')
    expect(pythonSpawnCalls(before)).toEqual([
      { fn: 'build', inBeforeAll: true, budgetMs: null },
      { fn: 'build', inBeforeAll: false, budgetMs: null },
      { fn: 'build', inBeforeAll: false, budgetMs: null },
      { fn: 'build', inBeforeAll: false, budgetMs: null },
    ])
    const direct = "import { execFileSync as run } from 'child_process'\nit('x', () => { run('python', ['-c', 'y']) })"
    expect(pythonSpawnCalls(direct)).toEqual([{ fn: 'python', inBeforeAll: false, budgetMs: null }])
    const ns = "import cp from 'node:child_process'\nbeforeAll(() => { cp.spawnSync('python3', ['z.py']) }, 60_000)"
    expect(pythonSpawnCalls(ns)).toEqual([{ fn: 'python', inBeforeAll: true, budgetMs: 60_000 }])
    const node = "import { spawnSync } from 'node:child_process'\nit('n', () => { spawnSync('node', ['x.mjs']) })"
    expect(pythonSpawnCalls(node)).toEqual([])
  })

  it('every direct Python spawner under journal-2-0 spawns at most once, inside beforeAll(fn, >= 30 s)', () => {
    const bad = []
    for (const { file, calls } of DIRECT) {
      if (calls.length > 1) bad.push(`${file}: ${calls.length} Python spawns (batch them into one)`)
      for (const c of calls) {
        if (!c.inBeforeAll) bad.push(`${file}: ${c.fn} spawns Python inside a test, not a beforeAll`)
        else if (!(c.budgetMs >= MIN_HOOK_BUDGET_MS)) bad.push(`${file}: ${c.fn}'s beforeAll has no budget >= ${MIN_HOOK_BUDGET_MS} ms (hookTimeout is 10 s)`)
      }
    }
    expect(bad).toEqual([])
  })

  it('every caller spawns at most once, inside beforeAll(fn, >= 30 s)', () => {
    const bad = []
    for (const { file, calls } of CALLERS) {
      if (calls.length > 1) bad.push(`${file}: ${calls.length} spawns (batch them into one)`)
      for (const c of calls) {
        if (!c.inBeforeAll) bad.push(`${file}: ${c.fn} runs inside a test, not a beforeAll`)
        else if (!(c.budgetMs >= MIN_HOOK_BUDGET_MS)) bad.push(`${file}: ${c.fn}'s beforeAll has no budget >= ${MIN_HOOK_BUDGET_MS} ms (hookTimeout is 10 s)`)
      }
    }
    expect(bad).toEqual([])
  })
})
