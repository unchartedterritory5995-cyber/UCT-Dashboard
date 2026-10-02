# Internal UCT capture expansion (G-040)

**Status: BUILT 2026-10-01 (wave 10, lane CX), as scoped by the rulings below — three
doors: Screener, COT Data, Model Book. Options Flow stays DECLINED.**
⚰️ was: *"NOT SCHEDULED. Do not implement from this document."* — created 2026-09-08 by
owner ruling, descoping these surfaces from Wave L. The owner delegated the per-surface
decisions to the controller; the rulings that unblocked the build are recorded verbatim
in the next section.

| Surface | Commit | Registry id | Kind |
|---|---|---|---|
| Screener | `5cbda9dab59cf6982438c31935cec3de7cd4121e` | `screener` | frozen snapshot |
| COT Data | `54bb717e40cde76660e26b98d11ca5ea0a14e508` | `cot` | frozen snapshot |
| Model Book | `15851a105660fe7ac415a06e1881354806becaba` | `modelbook` | reference + tombstone |
| Options Flow | — | `optionsflow` (unchanged) | DECLINED |

Branch `feat/notebook-w10-cx`, base master `a7878c586`.

## The rulings (controller, owner-delegated, 2026-10-01) — verbatim

1. SCREENER: a capture is a FROZEN SNAPSHOT of the result set as the member saw it: the scan's name and its criteria (the definition as text), the "as of" timestamp of the data, the columns shown, and up to the first 50 rows (ticker plus the visible columns' values), plus the total match count. It never re-runs on open. The embed shows the frozen table with "As of <date time ET>" and a "Run this scan now" link that opens the Screener with that definition (a new run, clearly labelled as such). If the scan returned zero rows or could not compute some symbols, the capture carries that honestly, using the same coverage wording the Screener shows (CoverageLine: evaluated / answered / dropped / not computable).
2. COT DATA: a capture is a FROZEN SNAPSHOT of one market's positioning at one report week: the symbol and market name, the report date, the date it was captured, and for commercials, large specs and small specs the net position, the week-over-week change and the 3-year COT Index, plus open interest and the rail's contrarian-bias and crowding verdicts as shown. It never re-fetches: CFTC revises data, and the note must keep what the member saw. The embed shows "Report week <date>, captured <date>" and a "Current COT for <symbol>" link.
3. MODEL BOOK: a capture is a REFERENCE to the canonical stock (year + symbol) and, if one is selected, the setup, plus an optional member annotation typed at capture time. It re-renders from the Model Book store (curated, static data). If the referenced stock or setup no longer exists, it shows a plain "This Model Book entry was removed" tombstone with the captured title, never an error.
4. OPTIONS FLOW stays DECLINED (partner-owned; "flow at a past instant is not replayable"). Do not touch OptionsFlow.jsx or any partner file.

## What was built — one contract per definition

An internal capture stores `widgetId` + `params` and re-renders through
`WIDGET_REGISTRY` (`app/src/widgets/registry.js`). None of these three surfaces had an
entry, so each got one. ⭐ **They are CAPTURE-ONLY** (`captureOnly: true`): a Notebook
capture kind with no `/charts` widget behind it. Every menu flag is false,
`registerPanel` refuses one that any menu offers, `WidgetHost` binds none of them and the
panel set (`surfaces/panelSet.js`) excludes them — all railed in `registry.test.js` /
`panelSet.test.js`. Their only host is the Notebook's `EMBED_COMPONENTS`.

