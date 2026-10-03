// UCT Terminal — EVERY REGISTRY FUNCTION RESOLVES TO A REAL SURFACE. Derived, never typed:
//   panel   -> IMPORTED: the module loads and default-exports a component;
//   door    -> AST: a `<Route path>` literal in App.jsx;
//   section -> AST: a key of ResearchPage.jsx's SECTION_TO_TAB (the "Full page" link lands);
//   flag    -> AST: a key AuthContext.Provider's `value` actually provides.
// Plus the pins that keep this shell's copies of other modules' vocabulary honest.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'
import { FUNCTIONS, BY_CODE, ABSENT, suggest, fillDoor } from './functions'
import { PANEL_IMPORTERS } from './panels'
import { LINK_GROUPS, GROUP_DOT } from './useTerminalLayout'
import { TERMINAL_NEXT_COHORT } from './terminalGate'

const SRC = path.join(process.cwd(), 'src')
const REPO = path.resolve(process.cwd(), '..')
const Parser = acorn.Parser.extend(jsx())
const parse = (file) => Parser.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })

function walk(n, visit) {
  if (!n || typeof n !== 'object') return
  visit(n)
  for (const k of Object.keys(n)) {
    const c = n[k]
    if (Array.isArray(c)) c.forEach((x) => walk(x, visit))
    else if (c && typeof c === 'object' && k !== 'parent') walk(c, visit)
  }
}

function appRoutes() {
  const out = new Set()
  walk(parse(path.join(SRC, 'App.jsx')), (n) => {
    if (n.type === 'JSXElement' && n.openingElement?.name?.name === 'Route') {
      const a = n.openingElement.attributes.find((x) => x.name?.name === 'path')
      if (a?.value?.type === 'Literal') out.add(a.value.value)
    }
  })
  return out
}

function sectionKeys() {
  const out = new Set()
  walk(parse(path.join(SRC, 'pages/research/ResearchPage.jsx')), (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'SECTION_TO_TAB' && n.init?.type === 'ObjectExpression') {
      for (const p of n.init.properties) out.add(p.key.type === 'Literal' ? p.key.value : p.key.name)
    }
  })
  return out
}

function authProvides() {
  const out = new Set()
  walk(parse(path.join(SRC, 'context/AuthContext.jsx')), (n) => {
    if (n.type === 'JSXElement' && n.openingElement?.name?.type === 'JSXMemberExpression'
      && n.openingElement.name.object.name === 'AuthContext') {
      const v = n.openingElement.attributes.find((x) => x.name?.name === 'value')
      for (const p of v?.value?.expression?.properties || []) out.add(p.key.name)
    }
  })
  return out
}

/** The App.jsx route a door lands on: literal match, or `{x}` placeholders against `:x` params. */
function doorRoute(door, routes) {
  const segs = door.split('?')[0].split('/')
  for (const r of routes) {
    const rs = r.split('/')
    if (rs.length !== segs.length) continue
    if (rs.every((seg, i) => seg === segs[i] || (seg.startsWith(':') && /^\{[^}]+\}$/.test(segs[i])))) return r
  }
  return null
}

/** Routes nested under <Route element={<Layout/>}> — the member-facing pages. */
function layoutRoutes() {
  const out = new Set()
  walk(parse(path.join(SRC, 'App.jsx')), (n) => {
    if (n.type === 'JSXElement' && n.openingElement?.name?.name === 'Route') {
      const el = n.openingElement.attributes.find((x) => x.name?.name === 'element')
      if (el?.value?.expression?.openingElement?.name?.name === 'Layout') {
        for (const c of n.children || []) {
          if (c.type !== 'JSXElement') continue
          const p = c.openingElement.attributes.find((x) => x.name?.name === 'path')
          if (p?.value?.type === 'Literal') out.add(p.value.value)
        }
      }
    }
  })
  return out
}

const variants = FUNCTIONS.flatMap((f) => [['ticker', f.ticker], ['market', f.market]]
  .filter(([, v]) => v).map(([scope, v]) => ({ code: f.code, scope, v })))

