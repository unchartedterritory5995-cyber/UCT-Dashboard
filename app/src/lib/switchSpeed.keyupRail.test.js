// ⛔ NO KEY-UP HANDLER SWITCHES A CHART'S SYMBOL (2026-11-23, review of #2641).
//
// The switch-speed instrument (lib/switchSpeed.js) times a switch from "the input event in flight" when the board's
// setGroupSym ran, and it knows a key event by its SHAPE, not its name (it spells no key event's name: the raw
// key-listener census counts those). So a key-UP in flight is a press to it as much as a key-down. Today that is
// harmless, because nothing switches a symbol from a key-up. If something ever did, the sample would start when the
// member LET GO of the key, up to a whole key-hold late, and the instrument would report the switch faster than it was.
//
// This rail holds "nothing does", from the SOURCE (an AST, comments are not in the tree):
//   · every key-up handler in app/src: a listener call with the literal name, a property assignment, a JSX prop
//     (bubble or capture), and, in a file that spells the name anywhere else, every listener registered through a
//     variable (how a dynamic registration shows up);
//   · each must be a function this file can SEE (written in place, or bound in the same file, through useCallback and
//     other wrappers); one it cannot see fails, by name, until someone has read it and listed it with a reason;
//   · none may call, itself or through same-file functions it calls, anything that moves a group's symbol (SWITCHERS);
//   · the shortcut registry binds handlers this scan cannot follow, so it must declare NO key-up shortcut at all
//     (a declared one fails here until its handler has been read and its id listed).
// NOT seen, said so nobody assumes otherwise: a switch reached through another FILE's function, or through a prop.
// The controls below prove each of the four shapes is found, that a comment is not, and that a key-DOWN is not.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { SHORTCUTS } from '../pages/command/shortcutRegistry'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..')
const ROOT = path.join(SRC, '..', '..')

// (built, so this file never spells the names the key-listener census counts)
const UP = 'key' + 'up'
const DOWN = 'key' + 'down'
const ADD = 'add' + 'EventListener'
const REMOVE = 'remove' + 'EventListener'
const JSX_PROPS = new Set(['onKey' + 'Up', 'onKey' + 'UpCapture'])
/** What moves a group's symbol: the board's setter, the group's own entry, and the names it travels under in the
 *  components between a control and the board (ChartsSymContext, WatchlistWidget, ChartPane, ChartWidget, the dock). */
const SWITCHERS = new Set([
  'setGroupSym', 'beginGroupSwitch', 'setSym', 'setHubSym', 'setChartSym', 'onSymbolChange', 'handleSymbolChange',
  'handleSearchedSymbol', 'changeSymbol', 'onPickSymbol', 'goToSym',
])
/** Key-up handlers this scan cannot see into, each READ by a person: 'repo path :: how' -> why it switches no symbol. */
const UNSEEN_OK = new Map([])
/** Key-up shortcuts of the registry, each READ by a person: id -> why its handler switches no symbol. */
const KEYUP_SHORTCUTS_OK = new Map([])
const MAX_DEPTH = 4

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
}
function staticString(n) {
  if (!n) return undefined
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked
  return undefined
}
function memberName(n) {
  if (!n || n.type !== 'MemberExpression') return null
  if (!n.computed && n.property.type === 'Identifier') return n.property.name
  return staticString(n.property) ?? null
}
const nameOf = (n) => (!n ? null : n.type === 'Identifier' ? n.name : memberName(n))
const isFn = (n) => !!n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration')
/** The function(s) an expression IS or wraps: itself, or the function arguments of a call (useCallback(fn), throttle(fn)). */
function functionsOf(node) {
  if (!node) return []
  if (isFn(node)) return [node]
  if (node.type === 'CallExpression') return node.arguments.flatMap(functionsOf)
  return []
}
/** name -> every function bound under that name anywhere in the file (a declaration, a const, an assignment, a property). */
function functionIndex(ast) {
  const fns = new Map()
  const add = (name, node) => {
    if (typeof name !== 'string') return
    for (const f of functionsOf(node)) { if (!fns.has(name)) fns.set(name, []); fns.get(name).push(f) }
  }
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) add(n.id.name, n)
    else if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') add(n.id.name, n.init)
    else if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') add(n.left.name, n.right)
    else if (n.type === 'Property' && !n.computed) add(n.key.type === 'Identifier' ? n.key.name : n.key.value, n.value)
    else if (n.type === 'MethodDefinition' && !n.computed && n.key.type === 'Identifier') add(n.key.name, n.value)
  })
  return fns
}

