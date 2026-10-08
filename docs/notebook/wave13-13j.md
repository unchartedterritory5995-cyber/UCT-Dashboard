# Wave 13, lane 13J: the active setups board and find more like this

Branch `feat/notebook-w13j`, from `origin/feat/notebook-w12-landing`. Spec:
`docs/notebook/WAVE-13-PLAN.md`, Appendix A.13J. Flags `NOTEBOOK_SETUPS_BOARD_ENABLED` (the
board) and `NOTEBOOK_FIND_SIMILAR_ENABLED` (find more like this), each unset = OFF (an
enablement gate). Reuses 13A-1's `plan_extract.py` (plan levels) and 13I-1's
`tech_fingerprint.py` / `chart_blocks.py` (the fingerprint, the chart-block index); no formula
is restated here.

| file | what it is |
|---|---|
| `api/services/journal_two/setups_board.py` | the board: levels read ONLY through `plan_extract.read_note_plan` |
| `api/services/journal_two/similar_matches.py` | the nightly distance/score + the precompute into `j2_similar_matches`; the request path only reads |
| `api/routers/notebook_setups_board.py` | the three routes, each router 404 while its own flag is off |
| `app/src/pages/journal-2-0/components/notebook/SetupsBoard.jsx` | the page, `/journal/notebook/setups` |
| `app/src/pages/journal-2-0/components/notebook/BoardCard.jsx` | one card: levels, distance, a read-only mini-chart |
| `app/src/pages/journal-2-0/components/notebook/SimilarNames.jsx` | the matches sheet, worded from the server's own field deltas |
| `tests/test_notebook_setups_board.py`, `tests/test_notebook_similar_matches.py` | the backend rails (38 tests) |
| `SetupsBoard.test.jsx`, `SimilarNames.test.jsx`, `a11y/setupsBoard.a11y.test.jsx` | the frontend + a11y rails (12 tests) |
| `tools/notebook_w13j_mutation_proof.py` | the mutation proof (12/12 killed) |
| `tools/notebook_w13j_walk.py` | the real-browser walk driver |

## 1. The board

Every live, non-trashed, non-archived note holding a chart embed (via the save path's own
`j2_note_embeds` sidecar, newest edit first, at most `SCAN_CAP` = 200 notes) contributes one
card per (note, symbol) when its **entry** was read off a **drawn** shape (`chart` or the
trade-plan `canvas` role, via `plan_extract.read_note_plan` — never a second reader). Excluded:
a plan 13A has already frozen against a trade for that (note, symbol) in `j2_trade_plan_links`,
and a note tagged as a plan review (`plan_grading.REVIEW_TAG`).

