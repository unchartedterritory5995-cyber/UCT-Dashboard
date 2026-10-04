# Obsidian (O) column proposals — wave 15 lane O

Research lane for the 28 owed rows of the Notebook parity scorecard's Obsidian (O) column.
**This file is a PROPOSAL, not an edit to the scorecard.** No row in `docs/notebook/parity-scorecard.md`
or `docs/notebook/competitive-gap-ledger.md` was changed by this lane; an integrator applies these
results. `tools/parity_scorecard.py` was read (lines 1-120), not edited.

**Method.** Fetched the raw markdown source of every English page in `obsidianmd/obsidian-help`
(176 pages, `master` branch, via `raw.githubusercontent.com`) and grepped locally for each row's
capability — never WebFetch (which summarizes; this task needs verbatim text). Per the tool's own
rule, a quote is checked against a page with its `[[target|display]]` / `[[target]]` wikilinks
rendered to their display text first — confirmed by simulation for every quote below that contains
one. Saved copies live outside the repo at
`C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\scorecard-pages\obsidian\<page id>.txt`
(never committed). URLs are `https://help.obsidian.md/<permalink>`, permalink read from each page's
own frontmatter. All fetch times are UTC, 2026-10-04.

**Where no official page states the capability**, the row is recorded as such with every URL
checked — never inferred from absence. That matches the existing convention in the scorecard
(e.g. G-005's Notion/Obsidian cells today: *"not verified — no Notion help page fetched today (R12)
states it"*) — a `NOT-VERIFIED` cell that stays `NOT-VERIFIED` is a positive, checked finding, not
a skipped one.

---

## G-003 — Account-deletion purge reaches Notebook data

- Page id: none settles it. Checked: `sync__security_and_privacy`, `sync__faq`,
  `licenses__refund_policy`, `licenses__introduction`, `files__how_obsidian_stores_data`
- URLs checked: https://help.obsidian.md/sync/security (sha256
  `a3d3cc16006f10769793ee512f4f4ec0cc26dfa39dd9e3cdfd9a7e692c194337`, fetched 14:48 UTC) ·
  https://help.obsidian.md/sync/faq (sha256 `6778b1a9fd40568ba4de73b49aee3326c0dda43b3ef02b91f37456a639859e08`,
  fetched 14:48 UTC) · https://help.obsidian.md/refunds (sha256
  `1284d2bee00db72a69d0f67e6ff06ca7200d9396a9316dd0634d4e7254275aca`, fetched 14:48 UTC) ·
  https://help.obsidian.md/payment (sha256 `48906d06e7d466070b6ed7ea0bf9640f15bcfbc486138c2a63eafad00f472fa7`,
  fetched 14:48 UTC) · https://help.obsidian.md/data-storage (sha256
  `add03088da7be4ab2fd364918c17b006d646eafedffada5440db83217f6942e6`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Obsidian's core product has no "account" to delete (a vault is local files); the
  closest official text is the Sync FAQ's "No. The data is deleted immediately from Obsidian Sync
  servers" (refund of a *Sync subscription*, not an account-deletion cascade reaching Notebook-style
  data), which is a different act and does not settle this row.

## G-005 — Local draft safety net (crash/close protection)

