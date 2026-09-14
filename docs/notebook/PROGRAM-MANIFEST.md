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

### ⚖️ 2026-09-14 — T-12'S OWNER-IDENTITY REQUIREMENT IS SATISFIED BY AN **ADMIN-ROLE** RUN (owner amendment)

T-12's charter said the smoke is run *"by the owner, on his own device, signed in
as himself"*. Amended by the owner, 2026-09-14:

> **The owner-identity requirement is satisfied by an admin-role run on the rig
> profile. The distinction that matters for T-12 is member-role vs admin-role,
> not which human.**

⭐ **The reason, and it is the useful part.** T-12 exists to prove the pre-launch
surface works for the two ROLES that see different things — a member and an
admin. "Which human" was never the property under test; it was shorthand for
"an admin, on a real profile, driving the real UI". The rig profile is a real
signed-in admin, so it satisfies exactly that. This closes the standing conflict
between the charter's *"no agent may run it"* and the 2026-09-13 amendment that
lets automation execute and the owner review the evidence.

⛔ **What an admin-role rig run could still miss, named specifically rather than
waved past** (owner asked for this): **step 7, Ask + citation**, if any Ask quota,
entitlement or history is keyed to the ACCOUNT rather than the role. The rig
account is admin and comped, so a per-account limit would read differently on the
owner's own account. Every other step in 0–8 is role-shaped. If step 7 comes back
green on the rig, that one step is worth a hand check.

`--identity owner-rig` is the admin-role identity in `tools/t12_smoke_runner.py`.

### ⚖️ 2026-09-14 — USER-DEFINED TEMPLATES ARE **FREE** (owner ruling)

S-07's spec could not settle this from the codebase, because **two shipped
precedents in this repo give opposite answers** and both are live:

| precedent | what it does | reading |
|---|---|---|
| `j2_note_saved_views` (`api/routers/journal_two.py`) | `Depends(get_current_user)` on all four routes | user-authored content, **free** |
| `api/routers/user_definitions.py` | *"EVERYTHING HERE IS PAID (owner ruling). There is no free read: a definition list is user content on a premium surface."* | user-authored content, **paid** |

⭐ **The ruling: FREE. `j2_note_saved_views` governs for Notebook templates;
`user_definitions.py`'s paid ruling stays true for definitions and does not
extend here.** The nine built-in templates are free today, so gating a member's
own version of a free feature would make the paid tier the price of *personalising
something they already have* — which is not what the premium surface is for.

⛔ This is a scope ruling, not an implementation detail: it decides the store, the
CRUD gate and two rails. It was escalated rather than guessed, and it is recorded
in both places so neither precedent can be cited against it later —
`docs/notebook/wave-S-decisions.md` carries the same entry.

### ⚖️ 2026-09-13 — T-12 MAY BE EXECUTED BY AUTOMATION (owner amendment)

`T-12-prelaunch-smoke.md` said, in its own charter: *"Who runs it: the owner, on
his own device, signed in as himself. ~15 minutes. **This is not automation.
Nothing in this repo runs it, and no agent may run it or fill in its results.**"*

⚖️ **AMENDED BY THE OWNER, 2026-09-13, in these words:**

> *"the owner delegates execution; the owner reviews the evidence; automation may
> not substitute a scripted fetch for a real interaction at any step."*

⭐ **What changed and what did NOT.** The human-observation requirement is
satisfied by **evidence a human can review afterward** rather than by a human at
the keyboard. Everything the gate was actually protecting stands: every step is
driven through the **real surface with pointer and keyboard**, and the standing
prohibitions — no auth bypass, no flag flipped to reach a surface, no
manufactured activations, no fixing anything mid-run — are untouched.

⛔ **The sentence that now does the work: a scripted `fetch` is not a step.** If a
step cannot be driven through the control a member uses, it is **INCONCLUSIVE
with the rig limitation named**, never a pass. That is the same rule the door
work runs under, and it is why this amendment does not weaken the gate: it moves
who presses the keys, not what counts as evidence.

⚠️ **The run file says so at the top**, in the words the owner set: *"automated
per charter amendment 2026-09-13"*. A reader must never have to infer that a
green T-12 was produced by a machine.

### ⚖️ 2026-09-12 — the kill switch's MECHANISM: the spec said `/api/config`; the live architecture already had one

`kill-switch-spec.md` §1 specified a new `GET /api/config`, read once at boot.
**Struck the same day, while building K.** `CLAUDE.md` records the absence of a
config endpoint as deliberate — *"There is no feature-flag endpoint in this app —
the flag rides that payload by design"* — and
`api/routers/auth.py::_access_payload`, shared by signup, login and
`/api/auth/me`, already serves three flags that way, saying in its own comments
*"READ AT REQUEST TIME, NOT AT IMPORT … RIDES AN EXISTING PAYLOAD RATHER THAN
ADDING AN ENDPOINT."*

**Owner ruling: ride `_access_payload`, latch for the tab's lifetime.** A new
endpoint would have been a SECOND AUTHORITY over server-served flags, and it
reaches members later — a boot-read needs a reload, the payload arrives on the
next authenticated request.

⭐ **Fresh on the server, frozen per tab, and the two are not in tension.** The
server re-reads so a flip needs no redeploy. The client latches so the answer
cannot move under a running tab: Q1's `SESSION_ID`, its sync Web Lock and its
in-flight marker all belong to a tab that has already decided it may write, and a
mid-session flip would change "am I allowed to write" during a write. Rail K-R9.

⛔ **The general shape:** a spec can be internally perfect and still specify a
mechanism the codebase has already chosen against, for reasons written down
somewhere the spec's author did not look. Before building a mechanism, grep for
one — `lesson_grep_for_a_name_finds_one_ask_the_module_finds_ten`.

### ⚖️ 2026-09-12 — the kill switch's POSITION: the Q2 PRD said "not before Q2-A/B"; the owner ruled K FIRST

`wave-q2-PRD.md` carried a bolded recommendation — **"BUILD BEFORE Q2-C, NOT
BEFORE Q2-A/B"** — reasoning that Q1 flipped without a kill switch and never
needed the deploy-only rollback, that Q2-A/B fail visibly and recoverably, and
that only Q2-C's quota-eating failure justified 6–12 h of work. The owner had
previously accepted that recommendation.

**Superseded by owner ruling, 2026-09-12: K is first, ahead of every other
track.** §2's wave table already said "now"; the PRD's recommendation was the
outlier, and it is now struck and annotated in place (never deleted — a
recommendation that vanishes is one the next reader re-derives).

⭐ **The reasoning that changed, stated precisely, because the PRD's own argument
is still correct in isolation.** The PRD weighed RISK: how bad is each slice's
failure, and how fast must it be stoppable. That weighing did not change. What
changed is that every other track — K, the S rows, Q2-A, R — is specified to ship
**dark behind a config key that only K provides**. A track that cannot ship dark
cannot ship at all. K therefore stopped being a risk decision and became a
**dependency**, and a dependency's position in a queue is not a judgement call.

⛔ **The general shape, for the next time a recommendation ages:** a
recommendation reasons from the facts at the time it was written. When a later
decision changes the *dependency graph* rather than the *risk*, the
recommendation can be entirely sound and entirely inapplicable. Strike it, say
which of the two changed, and leave the reasoning readable.

