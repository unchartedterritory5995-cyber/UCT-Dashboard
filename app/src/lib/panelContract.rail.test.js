// app/src/lib/panelContract.rail.test.js
//
// ─── TERM-024 — THE RAIL: A PANEL GETS A HANDLE, NEVER A URL ─────────────────
//
//     cd app && npx vitest run src/lib/panelContract.rail.test.js
//
// Two rails over the contract in `panelContract.js`, and they fail for
// different reasons — keep both:
//
//   (a) TRANSPORT OWNERSHIP. Constructing a push transport (`EventSource`,
//       `WebSocket`) is confined to the pool entry points the contract imports.
//       Every other module under `app/src` — every panel, hook and page — gets
//       a handle from `declareNeed`, never a URL. A NEW module that constructs
//       one fails BY NAME, with the line.
//
//   (b) DELIVERY SEMANTICS. Every `declareNeed(...)` call site passes an object
//       literal that states `delivery`. No default exists at runtime either, but
//       a runtime throw only fires when the code runs; this fails in CI at the
//       call site.
//
// ── THE POPULATION IS DERIVED, NEVER TYPED ──────────────────────────────────
//
// ⭐ Every non-test `.js`/`.jsx` module under `app/src`, enumerated from disk and
// parsed — no directory is named, so a panel added tomorrow is examined the day
// it lands. A "panel" for this rail is every module that is NOT a declared
// transport owner; the owners themselves are DERIVED from the contract module's
// own import statements (not retyped here), and each of them must actually own
// a transport or the rail refuses — so an unrelated import slipped into the
// contract cannot quietly widen the allow-list.
//
// ⛔ AN AST, NEVER A GREP. Only a parsed `new` expression is a construction: the
// words "EventSource" and "WebSocket" appear in a dozen comments across the tree
// (StockChart, streamStatus, chartSection, J2PriceProvider…), and a text search
// would report every one. The constructor names are also ASSEMBLED from
// fragments below, so this file's own source can never be read as a match.
//
// ── THE RATCHET — WHY NOT "ZERO VIOLATORS" ──────────────────────────────────
//
// Measured on this tree when the rail was written, four modules outside the
// pools construct a transport. Migrating them is the L-sized retrofit TERM-024
// exists to stop from GROWING; it is not this ticket. So `BASELINE` records
// them by name with the reason each is there, and:
//   • a violator NOT in the baseline fails by name (the thing being prevented);
//   • a baseline entry that no longer violates fails too ("drop it") — a list
//     that can only grow is a list nobody reads again;
//   • a baseline entry whose file is gone fails ("deleted — drop it").
// The baseline stores NAMES, never a count; every number printed is derived.
//
// ── WHAT IT DOES NOT CATCH, STATED ──────────────────────────────────────────
//
// `fetch()` with a streamed body (the Ask-AI token streams) is request-scoped
// and takes no subscriber slot, so it is out of scope. `Reflect.construct` and
// constructors reached through a computed property are not recognised. A
// module-level alias (`const ES = window.EventSource`, or a destructured one) IS
// recognised, and a control below proves it.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`panelContract.rail: could not find the repo root from ${process.cwd()}`)
})()

const SRC = path.join(ROOT, 'app', 'src')
const CONTRACT = path.join(SRC, 'lib', 'panelContract.js')

/** ⚠️ CRLF NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout. */
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const key = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')
const abs = (k) => path.join(ROOT, ...k.split('/'))

const parse = (src) => Parser.extend(jsx()).parse(src, {
  ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true, locations: true,
})

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}

// ⛔ ASSEMBLED, never written whole: this file is itself a source file, and a
// literal constructor name here would be the first thing a careless probe finds.
const TRANSPORT_CTORS = new Set([['Event', 'Source'].join(''), ['Web', 'Socket'].join('')])

function* sourceFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      yield* sourceFiles(p)
    } else if (/\.jsx?$/.test(e.name) && !/\.(test|spec)\.jsx?$/.test(e.name)) {
      // ⚠️ Test files are out of scope on purpose: a test's fake transport is
      // not a member-facing connection. `test-setup.js` DEFINES a stand-in
      // class and constructs nothing, so it is scanned and is clean.
      yield p
    }
  }
}

/** The whole tree as `key -> source`. Overridable, so a control can plant a
 *  fixture panel without writing anything to disk. */
function treeSources() {
  const out = new Map()
  for (const f of sourceFiles(SRC)) out.set(key(f), read(f))
  return out
}

const ctorName = (callee) => {
  if (callee?.type === 'Identifier') return callee.name
  if (callee?.type === 'MemberExpression' && !callee.computed) return callee.property?.name
  return null
}

