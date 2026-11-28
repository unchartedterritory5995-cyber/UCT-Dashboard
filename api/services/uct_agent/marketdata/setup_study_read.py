"""MD-1 kind `market.setupStudy` (owner: terminal-data, data wave 14) — how chart setups acted across the market, as held.

The SETH study's market view: for each setup of a fixed library (breakouts, pullbacks, gaps, reclaims, tight weeks, pocket
pivots), how it did across UCT's stock universe in each phase of the S&P 500 (in a correction, in the months after a low,
later in an uptrend, and all together), at 5, 20 and 60 trading days: the signals counted, the win rate, the average and
median move, and the same day's baseline. The Agent half of the bare SETH terminal function, over the answer of
`GET /api/research/setup-history` (`api/services/setup_history.py`), with the service's own field names. One stock's setup
signals are `stock.setupHistory`'s.

⛔ ONLY THE STUDY THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route reads the study through `get_study()`,
which starts the weekly build when it is due. This adapter reads `setup_history.held_study()` only (the hold's `peek()`,
never a build). provider_calls is always 0.

A NUMBER THAT DOES NOT EXIST IS NULL, NEVER 0: a horizon below the study's minimum signal count keeps its count and has
null figures (`below_floor`); a setup the build capped keeps its own sentence and no figures.

THE PHASE IS ASSIGNED WITH HINDSIGHT, and the study's own sentence says so on every read.

TIME (MD-1 §3): `as_of` is the newest session the study's prices reach, as the start of that Eastern day; when UCT built it
rides as `data.built_at`; never the time of the read. Every read is `historical`; the kind is declared `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): a study worked out from stored daily prices, as `stock.setupHistory` is;
the licensing register (docs/terminal-research/09-security-licensing-cost/licensing-register.md) rows T-04 and T-09 cover
the prices for member display and storage, restricted, and row T-14 is the vendor's numbers into a model, restricted. No row
clears these figures for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole, day_as_of

KIND = "market.setupStudy"
SOURCE = "uct-setup-study"
PHASES = ("correction", "after_low", "uptrend", "all")        # setup_history_calc phases, as the SETH panel lists them
HORIZONS = ("5", "20", "60")
MAX_SETUPS = 20

NOTE_WHAT = ("how each setup of UCT's fixed library acted across its stock universe ({universe}), in each phase of the "
             "S&P 500 and in all phases together, at 5, 20 and 60 trading days, beside the same day's baseline: a record "
             "of what followed, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the newest session the study's prices reach ({day}); UCT built the study at {built}, never the "
              "time of the read. Window: {window}")
NOTE_HINDSIGHT = "{hindsight}"
NOTE_FLOOR = "{n} horizons have fewer than {min} signals: their figures are null, never 0, and only the count is given"
NOTE_CAPPED = "{n} setups fired too often for the build to store and have no figures: {names}"
NOTE_NOT_HELD = ("the setup study is not held on this server yet (it is built once a week, outside trading hours), and this "
                 "read never builds it. That is not the same as no record. Open SETH in UCT, then ask again")
NOTE_FAILED = "the setup study read failed; nothing is stated. That is not the same as no record"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if params.get("phase") is not None and params["phase"] not in PHASES:
        return f"`phase` must be one of {', '.join(PHASES)}, or null for all four"
    return None


def held_answer() -> Optional[dict]:
    """READ ONLY: the study the service holds when it is this library's, else None. Never builds."""
    from api.services import setup_history as svc
    got = svc.held_study()
    return got if isinstance(got, dict) and svc._valid_study(got) else None


def _horizon(h: Any) -> dict:
    h = h if isinstance(h, dict) else {}
    s = h.get("strategy") if isinstance(h.get("strategy"), dict) else {}
    b = h.get("baseline") if isinstance(h.get("baseline"), dict) else {}
    below = h.get("below_floor") is True
    return {"n": _whole(h.get("n")), "below_floor": below,
            "win_rate": None if below else _num(s.get("win_rate")), "avg_pct": None if below else _num(s.get("avg_pct")),
            "median_pct": None if below else _num(s.get("median_pct")),
            "baseline_win_rate": None if below else _num(b.get("win_rate")),
            "baseline_avg_pct": None if below else _num(b.get("avg_pct"))}


def _setup(s: Any, phases: tuple) -> Optional[dict]:
    if not isinstance(s, dict) or not isinstance(s.get("id"), str) or not isinstance(s.get("name"), str):
        return None
    groups = []
    for g in s.get("groups") or []:
        if isinstance(g, dict) and g.get("phase") in phases:
            hz = g.get("horizons") if isinstance(g.get("horizons"), dict) else {}
            groups.append({"phase": g["phase"], "words": g.get("words") if isinstance(g.get("words"), str) else None,
                           "signals": _whole(g.get("signals")), "horizons": {k: _horizon(hz.get(k)) for k in HORIZONS}})
    groups.sort(key=lambda g: PHASES.index(g["phase"]))
    return {"id": s["id"], "name": s["name"], "words": s.get("words") if isinstance(s.get("words"), str) else None,
            "state": "capped" if s.get("state") == "capped" else "ok", "signals": _whole(s.get("signals")),
            "detail": s.get("detail") if isinstance(s.get("detail"), str) else None, "groups": groups}


def read_setup_study(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    phases = (params["phase"],) if params.get("phase") else PHASES
    try:
        got = held_answer()
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    setups = [x for x in (_setup(s, phases) for s in got.get("setups") or []) if x][:MAX_SETUPS]
    day = _day(got.get("data_through"))
    if not setups or day is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    u = got.get("universe") if isinstance(got.get("universe"), dict) else {}
    w = got.get("window") if isinstance(got.get("window"), dict) else {}
    method = got.get("method") if isinstance(got.get("method"), dict) else {}
    ph = got.get("phases") if isinstance(got.get("phases"), dict) else {}
    hindsight = method.get("phase") if isinstance(method.get("phase"), str) else ph.get("hindsight")
    min_signals = _whole(got.get("min_signals"))
    built = _read_at(got.get("built_at"))
    window = f"signals from {_day(w.get('from')) or 'a day it did not record'}, {_whole(w.get('years')) or '?'} years"
    notes = [NOTE_WHAT.format(universe=u.get("name") if isinstance(u.get("name"), str) else "UCT's stock universe"),
             NOTE_AS_OF.format(day=day, built=built or "a time it did not record", window=window)]
    if isinstance(hindsight, str) and hindsight:
        notes.append(NOTE_HINDSIGHT.format(hindsight=hindsight))
    floor = sum(1 for s in setups for g in s["groups"] for h in g["horizons"].values() if h["below_floor"])
    if floor:
        notes.append(NOTE_FLOOR.format(n=floor, min=min_signals or "the study's minimum"))
    capped = [s["name"] for s in setups if s["state"] == "capped"]
    if capped:
        notes.append(NOTE_CAPPED.format(n=len(capped), names=", ".join(capped)))
    data = {"setups": setups, "count": len(setups), "phases": list(phases), "horizons": list(HORIZONS),
            "min_signals": min_signals, "data_through": day, "built_at": built,
            "window": {"from": _day(w.get("from")), "to": _day(w.get("to")), "years": _whole(w.get("years"))},
            "universe": {"name": u.get("name") if isinstance(u.get("name"), str) else None,
                         "symbols_read": _whole(u.get("symbols_read"))},
            "index_phases": {"index": ph.get("index") if isinstance(ph.get("index"), str) else None,
                             "episodes": _whole(ph.get("episodes"))}}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, notes=notes, provider_calls=0)