Per card: `entry`/`stop`/`target`, `side` (long/short/unknown), `state`
(`waiting`/`watching`/`triggered`/`invalidated`/`no_price`), the distance to the entry in
percent and in R (`setups_board.distance_to_trigger`, pure, pinned on fixtures), `daysInSetup`
(calendar days, ET), and the last price with its source (`live`, the shared stream's own tick
via `bar_broadcaster`, or `close`, the last stored daily bar — never a vendor call from here).
Sorted by `setups_board.sort_key`: the live states by closeness, then the invalidated, then the
blind, ties by symbol then note id. 16 cards a page (`PAGE_SIZE = GRID_MAX_CELLS`, pinned equal
to the multi-chart grid's own cell cap).

**Herd safety is the multi-chart grid's own recipe, reused, not reinvented**
(`SetupsBoard.jsx`): `useStaggeredMount` admits at most `MOUNT_LIMIT` (3) charts at once, a slot
frees on the chart's own `onBarsReady` or the 5 s safety timer; every card's `StockChart` carries
`backgroundWarm={false}` and no deep warm; warming the NEXT page's daily bars happens only
through the prefetch module (`makeGridWarmer` + `prefetchListAllTimeframes`) once the current
page has painted, never a direct fetch; streams ride the shared pools. `SetupsBoard.test.jsx`
mounts a 40-card board and asserts all of this.

## 2. Find more like this

From any tagged, frozen chart block (13H-1's `ta.setupTag` + 13I-1's `ta.fingerprint`, read
through `chart_blocks.list_blocks`/`get_block`), today's nearest names over the nightly-scored
universe (`screener_rows`), by a deterministic weighted distance:

* **The fields compared are exactly the fingerprint fields the nightly row holds**
  (`tech_fingerprint._ROW_COLUMNS`) — never a per-name fingerprint computed by this job.
* **One constants block, `RULES`** (field → weight, scale), pinned by
  `test_the_constants_block_is_pinned`: a numeric field's distance is
  `min(1, |candidate - template| / scale)`; a category field is 0 (equal) or 1. The fingerprint
  distance is the weighted mean over fields BOTH sides hold; a candidate under `MIN_COVERAGE`
  (0.6) of the template's weight is not ranked, and a template under `MIN_TEMPLATE_FIELDS` (4)
  gets nothing.
* **Confirmed patterns** (never raw `pattern_engine_ids`) re-rank the `SHORTLIST` (50) nearest
  with one more term, weight `PATTERN_WEIGHT` (2.0): `1 - (shared confirmed setups) /
  (template's confirmed setups)`. Score = `round(100 * (1 - distance))`. Top
  `MATCHES_PER_TEMPLATE` (10).
* **Reasons are the field deltas** — the server's own `{field, label, unit, template, candidate,
  delta, same, d}` per field, worded by the client (`SimilarNames.jsx`), closest fields first,
  ties in the server's order; shared confirmed patterns are named too.

**Precomputed NIGHTLY, mon-fri 05:45 ET** (after the screener's 03:00 snapshot and the 05:00 ET
scan sweep), on an APScheduler worker thread, flag read per run (inert while dark): one read of
`screener_rows` a run (≤ `UNIVERSE_CAP` = 8000 rows), ≤ `MEMBER_CAP` (300) members a run
(least-recently-matched first, so a deferred member is first next night), ≤ `MAX_TEMPLATES` (25)
tagged charts a member, 10 matches each, a `RUN_BUDGET_S` (600 s) budget that defers rather than
runs long. Idempotent (`write_matches` deletes then rewrites one (user, note, embed, as_of) key);
an untagged or deleted chart loses its rows at the next run; rows older than `RETAIN_DAYS` (7)
age out. **The request path (`similar_matches.read_matches`/`list_templates`) only reads these
stored rows** — nothing it calls opens the screener store, the bars store or the pattern store,
and `rank_matches`/`load_universe`/`run_nightly` are never imported by the router
(mutation-proved, M "U1").

## 3. The API

| method | path | plan | answers |
|---|---|---|---|
| GET | `/api/j2/setups-board` | member | `{cards, count, today, pageSize, scanned, capped}` |
| GET | `/api/j2/similar-names/templates` | paid | `{templates, count, maxTemplates}` |
| GET | `/api/j2/similar-names/{note_id}/{embed_key}` | paid | `{template, asOf, computedAt, status, matches}`; `status` is `ready` / `not_tagged` / `pending`; another member's note is the one 404 |

Each router answers the one 404 **before any session is read** when its own flag is off
(`NOTEBOOK_SETUPS_BOARD_ENABLED`, `NOTEBOOK_FIND_SIMILAR_ENABLED`); find-similar additionally
needs a paid plan (402 on a free one) — the same gate the fingerprint it ranks on already needs.
A store that cannot be read answers 503 with one plain sentence, never a 500.

## 4. Decisions (the lane's own, for the controller)

1. **The board never re-parses a note.** `setups_board.py` calls `plan_extract.read_note_plan`
   for every number on a card; `test_the_board_reads_levels_only_through_plan_extract` swaps the
   reader and shows every number on the card follows it, and asserts the module's own source
   holds no annotation/role/regex parsing of its own.
2. **Find more like this never scans the universe on a click.** The nightly job and the request
   path are two different code paths reading two different stores; the router never imports
   `load_universe`/`rank_matches`/`run_nightly`, and the rail arms every door to the screener,
   the bars store and the pattern store to raise and still gets a 200 from stored rows.
3. **Chart herd safety is the grid's recipe, not a new one.** `MOUNT_LIMIT`, `backgroundWarm`,
   and the prefetch-only warm path are literal reuses of the multi-chart grid's own constants
   and helpers (`useStaggeredMount`, `makeGridWarmer`, `GRID_MAX_CELLS`), imported, not copied.
4. **A card's "find more like this" button only appears when its chart is tagged.** The board
   reads `similarEmbedKey` off the note's own chart block (`chart_blocks.extract_blocks`, pure,
   no DB), so an untagged setup never offers a door to a feature with nothing behind it.
5. **The invalidated and no-price buckets sort after the live ones, always.** `sort_key`'s
   bucket order is a single source both the route and the tests read
   (`setups_board._BUCKET`); mutation-proved (S1).

## 5. Verification

* `pytest tests/test_notebook_setups_board.py tests/test_notebook_similar_matches.py -q` →
  **38 passed**.
* `pytest tests/test_notebook_flags.py tests/test_notebook_flag_parse.py
  tests/test_journal_two_account_purge.py -q` → **162 passed** (roster rails: both flags
  registered on every roster the earlier lanes used).
* `npx vitest run src/pages/journal-2-0/components/notebook/SetupsBoard.test.jsx
  src/pages/journal-2-0/components/notebook/SimilarNames.test.jsx --maxWorkers=1` →
  **10 passed**.
* `npx vitest run src/pages/journal-2-0/a11y/setupsBoard.a11y.test.jsx --maxWorkers=1` →
  **2 passed** (axe, 0 violations, both surfaces).
* `npx vitest run src/pages/journal-2-0/a11y/surfaceCoverage.test.js
  src/pages/journal-2-0/a11y/ariaCoverage.test.js --maxWorkers=1` → **20 passed** (the a11y
  registration in `notebookSurfaces.js` is covered).
* `npx vitest run src/components/screener/reachable.test.js --maxWorkers=1` → **17 passed**
  (the `/journal/notebook/setups` route, reached only through a `lazy(() => import())` edge
  from `App.jsx`, is REACHABLE; see the note below on an unrelated fix this lane made here).
* **Mutation proof**: `tools/notebook_w13j_mutation_proof.py` — **12 of 12 KILLED**, each with a
  green control before and after and the file restored and verified against the committed blob.
  Raw: `docs/notebook/evidence/wave13-13j/mutation-da6bb328212397d3421861098750a2680fcc6df2.txt`.
  Guards: the drawn-levels-only filter (D1), the plan-review exclusion (D2), the
  already-consumed exclusion (D3), the invalidated boundary at price-equals-stop (B1), the sort
  bucket order (S1), the board router's flag gate (G1), the find-similar router's flag gate
  (G2), the paid gate (P1), the nightly-only door (U1), the `RULES` distance constants (C1), the
  mount cap (H1), and no-background-warm (H2).
* **Real-browser walk**: `tools/notebook_w13j_walk.py`, sandbox port 8645, tip `b5848eb968`.
  **VERDICT: PASS — 12 of 12 rows, sandbox integrity CLEAN** (pre-boot, post-boot and shutdown
  hashes all matched; 62 db files). Raw: `docs/notebook/evidence/wave13-13j/walk-b5848eb968/`
  (`walk.json`, five screenshots, the sandbox log, both seed-child logs, `integrity.md`; R-RAW,
  committed before this summary). Three fictional tickers (`ZQVA`/`ZQVB`/`ZQVC` — a real symbol
  risks a background pre-cache thread silently overwriting the walk's own seeded bars with a
  live quote, which is exactly what happened on the first attempt against `NVDA`/`AMD`/`TSLA`
  before this lane switched to names no vendor can answer for) carried one waiting, one
  watching and one invalidated card; the board showed them closest-first with the right
  distance/R text at both 1200 and 390 px; the keyboard path (Tab, Enter) and a phone tap each
  opened the find-similar sheet for the tagged card, whose one precomputed match (written by a
  REAL run of `similar_matches.run_nightly`, universe injected) named its reasons with the
  closest fields first and the shared VCP pattern; the page made zero requests to
  `/api/scans/**`; both flags off showed "This page is not available yet." and fetched neither
  route; zero unforced page errors; the driver's own `sys.modules` held no `api.*`.

### A fix made in passing: `reachable.test.js`'s stale `planLevels.js` parking entry

`app/src/components/screener/reachable.test.js` carries an `AWAITING_A_DECISION` register for
modules built but not yet mounted. Its "WAVE 13 CHART PLAN" block parked both `chartPlan.js`
(13H-1's library, waiting on 13H-2's panel) and `planLevels.js` (13A-1's write builders), with
its own stated expiry: *"13H-2 lands the panel (or 13A-2 imports planLevels.js); then drop the
entry that became reachable."* 13A-2 (`ca7424eb02`, merged into this branch's base ahead of this
lane) already imports `PLAN_ROLES` from `planLevels.js` via `notebookTemplates.js`, which
`NotebookTab.jsx` mounts — so the entry had been stale since that merge, pre-dating this lane's
own work, and the rail was failing on it when this lane's route was added (the failure does not
depend on anything this lane changed; it was reproduced identically with and without the 13J
route). Fixed as the register's own comment instructs: the `planLevels.js` entry is dropped;
`chartPlan.js` stays parked under its own, narrower comment.

## 6. Not in this lane

A chart's `ta.fingerprint` freeze flow (13I-1/13I-2); the visual playbook grid (13I-2); any new
scoring formula beyond the distance over existing fields (explicitly out of scope, Appendix
A.13J "Not:"); per-card price streams (the shared feed only); a per-request universe scan (never
— the nightly job is the only writer of `j2_similar_matches`).

## 7. Open items

* Both flags are armed `False` on every roster (dark). The owner arms
  `NOTEBOOK_SETUPS_BOARD_ENABLED` first (no dependency), and
  `NOTEBOOK_FIND_SIMILAR_ENABLED` once at least one nightly run has had a chance to populate
  `j2_similar_matches` for the members who will see it — arming it before the first run just
  means every template reads `pending` until morning, which the page already says plainly.
* No nav entry links to `/journal/notebook/setups` yet (M0's scaffold reserved nav rows for
  "Playbook, Setups board, Passed setups"; this lane did not add one, consistent with 13I-1 and
  13C shipping their own surfaces without a nav link in the same commit). A follow-up decision,
  not a defect: the route is reachable and flag-gated either way.
