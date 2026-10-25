/* global process */
// Wave 8 (Task 8.16 fix 1, R-44 / R-45): the gallery is REACHABLE. Nothing on the path is mocked: the real My tools
// sheet, its real "Build a widget" button, the real dynamic import of the builder's door, and the real builder.
// Plus an AST rail: every call of `openWidgetBuilder` that opens a NEW widget (no `from`) says where it starts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import MyToolsSheet from '../myTools/MyToolsSheet'
import { installFetch } from '../myTools/__fixtures__/myToolsFixtures'
import { CATALOG, payload } from './__fixtures__/builderFixtures'
import { GALLERY_TITLE, LINK_BROKER_HREF } from './ExamplesGallery'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'

vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 8 }))

const SHELF = JSON.parse(readFileSync(join(process.cwd(), '..', 'api', 'services', 'journal_two', 'widget_engine',
  'shelf.json'), 'utf8')).examples
const SAVED_W1 = { id: 'w1', name: 'Net P&L by setup', rev: 2, placedRev: 2, etag: 3, archived: false, usedIn: 0,
  lastAnswer: null, summary: 'Net P&L by setup.', plan: { v: 1, source: 'closed_trades', range: { token: 'last_90d' },
    measures: [{ key: 'net_pnl' }], split: { by: 'setup' } } }

/** Every card is in view the moment it is observed. */
class AllInView {
  constructor(cb) { this.cb = cb }
  observe(el) { this.cb([{ target: el, isIntersecting: true }], this) }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

let net
beforeEach(() => {
  __resetBuiltCaches()
  window.localStorage.clear()
  vi.stubGlobal('IntersectionObserver', AllInView)
  net = installFetch([
    ['GET', '/vocabulary', () => CATALOG],
    ['GET', '/api/j2/accounts', () => ({ accounts: [{ id: 'a1', name: 'Swing' }] })],
    ['GET', '/shelf', () => ({ examples: SHELF })],
    ['GET', '/w1', () => SAVED_W1],
    ['POST', '/preview', () => payload()],
    ['POST', '/examples', (req) => ({ sample: true, cards: Object.fromEntries(req.body.ids.map((id) => [id, payload({ sample: true })])) })],
  ])
})
afterEach(async () => {
  // Close any builder the door opened (its own root), so the next test's door starts free.
  // (The builder's Sheet is portalled to <body>: the topmost panel is the builder's while its root is there.)
  if (document.querySelector('[data-widget-builder-root]')) {
    const panels = document.querySelectorAll('[data-sheet-panel]')
    fireEvent.keyDown(panels[panels.length - 1] || document.body, { key: 'Escape' })
  }
  await waitFor(() => expect(document.querySelectorAll('[data-widget-builder-root]')).toHaveLength(0))
  cleanup()
  vi.unstubAllGlobals()
})

async function openMyTools(props = {}) {
  const onClose = vi.fn()
  render(<MyToolsSheet onClose={onClose} uid="u1" {...props} />)
  await screen.findByRole('heading', { name: /widgets?$/ })
  return { onClose }
}

describe('the gallery door, with nothing on the path mocked', () => {
  it('CONTROL: "Open" on a saved widget opens the builder on it, with no gallery', async () => {
    await openMyTools()
    fireEvent.click(screen.getByRole('button', { name: 'Open Net P&L by setup' }))
    expect(await screen.findByRole('dialog', { name: 'Edit widget' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: GALLERY_TITLE })).toBeNull()
  })

  it('R-44: My tools’ "Build a widget" opens "Start from an example"', async () => {
    await openMyTools()
    fireEvent.click(screen.getByRole('button', { name: /Build a widget/ }))
    expect(await screen.findByRole('heading', { name: GALLERY_TITLE })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(SHELF.length))
    expect(net.calls.some((c) => c.method === 'GET' && c.path === '/shelf')).toBe(true)
  })

  it('R-45: the door forwards navigate; a banner link navigates and closes BOTH sheets', async () => {
    const navigate = vi.fn()
    const { onClose } = await openMyTools({ navigate })
    fireEvent.click(screen.getByRole('button', { name: /Build a widget/ }))
    const banner = await screen.findByTestId('sample-banner')
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(within(banner).getByRole('link', { name: 'Link broker' }))
    expect(navigate).toHaveBeenCalledWith(LINK_BROKER_HREF)
    expect(onClose).toHaveBeenCalled()                                          // My tools closed
    await waitFor(() => expect(document.querySelectorAll('[data-widget-builder-root]')).toHaveLength(0))
    expect(push).not.toHaveBeenCalled()
  })
})

// ── the AST rail ────────────────────────────────────────────────────────────────────────────────
const SRC = join(process.cwd(), 'src')
const JsxParser = Parser.extend(jsx())

function sources(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== '__fixtures__') sources(p, out) } else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}

/** Every `openWidgetBuilder(...)` / `x.openWidgetBuilder(...)` call in `src`, with whether it names `from` and `start`
 *  (a spread `...(from ? {} : { start })` counts as naming start). */
export function builderCalls(src, file = 'x.jsx') {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const out = []
  walk(ast, (n) => {
    if (n.type !== 'CallExpression') return
    const c = n.callee
    const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null
    if (name !== 'openWidgetBuilder') return
    const arg = n.arguments[0]
    const keys = new Set()
    let spreadStart = false
    if (arg && arg.type === 'ObjectExpression') {
      for (const p of arg.properties) {
        if (p.type === 'Property' && !p.computed) keys.add(p.key.name || p.key.value)
        if (p.type === 'SpreadElement') walk(p.argument, (m) => { if (m.type === 'Property' && (m.key.name === 'start')) spreadStart = true })
      }
    }
    out.push({ file, line: n.loc.start.line, from: keys.has('from'), start: keys.has('start') || spreadStart, object: arg?.type === 'ObjectExpression' })
  })
  return out
}

describe('every door that opens a NEW widget says where the builder starts', () => {
  it('each openWidgetBuilder call without `from` passes `start` (non-vacuity: the My tools door is found)', () => {
    const calls = []
    for (const f of sources()) {
      const text = readFileSync(f, 'utf8')
      if (!text.includes('openWidgetBuilder(')) continue
      calls.push(...builderCalls(text, relative(SRC, f).replace(/\\/g, '/')))
    }
    expect(calls.some((c) => c.file.endsWith('myTools/WidgetsTab.jsx'))).toBe(true)
    const bad = calls.filter((c) => c.object && !c.from && !c.start).map((c) => `${c.file}:${c.line}`)
    expect(bad).toEqual([])
  })

  it('CONTROL: a door with no `from` and no `start` is SEEN; `from`, `start` or the conditional spread pass', () => {
    const at = (code) => builderCalls(code)[0]
    expect(at('openWidgetBuilder({ editor: null, uid })')).toMatchObject({ from: false, start: false })
    expect(at('mod.openWidgetBuilder({ editor, from: { defId } })')).toMatchObject({ from: true })
    expect(at("openWidgetBuilder({ editor, start: 'examples' })")).toMatchObject({ start: true })
    expect(at("m.openWidgetBuilder({ from, ...(from ? {} : { start: 'examples' }) })")).toMatchObject({ start: true })
  })
})
