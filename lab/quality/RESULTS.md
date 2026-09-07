# Pattern-detector recognition evaluation — first-pass results

Cohort (6 families, spanning candlestick / classical-structural /
growth-base / MA-pullback / event-gap / momentum-breakout): `hammer`,
`bull_flag`, `vcp`, `pullback_to_50sma`, `power_earnings_gap`,
`ascending_triangle`. Every fixture is real (hand-authored OHLCV, not
synthetic-on-the-fly) and every detection ran through the actual production
detector function — see `lab/quality/results.json` for full per-fixture
output.

## 1. Recall / false-positive proxy on the existing corpus

| family | n (pos/neg/edge) | recall proxy | false-positive proxy | geometry sane (of fires) |
|---|---|---|---|---|
| hammer | 15 (5/8/2) | 100% | 0% | 7/7 |
| bull_flag | 15 (5/8/2) | 100% | 0% | **0/7** |
| vcp | 16 (5/9/2) | 100% | 0% | 7/7 |
| pullback_to_50sma | 15 (5/8/2) | 100% | 0% | 7/7 |
| power_earnings_gap | 17 (5/10/2) | 100% | 0% | 7/7 |
| ascending_triangle | 15 (5/8/2) | 100% | 0% | **0/7** |

**Every family scores 100% recall / 0% false positives.** This is expected
and NOT evidence of a good detector — it's circular. These are the exact
fixtures each detector's own `test_*.py` battery already asserts against, so
a family that failed here would already be a broken build. All 6 families
DO have real negative/adversarial fixtures (8-10 each), satisfying the
mission's ask #2 — this is a repo-wide convention, not something unique to
this cohort (see `manifest.md`).

## 2. Geometry sanity — a real, concrete bug found

`bull_flag` and `ascending_triangle` fail geometry sanity on **every single
fixture that fires (7/7 each)**. Root cause, confirmed by reading the source:
both build `geometry.anchors[].t` from a **bar index**, not the bar's real
Unix timestamp — e.g. `bull_flag.py` line 167-171:
`upper_pivots = [{"t": pole_top_idx + 1 + i, ...}]` (should be `b["t"]`);
`ascending_triangle.py` lines 141/162-163 do the same
(`{"t": p["bar_index"], ...}` / `{"t": int(start_idx), ...}`). Meanwhile the
SAME Detection's `start_t`/`end_t`/`pivot_ts` correctly use `bars[idx]["t"]`.
So one Detection object mixes real timestamps (top-level) with small
integer bar-indices mislabeled as timestamps (inside `geometry.anchors`) —
violating `types.py`'s own `Anchor` contract (`t: int  # unix seconds`).
Any downstream consumer trusting `geometry.anchors[].t` as a real time
(a chart renderer, a replay tool, this harness) will place the anchor near
Jan 1 1970. `bear_flag.py` shares the same `fit_pair_parallel` primitive as
`bull_flag`, so it likely has the same bug, but that was NOT verified here
(out of the bounded cohort). `hammer`, `vcp`, `pullback_to_50sma`, and
`power_earnings_gap` all pass geometry sanity cleanly (7/7 each) — they
either use single-candle anchors or already thread real bar timestamps
through their trendline fit.

## 3. Is the existing corpus sufficient to claim real precision/recall?

**No, and one family already has a better answer sitting unused.** The
fixture batteries prove regression-safety ("still behaves as designed"),
not real-world precision/recall — the fixtures were authored to make the
assertions pass. `docs/uct-scanner-intelligence/vcp_gold_standard/` is
different: 82 real-symbol, real-history cases scored by a frozen rubric
against genuine ambiguity, with already-computed metrics
(`data/metrics.json`) for the real `vcp.py` detector: **precision 0.40 [95%
CI 0.168–0.687], recall 0.50 [0.215–0.785], F1 0.444**, on 48 non-ambiguous
cases (34 excluded as genuinely ambiguous/insufficient-data). That is the
VCP family's honest real-world number, and it is materially worse than the
100%/0% the fixture battery reports — exactly the gap this mission asked
to surface. The other 5 cohort families have no equivalent real-market
evaluation; their true precision/recall is unmeasured.

## 4. Candlestick context pilot (hammer family)

Compared raw candle anatomy (independent arithmetic on the fixture's last
bar) against context, on 3 real fixtures:

| fixture | body/range | lower-wick:body | fixture context | fired? | confidence |
|---|---|---|---|---|---|
| `hammer_at_support` | 0.122 | 7.0x | Stage 4, stacked-bearish, RS down | **yes** | 89.5 |
| `hammer_in_uptrend` | 0.028 | **34.0x** | Stage 2, stacked-bullish, RS up | **no** | — |
| `hammer_no_context` | 0.032 | 29.0x | Stage 1, mixed, RS flat | **no** | — |

`hammer_in_uptrend`'s raw anatomy is textbook-tighter and has a **~5x
larger** wick-to-body ratio than the fixture that fires — geometry alone
would rank it the stronger hammer. Context is what flips the verdict:
`hammer.py`'s hard reversal-context gate (swing-low / below-50SMA / ≥5%
recent decline) has nothing to attach to in a clean uptrend, so it discards
the candidate unconditionally regardless of anatomy. This is a concrete,
quantified confirmation that UCT's context fields — not raw shape — are
doing the real discriminating work for this family. One caveat found in the
same run: `build_context()` computed fresh from these short (15-31 bar)
fixtures disagreed with the fixtures' own hand-authored `context` (e.g. it
returned `trend_stage=1`/`mixed` for `hammer_at_support` where the fixture
author set `trend_stage=4`/`stacked_bearish`) — expected, since
`_trend_stage`/`_ma_alignment` need ≥50 bars of history to compute
meaningfully and these fixtures are short by design; worth knowing if this
harness is ever pointed at fixtures without an authored `context` block.
