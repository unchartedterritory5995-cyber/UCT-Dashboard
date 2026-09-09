"""Canonical, security-scoped Earnings evidence adapter for the grounded Ask
AI surface (Earnings Events AI slice, owner-authorized, 2026-09-04).

`ticker_explain.py` consumes ONLY `get_earnings_ai_evidence(sym)` from this
module. It never touches a raw Calendar-page payload (`/api/calendar/month`,
a week payload, etc.), never calls a raw provider (FMP/Finnhub) directly, and
never re-implements date/reaction matching. Every fact below is assembled
from EXISTING canonical services (`earnings_table.py`,
`earnings_estimates.py` / `earnings_history_fmp.py`, `earnings_enrichment.py`,
`implied_move.py`) plus one narrow, read-only reuse of `calendar.py`'s own
already-cached live-window merge (no new provider call) -- this module is
composition and reconciliation, not a new data source.

CANONICAL NEXT-DATE RESOLVER (owner-locked): `earnings_table._next_report_date`.
"Canonical" means the designated resolver for THIS AI surface, not that the
date has been independently verified by multiple providers -- see
`_resolve_next_date_status`'s docstring for the exact CONFIRMED/PROVISIONAL/
CONFLICTING/UNKNOWN semantics the owner locked.

PRICE-REACTION SAFETY (owner-locked, hard requirement): the existing
client-side index-based pairing between `beat_history` and
`get_historical_earnings_moves`'s positionally-aligned `moves_pct` array
(documented residual risk: `app/src/components/research/earningsHistoryModel.js`)
is NOT used here. This module instead joins by the actual REPORT DATE string
-- `fmp_beat_history`'s own `report_date` field against
`get_historical_earnings_moves`'s per-quarter `reportedDate` (both trace to
the same FMP `stable/earnings.date` fact) -- a deterministic equality match,
never array position. When no exact date match exists, the reaction is
OMITTED from that event's evidence entirely: never inferred, never
approximated, never taken by array index."""
from __future__ import annotations

import logging
from datetime import date as _date
from typing import Optional

from api.services.cache import cache
from api.services.research.entity_resolution import resolve_entity

_log = logging.getLogger(__name__)

STATUSES = ("CONFIRMED", "PROVISIONAL", "CONFLICTING", "UNKNOWN")


def _cross_check_live_window(sym: str, date_str: str) -> Optional[dict]:
    """Narrow, opportunistic two-way check (owner-approved -- explicitly NOT
    full N-way provider reconciliation): does `calendar.py`'s own
    live-window merge (Finnhub/FMP/Finviz, session-aware) agree with the
    canonical resolver's date? Reuses the EXACT caches the Calendar page
    itself populates -- zero new provider calls. Returns None when that
    week isn't cached/buildable at all (the ticker's report is likely
    outside the live window's typical near-term coverage) -- this is an
    ABSENT cross-check, never evidence of agreement. Callers must not
    upgrade confidence on a None result (owner note: "do not imply
    multi-provider agreement" when the secondary check is unavailable)."""
    try:
        from api.routers import calendar as _cal
        d = _date.fromisoformat(date_str)
        monday = _cal._monday_of(d)
        cur_monday = _cal._week_dates()[0]
        wk = (cache.get("calendar_weekly") if monday == cur_monday
              else _cal._get_or_build_range_week(monday))
        days = (wk or {}).get("days") or {}
        for ds, day in days.items():
            for timing in ("bmo", "amc", "tbd"):
                for entry in (day.get(timing) or []):
                    if (entry.get("sym") or "").upper() == sym:
                        if ds == date_str:
                            return {"match": "same_date", "timing": timing,
                                   "date_est": entry.get("date_est")}
                        return {"match": "different_date", "other_date": ds}
        return None
    except Exception as exc:
        _log.info("[earnings_ai_adapter] live-window cross-check failed for %s: %s", sym, exc)
        return None


def _resolve_next_date_status(sym: str) -> dict:
    """{date, timing, status, conflicting_date}.

    Status semantics (owner-locked, verbatim):
      CONFIRMED   -- the canonical resolver considers the date non-estimated
                     AND no contradiction is known from the available
                     cross-check. Does NOT mean verified by multiple
                     independent providers.
      PROVISIONAL -- the canonical resolver's date is estimated/tentative,
                     OR the cross-check has no information at all (a missing
                     cross-check is never silently upgraded to CONFIRMED).
      CONFLICTING -- the available cross-check materially disagrees (names a
                     different date) with the canonical result.
      UNKNOWN     -- no sufficiently trustworthy date is available at all."""
    from api.services.earnings_table import _next_report_date
    try:
        d = _next_report_date(sym)
    except Exception as exc:
        _log.warning("[earnings_ai_adapter] next_report_date failed for %s: %s", sym, exc)
        d = None
    if not d:
        return {"date": None, "timing": None, "status": "UNKNOWN", "conflicting_date": None}

    cross = _cross_check_live_window(sym, d)
    if cross is None:
        return {"date": d, "timing": None, "status": "PROVISIONAL", "conflicting_date": None}
    if cross["match"] == "different_date":
        return {"date": d, "timing": None, "status": "CONFLICTING",
               "conflicting_date": cross["other_date"]}
    status = "CONFIRMED" if cross.get("date_est") is False else "PROVISIONAL"
    return {"date": d, "timing": cross.get("timing"), "status": status, "conflicting_date": None}


