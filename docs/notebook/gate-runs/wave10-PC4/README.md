# Wave 10, lane PC4 — is `get_symbol_backlinks` genuinely super-linear 25k→50k?

Branch `feat/notebook-w10-pc4`, base `b529c8a78`. Raw artifacts committed in the prior
commit, before any of the interpretation below (R-RAW): `curve-pc4-1.{log,json}`,
`curve-pc4-2.{log,json}`, `isolated-backlinks-timing.{py,log,json}`,
`isolated-backlinks-explain.{py,log}`.

## The question this lane was handed

Two readings taken earlier the same day on `feat/notebook-w10-l16`, same op, same branch,
both "on a loaded box":

- `curve-d22-1.log`: **PASS**, `get_symbol_backlinks` slope 0.568, last segment 1.093.
- `curve-d22-q.log`: **BREACH**, `get_symbol_backlinks` last segment 25,000→50,000 slope
  1.360 > 1.3 (13.38 → 34.35 ms).

Both readings are per-call (D22's gating model). The question: is the second one a real
algorithmic super-linearity the first one's reps happened to miss, or is it noise acting
on a handful-of-milliseconds number under a busy box?

## The plan, before

1. Read `get_symbol_backlinks` (`api/services/journal_two/notes.py:2479`) and its query
   plan against the benchmark's own seeded database (never `C:\data`).
2. Time it in isolation at 25k and 50k, several independent rounds, many reps, one
   process, per-call connection model — enough samples that a single noisy call cannot
   decide the answer the way a 20-rep curve p50 can.
3. **If genuinely super-linear**: find which of (a) a scan over all of the symbol's notes
   before the LIMIT, (b) a sort without an index, (c) a window function over the whole
   set, (d) the embed lookup is the cause; fix it so cost tracks the page or the symbol's
   hit count, not the library; add an equivalence test + a test in the existing backlinks
   file; mutation-prove it; any new index goes through `_PERF_INDEXES` /
   `ensure_schema` (idempotent, `CREATE INDEX IF NOT EXISTS` with a NEW name, built in a
   per-index try/except loop so a failure never crashes a boot), and say how long it
   costs on an existing 50k-note table.
4. Look at the shared-model diagnostic's other breaches (`count_notes`,
   `folder_note_counts`, `list_tasks`, `tag_counts`, `tag_tree`) with the same standard.
5. Run the curve twice (per-call, gating), box status at both ends of each, and write
   this file.

## The plan, after

**Nothing in `notes.py` or `db.py` changed.** The isolated timing (150 per-call samples
per tier, two independent executions) and the `EXPLAIN QUERY PLAN` both say the same
thing: `get_symbol_backlinks` is not super-linear between 25k and 50k. The `1.360`
reading did not reproduce in two fresh full curve runs today, nor in two isolated
per-call timing passes with far more samples, all taken on a box that was *at least as
busy* as whatever produced the original breach. The shared-model diagnostic's other five
named ops (`count_notes`, `folder_note_counts`, `list_tasks`, `tag_counts`, `tag_tree`)
were re-examined by query plan and re-measured under per-call; all five pass cleanly
under per-call in both of today's runs, and the shared-model breach is the already-
documented instrument property (perf-budgets.md §9), reconfirmed below, not a new
finding. No index was needed, so none was added — §"If an index had been needed" below
answers the task's question about cost anyway, from a real measurement.

## 1. The query plan (`EXPLAIN QUERY PLAN`, against the benchmark's own seeded 50k db)

Full output: `isolated-backlinks-explain.log`. The two statements `get_symbol_backlinks`
runs:

```
SEARCH j2_note_embeds   USING INDEX idx_j2_note_embeds_user_sym   (user_id=? AND symbol=?)
SEARCH j2_note_mentions USING INDEX idx_j2_note_mentions_user_sym (user_id=? AND symbol=?)
SEARCH n USING COVERING INDEX idx_j2_notes_id_live (id=? AND user_id=? AND deleted_at=?)
USE TEMP B-TREE FOR ORDER BY
```

and the page's embed-detail query:

```
SEARCH j2_note_embeds USING INDEX idx_j2_note_embeds_user_sym (user_id=? AND symbol=?)
USE TEMP B-TREE FOR GROUP BY / group_concat(DISTINCT)
```

