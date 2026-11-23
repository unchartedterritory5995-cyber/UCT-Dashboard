// Settings → Faster charts on this device: the member-facing off switch of the on-device bar store (review of #2537
// head f16a87dd98, Q-4, "The member-facing off setting: where it writes and what it must not do").
//
// The REAL switch decides (data/deviceStore/switch.js): the stored key, the server's kill cookies, the desktop default.
// Every case is a fresh page load (vi.resetModules), because the switch and the kills are latched once per load. Nothing
// about the decision is mocked. Only the default's environment is forced (__setDeviceStoreDefaultForTests) where a case
// needs a desktop, because jsdom is no desktop. Asserted by the words a member reads and by what lands in storage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { census, repoSources } from '../../../../tools/persistence_census.mjs'

const KEY = 'uct.deviceStore'
const FILES_KEY = 'uct.deviceStore.files'
const TITLE = 'Faster charts on this device'
const ON = 'On for this device.'
const DEFAULT_OFF = 'Off on this device: it needs a window wider than a tablet, a mouse or trackpad, and a connection that is not metered.'
const MEMBER_OFF = 'Off: you turned it off. The stored chart data is removed the next time a chart loads.'
const KILLED = 'Temporarily unavailable.'
const OTHER_OFF = 'Off on this device.'
const UNREADABLE = 'Unavailable: this browser does not let the site keep data.'
const NEXT = 'Changes apply the next time the page loads.'
const NEXT_OFF = 'Changes apply the next time the page loads, and the stored chart data is removed after that.'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..')                 // app/src
const REPO = path.resolve(SRC, '..', '..')

const setCookie = (name, value) => { document.cookie = `${name}=${value}; path=/` }
const clearCookie = (name) => { document.cookie = `${name}=; max-age=0; path=/` }
const clearKills = () => { clearCookie('uct_chart_speed'); clearCookie('uct_device_store') }

/** A new page load: the switch, the kills and the card evaluated afresh. `desktop`: what the switch's default reads on
 *  this load (null: computed, which jsdom answers OFF: no matchMedia). */
async function pageLoad({ desktop = null } = {}) {
  vi.resetModules()
  const sw = await import('../../data/deviceStore/switch')
  if (desktop != null) sw.__setDeviceStoreDefaultForTests(desktop)
  const mod = await import('./FasterChartsCard')
  return { sw, Card: mod.default }
}

/** Every localStorage write, by any code, from here on. */
function writes() {
  const set = vi.spyOn(Storage.prototype, 'setItem')
  const remove = vi.spyOn(Storage.prototype, 'removeItem')
  return { set, remove, none: () => set.mock.calls.length === 0 && remove.mock.calls.length === 0 }
}

const control = () => screen.getByRole('button', { name: new RegExp(`^${TITLE}:`) })
const stateText = () => screen.getByTestId('faster-charts-state').textContent
const nextText = () => screen.getByTestId('faster-charts-next').textContent
const optionLabels = () => screen.getAllByRole('option').map((o) => o.textContent.replace('✓', '').trim())
function choose(label) {
  fireEvent.click(control())
  fireEvent.click(screen.getByRole('option', { name: label }))
}

beforeEach(() => { localStorage.clear(); clearKills() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); clearKills(); delete navigator.storage })