Spec: `docs/notebook/kill-switch-spec.md`.

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
- ⛔⛔ **K-1 — K'S OWN SECOND FLIP PACKET. QUEUED, NOT PARKED.** Owner ruling
  2026-09-12. Flip `OFFLINE_DEFAULT_ON` to `false` so an **unreachable auth payload
  fails to OFF** instead of ON. Precondition, stated so it cannot be softened later:
  *config-served rate 100% over the K window, measured by identity, rig excluded.*
  ⭐ Something now MEASURES that: the canary's `notebook config served` row
  (`tools/window_check.py`) reads the payload a signed-in member receives and reports
  **absent** and **off** as different facts — a pod predating K serves no keys and the
  browser reads the constant, which is exactly the fleet state K-1 must not be flipped
  in front of. Until K-1 ships, the limitation is printed verbatim in the flip packet
  and in every copy of the rollback text (§2b of `kill-switch-spec.md`, rail K-R8).
  Detail: `kill-switch-spec.md` §10; packet shape: `kill-switch-flip-packet.md`.
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

6. ⛔ **A LIVE FILE ARGUES FROM A RESCINDED RULE — `shellFlag.js`.** It justifies its
   own design with *"The deploy freeze (9:15am–4:20pm ET options tape) makes a same-day
   deploy-rollback impossible"*. **That freeze was removed 2026-08-24** (CLAUDE.md,
   *"Shipping window: NO FREEZE"*), so the justification is a mechanism explaining a
   rule that no longer exists — the shape this file has twice had a rescinded
   restriction re-derived from. ⛔ **RECORDED, NOT TOUCHED BY WAVE K** (owner ruling
   2026-09-12): it is a THIRD flag mechanism with a different scope (a per-browser
   rollout dial), and editing it inside K would widen K into somebody else's surface.
   It needs an owner ruling on whether to restate or retire it; carried as **K-2** in
   `kill-switch-spec.md` §10.

7. ⛔⛔ **AN AST FLAG INDEX IS BLIND TO A TABLE-DRIVEN ENV READ — and the ledger
   read GREEN over four missing gates.** `feature_flag_index` matched a string
   CONSTANT (`os.getenv("X")`, `os.environ["X"]`, the `or "1"` fallback). Wave K
   declares its four capabilities once as `NOTEBOOK_FLAGS = {"NAME": default}` and
   reads them in a loop — precisely so the env name and the payload key cannot
   drift — and `os.environ.get(env_name)` has no constant to match. **140 flag
   tests passed over a ledger that was four gates short**, which is the exact
   failure the ledger exists to prevent, one level up: a gate nobody can
   distinguish from a gate nobody decided on.
   ⭐ **RAIL:** `tests/test_notebook_flag_table_form.py` — the index now reads a
   gate TABLE, with a CONTROL proving a bare loop-variable read is still
   invisible, so the rail's boundary is stated rather than assumed. Mutation-proved
   both ways (drop the table pass → the three dark entries read as stale).

   ⛔⛔ **AND THE CLASS HAS A SECOND, COMMONER SHAPE — FOUND HOURS LATER, ON
   ANOTHER SESSION'S FLAG.** `ENABLED_ENV = "D2_SAMPLE_PERSIST_ENABLED"` followed
   by `os.environ.get(ENABLED_ENV, "1")` is the same blindness without the table:
   an env name held in a MODULE CONSTANT has no string literal at the call site.
   That is GOOD code — one authority over the name — and the index could not see
   it, so the ledger reported a correctly-declared gate as STALE. **It was
   reporting its own blindness and blaming the entry.**

   ⛔⛔ **WHAT THAT BLINDNESS WAS HIDING: `J2_OCR_ENABLED=1`, LIVE ON `web`.** A
   Wave P production flag, armed, with **no ledger entry at all** and nothing in
   the repo able to notice — the exact state this ledger exists to make
   impossible. Declared 2026-09-12 with its live reading; `worker` and `bars-api`
   unset, read the same day.

   ⭐ **RAIL:** `_module_str_consts` resolves the constant, mutation-proved (revert
   it and BOTH names vanish again). ⚠️ And the stale rule was sharpened in the same
   commit: **rot is an entry for a gate the code does not read AT ALL**, never an
   entry for a gate that exists and defaults ON — the old rule demanded the
   deletion of a GOOD entry whose note said *"set deliberately so 'on on purpose'
   stays distinguishable from 'nobody decided'"*, which is this ledger's founding
   sentence.

8. ⛔⛔ **A MUTATION GAUNTLET CAN STOP RUNNING ITS OWN RAILS, SILENTLY.** Seven
   test files naming `lib/offline` arrived with the door work (`0ecc4f886`) and
   were never added to the gauntlet's rail set, so from that merge onward a
   mutation to a door guard could redden NOTHING and be reported as *"a guard
   nothing tests"*. ⛔ **That is the dangerous direction**: under-reported coverage
   invites deleting a guard that was fine, which is worse than under-reported
   failures.
   ⭐ **RAIL:** the gauntlet's own `--self-check` already had the case and it
   found them the first time it was run after Wave K widened `GUARD_NAMES`. The
   lesson is that the self-check has to be RUN — it is not a rail if nobody drives
   it — so it is now part of every gauntlet invocation's record.

9. ⛔ **THE LEDGER TOOK THREE KEYS, NOT FOUR, AND THE SPEC WAS WRONG.** Wave K's
   definition of done said *"`docs/feature_flags.json` gains the four keys, status
   `dark`"*. The ledger's own doctrine refuses the fourth: `needs_declaration` is
   FALSE for a gate that defaults ON, because a gate on by default is
   self-evidently a live decision, and declaring `NOTEBOOK_OFFLINE_DEFAULT_ON`
   would have tripped `test_the_ledger_does_not_describe_gates_that_no_longer_exist`.
   ⭐ **RAIL:** that test, which already existed and which is why the discrepancy
   surfaced immediately rather than as a stale entry months later. **The
   artifact deferred to the rail, not the other way round** — a DoD row is a plan,
   and a plan that contradicts a measurement loses.

10. ⛔ **A PACKET IS NAMED FOR ITS MECHANISM, NEVER ITS WAVE LETTER.** Wave K's
    flip packet is `docs/notebook/kill-switch-flip-packet.md`, deliberately NOT
    `wave-k-flip-packet.md`: in that same directory `wave-k-*.md` already means the
    OTHER Wave K — Ask Notebook — which has its own closure and production
    certification. Trap 1 of this section is that *the wave letters I, J and K each
    mean two different things*, and a filename is the one place a reader cannot see
    the ambiguity before acting on it. The spec beside it is `kill-switch-spec.md`
    for the same reason.
    ⭐ **RAIL:** `tests/test_k_reach_statement.py` addresses the packet by path, so
    a rename that resurrects the collision reds immediately.

