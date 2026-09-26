# Notebook export formats — what each one keeps

Wave 8, lane 8C (item C4; rulings D-C2, D-C3, D-C4, D-C5, D-C8). The Notebook exports in
four formats. This page says what each one keeps of a note, node by node. **The table
below is measured, not typed**: it is the output of the round-trip rail
`app/src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js`, which fails if
this page and the measurement disagree.

## The four formats

| Format | What it is | Where |
|---|---|---|
| **Markdown** (the default) | One `.md` per note with YAML front matter, folders as directories, attachments bundled beside them. The same archive the Notebook has always exported — the format seam moved none of its bytes, and the only changes are the C5 fidelity fixes below (`tests/test_notes_export_formats.py` pins both). | Export dialog; each note's *Export* menu; `GET /api/j2/notes/export`, `GET /api/j2/notes/{id}/export` |
| **Web page (HTML)** | One standalone `.html` per note: the Markdown writer's output rendered by `markdown-it-py`, then an allowlist sanitizer, in a page with its styles inline. Opens in any browser, offline. Formulas stay as TeX in `<code class="math">`. | `GET /api/j2/export/notebook?format=html`, `GET /api/j2/export/notes/{id}?format=html` |
| **JSON** | One `.json` per note: the stored document **verbatim** (only attachment addresses become their paths inside the archive), plus the note's title, subtitle, folder path, tags, ticker, properties, dates and schema level. The **lossless** format: our importer reads it back exactly. | `...?format=json` |
| **Word (.docx)** | One `.docx` per note, written with the Python standard library (no dependency). Headings, marks, lists, tables, quotes, code, links and this note's images are Word's own; everything else becomes its text. | `...?format=docx` |

PDF is not a fourth file format: open the note and use **Print**, then **Save as PDF**.

