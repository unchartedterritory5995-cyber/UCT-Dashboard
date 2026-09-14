/**
 * S4 CHECKPOINT 2 — the rail behind the ratification. DERIVED. MOUNTS NOTHING.
 *
 * ⛔ APPROVED SCOPE: **NONE YET.** CP2 is unsigned; this file is built to
 * signature-ready and is not merged. The packet's CP2 line, verbatim: *"Write the
 * ratification down where a reviewer meets it: the promoted authority, the derivation
 * table, the 'an instruction is not a channel' rule (`chartDeepLink.js:13-17`), as a
 * review rule with the derived rail behind it. Docs + rail only."*
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐ WHAT THIS RAIL IS BEHIND
 * ──────────────────────────────────────────────────────────────────────────
 *
 * `chartDeepLink.js:13-17` is the ruling: a URL param is a ONE-SHOT INSTRUCTION that
 * the workspace applies through the authorities it already has and then STRIPS — never
 * a second source of truth. Its own header names the failure it exists to prevent:
 *
 *   "A hand-typed `?sym=` on one side and a hand-typed `p.get('symbol')` on the other
 *    agree the day they are written and silently stop agreeing later."
 *
 * ⛔⛔ THE REPO IS ON THE WRONG SIDE OF THAT SENTENCE RIGHT NOW, which is the only
 * reason this ships as a gate rather than a report. Five sites read a symbol or
 * timeframe straight out of a query string without going through the authority, and
 * TWO OF THEM SPELL THE SAME FACT A THIRD WAY — `?ticker=`, where the authority says
 * `sym`. That is not a hypothesis about drift; it is drift, in the tree, today.
 *
 * ⛔ So the baseline below is NOT empty, and that is the point. It is the
 * `LOOSE_MODIFIER_BASELINE` idiom: the population is recorded by name, a SIXTH site
 * fails by name, and a site that gets migrated must leave the list in the same commit
 * or the record outlives the defect.
 *
 * ⛔ WHAT THIS RAIL DOES NOT DO. It does not mount anything, change any consumer, or
 * claim the five sites are defects. Three of them are deliberate separate doors (a
 * headless bot renderer, an admin perf harness). The rail's claim is narrower and
 * checkable: **the set is this set**, and growing it is a reviewable act.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path, { join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'

// `focusDivergence.test.jsx`'s idiom, not `chordCollision.test.js`'s: under this
// vitest config `import.meta.url` is not a file: URL, so fileURLToPath throws at
// import time and the suite reports ZERO TESTS — which reads as "nothing to run",
// not as a failure.
const SRC = path.resolve(process.cwd(), 'src')
const AUTHORITY = 'lib/chartDeepLink.js'

/**
 * ⛔ DERIVED, NEVER TYPED. The param names come out of the authority module's own
 * export, so renaming a param there moves this rail with it. A hand-typed list here
 * would be the second authority the whole checkpoint is about.
 */
function authorityParams() {
  const src = readFileSync(join(SRC, AUTHORITY), 'utf8')
  const m = src.match(/CHART_LINK_PARAMS\s*=\s*\{([^}]*)\}/)
  if (!m) throw new Error('CHART_LINK_PARAMS not found in ' + AUTHORITY)
  return [...m[1].matchAll(/['"]([a-z_]+)['"]/gi)].map((x) => x[1])
}

/**
 * Spellings of "which symbol" that a URL has been seen to carry in this app. Declared,
 * so widening it is a reviewable act — and deliberately WIDER than the authority's own
 * names, because the defect being railed is precisely a site inventing a new spelling.
 */
const SYMBOL_SPELLINGS = ['sym', 'symbol', 'ticker', 'tf', 'timeframe']

/** ⛔ CODE, NEVER PROSE. A `//` or `/* *​/` comment describing this defect is not the
 *  defect. Line numbers are preserved so failures cite a real line. */
function stripComments(code) {
  const noBlock = code.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
  return noBlock
    .split('\n')
    .map((ln) => {
      const at = ln.indexOf('//')
      if (at < 0) return ln
      const before = ln.slice(0, at)
      const q = (before.match(/'/g) || []).length + (before.match(/"/g) || []).length
      return q % 2 === 0 ? before : ln
    })
    .join('\n')
}

function sourceFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue
      sourceFiles(p, out)
    } else if (/\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

/** Every `<something>.get('<spelling>')` — the shape that reads a param by hand. */
function handTypedReads() {
  const rx = new RegExp(`\\.get\\(\\s*['"](${SYMBOL_SPELLINGS.join('|')})['"]\\s*\\)`, 'g')
  const rows = []
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split('\\').join('/')
    const body = stripComments(readFileSync(file, 'utf8'))
    body.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(rx)) {
        rows.push({ file: rel, line: i + 1, param: m[1] })
      }
    })
  }
  return rows
}

/**
 * The five sites that read a symbol/timeframe param without the authority, measured
 * 2026-09-14. Each carries WHY it is here, because a baseline without reasons becomes
 * a list nobody dares shrink.
 */
