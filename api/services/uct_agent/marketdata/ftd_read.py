"""MD-1 kind `stock.failsToDeliver` (owner: terminal-data, data wave 12) — one stock's SEC fails-to-deliver, as held.

The newest reported settlement days' fails-to-deliver balance (shares, the price beside it and their value), the trend
(the change from the reported day before, the window's peak and the newest balance as a share of it), the window the
ingested files cover and the source's twice-monthly lag. The Agent half of FTD, over the answer of
`GET /api/research/ftd/{sym}` (`api/services/ftd_dataset.py`), with the route's own field names.

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A DOWNLOAD (MD-1 §5). The SEC's files are read by the scheduled ingest alone
(`ftd_dataset.run_ingest`); the route reads the local store, but opens it through a helper that creates the store when it
is missing. A turn must not create anything, so this adapter reads through `ftd_dataset_held.held_series()`, which answers
`not_held` when there is no store and is otherwise the route's own answer. provider_calls is always 0. A rail shows the
route's reader creating the store in the same state.

A BALANCE, NEVER A FLOW: each figure is the aggregate fails-to-deliver balance on that settlement date (the service's own
basis words), never summed across days. The value is the server's own (shares times the price in the file); a row
without a price has no value, never 0.

NOTHING HELD IS SAID, NEVER "NO FAILS": no store, or no file ingested yet, is `unavailable` with that reason. A stock with
no row in the ingested window is the service's own words for it ("no fails reported for … between … and …"), with the
window, never "no fails ever".

THE ROUTE'S SWITCH IS RESPECTED EXACTLY: the route answers 404 unless FTD_DATASET_ENABLED is on; with it off this read is
`unavailable`, never an empty series.

TIME (MD-1 §3): `as_of` = the start of the Eastern day of the newest settlement date reported for the stock (with none
reported, the newest date the ingested files cover), the data's own date; never the time of the read. The SEC posts each
half-month's file in the second half of the following period, so the newest figure is some weeks old: said. Every read
is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the SEC's fails-to-deliver data is US government data, public domain;
the nearest row of docs/terminal-research/09-security-licensing-cost/licensing-register.md is T-83 (SEC EDGAR filings,
"A", public domain), which names EDGAR's filings and not these NSCC-derived files; the one row that mentions this
store, T-104, reads it only as a CUSIP-to-symbol input to the N-PORT fund index, and no row names a model lane for it.
The narrower rule is kept: no row of that register clears these figures for a model provider. Shown to the member
only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _whole, day_as_of
from api.services.uct_agent.marketdata.stock_stats_read import check_params, clean_symbol

KIND = "stock.failsToDeliver"
SOURCE = "sec-fails-to-deliver"
DEFAULT_ROWS = 10
MAX_ROWS = 40
STATES = ("ok", "none_reported", "not_ingested")          # ftd_dataset.series's own states (a rail pins them)
POINT_FIELDS = ("settle_date", "quantity", "price", "value")

NOTE_WHAT = ("{symbol}'s fails to deliver as UCT holds them for the FTD panel, from the SEC's fails-to-deliver files "
             "(NSCC's Continuous Net Settlement data) ingested for {start} to {through}: each figure is the aggregate "
             "balance of shares that failed to deliver on that settlement date, not the day's new fails, and balances are "
             "never summed across days. Not advice")
NOTE_AS_OF = ("`as_of` is the newest settlement date stated ({day}); it is never the time of the read, and this read never "
              "downloads a file")
NOTE_NO_DAY = "`as_of` is null: neither a reported row nor the ingested files give a date"
NOTE_LAG = ("the SEC posts each half-month's file in the second half of the following period, so the newest figure is "
            "some weeks old")
NOTE_NONE = "{reason}: none of the {files} ingested files has a row for it. That is not the same as no fails ever"
NOTE_MISMATCH = "{n} of the ingested files did not reconcile with their own row count and are kept, marked: {names}"
NOTE_NO_PRICE = "{n} of the rows returned carry no price, so they have no value (never 0)"
NOTE_CUT = "{total} settlement days are reported and the newest {shown} are returned: the list is cut from the OLD end"
NOTE_NOT_INGESTED = ("no fails-to-deliver file has been ingested on this server yet, so nothing is stated for {symbol}. That "
                     "is not the same as no fails")
NOTE_SWITCHED_OFF = ("the fails-to-deliver data set is switched off on this server (its route answers nothing), so it is "
                     "not read. That is not the same as no fails")
NOTE_NOT_HELD = ("no fails-to-deliver store is held on this server yet, and this read never downloads one. That is not "
                 "the same as no fails")
NOTE_FAILED = "the fails-to-deliver read failed; nothing is stated. That is not the same as no fails"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def switched_on() -> bool:
    """The route's own switch (`ftd_dataset.is_enabled`, read per call)."""
    from api.services import ftd_dataset as svc
    return svc.is_enabled()


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the route's own answer, 'held' | 'not_held'), WITHOUT creating the store (`ftd_dataset_held.held_series`)."""
    from api.services import ftd_dataset_held as svc
    return svc.held_series(sym)


