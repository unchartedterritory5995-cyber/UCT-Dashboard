---
id: WISDOM-CAPTURE-METHODOLOGY-V1
title: D12 daily capture and archive — methodology v1
status: current
generated: 2026-09-13
owner: stream S-A (api/services/wisdom/capture)
authority: docs/wisdom/CONTRACTS.md §5, §6.1 win on any conflict
---

# D12 daily capture and archive — methodology v1

The product overwrites or purges a great deal of what a future replay or a
per-call context read needs: the wire payload is overwritten on every push,
`screener_rows` and RS ranks are current-only, tweets are deleted after 7 days,
`pattern_detections` after 120, the intraday breadth path after 7. D12 archives
each of those, every day, to R2, and records one health row per dataset per run
so that "the capture never ran" and "the capture found nothing" are different
facts.

Code: `api/services/wisdom/capture/` (readers in `families/`, the one registry in
`families/__init__.py`). Admin: `GET /api/admin/wisdom/capture/health`.

## 1. Datasets

`row_count` is what the health verdict counts; it is defined per dataset because
"a row" means different things.

| dataset | source (read-only) | slot (ET) | as_of | row_count | lost at source by |
|---|---|---|---|---|---|
| `detections` | `pattern_detections`, `last_seen_at` in (watermark, 00:17], bounded to `memory.ACTIVE_WINDOW_SECS` on the `detected_at` index | daily 00:17 | ET date of the slot | detection rows (streamed, 5,000-row shards + manifest) | 120-day prune at 00:40 |
| `detection_outcomes` | `pattern_outcomes`, `resolved_at` in (watermark, 00:17] | daily 00:17 | ET date of the slot | outcome rows | deleted with their detections |
| `screener` | `screener_rows` (streamed) + `snapshot_db.describe_rows` | daily 05:43 | median `bars_asof` | rows | rebuilt nightly |
| `finviz` | `screener_finviz.json` (parsed; `meta.source_sha256` of the bytes) | daily 05:43 | ET date of the artifact's own `as_of` | tickers | overwritten 02:45 |
| `themes` | `theme_db.get_all_themes()` + seed version/hash | daily 06:13 | ET date of the run; **hash-on-change** | holdings (owner + engine) | wiped on reseed |
| `tweets` | `tweet_store.feed(official_only=True)` | hourly :29 | ET date of (slot − 1 h) | posts that ET day | deleted after 7 days |
| `wire` | `engine._load_wire_data()` (retried once) | mon-fri 16:52 | the payload's own `date` | top-level keys | overwritten per push |
| `candidates` | `engine.get_candidates()`, counted by `engine.candidate_rows()` | mon-fri 16:52 | envelope `market_date` | candidate rows | overwritten daily |
| `rs` | `rs_ranking.cached_rank_map()` — never `compute_rs_scores` | mon-fri 16:52 | session of the run | tickers | cache, wiped per deploy |
| `street` | screener street columns + `catalyst_metadata.ticker_metadata` + `short_interest.get_short_interest` for ≤ 40 actives | mon-fri 16:52 | session of the run | screener rows | current-only |
| `breadth_intraday` | `breadth_intraday` for the session | mon-fri 16:52 | session of the run | samples | 7-day retention |
| `gex` | **named gap on web** (§6) | mon-fri 16:52 | session of the run | — | never stored |
| `wire_inputs` | Brain Pack `leadership_snapshots` / `market_regimes`; cache `intraday_update` | mon-fri 16:52 | the wire date | snapshot + regime rows (+1 intraday) | pack refreshed nightly |
| `catalysts` | `catalyst.store.get_for_date(ranked_only=False)` | mon-fri 17:34 | session of the run | rows incl. dropped (rank NULL) | re-ranked all day |
| `vision` | `pattern_verdicts`, `judged_at` in (watermark, 17:34] | mon-fri 17:34 | session of the run | verdicts | INSERT OR REPLACE |

PC-only Morning Wire inputs (`candidates.json`, `leading_sectors.json`,
`morning_wire_state.json`, the wire journals and ledgers) are recorded as named
gaps on every `wire_inputs` run.

## 2. as_of rules