- Page id: `plugins__file_recovery`
- URL: https://help.obsidian.md/plugins/file-recovery
- Fetch time UTC: 2026-10-04 14:48
- sha256: `57ae93fa2bd4d0729663d61367a3c7a3fa9c424fa275166f579b081d6d1aeefd`
- Quote: "File recovery is a core plugin that protects your work from accidental deletions, file
  corruption, or unwanted changes" (raw markdown carries this as `...a [[Core plugins|core
  plugin]] that protects...`; rendered to display text per the tool's own rule, confirmed by
  simulation)
- Proposed O verdict: **PARITY**
- Reasoning: the File recovery core plugin is Obsidian's officially documented safety net against
  losing work, via automatic snapshots every 5 minutes by default — the same protective intent as
  UCT's draft mirror, even though the mechanism (periodic snapshot vs. per-keystroke localStorage)
  differs.

## G-011 — Search read-latency at platform scale

- Page id: none settles it. Checked: `plugins__search`, `plugins__quick_switcher`
- URLs checked: https://help.obsidian.md/plugins/search (sha256
  `5a797fdbe551de35f662a64a02d0a275ebb9a65750b1a6f776860cf5c5e4b7f3`, fetched 14:48 UTC) ·
  https://help.obsidian.md/plugins/quick-switcher (sha256
  `114f299e96fe1bae5d6b75175ee45bad4002e1ebd966a7389a3ca188bfca493b`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Search's own page offers only a qualitative assurance ("even in large vaults"), and
  Quick switcher's one quantified note — "Autocomplete functionality switches to a simpler result
  algorithm when the vault reaches 10,000 items" — describes a different mechanism (note-name
  autocomplete, not full-text search), so neither gives a latency figure this row can be scored
  against.

## G-032 — Find-in-note

- Page id: none settles it. Checked: `plugins__search`, `editing__editing_shortcuts`, `ui__hotkeys`
- URLs checked: https://help.obsidian.md/plugins/search (sha256
  `5a797fdbe551de35f662a64a02d0a275ebb9a65750b1a6f776860cf5c5e4b7f3`, fetched 14:48 UTC) ·
  https://help.obsidian.md/editing-shortcuts (sha256
  `c20886bb62cf1e7461a7015ff747ebacb9914ea0e3b812ff40a1a85f971d8ed6`, fetched 14:48 UTC) ·
  https://help.obsidian.md/hotkeys (sha256 `9669b61322a5ed72a8cc9591526f9211ab7bae16962ba7303f90cdbec40e1ba5`,
  fetched 14:50 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: a full-text sweep of all 176 English help pages for "Find in", "find-in-file" and
  "Ctrl+F" returns nothing on-topic; the in-editor find/replace command is not documented anywhere
  on the official help site (Search.md documents only vault-wide search).

## G-041 — Comment/annotation field at capture time

- Page id: none settles it. Checked: `webclipper__clip_web_pages`, `webclipper__highlighter`,
  `webclipper__templates`
- URLs checked: https://help.obsidian.md/web-clipper/capture (sha256
  `4810cf31c509b02e735cb215b768f8440a915c6f60508a6be9c41f3205a1a080`, fetched 14:48 UTC) ·
  https://help.obsidian.md/web-clipper/highlight (sha256
  `c613748c58e76eb461eadc4211b805daebdc72e3c7260adb1094c8736f3068de`, fetched 14:48 UTC) ·
  https://help.obsidian.md/web-clipper/templates (sha256
  `69f8925b8d45e2f0e70b813564f00d5f5457952d57225e5c3809e7e8a950128b`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: the Web Clipper's documented capture surface has only Properties, Note content and
  Highlights; no page names a dedicated "why this matters" comment/annotation field separate from
  the captured content itself.

## G-045 — PDF / document upload + OCR

- Page id: none settles it. Checked: `editing__attachments`, `linking__embed_files`,
  `files__accepted_file_formats`, plus a full-text sweep of all 176 pages for "OCR"/"optical character"
- URLs checked: https://help.obsidian.md/attachments (sha256
  `7e3ec7096b7f7a4c4c523cc93b1d8de1a98c15141e862a243098387b8f112493`, fetched 14:48 UTC) ·
  https://help.obsidian.md/embeds (sha256 `aec6d56537a105e07fc854851575f8f96616e4c528d7da9f16db5fe1bd6bd1ff`,
  fetched 14:48 UTC) · https://help.obsidian.md/file-formats (sha256
  `95ede78937600de68ad15ade8cf5044f05261eac9f72187c2880f6a7c71b517e`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: PDF upload/embedding (incl. `#page=N` deep links) is documented, but "OCR" and
  "optical character" appear in zero of the 176 English help pages — the OCR half of this row is
  unaddressed.

