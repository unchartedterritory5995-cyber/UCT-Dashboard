# Screen backtesting — design (2026-08-23, written for the next build slot)

**Goal:** answer *"did this screen ever work?"* — the largest category-level
absence in the product, named in the controller's benchmark prior alongside
freshness (already in build) and fundamental history (deliberately out of scope
here, see §6).

**Status:** DESIGN ONLY. Blocked on file ownership until the live-tier workflow
releases `api/main.py`, `query.py` and `routers/screener.py`.

---

## 1 · Why this is reachable here, when it usually isn't

Most screeners cannot backtest because their screen is a SQL row filter over a
current snapshot — there is no history to replay. We are in a better position
than that, for one specific reason:

⭐ **The AST already evaluates against a bar array.** `ast_interpret.interpret(tree, bars)`
returns a value **per bar**, not one value for "now". A formula written in bar
terms is therefore *already* a time series of true/false — we have simply never
read the earlier entries. Backtesting a bar-expressible screen is not a new
engine; it is reading the part of the answer we currently throw away.

That single fact decides the whole design: **v1 backtests what the AST can
already say, and refuses — loudly, by name — everything else.**

## 2 · The bright line, and why it is not a limitation to apologise for

| Screen contains | Backtestable? | Why |
|---|---|---|
| bar series (`close`, `high`, `volume`), functions (`sma`, `atr`…), the offset node | ✅ | `bars.db` holds real history; the tree evaluates per bar |
| a declared SCALAR (`market_cap`, `rs_rank`, `pe_ttm`, `pattern_engine_vcp`…) | ⛔ **REFUSE** | `screener_rows` holds ONE row per ticker. There is no history of these values — `snapshot-status` shows 2-3 distinct snapshot dates, all recent. Evaluating today's `market_cap` at a 2024 bar is **survivorship-flavoured lookahead**: it screens the past using a fact from the future. |

⛔ **The refusal is the feature.** A backtester that quietly substitutes today's
fundamentals into a 2024 date produces a beautiful, wrong equity curve, and the
user cannot tell. Every competitor result of that shape is untrustworthy for
exactly this reason. We refuse by NAME — *"this screen cannot be backtested: it
reads `rs_rank`, and we hold no history of it"* — which is the same
`refusal ≠ empty` contract the coverage line already keeps.

This maps cleanly onto machinery that exists: `ast_interpret.unresolved_scalars(tree, {})`
already enumerates the scalars a tree reads, and `scan_evaluator` already draws
the dropped/not-computable distinction.

## 3 · Shape

```
POST /api/screener/backtest   (paid; admin not required — it spends bars, not provider budget)
  { source | ast, universe: "current" | <saved screen id>, from, to, horizons: [5,10,20] }
→ { backtestable: true,
    evaluated_dates, symbols_tested, signals,
    forward_returns: { "5":  {n, win_rate, avg_pct, median_pct, best, worst},
                       "10": {...}, "20": {...} },
    baseline:        { "5": {...} },        # the SAME universe, same dates, no filter
    coverage: { symbols_with_bars, symbols_missing_bars, dates_skipped_no_bars },
    as_of, bars_source }
→ or { backtestable: false, refused: "scalar_no_history", names: ["rs_rank"], detail: "…" }
```

### Rules that make the number honest
1. **A baseline is mandatory, not optional.** A 58% win rate means nothing until
   you know the universe did 55% over the same dates. Ship them adjacent; never
   the strategy number alone.
2. **Forward returns are measured from the NEXT bar's open**, never the signal
   bar's close — a fill you could not have got is the oldest way to flatter a
   backtest.
3. **Coverage counts travel with the result**, in the CoverageLine idiom: a
   symbol with no bars in the window is *not tested*, and must never be silently
   dropped into the denominator or out of it without saying so.
4. **The universe is the CURRENT membership** and that is itself a survivorship
   bias — we hold no historical constituent lists. ⛔ It must be **stated in the
   payload and rendered beside the result**, not buried in a doc. "This tests
   today's names against yesterday's prices" is a real caveat and the user has
   to see it to weigh the number.
5. **Refuse a window with too few signals** rather than reporting a win rate over
   n=3. Floor stated in the payload, not silently applied.

## 4 · Implementation sketch

- New `api/services/screener/backtest.py` — the ONE owner. Pure: takes a tree +
  a symbol list + a date range, returns the receipt. No route logic, no I/O
  beyond the bars reader it is handed (so it is testable without a DB).
- Reuse `api/services/bars_sqlite` / the existing bars reader; reuse the daily
  cache. **No new provider path** — this is exactly the fanout the 2026-07-01
  outage warns about; a 3,700-symbol × 500-bar sweep must be bounded and
  off the request path (background job + polled receipt, the `?background=1`
  idiom the calendar brief already uses).
- New router file `api/routers/screener_backtest.py` so the screener router is
  untouched (it is a hot, heavily-railed file with a route-count oracle).
- ⚠️ The route-count and auth-partition rails in `tests/test_scan_screener_auth.py`
  cover `screener.py` and `scans.py`; a new router needs its own coverage or an
  explicit, reasoned extension — do not let a new surface land ungated.

## 5 · Tests that must exist (each with a control)

- A tree containing a scalar REFUSES by name — and the control shows a bar-only
  tree of the same shape does not.
- Forward return uses the next bar's open: a fixture where close-fill and
  open-fill differ, asserting the open number.
- Baseline present and different from the strategy number.
- A symbol with a gap in its bars is COUNTED as untested, not dropped.
- Below-floor signal count refuses rather than reporting.
- Determinism: same inputs, same receipt (no clock, no RNG).

## 6 · Deliberately NOT in v1 (recorded so absence reads as decision)

- **Fundamental history.** Would need years of statements ingested per symbol —
  a data project, not a feature. It is the honest reason scalar screens refuse,
  and it is the natural v2.
- Position sizing, stops, portfolio simulation, transaction costs. v1 answers
  *"did names matching this screen tend to go up?"*, not *"what would I have
  made?"* — and the payload's wording must not blur the two.
- Intraday backtests (bars.db intraday retention differs from daily).
