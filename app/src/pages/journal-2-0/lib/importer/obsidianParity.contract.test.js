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
import { parseImport } from './postParse'
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
  } else if (node.type === 'attachmentChip') {
    // Plan C Task 4: a non-image file is a chip in both lanes; its NAME, in document
    // order (the client lane writes it from `data-name`, the server from the ref), and
    // D2 item 6, its LABEL (the member's link text; null when absent).
    out.files.push({ name: attrs.name ?? null, label: attrs.label ?? null })
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
  const out = { links: [], images: [], task_checked: [], highlights: [], pending: [], callouts: [], files: [] }
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
  // The wizard's own call (Plan B Task 3): adapter.parse + the one post-parse pass.
  const { docs } = await parseImport(obsidianAdapter, vfiles, {})
  const doc = docs.find((d) => d.importKey === `obsidian:${fixture.self_path}`)
  const { bodyJson } = htmlToNote(doc.html)
  const summary = semanticSummary(bodyJson)
  // Plan B Task 3: the client's post-parse pass turns a hotlinked `<img src="https://…">`
  // into a remote media item (`import-ref://remote-<md5>`, copied by the fetch door at
  // commit), where the server summary still names the URL. Same image, two transports: read
  // the ref back through the doc's OWN media list to the URL it stands for. Only a remote
  // item is mapped; a vault file or a data: item keeps its ref.
  const remote = new Map(doc.media.filter((m) => m.remoteUrl).map((m) => [m.ref, m.remoteUrl]))
  summary.images = summary.images.map((ref) => remote.get(ref) ?? ref)
  return summary
}

