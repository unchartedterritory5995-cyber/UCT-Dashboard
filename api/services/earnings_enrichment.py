"""Earnings preview/analysis enrichment helpers.

Provides high-value pre-earnings data members care about:
- Pre-earnings price-action context (5d / 30d returns)
- Historical earnings-day moves (avg ± move over last N reports)
- Estimate / analyst revision trends (Finnhub recommendation-trends proxy)
- Beat-magnitude history (surprise % per quarter for visualization)
- Implied move from front-week ATM options straddle (yfinance; the SPOT comes
  out of the chain response itself, not a second fetch — see section 5)
- Key quotes extracted from the most recent earnings call transcript

All helpers are best-effort — return None on any failure, never raise.
Every yfinance call here goes through `yf_util.bounded_call` — see the guard
note below; this module must never grow a pool or a deadline of its own.
The earnings router fans these out in parallel via ThreadPoolExecutor and
folds the results into the existing _generate_earnings_preview /
_generate_earnings_analysis responses.
"""
from __future__ import annotations

import datetime as _dt
import inspect as _inspect
import logging
import math
import threading
from typing import Optional

from api.services import yf_util

_logger = logging.getLogger(__name__)


# ─── Every yfinance call in this file goes through THE shared guard ───────────
#
# Three helpers here did `import yfinance` inside the function and then called
# it straight — no timeout, no concurrency cap, and invisible to the process's
# rate-limit handling. Two distinct exposures, and they are NOT the same bug:
#
#   1. UNBOUNDED WALL CLOCK. `enrich_earnings_response` fans these out on its
#      own `ThreadPoolExecutor`, and `as_completed(timeout=25)` does NOT cancel
#      a running future — the `with` block's `shutdown(wait=True)` then blocks
#      on it forever. `_compute_hist_stats` (calendar.py) calls
#      `get_historical_earnings_moves` with no bound at all. One hung Yahoo
#      socket pins an anyio worker indefinitely: the 2026-07-01 thread-
#      exhaustion class, verbatim.
#   2. NO SHARED VIEW OF A 429. This module is the burstiest yfinance caller in
#      the repo (the enrichment sweep at 6 workers × 2 dates, plus a 7×/weekday
#      preview warmer over ~80 symbols), so a rate limit is most likely to be
#      SEEN here first — and, unguarded, least likely to pause anyone else.
#
# ⛔ THE OBVIOUS FIX IS THE WRONG ONE, AND I BUILT IT FIRST. A private
# `ThreadPoolExecutor` here bounds (1) perfectly and does nothing for (2): it is
# a fourth pool that neither trips the shared breaker nor is paused by it. The
# reason a private pool is tempting — `calendar.py:2738-2742` records that these
# bursts must not monopolize the shared pool and starve `fundamentals` /
# `dividends_calendar` into their own timeouts — is real, but it argues for
# separate SLOTS, not a separate GUARD. `yf_util.bounded_call(..., lane=
# "earnings")` gives exactly those isolated slots under the one breaker.
#
# ⚠️ IMPORT THE MODULE, NEVER THE FUNCTION (`lesson_from_import_severs_a_module_
# _from_its_guards`): `from api.services.yf_util import bounded_call` binds a
# private copy that escapes every `monkeypatch.setattr(yf_util, ...)`, which is
# how these three call sites came to bypass the guard in the first place.
# `test_the_guard_is_reached_through_the_module_not_a_private_copy` is the rail.

# The per-call deadline. 12 s is `bounded_call`'s own default and sits UNDER
# calendar's outer `_bounded_em` 15 s budget, so the inner bound is the one that
# fires and the caller's thread is freed first.
_YF_TIMEOUT = 12.0

# `lane=` arrives with the yf_util guard consolidation (in flight in a parallel
# session, 2026-08-08; the "earnings" lane was declared there FOR this module).
# Detected rather than assumed, so this file is correct against either revision
# of the guard and starts using the isolated slots the moment they land — rather
# than TypeError-ing every enrichment call during the window where the two
# changes have not both merged.
try:
    _GUARD_KW = (
        {"lane": "earnings"}
        if "lane" in _inspect.signature(yf_util.bounded_call).parameters
        else {}
    )
