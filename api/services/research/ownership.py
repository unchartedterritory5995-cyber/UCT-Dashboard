"""Ownership for the research page: institutional holders (Form 13F), short
interest, float and insider activity.

2026-09-03 modernization (A6/A7 vertical slice): canonical identity resolves
through Entity Master (`resolve_entity`) before any provider call.
Float/shares-outstanding and Form 13F route through D1
(`fmp_client.get_shares_float` / `get_institutional_ownership_summary` /
`...holders`), each carrying a real provenance/freshness envelope. Insider
activity reuses the existing `get_insider_activity` service, called with the
entity-resolved FMP symbol.

INSTITUTIONAL HOLDERS AND THE INSTITUTIONAL PERCENT are the Form 13F block
(`thirteen_f`): the holders table reads its `holders`, and `institutional.pct_held`
is its summary's ownership percent (the one "institutional percent" every caller
reads). `institutional.state` says which of three things a missing percent is:
'ok' | 'none' (the vendor answered, no 13F summary in the last four completed
quarters) | 'failed' (the read failed).

SHORT INTEREST is the newest FINRA report the short interest service already
HOLDS for the stock (`short_data.held_stock`, read only). This module never
starts a vendor read for it: with nothing held the block says so
(`short.state == 'not_held'`) and the panel points at SHINT, where a member's
open builds it. The block is attached on every read and is never stored in the
12h cache, so it appears as soon as the service holds an answer.

Cached 12h -- but only when every provider leg (13F, share counts, the insider
feed) answered. A 13F filing genuinely not existing for a ticker, a ticker FMP
keeps no share count for, or an insider feed that legitimately has nothing
recent are NOT failures -- only a read that failed is, so a quiet ticker is not
refetched every few minutes and a failed read is never pinned as "nothing on
file" for half a day.
"""
from __future__ import annotations

import datetime
import logging
import math
import re
import threading

from api.services import fmp_client
from api.services import provider_errors as pe
from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.insider import get_insider_activity
from api.services.research.entity_resolution import resolve_entity

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12h -- only when both hard legs resolved
_FAIL_TTL = 300        # 5 min -- a partial/failed fetch self-heals fast
# Institutional holders kept for the newest filed quarter: the size of the ONE holders read
# (`limit`, FMP's first page). It was 12; the OWN panel's Funds (13F) block shows 20 and the rest
# on request, so the page is 50. Still one vendor call per symbol per quarter; `holders_limit`
# rides on the answer so the panel can say where the list stops.
_TF_MAX_HOLDERS = 50

_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _day(v):
    """'YYYY-MM-DD' from a vendor date or timestamp; None for anything else (never a guess)."""
    s = str(v or "").strip()
    return s[:10] if _ISO_DAY.match(s) else None


def _text(v):
    """A stripped string, or None for a missing or blank value."""
    s = str(v).strip() if v is not None else ""
    return s or None


#: Failed provider reads on this thread (a count). `_build_ownership` compares it before and
#: after a leg, so "the vendor answered: nothing on file" and "the read failed" stay apart
#: without changing what the leg functions return.
_reads = threading.local()


def _failed_reads() -> int:
    return getattr(_reads, "failed", 0)


def _note_failed_read() -> None:
    _reads.failed = _failed_reads() + 1


def _fmp_row_meta(fn, *args, **kwargs):
    """Same 'never raises, (row, meta)' contract as analyst_grades.py's
    `_fmp_row_with_meta` -- copied locally (that helper is module-private
    there too) rather than shared, until a third caller justifies promoting
    it. `meta` is the D1 provenance/freshness envelope shaped for
    ResearchPage's TrustStrip (`_meta.sourceObservedAt`/`.freshnessClass`/
    etc.) -- `None` on any miss, never fabricated."""
    try:
        result = fn(*args, **kwargs)
    except pe.ProviderNotFound:
        return None, None            # the vendor answered: nothing on file
    except Exception:
        _note_failed_read()
        return None, None
    if result.degraded is not None and not result.value:
        _note_failed_read()
        return None, None
    row = result.value[0] if isinstance(result.value, list) and result.value else None
    if not isinstance(row, dict):
        return None, None
    meta = {
        "vendor": result.provenance.vendor,
        "sourceActivity": result.provenance.source_activity,
        "fetchedAt": result.provenance.fetched_at,
        "sourceObservedAt": result.provenance.source_observed_at,
        "tieBreak": result.provenance.tie_break,
        "freshnessClass": result.freshness,
        "licensingClass": result.licensing_class,
        "degraded": result.degraded,
    }
    return row, meta


