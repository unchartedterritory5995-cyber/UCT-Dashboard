/**
 * Cross-LANE parity rail for the Obsidian wiki-syntax pre-passes.
 *
 * Obsidian markdown is pre-processed in TWO independent, hand-written
 * places: this directory's own `adapters/obsidian.js` (the CLIENT lane — a
 * member drags an exported vault into the file importer) and
 * `api/services/journal_two/note_connectors/providers/obsidian.py` (the
 * SERVER lane — the Obsidian plugin pushes a vault through the sync
 * engine). Both implement the same grammar (`[[wikilinks]]`,
 * `==highlight==`, task lists, embeds); neither knows the other exists.
 * That duplication is DELIBERATE — see `providers/obsidian.py`'s own
 * "Deliberately duplicated, kept honest by a rail" docstring section — so
 * fixing a divergence here means fixing ONE lane's pre-pass, never merging
 * the two. THIS FILE is the rail that makes the deliberate duplication
 * provably safe: if either lane's pre-pass silently stops handling a
 * construct the other still does, this test goes red.
 *
 * Shape (mirrors `serverConvert.contract.test.js` / `fixtures_gen.py`):
 * `convert/obsidian_parity_fixtures_gen.py` is the AUTHORITY — it runs the
 * REAL server-side conversion (`ObsidianProvider._convert_row`: the pre-pass,
 * the real converter `convert.mddoc.md_to_tiptap`, callouts) over a
 * shared set of committed markdown fixtures
 * (`convert/obsidian_fixtures_in/*.md`, each with a `.vault.json` sidecar
 * naming the vault's known paths) and commits the result as a SEMANTIC
 * summary JSON under `__fixtures__/obsidian_parity/`. This test loads each
 * one, re-derives the SAME summary by running the CLIENT adapter
 * (`adapters/obsidian.js::obsidianAdapter.parse`) + the exact client
 * pipeline `ImportWizard.jsx` uses in production (`convert.js::htmlToNote`)
 * over the fixture's own `input_markdown`/`vault_paths`, and asserts the
 * two summaries are equal.
 *
 * The comparison is deliberately at the SEMANTIC level, not raw TipTap doc
 * equality: the two lanes legitimately disagree on identity encoding (the
 * server key is `import-link://obsidian:{vault_id}/{path}` — a persistent
 * per-vault sync needs the vault_id to disambiguate; the client key is
 * `import-link://obsidian:{path}` — a one-shot drag-in batch has no
 * multi-vault concept at all). `normalizeLinkHref`/`normalizeImageSrc`
 * below strip each lane's own scheme down to the bare resolved vault path
 * before comparing — that is "the level where they SHOULD agree": a
 * wikilink became an internal-link node pointing at the SAME target note,
 * regardless of how each transport spells that target's identity.
 *
 * ── RED/GREEN proof this rail was actually run against (see the parity-
 * rail report for the verbatim transcript) ──────────────────────────────
 * Temporarily made the SERVER lane stop handling `==highlight==` (skip the
 * `_transform_highlights` pass) -> regenerated fixtures -> this test went
 * RED on `05-highlight.json` and `07-combined.json` (`text` mismatch:
 * server retained the literal `==...==` delimiters, client had already
 * stripped them) -> reverted -> GREEN again. A parity rail nobody has
 * watched fail is not a rail.
 *
 * This rail ALSO found a real, pre-existing bug on its first run (not an
 * injected one): a resolved wikilink/embed whose vault path contains a
 * space — Obsidian's own default note-naming convention — degraded to
 * literal broken text server-side (an un-bracketed CommonMark link
 * destination containing a space is invalid and markdown-it-py renders the
 * whole `[text](url)` as plain text) while resolving correctly client-side
 * (which builds an HTML attribute, not markdown link syntax, so a literal
 * space is harmless). Fixed in `providers/obsidian.py` by wrapping the
 * destination in CommonMark's angle-bracket form; see that file's own
 * "Parity-rail finding" docstring note. `01-wikilink-basename` and
 * `07-combined` exercise a space-containing target specifically so this
 * rail keeps covering that fix.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { obsidianAdapter } from './adapters/obsidian'
import { htmlToNote } from './convert'
import { extractPlainText } from '../tiptap'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'obsidian_parity')

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) return []
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8')
      return { file, fixture: JSON.parse(raw) }
    })
}

const fixtures = loadFixtures()

const vf = (p, text) => ({
  path: p,
  size: text.length,
  lastModified: null,
  bytes: async () => new TextEncoder().encode(text),
})

// Mirrors `obsidian_parity_fixtures_gen.py::_normalize_link_href` — strips
// the `import-link://obsidian:` scheme and NOTHING ELSE. The rail compares
// the stored hrefs byte-for-byte: it used to `decodeURIComponent` the
// remainder, which hid the defect it exists to catch (a name with a space
// that stored `%20` and never resolved).
function normalizeLinkHref(href) {
  const prefix = 'import-link://obsidian:'
  return href.startsWith(prefix) ? href.slice(prefix.length) : href
}

// Mirrors `obsidian_parity_fixtures_gen.py::_normalize_image_src`.
function normalizeImageSrc(src) {
  const prefix = 'import-ref://'
  return src.startsWith(prefix) ? src.slice(prefix.length) : src
}

// Mirrors `obsidian_parity_fixtures_gen.py::_walk_semantic` exactly:
// document-order walk collecting resolved link targets, resolved image
// targets, and task-checked states — the three cross-lane-comparable facts
// a wikilink/embed/task-list pre-pass can get wrong.
function walkSemantic(node, out) {
  if (!node || typeof node !== 'object') return
  const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {}
  if (node.type === 'text') {
    const linkMark = (node.marks || []).find((m) => m?.type === 'link')
    const href = linkMark ? linkMark.attrs?.href || '' : ''
    if (linkMark && href.startsWith(PENDING_PREFIX)) {
      // A link waiting for its note (a `name:` key) is never a resolved link.
      out.pending.push({ text: node.text || '', key: href.slice('import-link://'.length) })
    } else if (linkMark) {
      out.links.push({
        text: node.text || '',
        target: normalizeLinkHref(href),
      })
    }
    // N5: the highlight mark -- its run's text and colour (null = default).
    const hlMark = (node.marks || []).find((m) => m?.type === 'highlight')
    if (hlMark) out.highlights.push({ text: node.text || '', color: hlMark.attrs?.color ?? null })
  } else if (node.type === 'image') {
    out.images.push(normalizeImageSrc(attrs.src || ''))
  } else if (node.type === 'callout') {
    out.callouts.push(attrs.variant ?? null)
  } else if (node.type === 'taskItem') {
    out.task_checked.push(!!attrs.checked)
  }
  for (const child of node.content || []) walkSemantic(child, out)
}

// Mirrors `obsidian_parity_fixtures_gen.py::semantic_summary`. `text` reuses
// `lib/tiptap.js::extractPlainText` — the same function already pinned in
// lockstep with the server's `notes.py::extract_plain_text` for the
// notebook search index — rather than a third hand-rolled text walker.
function semanticSummary(doc) {
  const out = { links: [], images: [], task_checked: [], highlights: [], pending: [], callouts: [] }
  walkSemantic(doc, out)
  return { text: extractPlainText(doc), ...out }
}

// Plan A Task 13: `pending` is SERVER-ONLY by design, not a gap. The sync lane keeps a
// link to a note that has not arrived yet under a `name:` key so a later sync heals it;
// a one-shot drag-in has no "later", and shows the same text with no link. `text` still
// compares, so the member reads the same words in both lanes.
const SERVER_ONLY_FIELDS = ['pending']
const PENDING_PREFIX = 'import-link://name:obsidian:'

function withoutServerOnly(summary) {
  const out = { ...summary }
  for (const field of SERVER_ONLY_FIELDS) delete out[field]
  return out
}

async function clientSummaryFor(fixture) {
  const vfiles = fixture.vault_paths.map((p) =>
    vf(p, p === fixture.self_path ? fixture.input_markdown : ''))
  const { docs } = await obsidianAdapter.parse(vfiles)
  const doc = docs.find((d) => d.importKey === `obsidian:${fixture.self_path}`)
  const { bodyJson } = htmlToNote(doc.html)
  return semanticSummary(bodyJson)
}

// Differences the CLIENT importer is known to have against the server lane,
// named one by one so the rail stays strict for everything else. Never
// normalize a difference away -- list it here, with the plan that closes it.
//   09-space-and-pipe: the client adapter does not unescape `\|` inside a
//   table cell, so `[[Other note\|alias]]` never resolves. Closed by Plan B
//   (client importer), task "Obsidian escaped pipe" -- delete this entry then.
//   10..14 (server Plan A Task 13): rules the server lane adopted that the client
//   adapter has not yet. Each is closed by the named Plan B (client importer) task --
//   delete the entry then; the rail turns red until you do.
const knownClientGap = {
  '09-space-and-pipe.json': {
    missingLinks: [{ target: 'Other note.md', text: 'alias' }],
  },
  // Plan B task "Obsidian relative links" (spec O-5): the client keeps the raw relative
  // href and drops the one that is not beside the note; the server resolves all four.
  '10-relative-links.json': {
    clientReads: {
      links: [
        { text: 'the other', target: 'Other%20note.md' },
        { text: 'up and over', target: '../Notes/Other.md' },
        { text: 'a section', target: 'Other%20note.md#Heading' },
      ],
    },
  },
  // Plan B task "Obsidian anchors" (spec §5.2 polish, O-11): the client shows
  // `Other note#Risk`. ⚰️ Its `![[Other note]]` file chip of the raw `.md` is closed
  // (D1 fix round 2, M4): a note embed is now a link to the note on both lanes.
  '11-anchors-and-embeds.json': {
    clientReads: {
      links: [
        { text: 'Other note#Risk', target: 'Other note.md' },
        { text: 'the risk', target: 'Other note.md' },
        { text: 'Other note', target: 'Other note.md' },
      ],
      text: 'Anchors and embeds See Other note#Risk and the risk. Other note',
    },
  },
  // Plan B task "Obsidian callouts" (spec §5.2 polish): the client writes a blockquote
  // with a bold title, and its marker regex loses the untitled callout's title.
  '12-callouts.json': {
    clientReads: {
      callouts: [],
      text: 'Callouts Size Keep it small. > Wait for the pivot.',
    },
  },
  // The same Plan B "Obsidian callouts" gap as 12 and nothing else: the client writes
  // the two callouts as blockquotes. Their titles' links, the highlighted links and the
  // text all compare strictly (D1 fix round 3, N1/N2).
  '16-links-in-highlights-and-callouts.json': {
    clientReads: { callouts: [] },
  },
  // The same callout gap again and nothing else: member text holding the client's
  // placeholder characters (U+E000 runs, U+FDD0 runs, icon-font glyphs) compares
  // strictly on text, links, highlights and pending names (D1 fix round 4, P1).
  '17-member-placeholder-characters.json': {
    clientReads: { callouts: [] },
  },
  // ⚰️ 13-duplicate-basenames: closed by D1 fix round 2 (M1). Both lanes now share one
  // tie-break (same folder, then shortest path, then sort order).
  // Plan B task "Obsidian deep links" (spec L-4): the client drops an
  // `obsidian://open?vault=<this vault>` link to text; the server resolves it.
  '14-raw-html-and-deep-link.json': {
    missingLinks: [{ target: 'Plan.md', text: 'the plan' }],
  },
}

describe('Obsidian client<->server pre-pass parity', () => {
  // Non-vacuity control — mirrors serverConvert.contract.test.js's own: a
  // missing/empty fixtures dir must fail loudly, not report zero tests as a
  // silent pass.
  it('found at least one committed parity fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  describe.each(fixtures.map(({ file, fixture }) => [file, fixture]))('%s', (file, fixture) => {
    it('client adapter agrees with the server provider on the semantic outcome', async () => {
      const clientSummary = withoutServerOnly(await clientSummaryFor(fixture))
      const server = withoutServerOnly(fixture.server)
      const gap = knownClientGap[file]
      if (!gap) {
        expect(clientSummary).toEqual(server)
        return
      }
      // A named gap stays STRICT: the client must equal the server minus
      // exactly the listed links (so it cannot widen), and those links must
      // really be absent (so fixing Plan B forces this entry's removal).
      const missing = gap.missingLinks || []
      let expected = {
        ...server,
        links: server.links.filter(
          (l) => !missing.some((m) => m.target === l.target && m.text === l.text)),
      }
      expect(expected.links.length).toBe(server.links.length - missing.length)
      // `clientReads`: the field values the client lane produces TODAY, spelled out in
      // full. Each must really differ from the server's (a Plan B fix turns this red
      // and forces the entry's removal), and every field not named still compares.
      for (const [field, value] of Object.entries(gap.clientReads || {})) {
        expect(value, `${file}: ${field} is not a gap any more`).not.toEqual(server[field])
        expected = { ...expected, [field]: value }
      }
      expect(clientSummary).toEqual(expected)
    })
  })
})