1. **A source that carries its own date is keyed on it**, never on the server
   clock: wire (`date`), candidates (`market_date`), screener (median
   `bars_asof`, not `snapshot_date` — the 03:00 build stamps only what it rebuilt
   and runs on weekends against Friday's bars), finviz (its `as_of`).
2. **A source without one is keyed on the session of the run**
   (`timeutil.session_for`: pre-open and non-trading days belong to the previous
   session), or for the non-session datasets on the ET date of the slot.
3. **Stale is named, not silently re-archived.** When a dated source is older
   than the session the slot expects (no wire push today; no 02:45 Finviz pull),
   the payload is still archived under its own date (an idempotent no-op when
   unchanged) and the run row is recorded against the *expected* session as
   `unreachable` / `missing` — which pages.
4. An explicit `as_of` (on-demand, backfill) never produces a stale verdict; a
   mismatch with the source's own date is recorded as the gap `as_of_requested`.

## 3. Weekends and holidays

- The session slots (`eod`, `late`) are `trading_days_only`: the registry skips
  them on weekends and NYSE holidays before they claim.
- A session-shaped dataset whose session is not a trading day records
  `skipped_holiday` / `holiday` when it has nothing to keep. Rows that DO exist on
  a holiday (catalysts can) are archived and still read `holiday`.
- The daily/hourly datasets (detections, screener, finviz, themes, tweets) run
  every day. A weekend capture of unchanged data writes nothing new (same bytes,
  same key). Their `zero`/`missing` pages only on trading days.
- Holiday awareness is `core.timeutil`, whose table (`bars_fetch`) covers
  2025–2027; outside it a weekday reads as a session and the health table reports
  `holiday_table_covers_latest = false`.

## 4. Health (metric 6.6)

Per run, `health` is one of:

| verdict | rule |
|---|---|
| `holiday` | session-shaped dataset on a non-trading session |
| `missing` | the source was unreadable (`unreachable`), stale, or the R2 write failed (`failed`) |
| `zero` | read fine, held nothing |
| `low` | `row_count < 0.5 × trailing_median`, with at least 3 samples |
| `ok` | otherwise |

`trailing_median` = the median, over the last **10** trading sessions before this
one, of each session's largest `ok` row count (holidays, weekends and failed runs
excluded; a session with several runs — the hourly tweets — contributes its
maximum). Fewer than 3 samples never yields `low`.

Paging: `zero` or `missing` on a trading day emits
`chart_health_alerts.emit("wisdom_capture_p1:<dataset>", "critical", …)`, subject
to the dataset's declared policy:

| pages on | datasets | why |
|---|---|---|
| zero + missing | detections, screener, finviz, themes, wire, candidates, rs, street, breadth_intraday, catalysts | a zero on a trading day is an outage upstream |
| missing only | detection_outcomes, tweets, wire_inputs, vision | an hour without posts, a day without verdicts or outcome updates, is normal |
| never | gex | a known, named absence (§6), not a fresh failure |

Dry runs and backfills never page.

## 5. R2 layout, encoding, immutability

```
wisdom/context/<as_of YYYY-MM-DD>/<dataset>.json.gz             one object, or a shard manifest
wisdom/context/<as_of>/<dataset>-NNN.json.gz                    shard NNN of a streamed dataset
wisdom/context/<as_of>/<dataset>.<sha256[:12]>.json.gz          a different capture of an as_of already written
```

- Written through `core.r2.put_immutable` only: `head_object` → refuse overwrite →
  `put_object`. Same bytes at the same key is a no-op (`created: false`); a
  *different* capture of the same as_of (tweets through the day, a screener
  re-build) goes to the content-suffixed key, itself immutable and idempotent.
  Nothing is ever overwritten and there is no delete path.
- Canonical JSON (sorted keys, compact, UTF-8) in gzip with `mtime=0` and no
  filename: identical content → identical bytes → identical sha256.
- The object carries `schema` (`wisdom.capture.v1`), `dataset`, `family`, `as_of`,
  `source`, data `gaps`, data `meta`, `rows`, `payload`. **Not** `captured_at` and
  not run-context gaps (`stale`, `as_of_requested`, `retention`) — those vary by
  run, would turn every re-run into a new version, and live on the run row and
  the job result instead.
- Streamed datasets (screener, detections) are written row by row into gzip;
  detections in 5,000-row shards plus a manifest listing each shard's key, sha256,
  bytes and rows. Memory is bounded by one compressed shard.
- Hash-on-change (themes): the payload's content sha256 is compared with the
  registry's `last_sha256`; unchanged writes no object and the run row points at
  the previous key.

## 6. GEX / dealer gamma — the named gap

Not captured on web. `gex_service.get_gex_data` is async and binds
`schwab_service._CHAIN_SEMAPHORE` / `_TOKEN_REFRESH_LOCK` to the first event loop;
from a scheduler thread it fails "attached to a different loop" (indistinguishable
from a Schwab outage) and races flow-worker's token refresh. `adjusted=True` reads
web's frozen pre-cutover flow.db. The `/api/dealer-positioning/*` proxy needs a
signed user vouch and its `/sample` caps at 100 rows. **Alternative, costed:** a
flow-worker job at ~16:20 ET on its own loop for SPY, QQQ, IWM + ~20 actives —
~23 Schwab `/chains` calls per session (limit ~120/min), $0 vendor cost,
~150–400 KB gz/day — which needs an edit to a flow-worker-watched file, and a
flow-worker deploy is a permanent OPRA tape gap, so it ships after hours with the
flow owner's ack (W2).

## 7. Watermarks, dry runs, idempotency

