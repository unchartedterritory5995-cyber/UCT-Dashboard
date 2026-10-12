# UCT breadth universe — refreshed market-cap methodology (proposal)

Status: **investigation and proposal only, 2026-10-12.** Nothing has changed. Production
publishes over the collector list (`BREADTH_EOD_UNIVERSE=collector`, applied 2026-10-12 with
owner authorization). The owner's direction: no permanent reproduction of stale caps. The goal
is a server-managed universe on reliable, refreshed caps, delivered as a separate methodology
project.

This document contains counts, rates and aggregated percentage-point differences only. It
contains no breadth values.

## 1. The intended eligibility rules

Source: `scripts/breadth_collector.py::_get_universe`, and its own docstring.

| rule | intent | collector implementation |
|---|---|---|
| type | common stock or ADR. No ETFs, preferreds, warrants or units. | Massive reference `type ∈ {CS, ADRC}`, `active=true`. Refreshed daily and cached per day. |
| price | ≥ $2.00 | close on the newest Massive daily flat file. At 16:15 ET on D that is D−1's file. |
| volume | ≥ 200,000 shares | volume on that same file (one day, not an average) |
| market cap | ≥ $300M; **no cap on record = excluded** | `ticker_metadata.market_cap` in the PC's local `uct_intelligence.db` |
| exclusions | manual list plus confirmed buyouts | `universe_exclude.UNIVERSE_EXCLUDE` (manual 30, plus the PC's `buyout_sweep`) |

The intent is clearly a current cap ("is this a ≥ $300M company?"). Nothing in the rules asks
for the cap as first seen.

## 2. How the PC stores and refreshes cap, and why stale or missing caps persist

- `ticker_metadata.market_cap` is written by exactly one path:
  `scripts/market_ingest.py::step_metadata` → `api.update_ticker_metadata(...)`.
- The daily run calls `step_metadata(..., skip_existing=not update_metadata)`. Without the
  `--metadata` flag, `skip_existing=True`, so **only tickers with no row at all** are fetched.
- A ticker's cap is therefore written once, on the first night it qualifies (≥ $2, ≥ 100k
  volume), and is **never refreshed**.
- A first fetch that returned no `market_cap` stores NULL, and NULL **is never retried**,
  because the row exists. The upsert keeps the old cap when the new one is NULL.
- Effects:
  - A stock that has grown past $300M since it was first seen stays excluded.
  - A stock first seen with no cap stays excluded forever.
  - A stock that has shrunk below $300M stays included.
- Evidence, Oct 9 basis (`/api/breadth-monitor/eod-source/detail`, counts only):
  - The server list has 205 names the collector lacks, and the collector has 63 the server
    lacks.
  - 196 of the 205 never appear in any of the 54 clean collector lists (07-27 → 10-09), and 82
    of them have caps ≥ $1B.
  - 56 of the 63 fail only on cap (< $300M on a fresh cap), and 58 are in the collector list on
    most sessions.
  - An alphabetical check rules out a truncated type list.
- ⚠ Collector lists **before 2026-07-27** were the unfiltered `cap_universe_cache` fallback
  (~3,660 names). They must not be used as membership history.
- ⚠ Not verifiable from here: whether a scheduled task on the partner's PC ever passes
  `--metadata`. The evidence above says it does not, at least not recently.

## 3. The server's cap source

- **Field:** `screener_rows.market_cap`, written by every nightly screener build
  (`snapshot_builder` → `massive.get_market_cap`).
- **Freshness:** it is a live Massive ticker-details call per ticker per build, with no cache.
  `market_cap` falls back to shares × the bar price when the field is absent, so each value is
  current as of that build.
- **Coverage:** on the Oct 9 build, only 22 names that passed type, price and volume had no cap
  (`counts.no_cap`).
- **Limits:**
  - It is **not point-in-time.** Each build overwrites it, so it cannot reconstruct history.
  - It inherits Massive's known cap defects for multi-class shares, ADRs and stale share
    counts. The `marketcap/` PIT project documented these: 63 ≥ 10× disagreements across
    5.6k securities.
  - Not read for this report: production `built_at` timestamps, and how often the nightly
    build fails. Both are needed before cutover (§7).
- **The PIT cap shadow** (`MCAP_V1-20261003T140306Z`, local and not accepted) is not usable as
  the universe source today. About 481 eligible names per session have no PIT cap, mostly
  NYSE/Nasdaq common stock and about 25% ADRs. Its inputs were also frozen on 2026-09-29, and
  it has no refresh pipeline.

## 4–5. Historical comparison

Run: 42 clean sessions, 2026-07-27 → 2026-09-29. The script is local, at
`univ_compare.py` in the job's tmp directory.

