// @vitest-environment jsdom
/* The object manager's vocabulary, DERIVED — plus the site rail that keeps
 * hiding from becoming deletion.
 *
 * ⛔ A RECOVERY SURFACE THAT OMITS A SHAPE IS WORSE THAN NONE. It teaches you to
 * trust a list that is lying, and the object you cannot find is the one you
 * needed the list for. So the names are derived from the toolbar's own roster
 * and this file fails BY NAME when a tool loses its name here — the same reason
 * `singleWriterIndex.test.js` derives its ledger instead of counting it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { TOOLS } from './ChartToolbar'
import { objectTypeName, objectSummary, visibleOnly, hiddenCount, fmtLevel } from './drawingObjects'

describe('every drawable shape can be NAMED in the manager', () => {
  const ids = TOOLS.filter((t) => t && t.id).map((t) => t.id)

  it('the roster is not empty — this rail cannot pass vacuously', () => {
    expect(ids.length).toBeGreaterThan(15)
  })

  it('names every tool the toolbar offers', () => {
    const unnamed = ids.filter((id) => !objectTypeName(id) || objectTypeName(id) === id)
    expect(unnamed, `tools with no manager name: ${unnamed.join(', ')}`).toEqual([])
  })

  it('carries no keyboard chord and no how-to-use instruction', () => {
    // "Trendline (Alt+T)" and "Cup Curve — click the left rim, …" are toolbar
    // tooltips. An object row is a NAME.
    for (const id of ids) {
      const n = objectTypeName(id)
      expect(n, `${id} kept a chord`).not.toMatch(/\(.*\)$/)
      expect(n, `${id} kept an instruction`).not.toContain('—')
      expect(n.length, `${id} name too long for a row: ${n}`).toBeLessThanOrEqual(28)
    }
  })

  it('names the shapes that have no toolbar button of their own', () => {
    expect(objectTypeName('ray')).toBe('Ray')
    expect(objectTypeName('fibext')).toBe('Fibonacci Extension')
  })

  it('never returns an empty name, even for something it has never heard of', () => {
    expect(objectTypeName('someNewShape')).toBeTruthy()
    expect(objectTypeName(undefined)).toBeTruthy()
  })
})

describe('a row says WHICH object it is', () => {
  it('a flat line is its level', () => {
    expect(objectSummary({ type: 'horizontal', points: [{ price: 114.26 }] })).toBe('114.26')
  })
  it('a sloped line is both ends', () => {
    expect(objectSummary({ type: 'trendline', points: [{ price: 100 }, { price: 110.5 }] })).toBe('100 → 110.5')
  })
  it('a note is its text, truncated', () => {
    const long = 'a'.repeat(60)
    expect(objectSummary({ type: 'text', text: long })).toHaveLength(28)
    expect(objectSummary({ type: 'text', text: 'earnings' })).toBe('earnings')
  })
  it('says nothing rather than something wrong when there is no level', () => {
    expect(objectSummary({ type: 'vertical', points: [{}] })).toBe('')
    expect(objectSummary(null)).toBe('')
  })
  it('fmtLevel trims to a tidy price', () => {
    expect(fmtLevel(114.26000)).toBe('114.26')
    expect(fmtLevel(1 / 3)).toBe('0.3333')
    expect(fmtLevel(null)).toBe('')
  })
})

describe('the visible set', () => {
  const set = [{ id: 'a' }, { id: 'b', hidden: true }, { id: 'c', hidden: false }]
  it('drops only what is hidden', () => {
    expect(visibleOnly(set).map((d) => d.id)).toEqual(['a', 'c'])
  })
  it('counts what is hidden, because the count is what the user is told', () => {
    expect(hiddenCount(set)).toBe(1)
    expect(hiddenCount([])).toBe(0)
  })
})

// ─── the site rail ──────────────────────────────────────────────────────────
describe('⛔ hiding must never become deleting', () => {
  /* THE TRAP, and it is one line wide. Filtering hidden objects out of the
   * overlay's `drawings` PROP would have been the obvious implementation and a
   * silent data loss: the paneRelY migration builds a WHOLE REPLACEMENT list
   * from `drawings` and hands it to `onMigrate`, so a filtered prop deletes
   * every hidden object the first time a chart migrates — with every test still
   * green, because nothing else in the suite ever looks at a hidden object
   * again. This derives the actual lists used at each site from the AST, so the
   * mistake cannot be made quietly.
   */
  const SRC = fs.readFileSync(path.join(__dirname, 'ChartDrawingOverlay.jsx'), 'utf8')
  const ast = Parser.extend(jsx()).parse(SRC, { ecmaVersion: 'latest', sourceType: 'module', locations: true })

  /** Every identifier named `drawings` or `visibleDrawings` that is READ, with its line. */
  const reads = []
  ;(function walk(node, parent) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'Identifier' && (node.name === 'drawings' || node.name === 'visibleDrawings')) {
      const isProperty = parent && parent.type === 'Property' && parent.key === node && !parent.computed
      const isMember = parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed
      if (!isProperty && !isMember) reads.push({ name: node.name, line: node.loc.start.line })
    }
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (Array.isArray(v)) v.forEach((c) => walk(c, node))
      else if (v && typeof v.type === 'string') walk(v, node)
    }
  })(ast, null)

  const nameAtLine = (needle) => {
    const line = SRC.split('\n').findIndex((l) => l.includes(needle)) + 1
    expect(line, `anchor not found in the shipped file: ${needle}`).toBeGreaterThan(0)
    const hit = reads.find((r) => r.line === line)
    expect(hit, `no drawings-list identifier on the line with: ${needle}`).toBeTruthy()
    return hit.name
  }

  it('the migration replacement list is built from the FULL set', () => {
    // If this ever reads `visibleDrawings`, hidden objects are destroyed on migrate.
    expect(nameAtLine('const next = drawings.map(d => {')).toBe('drawings')
  })

  it('the canvas paints only the VISIBLE set', () => {
    expect(nameAtLine('for (const d of visibleDrawings) {')).toBe('visibleDrawings')
  })

  it('hit-testing considers only the VISIBLE set — a hidden object steals no taps', () => {
    expect(nameAtLine('for (let i = visibleDrawings.length - 1; i >= 0; i--) {')).toBe('visibleDrawings')
  })

  it('CONTROL — the walker really can tell the two lists apart', () => {
    expect(new Set(reads.map((r) => r.name))).toEqual(new Set(['drawings', 'visibleDrawings']))
    expect(reads.filter((r) => r.name === 'visibleDrawings').length).toBeGreaterThan(2)
  })
})