- **Watermarks** (detections, detection_outcomes, vision) live on
  `wisdom_capture_datasets` (`watermark`, `window_lo`, `window_as_of`). A re-run of
  the as_of last completed reuses that window's lower bound, so it re-reads the
  same rows instead of an empty delta (which would page as `zero`). The watermark
  only advances on an `ok` write and never moves backwards. A first run reads the
  24 h before the slot and names the gap `first_window`.
- **Dry run** (`dry_run=True`, the on-demand route's default) reads, encodes and
  sizes everything and writes nothing: no object, no run row, no registry state,
  no page.
- **Re-run**: one `wisdom_capture_runs` row per (run, dataset), always — skipped,
  unreachable and failed runs included.

## 8. Backfill

`tools/wisdom/capture_backfill.py` (dry run by default, explicit store paths):

| kind | what history exists | notes |
|---|---|---|
| `catalysts` | every `market_date` in catalysts.db | small; pod-side |
| `vision` | every verdict still in `pattern_verdicts`, per ET day judged | verdicts already REPLACEd are gone |
| `detections` | `pattern_detections` inside the 120-day retention, per ET day detected | ~50k rows/day: pod-side, one `--max-days` batch at a time, outside 00:40–05:00 |
| `x-posts` | the official accounts' posts via TwitterAPI.io `advanced_search` | PAID: `WISDOM_X_BACKFILL_ENABLED`, `--max-usd` ≤ $25 hard cap, full-page worst case reserved before each call |

Backfilled objects use the daily layout, record run rows (`meta.origin` =
`backfill` / `x_backfill`), never page and never move a watermark.

## 9. Sizes and projected R2 cost

⚠️ **Measured on STALE LOCAL MIRRORS, 2026-09-13, not production**
(`tools/wisdom/capture_measure_sizes.py`, which uses the archive's own encoding).
Rows marked *est.* had no local data and are estimates.

| dataset | measured raw | measured gz / capture | captures / month | gz / month |
|---|---:|---:|---:|---:|
| detections | 8,004 B/row | 2,169 B/row × 48–59k rows/day (mirror); ~36k/day implied by prod's 1.54M rows in 6 weeks | 30 | **2.3–3.8 GB** |
| screener | 16.97 MB | 1.50 MB | 21–30 (weekend runs dedupe) | 32–45 MB |
| breadth_intraday | *est.* ~780 KB | *est.* ~120 KB | 21 | *est.* 2.5 MB |
| finviz | *est.* ~925 KB | *est.* ~150 KB | 30 | *est.* 4.5 MB |
| detection_outcomes | *est.* | *est.* ~200 KB | 30 | *est.* 6 MB |
| rs | *est.* ~440 KB | *est.* ~90 KB | 21 | *est.* 1.9 MB |
| wire | 321 KB | 73 KB | 21 | 1.5 MB |
| street | 932 KB + 258 KB | 14 KB + 34 KB (+ short interest *est.* 3 KB) | 21 | 1.1 MB |
| catalysts | 78 KB (113 rows) | 17 KB | 21 | 0.4 MB |
| themes | 397 KB | 56 KB | 1–4 (hash-on-change) | 0.2 MB |
| tweets | 51 B/post gz | ~1 KB/day × ≤ 24 versions | 30 | 0.3 MB |
| candidates | 32 KB | 4.8 KB | 21 | 0.1 MB |
| vision | 73 KB (107 verdicts) | 9 KB | 21 | 0.1 MB |
| wire_inputs | *est.* 15 KB | *est.* 4 KB | 21 | 0.1 MB |
| gex | — | — | — | 0 |

**Projection:** ~2.4–3.9 GB of new objects a month, 98 % of it detections.
R2 list prices (Cloudflare, verify against the account): storage $0.015 per
GB-month, Class A writes $4.50 per million. Storage accumulates (nothing is
deleted): ≈ $0.04–0.06 in month 1, ≈ $0.43–0.70/month by month 12, ≈ 29–47 GB
held after a year. Writes ≈ 40 objects/day (11 detection shards + manifests + the
rest + tweet versions) ≈ 1,200/month ≈ $0.005. The one-time detections backfill of
the 120-day window is ~120 × 80–130 MB ≈ 10–15 GB (≈ $0.15–0.23/month of storage
once written). Re-measure on production after the first 7 days (W1 §12: "report R2
size and projected monthly cost after 7 days") and replace this table.

## 10. Open items

- GEX on flow-worker (§6) — W2, needs the flow owner.
- `wire_inputs` depends on `BRAIN_PACK_ENABLED` having installed a pack on web;
  unverified from this stream (no production variable reads were in scope).
- Cloudflare-side R2 lifecycle rules on the bucket are unverified; one would break
  the immutability premise.
- Intraday VIX, news-tile headlines, `catalyst_news` (48 h), OI and dark-pool
  retention (flow-worker-owned) are D12 §2.8 risks with no web-side reader in v1.
