// app/src/pages/terminal/panelProvenance.rail.test.js
//
// ─── TERM-019 (FB-S8-01) — EVERY TERMINAL PANEL SAYS WHERE ITS NUMBERS CAME FROM ─────────────
//
//     cd app && npx vitest run src/pages/terminal/panelProvenance.rail.test.js
//
// The backlog asks for one rail: "a panel that renders a value and imports none of the four
// primitives fails BY NAME, with a non-vacuity control (a fixture panel that must fail)", that
// prints its denominator, and that proves by an import census no second implementation of the
// four exists.
//
// ── WHY THE POPULATION IS THE TERMINAL'S PANELS, NOT ALL OF app/src ──────────────────────────
//
// `components/provenance/panelAdoption.ratchet.test.js` already explains why that assertion over
// all of app/src (771 modules, 8 adopters) would be red on arrival and is a ratchet instead. The
// terminal is the one place a PANEL is a declared thing: `PANEL_IMPORTERS` (panels.jsx) and
// `SURFACE_IMPORTERS` (surfacePanels.js) name every module the shell can mount, so the population
// is DERIVED from those two objects by AST — never a typed list — and a panel added to either is
// examined the day it lands. This rail and the ratchet do not overlap: the ratchet says adoption
// may not go backwards anywhere; this says every terminal panel adopts, now.
//
// ── WHAT "ADOPTS" MEANS HERE ─────────────────────────────────────────────────────────────────
//
// A panel adopts when its STATIC import closure (inside app/src) either
//   (body)   imports one of S8's four primitives — Provenance · FreshnessBadge · CoverageLine ·
//            Cited — or a re-export shim of one, or
//   (header) calls `usePanelFreshness(...)`, which hands the panel's `{ source, age }` report to
//            its own header, where `PanelProvenance` (TerminalShell.jsx) renders it with
//            `<Provenance>` and `<FreshnessBadge>` and nothing of its own.
// The WITNESS — the import chain that proves it — is printed for every panel, so a long or
// surprising chain is visible in the run rather than trusted.
//
// ⛔ Dynamic `import()` is NOT followed: a lazily-loaded popup or route reaches half the app (the
//    chart builder's EvidenceTab carries a CoverageLine), and following it made every panel that
//    can open a ticker popup "adopt" through a chart it does not render.
// ⛔ The shell itself is never traversed: it renders the header for EVERY panel, so reaching it
//    would make adoption trivially true.
//
// ── EXEMPTIONS ARE SHRINK-ONLY AND SAY WHY ──────────────────────────────────────────────────
//
// `EXEMPT` names the panels that show no sourced number (or whose number this lane cannot reach),
// each with ONE line starting with its kind. An entry FAILS by name the day its panel adopts (the
// gap closed — delete the line) or leaves the population. Nothing ever adds one automatically.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { PANEL_IMPORTERS } from './panels'
import { SURFACE_IMPORTERS } from './surfacePanels'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`panelProvenance.rail: could not find the repo root from ${process.cwd()}`)
})()

const SRC = path.join(ROOT, 'app', 'src')
const TERMINAL = path.join(SRC, 'pages', 'terminal')
const PROV_DIR = path.join(SRC, 'components', 'provenance')
const SHELL = path.join(TERMINAL, 'TerminalShell.jsx')
const FIXTURES = path.join(TERMINAL, '__fixtures__', 'provenance')
const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

/** ⚠️ CRLF normalised at the door — `core.autocrlf` is on in this checkout. */
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const key = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}

function resolve(fromFile, specRaw) {
  const spec = String(specRaw).split('?')[0]
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [base, ...CODE_EXT.map((e) => base + e), ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (CODE_EXT.includes(path.extname(c)) && fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/** The four primitives, as files, read off the names the backlog item fixes. */
const PRIMITIVES = ['Provenance', 'FreshnessBadge', 'CoverageLine', 'Cited']
const PRIMITIVE_FILES = PRIMITIVES.map((n) => path.join(PROV_DIR, `${n}.jsx`))

const _info = new Map()
/**
 * One module's static edges and whether it calls `usePanelFreshness`. `src` may be passed so a
 * control can sever an edge IN MEMORY without touching the working tree.
 */
function moduleInfo(file, src = null) {
  if (src == null && _info.has(file)) return _info.get(file)
  const ast = parse(src == null ? read(file) : src)
  const edges = []
  let reports = false
  let quiets = false
  walk(ast, (n) => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration')
      && n.source && typeof n.source.value === 'string') {
      const r = resolve(file, n.source.value)
      if (r) edges.push(r)
    }
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'usePanelFreshness') {
      reports = true
    }
    if (n.type === 'JSXOpeningElement' && n.name?.type === 'JSXIdentifier' && n.name.name === 'QuietPanelFreshness') {
      quiets = true
    }
  })
  const out = { edges: [...new Set(edges)], reports, quiets }
  if (src == null) _info.set(file, out)
  return out
}

