# Notebook performance budgets

Wave 7, lane I. This file is the record of what the Notebook is allowed to cost and the
measurements those allowances come from. Every number here names the command that produced
it and the tree it was built from. A number with no command beside it does not belong here.

The enforced values live in `docs/notebook/perf-budgets.json` (edited by hand; §3).
This file explains them.

## 1. Bundle baseline (I0, the merged `vite.config.js`)

### What changed and why the bytes moved

`app/vite.config.js` had two top-level `build` keys from 2026-09-12 (`d261d0731`) until this
change. The later key won, so the first `build` block was discarded without an error. That
block held `rollupOptions.output.manualChunks` and `chunkSizeWarningLimit`. esbuild printed a
warning about it on every build (`▲ [WARNING] Duplicate key "build" in object literal
[duplicate-object-key]`, line 5 of the pre-merge build log). Nothing read that warning.

The merge keeps both parts in one `build` object: the iOS engine floor (`target:
['safari16', 'es2021']`) and the `manualChunks` map. It also adds `manifest: true`, which
changes no chunk and writes `dist/.vite/manifest.json` for the budget tool.
`app/src/__tests__/viteConfigDuplicateKeys.test.js` fails on a duplicate key anywhere in any
`vite*.config*` file. It also fails if the evaluated config loses the floor or the chunk map.

### How it was measured

- **Before:** `npm run build` at `4fdda82cd` (both `build` keys present). The same config was
  then rebuilt with `manifest: true` added to the winning block, into a scratch outDir. That
  second build changes no chunk: all 300 JS file names and sizes match the first build.
- **After:** `npm run build` on the merged config, the tree of `7f8f24056` (the commit that
  added this section).
- **Byte counts:** raw bytes from `ls -l app/dist/assets`. They are not gzip sizes.
- **"First-open" bytes:** the JS a browser must fetch before a route can render. That is the
  static `imports` closure in the manifest from `index.html` plus the route's lazy root(s).
  Dynamic imports are not included, because they load on demand.

### The table

| chunk | planner (`5f60d5d5b`-era dist) | before, measured at `4fdda82cd` | after, merged | Δ vs before |
|---|---:|---:|---:|---:|
| entry `index-*.js` | 1,110,611 | 1,110,611 | **867,080** | −243,531 |
| `vendor-react-*.js` (entry preload) | — | — | 221,408 | new |
| `vendor-swr-*.js` (entry preload) | — | — | 19,870 | new |
| **entry + its preloads** | 1,110,611 | 1,110,611 | **1,108,358** | −2,253 |
| `vendor-charts-*.js` (lazy) | — | — | 185,379 | new |
| `vendor-echarts-*.js` (lazy) | — | two auto chunks, 561,021 + 588,935 | 1,142,871 | −7,085 |
| `tiptap-*.js` | 356,136 | 356,136 | 356,312 | +176 |
| `NotebookTab-*.js` | 270,020 | 270,043 | 270,227 | +184 |
| `askInsert-*.js` | 321,821 | 321,821 | 321,893 | +72 |
| `katexRender-*.js` (lazy) | 261,253 | 261,253 | 261,253 | 0 |
| `PdfDocumentViewer-*.js` (lazy) | 482,700 | 482,700 | 482,773 | +73 |
| all JS in `dist/assets` | 11,745,480 | 11,745,503 (300 files) | 11,750,448 (301 files) | +4,945 |
| `vendor-*` chunks | 0 | 0 | 4 | — |
| **Notebook route first-open** (entry + `JournalLayout` + `NotebookSurface`, static closure) | not measured | 2,324,697 | **2,323,886** | −811 |

The planner's figures differ from the `4fdda82cd` build by 23 bytes, in `NotebookTab` and the
all-JS total. `4fdda82cd` itself only touched backend files. The planner's dist was built
before `5f60d5d5b`, and the provenance of that dist was inferred in the plan, not proven.

### Every large movement, explained

- **Entry −243,531.** React, react-dom, scheduler and react-router moved into `vendor-react`
  (221,408 B), and swr moved into `vendor-swr` (19,870 B). The entry preloads both, so the JS
  fetched before first paint went from 1,110,611 to 1,108,358 (−2,253). The gain is caching:
  a deploy that does not touch React leaves those two chunks' hashes unchanged, so returning
  browsers reuse them.
