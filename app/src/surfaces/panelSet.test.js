// @vitest-environment node
// ⛔ NODE, NOT JSDOM — the same reason manifest.test.js gives: this rail parses files and
// walks a directory, and a jsdom environment it never uses cost a green rail its timeout.
/**
 * TERM-037 rail — the panel set is DERIVED from the surface set, and nothing else.
 *
 * Four jobs, and they fail for different reasons — keep all four:
 *   1. PARITY. An independent AST read of the authority (`manifest.js`) and of the nav
 *      labels (`NavBar.jsx`) predicts exactly which surfaces become panels; the module's
 *      set must equal that prediction. A planted-drift control proves the comparison
 *      sees an extra AND a missing panel.
 *   2. THE SOURCE MOVES THE SET. A row planted into `manifest.js`'s own source text,
 *      re-read by AST and handed to `derivePanelSet`, appears in the panel set with no
 *      edit to `panelSet.js`; a planted row that is not page-shaped is refused BY NAME.
 *   3. NO SECOND LIST. `panelSet.js`'s own AST carries no route-shaped string literal,
 *      so a hand-typed promotion list cannot come back. A control proves the scan fires.
 *   4. THE BINDING PIN, EXTENDED. `registry.test.js` pins every native id to a
 *      `WORKSPACE_WIDGETS` binding. Every id in `PANEL_SET` is now either that, or a
 *      surface panel that is bound nowhere AND offered by no menu — an unbound panel a
 *      member could add would render nothing. A control proves the check can fail.
 *
 * ⛔ AN AST, NEVER A REGEX, for every read of source (the repo's recorded lesson: a regex
 * finds the string in a comment, in a prop name and in the prose above the call site).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'
import { MANIFEST } from './manifest.js'
import { WIDGET_REGISTRY, WIDGET_IDS, validatePanelManifest } from '../widgets/registry.js'
import {
  SURFACE_PANELS, SURFACE_PANEL_IDS, REFUSED_SURFACES, PANEL_SET, REFUSAL,
  PROMOTABLE_KIND, SURFACE_PANEL_PREFIX, BOARD_HOST_ELEMENT,
  derivePanelSet, surfacePanelId, pageDefaults,
} from './panelSet.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
const Parser = acorn.Parser.extend(jsx())
const parse = (src) => Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const k of Object.keys(node)) {
    const c = node[k]
    if (Array.isArray(c)) c.forEach((x) => walk(x, visit))
    else if (c && typeof c === 'object' && typeof c.type === 'string') walk(c, visit)
  }
}

/** The ArrayExpression initialising the top-level `export const <name> = [...]`. */
function exportedArray(ast, name) {
  let found = null
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === name && n.init?.type === 'ArrayExpression') found = n.init
  })
  if (!found) throw new Error(`no array named ${name} — the AST read is broken, not the source`)
  return found
}

function literalObject(obj) {
  const out = {}
  for (const p of obj.properties) {
    if (p.type !== 'Property') continue
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.value
    if (p.value.type === 'Literal') out[key] = p.value.value
  }
  return out
}

/** MANIFEST rows, read from a manifest.js SOURCE STRING (so a planted string can be read too). */
function manifestRowsFrom(src) {
  return exportedArray(parse(src), 'MANIFEST').elements
    .filter((e) => e?.type === 'ObjectExpression')
    .map(literalObject)
}

const navItemsFrom = (src) =>
  exportedArray(parse(src), 'NAV_ITEMS').elements
    .filter((e) => e?.type === 'ObjectExpression')
    .map(literalObject)

/** The keys of `export const WORKSPACE_WIDGETS = {...}` — the /charts host binding map. */
function workspaceBindingIds() {
  let ids = null
  walk(parse(read('pages/charts/WidgetHost.jsx')), (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'WORKSPACE_WIDGETS' && n.init?.type === 'ObjectExpression') {
      ids = n.init.properties.filter((p) => p.type === 'Property').map((p) => p.key.name ?? p.key.value)
    }
  })
  if (!ids) throw new Error('no WORKSPACE_WIDGETS object found in WidgetHost.jsx')
  return ids
}