Inputs:
- collector lists: production pit-export;
- close and volume: bars export;
- type: Massive reference as of 09-30. This is not PIT, so it gives a slight survivorship bias.

Universes compared:

| universe | definition | size (median) |
|---|---|---|
| C | the collector's list | ~2,660 |
| P | the same rules, PIT cap only | ~2,390 (481/session lack a cap, so excluded) |
| **F** | the same rules, PIT cap, falling back to Massive's current cap where PIT is missing; the closest to a "refreshed" server list | ~2,790 |

| C vs F | median | range |
|---|---|---|
| names added | 191 | 146–466 |
| names removed | 66 | 44–472 |
| overlap (Jaccard) | 0.91 | 0.78–0.93 |
| daily list turnover, C | 5.2% | 0–8.5% |
| daily list turnover, F | 6.8% | 5.7–23.7% (one outlier session) |

**Population effect on breadth.** Both universes are measured with the same closes, so the
difference isolates membership.

| measure | median abs diff | p90 abs diff | mean signed diff |
|---|---|---|---|
| advancers share | 0.36 pp | 0.84 pp | +0.04 pp |
| % above 50-day SMA | 0.76 pp | 1.32 pp | +0.71 pp |
| % above 200-day SMA | 1.65 pp | 1.93 pp | **+1.57 pp** |

**Finding.** The stale-cap list has a **systematic bearish tilt** in trend measures. It keeps
companies that have shrunk (decliners) and excludes companies that have grown (risers). The
200-day measure is lower on the collector list in all 42 of 42 sessions (50-day: 36 of 42). That is a
methodology defect, not noise. Day-to-day measures (advancers) are nearly unbiased.

The Oct 9 production diff (+205 / −63) matches the F pattern (+191 / −66).

## 6. Historical continuity

- The tilt is persistent, about 1.6 pp on the 200-day measure. Switching universes silently
  would put a **level step** into the long-horizon series on the switch date.
- **Recommendation:** an explicit methodology version, `UCT universe v2 (refreshed cap)`, with a
  published transition date and no silent restatement.
  - The UCT V2 PIT ledger and frozen history keep the collector-defined membership up to the
    transition.
  - The new membership applies from the transition date.
  - A run of at least 20 sessions computes both universes, so the step can be stated
    (dates, counts, pass/fail).
- **US, NYSE and Nasdaq are not affected.** Their membership does not come from this list.

## 7. Proposed migration, step by step

1. **Define the rules as code and document**, owner approved.
   - type CS/ADRC; ≥ $2 and ≥ 200k on the basis session; exclusions unchanged.
   - cap ≥ $300M on a cap **no older than N days** (proposal: 7). A missing cap means
     excluded, but every such name is counted and alerted.
   - Decide whether volume stays single-day or becomes a 20-day median. Single-day causes most
     of the daily churn. This is a separate methodology question and stays unchanged unless
     the owner asks.
2. **Cap source on the server.**
   - Store a dated cap history from the nightly screener build (`breadth_universe_caps(date,
     ticker, cap, source, fetched_at)`). Today it is overwritten each night.
   - Health checks: build age, coverage (no-cap count), and day-over-day cap jumps ≥ 3× (the
     multi-class/ADR defect class) held back for review.
3. **Shadow run.** For ≥ 20 sessions:
   - build the v2 list nightly beside the collector list (the existing `eod_shadow_su`
     machinery);
   - record membership diffs and population effects;
   - grade price metrics against the collector **on the same list** (population control). This
     is the established bar, unchanged: it proves the server's computation, and the
     membership difference is reported separately.
4. **Acceptance.** All of the following must hold:
   - the population-control parity bar passes, 10 consecutive clean sessions;
   - no-cap names ≤ 1% of eligible;
   - daily turnover within the collector's range, except on stated events;
   - the population effect is stable (no unexplained drift);
   - the owner signs off on the tilt correction and the transition date.
5. **Cutover.** Set `BREADTH_EOD_UNIVERSE=server` on the approved transition date and record
   the methodology version in the row's `_source_detail`.
   - **Rollback:** `BREADTH_EOD_UNIVERSE=collector`, valid while the partner's PC keeps
     pushing.
   - **Monitoring:** the pipeline-stage check plus a daily universe-health line (size,
     turnover, no-cap count).

## 8. A metadata-refresh fix for the PC collector

This is recommended as a separate, owner-approved change in `uct-intelligence`. It has not
been made here.

- Refresh `market_cap` for the breadth candidates weekly (for example by running
  `market_ingest --metadata` scoped to ≥ $2 / ≥ 100k names), and retry NULL caps nightly.
- **Caution:** this changes the collector's membership too, and it is the same ~1.6 pp level
  step. It should land **on the same transition date** as v2, or after it, never silently
  before. Otherwise the approved collector baseline moves under the parity run.
