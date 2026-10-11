// @vitest-environment node
// P0.8: the Notebook's "Capture from anywhere" doors and the iPhone Shortcut how-to send a member
// to Settings > Connections. This holds the address they send them to against what Settings
// actually does with it.
//
// ⭐ Settings ALREADY deep-links a section: `?section=<id>` (read by `useSearchParams`, and what
// BrokerConnectionsCard, Support and the Journal tiles already link with). It has no `#hash`
// scheme and no per-section element id, so the doors use the existing address and Settings is not
// touched. This rail is what keeps that true: if the section id or the param is renamed, the doors
// would land on the Account tab and nothing else would notice.
//
// Read by acorn-jsx AST, never grep: a commented-out section is not a section.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { CONNECTIONS_PATH } from '../pages/journal-2-0/components/notebook/ShortcutHowTo'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, 'Settings.jsx'), 'utf8')

function walk(n, fn) {
  if (!n || typeof n.type !== 'string') return
  fn(n)
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}

/** { sectionIds: [...], params: [...], cards: {section: [cardId, ...]} } */
function settingsShape(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const sectionIds = []
  const params = []
  const cards = {}
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.name === 'SECTIONS' && n.init?.type === 'ArrayExpression') {
      for (const el of n.init.elements) {
        const id = el?.properties?.find((p) => p.key?.name === 'id')?.value?.value
        if (id) sectionIds.push(id)
      }
    }
    if (n.type === 'VariableDeclarator' && n.id?.name === 'sectionCards' && n.init?.type === 'ObjectExpression') {
      for (const p of n.init.properties) {
        if (p.type !== 'Property' || p.value.type !== 'ArrayExpression') continue
        cards[p.key.name ?? p.key.value] = p.value.elements
          .filter((e) => e?.type === 'CallExpression' && e.callee.name === 'card')
          .map((e) => e.arguments[0]?.value)
      }
    }
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression'
        && n.callee.object?.name === 'searchParams' && n.callee.property?.name === 'get'
        && typeof n.arguments[0]?.value === 'string') {
      params.push(n.arguments[0].value)
    }
  })
  return { sectionIds, params, cards }
}

describe('Settings > Connections is reachable by the address the Notebook doors use (P0.8)', () => {
  const shape = settingsShape(SRC)
  const url = new URL(CONNECTIONS_PATH, 'https://uct.test')

  it('NON-VACUITY: the parse found the section list, the param reads and the card map', () => {
    expect(shape.sectionIds.length).toBeGreaterThan(4)
    expect(shape.params).toContain('section')
    expect(Object.keys(shape.cards).length).toBeGreaterThan(4)
  })

  it('the doors point at /settings and name a section Settings actually has', () => {
    expect(url.pathname).toBe('/settings')
    const section = url.searchParams.get('section')
    expect(section).toBe('connections')
    expect(shape.sectionIds).toContain(section)
  })

  it('Settings reads that very param (the address does something)', () => {
    expect(shape.params).toContain([...url.searchParams.keys()][0])
  })

  it('the Connections section holds the three cards the doors talk about', () => {
    expect(shape.cards.connections).toEqual(expect.arrayContaining(['browserCapture', 'personalApi', 'inboundEmail']))
  })

  it('CONTROL: a section that is not in the list is not found', () => {
    const src = [
      "const SECTIONS = [{ id: 'account' }, /* { id: 'connections' } */]",
      'function S() { const [searchParams] = useSearchParams(); return searchParams.get(\'section\') }',
    ].join('\n')
    expect(settingsShape(src).sectionIds).toEqual(['account'])
    expect(settingsShape(src).params).toEqual(['section'])
  })
})