/**
 * Every push-transport CONSTRUCTION in one source, as `{line, ctor}`.
 *
 * Recognised: `new EventSource(…)`, `new window.WebSocket(…)` (any object), and
 * a `new X(…)` where X was bound to one of those — `const X = EventSource`,
 * `const X = globalThis.EventSource`, `const { EventSource: X } = window`.
 */
const SITE_CACHE = new Map()
export function transportSites(source) {
  // Keyed on the source text itself, so a planted fixture or an edited contract
  // is always re-read — only an identical source reuses a parse.
  if (!SITE_CACHE.has(source)) SITE_CACHE.set(source, readTransportSites(source))
  return SITE_CACHE.get(source)
}

function readTransportSites(source) {
  const tree = parse(source)
  const aliases = new Map()
  walk(tree, (n) => {
    if (n.type !== 'VariableDeclarator') return
    if (n.id?.type === 'Identifier' && TRANSPORT_CTORS.has(ctorName(n.init))) {
      aliases.set(n.id.name, ctorName(n.init))
    }
    if (n.id?.type === 'ObjectPattern') {
      for (const p of n.id.properties) {
        if (p.type !== 'Property' || p.computed) continue
        const name = p.key?.type === 'Identifier' ? p.key.name : p.key?.value
        if (TRANSPORT_CTORS.has(name) && p.value?.type === 'Identifier') aliases.set(p.value.name, name)
      }
    }
  })
  const out = []
  walk(tree, (n) => {
    if (n.type !== 'NewExpression') return
    const name = ctorName(n.callee)
    const resolved = TRANSPORT_CTORS.has(name) ? name
      : (n.callee?.type === 'Identifier' && aliases.get(name)) || null
    if (resolved) out.push({ line: n.loc.start.line, ctor: resolved })
  })
  return out
}

const CODE_EXT = ['.js', '.jsx']
/** Resolve a RELATIVE specifier from `fromKey` to a tree key, or null. */
function resolveKey(fromKey, spec, tree) {
  if (!spec.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromKey), spec))
  for (const c of [base, ...CODE_EXT.map((e) => base + e), ...CODE_EXT.map((e) => `${base}/index${e}`)]) {
    if (tree.has(c)) return c
  }
  return null
}

const CONTRACT_KEY = key(CONTRACT)

/**
 * The transport OWNERS, derived from the contract module's own imports.
 * ⛔ Raises rather than returning `[]` — an empty owner set would make every
 * transport in the tree a violator, and an unreadable contract must never read
 * as a verdict about the panels.
 */
export function transportOwners(tree) {
  const src = tree.get(CONTRACT_KEY)
  if (!src) throw new Error(`panelContract.rail: ${CONTRACT_KEY} is not in the tree`)
  const owners = []
  walk(parse(src), (n) => {
    if (n.type !== 'ImportDeclaration') return
    const k = resolveKey(CONTRACT_KEY, n.source.value, tree)
    if (!k) throw new Error(`panelContract.rail: the contract imports ${n.source.value}, `
      + 'which does not resolve to a module under app/src — only pool entry points belong there')
    owners.push(k)
  })
  if (!owners.length) throw new Error('panelContract.rail: the contract imports no pool at all')
  return owners
}

/** Modules outside the owner set that construct a transport: `key -> sites`. */
export function violators(tree) {
  const owners = new Set(transportOwners(tree))
  const out = new Map()
  for (const [k, src] of tree) {
    if (owners.has(k)) continue
    const sites = transportSites(src)
    if (sites.length) out.set(k, sites)
  }
  return out
}

/** The ratchet: what is new, and what the baseline still claims but is gone. */
export function ratchetVerdict(found, baseline) {
  const added = [...found.keys()].filter((k) => !(k in baseline)).sort()
  const stale = Object.keys(baseline).filter((k) => !found.has(k)).sort()
  return { added, stale }
}

/**
 * The modules that constructed a transport OUTSIDE the pools when this rail was
 * written. It may only SHRINK: remove an entry in the same commit that moves the
 * module onto a handle (or deletes it).
 */
const BASELINE = {
  'app/src/hooks/useRealtimePrices.js':
    'the LEGACY one-connection-per-hook path, kept verbatim as the kill switch '
    + '(localStorage uct.ssePool.disabled). Retire it after the pooled path has '
    + 'weeks of green prod — CLAUDE.md, "SSE connection pooling".',
  'app/src/lib/chatStreamManager.js':
    'a shared pool, but for community chat, which the TERM-024 contract does not '
    + 'declare. Declaring it (with its delivery semantics) is part of the L-later half.',
  'app/src/pages/LiveFlowMassive.jsx':
    'the options tape (ledger F1) opens its tailer SSE inside the page — the one '
    + 'every-message-matters stream, with no shared client pool yet. PARTNER-OWNED '
    + 'consumer (ledger F1) — ack before any edit.',
  'app/src/useFlowWebSocket.js':
    'a dead client (ledger F1: "useFlowWebSocket.js dead client"), recorded in '
    + 'components/screener/reachable.test.js AWAITING_A_DECISION.',
}

