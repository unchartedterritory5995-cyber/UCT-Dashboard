"""Historical expected move — reconstruct the pre-earnings ATM straddle for a
report that already happened.

WHY THIS EXISTS
    `implied_store` captures an expected move the night before each report, so
    the RICH/CHEAP verdict (was the option market's implied move too dear or
    too cheap versus what the stock actually did?) needs several PAIRED
    quarters before it can say anything. Waiting for those to accumulate means
    the feature stays dark for the better part of a year. Massive keeps both
    halves of what the nightly job would have seen, so the same quarters can be
    reconstructed today.

WHAT MAKES IT FAITHFUL
    Two things had to be true, and both were verified against the live API
    before this module was written (2026-08-06):

    1. Contract discovery `as_of` a past date. `/v3/reference/options/contracts`
       accepts `as_of`, so the strike ladder is the one that EXISTED then --
       not today's, which would silently include strikes listed after the fact.

    2. Historical NBBO. The live path prices a straddle off bid/ask MIDS
       (`implied_move._mid`). Daily aggregates carry only trade prices, and a
       backfill built on closes would be a different statistic wearing the same
       name -- worse than no backfill, because the verdict compares backfilled
       quarters against live ones and a method fork would read as a real edge.
       `/v3/quotes/{optionsTicker}` returns historical bid/ask, so the mid math
       is identical.

    The straddle itself is NOT reimplemented here: `implied_move.straddle_from_rows`
    and `implied_move.select_report_expiry` are imported and called. That is
    deliberate -- a second copy of this arithmetic would drift.

WHAT IS NOT IDENTICAL, AND IS RECORDED AS SUCH
    Rows are stamped `source="massive-backfill"` so they are never mistaken for
    live captures. The nightly job snapshots at whatever moment it runs; this
    reconstructs the last NBBO before the close of the prior session. Same
    method, slightly different instant.
"""
from __future__ import annotations

import datetime as _dt
import logging
import time

from api.services import earnings_estimates as ee
from api.services import polygon_options
from api.services.implied_move import select_report_expiry, straddle_from_rows
from api.services.massive import to_polygon_symbol

_log = logging.getLogger(__name__)

SOURCE = "massive-backfill"

# How far back to look for the prior session's close. A long holiday weekend
# plus a stray market closure is comfortably inside 6 calendar days; beyond
# that we would rather return nothing than price a straddle off a stale spot.
_MAX_LOOKBACK_DAYS = 6

# Strikes to pull around spot when assembling the ATM pair. The live chain uses
# strikes_around_spot=4; matching it keeps the ATM SELECTION identical, since
# `straddle_from_rows` picks the nearest strike from whatever it is handed.
_STRIKES_AROUND_SPOT = 4

# NBBO is read at the last quote at or before this UTC instant on the prior
# session -- 21:00Z is 16:00 ET during EDT, i.e. the close. Quotes are ordered
# desc and the first is taken, so an early close simply yields the last quote
# that actually printed.
_QUOTE_CUTOFF_UTC = "T21:00:00Z"

# Largest tolerated gap between the chosen ATM strike and spot. See the
# refusal in historical_expected_move.
_MAX_ATM_DEVIATION = 0.20


def _prior_session_close(sym: str, report_date: str) -> tuple[str, float] | None:
    """(date, close) of the last session with a print strictly BEFORE the
    report date. That is the spot the night-before capture would have used."""
    try:
        target = _dt.date.fromisoformat(report_date)
    except (TypeError, ValueError):
        _log.warning("implied_backfill: unparseable report_date=%s", report_date)
        return None
    start = (target - _dt.timedelta(days=_MAX_LOOKBACK_DAYS)).isoformat()
    end = (target - _dt.timedelta(days=1)).isoformat()
    try:
        data = polygon_options._safe_get(
            f"{polygon_options._BASE}/v2/aggs/ticker/{to_polygon_symbol(sym.upper())}/range/1/day/{start}/{end}",
            # adjusted=FALSE on purpose. Split-adjusted closes are restated
            # into TODAY's share terms, but `as_of` contract discovery returns
            # the strikes that were listed THEN, unadjusted. For any symbol
            # that split between the report and now, the two would be on
            # different scales — and the ATM pick would silently land on a
            # far-from-the-money strike rather than fail, producing a
            # confident wrong number. The raw close is the one that matches
            # the contemporaneous strike ladder.
            {"adjusted": "false", "sort": "desc", "limit": 10},
        )
    except Exception as exc:
        _log.warning("implied_backfill: spot fetch failed for %s: %s", sym, exc)
        return None
    for row in (data.get("results") or []):
        close = row.get("c")
        ts = row.get("t")
        if not isinstance(close, (int, float)) or isinstance(close, bool) or close <= 0:
            continue
        try:
            day = _dt.datetime.fromtimestamp(ts / 1000, _dt.timezone.utc).date().isoformat()
        except (TypeError, ValueError, OSError):
            continue
        return day, float(close)
    return None