INSTITUTIONAL_SOURCE = "Form 13F filings, through FMP"


def _institutional(thirteen_f, failed=False):
    """The institutional percent, from the Form 13F summary (`ownership_pct`: what 13F filers
    hold, as a percent of shares outstanding).

    A figure over 100 is not presented as the institutional stake: institutions cannot hold
    more than all of the shares outstanding, so it says the positions and the share count do
    not describe the same thing (a share-class mix, or lent shares reported twice). Suppressed
    rather than capped: capping to 100.0 would state a precise fact no provider reported. The
    13F card still shows the summary's own figure under its own label.
    """
    tf = thirteen_f if isinstance(thirteen_f, dict) else None
    pct_held = _num(((tf or {}).get("summary") or {}).get("ownership_pct"))
    if pct_held is not None and pct_held > 100:
        _logger.warning("13F ownership percent %.2f%% exceeds 100 — suppressing", pct_held)
        pct_held = None
    return {
        "state": "ok" if tf else ("failed" if failed else "none"),
        "pct_held": pct_held,
        "quarter": (tf or {}).get("quarter"),
        "source": INSTITUTIONAL_SOURCE,
    }


def _fmp_share_counts(symbol):
    """Float + shares outstanding via D1 (`fmp_client.get_shares_float`).

    The ONE source of the two share counts. FMP's figures are class-correct on
    dual-class tickers (measured 2026-08-06 on ATROB, ATRO, BRK-B and LEN-B:
    its float is never larger than its shares outstanding, which a
    whole-company float set against a single-class share count is). Returns
    ({}, None) when FMP holds nothing for the ticker or the read failed; the
    two are told apart by the failed-read count (`_failed_reads`), and the tab
    shows "not available" for the missing figure either way.
    """
    row, meta = _fmp_row_meta(fmp_client.get_shares_float, symbol)
    if not row:
        return {}, None
    return {
        "float_shares": _num(row.get("floatShares")),
        "shares_outstanding": _num(row.get("outstandingShares")),
    }, meta


def _reconcile_share_counts(fmp_counts):
    """The two share counts as they may be shown, from FMP's answer.

    A float larger than shares outstanding is arithmetically impossible —
    float is a SUBSET of shares outstanding. If the pair contradicts itself we
    cannot tell WHICH side is wrong, so we publish neither: a "not available"
    is honest, two confident numbers that can't both be true are not. Never
    "repair" by clamping one to the other — that invents a figure no provider
    reported."""
    counts = fmp_counts or {}

    # A ZERO (or negative) share count is a vendor's "nothing held", never a measurement:
    # no listed security has 0 shares outstanding. FMP writes 0 for funds, and the
    # Ownership tab rendered "Shares outstanding 0" as data. Not reported -> None.
    def _held(v):
        return v if v is not None and v > 0 else None

    float_shares = _held(counts.get("float_shares"))
    shares_out = _held(counts.get("shares_outstanding"))

    if float_shares is not None and shares_out is not None and float_shares > shares_out:
        _logger.warning("share counts inconsistent (float %s > outstanding %s) — suppressing both",
                        float_shares, shares_out)
        float_shares = shares_out = None
    return float_shares, shares_out


SHORT_STATES = ("ok", "none", "unavailable", "not_held")