def _reaction_by_date(sym: str) -> dict:
    """{report_date_iso: reaction_pct} -- built from
    `earnings_enrichment.get_historical_earnings_moves`'s own positionally-
    aligned (quarters[i], moves_pct[i]) pairing, immediately converted here
    to a DATE-KEYED dict so every downstream consumer joins by the real
    announcement date, never by array position. A quarter whose own
    reaction is `None` (not yet computable -- e.g. print night) is simply
    absent from this dict; `_historical_events` then omits `reaction_pct`
    for that event entirely, which is the required omit-on-uncertain
    behavior."""
    try:
        from api.services.engine import _fetch_quarterly_history
        from api.services.earnings_enrichment import get_historical_earnings_moves
        av_quarters = _fetch_quarterly_history(sym)
        if not av_quarters:
            return {}
        result = get_historical_earnings_moves(sym, av_quarters) or {}
        moves = result.get("moves_pct") or []
        out: dict = {}
        for q, move in zip(av_quarters, moves):
            if move is None:
                continue
            d = q.get("reportedDate")
            if d:
                # Rounded HERE, at the one source every consumer (evidence
                # text AND the grounding checks that verify against this
                # same field) reads from -- live-validation finding: an
                # unrounded value like 6.220095693779921 can never match
                # any reasonable model rewrite of it ("6.2%"), so the
                # grounding gate rejected honest, correctly-cited answers
                # on every real call until this was fixed at the source.
                out[d] = round(move, 1)
        return out
    except Exception as exc:
        _log.warning("[earnings_ai_adapter] reaction computation failed for %s: %s", sym, exc)
        return {}


def _historical_events(sym: str) -> list[dict]:
    """Up to 8 reported quarters -- event date (the real announcement date,
    NOT the fiscal period end), reporting period, EPS/revenue actual/
    estimate/surprise -- from the canonical `fmp_beat_history` (via
    `earnings_estimates.get_earnings_intel`), each date-keyed against a
    reaction (see `_reaction_by_date`) rather than zipped by array index."""
    from api.services.earnings_estimates import get_earnings_intel
    try:
        intel = get_earnings_intel(sym) or {}
    except Exception as exc:
        _log.warning("[earnings_ai_adapter] get_earnings_intel failed for %s: %s", sym, exc)
        return []
    beat_history = intel.get("beat_history") or []
    reactions = _reaction_by_date(sym)

    events = []
    for row in beat_history:
        report_date = row.get("report_date")
        events.append({
            "event_date": report_date,                  # real announcement date
            "reporting_period": row.get("period"),       # fiscal period END -- kept distinct
            "fiscal_year": row.get("year"),
            "fiscal_quarter": row.get("quarter"),
            "eps_actual": row.get("actual"),
            "eps_estimate": row.get("estimate"),
            # Rounded for the same reason as the reaction join above --
            # `fmp_beat_history`'s `_pct()` returns full float precision.
            "eps_surprise_pct": (round(row["surprise"], 1) if row.get("surprise") is not None
                                 else None),
            "revenue_actual": row.get("revenue_actual"),
            "revenue_estimate": row.get("revenue_estimate"),
            # Date-keyed join -- absent (never fabricated) when no confident
            # match exists.
            "reaction_pct": reactions.get(report_date) if report_date else None,
        })
    return events


def _expected_move(sym: str, report_date: Optional[str]) -> Optional[dict]:
    """Live pre-report implied/expected move for the resolved next report
    date, when a real one is available. Best-effort -- an options-chain-
    backed computation, so unavailability is common and never fatal to the
    rest of the evidence. Never called without a resolved date (an implied
    move is meaningless without one)."""
    if not report_date:
        return None
    try:
        from api.services.implied_move import get_expected_move
        move = get_expected_move(sym, report_date)
        if not move or move.get("pct") is None:
            return None
        dollar = move.get("dollar")
        return {"pct": round(move["pct"], 1), "dollar": round(dollar, 2) if dollar is not None else None}
    except Exception as exc:
        _log.info("[earnings_ai_adapter] expected move unavailable for %s: %s", sym, exc)
        return None


def get_earnings_ai_evidence(sym: str) -> dict:
    """The ONE function `ticker_explain.py` calls for the `earnings` domain.
    Never raises -- every leg above is independently defensive; a total
    failure still returns a well-shaped, empty-ish dict rather than
    propagating."""
    sym = (sym or "").upper().strip()
    if not sym:
        return {"sym": sym, "entity": None,
               "next_report": {"date": None, "timing": None, "status": "UNKNOWN",
                               "conflicting_date": None},
               "historical_events": [], "expected_move": None}
    try:
        entity, _ = resolve_entity(sym)
    except Exception:
        entity = None
    next_report = _resolve_next_date_status(sym)
    return {
        "sym": sym,
        "entity": entity,
        "next_report": next_report,
        "historical_events": _historical_events(sym),
        "expected_move": _expected_move(sym, next_report.get("date")),
    }
