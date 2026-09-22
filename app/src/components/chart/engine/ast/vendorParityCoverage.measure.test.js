// app/src/components/chart/engine/ast/vendorParityCoverage.measure.test.js
//
// ─── ⭐⭐ PHASE 1'S WORK QUEUE — WHICH DECLARED NAME HAS NO VENDOR EVIDENCE ──
//
// "Identical to TradingView" is an engineering statement whose unit is one
// VENDOR CAPTURE: a fixture recording what TradingView itself returns, that a
// test asserts against. `docs/pine/PARITY-PROGRAMME.md` Phase 1 is the
// programme of taking one per declared name.
//
// This is that programme's queue. It crosses three sets:
//
//   1. what `closedTable.json` DECLARES  — the names this engine claims
//   2. what `tests/fixtures/vendor/` HOLDS — the names we have measured
//   3. what `corpus/committed/` USES      — the names that actually matter
//
// and reports the intersection that matters: **declared, used by real scripts,
// and never measured against the vendor.** Those are the claims this engine
// makes that nothing has ever checked.
//
// ⭐⭐ TWO SIGNALS, AND THE GAP BETWEEN THEM IS THE POINT.
//
// WEAK — the name appears anywhere under `tests/fixtures/vendor/`. Fixtures are
// named by capture THEME (`r11-nine-safe-spy-1d-…`), not by function, so this
// OVER-reports badly: a capture whose prose mentions a name while measuring
// something else counts as covered.
//
// AUTHORITATIVE — the name is CALLED in a committed probe source under
// `tools/visual_conformance/probes/*.pine`. Those are the scripts actually run
// on TradingView to produce the fixtures (each fixture names its probe in
// `_probe`), so their call sites are what a capture genuinely measured.
//
// ⚠️ Measured 2026-09-21 the two disagree by an order of magnitude: the weak
// signal leaves 3 names uncovered, the authoritative one leaves 29. The weak
// number would have read as "Phase 1 is nearly done".
//
// ⛔ IT ASSERTS NO COUNT — same contract as the other censuses. A queue pinned
// to a number goes red every time the queue is worked.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import closedTable from './closedTable.json'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests/fixtures/vendor')
const CORPUS = path.join(REPO, 'corpus/committed')

/** Every function name the closed table declares. ⭐ Read from the manifest,
 *  never typed — a name typed in a test is the artifact that goes stale first. */
const declaredFunctions = () => Object.keys(closedTable.functions || {})
  .filter((k) => !k.startsWith('_'))

/** Fixture text, concatenated once. Includes nested dirs (parity/, reference/,
 *  raw_captures/, observations/) because captures live in all of them. */
const vendorText = () => {
  if (!fs.existsSync(VENDOR)) return ''
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(json|md|txt)$/i.test(e.name)) continue
      try { out.push(fs.readFileSync(p, 'utf8')) } catch { /* unreadable is not covered */ }
    }
  }
  walk(VENDOR)
  return out.join('\n')
}

/** How many corpus scripts call each name. Comments stripped first — a name in
 *  prose is not a call site (`CLAUDE.md`, "CODE, NEVER PROSE"). */
const corpusDemand = (names) => {
  const demand = new Map(names.map((n) => [n, 0]))
  if (!fs.existsSync(CORPUS)) return demand
  for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine'))) {
    const raw = fs.readFileSync(path.join(CORPUS, f), 'utf8')
    const code = raw.split('\n')
      .map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i) })
      .join('\n')
    for (const n of names) {
      // Escape the dot so `ta.sma` cannot match `taXsma`.
      const re = new RegExp(`\\b${n.replace(/\./g, '\\.')}\\s*\\(`)
      if (re.test(code)) demand.set(n, demand.get(n) + 1)
    }
  }
  return demand
}