except (TypeError, ValueError):   # a C-implemented or wrapped guard
    _GUARD_KW = {}


def _finite_pct(v: float | None) -> float | None:
    """`None`-safe AND `NaN`-safe percent, rounded to 1 decimal.

    A yfinance daily `Close` can be `NaN` around a data gap / split-adjustment
    edge (confirmed live for UBER); dividing through it yields `float('nan')`,
    which passes an `is not None` check (`nan is not None` is `True` — the
    Python-side sibling of this codebase's `Number(null) === 0` JS trap) and
    then breaks stdlib `json.dumps`, which raises `ValueError: Out of range
    float values are not JSON compliant: nan` — 500ing the WHOLE
    /api/earnings-analysis/{sym} response, not just this one field."""
    if v is None:
        return None
    try:
        if math.isnan(v) or math.isinf(v):
            return None
    except TypeError:
        return None
    return round(v, 1)


# ─── 1. Pre-earnings price-action context ──────────────────────────────────────

def get_pre_earnings_context(sym: str) -> Optional[dict]:
    """Recent price action: 5-day and 30-day returns + a one-line label.

    Returns: {ret_5d_pct, ret_30d_pct, label} or None on failure.
    """
    try:
        import yfinance as _yf
        df = yf_util.bounded_call(
            lambda: _yf.Ticker(sym.upper()).history(
                period="3mo", interval="1d", auto_adjust=False),
            None, timeout=_YF_TIMEOUT, **_GUARD_KW,
        )
        if df is None or df.empty or len(df) < 6:
            return None
        closes = df["Close"]
        last = float(closes.iloc[-1])
        ret_5d = ((last / float(closes.iloc[-6])) - 1) * 100 if len(closes) >= 6 else None
        ret_30d = ((last / float(closes.iloc[-22])) - 1) * 100 if len(closes) >= 22 else None
        # Sanitize BEFORE building the label too — an unsanitized NaN still
        # compares False in `nan >= 0` (no exception), so the label would
        # silently read "nan% / 5d" for a real user instead of omitting it.
        ret_5d = _finite_pct(ret_5d)
        ret_30d = _finite_pct(ret_30d)
        parts = []
        if ret_30d is not None:
            parts.append(f"{'+' if ret_30d >= 0 else ''}{ret_30d:.1f}% / 30d")
        if ret_5d is not None:
            parts.append(f"{'+' if ret_5d >= 0 else ''}{ret_5d:.1f}% / 5d")
        return {
            "ret_5d_pct":  ret_5d,
            "ret_30d_pct": ret_30d,
            "label":       " · ".join(parts) if parts else None,
        }
    except Exception as e:
        _logger.warning("get_pre_earnings_context failed for %s: %s", sym, e)
        return None


# ─── 2. Historical earnings-day moves ──────────────────────────────────────────

