# Research lane W15-E — Evernote ("E") column proposals

Scope: the parity scorecard's (`docs/notebook/parity-scorecard.md`) owed rows whose note reads
`E: a verbatim sentence from the page the paraphrase summarises`, plus three rows (G-011, G-113,
G-123) whose Evernote verdict is NOT-VERIFIED for a different reason. 19 rows total. This document
is **research only** — no edits were made to `tools/parity_scorecard.py` or
`docs/notebook/parity-scorecard.md`; an integrator applies these results.

**Method note on the fetch tool.** `WebFetch` returned `HTTP 403 Forbidden` for every
`help.evernote.com` URL tried (Cloudflare — the same wall the scorecard already records as
"9B could not fetch (Cloudflare, R15)"; `tools/parity_scorecard.py:1877`). `WebFetch` **did** work
for `evernote.com` marketing pages (no Cloudflare challenge there). For `help.evernote.com`
articles, the page itself is served by Zendesk, and Zendesk's public Help Center JSON API —
`https://help.evernote.com/api/v2/help_center/en-us/articles/<id>.json` — answered every request
with `HTTP 200` and no special headers, returning the article's title and body HTML directly. This
is the same mechanism the scorecard's own `SOURCES` bank already records for its R18 fetches (each
entry's `"read_from"` field names this exact API path, e.g.
`tools/parity_scorecard.py:1716`). I used that API to fetch the raw article JSON, stripped the HTML
body with BeautifulSoup, collapsed whitespace, and saved the result as plain text — this is the
"extracted text" referenced below. Zendesk's public search API
(`https://help.evernote.com/api/v2/help_center/articles/search.json?query=...`) was used the same
way for the "search" rows and for rows where no help-centre article addresses the ledger's claim.
No third-party source was used as a verdict; every verbatim quote below is cut from an Evernote
page fetched this session (listed by page id, URL, fetch time and sha256 — files are saved outside
the repo, never committed, per the lane brief).

Scratchpad root (not committed):
`C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\scorecard-pages\evernote\<page id>.txt`

---

## G-011 — Search read-latency at platform scale

- Pages checked: `evernote__troubleshooting_performance_issues`,
  `https://help.evernote.com/hc/en-us/articles/34230259006739-Troubleshooting-performance-issues-in-Evernote`,
  2026-10-04T14:59:18Z,
  sha256 `db058b016043783928976e9d9d3f44cde46dd458a3e6db8a889a0b6b220ac8d3`
- Also checked: `evernote__search_overview`,
  `https://help.evernote.com/hc/en-us/articles/360040282613-Search-overview`,
  2026-10-04T14:59:04Z,
  sha256 `a37019ab5f6ef911bbc3dcaf727e57d1a1529face629ff954e26a40cf2ab77ff`
- Also checked (search): `evernote__search_search_speed_performance_latency`,
  `https://help.evernote.com/hc/en-us/search?query=search%20speed%20performance%20latency`,
  2026-10-04T14:59:54Z,
  sha256 `0e31a12badd2525b739506b3fec04d873ee9cd5ad32a211f4d365c1dd410e4cb` (15 results — a
  troubleshooting page, the Search overview, filtering, AI FAQ, app-reinstall pages; none states a
  search latency figure or a scale claim)
- Quote: **none — no page states it.** The troubleshooting page discusses generic "latency" only
  as a symptom to fix (slow app, high CPU, syncing), never a number; the Search overview states a
  size limit ("The current limit for PDF file size processed for search is 52 MB per file") but no
  latency/scale figure.
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: Evernote publishes no help-centre
  page stating a search response-time figure at any corpus size, so there is nothing to cite either
  for or against UCT's own measured number — the row's own ledger text already frames this as a
  benchmark-protocol question, not a publicly documented spec, and the fetch confirms that.

## G-021 — Structured views / database-like properties

