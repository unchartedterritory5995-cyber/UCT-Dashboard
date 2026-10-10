# Notebook verification, 2026-10-09

The owner asked, after meaning search and voice notes were armed: is everything tested, and
what is left? This records what was then run, on the live site and in a local sandbox, and what
it found. Raw evidence was committed before each summary.

## 1. Live site (production, smoke account)

Tool: `tools/notebook_prod_verify_live.py`. Evidence: `docs/notebook/evidence/verify-1009/live/`.
Every note the run created was removed through the product's own delete and checked gone (404);
the smoke account ended with 0 active notes.

| check | 1280 | 390 |
|---|---|---|
| Long-note Ask (the PLTR question that spans the whole note; fin-walk 8.2, K1) | PASS: 26.35, 24.85, both risks, the final rule, cited, the citation opens the note | PASS, same |
| Meaning search: the PRODUCTION sweep indexed the new notes (314 s after creation); a phrase sharing no word with the note finds it by meaning; plain search finds nothing | PASS, row labelled "Related by meaning" | PASS, same |
| Voice note: upload a recording, transcribe (5.7 s), AI-labelled summary, NVDA and TSLA, the action item, transcript in the saved note | PASS | the sheet opens; every button at least 44 x 44 (`voice-dialog-390-targets.json`) |

Two things to know about the run:

- Attempt 1 hit a 502 four seconds in, during another workstream's deploy swap, and stopped
  before any check. Its three notes were removed by hand (404 each); its log is kept under
  `attempt1-502/`. The tool now retries a 5xx on create and delete.
- The first 390 voice reading was an instrument miss: the walker waited for Transcribe, which
  renders only after a file is chosen. The sheet's buttons were measured separately and the
  walker now measures them itself.

## 2. Local sandbox (items the fin-walk never walked)

Full record: `docs/notebook/verify-1009-sandbox.md`. Evidence: `docs/notebook/evidence/verify-1009/sbx/`.
Every boot read `SANDBOX INTEGRITY: CLEAN` at all four checkpoints; no key appears in the evidence.

| item | result |
|---|---|
| Confirm buttons on top at their centre and the action completes (bulk trash, folder delete, saved-view delete x3, version restore, gallery unpublish), 1280 and 390 | PASS; no floating button covers any of them. Saved-view delete beside an open note does not exist at 390 (the folders panel is hidden there) |
| Sample chart plan: role buttons and Arm alert | PASS; the alert is stored and the panel says so |
| Published page, signed out: bold, italic, heading, list, link, table, task list | PASS, all seven survive |
| Thesis chip sheet on a phone | PASS |
| Ask from a Word file's own preview sheet | PASS, cited to the file |
| Long-note Ask in the browser, twice at each width | PASS |
| Chart block drag | see P2 below |

**Product bugs found, both now fixed:**

- **P1.** Trashing a member's last notes started the first-run tour, which opened over the
  "Moved N notes to the Trash" notice and covered its Undo. Fixed in `27d6289b75`: a member who
  had notes earlier in the visit is not new. Mutation-proved test.
- **P2.** Dragging a block by its grip ("Move this block") failed for any block, not only charts,
  unless the first motion was slow: the grip re-aimed at the block under the pointer, or hid itself,
  before the browser started the drag. A tall chart scrolled up also put the grip off screen.
  Fixed in `1958b48cc8`: a press freezes the grip, and the grip stays in the visible part of the
  block. Re-walked: 6 of 6 grip drags move their block (2 of 6 before). Seven mutation proofs.

Still for a person: a plain mouse drag on the chart's BODY (not its grip) did not move it in the
harness, while Playwright's drag API did. That is ProseMirror's own node drag; one check by hand.

## 3. Full test run on today's master plus these fixes

Six shards, `docs/notebook/gate-runs/verify-1009/2026-10-09T18-52-51.md`: 3,152 test files, 12
tests failed, file count reconciles. **The same 12 fail on clean master** (`c3e95cb643`, run in a
separate worktree): none is caused by this work. Two of them were Notebook's and are now handled:

- `NotebookTour.stage.test.jsx`: red since `2c902624e4` (bisected). One test's save leaked into the
  next test's fake server through the new per-key save queue. Fixed in the test (`27d6289b75`).
