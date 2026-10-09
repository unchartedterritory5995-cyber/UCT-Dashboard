// UCT Terminal — THE COMPLETENESS RAIL: every function the registry declares meets the floor.
//
//     cd app && npx vitest run src/pages/terminal/completeness.rail.test.jsx --maxWorkers=1
//
// The audit of 2026-10-07 (docs/terminal-research/00-program-control/terminal-completeness-2026-10-07.md)
// checked every registry function against eight columns by hand. This rail keeps the columns a
// machine CAN keep, derived from the registry each run — a code added tomorrow is examined the day
// it lands, never typed into a list here:
//
//   (a) PARSE + HELP — every code parses in the form its variants take (`CODE`, `NVDA CODE`), the
//       echo describes it without an error, it has an argument shape, every argument kind it
//       declares accepts a sample token, and HELP prints it with its label.
//   (b) PANEL TEST — every module a `panel`/`surface` variant mounts is referenced by at least one
//       test file (static import, `vi.mock` or `import()`), and that test exercises a FAILED read
//       (a rejected fetch / non-2xx / thrown error) — so "a failed read is never drawn as empty
//       data" is pinned by a test, not by a reading of the code.
//   (c) PROVENANCE — every mounted module is in the population `panelProvenance.rail.test.js`
//       examines (PANEL_IMPORTERS ∪ the panel set's bound surfaces), so no function can reach a
//       panel that rail never looks at.
//
// ⛔ The two ledgers below are SHRINK-ONLY and say why. An entry FAILS by name the day it is no
// longer true (its gap closed — delete the line) or its module leaves the registry.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup } from '@testing-library/react'
import { FUNCTIONS } from './functions'
import parseCommand from './parseCommand'
import { describeCommand, argShape } from './grammar'
import { ARG_KINDS, applyArgs } from './args'
import { PANEL_IMPORTERS, panelNameFor } from './panels'
import { SURFACE_IMPORTERS, surfacePanel } from './surfacePanels'
import HelpPanel from './panels/HelpPanel'

const SRC = path.join(process.cwd(), 'src')
const TERMINAL = path.join(SRC, 'pages', 'terminal')
const EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs']
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/')