def _held_short(sym):
    """The short interest block for `sym`: what the short interest service ALREADY HOLDS, read
    only. First the stock's own held history (`_held_short_stock`: present for a while after a
    member opens its short interest panel); when the service holds nothing for the stock, its row
    of the market list (`_held_short_market`: the whole universe, kept built by the service's
    daily warm). `basis` says which one answered. Never starts a build, never asks a vendor,
    never raises."""
    out = _held_short_stock(sym)
    if out["state"] != "not_held":
        return out
    return _held_short_market(sym, out)


def _held_short_market(sym, out):
    """Fill `out` from the stock's row of the held market list (`short_data.held_market_row`).
    The row is the same report and the same percent of float the short interest list prints.

    'ok'          the stock is in the newest report
    'none'        a list is held, the stock is one the list covers, and the report has no row for it
    'unavailable' no list is held and the last build was refused or could not be read
    'not_held'    otherwise (no list yet, or a symbol the list does not cover): unknown, never zero
    """
    try:
        from api.services import short_data
        row, how = short_data.held_market_row(sym)
    except Exception as exc:  # noqa: BLE001 -- a held list that cannot be read is "not held"
        _logger.warning("held short interest list could not be read for %s: %s", sym, type(exc).__name__)
        return out
    if how == "held" and isinstance(row, dict):
        if row.get("short_interest") is None or not row.get("settlement_date"):
            return out
        pct, flt = row.get("pct_float"), row.get("float_shares")
        had_before = row.get("prev_short_interest") is not None
        out.update({
            "state": "ok", "basis": "market_list",
            "shares_short": row.get("short_interest"),
            "short_pct_float": pct,
            "days_to_cover": row.get("days_to_cover"),
            "avg_daily_volume": row.get("avg_daily_volume"),
            "settlement_date": row.get("settlement_date"),
            "prior_short": row.get("prev_short_interest"),
            "prior_settlement_date": row.get("previous_settlement_date") if had_before else None,
            "change_shares": row.get("change_shares"),
            "change_pct": row.get("change_pct"),
            "float_shares": flt,
            # the list keeps the figure or nothing: a float on file with no percent is the withheld case
            "pct_float_withheld": pct is None and flt is not None,
            "float_source": row.get("float_source"),
            "publication_estimate": row.get("publication_estimate"),
            "read_at": row.get("read_at"),
        })
        return out
    if how == "not_in_list":
        try:
            covered = short_data.clean_symbol(sym) in short_data.universe()
        except Exception:  # noqa: BLE001
            covered = False
        if covered:
            out.update({"state": "none", "basis": "market_list"})
        return out
    if how == "not_held" and isinstance(row, dict) and row.get("status") == "unavailable":
        out.update({"state": "unavailable", "basis": "market_list", "reason": row.get("reason"),
                    "http_status": row.get("http_status")})
    return out


