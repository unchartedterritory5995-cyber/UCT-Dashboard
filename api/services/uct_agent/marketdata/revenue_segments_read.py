"""MD-1 kind `company.segments` (owner: terminal-data, data wave 12) — one stock's revenue by segment and by region, as held.

For the newest fiscal year and the newest fiscal quarter the server holds: the revenue split by product (or business line)
and by region, each segment's revenue and share (the server's own share: of the segments listed), and its growth against
the same segment a year earlier. The Agent half of SEG, over the answer of
`GET /api/research/revenue-segments/{ticker}?period=annual|quarter` (`api/services/revenue_segments.py`), with the
route's own field names.

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `revenue_segments.get_segments` answers
through `KeyedHeld.get()`, which STARTS the one background build of a (stock, period) when nothing is held or a refresh is
due (two vendor reads). A turn must not, so this adapter reads through `revenue_segments_held.held_segments()` (the hold's
`peek()`), for the annual and the quarterly answer separately; each one not held is said. provider_calls is always 0. A
rail shows `get_segments` starting that build in the same state.

GROWTH IS WORKED OUT HERE, AND ONLY FROM HELD PERIODS: a segment's revenue against the same segment's in the period a year
earlier (for a year, the year before; for a quarter, the period that ended 350 to 380 days earlier). No such period, no
such segment in it, or a figure of 0 or less there: no growth, said, never 0. Shares are the server's own.

NOTHING HELD IS SAID, NEVER "NO SEGMENTS": neither answer held is `unavailable` with that reason; a leg the vendor did not
answer keeps its own state (`none`, `not_in_plan`, `not_configured`, `rate_limited`, `failed`), said in words.

TIME (MD-1 §3): `as_of` = the start of the Eastern day of the newest fiscal period end among the splits returned, the data's
own date; never the time of the read. When UCT read each answer rides as its `read_at`. Every read is `periodic`; the kind
is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the segment figures are the estimates vendor's company data, stamped
`data_class="segments"`, which no row of docs/terminal-research/09-security-licensing-cost/licensing-register.md names (so
"U", never inferred); the nearest rows are T-33 (FMP's statements and fundamentals for member display, "R") and T-44
(FMP's numbers into a model, "No AI clause"). No row of that register clears these figures for a model provider. Shown to
the member only; the capability is local-only.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, day_as_of
from api.services.uct_agent.marketdata.stock_stats_read import check_params, clean_symbol

KIND = "company.segments"
SOURCE = "uct-revenue-segments"
PERIODS = ("annual", "quarter")            # revenue_segments.PERIODS (a rail pins the two together)
LEGS = ("product", "region")
LEG_STATES = ("ok", "none", "not_in_plan", "not_configured", "rate_limited", "failed")
DEFAULT_ROWS = 8
MAX_ROWS = 25                              # revenue_segments.SEGMENT_CAP
YEAR_BACK_DAYS = (350, 380)
LEG_WORDS = {"none": "the vendor answered with no period it could read",
             "not_in_plan": "the site's plan with the vendor does not include it",
             "not_configured": "the vendor is not switched on for this server",
             "rate_limited": "the vendor turned the read away for too many requests",
             "failed": "the vendor's answer could not be read"}

NOTE_WHAT = ("{symbol}'s revenue by segment as UCT holds it for the SEG panel: the newest fiscal year's and quarter's split "
             "by product and by region, each segment's revenue and share of the segments listed (which may not add up to "
             "the company's total revenue), and its growth against a year earlier. Company-reported figures, not advice")
NOTE_AS_OF = ("`as_of` is the newest fiscal period end among the splits returned ({day}); it is never the time of the read. "
              "UCT read them at {at} (UCT's own time)")
NOTE_NO_PERIOD = "`as_of` is null: no split of the held answers has a period that could be read"
NOTE_GROWTH = ("growth is worked out by this read from the held periods: each segment against the same segment in the "
               "period a year earlier (the year before; for a quarter, the period that ended 350 to 380 days earlier); "
               "a segment without one has no growth stated, never 0")
NOTE_ONE_HELD = ("the {missing} split is not held on this server yet (only the {held} one is), and this read never builds it. "
                 "Open SEG {word} for {symbol} in UCT, then ask again")
NOTE_LEG = "the {period} {leg} split is not stated: {why}. That is not the same as no segments"
NOTE_CUT = "{period} {leg} split: {total} segments are held and the largest {shown} are returned (the smallest are cut)"
NOTE_LEFT_OUT = "the earlier periods side by side are not in this read, only the newest and its comparison: the SEG panel shows them"
NOTE_NOT_HELD = ("{symbol}'s revenue by segment is not held on this server yet, and this read never builds it. That is not "
                 "the same as no segments. Open SEG for {symbol} in UCT, then ask again")
NOTE_FAILED = "the revenue by segment read failed; nothing is stated. That is not the same as no segments"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(sym: str, period: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the route's own answer for one period, 'held' | 'not_held'), WITHOUT starting a build
    (`revenue_segments_held.held_segments`)."""
    from api.services import revenue_segments_held as svc
    return svc.held_segments(sym, period)


