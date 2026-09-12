# NOTEBOOK PROGRAM MANIFEST

**Built 2026-09-11 for the Notebook Completion Charter. This file is the contract.**
Every later report references rows by id.

---

## ⛔⛔ HOW TO READ THIS FILE — the three rules it was built under

1. **Status is verified against the CODE, not against the doc's claim.** A doc saying
   a thing shipped is a claim; this manifest records what a measurement found. Rows
   whose status I measured are marked **`[m]`**. Rows carrying a doc's claim that I
   did **not** independently measure are marked **`[d]`** — treat those as unverified.

   ⭐ **UPDATE 2026-09-11 (charter R-4, second half): every `[d]` row has now been
   worked through against the code.** 15 rows carried `[d]`; **14 are promoted to
   `[m]`** with a one-line evidence string in the status cell, and **1 (S-05)
   remains `[d]` carrying an explicit reason it cannot be measured from the code at
   all.** So a surviving `[d]` in this file no longer means "nobody looked" — it
   means somebody looked and the code could not answer. ⛔ **Five of the fourteen
   came back contradicting the claim they were carrying** (Q1-15, Q1-16, S-02,
   S-04, S-07), and in four of those the doc asserted a gap the code had already
   closed or had deliberately refused to build — the same failure mode §7 exists to
   end, found one layer deeper. ⛔ **Reading code to measure a claim is the only way
   this file stays true**; none of it involved editing code.
2. **A citation you cannot quote is struck.** Every row traces to a document. Anything
   not traceable to a doc is NOT in scope and does not appear here.
3. **The later doc wins**, and the ruling is logged in §7. Where a code measurement
   contradicts *both* docs, the measurement wins and that is logged too.

⛔ **The single most important finding of Phase 0, stated before any table:**

> **This program is far closer to done than its own planning documents say.**
> Waves K, L, M, N, O, O6 and P are **closed in production**. The master product
> spec, the architecture doc, the roadmap and the readiness scorecard were all
> written before those closures and describe a product that no longer exists. The
> scorecard still records OCR as unbuilt; OCR has been live in production since
> Wave P5. Six separate "absent" claims in those docs are false against the code
> today (§7).
>
> ⛔ **Do not plan from the older docs.** Plan from this manifest, and re-measure
> anything marked `[d]` before building against it.

---

## 1. WHAT A MEMBER CAN DO TODAY — measured, 2026-09-11, tip `eff7d7cbb`

This section is a measurement of the code, not a summary of a doc.

**Editor & structure.** TipTap rich editor · nested folders (depth-capped 6) · tags ·
optional ticker · hero image · tables · task lists · callouts · toggles · attachment
chips · resizable images · find-in-note · slash menu · templates · daily notes ·
properties · saved views · favorites · recents · trash + restore + 30-day retention
purge · version history with diff and restore.

**Knowledge.** `[[`-autocomplete note-to-note links · backlinks · link targets ·
per-ticker research workspace · notebook home · prose-mention entity sidecar
(`j2_note_mentions`, synced on every create/update).

**Search.** FTS5 over title+body with a LIKE fallback · date-range filters ·
query-aware snippets · opt-in BM25 relevance · entity-anchored retrieval · plus three
*separately sectioned* indexes: documents (page-level), excerpts (evidence), and
thesis reviews. Sectioned, never blended into one score.

**Documents.** PDF upload · text-layer extraction · page model · **OCR live in
production** (concurrency 1) · scanned-text panel · excerpts as first-class citable
objects with W3C text-quote anchors · evidence attachment with stance.

**Ask.** Four scopes (note / document / security / notebook) · deterministic refusal
with no model call when nothing qualifies · citations as verified locations with
declared precision states · prompt-injection boundary · per-user tenant isolation.

**Widgets.** `widgetEmbed` TipTap node · 10 embed renderers · snapshot vs live mode ·
frozen/anchored capture · annotations copied from the drawings store · fallback
archive PNG · tradeRef + tradeRefType · **an embed timeframe switcher that re-anchors
around the same moment** · auto height · searchText derived at the one moment params change.

**Capture.** Capture inbox · capture dialog/host · quick-thought hotkey
`Cmd/Ctrl+Shift+Y` · Chromium MV3 browser extension with a scoped 30-day revocable
credential · Android Web Share Target · "Send to Journal" and "Send to Journal
(choose where)…" on 7 widget headers + 2 pages.

**Portability.** Full-library export (markdown + YAML + attachments, round-trip
verified) · single-note export · trade links resolved into readable front matter ·
importer for Notion / Obsidian / Evernote / generic · 7 read-only sync connectors ·
conflict fork, never clobber.

**Trading integration.** Thesis notes (tag + templated body) · thesis↔trade links ·
thesis changelog over the append-only fact ledger · finance-native review loop with
immutable completed reviews · review search · review-grounded Ask.

---

## 2. WAVE ORDER

The critical path is quoted from `primary-platform-implementation-plan.md` §1 and is
**still correct** — but most of it is now behind us. Current order, save-path-first
per the charter:

