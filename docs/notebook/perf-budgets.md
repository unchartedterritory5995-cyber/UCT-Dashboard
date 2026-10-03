# Notebook performance budgets

Wave 7, lane I. This file is the record of what the Notebook is allowed to cost and the
measurements those allowances come from. Every number here names the command that produced
it and the tree it was built from. A number with no command beside it does not belong here.

The enforced values live in `docs/notebook/perf-budgets.json` (edited by hand; §3).
This file explains them.

The head-to-head speed benchmark against Notion, Evernote and Obsidian (wave 9, lane 9A) keeps its own record in `docs/notebook/benchmark/` (protocol, data sheet, generated results), and nothing it measures ever moves a budget here.

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
| `switcher_body_common`: the switcher's body half, a term in ~30% of bodies that no title names | 50,000 | 250 ms | wave 10 F6 fix round 1 (§8) |
| `switcher_body_rare`: the same, a term in one note | 50,000 | 100 ms | wave 10 F6 fix round 1 (§8) |
| `search_ci`, `reads_ci`, `tasks_ci` | 10,000 | same lines (one op informational, below) | the CI job |
| `editor`: note open (≤ 1,000 paragraphs) / typing per char (≤ 2,000) | — | 300 ms / 16 ms | the brief |
| `bytes.notebook_first_open` | — | baseline + 5% | the brief (§4) |

- **CI** (`.github/workflows/notebook-budgets.yml`, `# promotion-gate: no`): the 1k and 10k
  tiers and the byte budget after `npm run build`. The 50k tier is the local gate: seeding it
  takes minutes on a runner and a shared runner's timing would make a 100 ms line flap. At
  10k the line still catches the gross regressions (the correlated `EXISTS` was 717 ms at 10k)
  — ⚰️ but it is **not** quiet, as this bullet and the workflow once implied. Re-counted
  2026-09-25 18:26 CT: **8 of 56** runs of the job on `feat/notebook-w7` went red, every one on
  `search_ci`'s `q=` ops and never on bytes; `q=rare, relevance` read 160.0 ms p95 on a commit
  that changed one JS test file (`730153a60`) against 13.56 ms on a green run (`e6bb581a5`), and
  a comments-only commit (`46334dc85`, run 36198655258) breached `q=common, relevance` at
  191.6 ms while its parent passed. **Since the wave-7 whole-branch fix (tooling review I-3) a
  breach must REPRODUCE:** the benchmark re-times an op that reads over a budgeted line once,
  same warm-ups and reps (`--remeasure`, which the CI job passes for all three `_ci` budgets),
  and `check_search` breaches only when both readings are over the line; a one-off is printed
  as a note. No line was raised. ⚠️ **One re-measure does not make the job quiet:** of the
  first 7 runs under the rule (2026-09-25 18:47–19:05 CT) one was red — run 36203106608 on
  `1649bba7b` (a test file and a workflow comment) REPRODUCED `q=common, relevance` at
  239.1 → 118.5 ms, while in the same run `q=rare (list+count)` read 153.0 → 13.0 ms and was
  noted, not counted. A burst that outlasts the pass still reads red, and seven runs establish
  no rate.
  **One op is informational there (review M-8):** `switcher_search (fuzzy, in order)`, whose
  code this lane never touched, already read 90.5 ms p95 at 10k on this box (section 2's
  table), inside a shared runner's noise of the 100 ms line, so enforcing it would flap the job
  red and teach people to ignore it; `search_ci` lists it under `"informational"` (printed
  against the same 100 ms, never a breach), no line was raised, and the local 50k `search` gate
  still enforces it.
  `python tools/promotion_gate.py --self-check`: 9 cases, 0 failures (`w7I/i2-promotion-selfcheck.log`); the workflow classifies
  as `no`, and as unclassified (`None`) with its marker line removed (`w7I/i2-marker-control.log`).