11. ⛔⛔ **A MECHANISM THAT PREVENTS ONE FAILURE CAN MAKE THE RECOVERY FROM
    ANOTHER UNREACHABLE — the ring blocked the merge it was meant to protect.
    Classify before choosing.**

    The landed ring exists so a revision THIS browser created is not mistaken for
    a second writer; without it, a member who set a ticker in one tab and typed in
    another got a `(conflicted copy)` of a note only they had touched. It works.
    And because it answered FIRST — "ours ⇒ rebase and resend" — the drain never
    read the diff, so when the server's change was an APPEND the queued body went
    out over the block the member had just captured. **The append-only merge was
    built for exactly that case and was unreachable for every door this browser
    fired**, which is the normal case; it worked only when the door fired
    somewhere else.

    ⭐ The general shape, because it will recur: a guard that ANSWERS EARLY is a
    guard that decides on less evidence than the system has. The ring knew *who*
    wrote the revision; the classifier knew *what changed*. Ordering the cheap
    answer first meant the expensive one was never asked. ⛔ The fix is never to
    weaken the early guard — it is to stop it deciding. `ringVouchedPlan`
    (`outboxDrain.js`) is now the one authority, asked at BOTH points where the
    question arises, and the ring still answers exactly what it always did.

    ⭐ **RAILS:** the seven-family × six-ordering property matrix (24/24 metadata,
    18/18 append) and **M25 in `tools/q1_mutation_gauntlet.py`, permanent by owner
    ruling** — hoist the ring back above the classifier and exactly the eighteen
    append rows redden, no metadata row. Fixed at `9a213bd45`.

    ⭐ **AND A CENSUS RAIL, owner ruling 2026-09-13** —
    `lib/offline/ringVouchAuthority.test.js`. One authority is a property of the
    code, not of the commit that established it, so a THIRD site asking "the ring
    vouched, now what?" must fail by name the day it is written. It derives its
    census from the source the way `doorEnumeration.test.js` does: comments and
    string bodies blanked first (a comment quoting the old idiom is not a call
    site), every `.ours` read taken as a vouch site, and each site's own region —
    the block it guards, or the statement it belongs to — read for what it
    DECIDES. A region that chooses a plan must choose it through
    `ringVouchedPlan`; an `identical` short-circuit chooses none and is exempt
    **by name**; a region this rail cannot classify is a FAILURE, because "I do
    not know what this one does" must never read as "this one is fine". Four
    sites today: two authority, two identical. ⛔ The floor is asserted as well
    as the ceiling — **deleting a call site and inlining its answer is the same
    defect arriving from the other direction.** Mutation: **M26**, permanent —
    restore the PRE-SEND site to deciding on the vouch alone and 14 tests redden
    across the matrix and the census.

12. ⛔ **THE INSTRUMENT WAS WRONG FIRST — the ELEVENTH instance this programme has
    recorded, and the third in Wave Q1 alone.** The property rail's fake
    `serverCopyIsOurs` omitted `serverNote`, so the drain's classifier could not
    run **in the fixture at all**; all eighteen append rows went red for a reason
    that was purely the instrument's, and read exactly like a product defect in
    the append-only merge. The real one always returns the document — *"THE
    DOCUMENT COMES BACK WITH THE VERDICT … the classifier cannot classify a
    document it was never handed"* — and a second gap followed it: the fixture's
    dirty record carried no `serverBase`, which the product sets the moment a
    record goes dirty (`useDurableNote.js:385`).

    ⭐ **THE TELL, WORTH LEARNING:** *all eighteen* failed, including orderings
    where the classifier is the only code that could possibly run. A defect that
    is perfectly uniform across cases that exercise different paths is usually
    upstream of all of them — which is where the instrument sits.

    ⛔ **AND THE CONTROL IS WHAT SEPARATED THE TWO.** With the fixture corrected
    and the drain UNCHANGED, the eighteen stayed red — measured before the fix
    was written. That is the difference between "I fixed the product" and "I fixed
    the fixture", and it is the only evidence that distinguishes them.

    ⭐ **RAIL:** the fixture now derives the base from the server it is faking, so
    the two cannot disagree, and `f5Freeze.test.js` asserts from the SOURCE that
    an append door records and never settles with local state — the claim the
    matrix's clamp depends on.

13. ⛔⛔ **"THE FOUR DOORS" WAS AN ENUMERATION OF WHAT A CANARY DROVE, AND IT WAS
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

14. ⛔⛔ **DERIVE THE SERVER LIST FIRST, AND DO NOT TRUST A GREP TO FIND IT.**
   The fix for the four-doors trap (§10.6) was itself got wrong twice before it
   was got right, and both failures were the same shape: **a grep answered, so
   the search stopped.**
   · The first enumeration grepped the service layer for `UPDATE j2_notes SET …
     updated_at` and found **five** functions. It missed `update_note` and
     `import_confirm`, which BUILD their SQL (`f"UPDATE j2_notes SET {', '.join(sets)}"`,
     and a multi-line string concatenation) — so the two doors a member uses most
     were absent from the list of doors.
   · The second grepped the CLIENT for same-line `fetch` calls and found the
     three `/embeds` sites. It missed every write whose URL is a VARIABLE —
     including `delete_folder`, reached by ``fetch(`${url}/${id}`, {method:'DELETE'})``
     where `url` is a const eleven lines above. A cascade over every note in a
     folder was invisible to the rail meant to find it.
   ⭐ **THE ORDER THAT WORKS: SQL → ROUTER → CLIENT.** Ask the database layer
   which functions write `updated_at` (including the assembled form), ask the
   router which routes reach those functions, and only then check the client
   against THAT set. Each step is derived from the one before; no step is a
   memory or a label. `doorEnumeration.test.js` does exactly this and fails by
   name on a door without a settle.
   ⛔ **AND AN ENUMERATION IS NEVER THE WHOLE ANSWER.** The landed ring is an
   enumeration of callers; the drain's classifier reads the DIFF and needs no
   enumeration at all. When a correctness property can be derived from data
   instead of from a list of callers, derive it — the list goes stale silently
   and the diff cannot.

15. ⛔⛔ **AN INSTRUMENT'S REACH IS PART OF THE PRODUCT'S RISK SURFACE.**
   `hero` shipped unsettled **because no canary could reach it**, and that was
   not bad luck. The note editor renders three file inputs, and the hero
   picker's accept list is BYTE-IDENTICAL to the editor's hidden inline-image
   input — so the obvious selector matched the wrong one, posted to `/images`,
   and a later run read `heroImageUrl = null` and reported the rig's own
   mis-selection as a product defect. Worse, `HeroImagePicker` renders **only for
   a note that already has a hero**, so on a fresh canary note the door was not
   on the page at all.
   ⭐ Closed three ways on 2026-09-12: a stable `data-uct-hero-input` hook (with
   a rail asserting it stays), a SETUP step that seeds a first hero so the
   picker exists, and a measured verdict — the door then drove GREEN on
   production, `heroImageUrl` surviving the drain.
   ⛔ **THE HAZARD WHILE FIXING IT, RECORDED BECAUSE IT ALMOST SHIPPED:** adding
   `hero` to the canary's rotation made the SCHEDULED unattended window refuse
   to stamp every fourth run, for an instrument reason that reads as a product
   problem to whoever finds the gap later. It was taken straight back out and
   only restored once the door was genuinely drivable.
   ⭐ And adding a fourth door broke SEVEN of the rig's own self-check cases,
   every one with "three" typed into it (`(9, 10, 11)`, `range(n, n+3)`, a run
   number commented `10 % 3 = 1`). One was not arithmetic at all: a case that
   repeated a TWO-row fixture passed only because 2 and 3 are coprime. **A
   self-check that needs hand-editing when the thing it checks grows is a second
   authority over that thing's size** — they are all derived from `len(DOORS)`
   now.

16. ⛔ **A MATRIX ROW CAN MODEL SOMETHING THE PRODUCT CANNOT DO — and the clamp
    that fixes it is a second place to get it wrong.** One of the six orderings
    settles the door's revision BEFORE the queued work exists. For a metadata
    door that is real: `settleMetadataRevision` belongs to folder, ticker and
    tags. For an append door it is fiction — the three appenders record a landed
    revision and never settle with local state, because settling needs an editor
    mounted and these doors fire from surfaces that have none. A red row that
    models an impossible state is not evidence of a defect; it is the fixture
    describing itself.

    ⛔ **THE CLAMP'S OWN FIRST VERSION READ THE ORDERING'S HARD-CODED `'folder'`**
    instead of the family under test, so it evaluated the same answer for every
    row and silently un-clamped all eighteen append cases while looking correct.
    ⭐ **What caught it was a pair, not a review:** `settle-first` stayed red
    while an ordering that had become its behavioural twin went green. Two rows
    that must now agree and do not is a louder signal than either row alone.

    ⭐ **RAILS:** the clamp reads `server.familyUnderTest` in
    `offlineWordsSurvive.property.test.jsx`, and `f5Freeze.test.js` carries the
    structural half — asserting FROM THE SOURCE that `settleMetadataRevision`
    names only `folderId`, `tags` and `ticker`, and that `settleNoteWrite` never
    calls `settleLandedSave`. The claim the clamp depends on is measured, not
    assumed; if an append door ever learns to settle, the rail fails before the
    matrix silently starts lying.