describe('what the member sees: the control, and the state of THIS page load', () => {
  it('no key on a desktop: Automatic, "On for this device.", nothing pending', async () => {
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    expect(screen.getByText(TITLE)).toBeTruthy()
    expect(screen.getByText('Keeps recent chart data on this device (about 80 MB) so charts open instantly.')).toBeTruthy()
    expect(control().textContent).toMatch(/Automatic/)
    expect(stateText()).toBe(ON)
    expect(nextText()).toBe('')
    fireEvent.click(control())
    expect(optionLabels()).toEqual(['Automatic', 'Off'])
  })

  it('no key where the default reads off (jsdom: no wide window, no mouse): Automatic, and why it is off', async () => {
    const { sw, Card } = await pageLoad()
    expect(sw.deviceStoreOffReason()).toBe('default-off')
    render(<Card />)
    expect(control().textContent).toMatch(/Automatic/)
    expect(stateText()).toBe(DEFAULT_OFF)
  })

  it("the member's own '0': Off, and the packs go on the next chart load", async () => {
    localStorage.setItem(KEY, '0')
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    expect(control().textContent).toMatch(/Off/)
    expect(stateText()).toBe(MEMBER_OFF)
    expect(nextText()).toBe('')
  })

  it.each([['off'], ['true'], [''], [' 1']])('any other stored value (%j) shows as Off', async (stored) => {
    localStorage.setItem(KEY, stored)
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    expect(control().textContent).toMatch(/Off/)
    expect(stateText()).toBe(OTHER_OFF)
    expect(localStorage.getItem(KEY)).toBe(stored)
  })

  it.each([
    ['the device kill', 'uct_device_store', '0'],
    ['the device purge', 'uct_device_store', 'purge'],
    ['the chart-speed kill', 'uct_chart_speed', '0'],
  ])('%s in force: "Temporarily unavailable." (no key, a desktop)', async (_name, cookie, value) => {
    setCookie(cookie, value)
    const { sw, Card } = await pageLoad({ desktop: true })
    expect(sw.deviceStoreEnabled()).toBe(false)
    render(<Card />)
    expect(stateText()).toBe(KILLED)
    expect(control().textContent).toMatch(/Automatic/)
  })

  it("a kill over a tester's '1': still \"Temporarily unavailable.\"; the dropdown still shows the tester's value", async () => {
    localStorage.setItem(KEY, '1')
    setCookie('uct_device_store', '0')
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    expect(stateText()).toBe(KILLED)
    expect(control().textContent).toMatch(/On \(testing mode\)/)
  })

  it('reads THIS page load\'s answer: decided ON before the key changed in another tab; the change waits for a reload', async () => {
    const { sw, Card } = await pageLoad({ desktop: true })
    expect(sw.deviceStoreEnabled()).toBe(true)                 // the bar store read it when the page loaded
    localStorage.setItem(KEY, '0')                             // another tab's "Off" since
    render(<Card />)
    expect(stateText()).toBe(ON)
    expect(control().textContent).toMatch(/Off/)
    expect(nextText()).toBe(NEXT_OFF)
  })

  it('a browser that refuses storage: says so, and the control is disabled', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    expect(stateText()).toBe(UNREADABLE)
    expect(control().disabled).toBe(true)
  })
})

describe("a tester's hand-set '1' is shown honestly and never destroyed", () => {
  it("shows \"On (testing mode)\", read only; opening and picking it writes nothing; Automatic and Off are still offered", async () => {
    localStorage.setItem(KEY, '1')
    const { Card } = await pageLoad({ desktop: true })
    const w = writes()
    render(<Card />)
    expect(control().textContent).toMatch(/On \(testing mode\)/)
    expect(stateText()).toBe(ON)
    fireEvent.click(control())
    expect(optionLabels()).toEqual(['Automatic', 'Off', 'On (testing mode)'])
    const testing = screen.getByRole('option', { name: 'On (testing mode)' })
    expect(testing.disabled).toBe(true)
    fireEvent.click(testing)
    expect(w.none()).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('1')
  })
})