/** The rail's own statement of the rule — deliberately written from the spec, not imported. */
function expectedPromotedPaths(rows, navItems) {
  const labelled = new Set(navItems.filter((i) => i.label).map((i) => i.to))
  return rows
    .filter((r) => r.kind === 'surface' && r.pathKind === 'literal' && r.element !== 'ChartsWorkspace' && labelled.has(r.path))
    .map((r) => r.path)
}

/** Paths in one set and not the other, both directions, by name. */
function diffPaths(expected, actual) {
  const e = new Set(expected)
  const a = new Set(actual)
  return {
    missing: expected.filter((p) => !a.has(p)),
    extra: actual.filter((p) => !e.has(p)),
  }
}

const promotedPaths = () => Object.values(SURFACE_PANELS).map((p) => p.surface)

describe('TERM-037 — the AST reads found their sources (non-vacuity)', () => {
  it('reads MANIFEST, NAV_ITEMS and WORKSPACE_WIDGETS, and each is non-trivial', () => {
    const rows = manifestRowsFrom(read('surfaces/manifest.js'))
    expect(rows.length).toBeGreaterThan(40)
    expect(rows.map((r) => r.path)).toContain('/dashboard')
    const nav = navItemsFrom(read('components/NavBar.jsx'))
    expect(nav.length).toBeGreaterThan(10)
    expect(nav.map((i) => i.to)).toContain('/breadth')
    const bindings = workspaceBindingIds()
    expect(bindings).toContain('chart')
    expect(bindings.length).toBeGreaterThan(10)
  })

  it('the AST read of manifest.js and the imported MANIFEST are the same rows', () => {
    // Otherwise this rail would be checking a different authority from the one the module reads.
    const rows = manifestRowsFrom(read('surfaces/manifest.js'))
    expect(rows.map((r) => [r.path, r.kind, r.element])).toEqual(MANIFEST.map((r) => [r.path, r.kind, r.element]))
  })
})

describe('TERM-037 — PARITY: every page-shaped labelled surface is a panel, and nothing else is', () => {
  const rows = manifestRowsFrom(read('surfaces/manifest.js'))
  const nav = navItemsFrom(read('components/NavBar.jsx'))
  const expected = expectedPromotedPaths(rows, nav)

  it('the module set equals the AST prediction', () => {
    const d = diffPaths(expected, promotedPaths())
    expect(d, `surface panels out of step with manifest.js: ${JSON.stringify(d)}`).toEqual({ missing: [], extra: [] })
  })

  it('both branches are real — some surfaces promote, and every refusal reason occurs', () => {
    expect(SURFACE_PANEL_IDS.length).toBeGreaterThan(10)
    const reasons = new Set(REFUSED_SURFACES.map((r) => r.reason))
    for (const r of Object.values(REFUSAL)) expect(reasons, `no row is refused for ${r}`).toContain(r)
  })

  it('PLANTED DRIFT: the comparison sees an extra panel and a missing one', () => {
    const actual = promotedPaths()
    expect(diffPaths(expected, [...actual, '/zz-planted']).extra).toEqual(['/zz-planted'])
    expect(diffPaths(expected, actual.slice(1)).missing).toEqual([actual[0]])
  })

  it('every manifest row lands in exactly one bucket, with a stated reason when refused', () => {
    const promoted = promotedPaths()
    const refused = REFUSED_SURFACES.map((r) => r.path)
    expect(promoted.length + refused.length).toBe(MANIFEST.length)
    expect(new Set([...promoted, ...refused]).size).toBe(MANIFEST.length)
    for (const r of REFUSED_SURFACES) expect(Object.values(REFUSAL)).toContain(r.reason)
  })

  it('the board host is exactly one manifest row, refused as the host, and really hosts the board', () => {
    const hosts = MANIFEST.filter((r) => r.element === BOARD_HOST_ELEMENT)
    expect(hosts).toHaveLength(1)
    expect(REFUSED_SURFACES.find((r) => r.path === hosts[0].path)?.reason).toBe(REFUSAL.HOST)
    // BOARD_HOST_ELEMENT is a name; prove the page it names is the one that renders WidgetHost.
    const imports = parse(read('pages/charts/ChartsWorkspace.jsx')).body
      .filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value)
    expect(imports).toContain('./WidgetHost')
  })
})

