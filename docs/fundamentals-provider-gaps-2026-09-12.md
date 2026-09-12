# Fundamentals provider gaps — investigated and mostly closed, 2026-09-12

What the "Fundamentals data regression" alerts were reporting, how widespread it
was, what fixed it, and the narrow residue that still needs a provider ticket.
Companion to `fix/fundamentals-staleness-and-alert-dedupe`.

## The short version

The alerts were **true positives**. `/stable/earnings` — the only earnings
endpoint on this plan — stops returning rows for reports that happened, for a
slice of US operating companies. MMC's stops at 2026-01-29 with two quarters
reported since, so the widget showed 2025 Q4 as its latest quarter with nothing
said.

**The data was recoverable from a source we already pay for.**
`/stable/income-statement?period=quarter` — the same vendor, the same key, a
different endpoint — carries those quarters. It is now the third gap-fill leg in
`get_year_earnings`, and MMC, BK and SJW read through 2026 Q2 with
`stale_quarters = 0`. Nine of the fifteen names investigated came out clean.

A ticket is still worth filing for the six where FMP's whole record stops, but it
is no longer the only route and no member is waiting on it.

## ⚠️ Two measurements, and the first one overstated the problem

Recorded in full because the correction matters more than the numbers.

**Scan 1 — endpoint-only.** Random samples of `api/data/cap_universe.json`,
counting a ticker STALE when the newest `/stable/earnings` row carrying an actual
was >135 days old. n=300 gave 8.0% stale / 2.3% operating companies; n=900 gave
**6.1% / 1.44%**.

⛔ **Both figures measure ONE ENDPOINT, not what a member sees.** The pipeline
merges `/stable/earnings` with Finnhub and (now) the income statement, so an
endpoint-only scan counts names the merge already covers. It over-counted in a
way the method could not see: of the 15 names it flagged, four (TMHC, PRTC, VRE,
CVGW) are only **one** quarter behind once the legs are merged — an ordinary late
filer, below the notice threshold and not a defect at all.

**Scan 2 — through the real merged pipeline** (`get_year_earnings` for 2025+2026,
then `reported_staleness`), n=150, after the fix:

| | Count | Share |
|---|---|---|
| OK | 145 | 96.7% |
| **Stale (≥2 quarters behind)** | **3** | **2.0%** |
| No data at all | 2 | 1.3% |

**All three stale names are closed-end funds** — VVR (Invesco Senior Income
Trust), ISD (PGIM High Yield Bond), PPT (Franklin Premier Income Trust), each
`isFund=True`, each caught by the monitor's fund exclusion, none of which has a
quarterly EPS strip by nature.

⚠️ **That is not a claim of zero.** The residual operating-company rate implied
by scan 1's follow-through is on the order of 0.5–1%, so a fresh 150-name draw
containing none of them is *consistent with* that rate, not proof against it.
And the run hit Finnhub 429s, which degrades a leg and makes staleness look
**worse**, so 2.0% is an upper bound.

⭐ The general lesson, worth carrying: **a scan of one provider endpoint is not a
measurement of the product.** The first number went into two write-ups before
anyone ran the merged pipeline.

## What the income-statement leg recovers

Measured with this module's own fiscal mappers — `_fiscal_q_from_report` for
report dates, `_fiscal_q_from_period_end` for period ends — after a first attempt
compared the two date kinds directly and produced nonsense (`/stable/earnings`
`date` is the REPORT date; `/stable/income-statement` `date` is the PERIOD END,
~1–2 months earlier, so a naive `>` reads a same-quarter row as "behind").

| Ticker | earnings newest | income-stmt newest | Gain |
|---|---|---|---|
| MMC | 2025 Q4 | **2026 Q2** | +2 |
| SJW | 2025 Q4 | **2026 Q2** | +2 |
| RNP | 2025 Q4 | **2026 Q2** | +2 |
| BK | 2026 Q1 | **2026 Q2** | +1 |

End-to-end through the real pipeline, the fifteen investigated names now read:

**Clean (9):** MMC · BK · ERJ · TMHC · PRTC · SJW · VRE · RNP · CVGW
**Still stale (6):** EXAS · ACLX · FOLD · DHIL · BRY · HOLX

## The three upstream failure modes

1. **The feed stops.** MMC, BK, SJW, RNP — `/stable/earnings` has no row for
   reports that happened. **Now covered** by the income statement.
2. **A row exists with null actuals.** HOLX carries `date=2026-05-07` with
   `epsActual: null, revenueActual: null` and nothing after. Not covered — the
   income statement stops at the same quarter.
3. **The whole record stops.** EXAS, ACLX, FOLD, DHIL, BRY — every FMP endpoint
   ends at the same quarter, Finnhub is older, Yahoo is empty or shorter. Not
   recoverable from anything we hold.