// Differences the CLIENT importer is known to have against the server lane,
// named one by one so the rail stays strict for everything else. Never
// normalize a difference away -- list it here, with the plan that closes it; delete the
// entry when it closes (the rail turns red until you do).
// ⚰️ 09 (escaped pipe), 10 (relative links), 11 (anchor text + note embeds),
// 13 (duplicate names) and 14 (deep links) were listed here until Plan B Task 8 closed
// them (`obsidianResolve.js` + `adapters/obsidian.js`).
const knownClientGap = {
  // ⚰️ 11-anchors-and-embeds: also closed by D2 item 8. Both lanes show a heading link as
  // `Other note > Risk` (the client showed `Other note#Risk`); the `![[Other note]]` file
  // chip was closed by D1 fix round 2, M4.
  // ⚰️ 12-callouts, 16-links-in-highlights-and-callouts, 17-member-placeholder-characters:
  // closed by D2 item 1 (master listed 12 here as ruling R9's polish until the merge). The
  // client writes an Obsidian callout as the callout node (the server's variant and bold
  // title), and an untitled callout's title is its type.
  // ⚰️ 13-duplicate-basenames: also closed by D1 fix round 2 (M1). Both lanes share one
  // tie-break (same folder, then fewest folders, then sort order; `obsidianResolve.js::rank`
  // and the server's `_pick`).
  // Plan B final review, fix 2 (DELIBERATE, not a Plan B gap): the server knows its vault's
  // name (the plugin's device label), so `vault=Trading` resolves there. A client drop of
  // LOOSE files (no `.obsidian/`, no single top folder) cannot show the link is into the
  // vault it holds, so the deep link stays text rather than resolve by name across the drop
  // (which opened another vault's note). Dropped as a `Trading/` folder, the client links it.
  '14-raw-html-and-deep-link.json': {
    missingLinks: [{ target: 'Plan.md', text: 'the plan' }],
  },
  // ⚰️ 15-dotted-names and 18-attachment-names: closed by Plan C Task 4 fix round 1.
  // Both lanes dropped the no-dot stem rule (`[[chart]]` names `chart.md` only), and
  // both check a `#`-holding target against the vault's full file names before
  // splitting an anchor (`![[my chart #1 (v2).png]]` keeps its image).
  // ⚰️ 25-code-span-link-text: closed by D3 item 2. A code run inside a link keeps the LINK
  // and loses the code mark on both lanes (`convert.js::liftLinksOutOfCode`,
  // `convert/marks.py::exclusive_marks`), so `the x plan` is one link run on both.
  // 27-tilde-fence (D2 fix round 3, M-new-1): images, links and media agree -- the `~~~`
  // fence keeps its embed and wikilink as code on both lanes. What is left is a code BLOCK
  // difference no Obsidian pass makes: the shared client parse keeps the fence's final
  // newline in the codeBlock text (markdown-it), the server's `mddoc` drops it. Every
  // importer's fenced code has it. Closed by D3 (shared-converter follow-up PR: fenced
  // code final newline) -- delete this entry then.
  '27-tilde-fence.json': {
    clientReads: {
      text: 'Tilde fence before ![[img.png]] [[Plan]]\n after ',
    },
  },
  // 28-blank-line-and-fence-alias (D2 fix round 5, M-r4-1): links, images and media agree --
  // a link or embed across a blank line or a fence is left as written on both lanes, and a
  // single-newline alias is the one link, in a quote too (follow-up: a `>`-only quote line
  // is a paragraph break, and a one-line ``` run is inline code a link may hold). What is
  // left is D3 differences, neither an Obsidian pass:
  //   - 27's code BLOCK difference: the client keeps the fence's final newline in the
  //     codeBlock text, the server's `mddoc` drops it (D3: fenced code final newline);
  //   - ⚰️ 25's code RUN difference (the link on `x`) was closed by D3 item 2.
  //   - Round 5 (final), ruling A's `[[Plan|a\n<div>b]]` row: no link and no key on either
  //     lane, but the raw HTML block `<div>b]]` reads differently in the SHARED parses: the
  //     server's `mddoc` keeps the tag as text (`<div>b]]`), the client's parse renders it
  //     (`b]]`). Not an Obsidian pass; named for D3 (shared-converter follow-up PR: raw
  //     HTML blocks).
  // Delete this entry when D3 lands.
  '28-blank-line-and-fence-alias.json': {
    clientReads: {
      text: 'Blank line or fence in a link see [[Plan|first second]] end see [[Pl an]] end '
        + 'x ![[chart.png|a b]] y [[Plan|a code\n b]] see one line still links '
        + 'quoted [[Plan|c d]] stays text quoted one line still links see a x b inline code links '
        + 'see [[Plan|a b]] end see [[Plan|a b]] end see [[Plan|a b]] end see [[Plan|a b]] end '
        + 'see [[Plan|a b]] end see [[Plan|a b]] end [[Plan|a b]]',
    },
  },
  // ⚰️ 18-attachment-names and 19-nested-embeds: their text gaps (the EMPTY paragraph
  // beside a block image, and `Read ` losing its trailing space at a chip split, from the
  // shared parse `convert.js::htmlToNote`) are closed by D2 item 5.
  // Both lanes still drop the link text `the report` for a chip in 18 (no label
  // attribute); D2 item 6 adds an optional `attachmentChip.label`, and 18's `files`/`text`
  // move when it lands.
}

// DELIBERATE lane differences no parity fixture can carry, named one by one, each pinned
// below on the client and in `test_obsidian_provider.py::test_the_named_lane_differences`
// on the server, so a change on either side is seen. Never a gap to close.
//   attachment-folder (post-merge fix 2): Obsidian's "Files and links > Default location for
//   new attachments" lives in `<vault>/.obsidian/app.json`. A FILE IMPORT holds that file,
//   so the client's resolver ties a same-named file to the attachment folder after the
//   note's own folder (`obsidianResolve.js::rank`, Plan B). The SERVER lane never sees
//   `.obsidian/`: the plugin stages notes and their attachment refs only. A live sync from a
//   0.2.0 plugin resolves every attachment with Obsidian's OWN resolver and sends the
//   result as a ref (`_apply_attachment_refs`), so it honours the setting already; only the
//   old-plugin fallback (no ref list) resolves by the server's rule, which has no setting to
//   read and ties by fewest folders, then sort order (`_pick`). With no setting both lanes
//   agree (the vault root's files already have the fewest folders).
const DELIBERATE_LANE_DIFFERENCES = {
  'attachment-folder': {
    paths: ['V/A/x.png', 'V/Files/x.png', 'V/C/m.md'],
    appJson: '{"attachmentFolderPath":"Files"}',
    source: 'V/C/m.md',
    target: 'x.png',
    client: 'V/Files/x.png',
    server: 'V/A/x.png',
  },
}