## G-085 — Public API / webhooks / extensibility

- Page id: none settles it. Checked: `plugins__core_plugins`, `extending__obsidian_uri`,
  `extending__obsidian_cli`, `extending__obsidian_headless`, `extending__community_plugins`
- URLs checked: https://help.obsidian.md/plugins (sha256
  `0527cbfdb554fef0ee96f4949205a8ed03ea85d6a768741c72ddcfa50dd395ed`, fetched 14:48 UTC) ·
  https://help.obsidian.md/uri (sha256 `d401a97319322d3d3abf993dc18ab859c127060a54927b01a901781addecd5c1`,
  fetched 14:48 UTC) · https://help.obsidian.md/cli (sha256
  `884d3f36a30ad2dc08bcdc84c1243e17e255677a2bd4a7a1aa0d8f77939fc012`, fetched 14:48 UTC) ·
  https://help.obsidian.md/headless (sha256 `48e063d9f46deb199213ac6f57f099cd9e0dde67c2b78546755ca838e1914cbb`,
  fetched 14:48 UTC) · https://help.obsidian.md/community-plugins (sha256
  `7093086daa5a14a814307b113f435eff2a80e90e836a728fec681e33c236e9a1`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: the Core plugins page's complete catalog ("This page lists the core plugins that come
  installed with Obsidian") has no API/webhook plugin, and "webhook" appears nowhere on the site;
  Obsidian URI is a local `obsidian://` deep-link scheme (`open`/`new`/`daily`/…), not a documented
  remotely-callable public API, so it does not settle the row (community-plugin extensibility is
  excluded from this row per the brief).

## G-110 — "Where was I working?" resumption surface

- Page id: `plugins__quick_switcher`
- URL: https://help.obsidian.md/plugins/quick-switcher
- Fetch time UTC: 2026-10-04 14:48
- sha256: `114f299e96fe1bae5d6b75175ee45bad4002e1ebd966a7389a3ca188bfca493b`
- Quote: "If the search term is empty, the Quick switcher shows the most recent notes."
- Proposed O verdict: **PARITY**
- Reasoning: the official page confirms an MRU-style recents surface, the same kind of modest
  "resumption" capability that already earns Notion a PARITY cell on this row — a flat recents
  list, not the synthesized Continue-working/Active-theses view UCT ships, but a page states it.

## G-113 — Page-aware document search, sectioned separately from note search

- Page id: `plugins__search`
- URL: https://help.obsidian.md/plugins/search
- Fetch time UTC: 2026-10-04 14:48
- sha256: `5a797fdbe551de35f662a64a02d0a275ebb9a65750b1a6f776860cf5c5e4b7f3`
- Quote: "Obsidian only searches the contents of notes and canvases."
- Proposed O verdict: **AHEAD**
- Reasoning: the Search plugin's own page states its scope as notes and canvases only — an
  explicit limitation naming what is excluded (attachments, incl. PDFs) — so UCT's page-numbered,
  highlighted-snippet PDF-text FTS section has no native Obsidian counterpart, matching the same
  "competitor's own page states a ceiling" pattern already used for G-143's AHEAD verdicts.

## G-121 — OCR / scanned-document text

- Page id: none settles it. Checked: same full-text sweep as G-045 (176 pages, "OCR"/"optical
  character")
- URLs checked: https://help.obsidian.md/attachments (sha256
  `7e3ec7096b7f7a4c4c523cc93b1d8de1a98c15141e862a243098387b8f112493`, fetched 14:48 UTC) ·
  https://help.obsidian.md/embeds (sha256 `aec6d56537a105e07fc854851575f8f96616e4c528d7da9f16db5fe1bd6bd1ff`,
  fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: "OCR" and "optical character" appear in zero of the 176 English help pages — no
  official statement of OCR, present or absent, exists to score against.