**Selected notes** (the bulk bar's *Export*) stay Markdown in wave 8 (ruling D-C8). The
other formats export the whole notebook or one note.

A single note exported as HTML or JSON is one bare file when it has no attachments, and a
zip (the note, its attachments, and `EXPORT_ISSUES.txt` if anything could not be included)
when it has some — the same rule as Markdown. A single note exported as Word is always one
`.docx`: its images are inside it, and anything it could not hold (a file attachment, a
missing image) is listed at the end of the document under *Not included in this export*.

## Markdown fidelity fixes (wave 8, C5)

Three carry-overs, each railed through the real exporter and importer in
`app/src/pages/journal-2-0/lib/importer/fidelityCarryovers.roundtrip.test.js`:

- **Math and highlight come back.** The writer's `$…$`, `$$` blocks and `==…==` now
  re-import as a formula, a display formula and a highlight (the importer's reader:
  `lib/importer/markdownExtensions.js`, the same rules the web page's renderer uses). A `$`
  in prose is still escaped, and money written elsewhere (`$5 and $10`) or a comparison
  (`a == b == c`) stays text.
- **Image alts keep every character.** An alt holding `*`, `_`, `&amp;`, `$`, a backslash
  or brackets is escaped in the Markdown (so two `$` can never pair as math) and comes back
  exactly — in the Markdown re-import and in the web page's `<img alt>`.
- **A typed backslash stays.** A backslash before punctuation (`\*`, `\_`, `\$`), a double
  backslash, or one before a line break is written so it reads back as typed. A lone
  backslash before a letter (`C:\Users`) is left as it was, so paths stay readable.

## How the table is measured

For every node and mark type registered in `app/src/pages/journal-2-0/lib/notebookSchema.js`
(the list is parsed from that file, never typed — a type added tomorrow without a fixture
fails the rail by name), the rail builds one small note, exports it through the **real**
exporter in each format, and reads it back through the **real** importer:

- **Markdown** — `generic.js` (`mdToHtml`) then `convert.js` (`htmlToNote`);
- **Web page** — `htmlToNote` over the exported body;
- **JSON** — `detectAdapter` → the `uct` adapter (a whole exported archive);
- **Word** — the importer's Word path (`mammoth`) then `htmlToNote`.

Each cell is then one of:

- **kept** — the re-imported note holds that node or mark type (for JSON: the whole body
  came back deep-equal);
- **flattened** — the type is gone but its words survived (a callout that comes back as
  its paragraph);
- **dropped** — neither the type nor its words came back. For some types that is the
  format's nature rather than a loss of words: a horizontal rule, a note link (Word writes
  the target's *title* as text, which the rail does not count as the link), or a node whose
  content lives outside the note (a financial fact, a document excerpt — in Markdown and
  Word these are written from the note's front matter or the excerpt itself when the
  export can reach them).

Note-level fields: Markdown carries every field in its front matter; JSON carries the same
fields (`extras` holds favorite, related tickers, linked trades, financial facts, thesis
evidence and reviews); the web page shows the title, subtitle, tags, ticker, properties and
hero image in its header; Word writes the title, subtitle, tags, ticker and properties at
the top. On **re-import**, JSON restores the body, title, subtitle, tags, ticker, folder
path and dates; it does **not** restore the hero image, properties or extras (the import
route takes none of them).

<!-- BEGIN GENERATED: export fidelity table (lib/importer/exportFormats.roundtrip.test.js) -->
| Type | Schema | Markdown | Web page (HTML) | JSON | Word |
|---|---|---|---|---|---|
| `attachmentChip` | 0 | flattened | flattened | kept | flattened |
| `blockquote` | 0 | kept | kept | kept | flattened |
| `bold` | 0 | kept | kept | kept | kept |
| `bulletList` | 0 | kept | kept | kept | kept |
| `callout` | 0 | kept | kept | kept | flattened |
| `code` | 0 | kept | kept | kept | flattened |
| `codeBlock` | 0 | kept | kept | kept | flattened |
| `doc` | 0 | kept | kept | kept | kept |
| `documentExcerpt` | 0 | dropped | dropped | kept | dropped |
| `financialFact` | 0 | dropped | dropped | kept | dropped |
| `hardBreak` | 0 | flattened | flattened | kept | kept |
| `heading` | 0 | kept | kept | kept | kept |
| `horizontalRule` | 0 | kept | kept | kept | dropped |
| `image` | 0 | kept | kept | kept | flattened |
| `italic` | 0 | kept | kept | kept | kept |
| `link` | 0 | kept | kept | kept | kept |
| `listItem` | 0 | kept | kept | kept | kept |
| `noteLink` | 0 | dropped | dropped | kept | dropped |
| `orderedList` | 0 | kept | kept | kept | kept |
| `paragraph` | 0 | kept | kept | kept | kept |
| `strike` | 0 | kept | kept | kept | kept |
| `table` | 0 | kept | kept | kept | kept |
| `tableCell` | 0 | kept | kept | kept | kept |
| `tableHeader` | 0 | kept | kept | kept | kept |
| `tableRow` | 0 | kept | kept | kept | kept |
| `taskItem` | 0 | kept | kept | kept | flattened |
| `taskList` | 0 | kept | kept | kept | flattened |
| `text` | 0 | kept | kept | kept | kept |
| `textStyle` | 0 | flattened | flattened | kept | flattened |
| `toggle` | 0 | kept | kept | kept | flattened |
| `toggleContent` | 0 | kept | kept | kept | flattened |
| `toggleSummary` | 0 | kept | kept | kept | flattened |
| `underline` | 0 | flattened | flattened | kept | flattened |
| `videoTimestamp` | 0 | flattened | flattened | kept | flattened |
| `widgetEmbed` | 0 | flattened | flattened | kept | flattened |
| `askCitation` | 1 | flattened | flattened | kept | flattened |
| `askInsert` | 1 | flattened | flattened | kept | flattened |
| `blockMath` | 1 | kept | kept | kept | flattened |
| `highlight` | 1 | kept | kept | kept | flattened |
| `inlineMath` | 1 | kept | kept | kept | flattened |
| `textColor` | 1 | flattened | flattened | kept | flattened |
| `column` | 2 | flattened | flattened | kept | flattened |
| `columns` | 2 | flattened | flattened | kept | flattened |
| `dateMention` | 2 | flattened | flattened | kept | flattened |
| `imageCaption` | 2 | flattened | flattened | kept | flattened |
| `imageFigure` | 2 | flattened | flattened | kept | flattened |
| `linkPreview` | 2 | flattened | flattened | kept | flattened |
| `tableOfContents` | 2 | dropped | dropped | kept | dropped |
| `webEmbed` | 2 | flattened | flattened | kept | flattened |
<!-- END GENERATED -->

## Safety

- **HTML**: the rendered page passes an allowlist sanitizer (`notes_export_formats.py`):
  only a fixed set of tags and attributes; links and images only to `http`, `https`,
  `mailto` (links) and relative paths inside the archive; no `on*` attribute, no
  `javascript:`, no `data:`. A tag outside the list is written back as the literal text the
  member typed, and `javascript:` / `on<name>=` never appear in the file even as text.
  Railed with hostile input (`<script>` as text, a `javascript:` link, an image alt holding
  `" onerror="`) and mutation-proved.
- **Word**: the only external relationships a document carries are `http`/`https`
  hyperlinks; every other link is written as its text.
- **Every format** reads attachments through the same tenancy check, path containment and
  byte cap (`NOTE_EXPORT_MAX_ATTACHMENT_BYTES`, default 200 MiB) as the Markdown export; Word
  images count against that cap every time they are embedded.
