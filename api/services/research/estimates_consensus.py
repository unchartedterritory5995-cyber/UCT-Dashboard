"""EE depth: FMP analyst consensus — annual AND quarterly, several years forward.

The research Estimates tab reads yfinance (`estimates.py`): four periods (this
quarter, next quarter, this year, next year), an average and a range. FMP
Ultimate — already paid for, and already read by `annual_financials`,
`earnings_table`, `broker_estimates` and `estimate_history` — carries the
consensus per fiscal period for ~5 years forward: EPS and revenue mean, low and
high, the number of analysts behind each, plus EBITDA, EBIT and net income.

ONE vendor door. Every read goes through `fmp_client.get_analyst_estimates`
(the D1 adapter: its own timeout, token bucket, cached-forbidden handling and
provenance), with the SAME (period, limit) pairs the two existing request-path
readers already send — annual/20 (`annual_financials`) and quarter/40
(`earnings_table`) — so this is the same request, not a new shape of it. The
result is cached here per symbol; nothing in this module talks HTTP.

What FMP does NOT provide on this plan, and this payload says so rather than
inventing it: revisions history (`/stable/historical-analyst-estimates` answered
404, see `estimate_history.py`) and named-analyst estimates (`broker_estimates`).
Revisions on the EE panel stay yfinance's 30/90-day trend, labelled as such.

States, never a bare empty list:
  ok     — at least one forward period from FMP
  empty  — FMP answered and holds no forward consensus for this symbol
  error  — FMP did not answer (timeout, 5xx, rate limit, cached-forbidden)
The client falls back to yfinance on `empty` and `error`, and says which.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Any, Optional

from api.services import fmp_client
from api.services.research import reporting_currency

_logger = logging.getLogger(__name__)

SOURCE = "FMP /stable/analyst-estimates"
_TTL_OK = 6 * 3_600        # consensus moves daily at most; matches broker_estimates
_TTL_EMPTY = 6 * 3_600     # an answered "none" is as durable as an answer
_TTL_ERROR = 600           # a failed read self-heals fast
_TIMEOUT_S = 10            # per leg; the two legs run concurrently
_REQUESTS = {"annual": ("annual", 20), "quarterly": ("quarter", 40)}
MAX_ANNUAL = 5
MAX_QUARTERS = 8
# A fiscal period that ENDED recently has usually not REPORTED yet, so it is
# still forward-looking (the 2026-07-02 MXL off-by-one in earnings_table). Same
# grace window as `earnings_table._UNREPORTED_GRACE_DAYS`. It is now only the
# OUTER bound (an estimate row older than this is dead data); whether a period
# inside it is still forward is decided by `is_unreported` below.
GRACE_DAYS = 130


# ── THE forward-period rule, shared by EE (here) and BRKE (broker_estimates) ──
#
# A period is forward until the company has REPORTED it. FMP's analyst-estimates
# `date` is the fiscal period END, not the report date, so neither "end <
# today" (BRKE: drops the next quarter to report all earnings season) nor "end
# within 130 days" (EE: keeps a quarter that reported a month ago as the first
# forward row) answers that. The newest report date that carries an ACTUAL does:
# every period that ended before it has been reported, and every period ending
# on or after it has not.

def last_report_date(earnings_rows: Any) -> Optional[str]:
    """Newest report date (YYYY-MM-DD) on which FMP `/stable/earnings` records
    an actual EPS or revenue. None when there is no such row, or no answer."""
    best = None
    for r in earnings_rows or []:
        if not isinstance(r, dict):
            continue
        if r.get("epsActual") is None and r.get("revenueActual") is None:
            continue
        d = str(r.get("date") or "")[:10]
        if len(d) == 10 and (best is None or d > best):
            best = d
    return best


def today_et() -> date:
    """Today's date in New York. Audit wave 2: "upcoming" was picked by the server's
    UTC date, so from 8 PM ET a quarter could flip a day early. Every terminal date is ET."""
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date()


def is_unreported(period_end: str, last_report: Optional[str], today) -> bool:
    """True while `period_end` is still a forward period. `today` is a date or
    an ISO string. Without a known last report date only the grace window
    applies (the old behaviour, kept as the fallback rather than guessed)."""
    if isinstance(today, str):
        today = date.fromisoformat(today[:10])
    if period_end < (today - timedelta(days=GRACE_DAYS)).isoformat():
        return False
    if last_report is None:
        return True
    return period_end >= last_report


def read_last_report(sym: str, timeout: int = 10) -> tuple[str, Optional[str]]:
    """("ok", date|None) or ("error", None). One FMP `/stable/earnings` read;
    an answered-empty symbol is ("ok", None)."""
    try:
        res = fmp_client.get_earnings(sym, limit=12, timeout=timeout)
    except fmp_client.FMPNotFound:
        return "ok", None
    except Exception:  # noqa: BLE001 -- the caller falls back to the grace window
        return "error", None
    if res.degraded is not None:
        return "error", None
    return "ok", last_report_date(res.value)


def _cache():
    from api.services.cache import cache
    return cache


def _f(v) -> Optional[float]:
    if isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _i(v) -> Optional[int]:
    x = _f(v)
    return int(x) if x is not None else None


def _growth(cur: Optional[float], prev: Optional[float]) -> Optional[float]:
    """Percent change, None across a zero or a sign change."""
    if cur is None or prev is None or prev == 0 or (prev < 0) != (cur < 0):
        return None
    return round((cur - prev) / abs(prev) * 100, 2)


def _quarter_label(period_end: str) -> Optional[str]:
    """'Q3 2026' from a fiscal period END date, through the ONE shared
    period-end mapper (`earnings_estimates._fiscal_q_from_period_end`) that the
    ERN modal's estimate rows use — so EE and ERN number a quarter the same."""
    from api.services import earnings_estimates as ee
    q, y = ee._fiscal_q_from_period_end(period_end)
    return f"Q{q} {y}" if q else None


