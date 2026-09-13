# 02 — Baseline (the numbers everything after is judged against)

**Run:** `tools/discord_render_bench.py --adopt-pod-env --resume --runs 2`, inside the `web` pod,
2026-09-13 14:39–15:56 UTC (Sunday, market **closed**), web commit `58c2c233b28a`, chart-renderer
deployment of 2026-09-01 01:53 UTC. 85 cases × 2 runs = **170 rows**. Raw JSONL sha256
`305cc796…c282ef89` (pulled back and hash-matched against the pod copy). Discord was never called:
`edit_fn` is a capture, so every number below stops at "the PNG was ready to upload" — the PATCH
itself is not in these figures.

⚠️ **This is the closed-market baseline.** The S2 SLO is defined on RTH. A second run of the same
command during RTH (Monday) is recorded as a row in `05-progress.md`; until it exists, RTH claims
are not made from this table.

⚠️ **The pod redeployed four times under the bench** (other sessions' pushes). The bench is
resumable, so no case was lost, but a case that straddled a restart is marked by its gap in
`wall_start`. This is class C-01 measured on the instrument itself.

## How to reproduce

```sh
# local: upload (gzip+base64 over railway ssh; hash printed both sides)
bash scratchpad/pod_upload.sh tools/discord_render_bench.py /data/discord_render_bench/drb.py
# pod: run detached (survives the ssh session, --resume survives a redeploy)
cd /app && export LD_LIBRARY_PATH=$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^LD_LIBRARY_PATH=//p') && \
  (BENCH_APP_ROOT=/app setsid nohup /opt/venv/bin/python /data/discord_render_bench/drb.py \
     --adopt-pod-env --resume --out /data/discord_render_bench/baseline.jsonl --runs 2 \
     >> /data/discord_render_bench/baseline.log 2>&1 < /dev/null &)
```

## Symbol set (as run)

| Group | Symbols | Timeframes |
|---|---|---|
| liquid | SPY QQQ NVDA AAPL TSLA | D W 60 30 15 5 |
| mid (live UCT20 at run time) | LITE DELL MU QMCO PBF CDNA STX AMD TXG SMTC | D 15 |
| edge | AEHL (microcap) · SPCX (first daily bar **2026-06-12**, measured) · BRK.B · LEN.B · SIVB (delisted) · ZZZZQ (invalid) · SPX (index) · SMH (ETF) · UCTA50 (breadth) · AEHL 5-min | D (and 5) |
| modes | NVDA compare SPY QQQ · NVDA+AMD+AVGO+TSLA multi · NVDA flow popup (dark pools) | D |
| flow | SPY NVDA TSLA AAPL PLTR × days 1 / 7 / 30 / all · ZZZZQ | — |
| buzz | board, window `open` | — |

Not reproducible on a Sunday: a symbol mid-halt. Recorded, not substituted.

## Chart path — per hop (ms)

`e2e_first_image` = job start → first PNG handed to the (captured) edit; `e2e_final_image` = → the
last one (a stand-in followed by the house image counts twice).

| Group | n | Delivered | e2e first image p50 / p95 / p99 | e2e final p50 / p95 / p99 | house render p50 / p95 / p99 | page-bars warm p50 / p95 / max | bars D p50 / p95 / max | PNG p50 / max |
|---|---|---|---|---|---|---|---|---|
| liquid | 60 | **60 / 60** | 2,168 / 2,399 / **13,298** | 2,168 / 2,399 / **14,816** | 2,081 / 2,311 / 2,586 | 17 / 139 / **12,508** | 0.7 / 6.3 / 60 | 280 KB / 326 KB |
| mid | 40 | **40 / 40** | 2,073 / 2,361 / 3,380 | 2,073 / 2,361 / 4,634 | 2,019 / 2,284 / 2,945 | 18 / 135 / 2,445 | 0.8 / 7.8 / 16 | 275 KB / 326 KB |
| edge | 20 | 18 / 20 (ZZZZQ ×2) | 2,087 / 3,278 / 3,278 | 2,087 / 4,610 / 4,610 | 1,979 / 3,053 / 3,053 | 8 / 43 / 43 | 1.5 / 154 / 1,154 | 259 KB / 298 KB |
| modes | 6 | 6 / 6 | 2,243 / 3,329 / 3,329 | 2,243 / 5,580 / 5,580 | 2,118 / 9,158 / 9,158 | 17 / 120 / 120 | 0.8 / 7.1 / 7.1 | 459 KB / **1,155 KB** (multi) |

Other hops, all chart runs: ext quote p50 ≈ 14 ms, p99 ≤ 110 ms · context line p50 0 ms (cached),
p99 ≤ 355 ms · stand-in (mplfinance) render 211–760 ms.

**Renderer:** 130 house-render requests, **130 × HTTP 200, 130 × `X-Chart-Ready: true`**; 2 runs
needed a second attempt. **Stand-in rendered in 6 runs** (the house image missed the 3 s
`DISCORD_CHART_FAST_AFTER_S`): SPY 5m, DELL 15m, QMCO 15m, SMH D, AEHL 5m, the NVDA popup. On a
closed market with no member load, the stand-in still fires on 6 of 126 chart runs (4.8 %).

## Edge cases (run 0)

| Case | Outcome | e2e | Bars (n, first → last, serve layer) | Note |
|---|---|---|---|---|
| AEHL D | ok | 2,216 | 260, 2025-08-29 → 2026-09-11, stale-swr | microcaps chart fine |
| SPCX D | ok | 2,234 | **63**, 2026-06-12 → 2026-09-11 | recent listing; page drew 63 bars |
| BRK.B D | ok | 2,567 | 260 | |
| LEN.B D | ok | 2,270 | 260 | ⭐ the 2026-08-26 "LEN.B returns 0 bars" gap is **closed** |
| SIVB D | ok | 2,289 | 260, 2022-02-25 → **2023-03-09** | delisted history served frozen |
| **ZZZZQ D** | **no_bars** | **1,525** | 0, `cold-bg` | ⛔ D-04 wants <1 s and suggestions; today it is 1.5 s (a fixed 1.5 s retry) and none |
| SPX D | ok | 2,491 | 260, `index-disk`, unix-day timestamps | |
| SMH D | ok | 2,147 | 260 | stand-in fired on run 0 |
| UCTA50 D | ok | 3,020 | 260, `breadth-build` | slowest daily: breadth series build ~1 s |
| AEHL 5m | ok | **4,610** | 5-min | first image at 3,278 = stand-in, house at 4,610 |
| NVDA popup (dark pools) | ok | **5,580** | | stand-in at 3,329, house at 5,580: dark-pool zone embedding is the extra cost |

## `/flow` path (ms)

| days | first call (cold, per symbol) | second call (flow-worker 60 s cache) | card render |
|---|---|---|---|
| 1 | 1,961 – 8,762 | 26 – 68 | 119 p50 · 165 max |
| 7 | 4,433 – 9,725 | 28 – 36 | |
| 30 | 6,487 – **17,325** | 33 – 51 | |
| all | 6,855 – **20,889** | 28 – 41 | |

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| flow fetch (all 40 runs) | 68 | **17,325** | 20,889 | 20,889 |
| flow e2e | 173 | 17,445 | 21,008 | 21,008 |

⭐ The p50 is the cache; the p95 is the product. A first `/flow` for a symbol costs 2–21 s of
flow-worker compute, and web's timeout is 30 s — which is how 2026-09-11 10:45 ET (a live,
loaded flow-worker) crossed it.

