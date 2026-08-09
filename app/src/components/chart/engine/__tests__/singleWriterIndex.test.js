// app/src/components/chart/engine/__tests__/singleWriterIndex.test.js
//
// ─── THE 🔒 SINGLE-WRITER INDEX, DERIVED INSTEAD OF COUNTED BY HAND ──────────
//
// ⭐ THE DEFECT THIS EXISTS FOR, MEASURED 2026-08-07.
//
// `StockChart.jsx` carries an index of the developing-bar writers at the
// `barsPushActiveRef` declaration, and `CLAUDE.md` restates it as a LOCKED
// invariant. The whole mechanism of that invariant is *"go to the index, audit
// the writers"* — and the index was wrong in both ways an index can be:
//
//   1. **It under-counted.** It said FOUR ("the FOUR that exist today, and any
//      FIFTH one added later"). There were SIX. Writer E (the fast D/W/M candle
//      on the Massive 1-min tick) had existed long enough to have its own
//      retro-audit comment three screens away, and Writer F (the custom-TF live
//      bar) was never indexed at all.
//   2. **Every line number in it was wrong**, by 2,300–4,700 lines in an
//      11,700-line file. They were written as `~L2748` etc. and the file grew
//      underneath them. A hand-count beside the thing it counts drifts; that is
//      not a lapse, it is the property of hand-counts.
//
// Both writers were CORRECT when they were found — E consults the ref, F cannot
// coexist with push at all. The defect was never the code. It was that the
// artifact a future engineer audits against had quietly stopped describing it,
// which is exactly the Heikin-Ashi raw-candle bug class the index's own comment
// cites as its reason to exist.
//
// ⛔ SO THE INDEX IS NO LONGER A COUNT IN A COMMENT. This file derives the
// writer set from the AST of the shipped file and refuses to let the ledger
// below disagree with it. A new developing-bar writer cannot be added without
// this test naming it.
//
// WHAT COUNTS AS A DEVELOPING-BAR WRITER, mechanically: a call to `.update()`
// whose receiver is `candleSeriesRef.current` — directly, or through a local
// alias bound to it in an enclosing scope, WITH SHADOWING RESPECTED. That last
// clause is load-bearing and was found by running it: `updateChart`'s
// `_applyData = (series, data) => …` takes `series` as a PARAMETER, and a
// resolver that matched aliases by name alone attributed the repaint path's
// `series.update(...)` to the candle series.
//
// ⚠️ IT IS NOT A DATA-FLOW ANALYSIS. It resolves one shape (`const x =
// candleSeriesRef.current`) and it will not follow a series handed through a
// function argument or stored on an object. What it guarantees is narrow and
// sufficient for the invariant: every writer written the way all six existing
// writers are written is seen, and the count is pinned so a seventh forces a
// decision here rather than passing unnoticed.

import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

/** The repo root, found by walking up from wherever vitest was invoked —
 *  `import.meta.url` is an http: URL under this environment's vite transform.
 *  Same walk as `enumerationSites.test.js`, and it throws by name. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`single-writer index: could not find the repo root from ${process.cwd()}`)
})()

const SRC_REL = 'app/src/components/StockChart.jsx'
const SRC = fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8')

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const isCandleRef = (n) => !!n && n.type === 'MemberExpression' &&
  n.object.type === 'Identifier' && n.object.name === 'candleSeriesRef' &&
  n.property.type === 'Identifier' && n.property.name === 'current'

/** Every `.update()` call on the candle series, grouped by the writer function
 *  that owns it — the outermost function nested directly inside the component. */
function deriveWriters() {
  const ast = Parser.extend(jsx()).parse(SRC, {
    ecmaVersion: 'latest', sourceType: 'module', locations: true,
  })
  /** fn node -> Map(name -> "is this name bound to candleSeriesRef.current here?").
   *  Params bind to FALSE, which is what makes shadowing work. */
  const scopes = new Map()
  const bind = (fn, name, isAlias) => {
    if (!fn) return
    if (!scopes.has(fn)) scopes.set(fn, new Map())
    scopes.get(fn).set(name, isAlias)
  }
  const calls = []

  ;(function walk(node, stack) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(n => walk(n, stack)); return }
    if (typeof node.type !== 'string') return
    const isFn = FN_TYPES.has(node.type)
    if (isFn) {
      stack.push(node)
      for (const p of node.params) if (p.type === 'Identifier') bind(node, p.name, false)
    }
    const owner = stack[stack.length - 1]
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      bind(owner, node.id.name, isCandleRef(node.init))
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' && node.callee.property.name === 'update') {
      calls.push({ stack: stack.slice(), line: node.loc.start.line, recv: node.callee.object })
    }
    for (const k in node) {
      if (k === 'loc' || k === 'start' || k === 'end') continue
      walk(node[k], stack)
    }
    if (isFn) stack.pop()
  })(ast, [])

  const writesCandle = (call) => {
    if (isCandleRef(call.recv)) return true
    if (call.recv.type !== 'Identifier') return false
    for (let i = call.stack.length - 1; i >= 0; i--) {
      const scope = scopes.get(call.stack[i])
      if (scope && scope.has(call.recv.name)) return scope.get(call.recv.name)
    }
    return false
  }

  const byFn = new Map()
  for (const call of calls.filter(writesCandle)) {
    // stack[0] is the component function itself; stack[1] is the effect /
    // useCallback / subscription handler that IS the writer.
    const fn = call.stack.length >= 2 ? call.stack[1] : call.stack[0]
    if (!byFn.has(fn)) byFn.set(fn, { node: fn, line: fn.loc.start.line, updates: [] })
    byFn.get(fn).updates.push(call.line)
  }
  return [...byFn.values()].sort((a, b) => a.line - b.line)
}

