"""MD-1 kind `market.periodChange` (owner: terminal-data, data wave 14) — every stock's change between two dates, as held.

The PCHG terminal function's stock ranking for any two dates: each US common stock's percent change from its close on the
start day to its close on the end day (each date snapped back over a weekend or holiday), the biggest gainers or the biggest
losers, with the closes, the sector and the industry. Over the answer of `GET /api/scans/period-change?start=&end=`
(`api/services/scan_period.py`), with the service's own field names. `group.drill` reads the same ranking for the seven
one-click ranges; this kind takes any two dates.

⛔ ONLY WHAT THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). `get_period_change` starts ONE background build of the
whole-market ranking when it holds nothing for the range (two whole-market grouped-daily reads and the market snapshot).
This adapter reads the answer the service holds (`_period_answer`: `data.held` `fresh`) or its last good one
(`_period_old_answer`: `last_good`, and the read is `stale`), and is `unavailable` otherwise, saying `computing` when the
service's own build for that range is already running. provider_calls is always 0.
⚠️ COUPLING, stated: the range key (`scan_period_<start>_<end>`) and the two held-answer readers are private to the
service. A rail fills them through the service's own writer (`_period_remember`) and reads them back.

A NUMBER THAT DOES NOT EXIST IS NULL, NEVER 0: a stock with no change is left out; a missing close or price is null.

THE CUT IS STATED: at most `rows` stocks from the end asked for; the whole count rides beside them.

TIME (MD-1 §3): the ranking carries the two trading days it measures between and when UCT built it. The end day's close can
be a session still under way when the end is today, so neither is claimed as `as_of`: `as_of` is null with a note.
freshness `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): derived changes over a vendor's whole-market closes, as `group.drill`'s
ranking is; the licensing register (docs/terminal-research/09-security-licensing-cost/licensing-register.md) rows T-04 and
T-09 cover the prices for member display and storage, restricted, and row T-14 is the vendor's numbers into a model,
restricted. No row clears these figures for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _num

KIND = "market.periodChange"
SOURCE = "uct-period-change"
DEFAULT_ROWS = 15
MAX_ROWS = 50
SIDES = ("gainers", "losers")
FLOOR = "1990-01-01"                      # periodChangeModel.js PERIOD_FLOOR, railed equal
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("every US common stock's change from its close on {start} to its close on {end} as UCT ranked it (the PCHG "
             "panel's ranking; each date snapped back over a weekend or holiday), the biggest {side} first: a record of "
             "what the closes did, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is null: the ranking measures from {start} to {end} and UCT built it at {built}; the end close can "
              "be a session still under way. Never the time of the read")
NOTE_LAST_GOOD = ("this is the last good ranking UCT built for these dates, older than the five minutes it is normally "
                  "kept; its prices may be behind")
NOTE_PARTIAL = ("the ranking is partial: one of the dates is older than the whole-market history, so it was ranked from "
                "UCT's own stored prices, and stocks that no longer trade may be missing")
NOTE_CUT = "{total} stocks are ranked and the {shown} biggest {side} are returned"
NOTE_PRICE = "the price beside each stock is the one the market snapshot carried when UCT built the ranking, never a quote"
NOTE_COMPUTING = ("the ranking for {start} to {end} is being worked out on the server; this read never starts or waits "
                  "for it. Ask again in a minute")
NOTE_NOT_HELD = ("no ranking for {start} to {end} is held on this server, and this read never builds one. That is not the "
                 "same as no change. Open PCHG {start} {end} in UCT, then ask again")
NOTE_FAILED = "the period change read failed; nothing is stated. That is not the same as no change"


def _ymd(s: str) -> int:
    return int(s.replace("-", ""))


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    for k in ("start", "end"):
        v = params.get(k)
        if not isinstance(v, str) or not _DAY.match(v):
            return f"`{k}` must be a day, YYYY-MM-DD"
        try:
            date.fromisoformat(v)
        except ValueError:
            return f"`{k}` must be a real day"
        if v < FLOOR:
            return f"`{k}` must be on or after {FLOOR}"
    if params["start"] >= params["end"]:
        return "`start` must be before `end`"
    if params.get("side") is not None and params["side"] not in SIDES:
        return "`side` must be gainers or losers"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(start: str, end: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)`; `how` is `fresh`, `last_good`, `computing` or `not_held`. Never builds."""
    from api.services import scan_period as svc
    ck = f"scan_period_{_ymd(start)}_{_ymd(end)}"
    hit = svc._period_answer(ck)
    if isinstance(hit, dict) and hit.get("status") == "ok":
        return hit, "fresh"
    old = svc._period_old_answer(ck)
    if isinstance(old, dict) and old.get("status") == "ok":
        return old, "last_good"
    with svc._period_inflight_lock:
        running = ck in svc._period_inflight
    return None, "computing" if running else "not_held"


def _day_of(v: Any) -> Optional[str]:
    s = str(v or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if re.fullmatch(r"\d{8}", s) else None


def _built(v: Any) -> Optional[str]:
    try:
        at = datetime.fromisoformat(str(v))
    except (TypeError, ValueError):
        return None
    return env.utc_iso((at if at.tzinfo else at.replace(tzinfo=_ET)).astimezone(timezone.utc))


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not isinstance(r.get("sym"), str) or _num(r.get("period_change")) is None:
        return None
    s = lambda k: r.get(k) if isinstance(r.get(k), str) and r[k] else None    # noqa: E731
    return {"sym": r["sym"], "period_change": _num(r["period_change"]), "net_change": _num(r.get("net_change")),
            "start_close": _num(r.get("start_close")), "end_close": _num(r.get("end_close")), "price": _num(r.get("price")),
            "sector": s("sector"), "industry": s("industry")}


def read_period_change(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    start, end = params["start"], params["end"]
    side, limit = params.get("side") or "gainers", params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer(start, end)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "computing":
        return env.unavailable(KIND, params, SOURCE, NOTE_COMPUTING.format(start=start, end=end))
    if how not in ("fresh", "last_good") or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(start=start, end=end))
    rows, seen = [], set()
    for r in got.get("results") or []:
        x = _row(r)
        if x and x["sym"] not in seen:
            seen.add(x["sym"])
            rows.append(x)
    if not rows:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(start=start, end=end))
    rows.sort(key=lambda x: x["period_change"], reverse=side == "gainers")
    shown = rows[:limit]
    sd, ed, built = _day_of(got.get("start")), _day_of(got.get("end")), _built(got.get("as_of"))
    notes = [NOTE_WHAT.format(start=sd or start, end=ed or end, side=side),
             NOTE_AS_OF.format(start=sd or start, end=ed or end, built=built or "a time it did not record"), NOTE_PRICE]
    if how == "last_good":
        notes.append(NOTE_LAST_GOOD)
    if got.get("partial") is True:
        notes.append(NOTE_PARTIAL)
    if len(rows) > len(shown):
        notes.append(NOTE_CUT.format(total=len(rows), shown=len(shown), side=side))
    data = {"start": start, "end": end, "start_day": sd, "end_day": ed, "side": side, "held": how, "built_at": built,
            "partial": got.get("partial") is True, "rows": shown, "count": len(shown), "total": len(rows),
            "cut": len(rows) > len(shown)}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                             stale=how == "last_good", notes=notes, provider_calls=0)
