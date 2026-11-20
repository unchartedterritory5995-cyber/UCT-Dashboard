// app/src/components/terminal/watchMarks.rail.test.js
//
// ─── NOTHING BARE FOLLOWS A KIT SYMBOL CELL ──────────────────────────────────────────────────
//
//     cd app && npx vitest run src/components/terminal/watchMarks.rail.test.js --maxWorkers=2
//
// The watchlist mark (WatchMark.jsx) takes NO width when the kit's symbol cell is the last
// ELEMENT in a table cell: the star hangs in the cell's padding, so marking a name never moves a
// column (PanelSymbol.module.css). CSS decides that with `:last-child`, and `:last-child` cannot
// see bare text. So `<td><PanelSymbol sym={s} />{' · '}{name}</td>` would draw the star on top of
// the text that follows it.
//
// THE RULE: after a `<PanelSymbol>` / `<PanelTicker>`, a parent's remaining children are elements
// (or an expression that is an element or nothing), never bare text or a text-valued expression,
// unless a plain element also follows (then the cell is not the last child and the mark sits in
// the line). The fix is always the same and changes nothing on screen: wrap the text in a span.
//
// The population is derived: every non-test .jsx under src/ that mentions either component. The
// rule also runs against in-memory fixtures that MUST fail, so it cannot pass by saying yes.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const SRC = path.join(process.cwd(), 'src')
const CELLS = new Set(['PanelSymbol', 'PanelTicker'])
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '__fixtures__' || name === '__snapshots__') continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.jsx') && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

/** What an expression can put on screen: 'element', 'nothing', or 'text' (anything we cannot
 *  prove is one of the first two). */
function kindsOf(expr) {
  if (!expr) return ['nothing']
  switch (expr.type) {
    case 'JSXElement': case 'JSXFragment': return ['element']
    case 'JSXEmptyExpression': return ['nothing']
    case 'Literal': return expr.value === null || expr.value === false || expr.value === '' ? ['nothing'] : ['text']
    case 'Identifier': return expr.name === 'undefined' ? ['nothing'] : ['text']
    case 'ConditionalExpression': return [...kindsOf(expr.consequent), ...kindsOf(expr.alternate)]
    case 'LogicalExpression': return expr.operator === '&&' ? kindsOf(expr.right) : [...kindsOf(expr.left), ...kindsOf(expr.right)]
    default: return ['text']
  }
}

/** Every place where bare text can follow a kit symbol cell. Pure over source text. */
export function bareTextAfterCell(source, file = 'fixture') {
  const hits = []
  const visit = (node, parents) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'JSXElement' && CELLS.has(node.openingElement.name?.name)) check(node, parents)
    for (const key of Object.keys(node)) {
      const v = node[key]
      if (Array.isArray(v)) v.forEach((c) => visit(c, [...parents, node]))
      else if (v && typeof v.type === 'string') visit(v, [...parents, node])
    }
  }
  const check = (cell, parents) => {
    let child = cell
    for (let i = parents.length - 1; i >= 0; i -= 1) {
      const parent = parents[i]
      if (parent.type === 'JSXElement' || parent.type === 'JSXFragment') {
        const after = parent.children.slice(parent.children.indexOf(child) + 1)
        let text = null
        let element = false
        for (const sib of after) {
          if (sib.type === 'JSXElement') { element = true; break }
          if (sib.type === 'JSXText') { if (sib.value.trim() && !text) text = sib } else if (sib.type === 'JSXExpressionContainer') {
            if (kindsOf(sib.expression).includes('text') && !text) text = sib
          } else if (sib.type === 'JSXFragment' && !text) text = sib   // not looked into: say so
        }
        if (element) return                     // an element follows: the mark sits in the line
        if (text) { hits.push(`${file}:${text.loc.start.line}`); return }
        if (parent.type === 'JSXElement') return // nothing follows inside its real parent
        child = parent                           // a fragment: its own siblings are the cell's
      } else if (['JSXExpressionContainer', 'ConditionalExpression', 'LogicalExpression', 'ParenthesizedExpression'].includes(parent.type)) {
        child = parent
      } else {
        return                                   // a callback or a component root: no known siblings
      }
    }
  }
  visit(parse(source), [])
  return hits
}

describe('the rule can fail', () => {
  const wrap = (body) => `export default function F({ s, name, self }) { return <table><tbody><tr>${body}</tr></tbody></table> }`
  it.each([
    ['a string expression', `<td><PanelSymbol sym={s} />{' · '}{name}</td>`],
    ['bare text', `<td><PanelSymbol sym={s} /> shares</td>`],
    ['a value', `<td><PanelSymbol sym={s} />{name}</td>`],
    ['text after a fragment that ends in the cell', `<td><><PanelSymbol sym={s} /></>{name}</td>`],
    ['a conditional that can be text', `<td><PanelTicker sym={s} />{self ? ' (this stock)' : null}</td>`],
    ['a cell chosen by a conditional, then text', `<td>{s ? <PanelSymbol sym={s} /> : 'n/a'}{name}</td>`],
  ])('%s after the cell is caught', (_label, body) => {
    expect(bareTextAfterCell(wrap(body))).toHaveLength(1)
  })

  it.each([
    ['the cell alone', `<td><PanelSymbol sym={s} /></td>`],
    ['an element after it', `<td><PanelSymbol sym={s} /><span>{' · '}</span>{name}</td>`],
    ['an element or nothing after it', `<td><PanelSymbol sym={s} />{self ? <span> (this stock)</span> : null}</td>`],
    ['text before it', `<td>{name} <PanelSymbol sym={s} /></td>`],
    ['a cell chosen by a conditional', `<td>{s ? <PanelSymbol sym={s} /> : 'n/a'}</td>`],
    ['cells from a map', `<td>{[s].map((x) => <PanelSymbol key={x} sym={x} />)}</td>`],
    ['a label inside the cell', `<td><PanelTicker sym={s}><span>{s}</span></PanelTicker></td>`],
  ])('%s passes', (_label, body) => {
    expect(bareTextAfterCell(wrap(body))).toEqual([])
  })
})

describe('every page and panel that draws a kit symbol cell', () => {
  const files = walk(SRC).filter((f) => /<Panel(Symbol|Ticker)\b/.test(fs.readFileSync(f, 'utf8')))

  it('the population is real (the kit cell is used in many lists)', () => {
    expect(files.length).toBeGreaterThan(25)
  })

  it('puts no bare text straight after it', () => {
    const hits = files.flatMap((f) => bareTextAfterCell(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), path.relative(SRC, f).split(path.sep).join('/')))
    expect(hits, `wrap the text that follows the symbol in a <span>:\n${hits.join('\n')}`).toEqual([])
  })
})