def fiscal_relabel(quarterly: list[dict], annual_rows: Any) -> list[dict]:
    """Relabel quarterly rows with the COMPANY'S fiscal quarter when it differs from the
    calendar one `_quarter_label` assigns.

    ⛔ `_quarter_label` numbers a quarter by its calendar months, which is right only for a
    December fiscal year. The panel says "by fiscal quarter", so for NVIDIA (January year end)
    the quarter ending October 2026 read "Q3 2026" while NVIDIA calls it Q3 FY2027 and the annual
    table beside it reads "FY2027"; Apple's December quarter read "Q4" for its fiscal Q1
    (accuracy audit 2026-10-06). The fiscal year ends come from FMP's own ANNUAL estimate rows
    (their `date` IS the fiscal year end), placed by `fiscal_calendar.FiscalCalendar`. A
    December filer keeps its label byte-for-byte; with no annual anchors nothing changes."""
    from api.services.fiscal_calendar import FiscalCalendar, display_label
    ends = [str(r.get("date") or "")[:10] for r in (annual_rows or []) if isinstance(r, dict)]
    cal = FiscalCalendar([e for e in ends if len(e) == 10])
    if not cal.anchors:
        return quarterly
    for row in quarterly:
        info = cal.resolve(row.get("period_end"))
        # `display_label` is the one authority the ERN modal's history rows
        # also go through (earnings_history_fmp), so EE and ERN cannot drift.
        text = display_label(info.get("fiscal_year"), info.get("fiscal_quarter"), row.get("period_end"))
        if text:
            row["label"] = text
    return quarterly


def shape_rows(rows: Any, kind: str, *, today: Optional[date] = None,
               last_report: Optional[str] = None) -> list[dict]:
    """FMP rows -> forward periods, soonest first. Pure, so the fixture test
    can drive it without a cache or a clock. `last_report` is the newest
    report date with an actual (see `is_unreported`)."""
    if not isinstance(rows, list):
        return []
    today = today or today_et()
    parsed = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        end = str(r.get("date") or "")[:10]
        if len(end) != 10:
            continue
        parsed.append((end, r))
    parsed.sort(key=lambda t: t[0])
    out, seen = [], set()
    for end, r in parsed:
        eps = {"avg": _f(r.get("epsAvg")), "low": _f(r.get("epsLow")),
               "high": _f(r.get("epsHigh")), "n": _i(r.get("numAnalystsEps"))}
        rev = {"avg": _f(r.get("revenueAvg")), "low": _f(r.get("revenueLow")),
               "high": _f(r.get("revenueHigh")), "n": _i(r.get("numAnalystsRevenue"))}
        row = {"period_end": end, "eps": eps, "revenue": rev,
               "ebitda_avg": _f(r.get("ebitdaAvg")), "ebit_avg": _f(r.get("ebitAvg")),
               "net_income_avg": _f(r.get("netIncomeAvg")),
               "_eps": eps["avg"], "_rev": rev["avg"]}
        out.append(row)
    # Growth is consensus-over-consensus against the SAME period one year back
    # in FMP's own series (4 quarters / 1 year), computed BEFORE the forward
    # filter so the first forward row still has its comparison.
    step = 4 if kind == "quarterly" else 1
    for i, row in enumerate(out):
        back = out[i - step] if i >= step else None
        row["eps_growth"] = _growth(row["_eps"], back["_eps"] if back else None)
        row["revenue_growth"] = _growth(row["_rev"], back["_rev"] if back else None)
    fwd = []
    for row in out:
        row.pop("_eps"), row.pop("_rev")
        if not is_unreported(row["period_end"], last_report, today):
            continue
        if row["eps"]["avg"] is None and row["revenue"]["avg"] is None:
            continue
        if kind == "quarterly":
            label = _quarter_label(row["period_end"])
        else:
            label = f"FY{row['period_end'][:4]}"
        if not label or label in seen:
            continue
        seen.add(label)
        row["label"] = label
        fwd.append(row)
    return fwd[:MAX_QUARTERS if kind == "quarterly" else MAX_ANNUAL]


