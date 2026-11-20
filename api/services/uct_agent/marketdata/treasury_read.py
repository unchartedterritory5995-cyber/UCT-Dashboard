"""MD-1 kind `rates.treasury` (owner: terminal-data, data wave 6) — US Treasury yields by maturity, as held.

The US Treasury's daily par yield curve as UCT holds it: the yield at each maturity, what it was one day, one week,
one month, three months and one year earlier with the change in basis points, and the two curve spreads (10-year
minus 2-year, 10-year minus 3-month) with their state and how long they have been in it: the Agent half of the RATES
terminal function, over the same answer as `GET /api/research/treasury-yields` (`api/services/treasury_yields.py`).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `treasury_yields.get_yields` STARTS
a background build when nothing is held, or when the held answer is due a refresh: a thread that requests the
Treasury's website. A turn must not, so this adapter never calls it. It reads through
`treasury_yields.held_answer()`, which returns `(answer, how)` with how `held` (the answer in memory, or the copy on
this server's disk, looked for once per process) or `not_held` (nothing held: the answer is None), and never starts a
build. provider_calls is always 0. A rail shows `get_yields` starting the build in the same state.

NOTHING HELD IS SAID, NEVER AN EMPTY CURVE: `not_held` is `unavailable` with that reason.

WHAT IS STATED: every figure is the service's own; nothing is recomputed here. A maturity with no figure on the
curve's day has a null `yield`, never 0; a reference day the service did not find (a hole in the data) leaves that
horizon's `was` and `change_bp` null, never 0. `data.check` carries what the service's last look for a newer figure
said when it did not go well, and the read is then `stale` with a note.

THE CUT IS STATED: the answer's five years of daily history (the `dates` / yield / spread columns the panel draws) are
NOT carried: `data.history` keeps the window and the count of days, and the note says the columns were left out.

TIME (MD-1 §3): `as_of` = the date of the newest figure on the curve (the answer's own `as_of`), as the start of that
Eastern day; never today and never the time of the read. When the site read the figures rides as `data.read_at`. The
read is `stale`, with a note, when the curve's date is behind by the service's own rule (older than the weekday
before today in New York) or when its last look for a newer figure did not go well: this read never looks for a newer
one. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-95 covers these yields as a US
Government work shown on the member's Treasury yields panel, and says nothing else reads it (no AI lane, no export, no
external publication). That row does not clear the figures for a model provider, and no other row does. Shown to the
member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _status_code, _whole, day_as_of

KIND = "rates.treasury"
SOURCE = "us-treasury-par-curve"
#: the change horizons, by the service's own keys (treasury_yields.HORIZONS; a rail pins the two together)
HORIZONS = ("d1", "w1", "m1", "m3", "y1")
MAX_MATURITIES = 20         # the curve has 13 or so points; a ceiling, so a malformed answer cannot be unbounded
MAX_SPREADS = 4
SPREAD_STATES = ("positive", "inverted", "flat")
#: the service's words for a look that did not go well (treasury_yields `check.state` / `check.reason`)
CHECK_WORDS = {"refused": "the Treasury's website refused the request", "shape": "its answer could not be read as the feed",
               "rate_limited": "the Treasury's website said too many requests", "timeout": "it did not answer in time",
               "source": "the Treasury's website answered with an error", "error": "the read failed"}
CHECK_FAILED = "it did not go well"

NOTE_WHAT = ("US Treasury daily par yields by maturity, as UCT holds them: each yield in percent, what it was one "
             "day, one week, one month, three months and one year earlier with the change in basis points, and the "
             "10-year minus 2-year and 10-year minus 3-month spreads in percentage points. End-of-day figures "
             "published by the US Treasury, not live quotes")
NOTE_AS_OF = ("`as_of` is the date of the newest figure on the curve ({day}); it is never today and never the time "
              "of the read. UCT read the figures from the Treasury's website at {at} (UCT's own time)")
NOTE_HISTORY_CUT = ("the {points} days of daily history behind the spreads ({first} to {last}) are left out of this "
                    "read: only the window and the count are carried. The Treasury yields panel (RATES) in UCT "
                    "draws them")
NOTE_MISSING = ("{n} maturities have no figure on {day} and are null, never 0: {list}")
NOTE_NO_REFERENCE = ("no figure was found near enough to {list} earlier, so those changes are null, never 0")
NOTE_STALE = ("the newest figure held is {day}, older than {expected}, the weekday before today in New York. This "
              "read never looks for a newer one: open the Treasury yields panel (RATES) in UCT, then ask again")
NOTE_CHECK = ("UCT's last look for a newer figure, at {at}, did not go well ({why}): the figures held are the last "
              "good ones")
NOTE_NOT_HELD = ("no Treasury yields are held on this server yet, and this read never requests them. That is not the "
                 "same as no figure. Open the Treasury yields panel (RATES) in UCT, then ask again")
NOTE_FAILED = "the Treasury yields read failed; nothing is stated. That is not the same as no figure"

HORIZON_WORDS = {"d1": "one day", "w1": "one week", "m1": "one month", "m3": "three months", "y1": "one year"}


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The curve takes no argument."""
    if not isinstance(params, dict):
        return "the request must be an object"
    return None


def held_answer() -> tuple[Optional[dict], str]:
    """(the answer the service already holds, 'held' | 'not_held'), WITHOUT starting a build."""
    from api.services import treasury_yields as svc
    return svc.held_answer()


