"""MD-1 kind `options.ivRankLeaders` (owner: terminal-data, data wave 11) — the highest and lowest IV rank, as held.

The market-wide IV rank list UCT builds each evening from its own options log: the symbols whose latest at-the-money
implied volatility sits highest (options rich against their own logged year) and lowest (cheap) between its low and its
high over the symbol's own logged sessions (up to 252), with the IV percentile, the ATM IV, its range, the sessions
behind the rank and the open interest; how many symbols were ranked and how many were left out and why; the session read
and when the list was built. The Agent half of OSCR RICH and OSCR CHEAP, over the answer of
`GET /api/options-screener/iv-rank` (`api/services/research/iv_rank_leaders.py`), with the route's own field names (the
IvRank panel's model reads them).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The list is built by ONE evening job the
scheduler starts (`iv_rank_leaders.run_scheduled`, and `catch_up` after a missed evening); the route's read,
`iv_rank_leaders.get_leaders`, never reads the log: it answers from what the module holds (in memory, else its copy on
this server's disk). This adapter calls exactly that read. provider_calls is always 0. A rail shows `run_scheduled`
starting the build in the same state.

THE ROUTE'S SWITCH IS RESPECTED EXACTLY: the route answers 404 unless OPTIONS_SCREENER_ENABLED is on
(`options_screener.is_enabled`, read per call); with it off this read is `unavailable`, never an empty list.

NOTHING HELD IS SAID, NEVER "NO SYMBOL IS RICH": before the first evening build (`not_built`), or when the log held no
session at the last build (`no_log`), the read is `unavailable` with that reason. A symbol under the minimum sessions is
left out and COUNTED (the service's rule), never ranked on fewer sessions.

WHAT IS STATED: every row and count is the service's own (`iv_rank_leaders.build` over `iv_history.rank_of`), passed
through; nothing is recomputed here. Each side returns its first `rows` (the service keeps 100 a side), cut from the
middle of the ranking, with the number ranked beside them. The missing sessions return the newest `MISSING_SHOWN` with
their count.

TIME (MD-1 §3): `as_of` = the regular-session close of the session the list read (`session`: an end-of-day snapshot), in
UTC; never the time of the read. When UCT built it rides as `data.built_at`. The read is `stale`, with a note, when the
list's session is older than the one the last scheduled build should have read (`iv_rank_leaders.target_session`, the
service's own rule) or the last build failed: this read never builds it again. Every read is `historical`; the kind is
DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the implied volatilities come from the market-data vendor's options
chain that UCT logs each evening (docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-28:
the chain, Greeks and IV for display to members, restricted; row T-14: the vendor's numbers into a model, restricted).
No row clears these figures for a model provider. The same rule as `options.ivHistory`. Shown to the member only; the
capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import close_as_of

KIND = "options.ivRankLeaders"
SOURCE = "uct-options-log"
SIDES = ("high", "low", "both")
DEFAULT_SIDE = "both"
DEFAULT_ROWS = 10
MAX_ROWS = 100                 # iv_rank_leaders.MAX_PER_SIDE (a rail pins the two together)
MISSING_SHOWN = 10
#: one row, by the service's own names (iv_rank_leaders.build)
ROW_FIELDS = ("symbol", "atm_iv", "iv_rank", "iv_percentile", "rank_word", "low", "high", "sessions", "atm_dte", "open_interest")
#: the counts, by the service's own names (iv_rank_leaders._counts)
COUNT_FIELDS = ("ranked", "below_min", "flat", "not_in_latest", "latest_rows", "latest_no_atm_iv", "symbols_logged",
                "implausible_iv", "iv_above_watch")   # the last two: readings under iv_history.IV_FLOOR (never points) / above IV_WATCH
SIDE_WORDS = {"high": "highest", "low": "lowest"}

NOTE_WHAT = ("the IV rank list UCT built from its own options log for OSCR RICH and OSCR CHEAP: each symbol's latest "
             "at-the-money implied volatility placed between its lowest and highest over its own logged sessions (up to "
             "{window}), from 0 to 100, with the IV percentile. A symbol needs {min} logged sessions to be ranked. An "
             "end-of-day snapshot and a record of the past, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the close of the session the list read ({day}, an end-of-day snapshot); it is never the time "
              "of the read. UCT built it at {at} (UCT's own time) from the log it already held")
NOTE_NO_SESSION = "`as_of` is null: the held list names no session, so it carries no date"
NOTE_RANKED = ("{ranked} symbols are ranked; left out and counted: {below} with fewer than {min} logged sessions, {flat} "
               "whose ATM IV never moved (no rank), {stale} not in the latest session")
NOTE_CUT = "{ranked} symbols are ranked and the {shown} {side} are returned: the list is cut from the middle of the ranking"
NOTE_MISSING = ("{n} trading sessions since the log began were not logged (the newest {shown} are returned); a missed day "
                "is a gap, never filled in")
NOTE_BEHIND = ("the list read the session of {session}; the last scheduled build should have read {target}, and this read "
               "never builds it again")
NOTE_LAST_FAILED = "the last build could not read the options log, so this is the list before it"
NOTE_SWITCHED_OFF = ("the option screener is switched off on this server (its routes answer nothing), so the IV rank list "
                     "is not read. That is not the same as no rich or cheap options")
NOTE_NOT_BUILT = ("the IV rank list is built each evening from UCT's own options log, and no evening has built it on this "
                  "server yet{building}. This read never builds it. That is not the same as no rich or cheap options")
NOTE_NO_LOG = ("the options log held no session at the last evening build, so no symbol is ranked. That is not the same "
               "as no rich or cheap options")
NOTE_FAILED = "the IV rank list read failed; nothing is stated. That is not the same as no rich or cheap options"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if params.get("side", DEFAULT_SIDE) not in SIDES:
        return "`side` must be high, low or both"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def switched_on() -> bool:
    """The route's own switch (`options_screener.is_enabled`, read per call)."""
    from api.services.research import options_screener
    return options_screener.is_enabled()


