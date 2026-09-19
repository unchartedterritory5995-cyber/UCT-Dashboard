// app/src/components/chart/builder/memberPane/memberPaneWire.test.js
//
// ─── ⛔⛔ THE WIRE, NOT THE COMPONENT ────────────────────────────────────────
//
// `MemberPane.test.jsx` mocks `ChartPane` and proves what the pane does when
// something renders it. Until 2026-09-12 nothing did: the component had zero
// importers outside its own tests, so "renders nothing when the flag is off"
// was a claim about a surface no member could reach, and its flag-off rail was
// vacuous by construction.
//
// ⭐ THIS FILE IS THE OTHER HALF, AND IT FAILS FOR A DIFFERENT REASON. It reads
// `BuilderSheet.jsx`'s OWN AST and asserts the pane is mounted there and handed
// the member's PASTED script. Cut the wire and every component test stays green
// — that is the shape this repo has been bitten by repeatedly (eight features
// built, tested, green, and connected to nothing).
//
// ⛔ AN AST, NEVER A GREP. A `grep MemberPane BuilderSheet.jsx` matches the
// comment above the mount, matches an import that is never rendered, and
// matches this very sentence if the needle is typed rather than built. The
// prose here would satisfy a text search for every claim it makes.
import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const SHEET = path.resolve(__dirname, '../BuilderSheet.jsx')

function parse(src) {
  return JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
}

/** Every JSX element in the tree, by tag name. */
function elements(ast) {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.type === 'JSXElement') {
      const name = n.openingElement && n.openingElement.name
      out.push({ tag: name && name.name, node: n })
    }
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
      walk(n[k])
    }
  }
  walk(ast)
  return out
}

function propOf(el, prop) {
  const attrs = (el.node.openingElement && el.node.openingElement.attributes) || []
  const a = attrs.find((x) => x.type === 'JSXAttribute' && x.name && x.name.name === prop)
  if (!a || !a.value) return null
  if (a.value.type === 'JSXExpressionContainer') return a.value.expression
  return a.value
}

function defaultImportsOf(ast) {
  const out = new Map()
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    for (const s of node.specifiers) {
      if (s.type === 'ImportDefaultSpecifier') out.set(s.local.name, node.source.value)
    }
  }
  return out
}

describe('the member pane is WIRED, and to the pasted script', () => {
  const src = fs.readFileSync(SHEET, 'utf8')
  const ast = parse(src)
  const els = elements(ast)

  it('⭐ BuilderSheet imports it as a default import from the memberPane module', () => {
    const imports = defaultImportsOf(ast)
    expect(imports.get('MemberPane'), 'BuilderSheet no longer imports MemberPane')
      .toBe('./memberPane/MemberPane')
    // Control: the probe can see a sibling it is not looking for, so an empty
    // result means "absent" rather than "the walk found nothing at all".
    expect(imports.get('PreviewPane')).toBe('./editor/PreviewPane')
  })

  it('⛔ and RENDERS it — an import nobody mounts draws nothing', () => {
    const mounts = els.filter((e) => e.tag === 'MemberPane')
    expect(mounts.length, 'MemberPane is imported but never rendered').toBe(1)
    // Control again: the element walk really does find elements.
    expect(els.filter((e) => e.tag === 'PreviewPane').length).toBe(1)
  })

  it('⛔⛔ its `source` is `pineText`, NOT the sheet\'s single-tree `source`', () => {
    const el = els.find((e) => e.tag === 'MemberPane')
    const prop = propOf(el, 'source')
    expect(prop, 'MemberPane is mounted with no `source` — it would render null forever')
      .toBeTruthy()
    expect(prop.type).toBe('Identifier')
    // `source` is the FORMULA this sheet edits, already drawn by `PreviewPane`.
    // Feeding it here would put a second drawing of one tree on screen and none
    // of the member's document — four drawn series on v2, and the disclosures.
    expect(prop.name).toBe('pineText')
    expect(prop.name).not.toBe('source')
  })

  it('⭐ it is given the symbol and timeframe the sheet was opened over', () => {
    const el = els.find((e) => e.tag === 'MemberPane')
    for (const prop of ['sym', 'tf']) {
      const v = propOf(el, prop)
      expect(v, `MemberPane is mounted without \`${prop}\``).toBeTruthy()
      expect(v.type).toBe('Identifier')
      expect(v.name).toBe(prop)
    }
  })

  it('⛔ the call site adds NO second flag check — one authority over one value', () => {
    // `memberPaneEnabled()` is read inside the component, before any build. A
    // guard here would be a second place to get it wrong, and the rails measure
    // the inner one. (An `&&` in front of the element would show up as the
    // element sitting inside a LogicalExpression.)
    const el = els.find((e) => e.tag === 'MemberPane')
    const parents = []
    const walk = (n, chain) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) { n.forEach((c) => walk(c, chain)); return }
      if (n === el.node) { parents.push(...chain); return }
      for (const k of Object.keys(n)) {
        if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
        walk(n[k], [n.type, ...chain])
      }
    }
    walk(ast, [])
    expect(parents[0]).not.toBe('LogicalExpression')
    expect(parents[0]).not.toBe('ConditionalExpression')

    // ⚰️ AND THE CHECK IS OVER CODE, NOT TEXT. The first cut of this assertion
    // was `expect(src).not.toMatch(/memberPaneEnabled/)` and it went red against
    // the COMMENT above the mount, which says the flag is read inside the
    // component. A needle that matches the sentence explaining its own absence
    // is this repo's most repeated instrument defect — six in one day.
    const calls = []
    const gateImports = []
    const scan = (n) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) { n.forEach(scan); return }
      if (n.type === 'CallExpression' && n.callee && n.callee.type === 'Identifier') {
        calls.push(n.callee.name)
      }
      if (n.type === 'ImportDeclaration' && /memberPaneGate/.test(n.source.value)) {
        gateImports.push(n.source.value)
      }
      for (const k of Object.keys(n)) {
        if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
        scan(n[k])
      }
    }
    scan(ast)
    expect(calls).not.toContain('memberPaneEnabled')
    expect(gateImports).toEqual([])
    // Control: the call walk really does see calls in this file.
    expect(calls.length).toBeGreaterThan(20)
  })
})