def _point(p: Any) -> Optional[dict]:
    if not isinstance(p, dict) or not _day(p.get("settle_date")):
        return None
    return {"settle_date": p["settle_date"], "quantity": _whole(p.get("quantity")), "price": _num(p.get("price")),
            "value": _num(p.get("value"))}


def read_ftd(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = clean_symbol(params["symbol"])
    rows = params.get("rows", DEFAULT_ROWS)
    try:
        if not switched_on():
            return env.unavailable(KIND, params, SOURCE, NOTE_SWITCHED_OFF)
        got, how = held_answer(sym)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if got.get("state") not in ("ok", "none_reported"):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_INGESTED.format(symbol=sym))
    try:
        return _answer(params, sym, rows, got)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, sym: str, rows: int, got: dict) -> dict:
    window = got.get("window") if isinstance(got.get("window"), dict) else {}
    start, through = _day(window.get("from")), _day(window.get("through"))
    files = [f for f in (got.get("files") or []) if isinstance(f, dict)]
    ingested = [f for f in files if f.get("state") in ("ok", "count_mismatch")]
    points = [p for p in (_point(x) for x in (got.get("points") or [])) if p]
    points.sort(key=lambda p: p["settle_date"])
    newest_first = points[::-1]
    shown = newest_first[:rows]
    latest = points[-1] if points else None
    previous = points[-2] if len(points) > 1 else None
    peak = max(points, key=lambda p: p["quantity"] or 0) if points else None
    trend = None
    if latest:
        trend = {"previous": previous,
                 "change": (latest["quantity"] - previous["quantity"]) if previous and latest["quantity"] is not None
                 and previous["quantity"] is not None else None,
                 "peak": peak,
                 "latest_vs_peak_pct": round(latest["quantity"] / peak["quantity"] * 100.0, 1)
                 if peak and peak["quantity"] and latest["quantity"] is not None else None}
    day = latest["settle_date"] if latest else through
    notes = [NOTE_WHAT.format(symbol=sym, start=start or "a day it does not give", through=through or "a day it does not give"),
             NOTE_AS_OF.format(day=day) if day else NOTE_NO_DAY, NOTE_LAG]
    if not points:
        notes.append(NOTE_NONE.format(reason=str(got.get("reason") or f"no fails reported for {sym}"), files=len(ingested)))
    mismatched = [str(n) for n in (got.get("mismatched_files") or []) if isinstance(n, str)]
    if mismatched:
        notes.append(NOTE_MISMATCH.format(n=len(mismatched), names=", ".join(mismatched[:6])))
    no_price = sum(1 for p in shown if p["price"] is None)
    if no_price:
        notes.append(NOTE_NO_PRICE.format(n=no_price))
    if len(points) > len(shown):
        notes.append(NOTE_CUT.format(total=len(points), shown=len(shown)))
    data = {"symbol": sym, "state": got.get("state"), "window": {"from": start, "through": through},
            "basis": got.get("basis") if isinstance(got.get("basis"), str) else None,
            "description": got.get("description") if isinstance(got.get("description"), str) else None,
            "latest": latest, "trend": trend, "days_reported": len(points), "rows": shown,
            "files_ingested": len(ingested), "mismatched_files": mismatched,
            "newest_file": max((f.get("name") for f in ingested if isinstance(f.get("name"), str)), default=None)}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, notes=notes, provider_calls=0)
