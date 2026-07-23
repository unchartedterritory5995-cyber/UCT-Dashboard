# Stock Catalysts — Brain setup-grade + Finviz/AV news sources

**Date:** 2026-07-23
**Status:** built. Roadmap items 3 (Brain) + 4 (Finviz/AV news) of source-completeness,
after options-flow (1) and FMP analyst (2). Flag-gated; all fail-soft.

## Why

Owner steer: "make sure we get everything we need out of the catalysts — any and
all of our sources — so we can improve the skill, usefulness, and accuracy." Two
gaps remained after the flow + FMP-analyst work:

1. The list knew a name was moving on news, but not whether that name fits a setup
   **the firm has a proven edge on**. The Brain Pack (uct-intelligence engine,
   installed on the pod) has logged win-rate + expectancy for the firm's setups.
2. The only per-ticker news feeds were RSS + Perplexity + tweets. Finviz Elite
   carries a curated, ticker-tagged headline feed; AlphaVantage carries per-ticker
   news **sentiment** (bullish/bearish) — a dimension we had nowhere.

## (3) Brain setup-grade — `catalyst/brain_grades.py` (source 11, ENRICHMENT)

Not a discovery source — it **enriches** candidates the move-detectors already
found. `enrich(candidates)` infers a named firm setup from each candidate's
situation and, when the Brain has enough sample, attaches `brain_grade =
{setup, win_rate_pct, sample, expectancy, avg_gain_pct, avg_loss_pct}`.

- **`_infer_setup`** (priority): explicit scanner bucket (GAPPER_NEWS→Episodic
  Pivot, REMOUNT→Remount, PULLBACK_MA→20 EMA Pullback) → earnings gap-up→Power
  Earnings Gap → fresh-catalyst gap-up (no earnings)→Episodic Pivot → new-highs→
  Flat Base Breakout. Returns None when nothing maps confidently (never guesses a
  setup to force a grade).
- Reads through **`brain_service`** (the shared facade). Grade attaches ONLY when
  `setup_winrate` is `ok` (≥5 logged trades) — thin/ungraded setups get nothing
  (honest: no edge yet). Memoized per distinct setup (all news gappers = one
  lookup). Verified live: `Episodic Pivot → EP, 42.7% win, 1.68 expectancy, n=335`.
- **No new gate** — it only fires on names that already carry a real move / hard
  signal (earnings/scanner/gap+news/52w-high), all of which already pass
  `is_real_catalyst`. Pure ranking + narrative.
- **Consumed by:** `scoring` (`BRAIN_EDGE` bonus scaled by expectancy, capped),
  `synthesize._format_brain_block` ("Firm edge: EP, 43% win, 1.68 expectancy over
  335 logged trades") in the prompt, and the curator candidate block + a rubric
  keep-tiebreaker. Fail-soft everywhere: pack missing / flag off / any error →
  no-op, engine behaves identically. Gated `CATALYST_BRAIN_ENABLED` (default on).

## (4a) Finviz news — `sources._pull_finviz_news()` (source 12, LIVE)

Finviz Elite `news_export.ashx` CSV (`Title,Source,Date,Url,Category,Ticker`) —
a curated, ticker-tagged headline feed. Verified live: 100 rows, every one
ticker-tagged. Keeps only **catalyst-specific** rows (≤`CATALYST_FINVIZ_NEWS_MAX_TICKERS`
= 3 tickers); a headline tagged to many tickers is macro/thematic and dropped
(would attach vague sector prose to every megacap). Legal-boilerplate + blank-
ticker rows dropped. Items merge into the same `rss` list as RSS/Perplexity, so
they reuse tagging/scoring/synthesis with no new wiring; a Finviz headline on an
already-moving name adds the "why" but (like RSS) can't resurrect a flat tape.
Fail-soft (no key / any error → {}). Gated `CATALYST_FINVIZ_NEWS_ENABLED` (default on).

## (4b) AV news sentiment — `sources._pull_av_news()` (source 13, DORMANT)

AlphaVantage `NEWS_SENTIMENT` — one market-wide call whose articles carry
per-ticker sentiment scores. Aggregates to `av_news = {news_sentiment,
news_sentiment_label, av_article_count}` (relevance-floored). **DORMANT by
default** (`CATALYST_AV_NEWS_ENABLED` unset → off): the FREE AV tier is rate-
limited to ~25 calls/day and SHARED with the earnings-history widget — a live
call every refresh would starve that budget. Confirmed on the pod: the free key
returns an `Information`/throttle reply, which the code treats as empty. Wired +
ready so a dedicated/premium AV key (`CATALYST_AV_NEWS_KEY`) + the flag light it
up with zero further work. Consumed as a small scoring nudge + a synthesis/curator
line — never a gate. Rate-limit-aware + fail-soft.

## Skip-if-stable hash

`brain_grade` + `av_news` added to `compute_signals_hash` signal_keys so a newly-
graded / newly-sentiment-scored name refreshes its thesis instead of serving a
stale one. Kept minimal — NOT retroactively adding the older analyst/flow keys
(that would force a one-time mass re-synth cost spike).

## Env / safety

`CATALYST_BRAIN_ENABLED`(1) · `CATALYST_BRAIN_MIN_GAP`(3) · `CATALYST_FINVIZ_NEWS_ENABLED`(1)
· `CATALYST_FINVIZ_NEWS_MAX_TICKERS`(3) · `CATALYST_AV_NEWS_ENABLED`(0) ·
`CATALYST_AV_NEWS_KEY`/`ALPHAVANTAGE_API_KEY` · `CATALYST_AV_NEWS_MIN_RELEVANCE`(0.1)
· `CATALYST_SCORE_W_BRAIN_EDGE`(5) · `CATALYST_SCORE_W_NEWS_SENTIMENT`(8). All
sources fail-soft; needs `FINVIZ_API_KEY` (already set). Two new `collect_all`
tasks + universe union + source stats (`brain_grades` count recorded too).

## Tests

`tests/test_catalyst_brain_grades.py` (infer rules; enrich disabled/unavailable/
attaches/thin-sample/memoize/never-raises) + `tests/test_catalyst_finviz_av_news.py`
(Finviz disabled/no-key/failsoft/keeps-single+few/drops-macro+legal+blank; AV
dormant-default/no-key/throttle/aggregation+relevance-floor). Full catalyst suite
green (321).

## Roadmap after this

All four source-completeness items are built: (1) options flow (staged off,
pending the flow-worker `top-conviction` perf fix), (2) FMP analyst (live),
(3) Brain setup-grade (live), (4) Finviz news (live) + AV sentiment (dormant).
