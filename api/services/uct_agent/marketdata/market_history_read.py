"""MD-1 kind `market.history` (owner: terminal-data, data wave 13) — the S&P 500's or the Nasdaq-100's corrections and bear
markets, the rally after each low and its leaders, as held.

The Agent half of MKTH, over the answer of `GET /api/research/market-history` (`api/services/market_history.py`, the
definitions in `market_history_calc.py`), with the route's own field names: for one index, every decline of 10% or more
on closing prices (a correction to 20%, a bear market past it), newest first, each with its peak, low, depth, sessions
down, the day the peak was regained and the sessions it took, the index 1, 3, 6 and 12 months after the low, and the
stocks that rose most in the 63 sessions after it (with the sector medians); the index's summary line.

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route answers `get_market_history()`, which
STARTS the one background build when a rebuild is due and, with nothing held, waits for its first stage. This adapter
reads `market_history.held_answer()` instead (what the module holds, looked for on disk once; never a build).
provider_calls is always 0. A rail shows the route starting the build in the same state.

A RECORD, NEVER A FORECAST: every figure is what the index did; nothing here says what it will do. A return the store has
not reached yet is null with its reason (never 0); an ongoing decline has no recovery and says how far below its peak the
newest close is. The survivorship note travels with every leaders list, in the service's own words.

NOTHING HELD IS SAID: a held answer still computing its leaders says so; the index not held is `unavailable` with the
service's own words; nothing held is `unavailable`.

TIME (MD-1 §3): `as_of` = the regular close of the newest session the index's closes reach (the data's own date), never
the time of the read; `stale` when the held answer was built for an evening before the newest session's evening (the
service's own `evening_key`). Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the index closes are the index store's daily series (sourced from Yahoo,
rows T-71 and T-72 of docs/terminal-research/09-security-licensing-cost/licensing-register.md, "X"); the stock closes
behind the leaders are the market-data vendor's stored history (row T-04, member display, "R"; row T-09, its storage,
"R"); the episodes and leaders are UCT's analytics over them (row T-11, "R" for that vendor, LA for member display); row
T-14, the vendor's numbers into a model, "R". No row of that register clears these figures for a model provider; the
narrower rule is kept, as the price studies (§4.19) keep it. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import close_as_of

KIND = "market.history"
SOURCE = "uct-market-history"
DEFAULT_ROWS = 8
MAX_ROWS = 40
LEADER_ROWS = 5                                   # leaders per decline returned (the service keeps 25)
SECTOR_ROWS = 3                                   # sector medians per decline returned
INDEXES = ("SPX", "NDX")                          # market_history.INDEXES, in its order (a rail pins it)
INDEX_WORDS = {"spx": "SPX", "sp500": "SPX", "s&p 500": "SPX", "s&p": "SPX", "spy": "SPX",
               "ndx": "NDX", "nasdaq": "NDX", "nasdaq-100": "NDX", "nasdaq 100": "NDX", "nasdaq100": "NDX", "qqq": "NDX"}

NOTE_WHAT = ("{name}'s corrections and bear markets as UCT holds them for the MKTH panel: every decline of {corr}% or more "
             "on closing prices ({bear}% or more is a bear market), newest first, with the rally after each low and the "
             "stocks that led it. A record of what the index did, not a forecast and not advice")
NOTE_DEFINITION = "the definition, in the service's own words: {text}"
NOTE_AS_OF = ("`as_of` is the close of the newest session {name}'s closes reach ({day}); it is never the time of the read, "
              "and this read never builds. UCT built it at {at} (UCT's own time)")
NOTE_STALE = ("the held answer was built for the evening of {built}, before the newest session's evening ({due}); this read "
              "never builds it again")
NOTE_COMPUTING = "the leaders are still being worked out on the server; each decline's leaders say so, and this read never waits"
NOTE_LEADERS_FAILED = "the leaders could not be worked out on the server's last build; the declines stand without them"
NOTE_SURVIVORSHIP = "leaders: {note}"
NOTE_CUT = "{total} declines are held and the newest {shown} are returned: the list is cut from the OLD end"
NOTE_LEADERS_CUT = "each decline's leaders are cut to the first {leaders} of up to {kept} and its sectors to the first {sectors}"
NOTE_INDEX = "the index: {note}"
NOTE_HISTORY_START = "the oldest decline's peak is the first close UCT holds ({day}), so its true peak may be earlier"
NOTE_INDEX_NOT_HELD = "{detail} This read never builds it. That is not the same as no declines"
NOTE_NOT_HELD = ("market history is not held on this server yet, and this read never builds it. That is not the same as no "
                 "declines. Open MKTH in UCT, then ask again")
NOTE_FAILED = "the market history read failed; nothing is stated. That is not the same as no declines"


def index_of(v: Any) -> Optional[str]:
    """The service's index symbol for a member's word (`SPX` by default), or None when it names neither."""
    if v is None:
        return "SPX"
    s = str(v).strip().lower()
    return INDEX_WORDS.get(s) or (s.upper() if s.upper() in INDEXES else None)


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if index_of(params.get("index")) is None:
        return "`index` must be SPX (the S&P 500) or NDX (the Nasdaq-100)"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer() -> tuple[Optional[dict], str]:
    """READ ONLY: (what the service holds, 'held' | 'not_held'), WITHOUT starting a build (`market_history.held_answer`)."""
    from api.services import market_history as svc
    return svc.held_answer()


def evening_now() -> str:
    """The newest session whose evening has begun, by the service's own clock and key (pure: no read)."""
    from api.services import market_history as svc
    return svc.evening_key(svc.now_et())