def held_answer() -> tuple[Optional[dict], str]:
    """READ ONLY: (the held list, 'held' | 'not_built' | 'no_log'), WITHOUT building or reading the log
    (`iv_rank_leaders.get_leaders`)."""
    from api.services.research import iv_rank_leaders as svc
    got = svc.get_leaders()
    status = got.get("status") if isinstance(got, dict) else None
    if status == "ok":
        return got, "held"
    return got, status if status in ("not_built", "no_log") else "not_built"


def target_session() -> Optional[str]:
    """The session the last scheduled build should have read (`iv_rank_leaders.target_session`: pure, the calendar)."""
    from api.services.research import iv_rank_leaders as svc
    return svc.target_session()


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not isinstance(r.get("symbol"), str) or _num(r.get("iv_rank")) is None:
        return None
    out = {}
    for f in ROW_FIELDS:
        v = r.get(f)
        out[f] = (v[:12] if isinstance(v, str) else None) if f in ("symbol", "rank_word") else (
            _whole(v) if f in ("sessions", "atm_dte", "open_interest") else _num(v))
    return out


def read_leaders(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    side, limit = params.get("side", DEFAULT_SIDE), params.get("rows", DEFAULT_ROWS)
    try:
        if not switched_on():
            return env.unavailable(KIND, params, SOURCE, NOTE_SWITCHED_OFF)
        got, how = held_answer()
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "not_built":
        building = isinstance(got, dict) and got.get("building") is True
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_BUILT.format(building=" (the first build is running now)" if building else ""))
    if how == "no_log":
        return env.unavailable(KIND, params, SOURCE, NOTE_NO_LOG)
    try:
        return _answer(params, got, side, limit)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, got: dict, side: str, limit: int) -> dict:
    session, built_at = _day(got.get("session")), _read_at(got.get("built_at"))
    counts = {k: _whole((got.get("counts") or {}).get(k)) or 0 for k in COUNT_FIELDS}
    lists = {s: [x for x in (_row(r) for r in (got.get(s) or [])) if x] for s in ("high", "low")}
    shown = {s: (lists[s][:limit] if side in (s, "both") else []) for s in ("high", "low")}
    missing = [d for d in (_day(x) for x in (got.get("missing_sessions") or [])) if d]
    last_run = got.get("last_run") if isinstance(got.get("last_run"), dict) else None
    min_sessions = _whole(got.get("rank_min_sessions")) or 20
    notes = [NOTE_WHAT.format(window=_whole(got.get("rank_window")) or 252, min=min_sessions),
             NOTE_AS_OF.format(day=session, at=built_at or "a time it does not give") if session else NOTE_NO_SESSION,
             NOTE_RANKED.format(ranked=counts["ranked"], below=counts["below_min"], min=min_sessions, flat=counts["flat"],
                                stale=counts["not_in_latest"])]
    for s in ("high", "low"):
        if side in (s, "both") and counts["ranked"] > len(shown[s]):
            notes.append(NOTE_CUT.format(ranked=counts["ranked"], shown=len(shown[s]), side=SIDE_WORDS[s]))
    if missing:
        notes.append(NOTE_MISSING.format(n=len(missing), shown=min(len(missing), MISSING_SHOWN)))
    stale_for = []
    target = target_session()
    if session and target and session < target:
        stale_for.append("behind")
        notes.append(NOTE_BEHIND.format(session=session, target=target))
    if last_run and last_run.get("ok") is False:
        stale_for.append("last_build_failed")
        notes.append(NOTE_LAST_FAILED)
    data = {"side": side, "session": session, "built_at": built_at, "data_basis": "end-of-day snapshot",
            "logging_began": _day(got.get("logging_began")), "sessions_logged": _whole(got.get("sessions_logged")),
            "rankable_sessions": _whole(got.get("rankable_sessions")),
            "legacy_sessions": [d for d in (_day(x) for x in (got.get("legacy_sessions") or [])) if d][-MISSING_SHOWN:],
            "unread_sessions": [d for d in (_day(x) for x in (got.get("unread_sessions") or [])) if d][-MISSING_SHOWN:],
            "missing_sessions": missing[-MISSING_SHOWN:], "missing_total": len(missing),
            "counts": counts, "high": shown["high"], "low": shown["low"], "rank_min_sessions": min_sessions,
            "rank_window": _whole(got.get("rank_window")), "max_per_side": _whole(got.get("max_per_side")),
            "next_run": got.get("next_run") if isinstance(got.get("next_run"), str) else None,
            "last_run": {"ok": last_run.get("ok") is True, "at": _read_at(last_run.get("at"))} if last_run else None,
            "stale_for": stale_for}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=close_as_of(session), source=SOURCE,
                             data=data, stale=bool(stale_for),
                             coverage={"evaluated": counts["symbols_logged"], "answered": counts["ranked"], "dropped": 0,
                                       "not_computable": max(0, counts["symbols_logged"] - counts["ranked"])},
                             notes=notes, provider_calls=0)
