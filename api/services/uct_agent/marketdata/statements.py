"""MD-1 kind `fundamentals` (owner: agent-md) — contract MD-1 v1.1 §4.

Periodic financial DISCLOSURES (income statement, balance sheet, cash flow), never live data. An adapter
over `services/financial_statements.get_statements`, the canonical service behind
/api/fundamentals-statements. That service reads FMP first and Yahoo Finance (yfinance) only for a ticker
FMP holds no statements for, through the product's own memory and disk snapshot cache. The envelope's
`source` names the one that answered: `fmp`, or `yahoo-finance`.

* `as_of` = the newest reported statement PERIOD END (quarterly first, else annual), as UTC midnight of
  that date. That is the data's own time: the period the figures describe, not when we fetched them.
  The source carries no filed or accepted date, so none is reported (never fabricated).
* freshness `periodic`; `stale` when that period end is more than STALE_AFTER_DAYS old (about two quarters
  plus a filing lag: a company that has filed its latest quarter is never stale).
* `provider_calls`: what this read's synchronous build cost, as the service reports it in
  `meta.build_calls` (6 FMP statement reads; 12 or 13 when it went on to Yahoo Finance), detected by
  `meta.retrieved_at` being newer than the start of the read; otherwise 0. A stored copy from before the
  service reported it counts as 6.
* ⚠️ Background refresh: on a stale-but-usable snapshot the canonical service serves it and refreshes it
  out of band (`_schedule_refresh`). That is the service's own cache behaviour, accepted by agent-lead
  (2026-11-01); this adapter adds no job, connection or write of its own.
"""
from __future__ import annotations

import re
import time
from datetime import date, datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "fmp"                      # asked first; also named when no source answered
SOURCE_FALLBACK = "yahoo-finance"
_FALLBACK_LABEL = "Yahoo Finance"   # financial_statements.SOURCE_FALLBACK, as `meta.source` carries it
STALE_AFTER_DAYS = 135
BUILD_PROVIDER_CALLS = 6
MAX_PERIODS = 8
_STATEMENTS = ("income", "balance", "cashflow")
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_PERIOD_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

PERIOD_FIELDS = ("period_end", "values")
NOTE_NO_FILING_DATE = "the source gives no filing date; as_of is the period end"
NOTE_REFRESHING = "served from the last stored copy while the source refreshes"
NOTE_PERIODIC = ("periodic financial disclosures — figures describe the reporting period in as_of, "
                 "not today")
NOTE_UNAVAILABLE = "the statements source did not answer; try again shortly"


def _source_of(meta: dict) -> str:
    """The envelope source for the statements that were served."""
    return SOURCE_FALLBACK if meta.get("source") == _FALLBACK_LABEL else SOURCE


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    sym = str(params.get("symbol") or "").strip().upper()
    if not _SYMBOL_RE.match(sym):
        return "a valid ticker symbol is required"
    period = params.get("period", "quarterly")
    if period not in ("quarterly", "annual"):
        return "`period` must be 'quarterly' or 'annual'"
    n = params.get("periods", 4)
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        return "`periods` must be a positive whole number"
    return None


def _period_date(p: Any) -> Optional[date]:
    if isinstance(p, str) and _PERIOD_RE.match(p[:10]):
        try:
            return datetime.strptime(p[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def read_fundamentals(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "fundamentals"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    sym = str(params["symbol"]).strip().upper()
    period = params.get("period", "quarterly")
    n = min(params.get("periods", 4), MAX_PERIODS)

    from api.services import financial_statements
    started = time.time()
    payload = financial_statements.get_statements(sym)
    meta = payload.get("meta") if isinstance(payload, dict) and isinstance(payload.get("meta"), dict) else {}
    retrieved = meta.get("retrieved_at")
    built_now = isinstance(retrieved, (int, float)) and retrieved >= started - 1
    built = meta.get("build_calls")
    built = built if isinstance(built, int) and not isinstance(built, bool) and built >= 0 else BUILD_PROVIDER_CALLS
    calls = built if built_now else 0
    source = _source_of(meta)

    if not isinstance(payload, dict) or payload.get("error"):
        reason = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(payload, dict) and payload.get("state") == "unavailable":
            # The read failed: that says nothing about whether the company files statements.
            return env.unavailable(kind, params, source, f"{NOTE_UNAVAILABLE} ({sym})", calls)
        note = f"no financial statements for {sym}"
        if reason == "no statements available" and payload.get("security_type"):
            note += f" (a {payload['security_type']} does not publish company statements)"
        return env.unavailable(kind, params, source, note, calls)

    out: dict[str, list] = {}
    missing: list[str] = []
    newest: Optional[date] = None
    for st in _STATEMENTS:
        block = payload.get(st) if isinstance(payload.get(st), dict) else {}
        rows = block.get(period) if isinstance(block.get(period), list) else []
        clean = []
        for r in rows[:n]:
            d = _period_date(r.get("period") if isinstance(r, dict) else None)
            vals = r.get("values") if isinstance(r, dict) and isinstance(r.get("values"), dict) else {}
            if d is None:
                continue
            clean.append({"period_end": d.isoformat(),
                          "values": {k: _num(v) for k, v in vals.items()}})
            newest = d if newest is None or d > newest else newest
        if clean:
            out[st] = clean
        else:
            missing.append(st)
    if newest is None:
        return env.unavailable(kind, params, source, f"no dated {period} statements for {sym}", calls)

    age_days = (datetime.fromtimestamp(time.time(), timezone.utc).date() - newest).days  # one clock: time.time
    stale = age_days > STALE_AFTER_DAYS
    notes = [NOTE_PERIODIC, NOTE_NO_FILING_DATE]
    if stale:
        notes.append(f"the newest {period} statement is for the period ending {newest.isoformat()} "
                     f"({age_days} days ago)")
    if meta.get("stale"):
        notes.append(NOTE_REFRESHING)
    if missing:
        notes.append("no statement data for: " + ", ".join(missing))
    as_of = env.utc_iso(datetime(newest.year, newest.month, newest.day, tzinfo=timezone.utc))
    data = {"symbol": sym, "period": period, "statements": out,
            "currency": meta.get("currency"), "fiscal_year_end": meta.get("fiscal_year_end"),
            "units": meta.get("units")}
    return env.make_envelope(kind, params, status="partial" if missing else "ok", freshness="periodic",
                             as_of=as_of, source=source, data=data, stale=stale, notes=notes,
                             provider_calls=calls)