def _held_short_stock(sym):
    """The short interest block: the newest FINRA report the short interest service already
    holds for `sym`, with its settlement date. READ ONLY (`short_data.held_stock`): it never
    starts a build and never asks a vendor, and it never raises.

    state   'ok'          a report is held: the figures below are that report's
            'none'        the service asked and the vendor has no short interest rows for the symbol
            'unavailable' the service asked and the vendor refused (`reason`, `http_status`)
            'not_held'    the service holds nothing for this stock (nobody has opened its short
                          interest history lately): unknown, never zero

    `short_pct_float` is the service's own figure (short interest over today's float from the
    nightly screener export, withheld above its mismatch limit), the same one SHINT prints, so
    the two screens can never disagree. `prior_short` is the report before the newest one.
    """
    out = {
        "state": "not_held", "shares_short": None, "short_pct_float": None, "days_to_cover": None,
        "avg_daily_volume": None, "settlement_date": None,
        "prior_short": None, "prior_settlement_date": None, "change_shares": None, "change_pct": None,
        "float_shares": None, "pct_float_withheld": False, "float_source": None,
        "publication_estimate": None, "read_at": None, "reason": None, "http_status": None,
        "source": None, "basis": None,
    }
    try:
        from api.services import short_data
        out["source"] = short_data.SOURCE
        answer, _how = short_data.held_stock(sym)
    except Exception as exc:  # noqa: BLE001 -- a held answer that cannot be read is "not held"
        _logger.warning("held short interest could not be read for %s: %s", sym, type(exc).__name__)
        return out
    if not isinstance(answer, dict):
        return out
    interest = answer.get("interest") if isinstance(answer.get("interest"), dict) else {}
    reports = interest.get("reports") if isinstance(interest.get("reports"), list) else []
    if answer.get("status") == "ok" and interest.get("state") == "ok" and reports:
        newest = reports[0] if isinstance(reports[0], dict) else {}
        before = reports[1] if len(reports) > 1 and isinstance(reports[1], dict) else {}
        flt = answer.get("float") if isinstance(answer.get("float"), dict) else {}
        if newest.get("short_interest") is None or not newest.get("settlement_date"):
            return out
        out.update({
            "state": "ok", "basis": "stock_history",
            "shares_short": newest.get("short_interest"),
            "short_pct_float": flt.get("pct_float"),
            "days_to_cover": newest.get("days_to_cover"),
            "avg_daily_volume": newest.get("avg_daily_volume"),
            "settlement_date": newest.get("settlement_date"),
            "prior_short": before.get("short_interest"),
            "prior_settlement_date": before.get("settlement_date"),
            "change_shares": newest.get("change_shares"),
            "change_pct": newest.get("change_pct"),
            "float_shares": flt.get("shares"),
            "pct_float_withheld": flt.get("withheld") is True,
            "float_source": flt.get("source"),
            "publication_estimate": answer.get("publication_estimate"),
            "read_at": answer.get("read_at"),
        })
        return out
    if answer.get("status") == "ok" and interest.get("state") == "none":
        out["state"] = "none"
    elif answer.get("status") == "unavailable" or interest.get("state") == "unavailable":
        out.update({"state": "unavailable", "reason": interest.get("reason"),
                    "http_status": interest.get("http_status")})
    return out


# Market-wide "which 13F quarter is filed" hint. Not per symbol: the answer
# is the same for everyone and moves only when a new 13F window opens.
_TF_QUARTER_HINT_KEY = "research_ownership_13f_quarter"
_TF_QUARTER_HINT_TTL = 6 * 3600


# R12: SEC Rule 13f-1 gives managers 45 days after a quarter ends to file.
# Until that window closes the quarter is still being filed, and a summary of it
# counts only the managers who have filed so far -- ownership reads far too low.
# So a quarter is a candidate only once its filing window has closed. This is
# the regulatory deadline, not a measurement of FMP's data.
_TF_FILING_WINDOW_DAYS = 46


def _quarter_end(year: int, q: int) -> datetime.date:
    nxt = datetime.date(year + (q == 4), 1 if q == 4 else 3 * q + 1, 1)
    return nxt - datetime.timedelta(days=1)


def _recent_quarters(today=None):
    """Candidate (year, quarter) pairs newest-first: the four newest quarters
    whose 13F filing window has CLOSED (ended at least _TF_FILING_WINDOW_DAYS
    ago). We try newest-first and take the first that has data."""
    today = today or datetime.date.today()
    q = (today.month - 1) // 3 + 1
    out = []
    y = today.year
    while len(out) < 4:
        if (today - _quarter_end(y, q)).days >= _TF_FILING_WINDOW_DAYS:
            out.append((y, q))
        q -= 1
        if q == 0:
            q = 4
            y -= 1
    return out