def get_historical_earnings_moves(sym: str, av_quarters: list) -> Optional[dict]:
    """Compute past earnings-day % moves from Alpha Vantage quarterly history
    + yfinance daily prices.

    Args:
        sym: ticker
        av_quarters: AV `quarterlyEarnings` list (each row has `reportedDate`,
                     `reportTime` "post-market"/"pre-market", etc.)

    Returns: {avg_abs_move_pct, moves_pct[], n_quarters} or None.

    `moves_pct` is POSITIONALLY ALIGNED with `av_quarters[:8]` — index i is
    ALWAYS that quarter's own reaction, never a neighbour's. A quarter whose
    reaction cannot be computed (no date, no matching trading day in the
    price frame, or — the common case on PRINT NIGHT itself — the newest
    quarter's report date IS the last bar in the frame, so there is no
    next-day close yet) emits `None` at that index rather than being
    silently dropped. Dropping it would COMPACT the list, shifting every
    quarter after it up by one position and re-pairing it to the wrong
    quarter's reaction (P2 T9 review round 2, CRITICAL) — the identical
    off-by-one class as `calendar.py`'s since-fixed `reversed()` bug, one
    layer below it: `earningsHistoryModel.js` index-zips this array onto its
    own newest-first quarter list by RECENCY RANK, so a slot that can't be
    computed must stay a gap at that rank, never silently become the
    NEIGHBOURING quarter's number.
    `avg_abs_move_pct`/`n_quarters` are computed over the non-null entries
    only — averaging in a gap, or counting it, would misstate both.
    """
    if not av_quarters:
        return None
    try:
        import yfinance as _yf
        quarters = av_quarters[:8]

        # Positionally aligned with `quarters`: `dates[i]`/`report_times[i]`
        # describe `quarters[i]`. A missing/unparseable date degrades ONLY
        # that slot (`dates[i] = None`) instead of compacting the list.
        dates = []
        report_times = []
        for q in quarters:
            d_str = q.get("reportedDate") or q.get("fiscalDateEnding")
            d = None
            if d_str:
                try:
                    d = _dt.datetime.strptime(d_str, "%Y-%m-%d").date()
                except (ValueError, TypeError):
                    d = None
            dates.append(d)
            report_times.append(q.get("reportTime") or "")
        if not any(dates):
            return None

        df = yf_util.bounded_call(
            lambda: _yf.Ticker(sym.upper()).history(
                period="2y", interval="1d", auto_adjust=False),
            None, timeout=_YF_TIMEOUT, **_GUARD_KW,
        )
        if df is None or df.empty:
            return None

        # df.index is DatetimeIndex; convert to date for matching
        idx_dates = [d.date() for d in df.index.to_pydatetime()]
        opens  = df["Open"].astype(float).tolist()
        closes = df["Close"].astype(float).tolist()

        moves = []   # positionally aligned with `quarters`/`dates` — see docstring
        for ed, rtime in zip(dates, report_times):
            if ed is None:
                moves.append(None)
                continue
            # Find idx of the report date or nearest trading day
            report_idx = None
            for i in range(len(idx_dates) - 1, -1, -1):
                if idx_dates[i] <= ed:
                    report_idx = i
                    break
            # `report_idx` is None (date predates the price window), IS the
            # very first bar (no prior close to gap from), or IS the very
            # LAST bar (no next-day close YET — print night for the newest
            # quarter) — every one of these means "not knowable yet", never
            # "drop the slot". Every `continue` below emits an explicit
            # `None` first so the index this quarter occupies is preserved.
            if report_idx is None or report_idx == 0 or report_idx >= len(closes) - 1:
                moves.append(None)
                continue
            prev_close  = closes[report_idx - 1]
            report_open = opens[report_idx]
            next_open   = opens[report_idx + 1] if report_idx + 1 < len(opens) else None
            if prev_close <= 0:
                moves.append(None)
                continue
            # Pre-market report: gap from prev close to report-day open
            # Post-market report: gap from report-day close to next-day open
            if "pre" in (rtime or "").lower():
                move = (report_open - prev_close) / prev_close * 100
            elif "post" in (rtime or "").lower():
                if next_open is None:
                    moves.append(None)
                    continue
                report_close = closes[report_idx]
                move = (next_open - report_close) / report_close * 100
            else:
                # Unknown: take bigger of bmo/amc
                bmo = (report_open - prev_close) / prev_close * 100
                amc_move = (
                    (next_open - closes[report_idx]) / closes[report_idx] * 100
                    if next_open is not None and closes[report_idx] > 0
                    else None
                )
                move = bmo if amc_move is None or abs(bmo) >= abs(amc_move) else amc_move
            moves.append(move)

        computed = [m for m in moves if m is not None]
        if not computed:
            return None
        avg_abs = sum(abs(m) for m in computed) / len(computed)
        return {
            "avg_abs_move_pct": round(avg_abs, 1),
            "moves_pct":        [round(m, 1) if m is not None else None for m in moves],
            "n_quarters":       len(computed),
        }
    except Exception as e:
        _logger.warning("get_historical_earnings_moves failed for %s: %s", sym, e)
        return None


# ─── 3. Estimate / analyst revision trend ──────────────────────────────────────

