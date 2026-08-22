/**
 * 🔴 `fetch(url).then(r => r.json())` IS NOW A LIVE BUG, AND IT WAS COPIED AROUND.
 *
 * 55 routes were paywalled. A **402 answers JSON too** — `{"detail": "..."}` —
 * so a fetcher that never looks at the status hands a perfectly good OBJECT to
 * a consumer expecting an array. Every `!data` loading guard is skipped (an
 * error object is truthy), every `data.length === 0` empty guard is skipped
 * (`undefined === 0` is false), and `data.map(...)` throws. White screen.
 *
 * Four surfaces shipped that exact line: `Traders.jsx`, `Watchlists.jsx`,
 * `NewsFeed.jsx`, `TwitterAccountsPanel.jsx`.
 *
 * ⭐ THE FIX FOR THE FOUR IS `jsonFetcher`; THIS FILE IS THE FIX FOR THE FIFTH.
 * Patching the known four and stopping leaves the shape free to be copied into
 * the next page, which is how it got to four. The sweep below reads the tree
 * and fails on a new one the day it is written.
 *
 * ⛔ AN AST, NOT A GREP (`lesson_probe_names_must_be_derived_not_typed`): a grep
 * for `r.json()` matches this file's own prose and every comment quoting the
 * defect, and this repo has already measured a probe that "found 5 call sites,
 * all five of them prose".
 *
 * ⚠️ SCOPE, STATED OUT LOUD. This detects the ONE shape that actually
 * propagated — `fetch(…).then(<fn returning .json()>)` with no `ok` anywhere in
 * the handler. A multi-statement `await` chain that skips the check is the same
 * bug and is NOT caught here. Narrow and honest beats broad and vacuous; widen
 * it when a second shape is measured, not on suspicion.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

import jsonFetcher from './jsonFetcher'

const JSXParser = Parser.extend(jsx())

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'App.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`jsonFetcher probe: could not find the repo root from ${process.cwd()}`)
})()
const SRC = path.join(ROOT, 'app', 'src')

/** Every shipped source file. Tests are excluded: a fixture that fakes a bad
 *  fetch is not a surface a member can reach. */
function sourceFiles(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue
      sourceFiles(p, out)
    } else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach(c => walk(c, fn))
    else if (v && typeof v.type === 'string') walk(v, fn)
  }
}

/**
 * Offending `fetch(…).then(handler)` sites in one source string.
 *
 * ⛔ THE VERDICT IS STRUCTURAL, not textual: the handler must be the argument of
 * a `.then` whose OBJECT is a `fetch(…)` call. `somethingElse.then(r => r.json())`
 * is not this bug and is not reported.
 */
export function uncheckedJsonFetches(src) {
  let tree
  try {
    tree = JSXParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    return [] // not parseable as an ES module — nothing to claim about it
  }
  const hits = []
  walk(tree, (n) => {
    if (n.type !== 'CallExpression') return
    const callee = n.callee
    if (callee?.type !== 'MemberExpression') return
    if (callee.property?.name !== 'then') return
    const target = callee.object
    if (target?.type !== 'CallExpression' || target.callee?.type !== 'Identifier') return
    if (target.callee.name !== 'fetch') return

    const handler = n.arguments[0]
    if (!handler || (handler.type !== 'ArrowFunctionExpression' &&
                     handler.type !== 'FunctionExpression')) return

    // Does the handler parse the body, and does it consult the status first?
    let parses = false
    let checks = false
    walk(handler, (m) => {
      if (m.type === 'CallExpression' && m.callee?.type === 'MemberExpression' &&
          m.callee.property?.name === 'json') parses = true
      if (m.type === 'Identifier' && (m.name === 'ok' || m.name === 'status')) checks = true
      if (m.type === 'MemberExpression' && (m.property?.name === 'ok' ||
          m.property?.name === 'status')) checks = true
    })
    if (parses && !checks) hits.push(src.slice(n.start, n.end).replace(/\s+/g, ' '))
  })
  return hits
}

