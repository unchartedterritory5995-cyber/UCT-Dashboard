# NOTEBOOK PROGRAM MANIFEST

**Built 2026-09-11 for the Notebook Completion Charter. This file is the contract.**
Every later report references rows by id.

---

## ⛔⛔ HOW TO READ THIS FILE — the three rules it was built under

1. **Status is verified against the CODE, not against the doc's claim.** A doc saying
   a thing shipped is a claim; this manifest records what a measurement found. Rows
   whose status I measured are marked **`[m]`**. Rows carrying a doc's claim that I
   did **not** independently measure are marked **`[d]`** — treat those as unverified.
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
| Q1-07 | Offline save-status vocabulary ("on this device" ≠ "synced") | `[d]` built | wave-q0 §18 |
| Q1-08 | Debounced (not per-keystroke) durable write | `[m]` **built** | wave-q0 Gate 3 |
| Q1-09 | `onversionchange` handler from day one | `[d]` built | wave-q0 Gate 3 |
| Q1-10 | In-flight marker + landed-revision ring + 409 self-supersede | `[m]` **built, INSUFFICIENT** | round 1–3 |
| **Q1-11** | **THE OPEN DEFECT — queued entry reaches the server as a discard via the `folder` door** | `[m]` 🔴 **OPEN** | RESUME §"SELF-FORK, ROUND 3" |
| **Q1-12** | **The rail must drive the doors through the editor's REAL save path** | `[m]` 🔴 **OPEN** | RESUME §A |
| **Q1-13** | **Single-writer design decision — answered by measurement, then logged** | 🔴 **OPEN** | RESUME §B |
| Q1-14 | Logout-with-unsynced-work flow + "Download a copy" escape hatch | **not built** | wave-q0 §9 |
| Q1-15 | Offline session soft TTL; never drain into a new session | `[d]` partial | wave-q0 §10 |
| Q1-16 | Local purge on revocation, driven by the auth answer | `[d]` partial | wave-q0 §11 |
| Q1-17 | Disabled-with-reason offline controls | **not built** | wave-q0 §18 |
| **Q1-18** | **The flip — `OFFLINE_DEFAULT_ON` true for members** | `[m]` **false everywhere** | charter |

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

| id | feature | status |
|---|---|---|
| R-1a | **Scanner/Screener capture door** — has an embed renderer and embed params, no door | 🔴 **gap** |
| R-1b | 8 image-only widgets (notebook, profile, optionsflow, periodsort, nhnl, nhnlPulse, volumescan, scatter) have embed params but no renderer/door | 🟡 by design (`reconstructable: false`) — confirm the verdict, don't assume it |
| R-1c | Only `chart` has `menus.journal: true` | 🟡 **deliberate**, documented in `registry.js:36-43` — not a gap |

⛔ R-1a is the one that matters: the Screener is used as the flagship
trading-journal-moat example in the master architecture doc, and its door does not
exist. *"wire this door explicitly, don't assume it exists."*

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

| id | feature | status |
|---|---|---|
| R-3a | Breadth as a journal widget | `[m]` **built** (`BreadthEmbed` + frozen row) |
| R-3b | **Index / indices widget** | 🔴 **does not exist** — no index id in the registry's 18 |
| R-3c | **Market-context as a journal widget** | 🔴 **does not exist** — only a trade-row `contextAtEntry` snapshot |

⛔ R-3b and R-3c are **genuinely new build**, and they are the only rows in the entire
charter that are. Note the precedent that governs them: breadth's registry entry
records that *"A mid-session capture shows the LIVE intraday row, which the system
DISCARDS at the 4:15 collector — no endpoint can serve it back. The frozen row is the
only honest record of what the user saw."* An index or market-context widget inherits
that problem and must freeze, not promise to re-fetch.

### R-4 · Fast capture of a screenshot or arbitrary data into a note

| id | feature | status |
|---|---|---|
| R-4a | Image drag-drop + clipboard paste into the body | `[d]` built |
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
| S-02 | Shared skeleton/loading component | `[d]` open | UX ledger #8 |
| S-03 | Zero-result search next-step guidance | `[d]` open | UX ledger #6 |
| S-04 | In-note keyboard shortcuts (save / close / next-prev) | `[d]` open | UX ledger #12a |
| S-05 | Large-note performance at 10k+ words | `[d]` open, untested at scale | G-035 |
| S-06 | Email-to-note | `[m]` **absent** — *"real and cheap… the destination already exists"* | P1 §Evernote |
| S-07 | Templates: fundamental-research + data-aware prefill lineup | `[d]` partial (8 trading-ritual templates ship) | templates plan |
| S-08 | Recurrence / repeating reviews | `[d]` open | wave-o cert §A |
| S-09 | In-place stance toggle (currently remove-then-add) | `[d]` open | wave-n residual 4 |
| S-10 | Picker cap honest total ("50 of 137") | `[d]` open — endpoint exposes no total | wave-n residual 5 |
| S-11 | `j2_verdicts` cited as a thesis-changelog source | `[d]` open | G-073b |
| S-12 | PDF pinch-zoom / zoom control | `[d]` open debt | G-120 residual |
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

---

## 7. CONTRADICTIONS RESOLVED — later-wins, and where CODE overrules both docs

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

## 8. DO-NOT-BUILD — recorded so nobody rebuilds them

General web clipper (narrow bookmarklet carve-out only) · third-party plugin
marketplace · enterprise collaboration depth · one-click full-migration rollback ·
Notion-style external Agents platform · a new Trading Journal object model inside
Notebook · a second AI chat surface · a new `j2_theses` table · citation-level inline
markup in note bodies · full multi-hop knowledge graph · foreign listings / options
symbols / private companies as linkable entities · client-side E2E encryption ·
two-way connector sync · deep links back to source items · auto-merge of conflicts ·
offline destructive actions · offline Ask · browser-side OCR · presenting a partial
local corpus as "My Notebook" · **a service worker**.

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

### Rows added by §10

| id | feature | status |
|---|---|---|
| S-15 | Tasks / reminders, financial-native (review thesis before earnings, revisit in N days) | 🔴 never built · **SPEC-THIN** — named 3×, specified 0× |
| S-16 | Note-version retention / pruning policy | 🔴 unowned — nothing prunes `j2_note_versions` today |
