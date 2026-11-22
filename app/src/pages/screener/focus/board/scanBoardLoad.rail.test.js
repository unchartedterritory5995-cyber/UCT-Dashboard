// app/src/pages/screener/focus/board/scanBoardLoad.rail.test.js
//
// ─── A SCAN BOARD NEVER LOADS THE CHARTS WORKSPACE ───
//
//     cd app && npx vitest run src/pages/screener/focus/board/scanBoardLoad.rail.test.js --maxWorkers=2
//
// The scan board uses the Charts board's drop rule (the widget you moved keeps its slot, the others
// re-tile around it). Until 2026-11-18 it took that one function from `pages/charts/ChartsWorkspace`
// with a lazy import. Two things followed, neither visible in a test of the board itself:
//
//   * the first time a member turned Customize on, the browser fetched the whole Charts workspace
//     module and everything it imports (the Agent dock included) to run about sixty lines;
//   * every rail that derives its scope from the import graph (the Terminal's theme and contrast
//     rails walk lazy imports too) saw the Charts workspace and the Agent as mounted wherever a scan
//     board is: 199 files that are not there.
//
// The rule now lives in `pages/charts/repackAroundMoved.js`. This rail holds the three facts that
// keep it that way. It reads SOURCE and walks imports; it mounts nothing.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = path.join(process.cwd(), 'src')
const rel = (abs) => path.relative(SRC, abs).split(path.sep).join('/')
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8').replace(/\r\n/g, '\n')

const EXTS = ['', '.js', '.jsx', '/index.js', '/index.jsx']
const EDGE = /(?:^|[^\w.])(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[^\w.])import\s+['"]([^'"]+)['"]/g
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))

/** The relative imports of one source file (static, re-export and lazy), resolved, src-relative. */
function importsOf(r) {
  const abs = path.join(SRC, r)
  const out = []
  for (const m of stripComments(fs.readFileSync(abs, 'utf8')).matchAll(EDGE)) {
    const spec = m[1] || m[2] || m[3]
    if (!spec || !spec.startsWith('.')) continue
    const base = path.resolve(path.dirname(abs), spec.split('?')[0])
    const hit = EXTS.map((e) => base + e).find((p) => fs.existsSync(p) && fs.statSync(p).isFile())
    if (hit) out.push(rel(hit))
  }
  return out
}

/** Every source file reachable from `root` by imports, lazy ones included. */
function closure(root) {
  const seen = new Set()
  const queue = [root]
  while (queue.length) {
    const r = queue.pop()
    if (seen.has(r) || !/\.(jsx?)$/.test(r)) continue
    seen.add(r)
    queue.push(...importsOf(r))
  }
  return seen
}

const BOARD = 'pages/screener/focus/board/ScanBoard.jsx'
const RULE = 'pages/charts/repackAroundMoved.js'
const WORKSPACE = 'pages/charts/ChartsWorkspace.jsx'

describe('the scan board and the Charts workspace', () => {
  it('CONTROL: the walk follows a lazy import (it reaches the drop rule through one)', () => {
    expect(read(BOARD)).toMatch(/import\('\.\.\/\.\.\/\.\.\/charts\/repackAroundMoved'\)/)
    expect(importsOf(BOARD)).toContain(RULE)
    expect(closure(WORKSPACE).size).toBeGreaterThan(100) // the workspace really is large
  })

  it('nothing the scan board loads reaches the Charts workspace or the Agent', () => {
    const got = [...closure(BOARD)]
    expect(got.filter((f) => f === WORKSPACE || f.startsWith('agent/'))).toEqual([])
  })

  it('the drop rule stays a small pure module: the widget registry and the grid size, nothing else', () => {
    expect(importsOf(RULE).sort()).toEqual(['pages/charts/rowHeight.js', 'widgets/registry.js'])
    expect(read(RULE)).not.toMatch(/from 'react'|document\.|window\./)
    expect(closure(RULE).size).toBeLessThan(10)
  })

  it('the Charts workspace uses the same rule, not a second copy', () => {
    const ws = read(WORKSPACE)
    expect(ws).toMatch(/import \{[^}]*\brepackAroundMoved\b[^}]*\} from '\.\/repackAroundMoved'/)
    expect(ws).toContain('export { repackAroundMoved }')
    expect(ws).not.toMatch(/function repackAroundMoved\(/)
    expect(ws).not.toMatch(/const GRID_COLS\s*=/)
  })
})