def _days_between(a: str, b: str) -> int:
    return (date.fromisoformat(a) - date.fromisoformat(b)).days


def _prior(periods: list, period: str) -> Optional[dict]:
    newest = periods[0]
    for p in periods[1:]:
        if period == "annual":
            return p
        if YEAR_BACK_DAYS[0] <= _days_between(newest["date"], p["date"]) <= YEAR_BACK_DAYS[1]:
            return p
    return None


def _leg(raw: Any, period: str, rows: int) -> dict:
    src = raw if isinstance(raw, dict) else {}
    state = src.get("state") if src.get("state") in LEG_STATES else "failed"
    periods = [p for p in (src.get("periods") or []) if isinstance(p, dict) and _day(p.get("date"))]
    periods.sort(key=lambda p: p["date"], reverse=True)
    if state != "ok" or not periods:
        return {"state": "none" if state == "ok" else state, "latest": None, "prior": None}
    newest, prior = periods[0], _prior(periods, period)
    before = {s.get("name"): _num(s.get("revenue")) for s in (prior or {}).get("segments") or [] if isinstance(s, dict)}
    segs = []
    for s in newest.get("segments") or []:
        if not isinstance(s, dict) or not isinstance(s.get("name"), str) or _num(s.get("revenue")) is None:
            continue
        rev, was = _num(s.get("revenue")), before.get(s.get("name"))
        segs.append({"name": s["name"][:120], "revenue": rev, "share": _num(s.get("share")), "prior": was,
                     "growth_pct": round((rev - was) / was * 100.0, 2) if was is not None and was > 0 else None})
    latest = {"date": newest["date"], "label": newest.get("label") if isinstance(newest.get("label"), str) else newest["date"],
              "currency": newest.get("currency") if isinstance(newest.get("currency"), str) else None,
              "total": _num(newest.get("total")), "segments": segs[:rows], "segments_total": len(segs),
              "cut": len(segs) > rows or newest.get("cut") is True}
    return {"state": "ok", "latest": latest,
            "prior": {"date": prior["date"], "label": prior.get("label") if isinstance(prior.get("label"), str) else prior["date"]} if prior else None}


def read_segments(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = clean_symbol(params["symbol"])
    rows = params.get("rows", DEFAULT_ROWS)
    try:
        held = {p: held_answer(sym, p) for p in PERIODS}
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not any(how == "held" and isinstance(got, dict) for got, how in held.values()):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    try:
        return _answer(params, sym, rows, held)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, sym: str, rows: int, held: dict) -> dict:
    splits, ends, reads, notes_legs = {}, [], [], []
    for period in PERIODS:
        got, how = held[period]
        if how != "held" or not isinstance(got, dict):
            splits[period] = {"state": "not_held"}
            continue
        legs = {leg: _leg(got.get(leg), period, rows) for leg in LEGS}
        splits[period] = {"state": "held", "read_at": _read_at(got.get("read_at")), **legs}
        reads.append(splits[period]["read_at"])
        for leg, v in legs.items():
            if v["latest"]:
                ends.append(v["latest"]["date"])
                if v["latest"]["cut"]:
                    notes_legs.append(NOTE_CUT.format(period=period, leg=leg, total=v["latest"]["segments_total"],
                                                      shown=len(v["latest"]["segments"])))
            else:
                notes_legs.append(NOTE_LEG.format(period=period, leg=leg, why=LEG_WORDS.get(v["state"], LEG_WORDS["failed"])))
    newest = max(ends) if ends else None
    read_at = max((r for r in reads if r), default=None)
    notes = [NOTE_WHAT.format(symbol=sym),
             NOTE_AS_OF.format(day=newest, at=read_at or "a time it does not give") if newest else NOTE_NO_PERIOD, NOTE_GROWTH]
    missing = [p for p in PERIODS if splits[p]["state"] != "held"]
    if missing:
        held_one = next(p for p in PERIODS if p not in missing)
        notes.append(NOTE_ONE_HELD.format(missing=missing[0], held=held_one, symbol=sym,
                                          word="QUARTERLY" if missing[0] == "quarter" else "ANNUAL"))
    notes.extend(notes_legs)
    notes.append(NOTE_LEFT_OUT)
    data = {"symbol": sym, "splits": splits, "rows": rows, "growth_basis": "a year earlier, from held periods",
            "left_out": ["earlier_periods"]}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=day_as_of(newest), source=SOURCE,
                             data=data, notes=notes, provider_calls=0)