No full-table scan anywhere. The symbol's note-id set is answered from the two sidecar
indexes (never a correlated per-note probe — the `_symbol_note_ids_sql` fix this is
already built on), and every lookup into `j2_notes` is a covering-index hit by `id`
(`idx_j2_notes_id_live`, the lane-10A index built for exactly this read). The one
honest cost is **`USE TEMP B-TREE FOR ORDER BY`**: `COUNT(*) OVER ()` must see the whole
ordered result before the `LIMIT` can cut it, so the full matching set — every live note
that embeds or mentions the symbol — is materialized and sorted by `updated_at DESC, id`
before the page is taken. That cost is `O(k log k)` where `k` is the **symbol's hit
count**, not the library size — which is exactly what clause 14d's cause list (2) asks
the cost to track.

Measured directly against the seeded 50k db: `k` (distinct notes embedding or mentioning
`AMD`, the benchmark's `embed_symbol`) = **5,000**, library `n` = 50,000 — `k/n = 0.10`.
That ratio is a property of the benchmark's seed (`AMD` = `_TICKERS[0]`, and both the
embed and mention generators in `_seed` can only ever tag `AMD` on the same `i % 10 == 0`
subset, because `len(_TICKERS) == 10`), **not** of the product: `k` grows with `n` here
because the synthetic seed ties one ticker to a fixed 10% of the library, which is why a
query whose true cost is `O(k log k)` can still look library-shaped in this particular
benchmark. A real member's single-ticker hit count does not grow in lockstep with their
whole library the way this synthetic seed's does.

## 2. Isolated per-call timing, 25k vs 50k, one process, several rounds

