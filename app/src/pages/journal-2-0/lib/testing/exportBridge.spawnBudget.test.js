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

const SPAWNERS = bridgeSpawners(fs.readFileSync(BRIDGE, 'utf8'))
const CALLERS = testFiles(SRC)
  .filter((f) => /testing\/exportBridge['"]/.test(fs.readFileSync(f, 'utf8')))
  .map((f) => ({ file: path.relative(SRC, f).split(path.sep).join('/'), calls: spawnCalls(fs.readFileSync(f, 'utf8'), SPAWNERS) }))

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
