"""MD-1 kind `earnings` (owner: agent-md) — contract MD-1 v1.1 §4.

Event-driven earnings: the reported quarters (actuals vs estimates) and the NEXT scheduled report. An
adapter over `services/earnings_table.get_earnings_table`, the canonical payload behind
/api/fundamentals/earnings-table and the one the fundamentals monitor guards. Its staleness
(`stale_quarters`, from `reported_staleness`) is reused, never re-derived.

* Reported rows carry only a fiscal LABEL ("2026 Q2"), with no report date or period end. Turning a label
  into a date would be a guess, so `as_of` is null and a note names `reported_through`
  (MD-1 §3 allows a null as_of when a note says why).
* `stale` when `stale_quarters` >= STALE_QUARTERS (two quarters behind what a typical filer has reported).
* `next_report` is a SCHEDULED EVENT taken from the same payload's nearest forward row (its
  `report_date`). It is never used as `as_of`, and no second service is read for it.
* freshness `periodic`.
* `provider_calls`: the payload cannot say whether it was built on this read, so 1 per read (MD-1 §6.3,
  conservative).
* ⚠️ Background refresh: the canonical service serves a stale stored copy and refreshes it behind the
  response. That is its own cache behaviour (accepted by agent-lead, 2026-11-01); this adapter adds no
  job, connection or write.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "uct-earnings"
STALE_QUARTERS = 2
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

ROW_FIELDS = ("quarter", "eps_actual", "eps_estimate", "eps_surprise_pct", "rev_actual", "rev_estimate",
              "rev_surprise_pct")
NEXT_REPORT_FIELDS = ("report_date", "quarter", "eps_estimate", "rev_estimate", "kind")
NOTE_NO_NEXT = "no scheduled next report date is known"
NOTE_BEHIND = "reported results are {n} quarters behind what a typical filer has reported by now"
NOTE_NO_DATE = "reported quarters carry no report date — as_of is not given; reported through {label}"
NOTE_EVENT = "next_report is a scheduled event, not a result"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    sym = str(params.get("symbol") or "").strip().upper()
    if not _SYMBOL_RE.match(sym):
        return "a valid ticker symbol is required"
    return None


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _date(v: Any) -> Optional[str]:
    return v[:10] if isinstance(v, str) and _DATE_RE.match(v[:10]) else None


def read_earnings(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "earnings"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    sym = str(params["symbol"]).strip().upper()

    from api.services import earnings_table
    payload = earnings_table.get_earnings_table(sym)
    calls = 1
    quarterly = payload.get("quarterly") if isinstance(payload, dict) else None
    if not isinstance(quarterly, list):
        return env.unavailable(kind, params, SOURCE, f"no earnings data for {sym}", calls)

    reported = [r for r in quarterly if isinstance(r, dict) and r.get("reported") and r.get("label")]
    forward = [r for r in quarterly if isinstance(r, dict) and not r.get("reported")]
    if not reported:
        return env.unavailable(kind, params, SOURCE, f"no reported quarters for {sym}", calls)

    rows = [{"quarter": r["label"], "eps_actual": _num(r.get("eps_actual")),
             "eps_estimate": _num(r.get("eps_estimate")), "eps_surprise_pct": _num(r.get("eps_surprise_pct")),
             "rev_actual": _num(r.get("rev_actual")), "rev_estimate": _num(r.get("rev_estimate")),
             "rev_surprise_pct": _num(r.get("rev_surprise_pct"))} for r in reported]
    through = payload.get("reported_through") or reported[-1]["label"]
    behind = payload.get("stale_quarters")
    behind = behind if isinstance(behind, int) and not isinstance(behind, bool) else 0
    stale = behind >= STALE_QUARTERS

    nxt = next((r for r in forward if _date(r.get("report_date"))), None)
    next_report = None
    if nxt:
        next_report = {"report_date": _date(nxt.get("report_date")), "quarter": nxt.get("label"),
                       "eps_estimate": _num(nxt.get("eps_estimate")), "rev_estimate": _num(nxt.get("rev_estimate")),
                       "kind": "scheduled"}

    notes = [NOTE_NO_DATE.format(label=through)]
    if stale:
        notes.append(NOTE_BEHIND.format(n=behind))
    if next_report:
        notes.append(NOTE_EVENT)
    else:
        notes.append(NOTE_NO_NEXT)
    data = {"symbol": sym, "reported": rows, "reported_through": through, "quarters_behind": behind,
            "next_report": next_report}
    return env.make_envelope(kind, params, status="ok", freshness="periodic", as_of=None, source=SOURCE,
                             data=data, stale=stale, notes=notes, provider_calls=calls)