- Page: `evernote__search_tables_database_views`,
  `https://help.evernote.com/hc/en-us/search?query=tables%20database%20views`,
  2026-10-04T14:59:43Z,
  sha256 `48bdac0c8c8bc867f214f1b6ce7e61caef1e5e556c372cc573af771fc0f7cad9` (12 results — offline
  access, mobile offline setup, Spaces sharing, font settings, Spaces overview, the note-editor
  overview, Slack, AI note cleanup, note links, AI Assistant; none is a database/properties/views
  page)
- Settling page: `evernote__create_a_table`,
  `https://help.evernote.com/hc/en-us/articles/208314638-Create-a-table`,
  2026-10-04T14:59:01Z,
  sha256 `7028d122b97eaa3d7e30f6d8bf36c292ceded88592266e364e5f2ba776701590`
- Quote: **"Create tables to organize the data in your notes."**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: the only "table" Evernote documents
  is a plain content table inside one note (rows/cells of text, attachments, checkboxes — explicitly
  "Formulas and other spreadsheet functions" are NOT supported, and nested tables are refused), with
  no typed properties, no saved view modes (table/board/calendar/timeline) and no cross-note
  filter/sort — the quote settles what "table" means on Evernote's own page and it is not a
  database-like property system; the search plus the Spaces overview page (checked, one throwaway
  use of the word "database" describing how a *user* might use a Space, not a product feature)
  corroborate the paraphrase's "no database-like note properties or structured views are documented."

## G-031 — Command palette (Ctrl+K style)

- Page: `evernote__keyboard_shortcuts`,
  `https://help.evernote.com/hc/en-us/articles/34296687388307-Keyboard-shortcuts`,
  2026-10-04T14:59:11Z,
  sha256 `093884a554cfc00d8709f493267ca3350b7ff955b853f74ae1c895248ed9d750`
- Quote: **"Search ⌘ + K Ctrl + K"**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: the full shortcuts reference binds
  Ctrl/Cmd+K to the single action "Search" (both globally and in-app); every other action (New note,
  New notebook, New task, Open Home, etc.) has its own separate shortcut, and the word "palette"
  never appears on the page — this settles that Ctrl+K opens one feature (Search), not a unified,
  multi-command palette.

## G-102 — App-wide command palette does not include Notebook

- Page (search): `evernote__search_command_palette`,
  `https://help.evernote.com/hc/en-us/search?query=command%20palette`,
  2026-10-04T14:59:44Z,
  sha256 `a7771076c46ce1b77dbbbe73655d13cbc1abc6cb269bf0145b529f67fa51c57b` (32 results, all
  keyword-noise on "command" — Slash commands, Comments, rollout/spaces docs, Color, Stylus — zero
  on an app-wide palette)