describe('the writes: one key, in this browser, only on a choice', () => {
  it.each([[null], ['1'], ['0'], ['off'], ['']])('opening the card with %j stored, opening the menu and re-picking the current value writes NOTHING', async (stored) => {
    if (stored != null) localStorage.setItem(KEY, stored)
    const { Card } = await pageLoad({ desktop: true })
    const jar = document.cookie
    const w = writes()
    const { unmount } = render(<Card />)
    fireEvent.click(control())
    const current = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')
    fireEvent.click(current)                                   // the value already shown: no change
    unmount()
    expect(w.set.mock.calls).toEqual([])
    expect(w.remove.mock.calls).toEqual([])
    expect(localStorage.getItem(KEY)).toBe(stored)
    expect(document.cookie).toBe(jar)
  })

  it('opening it under a kill writes nothing either (a kill is not the member\'s choice)', async () => {
    setCookie('uct_device_store', 'purge')
    const { Card } = await pageLoad({ desktop: true })
    const w = writes()
    render(<Card />)
    expect(w.none()).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it.each([['0'], ['1'], ['off'], ['true']])("from a stored %j, Automatic REMOVES the key (never writes '1') and nothing else", async (stored) => {
    localStorage.setItem(KEY, stored)
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    const w = writes()
    choose('Automatic')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(w.set.mock.calls).toEqual([])
    expect(w.remove.mock.calls).toEqual([[KEY]])
    expect(control().textContent).toMatch(/Automatic/)
    expect(nextText()).toBe(NEXT)
  })

  it.each([[null], ['1']])("from %j, Off writes exactly '0' and nothing else", async (stored) => {
    if (stored != null) localStorage.setItem(KEY, stored)
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    const w = writes()
    choose('Off')
    expect(localStorage.getItem(KEY)).toBe('0')
    expect(w.set.mock.calls).toEqual([[KEY, '0']])
    expect(w.remove.mock.calls).toEqual([])
    expect(control().textContent).toMatch(/Off/)
    expect(stateText()).toBe(ON)                               // this page load is unchanged...
    expect(nextText()).toBe(NEXT_OFF)                          // ...and the member is told when it applies
  })

  it('back to what this page loaded with: nothing pending any more', async () => {
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    choose('Off')
    expect(nextText()).toBe(NEXT_OFF)
    choose('Automatic')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(nextText()).toBe('')
  })

  it('Off deletes nothing itself: no OPFS call, the files marker and the kill cookies untouched (source.js deletes, on a later load)', async () => {
    localStorage.setItem(FILES_KEY, '1')
    const storage = { getDirectory: vi.fn(async () => ({ removeEntry: vi.fn() })) }
    Object.defineProperty(navigator, 'storage', { value: storage, configurable: true, writable: true })
    setCookie('uct_chart_speed', '1')
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    const jar = document.cookie
    choose('Off')
    await new Promise((r) => setTimeout(r, 0))
    expect(storage.getDirectory).not.toHaveBeenCalled()
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
    expect(document.cookie).toBe(jar)
  })

  it('a write the browser refuses: says so, and shows what is really stored', async () => {
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    choose('Off')
    expect(nextText()).toBe('Could not save. Nothing was changed.')
    expect(control().textContent).toMatch(/Automatic/)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('per browser: no server preference, no fetch, and nothing that reaches the account is imported', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)
    const { Card } = await pageLoad({ desktop: true })
    render(<Card />)
    choose('Off')
    choose('Automatic')
    expect(fetchSpy).not.toHaveBeenCalled()
    const imports = staticImportsOf(path.join(HERE, 'FasterChartsCard.jsx'))
    expect(imports.length).toBeGreaterThan(2)                  // non-vacuity: the file parsed
    for (const bad of [/usePreferences/, /prefsSession/, /\/persistence\//, /AuthContext/, /deviceSync/, /preferences/i]) {
      expect(imports.filter((s) => bad.test(s)), String(bad)).toEqual([])
    }
  })
})

// ── Read by acorn AST, never grep: a commented-out import or mount is not one. ─────────────────────────────────────
const JsxParser = Parser.extend(jsx())
const parse = (src) => JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })
function walk(n, fn) {
  if (!n || typeof n.type !== 'string') return
  fn(n)
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}
/** { statics, dynamics }: the specifiers a source imports statically (import / export ... from) and dynamically. */
function importsIn(src) {
  const statics = []
  const dynamics = []
  walk(parse(src), (n) => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) statics.push(n.source.value)
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal') dynamics.push(n.source.value)
  })
  return { statics, dynamics }
}
function staticImportsOf(file) { return importsIn(fs.readFileSync(file, 'utf8')).statics }