## G-122 — Research assistant with an explicit, member-visible scope

- Page id: none settles it. Checked: `webclipper__interpreter`
- URL checked: https://help.obsidian.md/web-clipper/interpreter (sha256
  `ab2d217009e0de0a5fd38fcc47288dfe20d27363c77ed916b0d7d0e601673126`, fetched 15:02 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Interpreter is a Web Clipper feature that runs a member-configured LLM over the
  content of the single page being clipped at capture time; its page documents no cross-note
  corpus, no scope selector, and no member-visible statement of what was searched — a different
  capability from a notebook-wide research assistant.

## G-123 — A citation that is a verified location in the source

- Page id: none settles it. Checked: `webclipper__interpreter`
- URL checked: https://help.obsidian.md/web-clipper/interpreter (sha256
  `ab2d217009e0de0a5fd38fcc47288dfe20d27363c77ed916b0d7d0e601673126`, fetched 15:02 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Interpreter's page describes no citation mechanism at all — it "returns its
  responses" as text to drop into template variables, with nothing resembling a resolved location
  in a source document.

## G-124 — Refusing to answer when the corpus does not support one

- Page id: none settles it. Checked: `webclipper__interpreter`
- URL checked: https://help.obsidian.md/web-clipper/interpreter (sha256
  `ab2d217009e0de0a5fd38fcc47288dfe20d27363c77ed916b0d7d0e601673126`, fetched 15:02 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: the page documents no refusal behavior; every described path ends with the model
  "returns its responses," with no stated case where it declines to answer or skips the call.

## G-125 — Retrieved content cannot instruct the assistant

- Page id: none settles it. Checked: `webclipper__interpreter`
- URL checked: https://help.obsidian.md/web-clipper/interpreter (sha256
  `ab2d217009e0de0a5fd38fcc47288dfe20d27363c77ed916b0d7d0e601673126`, fetched 15:02 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: the page states the opposite emphasis — "By default, Interpreter uses the entire page
  HTML as its context" — with no documented boundary preventing page content from steering the
  model's behavior, so it does not describe a prompt-injection defense either way.

## G-133 — Image captions and alignment

- Page id: none settles it. Checked: `linking__embed_files`, `editing__basic_formatting_syntax`,
  `editing__advanced_formatting_syntax`
- URLs checked: https://help.obsidian.md/embeds (sha256
  `aec6d56537a105e07fc854851575f8f96616e4c528d7da9f16db5fe1bd6bd1ff`, fetched 14:48 UTC) ·
  https://help.obsidian.md/syntax (sha256 `739a3740a782d4a8979d8f90745bf0a0e2a64daab865c6db0d8ef8060dabfd64`,
  fetched 14:48 UTC) · https://help.obsidian.md/advanced-syntax (sha256
  `15ed1c714c0e8a4dd48ac05ce53df787d1eda241c78d8b27a091f142cbe26307`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Embed files documents only proportional width/height resizing (`![[img.jpg|100x145]]`)
  for images; "caption" appears nowhere in the 176-page site and no left/center/right alignment
  control for an embedded image is documented.

## G-138 — Find and replace

- Page id: none settles it. Checked: same as G-032 (`plugins__search`, `editing__editing_shortcuts`,
  `ui__hotkeys`)
- URLs checked: https://help.obsidian.md/plugins/search (sha256
  `5a797fdbe551de35f662a64a02d0a275ebb9a65750b1a6f776860cf5c5e4b7f3`, fetched 14:48 UTC) ·
  https://help.obsidian.md/editing-shortcuts (sha256
  `c20886bb62cf1e7461a7015ff747ebacb9914ea0e3b812ff40a1a85f971d8ed6`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: no official page documents a find-and-replace command (see G-032); "replace" appears
  site-wide only in the unrelated Web Clipper Filters page (a template string filter), not an
  editor command.

## G-139 — Emoji picker