| | Screener (`screener`) | COT (`cot`) | Model Book (`modelbook`) |
|---|---|---|---|
| **Params** | `name`, `criteria` [text], `spec` (the definition), `asOf`, `columns` [{key,label}], `rows` [{ticker, cells}] ≤ `SCREENER_CAPTURE_ROW_CAP` (50), `total`, `coverage` [{label, coverage}] | `market`, `marketName`, `reportDate`, `groups` {commercials, largeSpecs, smallSpecs: {net, wow, index}}, `openInterest` {value, wow, index}, `bias`, `crowding` | `year`, `symbol`, `setupId`, `setupType`, `setupDate`, `title`, `annotation` |
| **Validation** | `name`/`asOf`/`columns`/`rows`/`total` required; renders only when rows ≤ 50, columns non-empty, total a finite number ≥ 0 — zero rows included | `market`/`reportDate`/`groups` required; renders only with a `YYYY-MM-DD` report date and all three groups (`COT_CAPTURE_GROUPS`, pinned equal to the rail's `GROUPS`) | `year` (integer) + `symbol` required; the setup is optional |
| **Provenance** | the Screener page's results table: rows in display order, each visible column's text exactly as painted (live price/change included), the seal's as-of, the scan-filter coverage receipts | the positioning rail's own `composeWeek` output for the week on screen (latest or scrubbed) | the Model Book store (`/api/modelbook/stocks?year=` → `/api/modelbook/stock/{id}`) |
| **Freeze policy** | FROZEN at insert; the embed makes no request. "Run this scan now" opens `/screener?s=<spec>` — a NEW run, labelled so | FROZEN at insert; the embed makes no request. "Current COT for <market>" opens `/breadth?tab=cot&cot=<market>` — the latest report, labelled so | REFERENCE: re-rendered from the store on open; a removed stock or setup is the tombstone with the captured title; a store that could not be READ says so and is never shown as removed |
| **Search line** (`plainText` → `searchText` → `body_plain`) | `[screener: <name> — <total> matches · <every captured ticker> — as of <asOf>]` | `[cot: <market> <name> — report week <date> · <bias> · <crowding>]` | `[model book: <SYMBOL> <year> — <setup> <date> — <annotation>]` |
| **Embed** | `ScreenerEmbed.jsx`: name, total, "As of … · captured <date time ET>", criteria chips, `CoverageLine` per receipt, the frozen table, "first N of M", the run link | `CotEmbed.jsx`: "Report week <date>, captured <date>", the two verdict tiles, Net / WoW / 3Y index per group + open interest, the current-COT link | `ModelBookEmbed.jsx`: stock + the referenced setup (or the thesis), the member's annotation; tombstone / unreachable states |
| **Control** | `ScannerShell.jsx`, toolbar save slot | `PositioningRail.jsx`, rail head | `ModelBook.jsx`, stock header (every user) |

⛔ The COT capture stores `market`, never `symbol`: `notes._sync_note_sidecars` files any
`params.symbol` into `j2_note_embeds` as a ticker, and `ES` is also Eversource. The Model
Book capture DOES use `symbol` — it is a real equity, and the sidecar linking the note to
it is correct.

## The shared mechanics

- **One control.** `app/src/pages/journal-2-0/components/SaveToNotebookButton.jsx` — a
  real `<button type="button">` with an accessible name, the shared `JournalToast`, and
  (Model Book only) an annotation box that opens before anything is sent. The capture is
  built ON PRESS, once.
- **No new write path.** The control calls `sendCaptureToJournal`, so every door inherits
  the unsent-work door guard, the current-note → inbox route, the `append_widget_embed`
  call site `lib/offline/f5Freeze.test.js` freezes (unmoved), and its `settleNoteWrite`.
  `lib/offline/doorFamilies.settle.test.jsx` drives each of the three doors BY NAME and
  asserts the revision lands (and that a refused append lands nothing).
  `doorEnumeration.test.js` needed no entry: no new client write to a note route exists.
- **Locked notes (ruling 149).** A 423 from the embed door gives the doors' own message —
  *"“<note>” is locked — <label> captured to your inbox until you unlock it"* — and the
  frozen capture waits in the inbox. Asserted per definition.
- **Tenant and lifecycle.** The captured payload (or reference) lives in the member's own
  note body (and, before placement, their own inbox row) — user-scoped server-side like
  every embed. Account deletion purges the notes and inbox rows, and the capture with
  them; nothing is stored anywhere else. The Model Book store is firm-curated, read-only
  to members, and a capture never writes to it.
- **Backend.** No API was added or changed: `append_widget_embed` and `create_capture`
  accept any `widgetId`, and the inbox's 256 KB ceiling comfortably holds a 50-row screen.

## Rails and proofs

Unit/DOM tests (vitest, by file): `widgets/registry.test.js` (pins + the three
definitions' validation), `surfaces/panelSet.test.js`,
`components/notebook/{Screener,Cot,ModelBook}Embed.test.jsx` (frozen render against a
DIFFERENT live answer, tombstone, search line, locked refusal),
`pages/screener/shell/{notebookCapture.test.js, ScannerShell.notebookDoor.test.jsx}`,
`pages/cot/PositioningRail.notebookDoor.test.jsx`, `pages/CotData.notebookLink.test.jsx`,
`pages/ModelBook.notebookDoor.test.jsx`, `lib/offline/doorFamilies.settle.test.jsx`, and
the a11y rails (`parts.a11y.test.jsx` recipes `embed-screener` / `embed-cot` /
`embed-model-book`, `surfaceCoverage`, `ariaCoverage`, `notebookContrast`).

**"Never re-fetches", mutation-proved.** Each embed was mutated to fetch live data and
render it; the frozen-render test went RED (`1 failed | 4 passed`) for both the Screener
and the COT embed, and GREEN again (`5 passed`) after the captured bytes were written
back (sha-verified).

## Open, for a further ruling

- **Release gating.** The three doors ship ungated (like G-062's consensus door). If they
  should go dark behind a switch first, that is a decision, not a build.
- **The Screener's name.** `ScannerShell` cannot see which preset or saved screen was
  applied (`ScreensManager` keeps it private), so a capture is named by its pool
  (`Screener — UCT Universe`) and its chips carry the definition. Carrying the applied
  screen's own name needs a seam in another workstream's file.
- **Doors not built.** The My-scans definition detail (`ScanResults`), the Model Book
  Setup Library's charted examples and the Bottoms view have no door — outside the
  rulings' scope.

## History — why this was not "four missing buttons" (2026-09-08)

G-040 read as *"Save-to-Notebook is not reachable from Screener, Options Flow, COT Data,
Model Book"*. Wave L went to wire them and found that a surface can only be a capture
door if it **has a registry entry**. Measured 2026-09-08:

| Surface | Registry entry | Real blocker |
|---|---|---|
| Screener | **none** | needs a new widget definition |
| COT Data | **none** | needs a new widget definition |
| Model Book | **none** | needs a new widget definition |
| Options Flow | exists | `reconstructable: false`, `menus.journal: false` — a deliberate decline |

Per surface a new definition costs: params schema · provenance · rights policy ·
freeze-vs-reconstruct policy · plain-text/search representation · embed renderer ·
tenant + lifecycle behaviour · menu/placement policy · certification. The open questions
then were *what is captured* (Screener: a row, the set, the definition, the values?),
*what is authoritative* (COT: the report week or the publication vintage?) and *what
capture means for a curated example* (Model Book: duplicate, reference, freeze, or
annotate?). Rulings 1–3 above answer them.

⛔ **The standard still holds: coverage is not automatically a virtue.** A saved artifact
that misrepresents what it froze — an "as of" that quietly re-fetches, a row that no
longer means what the member saw — is worse than no door at all. That is why the two
snapshot embeds make no request and the property is mutation-proved, and why Options
Flow stays declined.

## Not to be confused with

Wave L's **external web capture** (`capture.js` → `/api/j2/capture`) and
**member-authored thoughts** (canonical Notebook write path). Those are different
semantic kinds with their own write paths; see the Wave L entry checkpoint. This
document is only about the INTERNAL UCT artifact kind.