17. ⛔⛔ **A DEPLOYED COPY DRIFTS, AND THE ONE THAT DECIDES A GATE IS THE WORST
    PLACE FOR IT.** `C:/Users/Patrick/uct-q1-observe/` holds COPIES of
    `nb_observe.py` and `nb_gate.py` outside every worktree, because the Task
    Scheduler jobs run from there. On 2026-09-13 the deployed `nb_gate.py` still
    carried the **four-doors** attribution — a day after the repo learned there
    are seven — so the 17:05 gate, the single run that decides keep-or-revert,
    would have printed a stale family list to the owner. Nothing was wrong in the
    repo; the repo was simply not what was going to run.

    ⭐ The generalisation is uncomfortable and worth keeping: **a file under
    version control tells you nothing about the file that executes.** Provenance
    for a scheduled tool is the copy the scheduler opens.

    ⭐ **RAIL:** `tests/test_nb_observe.py` — the drift check is now
    **parametrized over `["nb_observe.py", "nb_gate.py"]`**, so both copies are
    compared against the repo every run. It was written for the first file and
    covered exactly one of the two; the one it did not cover is the one that had
    drifted.

18. ⛔ **A BUNDLE SCAN THAT DOES NOT WALK THE GRAPH ANSWERS A DIFFERENT
    QUESTION.** Verifying Q1 fix 3 in the SERVED artifact, the first scan read
    the index's 99 direct `lazy(() => import(...))` chunks and reported the fix
    ABSENT. It was present. Those 99 chunks contain none of `outboxDrain`'s
    strings — **not even the pre-existing ones** — because the drain is reached
    transitively, several hops below any lazy entry point.

    ⭐ **The control is what named it:** a string that has been in the file for
    days must be findable, and it was not. When a scan cannot find something you
    know is there, the scan is the suspect — the same rule as the instrument
    being the first suspect, applied to a verification step rather than a test.
    A transitive walk over all 284 served chunks found it in
    `NotebookTab-BvWNR2dL.js`, with the append-only merge reason at @146105
    preceding the ours-rebase reason at @147235 — the classify-first ordering,
    read from the artifact a member downloads.

    ⚠️ **NOT YET A RAIL, and named here so it is not mistaken for one.** The walk
    is a procedure in the deploy evidence, not a test. Owner-bound item **C-8**
    covers making three-way verification a tool rather than a practice.

19. ⛔⛔ **FOUR FAULTS IN HOW THE GATE *READS*, ANY ONE OF WHICH PRINTED
    **REVERT** ON THE RUN THAT DECIDES KEEP-OR-REVERT.** Found 2026-09-13, seven
    hours before the 17:05 run, while wiring the C-4 sweep into it. Nothing was
    wrong with the wave.

    | # | the fault | what it printed |
    |---|---|---|
    | 1 | `rows()` selected on *"starts with a pipe"*, so the member identity/exclusion PROSE table — added the day before with the attributable-member report — was read as five observation rows ending in `**no**` / `**YES**` | *"trigger 1: 5 non-OK row(s), first at identity"* |
    | 2 | triggers 2 and 4 read hard-coded indices `x[4]` and `x[6]` — correct under the 8-column header, **off by one** under the 9-column one the config-served column created | trigger 2 was reading `blocked-baseline` under the name sync-conflict; trigger 4 was reading `outbox` under the name console errors |
    | 3 | the SKIPPED exclusion existed in **trigger 1 only**. The 2026-09-12 23:00 SKIP — production unreachable mid-deploy — carries **20 console errors** from a page that could not load | *"trigger 4: console errors at 2026-09-12 23:00 ET"* |
    | 4 | the sampler's identity-based member count was computed and **overwritten on the next line**, and that branch also emptied the canary window list the timing fallback needs | after fault 2 was fixed: *"FIRST MEMBER OPT-IN 2026-09-12 15:45:46"* — on a row whose own count says `members 0` |

    ⭐ **THE SHAPE THEY SHARE, and it is the one this programme keeps paying for:
    each is a SECOND AUTHORITY over something the log already states** — what a
    row is, where a column sits, whether a reading was taken, how many members
    there were. Every fix makes the log the authority instead.

    ⛔ **FAULT 4 WAS HIDDEN BY A SECOND BUG, and fixing fault 2 is what exposed
    it.** The timing fallback read the WHOLE opt-in cell — `2026-09-12 15:45:46 ·
    members 0` — which no date parser accepts, and `is_rig` answers True for
    anything unparseable, because you never claim a member from a value you could
    not read. That refusal was doing load-bearing work nobody knew about. ⭐ **A
    fix can be the thing that reveals the defect, and an instrument that gets
    MORE accurate can start reporting a fault that was always there.** It is the
    reason a fix is re-measured end to end rather than at the line it touched.

    ⚠️ **AND THE FIRST THREE ARRIVED WITH THE WORK THAT MADE THE GATE BETTER.**
    The prose table, the ninth column and the SKIPPED row are all from the last
    two days' improvements — the attributable-member report, the Wave K
    config-served column, and the sampler learning to write a SKIPPED row instead
    of failing silently. **Every one of those was right.** What was missing is
    that the READER was never re-derived when the thing it reads changed.

    ⚰️ **A FIFTH, MADE WHILE FIXING THE OTHER FOUR:** two successive patches each
    inserted `is_observation_row`, leaving the function defined **twice** in one
    file. Python keeps the last definition, so the behaviour was correct and the
    first copy was dead code arguing for itself — the `_parse_mdy` shape exactly.
    ⭐ **Two independent instruments caught it**: the gauntlet's own self-check
    (*"G1: its guard is present exactly once"*) refused to run, and
    `tests/test_no_shadowed_definitions.py` names it —
    `tools/nb_gate.py: is_observation_row (def) at lines [178, 183]` — verified by
    re-introducing the duplicate and watching that rail go red, then restoring.

    ⭐ **RAILS:** `tests/test_nb_gate_columns.py` — eight cases, driven against a
    log shaped like the real file (two header blocks, the prose table between
    them, a SKIPPED row), because every one of these faults needed a feature a
    tidy fixture would have left out. That is why the rails that already existed
    could not see them. Plus **G1, G2 and G3 in the gauntlet, permanent**: cut
    the row predicate, aim one column alias at its neighbour, or make
    `is_skipped` return False, and the rail reddens by name. An unknown header
    column is now a LOUD failure rather than a silent re-aim — the schema may
    change again, and the next change must break the gate rather than quietly
    move a trigger one column to the left.

