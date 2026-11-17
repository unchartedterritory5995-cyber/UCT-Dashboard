"""MD-1 kind `highsLows.yearly` (owner: terminal-data, data wave 2) — stocks at new 52-week highs and new 52-week lows.

The names behind the Breadth Monitor's new 52-week high and low counts: the Agent half of the H52 terminal panel
(app/src/pages/terminal/panels/highs52Model.js). A thin adapter over the reads its member routes make:
  * `breadth_live.live_drill(list)`              `GET /api/breadth-monitor/live/drill/{list}` (the session under way)
  * `breadth_monitor.get_drill_list(date, list)` `GET /api/breadth-monitor/{date}/drill/{list}` (a finished session),
    with `fill_drill_volumes`, as that route does
`list` is the Monitor's own drill key (`LISTS`, the panel's `HIGHS52_SIDES[side].list`; a rail reads both files).

WHICH LISTS (the panel's own rule, `highs52Mode`, decided from the same three words the Monitor's live row is gated on)
  * session under way (`session_live`, not `superseded`, not `degraded`) → the lists of the session: mode `live`;
  * otherwise → the stored lists of the newest finished session: mode `settled`, with why (`finished` | `thin` |
    `closed` | `no_read`).
  This is the 52-week measure, never `highsLows.session` (new highs and lows of the DAY, a different kind).

⛔ NEVER COMPUTES (MD-1 §5). The member route `GET /api/breadth-monitor/live` builds the breadth read when its cache is
cold: one whole-market snapshot scored against the universe, 12-16 seconds. This adapter reads it with
`compute_live(cached_only=True)`, the service's own non-building read (the breadth chart serve uses it): a warm read
or nothing. With no warm read it gives the newest stored session and says so (`no_read`). The route's
`warm_bars_async` side effect is not repeated here (MD-1 §6.2: no side effects). provider_calls is always 0.

TIME (MD-1 §3)
  * `live`: `as_of` = the market snapshot's own observation time (`data_as_of`) when the vendor stamped it; UCT's
    computation time (`as_of` in the payload) is never `as_of` and rides as `data.computed_at`. No vendor stamp →
    `as_of` null with a note. freshness `periodic` (recomputed about once a minute); `stale` after STALE_AFTER_S.
  * `settled`: `as_of` = that session's close; freshness `historical`; `stale` when the stored session is older than
    the last completed session.

A FAILURE IS NEVER AN EMPTY LIST: a list the service cannot give (`ok: false`, a stored session without it, a raise)
is "not given" for that side (`partial`), and `unavailable` when no side asked for can be given. An empty list from a
healthy read is `ok` with a note.

MODEL-ISOLATED (ADR-005; breadth contract rule 8): which names are on a list is UCT-derived breadth output over UCT's
own universe, the same class as `breadth.current`. Shown to the member only; the reading capability is local-only.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "highsLows.yearly"
SOURCE = "uct-breadth-monitor"
SIDES = ("both", "highs", "lows")
#: side → the Monitor's own drill key
LISTS = {"highs": "new_52w_highs_list", "lows": "new_52w_lows_list"}
DEFAULT_LIMIT = 25
MAX_LIMIT = 50
STALE_AFTER_S = 300                     # breadth's own intraday rule (`breadth.current`: current for 300 s)
HISTORY_ROWS = 11                       # the live route's own read (`_live_payload`), so its 5-minute cache is shared
#: an item's fields, by the drill routes' own names: ticker, price, change vs the prior close (%), volume against its
#: 20-day average, shares, company name. Anything else in an item is dropped.
ITEM_FIELDS = ("t", "c", "pct", "vr", "v", "n")
WHYS = ("finished", "thin", "closed", "no_read")
_ET = ZoneInfo("America/New_York")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTE_WHAT = ("the names behind the Breadth Monitor's new 52-week high and new 52-week low counts, from UCT's own "
             "stock universe (not every listed stock); 52-week highs and lows, not highs and lows of the day")
NOTE_LIVE = ("lists of the session under way ({date}), from the breadth read UCT computed at {at}; as_of is the market "
             "snapshot's own observation time. Recomputed about once a minute: not a live feed")
NOTE_LIVE_NO_TIME = ("lists of the session under way ({date}), from the breadth read UCT computed at {at} (UCT's time; "
                     "the market snapshot's observation time is not carried), so as_of is not given: not a live feed")
NOTE_SETTLED = "the stored lists of the finished session {date}; as_of is that session's close"
NOTE_FINISHED = "today's session has finished and its lists are stored"
NOTE_THIN = ("the breadth read of the session under way covers too few stocks to trust, so the last finished session "
             "is given instead")
NOTE_CLOSED = "the market is not in session, so the last finished session is given"
NOTE_NO_READ = ("no current breadth read is held in the server's cache (this read never starts one), so the last "
                "finished session is given instead; a session may be under way")
NOTE_BASIS = ("the session's counts use the exchange convention: a trade above the prior 52-week high (or below the "
              "prior 52-week low), not only a close")
NOTE_STALE_LIVE = "the breadth read behind these lists is more than five minutes old, so newer highs and lows may be missing"
NOTE_STALE_SETTLED = ("the newest stored session is {date}, older than the last completed session ({session}), so "
                      "these are not the latest lists")
NOTE_SIDE_MISSING = "the new 52-week {side} list could not be read for this session; that is not the same as an empty list"
NOTE_EMPTY = "no stock is on the new 52-week {side} list for this session; that is a healthy answer, not a failed read"
NOTE_CUT = "showing the first {n} of {total} names on the new 52-week {side} list, in the list's own order"
NOTE_NOTHING = ("no 52-week list is available: no current breadth read is held in the server's cache and no finished "
                "session is stored")
NOTE_UNAVAILABLE = ("the 52-week lists asked for could not be read for the session {date}; that is not the same as no "
                    "new highs or lows")
NOTE_FAILED = "the 52-week high and low lists could not be read"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    if params.get("side", "both") not in SIDES:
        return "`side` must be one of " + ", ".join(SIDES)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _day(v: Any) -> Optional[str]:
    s = str(v or "")[:10]
    return s if _ISO_DAY.match(s) else None


def _parse(ts: Any) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(ts))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=_ET)       # the breadth read stamps Eastern time


def _items(raw: Any) -> Optional[list]:
    if not isinstance(raw, list):
        return None
    return [{k: it.get(k) for k in ITEM_FIELDS} for it in raw if isinstance(it, dict) and str(it.get("t") or "").strip()]


def _live_list(bl, key: str) -> Optional[list]:
    try:
        got = bl.live_drill(key)
    except Exception:  # noqa: BLE001 — a list that cannot be read is "not given", never empty
        return None
    return _items(got.get("items")) if isinstance(got, dict) and got.get("ok") is True else None


def _stored_list(svc, day: str, key: str) -> Optional[list]:
    try:
        raw = svc.get_drill_list(day, key)
        if not isinstance(raw, list):
            return None
        filled = svc.fill_drill_volumes(day, raw)          # the stored rows carry no shares: the route fills them
    except Exception:  # noqa: BLE001
        return None
    return _items(filled if isinstance(filled, list) else raw)


def read_yearly_highs_lows(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    side = params.get("side", "both")
    limit = params.get("limit", DEFAULT_LIMIT)
    asked = [s for s in ("highs", "lows") if side in ("both", s)]
    try:
        from api.services import breadth_live as bl
        from api.services import breadth_monitor as svc
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never a guess
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    try:
        status = bl.compute_live(cached_only=True)         # a warm read or a not-ok answer: it never computes
    except Exception:  # noqa: BLE001
        status = None
    try:
        recent = svc.get_history(HISTORY_ROWS)
        stored = _day(recent[0].get("date")) if recent and isinstance(recent[0], dict) else None
    except Exception:  # noqa: BLE001
        stored = None

    read = status if isinstance(status, dict) and status.get("ok") is True else None
    session = _day(read.get("session_date")) if read else None
    started = bool(read) and read.get("session_live") is True
    superseded = bool(stored and session and stored >= session)   # the live route's own rule
    thin = bool(read) and read.get("degraded") is True
    if started and session and not superseded and not thin:
        mode, reason, day = "live", None, session
    elif stored:
        mode, day = "settled", stored
        reason = "no_read" if not (read and session) else "finished" if started and superseded else "thin" if started and thin else "closed"
    else:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOTHING)

    lists = {s: (_live_list(bl, LISTS[s]) if mode == "live" else _stored_list(svc, day, LISTS[s])) for s in asked}
    if all(lists[s] is None for s in asked):
        return env.unavailable(KIND, params, SOURCE, NOTE_UNAVAILABLE.format(date=day))

    notes = [NOTE_WHAT]
    stale = False
    computed_at = None
    if mode == "live":
        computed = _parse(read.get("as_of"))
        observed = _parse(read.get("data_as_of"))
        computed_at = env.utc_iso(computed) if computed else None
        as_of = env.utc_iso(observed) if observed else None
        notes.append((NOTE_LIVE if as_of else NOTE_LIVE_NO_TIME).format(date=day, at=computed_at or "a time not given"))
        if read.get("nhnl_basis") == "intraday":
            notes.append(NOTE_BASIS)
        newest = observed or computed
        if newest is None or (now_utc() - newest).total_seconds() > STALE_AFTER_S:
            stale = True
            notes.append(NOTE_STALE_LIVE)
        freshness = "periodic"
    else:
        from api.services.uct_agent.marketdata.sessions import last_completed_session
        from api.services.uct_agent.marketdata.themes import _session_close_utc
        ymd = int(day.replace("-", ""))
        as_of = _session_close_utc(ymd)
        notes.append(NOTE_SETTLED.format(date=day))
        notes.append({"finished": NOTE_FINISHED, "thin": NOTE_THIN, "closed": NOTE_CLOSED, "no_read": NOTE_NO_READ}[reason])
        latest = last_completed_session()
        if ymd < latest:
            stale = True
            s = str(latest)
            notes.append(NOTE_STALE_SETTLED.format(date=day, session=f"{s[:4]}-{s[4:6]}-{s[6:]}"))
        freshness = "historical"

    sides: dict[str, Optional[dict]] = {"highs": None, "lows": None}
    total = shown = 0
    for s in asked:
        rows = lists[s]
        if rows is None:
            sides[s] = {"state": "unavailable", "items": [], "count": 0}
            notes.append(NOTE_SIDE_MISSING.format(side=s[:-1]))
            continue
        if not rows:
            notes.append(NOTE_EMPTY.format(side=s[:-1]))
        elif len(rows) > limit:
            notes.append(NOTE_CUT.format(n=limit, total=len(rows), side=s[:-1]))
        sides[s] = {"state": "ok", "items": rows[:limit], "count": len(rows)}
        total += len(rows)
        shown += min(len(rows), limit)
    missing = [s for s in asked if lists[s] is None]
    data = {"mode": mode, "why": reason, "session_date": day, "side": side, "highs": sides["highs"], "lows": sides["lows"],
            "basis": "intraday" if mode == "live" and read.get("nhnl_basis") == "intraday" else None,
            "computed_at": computed_at, "missing": missing}
    coverage = {"evaluated": total, "answered": shown, "dropped": total - shown, "not_computable": 0}
    return env.make_envelope(KIND, params, status="partial" if missing else "ok", freshness=freshness, as_of=as_of,
                             source=SOURCE, data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