- Page id: none settles it. Checked: `plugins__core_plugins`, `editing__basic_formatting_syntax`
- URLs checked: https://help.obsidian.md/plugins (sha256
  `0527cbfdb554fef0ee96f4949205a8ed03ea85d6a768741c72ddcfa50dd395ed`, fetched 14:48 UTC) ·
  https://help.obsidian.md/syntax (sha256 `739a3740a782d4a8979d8f90745bf0a0e2a64daab865c6db0d8ef8060dabfd64`,
  fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: "emoji" appears in zero of the 176 English help pages, including the complete core
  plugins catalog.

## G-140 — @date mentions

- Page id: none settles it. Checked: `plugins__daily_notes`, `editing__properties`,
  `linking__internal_links`
- URLs checked: https://help.obsidian.md/plugins/daily-notes (sha256
  `776472f0c26adcc0c7556b4a7f3b7e3440720b48b724689a0282985fede4c2b8`, fetched 14:48 UTC) ·
  https://help.obsidian.md/properties (sha256 `bd81f389b54d3d2c596465078c80f9c5769566aacdb4a83ee5d8b5ed882f5cf3`,
  fetched 15:02 UTC) · https://help.obsidian.md/links (sha256
  `a143a6c1e2aea49d2e9a443da319a3a0e086f41512978dadb73a294c977a3b0f`, fetched 15:02 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Properties documents a `date` PROPERTY (frontmatter metadata, filled via a date
  picker) that links to the matching daily note — a different mechanism from UCT's inline
  `@today`/`@tomorrow` typed trigger in the note body; no "@" mention syntax is documented anywhere.

## G-142 — Multi-column layout

- Page id: none settles it. Checked: `editing__advanced_formatting_syntax`,
  `editing__basic_formatting_syntax`, `bases__views`
- URLs checked: https://help.obsidian.md/advanced-syntax (sha256
  `15ed1c714c0e8a4dd48ac05ce53df787d1eda241c78d8b27a091f142cbe26307`, fetched 14:48 UTC) ·
  https://help.obsidian.md/bases/views (sha256
  `1e00fbf9cd2ca1f46dd9e7ed821dcb008bc517c2bb9f92a8590e7b2121a65f16`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: "column" appears in the official docs only for table columns (`|`-delimited) and
  Bases table-view columns; no side-by-side block/page layout feature is documented.

## G-144 — An undo/redo control on touch

- Page id: none settles it. Checked: `getting_started__mobile_app`, `editing__editing_shortcuts`
- URLs checked: https://help.obsidian.md/mobile (sha256
  `e359fbc1ca45c91014aa926ac4ed6a42309592e1e343f3ddfc4e0a7b65a78692`, fetched 14:48 UTC) ·
  https://help.obsidian.md/editing-shortcuts (sha256
  `c20886bb62cf1e7461a7015ff747ebacb9914ea0e3b812ff40a1a85f971d8ed6`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: the Mobile app page documents a customizable toolbar and generic "Add global command"
  (e.g. "Change theme") but never names Undo or Redo as a toolbar entry, default or addable;
  Editing shortcuts' Undo/Redo rows are desktop keyboard shortcuts only.

## G-149 — Timeline view

- Page id: none settles it. Checked: `bases__views`, `plugins__core_plugins`
- URLs checked: https://help.obsidian.md/bases/views (sha256
  `1e00fbf9cd2ca1f46dd9e7ed821dcb008bc517c2bb9f92a8590e7b2121a65f16`, fetched 14:48 UTC) ·
  https://help.obsidian.md/plugins (sha256 `0527cbfdb554fef0ee96f4949205a8ed03ea85d6a768741c72ddcfa50dd395ed`,
  fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Bases/Views names five layouts — table, list, cards, Kanban and map — with no
  Timeline among them, but the same sentence hedges that "additional layouts can be added by
  Community plugins" and some "are still being developed," so this is an absence from the current
  list, not a clean statement that Obsidian lacks a Timeline view; not read as settling the row.