/** Every `declareNeed(...)` call whose first argument does not state `delivery`,
 *  as `{line, why}`. Resolves the local name from the import, aliases included. */
export function undeclaredDelivery(fileKey, source, tree) {
  const tree_ = parse(source)
  const local = new Set()
  walk(tree_, (n) => {
    if (n.type !== 'ImportDeclaration') return
    const k = resolveKey(fileKey, n.source.value, tree)
    if (k !== CONTRACT_KEY) return
    for (const s of n.specifiers) {
      if (s.type === 'ImportSpecifier' && s.imported.name === 'declareNeed') local.add(s.local.name)
    }
  })
  const calls = []
  walk(tree_, (n) => {
    if (n.type !== 'CallExpression' || n.callee?.type !== 'Identifier' || !local.has(n.callee.name)) return
    const arg = n.arguments[0]
    const line = n.loc.start.line
    if (!arg || arg.type !== 'ObjectExpression') {
      calls.push({ line, ok: false, why: 'the spec is not an object literal, so its `delivery` cannot be checked here' })
      return
    }
    const has = arg.properties.some((p) => p.type === 'Property' && !p.computed
      && ((p.key.type === 'Identifier' && p.key.name === 'delivery')
        || (p.key.type === 'Literal' && p.key.value === 'delivery')))
    calls.push({ line, ok: has, why: has ? null : 'omits `delivery` — it is REQUIRED and has no default' })
  })
  return calls
}

// ─── the tree, read once ────────────────────────────────────────────────────
const TREE = treeSources()
const OWNERS = transportOwners(TREE)
const FOUND = violators(TREE)

const FIXTURE_KEY = 'app/src/pages/__term024_fixture__/FixturePanel.jsx'
const withFixture = (src) => new Map([...TREE, [FIXTURE_KEY, src]])

describe('TERM-024 — non-vacuity: the instrument can see before it judges', () => {
  it('the population is the real tree, and the derived denominator is printed', () => {
    const scanned = TREE.size
    const panels = scanned - OWNERS.length
    const compliant = panels - FOUND.size
    console.info(`[term-024] modules scanned ${scanned} · transport owners ${OWNERS.length} `
      + `(${OWNERS.join(', ')}) · panels ${panels} · compliant ${compliant} · `
      + `baselined violators ${FOUND.size}`)
    expect(scanned).toBeGreaterThan(500)
    expect(TREE.has('app/src/App.jsx')).toBe(true)
  })

  it('the owners are DERIVED from the contract, and each one really owns a transport', () => {
    expect(OWNERS).toContain('app/src/lib/priceStreamManager.js')
    expect(OWNERS).toContain('app/src/lib/barsStreamManager.js')
    const idle = OWNERS.filter((k) => transportSites(TREE.get(k)).length === 0)
    expect(idle, 'the contract imports these, but they construct no transport — only pool '
      + 'entry points may be imported into panelContract.js, because its imports ARE the '
      + 'allow-list').toEqual([])
  })

  it('a non-pool import into the contract is refused (the allow-list cannot widen quietly)', () => {
    const planted = new Map(TREE)
    planted.set(CONTRACT_KEY, `${TREE.get(CONTRACT_KEY)}\nimport './realtimeCandle'\n`)
    const owners = transportOwners(planted)
    const idle = owners.filter((k) => transportSites(planted.get(k)).length === 0)
    expect(idle).toEqual(['app/src/lib/realtimeCandle.js'])
  })

  it('the detector sees the plain, member, and aliased forms — and not a mention', () => {
    const ES = ['Event', 'Source'].join('')
    const WS = ['Web', 'Socket'].join('')
    expect(transportSites(`const es = new ${ES}('/api/stream/prices?tickers=A')`)).toHaveLength(1)
    expect(transportSites(`const ws = new window.${WS}(u)`)).toHaveLength(1)
    expect(transportSites(`const X = globalThis.${ES}\nconst es = new X(u)`)).toHaveLength(1)
    expect(transportSites(`const { ${WS}: W } = window\nnew W(u)`)).toHaveLength(1)
    expect(transportSites(`// new ${ES}('/x') in a comment\nconst s = '${ES}'`)).toEqual([])
    expect(transportSites(`class ${ES} { constructor(u) { this.u = u } }`)).toEqual([])
  })

  it('a KNOWN owner is detected with a real construction site', () => {
    const sites = transportSites(TREE.get('app/src/lib/priceStreamManager.js'))
    expect(sites.length).toBeGreaterThan(0)
  })
})