/**
 * ⚠️ THE DEBT, NAMED AND DATED — 2026-08-09.
 *
 * Every file below still writes `fetch(…).then(r => r.json())`. They are NOT
 * the four this task fixed: each one's consumer already guards (`data?.rows ??
 * []`, `Array.isArray(x) ? x : []`), so a 402 renders an EMPTY page rather than
 * a broken one. That is better, and it is still wrong — "you have no
 * watchlists" and "you need a plan" are different sentences and only one of
 * them is true — but converting ~40 surfaces from silently-empty to
 * throws-into-SWR-error is a product change on ~40 screens, not a punch-list
 * item, and four of them (`OptionsFlow*.jsx`, `LiveFlow*.jsx`) are
 * partner-owned.
 *
 * ⭐ SO THIS IS A RATCHET, NOT AN ALLOW-LIST, and it is self-cleaning in
 * BOTH directions — the same idiom as `PRESETS_PREDATE_THE_RULE` in
 * `tests/test_screener_filters.py`. A NEW offender fails by name. A file that
 * is healed and left in the list ALSO fails, so the manifest cannot quietly
 * become the place the next one hides.
 *
 * ⛔ Do not add a file here to make a build green. Import `utils/jsonFetcher`.
 */
export const STILL_UNCHECKED = [
  'components/AuthGuard.jsx',
  'components/MoversSidebar.jsx',
  'components/admin/CatalystRulesPanel.jsx',
  'components/tiles/CatalystFlow.jsx',
  'components/tiles/FuturesStrip.jsx',
  'components/tiles/IntradayPulse.jsx',
  'components/tiles/LeadershipTile.jsx',
  'components/tiles/MARelationship.jsx',
  'components/tiles/MarketBreadth.jsx',
  'components/tiles/MorningWireIndexes.jsx',
  'components/tiles/OptionsFlowPreview.jsx',
  'components/tiles/SectorRotation.jsx',
  'components/tiles/ThemeTracker.jsx',
  'components/tiles/UCT20Backtest.jsx',
  'components/tiles/UCT20Performance.jsx',
  'hooks/useFlagged.js',
  'pages/Admin.jsx',
  'pages/Breadth.jsx',
  'pages/BreadthCharts.jsx',
  'pages/LiveFlow.jsx',
  'pages/LiveFlowMassive.jsx',
  'pages/ModelBook.jsx',
  'pages/MorningWire.jsx',
  'pages/OptionsFlow.jsx',
  'pages/OptionsFlow_admin.jsx',
  'pages/Patterns.jsx',
  'pages/PostMarket.jsx',
  'pages/Screener.jsx',
  'pages/SetupLibrary.jsx',
  'pages/ThemeTrackerPage.jsx',
  'pages/UCT20.jsx',
  'pages/admin/ChartHealth.jsx',
  'pages/admin/PatternAdmin.jsx',
  'pages/admin/PatternReview.jsx',
  'pages/breadth/grouping/useGroupMeta.js',
  'pages/charts/widgets/BreadthWidget.jsx',
  'pages/modelbook/SetupsView.jsx',
  'pages/modelbook/builder/BuilderView.jsx',
  'pages/modelbook/builder/UpbEntryPage.jsx',
  'pages/patterns/PatternFilter.jsx',
  'pages/screener/hooks/useScreenerMeta.js',
  'utils/prefetchBars.js',
]

// ── the sweep ───────────────────────────────────────────────────────────────