def _expiry_for(sym: str, report_date: str, as_of: str) -> str | None:
    """The expiry the night-before capture would have chosen: the first one on
    or after the report date, among contracts that existed `as_of`."""
    try:
        data = polygon_options._safe_get(
            f"{polygon_options._BASE}/v3/reference/options/contracts",
            {"underlying_ticker": to_polygon_symbol(sym.upper()), "as_of": as_of,
             "expiration_date.gte": report_date, "sort": "expiration_date",
             "order": "asc", "limit": 1000},
        )
    except Exception as exc:
        _log.warning("implied_backfill: contract discovery failed for %s: %s", sym, exc)
        return None
    expirations = {c.get("expiration_date") for c in (data.get("results") or [])}
    # Reuses the LIVE selection rule rather than taking the first row back:
    # same tie-breaking, same "report beyond every listed expiry -> None".
    return select_report_expiry(sorted(e for e in expirations if e), report_date)


def _contracts_near_spot(sym: str, expiry: str, as_of: str, spot: float) -> list[dict]:
    try:
        data = polygon_options._safe_get(
            f"{polygon_options._BASE}/v3/reference/options/contracts",
            {"underlying_ticker": to_polygon_symbol(sym.upper()), "as_of": as_of,
             "expiration_date": expiry, "sort": "strike_price",
             "order": "asc", "limit": 1000},
        )
    except Exception as exc:
        _log.warning("implied_backfill: strike ladder failed for %s: %s", sym, exc)
        return []
    rows = []
    for c in (data.get("results") or []):
        strike, kind, tick = c.get("strike_price"), c.get("contract_type"), c.get("ticker")
        if not isinstance(strike, (int, float)) or not tick or kind not in ("call", "put"):
            continue
        rows.append({"strike": float(strike), "kind": kind, "ticker": tick})
    if not rows:
        return []
    # Keep the N strikes nearest spot on each side -- the same neighbourhood
    # the live chain requests. Pulling every strike would be thousands of
    # per-contract NBBO calls for one quarter.
    strikes = sorted({r["strike"] for r in rows}, key=lambda s: abs(s - spot))
    keep = set(strikes[: _STRIKES_AROUND_SPOT * 2])
    return [r for r in rows if r["strike"] in keep]


def _nbbo_at(option_ticker: str, as_of: str) -> dict | None:
    """Last bid/ask at or before the prior session's close."""
    try:
        data = polygon_options._safe_get(
            f"{polygon_options._BASE}/v3/quotes/{option_ticker}",
            {"timestamp.lte": f"{as_of}{_QUOTE_CUTOFF_UTC}", "order": "desc",
             "sort": "timestamp", "limit": 1},
        )
    except Exception as exc:
        _log.debug("implied_backfill: nbbo failed for %s: %s", option_ticker, exc)
        return None
    for q in (data.get("results") or []):
        bid, ask = q.get("bid_price"), q.get("ask_price")
        if bid is None or ask is None:
            continue
        # Shaped exactly like a `polygon_options.get_chain` row so
        # `straddle_from_rows` cannot tell the two paths apart.
        return {"bid": bid, "ask": ask}
    return None


def historical_expected_move(sym: str, report_date: str) -> dict | None:
    """Reconstruct the expected move as of the session before `report_date`.

    Returns the same shape as `implied_move.compute_expected_move` (plus
    `as_of`), or None when any leg is unavailable. Never raises.
    """
    sym = (sym or "").upper().strip()
    if not sym or not report_date:
        return None

    prior = _prior_session_close(sym, report_date)
    if not prior:
        _log.debug("implied_backfill %s %s: no prior session close", sym, report_date)
        return None
    as_of, spot = prior

    expiry = _expiry_for(sym, report_date, as_of)
    if not expiry:
        _log.debug("implied_backfill %s %s: no expiry on/after report", sym, report_date)
        return None

    contracts = _contracts_near_spot(sym, expiry, as_of, spot)
    if not contracts:
        _log.debug("implied_backfill %s %s: no strikes near spot", sym, report_date)
        return None

    calls, puts = [], []
    for c in contracts:
        quote = _nbbo_at(c["ticker"], as_of)
        if not quote:
            continue
        (calls if c["kind"] == "call" else puts).append({"strike": c["strike"], **quote})

    straddle = straddle_from_rows(calls, puts, spot)
    if straddle is None:
        _log.debug("implied_backfill %s %s: no usable ATM straddle", sym, report_date)
        return None

    # Backstop for a spot/strike SCALE mismatch (an unhandled split, a
    # symbol reused by a different company, a ladder that does not reach
    # the money). `straddle_from_rows` picks the NEAREST strike, so it
    # cannot detect this on its own — with a mismatch it happily returns a
    # straddle on a deep-OTM pair and the implied move comes out enormous
    # but well-formed. A real ATM strike sits within a few percent of spot;
    # 20% is loose enough for a wide ladder on an illiquid name and tight
    # enough that a scale error cannot pass.
    if abs(straddle["strike"] - spot) / spot > _MAX_ATM_DEVIATION:
        _log.warning("implied_backfill %s %s: ATM strike %.2f is %.0f%% from spot %.2f "
                     "— refusing (scale mismatch?)", sym, report_date,
                     straddle["strike"], abs(straddle["strike"] - spot) / spot * 100, spot)
        return None

    return {
        **straddle,
        "expiry": expiry,
        "horizon": f"through {expiry}",
        "as_of": as_of,
        "asof": as_of,
        "source": SOURCE,
    }