def get_estimate_revisions(sym: str) -> Optional[dict]:
    """Analyst recommendation trend over last ~3 months (proxy for EPS revisions).

    FMP `stable/grades-historical` is primary (data-dependability migration
    plan, Task 5); Finnhub `/stock/recommendation` is the fallback when FMP
    yields nothing, routed through the shared finnhub_client.fh_get token
    bucket / 429 cooldown so it never spends that shared budget uncoordinated.
    Returns net change in (strongBuy+buy) minus (sell+strongSell) over 30d
    and 90d.
    """
    try:
        from api.services import earnings_estimates as ee
        resp = ee._fmp_grades_historical(sym.upper(), limit=4)
        if not resp:
            from api.services.finnhub_client import fh_get
            fh_resp = fh_get("/stock/recommendation", {"symbol": sym.upper()}, timeout=8)
            resp = fh_resp if isinstance(fh_resp, list) else []
        if not resp:
            return None
        resp.sort(key=lambda x: x.get("period", ""), reverse=True)
        latest = resp[0]
        prior_30 = resp[1] if len(resp) >= 2 else None
        prior_90 = resp[3] if len(resp) >= 4 else None

        def _net_buy(r):
            if not r:
                return 0
            return (
                int(r.get("strongBuy", 0) or 0)
                + int(r.get("buy", 0) or 0)
                - int(r.get("sell", 0) or 0)
                - int(r.get("strongSell", 0) or 0)
            )

        latest_net  = _net_buy(latest)
        prior30_net = _net_buy(prior_30) if prior_30 else latest_net
        prior90_net = _net_buy(prior_90) if prior_90 else prior30_net

        delta_30d = latest_net - prior30_net
        delta_90d = latest_net - prior90_net

        if delta_90d > 0:
            arrow = "↑"
            label = f"Analyst sentiment improving — {delta_90d:+d} net buy ratings vs 90d ago"
        elif delta_90d < 0:
            arrow = "↓"
            label = f"Analyst sentiment weakening — {delta_90d:+d} net buy ratings vs 90d ago"
        else:
            arrow = "→"
            label = "Analyst sentiment flat over 90 days"

        return {
            "buy_count":   int(latest.get("strongBuy", 0) or 0) + int(latest.get("buy", 0) or 0),
            "hold_count":  int(latest.get("hold", 0) or 0),
            "sell_count":  int(latest.get("sell", 0) or 0) + int(latest.get("strongSell", 0) or 0),
            "delta_30d":   delta_30d,
            "delta_90d":   delta_90d,
            "arrow":       arrow,
            "label":       label,
        }
    except Exception as e:
        _logger.warning("get_estimate_revisions failed for %s: %s", sym, e)
        return None


# ─── 4. Beat-magnitude history (visualization data) ───────────────────────────

def extract_beat_surprises(av_quarters: list) -> Optional[list]:
    """Extract last 8 EPS surprise %s from AV quarterly history.

    Returns list of {date, surprise_pct, beat} most-recent first, or None.
    """
    if not av_quarters:
        return None
    out = []
    try:
        for q in av_quarters[:8]:
            r = q.get("reportedEPS")
            e = q.get("estimatedEPS")
            try:
                rf = float(r); ef = float(e)
                if ef == 0:
                    continue
                pct = (rf - ef) / abs(ef) * 100
                out.append({
                    "date":         q.get("reportedDate") or q.get("fiscalDateEnding"),
                    "surprise_pct": round(pct, 1),
                    "beat":         rf >= ef,
                })
            except (TypeError, ValueError):
                continue
        return out or None
    except Exception:
        return None