- **tiptap +176, NotebookTab +184, askInsert +72, PdfDocumentViewer +73.** These chunks now
  import React from `vendor-react` as well as from the entry. In `tiptap` that is two more
  import statements (5 → 7), and those statements account for +76 of its +176 bytes. The rest
  is minified identifiers renamed around the new imports. That split was inferred and not
  isolated.
- **echarts: two chunks → one, −7,085 in total, and a regression on three routes.** Without
  `manualChunks`, Rollup put echarts in two chunks: the zrender and echarts core (561,021 B)
  and the charts and components (588,935 B). The Calendar ("UCT Terminal") and MyStocks
  routes needed only the core. The `vendor-echarts` entry merges both halves into one chunk,
  so those routes now fetch all of echarts. Measured over all 103 lazy routes the entry
  reaches:

  | route | before | merged | Δ |
  |---|---:|---:|---:|
  | `research/ResearchPage.jsx` | 3,238,246 | 3,818,902 | **+580,656** |
  | `Calendar.jsx` | 2,029,024 | 2,609,499 | **+580,475** |
  | `calendar/MyStocksHub.jsx` | 1,975,952 | 2,556,427 | **+580,475** |
  | the other 93 routes | — | — | −9,278 to −1,239 each |

  The fix is a variant with one change: remove `'vendor-echarts'` from the map. It was built
  and measured the same way. The three routes return to before −1,343. No route is worse than
  before by more than 375 B, and that 375 B is the legacy v8 `JournalTwoRoot`. The other
  routes give back up to ~7 KB of the merged config's gains. **This file does not choose
  between them.** The brief kept the map intact, so the map is intact here. The measurement
  and the one-line alternative go to the controller. ⚰️ *Superseded 2026-09-25: the
  controller chose the one-line alternative (ruling D-I1). See "Decision D-I1" below.*

### Decision D-I1 (fix round 1): `vendor-echarts` removed from `manualChunks`

Ruling D-I1: the merged chunk cost ~580 KB on first open on the three routes members open
most, to save at most ~7 KB on each of 93 others. `'vendor-echarts'` is gone from the map
(`app/vite.config.js`, with the reason beside the list), and
`src/__tests__/viteConfigDuplicateKeys.test.js` fails if it comes back.

