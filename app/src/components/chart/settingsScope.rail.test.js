// app/src/components/chart/settingsScope.rail.test.js
//
// ⛔⛔ AN EDIT IS SAVED WHERE THE CHART LIVES — owner ruling 2026-11-02 (policy A):
// "Changes to an individual chart should remain scoped to that chart unless the
// user explicitly requests a global change."
//
// THE DEFECT THIS RAIL EXISTS FOR. StockChart's `handleUpdateChartSettings`, given
// a `settingsOverride` and NO `onSettingsPersist`, restores only the override keys
// an edit left unchanged and writes the rest to the member's GLOBAL
// `chart_settings`. `indicatorInstances` is a new array after any add, hide or
// remove, so it is never "unchanged": one indicator added to one multi-chart grid
// cell appeared on every chart the member owns. The Watchlists table has the same
// shape one layer over: a hosted list mounted without a sink writes its ⚙ edits to
// the global `watchlist_settings`.
//
// TWO RULES, both DERIVED from the source by an acorn AST walk — never a typed list
// of hosts, which would agree with today's tree right up until the next host lands:
//
//   1. Every <StockChart>/<ChartPane> element that passes `settingsOverride` also
//      passes `onSettingsPersist` (allow-list below: genuinely read-only surfaces).
//   2. Every mount of a component that FORWARDS the Watchlists settings seam passes
//      `onSettingsPersist`. "Forwards" is derived: the ROOT is a function taking
//      `onSettingsPersist` that calls setPref('watchlist_settings', …) without it;
//      a forwarder is an exported function taking `onSettingsPersist` that renders
//      a root/forwarder with that attribute (to a fixpoint).

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`settingsScope.rail: could not find the repo root from ${process.cwd()}`)
})()
const SRC = path.join(ROOT, 'app', 'src')
const key = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}

// ⛔ RULE 1's ALLOW-LIST — read-only surfaces ONLY, each verified, each with why.
// A surface a person can click on is NOT read-only: StockChart's legend chips and
// right-click toggles write settings on any chart that has them. That is why the
// study exhibits (StudyGallery / StudyReview / DrillPlayer) are NOT here — they got
// a session-scoped sink (useSessionChartSettings) instead.
const READ_ONLY_OVERRIDE_HOSTS = {
  // The headless bot renderer behind /r/chart (Discord renders, golden captures):
  // a page a capture service screenshots, never one a member edits.
  'app/src/pages/ChartRender.jsx': 'headless bot renderer; no member interacts with it',
}

const CHART_HOSTS = new Set(['StockChart', 'ChartPane'])
const elName = (opening) => (opening.name?.type === 'JSXIdentifier' ? opening.name.name : null)
const attrNames = (opening) => new Set(opening.attributes
  .filter((a) => a.type === 'JSXAttribute' && a.name?.type === 'JSXIdentifier')
  .map((a) => a.name.name))

/** Rule 1 scan over ONE source text. Exported shape for the control below. */
function overrideWithoutSink(src) {
  const out = []
  walk(parse(src), (n) => {
    if (n.type !== 'JSXOpeningElement' || !CHART_HOSTS.has(elName(n))) return
    const a = attrNames(n)
    out.push({ name: elName(n), line: n.loc?.start?.line ?? null, override: a.has('settingsOverride'), sink: a.has('onSettingsPersist') })
  })
  return out
}

function shippedModules(dir = SRC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') shippedModules(p, acc) }
    else if (/\.(js|jsx)$/.test(e.name) && !/\.(test|spec)\.(js|jsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}

// Parse every shipped module ONCE. A file acorn cannot parse is reported by name
// rather than skipped silently — a rail that drops what it cannot read passes by
// reading nothing.
const FILES = shippedModules()
const AST = new Map()
const PARSE_FAILURES = []
for (const f of FILES) {
  const src = read(f)
  if (!/settingsOverride|onSettingsPersist|<|watchlist_settings/.test(src)) continue
  try {
    // parse once with locations so rule 1 can name the line
    AST.set(f, Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }))
  } catch (e) { PARSE_FAILURES.push(`${key(f)}: ${e.message}`) }
}