/** Does `node`'s subtree mention `name` as an identifier? (Comments are not in
 *  the AST at all, so this reads code and only code — no stripper needed.) */
function mentions(node, name) {
  let found = false
  ;(function walk(n) {
    if (found || !n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n.type !== 'string') return
    if (n.type === 'Identifier' && n.name === name) { found = true; return }
    for (const k in n) { if (k === 'loc' || k === 'start' || k === 'end') continue; walk(n[k]) }
  })(node)
  return found
}

// ─── THE LEDGER ─────────────────────────────────────────────────────────────
//
// `witness` is a code identifier that appears in EXACTLY ONE writer — asserted
// below, so a witness that stops discriminating fails by name instead of
// silently re-keying the ledger. No line numbers: they are what rotted.

const WRITERS = [
  {
    id: 'A', what: 'livePrices tick effect (Finnhub)',
    witness: 'barStartVolRef',
    guarded: true, freezesOnProvisionalStale: true,
  },
  {
    id: 'B', what: 'onRealtimeBar — the Massive push writer itself',
    witness: 'PERIOD_SECONDS',
    guarded: true, freezesOnProvisionalStale: true,
    note: 'B IS the writer, so its guard is NEGATED: `if (!barsPushActiveRef.current) return`.',
  },
  {
    id: 'D', what: 'updateChart post-setData re-top',
    witness: 'CandlestickSeries',
    guarded: true, freezesOnProvisionalStale: true,
    note: 'A BRANCH, not an early return: push-owned re-top vs Finnhub re-top.',
  },
  {
    id: 'F', what: 'custom-TF live developing bar',
    witness: '_customBaseIntraday',
    guarded: false, freezesOnProvisionalStale: false,
    note: 'DISJOINT BY CONSTRUCTION, never guarded. `_pushOptIn` requires ' +
          '`realtimeTfEligible`, which is a membership test against the five ' +
          'NATIVE intraday codes, so `barsPushActiveRef.current` is structurally ' +
          'false on a custom TF — and `provisionalStaleRef` is `isIntraday &&`-gated ' +
          'by the same five codes, so it is false here too. A guard would be dead ' +
          'code, which is worse than none: it reads as protection.',
  },
  {
    id: 'E', what: 'fast developing candle for D/W/M on the bars-WS 1-min tick',
    witness: 'barsStreamManager',
    guarded: true, freezesOnProvisionalStale: false,
    note: 'Daily-plus ONLY, and `provisionalStaleRef` is `isIntraday &&`-gated, ' +
          'so it can never be true while E runs. E was the path still seaming ' +
          'post-market onto the daily candle after A and D were gated.',
  },
  {
    id: 'C', what: 'realtimeCandle registry (Finnhub)',
    witness: 'realtimeCandle',
    guarded: true, freezesOnProvisionalStale: true,
  },
]

describe('the single-writer index is derived, not counted', () => {
  const derived = deriveWriters()

  it('finds a developing-bar writer for every ledger row and no others', () => {
    // Non-vacuity FIRST: a resolver that found nothing would make every
    // assertion below true. The old index claimed four; this is the number.
    expect(derived.length).toBeGreaterThan(0)
    expect(derived.map(w => w.updates.length).every(n => n > 0)).toBe(true)
    expect(derived).toHaveLength(WRITERS.length)
  })

  it('keys each writer by a witness that appears in exactly one of them', () => {
    for (const row of WRITERS) {
      const hits = derived.filter(w => mentions(w.node, row.witness))
      expect(hits.length, `witness ${row.witness} (writer ${row.id}) matched ${hits.length} writers`)
        .toBe(1)
    }
    // …and every derived writer is claimed by exactly one ledger row, so a NEW
    // writer cannot hide behind an existing row's witness.
    for (const w of derived) {
      const claims = WRITERS.filter(row => mentions(w.node, row.witness))
      expect(claims.length,
        `an unledgered developing-bar writer at line ${w.line} (updates at ${w.updates})`)
        .toBe(1)
    }
  })

  it.each(WRITERS)('writer $id ($what) consults barsPushActiveRef as declared', (row) => {
    const w = derived.find(x => mentions(x.node, row.witness))
    expect(w, `writer ${row.id}: witness ${row.witness} found no writer`).toBeTruthy()
    expect(mentions(w.node, 'barsPushActiveRef'),
      row.guarded
        ? `writer ${row.id} MUST consult barsPushActiveRef — an unguarded developing-bar ` +
          'writer dual-writes or paints the wrong candle (the Heikin-Ashi bug class)'
        : `writer ${row.id} now consults barsPushActiveRef; the ledger says it is disjoint ` +
          'by construction. Update the ledger and say which is true.')
      .toBe(row.guarded)
    expect(mentions(w.node, 'provisionalStaleRef')).toBe(row.freezesOnProvisionalStale)
  })

  it('pins the premise the ONE unguarded writer rests on', () => {
    // F is safe only because push can never engage on a custom timeframe. That
    // is not a comment; it is `realtimeTfEligible`, and if its vocabulary ever
    // grows to admit a non-native code, F becomes a real dual-write.
    const m = SRC.match(/const realtimeTfEligible = (\[[^\]]*\])\.includes\(resolvedTf\)/)
    expect(m, 'realtimeTfEligible is no longer a membership test — re-derive writer F')
      .toBeTruthy()
    expect(JSON.parse(m[1].replace(/'/g, '"'))).toEqual(['1', '5', '15', '30', '60'])
    expect(SRC).toContain('_barsPushEnabled() && realtimeTfEligible')
    expect(SRC).toMatch(/provisionalStaleRef\.current = isIntraday &&/)
  })
})