describe('⭐⭐ Phase 1 queue — declared, used, never measured', () => {
  it('⛔ CONTROL — the manifest and the fixtures were both found', () => {
    // Every count below is trivially satisfied by an empty read of either side.
    expect(declaredFunctions().length).toBeGreaterThan(20)
    expect(vendorText().length).toBeGreaterThan(1000)
  })

  it('⛔ CONTROL — the demand counter can tell a used name from an unused one', () => {
    // A counter that answers 0 for everything would make the whole queue read
    // as "nothing is used", which is the flattering direction.
    const d = corpusDemand(['ta.sma', 'ta.__definitely_not_a_real_name__'])
    expect(d.get('ta.sma')).toBeGreaterThan(0)
    expect(d.get('ta.__definitely_not_a_real_name__')).toBe(0)
  })

  it('⭐⭐ prints the queue: used by the corpus, no vendor evidence', () => {
    const names = declaredFunctions()
    const vendor = vendorText()
    const demand = corpusDemand(names)

    const rows = names.map((n) => ({
      name: n,
      scripts: demand.get(n) || 0,
      covered: vendor.includes(n),
    }))

    const uncoveredUsed = rows.filter((r) => !r.covered && r.scripts > 0)
      .sort((a, b) => b.scripts - a.scripts || a.name.localeCompare(b.name))
    const coveredCount = rows.filter((r) => r.covered).length
    const unusedUncovered = rows.filter((r) => !r.covered && r.scripts === 0)

    // ⭐⭐ THE AUTHORITATIVE SIGNAL — THE PROBE SOURCES THEMSELVES.
    //
    // A vendor capture is produced by running a real Pine script on
    // TradingView. Those scripts are committed at
    // `tools/visual_conformance/probes/*.pine` and each fixture names the one
    // it came from in its `_probe` field. So "what did this capture actually
    // measure" is answered by the CALL SITES IN THE PROBE — not by what a
    // fixture's prose happens to mention, and not by what a test file happens
    // to contain.
    //
    // ⛔⛔ COMMENTS ARE STRIPPED FIRST AND THAT IS LOAD-BEARING, NOT TIDINESS.
    // `r11-nine-safe.pine`'s own header names `alma`, `ta.nvi` and
    // `ta.correlation` to say they are **deliberately NOT in this probe** —
    // "a compile failure there would take these four with it". Grep the file
    // and all three read as covered by the very capture that excludes them.
    // That is `CLAUDE.md`'s "CODE, NEVER PROSE" in its purest form, and this
    // directory is where it would have bitten next.
    const probedNames = (() => {
      const hits = new Set()
      const dir = path.join(REPO, 'tools/visual_conformance/probes')
      if (!fs.existsSync(dir)) return hits
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pine'))) {
        let raw = ''
        try { raw = fs.readFileSync(path.join(dir, f), 'utf8') } catch { continue }
        const code = raw.split('\n')
          .map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i) })
          .join('\n')
        for (const n of names) {
          const re = new RegExp(`\\b${n.replace(/\./g, '\\.')}\\s*\\(`)
          if (re.test(code)) hits.add(n)
        }
      }
      return hits
    })()
    const assertedInTests = probedNames
    const usedRows = rows.filter((r) => r.scripts > 0)
    const assertedUsed = usedRows.filter((r) => assertedInTests.has(r.name))
    const realQueue = usedRows.filter((r) => !assertedInTests.has(r.name))
      .sort((a, b) => b.scripts - a.scripts || a.name.localeCompare(b.name))

    // ⛔⛔ A SATURATED INSTRUMENT REPORTS ZERO, AND ZERO READS AS "NOTHING TO
    // DO" — SO SATURATION IS DETECTED RATHER THAN PUBLISHED.
    //
    // ⚰️ THIS GUARD EXISTS BECAUSE THE FIRST ATTEMPT AT THE STRONG SIGNAL FIRED
    // IT. That version asked "is there a TEST that reads a vendor fixture AND
    // names this function", and it marked 42 of 42 used names as covered — an
    // EMPTY queue. Not a finding: one large test file reading any fixture and
    // mentioning many names satisfied it for all of them, so the "narrower"
    // check had a WIDER false-positive surface than the one it tightened.
    // Replacing it with the probe call sites took the queue from 0 to 29.
    //
    // ⭐ The guard stays live because the probe check could saturate the same
    // way if probes ever grow to name everything.
    //
    // ⭐ So the saturation is DETECTED and reported as INCONCLUSIVE rather than
    // published as a zero. An absence is only evidence if the instrument could
    // have seen a presence, and this one demonstrably cannot.
    const saturated = usedRows.length > 0
      && (assertedUsed.length / usedRows.length) > 0.8

    // eslint-disable-next-line no-console
    console.log([
      '',
      '════ VENDOR PARITY QUEUE ════',
      `declared functions: ${names.length}`,
      '',
      'WEAK signal — name appears anywhere under tests/fixtures/vendor/:',
      `  mentioned                  : ${coveredCount}   (OVER-reports; see header)`,
      `  no mention, USED by corpus : ${uncoveredUsed.length}`,
      `  no mention, unused         : ${unusedUncovered.length}`,
      '',
      'AUTHORITATIVE — a call site in a committed PROBE source (comments stripped):',
      `  probed AND used by corpus   : ${assertedUsed.length} of ${usedRows.length} used`,
      ...(saturated ? [
        '',
        '  ⛔⛔ INCONCLUSIVE — THIS CHECK IS SATURATED.',
        `     It marks ${assertedUsed.length}/${usedRows.length} used names as asserted, i.e. it matches`,
        '     (almost) everything. One large test file that reads any vendor',
        '     fixture and mentions many names satisfies it for all of them, so',
        '     its false-positive surface is WIDER than the weak signal it was',
        '     meant to tighten. Its queue length is NOT reported as a finding:',
        '     an absence is only evidence if the instrument could have seen a',
        '     presence, and this one cannot.',
        '',
        '     ⭐ THE REAL PHASE 1 QUEUE IS THEREFORE UNMEASURED. Closing it needs',
        '     a per-fixture manifest naming which function each capture actually',
        '     measures — which is Phase 1 task 1, not a grep.',
      ] : [
        `  NOT asserted, USED by corpus: ${realQueue.length}   <<< THE REAL QUEUE`,
        '',
        '── THE REAL QUEUE, most-used first ──',
        ...realQueue.slice(0, 40).map((r) =>
          `${String(r.scripts).padStart(4)} scripts   ${r.name}${r.covered ? '   (mentioned, not asserted)' : ''}`),
      ]),
      '',
      '── NO VENDOR MENTION AT ALL, used by the corpus (the floor) ──',
      ...(uncoveredUsed.length
        ? uncoveredUsed.map((r) => `${String(r.scripts).padStart(4)} scripts   ${r.name}`)
        : ['  (none)']),
      '',
    ].join('\n'))

    // ⛔ NON-VACUITY ONLY. The queue length is the thing that moves as Phase 1
    // is worked; pinning it would red the suite on every capture taken.
    expect(rows.length).toBe(names.length)
  })
})