## G-150 — Archive state

- Page id: none settles it. Checked: `plugins__core_plugins`
- URL checked: https://help.obsidian.md/plugins (sha256
  `0527cbfdb554fef0ee96f4949205a8ed03ea85d6a768741c72ddcfa50dd395ed`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: "archive" appears site-wide only in import-from-other-apps contexts (Google Keep,
  Roam, Logseq, a Web Clipper filter); no Obsidian note-level archive/unarchive state is documented.

## G-151 — Note lock (read-only)

- Page id: none settles it. Checked: `plugins__core_plugins`, `editing__views_and_editing_mode`
- URLs checked: https://help.obsidian.md/plugins (sha256
  `0527cbfdb554fef0ee96f4949205a8ed03ea85d6a768741c72ddcfa50dd395ed`, fetched 14:48 UTC) ·
  https://help.obsidian.md/edit-and-read (sha256
  `0835028c12d5dc875f1e16f3cc75748d2b28eef4ccaf538999823a880f3cb30b`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Reading view was checked as a candidate and ruled out — it is a per-tab display
  toggle, not a persistent guard (switching back to Editing view allows typing immediately, with
  no "unlock" step), so it does not match a note staying read-only until explicitly unlocked; no
  other page names a lock feature.

## G-154 — A tasks view across notes

- Page id: none settles it. Checked: `plugins__search`, `plugins__core_plugins`
- URLs checked: https://help.obsidian.md/plugins/search (sha256
  `5a797fdbe551de35f662a64a02d0a275ebb9a65750b1a6f776860cf5c5e4b7f3`, fetched 14:48 UTC) ·
  https://help.obsidian.md/plugins (sha256 `0527cbfdb554fef0ee96f4949205a8ed03ea85d6a768741c72ddcfa50dd395ed`,
  fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: Search's `task:`/`task-todo:`/`task-done:` operators ("Find matches in a task on a
  block-by-block basis") return filtered search results, not a dedicated grouped
  Overdue/Today/Upcoming/No-date view across notes; no such view is documented, and it is not in
  the core plugins catalog.

## G-160 — OCR for images and text extraction for docx / xlsx

- Page id: none settles it. Checked: same OCR sweep as G-045/G-121, plus `plugins__format_converter`
- URLs checked: https://help.obsidian.md/plugins/format-converter (sha256
  `c89b1d1165dd48d1514bc816e8368036f3954b29c78571a7581a6e34a7212634`, fetched 14:49 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: "OCR" appears nowhere on the site (see G-045/G-121), and Format converter converts
  *other apps'* flavors of Markdown into Obsidian's — it is not a docx/xlsx text-extraction feature.

## G-161 — Email-to-notebook (a per-member inbound address)

- Page id: none settles it. Checked: a full-text sweep of all 176 pages for "email"/"forward",
  `plugins__core_plugins`
- URL checked: https://help.obsidian.md/plugins (sha256
  `0527cbfdb554fef0ee96f4949205a8ed03ea85d6a768741c72ddcfa50dd395ed`, fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: every "email" hit site-wide is about support contact, license purchase receipts or
  2FA — no inbound-email-to-note capture address is documented anywhere.

## G-169 — Export to HTML, JSON and Word (and PDF)

- Page id: none settles it. Checked: `files__accepted_file_formats`, `linking__embed_files`,
  a sweep of the Import notes family and Obsidian Publish's limitations page for "export"
- URLs checked: https://help.obsidian.md/file-formats (sha256
  `95ede78937600de68ad15ade8cf5044f05261eac9f72187c2880f6a7c71b517e`, fetched 14:48 UTC) ·
  https://help.obsidian.md/embeds (sha256 `aec6d56537a105e07fc854851575f8f96616e4c528d7da9f16db5fe1bd6bd1ff`,
  fetched 14:48 UTC)
