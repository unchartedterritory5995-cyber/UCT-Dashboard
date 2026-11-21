// app/src/components/chart/visibleRangeSubscription.test.js
//
// ⛔⛔ A LIGHTWEIGHT CHARTS `subscribe*` RETURNS NOTHING, SO ITS RETURN VALUE IS NEVER AN UNSUBSCRIBE.
// (2026-11-20, the per-switch memory leak: see visibleRangeSubscription.js.)
//
//   1. onVisibleLogicalRange subscribes once and its return value really removes the handler.
//   2. THE SCAN: nowhere in app/src is the return value of a library `subscribe*` stored (`x = ….subscribeX(…)`),
//      which is the shape of all three leaks. Parsed (acorn + jsx), so a string or a comment cannot trip or hide it;
//      with a control that the scanner finds the shape it hunts and passes the right one.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { onVisibleLogicalRange } from './visibleRangeSubscription'

describe('onVisibleLogicalRange', () => {
  it('subscribes once, and its return value removes exactly that handler (once)', () => {
    const live = new Set()
    const ts = { subscribeVisibleLogicalRangeChange: (h) => { live.add(h) }, unsubscribeVisibleLogicalRangeChange: (h) => { live.delete(h) } }
    const chart = { timeScale: () => ts }
    const a = () => {}
    const b = () => {}
    const offA = onVisibleLogicalRange(chart, a)
    const offB = onVisibleLogicalRange(chart, b)
    expect([...live]).toEqual([a, b])
    offA()
    expect([...live]).toEqual([b])
    offA()                              // twice is harmless
    expect([...live]).toEqual([b])
    offB()
    expect(live.size).toBe(0)
  })
  it('a library without the API subscribes nothing and hands back a no-op', () => {
    const off = onVisibleLogicalRange({ timeScale: () => { throw new Error('stub') } }, () => {})
    expect(() => off()).not.toThrow()
  })
})

// ── THE SCAN ──────────────────────────────────────────────────────────────────────────────────────────────────────
const LIB_SUBSCRIBE = new Set([
  'subscribeVisibleLogicalRangeChange', 'subscribeVisibleTimeRangeChange', 'subscribeCrosshairMove',
  'subscribeClick', 'subscribeDblClick', 'subscribeSizeChange', 'subscribeDataChanged',
])
const parser = Parser.extend(jsx())
const parse = (src) => parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true })
function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue
    const v = node[k]
    if (Array.isArray(v)) for (const c of v) walk(c, fn)
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}
/** A library subscribe whose RESULT is kept: `x = ….subscribeX(…)` or `const x = ….subscribeX(…)`. */
function keptSubscribes(src) {
  const out = []
  const isLibCall = (e) => e && e.type === 'CallExpression' && e.callee?.type === 'MemberExpression'
    && !e.callee.computed && LIB_SUBSCRIBE.has(e.callee.property?.name)
  walk(parse(src), (n) => {
    if (n.type === 'VariableDeclarator' && isLibCall(n.init)) out.push({ line: n.loc.start.line, name: n.init.callee.property.name })
    if (n.type === 'AssignmentExpression' && isLibCall(n.right)) out.push({ line: n.loc.start.line, name: n.right.callee.property.name })
  })
  return out
}
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app', 'src'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('visibleRangeSubscription.test: no app/src above the working directory')
})()
const SRC = path.join(ROOT, 'app', 'src')
function shipped(dir = SRC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__' && e.name !== '__fixtures__') shipped(p, acc); continue }
    if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) acc.push(p)
  }
  return acc
}

describe('⛔ THE SCAN: no library subscribe result is kept as an unsubscribe, anywhere in app/src', () => {
  it('CONTROL: the scanner finds the leak shape (all three of the 2026-11-20 forms) and passes the right one', () => {
    const bad = keptSubscribes([
      'function a(chart, redraw) { const unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(redraw); return () => unsub() }',
      'function b(chart, onRange) { let unsub = null; try { unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(onRange) } catch {} }',
      'function c(chart, h) { const off = chart.subscribeCrosshairMove(h) }',
    ].join('\n'))
    expect(bad.map((x) => x.name)).toEqual(['subscribeVisibleLogicalRangeChange', 'subscribeVisibleLogicalRangeChange', 'subscribeCrosshairMove'])
    expect(keptSubscribes([
      'function ok(chart, h) { const ts = chart.timeScale(); ts.subscribeVisibleLogicalRangeChange(h); return () => ts.unsubscribeVisibleLogicalRangeChange(h) }',
      'const facade = { sub: (h) => raw.subscribeVisibleLogicalRangeChange(h) }',   // forwarding the void is not keeping it
      "const s = 'x = ts.subscribeClick(h)'",                                     // a string is not code
    ].join('\n'))).toEqual([])
  })

  it('no shipped module keeps one', () => {
    const files = shipped()
    expect(files.length, 'the scan saw the source tree').toBeGreaterThan(500)
    const found = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      if (!/subscribe(VisibleLogicalRange|VisibleTimeRange|CrosshairMove|Click|DblClick|SizeChange|DataChanged)/.test(src)) continue
      let hits
      try { hits = keptSubscribes(src) } catch (e) { throw new Error(`could not parse ${path.relative(ROOT, f)}: ${e.message}`) }
      for (const h of hits) found.push(`${path.relative(ROOT, f).split(path.sep).join('/')}:${h.line} keeps ${h.name}(...)`)
    }
    expect(found, 'a library subscribe returns nothing: unsubscribe with the matching unsubscribe* call (visibleRangeSubscription.js)').toEqual([])
  })
})