def _thirteen_f(symbol):
    """Form 13F institutional ownership via D1 (`fmp_client.
    get_institutional_ownership_summary` / `...holders`): a position-flow
    summary + the top institutional holders for the most recent filed
    quarter. Returns {quarter, summary, holders, _meta} or None. Best-effort;
    never raises."""
    quarter = None
    summ = None
    meta = None
    # ── cost fix (2026-09-07) ────────────────────────────────────────────────
    # 13F filings lag ~45 days, so the newest one or two candidate quarters
    # reliably return nothing and this loop burned 3-4 provider calls per
    # SYMBOL discovering a fact that is identical for every symbol in the
    # market. Which quarter is currently filed changes four times a year.
    # Remember it and try that first; the full scan still runs behind it, so a
    # stale or wrong hint costs nothing but the ordinary walk.
    candidates = _recent_quarters()
    hint = cache.get(_TF_QUARTER_HINT_KEY)
    if hint:
        try:
            hy, hq = int(hint[0]), int(hint[1])
            if (hy, hq) in candidates:
                candidates = [(hy, hq)] + [c for c in candidates if c != (hy, hq)]
        except Exception:
            pass
    for year, q in candidates:
        row, m = _fmp_row_meta(fmp_client.get_institutional_ownership_summary, symbol, year=year, quarter=q)
        if row:
            quarter, summ, meta = (year, q), row, m
            cache.set(_TF_QUARTER_HINT_KEY, (year, q), _TF_QUARTER_HINT_TTL)
            break
    if not summ:
        return None

    year, q = quarter
    try:
        hresult = fmp_client.get_institutional_ownership_holders(symbol, year=year, quarter=q, limit=_TF_MAX_HOLDERS)
        hraw = hresult.value if hresult.degraded is None else None
        if hresult.degraded is not None:
            _note_failed_read()
    except pe.ProviderNotFound:
        hraw = None                  # a summary with no holder rows: the vendor answered
    except Exception:
        _note_failed_read()
        hraw = None
    holders = []
    if isinstance(hraw, list):
        for h in hraw[:_TF_MAX_HOLDERS]:
            if not isinstance(h, dict):
                continue
            # Every field the holder row carries is passed on, from the row the read already
            # fetched (no further call): the filer's SEC id, the filing date and the quarter end,
            # last quarter's shares / value / percent of shares, and the position's weight in the
            # filer's own 13F portfolio (now, last quarter, the change, in points). A field the
            # vendor left out is None, never 0.
            holders.append({
                "name":         h.get("investorName"),
                "cik":          _text(h.get("cik")),
                "shares":       _num(h.get("sharesNumber")),
                "prior_shares": _num(h.get("lastSharesNumber")),
                "change_shares": _num(h.get("changeInSharesNumber")),
                "change_pct":   _num(h.get("changeInSharesNumberPercentage")),
                "ownership":    _num(h.get("ownership")),
                "prior_ownership": _num(h.get("lastOwnership")),
                "change_ownership": _num(h.get("changeInOwnership")),
                "market_value": _num(h.get("marketValue")),
                "prior_market_value": _num(h.get("lastMarketValue")),
                "weight":       _num(h.get("weight")),
                "prior_weight": _num(h.get("lastWeight")),
                "change_weight": _num(h.get("changeInWeight")),
                "quarter_end_price": _num(h.get("quarterEndPrice")),
                "quarter_end":  _day(h.get("date")),
                "filing_date":  _day(h.get("filingDate")),
                "is_new":       bool(h.get("isNew")),
                "is_sold_out":  bool(h.get("isSoldOut")),
            })

    return {
        "quarter": f"{year}Q{q}",
        "summary": {
            "investors_holding":   _num(summ.get("investorsHolding")),
            "investors_change":    _num(summ.get("investorsHoldingChange")),
            "ownership_pct":       _num(summ.get("ownershipPercent")),
            "ownership_change":    _num(summ.get("ownershipPercentChange")),
            "total_invested":      _num(summ.get("totalInvested")),
            "total_invested_change": _num(summ.get("totalInvestedChange")),
            "new_positions":       _num(summ.get("newPositions")),
            "increased_positions": _num(summ.get("increasedPositions")),
            "reduced_positions":   _num(summ.get("reducedPositions")),
            "closed_positions":    _num(summ.get("closedPositions")),
            "put_call_ratio":      _num(summ.get("putCallRatio")),
            # the shares all 13F filers reported holding, and the change on the quarter
            "total_shares":        _num(summ.get("numberOf13Fshares")),
            "total_shares_change": _num(summ.get("numberOf13FsharesChange")),
        },
        "holders": holders,
        # how many holder rows the read asked for: a list this long may be cut by the vendor
        "holders_limit": _TF_MAX_HOLDERS,
        "_meta": meta,
    }