20. ⛔ **THREE WAYS A NEW INSTRUMENT LIED ABOUT ITSELF IN ITS FIRST HOUR** — the
    C-4 DO-NOT-BUILD sweep, 2026-09-13. Recorded together because they are the
    same hour's work and none of them was about the thing being measured.

    - **IT SCANNED ITSELF.** `tools/q1_do_not_build_sweep.py` necessarily
      contains every construct it looks for, so its own probe table came back as
      six matches — and buried the one real one. ⭐ Same shape as
      `lesson_an_instrument_can_reproduce_its_own_blind_spot`, one step over: the
      instrument did not merely share the blind spot, it *was* the evidence.
    - **AN ASCII-SAFETY PASS RE-AIMED THE PARSER.** Replacing every `·` in the
      file to make the output console-safe also replaced the one the parser
      **splits §8 on**, so the roster came back as fragments of its own items
      (*"out only) · third"*, *"click full"*). ⛔ A cosmetic sweep over a file
      that contains a delimiter is a change to the parser. The delimiter is now
      named by codepoint, so the next cosmetic pass cannot reach it.
    - **IT DIED PRINTING ITS OWN VERDICT.** `UnicodeEncodeError` on this cp1252
      console, after the hit list had been computed and before any of it was
      shown — the exact bug that made `tools/flag_ledger_audit.py` read as an
      auth failure for a month. Output is ASCII now and `sys.stdout` is
      reconfigured as a second line of defence.

    ⭐ **AND THE ONE FINDING IT DID PRODUCE WAS A QUESTION, NOT A VERDICT.**
    `main.jsx:26` matches `navigator.serviceWorker.register` — and is exempt,
    with the argument written beside it: the call sits inside
    `getRegistrations().then(regs => if (regs.length > 0))`, so a clean install
    registers nothing, and **that call is what makes "there is no service worker"
    true**. Deleting it would strand every browser still carrying the legacy
    cache-first worker, which would then serve a stale bundle straight through a
    revert — the one failure the Wave Q1 rollback reasoning leans on being
    impossible. ⛔ A probe is never narrowed until it goes quiet; a legitimate
    match is exempted with its reasoning, so a later reader can disagree with the
    argument rather than only with the outcome.

    ⚠️ **`browser-side OCR` needed a SCOPE, not an exemption.** It is the same
    library as the server-side OCR that shipped and closed in production, so a
    probe on the bare word reported six files — five of them the *opposite* of
    the forbidden thing, including two app-side rails asserting the engine name
    never reaches member-visible copy. Some §8 items are defined by WHERE code
    runs, and the probe now says so.

21. ⛔⛔ **SEVEN INSTRUMENT FAULTS IN ONE MORNING — every fault made the PRODUCT
    look broken; every one was caught by a CONTROL, never by review.**

    F5's production matrix, 2026-09-13. Seven faults stood between the rig and
    the first honest cell. They are recorded together because the pattern is the
    lesson: **not one of them was found by reading the code, and every one of
    them pointed the same way — at the product.**

    | # | the fault | the control that caught it |
    |---|---|---|
    | 1 | **The rig is opted OUT by default.** The sampler runs opted out on purpose, so the durable layer never engaged and the first cell reported the member's offline sentence missing from the server | a pre-door read of the durable store: *on screen `True`, in durable copy `False`, queued `0`* — typed, never stored |
    | 2 | **A 502 was reported as "SIGN-IN REQUIRED."** Another session's merge was mid-swap | `/api/auth/me` answering `502`, which is neither `200` nor `401` — three answers, not two |
    | 3 | **Response statuses were matched by URL.** Three PUTs go to the same path in one cell, so statuses landed on whichever entry was unfilled — dressing three FAILED offline PUTs as `200`s | matching by **request identity** instead; the same run then read `None, None, None` |
    | 4 | **The server was read while work was still queued** — which measures the clock, not the product | waiting for the outbox to empty, and reporting **STILL QUEUED** rather than calling late words lost |
    | 5 | **The drain runs where the Notebook is mounted.** After the door fired on `/charts` the entry sat queued 60 s | the same wait, which showed the queue never moving on a route with nothing to drive it |
    | 6 | **The rig's own litter stalled the queue head.** Each cell deletes its note; the outbox entry survives, and a queued write to a deleted note blocks an ordered queue | a purge of entries whose note is `404` — **and only those**, because an entry for a live note is a member's unsent words |
    | 7 | **The race guard fired on the HEALTHY case.** It counted every PUT issued before the door, including the three that failed *because we were offline* — the normal shape of every cell | the metadata control going INCONCLUSIVE while its own wire showed the product working perfectly |

    ⭐ **AND AN EIGHTH, IN THE RESTORE ITSELF.** The opt-out restore ran in the
    outer `finally`, **after** the Playwright context had closed, so every call
    hit a closed event loop and returned `ERR: Error`. *The restore whose entire
    job is to fail loudly was itself failing* — caught only because it printed
    its own alarm. It runs in-session now, and the outer `finally` proves it **on
    disk with Chrome dead** and retries once.

    ⛔ **THE SHAPE WORTH CARRYING:** an instrument fault does not announce itself
    as one. Every fault above produced a plausible, coherent, *product-shaped*
    story — "the member's words were lost", "the rig is signed out", "the words
    were sent and the server dropped them", "the drain never finishes". Faults 2
    and 3 even pointed the same direction at the same time, which is how a
    finding gets published. **A control is what separates them, and a control
    only works if it can distinguish** — each one above answers a question the
    verdict cannot answer by itself.

    ⭐ **RAILS:** the controls are in `tools/q1_f5_matrix.py` and run on every
    cell, not as tests beside it — a cell that cannot separate instrument from
    product returns **INCONCLUSIVE** and says which. `tests/test_q1_rig_window.py`
    rails the window rule, and `tests/test_window_check_auth.py` rails fault 2's
    twin in the canary, mutation-proved by restoring the `!= 200` guard.

22. ⛔⛔ **AN INSTRUMENT COUNTED ITSELF AS THE POPULATION IT WAS MEASURING — our
    own test account published as SEVEN INDEPENDENT MEMBERS.**

    2026-09-13. The sampler's 15:00 and 17:00 ET rows read `members 7`. All seven
    were the T-12 smoke account. The Sunday gate would have printed
    **`organic members exposed = 7`** into the artifact the K window is judged
    on — inverting the window's central claim on the one run of the week that
    decides keep-or-revert.

    **Two faults, and they compound:**

    | # | the fault |
    |---|---|
    | 1 | the exclusion list held `smoke@…` but **not** `member-smoke@…` — two different accounts, 30 and 37 characters, one excluded and one not |
    | 2 | the count was `indep.length` — **ROWS, not identities** — while the config-served column *immediately beside it* is explicitly *"BY IDENTITY, not by row: one member with six tabs is one member."* |

    ⭐ **THE SAME FILE HELD TWO NOTIONS OF "MEMBER" IN ADJACENT COLUMNS, and the
    looser one was the one that fed the verdict.** Neither column was wrong about
    what it computed; they simply disagreed about what the word means, and
    nothing made them answer to each other.

    ⭐ **HOW IT WAS PROVED, and the method is reusable:**
    `/api/auth/export-data` returns an account's **own** activity and is gated
    only by `get_current_user` — so the smoke identity could read its own rows
    **without the rig, without admin, and without waiting for a clear rig
    window**. Its log held exactly those seven `notebook_offline_opt_in` events,
    17:51:57 → 18:14:46 UTC, one for one with the seven T-12 runs.
    ⛔ `tools/q1_member_attribution.py` deliberately **does not open the
    Notebook**: doing so would emit another opt-in and inflate the very count
    under investigation — *an instrument that changes what it measures*.

    ⭐ **SEVEN OPT-INS FROM SEVEN FRESH BROWSER CONTEXTS IS EXPECTED, NOT A DEDUPE
    FAILURE.** The dedupe marker is per tab/context by design. The events were
    never wrong; calling them seven **members** was. Said in the log annotation
    so nobody reads 7 as *"dedupe broke"* and goes hunting.

    **The fix — three populations, by distinct identity, never summed:**
    **ORGANIC** (a person who is not us — the only number the wave's claims may
    be divided by) · **SYNTHETIC** (an account we provisioned — counted and
    **shown**, never excluded into invisibility) · **RIG/OWNER**. Matched by
    **full email**, never prefix or substring: a `startsWith('smoke')` test would
    have caught `member-smoke@` only by luck, and a substring test would swallow
    a real member whose address happened to contain one.

    ⛔ **An unknown address on `@uctintelligence.internal` is raised as an
    ANOMALY, never counted as organic.** That domain is reserved (RFC 8375) and
    unroutable, so nobody outside this programme can hold one — a new one is a
    synthetic account somebody provisioned without declaring it, and silence is
    how that arrives.

    ⛔ **The rows already written are corrected in place, not rewritten.** The
    NUMBER is preserved — seven events really were recorded — and only the LABEL
    is corrected, with every timestamp named and the correction attributed, in
    the same style as the hand-written 10:00 row. Rows predating the split are
    counted **separately** by the gate and named in the verdict.

    ⭐ **RAILS:** `tests/test_member_populations.py` — including the pair that
    matters, *a real organic member still reaches the verdict*. Narrowing what
    counts must not make a real member invisible; that is the same failure
    pointing the other way, and far worse.