- **The local 50k gate:**
  `python tools/notebook_scale_benchmark.py --tiers 50000 --thresholds docs/notebook/perf-budgets.json --budget search --budget reads --budget tasks --budget switcher_body_common --budget switcher_body_rare`
  (the last two added by wave 10 F6's fix round 1, section 8).
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

  **Every typing reading of this wave, with its provenance** (tooling review M-6: this record
  held only lane I's, and the loaded-box 2,000-¶ figure was being quoted as *the* number). Same
  harness, `typing_per_char` p95:

  | who, when | tree | box | 1,000 ¶ | 2,000 ¶ |
  |---|---|---|---:|---:|
  | lane I, I2 (the table above) | `658f364af` | loaded (the §2 machine load) | 17.6 ms | 22.4 ms |
  | lane H, the final run of its round | `b14dfca1e` | loaded (shared) | 17.3 ms | 19.7 ms |
  | lane H, interleaved A/B, **B = the lane-H tip** (median of 4 runs) | `e6bb581a5` | quiet | **16.95 ms** | **17.70 ms** |
  | lane H, interleaved A/B, A (median of 4 runs) | `09bc51ecb` | quiet | 17.05 ms | 17.30 ms |

  The A/B ran 2026-09-25 13:53–14:05 local, alternating A1 B1 … A4 B4, both trees on the same
  harness bytes with `--boot --sizes 1000,2000 --opens 20 --chars 60`, a fresh data dir per
  run; every B median sits inside A's own run-to-run range (no regression, and no
  improvement). **The verdict does not move: typing is over its 16 ms/char line at both sizes
  on every reading, and no line moved.** What moves is the size of the gap: the loaded-box
  22.4 ms at 2,000 ¶ overstates it by ~4.7 ms against the quiet-box median of 17.70 ms.

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

## 7. Wave 10, lane 10A

Branch `feat/notebook-w10-a` (base `c7e140b9e`). Every timing window is named with its box
state (QUIET: no `vitest` / `pytest` / `hub_sandbox_boot` / `gate_shards` / `vite preview`
process and more than 6,000 MB available, checked twice 20 s apart; otherwise LOADED after a
bounded wait). ⛔ A LOADED reading is never a verdict. Scratch evidence is in the lane's
`w10A/` directory, named beside each number.

### The levers, and what each one measured

| lever | what it replaced | measured |
|---|---|---|
| `note_rowid` on `j2_notes_fts_map`, kept by the FTS triggers; `idx_j2_notes_fts_map_rowid_note (fts_rowid, note_rowid)` | FTS rowid -> `note_id` TEXT -> j2_notes' TEXT key -> rowid, three lookups per match | the common term's match set 49 -> 19 ms at 50k (same process) |
| a maintained task index, `j2_note_task_digest` (filled by the door writers, invalidated by triggers, backfilled at boot) | `json.loads` of every task-bearing body per `?view=tasks` | `list_tasks` 121 -> 45 ms (same process) |
| switcher candidates (`_switcher_candidates_sql`): a per-token ASCII superset in SQL, the exact fuzzy check in Python | every live title read and scored in Python | "nvda setup" 68 -> 29 ms, "ntvds" 77 -> 46 ms |
| tag index `j2_note_tag_index` (triggers on insert / tags update / delete; a fold column for the case-insensitive seek) | a `json_each` over every live note's `tags` per request | `tag=setups` pair 178 -> 51 ms, `/notes/tags` 175 -> 130 ms (same process) |
| relevance: ONE ranked MATCH pass primes the request's match set; plain tuples and two sorts; candidates read from the narrow `idx_j2_notes_switcher_live`; the page's total taken from the candidate read | the MATCH run again for the WHERE and the COUNT; a second COUNT over the library | see the A/B below |
| `idx_j2_notes_id_live (id, user_id, deleted_at, updated_at, title)` | backlinks read every matched note's ROW, behind its body's overflow pages | count 24 -> 7 ms, list 32 -> 14 ms at 50k |
| `idx_j2_note_document_pages_user_doc (user_id, document_id)` | the per-note document list walked every page the member owns, once per document (the planner took the one-column `(user_id)` index) | a note with 50 documents: 85 -> 11 ms at 1,000 documents; 819 ms p50 in the 10,000-document tier before |
| the document search ranks on the FTS table alone (`_RANKED_SQL`), then joins and snippets only the ranked pages (`api/services/journal_two/document_search.py`; the exact one-pass read `_one_pass` answers when the Trash takes more than the ranked window's slack) | one statement joined the document, the note (its `deleted_at` past the body, on an overflow page) and the page, and built a snippet, for every matching page before its sort kept twenty | a common term over 10,000 documents (9,075 matching pages): 134 -> 47 ms p50 (same process, loaded box); 32 of 32 answers identical to the old function (`w10A/docsearch_diff.py`) |
| typing: `ToolButton` declared at module scope (`NoteEditorPage.jsx`) | declared INSIDE the page, a new component type per render: all twelve toolbar buttons and their SVG icons unmounted and re-mounted on every render, and the page renders on every keystroke | traced keystroke at 2,000 ¶ (loaded): main-thread busy 29.6 -> 20.6 ms/key, style recalc 7.3 -> 2.8 ms/key |
| typing: UIcon takes its gold gradient id once per mounted icon (`components/ui/UIcon.jsx`) | an id numbered per RENDER: every re-render of every gold icon wrote a new `id` and `stroke=url(#…)` (an attribute write, a style recalc, an SVG resource invalidation) | the per-key `setAttribute` / SVG invalidation entries leave the trace (504 SVG attribute recalcs over 40 traced keys after the toolbar fix -> 0; `w10A/trace2`, `trace3`) |

⚰️ **`COUNT(*) OVER ()` was measured and not adopted** (the brief's second named lever): the
window over the SQL ranked pass read 47.7 ms against 35.7 + 10.7 ms without it. The page's total
now comes from the candidate read the relevance order already makes, which removes the COUNT.

⛔ Every index this lane added or changed has a NEW name (§2, review M-7):
`idx_j2_notes_fts_map_rowid_note` (the old `idx_j2_notes_fts_map_rowid` is dropped at boot),
`idx_j2_notes_id_live`, `idx_j2_note_document_pages_user_doc`, and the tag index's three.

**Same-process interleaved A/B, old (`c7e140b9e`) vs new, one 50k database** (loaded box, so a
ratio, never a millisecond verdict; `w10A/ab50k.py`): `q=common` pair 0.41, `q=rare` pair 0.43,
relevance common 0.46 (after the relevance restructure), relevance rare 0.27, `tag=setups`
0.31, `/notes/tags` 0.74, switcher word start 0.52, fuzzy 0.62, `list_tasks` 0.39; the
default pair, folder counts, `notes_for_folders` and `embed_symbol` unchanged (0.96 - 1.01).
Every answer identical. **Old-vs-new differential over one seed edited through every door**
(update, create, trash, restore, archive, append, tag patch; `w10A/diff_50k.py`): 60 of 60 reads
identical at 5,000 notes and at 50,000.

### The new budgets (hand-edited in `perf-budgets.json`, reasons here)

- **`attachments`** (clause 14b): the reads that grow with ATTACHMENTS rather than notes, timed
  through the routes a browser calls (`GET /notes/documents/search` for a common and a rare term,
  the search box's document half; `GET /notes/{id}/documents` for a note with 50 documents, the
  editor's list), at the 50k gate with 10,000 extracted documents of 3 pages each
  (`--attachments 10000`). Held to the search line, 100 ms p95. It holds only on a tier that
  carried the attachments (`check_search` reads the tier's count), so a 50k run without them
  checked nothing and says so.
- **`curve`** (clause 14d): the least-squares log-log slope of every timed op's p50 over
  1k / 5k / 10k / 25k / 50k is held at **1.1** (linear, plus an allowance for timing noise over a
  50x range: doubling the library may cost at most 2^1.1 = 2.14x), and the last segment,
  25k -> 50k, is held on its own at **1.3** (a curve that bends up at the top is the symptom the
  clause names, and a five-point fit dilutes it; a two-point slope over 2x carries about twice
  the fit's noise). Both were set BEFORE the curve was measured. An op missing at any tier, or a
  tier not run, is a breach.
- **`ratio_ci`** (ruling R-10): the CI latency check. Each CI-budgeted read (the `search_ci`,
  `reads_ci` and `tasks_ci` ops, the two formerly informational ones included) is timed as a
  RATIO to an in-run calibration op (`CALIBRATION_OP`: its own 20,000-row table, an `instr` scan
  with a GROUP BY, a `json_each` fan-out and a Python JSON loop, touching no product code),
  calibration then op back to back in each round, the MEDIAN of 5 rounds, and a median over the
  line re-measured with 5 fresh rounds before it can breach. The line is the SAME 100 ms
  (tasks 150 ms) the CI tier always used, at the reference box's speed:
  `line_ms / calibration_ref_ms`. **`calibration_ref_ms` = 43.45 ms**, read on this box in a
  QUIET window (2026-09-27 01:02 CT, 9 rounds of 10 reps, range 42.95 - 44.61; `w10A/calib-ref.log`).
  It is a property of the reference machine, not a budget.

### CI, per ruling R-10

- **Bytes gate now:** `.github/workflows/notebook-bytes.yml`, `# promotion-gate: yes`. The byte
  job moved out of `notebook-budgets.yml` unchanged (same tool, same budget) because promotion
  is decided per workflow FILE (`tools/promotion_gate.py`) and one file carries one marker.
  `notebook-budgets.yml` keeps its advisory millisecond job and its `no` marker.
- **The ratio check:** `.github/workflows/notebook-latency.yml` runs the 10k tier with
  `--ratio ratio_ci`. It was advisory until it had been seen red once and green once (the D-A2
  precedent), and `tests/test_notebook_perf_scale_w10.py` refuses a `yes` without the two run
  URLs in its header. **Promoted 2026-09-27** (`# promotion-gate: yes`):
  SEEN GREEN, run `36323273589` (`2b0f388f8`; 14 ops, ratios 0.018 - 0.942 against the 2.301
  line, the runner's calibration p50 about 53 ms against the reference 43.45);
  SEEN RED, run `36323335660` (throwaway branch `ci/notebook-w10a-latency-red`, `aafb5b1d7` = the
  same tree plus `--slow-op "GET /notes q=rare (list+count)=400"`: that op alone breached, median
  7.588, re-measured 7.620; the other 13 stayed under the line). If it flaps in its first 20
  runs, R-10 says gate bytes only, restate clause 4b and put the marker back to `no`. ⛔ The
  local 50k gate stays the verdict.
- **Its first 20 runs: 20 green, no flap.** Runs `36323273589`, `36323923444` on the lane
  branch and 18 on the throwaway `ci/notebook-w10a-flapwatch` (each commit touches only a
  trailing comment of the workflow, so each is the lane's tree; the token here cannot
  dispatch a workflow). In every run the worst op was the fuzzy switcher at **0.922 - 1.016**
  against the 2.301 line (40 - 44 % of it) while the runner's calibration ranged
  **42.8 - 58.4 ms**: the ratio held still as the runner's speed moved by a third, which is the
  property the check exists for (`w10A/flapwatch-summary.txt`). Clause 4b is not restated.
- ⚠️ **The ratio check compares P50s, not p95s** (fix round 1, review M-2, ruling: keep it).
  Each round is the op's p50 over the calibration's p50, so the number held to the line is a
  median ratio: **a regression that lands only in the tail passes CI, on purpose** -- a round's
  p95 on a shared runner is one burst away from a flake, and this check gates promotion. The
  tail belongs to the local 50k gate (its p95 lines), which stays the verdict. Said the same way
  in `ratio_ci.why`, the workflow header and the rail's comment.

### Typing (clause 4d): attributed in a real browser, then fixed

`tools/notebook_perf_harness.py --attribute` types the characters a second time with every
ProseMirror plugin piece, TipTap's `emit`, the view's `dispatch` / `updateState` and React's
scheduler tasks wrapped, and TRACES that pass (`summarize_trace`: the renderer main thread's
self time per phase). The wrapped editor pieces were only ~2 - 3.5 ms of a keystroke; 10B's
per-transaction column-resizing plugin is a named row (`appendTransaction selectingCells$`,
0.02 - 0.04 ms/key) and is not the cost. The trace, a raw capture with Chrome's CPU profiler
(`w10A/trace1`) and the invalidation tracking named the rest:

| at 2,000 ¶, loaded box (attribution, never a verdict) | before (`attr2`) | after the toolbar fix (`attr3`) |
|---|---:|---:|
| main-thread busy per key (trace) | 29.6 ms | 20.6 ms |
| style recalc (`UpdateLayoutTree`) per key | 7.3 ms | 2.8 ms |
| script (`FunctionCall` self) per key | 9.1 ms | 7.0 ms |

What remains per key, named: the ProseMirror transaction and its plugins (~3 ms, of which
TipTap's `onUpdate` -> the local draft is ~1.5 ms: `captureLocalState` takes `getJSON()` of the
whole note and writes it to localStorage on EVERY keystroke, by the Wave Q1 durability design
-- "ONE snapshot per keystroke", `NoteEditorPage.jsx` -- which this lane did not change); the
page's React re-render (`bumpToolbar` re-renders the whole NoteEditorPage on every transaction
to keep the toolbar's active states current: the next lever is to re-render only when a
toolbar-visible value changes, which needs every render-time read of the editor enumerated
first); and the browser's own editing, style, layout and paint of the changed note.

⚠️ **A typing sample includes one rendering frame.** Measured (`w10A/frames1`, 80 keys at
2,000 ¶, loaded): the frame the keystroke produced ran BEFORE the probe's message task in 80 of
80 keys (keydown -> frame 10.6 ms p50, frame -> sample 2.7 ms p50). It is not a vsync wait,
but it is not script time alone either; the harness's docstring said a frame "never inflates a
sample" and now says what is measured.

**Interleaved A/B, the lane-H method** (A = the lane tip's frontend before the fixes, `dist`
index `E774B7D72CCD`; B = both fixes, `84DD976101E4`; the same harness bytes and backend,
`--boot --sizes 1000,2000 --opens 20 --chars 60`, a fresh data dir per run, A1 B1 … A4 B4,
2026-09-27 11:14 - 11:36). ⛔ **Every run is LOADED**: lane 10D's long-lived sandbox shim held
every quiet check (by rule), and the in-run sampler read each run DISTURBED (CPU median 17 - 54 %,
up to 32 competing processes). A and B were interleaved under the same load, so the RATIOS are
the reading; the absolute numbers are not a verdict.

| typing, median of 4 runs | A p50 | B p50 | A p95 | B p95 | line |
|---|---:|---:|---:|---:|---:|
| 1,000 ¶ | 8.50 ms | 5.55 ms | 16.60 ms | 16.65 ms | < 16 ms |
| 2,000 ¶ | 13.20 ms | 8.55 ms | 19.10 ms | 16.50 ms | < 16 ms |

The median keystroke is 35 % cheaper at both sizes and the 2,000-¶ tail came down 2.6 ms; the
1,000-¶ tail did not move. **Clause 4d is not closed**: no quiet reading exists, and the LOADED
p95 sits at the line at both sizes. The budget was not moved.

### The windows of this lane, as the rule reads them

Quiet = no `vitest` / `pytest` / `hub_sandbox_boot` / `gate_shards` / `vite preview` process and
more than 6,000 MB available at the start (two probes 20 s apart); since W5 a sampler runs
DURING each window and says whether the quiet HELD (`w10A/windows.txt`, `w10A/quiet_then.ps1`).

| window | when (CT) | tree | box | what it read |
|---|---|---|---|---|
| W1 | 09-26 22:51 | `c7e140b9e` (base) | quiet at the start (no in-run sampler yet) | the base's 50k gate: BREACH relevance common 217.7, fuzzy switcher 113.0, tasks 200.7 p95 |
| W2 | 09-27 00:36 | `1aeebeb3e` | LOADED | not a reading |
| CALIB-REF | 01:02 | -- | QUIET | the calibration op, 43.45 ms p50 (the `ratio_ci` reference) |
| W3 | 01:06 | `e4647fa42` + the attachment tier | quiet at the start; 5 foreign processes by its end | every notes op under its line (relevance common 57.1 / 69.8); BREACH the per-note document list 818.6 / 887.1 (fixed: the `(user_id, document_id)` index) |
| W4 | 08:42 | `2b0f388f8` | quiet at the start; about 2x slower than W3 throughout (no sampler) | not trusted |
| W5 | 09:34 | `8064ce08e` | quiet at the start, DISTURBED during (23 processes) | not a verdict (relevance common 134.2) |
| W6 | 10:34 | `8e4b51a0c` | LOADED, CPU 100 % | not a verdict |
| W7 | 10:53 | `8e4b51a0c` | LOADED, DISTURBED (CPU median 85 %) | the curve (below) |
| typing A/B | 11:14 - 11:36 | `8e4b51a0c` | LOADED, DISTURBED | above |
| W8 | 11:38 | `8e4b51a0c` | LOADED, CPU 100 % | the 50k gate's 17 ops as RATIOS to the calibration op: all under their lines, worst relevance common 1.802 / 2.301 (78 %) and `list_tasks` 1.175 / 3.452 |
| W9 | 11:45 | `8e4b51a0c` | LOADED, CPU 95 % | the page-cache experiment (below) |
| W10 | 11:49 | `8e4b51a0c` | LOADED, CPU 98 % | the search box in the page (below) |

⛔ **So the quiet-box 50k verdict (clauses 4b, 13d, 14a, 14b) was not taken on this lane.** The
nearest reading, W3, was quiet at its start and passed every notes op; W8 converts a saturated
box's timings into the reference box's scale through the calibration op and passes all 17 --
a ratio reading, not the verdict.

### The curve (clause 14d), and why it bent

W7's curve BREACHED 9 ops, 11 lines (both `count_notes`, the three tag reads, folder counts,
backlinks, the word-start switcher, `list_tasks`), every one bending between 10,000 and 25,000 notes. It is not a
verdict (the tiers ran under different load: the window opened at 12.6 % CPU and averaged 85 %),
and a same-process experiment (W9, `w10A/curve_cache.py`) names a second cause: SQLite's default
page cache (2,000 KiB) holds a 10,000-note library's hot index pages and not a 25,000-note one's.
With `cache_size = 64 MiB` on the same databases the 10k -> 25k step became about linear
(backlinks x3.1 -> x2.2, `list_tasks` x2.7 -> x2.1, folder counts x2.3 -> x2.1, for 2.5x the
notes). ⚠️ That is a property of the connection settings, not of a read: auth.db connections
are opened per request with defaults (`auth_db.get_connection`), which is app-wide and not this
lane's to change. Recorded as the finding; the bounds were not moved.

### The search box, in the page (W10, LOADED)

A 50,000-note, 10,000-document sandbox seeded by the benchmark's own seed, 24 queries typed into
the real search box, the browser's own resource timings (`w10A/searchbox.json`; integrity CLEAN
at pre-boot, +15 s, +120 s and shutdown; 0 page errors). On a saturated box (calibration ran 3 - 4x
slow in W8): the notes request p50 358.8 / p95 759.2 ms, documents 55.1 / 181.6, excerpts
48.9 / 69.9. ⚠️ Twelve of the 24 queries match EVERY seeded note ("setup", "volume", "risk", …),
and the budgets' common term matches 30 %: in the same process a term in every note costs about
3x the 30 % term (623 against 226 ms, loaded). No budget covers a term in every note of a
50,000-note library; that is a gap in the budget, recorded, not closed here.
⚠️ The relevance order's ranked MATCH pass (`_RELEVANCE_RANKED_SQL`) scores every member's
matches, not the searcher's (the FTS table's `user_id` is UNINDEXED): with one member seeded the
benchmark cannot see that cost, and a library of many members would pay it on every search.
Not measured. (Closed in fix round 1, below: the pass is now scoped to the member, and the
benchmark can seed more than one.)

### Fix round 1 (the lane 10A task review)

**The integer hop has a readiness record (review I-2).** The `note_rowid` upgrade -- the
repair of every NULL or drifted row, the new index, the dropped old one and the three FTS
triggers rewritten to keep the column -- now runs in ONE `BEGIN IMMEDIATE` transaction. (On the
boot path the COLUMN itself is added earlier, by `_PHASE_2_ALTERS`, in its own commit; that is
harmless because no reader trusts the column -- they trust the record below -- re-review N-3.)
That transaction records `j2_notes_fts_map.note_rowid` in `j2_schema_builds`, inside the same
transaction. The trigger swap no longer goes through `executescript` (which COMMITS whatever is
open before it runs): the trigger DDL is split into whole statements (`_script_statements`, by
`sqlite3.complete_statement`) and executed one by one inside the transaction. Every reader --
the text set in `_q_match_parts`, the ranked relevance pass, the list and the count -- asks
`_fts_map_ready` and, while the record is absent, takes the pre-wave-10 hop through `note_id`.
**A failed upgrade costs speed, never results:** the rail makes the repair raise on an old-shape
library and reads `['n1','n3','n5']` from `list_notes(q=...)`, the relevance order and
`list_and_count_notes`, never `[]`, with the old triggers still in place. A drift found at a
later boot deletes the record in its OWN commit before repairing, so the readers fall back for
the length of the rebuild; the tag index does the same (`j2_note_tag_index@N` is deleted first,
and a failed rebuild leaves every tag read correct -- railed).

**Derivations are versioned (review I-3).** `TASK_DIGEST_VERSION` and `TAG_INDEX_VERSION` (both
1) are recorded as `j2_note_task_digest@1` and `j2_note_tag_index@1`. At boot a version mismatch
empties and refills the task index, or drops the tag triggers and rebuilds the tag index,
through the same unmark-first path; `list_tasks` reads the index only while the current version
is recorded, and otherwise parses the bodies as before wave 10. A rail
(`tests/test_journal_two_derivation_versions.py`) hashes the derivation SOURCE -- `extract_tasks`,
`_own_text_and_due`, `parse_due`, the date pattern, `_NOTE_TAG_INDEX_DDL`, the fold tables and
`rebuild_note_tag_index`, tokenised with comments and docstrings removed, so a comment edit
passes and a code edit does not -- and pins each hash to its version constant. Editing either
derivation without bumping the version fails it; a control proves the hash moves on a code edit
and holds on a comment edit. `backfill_note_task_digest` now takes its write lock before it
reads the notes it will fill (review M-1).

**The relevance pass reads only the searching member (review M-4).** The FTS table is shared by
every member and its `user_id` is UNINDEXED, so the ranked MATCH pass scored everyone's matches.
It now keeps a map row only when `+m.note_rowid IN (SELECT rowid FROM j2_notes WHERE user_id =
?)`; the unary `+` is load-bearing -- without it the planner pushes the membership test into the
map index's seek, `(fts_rowid=? AND note_rowid=?)`, a product of the two sets that ran for more
than ten minutes at 50k before it was stopped. ⚠️ **This is not the form the brief suggested**
(`JOIN j2_notes n ON n.rowid = m.note_rowid AND n.user_id = ?`), and the reason is measured, in
one process on one 50k database, every answer identical (`w10A/m4_variants.py`): the common
term's ranked pass unfiltered 18 ms, the membership test 26 ms, the JOIN 54 ms -- the JOIN reads
each matched note's row (behind its body's overflow pages) where the membership test reads one
narrow index. Interleaved A/B against the unfiltered pass (`w10A/m4_measure.py`, loaded box, so
ratios): **one member, 50,000 notes** -- common term 1.19x / 1.15x (58.6 -> 69.8 ms, 64.9 -> 74.4
ms p50), rare term 1.50x (12.6 -> 19.0 ms: the member's rowid list is read even for one match)
(`w10A/m4-1member.log`); **two members, 25,000 each** -- common 0.87x both ways (40.6 -> 35.3,
43.7 -> 38.1 ms: the other member's matches are no longer ranked), rare 1.32x (8.9 -> 11.8 ms)
(`w10A/m4-2members.log`). So a one-member library pays about 6 - 11 ms p50 on a search, and a
library shared with another member of the same size already gains. Rails: a member's results and
totals are identical whether or not another member has matching notes, recorded and unrecorded
(`test_a_members_search_does_not_move_when_another_member_matches`), and the other member's notes
are never ranked and the plan's map seek never takes `note_rowid=?`
(`test_the_relevance_pass_ranks_only_the_searching_members_matches`).
`tools/notebook_scale_benchmark.py --members N` seeds N members of the tier's size and times the
first member's reads; a 2 x 25,000 smoke run (one rep, box not checked, so no timing is cited)
passed every correctness check (`w10A/members2x25k.json`).

**The bytes gate has its red run (review M-3).** `.github/workflows/notebook-bytes.yml` now
carries both runs in its header, as the latency gate does: SEEN GREEN run `36328815419`
(`8e4b51a0c`: 2,205,893 B against the 2,260,793 B budget) and SEEN RED run `36345075379`
(throwaway `ci/notebook-w10a-bytes-red`, `a27769fee` = `90dbfc0f0` with the budget set to
1,000,000 B: "BREACH bytes.notebook_first_open: 2,205,893 B > budget 1,000,000 B"). The rail
that refused the latency gate a `yes` without its runs now reads both workflows. Both headers
also say what a red does: **any growth of the route's first-open JS past the budget -- from a
change anywhere in the app that lands in the entry chunk -- refuses promotion until
`perf-budgets.json` is edited by hand** (headroom at `8e4b51a0c`: 54,900 B, 2.4 %), and an
infrastructure failure refuses too. Recovery is a re-run, `gh run rerun <run-id> --failed`, then
promote the commit by hand, `gh workflow run promote-production.yml -f sha=<sha>` (a re-run does
not re-trigger promotion). ⚠️ No markdown runbook carries the a11y gate's recovery today -- it
lives in `notebook-a11y.yml`'s own header -- so the same two lines went into both perf workflow
headers, beside the gate they recover.

**Still open, by ruling:** the quiet-box verdicts (clauses 4b, 4d, 13d, 14a, 14b, 14d; here "4b" is the 50k search p95 reading, NOT R-10's clause 4b "enforced in CI", which the 20 green runs above met -- controller ruling, wave 10 follow-up F3) are taken
by the controller in a held quiet slot after this round; the SQLite page cache is not changed in
wave 10; the two typing levers named above (the toolbar's whole-page re-render and the
per-keystroke draft snapshot) are deferred, and the snapshot is not touched.

## 8. Wave 10, follow-up F6: the switcher's body half

The quick switcher now fills the rest of its page from the search box's relevance pass when its
title tiers leave room (`notes.switcher_search`; why, per query:
`docs/notebook/switcher-recall-diagnosis.md`). A page the titles fill never asks it, and the two
budgeted switcher ops (`nvda setup`, `ntvds`) fill theirs from titles, so their code path is the
one 10A measured. The benchmark times the new path as two ops, a common body term (~30% of bodies)
and a rare one, which no title names.

Measured 2026-09-27 on this box, 50k tier, 20 reps after 2 warm-ups, `--budget search`:

| op | before F6 (tree `3c2356270`) p95 | after F6 (tree `7ee21a7fc`) p95 |
|---|---:|---:|
| switcher_search (word start) | 48.2 | 38.6 |
| switcher_search (fuzzy, in order) | 78.0 | 69.6 |
| switcher_search (body fallback, common term) | not timed (answered nothing) | 171.2 |
| switcher_search (body fallback, rare term) | not timed (answered nothing) | 68.4 |

Both runs read `VERDICT` on the budgeted ops only; the before run breached on the search box's
common-term relevance request (102.1, re-measured 100.5), a known miss (section 3), and the after
run passed. The before and after runs are different minutes of a shared box, so the interleaved
A/B (the pre-F6 `notes.py` loaded beside the new one, same process, same 50k file, alternating
rounds, 8 rounds x 5 reps) is the comparison to read: word start 32.3 -> 32.7 ms p50, fuzzy
45.8 -> 45.7, common body term 41.6 -> 105.9, a term in every body 37.0 -> 198.9, rare 35.6 -> 52.1.

The body half costs what the search box's own relevance request costs for the same query (it IS
that request, minus its count), on top of the title half: over the 100 ms search line for a body
term common in a 50k library that no title names. A bounded top-k read was prototyped and
measured no faster: the full-text ranked pass (bm25 over every match) is most of the cost, and a
bounded read still has to rank every match to be exact (`docs/notebook/proof/f6-switcher-body/perf/topk-probe.txt`:
equal answers on six queries, the top-k read 77.6 vs 59.3 ms p50 on the common term, 143.3 vs 144.5 on
a term in every body; re-run 2026-09-28 00:41 CT on the kept 50k file).

### Fix round 1: the two ops get lines of their own (2026-09-28)

Decided 2026-09-28 by the controller: the speed is accepted, with honest lines. Titles still
answer in ~39 ms; the body pass runs only when titles leave room; member libraries are orders of
magnitude below 50k. `perf-budgets.json` gains two budgets, one op each:

| budget | op | quiet 50k p95 | line |
|---|---|---:|---:|
| `switcher_body_common` | switcher_search (body fallback, common term) | 171.2 | 250 ms |
| `switcher_body_rare` | switcher_search (body fallback, rare term) | 68.4 | 100 ms |

**How the lines were chosen:** the smallest multiple of 50 ms at or above 1.4x the quiet p95
(239.7 -> 250; 95.8 -> 100, the search line itself). The factor was fixed before any further
reading. A loaded-box run (CPU at 90% from other work, discarded) read 273.1 and 139.3: over both
lines, so they are not loose. `tests/test_notebook_perf_budgets.py` derives each line from its
recorded reading by that rule, and proves each line bites (just over it breaches by name, just
under it does not).

**The levers, if a line breaches or a member's library makes this slow:**
1. **A second, later request from the palette.** Ask the title half on the keystroke (as today)
   and the body half on its own, later request, rendered below. The titles never wait for the
   bm25 pass; the body rows arrive a beat later. Cost: a second request per settled query and a
   second loading state.
2. **A match-count cap.** Skip or truncate the body pass when the full-text match set is larger
   than N notes (the match itself is cheap, 4.8 ms p50 for 14,978 matches at 50k, against 25.8 ms
   for the ranked pass over the same matches: `perf/fts-probe.txt`, rows D and A; the ranking is the
   cost). Cost: recall on very common words, the queries least likely to name one note.

### The raw output behind every number in this section (fix round 2, R-RAW)

Every reading above and below is in `docs/notebook/proof/f6-switcher-body/perf/`, copied byte for byte from
the runs. Its `README.md` maps each file to the code it measured (each JSON stamps `git_head` and
`git_dirty_paths` itself):

- **"before" column:** `before-50k.*` (`3c2356270`).
- **"after" column and the quiet 171.2 / 68.4 the lines are derived from:** `after2-50k.*` (`7ee21a7fc`).
- **Discarded loaded-box 273.1 / 139.3:** `after-50k.*`.
- **Interleaved A/B:** `ab-interleaved-quiet.json` (loaded run `ab-interleaved-loaded.json`, discarded), made by
  `ab_interleaved.py`.
- **Fix round 1 gate run** (`fr1-50k.*`): `--budget search --budget reads --budget tasks --budget
  switcher_body_common --budget switcher_body_rare`, VERDICT PASS. Switcher p95 readings:
  - word start 37.00 ms;
  - fuzzy 51.64 ms;
  - body common 108.35 ms, against its 250 ms line;
  - body rare 70.36 ms, against its 100 ms line.
- **Fix round 1 curve run** (`fr1-curve.*`), 1k to 50k:
  - body common: slope 0.779, last segment 0.816;
  - body rare: slope 0.698, last segment 0.652;
  - both are under the 1.1 / 1.3 lines;
  - the run's BREACH verdict names only count_notes, folder_note_counts, get_symbol_backlinks and list_tasks,
    which this lane does not touch.

## 9. Wave 10, lane PC: the scale curve (clause 14d) and the backlinks pass

Raw files: `docs/notebook/gate-runs/wave10-PC/`, committed before this section (765252933,
3309d7e08, 848144264, 0e933480d, b9bf0fe9a). The lane's own reading is that directory's `README.md`.

### What the curve breach was

The curve (`--curve`, the log-log slope of p50 over 1k / 5k / 10k / 25k / 50k; bounds fit <= 1.1,
last segment <= 1.3, unchanged) breached on `count_notes`, `folder_note_counts`,
`get_symbol_backlinks` and `list_tasks`, in both of the controller's 2026-09-29 runs.

The benchmark read every op through ONE long-lived connection with SQLite's default page cache
(2 MB) against a ~490 MB database at 50k. `diag-before-slopes.txt` runs the same ops under four
connection settings, and with a cache sized for the database, or with mmap, every op is linear or
better:

| op | shared (default cache): fit / last | cache 64 MB | mmap 512 MB | per-call |
|---|---|---|---|---|
| count_notes (whole library) | 1.26 / 3.02 | 0.93 / 0.69 | 0.83 / 1.03 | 0.32 / 0.51 |
| folder_note_counts | 1.12 / 2.29 | 1.03 / 0.61 | 0.94 / 1.04 | 0.34 / 0.49 |
| get_symbol_backlinks | 1.15 / 1.07 | 1.10 / 0.81 | 1.05 / 0.85 | 0.65 / 0.70 |

So the super-linear shape is the page cache spilling, not an algorithm. Production does not read
the notes store through one long-lived connection: `api/services/auth_db.get_connection` opens a
fresh one per call (`timeout=3`, WAL, foreign keys; no pool, no `cache_size`).

### Ruling (controller, under the owner's delegation, 2026-09-29)

Clause 14d's curve is read in **production's connection model**: `notebook_scale_benchmark.py
--curve --connection per-call`, which opens every timed read through `auth_db.get_connection()`
itself, pointed at the tier's database. The shared model stays the default and stays a diagnostic;
every budget line, and the promotion-gating latency and bytes checks, read exactly what they did.
The curve's bounds are not changed.

**Update, 2026-09-30 (ruling D22, controller, owner-delegated 2026-09-30):** the sentence above, "the shared model stays the default", is superseded. A bare `--curve` now measures the per-call model, and only that reading gates the verdict; the shared model runs automatically beside it as a reported diagnostic (`curve_diagnostic` in the JSON), its breach recorded and never hidden. An explicit `--connection` is honoured as asked. The bounds are still unchanged. See D22 in `docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`.

⚠️ A per-call reading includes the connection open, a roughly constant cost that flattens a
log-log slope. Production pays the same cost, which is why it is the right model; it is also why
a per-call PASS says the product does not grow super-linearly as a member experiences it, and does
NOT say the queries themselves are free of page-cache effects on a large library.

### The per-call reading

`curve-percall-1.*`, 2026-09-29 11:30 CT, tree `b5c26dea7`: **VERDICT PASS**, every op's fit
<= 1.1; the four former breaches read `count_notes` 0.354, `folder_note_counts` 0.428,
`get_symbol_backlinks` 0.542, `list_tasks` 0.791.

⛔ **Not a quiet reading.** Every one of its 20 load samples shows another session's test processes
(20-22) and CPU at 96-100% (`curve-percall-1-load.txt`). Load inflates every op's time, so the
absolute numbers mean nothing here; the slope reading stands only until a quiet re-read confirms
it, and that re-read is owed before the scorecard cites 14d as MET.

### The backlinks change (`dfadfcd57`)

`get_symbol_backlinks` used to run a COUNT pass and then a page pass over the symbol's note set,
looking every hit up in `idx_j2_notes_id_live` twice, and grouped every embed of the symbol to
decorate the page's rows. It now takes the total as the window count before the LIMIT
(`COUNT(*) OVER ()`) and reads the embed detail for the page's ids alone.

- **Speed:** measured A/B on the benchmark's seed at every curve tier (`diag-ab.*`), about half
  the time, with the same answer on every row. For example, at 50k with the default cache,
  26-38 ms before and 13-16 ms after.
- **Rails:** `tests/test_journal_two_backlinks_one_pass.py` checks the answer against an
  independent truth. `test_symbol_backlinks_look_up_each_hit_ONCE` checks that there is one pass,
  that the detail read is keyed by the page, and that the order names its id tiebreak.
- **Mutations:** `mutation-backlinks*.txt`.
- **The tiebreak `, n.id`:** it cannot be seen behaviourally on today's plan, because the note-id
  set is a UNION, which hands the ids over in id order. Measured: `mutation-backlinks-M3-tie.txt`.
  It is therefore railed on the SQL, as the trash order's tiebreak is.

**Rejected:** a covering index for the tasks list. It gave the same answers and was **5-7x
slower** (for example, 64 ms before and 351 ms after at 25k, `diag-ab.*`). It is not in the
product.

### Typing: which reading the 16 ms line binds (ruling D24, 2026-10-01)

The harness has two typing rows since lane TY4 (`tools/notebook_perf_harness.py --busy`):

- `typing_per_char`: wall-clock, keydown to the task after the `input` event. It includes the
  wait for the next display frame.
- `typing_busy_per_char`: the renderer main thread's task time per keystroke, from a trace with
  no wrappers. Idle time is not counted. GPU and compositor work off the main thread is not in it.

Measured on 2026-10-01 (`docs/notebook/perf-runs/ty-floor/README.md`; frame interval 16.7 ms,
headless Chromium):

| median of 3 runs, p95 | 1 paragraph | 1,000 | 2,000 |
|---|---:|---:|---:|
| `typing_per_char` (wall-clock) | 14.8 ms | 15.5 ms | 16.8 ms |
| `typing_busy_per_char` (busy) | 7.6 ms | 10.1 ms | 21.0 ms |

The wall-clock row barely moves across a 2,000-fold change in document size, and reads 14.8 ms
on a note that cannot be slow. Its tail is the frame interval. That is why three rounds of real
fixes moved its median and never its p95.

**Ruling D24** (`NOTEBOOK-10-OF-10-PLAN.md`, decisions table): the 16 ms line is read on
`typing_busy_per_char` p95. The wall-clock row stays in every report. The number in
`perf-budgets.json` is unchanged.

**Where that leaves clause 4d: NOT MET.** On the busy reading, 1,000 paragraphs is under the line
on all three runs (9.75 to 11.2 ms) and 2,000 paragraphs is over it on all three (19.5 to
21.1 ms). Those three busy runs started on a BUSY box (another session's tests), so the absolute
numbers are not a verdict; the shape across sizes is the finding. A quiet-box busy reading is
owed, and the work is at 2,000 paragraphs: busy p50 grows from 5.0 ms at one paragraph to
14.9 ms at 2,000, so something in a keystroke still scales with the size of the note.

⚠️ The harness's own budget check still reads `typing_per_char` (`summarize()` was not changed
by TY4). Until it is moved to the busy row, its typing verdict line is the wall-clock one and is
not the clause's reading.

**Update, 2026-10-01 (lane TY6):** the line above is superseded. `summarize()` now reads the
typing budget off `typing_busy_per_char` p95 (`summarize_busy`'s rows, which since this lane
carry the budget up to 2,000 paragraphs the same way `note_open`'s rows carry theirs), exactly
per ruling D24. `typing_per_char` is still produced and written on every run, with
`budget_ms: None` ("n/a" in the markdown table) and a note that it is not the budget's reading.
A run with no `--busy` pass, or one where `--busy` shared a context with `--attribute` (an
unclean, wrapper-loaded trace -- `run_live`'s own caveat), now reports the typing budget
INCONCLUSIVE, never a silent pass and never a breach read off the wall-clock row. See
`tools/notebook_perf_harness.py`'s `summarize()`/`summarize_busy()` and
`tests/test_notebook_perf_harness.py`'s D24 cases.

### Quiet re-reads, 2026-10-02 (clauses 14d and 4d)

**14d, the curve: the owed quiet re-read exists.** `gate-runs/wave10-PC/curve-d22-q2.*`, a bare
`--curve` (so the per-call model, ruling D22), tree `93c4bed77`, 05:47-05:50 CT. The box was lock
FREE and load QUIET at both ends (`curve-d22-q2-box.txt`). **VERDICT PASS**: every op's fit is at
or under 1.1 and every last segment at or under 1.3. The shared model ran beside it as the
diagnostic and recorded 5 breaches (count_notes, folder_note_counts, get_symbol_backlinks,
list_tasks), not gating. Reading: `gate-runs/wave10-PC/README-quiet.md`. The bounds are unchanged.

**4d, typing: still NOT MET, because two quiet readings of the same code disagree.**
`perf-runs/ty8/ab/` holds six busy-time runs, interleaved A1 B1 A2 B2 A3 B3, 05:08-05:32 CT, each
QUIET at both ends. A is the editor code this tree ships. B adds TY8's change to
`memoStringifyBody.js`, which is not on this tree. Every one of the 18 p95 cells is under 16 ms.
At 2,000 paragraphs, A reads 10.60 / 10.93 / 10.15 ms and B reads 9.89 / 12.18 / 11.66 ms. But
L15's q1 run on 2026-10-01 at 19:28 was also QUIET at both ends by the same lock tool, on the same
editor code, and read 19.56 ms at 1,000 paragraphs and 17.12 ms at 2,000. Nothing measured explains
the gap; unmarked background load is a hypothesis (`perf-runs/ty8/README.md`, "Reading"). The
clause is cited as MET only once another quiet hour agrees with one side. The line in
`perf-budgets.json` is unchanged.