describe('Obsidian deliberate lane differences', () => {
  it('attachment-folder: the client honours app.json; the server cannot see it', async () => {
    const { makeObsidianResolver } = await import('./obsidianResolve')
    const d = DELIBERATE_LANE_DIFFERENCES['attachment-folder']
    const files = [vf('V/.obsidian/app.json', d.appJson), ...d.paths.map((p) => vf(p, ''))]
    const r = await makeObsidianResolver(files)
    expect(r.resolve(d.target, d.source)).toBe(d.client)
    expect(d.client).not.toBe(d.server)
    // With no setting the client takes the server's answer.
    const bare = await makeObsidianResolver(d.paths.map((p) => vf(p, '')))
    expect(bare.resolve(d.target, d.source)).toBe(d.server)
  })
})

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

// ── D2 fix round 5 (final), ruling B: the adversarial alias corpus ───────────
// `obsidian_parity_fixtures_gen.py::generate_adversarial` writes ~200 alias shapes (block
// starts, quote prefixes, newlines, fences, code spans) with the notes the SERVER links
// each to. The client must link the same notes, and neither lane may ever show an internal
// key or scheme as text (the client's held-markup placeholders included).
const ADVERSARIAL = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '__fixtures__/obsidian_adversarial/corpus.json'), 'utf8'))
// `obsidian_parity_fixtures_gen.py::INTERNAL_MARKERS`, plus the client's own placeholders.
const INTERNAL_MARKERS = ['import-link://', 'import-ref://', 'obsidian-att:', 'obsidian-file:',
  'obsidian-notice:']
// The held-markup placeholder code points (U+FDD0, U+E001, U+E010 to U+E019), built from
// numbers so this file holds no raw noncharacter or private-use code point.
const CLIENT_PLACEHOLDER_RE = new RegExp(`[${String.fromCharCode(0xfdd0, 0xe001, 0xe010)}-${String.fromCharCode(0xe019)}]`)

// Mirrors `providers/obsidian.py::_visible_strings`.
function visibleStrings(node, out = []) {
  if (node && typeof node === 'object') {
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
    for (const [k, v] of Object.entries(node.attrs || {})) {
      if (['label', 'name', 'alt', 'title'].includes(k) && typeof v === 'string') out.push(v)
    }
    for (const child of node.content || []) visibleStrings(child, out)
  }
  return out
}

describe('Obsidian adversarial alias corpus (ruling B)', () => {
  it('holds the committed corpus', () => {
    expect(ADVERSARIAL.cases.length).toBeGreaterThanOrEqual(190)
  })

  it('the client links the same notes as the server and never shows an internal key', async () => {
    const disagree = []
    const leaks = []
    for (const { input, targets } of ADVERSARIAL.cases) {
      const vfiles = ADVERSARIAL.vault_paths.map((p) => vf(p, p === 'a.md' ? input : ''))
      // Through `parseImport`, the wizard's own call (as `clientSummaryFor` above).
      const { docs } = await parseImport(obsidianAdapter, vfiles, {})
      const doc = docs.find((d) => d.importKey === 'obsidian:a.md')
      const { bodyJson } = htmlToNote(doc.html)
      const got = [...new Set(semanticSummary(bodyJson).links.map((l) => l.target))].sort()
      if (JSON.stringify(got) !== JSON.stringify(targets)) disagree.push({ input, got, targets })
      const seen = visibleStrings(bodyJson).join(' ')
      if (INTERNAL_MARKERS.some((m) => seen.includes(m)) || CLIENT_PLACEHOLDER_RE.test(seen)) {
        leaks.push({ input, seen })
      }
    }
    expect(leaks).toEqual([])
    expect(disagree).toEqual([])
  })
})
