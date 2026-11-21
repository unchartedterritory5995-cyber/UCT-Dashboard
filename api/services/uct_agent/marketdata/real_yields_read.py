"""MD-1 kind `rates.realYields` (owner: terminal-data, data wave 9) — US Treasury real yields and breakevens, as held.

The US Treasury's daily par REAL yield curve (TIPS, 5 to 30 years) as UCT holds it: the real yield at each maturity,
what it was one day and one week earlier with the change in basis points, and the breakeven at each maturity (the
nominal yield minus the real yield on the newest day both curves hold, worked out by the server): the Agent half of
the real-yield block of the RATES terminal function, over the `real` block of `GET /api/research/treasury-yields`
(`api/services/treasury_real_yields.py`).

A KIND OF ITS OWN, NOT AN EXTENSION OF `rates.treasury`: the block has its own date, its own held state and its own
staleness (the route sends it as a block with its own status beside the nominal answer). Folded into `rates.treasury`
it would either change what that kind's `as_of`, `stale`, notes and coverage mean, or hide the block's own state; and
`rates.treasury`'s capability text and corpus entries would change. That kind is untouched.

⛔ ONLY THE BLOCK THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `treasury_real_yields.get_real`
STARTS the service's background build (requests to the Treasury's website) when nothing is held or a refresh is due.
A turn must not, so this adapter never calls it. It reads through `treasury_real_yields_held.held_real()`, which
shapes the real figures the service holds and the nominal days `treasury_yields` holds with the service's own
`assemble`, or returns nothing, and never builds. provider_calls is always 0. A rail shows `get_real` starting the
build in the same state.

NOTHING HELD IS SAID, NEVER AN EMPTY CURVE: `not_held` is `unavailable` with that reason.

WHAT IS STATED: every figure is the service's own; nothing is recomputed here. A maturity with no figure on the
curve's day has a null `yield`, never 0; a reference day the service did not find leaves that horizon's `was` and
`change_bp` null, never 0. A breakeven is null when either side is missing, never 0, and carries its own date, which
can be older than the real curve's; a breakeven row dated another day than the block's breakeven day is not carried
as one (the panel's own rule). With no day both curves hold, every breakeven is null and that is said.

TIME (MD-1 §3): `as_of` = the date of the newest real figure (the block's own `as_of`), as the start of that Eastern
day; never today and never the time of the read. The breakevens' own day rides as `data.breakevens.as_of`, and when
the site read the figures as `data.read_at`. The read is `stale`, with a note, when the curve's date is behind by the
nominal read's own rule (older than the weekday before today in New York) or when the last look for newer figures did
not go well: this read never looks. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) has no row for the Treasury's real yield
curve. Row T-95 covers the nominal par yield curve the breakevens are worked out from, as a US Government work shown
on the member's Treasury yields panel, and says nothing else reads it (no AI lane, no export, no external
publication). No row clears these figures for a model provider, and no other row does. Shown to the member only; the
capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _status_code, _whole, day_as_of

KIND = "rates.realYields"
SOURCE = "us-treasury-real-curve"
#: the change horizons, by the service's own keys (treasury_real_yields.HORIZONS; a rail pins the two together)
HORIZONS = ("d1", "w1")
MAX_MATURITIES = 10         # the real curve has five points; a ceiling, so a malformed answer cannot be unbounded
#: the service's words for a look that did not go well (the nominal read's own `check.reason` words)
CHECK_WORDS = {"refused": "the Treasury's website refused the request", "shape": "its answer could not be read as the feed",
               "rate_limited": "the Treasury's website said too many requests", "timeout": "it did not answer in time",
               "source": "the Treasury's website answered with an error", "error": "the read failed"}
CHECK_FAILED = "it did not go well"
HORIZON_WORDS = {"d1": "one day", "w1": "one week"}

NOTE_WHAT = ("US Treasury daily par real yields (Treasury inflation-protected securities) by maturity, as UCT holds "
             "them: each real yield in percent, what it was one day and one week earlier with the change in basis "
             "points, and the breakeven at each maturity (the nominal yield minus the real yield on the newest day both "
             "curves hold, in percent, worked out by UCT's server). End-of-day figures published by the US Treasury, "
             "not live quotes, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the date of the newest real figure ({day}); it is never today and never the time of the "
              "read. UCT read the figures from the Treasury's website at {at} (UCT's own time)")
NOTE_BREAKEVEN_DAY = ("the breakevens are for {day}, the newest day both the nominal and the real curve have a figure, "
                      "which is older than the newest real figure")
NOTE_NO_BREAKEVEN = ("no breakeven is stated: the nominal and the real curve have no day in common in what UCT holds, "
                     "so every breakeven is null, never 0")
NOTE_MISSING = "{n} maturities have no real figure on {day} and are null, never 0: {list}"
NOTE_MISSING_BREAKEVEN = ("{n} maturities have no breakeven on {day} (the nominal or the real figure is missing) and "
                          "are null, never 0: {list}")
NOTE_NO_REFERENCE = "no real figure was found near enough to {list} earlier, so those changes are null, never 0"
NOTE_STALE = ("the newest real figure held is {day}, older than {expected}, the weekday before today in New York. This "
              "read never looks for a newer one: open the Treasury yields panel (RATES) in UCT, then ask again")
NOTE_CHECK = ("UCT's last look for newer real figures, at {at}, did not go well ({why}): the figures held are the last "
              "good ones")
NOTE_NOT_HELD = ("no real yields are held on this server yet, and this read never requests them. That is not the same "
                 "as no figure. Open the Treasury yields panel (RATES) in UCT, then ask again")
NOTE_FAILED = "the real yields read failed; nothing is stated. That is not the same as no figure"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The curve takes no argument."""
    if not isinstance(params, dict):
        return "the request must be an object"
    return None