describe('no shipped surface parses a response it never checked', () => {
  it('NO NEW SURFACE joins the list — and a healed one must leave it', () => {
    const offenders = new Set()
    for (const file of sourceFiles()) {
      if (uncheckedJsonFetches(fs.readFileSync(file, 'utf8')).length) {
        offenders.add(path.relative(SRC, file).split(path.sep).join('/'))
      }
    }
    const known = new Set(STILL_UNCHECKED)

    const fresh = [...offenders].filter(f => !known.has(f)).sort()
    expect(fresh, [
      'these surfaces hand a NON-OK body to their consumer as if it were data.',
      'A 402 answers JSON, its {detail} body is truthy, so every `!data`',
      'loading guard downstream is skipped. Import `utils/jsonFetcher`.',
      '', ...fresh,
    ].join('\n')).toEqual([])

    const healed = [...known].filter(f => !offenders.has(f)).sort()
    expect(healed, [
      'these are listed in STILL_UNCHECKED but no longer carry the shape.',
      'Delete them from the list — a stale exemption is how a rail rots into',
      'somewhere the next offender can hide.',
      '', ...healed,
    ].join('\n')).toEqual([])
  })

  it('the four surfaces this task FIXED are not in the debt list', () => {
    // ⛔ Named, because the ratchet above passes trivially if somebody adds
    // them back to STILL_UNCHECKED instead of keeping them fixed.
    for (const f of ['pages/Traders.jsx', 'pages/Watchlists.jsx',
                     'components/tiles/NewsFeed.jsx',
                     'components/admin/TwitterAccountsPanel.jsx']) {
      expect(STILL_UNCHECKED, `${f} regressed into the debt list`).not.toContain(f)
      expect(uncheckedJsonFetches(fs.readFileSync(path.join(SRC, f), 'utf8')),
        `${f} parses a response it never checked`).toEqual([])
    }
  })

  it('🔴 THE CONTROL — the sweep really does fire on the shape it claims to catch', () => {
    // A rail nobody has seen fail is not a rail (`lesson_gate_that_cannot_fail`).
    expect(uncheckedJsonFetches('const f = url => fetch(url).then(r => r.json())'))
      .toHaveLength(1)
    expect(uncheckedJsonFetches('const f = (u) => fetch(u).then((res) => res.json())'))
      .toHaveLength(1)
  })

  it('…and does NOT fire on a fetcher that checks, or on prose about one', () => {
    // The three shapes that must stay green, or the sweep is unusable noise.
    expect(uncheckedJsonFetches(
      'const f = url => fetch(url).then(r => { if (!r.ok) throw new Error(); return r.json() })',
    )).toEqual([])
    expect(uncheckedJsonFetches(
      '// never write fetch(url).then(r => r.json())\nconst f = 1',
    )).toEqual([])
    // Not a fetch at all — a `.then` on something else is a different program.
    expect(uncheckedJsonFetches('promise.then(r => r.json())')).toEqual([])
  })

  it('the sweep actually READ the tree — a floor, so an empty walk cannot pass', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(400)
    expect(files.some(f => f.endsWith('Traders.jsx'))).toBe(true)
  })
})

// ── the helper itself ───────────────────────────────────────────────────────

describe('jsonFetcher', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns the parsed body of a 2xx', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ a: 1 }] }))
    await expect(jsonFetcher('/api/x')).resolves.toEqual([{ a: 1 }])
  })

  it('🔴 THROWS on a 402 and carries the status, rather than returning the error body', async () => {
    // The whole point: a swallowed 402 renders as an empty account.
    const json = vi.fn(async () => ({ detail: 'payment required' }))
    global.fetch = vi.fn(async () => ({ ok: false, status: 402, json }))
    await expect(jsonFetcher('/api/traders')).rejects.toMatchObject({ status: 402 })
    expect(json, 'the error body was parsed and could still leak to a consumer')
      .not.toHaveBeenCalled()
  })

  it('throws on 401/403/500 too — this is not a paywall special case', async () => {
    for (const status of [401, 403, 500]) {
      global.fetch = vi.fn(async () => ({ ok: false, status, json: async () => ({}) }))
      await expect(jsonFetcher('/api/x')).rejects.toMatchObject({ status })
    }
  })
})
