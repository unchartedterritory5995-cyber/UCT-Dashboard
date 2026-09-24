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
// writes the zip to a FILE and prints only a frame naming it (below). This
// test reads that file, unzips it with the SAME library `intake.js` uses, and
// runs it through `detectAdapter` + `parse`.
//
// ⛔ THE ARCHIVE NEVER TRAVELS THROUGH STDOUT (wave-5 re-review, round 4). It
// used to be printed base64-encoded, and twice in seven runs this file died in
// beforeAll on "unknown compression type 8628" -- anything else the Python
// process printed (a module's print(), a warning, a background thread) had
// landed inside the payload. The fixture now writes the file, proves it with
// zipfile.testzip, and prints a FRAME: begin marker, path, sha256, end marker.
// Only what is inside the frame is read; a broken frame is reported as exactly
// that; and the sha256 proves the file read is the file written.

import fs from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import MarkdownIt from 'markdown-it'
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

const FIXTURE = path.join(ROOT, 'api/services/journal_two/roundtrip_export_fixture.py')
const FRAME_BEGIN = 'UCT-EXPORT-FIXTURE-ZIP-BEGIN'
const FRAME_END = 'UCT-EXPORT-FIXTURE-ZIP-END'

/**
 * The archive the fixture wrote, read from the file its frame names. Anything
 * the process printed outside the frame is ignored; a frame that is missing or
 * broken, or a file whose sha256 is not the one the fixture printed, is a CLEAR
 * error -- never a decompress error three layers down.
 */
function readFixtureArchive(stdout) {
  const lines = stdout.split(/\r?\n/)
  const at = lines.lastIndexOf(FRAME_BEGIN)
  if (at < 0 || lines[at + 3] !== FRAME_END) {
    throw new Error(`fixture stdout was contaminated or cut short (no intact ${FRAME_BEGIN} frame): ${JSON.stringify(stdout.slice(0, 200))}`)
  }
  const zipPath = lines[at + 1]
  const sha = lines[at + 2]
  let bytes
  try {
    bytes = fs.readFileSync(zipPath)
  } catch (err) {
    throw new Error(`the fixture's frame names an archive that cannot be read (${JSON.stringify(zipPath)}): ${err.message}`)
  }
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== sha) {
    throw new Error(`the fixture archive at ${zipPath} is not the one the fixture wrote (sha256 ${actual}, expected ${sha})`)
  }
  return new Uint8Array(bytes)
}

// `pythonArgs(script, attachRoot)` lets a rail run the fixture under a wrapper
// that misbehaves (prints around it, tampers with its file); by default it is
// the fixture itself.
function buildRealExportVfiles(pythonArgs = (script, root) => [script, root]) {
  const attachRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uct-export-fixture-'))
  let result
  let zipBytes
  try {
    result = spawnSync('python', pythonArgs(FIXTURE, attachRoot), { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
    if (result.status !== 0) {
      throw new Error(`roundtrip_export_fixture.py failed (exit ${result.status}): ${result.stderr}`)
    }
    zipBytes = readFixtureArchive(result.stdout)
  } finally {
    // The archive is in memory now; the planted attachments and the zip file
    // have nothing left to say.
    fs.rmSync(attachRoot, { recursive: true, force: true })
  }
  let entries
  try {
    entries = unzipSync(zipBytes)
  } catch (err) {
    throw new Error(`the fixture archive did not unzip (${err.message}) -- it passed zipfile.testzip in Python, so the bytes changed on the way`)
  }
  const vfiles = Object.entries(entries)
    .filter(([name]) => !name.endsWith('/'))
    .map(([name, data]) => ({
      path: name,
      size: data.length,
      lastModified: null,
      bytes: async () => data,
    }))
  return Object.assign(vfiles, { stdout: result.stdout })
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
    // N4: prose dollars went out escaped (so no reader takes "$5-$10" for
    // math) and come back as plain dollars -- never a stray backslash.
    expect(doc.html).toContain('Range $5-$10 on $NVDA.')
    // ...and so does member text that arrives by ATTRIBUTE (fix round 2): an
    // attachment's name, a widget's label, an Ask answer's question and its
    // source labels. An image's alt is exported RAW on purpose: markdown-it
    // drops an escaped character from an alt, so `\$` would come back as
    // nothing -- this is the assertion that caught it.
    expect(doc.html).toContain('alt="NVDA $5 base"')
    expect(doc.html).toContain('report $Q3.pdf')
    expect(doc.html).toContain('Chart $NVDA 1D')
    expect(doc.html).toContain('Q: Hold above $5?')
    expect(doc.html).toContain('[1] Deck $Q3')
    // ...the member's own `\$` (R2-N4, the next test) is the one backslash
    // that belongs in the note; anywhere else a `\$` is our escape leaking.
    expect(doc.html.replace('cost \\$5 and \\$6', '')).not.toContain('\\$')
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
    expect(doc.html).toContain('stop at $42') // an HTML island keeps its $ raw
    expect(doc.html).toContain('<details>')
    expect(doc.html).toContain('<summary>More detail</summary>')
    expect(doc.html).toContain('hidden until expanded')
  })

  // Re-review R2-N1 / R2-N4. An `<aside>` / `<details>` island is a CommonMark
  // HTML block, which ENDS AT ITS FIRST BLANK LINE; an excerpt's annotation, two
  // Shift+Enters and a code block's empty line each used to put one inside, and
  // everything after it was read as Markdown with its `$` raw.
  it('a raw-HTML island stays ONE block, so nothing inside it is read as Markdown; every $ comes back', async () => {
    const noteFile = vfiles.find((f) => f.path.endsWith('.md') && f.path.includes('AAPL'))
    const md = new TextDecoder().decode(await noteFile.bytes())
    // The importer's own parser and options (adapters/generic.js), token by
    // token: each island is ONE html_block, open tag to close tag.
    const tokens = new MarkdownIt({ html: true, linkify: true }).parse(md, {})
    for (const [open, close] of [['<aside>', '</aside>'], ['<details>', '</details>']]) {
      const blocks = tokens.filter((t) => t.type === 'html_block' && t.content.includes(open))
      expect(blocks.length, `every ${open} opens a block`).toBe(md.split(open).length - 1)
      for (const t of blocks) expect(t.content, `${open} closes in the same block`).toContain(close)
    }
    expect(md.split('<aside>').length - 1).toBe(2) // non-vacuity: both callouts are in the file
    expect(md).toContain('<br>') // ...and the blank lines were there to be closed

    const { adapter } = await detectAdapter(vfiles)
    const { docs } = await adapter.parse(vfiles)
    const [doc] = docs
    // What came back: each island still raw HTML -- no <p>, <em>, <pre> made
    // inside it -- and every `$` in it intact.
    const islands = doc.html.match(/<(aside|details)>[\s\S]*?<\/\1>/g)
    expect(islands).toHaveLength(3)
    for (const island of islands) expect(island).not.toMatch(/<(p|em|pre|code)[\s>]/)
    expect(doc.html).toContain('Guidance $5.2B-$6.1B for the year')
    expect(doc.html).toContain('*stop $4 then $6*') // text inside the island, never <em>
    expect(doc.html).toContain('$5-$10 now')
    expect(doc.html).toContain('total = $7')

    // R2-N4: the member typed `\$` -- it comes back exactly, and in the file
    // every `$` of it is ESCAPED (an ODD run of backslashes before it), so a
    // math reader cannot pair it.
    expect(doc.html).toContain('cost \\$5 and \\$6')
    const line = md.split('\n').find((l) => l.startsWith('cost '))
    const runs = [...line.matchAll(/(\\*)\$/g)].map((m) => m[1].length)
    expect(runs).toHaveLength(2)
    for (const n of runs) expect(n % 2, `a run of ${n} backslashes before a $`).toBe(1)
  })
})

