"""MD-1 kind `highsLows.session` (owner: terminal-data, data wave 1) — new highs and new lows OF THE SESSION.

A thin adapter over the intraday scanner `services/nhnl_live.get_live(...)` (the read behind `GET /api/nhnl/live`,
flag NHNL_SCANNER_ENABLED): one row per stock that has printed a new high (or low) of the current session, with a
running `count` of how many times, busiest first. Read-only against the scanner's in-memory state: no provider call,
no write, and it never starts the scanner.

⛔ NOT 52-WEEK HIGHS AND LOWS. Those are `breadth.current` measures (MD-1 §4, `new_52w_highs` …). This is the
high-of-day / low-of-day EVENT COUNTER, per session: `pre` (4:00-9:30 ET), `rth` (9:30-16:00), `post` (16:00-20:00),
each with its own counts. Every answer carries a note that says so.
⚠️ MD-1 v1.3 recorded `nhnl_live` as "not exposed" for two reasons: it was being confused with the 52-week measure,
and it has no vendor time. Both are answered here (the name and note above; `as_of` below), but that contract row must
be amended (MD-1 §8) before this kind is armed. It ships dark and model-isolated, so nothing reads it until then.

TIME (MD-1 §3)
  * The scanner's `asof` is the time of UCT's own last tick (a polling time, like `fetched_at`); the vendor's
    observation time of the snapshot is not carried. So `as_of` is null, `data.tick_at` gives UCT's tick time,
    labelled as such, and it is never worded as live (the same rule as `themes`, MD-1 §4.3).
  * While a session is open the read is `periodic`, and `stale` when the last tick is older than STALE_AFTER_S (the
    scanner stopped ticking). With the market closed the counts are the last tracked session's: `historical`.
  * Scanner off / not running / never ticked → `unavailable`, never an empty "nothing made a new high".

MODEL-ISOLATED (ADR-005): the counts are UCT's own accumulator output (UCT-derived), shown to the member only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "highsLows.session"
SOURCE = "uct-nhnl-scanner"
DEFAULT_LIMIT = 15
MAX_LIMIT = 50
MAX_MIN_COUNT = 1000
STALE_AFTER_S = 60                      # the scanner ticks every few seconds; a minute of silence is a stopped scanner
ROW_FIELDS = ("sym", "price", "pct", "count", "ts", "dir")
WINDOWS = ("pre", "rth", "post", "closed")

NOTE_WHAT = ("new highs and new lows of the SESSION (pre-market, regular and after-hours are counted separately), "
             "not 52-week highs and lows; `count` is how many times the stock has made one this session")
NOTE_OFF = "the new highs and lows scanner is not running on this server, so no counts are available"
NOTE_NO_TICK = "the new highs and lows scanner has not produced a reading yet"
NOTE_FAILED = "the new highs and lows scanner could not be read"
NOTE_TICK = ("counts as of the scanner's last tick at {at} (UCT's polling time; the vendor's observation time is not "
             "carried), so as_of is not given — not a live feed")
NOTE_CLOSED = "the market is closed: these are the counts of the last tracked session ({date}), not a current reading"
NOTE_CLOSED_EMPTY = "the market is closed and no session counts are held"
NOTE_STOPPED = "the scanner's last tick is more than a minute old, so newer highs and lows may be missing"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    p = params.get("min_price", 0)
    if not isinstance(p, (int, float)) or isinstance(p, bool) or p != p or p < 0:
        return "`min_price` must be zero or a positive number"
    c = params.get("min_count", 1)
    if not isinstance(c, int) or isinstance(c, bool) or not 1 <= c <= MAX_MIN_COUNT:
        return f"`min_count` must be a whole number from 1 to {MAX_MIN_COUNT}"
    return None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: Any) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(ts))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else None       # a time with no zone is not a time we can state


def _rows(raw: Any) -> list[dict]:
    return [{k: r.get(k) for k in ROW_FIELDS} for r in (raw if isinstance(raw, list) else [])
            if isinstance(r, dict) and r.get("sym") and not r.get("group")]


def _total(v: Any, shown: list) -> int:
    """How many rows the whole view holds: the scanner's own count, never fewer than the rows shown."""
    return max(len(shown), v) if isinstance(v, int) and not isinstance(v, bool) else len(shown)


def read_session_highs_lows(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    try:
        from api.services import nhnl_live
        payload = nhnl_live.get_live(limit=params.get("limit", DEFAULT_LIMIT),
                                     min_price=float(params.get("min_price", 0)),
                                     min_count=params.get("min_count", 1))
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never a guess
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(payload, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    window = payload.get("window") if payload.get("window") in WINDOWS else "closed"
    active = payload.get("active") is True
    tick = _parse(payload.get("asof"))
    highs, lows = _rows(payload.get("highs")), _rows(payload.get("lows"))
    if window != "closed" and not active:
        return env.unavailable(KIND, params, SOURCE, NOTE_OFF)
    if tick is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_CLOSED_EMPTY if window == "closed" else NOTE_NO_TICK)
    if window == "closed" and not (highs or lows):
        return env.unavailable(KIND, params, SOURCE, NOTE_CLOSED_EMPTY)

    tick_at = env.utc_iso(tick)
    notes = [NOTE_WHAT, NOTE_TICK.format(at=tick_at)]
    stale = False
    if window == "closed":
        freshness = "historical"
        notes.append(NOTE_CLOSED.format(date=payload.get("date") or "date not given"))
    else:
        freshness = "periodic"
        if (now_utc() - tick).total_seconds() > STALE_AFTER_S:
            stale = True
            notes.append(NOTE_STOPPED)
    highs_total, lows_total = _total(payload.get("highs_total"), highs), _total(payload.get("lows_total"), lows)
    # `window` / `active` / `date` / `asof` / `highs` / `lows` / the totals keep the route's own names: the HILO
    # panel's pure helper (HighsLowsPanel.jsx highsLowsBoard) reads them
    data = {"window": window, "active": active, "date": payload.get("date"), "asof": payload.get("asof"),
            "tick_at": tick_at, "group": None, "value": None, "highs": highs, "lows": lows,
            "highs_total": highs_total, "lows_total": lows_total}
    shown = len(highs) + len(lows)
    coverage = {"evaluated": highs_total + lows_total, "answered": shown, "dropped": highs_total + lows_total - shown,
                "not_computable": 0}
    return env.make_envelope(KIND, params, status="ok", freshness=freshness, as_of=None, source=SOURCE, data=data,
                             stale=stale, coverage=coverage, notes=notes, provider_calls=0)