- Also checked: `evernote__keyboard_shortcuts` (same as G-031) — no "palette" language.
- Quote: **none — no page states it.**
- Proposed E verdict: **NOT-VERIFIED, but flagged for reconsideration as N/A.** Reasoning: the
  committed evidence entry for this row already records `url: null` with "UCT-internal row...
  there is no Evernote counterpart to score," and the ledger's own competitor column cites only
  Notion and Obsidian for this row, deliberately omitting Evernote. The fresh search confirms
  Evernote documents no app-wide command-palette construct at all (unlike Notion's Cmd/Ctrl+K or
  Obsidian's Quick switcher), so there is no Evernote feature for an "includes/excludes Notebook"
  question to be asked of. I did not change the verdict myself (out of scope for this lane), but the
  evidence supports N/A over NOT-VERIFIED for this cell — leaving that call to the integrator.

## G-110 — "Where was I working?" resumption surface

- Page: `evernote__evernote_teams_features`,
  `https://help.evernote.com/hc/en-us/articles/4403442292371-Evernote-Teams-features`,
  2026-10-04T14:59:10Z,
  sha256 `7639dd1d27b8b8c11dd9ff2e57b918e9f2ca4517c4b5959bab90016e138ca387`
- Quote: **"Home consists of widgets designed to display your content in a simple, organized view."**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: Home is described as a configurable
  dashboard of static widgets (pinned notes, scratch pad, calendar, tasks) that the member arranges
  by hand — the quote settles that this is a widget board, not an activity-derived "continue working"
  feed; no sentence on the page (or on the related Teams/Home description) claims a resumption
  surface that synthesizes recents/favourites/review-state the way UCT's `ResearchHome` does.

## G-113 — Page-aware document search, sectioned separately from note search

- Page: `evernote__search_overview`,
  `https://help.evernote.com/hc/en-us/articles/360040282613-Search-overview`,
  2026-10-04T14:59:04Z,
  sha256 `a37019ab5f6ef911bbc3dcaf727e57d1a1529face629ff954e26a40cf2ab77ff`
- Quote: **"the note list shows the line where your keyword actually matched, not just the first line of each note"**
- Also checked: `evernote__annotate_images_and_pdfs` (page/annotation UI, not search display) and
  `evernote__scanned_pdfs_not_in_search_results` (OCR troubleshooting, not result display) —
  neither describes search-result sectioning either.
- Proposed E verdict: **AHEAD (DIFF, UCT ahead) — upgrade from NOT-VERIFIED.** Reasoning: Evernote's
  own Search overview page states PDF/document matches surface as an ordinary row in the single
  note list, with the matched *line* shown inline (the same mechanism the page describes for plain
  notes) — not a separate, page-numbered "Documents" section the way UCT's dedicated
  `j2_note_document_pages_fts` sidebar group is. This is the limit stated on the competitor's own
  page (the same pattern already used for G-015/Obsidian and G-045/Notion elsewhere in §A), so it
  reads as a real AHEAD rather than an unresolved NOT-VERIFIED — recorded as a proposal for the
  integrator to weigh, since changing a verdict is a judgment call outside a pure "find a quote" task.

## G-123 — A citation that is a verified LOCATION in the source, not a quoted string

- Page: `evernote__ai_assistant`,
  `https://help.evernote.com/hc/en-us/articles/46319409880211-AI-Assistant`,
  2026-10-04T14:59:12Z,
  sha256 `f08b4dc1622ec2f74cad42d197dafc949c2d78d15acd56e236e01eecfbcdc02e`
- Quote: **"Replies include which notes were used to generate them."** (re-confirms the quote the
  scorecard already carries from the R18 fetch of this same page, 2026-10-02 — re-fetched this
  session and byte-identical in substance)
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: I read the full AI Assistant page
  (and the AI Features FAQ it cross-links) looking specifically for any sentence about a verified
  sub-note position (a page, a paragraph, an exact span) rather than "which note" — there is none.
  The assistant's citation is stated at note level only ("which notes were used"), the same gap
  the scorecard's existing note already records; no page states a location-level precision for
  either side of the comparison, so NOT-VERIFIED stands.

## G-125 — Retrieved content cannot instruct the assistant

- Page: `evernote__ai_assistant` (as above)
- Also checked: `evernote__ai_features_faq`,
  `https://help.evernote.com/hc/en-us/articles/45353174499475-Evernote-s-AI-Features-FAQ`,
  2026-10-04T14:59:15Z,
  sha256 `79834a7adda3bd4a84abe43bc075e6ed9d16c57dd2413e5967998c16393fed5f`
- Quote: **none — no page states it.** The AI Features FAQ's "Content moderation" section states a
  safeguard against the *assistant* producing inappropriate output ("safeguarding measures in AI
  Assistant to prevent it from responding to requests that are inappropriate"), which is an output
  filter, not a statement about retrieved note content being prevented from instructing the model.
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: read both pages end to end; neither
  states how (or whether) content retrieved from a member's own notes is kept from acting as
  instructions to the assistant. Absence of a statement is not evidence either way, matching the
  existing paraphrase exactly.

## G-129 — Syntax highlighting in code blocks

- Page: `evernote__note_editor_and_editing_toolbar_overview`,
  `https://help.evernote.com/hc/en-us/articles/360022954093-Note-editor-and-editing-toolbar-overview`,
  2026-10-04T14:59:20Z,
  sha256 `ae89d17b1e704398e9b71c5deee38829579f5eee9073c00eba92c7ecfec7de0a`
- Quote: **"Tables, code blocks, and quotes"**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: code blocks are listed as one of the
  Insert-menu content types, exactly as the paraphrase says, with no language picker or per-language
  highlighting mentioned anywhere on the page.

## G-141 — Web embeds and link bookmarks (previews)

- Page: `evernote__note_editor_and_editing_toolbar_overview` (as above)
- Also checked: `evernote__note_links`,
  `https://help.evernote.com/hc/en-us/articles/208313588-Note-links`,
  2026-10-04T14:59:21Z,
  sha256 `d8f12d4f4fa22b1b2bcc83841166365c96e11ec514540ea7731e3bf5f7529fd4`
- Quote: **"Just copy a URL, highlight some text, paste, and it'll automatically convert to a clickable link."**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: a pasted web URL becomes a plain
  clickable link by this page's own account. I checked whether the page's later "Personalize
  attachment views" paragraph (a title preview / full preview display option) might describe a
  general web-link preview card; it does not — the Note links page confirms that same
  "preview"/"title" display toggle is specifically the "Links and attachments" setting for
  **Evernote note-to-note links** ("under 'Links and attachments', select a default view from the
  dropdown options for Evernote links"), not for arbitrary external URLs. No page documents a web
  embed or bookmark-card preview for a pasted external link; a Zendesk search for "embed youtube"
  and "web link preview bookmark" turned up only the Web Clipper's unrelated "Bookmark" clip format
  (a different tool, saving a page INTO Evernote, not a preview rendered from a link pasted inside
  an existing note).

## G-142 — Multi-column layout

- Page: `evernote__note_editor_and_editing_toolbar_overview` — zero occurrences of "column"
  anywhere in the extracted text (checked by direct grep against the saved file).
- Also checked (search): Zendesk search for "columns layout" — 8 results (Take notes, Clip formats,
  Wrap text around an image, Save clipped content, Create a table, Mobile editor shortcuts, Annotate
  images and PDFs, a Workflow article); none describes a multi-column note layout.
- Quote: **none — no page states it.**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: confirmed absence two ways (a full
  read of the editor-overview page and a targeted site search) rather than inferring from silence
  on one page alone; neither surfaces a multi-column layout feature.

## G-145 — Quick switcher over ALL notes (fuzzy, keyboard-first)

- Page: `evernote__keyboard_shortcuts` (as G-031)
- Also checked (search): Zendesk search for "quick switcher" (93 results, none a switcher feature —
  mostly Quick Start guides and an account-switching article) and "jump to note" (276 results,
  topped by Note links / editor overview / Take notes — note-to-note navigation, not a global
  fuzzy switcher).
- Quote: **"Search ⌘ + K Ctrl + K"**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: the only keyboard-first way to reach
  an arbitrary note by name is the generic Search shortcut; no page names a dedicated "quick
  switcher"/"go to note" ranked-by-title feature the way Notion's and Obsidian's do.

## G-148 — Unlinked mentions

- Page (search): `evernote__search_backlinks_unlinked_mentions`,
  `https://help.evernote.com/hc/en-us/search?query=backlinks%20unlinked%20mentions`,
  2026-10-04T14:59:44Z,
  sha256 `d0986b53e49a60c820a1fa9015c4af38c2cc4249dde133cad9d03dafdd3a2cb2`,
  **count = 0**
- Quote: **none — no page states it** (confirmed directly: the search returns zero results today,
  matching the committed evidence file's record of the same search on 2026-09-26).
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: a zero-result search is itself the
  evidence the paraphrase already recorded; re-run today it is unchanged.

## G-149 — Timeline view

- Page: `evernote__link_notes_to_calendar_events`,
  `https://help.evernote.com/hc/en-us/articles/4401880620051-Link-notes-to-calendar-events`,
  2026-10-04T14:59:05Z,
  sha256 `d1310e9ad26f93c68701ecbd075bbbc342361f24f09765324c7d7736bec7d9df`
- Quote: **"you'll be able to link notes to events in your calendar, and access them from the calendar widget in Home"**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: this settles the paraphrase's two
  claims exactly — a note can be linked to a single calendar event, and there is a calendar WIDGET
  on Home — while nowhere on the page (or in the companion search/filter language, e.g.
  `contains:calendarEvent`) is there a sixth "view mode" laying every note on a time axis the way
  UCT's `NoteTimelineView` does.

## G-150 — Archive state

- Page (search): `evernote__search_archive`,
  `https://help.evernote.com/hc/en-us/search?query=archive`,
  2026-10-04T14:59:44Z,
  sha256 `0e6ba9503c570da400b2ce18295024f9f8462d943f84fdbdc7d957d30d91ee5b` (3 results: Comments,
  Use advanced search syntax, How to use Evernote for Slack)
- Settling page: `evernote__use_advanced_search_syntax`,
  `https://help.evernote.com/hc/en-us/articles/208313828-Use-advanced-search-syntax`,
  2026-10-04T14:59:22Z,
  sha256 `59d6f0a573f80a8d3f5719f0b31d7a3538f3290d11e5595440cd43423cc005c5`
- Quote: **"Archive files contains:fileArchive"**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: the only place "archive" appears on
  an Evernote help page that the search surfaces is this search-syntax row — and it is a file-TYPE
  filter for attached `.zip`-style archive files, not a note-level archived/unarchived state. This
  settles that the word "archive" on Evernote's help site means something else entirely, confirming
  the paraphrase's "no article describing an archive state for notes."

## G-152 — Split view (desktop, two notes side by side)

- Page: `evernote__use_tabs_to_multitask_in_evernote`,
  `https://help.evernote.com/hc/en-us/articles/52440426461075-Use-tabs-to-multitask-in-Evernote`,
  2026-10-04T14:59:16Z,
  sha256 `fa62ce14548d4da09f39a93b70408222f92ac19140dc4ce3b7bacfc8c0135cad`
- Quote: **"Instead of navigating back and forth, you can keep several items open at once and switch between them instantly."**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: the page's own description of tabs
  is a switching mechanism (one tab's content visible at a time, like a browser), not a
  simultaneous two-pane split showing two notes at once; the page is desktop-only and says nothing
  about a side-by-side dual view, settling the "not clearly evidenced" half of the paraphrase.

## G-158 — Lightweight relations (a relation property + backlink)

- Page: `evernote__note_links` (as G-141),
  2026-10-04T14:59:21Z,
  sha256 `d8f12d4f4fa22b1b2bcc83841166365c96e11ec514540ea7731e3bf5f7529fd4`
- Quote: **"Note links allow you to link from one note to another note, making it easy to quickly jump between notes within Evernote"**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: the page describes an inline,
  in-body link a member inserts by hand (with an optional title/preview display mode) — a content
  feature, not a typed **property** on a note whose value is a reference to other notes (the thing
  G-021 already establishes Evernote does not have). "Note links" is the same mechanism G-022
  already scores as plain backlinks (PARITY there); it is not a relation property, so this row
  stays NOT-VERIFIED rather than inheriting G-022's PARITY.

## G-167 — Publish-to-web for a note or a folder

- Page: `evernote__publish_team_notebooks`,
  `https://help.evernote.com/hc/en-us/articles/208314148-Publish-team-notebooks`,
  2026-10-04T14:59:13Z,
  sha256 `7e598d61cdaf1c43ee11034ea95281fecf2e43938d1fe52dff104bb45b9faf25`
- Quote: **"Some Evernote Teams accounts have the ability to publish notebooks. These published notebooks can be joined by anyone on the team."**
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: this settles that "publish" for an
  Evernote notebook is scoped to the TEAM directory ("can be joined by anyone on the team"), gated
  to some Teams accounts, and is never a public web page — confirming the paraphrase exactly. A
  single Evernote NOTE can already be given a public read-only link (G-080, PARITY), but there is
  no Evernote web-publish surface at the notebook/folder level to compare against UCT's folder
  Publish door, so NOT-VERIFIED stands for this row.

## G-171 — First-run tour and a sample notebook

- Page: `evernote__why_do_i_see_notebooks_feature_learning_experience`,
  `https://help.evernote.com/hc/en-us/articles/37409323059475-Why-do-I-see-notebooks-I-never-created-Feature-Learning-Experience-for-Spaces`,
  2026-10-04T14:59:10Z,
  sha256 `48e34a3b55b430f21de8da979c6882f9a991ec50c21f2581e43e38acbf5b3ce5`
- Quote: **"individual users are presented with a Feature Learning Experience for Spaces, which they can dismiss."**
- Also checked: `evernote__quick_start_guide`,
  `https://help.evernote.com/hc/en-us/articles/208314458-Using-Evernote-Quick-Start-Guide`,
  2026-10-04T14:59:05Z,
  sha256 `ce6c294dac6b1557e4bfcd46c2de6f6f3e43f0b0fed91bb57efe1a299279e888` — a three-step written
  guide ("Create a new note", "Add some content", "Find your notes"), not an interactive in-app
  walkthrough.
- Proposed E verdict: **NOT-VERIFIED (unchanged)**. Reasoning: the Feature Learning Experience is a
  one-time dismissible popup offering to create ~4 empty sample notebooks when the member first
  encounters the Spaces feature — not a guided, multi-step first-run tour of the product; the Quick
  Start guide is static documentation, not an in-app tour either. Neither page evidences a first-run
  tour comparable to UCT's eight-step tour, confirming the paraphrase.

---

## Summary (one line per row)

| row | feature | proposed E verdict | settled by |
|---|---|---|---|
| G-011 | Search read-latency at platform scale | NOT-VERIFIED (unchanged) | no page states it |
| G-021 | Structured views / database-like properties | NOT-VERIFIED (unchanged) | "Create tables to organize the data in your notes." |
| G-031 | Command palette (Ctrl+K style) | NOT-VERIFIED (unchanged) | "Search ⌘ + K Ctrl + K" |
| G-102 | App-wide command palette does not include Notebook | NOT-VERIFIED, flagged possible N/A | no page states it; no Evernote counterpart exists |
| G-110 | "Where was I working?" resumption surface | NOT-VERIFIED (unchanged) | "Home consists of widgets designed to display your content in a simple, organized view." |
| G-113 | Page-aware document search, sectioned separately | **AHEAD (proposed upgrade)** | "the note list shows the line where your keyword actually matched, not just the first line of each note" |
| G-123 | Verified-location citation | NOT-VERIFIED (unchanged) | "Replies include which notes were used to generate them." |
| G-125 | Retrieved content cannot instruct the assistant | NOT-VERIFIED (unchanged) | no page states it |
| G-129 | Syntax highlighting in code blocks | NOT-VERIFIED (unchanged) | "Tables, code blocks, and quotes" |
| G-141 | Web embeds and link bookmarks (previews) | NOT-VERIFIED (unchanged) | "Just copy a URL, highlight some text, paste, and it'll automatically convert to a clickable link." |
| G-142 | Multi-column layout | NOT-VERIFIED (unchanged) | no page states it |
| G-145 | Quick switcher over ALL notes | NOT-VERIFIED (unchanged) | "Search ⌘ + K Ctrl + K" |
| G-148 | Unlinked mentions | NOT-VERIFIED (unchanged) | zero-result search, reconfirmed |
| G-149 | Timeline view | NOT-VERIFIED (unchanged) | "you'll be able to link notes to events in your calendar, and access them from the calendar widget in Home" |
| G-150 | Archive state | NOT-VERIFIED (unchanged) | "Archive files contains:fileArchive" (a file type, not a note state) |
| G-152 | Split view (two notes side by side) | NOT-VERIFIED (unchanged) | "Instead of navigating back and forth, you can keep several items open at once and switch between them instantly." |
| G-158 | Lightweight relations (relation property + backlink) | NOT-VERIFIED (unchanged) | "Note links allow you to link from one note to another note, making it easy to quickly jump between notes within Evernote" |
| G-167 | Publish-to-web for a note or a folder | NOT-VERIFIED (unchanged) | "Some Evernote Teams accounts have the ability to publish notebooks. These published notebooks can be joined by anyone on the team." |
| G-171 | First-run tour and a sample notebook | NOT-VERIFIED (unchanged) | "individual users are presented with a Feature Learning Experience for Spaces, which they can dismiss." |