def _rally(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _whole(r.get("months")) is None:
        return None
    return {"months": _whole(r.get("months")), "date": _day(r.get("date")), "return_pct": _num(r.get("return_pct"))}


def _leaders(ld: Any) -> dict:
    if not isinstance(ld, dict):
        return {"state": "computing"}
    state = ld.get("state") if ld.get("state") in ("ok", "thin", "not_yet", "computing", "failed") else "computing"
    out = {"state": state, "trough": _day(ld.get("trough")), "end": _day(ld.get("end")),
           "index_return_pct": _num(ld.get("index_return_pct")), "priced_both": _whole(ld.get("priced_both")),
           "sessions_so_far": _whole(ld.get("sessions_so_far")), "needed": _whole(ld.get("needed"))}
    top = [t for t in (ld.get("top") or []) if isinstance(t, dict) and isinstance(t.get("sym"), str)]
    out["top"] = [{"sym": t["sym"], "sector": t.get("sector") if isinstance(t.get("sector"), str) else None,
                   "return_pct": _num(t.get("return_pct")), "vs_index_pct": _num(t.get("vs_index_pct")),
                   "check": t.get("check") is True} for t in top[:LEADER_ROWS]]
    out["top_total"] = len(top)
    secs = [s for s in (ld.get("sectors") or []) if isinstance(s, dict) and isinstance(s.get("sector"), str)]
    out["sectors"] = [{"sector": s["sector"], "median_pct": _num(s.get("median_pct")), "count": _whole(s.get("count"))}
                      for s in secs[:SECTOR_ROWS]]
    out["sectors_total"] = len(secs)
    return out


def _episode(e: Any) -> Optional[dict]:
    if not isinstance(e, dict) or not isinstance(e.get("peak"), dict) or not isinstance(e.get("trough"), dict):
        return None
    if not _day(e["peak"].get("date")) or not _day(e["trough"].get("date")):
        return None
    return {"kind": e.get("kind") if e.get("kind") in ("correction", "bear") else None,
            "peak": {"date": e["peak"]["date"], "close": _num(e["peak"].get("close"))},
            "trough": {"date": e["trough"]["date"], "close": _num(e["trough"].get("close"))},
            "depth_pct": _num(e.get("depth_pct")), "sessions_down": _whole(e.get("sessions_down")),
            "recovered": _day(e.get("recovered")), "sessions_to_recover": _whole(e.get("sessions_to_recover")),
            "ongoing": e.get("ongoing") is True, "peak_at_history_start": e.get("peak_at_history_start") is True,
            "below_peak_now_pct": _num(e.get("below_peak_now_pct")),
            "rally": [x for x in (_rally(r) for r in e.get("rally") or []) if x], "leaders": _leaders(e.get("leaders"))}


def read_history(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = index_of(params.get("index"))
    rows = params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer()
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held" or not isinstance(got, dict) or not isinstance(got.get("indexes"), dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    block = got["indexes"].get(sym)
    if not isinstance(block, dict) or block.get("state") != "ok":
        detail = (block or {}).get("detail") if isinstance(block, dict) else None
        return env.unavailable(KIND, params, SOURCE, NOTE_INDEX_NOT_HELD.format(
            detail=detail if isinstance(detail, str) else "UCT does not hold that index's daily closes on this server yet."))
    try:
        return _answer(params, sym, rows, got, block)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, sym: str, rows: int, got: dict, block: dict) -> dict:
    from api.services import market_history_calc as C
    name = block.get("name") if isinstance(block.get("name"), str) else sym
    eps = [x for x in (_episode(e) for e in block.get("episodes") or []) if x]
    shown = eps[:rows]
    last = _day(block.get("last"))
    built_for = _day(got.get("built_for"))
    due = evening_now()
    lead = got.get("leaders") if isinstance(got.get("leaders"), dict) else {}
    lead_state = lead.get("state") if lead.get("state") in ("ok", "computing", "failed", "unavailable") else "computing"
    definition = got.get("definition") if isinstance(got.get("definition"), dict) else {}
    s = block.get("summary") if isinstance(block.get("summary"), dict) else {}
    summary = {"since": _day(s.get("since")), "corrections": _whole(s.get("corrections")),
               "bear_markets": _whole(s.get("bear_markets")), "ongoing": _whole(s.get("ongoing")),
               "recovered": _whole(s.get("recovered")), "median_depth_pct": _num(s.get("median_depth_pct")),
               "median_recovery_sessions": _num(s.get("median_recovery_sessions"))}
    stale = bool(built_for and due and built_for < due)
    notes = [NOTE_WHAT.format(name=name, corr=round(C.CORRECTION_MIN * 100), bear=round(C.BEAR_MIN * 100))]
    notes.append(NOTE_AS_OF.format(name=name, day=last or "a day it does not give",
                                   at=_read_at(got.get("built_at")) or "a time it does not give"))
    if isinstance(definition.get("text"), str):
        notes.append(NOTE_DEFINITION.format(text=definition["text"]))
    if isinstance(got.get("index_note"), str) and sym == "NDX":
        notes.append(NOTE_INDEX.format(note=got["index_note"]))
    if stale:
        notes.append(NOTE_STALE.format(built=built_for, due=due))
    if lead_state == "computing":
        notes.append(NOTE_COMPUTING)
    elif lead_state == "failed":
        notes.append(NOTE_LEADERS_FAILED)
    notes.append(NOTE_SURVIVORSHIP.format(note=C.SURVIVORSHIP_NOTE))
    if any(e["peak_at_history_start"] for e in eps):
        notes.append(NOTE_HISTORY_START.format(day=_day(block.get("first")) or "a day it does not give"))
    if len(eps) > len(shown):
        notes.append(NOTE_CUT.format(total=len(eps), shown=len(shown)))
    if any(e["leaders"]["top_total"] > LEADER_ROWS or e["leaders"]["sectors_total"] > SECTOR_ROWS for e in shown):
        notes.append(NOTE_LEADERS_CUT.format(leaders=LEADER_ROWS, kept=C.LEADERS_TOP, sectors=SECTOR_ROWS))
    data = {"index": sym, "name": name, "first": _day(block.get("first")), "last": last, "closes": _whole(block.get("closes")),
            "summary": summary, "definition": definition.get("text") if isinstance(definition.get("text"), str) else None,
            "episodes": shown, "episodes_total": len(eps), "leaders_state": lead_state,
            "survivorship": C.SURVIVORSHIP_NOTE, "built_for": built_for, "built_at": _read_at(got.get("built_at")),
            "stale_for": ["earlier_evening"] if stale else []}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=close_as_of(last), source=SOURCE,
                             data=data, stale=stale, notes=notes, provider_calls=0)