describe('TERM-024 (a) — transport construction is confined to the pools', () => {
  it('no NEW module constructs a transport outside the pools', () => {
    const { added } = ratchetVerdict(FOUND, BASELINE)
    const named = added.map((k) => `${k} (line ${FOUND.get(k).map((s) => s.line).join(', ')})`)
    expect(named, 'these modules construct a push transport themselves. A panel declares a '
      + 'need and gets a handle: `declareNeed({ kind, delivery })` from lib/panelContract.js. '
      + 'It never owns a transport, a budget or a freshness opinion (TERM-024).').toEqual([])
  })

  it('the baseline only shrinks — an entry that no longer violates must be dropped', () => {
    const { stale } = ratchetVerdict(FOUND, BASELINE)
    expect(stale, 'these no longer construct a transport outside the pools (or were deleted). '
      + 'Drop them from BASELINE in the same commit — the ratchet only moves one way.').toEqual([])
  })

  it('every baseline entry names a file that exists', () => {
    const gone = Object.keys(BASELINE).filter((k) => !fs.existsSync(abs(k)))
    expect(gone).toEqual([])
  })

  it('ACCEPTANCE (a): a fixture panel that opens a URL fails BY NAME — with a control', () => {
    const ES = ['Event', 'Source'].join('')
    const bad = withFixture(`export default function FixturePanel() {\n`
      + `  const es = new ${ES}('/api/stream/prices?tickers=NVDA')\n  return null\n}\n`)
    const verdict = ratchetVerdict(violators(bad), BASELINE)
    expect(verdict.added).toContain(FIXTURE_KEY)
    expect(violators(bad).get(FIXTURE_KEY)).toEqual([{ line: 2, ctor: ES }])

    // CONTROL — the same panel written the contract's way is NOT a violator.
    const good = withFixture(`import { declareNeed, DELIVERY } from '../../lib/panelContract'\n`
      + `const PRICES = declareNeed({ kind: 'prices', delivery: DELIVERY.LAST_VALUE_WINS })\n`
      + `export default function FixturePanel() { PRICES.subscribe(['NVDA'], () => {}); return null }\n`)
    expect(ratchetVerdict(violators(good), BASELINE).added).not.toContain(FIXTURE_KEY)
  })
})

describe('TERM-024 (b) — every declared need states its delivery semantics', () => {
  const CALLS = [...TREE].flatMap(([k, src]) => undeclaredDelivery(k, src, TREE).map((c) => ({ k, ...c })))

  it('non-vacuity: real call sites exist, so this is not a check over nothing', () => {
    expect(CALLS.some((c) => c.k === 'app/src/hooks/useRealtimeBars.js')).toBe(true)
  })

  it('no declareNeed call site omits `delivery`', () => {
    const bad = CALLS.filter((c) => !c.ok).map((c) => `${c.k}:${c.line} — ${c.why}`)
    expect(bad).toEqual([])
  })

  it('ACCEPTANCE (b): a fixture panel omitting delivery fails BY NAME — with a control', () => {
    const omit = `import { declareNeed as need } from '../../lib/panelContract'\n`
      + `const BARS = need({ kind: 'bars' })\n`
    const calls = undeclaredDelivery(FIXTURE_KEY, omit, withFixture(omit))
    expect(calls).toEqual([{ line: 2, ok: false, why: expect.stringContaining('omits `delivery`') }])

    const byVar = `import { declareNeed } from '../../lib/panelContract'\nconst s = { kind: 'bars' }\n`
      + `const BARS = declareNeed(s)\n`
    expect(undeclaredDelivery(FIXTURE_KEY, byVar, withFixture(byVar))[0].ok).toBe(false)

    // CONTROL — stating it passes, and an unrelated `declareNeed` is not ours.
    const stated = `import { declareNeed, DELIVERY } from '../../lib/panelContract'\n`
      + `const BARS = declareNeed({ kind: 'bars', delivery: DELIVERY.LAST_VALUE_WINS })\n`
    expect(undeclaredDelivery(FIXTURE_KEY, stated, withFixture(stated))).toEqual([
      { line: 2, ok: true, why: null }])
    const foreign = `import { declareNeed } from './somewhereElse'\ndeclareNeed({ kind: 'bars' })\n`
    expect(undeclaredDelivery(FIXTURE_KEY, foreign, withFixture(foreign))).toEqual([])
  })
})