def _read(sym: str, period: str, limit: int):
    """One leg. Returns ("ok", rows) | ("empty", []) | ("error", reason)."""
    try:
        res = fmp_client.get_analyst_estimates(sym, period=period, limit=limit, timeout=_TIMEOUT_S)
    except fmp_client.FMPNotFound:
        return "empty", []
    except Exception as exc:  # noqa: BLE001 -- recorded as the `error` state
        return "error", f"{type(exc).__name__}: {exc}"[:200]
    if res.degraded is not None:
        return "error", f"FMP endpoint degraded ({res.degraded})"
    return "ok", res.value if isinstance(res.value, list) else []


def get_consensus(sym: str, *, today: Optional[date] = None) -> dict:
    """Annual + quarterly forward consensus for one symbol. Never raises."""
    sym = (sym or "").upper().strip()
    if not sym:
        return {"sym": "", "state": "empty", "annual": [], "quarterly": [], "source": SOURCE}
    # v3: the payload carries `currency` (the company's reporting currency).
    ck = f"research_consensus::v3::{sym}"
    hit = _cache().get(ck)
    if hit is not None:
        return hit

    legs: dict[str, tuple] = {}
    try:
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="ee-consensus") as ex:
            futs = {k: ex.submit(_read, sym, p, lim) for k, (p, lim) in _REQUESTS.items()}
            f_rep = ex.submit(read_last_report, sym, _TIMEOUT_S)
            f_ccy = ex.submit(reporting_currency.read, sym, _TIMEOUT_S)
            for k, f in futs.items():
                try:
                    legs[k] = f.result()
                except Exception as exc:  # noqa: BLE001
                    legs[k] = ("error", str(exc)[:200])
            try:
                rep_state, last_report = f_rep.result()
            except Exception:  # noqa: BLE001
                rep_state, last_report = "error", None
            try:
                ccy_state, currency = f_ccy.result()
            except Exception:  # noqa: BLE001
                ccy_state, currency = "error", None
    except Exception as exc:  # noqa: BLE001
        _logger.warning("[ee_consensus] fan-out failed for %s: %s", sym, exc)
        legs = {k: ("error", str(exc)[:200]) for k in _REQUESTS}
        rep_state, last_report = "error", None
        ccy_state, currency = "error", None

    annual = (shape_rows(legs["annual"][1], "annual", today=today, last_report=last_report)
              if legs["annual"][0] == "ok" else [])
    quarterly = (shape_rows(legs["quarterly"][1], "quarterly", today=today, last_report=last_report)
                 if legs["quarterly"][0] == "ok" else [])
    if quarterly and legs["annual"][0] == "ok":
        quarterly = fiscal_relabel(quarterly, legs["annual"][1])
    errors = {k: v[1] for k, v in legs.items() if v[0] == "error"}
    if annual or quarterly:
        # Without the report date the grace window alone decided what is
        # forward, which can keep a just-reported period: hold it briefly.
        # An unread currency is held briefly too: "$" on TWD figures must not
        # stick for six hours because one income-statement read timed out.
        state, ttl = "ok", (_TTL_ERROR if errors or rep_state != "ok" or ccy_state != "ok"
                            else _TTL_OK)
    elif errors:
        state, ttl = "error", _TTL_ERROR
    else:
        state, ttl = "empty", _TTL_EMPTY
    out = {"sym": sym, "state": state, "annual": annual, "quarterly": quarterly,
           "source": SOURCE, "fetched_at": int(time.time()),
           "last_report": last_report,
           # FMP's estimate rows carry no currency; they are on the statements'
           # basis, so this is the statements' `reportedCurrency` (TSM -> "TWD").
           # None = not known. Nothing is converted. See reporting_currency.py.
           "currency": currency,
           "currency_source": reporting_currency.SOURCE,
           "forward_rule": ("reported_through" if rep_state == "ok" and last_report
                            else "grace_window")}
    if errors:
        out["errors"] = errors
    if state == "empty":
        out["reason"] = "FMP holds no forward consensus for this symbol"
    _cache().set(ck, out, ttl)
    return out