## What is NOT the answer, so nobody re-tries it

- **Yahoo.** `quarterly_income_stmt` and `earnings_dates` are **empty for MMC,
  BK and HOLX** (control: AAPL and NVDA return five quarters in the same
  session, so not a rate limit). Yahoo's MMC record stops at 2025-10-16 — a
  *bigger* hole than FMP's. The yfinance re-gating on this branch is still worth
  having, but it recovers nothing here.
- **Massive/Polygon `/vX/reference/financials`.** Has data, but lags (MMC newest
  2025-12-31, BK 2026-03-31) and its revenue disagrees with FMP for banks
  (BK 2025 Q1: 6123M vs FMP's 4792M — different revenue definitions). Using it
  would put a second authority on revenue for exactly the sector where the two
  disagree most.
- **`_UNREPORTED_GRACE_DAYS` (130d).** CLAUDE.md suggested tightening it. It is
  correct in both directions: on MMC it rightly drops the 2026-03-31 estimate
  row, because that quarter should be a reported actual and showing it as a
  forward estimate is the lie to avoid. Tightening drops more real forward
  quarters; loosening re-admits stale estimates for already-reported ones, which
  is the `reported_forward_overlap` class. **The gap was upstream absence, not
  our window.**

## Deploying this — the watch-coverage FAIL is accepted, and why

`python tools/flow_worker_watch_coverage.py` **exits 1** on this branch:

```
FAIL — flow-worker RUNS these files but will NOT redeploy for them:
    api/services/earnings_estimates.py
```

The tool is right about static reachability; the answer is **accepted skew — do
not trigger a flow-worker redeploy.** The chain:

```
api.flow_worker_main -> api.flow_gap_autofill -> api.services.liveflow_monitor
  -> api.services.bars_fetch -> api.services.bars_sanitize
    -> api.services.earnings_estimates
```

`bars_sanitize` imports **exactly one symbol**, function-locally at line 261:
`from api.services.earnings_estimates import _fmp_get`. This branch changes
`get_year_earnings`'s provider chain and adds three helpers. It does not touch
`_fmp_get` or anything `_fmp_get` calls, so flow-worker behaves identically on
either version.

⭐ The trade being refused: a flow-worker restart drops the Massive OPRA
websocket and **Massive does not replay** — permanent gap until the T+1 flat file
(`docs/runbooks/deploy-windows.md` Tier 2). Paying that to synchronise a function
nothing in that process calls is the wrong way round.

⛔ **Per-push, not a standing exemption.** A future change touching `_fmp_get`,
or a new symbol `bars_sanitize` starts importing, genuinely needs the window.
Re-run the tool and redo this analysis; do not cite this paragraph.

Everything else is `api/services/**`, `tests/**`, `app/**` and docs → restarts
web plus worker and bars-api (both watch `api/**`), ~1 min of `/api/*` blip.
Tier 1: push any time, but if a scheduled job is due in the next minute or two,
wait for it.

## The remaining ask (paste-ready, narrowed)

Worth filing, no longer urgent — these five are the ones nothing we hold can
recover.

> **Plan:** Ultimate. **Endpoints:** `/stable/earnings` and
> `/stable/income-statement`.
>
> For a subset of US operating companies both endpoints stop returning data for
> quarters the companies have reported and filed. Newest quarter your API
> returns for each, verified against their filings:
>
> - `EXAS` (Exact Sciences, ~$20B) — 2025 Q4
> - `FOLD` (Amicus Therapeutics, ~$4.5B) — 2025 Q4
> - `ACLX` (Arcellx, ~$6.7B) — 2025 Q4
> - `DHIL` (Diamond Hill, ~$0.5B) — 2025 Q4
> - `BRY` (Berry Corporation, ~$0.3B) — 2025 Q3
>
> Separately, `HOLX` (Hologic, ~$17B) returns a row dated 2026-05-07 on
> `/stable/earnings` with `epsActual` and `revenueActual` both null, and no row
> after it — the report is known but unpopulated.
>
> Also: for `MMC` your API dates the 1.87 EPS report 2026-01-29 while another
> provider dates the same figure 2025-01-30. Could you confirm which is correct?
> A shifted report date lands the quarter under the wrong fiscal label.

## What the code change does and does not do

**Does:** recovers the quarters `/stable/earnings` dropped, for every name where
the income statement has them (MMC, BK, SJW, RNP among those investigated);
stops paging about defects nobody can act on; excludes funds; detects the
staleness that remains and tells the member their latest quarter is unavailable
instead of implying an old one is current; makes the yfinance leg reachable for
US tickers in recent years.

**Does not:** recover quarters absent from every endpoint we hold — the six
above. Those now surface honestly (notice + daily digest, never a page) rather
than silently.