# ─── 5. Implied move from ATM options straddle ────────────────────────
#
# THE SPOT FETCH IS GONE FROM THE HAPPY PATH — the chain response already
# carries it.
#
# `get_implied_move` used to OPEN with
#
#     t.history(period="5d", interval="1d", auto_adjust=False)
#
# purely to learn the underlying's price, before it had fetched anything else.
# That is a whole extra Yahoo round-trip per symbol, and this function is fanned
# out once per reporting symbol by BOTH the calendar enrichment sweep
# (`calendar._compute_enrichment_for_date._one`, 5-minute TTL, ~40-150 reporters
# a day) and `enrich_earnings_response` (the earnings-preview warmer, 7 runs a
# weekday with `EARNINGS_WARM_ENABLED` defaulting ON). It was a measurable slice
# of the sustained `Too Many Requests` storm.
#
# ── WHY THE CHAIN'S OWN SPOT, AND NOT A "BETTER" ONE ────────────────────────
#
# An implied move is a RATIO: `(call mark + put mark) / spot`. Numerator and
# denominator have to come from the SAME INSTANT. The straddle was priced by the
# market against the spot that existed AT QUOTE TIME; dividing it by a spot
# sampled from some other rail 15 seconds later does not make the answer fresher,
# it adds skew. Simultaneity dominates every other consideration here —
# including session provenance, which simultaneity gets right for free.
#
# yfinance hands us exactly that and we were throwing it away: `_download_options`
# (yfinance 1.2.0 `ticker.py:42-58`) reads `optionChain.result[0].quote` out of
# the SAME HTTP response as the calls/puts and `option_chain()` returns it as
# `.underlying`. So the marks and the spot are one payload, one instant, one
# provider. `regularMarketPrice` is the field — Yahoo holds it at the regular
# close outside RTH, which is also the session the option marks belong to, since
# US equity options do not trade extended hours.
#
# Rail 2 is the ORIGINAL `t.history(...)` call, kept ONLY as a fallback for a
# payload that arrives without a usable quote. It is not simultaneous and it does
# cost the extra round-trip — but a slightly-skewed answer beats no answer, which
# is the fail-soft direction this module already commits to. `_note_spot_source`
# counts it and it is logged, so if that rate ever climbs it is visible rather
# than silently reintroducing the per-symbol call this change removed.
#
# NOT DONE HERE, deliberately: `implied_move.py` / `polygon_options.py` compute
# the same number from the Massive REST chain snapshot, whose
# `underlying_asset.price` is simultaneous by construction. That cutover is
# `IMPLIED_ENRICHMENT_CUTOVER` (`calendar.py:2745`) and is an owner decision, not
# this change's.

_SPOT_SOURCE_COUNTS: dict[str, int] = {}
_SPOT_COUNTS_LOCK = threading.Lock()


def spot_source_counts() -> dict:
    """{source: n} — which rail answered for spot, process-lifetime.

    `yfinance_history` IS the fallback rate: the number of times we still paid
    the extra round-trip this change exists to remove. A climbing count means
    the chain payload stopped carrying a usable quote.
    """
    with _SPOT_COUNTS_LOCK:
        return dict(_SPOT_SOURCE_COUNTS)


def _note_spot_source(name: str) -> None:
    with _SPOT_COUNTS_LOCK:
        _SPOT_SOURCE_COUNTS[name] = _SPOT_SOURCE_COUNTS.get(name, 0) + 1


def _positive(v) -> Optional[float]:
    """float(v) when it is a real, finite, strictly-positive price; else None.

    `nan`/`inf` must not survive: `nan > 0` is already False, but `inf` would
    pass a bare comparison and then poison `straddle / spot` — and a `nan` in
    the returned dict is the documented `json.dumps` 500 this module carries
    `_finite_pct` for.
    """
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f) or f <= 0:
        return None
    return f


def _spot_from_chain(chain) -> Optional[float]:
    """Rail 1 — the spot Yahoo returned IN THE SAME RESPONSE as the marks.

    Zero extra requests, and simultaneous with the numerator by construction.
    """
    try:
        underlying = getattr(chain, "underlying", None) or {}
        return _positive(underlying.get("regularMarketPrice"))
    except Exception as e:
        _logger.debug("spot: chain underlying unreadable: %s", e)
        return None


def _ticker_and_expiries(symbol: str):
    """Build the Ticker AND read its expiry list in ONE guarded call.

    The constructor lives inside the guard, not outside it: the guard census
    counts `yf.Ticker(...)` as a yfinance reach — rightly, since it is the
    object every later network call hangs off — and folding it in with the
    first real request costs one pool hop instead of two.

    The SAME instance is then reused for the chain fetch, and that is
    load-bearing: `option_chain(date)` resolves `date` against
    `self._expirations`, which this `.options` read is what populates
    (yfinance 1.2.0 `ticker.py:83-94`). A freshly-constructed Ticker would
    re-download the option index — an EXTRA Yahoo request per symbol, i.e. it
    would give back exactly what this change removed.
    """
    import yfinance as _yf
    t = _yf.Ticker(symbol)
    return t, list(t.options or [])


