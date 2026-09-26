// @vitest-environment node
// Wave 8 seam S8-5 — Settings MOUNTS the sharing card, beside the Personal API card.
//
// SharingCard renders nothing while both sharing gates are dark (its own rail), so a
// render of Settings could not tell "mounted and dark" from "never mounted". The mount is
// the controller's (Settings.jsx is nobody's lane this wave) and this is its rail: the
// card is imported from the lane's file and handed to `card('sharing', …)` in the
// CONNECTIONS section, immediately after `card('personalApi', …)`. Read by acorn-jsx AST,
// never grep: a commented-out mount is not a mount.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

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

/** { imports: {local: source}, sections: {name: [[cardId, jsxElementName], …]} } */
function settingsShape(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const imports = {}
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration') continue
    for (const s of n.specifiers) if (s.type === 'ImportDefaultSpecifier') imports[s.local.name] = n.source.value
  }
  const sections = {}
  walk(ast, (n) => {
    if (n.type !== 'VariableDeclarator' || n.id?.name !== 'sectionCards' || n.init?.type !== 'ObjectExpression') return
    for (const p of n.init.properties) {
      if (p.type !== 'Property' || p.value.type !== 'ArrayExpression') continue
      const name = p.key.name ?? p.key.value
      sections[name] = p.value.elements
        .filter((e) => e?.type === 'CallExpression' && e.callee.name === 'card')
        .map((e) => [e.arguments[0]?.value, e.arguments[1]?.type === 'JSXElement'
          ? e.arguments[1].openingElement.name.name : null])
    }
  })
  return { imports, sections }
}

describe('Settings mounts the sharing card (S8-5)', () => {
  const { imports, sections } = settingsShape(SRC)

  it('NON-VACUITY — the parse found the section map and the Personal API card', () => {
    expect(Object.keys(sections).length).toBeGreaterThan(4)
    expect(sections.connections?.map(([id]) => id)).toContain('personalApi')
  })

  it('SharingCard is imported from the lane-8B file', () => {
    expect(imports.SharingCard).toBe('./journal-2-0/components/SharingCard')
  })

  it("card('sharing', <SharingCard />) sits in CONNECTIONS, right after personalApi", () => {
    const ids = sections.connections.map(([id]) => id)
    const at = ids.indexOf('personalApi')
    expect(sections.connections[at + 1], `connections are ${JSON.stringify(sections.connections)}`)
      .toEqual(['sharing', 'SharingCard'])
    // …and nowhere else.
    const everywhere = Object.values(sections).flat().filter(([, el]) => el === 'SharingCard')
    expect(everywhere).toHaveLength(1)
  })

  it('CONTROL — a commented-out mount is not a mount', () => {
    const src = [
      "import SharingCard from './journal-2-0/components/SharingCard'",
      'function S() {',
      "  const sectionCards = { connections: [card('personalApi', <P />), /* card('sharing', <SharingCard />) */] }",
      '  return sectionCards',
      '}',
    ].join('\n')
    expect(settingsShape(src).sections.connections).toEqual([['personalApi', 'P']])
  })
})
