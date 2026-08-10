# Addendum — Qullamaggie, fetched from the primary source

**Fetched 2026-08-09 from <https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/>** —
the author's own page, not a summary of it. Every number below is a direct quote.

⚠️ **THIS IS AN ADDENDUM, NOT A MERGE.** `setup_criteria.json` already carries
Qullamaggie criteria gathered by the sweep. Where these disagree with those, **record
both** — the catalog's `_no_average` rule holds: an average is a number nobody
published. Reconcile only by reading both citations, never by splitting a difference.

## Breakout

| Criterion | Exact wording | Expressible today? |
|---|---|---|
| Prior move | *"A big move higher sometime in the past 1-3 months. This move can be anywhere from 30-100%+"* | **expressible** — a range over `close` vs `close[n]` |
| Universe rank | *"the 1 or 2% of stocks that are up the most over these 3 timeframes: 1-month, 3-month, 6-month"* | **needs-engine** — a cross-sectional RANK, not a per-symbol predicate |
| Consolidation | *"The consolidation phase is usually 2 weeks to 2 months"* | expressible as a bar count |
| Stop width | *"Stop should not be wider than the ATR or ADR of the stock"* — *"if the ADR of the stock is 5%, your stop shouldn't be wider than 5%"* | expressible — `atr` is declared |
| Partial exit | *"You should sell 1/3 to 1/2 of the position after 3-5 days"* | **not a scan** — trade management |
| Trail | *"10- or the 20-day moving average"*, *"Wait for the first CLOSE below the 10-day"* | expressible — `crossUnder(close, sma(close,10))` |

## Episodic Pivot

| Criterion | Exact wording | Expressible today? |
|---|---|---|
| Gap | *"Gap up 10%+"* | expressible — `open / close[1] - 1 > 0.10` |
| Volume | *"many times the best ones have traded their average daily volume in the first 15-30 minutes"* | **needs-cadence** — intraday, and the engine is closed-bar daily here |
| Fundamentals | *"preferably mid/high or even triple digit EPS and revenue growth"* | **needs-column** — no EPS-growth series declared |
| Prior quiet | *"Best if the stock has not rallied over the past 3-6 months"* | expressible |

## Parabolic Short

| Criterion | Exact wording |
|---|---|
| Extension | *"Stock up 50-100%+ in a few days or weeks (if larger cap) or 300-1000%+ (if smaller cap)"* |
| Streak | *"Stock should be up 3-5+ days in a row"* |
| Reward | *"More like 5-10x risk reward"* |
| Target | *"Target area is the 10- and 20-day moving averages"* |

⭐ **The streak criterion is newly expressible as of today.** *"up 3-5+ days in a row"*
is a bar-to-bar accumulator, which is precisely what `accum` was built for:
`accum(0, close > close[1] ? self + 1 : 0, 250) >= 3`. Before the recurrence landed
there was no way to say it at all.

## Position sizing and risk — all three setups

- *"Never have more than 30% of your account overnight in any stock or ETF"*
- *"Most of my positions are 10-20% of account size"*
- *"Risk on most trades is usually 0.25-1%. I rarely risk more than 1% of my account"*

⛔ **None of these are scan criteria** and they must not be filed as though they were.
They are position-sizing rules, and the catalog's value depends on the distinction:
a screener that silently turned *"risk 0.25-1%"* into a filter would be inventing a
predicate the author never wrote.

## What this addendum does NOT close

The sweep listed eight setups it could not pin, and this source closes none of them:
**Slingshot · Green to Red · Parabolic Long · News Failure · Wedge Pop · Wedge Drop ·
EMA Crossback · Weinstein's `4B-`**, plus Minervini's PEG. Six of those are Oliver
Kell's, and the sweep read two of his own articles in full and found *only* moving-
average periods — no entry, stop or size numbers. That is a finding, not a gap in the
search: **the numbers may not be published anywhere**, and the honest catalog entry
for them is a refusal with that reason rather than a plausible threshold.

⚠️ **RESEARCH WAS CUT SHORT BY A HARD SESSION LIMIT, NOT BY A JUDGEMENT THAT ENOUGH
HAD BEEN GATHERED.** WebSearch hit 200/200 and subagents hit 200/200, so no further
discovery was possible in this session — only direct fetches of URLs already known.
Two of the three URLs tried were 404s, which is exactly the cost of losing search.
The next session should resume here with the eight unpinned setups.