def behind_before() -> str:
    """The service's own "behind" line: a curve dated before this day is behind (treasury_yields.refresh_due)."""
    from api.services import treasury_yields as svc
    return svc.last_weekday_before(svc.now_et().date()).isoformat()


def _by_horizon(v: Any) -> dict:
    v = v if isinstance(v, dict) else {}
    return {h: _num(v.get(h)) for h in HORIZONS}


def _maturity(m: Any) -> Optional[dict]:
    if not isinstance(m, dict) or not isinstance(m.get("key"), str) or not m["key"]:
        return None
    return {"key": m["key"], "label": m.get("label") if isinstance(m.get("label"), str) else None,
            "months": _whole(m.get("months")), "yield": _num(m.get("yield")),      # no figure: null, never 0
            "was": _by_horizon(m.get("was")), "change_bp": _by_horizon(m.get("change_bp"))}


def _spread(s: Any) -> Optional[dict]:
    if not isinstance(s, dict) or not isinstance(s.get("key"), str) or not s["key"]:
        return None
    value = _num(s.get("value"))
    text = lambda k: s.get(k) if isinstance(s.get(k), str) else None      # noqa: E731
    return {"key": s["key"], "label": text("label"), "long": text("long"), "short": text("short"), "value": value,
            "state": s.get("state") if value is not None and s.get("state") in SPREAD_STATES else None,
            "inverted": (s.get("inverted") is True) if value is not None else None,
            "days_in_state": _whole(s.get("days_in_state")) if value is not None else None,
            "since": _day(s.get("since")), "days_at_least": s.get("days_at_least") is True,
            "was": _by_horizon(s.get("was")), "change_bp": _by_horizon(s.get("change_bp"))}


def _check(c: Any) -> Optional[dict]:
    if not isinstance(c, dict):
        return None
    text = lambda k: c.get(k) if isinstance(c.get(k), str) and c.get(k) else None      # noqa: E731
    return {"state": text("state"), "reason": text("reason"), "http_status": _status_code(c.get("http_status")),
            "at": text("at")}


def read_treasury(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    try:
        got, how = held_answer()                               # the held answer only: never a build
        expected = behind_before()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no figure"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "not_held" or got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    day = _day(got.get("as_of")) if isinstance(got, dict) else None
    if how != "held" or day is None or got.get("status") != "ok" or not isinstance(got.get("maturities"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    maturities = [x for x in (_maturity(m) for m in got["maturities"]) if x][:MAX_MATURITIES]
    if not any(m["yield"] is not None for m in maturities):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    spreads = [x for x in (_spread(s) for s in got.get("spreads") or []) if x][:MAX_SPREADS]
    refs = got.get("ref_dates") if isinstance(got.get("ref_dates"), dict) else {}
    ref_dates = {h: _day(refs.get(h)) for h in HORIZONS}
    hist = got.get("history") if isinstance(got.get("history"), dict) else {}
    history = {"from": _day(hist.get("from")), "to": _day(hist.get("to")), "points": _whole(hist.get("points")),
               "years": _whole(hist.get("years")), "columns_left_out": True}
    check = _check(got.get("check"))
    read_at = got.get("read_at") if isinstance(got.get("read_at"), str) and got["read_at"] else None
    missing = [m["label"] or m["key"] for m in maturities if m["yield"] is None]
    no_ref = [HORIZON_WORDS[h] for h in HORIZONS if ref_dates[h] is None]
    behind = day < expected
    stale = behind or check is not None

    notes = [NOTE_WHAT, NOTE_AS_OF.format(day=day, at=read_at or "a time it did not record")]
    if history["points"]:
        notes.append(NOTE_HISTORY_CUT.format(points=history["points"], first=history["from"] or "an unrecorded day",
                                             last=history["to"] or "an unrecorded day"))
    if missing:
        notes.append(NOTE_MISSING.format(n=len(missing), day=day, list=", ".join(missing)))
    if no_ref:
        notes.append(NOTE_NO_REFERENCE.format(list=", ".join(no_ref)))
    if behind:
        notes.append(NOTE_STALE.format(day=day, expected=expected))
    if check is not None:
        notes.append(NOTE_CHECK.format(at=check["at"] or "a time it did not record",
                                       why=CHECK_WORDS.get(check["reason"] or "", CHECK_FAILED)))

    # `as_of` / `ref_dates` / `maturities` / `spreads` / `history` / `rows` / `read_at` / `basis` / `units` /
    # `source` / `check` keep the route's own names (the panel's model reads them)
    units = got.get("units") if isinstance(got.get("units"), dict) else {}
    data = {"as_of": day, "ref_dates": ref_dates, "maturities": maturities, "spreads": spreads, "history": history,
            "rows": _whole(got.get("rows")), "read_at": _read_at(read_at) if read_at else None,
            "basis": got.get("basis") if isinstance(got.get("basis"), str) else None,
            "units": {k: v for k, v in units.items() if isinstance(k, str) and isinstance(v, str)},
            "source": got.get("source") if isinstance(got.get("source"), str) else None, "check": check}
    answered = sum(1 for m in maturities if m["yield"] is not None)
    coverage = {"evaluated": len(maturities), "answered": answered, "dropped": 0,
                "not_computable": len(maturities) - answered}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