describe('every registry function resolves to a real surface', () => {
  const routes = appRoutes()
  const sections = sectionKeys()
  const provides = authProvides()

  it('non-vacuity: the derivations found what they must', () => {
    expect(routes.has('/calendar')).toBe(true)
    expect(routes.has('/terminal')).toBe(true)
    expect(sections.has('filing-changes')).toBe(true)
    expect(provides.has('optionsChainEnabled')).toBe(true)
    expect(variants.length).toBeGreaterThan(25)
  })

  it('every variant is EITHER a panel or a door, never both, never neither', () => {
    for (const { code, scope, v } of variants) {
      expect(!!v.panel !== !!v.door, `${code}/${scope}`).toBe(true)
    }
  })

  it.each(variants.filter((x) => x.v.door).map((x) => [x.code, x.scope, x.v.door]))(
    '%s (%s) door %s is a route App.jsx registers', (code, scope, door) => {
      expect(doorRoute(door, appRoutes()), door).toBeTruthy()
      // A market door has no security to fill; only a ticker door may say {sym}.
      if (scope === 'market') expect(door).not.toMatch(/\{sym\}/)
    })

  it.each(variants.filter((x) => x.v.door && /[?&]view=/.test(x.v.door)).map((x) => [x.code, x.v.door]))(
    '%s door %s names a view App.jsx actually honours', (code, door) => {
      const view = new URLSearchParams(door.split('?')[1].replace(/\{[^}]+\}/g, 'X')).get('view')
      const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
      expect(app).toContain(`get('view') === '${view}'`)
    })

  it('fillDoor fills {sym}/{argN} encoded, and refuses a missing value instead of a broken URL', () => {
    expect(fillDoor('/options-flow?view=gex&ticker={sym}', { sym: 'nvda' })).toBe('/options-flow?view=gex&ticker=NVDA')
    expect(fillDoor('/research/{sym}/compare/{arg0}', { sym: 'NVDA', args: ['amd'] })).toBe('/research/NVDA/compare/AMD')
    expect(fillDoor('/research/{sym}/compare/{arg0}', { sym: 'NVDA', args: [] })).toBeNull()
    expect(fillDoor('/breadth')).toBe('/breadth')
  })

  it('every App.jsx member route is reachable from SOME registry function (or is declared not to be)', () => {
    // "Every capability already built is reachable from the shell" (owner ruling 1), DERIVED:
    // each top-level route under <Layout> must be a door/panel target, or be named below.
    const NOT_A_FUNCTION = new Set([
      '/terminal', '/terminal/calendar', '/calendar',          // the shell itself, and its CAL panel
      '/settings', '/support', '/admin',                        // account chrome, not market functions
      '/theme-tracker', '/watchlists', '/multi-chart',          // LegacyRedirect into /charts
      '/live-flow', '/educational-videos',                      // <Navigate> redirects
      '/open-flow', '/traders', '/provenance-demo',             // unlisted / demo pages
      '/journal-2-0/report',                                    // a journal detail page
    ])
    const doors = new Set(variants.filter((x) => x.v.door).map((x) => doorRoute(x.v.door, appRoutes())))
    const memberTop = [...appRoutes()].filter((r) => r.startsWith('/') && !r.includes(':')
      && !r.startsWith('/r/') && !r.startsWith('/admin/') && layoutRoutes().has(r))
    expect(memberTop.length).toBeGreaterThan(20)   // non-vacuity: the derivation found the pages
    const unreached = memberTop.filter((r) => !doors.has(r) && !NOT_A_FUNCTION.has(r))
    expect(unreached.sort()).toEqual([])
  })

  it.each(variants.filter((x) => x.v.section).map((x) => [x.code, x.v.section]))(
    '%s full-page link ?section=%s is a section ResearchPage honours', (code, section) => {
      expect(sectionKeys().has(section)).toBe(true)
    })

  it.each(variants.filter((x) => x.v.flag).map((x) => [x.code, x.v.flag]))(
    '%s is gated by %s, a key AuthContext provides', (code, flag) => {
      expect(authProvides().has(flag)).toBe(true)
    })

  it('every panel named by the registry has an importer, and every importer is used', () => {
    const named = new Set(variants.filter((x) => x.v.panel).map((x) => x.v.panel))
    expect([...named].filter((n) => !PANEL_IMPORTERS[n])).toEqual([])
    expect(Object.keys(PANEL_IMPORTERS).filter((n) => !named.has(n))).toEqual([])
  })

  it.each(Object.keys(PANEL_IMPORTERS))('panel %s imports a default-exported component', async (name) => {
    const mod = await PANEL_IMPORTERS[name]()
    expect(typeof mod.default).toBe('function')
  }, 60_000)

  it('the brief\'s named codes are all present (or answered as ABSENT)', () => {
    const named = ['DES', 'GP', 'FA', 'EE', 'FIL', 'OWN', 'HIS', 'SEAS', 'OMON', 'OVS', 'GEX', 'OBT',
      'OSCR', 'DR', 'CN', 'CAL', 'FLOW', 'BRD', 'WIRE', 'HELP']
    expect(named.filter((c) => !BY_CODE[c] && !ABSENT[c])).toEqual([])
  })

  it('market-wide codes open with no ticker', () => {
    for (const c of ['CAL', 'BRD', 'WIRE', 'FLOW']) expect(BY_CODE[c].market, c).toBeTruthy()
  })

  it('codes are unique, upper-case, and no code is also an ABSENT code', () => {
    const codes = FUNCTIONS.map((f) => f.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of codes) expect(c).toMatch(/^[A-Z0-9]{2,5}$/)
    expect(codes.filter((c) => ABSENT[c])).toEqual([])
  })

  it('suggest() finds near misses', () => {
    expect(suggest('GPX')).toContain('GP')
    expect(suggest('OMN')).toContain('OMON')
    expect(suggest('OSC')).toContain('OSCR')
  })
})

describe('pins: this shell reuses other modules\' vocabulary, it does not restate it loosely', () => {
  it('the cohort name is rollout_gate.py\'s TERMINAL_NEXT_COHORT', () => {
    const py = fs.readFileSync(path.join(REPO, 'api/services/rollout_gate.py'), 'utf8')
    const m = py.match(/^TERMINAL_NEXT_COHORT\s*=\s*"([^"]+)"/m)
    expect(m?.[1]).toBe(TERMINAL_NEXT_COHORT)
  })

  it('the link groups are /charts\' WidgetHeader COLORS', () => {
    const src = fs.readFileSync(path.join(SRC, 'pages/charts/WidgetHeader.jsx'), 'utf8')
    const m = src.match(/const COLORS = (\[[^\]]+\])/)
    expect(JSON.parse(m[1].replace(/'/g, '"'))).toEqual(LINK_GROUPS)
  })

  it('the group dot colours are /charts\' (PeriodSortPanel COLOR_HEX)', () => {
    const src = fs.readFileSync(path.join(SRC, 'pages/charts/PeriodSortPanel.jsx'), 'utf8')
    const m = src.match(/const COLOR_HEX = (\{[^}]+\})/)
    const hex = JSON.parse(m[1].replace(/'/g, '"').replace(/([A-Z]):/g, '"$1":'))
    expect(hex).toEqual(GROUP_DOT)
  })
})
