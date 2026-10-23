// Members never see the learned auto-drawer's levels + trendlines (owner decision 2026-10-23).
// The SERVER is the authority (api/services/auto_structures.MEMBER_LEARNED_LINES_ROUND = None: a
// member's payload carries no `drawn` block); this rail pins the client's second layer -- StockChart
// hands PatternOverlay a `drawn` block for the ADMIN scope ('all') only -- and that no other module
// renders learned lines. Read from StockChart's AST (acorn-jsx), never a grep, so a comment or a
// string that mentions `drawn=` cannot satisfy it.
import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { autoStructuresScope } from './chart/autoStructuresGate'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`learned-lines member gate: could not find the repo root from ${process.cwd()}`)
})()
const SRC_DIR = path.join(ROOT, 'app', 'src')

function overlayDrawnAttrs() {
  const src = fs.readFileSync(path.join(SRC_DIR, 'components', 'StockChart.jsx'), 'utf8')
  const ast = Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const found = []
  ;(function walk(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'JSXOpeningElement' && node.name?.name === 'PatternOverlay') {
      found.push(node.attributes.find((a) => a.type === 'JSXAttribute' && a.name?.name === 'drawn') || null)
    }
    for (const k in node) if (k !== 'loc') walk(node[k])
  })(ast)
  return found
}

describe('StockChart — learned lines reach the admin scope only', () => {
  it("every PatternOverlay gets `drawn` only when autoStructuresScope === 'all'", () => {
    const attrs = overlayDrawnAttrs()
    expect(attrs.length).toBeGreaterThan(0)            // non-vacuity: the overlay is mounted here
    for (const a of attrs) {
      if (a === null) continue                         // no drawn prop at all: nothing to leak
      const e = a.value?.expression
      expect(e?.type).toBe('ConditionalExpression')
      expect(e.test.type).toBe('BinaryExpression')
      expect(e.test.operator).toBe('===')
      expect(e.test.left.name).toBe('autoStructuresScope')
      expect(e.test.right.value).toBe('all')
      expect(e.consequent.name).toBe('patternDrawn')
      expect(e.alternate.type === 'Literal' && e.alternate.value === null).toBe(true)
    }
  })

  it("control: a paid member resolves to 'trusted', an admin to 'all'", () => {
    expect(autoStructuresScope({ user: { role: 'user' }, isPaid: true, autoStructuresMembersEnabled: true }))
      .toBe('trusted')
    expect(autoStructuresScope({ user: { role: 'admin' }, autoStructuresEnabled: true })).toBe('all')
  })

  it('LearnedDrawn is rendered by PatternOverlay alone (no client-side fallback source)', () => {
    const importers = []
    ;(function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(p); continue }
        if (!/\.(jsx?|tsx?)$/.test(ent.name) || /\.test\./.test(ent.name)) continue
        if (/from\s+['"][^'"]*\/LearnedDrawn['"]/.test(fs.readFileSync(p, 'utf8'))) {
          importers.push(path.relative(SRC_DIR, p).split(path.sep).join('/'))
        }
      }
    })(SRC_DIR)
    expect(importers).toEqual(['components/chart/PatternOverlay.jsx'])
  })
})