describe('TERM-037 — moving the source moves the derived set', () => {
  const manifestSrc = read('surfaces/manifest.js')
  const nav = navItemsFrom(read('components/NavBar.jsx'))

  /** manifest.js's source with `rowText` inserted as the last element of MANIFEST. */
  function plant(rowText) {
    const arr = exportedArray(parse(manifestSrc), 'MANIFEST')
    const at = arr.end - 1 // the offset of the closing `]`
    return manifestSrc.slice(0, at) + rowText + '\n' + manifestSrc.slice(at)
  }

  it('the real inputs reproduce the module exports (the function IS the export)', () => {
    const d = derivePanelSet({ manifest: manifestRowsFrom(manifestSrc), navItems: nav, registry: WIDGET_REGISTRY })
    expect(Object.keys(d.promoted)).toEqual(SURFACE_PANEL_IDS)
    expect(d.panelSet).toEqual(PANEL_SET)
  })

  it('a planted page-shaped, labelled surface becomes a panel with no edit to panelSet.js', () => {
    const rows = manifestRowsFrom(plant(
      '  { path: "/zz-planted", pathKind: "literal", element: "Planted", kind: "surface", order: null },',
    ))
    expect(rows.length).toBe(MANIFEST.length + 1)
    const d = derivePanelSet({
      manifest: rows, navItems: [...nav, { to: '/zz-planted', label: 'Planted' }], registry: WIDGET_REGISTRY,
    })
    const id = surfacePanelId('/zz-planted')
    expect(d.promoted[id]?.surface).toBe('/zz-planted')
    expect(d.panelSet).toEqual([...PANEL_SET, id])
  })

  it('a planted non-page row and an unlabelled surface are refused by name, not dropped', () => {
    const rows = manifestRowsFrom(plant([
      '  { path: "/zz-detail/:id", pathKind: "literal", element: "PlantedDetail", kind: "detail", order: null },',
      '  { path: "/zz-unlabelled", pathKind: "literal", element: "PlantedPage", kind: "surface", order: null },',
    ].join('\n')))
    const d = derivePanelSet({ manifest: rows, navItems: nav, registry: WIDGET_REGISTRY })
    expect(d.panelSet).toEqual(PANEL_SET)
    const reasonOf = (p) => d.refused.find((r) => r.path === p)?.reason
    expect(reasonOf('/zz-detail/:id')).toBe(REFUSAL.KIND)
    expect(reasonOf('/zz-unlabelled')).toBe(REFUSAL.LABEL)
  })

  it('a derived id that collides with a native registry id is refused loudly', () => {
    const native = { surfaceBreadth: WIDGET_REGISTRY.chart, ...WIDGET_REGISTRY }
    expect(() => derivePanelSet({ manifest: MANIFEST, navItems: nav, registry: native })).toThrow(/collides/)
  })
})

describe('TERM-037 — NO SECOND LIST: panelSet.js types no route', () => {
  /** Every route-shaped string in a source's AST: a Literal or template chunk starting "/<letter>". */
  function routeLiterals(src) {
    const hits = []
    walk(parse(src), (n) => {
      if (n.type === 'Literal' && typeof n.value === 'string' && /^\/[A-Za-z]/.test(n.value)) hits.push(n.value)
      if (n.type === 'TemplateElement' && /^\/[A-Za-z]/.test(n.value.cooked ?? '')) hits.push(n.value.cooked)
    })
    return hits
  }

  it('panelSet.js carries no route-shaped literal', () => {
    expect(routeLiterals(read('surfaces/panelSet.js'))).toEqual([])
  })

  it('CONTROL: the scan sees a hand-typed roster, and ignores one in a comment', () => {
    expect(routeLiterals("const X = ['/breadth', `/calendar`]")).toEqual(['/breadth', '/calendar'])
    expect(routeLiterals("// const X = ['/breadth']\nconst y = 1")).toEqual([])
  })
})