def held_answer() -> tuple[Optional[dict], str]:
    """READ ONLY: (the block the service already holds, 'held' | 'not_held'), WITHOUT starting a build
    (`treasury_real_yields_held.held_real`)."""
    from api.services import treasury_real_yields_held as svc
    return svc.held_real()


def behind_before() -> str:
    """The nominal read's own "behind" line: a curve dated before this day is behind (treasury_yields.refresh_due)."""
    from api.services import treasury_yields as ty
    return ty.last_weekday_before(ty.now_et().date()).isoformat()


def _by_horizon(v: Any) -> dict:
    v = v if isinstance(v, dict) else {}
    return {h: _num(v.get(h)) for h in HORIZONS}


def _text(v: Any) -> Optional[str]:
    return v if isinstance(v, str) and v else None


def _maturity(m: Any) -> Optional[dict]:
    if not isinstance(m, dict) or not isinstance(m.get("key"), str) or not m["key"]:
        return None
    return {"key": m["key"], "label": _text(m.get("label")), "months": _whole(m.get("months")),
            "yield": _num(m.get("yield")),                                  # no figure: null, never 0
            "was": _by_horizon(m.get("was")), "change_bp": _by_horizon(m.get("change_bp"))}


def _breakeven(r: Any, day: Optional[str]) -> Optional[dict]:
    if not isinstance(r, dict) or not isinstance(r.get("key"), str) or not r["key"]:
        return None
    dated = day is not None and _day(r.get("date")) == day           # a row for another day is not a breakeven of this one
    return {"key": r["key"], "label": _text(r.get("label")), "months": _whole(r.get("months")), "date": day if dated else None,
            "nominal": _num(r.get("nominal")) if dated else None, "real": _num(r.get("real")) if dated else None,
            "value": _num(r.get("value")) if dated else None}


def _check(c: Any) -> Optional[dict]:
    if not isinstance(c, dict):
        return None
    return {"state": _text(c.get("state")), "reason": _text(c.get("reason")), "http_status": _status_code(c.get("http_status")),
            "at": _text(c.get("at"))}


def read_real(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    try:
        got, how = held_answer()                               # the held block only: never a build
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
    raw_be = got.get("breakevens") if isinstance(got.get("breakevens"), dict) else {}
    be_day = _day(raw_be.get("as_of"))
    breakevens = [x for x in (_breakeven(r, be_day) for r in raw_be.get("rows") or []) if x][:MAX_MATURITIES]
    refs = got.get("ref_dates") if isinstance(got.get("ref_dates"), dict) else {}
    ref_dates = {h: _day(refs.get(h)) for h in HORIZONS}
    check = _check(got.get("check"))
    read_at = _text(got.get("read_at"))
    missing = [m["label"] or m["key"] for m in maturities if m["yield"] is None]
    no_breakeven = [r["label"] or r["key"] for r in breakevens if r["value"] is None]
    no_ref = [HORIZON_WORDS[h] for h in HORIZONS if ref_dates[h] is None]
    behind = day < expected
    stale = behind or check is not None

    notes = [NOTE_WHAT, NOTE_AS_OF.format(day=day, at=read_at or "a time it did not record")]
    if be_day is None:
        notes.append(NOTE_NO_BREAKEVEN)
    else:
        if be_day != day:
            notes.append(NOTE_BREAKEVEN_DAY.format(day=be_day))
        if no_breakeven:
            notes.append(NOTE_MISSING_BREAKEVEN.format(n=len(no_breakeven), day=be_day, list=", ".join(no_breakeven)))
    if missing:
        notes.append(NOTE_MISSING.format(n=len(missing), day=day, list=", ".join(missing)))
    if no_ref:
        notes.append(NOTE_NO_REFERENCE.format(list=", ".join(no_ref)))
    if behind:
        notes.append(NOTE_STALE.format(day=day, expected=expected))
    if check is not None:
        notes.append(NOTE_CHECK.format(at=check["at"] or "a time it did not record",
                                       why=CHECK_WORDS.get(check["reason"] or "", CHECK_FAILED)))

    # `as_of` / `ref_dates` / `maturities` / `breakevens` / `rows` / `read_at` / `basis` / `source` / `check` keep the
    # route's own names (the panel's model reads them)
    data = {"as_of": day, "ref_dates": ref_dates, "maturities": maturities,
            "breakevens": {"as_of": be_day, "rows": breakevens}, "rows": _whole(got.get("rows")),
            "read_at": _read_at(read_at) if read_at else None,
            "basis": got.get("basis") if isinstance(got.get("basis"), str) else None,
            "source": got.get("source") if isinstance(got.get("source"), str) else None, "check": check}
    answered = sum(1 for m in maturities if m["yield"] is not None)
    coverage = {"evaluated": len(maturities), "answered": answered, "dropped": 0,
                "not_computable": len(maturities) - answered}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