# Seconds between Finnhub calls. The bucket allows ~55/min and is SHARED with
# live member traffic, so this job deliberately takes a small slice (~20/min)
# and leaves the rest to the app. Overridable with --fh-pace.
_FH_PACE_SECONDS = 3.0
# Finnhub's shared cooldown on a 429 is 20s; wait past it before retrying.
_FH_COOLDOWN_WAIT = 22.0
_FH_ATTEMPTS = 3

# Finnhub /stock/earnings returns at most 4 quarters on this plan regardless of
# `limit` (measured 2026-08-06), and it is the only fiscal-identity source, so
# no amount of --quarters can exceed that.
_MAX_BACKFILLABLE_QUARTERS = 4


def past_reports(sym: str, limit: int) -> list[dict]:
    """Past ANNOUNCEMENT dates carrying real fiscal identity, newest first.

    Neither provider has both halves, so this joins them:

      * FMP `stable/earnings` has the ANNOUNCEMENT date — the day the market
        actually repriced, which is the date an implied snapshot is keyed on —
        but carries no fiscal year/quarter at all (verified 2026-08-06: the
        row is {symbol, date, epsActual, epsEstimated, revenue*, lastUpdated}).
      * Finnhub `/stock/earnings` has the real fiscal `quarter`/`year`, but
        its `period` is the period END, not the announcement.

    The join rule: the fiscal row whose `period` is NEAREST the announcement.

    "Most recent period ending before the announcement" is the intuitive rule
    and it is WRONG. Finnhub's `period` is the calendar quarter-end CONTAINING
    the fiscal period end, which can land on either side of the announcement:

        AAPL  fiscal Q4 FY2025 ended Sep 27 -> period 2025-09-30, announced
              Oct 30. The period precedes the announcement.
        NVDA  fiscal Q3 FY2026 ended Oct 26 -> period 2025-12-31, announced
              Nov 19. The period FOLLOWS the announcement.

    So "before" silently mislabels every NVDA quarter and "on or after"
    silently mislabels every AAPL quarter — each off by exactly one, in
    opposite directions, which is the worst kind of wrong: it pairs a snapshot
    against a real but incorrect quarter's realized move rather than failing.
    Nearest handles both. Verified 2026-08-06 against 9 known announcements
    across three fiscal shapes (NVDA Jan-end, AAPL Sep-end, MSFT Jun-end):
    9/9 correct, where each single-sided rule scored 3/9 or 6/9.

    Deliberately NOT derived from the announcement month either. A
    calendar-fiscal guess (Jan-Mar -> Q4, Apr-Jun -> Q1, ...) is wrong for
    every off-calendar filer. Unmatched announcements are dropped.
    """
    today = _dt.date.today().isoformat()
    # Newest-first, and includes not-yet-reported rows (filtered below).
    fmp = ee._fmp_get("/stable/earnings", {"symbol": sym.upper(), "limit": max(limit * 3, 24)})
    announcements = []
    for r in fmp or []:
        if not isinstance(r, dict):
            continue
        date = str(r.get("date") or "")[:10]
        if date and date < today:          # exclude future / today's unreported
            announcements.append(date)

    if not announcements:
        return []

    # Finnhub is the ONLY source of fiscal identity here, and its budget is a
    # process-wide token bucket SHARED WITH THE LIVE APP. Unpaced, a 739-symbol
    # sweep 429s on its very first call, engages a 20s shared cooldown, and
    # then races through every remaining symbol getting empty responses — the
    # whole run "succeeds" in seconds having written almost nothing. Worse, it
    # would be starving members' requests for the same budget.
    #
    # So: pace every call, and RETRY through a cooldown instead of treating an
    # empty response as "this company has no earnings history". Only retry
    # when FMP already confirmed the symbol is real (above), so a genuinely
    # uncovered ticker still costs at most one extra wait.
    fh = None
    for attempt in range(_FH_ATTEMPTS):
        if _FH_PACE_SECONDS:
            time.sleep(_FH_PACE_SECONDS)
        fh = ee._fh_get("/stock/earnings", {"symbol": sym.upper(),
                                            "limit": max(limit * 2, 16)})
        if fh:
            break
        if attempt < _FH_ATTEMPTS - 1:
            time.sleep(_FH_COOLDOWN_WAIT)
    periods = []
    for q in fh or []:
        if not isinstance(q, dict):
            continue
        end = str(q.get("period") or "")[:10]
        fy, fq = ee._int_or_none(q.get("year")), ee._int_or_none(q.get("quarter"))
        if end and fy is not None and fq is not None and 1 <= fq <= 4:
            periods.append((end, fy, fq))
    out, used = [], set()
    for date in sorted(announcements, reverse=True):
        try:
            ad = _dt.date.fromisoformat(date)
        except ValueError:
            continue
        scored = []
        for (end, fy, fq) in periods:
            try:
                scored.append((abs((_dt.date.fromisoformat(end) - ad).days), fy, fq))
            except ValueError:
                continue
        if not scored:
            continue
        gap, fy, fq = min(scored)
        # A real announcement sits within one calendar quarter of its period
        # bucket; beyond that the "nearest" row is just the least-far wrong
        # one, which is exactly the silent mispairing this rule exists to
        # avoid. Refuse rather than guess.
        if gap > 100:
            continue
        if (fy, fq) in used:               # two announcements, one quarter
            continue
        used.add((fy, fq))
        out.append({"report_date": date, "fiscal_year": fy, "fiscal_quarter": fq})
        if len(out) >= limit:
            break
    return out