/** app/src-relative path of a relative specifier, or null (a package, CSS, an asset, a ?query import). */
function resolveRel(fromRel, spec) {
  if (!spec.startsWith('.') || spec.includes('?')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  for (const cand of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}/index.js`, `${base}/index.jsx`]) {
    if (/\.(jsx?|mjs)$/.test(cand) && fs.existsSync(path.join(SRC, cand)) && fs.statSync(path.join(SRC, cand)).isFile()) return cand
  }
  return null
}
/** The STATIC import closure of `roots` (app/src-relative): what a browser fetches before those modules run. Dynamic
 *  imports are on demand and are not followed. */
function staticClosure(roots) {
  const seen = new Set()
  const parseErrors = []
  const stack = [...roots]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    let statics = []
    try { statics = importsIn(fs.readFileSync(path.join(SRC, f), 'utf8')).statics } catch (e) { parseErrors.push(`${f}: ${e.message}`); continue }
    for (const s of statics) { const r = resolveRel(f, s); if (r && !seen.has(r)) stack.push(r) }
  }
  return { files: seen, parseErrors }
}

describe('first-open bytes: the switch reaches the page only through the lazy Settings page', () => {
  // The Notebook's first-open roots are docs/notebook/perf-budgets.json's own (tools/notebook_perf_budgets.py sums the
  // entry plus their static closure): read, never typed.
  const budgets = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'notebook', 'perf-budgets.json'), 'utf8'))
  const notebookRoots = budgets.bytes.notebook_first_open.roots.map((r) => r.replace(/^src\//, ''))
  const FIRST_OPEN = staticClosure(['main.jsx', ...notebookRoots])

  it('NON-VACUITY: the walk parsed the entry and the Notebook roots and followed their imports', () => {
    expect(notebookRoots.length).toBeGreaterThan(1)
    expect(FIRST_OPEN.parseErrors).toEqual([])
    expect(FIRST_OPEN.files.size).toBeGreaterThan(200)
    for (const f of ['main.jsx', 'App.jsx', 'lib/desktopBridge.js', ...notebookRoots]) expect(FIRST_OPEN.files.has(f), f).toBe(true)
  })

  it('the entry and the Notebook first open reach neither switch.js nor lib/chartSpeed.js, nor Settings or this card', () => {
    const reached = ['data/deviceStore/switch.js', 'lib/chartSpeed.js', 'pages/Settings.jsx', 'pages/settings/FasterChartsCard.jsx']
      .filter((f) => FIRST_OPEN.files.has(f))
    expect(reached).toEqual([])
  })

  it('App.jsx imports Settings lazily, and only lazily', () => {
    const app = importsIn(fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8'))
    expect(app.dynamics).toContain('./pages/Settings')
    expect(app.statics.filter((s) => /pages\/Settings(\.jsx)?$/.test(s))).toEqual([])
  })

  it('CONTROL: the same walk from Settings.jsx DOES reach this card, the switch and lib/chartSpeed.js', () => {
    const settings = staticClosure(['pages/Settings.jsx'])
    expect(settings.parseErrors).toEqual([])
    for (const f of ['pages/settings/FasterChartsCard.jsx', 'data/deviceStore/switch.js', 'lib/chartSpeed.js']) expect(settings.files.has(f), f).toBe(true)
  })
})

describe('Settings mounts it: the Charts section, and the settings search', () => {
  const ast = parse(fs.readFileSync(path.join(SRC, 'pages', 'Settings.jsx'), 'utf8'))
  const declared = (name) => {
    let init = null
    walk(ast, (n) => { if (n.type === 'VariableDeclarator' && n.id?.name === name) init = n.init })
    return init
  }

  it('imports it and mounts it in the charts section', () => {
    const imp = ast.body.find((n) => n.type === 'ImportDeclaration' && n.specifiers.some((s) => s.local.name === 'FasterChartsCard'))
    expect(imp?.source.value).toBe('./settings/FasterChartsCard')
    const charts = declared('sectionCards').properties.find((p) => (p.key.name ?? p.key.value) === 'charts')
    const cards = charts.value.elements.map((e) => [e.arguments[0].value,
      e.arguments[1].type === 'JSXElement' ? e.arguments[1].openingElement.name.name : null])
    expect(cards.length).toBeGreaterThan(1)                    // non-vacuity: the section parsed
    expect(cards).toContainEqual(['fasterCharts', 'FasterChartsCard'])
  })

  it('is indexed for the settings search box, under Charts', () => {
    const row = declared('SEARCH_INDEX').elements.find((e) => e.properties.some((p) => p.key.name === 'card' && p.value.value === 'fasterCharts'))
    const field = (k) => row?.properties.find((p) => p.key.name === k)?.value.value
    expect(field('section')).toBe('charts')
    expect(field('title')).toBe(TITLE)
    for (const word of ['faster', 'off', 'device', 'storage']) expect(field('keywords')).toContain(word)
  })
})

describe('the persistence census: the key is declared, device-local, a member setting', () => {
  // The Settings card "What syncs across your devices" renders from persistenceManifest.json. The census derives each
  // key's store and files from the code (tools/persistence_census.mjs); the declared row must match what it derives.
  const REAL = census(repoSources())
  const MANIFEST = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'persistence', 'persistenceManifest.json'), 'utf8'))
  const CARD = 'app/src/pages/settings/FasterChartsCard.jsx'

  it("the census reads this card's writes as localStorage 'uct.deviceStore', every one resolved", () => {
    const derived = REAL.entries.find((e) => e.store === 'localStorage' && e.key === KEY)
    expect(derived?.files).toContain(CARD)
    expect(derived?.files).toContain('app/src/data/deviceStore/switch.js')
    expect(REAL.unresolved.filter((u) => u.file === CARD)).toEqual([])
  })

  it('the manifest declares it as a device-local member setting, with exactly the files the census derives', () => {
    const row = MANIFEST.entries.find((e) => e.store === 'localStorage' && e.key === KEY)
    expect(row).toMatchObject({ scope: 'device-local', kind: 'setting', surface: 'Charts', label: TITLE })
    expect(row.files).toEqual(REAL.entries.find((e) => e.store === 'localStorage' && e.key === KEY).files)
  })
})
