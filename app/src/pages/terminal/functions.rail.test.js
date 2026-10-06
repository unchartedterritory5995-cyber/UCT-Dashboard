// UCT Terminal — EVERY REGISTRY FUNCTION RESOLVES TO A REAL SURFACE. Derived, never typed:
//   panel   -> IMPORTED: the module loads and default-exports a component;
//   surface -> the TERM-037 panel set promotes it, and surfacePanels.js imports the SAME
//              module App.jsx lazy-loads for it (AST on both files);
//   door    -> AST: a `<Route path>` literal in App.jsx (nested children composed); a door to
//              a page the panel set promotes must carry its `why`;
//   args    -> every kind exists; the timeframes are StockChart's own TF_WM_LABELS keys;
//   coverage-> every ResearchPage section and every Research › Depth key has a code;
//   section -> AST: a key of ResearchPage.jsx's SECTION_TO_TAB (the "Full page" link lands);
//   flag    -> AST: a key AuthContext.Provider's `value` actually provides.
// Plus the pins that keep this shell's copies of other modules' vocabulary honest.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'
import { FUNCTIONS, BY_CODE, ABSENT, suggest, fillDoor, flagOn, depthPanelOf, researchHref } from './functions'
import { PANEL_IMPORTERS, panelNameFor } from './panels'
import { SURFACE_IMPORTERS, surfacePanel, promotedPaths } from './surfacePanels'
import { ARG_KINDS, TIMEFRAMES, applyArgs } from './args'
import { RESEARCH_DEPTH_KEYS } from '../research/depth/researchDepthFlags'
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

const routePath = (el) => {
  const a = el.openingElement.attributes.find((x) => x.name?.name === 'path')
  return a?.value?.type === 'Literal' ? a.value.value : null
}