- Quote: none — **no page states it**
- Proposed O verdict: **NOT-VERIFIED (stays)**
- Reasoning: every "export" hit site-wide describes exporting FROM another app (Notion/Evernote/
  Roam) so it can be imported INTO Obsidian, or exporting Web Clipper highlights/templates to
  `.json` — no page describes exporting an Obsidian note itself to HTML, JSON, Word or PDF.

## G-171 — First-run tour and a sample notebook

- Page id: `getting_started__sandbox_vault`
- URL: https://help.obsidian.md/sandbox
- Fetch time UTC: 2026-10-04 14:48
- sha256: `f60decc353992abb4eb8ac0517e85210c0b4d02065b718e8542a905b7b85d2fe`
- Quote: "Obsidian's sandbox vault is a feature that lets you explore various functionalities
  without affecting your existing data."
- Proposed O verdict: **PARITY**
- Reasoning: an officially documented, always-available separate practice vault a new member can
  open, explore and close without touching their real notes serves the same "try it risk-free"
  role as a sample notebook a member can add and remove, even though it is not a scripted,
  in-app first-run tour the way UCT's eight-step walkthrough is.

---

## Summary table

| ID | Capability | Proposed O verdict | Settles via |
|---|---|---|---|
| G-003 | Account-deletion purge | NOT-VERIFIED (stays) | no page states it |
| G-005 | Local draft safety net | PARITY | File recovery |
| G-011 | Search read-latency at scale | NOT-VERIFIED (stays) | no page states it |
| G-032 | Find-in-note | NOT-VERIFIED (stays) | no page states it |
| G-041 | Comment/annotation at capture | NOT-VERIFIED (stays) | no page states it |
| G-045 | PDF upload + OCR | NOT-VERIFIED (stays) | no page states it |
| G-085 | Public API / webhooks | NOT-VERIFIED (stays) | no page states it |
| G-110 | "Where was I working?" | PARITY | Quick switcher |
| G-113 | Page-aware document search | AHEAD | Search |
| G-121 | OCR / scanned text | NOT-VERIFIED (stays) | no page states it |
| G-122 | Assistant with explicit scope | NOT-VERIFIED (stays) | no page states it |
| G-123 | Citation as verified location | NOT-VERIFIED (stays) | no page states it |
| G-124 | Refuses when corpus insufficient | NOT-VERIFIED (stays) | no page states it |
| G-125 | Retrieved content cannot instruct | NOT-VERIFIED (stays) | no page states it |
| G-133 | Image captions and alignment | NOT-VERIFIED (stays) | no page states it |
| G-138 | Find and replace | NOT-VERIFIED (stays) | no page states it |
| G-139 | Emoji picker | NOT-VERIFIED (stays) | no page states it |
| G-140 | @date mentions | NOT-VERIFIED (stays) | no page states it |
| G-142 | Multi-column layout | NOT-VERIFIED (stays) | no page states it |
| G-144 | Undo/redo control on touch | NOT-VERIFIED (stays) | no page states it |
| G-149 | Timeline view | NOT-VERIFIED (stays) | no page states it |
| G-150 | Archive state | NOT-VERIFIED (stays) | no page states it |
| G-151 | Note lock (read-only) | NOT-VERIFIED (stays) | no page states it |
| G-154 | Tasks view across notes | NOT-VERIFIED (stays) | no page states it |
| G-160 | OCR + docx/xlsx extraction | NOT-VERIFIED (stays) | no page states it |
| G-161 | Email-to-notebook | NOT-VERIFIED (stays) | no page states it |
| G-169 | Export to HTML/JSON/Word | NOT-VERIFIED (stays) | no page states it |
| G-171 | First-run tour + sample notebook | PARITY | Sandbox vault |

4 of 28 rows settle to a verdict change (3 PARITY, 1 AHEAD); 24 settle to "no official page states
it," proposed to stay NOT-VERIFIED — a checked, not skipped, finding in each case.