describe('TERM-037 — the binding pin, extended to the whole panel set', () => {
  const bindings = new Set(workspaceBindingIds())

  /** Why an entry of PANEL_SET is not safe to hold, or [] when it is. */
  function bindingProblems(id, entry) {
    if (!id.startsWith(SURFACE_PANEL_PREFIX)) return bindings.has(id) ? [] : [`${id}: native panel with no host binding`]
    const problems = []
    if (bindings.has(id)) problems.push(`${id}: bound in WORKSPACE_WIDGETS while declared inert`)
    for (const [menu, on] of Object.entries(entry.menus)) if (on) problems.push(`${id}: offered by menus.${menu} with no binding`)
    return problems
  }

  it('PANEL_SET is the native ids followed by the surface ids, with no duplicate', () => {
    // G-040: the capture-only kinds are Notebook captures, not board tools.
    const boardIds = WIDGET_IDS.filter((id) => WIDGET_REGISTRY[id].captureOnly !== true)
    expect(boardIds.length, 'the capture-only filter must not empty the native set').toBeGreaterThan(15)
    expect(WIDGET_IDS.length - boardIds.length, 'the G-040 capture-only kinds are filtered out').toBeGreaterThan(0)
    expect(PANEL_SET).toEqual([...boardIds, ...SURFACE_PANEL_IDS])
    expect(new Set(PANEL_SET).size).toBe(PANEL_SET.length)
    for (const id of WIDGET_IDS) expect(id.startsWith(SURFACE_PANEL_PREFIX), id).toBe(false)
  })

  it('every id in the set is either bound, or a surface panel bound nowhere and offered nowhere', () => {
    const problems = PANEL_SET.flatMap((id) => bindingProblems(id, WIDGET_REGISTRY[id] ?? SURFACE_PANELS[id]))
    expect(problems).toEqual([])
  })

  it('CONTROL: an offered surface panel and a bound one are both caught', () => {
    const id = SURFACE_PANEL_IDS[0]
    const offered = { ...SURFACE_PANELS[id], menus: { ...SURFACE_PANELS[id].menus, workspace: true } }
    expect(bindingProblems(id, offered)).toEqual([`${id}: offered by menus.workspace with no binding`])
    expect(bindingProblems('surfaceZz', SURFACE_PANELS[id])).toEqual([])
    expect(bindingProblems('zzNative', null)).toEqual(['zzNative: native panel with no host binding'])
  })

  it('every surface panel went through registerPanel and validates as a panel manifest', () => {
    for (const id of SURFACE_PANEL_IDS) {
      expect(validatePanelManifest(id, SURFACE_PANELS[id]), id).toEqual([])
      expect(SURFACE_PANELS[id].menus.terminal, id).toBe(false)
      expect(SURFACE_PANELS[id].defaults).toEqual(pageDefaults(WIDGET_REGISTRY))
    }
    expect(Object.isFrozen(SURFACE_PANELS)).toBe(true)
    expect(PROMOTABLE_KIND).toBe('surface')
  })
})

describe('TERM-037 — INERT: nothing mounts the surface panels yet', () => {
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  }
  const importsPanelSet = (src) => /from\s+['"][^'"]*surfaces\/panelSet(\.js)?['"]/.test(stripComments(src))

  function walkFiles(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        walkFiles(full, acc)
      } else if (/\.(jsx?|tsx?|mjs)$/.test(e.name) && !/\.test\.(jsx?|tsx?)$/.test(e.name)) acc.push(full)
    }
    return acc
  }

  it('no production file outside src/surfaces imports panelSet.js', () => {
    const offenders = walkFiles(SRC)
      .filter((f) => !f.startsWith(path.join(SRC, 'surfaces')))
      .filter((f) => importsPanelSet(fs.readFileSync(f, 'utf8')))
    expect(
      offenders.map((f) => path.relative(SRC, f)),
      'the surface panels are declared, not mounted — an importer means the mount half shipped',
    ).toEqual([])
  }, 60_000)

  it('CONTROL: the import check sees a real import and ignores a commented one', () => {
    expect(importsPanelSet("import { PANEL_SET } from '../surfaces/panelSet.js'")).toBe(true)
    expect(importsPanelSet("// import { PANEL_SET } from '../surfaces/panelSet.js'")).toBe(false)
  })
})