function appRoutes() {
  const out = new Set()
  walk(parse(path.join(SRC, 'App.jsx')), (n) => {
    if (n.type === 'JSXElement' && n.openingElement?.name?.name === 'Route') {
      const p = routePath(n)
      if (p) out.add(p)
      // A nested child (`/journal` › `notebook`) is reachable at the COMPOSED path.
      if (p && p.startsWith('/')) {
        for (const c of n.children || []) {
          if (c.type !== 'JSXElement' || c.openingElement?.name?.name !== 'Route') continue
          const cp = routePath(c)
          if (cp && !cp.startsWith('/')) out.add(`${p}/${cp}`)
        }
      }
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

/** element name → the module App.jsx loads it from, resolved to a path under src
 *  (`const Breadth = lazyPage('/breadth', () => import('./pages/Breadth'))`). */
function appImports() {
  const out = new Map()
  walk(parse(path.join(SRC, 'App.jsx')), (n) => {
    if (n.type !== 'VariableDeclarator' || n.id?.type !== 'Identifier' || !n.init) return
    walk(n.init, (m) => {
      if (m.type === 'ImportExpression' && m.source?.type === 'Literal' && !out.has(n.id.name)) {
        out.set(n.id.name, path.resolve(SRC, m.source.value))
      }
    })
  })
  return out
}

/** importer key → the module a `() => import('…')` in surfacePanels.js names, resolved. */
function surfaceImporterTargets() {
  const out = new Map()
  const file = path.join(SRC, 'pages/terminal/surfacePanels.js')
  walk(parse(file), (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'SURFACE_IMPORTERS') {
      for (const p of n.init.properties) {
        walk(p.value, (m) => {
          if (m.type === 'ImportExpression') out.set(p.key.name, path.resolve(path.dirname(file), m.source.value))
        })
      }
    }
  })
  return out
}

/** The ids of Settings.jsx's `SECTIONS` (what `?section=` honours there). */
function settingsSections() {
  const out = new Set()
  walk(parse(path.join(SRC, 'pages/Settings.jsx')), (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'SECTIONS' && n.init?.type === 'ArrayExpression') {
      for (const el of n.init.elements) {
        const id = el.properties?.find((p) => p.key?.name === 'id')
        if (id?.value?.type === 'Literal') out.add(id.value.value)
      }
    }
  })
  return out
}

/** The keys of StockChart's `TF_WM_LABELS` — the timeframes the chart itself labels. */
function chartTimeframes() {
  const out = new Set()
  walk(parse(path.join(SRC, 'components/StockChart.jsx')), (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'TF_WM_LABELS' && n.init?.type === 'ObjectExpression') {
      for (const p of n.init.properties) out.add(String(p.key.type === 'Literal' ? p.key.value : p.key.name))
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

  it('every variant is exactly ONE of panel / surface / door', () => {
    for (const { code, scope, v } of variants) {
      expect([v.panel, v.surface, v.door].filter(Boolean).length, `${code}/${scope}`).toBe(1)
    }
  })

  it.each(variants.filter((x) => x.v.surface).map((x) => [x.code, x.v.surface]))(
    '%s surface %s is a page the TERM-037 panel set promotes, bound to a page module', (code, surface) => {
      const sp = surfacePanel(surface)
      expect(sp, `${surface}: not promoted by panelSet.js, or no SURFACE_IMPORTERS entry`).toBeTruthy()
      expect(panelNameFor({ surface })).toBe(sp.id)
      expect(doorRoute(surface, appRoutes()), surface).toBe(surface)
    })

  it('every SURFACE_IMPORTERS page is used, and loads the SAME module App.jsx loads for it', () => {
    const used = new Set(variants.filter((x) => x.v.surface).map((x) => surfacePanel(x.v.surface)?.element))
    expect(Object.keys(SURFACE_IMPORTERS).filter((el) => !used.has(el))).toEqual([])
    const app = appImports()
    const ours = surfaceImporterTargets()
    expect(ours.size).toBe(Object.keys(SURFACE_IMPORTERS).length)   // non-vacuity
    for (const [el, target] of ours) {
      expect(app.get(el), `${el}: App.jsx has no import for it`).toBeTruthy()
      expect(target, el).toBe(app.get(el))
    }
  })

  it('a door to a page the panel set promotes says WHY it is not embedded (never a silent door)', () => {
    const promoted = promotedPaths()
    expect(promoted.size).toBeGreaterThan(5)   // non-vacuity: the panel set is mounted and populated
    const silent = variants.filter((x) => x.v.door && !x.v.why)
      .filter((x) => promoted.has(doorRoute(x.v.door, appRoutes())))
      .map((x) => `${x.code}/${x.scope} -> ${x.v.door}`)
    expect(silent).toEqual([])
  })

  it('a market panel\'s `full` page is a route App.jsx registers', () => {
    const fulls = variants.filter((x) => x.v.full)
    expect(fulls.length).toBeGreaterThan(0)
    for (const { code, v } of fulls) expect(doorRoute(v.full, appRoutes()), `${code} ${v.full}`).toBeTruthy()
  })

  it('a /settings door names a section Settings.jsx honours', () => {
    const sections = settingsSections()
    expect(sections.has('account')).toBe(true)   // non-vacuity
    const doors = variants.filter((x) => x.v.door?.startsWith('/settings?'))
    expect(doors.length).toBeGreaterThan(0)
    for (const { code, v } of doors) {
      const s = new URLSearchParams(v.door.split('?')[1]).get('section')
      expect(sections.has(s), `${code} ?section=${s}`).toBe(true)
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
    const doors = new Set(variants.flatMap((x) => [x.v.door, x.v.surface, x.v.full])
      .filter(Boolean).map((d) => doorRoute(d, appRoutes())))
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
      const [head, tail] = flag.split('.')
      expect(authProvides().has(head)).toBe(true)
      // A dotted flag names one Research › Depth key the server publishes (or `*` = any).
      if (tail) {
        expect(head).toBe('researchDepth')
        expect(tail === '*' || RESEARCH_DEPTH_KEYS.includes(tail), tail).toBe(true)
      }
    })

  // A Depth code's "Full page" link lands on ITS panel: the `&panel=` it carries is derived
  // from its own flag, and must be a key DepthTab actually anchors a panel by (AST over
  // DepthTab.jsx's DEPTH_PANELS — the same keys that gate each panel there).
  it('every per-panel Depth code deep-links to a panel DepthTab anchors, and every anchored panel has one', () => {
    let anchored = null
    walk(parse(path.join(SRC, 'pages/research/depth/DepthTab.jsx')), (n) => {
      if (n.type === 'VariableDeclarator' && n.id?.name === 'DEPTH_PANELS' && n.init?.type === 'ArrayExpression') {
        anchored = new Set(n.init.elements.map((e) => e?.elements?.[0]?.value).filter(Boolean))
      }
    })
    expect(anchored && anchored.size).toBeGreaterThan(3)   // non-vacuity: the derivation found them
    expect(anchored.has('events_timeline_enabled')).toBe(true)
    const depth = variants.filter((x) => x.v.section === 'depth')
    const perPanel = depth.filter((x) => depthPanelOf(x.v))
    expect(perPanel.map((x) => x.code)).toContain('EVTS')   // non-vacuity
    for (const { code, v } of perPanel) {
      const key = depthPanelOf(v)
      expect(anchored.has(key), `${code} → ${key}`).toBe(true)
      expect(researchHref('nvda', v.section, key), code)
        .toBe(`/research/NVDA?section=depth&panel=${key}`)
    }
    // The whole-tab code (DPTH, `researchDepth.*`) opens the tab, not a panel.
    expect(depth.filter((x) => !depthPanelOf(x.v)).map((x) => x.code)).toEqual(['DPTH'])
    // …and every panel DepthTab anchors is reachable from a code (a new panel without one is red).
    const reached = new Set(perPanel.map((x) => depthPanelOf(x.v)))
    expect([...anchored].filter((k) => !reached.has(k)).sort()).toEqual([])
    // A non-depth section never grows a `panel` param.
    expect(depthPanelOf({ section: 'options', flag: 'researchDepth.ftd_dataset_enabled' })).toBe(null)
    expect(researchHref('nvda', 'news')).toBe('/research/NVDA?section=news')
  })

  it('flagOn: a plain key is === true; a dotted key reads the object; `*` is ANY key', () => {
    expect(flagOn({}, undefined)).toBe(true)
    expect(flagOn({ a: 'yes' }, 'a')).toBe(false)
    expect(flagOn({ a: true }, 'a')).toBe(true)
    expect(flagOn({ researchDepth: { x: false, y: true } }, 'researchDepth.y')).toBe(true)
    expect(flagOn({ researchDepth: { x: false, y: true } }, 'researchDepth.x')).toBe(false)
    expect(flagOn({ researchDepth: { x: false } }, 'researchDepth.*')).toBe(false)
    expect(flagOn({ researchDepth: { x: false, y: true } }, 'researchDepth.*')).toBe(true)
    expect(flagOn({}, 'researchDepth.*')).toBe(false)
  })

  it('V1b COVERAGE, derived: every Research section is reached by a code, and so is every Depth panel', () => {
    // Every key of ResearchPage's SECTION_TO_TAB (each a built tab) is some ticker variant's
    // `section` — a tab added to the page without a terminal code goes red here.
    const reached = new Set(variants.map((x) => x.v.section).filter(Boolean))
    const sections = [...sectionKeys()]
    expect(sections.length).toBeGreaterThan(15)   // non-vacuity
    expect(sections.filter((s) => !reached.has(s)).sort()).toEqual([])
    // …and every Depth surface key the server publishes gates its OWN code.
    const depthFlags = new Set(variants.map((x) => x.v.flag).filter((f) => f?.startsWith('researchDepth.')))
    expect(RESEARCH_DEPTH_KEYS.filter((k) => !depthFlags.has(`researchDepth.${k}`))).toEqual([])
  })

  it('V6a: every declared argument kind exists, and every timeframe is one StockChart labels', () => {
    for (const { code, v } of variants) {
      for (const a of v.args || []) {
        expect(ARG_KINDS[a.kind], `${code} arg ${a.kind}`).toBeTruthy()
        expect(!!a.prop !== !!a.param, `${code} arg ${a.kind}: exactly one of prop/param`).toBe(true)
      }
    }
    const chart = chartTimeframes()
    expect(chart.has('D') && chart.has('W')).toBe(true)   // non-vacuity
    expect([...new Set(Object.values(TIMEFRAMES))].filter((tf) => !chart.has(tf))).toEqual([])
  })

  it('V6a: applyArgs applies what fits, names what does not, and lets a door consume {argN}', () => {
    const gp = BY_CODE.GP.ticker
    expect(applyArgs(gp, ['w'])).toMatchObject({ props: { tf: 'W' }, ignored: [] })
    expect(applyArgs(gp, ['W', 'X'])).toMatchObject({ props: { tf: 'W' }, ignored: ['X'] })
    expect(applyArgs(BY_CODE.FA.ticker, ['1Y'])).toMatchObject({ ignored: ['1Y'], takes: [] })
    expect(applyArgs(BY_CODE.CMP.ticker, ['AMD'])).toMatchObject({ ignored: [] })
    expect(applyArgs(BY_CODE.CMP.ticker, ['AMD', 'Z'])).toMatchObject({ ignored: ['Z'] })
    const cal = applyArgs(BY_CODE.CAL.market, ['TODAY'], { today: '2026-10-02' })
    expect(cal.params).toEqual({ week: null, d: '2026-10-02' })
    expect(applyArgs(BY_CODE.CAL.market, ['NEXT'], { today: '2026-10-02' }).params).toEqual({ week: '2026-10-05', d: null })
    expect(applyArgs(BY_CODE.HELP.market, ['gp']).props).toEqual({ focusCode: 'GP' })
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

  it('V1: OSCR and OBT are BUILT surfaces — registered codes, never ABSENT answers', () => {
    // COV-02's Options view (Screener.jsx imports OptionsScreener) and BRK-01 inc-4's backtest
    // (OptionsChainTab imports BacktestPanel) exist on this build; the shell must not deny them.
    for (const c of ['OSCR', 'OBT']) {
      expect(BY_CODE[c], c).toBeTruthy()
      expect(Object.prototype.hasOwnProperty.call(ABSENT, c), c).toBe(false)
    }
    expect(PANEL_IMPORTERS[BY_CODE.OSCR.market.panel]).toBeTruthy()
    expect(PANEL_IMPORTERS[BY_CODE.OBT.ticker.panel]).toBeTruthy()
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

describe('O12: IVH and STRS gate on their own switches', () => {
  it('IVH needs ivHistoryEnabled and STRS needs optionsStrategyScreensEnabled', () => {
    expect(BY_CODE.IVH.ticker.flag).toBe('ivHistoryEnabled')
    expect(BY_CODE.STRS.market.flag).toBe('optionsStrategyScreensEnabled')
    expect(flagOn({ optionsChainEnabled: true }, BY_CODE.IVH.ticker.flag)).toBe(false)
    expect(flagOn({ ivHistoryEnabled: true }, BY_CODE.IVH.ticker.flag)).toBe(true)
    expect(flagOn({}, BY_CODE.STRS.market.flag)).toBe(false)
    expect(flagOn({ optionsStrategyScreensEnabled: true }, BY_CODE.STRS.market.flag)).toBe(true)
  })
})
