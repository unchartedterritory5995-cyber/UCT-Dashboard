# Notebook P4b: Sharing a Page Layout Through the Community Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can share the page layout they built in Customize (Today, or the trade page) to the community library as a third item type, `page_layout`, beside outlines and styles. Other members browse layouts, preview one as a list of panels per phase, and adopt it into their own `journal_page_layout` preference after a confirm that shows exactly what changes, with an Undo. Layouts reuse P3a's machinery: `item_type`, the admin review queue, Helpful, report and hide, held revisions, and the rate-limit scopes. All of it is dark behind a new server-only switch, `NOTEBOOK_LAYOUT_SHARING_ENABLED`, which works only while `NOTEBOOK_STYLE_LIBRARY_ENABLED` and `JOURNAL_PAGE_LAYOUTS_ENABLED` are both on.

**Architecture:**
- **One gallery, a third item type.** `j2_template_gallery.item_type` gains `page_layout` (P3a's additive column, `template_gallery.py:256`). One additive column, `source_page`, identifies which of the author's two pages an item came from, so sharing that page again updates the same item (the `source_style_id` precedent, `:260`, `:266-268`). The review queue, Helpful, report, hide, unpublish and held revisions are reused unchanged.
- **A layout item is a closed-enum payload built by the server.** `layout_payload` reads the member's OWN saved `journal_page_layout` preference row and returns `{page, lists}`: the page (`today` or `trade`), and for each phase of that page an ordered list of `{id, shown}` whose ids are in the server's panel registry. Nothing else leaves: no labels, no unknown ids, no unknown phases, no carried fields. The client sends a page name and form fields, never a list.
- **The server holds the panel ids as ONE FACT IN TWO FILES.** A new pure module, `api/services/journal_two/page_layout_share.py`, declares `LAYOUT_PANEL_IDS` and `LAYOUT_PHASES`, and a rail parses `PANELS` and `PHASES` out of `J/lib/pageLayouts.js` and holds them equal. The preference validator stays shape-only, as R-P4-7 ruled; only a SHARED payload is checked against the registry.
- **Adopt is a confirm, a server record, then the member's own preference write.** The confirm sheet shows the panels per phase now and after. On "Use this layout", `POST /{id}/adopt-layout` checks the gates, the listing and the version the member previewed, records the use and returns the listed payload. The client then writes it through the one preference door P4a already uses (`setPrefMerged`), with a new pure model function `applySharedPage`. Undo writes the previous lists back through the same door.
- **All UI lives in already-lazy chunks.** Library cards and sheets live in the lazy `TemplateGallery` chunk. The Share door and the "Find shared layouts" door live in the lazy Customize editor. The admin review details live in the admin panel. The first-open closure gains at most one telemetry enum literal (R-P4b-13).

**Tech Stack:** FastAPI + SQLite (`auth.db`, `j2_` tables), React + Vite, vitest + Testing Library, pytest, Python Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`:
- §P4 (lines 333-341): "Saved as a **page layout**; shareable through P3 as `page_layout`."
- §P3 (285-329), in particular P3.1 (item types, line 290), P3.2 (review before listing, 294-303), P3.3 (browse, preview, adopt, Helpful, report, withdraw, 305-316), P3.3b (data model, 318-324) and P3.4 (rate limits, dark switch, 326-329).
- §6 cross-cutting (361-378).

**Model plans:** `docs/superpowers/plans/2026-10-17-notebook-p3a-style-library.md` (shape, rails, Global Constraints, the gallery machinery) and `docs/superpowers/plans/2026-10-17-notebook-p4a-page-layouts.md` (the layout model, the preference, R-P4-7 and R-P4-8, which deferred this plan).

**Base:** `origin/master` when Task 1 runs. It must carry P3a (#391, `ecb377b641`) and P4a (#388, `a512f220f7`); both are merged at `04778e0606`. One integration worktree `C:\Users\Patrick\uct-worktrees\notebook-p4b`, branch `notebook-p4b-layout-sharing`, written with a `.uct-session-owner` file. Tasks run one at a time: Tasks 3-5 share `template_gallery.py`, and Task 8 builds on Task 7's client calls and model functions.

Every `file:line` below was read on `origin/master` at `04778e0606` when this plan was written. Each is a dated claim; Task 1 re-reads them on the base.

## Facts (read at write time; Task 1 re-verifies each)

| # | Fact | Where |
|---|---|---|
| F1 | The layout preference key is `journal_page_layout`. The registry `PANELS` has 9 `today` panels and 9 `trade` panels, each `{id, label, defaultShown}`. `PHASES = ['premarket','market','postclose']`. | `J/lib/pageLayouts.js:12`, `:14`, `:17-40` |
| F2 | The client ceilings are `LAYOUT_VERSION = 1`, `LAYOUT_MAX_ENTRIES = 40`, `LAYOUT_MAX_ID_LENGTH = 40`, `LAYOUT_MAX_BYTES = 16384`, read as source text by `tests/test_page_layout_preference.py`. | `J/lib/pageLayouts.js:42-49` |
| F3 | `normalizeLayout` never throws, keeps unknown ids in place, appends missing registry ids hidden at the end, and carries unknown phases and unknown top-level fields through untouched. `resetPage` keeps unknown ids after the default panels. | `J/lib/pageLayouts.js:75-99`, `:101-138`, `:192-201` |
| F4 | "Nothing eager may import this module." Its importers are `PageLayoutEditor.jsx`, `TradeDetailPage.jsx` and `TodaySurface.jsx`. | `J/lib/pageLayouts.js:9-10`; `PageLayoutEditor.jsx:28-30`; `TradeDetailPage.jsx:47`; `TodaySurface.jsx:52` |
| F5 | `_PREFERENCE_KEYS` maps `journal_page_layout` to a named schema. `_validate_page_layout` checks SHAPE only, never ids (R-P4-7), and refuses with `That page layout could not be saved. Reset it and try again.` | `api/routers/auth.py:2865-2866`, `:3141-3234` |
| F6 | `JOURNAL_PAGE_LAYOUTS_ENABLED` and `NOTEBOOK_STYLE_LIBRARY_ENABLED` are rows in `NOTEBOOK_FLAGS` (payload keys `journal_page_layouts_enabled`, `notebook_style_library_enabled`), with `FLAG_FALLBACKS` rows on the client. | `api/routers/auth.py:268-272`; `J/lib/offline/notebookFlags.js:80-81` |
| F7 | The editor edits a draft, saves only the changed lists with `setPrefMerged(LAYOUT_PREF, prev => withLists(normalizeLayout(prev), page, edits))`, counts only `{ok: true}` as a save, and disables Save when `readFailed`. It is opened through `PageLayoutEditorSlot`'s `lazyLeaf`. | `PageLayoutEditor.jsx:58-125`, `:197-216`; `PageLayoutEditorSlot.jsx:11`, `:29-37`; `app/src/hooks/usePreferences.js:362` |
| F8 | Today's and the trade page's Customize state and toast hosts live on the page, because the sheet is unmounted by its own save. | `J/surfaces/TodaySurface.jsx:112-115`, `:237-268`; `J/components/trade/TradeDetailPage.jsx:355-357` |
| F9 | Gallery constants: `ITEM_TYPES = ("outline", "style")`, `TRADING_STYLES`, `SORTS`, `LIBRARY_FLAG`. `library_enabled()` reads `flag_on` per call. | `S/template_gallery.py:73-80`, `:135-137` |
| F10 | `ensure_gallery_schema` adds P3a's columns in an ALTER loop, then a unique partial index on `(user_id, source_style_id)`. | `S/template_gallery.py:244-269` |
| F11 | `_summary` emits `itemType`, `version`, `tradingStyle`, `helpfulCount`, `authorHandle`, and for the author or an admin `status`, `hasRevision`, `revisionTitle`. `_LIST_COLUMNS` is the list's narrow column set; `_check_select_shapes` asserts at import that the list and queue never read `body_json`, `payload_json` or `pending_json`. | `S/template_gallery.py:482-546`, `:561-603` |
| F12 | Style visibility is decided in four separate places: `list_gallery` (`g.item_type = 'outline'` while the library is off), `_library_hides`, `admin_queue` (`outlines_only`), and the style routes' `_require_library`. `author_page` and `feed` filter on `_VISIBLE` only. | `S/template_gallery.py:656-665`, `:691-694`, `:1575`, `:1507`, `:1557`; `api/routers/notebook_template_gallery.py:97-103` |
| F13 | `get_item` adds `payload` for a style row through `_safe_listed`, and `pendingRevision` for an admin through `_pending_revision`, which also calls `_safe_listed` (style-only). | `S/template_gallery.py:705-755` |
| F14 | `publish_style`: first publish is pending; again while pending or rejected replaces in place; again while APPROVED holds the new version in `pending_json` (R-P3-3). `admin_act` approve swaps a held revision in and bumps `version`; reject clears it and keeps the listing. | `S/template_gallery.py:894-957`, `:1636-1677` |
| F15 | `adopt_style` writes one transaction: the copy, a `j2_template_gallery_uses` row (`INSERT OR IGNORE`, distinct members, not for the author) and an optional watch. `_listed_style_row` requires approved and not hidden. | `S/template_gallery.py:1128-1135`, `:1190-1257` |
| F16 | Rate scopes: publish 10/hour + durable 10/day (`notebook_gallery_publish`); adopt 30/hour + durable 50/day (`notebook_gallery_adopt`); helpful and follow 60/hour in-process. A refused write gives the day's charge back. | `api/routers/notebook_template_gallery.py:65-85`, `:155-167`, `:356-380` |
| F17 | Literal routes (`/styles`, `/updates`, `/feed`, `/authors/...`) are declared before `GET /{gallery_id}`. A route-level gate dependency answers the one 404 before the plan check and the body. | `api/routers/notebook_template_gallery.py:43-45`, `:199-307` |
| F18 | Client lists: `ITEM_TYPES`, `TRADING_STYLES`, `LIBRARY_SORTS` in the lazy-only `J/lib/styleLibrary.js`; `tests/test_style_library.py` parses them (`_client_keys`). | `J/lib/styleLibrary.js:21-39`; `tests/test_style_library.py:156-166` |
| F19 | `TemplateGallery.jsx` is a lazy chunk (`TemplatePicker.jsx:86`, `styles/LibraryDoor.jsx:13`). It renders type chips from `ITEM_TYPES`, picks `StyleLibraryCard` for style items, holds the message host, and fires `library_viewed` per view change. | `B/TemplateGallery.jsx:266-306`, `:392-399`, `:472-480` |
| F20 | `StyleLibraryCard` imports `ReportForm` and `PreviewLines` from `TemplateGallery`; adopt shows `Added "<name>" to your styles.<credit>` via `onMessage`; failures go through `refusalSentence`. | `B/StyleLibraryCard.jsx:14-17`, `:26-32`, `:61-72` |
| F21 | `LibraryDoor` is the lazy door into the gallery: a button, then a `Sheet` with `<TemplateGallery initialType=...>`. | `B/styles/LibraryDoor.jsx:13-31` |
| F22 | Telemetry: `library_viewed: {type: oneOf('all','outline','style'), view: ...}` and `style_adopted: {notify: bool}` on the client; the server mirrors both. `notebookTelemetry.js` is in the first-open closure. | `J/lib/notebookTelemetry.js:55-56`, `:168-174`; `api/routers/journal_two.py:222`, `:324-330` |
| F23 | The contract tool's style library builder is `_style_library(w)`, registered LAST via `style_library(w)`. | `tools/notebook_contract_fixtures.py:1345`, `:1463-1590`, `:2224-2226` |
| F24 | The a11y population carries the library rows `StyleLibraryCard.jsx`, `AuthorView.jsx` and `ShareStyleForm.jsx`, railed by `a11y/styleLibrary.a11y.test.jsx`. | `J/a11y/notebookSurfaces.js:58-59`, `:357-359` |
| F25 | Account purge deletes `j2_template_gallery` rows by `user_id`, plus reports, uses, watches, helpful and the handle. | `S/account_purge.py:161-174`, `:343` |
| F26 | `tools/notebook_switch_rehearsal.py` lists every switch it does not rehearse in `NOT_REHEARSED`, with a reason; its rail fails on a name with no row. | `tools/notebook_switch_rehearsal.py:36`, `:185`, `:285` |
| F27 | **P3b (branch `notebook-p3b-examples`, tip `58e9a74667`, NOT merged)** sets the precedent this plan follows for a server-only switch: `EXAMPLE_FLAG` is not in `NOTEBOOK_FLAGS`, has no client fallback row, is read with `os.environ.get` + `notebook_flags.TRUTHY` ("a `flag_on` call is for payload flags only"), and the lazy list reports it as `capabilities.exampleNotes`. It also adds `example_note` to `ITEM_TYPES`, a `LISTED_ITEM_TYPES`, and type branches in `_library_hides`, `_can_see` and `_pending_revision`. | P3b `S/template_gallery.py:78-91`, `:160-164`, `:736-761`, `:873`; P3b `notebook_template_gallery.py:235`; P3b `J/lib/styleLibrary.js:21-35`; P3b `B/TemplateGallery.jsx:501` |
| F28 | **Bytes.** Budget `max` is 2,260,793 B (`docs/notebook/perf-budgets.json`). P3b's evidence reads 2,260,246 B (`docs/notebook/evidence/p3b-bytes-20261018T122852Z/run.txt`), but on tree `8e4dedc998`, which does NOT contain #373 (`4028fe61fe`, the lazy-screenshot headroom change). Master's newest reading is 2,237,178 B on tree `4f50a8ba` (`docs/notebook/evidence/t3-bytes-20261018T035753Z/bytes.txt`). Which figure P4b starts from is measured in Task 1; this plan spends neither headroom (R-P4b-13). | as named |

## Rulings this plan makes (each is also in the ledger and the PR body)

Each reads **Ruling: what. Why. Cost if wrong.**

- **R-P4b-1, the scope.** P4b ships: sharing a layout, browsing and filtering layouts, previewing, adopting with a confirm and an Undo, Helpful, report, hide, unpublish, held revisions, and the rate limits. It does NOT ship: "notify me when the author updates" or an update merge for layouts, firm (UCT pick) layout rows, a live render of a layout on the viewer's Today, or a durable "previous layout". Why: an adopted layout is a preference, not a row, so it has no copy to carry a `source_version` or a watch; firm layouts need content the team writes. Cost if wrong: a follow-up adds a watch for layouts, or firm rows through the P5 seed pattern.
- **R-P4b-2, one page per item.** A layout item carries ONE page, `today` (its three phases) or `trade`. A member has at most one shared item per page (`UNIQUE(user_id, source_page)`), and sharing that page again updates it. Why: Today and the trade page are independent, and a confirm that changes one page is readable. Cost if wrong: an author who wants both pages shares twice.
- **R-P4b-3, what a shared layout carries.** Exactly `{"page": "today", "lists": {"premarket": [...], "market": [...], "postclose": [...]}}` or `{"page": "trade", "lists": {"trade": [...]}}`. Each list is ordered `{"id": <registry id>, "shown": <bool>}`, each registry id at most once. Only the phases the author's saved preference holds are carried. Labels, unknown ids, unknown phases, unknown top-level fields, the version field, account ids and timestamps are never carried. Why: a layout is panel ids and on/off: closed enums, nothing a member typed (spec §6 privacy). Cost if wrong: none found; a field added later needs its own enum.
- **R-P4b-4, the server builds it from the saved preference.** `publish_layout` reads the member's own `journal_page_layout` row through the request's connection. The client sends `{page, title, description, category, tradingStyle}` and never a list. The Customize editor's Share button is disabled while the draft differs from what is saved: "Save your changes first, then share." Why: P3a's rule "Server owns every rule. The client sends ids and form fields, never a body or a payload." Cost if wrong: a member saves before sharing.
- **R-P4b-5, the panel registry is ONE FACT IN TWO FILES.** `page_layout_share.LAYOUT_PANEL_IDS` (`{"today": (...), "trade": (...)}`, in registry order) and `LAYOUT_PHASES` are pinned to `PANELS` and `PHASES` in `J/lib/pageLayouts.js` by a rail that parses that file. The preference validator (R-P4-7) is unchanged: a member's own saved layout may still hold any id. Why: refusing an unknown panel in a SHARED item needs a server copy of the ids, and a copy only stays honest if a rail reads the original. Cost if wrong: a panel added on the client without the server row fails the rail, which is the point.
- **R-P4b-6, unknown panels are refused at the write door and dropped at the build and the read.** (a) `validate_layout_payload` refuses any payload with an id outside the page's registry, a repeated id, a phase the page does not have, or a non-boolean `shown`. Every write of `payload_json` or `pending_json` for a layout calls it, so no unknown id can be stored. (b) `layout_payload` builds from the member's preference and keeps registry ids only; an id it leaves out is counted in `droppedPanels`, and the share form says so. (c) `safe_layout` drops any id outside the registry on every read (a row stored before a panel was removed). Why: refusing the member's own preference outright would trap them, because Customize keeps unknown ids by design (F3) and Save cannot remove one. Cost if wrong: an author sees "1 panel this version doesn't show was left out." instead of a refusal.
- **R-P4b-7, nothing to share.** A page with no saved list (the member never saved Customize for it), or a preference row that does not parse to `version == 1`, is refused with `You haven't changed this page's layout yet, so there is nothing to share.` or `Your layout couldn't be read, so it can't be shared. Open Customize, press Save, and try again.` Why: sharing today's default is noise in the library. Cost if wrong: a member who likes the default cannot share it.
- **R-P4b-8, adopt is confirm, record, write, Undo.** (1) The card's "Use this layout" opens a confirm sheet that shows, per phase, the panels shown now and after. (2) "Use this layout" calls `POST /{id}/adopt-layout` with `{version}` (the version the member previewed). The server checks the gates, that the item is listed, and that `version` equals the listed version (409 `LAYOUT_MOVED_SENTENCE` otherwise), records the use (`INSERT OR IGNORE`, never for the author), spends the adopt scopes, and returns `{layout, version, credit}`. (3) The client writes the returned layout with `setPrefMerged(LAYOUT_PREF, prev => applySharedPage(normalizeLayout(prev), page, lists))`. Only `{ok: true}` is a success. (4) The toast offers Undo, which writes the previous lists of exactly the replaced phases back through the same door. A failed write keeps the confirm open with `Couldn't change your layout. Nothing was changed.` and "Try again", which repeats step 3 only. Why: the spec's "without clobbering your current one silently" is met by a confirm that shows the change, and Undo makes trying a layout cheap. The write must be the client's because the merge rules (unknown ids kept, missing panels appended) live only in `pageLayouts.js`; a Python copy would be a second authority over the model. Cost if wrong: a failed write after a recorded use counts one adoption too many.
- **R-P4b-9, a panel this member cannot show.** `applySharedPage` replaces the registry entries of each shared phase with the shared order and on/off. It keeps the member's unknown ids after them (the `resetPage` rule, F3). Registry panels the shared list lacks are appended hidden by `normalizeLayout`. A shared id this client's registry lacks (a stale tab after a deploy) is kept as an unknown id: never rendered, never lost. A panel whose content depends on something the member does not have (an account picked, plan grading, the visual playbook, a paid plan) keeps its place and renders exactly as it would in a layout they set themselves. The confirm carries one standing line: `A panel that needs something you don't have on yet keeps its place and shows once it can.` Why: the pages' own render conditions are the authority (P4a Tasks 5-6); restating them in the confirm would be a second copy. Cost if wrong: a member sees an empty slot until the feature is on.
- **R-P4b-10, the switch.** A new switch, `NOTEBOOK_LAYOUT_SHARING_ENABLED`, read per call, effective only when `NOTEBOOK_STYLE_LIBRARY_ENABLED` AND `JOURNAL_PAGE_LAYOUTS_ENABLED` are also on: `layout_sharing_enabled()`. It is SERVER-ONLY, the P3b precedent (F27): not in `NOTEBOOK_FLAGS`, no client fallback row, read with `os.environ.get` and `TRUTHY`. The client learns it from lazy answers only: the library list's `capabilities.layoutSharing`, and `GET /layouts/status` (404 while off) for the Customize editor. With it off, every layout row reads like one that does not exist, and every layout route answers the one 404. Why: arming the library or page layouts must not expose layout sharing, layout sharing must roll back alone, and a payload key would cost a `FLAG_FALLBACKS` row of first-open bytes. Cost if wrong: one more variable for the owner to arm.
- **R-P4b-11, versions.** R-P3-3 applies to layout items: sharing an APPROVED layout again holds the new version in `pending_json`, and the approved one stays listed until an admin approves the revision. There are no watches and no update notices for layouts (R-P4b-1). Why: the reviewer must have seen what is listed, and members adopt only reviewed versions. Cost if wrong: none found.
- **R-P4b-12, rate limits.** Sharing a layout spends the publish scopes (10/hour, durable 10/day). Adopting a layout spends the adopt scopes (30/hour, durable 50/day). `GET /layouts/status` is a read with no limit. Why: the gallery's own split (F16); one budget per kind of action. Cost if wrong: a member adopting 51 items in a day waits until tomorrow.
- **R-P4b-13, bytes.** Target **+0 B** on the first-open closure over Task 1's measurement. The only first-open addition allowed is the `'page_layout'` literal in `library_viewed.type` (R-P4b-14), about 14 B; the hard ceiling for the plan is **+40 B**. Every other new file and import lives in the lazy gallery chunk, the lazy Customize chunk or the admin panel. Why: the headroom is tiny on the reading the brief names (F28), and P3b and P5 also draw on it. Cost if wrong: Task 9's fallback drops the literal (see there).
- **R-P4b-14, telemetry.** `library_viewed.type` gains `'page_layout'` on both sides. No new event: adoptions are already counted by `j2_template_gallery_uses` (distinct members, the "Most adopted" and "Trending this week" sorts). Why: a closed enum, no content, and no new first-open schema. Cost if wrong: a client-side `layout_adopted` event later (~60 B).
- **R-P4b-15, the doors.** (a) The library: a "Page layouts" type chip, shown only while `capabilities.layoutSharing` is true. (b) The Customize editor: "Share this layout" and "Find shared layouts", shown only on a 200 from `GET /layouts/status`. "Find shared layouts" closes the editor and opens the library at Page layouts through a page-owned lazy door, so two sheets never stack. No new Notebook tab (R-P3-7). Why: a member who shapes Today should find sharing where they shape it. Cost if wrong: one more click.
- **R-P4b-16, the preview is a list.** The preview shows the shared panels in order per phase, shown or hidden, labelled from `PANELS`, beside the member's own current lists. It does not render the viewer's Today with the layout. Why: Today and the trade page are separate lazy routes with their own data hooks; mounting them inside the gallery would pull those chunks in, and adopt plus Undo already makes a real try cheap. Cost if wrong: a later "Try it" renders the page with a layout override.

## Interaction with P3b and P5 (expected union-merge points)

P3b (`notebook-p3b-examples`, not merged) and P5 (`notebook-p5-launch`, in build in `notebook-p5`) both edit the files P4b edits. Whichever lands second merges master first. Each point below is resolved by keeping BOTH sides:

| File | P3b / P5 side | P4b side | Resolution |
|---|---|---|---|
| `S/template_gallery.py` `ITEM_TYPES` | P3b: `("outline", "style", EXAMPLE_ITEM)`, plus `LISTED_ITEM_TYPES` | `("outline", "style", LAYOUT_ITEM)` | `("outline", "style", EXAMPLE_ITEM, LAYOUT_ITEM)`, spec P3.1's order. `LISTED_ITEM_TYPES` keeps everything but the example note, so it includes `page_layout`. |
| `S/template_gallery.py` `_library_hides`, `_can_see`, `_pending_revision`, `get_item` | P3b: an example-note branch in each | a `page_layout` branch through `_hidden_item_types()` | Keep both branches. P3b's example rule (never listed, style-shown) stays its own clause. |
| `S/template_gallery.py` list, `author_page`, `feed`, `admin_queue` | P3b: `_NEVER_LISTED` in each | `_type_visible_clause()` in each | Both clauses, ANDed. |
| `S/template_gallery.py` gates block | P3b: `EXAMPLE_FLAG`, `example_enabled()`; P5: `seed_firm_styles` and firm-style visibility | `LAYOUT_SHARING_FLAG`, `layout_sharing_enabled()` | Additive. |
| `api/routers/notebook_template_gallery.py` list endpoint | P3b: `"capabilities": {"exampleNotes": ...}` | `"layoutSharing": ...` | One `capabilities` dict with both keys. |
| `J/lib/styleLibrary.js` `ITEM_TYPES`, `useLibraryList` | P3b: the `example_note` row, `LISTED_ITEM_TYPES`, `exampleNotes` | the `page_layout` row, `layoutSharing` | All rows in server order; both capability fields. |
| `B/TemplateGallery.jsx` chips and card switch | P3b: chips read `LISTED_ITEM_TYPES`, example rows; P5: `data-tour="library-types"` | the layout chip hidden unless `layoutSharing`; `LibraryCard` dispatch | Chips read `LISTED_ITEM_TYPES` filtered by capability; keep P5's anchor on the chip row. |
| `tools/notebook_contract_fixtures.py`, `tools/notebook_switch_rehearsal.py`, `docs/feature_flags.json`, `J/a11y/notebookSurfaces.js`, `B/admin/TemplateGalleryReviewPanel.jsx` | P3b: one builder, one row, one entry, rows, an example branch | the same for layouts | Additive rows; builders registered last in landing order. |

Task 1 V2 records which of P3b and P5 have landed on the base, and every task applies the resolution above when the other side is already there.

## Owner decisions this plan surfaces (none blocks the build)

- **O-P4b-1.** Arming `NOTEBOOK_LAYOUT_SHARING_ENABLED` on `web`. It does nothing until the library and page layouts are both armed. Task 10 hands over the command and the checks.
- **O-P4b-2.** UCT-pick layouts (firm rows). P4b ships the machinery and zero firm layout rows. Recommended: author them as P5 seed rows once members have shared a few.

## Global Constraints

P3a's Global Constraints apply unchanged (`docs/superpowers/plans/2026-10-17-notebook-p3a-style-library.md`, "Global Constraints"). Restated, with this plan's values:

- **Worktree.** Everything runs in `$WT = C:\Users\Patrick\uct-worktrees\notebook-p4b`. `app/node_modules` is a junction to `C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules`.
  - Make the junction only after `ls -A` counts **377** entries in the target.
  - Remove it only with `cmd /c rmdir` from PowerShell, after `Get-Item -Force` shows `LinkType` = `Junction`. Then re-count 377.
- **Do not write in `C:\Users\Patrick\uct-worktrees\notebook-p5`.** Another session builds P5 there.
- **Zero schema bumps.** No new note node type or attribute; a layout item carries no note body.
- **No note writes.** Sharing reads a preference; adopting writes only the member's own `journal_page_layout` through `setPrefMerged`. `J/lib/offline/doorEnumeration.test.js` stays `MODE = 'fail'` and green.
- **The gallery's rules stay** (`template_gallery.py:9-46`): definitions never values; the display name only; hide is a visibility state, never a delete; unpublish deletes only the author's own copy.
- **Server owns every rule.** The client sends a page name and form fields, never a list.
- **The preference stays shape-checked only.** `_validate_page_layout` and R-P4-7 are not edited.
- **No new `document` or `window` key listener** (`app/src/pages/command/keyListenerCensus.test.js`).
- **iOS 16 floor.** No regex lookbehind; no `Iterator` helpers or `Promise.withResolvers` without the existing shims.
- **Bytes.** The first-open closure (`python tools/notebook_perf_budgets.py --dist app/dist`) stays at Task 1's figure **+0 B**, with a hard ceiling of **+40 B** (R-P4b-13). Every new surface is a lazy chunk or lives inside one. `pageLayouts.js` is imported only from lazy files. The budget is never raised.
- **Copy.** Plain English, no emoji, no em dash, no en dash, no `!`, `UIcon` names only.
  - A refusal is a fixed sentence, never a raw server `detail` (`rawErrorSurface.test.js`). The gallery's own fixed sentences may be shown, as `StyleLibraryCard` does through `refusalSentence`.
  - A toast or line says what happened and what did not ("Nothing was changed.").
- **Touch.** Every new control meets `var(--tap-min)` (44 px) at or below 1,024 px (`app/src/styles/tapFloor.test.js`). Breakpoints are 640 and 1,024 only.
- **Rails that must stay green:**
  - `J/lib/offline/doorEnumeration.test.js`
  - `app/src/pages/command/keyListenerCensus.test.js`
  - `app/src/components/screener/reachable.test.js`
  - `app/src/styles/tapFloor.test.js`
  - `rawErrorSurface.test.js`
  - `J/lib/swallowedFetch.census.test.js`
  - `NoteEditorPage.styleChunks.test.js` (two `import()`s of `styles/` modules; this plan adds none)
  - the a11y population in `J/a11y/notebookSurfaces.js` with its coverage rail
  - `tests/test_page_layout_preference.py`
  - `tests/test_style_library.py`, `tests/test_notebook_template_gallery.py`
  - `tests/test_journal_two_account_purge.py`
  - `tests/test_notebook_contract_fixtures.py`
  - `tests/test_paywall_gate_free_tier.py`
  - `tests/test_notebook_flag_parse.py`, `tests/test_feature_flag_ledger.py`, `tests/test_notebook_switch_rehearsal.py`
- **Tests.**
  - Backend pytest by named files only (`python -m pytest tests/test_a.py tests/test_b.py -q`), never `tests/` and never `-k` alone.
  - Vitest by named files from `$WT/app`.
  - Each verification runs in its own tool call, captures `code=$?` and exits with it, with no pipe and no trailing `echo`.
  - Read the totals line, then commit in a separate call.
- **Commits.**
  - Run `python tools/check_repo_hygiene.py --staged` in its own call, then `git commit -F - -- <paths>` with a quoted heredoc, never `-m`.
  - The message ends with exactly these trailer lines:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01HWkKoqzDHY4uA1Ux38u64H
    ```
  - Push the branch after every task. Never `--no-verify`. Never `git add -A`. Never `git checkout` or `git stash`; restore a mutated file from bytes captured first and verify against `git cat-file blob HEAD:<path>`.
- **Evidence.** Every walk, bytes and a11y run writes its raw output under `docs/notebook/evidence/p4b-<run-id>/`. It is committed BEFORE any summary is written (R-RAW).
- **Gate and walk.** The six-shard gate runs in a SEPARATE worktree on a `notebook-*` branch, only when no other gate runs on the box. The walk runs at 1280 / 820 / 390.
- **Flags in production are the owner's.** No agent runs `railway variables --set` or `railway variable delete`.

## Review Focus

These are the input classes the spec implies, most likely first. Each is pinned by a test in the task that owns the code.

1. **A saved preference holding more than panels.**
   - Input: a `journal_page_layout` with an unknown top-level field (`"notes": "my account 1234"`), an unknown phase (`"overnight"`), an unknown panel id, a repeated id, a `"__proto__"` key, and the other page's lists.
   - Expected: the stored payload holds only `page` and that page's known phases, registry ids only, each once. `droppedPanels` counts the unknown id. The JSON text contains none of the other strings.
   - Pinned in Task 4: `test_a_shared_layout_carries_only_registry_panels`.
2. **An unknown panel at the write door, and in a stored row.**
   - A payload with an unknown id, a repeated id, a wrong phase or a string `shown` never reaches `payload_json` or `pending_json`.
   - A row stored with an unknown id (written by hand) never hands that id to an adopter or a previewer.
   - Pinned in Task 4: `test_the_write_door_refuses_an_unknown_panel`. Pinned in Task 5: `test_a_stored_unknown_panel_never_reaches_an_adopter`.
3. **Adopting over a customized layout.**
   - Expected: only the shared page's shared phases change. The other page, the other phases and the member's unknown ids are byte-equal afterwards. Undo restores the replaced lists exactly.
   - Pinned in Task 7: `adopt replaces only the shared phases and Undo restores them` (client) and `applySharedPage keeps unknown ids and appends missing panels hidden` (model).
4. **The author shares again while the layout is listed.**
   - The listed version is unchanged until approval. An adopt naming the old version after approval answers 409 and records nothing.
   - Pinned in Task 4: `test_an_approved_layout_update_is_held_not_listed`. Pinned in Task 5: `test_adopting_a_moved_version_is_refused_and_records_nothing`.
5. **The switch off on a pod that has layout rows.** Each of the three switches off in turn, with the other two on.
   - The list holds no layout row; `type=page_layout` is a 400; `get_item`, adopt, publish, status, Helpful and report on a layout answer 404; the admin queue holds no layout row; author pages and the feed hold none; `capabilities.layoutSharing` is false.
   - Pinned in Task 3: `test_layout_rows_vanish_unless_all_three_switches_are_on`. Pinned in Task 6 (routes and sweeps) and Task 8 (no Customize door).
6. **A member with nothing to share, or nothing readable.**
   - No saved list for the page: refused with R-P4b-7's first sentence. An unparseable row: the second sentence.
   - The adopter's own preference read failed (`readFailed`): "Use this layout" is disabled with P4a's load-failed sentence, and nothing is written.
   - Pinned in Task 4: `test_nothing_to_share_is_refused_with_a_sentence`. Pinned in Task 7: `adopt is disabled while the member's layout could not be read`.
7. **Withdraw, hide, or account deletion after an adoption.**
   - The adopter's preference is untouched. A withdrawn or hidden item answers 404 to a later adopt. A deleted author's layout items, reports, uses and helpful marks go; other members' preferences stay.
   - Pinned in Task 5: `test_withdraw_and_hide_leave_adopted_layouts_alone` and `test_account_purge_removes_layout_items_and_keeps_adopters_layouts`.
8. **A panel this member cannot show.**
   - A shared id unknown to this client is kept and not rendered. A shared layout missing a registry panel gets it appended hidden.
   - Pinned in Task 7: `applySharedPage keeps an id this build does not know`.

---

## File map

`J` = `app/src/pages/journal-2-0`, `B` = `J/components/notebook`, `S` = `api/services/journal_two`.

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p4b-verify-before-building.md` (new), `docs/notebook/evidence/p4b-verify-<run-id>/` | citations re-read; V1-V14 answered; bytes measured | 1 |
| `S/template_gallery.py` (`LAYOUT_SHARING_FLAG`, `layout_sharing_enabled`), `docs/feature_flags.json`, `tools/notebook_switch_rehearsal.py`, `tests/test_page_layout_share.py` (new) | the switch | 2 |
| `S/page_layout_share.py` (new: registry, `validate_layout_payload`, `safe_layout`), `S/template_gallery.py` (item type, `source_page`, `_hidden_item_types`, `_type_visible_clause`, summary keys), `api/routers/notebook_template_gallery.py` (`capabilities`), `J/lib/styleLibrary.js` (lists), `tests/test_page_layout_share.py` | item type, registry rail, visibility | 3 |
| `S/page_layout_share.py` (`layout_payload`), `S/template_gallery.py` (`publish_layout`, `layout_status`, the revision branch), router (`POST /layouts`, `GET /layouts/status`), `tests/test_page_layout_share.py` | publishing a layout; versions | 4 |
| `S/template_gallery.py` (`adopt_layout`, `get_item` payload), router (`POST /{id}/adopt-layout`), `tests/test_page_layout_adopt.py` (new), `tests/test_journal_two_account_purge.py` | adopt, Helpful, report, hide, withdraw, purge | 5 |
| `tools/notebook_contract_fixtures.py`, `J/__fixtures__/contract/*.json`, `tests/test_paywall_gate_free_tier.py` (if it lists routes) | contract fixtures and sweeps | 6 |
| `J/lib/pageLayouts.js` (`applySharedPage`, `replaceLists`, `layoutDiff`) + test, `J/lib/styleLibrary.js` (calls), `B/LibraryCard.jsx` (new dispatcher), `B/LayoutLibraryCard.jsx` (new), `B/LayoutPreviewSheet.jsx` (new), `B/AdoptLayoutSheet.jsx` (new), `B/TemplateGallery.jsx` + CSS, `B/AuthorView.jsx`, `J/lib/notebookTelemetry.js`, `api/routers/journal_two.py`, tests | the library UI and telemetry | 7 |
| `J/components/layout/PageLayoutEditor.jsx`, `J/components/layout/ShareLayoutForm.jsx` (new), `J/components/layout/LayoutLibraryDoor.jsx` (new), `J/surfaces/TodaySurface.jsx`, `J/components/trade/TradeDetailPage.jsx`, `app/src/components/admin/TemplateGalleryReviewPanel.jsx`, tests | the doors, sharing, the admin review details | 8 |
| `J/a11y/notebookSurfaces.js`, `J/a11y/layoutLibrary.a11y.test.jsx` (new), `tools/notebook_layout_library_walk.py` (new), evidence | a11y, walk, bytes | 9 |
| `docs/notebook/p4b-arming.md` (new), PR | gate, review, PR, arming packet | 10 |

---

### Task 1: Verify before building

This task re-reads every citation on the base and changes no product code.

**Files:**
- Create: `docs/notebook/p4b-verify-before-building.md`, `docs/notebook/evidence/p4b-verify-<run-id>/`

**Interfaces:**
- Consumes: nothing.
- Produces: the doc. Each V-item is either "confirmed", with a quoted line and its `file:line`, or "differs", with the real shape and the task text it changes. The controller rules on every "differs" before Task 2 is dispatched.

- [ ] **Step 1: Make the worktree**

```bash
git -C /c/Users/Patrick/uct-worktrees/notebook-presets-spec fetch origin && git -C /c/Users/Patrick/uct-worktrees/notebook-presets-spec worktree add -b notebook-p4b-layout-sharing /c/Users/Patrick/uct-worktrees/notebook-p4b origin/master
printf 'session: 61625d99-f8db-4269-a728-231c08d3da11\ncreated: 2026-10-18\n' > /c/Users/Patrick/uct-worktrees/notebook-p4b/.uct-session-owner
ls -A /c/Users/Patrick/uct-worktrees/_nb-shared-install/node_modules | wc -l
```
Expected: the last line prints `377`. Then make the junction from PowerShell:
```powershell
New-Item -ItemType Junction -Path 'C:\Users\Patrick\uct-worktrees\notebook-p4b\app\node_modules' -Target 'C:\Users\Patrick\uct-worktrees\_nb-shared-install\node_modules'
```
Confirm P3a and P4a are ancestors, in their own calls:
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && git merge-base --is-ancestor ecb377b641 HEAD; code=$?; echo "P3a ancestor: $code"; exit $code
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && git merge-base --is-ancestor a512f220f7 HEAD; code=$?; echo "P4a ancestor: $code"; exit $code
```
Stop if either is not.

- [ ] **Step 2: Record the base reds.** Run each in its own call, in the form `cmd > log 2>&1; code=$?; tail -5 log; exit $code`:
  - vitest: `B/TemplateGallery.test.jsx`, `B/StyleLibrary.test.jsx`, `J/lib/pageLayouts.test.js`, `J/components/layout/PageLayoutEditor.test.jsx`, `J/components/layout/PageLayoutEditor.realSave.test.jsx`, `app/src/components/admin/TemplateGalleryReviewPanel.test.jsx`, `J/lib/notebookTelemetry.test.js`, `J/lib/swallowedFetch.census.test.js`, `app/src/components/screener/reachable.test.js`, `app/src/pages/command/keyListenerCensus.test.js`, `app/src/styles/tapFloor.test.js`, `J/a11y/styleLibrary.a11y.test.jsx`, `J/a11y/surfaceCoverage.test.js`.
  - pytest: `tests/test_style_library.py tests/test_notebook_template_gallery.py tests/test_page_layout_preference.py tests/test_journal_two_account_purge.py tests/test_notebook_contract_fixtures.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py tests/test_notebook_switch_rehearsal.py tests/test_notebook_telemetry_events.py tests/test_j2_telemetry_allowlist.py tests/test_paywall_gate_free_tier.py -q`.

  If a named file does not exist, record the real name and use it in later tasks. Record any red, with its first assertion line, as "pre-existing at <base sha>".

- [ ] **Step 3: Answer V1-V14 in the doc, each with a quoted line**

| V | Question | Where to look |
|---|---|---|
| V1 | Base SHA; F1-F28 re-read, each quoted, drift noted | the Facts table |
| V2 | Have P3b (`58e9a74667` or later) and P5 landed on the base? For each that has, quote its `ITEM_TYPES`, `_library_hides`, list endpoint `capabilities`, and chip row, and apply the union table above to every later task | `git merge-base --is-ancestor`; F27 |
| V3 | The `user_preferences` table: its columns, and how a server function reads one key for one member through a passed connection | `api/services/auth_service.py:1631-1660`, the table's DDL |
| V4 | Does any rail require every switch read by a gallery gate to be in `NOTEBOOK_FLAGS`, or forbid `os.environ.get` for a Notebook switch? Quote P3b's answer (`notebook_flags.py`'s rule) if P3b has landed, else read `tests/test_notebook_flag_parse.py` and `tests/test_feature_flag_ledger.py` | as named |
| V5 | How `tests/test_feature_flag_ledger.py` and `test_notebook_switch_rehearsal.py` want a server-only switch declared (P3b's `docs/feature_flags.json` entry and `NOT_REHEARSED` row, if landed) | as named |
| V6 | `set_helpful`, `report`, `author_page`, `feed`, `admin_queue`: every clause that decides whether a row's TYPE is visible, quoted | `S/template_gallery.py:1419-1600` |
| V7 | `journal_two.db.ensure_schema` calls `ensure_gallery_schema`; an existing database gains a new column on boot (the ALTER loop) | `S/template_gallery.py:244-269`, `S/db.py` |
| V8 | `swallowedFetch.census.test.js`: what it accepts as an explicit "404 means off" branch, so the Customize editor's status read can hide its door without being counted as a swallow | the census file |
| V9 | `usePreferences()`: the return shape (`prefs`, `setPrefMerged`, `loading`, `readFailed`) and that `setPrefMerged` resolves `{ok}` | `app/src/hooks/usePreferences.js:303-400` |
| V10 | The admin review panel's chunk: is `TemplateGalleryReviewPanel.jsx` reached only through the lazy admin route, so importing `pageLayouts.js` there adds no Notebook first-open bytes? | `App.jsx`, the admin page |
| V11 | TodaySurface's and TradeDetailPage's Customize button and slot: the exact JSX the "Find shared layouts" door will sit beside | F8 |
| V12 | `TemplateGallery`'s `ReportForm`, `PreviewLines` and message host signatures; `AuthorView`'s card branch | `B/TemplateGallery.jsx:105-183`, `B/AuthorView.jsx` |
| V13 | `notebookTelemetry.js`'s client-side handling of an enum value outside the schema (dropped, sanitized, or sent), and the server's (`'other'`?) | `J/lib/notebookTelemetry.js:85-180`; `api/routers/journal_two.py` |
| V14 (**measured**) | The first-open closure on the base: `cd app && npm run build`, then `python tools/notebook_perf_budgets.py --dist app/dist`. Record the number and the tree. It is R-P4b-13's base. Record which of F28's two figures it is closer to, and whether #373 is an ancestor | build |

- [ ] **Step 4: Commit the doc and the raw output, then push**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && git add docs/notebook/p4b-verify-before-building.md docs/notebook/evidence && python tools/check_repo_hygiene.py --staged
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && git commit -F - -- docs/notebook/p4b-verify-before-building.md docs/notebook/evidence <<'MSG'
docs(notebook): P4b verify-before-building (V1-V14, bytes measured)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HWkKoqzDHY4uA1Ux38u64H
MSG
git push -u origin notebook-p4b-layout-sharing
```

---

### Task 2: The `NOTEBOOK_LAYOUT_SHARING_ENABLED` switch

**Files:**
- Modify: `S/template_gallery.py` (the gates block, after `library_enabled`), `docs/feature_flags.json`, `tools/notebook_switch_rehearsal.py` (`NOT_REHEARSED`)
- Create: `tests/test_page_layout_share.py` (the switch cases only in this task)
- NOT modified: `api/routers/auth.py` `NOTEBOOK_FLAGS`, `J/lib/offline/notebookFlags.js` `FLAG_FALLBACKS` (R-P4b-10). If V4 found a rail that requires them, STOP and report; the controller then rules between the rail and R-P4b-13.

**Interfaces:**
- Produces, in `template_gallery.py`:
  - `LAYOUT_SHARING_FLAG = "NOTEBOOK_LAYOUT_SHARING_ENABLED"`
  - `PAGE_LAYOUTS_FLAG = "JOURNAL_PAGE_LAYOUTS_ENABLED"`
  - `layout_sharing_enabled() -> bool`

- [ ] **Step 1: Write the failing tests** (`tests/test_page_layout_share.py`)

```python
"""P4b: sharing a page layout through the community library."""
from __future__ import annotations

import itertools

import pytest

from api.services.journal_two import template_gallery as gallery

SWITCHES = ("NOTEBOOK_STYLE_LIBRARY_ENABLED", "JOURNAL_PAGE_LAYOUTS_ENABLED", "NOTEBOOK_LAYOUT_SHARING_ENABLED")


def _set(monkeypatch, on: dict[str, bool]) -> None:
    for name in SWITCHES:
        monkeypatch.setenv(name, "1" if on.get(name) else "0")


@pytest.mark.parametrize("combo", list(itertools.product((False, True), repeat=3)))
def test_layout_sharing_needs_all_three_switches(monkeypatch, combo):
    _set(monkeypatch, dict(zip(SWITCHES, combo)))
    assert gallery.layout_sharing_enabled() is all(combo)


def test_layout_sharing_is_read_per_call(monkeypatch):
    _set(monkeypatch, {n: True for n in SWITCHES})
    assert gallery.layout_sharing_enabled() is True
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", "0")
    assert gallery.layout_sharing_enabled() is False


@pytest.mark.parametrize("value", ["", "maybe", "2", "off", "no"])
def test_an_unrecognised_value_is_off(monkeypatch, value):
    _set(monkeypatch, {n: True for n in SWITCHES})
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", value)
    assert gallery.layout_sharing_enabled() is False


def test_the_switch_is_server_only():
    from api.routers import auth
    assert "NOTEBOOK_LAYOUT_SHARING_ENABLED" not in auth.NOTEBOOK_FLAGS   # R-P4b-10: no payload key, +0 B
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_page_layout_share.py -q > /tmp/p4b-t2.log 2>&1; code=$?; tail -5 /tmp/p4b-t2.log; exit $code
```
Expected: FAIL, `layout_sharing_enabled` does not exist.

- [ ] **Step 3: Implement**

In `template_gallery.py`, beside `library_enabled` (import `TRUTHY` from `notebook_flags` and `os`, as P3b does, if either is not already imported):
```python
#: P4b (R-P4b-10): the layout-sharing switch. SERVER-ONLY: it is not in `auth.NOTEBOOK_FLAGS` and has no client
#: fallback row (a payload key would cost first-open bytes); the lazy library list reports it as
#: `capabilities.layoutSharing` and `GET /layouts/status` answers 404 while it is off. Read per call with a plain
#: `os.environ.get` (a `flag_on` call is for payload flags), and it needs the library AND page layouts too.
LAYOUT_SHARING_FLAG = "NOTEBOOK_LAYOUT_SHARING_ENABLED"
PAGE_LAYOUTS_FLAG = "JOURNAL_PAGE_LAYOUTS_ENABLED"


def layout_sharing_enabled() -> bool:
    """P4b's gate: all three switches on, read PER CALL. Default OFF; an unrecognised value is OFF."""
    return (library_enabled() and flag_on(PAGE_LAYOUTS_FLAG, False)
            and (os.environ.get(LAYOUT_SHARING_FLAG) or "").strip().lower() in TRUTHY)
```
If V4 found that P3b's rule applies to `PAGE_LAYOUTS_FLAG` differently (it is a payload flag, so `flag_on` is right), say so in the report.

Add the `docs/feature_flags.json` entry in the shape V5 recorded:
```json
"NOTEBOOK_LAYOUT_SHARING_ENABLED": {
  "member_facing": { "label": "Shared page layouts", "where": "Journal and Notebook" },
  "status": "dark",
  "where": ["web"],
  "note": "P4b. Gates sharing a Today or trade page layout to the community library, the Page layouts chip, previewing and adopting a layout. Server-only (no payload key); needs NOTEBOOK_STYLE_LIBRARY_ENABLED and JOURNAL_PAGE_LAYOUTS_ENABLED too. Off: layout items read like ones that do not exist and every layout route answers 404. Arm: railway variables --service web --set NOTEBOOK_LAYOUT_SHARING_ENABLED=1 (the owner's). Rollback: 0; adopted layouts stay in members' own preferences."
}
```
Add a `NOT_REHEARSED` row in `tools/notebook_switch_rehearsal.py`: `"NOTEBOOK_LAYOUT_SHARING_ENABLED": "dark (P4b): sharing and adopting page layouts; server-only, rehearsed by the P4b walk (tools/notebook_layout_library_walk.py)",`.

- [ ] **Step 4: Run the tests and the flag rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_page_layout_share.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py tests/test_notebook_switch_rehearsal.py tests/test_notebook_flags.py -q > /tmp/p4b-t2.log 2>&1; code=$?; tail -3 /tmp/p4b-t2.log; exit $code
```
Expected: all PASS. Mutation proof: drop `library_enabled() and` from the gate; the parametrized case `(False, True, True)` fails. Restore the file from the captured bytes and verify it against `git cat-file blob HEAD:api/services/journal_two/template_gallery.py` after the commit.

- [ ] **Step 5: Commit and push.** Paths: `api/services/journal_two/template_gallery.py docs/feature_flags.json tools/notebook_switch_rehearsal.py tests/test_page_layout_share.py`. Message: `feat(notebook): NOTEBOOK_LAYOUT_SHARING_ENABLED switch, server-only, needs the library and page layouts (P4b)`.

---

### Task 3: The `page_layout` item type, the panel registry, and one visibility rule

**Files:**
- Create: `S/page_layout_share.py`
- Modify: `S/template_gallery.py`, `api/routers/notebook_template_gallery.py` (the list endpoint), `J/lib/styleLibrary.js` (the `ITEM_TYPES` row and `layoutSharing`), `tests/test_page_layout_share.py`, `tests/test_style_library.py` (only if V2 found its `ITEM_TYPES` assertion needs the new row)

**Interfaces:**
- Produces, in `page_layout_share.py` (pure; it imports nothing from `template_gallery`, so the two never import each other at load):
  - `LAYOUT_ITEM = "page_layout"`
  - `LAYOUT_PAGES = ("today", "trade")`
  - `LAYOUT_PHASES = ("premarket", "market", "postclose")`
  - `LAYOUT_PANEL_IDS = {"today": (...9 ids...), "trade": (...9 ids...)}`, in `PANELS` order
  - `page_lists(page) -> tuple[str, ...]`: `LAYOUT_PHASES` for `today`, `("trade",)` for `trade`
  - `class LayoutPayloadError(ValueError)`
  - `validate_layout_payload(p) -> dict` (raises `LayoutPayloadError`; returns `p` unchanged)
  - `safe_layout(p) -> dict | None` (the read: registry ids only, first occurrence, known lists only; None when `page` is unknown)
- Produces, in `template_gallery.py`:
  - `ITEM_TYPES = ("outline", "style", LAYOUT_ITEM)` (with P3b landed: `("outline", "style", EXAMPLE_ITEM, LAYOUT_ITEM)`)
  - column `source_page TEXT`, index `idx_j2_template_gallery_layout_source` on `(user_id, source_page)` `WHERE user_id IS NOT NULL AND source_page IS NOT NULL`
  - `_hidden_item_types() -> tuple[str, ...]`: `"style"` while the library is off, `LAYOUT_ITEM` while layout sharing is off
  - `_type_visible_clause() -> str`: `"1"` when nothing is hidden, else `g.item_type NOT IN ('style', 'page_layout')` built from the tuple
  - `_library_hides(row)` becomes `row["item_type"] in _hidden_item_types()` (P3b's example branch kept)
  - `_summary` adds `layoutPage` (`row["source_page"]`) for a `page_layout` row; `_LIST_COLUMNS` gains `g.source_page`
- Produces, on the router: the list answer gains `"capabilities": {"layoutSharing": gallery.layout_sharing_enabled()}` (merged into P3b's dict when it has landed).
- Produces, in `styleLibrary.js`: `{ key: 'page_layout', label: 'Page layouts' }` as the last `ITEM_TYPES` row, and `useLibraryList` returns `layoutSharing: data?.capabilities?.layoutSharing === true` (a missing key is false).

- [ ] **Step 1: Write the failing tests** (append to `tests/test_page_layout_share.py`)

```python
import json
import re
import uuid
from pathlib import Path

from api.services.journal_two import page_layout_share as pls

ROOT = Path(__file__).resolve().parents[1]
PAGE_LAYOUTS_JS = ROOT / "app" / "src" / "pages" / "journal-2-0" / "lib" / "pageLayouts.js"


def _client_panels() -> dict[str, tuple[str, ...]]:
    text = PAGE_LAYOUTS_JS.read_text(encoding="utf-8")
    out = {}
    for page in ("today", "trade"):
        m = re.search(rf"{page}: Object\.freeze\(\[(.*?)\]\)", text, re.S)
        assert m, f"PANELS.{page} not found in pageLayouts.js"
        out[page] = tuple(re.findall(r"id: '([A-Za-z]+)'", m.group(1)))
    return out


def test_the_server_registry_is_the_client_registry():
    assert _client_panels() == {p: pls.LAYOUT_PANEL_IDS[p] for p in pls.LAYOUT_PAGES}
    m = re.search(r"export const PHASES = Object\.freeze\(\[(.*?)\]\)", PAGE_LAYOUTS_JS.read_text(encoding="utf-8"))
    assert tuple(re.findall(r"'([a-z]+)'", m.group(1))) == pls.LAYOUT_PHASES
    assert len(pls.LAYOUT_PANEL_IDS["today"]) >= 2 and len(pls.LAYOUT_PANEL_IDS["trade"]) >= 2   # non-vacuity


@pytest.fixture
def conn(tmp_path):
    # The connection tests/test_style_library.py's `conn` fixture builds: an auth.db under tmp_path with the users
    # table and journal_two.db.ensure_schema applied. Copy that fixture's body into `_make_auth_db` in this file;
    # never import a private fixture from another test module.
    return _make_auth_db(tmp_path)


def _row(conn, *, item_type, status="approved", user_id="u1", source_page=None, title="T"):
    gid = uuid.uuid4().hex
    now = "2026-10-18T00:00:00+00:00"
    conn.execute(
        "INSERT INTO j2_template_gallery (id, user_id, kind, title, description, category, body_json, status,"
        " listed_at, created_at, updated_at, preview_json, item_type, payload_json, source_page)"
        " VALUES (?, ?, 'member', ?, '', 'journal', '{}', ?, ?, ?, ?, '[]', ?, ?, ?)",
        (gid, user_id, title, status, now, now, now, item_type,
         json.dumps({"page": "trade", "lists": {"trade": [{"id": "chart", "shown": True}]}}), source_page))
    conn.commit()
    return gid


@pytest.mark.parametrize("off", SWITCHES)
def test_layout_rows_vanish_unless_all_three_switches_are_on(conn, monkeypatch, off):
    _set(monkeypatch, {n: n != off for n in SWITCHES})
    outline = _row(conn, item_type="outline", title="O")
    layout = _row(conn, item_type="page_layout", source_page="trade", title="L")
    pending = _row(conn, item_type="page_layout", status="pending", source_page="today", title="P")
    assert "L" not in [t["title"] for t in gallery.list_gallery("v", conn=conn)]
    with pytest.raises(gallery.GalleryError):
        gallery.list_gallery("v", item_type="page_layout", conn=conn)
    assert gallery.get_item("v", layout, conn=conn) is None
    assert gallery.get_item("u1", layout, conn=conn) is None            # the author too (R-P4b-10)
    assert gallery.get_item("v", outline, conn=conn) is not None
    assert all(r["id"] != pending for r in gallery.admin_queue(conn=conn)["pending"])   # a PENDING layout row
    handle = gallery.author_handle("u1", conn)
    assert all(i["itemType"] != "page_layout" for i in gallery.author_page("v", handle, conn=conn)["items"])


def test_layout_rows_list_when_all_three_are_on(conn, monkeypatch):
    _set(monkeypatch, {n: True for n in SWITCHES})
    _row(conn, item_type="page_layout", source_page="trade", title="L")
    rows = gallery.list_gallery("v", item_type="page_layout", conn=conn)
    assert [(r["title"], r["itemType"], r["layoutPage"]) for r in rows] == [("L", "page_layout", "trade")]


def test_one_rule_decides_type_visibility(monkeypatch):
    _set(monkeypatch, {"NOTEBOOK_STYLE_LIBRARY_ENABLED": False})
    assert set(gallery._hidden_item_types()) == {"style", "page_layout"}
    _set(monkeypatch, {n: True for n in SWITCHES})
    assert gallery._hidden_item_types() == ()
    assert gallery._type_visible_clause() == "1"


def test_the_client_item_types_include_page_layout():
    from tests.test_style_library import _client_keys
    assert "page_layout" in _client_keys("ITEM_TYPES")
    assert _client_keys("ITEM_TYPES") == gallery.ITEM_TYPES
```
The `conn` fixture body is copied from `tests/test_style_library.py`'s; if that helper is a fixture, copy its body, never import it. If importing `_client_keys` from another test module is not the repo's pattern, copy the six-line helper.

- [ ] **Step 2: Run it and see it fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_page_layout_share.py -q > /tmp/p4b-t3.log 2>&1; code=$?; tail -5 /tmp/p4b-t3.log; exit $code
```
Expected: FAIL, `page_layout_share` does not exist.

- [ ] **Step 3: Implement**

`S/page_layout_share.py`:
```python
"""P4b: a page layout as a community-library item. PURE: constants and functions over a payload, no database,
no import of template_gallery (which imports THIS module).

⛔ LAYOUT_PANEL_IDS and LAYOUT_PHASES are ONE FACT IN TWO FILES with PANELS and PHASES in
app/src/pages/journal-2-0/lib/pageLayouts.js; tests/test_page_layout_share.py PARSES that file and holds them
equal, in order (R-P4b-5). The PREFERENCE validator (auth._validate_page_layout) stays shape-only (R-P4-7); only
a SHARED payload is held to these ids (R-P4b-6)."""
from __future__ import annotations

from typing import Any

LAYOUT_ITEM = "page_layout"
LAYOUT_PAGES = ("today", "trade")
LAYOUT_PHASES = ("premarket", "market", "postclose")
LAYOUT_PANEL_IDS = {
    "today": ("coachStrip", "weekStrip", "goalProgress", "quickActions", "checklistToday", "myRules", "regime",
              "todayNote", "notices"),
    "trade": ("linkedNotes", "entryContext", "planGrade", "outcome", "chart", "beforeAfter", "story",
              "executions", "review"),
}


class LayoutPayloadError(ValueError):
    """A payload that must never be stored."""


def page_lists(page: str) -> tuple[str, ...]:
    return LAYOUT_PHASES if page == "today" else ("trade",)


def validate_layout_payload(p: Any) -> dict:
    """The WRITE door (R-P4b-6a): raise unless `p` is exactly {page, lists} with known lists of unique registry
    ids and boolean `shown`, and at least one list."""
    if not isinstance(p, dict) or set(p) != {"page", "lists"} or p["page"] not in LAYOUT_PAGES:
        raise LayoutPayloadError("not a layout payload")
    lists, known = p["lists"], set(LAYOUT_PANEL_IDS[p["page"]])
    if not isinstance(lists, dict) or not lists or not set(lists) <= set(page_lists(p["page"])):
        raise LayoutPayloadError("unknown list")
    for entries in lists.values():
        if not isinstance(entries, list):
            raise LayoutPayloadError("a list is not a list")
        seen: set[str] = set()
        for e in entries:
            if not isinstance(e, dict) or set(e) != {"id", "shown"} or not isinstance(e["shown"], bool):
                raise LayoutPayloadError("bad entry")
            if e["id"] not in known or e["id"] in seen:
                raise LayoutPayloadError("unknown or repeated panel")
            seen.add(e["id"])
    return p


def safe_layout(p: Any) -> dict | None:
    """The READ (R-P4b-6c): whatever is stored, registry ids only, first occurrence, known lists only."""
    if not isinstance(p, dict) or p.get("page") not in LAYOUT_PAGES:
        return None
    page, raw = p["page"], p.get("lists")
    known = set(LAYOUT_PANEL_IDS[page])
    lists: dict[str, list[dict]] = {}
    for name in page_lists(page):
        entries = raw.get(name) if isinstance(raw, dict) else None
        if not isinstance(entries, list):
            continue
        seen: set[str] = set()
        out = []
        for e in entries:
            if (isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"] in known
                    and e["id"] not in seen and isinstance(e.get("shown"), bool)):
                seen.add(e["id"])
                out.append({"id": e["id"], "shown": e["shown"]})
        lists[name] = out
    return {"page": page, "lists": lists}
```

In `template_gallery.py`:
- import `from api.services.journal_two.page_layout_share import LAYOUT_ITEM` and set `ITEM_TYPES` (with P3b's row when landed).
- add `("source_page", "TEXT")` to the ALTER loop and the new unique partial index after the style index.
- add the one rule and route every type decision through it:
```python
def _hidden_item_types() -> tuple[str, ...]:
    """⛔ THE ONE RULE for which item TYPES are absent right now (R-P3-10, R-P4b-10). Every read and write path
    asks this, never its own copy: list, get, author page, feed, the queue, Helpful, report, adopt, publish."""
    hidden = []
    if not library_enabled():
        hidden.append("style")
    if not layout_sharing_enabled():
        hidden.append(LAYOUT_ITEM)
    return tuple(hidden)


def _type_visible_clause() -> str:
    hidden = _hidden_item_types()
    return "1" if not hidden else "g.item_type NOT IN (" + ", ".join(f"'{t}'" for t in hidden) + ")"
```
- `list_gallery`: a requested `item_type` in `_hidden_item_types()` raises `GalleryError("Unknown item type.")`; replace the `g.item_type = 'outline'` clause with `_type_visible_clause()`. A `trading_style` filter while the library is off still raises as today.
- `_library_hides(row)`: `return row["item_type"] in _hidden_item_types()` (P3b's example branch first, when landed).
- `author_page`, `feed`, `admin_queue`: AND `_type_visible_clause()` into each WHERE (the queue's `outlines_only` becomes it).
- `_LIST_COLUMNS` gains `g.source_page,`; `_summary` adds `out["layoutPage"] = row["source_page"] if row["item_type"] == LAYOUT_ITEM and "source_page" in keys else None`.

The router's list endpoint returns `"capabilities": {"layoutSharing": gallery.layout_sharing_enabled()}`. The literal `type` query value `page_layout` passes the service's own check.

`styleLibrary.js`: the `ITEM_TYPES` row and the `layoutSharing` field as in Interfaces; update the file's header comment to name page layouts.

- [ ] **Step 4: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_page_layout_share.py tests/test_style_library.py tests/test_notebook_template_gallery.py -q > /tmp/p4b-t3.log 2>&1; code=$?; tail -3 /tmp/p4b-t3.log; exit $code
```
Expected: all PASS. Prove three rails can fail, restoring each file from captured bytes and verifying it against the committed blob after the commit:
1. Make `_hidden_item_types` return `()` unconditionally: the vanish test fails for all three switches.
2. Reorder two ids in `LAYOUT_PANEL_IDS["trade"]`: the registry rail fails.
3. Drop `_type_visible_clause()` from `admin_queue`: the vanish test's queue assertion fails.

- [ ] **Step 5: Commit and push.** Paths: `api/services/journal_two/page_layout_share.py api/services/journal_two/template_gallery.py api/routers/notebook_template_gallery.py app/src/pages/journal-2-0/lib/styleLibrary.js tests/test_page_layout_share.py` (plus `tests/test_style_library.py` if changed). Message: `feat(notebook): page_layout item type, the shared panel registry, and one rule for type visibility (P4b)`.

---

### Task 4: Publishing a layout, and held revisions

**Files:**
- Modify: `S/page_layout_share.py` (`layout_payload`), `S/template_gallery.py` (`publish_layout`, `layout_status`, the layout branch of `_pending_revision`, and the write-door call in `admin_act`'s revision swap), `api/routers/notebook_template_gallery.py`, `tests/test_page_layout_share.py`

**Interfaces:**
- Produces, in `page_layout_share.py`:
  - `NOT_CUSTOMIZED_SENTENCE = "You haven't changed this page's layout yet, so there is nothing to share."`
  - `UNREADABLE_SENTENCE = "Your layout couldn't be read, so it can't be shared. Open Customize, press Save, and try again."`
  - `PAGE_SENTENCE = "Pick Today or the trade page."`
  - `layout_payload(raw_pref: str | None, page: str) -> tuple[dict, int]`: the payload and `droppedPanels`; raises `LayoutPayloadError` carrying one of the three sentences. It parses the stored text (`json.loads` with `parse_constant` refusing NaN, as `_validate_page_layout` does), requires `version == 1`, takes only `today.<phase>` for each known phase present (or `trade`), keeps registry ids at first occurrence with boolean `shown`, and passes the result through `validate_layout_payload`. `droppedPanels` counts every entry of the shared page's lists that it leaves out (an unknown id, a repeat, a non-boolean `shown`); entries of the other page and of unknown phases are not shared and not counted. A page with no list present, or with only empty lists, is `NOT_CUSTOMIZED_SENTENCE`.
- Produces, in `template_gallery.py`:
  - `publish_layout(user_id, page, *, title, description, category, trading_style, conn=None) -> dict | None`: None while sharing is off. Reads the member's own preference row through `conn` (V3's query), builds the payload, and writes the item exactly as `publish_style` does (first publish pending; pending or rejected replaced in place; approved: held in `pending_json`), keyed on `(user_id, source_page)`. `body_json` is `{"type": "doc", "content": []}`; `preview_json` is `[]`. `validate_layout_payload` runs on the payload immediately before the write. Returns the summary plus `droppedPanels`.
  - `layout_status(user_id, conn=None) -> dict | None`: None while sharing is off; else `{"shared": {"today": summary-or-None, "trade": summary-or-None}}` for the member's own items (status, version, hasRevision included).
  - `_pending_revision(row)`: for a `page_layout` row, the held payload goes through `safe_layout`, not `_safe_listed`.
  - `admin_act` approve of a layout revision: `validate_layout_payload(rev["payload"])` before the swap; a failure raises `GalleryConflict("That revision could not be read, so nothing was listed. Ask the author to submit it again.")` (the existing sentence).
- Routes (both declared above `GET /{gallery_id}`, each with `dependencies=[Depends(_require_layout_sharing)]`, a new route dependency that answers the one 404 while `layout_sharing_enabled()` is false):
  - `GET /api/j2/template-gallery/layouts/status` (paid) → `layout_status`.
  - `POST /api/j2/template-gallery/layouts` (paid), body `{page, title, description?, category, tradingStyle?}` → `{template, droppedPanels}`. It spends the publish scopes exactly as `POST /styles` does (F16), and gives the day back on any refusal.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_page_layout_share.py`)

```python
def _save_pref(conn, user_id, blob):
    # V3: write through the real user_preferences table with its real columns.
    conn.execute("INSERT OR REPLACE INTO user_preferences (user_id, key, value) VALUES (?, 'journal_page_layout', ?)",
                 (user_id, blob if isinstance(blob, str) else json.dumps(blob)))
    conn.commit()


@pytest.fixture
def sharing_on(monkeypatch):
    _set(monkeypatch, {n: True for n in SWITCHES})


TRADE = [{"id": "story", "shown": True}, {"id": "chart", "shown": False}, {"id": "outcome", "shown": True}]


def _publish(conn, page="trade", user_id="author", title="Prop trade page"):
    return gallery.publish_layout(user_id, page, title=title, description="", category="journal",
                                  trading_style="prop", conn=conn)


def test_a_shared_layout_carries_only_registry_panels(conn, sharing_on):
    _save_pref(conn, "author", {
        "version": 1, "notes": "my account 1234", "__proto__": {"x": 1},
        "today": {"market": [{"id": "regime", "shown": True}], "overnight": [{"id": "regime", "shown": True}]},
        "trade": TRADE + [{"id": "futurePanel", "shown": True}, {"id": "story", "shown": False}],
    })
    item = _publish(conn)
    raw = conn.execute("SELECT payload_json, item_type, source_page, status FROM j2_template_gallery WHERE id = ?",
                       (item["id"],)).fetchone()
    assert (raw["item_type"], raw["source_page"], raw["status"]) == ("page_layout", "trade", "pending")
    assert json.loads(raw["payload_json"]) == {"page": "trade", "lists": {"trade": TRADE}}
    for leaked in ("my account 1234", "__proto__", "overnight", "futurePanel", "regime", "version"):
        assert leaked not in raw["payload_json"]
    assert item["droppedPanels"] == 2           # futurePanel, and the repeated story


def test_the_write_door_refuses_an_unknown_panel():
    good = {"page": "trade", "lists": {"trade": TRADE}}
    assert pls.validate_layout_payload(good) is good
    for bad in (
        {"page": "trade", "lists": {"trade": [{"id": "futurePanel", "shown": True}]}},
        {"page": "trade", "lists": {"trade": [{"id": "chart", "shown": True}, {"id": "chart", "shown": False}]}},
        {"page": "trade", "lists": {"market": [{"id": "chart", "shown": True}]}},
        {"page": "today", "lists": {"market": [{"id": "regime", "shown": "yes"}]}},
        {"page": "today", "lists": {"market": [{"id": "regime", "shown": True, "label": "x"}]}},
        {"page": "tray", "lists": {"trade": []}},
        {"page": "trade", "lists": {}},
        {"page": "trade", "lists": {"trade": TRADE}, "extra": 1},
    ):
        with pytest.raises(pls.LayoutPayloadError):
            pls.validate_layout_payload(bad)


def test_nothing_to_share_is_refused_with_a_sentence(conn, sharing_on):
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn)                                        # no preference row at all
    assert str(e.value) == pls.NOT_CUSTOMIZED_SENTENCE
    _save_pref(conn, "author", {"version": 1, "today": {"market": [{"id": "regime", "shown": True}]}})
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn, page="trade")                          # Today saved, the trade page never was
    assert str(e.value) == pls.NOT_CUSTOMIZED_SENTENCE
    _save_pref(conn, "author", "{not json")
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn)
    assert str(e.value) == pls.UNREADABLE_SENTENCE
    with pytest.raises(gallery.GalleryError) as e:
        _publish(conn, page="sidebar")
    assert str(e.value) == pls.PAGE_SENTENCE


def test_an_approved_layout_update_is_held_not_listed(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn, title="V1")
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=item["updatedAt"], conn=conn)
    _save_pref(conn, "author", {"version": 1, "trade": list(reversed(TRADE))})
    again = _publish(conn, title="V2")
    assert again["id"] == item["id"]
    listed = gallery.get_item("viewer", item["id"], conn=conn)
    assert (listed["title"], listed["version"], listed["payload"]["lists"]["trade"]) == ("V1", 1, TRADE)
    rev = next(r for r in gallery.admin_queue(conn=conn)["pending"] if r["id"] == item["id"])
    assert rev["hasRevision"] is True
    gallery.admin_act("admin", item["id"], "approve", reviewed_updated_at=rev["updatedAt"], conn=conn)
    after = gallery.get_item("viewer", item["id"], conn=conn)
    assert (after["title"], after["version"]) == ("V2", 2)
    assert after["payload"]["lists"]["trade"] == list(reversed(TRADE))


def test_status_names_the_members_own_items_only(conn, sharing_on):
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    item = _publish(conn)
    status = gallery.layout_status("author", conn=conn)
    assert status["shared"]["trade"]["id"] == item["id"] and status["shared"]["today"] is None
    assert gallery.layout_status("someone-else", conn=conn) == {"shared": {"today": None, "trade": None}}


def test_publish_layout_is_none_while_sharing_is_off(conn, monkeypatch):
    _set(monkeypatch, {"NOTEBOOK_STYLE_LIBRARY_ENABLED": True, "JOURNAL_PAGE_LAYOUTS_ENABLED": True})
    _save_pref(conn, "author", {"version": 1, "trade": TRADE})
    assert _publish(conn) is None
    assert gallery.layout_status("author", conn=conn) is None
```

Add router cases in the same file with the gallery tests' existing client helper (P3a's `test_style_library.py` route tests are the model): `POST /layouts` and `GET /layouts/status` answer the identical 404 while sharing is off to a paid, an unpaid and a signed-out caller; with it on, unpaid is 402; a refused publish gives the daily charge back (assert the `daily_usage_counters` row is unchanged).

- [ ] **Step 2: Run them and see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_page_layout_share.py -q > /tmp/p4b-t4.log 2>&1; code=$?; tail -5 /tmp/p4b-t4.log; exit $code
```
Expected: FAIL, `publish_layout` does not exist.

- [ ] **Step 3: Implement** per Interfaces. `publish_layout` reads the preference through the passed `conn` inside the same `try` as the write, never a second connection. It maps `LayoutPayloadError` to `GalleryError` with the error's own sentence (use the sentence as the exception's text when raising from `layout_payload`). Title, description, category and trading style go through `_clean_text`, `_clean_category` and `_clean_trading_style`, as `publish_style` does; `author_handle(user_id, conn)` runs before the write.

- [ ] **Step 4: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_page_layout_share.py tests/test_style_library.py tests/test_notebook_template_gallery.py tests/test_page_layout_preference.py -q > /tmp/p4b-t4.log 2>&1; code=$?; tail -3 /tmp/p4b-t4.log; exit $code
```
Expected: all PASS. Mutation proofs, each restored and verified:
1. Skip the `validate_layout_payload` call in `publish_layout` and make `layout_payload` keep unknown ids: the carries-only test fails (proves the build filter and the door are both load-bearing; run each half separately).
2. Make the approved branch replace the listed payload in place: the held-revision test fails.

- [ ] **Step 5: Commit and push.** Paths: `api/services/journal_two/page_layout_share.py api/services/journal_two/template_gallery.py api/routers/notebook_template_gallery.py tests/test_page_layout_share.py`. Message: `feat(notebook): share a page layout - built from the saved preference, registry panels only, held revisions (P4b)`.

---

### Task 5: Adopting a layout, and the shared machinery on layout items

**Files:**
- Modify: `S/template_gallery.py` (`adopt_layout`, `get_item`'s layout payload), `api/routers/notebook_template_gallery.py` (`POST /{gallery_id}/adopt-layout`), `tests/test_journal_two_account_purge.py`
- Create: `tests/test_page_layout_adopt.py`

**Interfaces:**
- Produces, in `template_gallery.py`:
  - `LAYOUT_MOVED_SENTENCE = "The author listed a newer version since you opened it. Nothing was changed. Look again."`
  - `LAYOUT_UNSUPPORTED_SENTENCE = "This layout can't be used yet."`
  - `adopt_layout(user_id, gallery_id, *, version, conn=None) -> dict | None`: None while sharing is off or when the item is not a listed (approved, not hidden) `page_layout`. `version` must be an int equal to the listed version, else `GalleryConflict(LAYOUT_MOVED_SENTENCE)` and nothing written. A payload `safe_layout` cannot read, or one with no list, is `GalleryError(LAYOUT_UNSUPPORTED_SENTENCE)`. Otherwise one `INSERT OR IGNORE` into `j2_template_gallery_uses` (never for the author), committed, and `{"layout": safe_layout(...), "version": v, "credit": f"Based on {_author_label(row)}'s {row['title']}"}`. It writes NO preference (R-P4b-8).
  - `get_item`: for a `page_layout` row, `out["payload"] = safe_layout(json.loads(row["payload_json"] or "{}"))` (an unreadable row reads as `None`, never a 500).
- Route: `POST /api/j2/template-gallery/{gallery_id}/adopt-layout` (paid, `_require_layout_sharing`), body `{version}` (an int, not a bool; 400 `Say which version you previewed: version must be a whole number.` otherwise). It spends the adopt scopes like `POST /{id}/adopt` (F16) and gives the day back on every refusal, a None, and an exception.

- [ ] **Step 1: Write the failing tests** (`tests/test_page_layout_adopt.py`, with Task 4's fixtures copied, not imported, plus three helpers: `_listed_layout(conn)` saves the author's `{"version": 1, "trade": TRADE}`, publishes it and approves it, returning the id; `_approve_a_revision(conn, gid)` saves a reordered trade list, shares again and approves the held revision; `_pref(conn, user_id)` returns the stored `journal_page_layout` text)

```python
def test_adopt_returns_the_listed_layout_and_counts_one_member_once(conn, sharing_on):
    gid = _listed_layout(conn)                      # author shares TRADE, admin approves
    out = gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert out["layout"] == {"page": "trade", "lists": {"trade": TRADE}}
    assert out["credit"].startswith("Based on ")
    gallery.adopt_layout("member", gid, version=1, conn=conn)
    gallery.adopt_layout("author", gid, version=1, conn=conn)
    uses = conn.execute("SELECT user_id FROM j2_template_gallery_uses WHERE gallery_id = ?", (gid,)).fetchall()
    assert [u["user_id"] for u in uses] == ["member"]
    assert conn.execute("SELECT COUNT(*) FROM user_preferences WHERE user_id = 'member'").fetchone()[0] == 0


def test_adopting_a_moved_version_is_refused_and_records_nothing(conn, sharing_on):
    gid = _listed_layout(conn)
    _approve_a_revision(conn, gid)                  # version 2 is listed
    with pytest.raises(gallery.GalleryConflict) as e:
        gallery.adopt_layout("member", gid, version=1, conn=conn)
    assert str(e.value) == gallery.LAYOUT_MOVED_SENTENCE
    assert conn.execute("SELECT COUNT(*) FROM j2_template_gallery_uses WHERE gallery_id = ?", (gid,)).fetchone()[0] == 0


def test_a_stored_unknown_panel_never_reaches_an_adopter(conn, sharing_on):
    gid = _listed_layout(conn)
    conn.execute("UPDATE j2_template_gallery SET payload_json = ? WHERE id = ?", (json.dumps(
        {"page": "trade", "lists": {"trade": TRADE + [{"id": "futurePanel", "shown": True}], "market": []}}), gid))
    conn.commit()
    assert gallery.adopt_layout("member", gid, version=1, conn=conn)["layout"]["lists"] == {"trade": TRADE}
    assert gallery.get_item("member", gid, conn=conn)["payload"]["lists"] == {"trade": TRADE}


def test_withdraw_and_hide_leave_adopted_layouts_alone(conn, sharing_on):
    gid = _listed_layout(conn)
    _save_pref(conn, "member", {"version": 1, "trade": TRADE})        # what the member wrote after adopting
    before = _pref(conn, "member")
    gallery.admin_act("admin", gid, "hide", conn=conn)
    assert gallery.adopt_layout("member", gid, version=1, conn=conn) is None
    gallery.admin_act("admin", gid, "unhide", conn=conn)
    assert gallery.unpublish("author", gid, conn=conn) is True
    assert gallery.adopt_layout("member", gid, version=1, conn=conn) is None
    assert _pref(conn, "member") == before


def test_helpful_and_report_work_on_a_layout_and_404_while_off(conn, monkeypatch, sharing_on):
    gid = _listed_layout(conn)
    assert gallery.set_helpful("member", gid, True, conn=conn)["helpful"] is True
    assert gallery.report("member", gid, reason="spam", note="", conn=conn) is not None
    monkeypatch.setenv("NOTEBOOK_LAYOUT_SHARING_ENABLED", "0")
    assert gallery.set_helpful("member2", gid, True, conn=conn) is None
    assert gallery.report("member2", gid, reason="spam", note="", conn=conn) is None
    assert gallery.adopt_layout("member2", gid, version=1, conn=conn) is None
```
Use the real return shapes of `set_helpful` and `report` (V6). Add router cases: `adopt-layout` answers the identical 404 to every caller while sharing is off; `{"version": true}` and `{"version": "1"}` answer 400 with the sentence; a 409 and a 404 give the adopt day back.

In `tests/test_journal_two_account_purge.py`, add `test_account_purge_removes_layout_items_and_keeps_adopters_layouts`: an author with a shared layout, a member who adopted it and saved the preference; purging the author removes the gallery row, its uses and helpful marks, and leaves the member's `journal_page_layout` row byte-equal.

- [ ] **Step 2: Run them and see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_page_layout_adopt.py -q > /tmp/p4b-t5.log 2>&1; code=$?; tail -5 /tmp/p4b-t5.log; exit $code
```

- [ ] **Step 3: Implement** per Interfaces. `adopt_layout` reads the row through `_row(conn, gallery_id)`, then applies `_library_hides`, approved and not hidden, and `item_type == LAYOUT_ITEM`.

- [ ] **Step 4: Run the tests**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_page_layout_adopt.py tests/test_page_layout_share.py tests/test_style_library.py tests/test_journal_two_account_purge.py -q > /tmp/p4b-t5.log 2>&1; code=$?; tail -3 /tmp/p4b-t5.log; exit $code
```
Mutation proofs, each restored and verified: drop the version check (the moved-version test fails); read `payload_json` without `safe_layout` in `adopt_layout` (the stored-unknown test fails).

- [ ] **Step 5: Commit and push.** Paths: `api/services/journal_two/template_gallery.py api/routers/notebook_template_gallery.py tests/test_page_layout_adopt.py tests/test_journal_two_account_purge.py`. Message: `feat(notebook): adopt a shared layout - the listed version, counted once, never a server write to the preference (P4b)`.

---

### Task 6: Contract fixtures and sweeps for the layout routes

**Files:**
- Modify: `tools/notebook_contract_fixtures.py` (a new `_layout_library(w)` builder and a `layout_library(w)` registered LAST, after `style_library` and after P3b's builder if landed), `J/__fixtures__/contract/` (the files the tool writes, including `sweep.signed-out.json` and `sweep.flags-off.json`), `tests/test_notebook_contract_fixtures.py` only if it lists routes by hand, `tests/test_paywall_gate_free_tier.py` only if it lists routes.

- [ ] **Step 1:** Write `_layout_library(w)` in the shape of `_style_library(w)` (F23), with the three switches on in its own env (how P3b set its server-only switch inside the tool, V5; else `monkeypatch`-style `os.environ` within the builder, restored after). It records:
  - `GET /layouts/status` (none shared, then one pending);
  - `POST /layouts` for `trade` (pending), for `today`, and the three refusals (nothing to share, unreadable, unknown page);
  - the gallery list with `?type=page_layout`, showing `capabilities.layoutSharing: true` and `layoutPage`;
  - `GET /{id}` for a listed layout (the `payload`), and for an admin with a held revision (`pendingRevision`);
  - `POST /{id}/adopt-layout` (ok, a moved version 409, a bad version 400);
  - Helpful and report on a layout item.

  Add each route to the signed-out sweep (401) and the flags-off sweep (404, sharing off with the other two on).
- [ ] **Step 2:** Run the tool in write mode (as P3a Task 8 did), then:
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_notebook_contract_fixtures.py tests/test_paywall_gate_free_tier.py -q > /tmp/p4b-t6.log 2>&1; code=$?; tail -3 /tmp/p4b-t6.log; exit $code
```
Every new route is paid; none belongs in `LEFT_OPEN`. Confirm by `git diff --stat` that no earlier fixture file changed (the builder is last, so no earlier id or time moved). If one did, STOP and report.
- [ ] **Step 3: Commit and push.** Message: `test(notebook): contract fixtures and sweeps for the page layout routes (P4b)`.

---

### Task 7: The library UI for layouts, the model functions, and telemetry

**Files:**
- Modify: `J/lib/pageLayouts.js` (three pure functions) + `J/lib/pageLayouts.test.js`, `J/lib/styleLibrary.js` (calls), `B/TemplateGallery.jsx` + `B/TemplateGallery.module.css`, `B/AuthorView.jsx`, `J/lib/notebookTelemetry.js`, `api/routers/journal_two.py`, `J/lib/notebookTelemetry.test.js`, `tests/test_notebook_telemetry_events.py`
- Create: `B/LibraryCard.jsx` (the one card dispatcher), `B/LayoutLibraryCard.jsx`, `B/LayoutPreviewSheet.jsx`, `B/AdoptLayoutSheet.jsx`, `B/LayoutLibrary.test.jsx`

**Interfaces:**
- `pageLayouts.js` adds, pure and React-free:
  - `applySharedPage(layout, page, lists)`: for each list name in `lists` (phases of Today, or `trade`), the shared registry entries in their order, then the member's unknown ids from that list in their saved order (the `resetPage` rule), and a shared id this build does not know kept as an unknown id after the shared registry entries. Every other page, phase and field is unchanged. The result goes through `normalizeLayout`, which appends any missing registry panel hidden.
  - `replaceLists(layout, page, lists)`: the given lists put in VERBATIM for those names, every other page, phase and field unchanged, then `normalizeLayout`. Undo uses it, because Undo must restore unknown ids in their original slots, which `applySharedPage` does not. (Task 8 replaces `PageLayoutEditor`'s private `withLists` with it, so the replace has one copy.)
  - `layoutDiff(current, page, lists) -> [{list, now: [label], after: [label], changed: bool}]`: shown panels by label, per list in `lists`, from `resolvePanels`.
- `styleLibrary.js` adds (each mirrors `call`; nothing swallowed):
  - `shareLayout({page, title, description, category, tradingStyle})` → `{template, droppedPanels}`
  - `useLayoutSharingStatus()` → `{status, off, error}`: SWR on `${GALLERY_KEY}/layouts/status`; a 404 is `off: true` (V8's explicit branch), never an error shown to the member
  - `adoptLayout(id, {version})` → `{layout, version, credit}`
- `LibraryCard({item, ...})`: `page_layout` → `LayoutLibraryCard`, `style` → `StyleLibraryCard`, else `GalleryCard`. `TemplateGallery`'s `card` and `AuthorView` both render it; neither keeps its own switch.
- `LayoutLibraryCard({item, onMessage, onOpenAuthor, busy})` shows the title, the author (a button when there is a handle), a page badge (`Today` / `Trade page`), the trading-style label, `Used by N`, `N found this helpful`, the Helpful toggle (hidden on `item.mine`), **Preview**, **Use this layout**, and the existing Report flow.
- `LayoutPreviewSheet({item, onClose, onUse})`: loads `getGalleryTemplate(item.id)`, then for Today a phase tab row (`Premarket · Market · After close`, real buttons with `aria-pressed`) and, per phase, two read-only lists, `Shared` and `Yours now`, of panel labels with `Shown` / `Hidden`. A list missing from the payload says `This layout doesn't change <phase>.` Footer: **Use this layout** and **Close**.
- `AdoptLayoutSheet({item, version, layout, onClose, onMessage})`, the confirm:
  - title `Use this layout for Today?` or `Use this layout for the trade page?`;
  - the line `Your current <Today|trade page> layout is replaced for the parts listed below. Nothing else changes.`;
  - `layoutDiff` rows, each `<phase>: now <labels> · after <labels>` (`The trade page:` for trade); unchanged rows say `stays the same`;
  - the standing line `A panel that needs something you don't have on yet keeps its place and shows once it can.`;
  - **Use this layout** (disabled with P4a's `LOAD_FAILED` sentence while `readFailed`) and **Cancel**.
  - On Use: `adoptLayout(item.id, {version})`, then `setPrefMerged(LAYOUT_PREF, (prev) => { const base = normalizeLayout(prev); captured = <base's lists for the names in layout.lists>; return applySharedPage(base, page, layout.lists) })`. The previous lists are captured INSIDE the updater, from the exact layout the write merges into, never from an earlier render's `prefs`. Only `{ok: true}` is a success.
  - Success: close, and `onMessage({tone: 'ok', text: '<Today|The trade page> now uses "<title>". <credit>.', action: {label: 'Undo', run}})`. `run` calls `setPrefMerged(LAYOUT_PREF, (prev) => replaceLists(normalizeLayout(prev), page, captured))`: the same door, replacing exactly those lists with what they were. Its outcomes: `Your previous <Today|trade page> layout is back.` or `Couldn't put your previous layout back. Open Customize to change it.`
  - A refused adopt shows `refusalSentence(err, "Couldn't change your layout. Nothing was changed.")` and nothing is written. A failed write shows `Couldn't change your layout. Nothing was changed.` with **Try again**, which repeats only the write.
- `TemplateGallery`: the type chips read `ITEM_TYPES` (P3b: `LISTED_ITEM_TYPES`) filtered so `page_layout` shows only while `layoutSharing`; the trading-style row also shows for `page_layout`; the message host renders `action` as a button (`Undo`) beside the text and outlives the card and its sheets (it is the gallery's own state, F19). The P3a `initialType` prop accepts `page_layout` only while `layoutSharing`.
- Telemetry: `library_viewed.type: oneOf('all', 'outline', 'style', 'page_layout')` on the client, and the matching server tuple. No new event (R-P4b-14).

- [ ] **Step 1: Write the failing tests**

`J/lib/pageLayouts.test.js` gains:
```js
describe('applySharedPage', () => {
  const shared = { trade: [{ id: 'story', shown: true }, { id: 'chart', shown: false }, { id: 'outcome', shown: true }] }

  it('replaces only the shared lists and keeps everything else byte-equal', () => {
    const mine = movePanel(togglePanel(DEFAULT_LAYOUT, 'today', 'market', 'regime'), 'today', 'market', 'regime', 'up')
    const next = applySharedPage(mine, 'trade', shared)
    expect(next.today).toEqual(mine.today)
    expect(resolvePanels(next, 'trade').slice(0, 3).map((p) => [p.id, p.shown]))
      .toEqual([['story', true], ['chart', false], ['outcome', true]])
  })

  it('keeps unknown ids and appends missing panels hidden', () => {
    const mine = { ...DEFAULT_LAYOUT, trade: [{ id: 'futurePanel', shown: true }, ...DEFAULT_LAYOUT.trade] }
    const next = applySharedPage(mine, 'trade', shared)
    expect(next.trade.map((e) => e.id)).toContain('futurePanel')
    const ids = next.trade.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(next.trade.find((e) => e.id === 'review')).toEqual({ id: 'review', shown: false })   // not shared: appended hidden
  })

  it('keeps an id this build does not know', () => {
    const next = applySharedPage(DEFAULT_LAYOUT, 'trade', { trade: [{ id: 'fromANewerBuild', shown: true }] })
    expect(next.trade.map((e) => e.id)).toContain('fromANewerBuild')
    expect(resolvePanels(next, 'trade').map((p) => p.id)).not.toContain('fromANewerBuild')
  })

  it('touches only the phases it is given', () => {
    const next = applySharedPage(DEFAULT_LAYOUT, 'today', { market: [{ id: 'regime', shown: true }] })
    expect(next.today.premarket).toEqual(DEFAULT_LAYOUT.today.premarket)
    expect(next.today.postclose).toEqual(DEFAULT_LAYOUT.today.postclose)
    expect(resolvePanels(next, 'today', 'market')[0]).toMatchObject({ id: 'regime', shown: true })
  })

  it('is pure', () => {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)))
    expect(() => applySharedPage(frozen, 'trade', shared)).not.toThrow()
  })
})
```
Use the file's existing deep-freeze helper, or add one to the test file. Add a `replaceLists` block too: it puts the given lists in verbatim (then `normalizeLayout`), so `replaceLists(applySharedPage(mine, 'trade', shared), 'trade', {trade: mine.trade})` equals `mine` exactly, unknown ids in their original slots.

`B/LayoutLibrary.test.jsx`, mocking `fetch` the way `StyleLibrary.test.jsx` does (V12), covers:
1. `layoutSharing: false` in the list answer: no `Page layouts` chip, and a `page_layout` row in a stale cache renders nothing. `true`: the chip shows and filters the URL (`?type=page_layout`).
2. A layout card shows the title, the `Trade page` badge, `Used by 3`, and no Helpful toggle on `mine`.
3. **Preview** calls `GET /{id}` and renders `Shared` and `Yours now` lists by label, with phase tabs for Today.
4. **adopt replaces only the shared phases and Undo restores them.** Press Use this layout, then confirm. The adopt POST body is exactly `{"version": 2}`. The preference POST carries `journal_page_layout` with the trade list replaced and `today` byte-equal to the input. The toast text renders `The trade page now uses "Prop trade page". Based on Ana's Prop trade page.` Press Undo: a second preference POST restores the previous trade list exactly, and `Your previous trade page layout is back.` renders.
5. A 409 on adopt renders the server's moved sentence, and no preference POST is made.
6. A preference write answering `{ok: false}` renders `Couldn't change your layout. Nothing was changed.` and Try again posts the preference only (no second adopt POST).
7. **adopt is disabled while the member's layout could not be read** (`readFailed`): Use this layout is disabled and the load-failed sentence renders.
8. Every new control has an accessible name; tab order runs the phase tabs, the lists, then the actions.

Telemetry: in `notebookTelemetry.test.js` and `tests/test_notebook_telemetry_events.py`, `library_viewed.type` accepts `page_layout`, and the client and server enums stay equal (the existing parity rail). `TemplateGallery` fires `library_viewed {type: 'page_layout', view: 'browse'}` when the chip is chosen (a test).

- [ ] **Step 2: Run them and see them fail**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b/app && npx vitest run src/pages/journal-2-0/lib/pageLayouts.test.js src/pages/journal-2-0/components/notebook/LayoutLibrary.test.jsx > /tmp/p4b-t7.log 2>&1; code=$?; tail -5 /tmp/p4b-t7.log; exit $code
```

- [ ] **Step 3: Implement.**
  - `LibraryCard`, `LayoutLibraryCard`, `LayoutPreviewSheet` and `AdoptLayoutSheet` are imported ONLY from `TemplateGallery.jsx`, `AuthorView.jsx` and each other. `pageLayouts.js` is imported only from those lazy files here. Nothing eager imports any of them.
  - Copy the `Sheet`, `aria-pressed` tab and row patterns from `PageLayoutEditor.jsx` (F7) so the preview reads like Customize.
  - CSS: every new control gets `min-height: var(--tap-min)` inside `@media (max-width: 1024px)`. Existing gallery tokens only.
- [ ] **Step 4: Run the tests plus the rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b/app && npx vitest run src/pages/journal-2-0/lib/pageLayouts.test.js src/pages/journal-2-0/components/notebook/LayoutLibrary.test.jsx src/pages/journal-2-0/components/notebook/StyleLibrary.test.jsx src/pages/journal-2-0/components/notebook/TemplateGallery.test.jsx src/pages/journal-2-0/lib/notebookTelemetry.test.js src/pages/journal-2-0/lib/swallowedFetch.census.test.js src/styles/tapFloor.test.js src/components/screener/reachable.test.js src/pages/command/keyListenerCensus.test.js > /tmp/p4b-t7.log 2>&1; code=$?; tail -5 /tmp/p4b-t7.log; exit $code
```
```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python -m pytest tests/test_notebook_telemetry_events.py tests/test_j2_telemetry_allowlist.py -q > /tmp/p4b-t7py.log 2>&1; code=$?; tail -3 /tmp/p4b-t7py.log; exit $code
```
Mutation proofs, each restored and verified: make `applySharedPage` drop unknown ids (the unknown-id model tests fail); make Undo write `DEFAULT_LAYOUT`'s list instead of the captured one (the Undo test fails).

- [ ] **Step 5: Commit and push.** Message: `feat(notebook): page layouts in the library - preview, a confirm that shows what changes, Undo, and one card dispatcher (P4b)`.

---

### Task 8: The doors, sharing a layout, and the admin review details

**Files:**
- Modify: `J/components/layout/PageLayoutEditor.jsx` (+ CSS), `J/surfaces/TodaySurface.jsx`, `J/components/trade/TradeDetailPage.jsx`, `app/src/components/admin/TemplateGalleryReviewPanel.jsx`, their tests
- Create: `J/components/layout/ShareLayoutForm.jsx`, `J/components/layout/LayoutLibraryDoor.jsx`, `J/components/layout/LayoutSharingDoors.test.jsx`

**Interfaces:**
- **`PageLayoutEditor`** swaps its private `withLists` for `replaceLists` from `pageLayouts.js` (Task 7), with no change in behaviour (`PageLayoutEditor.test.jsx` and `PageLayoutEditor.realSave.test.jsx` stay green unchanged). It reads `useLayoutSharingStatus()` (lazy, inside the editor's chunk). On `off` or an error, nothing new renders. On a 200 it adds, above the footer actions:

  - a status line: `Shared, waiting for review.` / `Listed. Version N.` / `Listed. Your update is waiting for review.` / nothing when not shared;
  - **Share this layout**: disabled with the hint `Save your changes first, then share.` while the draft differs from the saved baseline (`changedLists` is non-empty, F7). It opens `ShareLayoutForm` inside the editor's sheet body (not a second sheet).
  - **Find shared layouts**: calls the page's `onFindLayouts` prop. The page closes the editor, then opens `LayoutLibraryDoor`.
- **`ShareLayoutForm({page, existing, onDone, onCancel})`**: title (prefilled `My Today layout` / `My trade page layout`), description, category (`GALLERY_CATEGORIES`), trading style (optional), the line `An admin reviews it before it is listed. Only which panels show, and their order, are shared.`, **Submit** and **Cancel**. Success sentences: `Sent for review. It is listed once an admin approves it.`, or for an approved item `Sent for review. The version listed now stays listed until an admin approves this update.`, plus `N panel(s) this version doesn't show {was|were} left out.` when `droppedPanels > 0`. A refusal shows `refusalSentence(err, "Couldn't share that layout. Nothing was sent.")`.
- **`LayoutLibraryDoor({open, onClose})`**: the `LibraryDoor` pattern (F21) without a button: `{open && <Sheet ... title="Shared page layouts"><TemplateGallery initialType="page_layout" .../></Sheet>}`, loading the gallery through the same `lazyChunk(() => import('../notebook/TemplateGallery'))` specifier, so the chunk is shared.
- **TodaySurface / TradeDetailPage**: one `findingLayouts` state each; `onFindLayouts` closes Customize and sets it; the door renders only while it is true. The page's toast host is unchanged.
- **`TemplateGalleryReviewPanel`**: for `itemType === 'page_layout'`, a `LayoutReviewDetails` block: `Page: Today` or `Page: Trade page`, the trading style, and per list the panels in order with `Shown` / `Hidden`, from the item's `payload`. For a held revision, the line `Update to a listed layout (version N). Approving lists it; the current version stays until then.` and the revision's lists from `pendingRevision`. Approve passes `reviewedUpdatedAt` as today.

- [ ] **Step 1: Write the failing tests** (`LayoutSharingDoors.test.jsx` plus additions to the review panel's test). Cover:
  1. Status 404: no Share and no Find button in Customize, on Today and on the trade page.
  2. Status 200, not shared: Share opens the form; Submit posts exactly `{page, title, description, category, tradingStyle}` and the sent sentence renders, plus `2 panels this version doesn't show were left out.` when the answer says 2.
  3. An unsaved toggle in the editor disables Share with the hint; Save, then Share is enabled.
  4. Status 200, approved item: the status line reads `Listed. Version 1.` and the success sentence is the update one.
  5. Find shared layouts closes the editor and opens the library sheet at Page layouts; only one sheet is open at any moment.
  6. Review panel: a layout item shows `Page: Trade page` and its panel list; a held revision shows the update line.
  7. Every new control has an accessible name and meets the tap floor.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** `ShareLayoutForm` and `LayoutLibraryDoor` are imported only from `PageLayoutEditor.jsx` and the two pages respectively, behind the existing lazy editor slot and the new lazy door. `TodaySurface` and `TradeDetailPage` are lazy routes (P4a "Bytes"), so their edits add no first-open bytes; Task 9 measures.
- [ ] **Step 4: Run the tests plus the rails**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-p4b/app && npx vitest run src/pages/journal-2-0/components/layout/LayoutSharingDoors.test.jsx src/pages/journal-2-0/components/layout/PageLayoutEditor.test.jsx src/pages/journal-2-0/components/layout/PageLayoutEditor.realSave.test.jsx src/components/admin/TemplateGalleryReviewPanel.test.jsx src/pages/journal-2-0/lib/swallowedFetch.census.test.js src/styles/tapFloor.test.js src/components/screener/reachable.test.js src/pages/command/keyListenerCensus.test.js > /tmp/p4b-t8.log 2>&1; code=$?; tail -5 /tmp/p4b-t8.log; exit $code
```
Also run every existing `TodaySurface*.test.jsx` and `TradeDetailPage*.test.jsx` (named files, V11's list). Mutation proof: make Share ignore the unsaved draft; the disabled-hint test fails. Restore and verify.
- [ ] **Step 5: Commit and push.** Message: `feat(journal): share a layout from Customize, find shared layouts, and the admin review details (P4b)`.

---

### Task 9: Accessibility, the walk, and bytes

**Files:**
- Modify: `J/a11y/notebookSurfaces.js`
- Create: `J/a11y/layoutLibrary.a11y.test.jsx`, `tools/notebook_layout_library_walk.py`, `docs/notebook/evidence/p4b-walk-<run-id>/`, `docs/notebook/evidence/p4b-bytes-<run-id>/`

- [ ] **Step 1: Accessibility.** Add `B/LayoutLibraryCard.jsx`, `B/LayoutPreviewSheet.jsx`, `B/AdoptLayoutSheet.jsx`, `B/LibraryCard.jsx`, `J/components/layout/ShareLayoutForm.jsx` and `J/components/layout/LayoutLibraryDoor.jsx` to `notebookSurfaces.js` with recipes, in the shape of the library rows (F24). Write `layoutLibrary.a11y.test.jsx` running axe on each with sharing on (each preview phase tab; the confirm; the share form with a drop line). Run it plus `J/a11y/surfaceCoverage.test.js`.
- [ ] **Step 2: The walk.** Write `tools/notebook_layout_library_walk.py`:
  - **Shape.** Copy the sandbox and two-account shape of `tools/notebook_style_library_walk.py`. The header names its preconditions: a sandbox from the tip; two paid walk accounts and an admin (`ADMIN_EMAILS`) on that data dir; `app/dist` rebuilt; `NOTEBOOK_STYLE_LIBRARY_ENABLED=1`, `JOURNAL_PAGE_LAYOUTS_ENABLED=1` and `NOTEBOOK_LAYOUT_SHARING_ENABLED=1` in the sandbox env.
  - **Steps:**
    1. The author opens Today, Customize, shows Regime and My rules, moves Regime first, saves, and shares the layout.
    2. The admin approves it in the review panel and reads the panel list.
    3. The member opens Customize on Today, presses Find shared layouts, filters Page layouts, previews, and confirms Use this layout. Today renders Regime first.
    4. The member presses Undo; Today renders its previous order.
    5. The author shares again; the listed version is unchanged until the admin approves.
    6. The author unpublishes; the member's Today is unchanged.
    7. With `NOTEBOOK_LAYOUT_SHARING_ENABLED=0` (a sandbox restart), Customize shows no Share door and the library shows no Page layouts chip.
  - Each step records PASS, FAIL or INCONCLUSIVE with the rendered text it read, at 1280, 820 and 390.
  - **Run.** From PowerShell, with the data dir single-quoted, outside `C:\data`. Raw output goes to `docs/notebook/evidence/p4b-walk-<run-id>/` and is committed before the summary.
- [ ] **Step 3: Bytes.**
  ```bash
  cd /c/Users/Patrick/uct-worktrees/notebook-p4b/app && npm run build > /tmp/p4b-build.log 2>&1; code=$?; tail -2 /tmp/p4b-build.log; exit $code
  ```
  ```bash
  cd /c/Users/Patrick/uct-worktrees/notebook-p4b && python tools/notebook_perf_budgets.py --dist app/dist > /tmp/p4b-bytes.log 2>&1; code=$?; tail -3 /tmp/p4b-bytes.log; exit $code
  ```
  - Copy the log into `docs/notebook/evidence/p4b-bytes-<run-id>/notebook_perf_budgets.txt` and commit it.
  - The figure must be at or under Task 1 V14 **+40 B**, and is expected to be about +14 B (the telemetry literal).
  - **If it is over,** find the chunk that grew (`--json` attribution, as the P4a walk's `bytes-attribution.txt` did). An eager import of a new file is a defect: make it lazy. If the only growth is the literal and it is still over, drop `'page_layout'` from `library_viewed.type` on both sides, send nothing for the Layouts view, and record both readings and the dropped measurement in the ledger.
- [ ] **Step 4: Commit and push.** Message: `test(notebook): page layout sharing a11y, the walk and bytes evidence (P4b)`.

---

### Task 10: Gate, review, PR, arming

- [ ] **Step 1: Gate.**
  - Make a separate gate worktree on a `notebook-p4b-gate` branch at the branch tip, with a `node_modules` junction.
  - Run `python scripts/gate_shards.py --shards 6 --max-workers 3`, or `2` when Available MBytes is under 8 GB, only when no other gate runs on the box.
  - Commit the raw manifest to the branch before classifying.
  - Classify each NEW failure by running it alone on the branch and on master.
- [ ] **Step 2: Final whole-branch review.** Use the most capable available model. Then ONE fix dispatch, one scoped re-review, and an adjudication of the residuals in the ledger. The reviewer gets Review Focus 1-8 and checks each against its named test.
- [ ] **Step 3: The arming packet.** `docs/notebook/p4b-arming.md` contains:
  - the precondition: `NOTEBOOK_STYLE_LIBRARY_ENABLED` and `JOURNAL_PAGE_LAYOUTS_ENABLED` are armed and verified in the running process first (O-P4b-1);
  - the command `railway variables --service web --set NOTEBOOK_LAYOUT_SHARING_ENABLED=1` (the owner's), then verify a NEW BOOT and read the value in-process, never from `--kv`;
  - the checks after it: the gallery list answers `capabilities.layoutSharing: true`; Customize on Today shows Share this layout; as the smoke account, share a trade page layout, approve it, adopt it from the bench account, Undo it, then unpublish through the product and restore the smoke account's own layout through Customize's Reset;
  - the rollback: `=0` and a new boot; adopted layouts stay in members' own preferences, and layout items stay stored and unread;
  - the `docs/feature_flags.json` update to `armed` with the flip timestamp, in the same docs push that records the flip.
- [ ] **Step 4: Land and open the PR.**
  - Merge `origin/master`. Apply the union table for whichever of P3b and P5 landed since Task 1.
  - Run `tools/gate_carry_over.py`. Run its owed C4 vitest and pytest on the landing tree, including every Python rail this branch touched (C4-Python is never short-circuited).
  - Rebuild and re-measure bytes on the landing tree, then commit the evidence.
  - Open the PR. The body lists the rulings, the union-merge resolutions taken, the evidence paths and the arming packet, and ends with the attribution lines.
  - The owner merges.
  - After the merge, watch promote, then web SUCCESS, then `hub_nav_smoke --auth` PASS. A failing smoke is rolled back first (H15).

---

## Self-review (done at write time)

1. **Spec coverage:**

   | Spec item | Where it lands |
   |---|---|
   | P4 "shareable through P3 as `page_layout`" | Tasks 3-8 |
   | P3.1 `item_type` value `page_layout` | Task 3 |
   | P3.2 publish from a page layout, reviewed before listing | Task 4 (publish), Task 8 (door, review panel) |
   | P3.2 sanitizing shown before publish | R-P4b-3: nothing private can be carried; the form says what is shared and what was left out (Task 8) |
   | P3.2 category by trading style | Task 4 (`trading_style`), Task 7 (filter) |
   | P3.3 library tab and door | R-P4b-15 (Customize doors and the chip; no tab, R-P3-7) |
   | P3.3 filters and sorts | Task 3, Task 7 (existing sorts, the type chip) |
   | P3.3 preview with the viewer's own data | R-P4b-16 (the viewer's own lists beside the shared ones; no live render) |
   | P3.3 adopt, credited | Task 5, Task 7 |
   | P3.3 notify-me and update merge | not for layouts, R-P4b-1 |
   | P3.3 Helpful, report, hide | Task 5 (service), Task 7 (card) |
   | P3.3 author withdraws | Task 5 |
   | P3.3b `payload_json`, `version` for page layouts | Tasks 3-4 |
   | P3.3b ONE FACT rail for item types | Task 3 |
   | P3.4 paid gate, rate limits, dark switch | Tasks 2, 4, 5, R-P4b-12 |
   | §6 performance (lazy, budget unmoved) | R-P4b-13, Task 9 |
   | §6 accessibility (names, keyboard, 44 px) | Tasks 7-9 |
   | §6 privacy, rollback, testing (fixtures, ONE FACT rails, mutation-checked rails, the walk) | R-P4b-3, R-P4b-10, Tasks 3-9 |
   | §6 offline ("library browsing needs a connection and says so") | inherited from the gallery's existing offline line; the confirm's write goes through `setPrefMerged`, whose failure is shown (Task 7) |

2. **Placeholders.** None. Where a name or shape must be read from code, the step names the V-item that answers it (V3 for the preference table, V5 for the ledger shape, V8 for the census rule, V12 for the card signatures).
3. **Names used the same everywhere:** `NOTEBOOK_LAYOUT_SHARING_ENABLED`, `layout_sharing_enabled`, `LAYOUT_ITEM`, `LAYOUT_PANEL_IDS`, `LAYOUT_PHASES`, `validate_layout_payload`, `safe_layout`, `layout_payload`, `publish_layout`, `layout_status`, `adopt_layout`, `_hidden_item_types`, `_type_visible_clause`, `source_page`, `layoutPage`, `capabilities.layoutSharing`, `droppedPanels`, `applySharedPage`, `replaceLists`, `layoutDiff`, `shareLayout`, `adoptLayout`, `useLayoutSharingStatus`, `LibraryCard`, `LayoutLibraryCard`, `LayoutPreviewSheet`, `AdoptLayoutSheet`, `ShareLayoutForm`, `LayoutLibraryDoor`, and the routes `/layouts`, `/layouts/status`, `/{id}/adopt-layout`.
4. **Review Focus.** Each of the eight lines has a named test in its owning task.