23. ⛔ **THREE MORE FROM THE SAME DAY, each small, each the same shape: a reader
    that could not see evidence sitting next to it.**

    - **The gate printed `n/a` beside a GREEN canary.** Trigger 3 (*outbox stuck
      >5 min*) is the one trigger the sampler cannot fill — it runs opted out, so
      its outbox is structurally zero. The Sunday canary drives a real queue and
      had already reported `outbox 0`, 11/11 steps green, two hours before the
      verdict was written. The verdict said the evidence did not exist.
      ⭐ It now reads the canary's own stamp — and **refuses to overclaim in the
      line itself**: a canary run lasts minutes, so it evidences *that the queue
      settles*, not a five-minute observation. A stale canary (>30 h), a run that
      died before the settle step, and no canary at all are three different
      answers and none of them is a PASS.

    - **The C-4 sweep timed out inside the gate** at 180 s and printed *"DID NOT
      RUN … this is not a clean result"* — **a tooling failure wearing a
      verdict's clothes.** Measured rather than guessed: reading 4,711 files /
      60 MB costs **0.3 s**; matching 75 patterns costs **~66 s**, because a
      75-way regex alternation runs at a few MB/s. The timeout landed while
      another session's six-shard gate loaded the box. Budget is now 900 s —
      ~10× the measured cost — and the gate has no deadline of its own, so
      waiting is free while *being unable to say whether §8 is intact* is not.

    - ⚰️ **A hash mismatch that was only line endings.** `tools/nb_gate.py`
      differed between the repo and `origin/master` — 462 CRLF vs 0 — and was
      byte-identical once normalised. Recorded rather than waved through: **a
      hash mismatch is a finding until it is explained**, and "it's just CRLF" is
      a conclusion, not an observation.

    - ⚰️ **And the handoff contained the bug it was warning about.** The
      pre-restart resume doc's own step 3 called `resolve_profile(None)` without
      exporting `UCT_Q1_RIG_PROFILE`; run from a worktree whose `.worktrees/`
      does not exist, it reports `exists: False, value: None` — and **absence
      reads as OPTED IN**. A fresh session following the doc would have "fixed" a
      rig that was already correct. Caught by running my own instructions.
      ⭐ *Write the handoff, then follow it as if you had never seen it.*

24. ⛔⛔ **THE SECRET SCAN HAD NEVER RUN IN ANY WORKTREE, AND THE HOOK SAID SO
    EVERY TIME.** The pre-push hook printed *"tools/secret_scrub.py not found in
    this worktree — the secret scan did NOT run. This is not a pass."* That
    warning was correct for months. Its cause was a path: the fallback candidate
    was `$root/../uct-worktrees/breadth-charts/...` where `$root` is the
    **worktree** root, so from any worktree under `uct-worktrees/` it expanded to
    `uct-worktrees/uct-worktrees/...` — a doubled path that cannot exist. The
    scan was therefore skipped for **exactly the checkouts that lack the file**,
    which is every worktree.

    ⭐ **The warning branch is what made it survive.** It was written to be
    honest — "this is not a pass" — and being visible, it became furniture: a
    broken path read as a considered exemption. Fixed by deriving the primary
    checkout from `git rev-parse --git-common-dir` (the main `.git` from any
    worktree), so it survives a rename. Retrospective scan of the 131 commits
    pushed that day: **0 findings**.

    ⛔ **AND THE CONTROL WAS THE WRONG SHAPE, WHICH NEARLY PRODUCED A SECOND
    FINDING.** A planted `ghp_` token did **not** fire, and the scanner was one
    sentence away from being reported broken. It is not: it hunts three shapes on
    purpose — session cookie by name, cookie header, authorization header — a
    narrowing recorded in the file because an earlier draft returned 68 findings
    of which 1 was real, and a muted scanner reads as coverage. A control using
    an in-scope shape fires and exits 1. *The instrument was the first suspect
    and this time it was innocent.*

25. ⛔⛔ **THE REMOUNT DEFECT, AND THE RECOVERY BLIND SPOT SITTING BEHIND IT.**
    `settleLandedSave` asks `sameAuthoredContent(acked, current)` — the server's
    accepted copy against the editor's current copy. On a remount **both sides of
    that comparison are the server**, because the editor was just rebuilt from
    it. The answer is `true` for a reason that has nothing to do with the member,
    and what follows is one transaction that writes the record clean at the
    server's newer baseline and passes `intent = null`, which deletes every
    queued entry for the note.

    ⭐ **The blast radius is larger than "the drain deleted it", and the audit is
    what found it.** `recover()` admits only a DIRTY record, and `listOutbox` has
    exactly three non-test callers — the drain, the pending count, the blocked
    badge — **none of them a recovery surface**. So in the exact state this
    defect produces, the same cheap flag that authorises the discard also
    suppresses the offer-back. Verified independently, not taken on report.

    ⛔ Reproduced at unit level in `remountNeverDiscardsUnsent.test.js` (RED, with
    a control and a discriminator green) and the fix drafted, applied once to
    prove it turns that rail 3/3 green, then **restored and HELD** pending the
    production cell. ⭐ The same run established that the remount fix does **not**
    fix the supersede hazard — `supersedeProvesContent.test.js` stayed red
    through it. **Two independent defects, not one seen twice.**

26. ⚖️ **A RAIL CONTRADICTED THE RULING IT EXISTS TO SERVE.** `f5Freeze.test.js`
    armed on *"zero INCONCLUSIVE rows"*; the ruling lifts the freeze when every
    cell is *"green or named"* — and a **named rig limitation renders as
    `INCONCL`**. As written the rail would have refused to lift the freeze
    permanently, because the pdf.js caret limitation is not going to stop being
    true. Amended and recorded without asking, per the standing ruling.

    ⭐ The distinction the amendment turns on:
    INCONCLUSIVE-because-nobody-looked and
    INCONCLUSIVE-because-this-rig-cannot-look are different facts wearing one
    glyph. A cell counts as *named* only if a limitation is written down for it
    in `q1-product-followups.md`; an unexplained INCONCLUSIVE still blocks, which
    is what stops "named" becoming a way to wave the table through.

27. ⚰️ **"NOTHING WAS SENT FOR 120 s" WAS THE INSTRUMENT'S BUDGET, NOT THE
    PRODUCT'S BEHAVIOUR.** The drain wait is `for _ in range(48)` ×
    `wait_for_timeout(2500)` — **exactly 120 s**. So the number that looked like
    a measured ceiling is the moment the rig stopped watching, and nothing
    establishes what happens at 121 s. Recorded in `F5P-1` that way rather than
    as *"it never sends"*, which is the stronger claim the number cannot carry.
    ⭐ **A round number that equals your own timeout is a reading of your loop.**

