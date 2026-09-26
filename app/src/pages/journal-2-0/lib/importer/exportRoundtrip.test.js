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
//
// ⛔ ONE PYTHON SPAWN FOR THE WHOLE FILE, IN A beforeAll WITH ITS OWN BUDGET (wave 7
// whole-branch fix; the `192f4a60a` pattern). The fixture used to be spawned in a
// beforeAll with NO budget (vitest's hookTimeout is 10 s) and again in three tests --
// four fixture processes per file, each importing the exporter cold. Now ONE driver
// process runs every variant these rails need -- the clean fixture, the fixture with
// stray output around its frame, and the fixture with its archive changed after it was
// written -- through the fixture's own `__main__` (runpy, exactly what
// `python roundtrip_export_fixture.py <root>` runs), each with its stdout captured on
// its own, and prints them as one JSON line. Every rail below reads a variant's stdout
// the way it used to read a process's; what each asserts is unchanged.
// `lib/testing/exportBridge.spawnBudget.test.js` holds this file to one budgeted spawn.

import fs from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { unzipSync } from 'fflate'
import MarkdownIt from 'markdown-it'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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

const VARIANTS_MARK = 'UCT-EXPORT-FIXTURE-VARIANTS '

// The one driver: the REAL fixture's `__main__`, once per variant, each variant's stdout
// captured on its own; then every variant's stdout, as one JSON line after VARIANTS_MARK.
// Anything the process prints outside a variant is ignored, like anything outside a frame.
const DRIVER = `
import contextlib, io, json, runpy, sys
fixture, root = sys.argv[1], sys.argv[2]

def run(before=None, after=None):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        if before:
            before()
        sys.argv = [fixture, root]
        runpy.run_path(fixture, run_name='__main__')
        if after:
            after(buf)
    return buf.getvalue()

def stray_before():
    print('stray: a module printed at import')
    sys.stdout.write('stray: no newline, then ')

def stray_after(buf):
    print('stray: printed after the payload')

def tamper(buf):
    lines = buf.getvalue().splitlines()
    path = lines[lines.index('${FRAME_BEGIN}') + 1]
    with open(path, 'ab') as f:
        f.write(b'\\0')

out = {'clean': run(), 'noisy': run(stray_before, stray_after), 'tampered': run(after=tamper)}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print('UEsDBBQ garbage that looks like base64 and is not a frame')
out['noFrame'] = buf.getvalue()
sys.stdout.write('\\n${VARIANTS_MARK}' + json.dumps(out) + '\\n')
`

/** ONE python process for the file: `{ attachRoot, runs: {clean, noisy, tampered, noFrame} }`,
 * each run the stdout of one variant. The archives stay in `attachRoot` until afterAll. */
