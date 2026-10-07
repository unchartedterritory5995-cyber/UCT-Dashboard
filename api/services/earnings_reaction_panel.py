"""FT-005 -- the per-ticker earnings-reaction panel (Research > Depth).

The Earnings strip (`earnings_reaction.reaction_for`) answers ONE number per
quarter: the close-to-close move of the session that first traded the result.
This panel adds what a trader reads around it, for the same 8 quarters and on
the same reacting session (the selection rule is reused, not restated):

  run_in_pct    close[S-1] / close[S-6] - 1   the 5 sessions BEFORE the print
  gap_pct       open[S]   / close[S-1] - 1    what the news repriced overnight
  reaction_pct  close[S]  / close[S-1] - 1    the holder's day (the strip's number)
  drift_pct     close[S+5] / close[S]  - 1    the 5 sessions AFTER the print

plus, beside them, the realized volatility of the last 20 sessions and the
options market's implied move for the next print (front ATM straddle).

Honesty rules, railed in tests/test_earnings_reaction_panel.py:
  * a quarter whose sessions are not all in our bars keeps its row with the
    missing legs None; a drift whose sessions have not happened yet is
    "pending", never zero;
  * every summary carries its n;
  * the implied move names its expiry, strike, both marks and when it was
    read; when it has not been read yet it is "pending", never omitted.

Request path. Quarters come from the earnings payload's CACHE only (memory,
then the snapshot store; a miss schedules the existing background rebuild and
answers pending). Prices are our own daily bars (`earnings_reaction._daily_bars`,
the strip's own read). The implied move is a vendor read (an option chain), so
it is NEVER fetched in the request: a miss is queued on this module's own
one-thread worker and the panel says it is being read.
DARK behind EARNINGS_REACTION_PANEL_ENABLED.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from statistics import median
from typing import Any, Optional

from api.services import earnings_reaction as er
from api.services.realized_vol import METHOD as HV_DEFINITION, annualized_hv

_logger = logging.getLogger(__name__)

ENABLED_ENV = "EARNINGS_REACTION_PANEL_ENABLED"
QUARTERS = 8
RUN_IN = 5
DRIFT = 5
VOL_WINDOW = 20
_IMPLIED_TTL = 30 * 60
_MAX_QUEUED = 8
SOURCE = ("UCT daily bar store (sessions chosen by the reaction strip's rule); quarters from the "
          "earnings payload (earnings_intel); implied move from the front ATM straddle "
          "(earnings_enrichment.get_implied_move)")


REALIZED_VOL_METHOD = (f"Realized volatility = {HV_DEFINITION}, over the last {VOL_WINDOW} "
                       "sessions -- the same definition the VOL panel's HV uses.")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _pct(a, b) -> Optional[float]:
    v = er._pct(a, b)
    return None if v is None else round(v, 2)


def _reacting_index(idx: int, bars: list[dict]) -> Optional[int]:
    """The SAME selection `earnings_reaction._move_for` makes: of the report day
    and the next session, the one that opens furthest from its prior close."""
    cands = [i for i in (idx, idx + 1) if 0 < i < len(bars)]
    if not cands:
        return None
    return max(((abs(er._gap(i, bars) or 0.0), i) for i in cands), key=lambda t: t[0])[1]


def quarter_rows(quarters: list[dict], bars: list[dict], limit: int = QUARTERS) -> list[dict]:
    """Rows newest LAST, one per reported quarter, slots kept when a leg is missing."""
    rows = [q for q in (quarters or []) if q and q.get("reported") and q.get("report_date")][:limit]
    by_date = {str(b["t"])[:10]: i for i, b in enumerate(bars)}
    out = []
    for q in rows:
        day = str(q["report_date"])[:10]
        idx = er._index_for(day, by_date, bars)
        # R22: the reacting session is chosen between the report day and the
        # NEXT session. Until that next session has traded, the choice cannot
        # be made: for an after-close print the report day is the PRE-print
        # session, and showing it as the "Reaction" is wrong. Wait for it.
        awaiting = idx is not None and idx + 1 >= len(bars)
        s = None if idx is None or awaiting else _reacting_index(idx, bars)
        row: dict[str, Any] = {
            "quarter": q.get("label") or day, "report_date": day,
            "session": None, "run_in_pct": None, "gap_pct": None, "reaction_pct": None,
            "drift_pct": None, "drift_state": None,
            "eps_actual": q.get("eps_actual"), "eps_estimate": q.get("eps_estimate"),
            "eps_surprise_pct": q.get("eps_surprise_pct"),
            "reaction_state": ("awaiting_next_session" if awaiting
                               else "measured" if s is not None else "no_session"),
        }
        if s is not None:
            row["session"] = str(bars[s]["t"])[:10]
            if s - 1 - RUN_IN >= 0:
                row["run_in_pct"] = _pct(bars[s - 1].get("c"), bars[s - 1 - RUN_IN].get("c"))
            row["gap_pct"] = _pct(bars[s].get("o"), bars[s - 1].get("c"))
            row["reaction_pct"] = _pct(bars[s].get("c"), bars[s - 1].get("c"))
            if s + DRIFT < len(bars):
                row["drift_pct"] = _pct(bars[s + DRIFT].get("c"), bars[s].get("c"))
                row["drift_state"] = "measured"
            else:
                row["drift_state"] = "pending"   # those sessions have not traded yet
        out.append(row)
    out.reverse()
    return out


def _stat(values: list[Optional[float]]) -> dict:
    v = [x for x in values if x is not None]
    if not v:
        return {"n": 0, "avg": None, "avg_abs": None, "median": None, "pct_up": None}
    return {"n": len(v), "avg": round(sum(v) / len(v), 2),
            "avg_abs": round(sum(abs(x) for x in v) / len(v), 2),
            "median": round(median(v), 2), "pct_up": round(100 * sum(1 for x in v if x > 0) / len(v))}


def realized_vol(bars: list[dict], window: int = VOL_WINDOW) -> Optional[dict]:
    """Annualised close-to-close volatility of the last `window` sessions, through the shared
    `realized_vol.annualized_hv` -- the SAMPLE standard deviation, the same definition VOL/IVH
    print (it was the population one here: ~2.6 % lower at 20 sessions)."""
    closes = []
    for b in bars[-(window + 1):]:
        try:
            closes.append(float(b.get("c")))
        except (TypeError, ValueError):
            return None
    if len(closes) < window + 1:
        return None
    v = annualized_hv(closes)
    if v is None:
        return None
    return {"annualized_pct": round(v * 100, 1), "sessions": window,
            "through": str(bars[-1]["t"])[:10], "method": REALIZED_VOL_METHOD}


# ── implied move: a vendor read, OFF the request path ──────────────────────

_lock = threading.Lock()
_implied: dict[str, tuple[float, Optional[dict]]] = {}
_queued: set[str] = set()
_executor: Optional[ThreadPoolExecutor] = None


def _read_implied(sym: str, next_date: Optional[str]) -> None:
    """Off-request read. The report's session ('bmo'/'amc') comes from
    `implied_move.report_timing` -- an after-close print needs the first expiry
    STRICTLY after the date (a same-day expiry settles before the print). An
    unknown session keeps the on-or-after rule (documented default)."""
    try:
        from api.services import earnings_enrichment
        from api.services.implied_move import report_timing
        timing = report_timing(sym, next_date) if next_date else None
        res = earnings_enrichment.get_implied_move(sym, next_date, timing=timing)
        if isinstance(res, dict):
            res = {**res, "timing": timing}
    except Exception as exc:  # noqa: BLE001 -- recorded, never raised into a request
        _logger.warning("implied move read failed for %s: %s", sym, exc)
        res = None
    with _lock:
        _implied[sym] = (time.time(), res)
        _queued.discard(sym)


def implied_snapshot(sym: str, next_date: Optional[str]) -> dict:
    global _executor
    now = time.time()
    with _lock:
        hit = _implied.get(sym)
        if hit and now - hit[0] < _IMPLIED_TTL:
            read_at, res = hit
            if res is None:
                return {"state": "unavailable", "read_at": read_at,
                        "reason": "no front-expiry option chain with marks could be read"}
            return {"state": "ok", "read_at": read_at, **res}
        if not is_enabled():
            return {"state": "pending"}
        if sym not in _queued and len(_queued) < _MAX_QUEUED:
            _queued.add(sym)
            if _executor is None:
                _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="earn-implied")
            _executor.submit(_read_implied, sym, next_date)
    return {"state": "pending", "reason": "the option chain is being read; this panel fills in by itself"}


# ── the panel (REQUEST PATH) ────────────────────────────────────────────────

def _cached_earnings(sym: str) -> Optional[dict]:
    """The earnings payload from CACHE only. A miss schedules the existing
    background rebuild (earnings_intel._schedule_refresh) and returns None."""
    from api.services import earnings_intel as ei
    ck = f"{ei._KIND}::{sym}"
    hit = ei.cache.get(ck)
    if hit is not None:
        return hit
    stored = ei.snap_store.get(ei._KIND, sym)
    if stored is not None and isinstance(stored[0], dict) and stored[0].get("quarters"):
        return stored[0]
    ei._schedule_refresh(sym)
    return None


def panel(sym: str) -> dict:
    sym = (sym or "").upper().strip()
    base = {"ticker": sym, "source": SOURCE, "method": {
        "run_in": f"close of the session before the reaction over the close {RUN_IN} sessions earlier",
        "gap": "open of the reacting session over the prior close",
        "reaction": "close of the reacting session over the prior close",
        "drift": f"close {DRIFT} sessions after the reaction over the reaction close",
        "reacting_session": "of the report day and the next session, the one that opens furthest from its prior close",
        "realized_vol": REALIZED_VOL_METHOD}}
    payload = _cached_earnings(sym)
    if payload is None:
        return {**base, "state": "pending", "reason": "the earnings history is being read; this panel fills in by itself"}
    quarters = payload.get("quarters") or []
    reported = [q for q in quarters if q and q.get("reported") and q.get("report_date")][:QUARTERS]
    if not reported:
        return {**base, "state": "no_reports", "reason": "no reported quarter with a report date on file"}
    oldest = min(str(q["report_date"])[:10] for q in reported)
    since = (date.fromisoformat(oldest) - timedelta(days=er._LOOKBACK_PAD_DAYS + 14)).isoformat()
    bars = er._daily_bars(sym, since)
    if len(bars) < 2:
        return {**base, "state": "unavailable", "reason": f"daily bars for {sym} could not be read"}
    rows = quarter_rows(reported, bars)
    summary = {k: _stat([r[f] for r in rows]) for k, f in
               (("run_in", "run_in_pct"), ("gap", "gap_pct"), ("reaction", "reaction_pct"), ("drift", "drift_pct"))}
    nxt = (payload.get("summary") or {}).get("next_report_date") or payload.get("next_report_date")
    # The company's reporting currency, from the cached earnings payload or the
    # cached reporting-currency read -- never a vendor call here. A non-USD
    # filer's EPS is then shown without "$" (its legs do not share a stated
    # currency). None = not known, rendered as before.
    currency = payload.get("currency")
    if not currency:
        from api.services.research import reporting_currency
        currency = reporting_currency.peek(sym)
    return {**base, "state": "ok", "quarters": rows, "summary": summary, "currency": currency,
            "realized_vol": realized_vol(bars), "next_report_date": nxt,
            "implied_move": implied_snapshot(sym, nxt),
            "bars_through": str(bars[-1]["t"])[:10]}