def _spot_from_yfinance(yf_ticker) -> Optional[float]:
    """Rail 2 — the ORIGINAL extra round-trip. Fallback only, never the happy path."""
    hist = yf_util.bounded_call(
        lambda: yf_ticker.history(period="5d", interval="1d", auto_adjust=False),
        None, timeout=_YF_TIMEOUT, **_GUARD_KW,
    )
    if hist is None or hist.empty:
        return None
    return _positive(hist["Close"].iloc[-1])


def _resolve_spot(sym: str, chain, yf_ticker) -> tuple[Optional[float], str]:
    """(spot, rail) for the straddle denominator. Never raises.

    ORDER IS THE WHOLE POINT: the simultaneous, already-paid-for spot first;
    the extra round-trip only when that payload had none.
    """
    spot = _spot_from_chain(chain)
    if spot is not None:
        _note_spot_source("option_chain_underlying")
        return spot, "option_chain_underlying"

    spot = _spot_from_yfinance(yf_ticker)
    rail = "yfinance_history" if spot is not None else "unresolved"
    _note_spot_source(rail)
    _logger.info(
        "get_implied_move: %s chain carried no usable underlying quote — fell back "
        "to the extra yfinance history call (resolved=%s); spot-source counts: %s",
        sym, spot is not None, spot_source_counts(),
    )
    return spot, rail


def get_implied_move(sym: str, earnings_date: Optional[str] = None) -> Optional[dict]:
    """Implied move from front-week ATM call+put straddle.

    SPOT is read off the chain response itself (`_resolve_spot`), so it is
    simultaneous with the marks and costs no extra request. The arithmetic is
    UNCHANGED: same spot in, same dict out.

    ORDER MATTERS: spot is resolved AFTER the chain, because the chain is what
    carries it. Spot is not needed before that point anyway — its only two uses
    are picking the ATM strike and dividing the straddle, both below.

    Args:
        sym: ticker
        earnings_date: ISO date of earnings; pick first option expiry on/after.
                       If None, use front expiry.

    Returns: {pct, dollar, expiry, strike, spot, call_mark, put_mark} or None.
    """
    try:
        built = yf_util.bounded_call(
            lambda: _ticker_and_expiries(sym.upper()), None,
            timeout=_YF_TIMEOUT, **_GUARD_KW)
        if not built:
            return None
        t, expiries = built
        if not expiries:
            return None

        # Pick first expiry on/after earnings (or first available)
        target_date = None
        if earnings_date:
            try:
                target_date = _dt.datetime.strptime(earnings_date, "%Y-%m-%d").date()
            except (ValueError, TypeError):
                target_date = None

        chosen = None
        for exp in expiries:
            try:
                exp_d = _dt.datetime.strptime(exp, "%Y-%m-%d").date()
            except ValueError:
                continue
            if target_date is None or exp_d >= target_date:
                chosen = exp
                break
        if chosen is None:
            chosen = expiries[0]

        chain = yf_util.bounded_call(
            lambda: t.option_chain(chosen), None, timeout=_YF_TIMEOUT, **_GUARD_KW)
        if chain is None:
            return None
        calls = chain.calls
        puts  = chain.puts
        if calls is None or calls.empty or puts is None or puts.empty:
            return None

        # The spot that arrived WITH these marks (see the block comment above).
        spot, _spot_rail = _resolve_spot(sym, chain, t)
        if spot is None:
            return None

        # ATM strike = closest to spot
        atm_strike = float(calls["strike"].iloc[(calls["strike"] - spot).abs().argsort().iloc[0]])

        c_row = calls[calls["strike"] == atm_strike].head(1)
        p_row = puts[puts["strike"] == atm_strike].head(1)
        if c_row.empty or p_row.empty:
            return None

        def _mark(row):
            bid = float(row["bid"].iloc[0] or 0)
            ask = float(row["ask"].iloc[0] or 0)
            last = float(row["lastPrice"].iloc[0] or 0)
            if bid > 0 and ask > 0:
                return (bid + ask) / 2
            return last  # fallback to last trade

        call_mark = _mark(c_row)
        put_mark  = _mark(p_row)
        if call_mark <= 0 or put_mark <= 0:
            return None
        straddle = call_mark + put_mark
        pct = (straddle / spot) * 100
        return {
            "pct":       round(pct, 1),
            "dollar":    round(straddle, 2),
            "expiry":    chosen,
            "strike":    atm_strike,
            "spot":      round(spot, 2),
            "call_mark": round(call_mark, 2),
            "put_mark":  round(put_mark, 2),
        }
    except Exception as e:
        _logger.warning("get_implied_move failed for %s: %s", sym, e)
        return None


