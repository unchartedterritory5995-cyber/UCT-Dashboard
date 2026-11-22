"""MD-1 kind `options.ivHistory` (owner: terminal-data, data wave 7) — one stock's implied volatility history.

One stock's at-the-money implied volatility by session, from UCT's own options log as mirrored on this server: each
session's ATM IV with the days to expiry it was read at, the day the log began, how many sessions it holds, and the
IV rank and percentile when enough sessions are logged: the Agent half of the IVH terminal function, over the answer
of `GET /api/research/iv-history/{sym}` (`api/services/research/iv_history.py`).

⛔ ONLY THE SESSIONS ALREADY ON THIS SERVER'S DISK, NEVER A DOWNLOAD (MD-1 §5). The route reads through the
service's production store, which LISTS the log in remote storage and downloads any session file it does not have.
A turn must not, so this adapter gives the service a plain local store over the same directory
(`LocalStore(get_store().root)`): the files a member's visit to the panel already mirrored, and nothing else.
provider_calls is always 0. A rail shows the production store reaching remote storage in the same state.

THE SWITCH IS THE ROUTE'S: while `IV_HISTORY_ENABLED` is not on, the route answers 404 and this read is
`unavailable` with that reason. No session on this server's disk is `unavailable` too, and so is a stock with no ATM
IV in any session held: neither is "no implied volatility".

THE RANK RULE IS THE SERVICE'S: under `RANK_MIN_SESSIONS` ranked sessions the rank is null and `data.rank_note`
carries the service's own sentence; nothing is ranked here. A session with no ATM IV has a null `atm_iv`, never 0.

THE CUT IS STATED: at most `rows` sessions are returned, newest first; a longer history is cut from the OLD end and
the note says so. The rank is the service's, over its own window, whatever the cut.

TIME (MD-1 §3): `as_of` = the newest session that has an ATM IV for the stock, as the start of that Eastern day;
never today as such and never the time of the read. The read is `stale`, with a note, when that session is older
than the newest completed session: a newer session may be logged and not mirrored here. Every read is `historical`;
the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-28 covers the vendor's options
chain, Greeks and IV for display to members, restricted, and row T-14 is the vendor's numbers into a model,
restricted. Neither clears these figures for a model provider, and no other row does. Shown to the member only; the
capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import sessions
from api.services.uct_agent.marketdata.bars_daily import _SYMBOL_RE
from api.services.uct_agent.marketdata.short_interest import _day, _num, _whole, day_as_of

KIND = "options.ivHistory"
SOURCE = "uct-options-log"
DEFAULT_ROWS = 20
MAX_ROWS = 60
MAX_REASONS = 5
MAX_REASON_CHARS = 240
RANK_KEYS = ("current", "iv_rank", "iv_percentile", "low", "high")

NOTE_WHAT = ("{symbol}'s at-the-money implied volatility by session, from UCT's own options log as held on this "
             "server: the mean of the call and the put implied volatility at the strike closest to the stock, on "
             "the expiry closest to 30 days out, as a fraction (0.30 is 30%), with the days to expiry it was read "
             "at. Recorded once a day after the close: not a live figure, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the newest session with an ATM IV for {symbol} ({day}); it is never the time of the read. "
              "The log began on {began} and {sessions} of its sessions are on this server")
NOTE_CUT = ("{total} sessions are held for {symbol} and the newest {shown} are returned, newest first: the history "
            "is cut from the OLD end. The rank is over the service's own window, not over the rows returned")
NOTE_NO_RANK = ("no IV rank is stated: {why} The rank is null, never 0")
NOTE_MISSING = ("{n} of the sessions returned have no ATM IV for {symbol} and that figure is null, never 0")
NOTE_PARTIAL = ("the service marks this history partial: {reasons}")
NOTE_STALE = ("the newest session held for {symbol} is {day}, older than the newest completed session "
              "({expected}). A newer session may be logged and not mirrored on this server: this read never "
              "downloads one. Open the IV history panel (IVH) in UCT, then ask again")
NOTE_OFF = ("the IV history is switched off on this server (IV_HISTORY_ENABLED is not on), so nothing is read. "
            "That is not the same as no implied volatility")
NOTE_NOT_HELD = ("no session of UCT's options log is on this server's disk, and this read never downloads one. "
                 "That is not the same as no implied volatility. Open the IV history panel (IVH) in UCT, then ask "
                 "again")
NOTE_NOT_IN_LOG = ("the {sessions} sessions of UCT's options log on this server hold no ATM IV for {symbol}. That "
                   "is not the same as no implied volatility: the stock may have no listed options, or its "
                   "sessions may not be mirrored here")
NOTE_FAILED = "the IV history read failed; nothing is stated. That is not the same as no implied volatility"


def _clean(v: Any) -> Optional[str]:
    s = v.strip().upper().lstrip("$") if isinstance(v, str) else ""
    return s if s and _SYMBOL_RE.match(s) else None


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """(the service's answer over the sessions on this server's disk, 'held') or (None, 'off') while the route's
    own switch is off. READ ONLY: a plain local store over the service's own directory, so nothing is listed in or
    downloaded from remote storage (the production store does both on a read)."""
    from api.services.research import iv_history as svc
    if not svc.is_enabled():
        return None, "off"
    local = svc.LocalStore(svc.get_store().root)
    return svc.iv_history(sym, store=local), "held"


def _point(p: Any) -> Optional[dict]:
    if not isinstance(p, dict) or _day(p.get("date")) is None:
        return None
    return {"date": _day(p["date"]), "atm_iv": _num(p.get("atm_iv")),              # no ATM IV: null, never 0
            "atm_dte": _whole(p.get("atm_dte")), "atm_expiration": _day(p.get("atm_expiration")),
            "rule": p.get("rule") if isinstance(p.get("rule"), str) else None, "complete": p.get("complete") is True}


def _rank(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _num(r.get("current")) is None:
        return None
    return {**{k: _num(r.get(k)) for k in RANK_KEYS}, "window_sessions": _whole(r.get("window_sessions"))}


def read_iv_history(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, limit = _clean(params["symbol"]), params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer(sym)                            # the sessions on this server's disk only
        expected = sessions.last_completed_session()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no implied volatility"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "off":
        return env.unavailable(KIND, params, SOURCE, NOTE_OFF)
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    status, logged = got.get("status"), _whole(got.get("sessions_logged"))
    if status == "no_log":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if status == "not_in_log":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_IN_LOG.format(sessions=logged or 0, symbol=sym))
    points = [x for x in (_point(p) for p in got.get("points") or []) if x] if status == "ok" else []
    with_iv = [p for p in points if p["atm_iv"] is not None]
    if not with_iv or logged is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    points.sort(key=lambda p: p["date"], reverse=True)                     # newest first
    day = max(p["date"] for p in with_iv)
    total, shown = len(points), points[:limit]
    rank = _rank(got.get("rank"))
    rank_note = got.get("rank_note") if isinstance(got.get("rank_note"), str) and got["rank_note"] else None
    reasons = [r.strip()[:MAX_REASON_CHARS] for r in got.get("partial_reasons") or [] if isinstance(r, str) and r.strip()]
    missing = [d for d in got.get("missing_sessions") or [] if _day(d)]
    expected_day = f"{expected // 10000:04d}-{expected // 100 % 100:02d}-{expected % 100:02d}"
    stale = day < expected_day
    no_iv = sum(1 for p in shown if p["atm_iv"] is None)

    notes = [NOTE_WHAT.format(symbol=sym),
             NOTE_AS_OF.format(symbol=sym, day=day, began=_day(got.get("logging_began")) or "a day it did not record",
                               sessions=logged)]
    if total > len(shown):
        notes.append(NOTE_CUT.format(total=total, symbol=sym, shown=len(shown)))
    if rank is None:
        notes.append(NOTE_NO_RANK.format(why=rank_note or "the service gave no rank."))
    if no_iv:
        notes.append(NOTE_MISSING.format(n=no_iv, symbol=sym))
    if reasons:
        notes.append(NOTE_PARTIAL.format(reasons=" ".join(reasons[:MAX_REASONS])))
    if stale:
        notes.append(NOTE_STALE.format(symbol=sym, day=day, expected=expected_day))

    data = {"symbol": sym, "rows": shown, "count": len(shown), "total": total, "cut": total > len(shown),
            "as_of": day, "logging_began": _day(got.get("logging_began")), "covers_from": _day(got.get("covers_from")),
            "covers_to": _day(got.get("covers_to")), "sessions_logged": logged, "sessions_with_iv": len(with_iv),
            "missing_sessions": len(missing), "rank": rank, "rank_note": rank_note,
            "rank_min_sessions": _whole(got.get("rank_min_sessions")), "partial": got.get("partial") is True,
            "partial_reasons": reasons[:MAX_REASONS], "expected_session": expected_day,
            "source": got.get("source") if isinstance(got.get("source"), str) else None}
    coverage = {"evaluated": total, "answered": len(shown) - no_iv, "dropped": total - len(shown), "not_computable": no_iv}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
