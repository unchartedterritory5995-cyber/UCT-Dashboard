// The round trip that matters: our own export, fed back into our own
// importer, through the REAL detect + parse path.
//
// 2026-09-02 adversarial audit, finding A4 ("the export does not round-trip
// through the importer, and the module docstring says it does"): no test
// anywhere had ever built a real archive with the real backend exporter and
// fed it to the real `detectAdapter()` + adapter `parse()` — every export
// test asserts against itself, and every importer test asserts against
// hand-authored fixtures. That gap is exactly why the four defects this
// test guards against (front matter re-rendering as a heading, dropped
// attachments, mis-split quoted tags, undetected format) shipped invisibly.
//
// `roundtrip_export_fixture.py` is the bridge: it builds ONE note through
// `build_export_zip` — the exact function the export ROUTE calls — with
// tags, a subtitle, a ticker, a hero image, an inline image, a file
// attachment, a title containing a colon, and a tag needing quoting, then
// prints the zip as base64. This test decodes it, unzips it with the SAME
// library `intake.js` uses, and runs it through `detectAdapter` + `parse`.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import { describe, it, expect, beforeAll } from 'vitest'
import { detectAdapter } from './registry'
import { genericAdapter } from './adapters/generic'
import { obsidianAdapter } from './adapters/obsidian'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`exportRoundtrip.test: could not find the repo root from ${process.cwd()}`)
})()

function pythonAvailable() {
  try {
    return spawnSync('python', ['--version'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

function buildRealExportVfiles() {
  const attachRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uct-export-fixture-'))
  const script = path.join(ROOT, 'api/services/journal_two/roundtrip_export_fixture.py')
  const result = spawnSync('python', [script, attachRoot], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`roundtrip_export_fixture.py failed (exit ${result.status}): ${result.stderr}`)
  }
  const zipBytes = new Uint8Array(Buffer.from(result.stdout.trim(), 'base64'))
  const entries = unzipSync(zipBytes)
  return Object.entries(entries)
    .filter(([name]) => !name.endsWith('/'))
    .map(([name, data]) => ({
      path: name,
      size: data.length,
      lastModified: null,
      bytes: async () => data,
    }))
}

const hasPython = pythonAvailable()
const d = hasPython ? describe : describe.skip

// A silent skip here deletes the ONLY proof of this file's headline claim
// while the suite still reads green, and a skip count is the easiest thing in
// a summary to slide past ("9 passed, 2 skipped" has been cited as
// verification in this repo before). Staying non-blocking is right -- a
// frontend-only checkout should not be forced to install Python -- but the
// skip has to say what it COSTS, somewhere the default reporter prints.
// ⛔ Not in the describe title: vitest's default reporter renders a skipped
// file as a bare "3 skipped" and never shows the name. Measured, not assumed.
// console.warn IS surfaced, so the warning goes there.
if (!hasPython) {
  console.warn(
    '\n⛔ export round-trip NOT VERIFIED in this run: `python` is not on PATH, so the '
    + 'archive under test was never built. Whether the importer can read our own '
    + 'export is UNPROVEN here -- these skipped tests are the only thing that checks it.\n',
  )
}

d('our own export round-trips through our own importer', () => {
  let vfiles

  beforeAll(() => {
    vfiles = buildRealExportVfiles()
  })

  it('is claimed by NEITHER generic nor obsidian with any real confidence (documents the "before" state)', async () => {
    // These two scores are the audit's own measurement of the gap this test
    // exists to close: a real export was claimed by generic at a coincidental
    // 0.1 and never by Obsidian at all. Both detect() functions are
    // unchanged by this fix (only their parse()s learned to read front
    // matter/attachments) — so these numbers document the historical "why"
    // a dedicated detector was needed, not a regression risk.
    expect(genericAdapter.detect(vfiles)).toBe(0.1)
    // obsidian's detect() is async (Promise<number>) when the fast
    // `.obsidian/`-dir signal is absent (our export never has one) — it
    // falls through to the content-sampling heuristic.
    await expect(Promise.resolve(obsidianAdapter.detect(vfiles))).resolves.toBe(0)
  })

  it('is claimed by the dedicated uct-export adapter at high confidence', async () => {
    const { adapter, confidence } = await detectAdapter(vfiles)
    expect(adapter.id).toBe('uct-export')
    expect(confidence).toBeGreaterThan(0.9)
  })

  it('carries every field that went in back out, through the real parse()', async () => {
    const { adapter } = await detectAdapter(vfiles)
    const { docs, warnings } = await adapter.parse(vfiles)

    // The manifest + (absent) EXPORT_ISSUES.txt must never become spurious
    // notes of their own — exactly one real note went in.
    expect(docs).toHaveLength(1)
    expect(warnings).toEqual([])

    const [doc] = docs
    // Front-matter `title:` wins over the filename-mangled
    // "AAPL- the thesis" `_safe_name` produced on disk.
    expect(doc.title).toBe('AAPL: the thesis')
    expect(doc.subtitle).toBe('Why I am long')
    expect(doc.ticker).toBe('AAPL')
    // The quote-aware flow-sequence parser: a naive comma split would have
    // produced ['swing', '"reclaim', 'tight"'].
    expect(doc.tags).toEqual(['swing', 'reclaim, tight'])
    expect(doc.createdAt).toBe('2024-03-04T10:00:00Z')
    expect(doc.updatedAt).toBe('2026-08-31T12:00:00Z')

    // Every bundled attachment survives: hero, inline image, and file chip.
    const refs = doc.media.map((m) => m.ref).sort()
    expect(refs).toEqual([
      'attachments/u1/n1/file/report.pdf',
      'attachments/u1/n1/hero/cover.png',
      'attachments/u1/n1/inline/chart.png',
    ])
    expect(doc.media.find((m) => m.ref.includes('cover.png')).kind).toBe('image')
    expect(doc.media.find((m) => m.ref.includes('chart.png')).kind).toBe('image')
    expect(doc.media.find((m) => m.ref.includes('report.pdf')).kind).toBe('file')

    // The body content itself survived (not swallowed by front-matter
    // corruption), and the front-matter block does NOT re-render as a
    // visible heading (the generic-adapter defect this audit found).
    expect(doc.html).toContain('The thesis holds.')
    expect(doc.html).not.toMatch(/<h[1-6]>\s*title:/i)
    expect(doc.html).not.toContain('subtitle:')
    // Hero image is real, visible content — not an orphaned blob referenced
    // by nothing.
    expect(doc.html).toContain('import-ref://attachments/u1/n1/hero/cover.png')
    expect(doc.html).toContain('import-ref://attachments/u1/n1/inline/chart.png')
    expect(doc.html).toContain('import-ref://attachments/u1/n1/file/report.pdf')

    // A callout and a toggle went out through notes_export.py's Notion-
    // shaped <aside>/<details> markup and survive the round trip as the
    // SAME raw HTML islands the notion adapter itself passes through
    // untouched (notion.js's own docstring: "for the converter" -- see
    // calloutNode.js/toggleNode.js + importer/convert.js for the half that
    // turns them into real editor nodes, exercised separately in
    // convert.test.js against this exact shape).
    expect(doc.html).toContain('<aside>')
    expect(doc.html).toContain('a tip worth keeping')
    expect(doc.html).toContain('<details>')
    expect(doc.html).toContain('<summary>More detail</summary>')
    expect(doc.html).toContain('hidden until expanded')
  })
})