/** Every key-up handler of one parsed file: [{ how, node }] (`node` is the handler EXPRESSION). */
function keyupHandlers(ast) {
  const out = []
  const consumed = new Set()
  const throughAVariable = []
  walk(ast, (n) => {
    if (n.type === 'CallExpression') {
      const name = memberName(n.callee)
      if (name !== ADD && name !== REMOVE) return
      const type = staticString(n.arguments[0])
      if (type !== undefined) {
        consumed.add(n.arguments[0])
        if (name === ADD && type === UP && n.arguments[1]) out.push({ how: 'listener', node: n.arguments[1] })
      } else if (name === ADD && n.arguments[1]) throughAVariable.push(n.arguments[1])
    } else if (n.type === 'NewExpression') {
      const ctor = nameOf(n.callee)
      if (ctor && /Event$/.test(ctor) && n.arguments[0]) consumed.add(n.arguments[0])      // a dispatch, not a listener
    } else if (n.type === 'AssignmentExpression' && memberName(n.left) === 'on' + UP) {
      out.push({ how: 'property', node: n.right })
    } else if (n.type === 'JSXAttribute' && n.name.type === 'JSXIdentifier' && JSX_PROPS.has(n.name.name)
               && n.value && n.value.type === 'JSXExpressionContainer') {
      out.push({ how: 'jsx', node: n.value.expression })
    }
  })
  // the name spelled anywhere else is how a registration through a variable shows up: then EVERY such registration counts
  let spelled = false
  walk(ast, (n) => { if (staticString(n) === UP && !consumed.has(n)) spelled = true })
  if (spelled) for (const node of throughAVariable) out.push({ how: 'variable', node })
  return out
}

/** The switchers a function reaches, itself or through same-file functions it calls by name: ['setSym', 'go -> setSym']. */
function switchCalls(fn, fns, depth = 0, seen = new Set()) {
  if (seen.has(fn)) return []
  seen.add(fn)
  const hits = []
  walk(fn.body, (n) => {
    if (n.type !== 'CallExpression') return
    const name = nameOf(n.callee)
    if (!name) return
    if (SWITCHERS.has(name)) { hits.push(name); return }
    if (depth < MAX_DEPTH && n.callee.type === 'Identifier') {
      for (const g of fns.get(name) || []) for (const h of switchCalls(g, fns, depth + 1, seen)) hits.push(`${name} -> ${h}`)
    }
  })
  return hits
}

/** One source text: { handlers, switches: ['how: chain'], unseen: ['how'] }. */
function scan(src) {
  const ast = parse(src)
  const fns = functionIndex(ast)
  const found = keyupHandlers(ast)
  const switches = []
  const unseen = []
  for (const { how, node } of found) {
    const name = nameOf(node)
    if (name && SWITCHERS.has(name)) { switches.push(`${how}: ${name}`); continue }       // the switcher itself IS the handler
    const direct = functionsOf(node)
    const bodies = direct.length ? direct : (name ? fns.get(name) || [] : [])
    if (!bodies.length) { unseen.push(how + (name ? ` ${name}` : '')); continue }
    for (const fn of bodies) for (const chain of switchCalls(fn, fns)) switches.push(`${how}: ${chain}`)
  }
  return { handlers: found.length, switches, unseen }
}

function productFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) { if (ent.name !== 'node_modules') productFiles(p, out) }
    else if (/\.(m?jsx?|cjs)$/.test(ent.name) && !/\.(test|spec)\.[mc]?jsx?$/.test(ent.name)) out.push(p)
  }
  return out
}