function spawnFixtureVariants() {
  const attachRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uct-export-fixture-'))
  const result = spawnSync('python', ['-c', DRIVER, FIXTURE, attachRoot], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
  const line = (result.stdout || '').split(/\r?\n/).reverse().find((l) => l.startsWith(VARIANTS_MARK))
  if (result.status !== 0 || !line) {
    fs.rmSync(attachRoot, { recursive: true, force: true })
    throw new Error(`the roundtrip_export_fixture.py driver failed (exit ${result.status}, `
      + `${line ? 'variants printed' : `no ${VARIANTS_MARK.trim()} line`}): ${result.stderr}`)
  }
  return { attachRoot, runs: JSON.parse(line.slice(VARIANTS_MARK.length)) }
}

/** One variant's stdout -> the archive its frame names, unzipped into importer vfiles. Pure JS:
 * no process is spawned here. */
function vfilesFromStdout(stdout) {
  const zipBytes = readFixtureArchive(stdout)
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
  return Object.assign(vfiles, { stdout })
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

// ONE fixture spawn for the whole file, with its own budget (the header says why). Guarded,
// so a frontend-only checkout without python neither spawns nor fails here: both suites below
// are skipped, and the warning above says what that costs.
let attachRoot
let runs

beforeAll(() => {
  if (hasPython) ({ attachRoot, runs } = spawnFixtureVariants())
}, 60_000)

afterAll(() => {
  // The archives have been read; the planted attachments and the zips have nothing left to say.
  if (attachRoot) fs.rmSync(attachRoot, { recursive: true, force: true })
})

d('our own export round-trips through our own importer', () => {
  let vfiles

  beforeAll(() => {
    vfiles = vfilesFromStdout(runs.clean)
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
    // ...the member's own `\$` (R2-N4 and R34-N2, the next test) is the one
    // backslash that belongs in the note; anywhere else a `\$` is our escape
    // leaking.
    expect(doc.html.replace('cost \\$5 and \\$6', '').replace('fee \\$3 flat', '')).not.toContain('\\$')
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
    // R34-N1: the CR endings were made line breaks and closed, never kept
    // (a reader ends a line at a lone \r too) and never dropped.
    expect(md).not.toContain('\r')
    expect(md).toContain('pasted\n<br>\nfrom Windows $8 and\n<br>\nold Mac $9')

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
    expect(doc.html).toContain('from Windows $8 and')
    expect(doc.html).toContain('old Mac $9')

    // R2-N4: the member typed `\$` -- it comes back exactly, and in the file
    // every `$` of it is ESCAPED (an ODD run of backslashes before it), so a
    // math reader cannot pair it.
    expect(doc.html).toContain('cost \\$5 and \\$6')
    const line = md.split('\n').find((l) => l.startsWith('cost '))
    const runs = [...line.matchAll(/(\\*)\$/g)].map((m) => m[1].length)
    expect(runs).toHaveLength(2)
    for (const n of runs) expect(n % 2, `a run of ${n} backslashes before a $`).toBe(1)

    // R34-N2: the same when the backslash ends a coloured run and the `$`
    // opens the next one.
    expect(doc.html).toContain('fee \\$3 flat')
    const feeLine = md.split('\n').find((l) => l.startsWith('fee '))
    const feeRun = feeLine.match(/(\\*)\$/)[1].length
    expect(feeRun % 2, `a run of ${feeRun} backslashes before the $`).toBe(1)
  })
})

// Round 4: the transport cannot be contaminated. Each rail reads the REAL fixture's
// stdout from a variant that misbehaves in exactly one way (the driver above).
d('the fixture transport cannot be contaminated', () => {
  const noteMd = async (vfiles) => {
    const f = vfiles.find((v) => v.path.endsWith('.md') && v.path.includes('AAPL'))
    return new TextDecoder().decode(await f.bytes())
  }

  it('stray output before and after the payload changes nothing: the same archive comes back', async () => {
    const clean = vfilesFromStdout(runs.clean)
    const noisy = vfilesFromStdout(runs.noisy)
    // non-vacuity: the wrapper really did print around the payload
    expect(noisy.stdout).toMatch(/^stray: a module printed at import/)
    expect(noisy.stdout).toMatch(/stray: printed after the payload\s*$/)
    expect(noisy.map((v) => v.path).sort()).toEqual(clean.map((v) => v.path).sort())
    expect(await noteMd(noisy)).toBe(await noteMd(clean))
  })

  it('output with no intact frame is a CLEAR failure that quotes it, never a decompress error', () => {
    expect(() => vfilesFromStdout(runs.noFrame))
      .toThrow(/fixture stdout was contaminated or cut short .*UEsDBBQ garbage/)
  })

  it('an archive changed after the fixture wrote it is refused by its sha256', () => {
    // The driver ran the fixture, then appended a byte to the file its frame names.
    expect(runs.tampered).toContain(FRAME_BEGIN)      // non-vacuity: a real frame, a real file
    expect(() => vfilesFromStdout(runs.tampered))
      .toThrow(/is not the one the fixture wrote/)
  })
})
