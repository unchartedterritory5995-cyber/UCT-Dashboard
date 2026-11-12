# RS component ranks: restating the stored history (IBD-style 6M / 9M / 12M)

On 2026-11-11 the three long component ranks of the RS rating history changed meaning:

| Column | Before | Now |
|---|---|---|
| `m1`, `m3` | percentile of the plain 21- and 63-bar return | unchanged |
| `m6`, `m9`, `m12` | percentile of the plain 126-, 189- and 252-bar return | percentile of a recency-weighted close ratio, newest quarter counted double: `m6 = (2 R63 + R126) / 3`, `m9 = (2 R63 + R126 + R189) / 4`, `m12 = (2 R63 + R126 + R189 + R252) / 5`, `Rn = close / close[-n]` |
| `ibd` (the RS Rating) | 40/20/20/20 composite | unchanged |

Why: 61 Deepvue readings (production fit, 2026-11-10 close) scored against three methods. The weighted blend
tracked Deepvue's order far better at 6M, 9M and 12M and changed nothing at 1M and 3M. Deepvue documents its 1M as
unweighted, its 3M as equal weighted and its 6M and 12M as recency-weighted, without weights. The math lives in
`api/services/rs_weighted_return.py` (`IBD_STYLE_COMPONENT_TERMS`, the one place RS lookbacks may be declared) and
`rs_history.component_values`.

A component needs its WHOLE window: a stock with 150 bars has a 6M rank and no 9M or 12M rank, as before.

## Why the stored history must be restated

The stored sessions (about a year) still hold the plain-return `m6` / `m9` / `m12`. Reads that mix the two meanings
are wrong, so one command rewrites exactly those three columns for the sessions already stored. Nothing else is
written: `ibd`, `fast`, `m1`, `m3`, `score` and `bars` are never touched.

## Order

1. Merge the PR. Wait for the master deploy gate and the production deploy.
2. DRY RUN (reads, writes nothing, takes the bars-read time of a backfill, a few minutes):

   ```
   MSYS_NO_PATHCONV=1 railway ssh --service web -- "/opt/venv/bin/python -m api.services.screener.rs_history --backfill-days 260 --restate-ranks --dry-run"
   ```

   Read the last line. A clean line ends `ok=True` with `reason=None`. It prints counts only:
   `stored`, `todo`, `checked`, `drift`, `hard`, `mismatches`. Use the same `--backfill-days` you used for the
   original backfill or more (the span only chooses which stored sessions are in scope; 260 covers all 254).
3. If the dry run ends `reason=would_change_other_values`, nothing was written and the receipt shows what drifted.
   `ibd`, `m1` and `m3` are recomputed from today's bars and compared with the stored values; a rank that moved by one
   point is drift, anything bigger, a stored name with no bars today, or a name today's split guard would skip is a
   hard mismatch. Each kind is allowed up to 1 % of the rows checked. If the count is a little over and the cause is
   understood (for example a few delisted names), rerun with `--max-drift-share 0.03` (never above 0.05).
4. REAL RUN (same command without `--dry-run`). Resumable: each session commits with a row in
   `rs_history_restated`; if the run is cut off (a web deploy restarts the pod), run it again and it continues.
   `--max-sessions N` limits one invocation.
5. Verify: run the dry run again. It must print `todo=0` and `reason=nothing_to_do`.

## What a stored name that cannot be restated gets

A name with no bars window today, or one the split guard would skip, is allowed only inside the 1 % allowance and gets
`NULL` in `m6` / `m9` / `m12` for that session. It never keeps an old-meaning number.

## Cached chart payloads

The chart's RS payload is cached per ET day and is not keyed on the rating history. After the real run, a chart opened
earlier the same day can show the old 6M / 9M / 12M ranks until the next session close or the next web restart. The
nightly 04:15 ET job writes new-meaning ranks from the day this ships.

## Rollback

Treat the real run as one-way: the old plain-return `m6` / `m9` / `m12` of a restated session are not kept. If you want a
restore point, take a consistent copy of `screener.db` on the pod before step 4 (a `VACUUM INTO` copy, never a plain file
copy of a WAL database). Reverting the PR alone changes how new sessions are written; it does not put the old values back
in the sessions already restated.

# The 3M rank (2026-11-12): equal-weighted average of the 1-, 2- and 3-month returns

A day after the long ranks changed, the 3M rank changed too:

| Column | Before | Now |
|---|---|---|
| `m1` | percentile of the plain 21-bar return | unchanged |
| `m3` | percentile of the plain 63-bar return | percentile of the equally weighted average of the 21-, 42- and 63-bar close ratios: `m3 = (R21 + R42 + R63) / 3`, `Rn = close / close[-n]` |
| `m6`, `m9`, `m12`, `ibd` | | unchanged (the previous section) |

