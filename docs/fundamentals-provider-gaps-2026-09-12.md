# Fundamentals provider gaps — measured 2026-09-12

What the "Fundamentals data regression" alerts were actually reporting, how
widespread it is, and the escalation we owe FMP. Companion to the code change on
`fix/fundamentals-staleness-and-alert-dedupe`.

## The short version

The alerts were **true positives**. For a small but real slice of the universe
our providers stop delivering quarterly earnings, the widget's completeness
guard could not see it, and members were shown an old quarter as the latest with
nothing said. The code change makes that visible and stops the monitor paging
about it nightly. **Restoring the data itself is a provider problem and needs a
support ticket** — that is the only open item here.

## Method

`/stable/earnings?symbol=<T>&limit=12` for a random sample of
`api/data/cap_universe.json`; a ticker counts as STALE when the newest row
carrying an actual (`epsActual` or `revenueActual`) is more than 135 days old —
i.e. at least one quarterly report is missing. Stale names were then classified
with `/stable/profile` (`isFund`/`isEtf`) and cross-checked against Finnhub
`/stock/earnings`, which is the gap-fill `get_year_earnings` actually uses.

⚠️ **Two samples were taken and they disagree.** The first (n=300, seed 11)
gave 8.0% stale / 2.3% operating companies. The second (n=900, seed 4242) gives
6.1% / 1.44%. **Use the 900 figure** — it is the larger sample and the earlier
number was quoted in the first write-up of this investigation before the wider
scan was run. Both are recorded so nobody re-derives the old one from the
earlier prose and thinks it is a second confirmation.

## Prevalence (n=900 of 3,742)

| Bucket | Count | Share |
|---|---|---|
| OK | 811 | 90.1% |
| **Stale** (>135d since newest reported quarter) | **55** | **6.1%** |
| No actuals at all | 4 | 0.4% |
| No FMP rows at all | 30 | 3.3% |

Of the 55 stale names, **42 are funds or ETFs** — closed-end funds (Nuveen,
PIMCO, Eaton Vance, BlackRock) that can never have a quarterly EPS strip. They
are not a data gap; they are names that should never have been invariant-checked,
and the code change now skips them.

**13 are operating companies — 1.44% of the sample.** Finnhub rescued only
**2 of the 55**, so the fallback chain is not covering this.

## The 13, and whether anything covers them

| Ticker | Mkt cap | FMP newest actual | Days | Finnhub | Covered? |
|---|---|---|---|---|---|
| MMC | $89.8B | 2026-01-29 | 226 | empty | **no** |
| ERJ | $47.4B | 2025-11-04 | 312 | 2026-06-30 | yes — gap-fill |
| EXAS | $20.0B | 2026-02-13 | 211 | 2025-12-31 (older) | **no** |
| ACLX | $6.7B | 2026-02-26 | 198 | 2025-12-31 (older) | **no** |
| TMHC | $6.7B | 2026-04-22 | 143 | 2026-03-31 (older) | **no** |
| FOLD | $4.5B | 2026-02-20 | 204 | 2025-12-31 (older) | **no** |
| PRTC | $4.2B | 2026-04-29 | 136 | 2024-12-31 (older) | **no** |
| SJW | $1.9B | 2026-02-26 | 198 | empty | **no** |
| VRE | $1.8B | 2026-04-22 | 143 | 2025-12-31 (older) | **no** |
| RNP | $0.9B | 2026-03-05 | 191 | empty | **no** — but see below |
| DHIL | $0.5B | 2026-02-26 | 198 | 2025-03-31 (older) | **no** |
| CVGW | $0.5B | 2026-03-12 | 184 | 2026-03-31 | yes — gap-fill |
| BRY | $0.3B | 2025-11-05 | 311 | 2025-09-30 (older) | **no** |

So **11 of 900 (~1.2%)** have no source newer than FMP — extrapolating,
on the order of **45 operating companies** across the universe.

⚠️ **RNP is a closed-end fund** (Cohen & Steers REIT and Preferred Income) that
FMP's `isFund`/`isEtf` flags do **not** set, so the fund exclusion will not catch
it. An industry-based exclusion would be worse, not better: DHIL is also
"Asset Management" and is a genuine operating company. FMP's flag is the
principled signal and this is its known miss rate — RNP will be recorded as a
shape defect and digested, never paged, which is the right outcome for a name
nobody can fix.

## Three distinct upstream failure modes

Worth keeping separate; they need different asks.

1. **The feed stops.** MMC and BK have a clean quarterly cadence and then
   nothing — no row at all for reports that happened. MMC's last row is
   2026-01-29 and it has reported twice since.
2. **A row exists with null actuals.** HOLX carries `date=2026-05-07` with
   `epsActual: null, revenueActual: null` — FMP knows the report happened and
   never filled the numbers.
3. **The record is sparse and irregular.** Mostly funds, where quarterly
   earnings are not a meaningful concept.

⚠️ **Unresolved, and worth raising in the ticket:** FMP dates MMC's 1.87 EPS
report as **2026-01-29** while Yahoo dates the same figure **2025-01-30** — a
year apart. Either a coincidence of two similar quarters or a corrupted date on
FMP's side. Not established either way here, and it matters because a shifted
date lands the quarter under the wrong fiscal label.

## Yahoo is not the answer for the worst cases

`quarterly_income_stmt` and `earnings_dates` are **empty for MMC, BK and HOLX**
(control: AAPL and NVDA return five quarters in the same session, so this is not
a rate limit). Yahoo's MMC record has actuals through 2025-10-16 and then jumps
to a future scheduled date — a *bigger* hole than FMP's.

⭐ This is why the yfinance re-gating in the code change is worth doing but is
**not** a fix for these names: it turns a fallback that could never run for a US
ticker into one that runs where Yahoo has data, and Yahoo does not have data
here. Do not read that change as closing this gap.

## The ask (paste-ready)

> **Plan:** Ultimate. **Endpoint:** `/stable/earnings`.
>
> For a subset of US operating companies, `/stable/earnings` stops returning
> rows for reports that have taken place. Examples, all verified against the
> companies' own filings, with the newest row your API returns that carries an
> actual:
>
> - `MMC` (Marsh & McLennan, ~$90B) — newest actual dated 2026-01-29. Two
>   quarters reported since; no rows for them.
> - `BK` (Bank of New York Mellon, ~$97B) — newest actual 2026-04-16; the
>   following quarter is absent.
> - `HOLX` (Hologic, ~$17B) — a row exists for 2026-05-07 with `epsActual` and
>   `revenueActual` both null, and nothing after it.
> - Also affected: `EXAS`, `FOLD`, `ACLX`, `TMHC`, `VRE`, `SJW`, `DHIL`, `BRY`,
>   `PRTC`.
>
> Separately, for `MMC` your API dates the 1.87 EPS report 2026-01-29 while
> another provider dates the same figure 2025-01-30. Could you confirm which is
> correct?
>
> Measured prevalence: 13 of a random 900-symbol sample of US listings.

## What the code change does and does not do

Does: stops paging about it, excludes funds, detects the staleness, and tells the
member their latest quarter is unavailable instead of implying an old one is
current. Makes the yfinance leg reachable for US tickers in recent years.

Does **not**: recover the missing numbers. Nothing in our code can — the data is
absent from every provider we read for 11 of these names. The ticket above is
the only route.