`isolated-backlinks-timing.py` reuses `tools.notebook_scale_benchmark._seed` (the real
schema, the real FTS/index triggers) to build fresh 25k/50k databases, then times
**only** `get_symbol_backlinks`, through the per-call model (`auth_db.get_connection()`
pointed at the tier db, a fresh connection per call — the same `_auth_db_is` +
`per_call()` closure `run_tier` itself uses), 5 independent rounds × 30 reps (2 warmup
each) = 150 timed samples per tier. Correctness is asserted every round (`count ==` the
seed's own `backlink_notes` truth).

Two separate executions, both on this box while it was `HELD`/`BUSY` with another lane's
six-shard gate plus several vitest/pytest runs (the same load class, or heavier, than
either original curve reading):

| run | 25k p50 (150 samples) | 50k p50 (150 samples) | ratio | **log2 slope (= "last segment")** |
|---|---:|---:|---:|---:|
| isolated A | 13.971 ms (p95 18.927, min 9.939, max 24.006) | 22.348 ms (p95 29.742, min 17.944, max 32.799) | 1.600 | **0.678** |
| isolated B | 15.903 ms (p95 21.614, min 11.388, max 27.508) | 27.983 ms (p95 34.261, min 19.728, max 43.195) | 1.760 | **0.815** |

Both comfortably under the 1.3 last-segment bound, consistent with each other, and
consistent with `curve-d22-1.log`'s own PASS (1.093). The within-tier spread
(round-median spread 2–5 ms on top of a 14–28 ms median) is exactly the kind of noise a
single 20-rep curve p50 can land on either side of 1.3 by chance when the true value is
this close to a handful of milliseconds — which is what happened between `curve-d22-1`
(1.093, PASS) and `curve-d22-q` (1.360, BREACH): both are plausible single draws from the
same noisy distribution my 150-sample measurements describe.

## 3. Verdict: is it genuinely super-linear?

**No.** `get_symbol_backlinks` tracks its symbol's hit count through two correct index
lookups and one honest, hit-count-bounded sort (`O(k log k)`, no scan, no missing index,
no window-over-the-whole-library beyond what the `COUNT(*) OVER ()` + `ORDER BY`
contract requires). The one BREACH reading was noise on a loaded box acting on absolute
times in the 13–34 ms range — two fresh curve runs and two isolated 150-sample timing
passes, all taken on an equally or more loaded box today, never reproduced it. **No fix
was made, because none is needed.**

### If an index had been needed (the task's question, answered anyway)

No new index is being added. For the record: `_PERF_INDEXES` in
`api/services/journal_two/db.py` is the existing, already-safe path — built inside
`ensure_schema`'s own per-index `try/except` loop (a failure is logged, never a startup
crash), as `CREATE INDEX IF NOT EXISTS <name>` under a **new name** (an existing index's
definition can never be changed in place — `IF NOT EXISTS` skips a name that already
exists, which is why every index this file has ever revised has a new name, never a
`DROP`+recreate on the request path). That makes it idempotent and safe to ship against
an existing production `auth.db`: the boot that first sees the new index name builds it
once, in the background of the app's own startup, and every boot after that is a no-op.
**Cost, measured directly**: building a representative index of this shape
(`idx_j2_notes_id_live`'s own five-column definition) from scratch against an existing,
populated 50,000-row `j2_notes` table took **0.366 s** on this box (dropped and
recreated against the isolated-timing script's own 50k seed). Production's `j2_notes`
holds every member's notes in one table, so the real number scales with the table's
*total* row count across all members, not one member's 50k — but at the per-member scale
this task measures, a new index is cheap, and `ensure_schema` already builds every index
in `_PERF_INDEXES` the same way on the live `auth.db` today.

## 4. The shared-model diagnostic breaches (recorded, never gating — D22)

Both of today's curve runs re-ran the shared-connection diagnostic automatically (bare
`--curve`, no explicit `--connection`). Per perf-budgets.md §9, this diagnostic answers
the queries through **one long-lived connection** with SQLite's **default ~2 MB page
cache** against a database that grows past it (203 MB at 25k, ~407 MB at 50k in these
seeds) — a property of the benchmark's own instrument, never of production, which reads
the notes store through a fresh `auth_db.get_connection()` per call (D22's gating model)
and never accumulates a stale cache across a growing file.

| op | query plan (confirmed, `isolated-backlinks-explain.log`) | run 1 shared slope / last | run 2 shared slope / last | run 1/2 **per-call** slope / last (gating) |
|---|---|---:|---:|---:|
| `count_notes` | `SEARCH ... USING COVERING INDEX idx_j2_notes_live_folder_title` — no scan | 1.119 / **2.679** | 1.128 / **2.421** | 0.574/0.699 · 0.432/0.125 |
| `folder_note_counts` | same covering index, `GROUP BY folder_id` off it — no scan | 1.136 / **2.128** | 1.074 / **2.249** | 0.709/0.322 · 0.360/0.328 |
| `list_tasks` | `SEARCH ... USING INDEX idx_j2_notes_live_tasks` (partial, `instr(body_json,'taskItem')>0`) — no scan | **1.157** / 0.837 | **1.207** / 0.865 | 1.005/0.951 · 0.673/0.579 |
| `get_symbol_backlinks` | see §1 — no scan | **1.232** / 0.886 | 1.089 / **1.483** | 0.770/0.539 · 0.470/0.361 |
| `tag_counts` | covering-index grouped pass (`tag_counts_and_tree`) | 1.063 / 1.033 (under bound) | 1.011 / 1.035 (under bound) | 0.918/0.381 · 0.578/0.429 |
| `tag_tree` | same pass | 1.076 / 1.096 (under bound) | 1.025 / 1.073 (under bound) | 1.005/0.663 · 0.675/0.589 |

(Bold = over its bound in that column; `slope` bound 1.1, `last segment` bound 1.3.)

**Verdict per op, shared-model diagnostic:**

- **`count_notes`, `folder_note_counts`** — breach in BOTH of today's runs, every time on
  the last segment specifically (2.1–2.7×, i.e. the shared connection's cache spills
  somewhere between 25k and 50k on this box). Confirmed by query plan: both are answered
  entirely from `idx_j2_notes_live_folder_title`, a covering index, with no table touch.
  **Cause: the benchmark's single fixed-cache long-lived connection against a growing
  on-disk file (perf-budgets.md §9's own cache-size/mmap A/B already showed this —
  `cache 64 MB` or `mmap 512 MB` makes both linear again on the SAME query plan).** Not
  an index or query defect. No fix made: production never runs this connection model
  (D22), and per-call reads these two ops comfortably inside bounds in both of today's
  runs (0.43–0.71 / 0.13–0.70).
- **`list_tasks`** — breach on the whole-curve slope (1.16–1.21) in both runs, never on
  the last segment. Query plan confirms the partial index is used (no body scan). The
  documented residual Python cost (`json.loads` of every task-bearing body + the task
  walk, perf-budgets.md §2/§9) is unchanged by connection model and is already recorded
  as the known lever (a maintained task index, out of scope for this wave). Per-call
  passes comfortably in both runs (0.67–1.01 / 0.58–0.95).
- **`get_symbol_backlinks`** — breached on a DIFFERENT metric in each run (slope in run
  1, last segment in run 2), which is itself evidence this is sampling noise on the
  shared instrument rather than a stable shape: a real super-linear curve breaches the
  same way run over run. Same cause and same non-finding as §1–3 above.
- **`tag_counts`, `tag_tree`** — named as breaching in the brief's description of
  earlier runs today, but did **not** breach in either of my two reruns (both land just
  under 1.1 slope / 1.3 last-segment). This is the same instrument-noise signature as
  the rest of this table: which ops cross the shared model's line varies run to run on a
  loaded box. No cause investigation beyond §9's existing one was needed since nothing
  reproduced here.

**No code change for section 3.** The shared model is deliberately left at SQLite's
default cache settings as a diagnostic sentinel — perf-budgets.md §9 already ruled
"production does not change its cache_size/mmap_size on the strength of this ruling",
and tuning the *benchmark's* shared-connection cache would blunt a working diagnostic for
a connection model production does not use, not fix a product defect.

## 5. The curve, twice, gating verdict both times

Command (identical both times): `python tools/notebook_scale_benchmark.py --curve
--thresholds docs/notebook/perf-budgets.json --json <out>`. The `MEASURING.flag`
coordination file was created immediately before each run and deleted immediately after;
no other lane's flag was present at either start.

| | run 1 (`curve-pc4-1`) | run 2 (`curve-pc4-2`) |
|---|---|---|
| **box status, START** | `lock: HELD` (pid 45260, `int-w10`, `gate_shards.py --shards 6`); `load: BUSY` — 5 marked processes (gate 1, vitest 4, pytest 0) | `lock: HELD` (same `int-w10` holder); `load: BUSY` — 14 marked processes (gate 1, vitest 12, pytest 1) |
| **box status, END** | `lock: HELD` (same holder, unchanged); `load: BUSY` — 14 marked processes (gate 1, vitest 12, pytest 1) | `lock: HELD` (same holder, unchanged); `load: BUSY` — 7 marked processes (gate 1, vitest 4, pytest 2) |
| wall time | 5m57.8s | 4m46.3s |
| correctness | all 5 tiers: `OK all correctness checks passed` | all 5 tiers: `OK all correctness checks passed` |
| **VERDICT** | `PASS — curve: every op's slope <= 1.1 (connection=per-call); diagnostic shared: 6 breach(es) recorded, not gating` | `PASS — curve: every op's slope <= 1.1 (connection=per-call); diagnostic shared: 6 breach(es) recorded, not gating` |
| `get_symbol_backlinks` (per-call, gating) | slope 0.770, last segment 0.539 | slope 0.470, last segment 0.361 |

**Neither run was quiet.** `int-w10`'s gate held the box lock throughout both runs, and
the marked-process count (an independent lane's vitest/pytest, not mine) ranged from 5 to
14. Per this repo's own standing rule, a loaded run's PASS is evidence toward "not
super-linear", never a certificate that clause 14d is MET — that still wants one quiet
re-read, same as the per-call reading already on record in perf-budgets.md §9
(`curve-percall-1`, also flagged "not a quiet reading… owed before the scorecard cites
14d as MET"). What two independent, fully-reproduced PASSES on an *equally or more*
loaded box than the one `curve-d22-q.log` ran on DO establish: the single BREACH reading
this lane was asked to investigate does not reproduce, and is not a stable product
defect.

## Plain verdict per op

| op | genuinely super-linear 25k→50k? | evidence |
|---|---|---|
| `get_symbol_backlinks` (per-call, gating) | **No.** Noise on a loaded box, not reproduced. | 2 curve PASSes (0.539, 0.361 last segment) + 2 isolated 150-sample passes (0.678, 0.815) + EXPLAIN QUERY PLAN (no scan, no missing index) |
| `count_notes` (shared, diagnostic only) | No — benchmark-instrument artifact (page-cache spill on a long-lived connection), not an algorithm. Per-call (gating) passes both runs. | query plan (covering index, no scan) + perf-budgets.md §9's cache-size/mmap A/B |
| `folder_note_counts` (shared, diagnostic only) | Same as `count_notes`. | same |
| `list_tasks` (shared, diagnostic only) | No new super-linear shape; same documented residual Python cost (json.loads + task walk), connection-model independent. Per-call passes both runs. | query plan (partial index, no scan) |
| `tag_counts`, `tag_tree` (shared, diagnostic only) | Did not reproduce a breach in either of today's runs. | re-measured twice, both under bound |

Clause 14d's curve, under the production (per-call) connection model D22 names as
gating, is **PASS** on both of today's runs — but, per this repo's own rule, that is not
cited here as "14d MET": both runs were taken on a box another lane's gate held BUSY
throughout. A quiet re-read is the one thing still owed before that citation is made.