28. ⛔⛔ **R-1a IS NOT A GAP. THE DOOR IS BUILT, MERGED TO MASTER, AND DARK** —
    and the row above still calls it 🔴 **gap**, which is this programme's single
    most-repeated defect (§10 items 1, 2 and the S-07 row are all the same shape:
    a doc asserting a hole the code had already filled).

    Measured by `git show`, never `git status`: `9666842d0` (*"Wave R: the
    Screener's capture door (R-1a) and send-a-chart-to-a-note (R-2e)"*, 741
    insertions) and `046214a82` (*"gate all four capture doors behind a release
    switch"*) are **both ancestors of `origin/master`**. The switch is
    `app/src/widgets/captureRelease.js:46` — `export const WAVE_R_CAPTURE_ON =
    false` — and the door ships with a 283-line rail,
    `ScannerResults.journalDoor.test.jsx`.

    ⭐ **So R-1a's remaining work is a FLAG FLIP AND ITS PRECONDITIONS, not a
    build.** It stays HELD — the ruling holds it until the navigation cells are
    green, and a `/screener` door is by construction the offline-route-change
    case that `append_widget_embed × drain-first` has RED — but it is held at a
    completely different point in its life than the row implies, and anyone
    planning from that row would have rebuilt a door that already exists.

    ⚰️ **AND MY OWN CHECK NEARLY REFUTED THE FINDING.** I grepped
    `ScannerResults.jsx` for `WAVE_R_CAPTURE_ON` and got **0 at every revision,
    including master** — because the constant lives in `captureRelease.js` and
    the door only imports `captureEnabled`. The zero was real and meaningless: I
    had grepped the CONSUMER for the PRODUCER'S NAME. Same shape as *read the
    call site ≠ read the request*. ⭐ The tell was that the zero was identical at
    five unrelated revisions — **a finding that does not vary across history is
    usually a question that does not touch it.**

    ⚠️ One thing still unsettled and NOT to be assumed: `wave-all-RESUME-HERE.md`
    places R-1a in a different worktree at `adbcbcdf8`. That commit exists and
    the door file exists there too. Whether that line describes this same code or
    a second implementation is **UNKNOWN** and must be settled before anything
    is merged toward it.

29. ⛔⛔ **A FIX THAT CHANGES TWO VARIABLES DESTROYS THE ISOLATION THE CELL EXISTS
    FOR.** Owner ruling, 2026-09-14 — recorded because the cheap fix and the
    correct fix pointed in opposite directions and the cheap one looked better.

    `second-writer-while-away` was written to the ruling's literal ordering —
    *return to N, then reconnect* — and the return died with
    `net::ERR_INTERNET_DISCONNECTED`, because `page.goto` is a **document load**
    and the context was still offline by design.

    ⭐ **The obvious repair was to make the return an SPA route change**, which
    works offline, is one line, and is *more like what a member does*. It would
    also have made the cell differ from its GREEN baseline in **two** ways at
    once — the second writer **and** the return mechanism — so a colour change
    could no longer have been attributed to either. The cell's entire value is
    that it differs from `navigate-no-door` in exactly one thing.

    The reconnect was moved to just after the second writer instead, leaving the
    cell byte-identical to the GREEN baseline plus one variable. **The deviation
    from the ruling's literal wording was recorded rather than done quietly**
    (`f5-second-writer-while-away.md`), because a silent deviation in an
    isolation experiment is indistinguishable from a mistake.

    ⛔ **The general form:** when an experiment breaks, the repair must be checked
    against the *comparison*, not just against the error. "Does this make it run?"
    and "does this keep it comparable?" are different questions, and only the
    second one protects the finding.

30. ⛔⛔ **AN AMENDMENT TO A SHARED RAIL IS INVISIBLE TO EVERY OTHER WORKTREE
    UNTIL IT MERGES — and it was reported here as though it were done.**

    The F5 freeze's arming condition was amended on 2026-09-13 from *"zero
    INCONCLUSIVE rows"* to *"every cell GREEN or NAMED"*, under the standing
    ruling that a rail contradicting a ruling is amended and recorded. That
    happened, `f5Freeze.test.js` went 6/6 green, and it was reported as settled.

    It is settled **on one branch.** Measured 2026-09-14:

    | where | `GREEN or NAMED` |
    |---|---|
    | `notebook-k` (`feat/notebook-kill-switch`) | **3** |
    | `notebook-q2a` (`feat/notebook-q2a-offline-read`) | **0** |
    | `origin/master` | **0** |

    ⭐ **It was caught by a subagent planning Q2-A in its own worktree**, which
    searched the repo for the amended wording, found nothing, and **struck the
    citation rather than softening it** — exactly the right call, and it was right
    about the tree it could see. Every other track is still planning against the
    un-amended condition.

    ⛔ **The general trap:** `f5Freeze.test.js` is a rail that *governs several
    workstreams*, so amending it in one feature branch changes the rule for
    nobody. The same is true of the settle, the drain, and the do-not-build
    sweep. **A shared rail's amendment is not in force until it is on master**,
    and until then the honest report is *"amended on branch X, not yet in force"*.

    ⚠️ This is the same shape as the deployed-copy drift that keeps
    `C:\Users\Patrick\uct-q1-observe\` out of step with `tools/` — one artifact,
    two copies, and the one that matters is not the one being edited. The fix
    there was to write both and verify the hashes match; the fix here is to say
    which branch a rule is live on, every time.

31. ⛔⛔ **"198 OF 200 DEPLOYMENTS ARE `REMOVED`" WAS NOT EVIDENCE OF ANYTHING, AND
    I REPORTED IT AS THE HEADLINE.** Only one deployment can be current, so every
    older one is `REMOVED` **by construction**. A ratio that is forced by the
    data model is not a measurement. ⭐ *A count that could not have come out any
    other way is not a finding.*

    **The real signal is the GAP, and it was measured properly afterwards** over
    200 deployments spanning 2026-09-12 14:58Z → 2026-09-14 04:49Z:

    | | deploys | median gap | started <5 min after the previous |
    |---|---|---|---|
    | before `4fb4f9daf` | 162 | 5.1 min | 78/161 (48%) |
    | after `4fb4f9daf` | 38 | **3.6 min** | **26/37 (70%)** |

    ⛔ **AND THE SECOND CONCLUSION WAS WRONG TOO.** That looks like the guard
    failing — until you read the guard. `tools/pre_push_guard.py` (on master since
    `4fb4f9daf`, 2026-09-13 17:27 CT) sets **`MIN_SETTLE_SECONDS = 150`**, so a
    push 2.5 minutes after the previous deployment reached `SUCCESS` is
    **permitted**. A 3.6-minute median is the guard working as designed, not
    being bypassed. `core.hooksPath` is set to the real hooks directory, so the
    hook is reached; the bypass is a logged env var, not `--no-verify`.

    ⭐ **So the honest problem statement is different, and more useful than the one
    I gave.** Nobody is breaking the rule. **Five workstreams each pushing under a
    rule that permits a 2.5-minute cadence means production swaps almost
    continuously** — and a rig measurement that takes two minutes has a real
    chance of landing inside a swap. That is what cost the embed cell its first
    attempt (`HTTP 502`, *"could not create the probe note"*), not somebody
    violating the merge queue.

    ⛔ **The fix therefore belongs in the instrument, not in the rule.** A cell
    that meets a 502 measured nothing and must be re-run, never banked — which is
    exactly the runner defect fixed the same night (exit 0 with an INCONCLUSIVE
    verdict was being recorded as `done`).

    ✅ **UPDATE, same night — IT HAS NOW BEEN WATCHED, IN BOTH DIRECTIONS**, by
    an ordinary push rather than a contrived test. Pushing this programme's
    tooling merge to master:

    ```
    [pre-push] the newest web deployment is DEPLOYING (2d7ae7795 …) — a swap is in
               flight; pushing now marks it REMOVED mid-swap and members get a 502.
    [pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.
    ```

    and four minutes later, unchanged and unforced:

    ```
    [pre-push] web is SUCCESS on 2d7ae7795, 167s settled — safe to push.
    ```

    ⭐ **So the guard bites, and its settle window is real** — 167 s against a
    150 s floor. The override was **not** used. This also settles the question
    §10.31 opened: the mechanism is not being bypassed, and the tight cadence is
    the permitted one.

    ⚠️ Still genuinely missing: `pre_push_guard.py` has no `--self-check`, so its
    refusal has been *observed* but never *proved on demand* — an observation is
    not a rail, and the next person to change it has nothing to run. And its
    bypass log is `logs/pre-push-guard-bypass.log`, not the `uct-q1-observe`
    location an owner ruling asked for.

32. ⛔⛔ **A SUBAGENT'S REPLY ABOUT ITS WORK IS NOT THE WORK — and I briefed a
    second agent from the reply.**

    A subagent that wrote the Q2-A plan volunteered, in its **reply**, that one
    design decision was *"most likely to be wrong"* and that it had kept a weaker
    option for a speculative reason. That was a good, honest self-assessment. It
    was **not in the document**.

    When the owner ruled on that hazard, I briefed the next agent to *"update the
    plan so it no longer presents the weaker option as the chosen design"* — a
    change to text that did not exist. Measured: `grep -in
    "discipline rule|probably wrong|weaker"` over the committed plan returns
    **0**, and §3 already called the rule *"absolute"*.

    ⭐ **The agent refused to invent the reversal.** It recorded the ruling as
    *promoting* the rule, marked the draft I described as UNKNOWN, and said so in
    its reply. Had it complied, the plan would have carried a struck-through
    "earlier choice" that was never made, and the next reader would have believed
    a decision had been reversed.

    ⛔ **The rule:** a reply is testimony about an artifact; the artifact is the
    artifact. Quote the file before briefing anyone from it — including yourself.
    Same family as *read the call site ≠ read the request* and *a comment claiming
    agreement is not agreement*, with a new vector: **the claim came from a
    conversation, and conversations are not greppable by the next reader.**

    ⚠️ The same agent also cut a sentence I had supplied — *"that state is where
    this programme has already been bitten"* — as unestablished, and grounded the
    weaker true version instead (`landedBaseline` returns null for a dirty record,
    so the drain's supersede branch is reachable **only** in the clean state).
    Two refusals, both correct, both against the brief.

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
| C-4 | ✅ **TRUE** — §8 **DO-NOT-BUILD is untouched** | `tools/q1_do_not_build_sweep.py`, built 2026-09-13 by owner ruling and run in **every gate** from now on (wired into `scripts/gate_shards.py` and `tools/nb_gate.py`). ⭐ The roster is **parsed out of §8 at run time** — an item added tomorrow with no probe fails the sweep BY NAME, because *"I do not know how to check this one"* must never read as *"this one is clean"*. ⛔ This row used to say **22** items; the sweep reads **20** and no count is typed anywhere now — the list is the authority. Result: **0 matches** across `app/src`, `api`, `scripts`, `tools`. One legitimate match is exempted WITH its argument: `main.jsx:26` registers `/sw.js` only for a browser that already has a worker, which is what makes *"there is no service worker"* true |
| C-5 | §9 **OPEN** rows are each resolved **or** deferred with an owner ruling | no row left silently open |
| C-6 | ✅ **TRUE** — §6 **Wave T** rows each carry an owner answer | `wave-T-decisions.md`, one line each, **RATIFIED by the owner 2026-09-13**: *"nothing in T waits on me except flips"*. ⭐ The answers were recorded 2026-09-12; what closed C-6 was the ratification, because until then the file read as proposals a reader could not distinguish from decisions |
| C-7 | ⏳ **FALSE — 7 of 9 steps PASS** — T-12 pre-launch smoke passes | ⚖️ **No longer owner-bound**: the charter was amended by the owner 2026-09-13 (§7) so automation executes and the owner reviews the evidence. **Run and recorded**: `docs/notebook/t12-smoke-2026-09-13.md`, `member-smoke@uctintelligence.internal` in a fresh context, steps **0–6 PASS** (sign in through the real form · reach the Notebook by CLICKING · create a note · type → reload → **the sentence survived** · widget embed lands and survives a reload · search finds it and `zzqqxx` gives an honest empty state · a real PDF opens a page-rendered viewer). **BLOCKER:** steps 7 (Ask + citation) and 8 (trash/restore) are **INCONCLUSIVE with named runner limitations**, and the `owner-rig` identity run has not happened. Seven of nine is not a gate that passed. ⛔ One unexplained PRODUCT finding lives in that run: the member's first action returned `POST /api/j2/notes` **500 twice**, showing *"Couldn't create that note. Nothing was saved."*, with no deploy in flight | it is the gate that outranks every row (§6). ⛔ **It cannot be agent-run, by its own charter:** *"Who runs it: the owner, on his own device, signed in as himself. This is not automation. Nothing in this repo runs it, and no agent may run it or fill in its results."* That is a direct conflict with the 2026-09-13 queue item *"run it today"*, raised rather than resolved either way. ⭐ **What was done instead, 2026-09-13:** its preconditions were corrected — prohibition 4 claimed `OFFLINE_DEFAULT_ON` is *false for every member* and the flip *blocked behind an open defect*, both false since 2026-09-12 00:45 ET, which would have had the owner smoking a path no member is on; and production was verified current (`/api/health` 200, `uptime_seconds` 113 on a fresh boot, no deploy in flight) so the run is not invalidated by a swap |
| C-8 | ⏳ **FALSE — the window is still open** — Q1's 7-day window closed **KEEP** | `wave-q1-gate-verdict.md`. ⭐ **2026-09-13 18:05 ET read KEEP** — all four triggers PASS, `do-not-build` CLEAN, **organic 0 · synthetic 1 · rig/owner 1**. **BLOCKER:** the window runs to **2026-09-19 00:45 ET**; one clean reading inside it is not the window closing. ⛔ And a KEEP over **zero organic members** is what clean looks like over an EMPTY SET — if the window closes this way, K-1's precondition is *100% of a synthetic population* and its packet must say so |
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
| ~~**K**~~ ✅ **CLOSED 2026-09-12** | runtime kill switch — ⚰️ *"server-served config"* became **the auth payload**, no new endpoint; every other track's flag rides on it | `53a181082`, live **dark** | — · packet `kill-switch-flip-packet.md` · K-1 queued behind a measured precondition |
| **F5 drivers** | the three append-family production drivers (widget embed chooser · TickerPopup financial fact · PDF excerpt selection) — **NEXT**, picked 2026-09-13 | now | — |
| **R** | the charter's four MUST items: R-1a scanner/screener capture door · R-3b index widget · R-3c market-context widget · R-4a image paste/drop **with coverage** | now | — |
| **S** | the 16 measured debt rows, **claims-measured-FALSE first** (S-07), then S-03, S-04, S-06, S-08, S-16, rest | now | file overlap with R |
| **Q2-A** | offline read cache | now | must not touch the save path or R's files |
| **Q2-B/C/D** | conflict UX · attachment pinning · mobile shell | **when R has merged dark and passed its post-merge Q1 canary** | R |
| **T** | decision-blocked | ⛔ **do not build** — `wave-T-decisions.md`, owner answers in one pass | owner |

⭐ **TRACK ORDER AFTER K — F5 first, and the reason is one line:** F5 gates R-1a,
R-3b and R-3c, so every hour it stays open is an hour three charter MUST rows
cannot start; S, Q2-A and R-4a each unblock only themselves.

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