Measured the same way as above, on two clean builds (`git archive` of the committed tree, so no
uncommitted file from another lane reached either one) of the tree of `0189bca13`: **with** the
entry (that commit as it stands) and **without** it (the same tree plus the one-line change,
which is the D-I1 commit's `vite.config.js`). `npx vite build` for each, then
`tools/notebook_perf_budgets.py --dist` and the per-route census (scratch `w7I/fr1/`:
`build-dI1-{before,after}.log`, `bytes-dI1-{before,after}.json`, `routes-dI1.txt`,
`dI1_summary.log`). Raw bytes, first-open static closure:

| route / figure | with `vendor-echarts` | without (D-I1) | Δ |
|---|---:|---:|---:|
| `research/ResearchPage.jsx` | 3,827,063 | 3,245,245 | **−581,818** |
| `Calendar.jsx` (the UCT Terminal) | 2,610,475 | 2,028,657 | **−581,818** |
| `calendar/MyStocksHub.jsx` | 2,557,403 | 1,975,585 | **−581,818** |
| the other 93 lazy routes | — | — | +50 to +7,186 each (median +50, sum +61,487) |
| **Notebook route first-open** (the budgeted figure) | 2,153,087 | **2,153,137** | **+50** |
| echarts chunks | one, 1,142,871 | two, 561,021 (core) + 588,938 | +7,088 |
| all JS in `dist/assets` | 11,787,679 (312 files) | 11,794,972 (313 files) | +7,293 |

The +50 B on every route is the entry chunk (867,895 → 867,945). Every lazily loaded module of
the D-I1 build (149) was imported in headless Chromium with the section-1 smoke: 149
evaluated, 0 rejected, 0 page errors (`w7I/fr1/smoke-dI1-after.json`).

The budget file's byte baseline moved in the same commit, from this measurement, never
adjusted: **2,153,137, max 2,260,793** (floor of +5%). Against the I3 baseline (2,145,850,
section 4) the Notebook first open is +7,287 B: +7,237 from the commits that landed after I3
(the "with" build) and +50 from D-I1.

### Does the merged bundle still start?

Re-enabling a chunk map is how the 2026-08-09 "reading 'PureComponent'" crash shipped: a
module evaluated before its React import was ready. The unit suite cannot see this, so
every lazy route module was loaded in headless Chromium and module evaluation was checked.
The test served `dist` from a loopback port, checked a per-run nonce, loaded `/`, then ran
`import()` on each of the 103 unique route modules in `index.html`'s `dynamicImports`.

| dist | routes evaluated | rejected | page errors |
|---|---:|---:|---:|
| before (control) | 103 | 0 | 0 |
| merged | 103 | 0 | 0 |
| before, one route chunk poisoned (negative control) | 102 ok | **1** (`PostMarket.jsx: Error: w7i-negative-control`) | 0 |

This is a local check. It is not device or certification evidence.

## 2. Search and whole-library reads (I1)

### The instrument

`tools/notebook_scale_benchmark.py` seeds a fresh SQLite file per tier through the real
schema and FTS triggers and times the real read functions: 2 untimed warm-ups, then 20
timed runs per op, nearest-rank p50/p95. It imports the repo-root `conftest` first, so every
`/data` path is pinned to a sandbox and a stray write fails the run (`shared_root_writes` is
`[]` in both reports below). The two route pairs time what the routes call
(`list_and_count_notes`, `tag_counts_and_tree`), and the search box's own request
(`sort=relevance, limit=100`, `FolderSidebar.jsx`) is timed as its own op.

⚠️ **Single-tenant seed (review M-9): a known limitation.** Every tier seeds ONE member, while
the full-text sets (the `q=` set and the relevance pass) match against the whole
`j2_notes_fts` table with no user filter by design, so their cost grows with every member's
matches and none of the figures below covers that; a multi-tenant seed is a follow-up.

⚰️ **The first baseline was void.** It timed every read inside `tracemalloc`, which hooks
every Python allocation: `switcher_search` read 435 ms traced against 62 ms untraced
(×7.0), `list_tasks` ×1.9, `tag_tree` ×1.6, while the SQL-bound reads did not move. It
would have sent the fix work after a slowness the product does not have. Timing now runs
untraced and memory is one separate pass (`test_no_timed_call_runs_under_tracemalloc`).

Command, both runs (scratch paths are on this box, under the session scratchpad `w7I/`):

    python -u tools/notebook_scale_benchmark.py --tiers 1000,10000,50000 --reps 20 --warmup 2 \
        --json <scratch>/<report>.json [--thresholds docs/notebook/perf-budgets.json \
        --budget search --budget reads --budget tasks --keep-db] --work-dir <scratch>/bench-work

- **before:** `acf1eb51e`, `w7I/i1-before2.json` / `i1-before2.log`. The tree was dirty only in
  files these reads do not import.
- **after:** `3efe7fa30`, `w7I/i1-final.json` / `i1-final.log`, clean tree.

### Before and after (p95, ms)

⚠️ **Read the after column with the A/B below it.** The after runs overlapped the owner's
live trading session on this machine (Zoom and the broker platform were running). The
switcher, whose code this lane did not touch, read 78 ms p95 at 50k before and 135 ms after,
so the after column is inflated by the machine, not only by the code.

| op (p95, ms) | before 1k | before 10k | before 50k | after 1k | after 10k | after 50k |
|---|---:|---:|---:|---:|---:|---:|
| list_notes (page 1, default sort) | 0.6 | 0.6 | 0.7 | 0.8 | 1.2 | 1.4 |
| count_notes (whole library) | 0.0 | 0.3 | 9.3 | 0.0 | 0.6 | 14.6 |
| GET /notes default (list+count) | 0.7 | 1.4 | 11.2 | 0.9 | 1.6 | 18.3 |
| list_notes (FTS, common term ~30%) | 10.6 | 30.2 | 130.1 | 15.4 | 31.7 | 135.6 |
| count_notes (FTS, common term ~30%) | 4.0 | 39.4 | 223.3 | 1.0 | 19.2 | 110.2 |
| GET /notes q=common (list+count) | 13.8 | 88.5 | 323.8 | 14.4 | 33.1 | 131.8 |
| list_notes (FTS, rare term, 1 note) | 8.1 | 42.7 | 175.8 | 8.1 | 18.5 | 61.0 |
| GET /notes q=rare (list+count) | 10.2 | 64.2 | 269.9 | 9.1 | 20.1 | 83.4 |
| GET /notes q=common, relevance (search box) | not measured | not measured | not measured | 19.3 | 61.1 | 231.0 |
| GET /notes q=rare, relevance (search box) | not measured | not measured | not measured | 7.4 | 32.0 | 115.2 |
| GET /notes tag=setups (list+count) | 5.5 | 43.3 | 164.2 | 2.0 | 23.7 | 118.3 |
| GET /notes embed_symbol (list+count) | 27.7 | 716.8 | 16,718.9 | 5.0 | 11.2 | 62.7 |
| tag_counts (whole library) | 3.6 | 46.7 | 233.1 | 1.0 | 18.8 | 102.2 |
| tag_tree (whole library) | 10.4 | 136.4 | 635.8 | 1.2 | 17.3 | 95.2 |
| GET /notes/tags (before: tag_counts+tag_tree; after: tags+tree) | 14.2 | 207.2 | 983.5 | 1.3 | 16.4 | 112.8 |
| folder_note_counts (whole library) | 2.0 | 29.6 | 137.1 | 0.1 | 1.0 | 12.9 |
| notes_for_folders (heavy + 2 others) | 1.9 | 14.4 | 44.4 | 2.0 | 9.5 | 21.3 |
| get_symbol_backlinks | 2.4 | 39.1 | 164.0 | 0.4 | 25.6 | 137.5 |
| switcher_search (word start) | 1.0 | 19.3 | 78.3 | 1.5 | 19.1 | 135.2 |
| switcher_search (fuzzy, in order) | 3.4 | 27.8 | 69.2 | 6.2 | 90.5 | 152.0 |
| list_tasks (open, ?view=tasks) | 5.6 | 67.1 | 303.0 | 3.0 | 30.4 | 223.6 |

The search box's relevance request had no before row because the old benchmark did not
time it. Measured separately on the old ORDER BY: **17.3 s** at 10k for the common term and
**128.6 s** for "setups" (`w7I/i1b-diff-rel-10k.log`), and **561 s** for one call at 50k
(`w7I/i1-relevance-before-50k.log`, taken while other jobs ran on the box).

### The same moment, both sides: interleaved A/B at 50k

`w7I/ab_50k.py`: side A is the `acf1eb51e` read functions on a 50k seed built by the old
schema; side B is `3efe7fa30` on a 50k seed built by the new one (indexes maintained during
the seed, as production maintains them). Each rep runs every op on both sides, alternating
which goes first, so both see the same load. 15 reps after a warm-up.
`w7I/i1-ab-50k-final.json` / `.log`.

| op | A: old code, old schema p50 / p95 | B: new code, new schema p50 / p95 |
|---|---:|---:|
| GET /notes default (list+count) | 12.4 / 17.1 | 8.9 / 13.8 |
| GET /notes q=common (list+count) | 455.6 / 529.4 | 113.3 / 146.5 |
| GET /notes q=rare (list+count) | 402.7 / 431.3 | 61.4 / 82.0 |
| GET /notes q=rare, relevance (search box) | 430.7 / 615.2 | 67.0 / 93.8 |
| GET /notes q=common, relevance (search box) | not run: 561 s per call | 183.0 / 293.5 |
| GET /notes tag=setups (list+count) | 222.0 / 344.1 | 86.3 / 124.6 |
| GET /notes embed_symbol (list+count) | not run: 16.7 s per call | 49.7 / 73.5 |
| GET /notes/tags (tags+tree) | 1160.3 / 1654.3 | 90.6 / 123.7 |
| folder_note_counts (whole library) | 188.1 / 234.4 | 9.4 / 17.2 |
| notes_for_folders (heavy + 2 others) | 57.9 / 86.8 | 7.7 / 13.3 |
| get_symbol_backlinks | 216.3 / 306.1 | 84.0 / 124.2 |
| switcher_search (word start) | 86.7 / 123.0 | 89.9 / 127.7 |
| switcher_search (fuzzy, in order) | 104.2 / 143.1 | 97.9 / 116.2 |
| list_tasks (open, ?view=tasks) | 405.9 / 489.0 | 142.7 / 188.7 |

Side A ran ~1.6–1.7× slower than the 06:32 before-run of the same code (q=common pair 324 →
529 ms p95, `/notes/tags` 984 → 1,654, `list_tasks` 303 → 489), which is the size of the
machine's load during these runs.

### What the measurement named, and what changed

In the order it named them (commits `5bed6c3a8`, `d437c9116`, `3efe7fa30`):

1. **Symbol filters and backlinks** (`embed_symbol`, `ticker`, sector/theme `symbol_in`,
   `embed_widget`, `get_symbol_backlinks`): a correlated `EXISTS` over the sidecars was
   answered from `idx_j2_note_embeds_user_sym` once PER NOTE (16.7 s at 50k). Now one
   non-correlated note-id set (`_symbol_note_ids_sql`).
2. **`GET /notes/tags`**: four whole-library `json_each` passes, each reading every note's
   `tags` off its overflow page (984 ms). Now one grouped pass over a covering index feeds
   both halves (`tag_counts_and_tree`).
3. **The search box's relevance order**: a correlated `bm25` subquery re-ran the full-text
   query per candidate note. Now one ranked MATCH pass, joined by note id, ordered over
   rowids and the two sort keys, and the page's columns read for the page only.
4. **`list_tasks`** read every live note's whole body to find "taskItem" (303 ms). Now a
   partial index holds just the task-bearing notes, and the readers spell its predicate
   exactly (`instr(body_json, 'taskItem') > 0`) so SQLite can prove it applies.
5. **Folder counts and the FTS / tag / ticker sets** read `deleted_at` / `archived_at` /
   `tags` off overflow pages. Now `idx_j2_notes_live_cover` answers them, and the search's
   FTS set maps through `j2_notes_fts_map` in both directions instead of reading each
   match's content row.
6. **`GET /notes` built each match set twice** (page and total). Now one connection and a
   per-request set memo (`list_and_count_notes`, `_RowidSets`).
7. **A regression this wave caused**: with `idx_j2_notes_live_cover` in place the planner
   read a folder's notes in `updated_at` order and sorted them all to keep 200
   (`notes_for_folders` 63 → 111 ms p50, `w7I/i1-ab-folders.log`). Fixed with
   `idx_j2_notes_live_folder_title`, walked in title order (8.3 ms p50, same rows, same order).

**Aggregate or indexes: indexes, decided by the measurement.** A maintained tag aggregate
would need every tag writer (`update_note`, `patch_note_tags`, the batch ops,
`import_confirm`, create / delete / restore, archive, the purge, the folder cascade and the
connector engine) to update it in the same transaction, and a trigger cannot call Python's
`tag_key` on connections that never registered it. Covering indexes plus one grouped pass
took `/notes/tags` from 1,160 to 91 ms p50 at 50k (A/B) with no writer touched.

- **The indexes' cost on every save (review M-3): accepted.** The reviewer measured it
  (`w7review/write_cost.log`: 10k notes, 600 interleaved autosave-shaped `UPDATE`s including
  the FTS trigger): p50 1.16 vs 0.67 ms per save, p95 2.38 vs 1.40 ms, the file +2.4%. About
  1.7× on the raw SQL of a save and still under a millisecond at p50, within the brief's option
  (b); lane I had not measured it.
- **These indexes cannot be upgraded in place (review M-7).** `db.py` creates them with
  `CREATE INDEX IF NOT EXISTS` by name, which never touches an index that already exists, so a
  changed definition needs a NEW name (or the DROP-then-CREATE idiom `idx_j2_notes_user_import`
  already uses); otherwise a database holding the old shape keeps it silently, and the plan
  rails, which build fresh databases, cannot see it.

Correctness is checked, not assumed: an old-vs-new differential over the same 50k seed
(`w7I/i1-diffcheck2.log`: 49/49 identical, tags, counts, lists, backlinks and tasks, at the
`5bed6c3a8` state; `w7I/i1-diffcheck3.log`: 59/59 identical including the shared pairs, stopped
by hand at the first old-code relevance case, which takes minutes per call at 50k), 8/8
relevance cases identical at 10k (`w7I/i1b-diff-rel-10k.log`), and every benchmark run's own
correctness checks pass.

### What is still over the line

The 50k budget verdict at `3efe7fa30` is **BREACH** (`w7I/i1-final.log`). On the A/B, the
ops still above 100 ms p95 at 50k under this load are: the common-term search pair (146),
the common-term relevance search (294), the tag filter pair (125), `/notes/tags` (124),
backlinks (124), the switcher (128 / 116, unchanged code, above the line before this wave
too under load) and `list_tasks` (189, against lane I's own 150). What is left, and the lever
under each:

- **Common-term relevance search.** Ranking ~15k matches is one MATCH with bm25 joined to
  note ids (~30 ms), then the order over every candidate (the full ranked statement ~111 ms),
  on top of the search set the page and its total share (`w7I/i1-prof-relevance.log`, a
  compacted copy of the 50k seed, `658f364af`). The lever is schema: a `note_rowid` column on
  `j2_notes_fts_map`, maintained by the FTS triggers, would turn the text-keyed note-id hops
  into integer lookups; and the page's total can come from the same ranked pass
  (`COUNT(*) OVER ()`). Not done in this wave.
- **`list_tasks`.** SQL is ~30 ms; the rest is Python: `json.loads` of 3,813 task-bearing
  bodies (~9 MB, ~60 ms) and the task walk (~46 ms) (`w7I/i1-prof-tasks.log`, same copy, same
  load). The lever is a maintained task index, the every-writer aggregate above.
- **A small regression:** the whole-library count reads the wider `idx_j2_notes_live_cover`
  where it used to read a narrow index (`GET /notes default` 11.2 → 18.3 ms p95 at 50k in the
  benchmark; the A/B shows 12.4 → 8.9 p50 under equal load, so it is within noise there).

Rails: `tests/test_journal_two_notes_read_plans.py` (plans captured from the real functions:
covering indexes, no correlated sidecar subquery, no full-text scan under a correlated
subquery, the tasks partial index, a folder walked in title order),
`tests/test_journal_two_tag_counts_combined.py`, `tests/test_journal_two_notes_list_and_count.py`.

## 3. Budgets (I2)

`docs/notebook/perf-budgets.json` holds every number the gates enforce. It is **edited by
hand**, and only on purpose, with the reason here and in the commit. One checker reads it:
`tools/notebook_perf_budgets.py`. The benchmark's `--thresholds` delegates to the same
function rather than carrying a copy.

| budget | tier | p95 line | whose |
|---|---:|---:|---|
| `search`: the `GET /notes` pairs, the search box's relevance request, the switcher | 50,000 | 100 ms | the brief |
| `reads`: `/notes/tags`, folder counts, `notes_for_folders`, backlinks | 50,000 | 100 ms | lane I |
| `tasks`: `list_tasks` | 50,000 | 150 ms | lane I, above the search line on purpose (§2) |
| `search_ci`, `reads_ci`, `tasks_ci` | 10,000 | same lines (one op informational, below) | the CI job |
| `editor`: note open (≤ 1,000 paragraphs) / typing per char (≤ 2,000) | — | 300 ms / 16 ms | the brief |
| `bytes.notebook_first_open` | — | baseline + 5% | the brief (§4) |

- **CI** (`.github/workflows/notebook-budgets.yml`, `# promotion-gate: no`): the 1k and 10k
  tiers and the byte budget after `npm run build`. The 50k tier is the local gate: seeding it
  takes minutes on a runner and a shared runner's timing would make a 100 ms line flap. At
  10k the line still catches the gross regressions (the correlated `EXISTS` was 717 ms at 10k).
  **One op is informational there (review M-8):** `switcher_search (fuzzy, in order)`, whose
  code this lane never touched, already read 90.5 ms p95 at 10k on this box (section 2's
  table), inside a shared runner's noise of the 100 ms line, so enforcing it would flap the job
  red and teach people to ignore it; `search_ci` lists it under `"informational"` (printed
  against the same 100 ms, never a breach), no line was raised, and the local 50k `search` gate
  still enforces it.
  `python tools/promotion_gate.py --self-check`: 9 cases, 0 failures (`w7I/i2-promotion-selfcheck.log`); the workflow classifies
  as `no`, and as unclassified (`None`) with its marker line removed (`w7I/i2-marker-control.log`).
- **The local 50k gate:**
  `python tools/notebook_scale_benchmark.py --tiers 50000 --thresholds docs/notebook/perf-budgets.json --budget search --budget reads --budget tasks`.
- **The editor harness** (`tools/notebook_perf_harness.py`, local only, Playwright): boots the
  hub sandbox launcher (`--data-dir 'C:\data-w7perf' --port 8095`, passed from PowerShell),
  signs up and comps a perf account through the app's own doors, seeds 1,000- and
  2,000-paragraph notes through `POST /api/j2/notes`, and measures an in-app note open and
  per-keystroke main-thread cost. Run at `658f364af` against that tree's build
  (`w7I/i2-editor.json`, `.md`, `.log`); the shared data root read CLEAN at pre-boot
  (`w7I/i2-editor-sandbox-integrity.md`) and no file under `C:\data` changed during the run
  (`w7I/i2-editor-cdata-mtime.log`: 0 files written after the boot). The launcher's +15 s and
  +120 s checkpoints did not log before the harness stopped it, so this mtime listing is the
  post-boot evidence.
  ⚰️ *That was the defect review I-1 named, fixed in fix round 1 (`8531f317c`).* The harness
  hard-killed the launcher, so its `finally` never wrote the shutdown checkpoint, and it never
  read the integrity log at all. It now starts the launcher through a SIGBREAK shim in its own
  process group, stops it with CTRL_BREAK (the signal uvicorn already handles), waits for the
  +15 s checkpoint before stopping it, reads the log, prints `SANDBOX INTEGRITY: ...` as its
  first line, and withholds every timing unless pre-boot, +15 s and shutdown all read CLEAN.
  *Since fix round 2 (N-4) that holds for `--base` too: it waits for its sandbox's shutdown
  checkpoint (`--shutdown-wait`) and withholds without it. A run that could not start (sign-in,
  comp or seeding failed) prints `SANDBOX INTEGRITY: NOT RUN (<reason>)` and exits 3 (N-3).*
  Proof against the real launcher: `docs/plans/joystick/sandbox-runs/2026-09-25T09-47-48.md`
  (all three CLEAN over 61 db files). That run was a lifecycle proof (200 paragraphs, 3 opens,
  10 keys), not a budget measurement; the numbers above were not re-taken.

  | measure | paragraphs | samples | p50 | p95 | budget |
  |---|---:|---:|---:|---:|---:|
  | note open | 1,000 | 20 | 58.3 ms | 74.6 ms | < 300 ms |
  | note open | 2,000 | 20 | 112.2 ms | 169.6 ms | n/a |
  | typing per char | 1,000 | 60 | 10.3 ms | 17.6 ms | < 16 ms |
  | typing per char | 2,000 | 60 | 17.8 ms | 22.4 ms | < 16 ms |

  Note open is inside its budget; **typing breaches it** at both sizes, measured under the
  same machine load as §2. `ColumnsGuard` (`lib/columnsNode.js`, lane H) was measured and is
  not the cause: its two whole-document walks cost 0.07 ms p50 / 0.12 ms p95 per keystroke at
  2,000 paragraphs (`w7I/i2-columnsguard-cost.log`, Node, minimal schema). Where the rest of
  the ~18 ms goes was not attributed (a browser profile per plugin and per React commit).

## 4. Bundle after I3

`npm run build` at the tree of `658f364af` (`w7I/i3-build.log`), measured with
`python tools/notebook_perf_budgets.py --dist app/dist` and the chunk census
(`w7I/i3-bytes.json`, `w7I/i3-after-census.json`). Raw bytes.

| chunk | I0 (`7f8f24056`) | I3 (`658f364af`) | Δ |
|---|---:|---:|---:|
| **Notebook route first-open** (static closure) | 2,323,886 | **2,145,850** | **−178,036 (−7.7%)** |
| `tiptap-*.js` | 356,312 | 256,404 | −99,908 |
| `codeHighlight-*.js` (lazy, first code block) | — | 100,593 | new |
| `NotebookTab-*.js` | 270,227 | 212,463 | −57,764 |
| graph / board / calendar / timeline / tasks views (lazy) | — | 5,577 / 5,474 / 6,350 / 7,900 / 4,549 | new |
| `ImportWizard` / `ExportDialog` (lazy, first open) | — | 31,330 / 3,121 | new |
| entry + its preloads | 1,108,358 | 1,108,385 | +27 |
| all JS in `dist/assets` | 11,750,448 (301 files) | 11,773,716 (311 files) | +23,268 |

- **tiptap −99,908 / codeHighlight 100,593:** highlight.js core, the 19 grammars and lowlight
  moved out of the editor chunk whole; the new chunk is fetched the first time a note holds a
  code block.
- **NotebookTab −57,764 / seven chunks 64,301:** the opt-in views and dialogs. The +6,537 B
  difference is chunk wrappers and helpers each chunk now imports for itself. Rollup also
  split a 5,791 B shared `_index-*.js` out (imported by `JournalLayout` and the Trades
  surfaces); it is inside the first-open figure.
- **All JS +23,268:** ten more files and their import preambles. None of it is in the
  Notebook's first open.
- **Emoji data: left static, ~14 KB.** The `:rocket:` input rule converts synchronously;
  lazy data would drop the first conversion typed before it arrives.
- Every lazily loaded module of this build (147) was imported in headless Chromium:
  147 evaluated, 0 rejected, 0 page errors (`w7I/i3-smoke.json`, the §1 smoke widened from
  routes to every dynamic entry).

The budget file's byte baseline moved to this build: 2,145,850, max 2,253,142
(floor of +5%). *It moved again with ruling D-I1: 2,153,137, max 2,260,793 (section 1,
"Decision D-I1").*

## 5. Fix round 1 (the lane I task review)

Each finding and where it now lives. Numbers are in the sections named, not repeated here.

- **I-1** (Important): the editor harness's sandbox lifecycle. Section 3, the editor harness
  paragraph; `tools/notebook_perf_harness.py`, `tests/test_notebook_perf_harness.py`.
- **D-I1**: `vendor-echarts` removed. Section 1, "Decision D-I1".
- **M-1**: the search snippets keep a matched row whose body column is NULL; the page filter
  is its own marker column, measured on the 50k seed against two slower alternatives
  (`api/services/journal_two/notes.py` `_snippets_for`, `tests/test_journal_two_snippet_page_filter.py`).
- **M-2**: the Trash order breaks `deleted_at` ties by id (`deleted_at DESC, id ASC`), railed in
  `tests/test_journal_two_notes_read_plans.py`.
- **M-3**, **M-7**, **M-9**: recorded in section 2. **M-8**: section 3, the CI bullet.
- **M-4**, *Ruling (b)*: the tag cloud follows the notes list's OWN refresh. The list keeps
  revalidating on focus (stopping it would trade a stale count for a stale list); when a refresh
  of the same query returns a page whose tags moved, `useJ2Notes` asks the tag key once. No
  per-focus tag query: an unchanged page, or a change that moves no tag, asks nothing
  (`hooks/useJ2Notes.tagFollow.test.jsx`).
- **M-5**: the seven on-demand views and dialogs load through `lib/lazyChunk.js`: one in-place
  retry of a failed fetch, then the app's existing `utils/lazyWithRetry` reload.
- **M-6**: the harness writes its logs beside `--json` or into a temp dir (never the cwd), closes
  its log handle, and `--dry-run` runs under a test.

## 6. Fix round 2 (the scoped re-review)

- **Where the +7,237 B went** (section 1: the commits that landed between I3 and D-I1): about
  6,650 B is lane H's H1/H2 and about 550 B is lane I's own M-4 (+353) and M-5 (+166). M-4 put
  `useJ2NoteTags` in the entry chunk, which costs +716 B on every route; about 363 B of that is
  winnable by moving the shared pieces into a leaf module. Recorded, not built.
- **N-2** (the tag ask once per refresh, not once per list) added 381 B, all of it in the entry
  chunk, so +381 B on every route: clean builds (`git archive`) of `b14dfca1e` and `40ced192b`,
  Notebook first open 2,154,146 → 2,154,527 B against the 2,260,793 B ceiling (scratch
  `w7I/fr2/build/bytes-{before,after}-n2.json`).
- **`lazyChunk`'s one in-place retry is unverified in a real browser engine.** Its rails run in
  jsdom, and whether a real engine re-requests a module whose first fetch failed, rather than
  replaying the cached failure, is the walk's to establish on a device.