// Round 4: the transport cannot be contaminated. Each rail runs the REAL fixture
// under a small Python wrapper that misbehaves in exactly one way.
d('the fixture transport cannot be contaminated', () => {
  const runsFixture = (before, after = '') => `
import runpy, sys
${before}
sys.argv = [sys.argv[1], sys.argv[2]]
try:
    runpy.run_path(sys.argv[0], run_name='__main__')
finally:
    ${after || 'pass'}
`
  const noteMd = async (vfiles) => {
    const f = vfiles.find((v) => v.path.endsWith('.md') && v.path.includes('AAPL'))
    return new TextDecoder().decode(await f.bytes())
  }

  it('stray output before and after the payload changes nothing: the same archive comes back', async () => {
    const clean = buildRealExportVfiles()
    const noisy = buildRealExportVfiles((script, root) => ['-c', runsFixture(
      "print('stray: a module printed at import')\nsys.stdout.write('stray: no newline, then ')",
      "print('stray: printed after the payload')",
    ), script, root])
    // non-vacuity: the wrapper really did print around the payload
    expect(noisy.stdout).toMatch(/^stray: a module printed at import/)
    expect(noisy.stdout).toMatch(/stray: printed after the payload\s*$/)
    expect(noisy.map((v) => v.path).sort()).toEqual(clean.map((v) => v.path).sort())
    expect(await noteMd(noisy)).toBe(await noteMd(clean))
  })

  it('output with no intact frame is a CLEAR failure that quotes it, never a decompress error', () => {
    expect(() => buildRealExportVfiles(() => ['-c', "print('UEsDBBQ garbage that looks like base64 and is not a frame')"]))
      .toThrow(/fixture stdout was contaminated or cut short .*UEsDBBQ garbage/)
  })

  it('an archive changed after the fixture wrote it is refused by its sha256', () => {
    // Run the fixture, then append a byte to the file its frame names.
    const tamper = runsFixture(
      'import io, contextlib\n_buf = io.StringIO()\n_ctx = contextlib.redirect_stdout(_buf)\n_ctx.__enter__()',
      "_ctx.__exit__(None, None, None)\n    _out = _buf.getvalue()\n    _lines = _out.splitlines()\n    _p = _lines[_lines.index('UCT-EXPORT-FIXTURE-ZIP-BEGIN') + 1]\n    open(_p, 'ab').write(b'\\0')\n    sys.stdout.write(_out)",
    )
    expect(() => buildRealExportVfiles((script, root) => ['-c', tamper, script, root]))
      .toThrow(/is not the one the fixture wrote/)
  })
})
