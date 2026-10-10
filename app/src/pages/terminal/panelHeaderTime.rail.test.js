// app/src/pages/terminal/panelHeaderTime.rail.test.js
//
// A terminal panel that KNOWS when its data was read must say so in its header.
//
// Seen live 2026-10-09: SCAT's header printed "UNKNOWN as of 8:54 PM ET", and REGM, RSL, CHK,
// ETF, GRADE, PEER, PLAN, SIZE and TWT printed "undated", although every one of them had a read
// time in hand. The cause was the report's shape, not the data: a bare `{ source, asOf }` with no
// freshness class makes FreshnessBadge print UNKNOWN, and `{ source }` / `{ source, observedAt }`
// carry no age, so the header reads "undated". `panelAsOf(source, at)` turns a time into the age
// clause (components/terminal/terminalPanel.js).
//
// The rule, read from the AST of every panels/*.jsx file: an object literal passed to
// `usePanelFreshness` must carry `age`, `freshnessClass` or `fields`. A panel with a time uses
// panelAsOf (or a shared helper that does); a panel with truly no time can still report its
// source through panelAsOf(source, null), which says "undated" on purpose.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const PANELS_DIR = path.resolve(__dirname, 'panels')
const DATED_KEYS = new Set(['age', 'freshnessClass', 'fields'])

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit))
    else if (v && typeof v.type === 'string') walk(v, visit)
  }
}

/** Object literals reachable inside the first argument of a usePanelFreshness(...) call. */
export function undatedReports(source) {
  const ast = JsxParser.parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const bad = []
  walk(ast, (n) => {
    if (n.type !== 'CallExpression' || n.callee?.name !== 'usePanelFreshness' || !n.arguments[0]) return
    walk(n.arguments[0], (m) => {
      if (m.type !== 'ObjectExpression') return
      const keys = m.properties.map((p) => p.key?.name ?? p.key?.value).filter(Boolean)
      if (!keys.includes('source') && !keys.includes('observedAt') && !keys.includes('asOf')) return
      if (keys.some((k) => DATED_KEYS.has(k))) return
      bad.push(`line ${m.loc ? m.loc.start.line : '?'}: { ${keys.join(', ')} }`)
    })
  })
  return bad
}

const files = fs.readdirSync(PANELS_DIR).filter((f) => f.endsWith('.jsx') && !f.includes('.test.'))

describe('terminal panel headers carry a time when the panel has one', () => {
  it('reads every panel file (non-vacuous)', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain('ScatterPanel.jsx')
  })

  it('no panel reports a bare source / observedAt / asOf object to the header', () => {
    const offenders = files.flatMap((f) => undatedReports(fs.readFileSync(path.join(PANELS_DIR, f), 'utf8'))
      .map((b) => `${f} ${b}`))
    expect(offenders).toEqual([])
  })

  it('CONTROL: the check sees the three shapes that printed UNKNOWN or undated', () => {
    const shapes = [
      "usePanelFreshness(x ? { source: 'S', asOf: t } : null)",
      "usePanelFreshness({ source: 'S' })",
      "usePanelFreshness(ok ? { source: 'S', observedAt: t } : null)",
    ]
    for (const s of shapes) expect(undatedReports(s)).toHaveLength(1)
    expect(undatedReports("usePanelFreshness(ok ? panelAsOf('S', t) : null)")).toEqual([])
    expect(undatedReports("usePanelFreshness({ source: 'S', asOf: t, freshnessClass: 'real_time' })")).toEqual([])
  })
})
