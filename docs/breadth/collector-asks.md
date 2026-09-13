# Collector asks — for the engine repo (`uct-intelligence`)

Things the Data Charts overhaul found that **only collector/engine work can fix**. None of them blocks this program:
the dashboard will disclose each gap on the chart instead of hiding it. Measured against production on 2026-09-13
(365 served sessions, 2025-03-31 → 2026-09-11, plus sampled 20-session windows in 2008, 2012, 2016, 2020, 2022).
Evidence: `docs/breadth/00-discovery.md` §1 and §6.

Ordered by member impact.

| # | Ask | What we measured | Why it matters |
|---|---|---|---|
| 1 | **CBOE put/call stopped updating** | `cboe_putcall` last value **2026-08-07**; its derived `avg_10d_cpc` last 2026-08-18 | Volatility & Fear shows a five-week-old ratio as the latest reading. The dashboard will label it stale, but the series should resume |
| 2 | **Follow-through days before 2026** | `is_ftd` is derived from `qqq_day_pct` (from `qqq_close`) and `up_vol_ratio` (`api/services/breadth_monitor.py:502-524`); reconstructed rows carry no `qqq_close`, so **no FTD can ever be flagged before 2026-01-02** — not even April 2025 | Members zooming back see no follow-through days at all and would reasonably read that as none happened |
| 3 | **Index and volatility history before 2026** | `sp500_close`, `qqq_close`, `vix`, `vxn`, `avg_10d_vix`, `avg_10d_vxn`, `rsp_spy_ratio`, `iwm_qqq_ratio`, `atr_ext_7` all start **2026-01-02**; absent from every 2008–2022 sample | Breadth-vs-price, Narrow Leadership, Risk Appetite and every VIX preset show breadth for years and price for months. This is also what ask #2 needs |
| 4 | **Stage 2 / Stage 4 gaps** | `stage2_count`/`stage4_count` present on 343 of 365 sessions | 22 holes in a core regime series |
| 5 | **`up_from_open` / `down_from_open` are empty** | Present in the row schema, null in all 365 rows | Either populate or remove — an always-empty field invites a surface to render it as zero |
| 6 | **`up_on_volume` / `down_on_volume` history** | First stored 2026-08-31 (2 sessions at measurement) | Not offered until ≥ 20 sessions exist; a backfill would let it ship with history |
| 7 | **Advancing / declining before 2026-03-16** | Backfilled 107 of 114 graded sessions from the collector's cached frames (2026-08-30); nothing earlier exists | Limits Net Advancers' raw sides and Zweig to 2026 |
| 8 | **Mark restated rows** | Every stored row before 2026-03-23 was recomputed from the 2026-03-22 frame (not point-in-time) and nothing in the row says so; `_reconstructed` marks only bar-derived rows | The chart can disclose reconstruction precisely, restatement only as a footnote. A `_restated_from: "2026-03-22"` field would let it mark the exact sessions |
| 9 | **Drill lists for reconstructed sessions** | `GET /api/breadth-monitor/{date}/drill/{key}` reads `breadth_snapshots` only; reconstructed sessions have no `_list` fields (404) | Drill-through from the chart will be disabled (with a reason) on every pre-2026 session unless lists can be reconstructed |
| 10 | **NAAIM forward coverage** | Weekly, carried; the free feed runs ~3 months behind since NAAIM paywalled the live index (2026-08-01) | Stays out of presets; a paid feed is a product decision |
| 11 | **UCT Exposure history** | `uct_exposure` starts 2026-02-20 | Wire-derived and probably not reconstructible; if it can be, Exposure vs Score gains history |

Not asks, but recorded for whoever next touches the collector: the dashboard's 6× magnitude test used a hand-typed
table of maxima that had drifted (one series' typed maximum was an order of magnitude below what is now served); the dashboard is replacing it with
a runtime rule, so no range table needs maintaining on either side.