Why: the production fit against the same 61 Deepvue readings (2026-11-12) tested seven definitions of 3M and six of 1M.
The equal-weighted average beat the plain 63-bar return clearly (rank correlation 0.856 to 0.994, mean miss 10.2 to 6.9
points on our universe) and Deepvue documents its 3M as "equal weighted". 1M had no candidate that beat the plain return.
Averaging the ratios or the percentage returns orders stocks identically; the ratio form matches the other blends. The
math lives in `api/services/rs_weighted_return.py` (`EQUAL_WEIGHT_COMPONENT_TERMS`). A stock needs the 63-bar window: one
with 63 closes or fewer has no 3M rank.

The remaining gap to Deepvue (ours reads about 6 points lower) is the universe: we rank about 3,400 liquid stocks and
Deepvue ranks about 6,600. That is a separate decision and this change does not touch it.

## Restating the stored history for 3M

Same command, one flag more. It has its own marker table (`rs_history_restated_m3`, method `m3_eqwt_v1`), so it is
independent of the long restate: either can run first, and finishing one never marks the other done. It rewrites only
`m3`. The check recomputes `ibd` and `m1` always, and `m6`/`m9`/`m12` for the sessions that already carry the long marker
(a column still holding an old meaning is not compared, because it would only produce false mismatches). The same
allowance applies (1 % drift, 1 % hard).

Each session's commit is now retried with a growing wait when SQLite answers `database is locked` (6 attempts, 5 s
doubling, 60 s cap): the first long restate died at session 249 of 254 on one lock. A retry never leaves half a session
behind, because a session is one transaction.

1. Merge the PR. Wait for the master deploy gate and the production deploy. From that deploy the nightly job stores the
   new `m3` for new sessions; the sessions before it still hold the old one until step 3, so do not wait long.
2. DRY RUN (read-only, a few minutes):

   ```
   MSYS_NO_PATHCONV=1 railway ssh --service web -- "/opt/venv/bin/python -m api.services.screener.rs_history --backfill-days 260 --restate-ranks --columns m3 --dry-run"
   ```

   A clean last line ends `ok=True`; `reason=would_change_other_values` means nothing was written (see step 3 of the
   previous order).
3. REAL RUN: the same command without `--dry-run`. About 18 minutes; the shell moves it to the background after two
   minutes, which is normal. If it is cut off, run it again and it continues from the first session without a marker.
4. Verify: the dry run again must print `todo=0` and `reason=nothing_to_do`.

Nothing in the screener, chart or alerts needs a flag: the new meaning shows as soon as a session holds it. Saved screens
that filter on `Rank 3M` change who they include once the rows are restated, and a chart opened earlier the same day can
show the old 3M until the next session close (the RS payload is cached per ET day).

Rollback is as one-way as the long restate: the old `m3` of a restated session is not kept. Take a `VACUUM INTO` copy of
`screener.db` first if you want a restore point.

# The rated universe (2026-11-12): every non-ETF stock with a recent price

Owner decision, "everything until the indicator is 100% perfect". The nightly rating ranked each stock against the
3,418-name cap universe. It now ranks against **every non-ETF ticker that holds a daily bar**, about 6,000 names on any
session (`rs_history.ranking_universe()`; each session still keeps only names with a bar inside the five-calendar-day
freshness window and enough closes for the term, exactly the rules it always used).

| | Before | Now |
|---|---|---|
| Ranked set | cap universe minus ETFs (3,418 names) | every rankable symbol with a fresh daily bar, minus ETFs (about 6,000) |
| Warrants, rights, units, preferreds | in the cap universe only if listed there | in |
| Penny / thin names | out unless in the cap universe | in (no price or volume floor) |
| Index and crypto feeds in `bars.db` (`$SPX`, `^VIX`, `X:BTCUSD`, `VIX`) | out | out (`rankable_symbol`) |
| ETFs | rated by interpolation, never ranked | unchanged |
| Methods per horizon, composite weights, split guard | | unchanged |
| The hourly "fast" rank (`rs_ranking`) | cap universe | unchanged |

Why: the production fit against 61 Deepvue readings (2026-11-12, `u5d_fit_pod.py`) ranked the same methods over eight
universe definitions. Ranked over the cap universe our ratings sat 5 to 8 points BELOW Deepvue's at every horizon (it
ranks every stock); ranked over everything they sit 3.0 points from Deepvue's on average, bias +0.1, 285 of 305
comparisons (93 %) within 10. Removing warrants, rights, units and preferreds moved the mean miss by 0.02 points, a $1 or
$5 price floor made it 2.7 and 7.4 points worse, and a $250k dollar-volume floor 2.6 worse; the simplest rule won. The
record is `tests/fixtures/indicators/rs_parity_deepvue_universe.json`.