def get_ownership(sym):
    """S6 (terminal backend fixes, 2026-10-05): a cold symbol is composed ONCE however
    many members open it at the same moment. The cache answers first; on a miss the
    first caller builds and the rest wait for its result (`single_flight`), so N cold
    opens cost one vendor walk instead of N on the shared threadpool. A follower that
    waits past the single-flight bound raises, and the route answers that as a failed
    read rather than an empty record.

    The short interest block is attached here, on every read, from what the short
    interest service holds at that moment (`_held_short`): it is never part of the
    cached record."""
    s = (sym or "").upper().strip()
    if not s:
        return {}
    cached = cache.get(f"research_own::{s}")
    if cached is None:
        from api.services import single_flight
        cached = single_flight.run(f"research_own::{s}", lambda: _build_ownership(s))
    if not isinstance(cached, dict) or not cached:
        return cached
    return {**cached, "short": _held_short(s)}


#: The provider legs, by the words the panel uses for one that failed.
LEG_13F = "institutional holders (Form 13F)"
LEG_SHARE_COUNTS = "float and shares outstanding"
LEG_INSIDER = "insider activity"


def _build_ownership(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    ck = f"research_own::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    entity, fmp_symbol = resolve_entity(sym, vendor="fmp")

    insider = []
    insider_ok = True
    try:
        insider = (get_insider_activity(fmp_symbol) or [])[:10]
    except Exception as exc:
        insider_ok = False
        _logger.warning("insider activity failed for %s: %s", sym, exc)

    # `_thirteen_f` and `_fmp_share_counts` answer None / {} both for "nothing on file" (common
    # and legitimate: most funds, a new listing) and for a read that failed. The failed-read
    # count tells the two apart: only a failed read shortens the cache and is named.
    before = _failed_reads()
    try:
        thirteen_f = _thirteen_f(fmp_symbol)
        tf_ok = _failed_reads() == before
    except Exception as exc:  # defensive: _thirteen_f swallows its own per-endpoint failures
        _logger.warning("13F ownership failed for %s: %s", sym, exc)
        thirteen_f, tf_ok = None, False

    before = _failed_reads()
    try:
        share_counts_raw, share_counts_meta = _fmp_share_counts(fmp_symbol)
        counts_ok = _failed_reads() == before
    except Exception as exc:  # defensive: _fmp_share_counts already swallows
        _logger.warning("share counts failed for %s: %s", sym, exc)
        share_counts_raw, share_counts_meta, counts_ok = {}, None, False

    float_shares, shares_out = _reconcile_share_counts(share_counts_raw)

    out = {
        "sym": sym,
        "entity": entity,
        "institutional": _institutional(thirteen_f, failed=not tf_ok),
        "share_counts": {
            "float_shares": float_shares,
            "shares_outstanding": shares_out,
            "_meta": share_counts_meta,
        },
        "insider": insider,
        "thirteen_f": thirteen_f,
    }
    complete = tf_ok and counts_ok and insider_ok
    # tq-panels: name the legs that failed, so the panel can say which part of the
    # record is missing because a read failed (not because nothing is reported).
    legs_failed = []
    if not tf_ok:
        legs_failed.append(LEG_13F)
    if not counts_ok:
        legs_failed.append(LEG_SHARE_COUNTS)
    if not insider_ok:
        legs_failed.append(LEG_INSIDER)
    out["legs_failed"] = legs_failed
    set_by_completeness(ck, out, complete=complete, ttl_ok=_CACHE_TTL, ttl_partial=_FAIL_TTL)
    return out