function rule1Findings() {
  const hosts = []
  for (const [f, ast] of AST) {
    walk(ast, (n) => {
      if (n.type !== 'JSXOpeningElement' || !CHART_HOSTS.has(elName(n))) return
      const a = attrNames(n)
      if (!a.has('settingsOverride')) return
      hosts.push({ file: key(f), line: n.loc.start.line, name: elName(n), sink: a.has('onSettingsPersist') })
    })
  }
  return hosts
}

// ── Rule 2 derivation ────────────────────────────────────────────────────────

/** Params of a function node destructure `onSettingsPersist`. */
const takesSink = (fn) => fn?.params?.some((p) => p.type === 'ObjectPattern'
  && p.properties.some((pr) => pr.type === 'Property' && pr.key?.name === 'onSettingsPersist'))

/** Exported functions of a module: [{ exportName, fn }]. */
function exportedFunctions(ast) {
  const out = []
  for (const st of ast.body) {
    if (st.type === 'ExportDefaultDeclaration' && /Function/.test(st.declaration.type)) out.push({ exportName: 'default', fn: st.declaration })
    if (st.type === 'ExportNamedDeclaration' && st.declaration?.type === 'FunctionDeclaration') out.push({ exportName: st.declaration.id.name, fn: st.declaration })
  }
  return out
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const c of [base, `${base}.jsx`, `${base}.js`, path.join(base, 'index.jsx'), path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/** Local JSX name → `${file}#${exportName}`, from static imports and `lazy(() => import())`. */
function localBindings(file, ast) {
  const m = new Map()
  for (const st of ast.body) {
    if (st.type !== 'ImportDeclaration') continue
    const target = resolveImport(file, st.source.value)
    if (!target) continue
    for (const s of st.specifiers) {
      if (s.type === 'ImportDefaultSpecifier') m.set(s.local.name, `${target}#default`)
      if (s.type === 'ImportSpecifier') m.set(s.local.name, `${target}#${s.imported.name}`)
    }
  }
  walk(ast, (n) => {
    if (n.type !== 'VariableDeclarator' || n.id?.type !== 'Identifier') return
    const init = n.init
    if (init?.type !== 'CallExpression' || init.callee?.name !== 'lazy') return
    let spec = null
    walk(init, (x) => { if (x.type === 'ImportExpression' && x.source?.type === 'Literal') spec = x.source.value })
    const target = spec && resolveImport(file, spec)
    if (target) m.set(n.id.name, `${target}#default`)
  })
  return m
}

function callsGlobalWatchlistWrite(fn) {
  let hit = false
  walk(fn.body, (n) => {
    if (n.type === 'CallExpression' && n.callee?.name === 'setPref'
      && n.arguments[0]?.type === 'Literal' && n.arguments[0].value === 'watchlist_settings') hit = true
  })
  return hit
}

function deriveSeamComponents() {
  const exported = []   // { id, file, fn }
  for (const [f, ast] of AST) for (const e of exportedFunctions(ast)) exported.push({ id: `${f}#${e.exportName}`, file: f, fn: e.fn })
  const seam = new Set(exported.filter((e) => takesSink(e.fn) && callsGlobalWatchlistWrite(e.fn)).map((e) => e.id))
  const roots = new Set(seam)
  for (let changed = true; changed;) {
    changed = false
    for (const e of exported) {
      if (seam.has(e.id) || !takesSink(e.fn)) continue
      const binds = localBindings(e.file, AST.get(e.file))
      let forwards = false
      walk(e.fn.body, (n) => {
        if (n.type !== 'JSXOpeningElement') return
        const target = binds.get(elName(n))
        if (target && seam.has(target) && attrNames(n).has('onSettingsPersist')) forwards = true
      })
      if (forwards) { seam.add(e.id); changed = true }
    }
  }
  return { roots, seam }
}

function rule2Findings(seam) {
  const mounts = []
  for (const [f, ast] of AST) {
    const binds = localBindings(f, ast)
    walk(ast, (n) => {
      if (n.type !== 'JSXOpeningElement') return
      const target = binds.get(elName(n))
      if (!target || !seam.has(target)) return
      mounts.push({ file: key(f), line: n.loc.start.line, name: elName(n), target: key(target.split('#')[0]), sink: attrNames(n).has('onSettingsPersist') })
    })
  }
  return mounts
}

describe('settings scope rail — an edit is saved where the chart lives (policy A)', () => {
  it('parses every candidate module (a file it cannot read would pass by being skipped)', () => {
    expect(PARSE_FAILURES).toEqual([])
    expect(AST.size).toBeGreaterThan(100)
  })

  describe('rule 1: settingsOverride on StockChart/ChartPane comes with onSettingsPersist', () => {
    const hosts = rule1Findings()

    it('CONTROL: the scanner finds known hosts, so an empty result cannot pass by seeing nothing', () => {
      const files = hosts.map((h) => h.file)
      expect(files).toContain('app/src/pages/charts/grid/GridChartCell.jsx')
      expect(files).toContain('app/src/components/chart/pane/ChartPane.jsx')
      expect(files).toContain('app/src/pages/ChartRender.jsx')
    })

    it('CONTROL: the check can fail — a host with an override and no sink is flagged', () => {
      const bad = overrideWithoutSink('const x = <StockChart sym="A" settingsOverride={o} />')
      expect(bad).toEqual([expect.objectContaining({ name: 'StockChart', override: true, sink: false })])
      const good = overrideWithoutSink('const x = <ChartPane settingsOverride={o} onSettingsPersist={p} />')
      expect(good[0]).toMatchObject({ override: true, sink: true })
    })

    it('every override host passes a sink, or is an allow-listed read-only surface', () => {
      const leaking = hosts
        .filter((h) => !h.sink && !READ_ONLY_OVERRIDE_HOSTS[h.file])
        .map((h) => `${h.file}:${h.line} <${h.name}> passes settingsOverride without onSettingsPersist`)
      expect(leaking).toEqual([])
    })

    it('the allow-list names only files that still need it (no stale exemptions)', () => {
      for (const f of Object.keys(READ_ONLY_OVERRIDE_HOSTS)) {
        expect(hosts.some((h) => h.file === f && !h.sink), `${f} no longer needs its exemption`).toBe(true)
      }
    })
  })

  describe('rule 2: every mount of a Watchlists settings forwarder passes onSettingsPersist', () => {
    const { roots, seam } = deriveSeamComponents()
    const mounts = rule2Findings(seam)

    it('CONTROL: the derivation finds the Watchlists root and the known forwarders', () => {
      const r = [...roots].map((id) => key(id.split('#')[0]))
      expect(r).toContain('app/src/pages/Watchlists.jsx')
      const s = [...seam].map((id) => key(id.split('#')[0]))
      expect(s).toContain('app/src/pages/charts/widgets/EtfHoldingsResults.jsx')
      expect(s).toContain('app/src/pages/charts/widgets/PeriodSortResults.jsx')
      expect(s).toContain('app/src/pages/charts/widgets/ScannerResults.jsx')
      // A picker takes the seam but never renders Watchlists: sink-less, it shows
      // no settings and writes nothing, so it is correctly NOT a forwarder.
      expect(s).not.toContain('app/src/pages/charts/widgets/WatchlistPicker.jsx')
    })

    it('CONTROL: the scan sees the two floating panels that used to mount without a sink', () => {
      const files = mounts.map((m) => m.file)
      expect(files).toContain('app/src/pages/charts/widgets/EtfHoldingsPanel.jsx')
      expect(files).toContain('app/src/pages/charts/PeriodSortPanel.jsx')
    })

    it('no forwarder is mounted without a sink (it would write the GLOBAL watchlist_settings)', () => {
      const leaking = mounts.filter((m) => !m.sink).map((m) => `${m.file}:${m.line} <${m.name}> (→ ${m.target}) has no onSettingsPersist`)
      expect(leaking).toEqual([])
    })
  })
})