| Wave | Name | State |
|---|---|---|
| — | Waves -1, 0–3, A–B, E, K, L, M, N, O, O6, P | **CLOSED IN PRODUCTION** |
| **Q1** | **Offline durable working copy + editing** | **IN FLIGHT — BLOCKS EVERYTHING** |
| R | Widget & capture completion (the charter's four named items) | not started |
| S | Knowledge/UX completion (the surviving Bucket-B debt) | not started |
| T | Decision-blocked items | **not schedulable** — see §6 |
| Q2–Q5 | Conflict UX · offline read cache · attachment pinning · mobile shell | not started |

⛔ **Q1 is first because every later slice depends on the working-copy and
base-revision contract being right** — and because a second writer to the note save
path is exactly what Wave R's capture work would add. Building R before Q1 lands
would put new PUT paths into a save path with a known, open, unfixed race.

---

## 3. WAVE Q1 — THE SAVE PATH (blocks everything)

| id | feature | status | source |
|---|---|---|---|
| Q1-01 | Durable per-account IndexedDB working copy carrying its base revision | `[m]` **built** | wave-q0 §3 |
| Q1-02 | Outbox / ordered idempotent mutation queue surviving tab death | `[m]` **built** | wave-q0 §3 |
| Q1-03 | Web Locks leader election; only the leader drains | `[m]` **built** | wave-q0 §12 |
| Q1-04 | Reachability check, not `navigator.onLine` | `[m]` **built** | wave-q0 §7 |
| Q1-05 | 409 conflict fork — preserve both, never clobber | `[m]` **built** | wave-q0 §8 |
| Q1-06 | `reconcileConflict` append-only safety proof (compares against BASE) | `[m]` **built** | wave-q0 §0.1 |
| Q1-07 | Offline save-status vocabulary ("on this device" ≠ "synced") | `[m]` **built** — `lib/offline/unsyncedCopy.js:28` `'Saved on this device'` / `'Saved in this browser'`; `:33` `· waiting to sync`; `:51` `BLOCKED_BADGE = 'Edit again to sync'`. ⚠️ **There is no positive "Synced" string — synced is SILENCE by design** (`NoteEditorPage.jsx:1876` drops Saved/Saving chatter); the distinction is carried by what is said when the server does NOT have it. The noun also narrows on `persisted()` — "this device" vs "in this browser" — a second axis the claim never named | wave-q0 §18 |
| Q1-08 | Debounced (not per-keystroke) durable write | `[m]` **built** | wave-q0 Gate 3 |
| Q1-09 | `onversionchange` handler from day one | `[m]` **built** — `lib/offline/notebookDb.js:120` `db.onversionchange = () => { db.close(); onVersionChange?.() }`, installed on **every** successful open, with `DB_VERSION = 1` at `:31`. It closes the connection and drops the cached handle (`useDurableNote.js:78`); it does **not** notify the member — the user-facing half is the separate `req.onblocked` hook (`notebookDb.js:111`) | wave-q0 Gate 3 |
| Q1-10 | In-flight marker + landed-revision ring + 409 self-supersede | `[m]` **built, INSUFFICIENT** | round 1–3 |
| **Q1-11** | ~~THE OPEN DEFECT — queued entry reaches the server as a discard~~ | `[m]` ✅ **CLOSED 2026-09-11 — NOT A PRODUCT DEFECT.** The canary fired the door with a raw `fetch`, which is a SECOND-WRITER simulation: the editor's handlers never ran, `recordLandedRevision` never recorded the revision, guard 2 correctly answered "not ours", and forking was the right answer. Through the member's own control: **36 verifiable runs, 0 losses, r = 0.000** (excludes r ≥ 12% at ≥99%) against **13 runs, 11 losses, r = 0.85** for the raw-fetch door. One real-door run caught the mechanism working on the wire: 409 on the stale baseline → rebase onto the door's revision → 200 with the sentence, same second | RESUME §"THE INSTRUMENT MANUFACTURED THE FINDING" |
| **Q1-12** | The rail drives the doors through the editor's REAL save path | `[m]` ✅ **DONE** — `doorsThroughTheEditor.property.test.jsx`, the first test here to mount the real `NoteEditorPage` AND the real `useOutboxDrain` together, with the measured chain replayed. ⭐ Its green was the PRODUCT WORKING, not the rail failing — which is how it was read for most of a session | RESUME §A |
| **Q1-13** | Single-writer design decision | ⚖️ **DECIDED, THEN REVERSED** — see `wave-q1-single-writer-decision.md`. The race it removed does not exist on the member path, and my axis-3 measurement was wrong: the coordination machinery is not overhead, it is what makes the member path REBASE correctly (`recordLandedRevision` → landed ring → guard 2 says "ours"). Deleting it would break the working path | RESUME §B |
| Q1-14 | Logout-with-unsynced-work flow + "Download a copy" escape hatch | **not built** | wave-q0 §9 |
| Q1-15 | Offline session soft TTL; never drain into a new session | `[m]` ⚠️ **partial — but the OTHER half from what "partial" implied.** Account isolation is **structural, not a check**: one IndexedDB per account by name (`notebookDb.js:40`), so a different account physically cannot see another's outbox. A `sessionId` IS stamped on the working copy and the queued entry (`useDurableNote.js:267,278`). ⛔ **Neither named behaviour exists.** There is **no soft TTL** — `queuedAt` is written and re-stamped and **never read as an expiry** (no `expiresAt`/`staleAfter`/`MAX_QUEUE_AGE` in the offline layer); the only TTL is `IN_FLIGHT_TTL_MS = 10_000` (`inFlight.js:75`), the open-editor marker, a different mechanism. And there is **no refusal to drain another session's entry** — `outboxDrain.js:217` `sessionId: rec?.sessionId ?? entry.sessionId ?? null` is the sole read, a pass-through into a record field; no per-entry guard compares it to the current session | wave-q0 §10 |
| Q1-16 | Local purge on revocation, driven by the auth answer | ⚖️ **ADJUDICATED 2026-09-11 under R-9: BUILD — in its wave, and blocked on a prerequisite that does not exist yet.** None of the five DO-NOT-BUILD criteria fires: no service worker, CAS untouched, no second server writer, nothing blocks a save on bookkeeping, and it keeps its citation (wave-q0 §11). ⛔ **But it has NO SAFE TRIGGER TODAY.** Measured: every auth failure in `api/routers/auth.py` is a `401` carrying a PROSE `detail` — `"Sign-in expired — enter your password again"` (:278) sits beside `"Account not found"` (:284) with no machine-readable discriminator, and the client classifies on the status code alone (`outboxDrain.js:36`, `e.status >= 500`). So a purge wired to the auth answer today would have to decide whether to DELETE a member's unsynced words by matching English copy — a second authority over one value, on a string any copy edit can change. ⭐ **Prerequisite: the server must emit a distinguishable account-gone/revoked code** (not prose). Until it does, the current behaviour is correct and stays: a 401 marks the entry `permanent` and KEEPS every word. **The reason it is not DO-NOT-BUILD: the feature is sound and cited; only its trigger is missing.** | wave-q0 §11 |
| Q1-17 | Disabled-with-reason offline controls | **not built** | wave-q0 §18 |
| **Q1-18** | The flip — `OFFLINE_DEFAULT_ON` true for members | `[m]` **false everywhere — and still the owner's call.** ⛔ The blocker that held it (round 3) is resolved, but the packet's GO conditions were written against the artifact and must be re-read before anyone treats this as ready | charter |

### ⛔ Q1-12 — the measured reason this defect has survived three deploys

Self-fork rails, and whether each mounts the editor (`NoteEditorPage` references):

| rail | refs | what it actually drives |
|---|---|---|
| `offlineWordsSurvive.property.test.jsx` | **0** | calls `settleLandedSave` / `recordLandedRevision` / `drainOutbox` directly |
| `selfForkDoors.test.jsx` | **0** | ⛔ **the DOOR rail — the one that should have caught `folder`** |
| `slowPutOrdering.test.jsx` | **0** | — |
| `selfFork.test.jsx` | 1 | — |
| `inFlightGuards.test.jsx` | 1 | — |

**Four of five rails are structurally blind to a defect living in the editor's wiring
or in an ordering the editor creates.** That is not a summary of the handoff — it is a
measurement, and it is sharper than the handoff states: the door rail itself never
mounts the editor. A rail that models a door by calling the helper the door calls
cannot fail when the door is wired to the wrong helper. This is
`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` in its purest form.

---


### ⚰️ CORRECTION 2026-09-11 — "the doors send no baseline" was WRONG

I wrote, in this file and in two commits, that the three metadata doors PUT with
**no `baseUpdatedAt`** and therefore cannot 409. **That is false, and the rig
disproved it.** The reproduction run recorded the door's actual request:

```
02:57:58Z  keys=['baseUpdatedAt', 'ticker']  carriedBody=False
           base=2026-09-11T02:57:46.130041+00:00
```

The door DOES carry a baseline. I inferred its absence by reading
`onTickerChange` (`await update({ ticker })`) and never checked the wire —
`useJ2Note().update` supplies it. ⛔ **Reading the call site is not reading the
request.** The claim survived into a manifest, a §B decision doc and two commit
messages before a real browser contradicted it in one line.

⭐ What this does NOT change: the door still carries **no body**, so it still
decides the body while body-carrying entries are resolved elsewhere. The
single-writer conclusion (R-11) is unaffected — it rests on there being two
writers, not on whether one of them sends a baseline.

## 4. WAVE R — WIDGETS & CAPTURE (the charter's four named MUST items)

The charter names four items that "MUST appear". All four trace to documents. **Three
are substantially built; the gaps are specific and small.**

### R-1 · Import any chart-page widget into a note

Source: `2026-09-01-notebook-migration-program-design.md` §2.1 — *"Live embeds in
notes | `ChartEmbed`, `BreadthEmbed`, `ScannerEmbed`, `NewsEmbed`, `WatchlistEmbed`,
`FundamentalsEmbed`, `CalendarEmbed`, `AlertsEmbed`, `ThemesEmbed`, `AiSearchEmbed`"*

Measured state of the three layers:

| layer | count | detail |
|---|---|---|
| widgets with journal-embed params in `WIDGET_REGISTRY` | **18 / 18** | every id carries `paramsSchema` + `plainText` + `reconstructable` + `liveCapable` |
| widgets with an embed renderer | **10** | chart breadth themes watchlist scanner news calendar fundamentals aisearch alerts |
| widgets with a capture door | **7 + 2 pages** | chart aisearch alerts breadth calendar fundamentals news · ThemeTrackerPage · Watchlists |

| id | feature | status | source |
|---|---|---|---|
| R-1a | **Scanner/Screener capture door** — has an embed renderer and embed params, no door | 🔴 **gap** · **stays in Wave R** | `primary-platform-master-architecture.md` §9, "Future capture sources": *"screener/scanner results (currently NOT among the … capture-door widgets, despite being used as the flagship trading-journal-moat example — wire this door explicitly, don't assume it exists)"* |
| R-1b | 8 image-only widgets (notebook, profile, optionsflow, periodsort, nhnl, nhnlPulse, volumescan, scatter) have embed params but no renderer/door | 🟡 by design (`reconstructable: false`) — confirm the verdict, don't assume it | `app/src/widgets/registry.js` (`reconstructable: false` per id) |
| R-1c | Only `chart` has `menus.journal: true` | 🟡 **deliberate**, documented in `registry.js:36-43` — not a gap | `app/src/widgets/registry.js:36-43` |

⛔ R-1a is the one that matters: the Screener is used as the flagship
trading-journal-moat example in the master architecture doc, and its door does not
exist. *"wire this door explicitly, don't assume it exists."*

### R-0 · THE RELEASE GATE — added 2026-09-11, during the deploy checklist

⛔⛔ **Wave R was built with NO gate at all.** All four doors — the Scanner
header door (R-1a), the ticker-menu "Send chart to note" (R-2e), and the
`indexes` / `marketcontext` widgets — rendered unconditionally. The widgets were
in `WORKSPACE_MENU_TYPES` and `TAB_MENU_TYPES`; the two buttons had no condition
on them whatsoever.

⚰️ **This was found by checking the deploy's own member-impact paragraph against
the code, not by a test.** The paragraph reads *"Nothing changes for members …
the new Notebook capture tools in this release are switched off until a later
update turns them on."* On the branch as built, that sentence was **false for at
least three of the four doors** — the same defect shape as the round-3 claim that
the doors PUT with no `baseUpdatedAt`, which was read off a call site instead of
the wire. A member-impact paragraph is a claim about the product and gets
measured like any other.

**The gate** is `app/src/widgets/captureRelease.js`, mirroring `offlineFlag.js`:

| | |
|---|---|
| switch | `WAVE_R_CAPTURE_ON = false` (source constant; flip in ONE commit) |
| per-browser opt-in | `localStorage['uct.nb.capture.enabled'] = '1'` |
| applied at | the four derived menu arrays in `registry.js` — **one gate, seven surfaces** (workspace add-menu, ChartWidget add-menu, add-tab, phone sheet, slash menu, insert palette, `menuGroups()`) |
| plus | a render-time `captureEnabled()` read in each of the two capture buttons |

⛔ **OFF IS NOT DELETED.** `WIDGET_REGISTRY` still describes both widgets with
their `paramsSchema` intact, so a note that already stores such an embed still
renders and still search-indexes. Turning a door off has never been permission to
stop honouring what a member already saved. `WORKSPACE_MENU_TYPES_ALL` (ungated)
is what the catalogue rails read; `WORKSPACE_MENU_TYPES` (gated) is what menus
render.

**Rails**, each mutation-proved in both directions (4 mutations, all red, all
restored byte-identical):

- `app/src/widgets/captureRelease.test.js` — the switch, the menu withholding,
  `menuGroups()` not leaking, both directions, and the "off is not deleted" pin.
- `TickerActions.sendNote.test.jsx` / `ScannerResults.journalDoor.test.jsx` — the
  two buttons, **by rendered DOM**, absent with the flag off and present with it
  on, each with a control proving the absence is the gate and not a crash.

⚠️ Deliberate asymmetry, stated rather than papered over: the menu arrays are
derived at module import, so a per-browser opt-in reaches the **menus** on the
next page load; the two buttons read at render and follow immediately.

⛔ Not in `docs/feature_flags.json` — that ledger's 124 entries are Railway env
vars, and `OFFLINE_DEFAULT_ON` is deliberately absent from it too. This is the
wave's own source-constant idiom, recorded here.

### R-2 · Right-click a symbol → insert a chart widget at a timeframe and spot, 5m/15m/30m switching

| id | feature | status |
|---|---|---|
| R-2a | Chart right-click carries **Send to Journal** + **Send to Journal (choose where)…** | `[m]` **built** (`2026-09-07-breadth-drill…` line 451/453) |
| R-2b | Capture freezes symbol + `tf` + `from`/`to` visible range via `getCaptureState()` | `[m]` **built** |
| R-2c | 5m/15m/30m are first-class: `{1:'1m',5:'5m',15:'15m',30:'30m',60:'1h'}` + per-tf ceilings | `[m]` **built** (`registry.js:88,96`) |
| R-2d | **Timeframe switcher on the embedded chart, re-anchoring around the same moment** | `[m]` **built** (`WidgetEmbedView` `switchTf`) |
| **R-2e** | **`TickerActions` — the universal per-symbol right-click — has NO send-to-note entry** | 🔴 **THE GAP** |

⛔ **R-2e is the whole of this charter item that is not already built.** `TickerActions.jsx`
offers Flag · colour tags · + Add to list · Compare · Set alert. Every piece of
machinery a "Send chart to note" entry needs — `buildWidgetEmbedAttrs`,
`sendCaptureToJournal`, `CAPTURE_TARGETS`, the tf switcher — already exists and is
already used by nine other doors. This is a small, well-supported build, not a feature.

### R-3 · Indexes, breadth and market-context as journal widgets

⛔ **These three rows carry an explicit `source` because they are the rows rule 2
nearly struck.** §9.1 records that R-3b and R-3c trace to **no repo document at
all**; they are in scope because the charter is the latest owner instruction, and
that has to be written where the rows are, not only in a footnote 300 lines down.

| id | feature | status | source |
|---|---|---|---|
| R-3a | Breadth as a journal widget | `[m]` **built** (`BreadthEmbed` + frozen row) | `Notebook Completion Charter 2026-09-11` |
| R-3b | **Index / indices widget** | 🔴 **does not exist** — no index id in the registry's 18 | `Notebook Completion Charter 2026-09-11` |
| R-3c | **Market-context as a journal widget** | 🔴 **does not exist** — only a trade-row `contextAtEntry` snapshot | `Notebook Completion Charter 2026-09-11` |

⚠️ **R-3a is `[m]` built and still carries the charter source, not a design doc.**
Breadth-as-a-widget shipped before any charter asked for it; the charter is what
puts it in THIS wave's scope, and recording that is what stops a later reader
concluding the charter item is unbuilt because the widget predates it.
⛔ **R-3b and R-3c are new SPECIFICATION, not recovered specification** (§9.1).
Nobody should start them expecting to find a design waiting.

⛔ R-3b and R-3c are **genuinely new build**, and they are the only rows in the entire
charter that are. Note the precedent that governs them: breadth's registry entry
records that *"A mid-session capture shows the LIVE intraday row, which the system
DISCARDS at the 4:15 collector — no endpoint can serve it back. The frozen row is the
only honest record of what the user saw."* An index or market-context widget inherits
that problem and must freeze, not promise to re-fetch.

### R-4 · Fast capture of a screenshot or arbitrary data into a note

| id | feature | status |
|---|---|---|
| R-4a | Image drag-drop + clipboard paste into the body | `[m]` **built** — `NoteEditorPage.jsx:1272-1308`, `editorProps.handlePaste`/`handleDrop` gate on `ALLOWED_IMAGE_MIMES` then call `handleImageInsert` (`:946`), which `uploadInlineImage`s and `setImage`s, with a "Your note is unchanged." toast on failure. ⚠️ **Zero test coverage on this path**, stated in-repo at `NoteEditorPage.attachments.test.jsx:193-195` — built, working, and unrailed |
| R-4b | Capture inbox + dialog + host + quick-thought hotkey | `[m]` **built** |
| R-4c | Chart-pane canvas screenshot as hero | 🟡 **specified, then explicitly declined** — *"Step 3: Skip canvas hero capture in v1."* |
| R-4d | Video-frame still at a timestamp | ⛔ **impossible client-side**, recorded as such — cross-origin iframe, no pixel access |

---

## 5. WAVE S — THE SURVIVING DEBT

Rows that are real, unblocked, and small. Several *named* Bucket-B items are already
closed and are listed in §7 rather than here.

| id | feature | status | source |
|---|---|---|---|
| S-01 | **G-128** — widen the raw-error rail past `components/notebook` + `NotebookTab.jsx` | `[m]` 🔴 open — `IN_SCOPE` still narrow; rail itself green (8 tests) | pre-wave-l §5 |
| S-02 | Shared skeleton/loading component | `[m]` 🔴 **THE CLAIM IS FALSE — it exists AND is used here.** `app/src/components/Skeleton.jsx:3` exports `SkeletonLine`/`Block`/`Circle`/`Pill`, imported by 15 modules app-wide and rendered in Notebook at `NoteEditorPage.jsx:1786` and `FolderSidebar.jsx:908`. ⚠️ **The real defect is uneven adoption, not absence — five loading treatments coexist**: the shared skeleton, a SECOND locally-defined `Skeleton` in `NoteVideoRails.jsx:58`, bare "Loading…" (`NotebookTab.jsx:796`, `ResearchHome.jsx:75`, `TickerResearchWorkspace.jsx:104`), CSS spinner divs (`ExportDialog.jsx:125`, `ImportWizard.jsx:953`), and "Searching…" text. **Rewrite this row as a consistency sweep**; "build a shared skeleton" would build a third one | UX ledger #8 |
| S-03 | Zero-result search next-step guidance | `[m]` **open** — `FolderSidebar.jsx:976` is the entire empty node: `No notes match "{query}".` / `No notes match these filters.` No link, no clear-filters, no broaden hint. ⭐ The hint idiom already exists in the same surface (`NotebookTab.jsx:807` "Start from a template — or a blank page.") and simply is not applied to this branch. ⚠️ Found while measuring: `NotebookTab.jsx:803-806` says "Your notebook is empty." even when filters are active — the `hasActiveFilters` flag gates only the import pitch at `:809`, so a member who filtered to nothing is told their library is empty | UX ledger #6 |
| S-04 | In-note keyboard shortcuts (save / close / next-prev) | `[m]` **open — all three genuinely absent**, but the ledger's framing is stale: custom keydown handling DOES now exist (`NoteEditorPage.jsx:397-409`, `onPageKeyDown` → `Cmd/Ctrl+F` find-in-note + Escape). No `Mod-s` binding anywhere under `journal-2-0/**` (saving is autosave-only, `:1310`); Escape closes the find bar, not the note; no next/prev note navigation; and **no TipTap `addKeyboardShortcuts` anywhere in `app/src`** | UX ledger #12a |
| S-05 | Large-note performance at 10k+ words | `[d]` ⛔ **NOT MEASURABLE FROM THE CODE — examined and left, not skipped.** Performance is a runtime property and **no benchmark, perf budget, or large-note fixture exists in the repo to read**. Closing it needs an instrument that does not exist, not a reading. ⭐ What IS measurable and is a real negative: the editor does **not** virtualize — `useVirtualizer` appears in the notebook exactly twice, neither in the note body (`import/ImportWizard.jsx:10` for the import list, `PdfDocumentViewer.jsx:2` for PDF pages), so TipTap renders the full ProseMirror doc. Note that the import wizard's own comment (`:160`) records that *"5,000 unvirtualized rows stalled every checkbox click"* — the same failure mode, already met once in this surface | G-035 |
| S-06 | Email-to-note | `[m]` **absent** — *"real and cheap… the destination already exists"* | P1 §Evernote |
| S-07 | Templates: fundamental-research + data-aware prefill lineup | `[m]` 🔴 **THREE OF THE FOUR CLAIMS ARE FALSE.** `notebookTemplates.js:36` holds **9** templates in **4** families (`FAMILIES` at `:27` — `rituals · research · trades · mind`), not 8 in 3; only 4 of 9 are rituals; a **research template ships** (`:174` `key:'thesis'`, `family:'research'` — Bull/Bear/Assumptions/Catalysts/Risks/What would prove me wrong, Wave G); and **data-aware prefill is live and wired** (`templateContext.js:122-126` fetches `/api/breadth` + `/api/j2/positions` + today's game plan, consumed at `NotebookTab.jsx:527` and `noteCreation.js:55`, rendered at `notebookTemplates.js:48,57,92`). ⚠️ **What actually survives:** no user-defined templates, and no *financials/valuation* scaffold — the thesis template has no revenue/margin/multiple section, and `earnings-play`'s "Expected move"/"Last four quarters" are static em-dash prompts (`:273-277`); `templateContext` returns only `{dateText,dateShort,weekOfText,ticker,regimeLine,positionLines,gamePlanNote}` — no price, earnings date or fundamentals. ⛔ **`containsTableNode` CONFIRMED to guard a retired constraint** — §7 #13's warning is now measured: `notebookTemplates.js:322`, callers are the test suite ONLY, and `tiptap.js:11,56` loads the table extension, so `:14`'s *"StarterKit does NOT include @tiptap/extension-table"* is false. ⭐ **The source file's own header is stale the same way this row was** — `:5` "Eight … scaffolds in three families", `:34` "── The eight templates ──", beside an array of nine | templates plan |
| S-08 | Recurrence / repeating reviews | `[m]` **absent** — review scheduling is ONE member-set date property, not a rule: `thesis_reviews.py:62` `REASON_SCHEDULED` fires off `notebook_home.py:56`'s `builtin:review_date lte today`, and completing a review writes a single next date (`ThesisReviewSection.jsx:215`). No `recurrence`/`repeat`/`cadence`/`cron`/`RRULE`/`next_due` anywhere in the review, changelog, home or properties modules; the property is typed plain `date` (`note_properties.py:82`) | wave-o cert §A |
| S-09 | In-place stance toggle (currently remove-then-add) | `[m]` **open** — `journal_two.py:2152` POST `/notes/{id}/evidence` and `:2172` DELETE `/evidence/{id}` are the only mutating verbs; **no PATCH/PUT route for evidence exists** (the file's PATCH routes are trades, reviews, excerpts). Frontend matches (`ThesisSection.jsx:286` DELETE, `:259` POST). The service documents the workaround as intended — `thesis_evidence.py:117` *"a changed judgement — remove, re-add with the other stance — still works"*. ⚠️ Stances are `("supports","opposes")` only (`:32`), so a toggle is a two-state flip and cheaper than the row implies | wave-n residual 4 |
| S-10 | Picker cap honest total ("50 of 137") | `[m]` **open — and the UI is already honest about it.** `journal_two.py:3022` `GET /notes/{id}/evidence-candidates` returns `{"candidates": [...]}`, a bare list with **no `total`/`count`**, and `evidence_candidates.py:123-135` has no `COUNT(*)` at all. The cap is `ThesisSection.jsx:30` `CANDIDATE_PAGE = 50`, inferred client-side at `:469`, rendered at `:471` as *"Showing your 50 most recent — search to narrow."* with an in-file comment that it "never claims a total it does not have". ⭐ **This is a backend-capability row, not a copy row**: the string is correct today; "50 of 137" requires the endpoint to start returning a total | wave-n residual 5 |
| S-11 | `j2_verdicts` cited as a thesis-changelog source | `[m]` **open** — `thesis_changelog.py:215` assembles from exactly four readers (`_content_transition_events, _evidence_events, _fact_events, _trade_events`); the string `verdict` appears **nowhere** in that module. `j2_verdicts` is read elsewhere (`journal_two.py:1514`, a SKIP-coverage stat), so the table is live — it is simply not wired to the changelog that both the spec (§P1-3) and the architecture doc (§13) prescribe it for | G-073b |
| S-12 | PDF pinch-zoom / zoom control | `[m]` **open — no zoom affordance of any kind.** `PdfDocumentViewer.jsx:86-87` derives scale solely from a `ResizeObserver` on the scroll container, capped at `MAX_PAGE_WIDTH = 960` (`:15`): fit-to-width with a ceiling. No zoom state, no ±/fit/actual-size control, no `touchstart`/`gesturestart`/`wheel` handling — the words `pinch`, `touch`, `gesture` and `wheel` do not appear in the file | G-120 residual |
| S-13 | Self-serve account deletion trigger + SLA | `[m]` **absent** (purge engine exists) | P1-8 |
| S-14 | Mobile capture depth on iOS | ⛔ platform — no Web Share Target | wave-l R5 |

---

## 6. BLOCKED — NOT SCHEDULABLE WORK (H8 rows)

⛔ **These are logged as OPEN and skipped, not invented.** Each is blocked on a
decision that is not engineering's to make. The charter's H8 applies.

| id | feature | blocked on |
|---|---|---|
| T-01 | Semantic / vector retrieval | Zero-Data-Retention verification **and** out-of-process placement (~478 MB + 25 s cold load in the single web process) |
| T-02 | **G-080 public share-link activation** | owner ruling. Implemented · activation disabled · authorization **unverified**. ⛔ *"CONFIGURATION IS NOT AUTHORIZATION"* |
| T-03 | **G-052 Ask Notebook + live UCT vendor data** | external legal / data-rights review |
| T-04 | `analyst_price_target_consensus` fact type | same legal review — architected but inactive |
| T-05 | Encryption at rest | a design spike that must first answer whether SQLite here supports whole-file encryption under search |
| T-06 | Full-page content storage / rendered page snapshot | owner rights ruling |
| T-07 | OCR: handwriting · non-English · image attachments | not assessed / not certified — **not rejected** |
| T-08 | OCR concurrency 2 | a 7-day / ~20-document production observation gate |
| T-09 | Per-service Railway build configuration | owner trade — one `railway.json`, every service builds the same image |
| T-10 | Collaboration of any depth | requires an account/team boundary primitive that does not exist |
| T-11 | Native POST share service worker | owner decision — ⛔ **the charter's standing constraint is "No service worker"** |

### ⛔ T-12 — the gate that outranks every row above

**Stage A member validation is NOT MET. Zero member activations. `Wave 4 authorization: NOT granted.`**
And the decision log's **"HARD PRE-LAUNCH GATE — PRE-LAUNCH AUTHENTICATED NOTEBOOK
SMOKE" (2026-09-05) has never been executed.**

The readiness scorecard caps *every* domain at 6–7 for this reason and says so in its
own words: *"Every domain here is capped at 6-7 until real Stage A member behavior
exists — that gate is the actual ceiling on this scorecard right now, not any
individual feature gap."*

⛔ **This means the charter's goal — "on for members" — is gated on something no
amount of building moves.** It is named here so it is not discovered late. It is the
owner's to run; the standing constraints forbid me from manufacturing a path to it
(never request credentials, never weaken auth, never flip `COMING_SOON_MODE`).

⭐ **The script now exists: `docs/notebook/T-12-prelaunch-smoke.md`** (written
2026-09-11 under charter R-2). ~15 minutes, owner-executed, on real glass against
production, with a PASS/FAIL condition on every step and the standing prohibitions
restated at the top as stop conditions. **Its result is recorded in that file and
nowhere else**, in fixed wording so the gate's state is greppable.

⛔ **T-12 and the real-glass acceptance run are the TWO closure gates, and both
lines are required in that file even when one was not run** — `NOT PERFORMED` is
the honest value and it is not `PASS`. This program has already recorded a gate as
OPEN rather than PASS because a template came back blank four times: **absence is
not PASS.**

⚠️ **The smoke run's own notes and telemetry are NOT Stage A activations.** The
script tags everything it creates `t12-smoke` and says so, because the owner
walking the product is exactly the single-power-user signal Stage A's anti-gaming
discipline exists to exclude. Running T-12 does not move T-12's *other* half.

---

## 7. CONTRADICTIONS RESOLVED — later-wins, and where CODE overrules both docs

### ⚖️ 2026-09-12 — Q2 proposed ahead of R/S; REJECTED, contract order stands

A session proposed starting Wave Q2 (offline read · conflict UX · attachments) in
parallel ahead of Waves R and S. **Rejected by the owner the same day.** §2's order
is the contract and its dependency reasoning is explicit: R adds a **second writer
to the note save path**, which is why Q1 blocked everything and why R must land on
the finished save path rather than beside a changing one.

⭐ **What was adopted instead: the order stands, the EXECUTION is parallelised** —
see §12. K, R, S and Q2-A run concurrently on non-overlapping files; Q2-B/C/D wait
for R to merge dark and pass its post-merge Q1 canary.

⚰️ **Two errors in the proposal, both from planning off a later doc instead of this
one** — the trap §10 exists to warn about:
1. It treated `wave-q2-PRD.md` as Q2's scope. That PRD was written from
   `wave-q1-observation-window.md`'s passing mention and **omits mobile shell**,
   which §2 names as part of Q2–Q5.
2. It proposed a new `ROADMAP.md` as "the single authority", which would have been
   a second authority over this file — the exact defect §7 exists to resolve.


| # | claim | resolution |
|---|---|---|
| 1 | Offline editing "lean toward Do-Not-Build" (arch, 09-05) vs "EDITABLE in v1" (wave-q0, 09-09) | **wave-q0 wins** — later, and the charter re-affirms it |
| 2 | Version history "still entirely absent" (roadmap 09-06) | ⛔ **CODE OVERRULES** — `[m]` built: panel, `/versions`, restore |
| 3 | Entity layer "does not run at all" (spec 09-05) vs "~75% shipped" (roadmap 09-06) | ⛔ **CODE OVERRULES BOTH** — `[m]` `_sync_note_mentions` is called on create *and* update |
| 4 | Folder-sidebar fix "unconfirmed" | ⛔ **CODE** — `[m]` `/notes/folder-counts` exists |
| 5 | Local draft safety net: build item vs already done | **already done** |
| 6 | Append-only fact ledger — "the critical path", status unclear | ⛔ **CODE** — `[m]` `note_facts.py` with `observed_at`/`source_as_of`/`rights_class` |
| 7 | Command palette: "Notebook has ZERO participation" | **retracted** — the palette *pulls*; the scorecard was never corrected |
| 8 | Search Evolution I "PREP ONLY / not authorized" vs "shipped 09-06" | ⛔ **CODE** — `[m]` `dateFrom`/`dateTo` live; shipped as Wave A |
| 9 | OCR "genuinely unbuilt and deliberately so" (scorecard) | **wave-p5 wins** — OCR ACTIVE in production |
| 10 | Reviews unfindable by Search/Ask (wave-o) | **wave-o6 closes it** |
| 11 | `J2_SHARE_LINKS_ENABLED=1` (09-07) | **=0**, re-verified in every later certification |
| 12 | `NOTE_SYNC_ENABLED` asserted unset | **it is ON** — asserted from a code default, not a reading |
| 13 | Editor has NO table extension (templates plan 07-12) | **superseded** — tables shipped. ⚠️ if `containsTableNode` still guards templates it now enforces a retired constraint |
| 14 | "Charts embedded in Journal rows — Won't build" | scoped to **rows**; reversed for **notes** |
| 15 | Capture destination menu `targetsFor()` "has zero callers" | ⛔ **CODE** — `[m]` `CaptureMenu.jsx` calls it; "choose where" ships on 7 widgets |
| 16 | Thesis-trade link broken from 3 of 5 Add-Position doors (UX #0, highest severity) | ⛔ **CODE** — `[m]` fixed; `AddPositionModal` returns the created position and attaches |
| 17 | `LinkedNotesPanel` mounted only on closed-trade views (UX #4) | ⛔ **CODE** — `[m]` mounted on `PositionDetailPage` |
| 18 | Favorites / recents absent (UX #7) | **shipped** (Wave B) |

⛔ **Six of these are cases where a planning document asserted a gap that the code had
already closed.** That is the failure mode this manifest exists to end, and it is the
same one CLAUDE.md names repeatedly: *a hand-typed claim beside the source that owns it.*

---

### 🗄️ SHELVED — the offline diagnostic (`diag.js`)

**Built, railed (19 cases, mutation on the gate), and SHELVED on branch
`notebook/diag-shelved`.** It is not in any deploy.

⛔ **Investigate a closed defect no further.** It was written to see inside
round 3, which turned out to be an instrument artifact — and the wire evidence
(request *and* response, correlated) answered every question it was meant to
answer, better. The deploy gate then returned **TIER 1** on it, correctly: its
hooks sat inside `outboxDrain`'s discard-vs-rebase decision and inside
`sameAuthoredContent`, the one authority for "did the server catch up".

⛔ **No hooks inside `outboxDrain`'s decision or `sameAuthoredContent` under any
name.** Reconsider only against a real, open finding on the member path.

## 8. DO-NOT-BUILD — recorded so nobody rebuilds them

General web clipper (narrow bookmarklet carve-out only) · third-party plugin
marketplace · enterprise collaboration depth · one-click full-migration rollback ·
Notion-style external Agents platform · a new Trading Journal object model inside
Notebook · a second AI chat surface · a new `j2_theses` table · citation-level inline
markup in note bodies · full multi-hop knowledge graph · foreign listings / options
symbols / private companies as linkable entities · client-side E2E encryption ·
two-way connector sync · deep links back to source items · auto-merge of conflicts ·
offline destructive actions · offline Ask · browser-side OCR · presenting a partial
local corpus as "My Notebook" · **a service worker** — ⚖️ **including T-11's native
POST share service worker, ruled NO and moved here permanently 2026-09-12.**

---

## 9. OPEN — LOGGED, NOT INVENTED

- **The widget-embed system has no design document.** The largest single feature in
  the notebook's surface area — 10 live embeds plus the capture/insert workflow —
  exists in `registry.js` comments, one export-test line, and a §2.1 inventory row.
  It was built correctly and documented nowhere. Recorded as an OPEN documentation
  debt, not a build item.
- **G-040 internal capture surfaces** (Screener · COT · Model Book · Options Flow)
  were descoped by owner ruling 2026-09-08 — *"Status: NOT SCHEDULED. Do not
  implement from this document."* ⚠️ **The 2026-09-11 charter names this work as a
  MUST.** The charter is the later owner instruction and wins; R-1a carries it. Logged
  because a reader of the older ruling will otherwise think it is still descoped.
- Competitor AI source-counting rows remain **NOT ASSESSED** and must keep saying so.
- The readiness scorecard is **stale** and internally inconsistent (it quotes its own
  composite as both ~5.7 and 4.9). Do not re-score it from this manifest; re-measure.

### ⛔ 9.1 — THREE CHARTER ROWS TRACE TO NO REPO DOCUMENT

**H8 requires this be said plainly rather than papered over.** Six readers swept every
notebook doc, the 344 KB build plan and the 280 KB decision log. Three of the charter's
named MUST items appear in **none** of them:

| row | search result across every notebook doc |
|---|---|
| **R-2e** right-click a symbol → insert a chart widget | zero occurrences of "right-click"/"context menu" in the build plan or decision log |
| **R-3b** index / indices as a journal widget | no index widget in the registry's 18; no doc names one |
| **R-3c** market-context as a journal widget | appears only as *"ABSENT as a Notebook integration; a future opportunity, not yet scoped"* |

Also absent everywhere: the strings **"5m" / "15m" / "30m"** in any timeframe sense.

⭐ **They are in scope anyway, and here is the reasoning, stated so it can be
challenged:** the charter of 2026-09-11 is itself an owner document, and it is the
*latest* one. It names these four items as *"Known items that MUST appear (from my own
rulings)"*. So they trace to the charter, not to an older repo doc — which satisfies
rule 2 by the narrowest honest margin. ⛔ **They are new specification, not recovered
specification.** Nobody should build them expecting to find a design waiting.

---

### ⛔ 9.2 — WHAT THE `[d]` SWEEP FOUND THAT CONTRADICTS THIS MANIFEST

**Rule 1 says a `[d]` row is unverified. Measuring all 15 of them found that
`[d]` was not merely unverified — it was wrong about a third of the time, and
wrong in both directions.** Recorded here rather than silently corrected in the
rows, because the pattern is the finding.

| row | the manifest carried | the code says |
|---|---|---|
| **S-02** | "Shared skeleton/loading component — open" | **It exists and is already used in Notebook.** The defect is five competing loading treatments, including a second locally-defined `Skeleton`. Build the row as written and you add a sixth. |
| **S-07** | "partial (8 trading-ritual templates ship)" | **9 templates, 4 families, a research template already ships, and data-aware prefill is live and wired.** Only "no user-defined templates" and "no valuation scaffold" survive. |
| **Q1-16** | "Local purge on revocation — partial" | **The purge does not exist and the codebase forbids it by name.** The row asks for the deletion the owner's own Wave-Q1 invariant prohibits. It needs an owner ruling, not an implementation. |
| **Q1-15** | "Offline session soft TTL — partial" | **Neither named behaviour exists.** What exists instead is structural per-account DB isolation. The `sessionId` is stamped and never gated on; `queuedAt` is written and never read as an expiry. |
| **S-04** | "In-note keyboard shortcuts — open" | Open, but its premise moved: custom keydown handling now exists (find-in-note). The three named shortcuts are genuinely absent. |

⭐ **Three of these five assert a gap the product had already closed or had
deliberately refused to build — the same failure §7 was written to end.** §7
caught it between *documents*; this caught it between *this manifest and the
code*. A file that records other files' staleness is not immune to it.

⛔ **The two most expensive are S-02 and Q1-16, and for opposite reasons.** S-02
would have been *built twice*. Q1-16 would have been built *once, and destroyed
member words the first time a session expired with unsynced work in the outbox.*

⚠️ **S-05 is the honest residue:** it cannot be answered from the code at all,
because no benchmark exists to read. It stays `[d]` with that reason attached.
Closing it requires building an instrument first — that is a task, not a lookup.

---

## 10. TRAPS IN THE OLDER DOCS — read before planning from any of them

1. ⛔ **The wave letters I, J and K each mean two different things.** The dependency
   graph assigns *Wave I = Templates + Tasks · Wave J = Attachments/PDF · Wave K = OCR ·
   Wave L = Ask Notebook*. The waves that were actually built are *I = Attachments/PDF ·
   J = Document Intelligence II · K = Ask Notebook*. **The graph's "Wave I — Templates
   (finance-native extension) + Tasks/catalyst follow-up" was never built and has no
   home** — it was overwritten by a different Wave I. Any reader trusting the graph's
   letters will mis-assign work. Tasks/reminders is named three times across the docs,
   specified nowhere, and built never. It is carried here as **S-15**.
2. ⛔ **§10–§13 of the build plan were never re-stamped as waves closed.** Every row in
   those tiering tables still reads as pending work, including rows shipped five waves
   ago. They are the most inviting and most stale backlog in the repo.
3. ⛔ **Version retention is contradicted and unresolved.** The pre-mortem says
   *"Capped retention (last 50 versions or 30 days…) designed into Wave C from the
   start"*; Wave C's own decision 10 says *"no automatic pruning in Wave C. All
   versions kept indefinitely"*. Wave C's decision is later and more specific and
   governs — but **nothing prunes note versions today**, and that is a storage-growth
   item nobody owns. Carried as **S-16**.
4. ⛔ **Wave K broke the program's own process rule** — a task-specific competitor
   comparison was made mandatory "from Wave B forward"; *"Wave J did one, Wave K did
   not, and no gate caught it."* A rule with no gate is a hope with a timestamp.
5. The owner's stop condition after Wave K (*"Wave L does not begin"*) was satisfied by
   a re-baseline: Waves L–P shipped afterwards. **The 2026-09-11 charter is the current
   re-baseline and supersedes that stop.**

6. ⛔⛔ **"THE FOUR DOORS" WAS AN ENUMERATION OF WHAT A CANARY DROVE, AND IT WAS
   WRONG BY THREE.** Wave Q1 recorded *"the FOUR doors — every path that advances
   `updatedAt`"* and named body, folder, ticker, tags. That list came from the
   DERIVED WIRE RAIL, which can only see doors a canary actually opened; no canary
   uploaded a hero image, so `hero` never appeared and **shipped to production
   unsettled**. Re-derived from the SQL on 2026-09-12: **SEVEN server-side functions**
   advance a note's `updated_at`, through **nine routes** and **sixteen client call
   sites** — and the conflict they produce has **THREE SHAPES** (metadata-only →
   rebase · append-only → merge · body-rewrite → fork), not one.
   ⭐ **The generalisable lesson is about METHOD, not about doors.** An enumeration
   derived from BEHAVIOUR can only ever contain what was exercised, and it goes stale
   silently: nothing fails when it is incomplete. The replacement
   (`doorEnumeration.test.js`) reads the SQL, then the router, then the client, and
   fails by name on a door that appears without a settle — and the classifier in
   `serverChange.js` needs no enumeration at all, because it reads the DIFF.
   ⛔ The same shape is already recorded three times in `CLAUDE.md` (the writer index's
   `FOUR` beside six, the COT router's "4 routes" beside five, the setup catalog's
   "24" beside 26). **This one was not a stale count in a doc — it was a stale count
   the PRODUCT was built on.** Full entry: `docs/notebook/wave-q1-RESUME-HERE.md`.

### Rows added by §10

| id | feature | status |
|---|---|---|
| S-15 | Tasks / reminders, financial-native (review thesis before earnings, revisit in N days) | 🔴 never built · **SPEC-THIN** — named 3×, specified 0× |
| S-16 | Note-version retention / pruning policy | 🔴 unowned — nothing prunes `j2_note_versions` today |

---

## 11. COMPLETION CRITERIA — the one-screen definition of done

⛔ **The charter is done when every line below is TRUE.** Not when the code exists —
when it is *reachable by a member or explicitly ruled not to be.*

| # | criterion | how it is proven |
|---|---|---|
| C-1 | Every row in §2's waves Q1, R, S is **SHIPPED-DARK or FLIPPED** | per-row flag column below, plus a merge SHA |
| C-2 | Every SHIPPED-DARK row has a **flip packet** delivered to the owner | key · railway command · preconditions TRUE with evidence · window + verdict rule · rollback · member-impact paragraph |
| C-3 | Every FLIPPED row has **run its observation window to a verdict** | window length from its row; verdict recorded |
| C-4 | §8 **DO-NOT-BUILD is untouched** | a sweep proves none of the 22 named items gained code |
| C-5 | §9 **OPEN** rows are each resolved **or** deferred with an owner ruling | no row left silently open |
| C-6 | §6 **Wave T** rows each carry an owner answer | `wave-T-decisions.md`, one line each |
| C-7 | **T-12 pre-launch smoke passes** | it is the gate that outranks every row (§6) |
| C-8 | Q1's 7-day window closed **KEEP** | `wave-q1-gate-verdict.md` |
| C-9 | The manifest's own rows are **`[m]` measured, not `[d]` claimed** | one `[d]` (S-05) survives with its stated reason |
| C-10 | No capability is member-visible that the owner has not flipped | a rail per track; dark-means-dark |

⛔ **C-4 and C-10 are the two that fail silently.** Everything else announces itself.

---

## 12. EXECUTION PLAN — 2026-09-12

**Contract order stands. Execution is parallel.** Owner ruling, 2026-09-12.

### Deploy rules for this program

⭐ **The Notebook program is `app/**` web-only and has no deploy window.** It never
touches flow-worker's watch list, so the OPRA-gap reasoning in
`docs/runbooks/deploy-windows.md` does not apply to it. ⛔ That runbook is the
Options Flow session's file and is **not edited from here**.

⛔ **Merges serialize: one at a time, Railway web SUCCESS before the next.** This is
not a window, it is a queue — and it exists because three merges in four minutes on
2026-09-12 served 502s for several minutes, each push marking the previous deploy
`REMOVED`. The runbook's "~1 min blip" is per push and does not compose.

### Tracks

| track | scope | starts | gate on |
|---|---|---|---|
| **K** | runtime kill switch — server-served config; every other track's flag rides on it | now | — |
| **R** | the charter's four MUST items: R-1a scanner/screener capture door · R-3b index widget · R-3c market-context widget · R-4a image paste/drop **with coverage** | now | — |
| **S** | the 16 measured debt rows, **claims-measured-FALSE first** (S-07), then S-03, S-04, S-06, S-08, S-16, rest | now | file overlap with R |
| **Q2-A** | offline read cache | now | must not touch the save path or R's files |
| **Q2-B/C/D** | conflict UX · attachment pinning · mobile shell | **when R has merged dark and passed its post-merge Q1 canary** | R |
| **T** | decision-blocked | ⛔ **do not build** — `wave-T-decisions.md`, owner answers in one pass | owner |

⛔⛔ **R IS THE SECOND WRITER THE MANIFEST WARNED ABOUT.** §2: *"a second writer to
the note save path is exactly what Wave R's capture work would add."* Q1 went first
so R could land on a correct save path. **R therefore gets the Q1 treatment in
full**: real-door canaries with two writers, fork-never-clobber rails proven for
every capture door, the mutation gauntlet extended to each new write site, and the
sweep classifying every new default-reading site *before* code lands.

⛔ **Q2-B waits for R** because B's conflict surface must be built on the save path R
*finishes*, not the one it is about to change. Its spec is written now; it starts the
hour R lands.

### Per-row columns added to every wave table

`flag key (config)` · `default` · `flip preconditions` · `observation window + verdict
rule` · `rollback (config after K)` · `owner-bound y/n`.

⛔ **Owner-bound = member-visible and hard to reverse.** Build proceeds on the
recommendation; the **flip** waits for the owner's override pass.

### The standard every track meets

spec (cites its manifest row id) → rails before code → telemetry with the
denominator defined first, rig/canary/owner-browser excluded **by identity** →
flag on config (compile-time fallback until K merges) → gate with `rule12Paths`
waived and the reason printed → plain-diff cross-check → mutation gauntlet →
sweep to zero → sandbox canary via the **real door** → BrowserStack matrix →
**merge dark** → DEPLOY row in the Q1 observation log → **one Q1 real-door canary
after**.