# ─── 6. Key quotes from previous earnings call transcript ─────────────────────

def get_key_quotes(sym: str) -> Optional[list]:
    """Extract the 3 most material quotes from the prior earnings call transcript.

    Pulls transcript via Finnhub and runs a one-shot AI extraction.
    Returns list of {topic, quote} or None on failure.
    """
    try:
        from api.services.transcripts import _fetch_latest_transcript
        tr = _fetch_latest_transcript(sym.upper())
    except Exception as e:
        _logger.warning("transcript fetch failed for %s: %s", sym, e)
        return None
    if not tr or not isinstance(tr, dict):
        return None
    text = tr.get("text") or ""
    if not text or len(text) < 500:
        return None

    try:
        from api.services.engine import _get_anthropic_client, _EARNINGS_AI_MODEL, _anthropic_text
    except Exception:
        return None

    # Truncate to ~30K chars to keep token usage modest
    excerpt = text[:30_000]
    try:
        client = _get_anthropic_client()
        prompt = (
            f"From this earnings call transcript for {sym}, extract the 3 most material "
            f"quotes that a trader would care about. Focus on: forward guidance, segment "
            f"growth, demand commentary, margin trends, or specific risks/catalysts called "
            f"out by management. Each quote must be verbatim from the transcript.\n\n"
            f"Return JSON only — no markdown:\n"
            '{"quotes": [{"topic": "<2-3 word label>", "quote": "<verbatim quote, max 30 words>"}, ...]}\n\n'
            f"Transcript:\n{excerpt}"
        )
        msg = client.messages.create(
            model=_EARNINGS_AI_MODEL,
            max_tokens=600,
            # Claude 5 models emit a ThinkingBlock FIRST by default: it ate
            # `content[0]` (→ `'ThinkingBlock' object has no attribute 'text'`,
            # live 2026-08-22 for FLXS) and part of the 600-token budget. Same
            # two guards as engine's own generators.
            thinking={"type": "disabled"},
            metadata={"user_id": "earnings_enrichment:global"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw = _anthropic_text(msg)
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        import json as _json
        parsed = _json.loads(raw)
        quotes = parsed.get("quotes") or []
        out = []
        for q in quotes[:3]:
            if isinstance(q, dict) and q.get("quote"):
                out.append({
                    "topic": str(q.get("topic", ""))[:40],
                    "quote": str(q.get("quote", ""))[:300],
                })
        return out or None
    except Exception as e:
        _logger.warning("AI key-quotes extraction failed for %s: %s", sym, e)
        return None


# ─── Convenience: run all enrichers in parallel ───────────────────────────────

def enrich_earnings_response(sym: str, av_quarters: list, earnings_date: Optional[str] = None) -> dict:
    """Run all enrichment helpers in parallel; merge into a single dict.

    Returns dict with keys present (None or value) for each enrichment field.
    Never raises — each helper is wrapped.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    out = {}
    funcs = {
        "pre_earnings":     lambda: get_pre_earnings_context(sym),
        "hist_moves":       lambda: get_historical_earnings_moves(sym, av_quarters),
        "revisions":        lambda: get_estimate_revisions(sym),
        "beat_surprises":   lambda: extract_beat_surprises(av_quarters),
        "implied_move":     lambda: get_implied_move(sym, earnings_date),
        "key_quotes":       lambda: get_key_quotes(sym),
    }
    with ThreadPoolExecutor(max_workers=6, thread_name_prefix="earnings-enrich") as pool:
        futs = {pool.submit(fn): name for name, fn in funcs.items()}
        for fut in as_completed(futs, timeout=25):
            name = futs[fut]
            try:
                out[name] = fut.result()
            except Exception as e:
                _logger.warning("enrichment helper %s for %s failed: %s", name, sym, e)
                out[name] = None
    return out