function resolve(from, specRaw) {
  const spec = String(specRaw).split('?')[0]
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(from), spec)
  for (const c of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, `index${e}`))]) {
    if (EXT.includes(path.extname(c)) && fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

/** `{ name: file }` for an importer object, read from its `() => import('…')` literal. */
function importerFiles(file, objectName, names) {
  const src = read(file)
  const out = {}
  for (const name of names) {
    const m = src.match(new RegExp(`\\b${name}:\\s*(?:named\\()?\\(\\)\\s*=>\\s*import\\('([^']+)'\\)`))
    out[name] = m ? resolve(file, m[1]) : null
  }
  return out
}
const PANEL_FILES = importerFiles(path.join(TERMINAL, 'panels.jsx'), 'PANEL_IMPORTERS', Object.keys(PANEL_IMPORTERS))
const SURFACE_FILES = importerFiles(path.join(TERMINAL, 'surfacePanels.js'), 'SURFACE_IMPORTERS', Object.keys(SURFACE_IMPORTERS))

/** Every (code, scope, variant, module) the registry mounts. Doors mount nothing. */
const MOUNTS = FUNCTIONS.flatMap((fn) => ['ticker', 'market'].flatMap((scope) => {
  const v = fn[scope]
  if (!v || v.door) return []
  const name = panelNameFor(v)
  const file = v.panel ? PANEL_FILES[v.panel] : SURFACE_FILES[surfacePanel(v.surface)?.element]
  return [{ code: fn.code, scope, variant: v, name, file }]
}))
const MODULES = [...new Set(MOUNTS.map((m) => m.file).filter(Boolean))]

function walkFiles(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') walkFiles(p, out) } else out.push(p)
  }
  return out
}
const TEST_FILES = walkFiles(SRC).filter((f) => /\.test\.(jsx?|tsx?)$/.test(f))
/** module -> the test files that name it (import / vi.mock / dynamic import / require). */
const TESTS_OF = new Map()
for (const t of TEST_FILES) {
  const src = read(t)
  // By name, too: `<Module>.test.jsx` / `<Module>.<topic>.test.jsx` beside the module tests it,
  // even when it renders the module through its host (the depth panels render through DepthTab).
  const stem = path.basename(t).split('.')[0]
  for (const e of EXT) {
    const sib = path.join(path.dirname(t), stem + e)
    if (fs.existsSync(sib)) {
      if (!TESTS_OF.has(sib)) TESTS_OF.set(sib, new Set())
      TESTS_OF.get(sib).add(t)
    }
  }
  for (const m of src.matchAll(/(?:from\s+|import\(\s*|vi\.mock\(\s*|require\(\s*)['"]([^'"]+)['"]/g)) {
    const r = resolve(t, m[1])
    if (!r) continue
    if (!TESTS_OF.has(r)) TESTS_OF.set(r, new Set())
    TESTS_OF.get(r).add(t)
  }
}
/** A test that makes a read FAIL: a rejected promise, a non-2xx answer, a thrown error. */
/** A hook mocked as failed (`error: true`, `error: {…}`, `error: 'x'`) counts: the tab's own
 *  error branch is what renders, and the hook's own test proves the non-2xx → error mapping. */
const FAILED_READ_RE = /mockRejected|Promise\.reject\(|\breject\(|ok:\s*false|status\s*[:=]\s*[45]\d\d|[[(]\s*[45]\d\d\s*[,)]|new Error\(|throw\s|[eE]rror\s*[:=]\s*(?:true\b|\{|['"`]|new\b)|\bisError:\s*true/

/**
 * ⛔ SHRINK-ONLY. Panel modules with NO test file at all. Empty since 2026-10-07 (the GP / RSCH /
 * DPTH adapters gained panels/adapterPanels.test.jsx). Keep it empty.
 */
const NO_PANEL_TEST = {}

/**
 * ⛔ SHRINK-ONLY. Panel modules whose tests never make a read fail. Each line starts with its kind:
 *   no-read:  the module performs no fetch of its own (an adapter, or shell-owned text)
 *   gap:      it fetches, and no test proves a failure is drawn as an error — close it
 */
const NO_FAILED_READ_TEST = {
  'pages/terminal/panels/HelpPanel.jsx': 'no-read: the function list and key help are registry text the shell owns',
  'pages/terminal/panels/ChartPanel.jsx': 'no-read: an adapter; StockChart owns the bar fetch (components/chart/**, another lane)',
  'pages/terminal/panels/MyResearchPanel.jsx': 'no-read: an adapter; TickerResearchWorkspace (journal-2-0, another lane) owns the fetch',
  'pages/terminal/panels/DepthPanel.jsx': 'no-read: an adapter; each depth panel it stacks owns (and tests) its own failure',
}
const NO_READ_KINDS = ['no-read:', 'gap:']

/** One token each ARG_KIND accepts — every kind must have one, so a new kind fails here first. */
const ARG_SAMPLE = {
  timeframe: 'W', calendarDay: 'TODAY', code: 'GP', symbol: 'AMD', lookback: '3M', cadence: 'D',
  moversLens: 'UP', contribWindow: '1W', themeName: 'SEMICONDUCTORS', alertPrice: '950', watchlistPick: '2', mine: 'MINE',
}

afterEach(cleanup)

describe('completeness rail — the registry is the population', () => {
  it('NON-VACUITY: the registry, the mounts and the test census are real', () => {
    expect(FUNCTIONS.length).toBeGreaterThan(60)
    expect(MOUNTS.length).toBeGreaterThan(50)
    for (const m of MOUNTS) expect(m.file, `${m.code} ${m.scope} (${m.name}) resolves to a module`).toBeTruthy()
    expect(TEST_FILES.length).toBeGreaterThan(500)
    // The census can SEE a known reference: MoversPanel.test.jsx imports MoversPanel.
    const movers = PANEL_FILES.Movers
    expect([...(TESTS_OF.get(movers) || [])].map(rel)).toContain('pages/terminal/panels/MoversPanel.test.jsx')
    // …and the failed-read detector can tell a failing test from a happy one.
    expect(FAILED_READ_RE.test("fetch.mockRejectedValueOnce(new Error('down'))")).toBe(true)
    expect(FAILED_READ_RE.test('fetch.mockResolvedValue({ ok: true, json: () => ({}) })')).toBe(false)
  })
})

describe('(a) every code parses, echoes, and is listed in HELP', () => {
  for (const fn of FUNCTIONS) {
    it(`${fn.code} parses in every form its variants take`, () => {
      expect(argShape(fn.code), `${fn.code} has an argument shape`).toBeTruthy()
      const forms = [fn.ticker && `NVDA ${fn.code}`, fn.market && fn.code].filter(Boolean)
      for (const line of forms) {
        const cmd = parseCommand(line)
        expect(cmd.ok, `${line}: ${cmd.error}`).toBe(true)
        expect(cmd.type).toBe('function')
        expect(cmd.code).toBe(fn.code)
        if (line.startsWith('NVDA ')) expect(cmd.sym).toBe('NVDA')
        const echo = describeCommand(cmd)
        expect(echo?.text, `${line} echoes something`).toBeTruthy()
        expect(echo.tone, `${line}: ${echo.text}`).not.toBe('error')
      }
    })
  }

  it('every argument kind has a sample, and every declared argument accepts it', () => {
    expect(Object.keys(ARG_SAMPLE).sort()).toEqual(Object.keys(ARG_KINDS).sort())
    for (const fn of FUNCTIONS) {
      for (const scope of ['ticker', 'market']) {
        const v = fn[scope]
        for (const kind of new Set((v?.args || []).map((a) => a.kind))) {
          const out = applyArgs(v, [ARG_SAMPLE[kind]])
          expect(out.ignored, `${fn.code} ${scope} ignores its own ${kind} argument "${ARG_SAMPLE[kind]}"`).toEqual([])
          expect(out.applied.length, `${fn.code} ${scope} applies ${kind}`).toBe(1)
        }
      }
    }
  })

  it('HELP lists every registered code with its label', () => {
    render(<HelpPanel auth={{}} />)
    const help = screen.getByTestId('terminal-help')
    for (const fn of FUNCTIONS) {
      expect(help.textContent, `HELP is missing ${fn.code}`).toContain(fn.code)
      expect(help.textContent, `HELP is missing the label of ${fn.code}`).toContain(fn.label)
    }
  })
})

describe('(b) every mounted panel has a test, and the test makes a read fail', () => {
  it('⭐ every panel module is named by at least one test file', () => {
    const missing = MODULES.filter((f) => !TESTS_OF.has(f) && !NO_PANEL_TEST[rel(f)])
      .map((f) => `${rel(f)} (${MOUNTS.filter((m) => m.file === f).map((m) => m.code).join(', ')}) has no test file`)
    expect(missing).toEqual([])
  })

  it('⭐ every panel module that reads data has a test that makes the read fail', () => {
    const missing = []
    for (const f of MODULES) {
      if (NO_FAILED_READ_TEST[rel(f)]) continue
      const tests = [...(TESTS_OF.get(f) || [])]
      if (!tests.some((t) => FAILED_READ_RE.test(read(t)))) {
        missing.push(`${rel(f)} (${MOUNTS.filter((m) => m.file === f).map((m) => m.code).join(', ')}): `
          + `no test makes its read fail — add one that rejects / answers non-2xx and asserts an error with a retry, never empty data`)
      }
    }
    expect(missing).toEqual([])
  })

  it('both ledgers are shrink-only: every entry is a mounted module, still true, and says why', () => {
    const mods = new Set(MODULES.map(rel))
    for (const [file] of Object.entries(NO_PANEL_TEST)) {
      expect(mods.has(file), `${file} is no longer mounted — delete its NO_PANEL_TEST line`).toBe(true)
      const abs = path.join(SRC, file)
      expect(TESTS_OF.has(abs), `${file} now has a test — delete its NO_PANEL_TEST line`).toBe(false)
    }
    for (const [file, why] of Object.entries(NO_FAILED_READ_TEST)) {
      expect(mods.has(file), `${file} is no longer mounted — delete its NO_FAILED_READ_TEST line`).toBe(true)
      expect(NO_READ_KINDS.some((k) => why.startsWith(k)), `${file}: reason must start with a kind`).toBe(true)
      // A `no-read:` module can be named by a shell test that fails some OTHER read; only a `gap:`
      // line is closed by a failed-read test appearing.
      if (!why.startsWith('gap:')) continue
      const tests = [...(TESTS_OF.get(path.join(SRC, file)) || [])]
      expect(tests.some((t) => FAILED_READ_RE.test(read(t))), `${file} now has a failed-read test — delete its line`).toBe(false)
    }
  })
})

describe('(c) every mounted panel is in the provenance rail\'s population', () => {
  it('every panel/surface a code mounts is an importer panelProvenance.rail.test.js examines', () => {
    const population = new Set([...Object.values(PANEL_FILES), ...Object.values(SURFACE_FILES)].filter(Boolean))
    const outside = MOUNTS.filter((m) => !population.has(m.file)).map((m) => `${m.code} ${m.scope} -> ${m.name}`)
    expect(outside).toEqual([])
  })
})