⛔ **`/flow SPY`, `/flow` of any ETF, answers "no significant options flow" — and it is wrong.**
All 8 SPY runs returned 0 contracts because `run_flow_card_job` asks flow-worker for
`source=stocks`. Verified directly against flow-worker the same afternoon, 30 days:
SPY `stocks` 0 / **`etfs` 182 contracts** · QQQ 0 / **136** · SMH 0 / **83**. Class **C-14** in `01`.

**S4 flow targets (owner rule: baseline × 0.5)**, by window, from the cold first-call p95 per window:
days=1 ≈ **4.4 s** · 7 ≈ **4.9 s** · 30 ≈ **8.7 s** · all ≈ **10.4 s** (OI-11: the `all` target depends
on flow-worker compute in a partner file).

## `/buzz`

Board render 1,102 / 1,357 ms (2 runs), 194 KB.

## Determinism (run 1 vs run 0, same closed-market data, seconds apart)

**58 of 85 cases byte-identical.** Every flow card, the multi-chart set and the buzz board were
identical. The 27 that differed, by cause (bounding box of changed pixels, 2592-wide image):

| Cause | Cases | Evidence |
|---|---|---|
| Footer stamps the **wall clock** | TSLA 60, PBF D | change box y 1367–1387 (the footer line) |
| Header re-reads a **live quote** | TSLA 15, PBF 15, CDNA 15, TXG 15, LEN.B D | change box y 26–56 (header price) |
| A **stand-in vs house** mix between runs | SPY 5 (99.7 % changed) | run 0 took the stand-in path |
| Right-axis label shift | AAPL 30, AAPL 15 | x 2529–2547 (price scale) |
| Intraday body shift | SPY 30, QQQ 30, NVDA 30, TSLA 30, TSLA D | 0.02–0.29 % |
| **Large, unexplained** | SPX D (20.1 %), NVDA compare (28.1 %), TSLA W (1.25 %), AEHL 5 (0.35 %) | investigated in 3.3 |

A closed market should produce the same picture twice. It does for 68 %; the rest is the image
reading a clock or a live feed, which is also why a cached chart and a fresh one can disagree.

## Baseline SLO snapshot (closed market — RTH pending)

| SLO | Today (measured here) | Target |
|---|---|---|
| S1 ack p99 | **not measurable from history** (no HTTP logs for past deployments; web writes no access log) — measured going forward by V2 | ≤ 1,000 ms |
| S2 chart p50 / p95 / p99 (liquid) | 2.17 s / 2.40 s / **14.8 s** (closed market, no Discord upload) | 2.5 / 5 / 8 s (RTH) |
| S4 flow p95 | **17.3 s** | per-window × 0.5 (above) |
| S5 success | 100 % liquid/mid; ZZZZQ correctly no-bars | ≥ 99.5 % |
| S6 invalid symbol | **1.5 s, no suggestions** | ≤ 1 s, ≤ 3 suggestions |
| S8 honest degradation | stand-in on 4.8 % of runs, **unlabelled** | 100 % labelled |