# ── Nightly sweep ─────────────────────────────────────────────────────────────
# 17:00 ET, weekdays. AFTER the close and AFTER the 16:35 ET nightly capture, on
# purpose: the two write the same store and both need the same Finnhub budget,
# and a backfill has no deadline while a capture does.
SWEEP_HOUR_ET = 17
SWEEP_MINUTE_ET = 0

# Wall-clock ceiling for one night. The sweep is INCREMENTAL — every symbol it
# already captured is skipped on the next run — so it does not need to finish in
# one night, and it must not still be running when the pre-market tape starts.
_SWEEP_MAX_SECONDS = 3 * 3600


def run_backfill_sweep(max_seconds: int = _SWEEP_MAX_SECONDS,
                       quarters: int = _MAX_BACKFILLABLE_QUARTERS) -> str:
    """Reconstruct missing history for every symbol the store already tracks.

    Idempotent and resumable: `_has_snapshot` skips captured quarters, so a
    redeploy, a crash, or the time ceiling below costs only time. That is what
    makes a nightly cron the right home for this rather than a one-shot script
    someone has to babysit — an interrupted run simply continues tomorrow.

    Never raises: a scheduler job that throws takes its own next fire with it.
    """
    from api.services import implied_store as store

    started = time.time()
    wrote = skipped = no_move = unresolved = 0
    stopped_early = False
    try:
        syms = store.all_symbols()
    except Exception as exc:
        _log.warning("implied backfill sweep: symbol list failed: %s", exc)
        return "implied backfill sweep: could not read the symbol list"

    for sym in syms:
        if time.time() - started > max_seconds:
            stopped_early = True
            break
        try:
            reports = past_reports(sym, quarters)
        except Exception as exc:
            _log.warning("implied backfill sweep: %s report lookup failed: %s", sym, exc)
            continue
        if not reports:
            unresolved += 1
            continue
        for rep in reports:
            rd = rep["report_date"]
            try:
                if store._has_snapshot(sym, rd):
                    skipped += 1
                    continue
                move = historical_expected_move(sym, rd)
                if not move:
                    no_move += 1
                    continue
                store.record_implied(
                    sym, rd, move,
                    captured_at=f"{move['as_of']}T21:00:00Z",
                    fiscal_year=rep["fiscal_year"], fiscal_quarter=rep["fiscal_quarter"],
                )
                wrote += 1
            except Exception as exc:
                _log.warning("implied backfill sweep: %s %s failed: %s", sym, rd, exc)

    mins = (time.time() - started) / 60
    return (f"implied backfill sweep: wrote {wrote}, already had {skipped}, "
            f"no straddle {no_move}, unresolved {unresolved} "
            f"over {len(syms)} symbols in {mins:.0f}m"
            + (" (hit the time ceiling; continues tomorrow)" if stopped_early else ""))