let _tree = null
/** The whole of app/src, scanned once: { files, withHandlers: Map<repo path, result>, unparsed: [..] }. */
function tree() {
  if (_tree) return _tree
  const withHandlers = new Map()
  const unparsed = []
  let files = 0
  for (const f of productFiles(SRC)) {
    files += 1
    let r
    try { r = scan(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')) } catch (e) { unparsed.push(`${rel(f)}: ${e.message}`); continue }
    if (r.handlers) withHandlers.set(rel(f), r)
  }
  _tree = { files, withHandlers, unparsed }
  return _tree
}

describe('the scan sees what it must (controls)', () => {
  const press = (body) => `window.${ADD}('${UP}', ${body})`
  it('a listener, a property, a JSX prop and a JSX capture prop that switch the symbol are each found', () => {
    expect(scan(press("(e) => { setGroupSym('A', next(e)) }")).switches).toEqual(['listener: setGroupSym'])
    expect(scan(`el.on${UP} = function (e) { ws.setGroupSym('A', 'X') }`).switches).toEqual(['property: setGroupSym'])
    expect(scan(`const C = () => <input onKey${'Up'}={() => setSym(v)} />`).switches).toEqual(['jsx: setSym'])
    expect(scan(`const C = () => <div onKey${'Up'}Capture={(e) => props.onSymbolChange?.(e.target.value)} />`).switches).toEqual(['jsx: onSymbolChange'])
  })

  it('...through a name, a wrapper, and same-file functions it calls; and the switcher handed over as the handler itself', () => {
    expect(scan(`const go = (s) => setHubSym(s)\nfunction onUp(e) { if (e.key) go(e.key) }\n${press('onUp')}`).switches).toEqual(['listener: go -> setHubSym'])
    expect(scan(`const onUp = useCallback((e) => { changeSymbol(e.key) }, [])\nconst C = () => <b onKey${'Up'}={onUp} />`).switches).toEqual(['jsx: changeSymbol'])
    expect(scan(`const C = ({ setSym }) => <input onKey${'Up'}={setSym} />`).switches).toEqual(['jsx: setSym'])
    expect(scan(`const a = () => b()\nconst b = () => c()\nconst c = () => beginGroupSwitch(s, g, x)\n${press('a')}`).switches).toEqual(['listener: b -> c -> beginGroupSwitch'])
  })

  it('...and a registration through a variable, in a file that spells the name', () => {
    const src = `for (const type of ['${DOWN}', '${UP}']) document.${ADD}(type, (e) => handleSymbolChange(pick(e)))`
    expect(scan(src)).toMatchObject({ handlers: 1, switches: ['variable: handleSymbolChange'] })
  })

  it('a handler it cannot see into is reported unseen, never passed', () => {
    expect(scan(`import { onUp } from './elsewhere'\n${press('onUp')}`)).toMatchObject({ handlers: 1, switches: [], unseen: ['listener onUp'] })
    expect(scan(`const C = (p) => <i onKey${'Up'}={p.onUp} />`)).toMatchObject({ handlers: 1, unseen: ['jsx onUp'] })
  })

  it('what is NOT a key-up handler that switches: a comment, a key-down, a dispatch, a removal, a handler that does something else', () => {
    expect(scan(`// window.${ADD}('${UP}', () => setGroupSym('A', 'X'))\nconst x = 1`)).toEqual({ handlers: 0, switches: [], unseen: [] })
    expect(scan(`window.${ADD}('${DOWN}', (e) => setGroupSym('A', next(e)))`)).toEqual({ handlers: 0, switches: [], unseen: [] })
    expect(scan(`document.dispatchEvent(new KeyboardEvent('${UP}', { key: 'a' })); setGroupSym('A', 'X')`)).toEqual({ handlers: 0, switches: [], unseen: [] })
    expect(scan(`window.${REMOVE}('${UP}', () => setGroupSym('A', 'X'))`)).toEqual({ handlers: 0, switches: [], unseen: [] })
    expect(scan(press('(e) => { latch.delete(e.code) }'))).toEqual({ handlers: 1, switches: [], unseen: [] })
  })
})

describe('no key-up handler in app/src switches a symbol', () => {
  it('the scan is not vacuous: every product file parsed, and the key-up handlers known today are among those found', () => {
    const t = tree()
    expect(t.unparsed, 'a file this rail could not parse is a file it did not check').toEqual([])
    expect(t.files).toBeGreaterThan(1000)
    const found = [...t.withHandlers.keys()]
    for (const known of [
      'app/src/components/chart/engine/serverCompute.js',        // the held-key walk detector
      'app/src/components/chart/keyboardShortcuts.js',           // the shift latch
      'app/src/pages/charts/popout/PopoutWindow.jsx',            // the pop-out's key relay
      'app/src/pages/command/shortcutRegistry.js',               // registered through a variable
    ]) expect(found, known).toContain(known)
  })

  it('none of them switches a symbol, itself or through a same-file function', () => {
    const bad = []
    for (const [file, r] of tree().withHandlers) for (const s of r.switches) bad.push(`${file} :: ${s}`)
    expect(bad, 'A KEY-UP HANDLER SWITCHES A SYMBOL. The switch-speed instrument would time it from the key\'s RELEASE. Switch on the key-down, or teach lib/switchSpeed.js to tell them apart first.').toEqual([])
  })

  it('every one of them is a function this rail can see into (or has been read, and listed with why)', () => {
    const unseen = []
    for (const [file, r] of tree().withHandlers) for (const how of r.unseen) unseen.push(`${file} :: ${how}`)
    expect(unseen.filter((u) => !UNSEEN_OK.has(u)), 'READ the handler; if it switches no symbol, list it in UNSEEN_OK with why').toEqual([])
    expect([...UNSEEN_OK.keys()].filter((u) => !unseen.includes(u)), 'listed, but no longer in the source: drop the line').toEqual([])
    for (const [u, why] of UNSEEN_OK) expect(String(why).length, u).toBeGreaterThan(10)
  })

  it('the shortcut registry declares no key-up shortcut (its handlers are bound where this scan cannot follow)', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0)
    const up = SHORTCUTS.filter((d) => d.type === UP).map((d) => d.id)
    expect(up.filter((id) => !KEYUP_SHORTCUTS_OK.has(id)), 'READ its handler; if it switches no symbol, list the id in KEYUP_SHORTCUTS_OK with why').toEqual([])
    expect([...KEYUP_SHORTCUTS_OK.keys()].filter((id) => !up.includes(id)), 'listed, but no longer declared: drop the line').toEqual([])
  })
})
