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

## ⛔ THE FMP TICKET IS WITHDRAWN — DO NOT SEND IT

An earlier revision of this document carried a paste-ready support ticket
accusing FMP of dropping filed quarters for `EXAS`, `FOLD`, `ACLX`, `DHIL`,
`BRY` and `HOLX`. **That accusation is false and the ticket must not be sent.**

Checked against **SEC EDGAR's submissions index** — the filings themselves, not
a vendor's copy of them — on 2026-09-12:

| Ticker | Newest SEC filing | Period end | Filed | What FMP has |
|---|---|---|---|---|
| HOLX | 10-Q | 2025-12-27 | 2026-01-29 | the same |
| EXAS | 10-K | 2025-12-31 | 2026-02-13 | the same |
| ACLX | 10-K | 2025-12-31 | 2026-02-26 | the same |
| FOLD | 10-K | 2025-12-31 | 2026-02-20 | the same |
| DHIL | 10-K | 2025-12-31 | 2026-02-26 | the same |
| BRY | 10-Q | 2025-09-30 | 2025-11-05 | the same |

**Control (this is what makes the table mean anything):** the same method run
against `MMC`, `BK` and `AAPL` returns a **2026 Q2** 10-Q for each — period ends
2026-06-30, 2026-06-30 and 2026-06-27, filed 2026-07-21, 2026-07-31 and
2026-07-31. So the method does find current filings; it is not silently
returning stale data for everything.

⭐ **These six are not provider gaps. The companies have not filed anything
newer.** FMP has everything that exists. Sending that ticket would have been a
wrong accusation against a vendor, generated from a scan that only ever looked
at other vendors.

⚰️ **Two instrument failures nearly published it as fact.** First,
`https://www.sec.gov/files/company_tickers.json` returned no entry for HOLX,
EXAS, ACLX, FOLD, DHIL *or* BRY — and the first version of the probe printed
"(no CIK — not a US filer?)", **a fabricated explanation for the instrument's own
limitation**. That file is partial: it has 10,426 entries and is missing `MMC`
and `BK` too, both certain filers. Second, an earlier run had swallowed a
transient fetch error and built an EMPTY ticker map, so every lookup "failed"
identically. Both were caught only by adding controls — assert the map is large,
assert `AAPL` resolves — and by resolving CIKs through
`browse-edgar?action=getcompany&CIK=<ticker>`, which works for all of them.

⛔ **An absence is only evidence if the instrument could have seen a presence.**
This document asserted a vendor was at fault on the strength of three vendors
being silent, and the authoritative source was one HTTP call away.

### What, if anything, is still worth raising with FMP

One thing only, and it is a question rather than a complaint: for `MMC`, FMP
dates the 1.87 EPS report **2026-01-29** while another provider dates the same
figure **2025-01-30**. A shifted report date lands a quarter under the wrong
fiscal label. Worth asking; not worth a ticket on its own.

`/stable/earnings` dropping quarters for MMC, BK, SJW and RNP **was** real — the
companies had filed (MMC's Q2 2026 10-Q was filed 2026-07-21) and that endpoint
did not have it. But it is fixed from inside, by reading FMP's own income
statement, so there is nothing to ask for.

## The monitor now confirms before it accuses

The withdrawal above exposed a design flaw, not just a wrong document:
`reported_staleness` answers *"is what we hold old?"*, and the monitor was
reading that as *"we are missing something"*. Those are different questions and
only the second is a defect.

`check_ticker` now consults `edgar.newest_reported_quarter(sym)` — the SEC
submissions index — and raises `stale_reported` **only when the filings show a
periodic report we do not have**. Validated against live SEC on 2026-09-12:

| Ticker | We serve | SEC shows | Monitor |
|---|---|---|---|
| HOLX, EXAS, ACLX, FOLD, DHIL | 2025 Q4 | 2025 Q4 | **no flag** |
| BRY | 2025 Q4 | 2025 Q3 | **no flag** |
| MMC (pre-fix state) | 2025 Q4 | **2026 Q2** | **flag — real gap** |

Without this, those six would have sat in the daily digest forever — a slower
version of the spam this whole change removed.

⚠️ Cost and failure modes: SEC is consulted only for a strip that already looks
stale, cached per ticker per UTC day, and a `None` answer does not flag — an
outage must not manufacture findings. The member-facing notice is deliberately
NOT gated on this: a member wants to know the figures are old whatever the
reason.

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