## What members will see

* Ratings rise about 4 to 8 points for the same stock (thin names rank below most liquid ones, so a liquid name beats
  more of the field than before). The chart's RS tag and ranks strip, the RS badge, the screener's `RS` and `Rank`
  columns, the RS lists and the Compass RS answers all read this rating once `RS_RANK_IBD_ENABLED` is on (it is).
* Stocks outside the cap universe now carry ratings (about 3,200 more names). The by-symbol rank map appends them like
  ETFs (`rs_rank_source = "ibd"`, no hourly score).
* Saved screens and the seven starter screens that threshold on `rs_rank` or a `Rank` column change membership.
* The RS Leaders / Emerging lists keep their published liquidity floors, so thin names do not enter them.

## Restating the stored history against the wide universe

One command re-ranks EVERY stored session (254) for ALL six rating columns (`ibd, m1, m3, m6, m9, m12`) against the wide
universe as of that session. It calls the same `compute_ratings` the nightly job calls, over the same candidate list, so
the stored history cannot disagree with tonight's rows. **It also writes the long and the m3 markers, so the owner does
NOT run the m3-only restate (`--restate-ranks --columns m3`): this one rewrites `m3` too.**

What it writes, one transaction per session (retried with a growing wait on `database is locked`, the helper from #1133):
an UPSERT of the rating columns, `score` and `bars` for every ticker rated that session (a stock the cap universe never
held is a NEW row; an ETF row is rewritten because its interpolation distribution moved); `NULL` ratings for a stored
ticker that no longer has a window or is split-guarded (never an old-universe number); the session's marker in
`rs_history_restated_universe` (method `universe_u1_v1`) and in the two older marker tables. The hourly `fast` value is
never touched. About 3,200 new rows per session, so the table grows by roughly a million rows.

It REFUSES, writing nothing, when (a) a session would rank fewer than 3,000 names or its ranked count is outside 15 % of
the median session's (`--universe-band`, 0.02 to 0.5): a stale bars store or a half-listed night; (b) on a real run, more
split lists are unknown than the backfill allows (the lists it did fetch are kept; run it again). The values change by
design, so the drift check of `--restate-ranks` does not apply: the last line prints the shift instead.

Order:

1. Merge the PR. Wait for the master deploy gate and the production deploy. From that deploy the nightly job ranks against
   the wide set; sessions before it keep the cap-universe ratings until step 3, so do not wait long.
2. DRY RUN (read-only; it reads about 13,000 tickers' bars and ranks every session, roughly 25 minutes; the shell moves
   it to the background after two minutes, which is normal):

   ```
   MSYS_NO_PATHCONV=1 railway ssh --service web -- "/opt/venv/bin/python -m api.services.screener.rs_history --backfill-days 260 --restate-universe --dry-run"
   ```

   Read the last line before the `receipt {...}`:
   `ranked_min / ranked_median / ranked_max` (about 5,500 to 6,700 is plausible), `new_rows` (about 800,000 over 254
   sessions), `shift_mean` (expect +4 to +8), `shift_over15` (the share of stocks that moved by more than 15 points),
   `split_unknown` (a dry run reads stored answers and the cache only: expect about 3,000 unknown, which the real run
   fetches), `reason=None` and `ok=True`. A `reason=implausible_universe` line names the sessions: nothing was written;
   send me the counts.
3. REAL RUN: the same command without `--dry-run`. It first fetches the ~3,000 missing split lists (they are kept as it
   goes; the 2026-11-07 backfill fetched about 9,500 lists in a little over an hour, so ~3,000 is roughly 20 to 25
   minutes), then ranks and writes newest first. Expect about an hour in all (unmeasured). If a deploy interrupts it or it ends
   `reason=split_lists_unknown`, run the same line again: it continues from the first session without a marker.
4. Verify: the dry run again must print `todo=0` and `reason=nothing_to_do`.

Memory: the series are held as typed arrays (12 bytes a bar), about 90 MB for the whole universe, not the ~500 MB two
lists of Python floats would take.

Cached chart payloads: the chart's RS payload is cached per ET day, so a chart opened before the real run can show the
old ratings until the next session close or the next web restart.

Rollback: the cap-universe ratings of a restated session are not kept. Take a `VACUUM INTO` copy of `screener.db` on the
pod before step 3 if you want a restore point (a copy, never a plain file copy of a WAL database). To stop ranking
against the wide set without touching history, revert the PR: new sessions are written against the cap universe again,
and the already-restated sessions stay as they are.
