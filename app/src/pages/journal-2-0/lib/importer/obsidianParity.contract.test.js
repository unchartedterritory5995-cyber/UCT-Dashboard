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
 * REAL server-side pre-pass (`providers.obsidian._preprocess_obsidian_
 * markdown`) + the real converter (`convert.mddoc.md_to_tiptap`) over a
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
// this lane's own identity-encoding down to the bare resolved vault path.
// The client lane never had a vault_id segment to begin with (see the file
// docstring), so there is no vault_id prefix to strip here, only the
// `import-link://obsidian:` scheme. `decodeURIComponent` is a defensive
// no-op mirror of the Python side's `urllib.parse.unquote` — the client
// never percent-encodes (it sets hrefs as raw HTML attribute values), but
// decoding a string with no `%` escapes is idempotent, so this keeps both
// normalizers symmetric on purpose.
function normalizeLinkHref(href) {
  const prefix = 'import-link://obsidian:'
  const remainder = href.startsWith(prefix) ? href.slice(prefix.length) : href
  return decodeURIComponent(remainder)
}

// Mirrors `obsidian_parity_fixtures_gen.py::_normalize_image_src`.
function normalizeImageSrc(src) {
  const prefix = 'import-ref://'
  const remainder = src.startsWith(prefix) ? src.slice(prefix.length) : src
  return decodeURIComponent(remainder)
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
    if (linkMark) {
      out.links.push({
        text: node.text || '',
        target: normalizeLinkHref(linkMark.attrs?.href || ''),
      })
    }
  } else if (node.type === 'image') {
    out.images.push(normalizeImageSrc(attrs.src || ''))
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
  const out = { links: [], images: [], task_checked: [] }
  walkSemantic(doc, out)
  return { text: extractPlainText(doc), ...out }
}

async function clientSummaryFor(fixture) {
  const vfiles = fixture.vault_paths.map((p) =>
    vf(p, p === fixture.self_path ? fixture.input_markdown : ''))
  const { docs } = await obsidianAdapter.parse(vfiles)
  const doc = docs.find((d) => d.importKey === `obsidian:${fixture.self_path}`)
  const { bodyJson } = htmlToNote(doc.html)
  return semanticSummary(bodyJson)
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
      const clientSummary = await clientSummaryFor(fixture)
      expect(clientSummary).toEqual(fixture.server)
    })
  })
})
