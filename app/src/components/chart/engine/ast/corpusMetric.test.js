// ─── ⭐⭐ THE THREE-NUMBER METRIC, MEASURED RATHER THAN QUOTED ───────────────
//
// ⚰️ WHY THIS FILE EXISTS. "30/266 host · 45/266 screener" was quoted in four
// places across `docs/pine/` and in SESSION-STATE, and it came from an ad-hoc run
// nobody could repeat. Re-measured 2026-09-11 the numbers were **32 and 46** — so
// the figure every plan was reasoning against had been stale for at least two
// capability landings, and nothing could have told anyone, because no test
// computed it. A number with no runnable producer is a number that drifts.
//
// ⛔ IT CARRIES NO FLOOR, AND THAT IS DELIBERATE. A floor here is how
// `capabilityDemandCensus` ended up asserting `> 150` against a corpus half of
// which is licence-restricted and never committed. What this asserts instead is
// NON-VACUITY — that it really read the corpus and that both lanes really
// discriminate — and it PRINTS the measurement plus writes per-script rows, so
// any number walks back to a file. The authority is the artifact, not a literal.
//
// ⛔ A THROW IS RECORDED AS `THREW`, NEVER SWALLOWED. `translatePine` is supposed
// to RETURN refusals; one committed script makes it throw one instead
// (`smart-money-breakouts-chartprime__ea79c79a67.pine`, `pine:statement` out of
// `switchBinding`). Catching it silently would have hidden a member-reachable
// crash behind a tidy count, so the row says `THREW` and the console says which.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const OUT = path.join(REPO, 'tools/corpus_metric.json')

describe('the committed corpus, both lanes', () => {
  it('⭐ measures host and screener, and records every row', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()

    const run = (src, sp, strict) => {
      try {
        const r = translatePine(src, strict
          ? { strict: true, budgetMs: 2000, sourcePath: sp }
          : { budgetMs: 2000, sourcePath: sp })
        return { ok: !!r.ok, guards: [...new Set((r.refusals || []).map((x) => x.guard))] }
      } catch (e) {
        /* eslint-disable-next-line no-console */
        console.log(`THREW ${strict ? 'host    ' : 'screener'} ${sp}: ${e && e.guard}`)
        return { ok: false, guards: ['THREW'] }
      }
    }

    const rows = files.map((f) => {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8')
      const sp = `corpus/committed/${f}`
      const host = run(src, sp, true)
      const screener = run(src, sp, false)
      return { file: f, host: host.ok, screener: screener.ok, hostGuards: host.guards, screenerGuards: screener.guards }
    })

    const hostOk = rows.filter((r) => r.host).length
    const screenerOk = rows.filter((r) => r.screener).length
    const threw = rows.filter((r) => r.hostGuards.includes('THREW') || r.screenerGuards.includes('THREW'))

    /* eslint-disable no-console */
    console.log(`\n=== THE THREE-NUMBER METRIC, measured ===`)
    console.log(`  scripts                 ${rows.length}`)
    console.log(`  host / pane   (strict)  ${hostOk}/${rows.length}`)
    console.log(`  screener    (default)   ${screenerOk}/${rows.length}`)
    console.log(`  translatePine THREW on  ${threw.length} (see rows)`)
    /* eslint-enable no-console */

    // ⚰ `measured_at` WAS A HAND-TYPED '2026-09-11' AND WENT STALE THE FIRST TIME THE
    // METRIC MOVED: ruling R-F re-derived it on 2026-09-12 and the artifact still said
    // yesterday — a stamp claiming to date a measurement, dating the last time someone
    // edited the literal. It is derived from the run now, so the only way for it to be
    // wrong is for the file not to have been regenerated, which is the thing it should say.
    fs.writeFileSync(OUT, `${JSON.stringify({
      measured_at: new Date().toISOString().slice(0, 10),
      scripts: rows.length,
      host_ok: hostOk,
      screener_ok: screenerOk,
      threw: threw.map((r) => r.file),
      rows,
    }, null, 2)}\n`)

    // ── NON-VACUITY, not a floor ──────────────────────────────────────────
    // It really read the corpus…
    expect(rows.length).toBeGreaterThan(200)
    // …both lanes really answer…
    expect(hostOk).toBeGreaterThan(0)
    expect(screenerOk).toBeGreaterThan(0)
    // …and both really DISCRIMINATE. A lane that said yes to everything, or no to
    // everything, would be an instrument reporting a property of itself.
    expect(hostOk).toBeLessThan(rows.length)
    expect(screenerOk).toBeLessThan(rows.length)
    // …and the lanes are not the same question: the screener is the looser one, so
    // it must clear at least as many as the host. If this ever inverts, one of the
    // two lanes is not what its name says.
    expect(screenerOk).toBeGreaterThanOrEqual(hostOk)
  })
})