const HAND_TYPED_BASELINE = [
  // A headless renderer for the Discord/bot image path — a different door by design.
  'pages/ChartRender.jsx',
  // The admin-only `?gridspike=N&tf=D|5` perf harness (CLAUDE.md, Multi-Chart Grid).
  'pages/charts/grid/MultiChartGrid.jsx',
  // ⛔ THE REAL ONE. Spells the same fact `?ticker=`, where the authority says `sym`.
  // Not fixed by CP2 (docs + rail only, touches no live consumer) — filed instead.
  'pages/journal-2-0/tabs/NotebookTab.jsx',
]

describe('S4 CP2 — the deep-link ruling has a derived rail behind it', () => {
  it('NON-VACUITY: the sweep sees a real population of sources', () => {
    // ⛔ Every assertion below is satisfied by an empty sweep, and an empty sweep is
    // exactly what a broken path or a bad filter produces.
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(500)
    expect(files.some((f) => f.endsWith('chartDeepLink.js'))).toBe(true)
  })

  it('the param names are DERIVED from the authority, not typed here', () => {
    const params = authorityParams()
    expect(params.length).toBeGreaterThan(0)
    // The authority's own names must be a subset of the spellings this rail watches,
    // or a renamed param would walk straight past it.
    for (const p of params) expect(SYMBOL_SPELLINGS).toContain(p)
  })

  it('POSITIVE CONTROL: the matcher can see a real hand-typed read', () => {
    // ⚰️ v1 of this control asserted the sweep finds reads inside the AUTHORITY, and it
    // failed — correctly. `chartDeepLink.js` reads `p.get(CHART_LINK_PARAMS.sym)`, never
    // a string literal, because routing through the constant is the very behaviour being
    // ratified. The control was wrong about the thing it was controlling for.
    //
    // So the control is now the population itself: the sweep must find the baselined
    // sites. If it goes empty the matcher has stopped working, and every "no new site"
    // result below is a silence rather than a measurement.
    const outside = handTypedReads().filter((r) => r.file !== AUTHORITY)
    expect(outside.length).toBeGreaterThan(0)
    const files = new Set(outside.map((r) => r.file))
    expect([...files].some((f) => HAND_TYPED_BASELINE.includes(f))).toBe(true)
  })

  it('POSITIVE CONTROL: the authority itself routes through the constant, not a literal', () => {
    // ⭐ The other half, and the one that says what "correct" looks like. This is what
    // every baselined site would look like after migration.
    const own = handTypedReads().filter((r) => r.file === AUTHORITY)
    expect(own).toEqual([])
    const src = readFileSync(join(SRC, AUTHORITY), 'utf8')
    expect(src).toMatch(/\.get\(CHART_LINK_PARAMS\./)
  })

  it('⛔ no NEW surface reads a symbol/timeframe param by hand', () => {
    const outside = handTypedReads().filter((r) => r.file !== AUTHORITY)
    const added = [...new Set(outside.map((r) => r.file))]
      .filter((f) => !HAND_TYPED_BASELINE.includes(f))
      .sort()
    expect(
      added,
      added.length
        ? `NEW hand-typed deep-link read(s): ${added.join(', ')}.\n` +
            "chartDeepLink.js:13-17 rules that a URL param is a one-shot INSTRUCTION " +
            'applied through an existing authority and then STRIPPED — never a second ' +
            'source of truth. Route through readChartsLink/chartsLinkPath, or add the ' +
            'file to HAND_TYPED_BASELINE with the reason it is a separate door.'
        : '',
    ).toEqual([])
  })

  it('⭐ the baseline has not gone stale in the other direction', () => {
    // A site that gets migrated must leave the list in the same commit, or the record
    // outlives the defect it describes.
    const outside = new Set(handTypedReads().filter((r) => r.file !== AUTHORITY).map((r) => r.file))
    const fixed = HAND_TYPED_BASELINE.filter((f) => !outside.has(f))
    expect(
      fixed,
      fixed.length
        ? `${fixed.join(', ')} no longer reads a deep-link param by hand — remove it ` +
            'from HAND_TYPED_BASELINE in the same commit that migrated it.'
        : '',
    ).toEqual([])
  })

  it('records WHICH spellings are in use, so the finding has a measurement', () => {
    const outside = handTypedReads().filter((r) => r.file !== AUTHORITY)
    const spellings = [...new Set(outside.map((r) => r.param))].sort()
    // ⛔ This is the finding, pinned: the authority says `sym`, and a live surface says
    // `ticker`. If that ever stops being true the finding is closed and this line is
    // what tells the next reader.
    expect(spellings).toContain('ticker')
    expect(authorityParams()).not.toContain('ticker')
  })

  it('the ruling it cites is still where the packet says it is', () => {
    // ⛔ CHECK THE ARTIFACT, NOT THE TEXT. A citation that has drifted is the defect
    // this repo has paid for repeatedly (CLAUDE.md's "Lines 1508 and 1540").
    const lines = readFileSync(join(SRC, AUTHORITY), 'utf8').split('\n')
    const rule = lines.slice(12, 17).join(' ')
    expect(rule).toMatch(/Deliberately NOT a new state channel/)
    expect(rule).toMatch(/STRIPS the params/)
  })
})
