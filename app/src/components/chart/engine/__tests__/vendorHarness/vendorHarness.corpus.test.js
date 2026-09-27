// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
//
// ─── THE HARNESS OVER EVERY CAPTURE ON DISK — and its CLI entry ───────────────
//
// Default: walks `tests/fixtures/vendor/` (native captures under `harness/`
// plus every legacy format the adapters understand) and prints the verdict
// table. As a CLI (docs/pine/VENDOR-HARNESS.md):
//
//   cd app
//   VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness \
//   VENDOR_HARNESS_OUT=../docs/pine/vendor-harness \
//     npx vitest run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
//
//   (PowerShell: `$env:VENDOR_HARNESS_DIR='…'; $env:VENDOR_HARNESS_OUT='…'; npx vitest run …`)
//
// `VENDOR_HARNESS_DIR` may hold several directories separated by `;`.
// `VENDOR_HARNESS_OUT` receives `verdicts.json` (machine-readable) and
// `summary.md` (the human table + the inventory of files that could not be
// compared, with why).
//
// ⛔ IT ASSERTS NO VERDICT. A table pinned to MATCH/DIVERGE goes red on exactly
// the progress it exists to measure (PARITY-PROGRAMME.md, "IT REPORTS, IT DOES
// NOT GATE"). What it asserts is that the harness told the truth about what it
// did: every file was accounted for, every verdict is one of three, every
// DIVERGE names its bar and both readings, every MATCH compared something.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { VERDICTS } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { runHarness, VENDOR_DIR, REPO } from './harness'

const dirs = process.env.VENDOR_HARNESS_DIR
  ? process.env.VENDOR_HARNESS_DIR.split(';').filter(Boolean).map((d) => path.resolve(process.cwd(), d))
  : [VENDOR_DIR]
const OUT = process.env.VENDOR_HARNESS_OUT ? path.resolve(process.cwd(), process.env.VENDOR_HARNESS_OUT) : null

describe('the vendor harness over the captures on disk', () => {
  const run = runHarness(dirs)

  it('prints the table, and writes it when asked', () => {
    // eslint-disable-next-line no-console
    console.log(`\n${run.table}\n\nNOT COMPARABLE (${run.inventory.length}):\n${run.inventory.map((i) => `  - ${i.file}: ${i.reason}`).join('\n')}\n`)
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true })
      fs.writeFileSync(path.join(OUT, 'verdicts.json'), JSON.stringify({
        generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js',
        dirs: dirs.map((d) => path.relative(REPO, d).replace(/\\/g, '/')),
        results: run.results,
        inventory: run.inventory,
      }, null, 1) + '\n')
      fs.writeFileSync(path.join(OUT, 'summary.md'), [
        '# Vendor harness — verdicts',
        '',
        `Directories: ${dirs.map((d) => `\`${path.relative(REPO, d).replace(/\\/g, '/')}\``).join(', ')}`,
        '',
        '```', run.table, '```', '',
        `## Not comparable (${run.inventory.length})`, '',
        ...run.inventory.map((i) => `- \`${i.file}\` — ${i.reason}`), '',
      ].join('\n'))
    }
  })

  it('⛔ every file is accounted for — graded or listed with a reason', () => {
    expect(run.results.length + run.inventory.length).toBe(run.files)
    for (const i of run.inventory) expect(i.reason, i.file).toBeTruthy()
  })

  it('⛔ every verdict is exactly one of the three, with its reason', () => {
    for (const r of run.results) {
      expect(VERDICTS, r.file).toContain(r.verdict)
      expect(r.reason, r.file).toBeTruthy()
      for (const p of r.plots || []) {
        expect(VERDICTS, `${r.file} ${p.title}`).toContain(p.verdict)
        expect(p.reason, `${r.file} ${p.title}`).toBeTruthy()
      }
    }
  })

  it('⛔ a DIVERGE names its bar and both readings; a MATCH compared something', () => {
    for (const r of run.results) {
      for (const p of r.plots || []) {
        if (p.verdict === 'DIVERGE') {
          const f = p.stats.steady.first
          expect(f, `${r.file} ${p.title}`).toBeTruthy()
          expect(f).toHaveProperty('bar')
          expect(f).toHaveProperty('time')
          expect(f).toHaveProperty('vendor')
          expect(f).toHaveProperty('ours')
        }
        if (p.verdict === 'MATCH') expect(p.stats.steady.compared, `${r.file} ${p.title}`).toBeGreaterThan(0)
      }
    }
  })

  it('⛔ NON-VACUITY — the default corpus is not empty and was really graded', () => {
    if (process.env.VENDOR_HARNESS_DIR) return            // a CLI run over a new directory may legitimately be small
    expect(run.results.length).toBeGreaterThan(5)
    // both measured outcomes occur on real data — a harness that could only say
    // one of them would pass the structural checks above
    expect(run.results.some((r) => r.verdict === 'MATCH')).toBe(true)
    expect(run.results.some((r) => r.verdict === 'DIVERGE')).toBe(true)
  })
})