/** A re-export shim: every top-level statement re-exports, every edge lands on a primitive. */
function isReExportAlias(file) {
  let body
  try { body = parse(read(file)).body } catch { return false }
  if (!body.length) return false
  if (!body.every((n) => (n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source)) return false
  const { edges } = moduleInfo(file)
  return edges.length > 0 && edges.every((t) => PRIMITIVE_FILES.includes(t))
}

const _alias = new Map()
const isPrimitive = (file) => {
  if (PRIMITIVE_FILES.includes(file)) return true
  if (!_alias.has(file)) _alias.set(file, isReExportAlias(file))
  return _alias.get(file)
}

/**
 * The adoption witness for one panel module: `{ kind, chain }` or `null`.
 * Breadth-first, so the witness printed is the SHORTEST proof.
 *
 * ⛔ A header report reached THROUGH a module that renders `<QuietPanelFreshness>` does not count:
 * that wrapper exists precisely so an embedded panel (the IV history inside the options chain, the
 * Filings tab inside the earnings modal) does NOT speak for the panel around it. Counting it would
 * credit the calendar with a source line the calendar never shows. A body primitive still counts —
 * it is on screen whatever the header says.
 */
export function adoptionWitness(file, overrides = new Map()) {
  const info = (f) => moduleInfo(f, overrides.has(f) ? overrides.get(f) : null)
  const prev = new Map([[file, null]])
  const quiet = new Map([[file, false]])
  const queue = [file]
  const chainTo = (f) => { const out = []; for (let c = f; c; c = prev.get(c)) out.unshift(key(c)); return out }
  while (queue.length) {
    const cur = queue.shift()
    const { edges, reports, quiets } = info(cur)
    if (reports && !quiet.get(cur)) return { kind: 'header', chain: chainTo(cur) }
    for (const t of edges) {
      if (isPrimitive(t)) return { kind: 'body', chain: [...chainTo(cur), key(t)] }
      if (t === SHELL || prev.has(t)) continue
      prev.set(t, cur)
      quiet.set(t, quiet.get(cur) || quiets)
      queue.push(t)
    }
  }
  return null
}

// ── THE POPULATION, DERIVED ──────────────────────────────────────────────────────────────────

/** `{ name, file }` for every entry of the named object, read off the AST of `registryFile`. */
function registryEntries(registryFile, objectName) {
  const out = []
  walk(parse(read(registryFile)), (n) => {
    if (n.type !== 'VariableDeclarator' || n.id?.name !== objectName || n.init?.type !== 'ObjectExpression') return
    for (const p of n.init.properties) {
      if (p.type !== 'Property') continue
      const name = p.key?.name ?? p.key?.value
      let spec = null
      walk(p.value, (m) => {
        if (!spec && m.type === 'ImportExpression' && m.source?.type === 'Literal') spec = m.source.value
      })
      out.push({ name, file: spec ? resolve(registryFile, spec) : null })
    }
  })
  return out
}

const PANELS = [
  ...registryEntries(path.join(TERMINAL, 'panels.jsx'), 'PANEL_IMPORTERS'),
  ...registryEntries(path.join(TERMINAL, 'surfacePanels.js'), 'SURFACE_IMPORTERS'),
]

/**
 * ⛔ SHRINK-ONLY, HAND-EDITED. Each value is ONE line starting with its kind:
 *   no-sourced-value:  the panel shows no number that came from a data source
 *   blocked:           it does, but the module that holds the number is outside this lane
 */
export const EXEMPT = {
  'app/src/pages/terminal/panels/HelpPanel.jsx':
    'no-sourced-value: the function list, key bindings and board help — text the terminal itself owns',
  'app/src/pages/terminal/panels/MyResearchPanel.jsx':
    "no-sourced-value: the member's own research notes (the Notebook workspace); nothing in it is market data",
  'app/src/pages/terminal/panels/ChartPanel.jsx':
    'blocked: the bars and their last-bar time live inside StockChart / components/chart/**, which this lane may not edit; the chart draws its own time axis, so the adapter cannot honestly report an as-of it never sees',
}
const EXEMPT_KINDS = ['no-sourced-value:', 'blocked:']

/** The verdict over a population: who adopts (and how), who is exempt, who fails. */
export function railVerdict(population, overrides = new Map()) {
  const adopting = []
  const exempt = []
  const failing = []
  for (const p of population) {
    const k = key(p.file)
    const w = adoptionWitness(p.file, overrides)
    if (w) adopting.push({ ...p, key: k, witness: w })
    else if (EXEMPT[k]) exempt.push({ ...p, key: k })
    else failing.push({ ...p, key: k })
  }
  return { adopting, exempt, failing }
}

const VERDICT = railVerdict(PANELS)

describe('TERM-019 — every terminal panel says where its numbers came from', () => {
  it('the population is derived from the two registries and matches them exactly', () => {
    const declared = Object.keys(PANEL_IMPORTERS).length + Object.keys(SURFACE_IMPORTERS).length
    expect(PANELS.length, 'every registry entry was read off the AST').toBe(declared)
    for (const p of PANELS) expect(p.file, `${p.name} resolves to a real module`).toBeTruthy()
    // Two names can share a module (none do today); the population is per entry, not per file.
    expect(new Set(PANELS.map((p) => p.name)).size).toBe(PANELS.length)
  })

  it('NON-VACUITY: the detector sees a real graph and tells the two fixtures apart', () => {
    // A known body adopter and a known header adopter, by name.
    const news = PANELS.find((p) => p.name === 'News')
    expect(adoptionWitness(news.file)?.kind).toBe('body')
    const move = PANELS.find((p) => p.name === 'Move')
    expect(adoptionWitness(move.file)?.kind).toBe('header')
    // ⛔ The fixture that renders a value and names no source MUST fail — it imports the modules
    // nearly every panel imports, so a shared module that started "adopting" for everyone would
    // turn it green here first.
    const unsourced = path.join(FIXTURES, 'UnsourcedPanel.jsx')
    expect(moduleInfo(unsourced).edges.length).toBeGreaterThan(3)
    expect(adoptionWitness(unsourced)).toBeNull()
    const withFixture = railVerdict([...PANELS, { name: 'FIXTURE', file: unsourced }])
    expect(withFixture.failing.map((f) => f.name)).toContain('FIXTURE')
    // …and the same panel plus one usePanelFreshness call passes.
    expect(adoptionWitness(path.join(FIXTURES, 'SourcedPanel.jsx'))?.kind).toBe('header')
  })

  it('CONTROL: a header report reached through <QuietPanelFreshness> does not count', () => {
    // The fixture, rewritten in memory to embed a real header-reporting tab (FilingsTab). Loud, it
    // adopts through the tab; wrapped quiet — as the earnings modal and the options chain wrap
    // theirs — it does not, because the tab no longer speaks for the panel around it.
    const host = path.join(FIXTURES, 'UnsourcedPanel.jsx')
    const embed = (quiet) => [
      "import FilingsTab from '../../../research/tabs/FilingsTab'",
      "import { QuietPanelFreshness } from '../../../../components/terminal'",
      quiet
        ? 'export default function Host({ sym }) { return <QuietPanelFreshness><FilingsTab sym={sym} /></QuietPanelFreshness> }'
        : 'export default function Host({ sym }) { return <FilingsTab sym={sym} /> }',
      '',
    ].join('\n')
    expect(adoptionWitness(host, new Map([[host, embed(false)]]))?.kind).toBe('header')
    expect(adoptionWitness(host, new Map([[host, embed(true)]]))).toBeNull()
  })

  it('MUTATION, PERMANENT: severing a real adopter in memory makes the rail name it', () => {
    const fsPanel = PANELS.find((p) => p.name === 'Ftd')
    const src = read(fsPanel.file)
    expect(src).toContain('usePanelFreshness(')
    const severed = src.replace(/usePanelFreshness\(/g, 'noLongerReports(')
    const v = railVerdict([fsPanel], new Map([[fsPanel.file, severed]]))
    expect(v.failing.map((f) => f.name)).toEqual(['Ftd'])
  })

  it('⭐ EVERY terminal panel adopts the provenance set or carries a stated exemption', () => {
    const { adopting, exempt, failing } = VERDICT
    const header = adopting.filter((a) => a.witness.kind === 'header').length
    // eslint-disable-next-line no-console
    console.log(`[term-019 rail] examined ${PANELS.length} terminal panels · adopting ${adopting.length} `
      + `(header ${header} · body ${adopting.length - header}) · exempt ${exempt.length} · failing ${failing.length}`)
    for (const a of adopting) {
      // eslint-disable-next-line no-console
      console.log(`  ${a.name.padEnd(18)} ${a.witness.kind.padEnd(6)} ${a.witness.chain.join(' -> ')}`)
    }
    expect(failing.map((f) => `${f.name} (${f.key}) renders without naming a source — report one through `
      + 'usePanelFreshness({ source, age }) or render a provenance primitive, or add a reasoned EXEMPT line'))
      .toEqual([])
  })

  it('EXEMPT is shrink-only: every entry is in the population, still non-adopting, and says why', () => {
    const keys = new Set(PANELS.map((p) => key(p.file)))
    for (const [file, why] of Object.entries(EXEMPT)) {
      expect(keys.has(file), `${file} is no longer a terminal panel — delete its EXEMPT line`).toBe(true)
      expect(EXEMPT_KINDS.some((k) => why.startsWith(k)), `${file}: reason must start with a kind`).toBe(true)
      expect(why.split('\n').length).toBe(1)
      const p = PANELS.find((x) => key(x.file) === file)
      expect(adoptionWitness(p.file), `${file} now adopts — delete its EXEMPT line`).toBeNull()
    }
  })
})

// ── (c) NO SECOND IMPLEMENTATION OF ANY OF THE FOUR — AN IMPORT CENSUS ───────────────────────

/** Tracked, non-test source modules under app/src. ⛔ Asked of git, never guessed. */
function trackedSources() {
  const out = execFileSync('git', ['ls-files', '--', 'app/src'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((p) => CODE_EXT.includes(path.extname(p)) && !/\.(test|spec)\./.test(p) && !/__(fixtures|mocks|tests)__/.test(p))
    .map((p) => path.join(ROOT, p))
}

/** Top-level declarations in `src` that DEFINE one of the four names. */
export function definesPrimitive(src) {
  const hits = []
  let ast
  try { ast = parse(src) } catch { return hits }
  for (const n of ast.body) {
    const decl = n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration' ? n.declaration : n
    if (!decl) continue
    if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && PRIMITIVES.includes(decl.id?.name)) hits.push(decl.id.name)
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) if (PRIMITIVES.includes(d.id?.name)) hits.push(d.id.name)
    }
  }
  return hits
}

describe('TERM-019 (c) — no second implementation of any of the four primitives', () => {
  const files = trackedSources()
  const NAME_RE = new RegExp(`\\b(${PRIMITIVES.join('|')})\\b`)

  it('the census reads a real tree (non-vacuity)', () => {
    expect(files.length).toBeGreaterThan(500)
    for (const f of PRIMITIVE_FILES) expect(files).toContain(f)
    // The detector can SEE a definition: each real primitive defines its own name.
    for (const [i, f] of PRIMITIVE_FILES.entries()) expect(definesPrimitive(read(f))).toContain(PRIMITIVES[i])
    expect(definesPrimitive('const Cited = () => null\nexport default Cited\n')).toEqual(['Cited'])
    expect(definesPrimitive('import Cited from "./x"\nexport default function Panel() { return null }\n')).toEqual([])
  })

  it('⭐ only components/provenance/ defines Provenance, FreshnessBadge, CoverageLine or Cited', () => {
    const second = []
    let examined = 0
    for (const f of files) {
      if (f.startsWith(PROV_DIR + path.sep)) continue
      const src = read(f)
      if (!NAME_RE.test(src)) continue
      examined += 1
      for (const name of definesPrimitive(src)) second.push(`${key(f)} defines its own ${name}`)
      const base = path.basename(f, path.extname(f))
      if (PRIMITIVES.includes(base) && !isReExportAlias(f)) second.push(`${key(f)} is named ${base} and is not a re-export of S8's`)
    }
    // eslint-disable-next-line no-console
    console.log(`[term-019 census] ${files.length} tracked modules · ${examined} mention a primitive by name · ${second.length} second implementations`)
    expect(examined).toBeGreaterThan(5)
    expect(second).toEqual([])
  })
})