- `NotebookTab.publishFolder.test.jsx`: red since F3 (#300). The test expected focus on the
  folder's action button; F3 deliberately moves it to the folder row. Test updated (`0c24343596`).
- `iteratorGlobalFloor.test.js` fails only when `app/dist` is not built; with a build it passes 9/9.

The other nine belong to other workstreams (chart engine, screener reachability, polling,
persistence, formatter and fetch censuses, the symbol-link rail). The Python gate rails: 291
passed; the one failure (`test_gate_shards` read-set coverage) fails the same way on master.

After merging the 8 commits master gained during the run (chart agent only, no shared files), the
changed areas were re-run on the final tree: 55 files, 687 tests, all passed.

## 4. The red-rail and error sweep (branch `notebook-rails-1009`)

The owner asked for the remaining failures and any other errors to be fixed too. Every item was
reproduced on master first, fixed at its source where the source could be changed safely, and
tested both ways (the new test fails on the old code).

| item | what was wrong | fix |
|---|---|---|
| `entryExcludesChartEngine` | chart-engine modules on every first load and the Notebook route, via `usePreferences → instanceShape → engine/legacyCotGroups` and `SymbolSearch → useMarketIndicators → engine/ohlcCapability` | the three pure COT helpers move out of `engine/`; the registry half of `useMarketIndicators` becomes `hooks/marketIndicatorRegistry.js` (re-exported, no import changed) — `7954f4b9da` |
| `reachable.test` | the Wave 2 renderer-primitives parking note lapsed 10-06 | renewed once, short (10-23); the wire/delete call is the Pine owner's and `zorder.js` is still being edited on `pine/s1-strategy-broker` |
| swallowed-fetch census | three new `.catch(() => null)` | a redundant catch removed, an explicit `alertBookFresh` flag, a throwing admin fetcher |
| formatter census | `stock.js` hand-rolled `$1.23B` | `formatCompact` on the terminal ladder |
| symbol-link rail | DarkPool `?ticker=` and the market-cap harness | recorded as separate doors, with reasons |
| persistence manifest | 14 undeclared keys | declared and named for members; the agent watchlist undo's server calls marked not-web-storage |
| suite coverage | `chart/builder/authoring` unacknowledged | acknowledged after a green run (147 tests) |
| `GATE_READ_PATHS` | nine read paths missing | added |
| test discovery | three scripts outside testpaths (two are this program's rollback evidence) | recorded as not-a-suite |
| page views (prod) | ISO cutoff vs SQLite's space-separated stamp: the 60 s dedup never fired and admin "active now" was always empty | cutoff in the stored form — `1710b51539` |
| briefing (verify-1009 finding) | "Two asks for next week" then one read (300-char clip) | focus spoken up to its loader's 500 |
| call-recap batch warm (prod log) | `SYM|quarter` custom_id refused by the batch API on every submit | `llm_batch.custom_id()` + a local guard — `74189ba066` |
| breadth backfill (worker log) | floor on a holiday never "reached"; the done grind re-ran every idle period | completion is session-aware — `253cb09b7e` |

The polling-rail red was fixed by another session (`418dcb2409`) during the sweep and was left alone.

**Settled, no change:** a plain mouse drag on a chart embed's body pans the chart (the live chart
owns that gesture); the block moves by its grip, which P2 fixed. Only Draw mode keeps the editor
out of the body.

**Noticed, not changed:** the admin stats' 7- and 30-day windows (`users`, `subscriptions`) use
the same ISO-cutoff form; on columns written as CURRENT_TIMESTAMP that only miscounts rows on the
boundary day, and those queries belong to the admin dashboard, so it is left as a note.

## 5. Speed under load (branch `notebook-ux-1010`, 2026-10-10)

Instrument: `tools/notebook_swarm.py`, 20 API members for 2 minutes against a local sandbox,
no browsers on the box. Raw runs: the session scratchpad (`ux1010/ab-*`).

**The 11-14 second "slow save" was the instrument, not the server.** Every member built its own
`httpx.AsyncClient`, and each one loads the certificate bundle synchronously inside the event
loop (150-700 ms here). Twenty in a row blocked the loop about 14 s, so each member's FIRST
response was timed as if the server had taken up to 14 s; all twenty finished within 0.1 s of
each other. A stand-alone probe (20 brand-new members saving their first note at once) answered
in 0.43-1.1 s, first wave no slower than the second. Fixed in the swarm (one shared TLS
context, `0b43de82f2`).

| endpoint, steady state (after the opening burst) | p50 | p95 | p99 |
|---|---|---|---|
| POST notes (new note) | 29 ms | 64 ms | 121 ms |
| GET notes/{id} (open a note) | 11 ms | 33 ms | 44 ms |
| PUT notes/{id} (save an edit) | 16 ms | 38 ms | 89 ms |

Browser, one member at 1280 px: open a note from the list 244 ms to a live editor; switch to
another note 170 ms to its content showing.

**Tried and dropped:** setting SQLite's WAL mode once per database file instead of on every
connection. py-spy put most samples on that line, but those samples were requests WAITING for
the write lock behind the swarm's own stall. Same runs with and without it: POST notes p99 934
vs 984 ms. Not shipped.

## 6. The full walk after the UX and phone passes (2026-10-10)

Instrument: `tools/notebook_fin_walk.py --config c2`: a fresh member, every feature's main path and
every walkthrough at 1280, 820 and 390. Raw records:
`docs/notebook/evidence/fin-walk/<sha>/c2/walk.json`. Sandbox integrity CLEAN at every checkpoint,
shutdown included, on both runs.

| tree | PASS | FAIL | against the 10/07 walk (`af0b7ffeea`) |
|---|---:|---:|---|
| master after #311 and #312 (`3ec81aba15`) | 171 | 14 | **9 regressions** |
| `fix/notebook-tours-1010` (`e0102557f4`, #314) | 178 | 7 | **0 regressions**, 1 more pass |

The nine, read from the product's own answer, not the walk's verdict:

- **Product, fixed in #314.** The Transcript passages tour told the member to type `/transcript`
  and press Enter, and Enter opened Voice note (it lists "transcript" as a keyword and sits first
  in menu order; voice notes were armed 10/09, after the 10/07 walk). A typed slash query now
  ranks title matches above keyword-only ones. On a phone the Writing help tour pointed at a
  button #312 moved into More (it stays in the row as its icon now), and Search by meaning and
  the image import tour pointed into the folders panel, which #312 made a closed drawer: the
  engine now asks a region hiding an off-screen anchor to open (`requestReveal`).
- **Instrument, fixed in the walk.** The welcome's capability preview is behind "See what it can
  do", Reporting soon folds when empty, and properties sit behind Details (all #311, on
  purpose). The walk now unfolds them the way a member would. The formulas tour's 1-of-5 on
  master was downstream of that: the walk's formulas step never made a formula.

The seven that remain all failed on 10/07 too: thesis chips (the chips route answers the app's
HTML), find similar on an example card, the formulas tour's last step (its anchor is present but
off screen), the entry-context note not saving in the walk, and remove-sample's own-folder
create answering 400. They predate this work and are not claimed here.

The 503s in every step's console are the sandbox's switched-off broker sync and bar stream (137
passing steps carry the same lines).

