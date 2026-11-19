"""MD-1 kind `earnings.expectedMove` (owner: terminal-data, data wave 2) — what the options market prices for a report.

One stock's expected move around earnings: the Agent half of the EXMV terminal panel
(app/src/pages/terminal/panels/expectedMoveModel.js), over the services `GET /api/research/expected-move/{sym}` reads:
  * `services/implied_store.get_implied_history(sym)` / `get_earliest_report_date(sym)`: what the at-the-money straddle
    priced BEFORE each report, captured once by the nightly job (a local SQLite read). A row whose report is still
    ahead is the coming report's capture;
  * `services/implied_move`'s cached straddle for the current chain (see below).
The route's `grade` (UCT's Setup Grade, a scored verdict) is NOT part of this kind.

LICENSING, verified in code: the straddle is computed from UCT's own Massive option chain
(`implied_move.compute_expected_move_result` over `services/polygon_options`, which calls api.massive.com only;
payload `source: "massive-chain"`). The store's rows are `massive-chain` or `massive-backfill`. No Schwab chain is read.
Belt and braces: a current straddle whose `source` is not in LICENSED_SOURCES is dropped, with a note.

⛔ THE CURRENT STRADDLE IS READ FROM THE SERVICE'S CACHE, NEVER BUILT HERE (MD-1 §5). `get_expected_move` builds
synchronously when it holds nothing for the key: an expirations walk (up to 12 requests, 20 seconds), a chain read (up
to 8) and a spot hint, up to 21 Massive requests, more than a turn's whole provider budget. So this adapter reads only
what the service already holds for the member route's own key:
  * its 15-minute cache (`_MOVE_CACHE`)                    → `live_state: "fresh"`;
  * else its last-good slot (`_MOVE_STALE`, 2 hours)        → `live_state: "last_good"`, and the read is `stale`;
  * else no current straddle                                → `live_state: "not_cached"`, `live: null`, with a note.
    `live_outcome` is then null, the route's own word for "the read was never attempted".
provider_calls is always 0.
⚠️ COUPLING, stated: the service's cache key and its two cache objects. A rail fills them through the service's own
`get_expected_move` and reads them back with `cache_key`, so a rename fails by name.

WHICH EXPIRY: the service picks the first expiry ON OR AFTER `report_date`, or simply the nearest expiry without
one. So the adapter looks up the key for `report_date` when given, else for the coming report the store holds a
capture for, else the route's bare key. `data.report_date` says which; with none a note says the expiry may not span
the report.

TIME (MD-1 §3): a straddle's `asof` is when UCT read the chain, and a capture's `captured_at` when UCT stored it:
both UCT's times, the vendor's quote time is not carried. So `as_of` is null with a note; the times ride in `data`
under their own names (`read_at`, each row's `captured_at`). freshness `periodic`.

STATUS: a current straddle → `ok`; none but stored captures → `partial`, with the note; neither → `unavailable`
(nothing is held: that is not "no move is priced").

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the number is computed by UCT from a vendor option chain under
UCT's own refusal bounds, and the history is a series only UCT holds (its nightly capture archive). UCT-derived, like
`levels.darkpool`, and derived from options data the owner has not cleared for the model. Shown to the member only.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "earnings.expectedMove"
SOURCE = "uct-implied-move"
#: the dark pool levels kind's symbol rule (one ticker; letters, dots and dashes)
SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z.\-]{0,9}$")
HISTORY_LIMIT = 8                       # the member route's own
#: the chain sources this kind may show (UCT's own Massive chain). Anything else is dropped, never shown.
LICENSED_SOURCES = ("massive-chain",)
LIVE_FIELDS = ("pct", "dollar", "strike", "spot", "call_mid", "put_mid", "iv_atm", "expiry", "horizon", "asof", "source")
HISTORY_FIELDS = ("sym", "report_date", "captured_at", "pct", "dollar", "expiry", "fiscal_year", "fiscal_quarter")
LIVE_STATES = ("fresh", "last_good", "not_cached")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("the expected move is the price of the at-the-money straddle (the call plus the put at the strike nearest "
             "the stock price) as a percent of the stock price, through the option expiry given; what the options "
             "market prices, not a forecast")
NOTE_READ = ("the current straddle was read by UCT from its option chain at {at} (UCT's read time; the vendor's quote "
             "time is not carried), so as_of is not given: not a live feed")
NOTE_LAST_GOOD = ("the current straddle is the last good read, older than the 15 minutes it is normally kept, so it "
                  "may be behind the option market")
NOTE_NOT_CACHED = ("no current straddle is held in the server's cache for {sym}, and this read never starts an option "
                   "chain read; only what was stored before each report is given")
NOTE_NO_REPORT_DATE = ("no report date was given or stored for {sym}, so the straddle is for the nearest expiry, which "
                       "spans the next report only if that report falls before it")
NOTE_UNLICENSED = "a current straddle from an option chain this kind does not show was left out"
NOTE_CAPTURES = ("each stored row is what the straddle priced before that report, captured once by UCT on the "
                 "`captured_at` date; a row whose report date is still ahead is the coming report's capture")
NOTE_NO_HISTORY = "no stored capture is held for {sym}: the capture store began recently and many stocks have none"
NOTE_STORE_FAILED = "the stored captures could not be read for {sym}; that is not the same as none being held"
NOTE_NO_READ_TIME = "the current straddle carries no read time, so as_of is not given"
NOTE_CAPTURE_TIME = "the stored rows carry UCT's own capture dates, not a market time, so as_of is not given"
NOTE_UNAVAILABLE = ("no expected move is held for {sym}: no current straddle is in the server's cache and no capture "
                    "is stored. That is not the same as no move being priced")
NOTE_FAILED = "the expected move could not be read for {sym}"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    sym = params.get("symbol")
    if not isinstance(sym, str) or not SYMBOL_RE.match(sym.strip()):
        return "`symbol` must be one ticker (letters, dots and dashes, starting with a letter)"
    day = params.get("report_date")
    if day is not None:
        if not isinstance(day, str) or not _ISO_DAY.match(day):
            return "`report_date` must be a date as YYYY-MM-DD"
        try:
            datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            return "`report_date` must be a real calendar date"
    return None


def today_et() -> str:
    return datetime.now(_ET).date().isoformat()


def cache_key(sym: str, report_date: Optional[str]) -> str:
    """The member route's own key in `implied_move.get_expected_move` (no report timing: the route passes none)."""
    return f"expmove::{(sym or '').upper()}::{report_date or ''}"


def cached_move(sym: str, report_date: Optional[str]) -> tuple[Optional[dict], str]:
    """(the straddle the service already holds for this key, how it is held), WITHOUT building one."""
    from api.services import implied_move as svc
    key = cache_key(sym, report_date)
    hit = svc._MOVE_CACHE.get(key)
    if isinstance(hit, dict):
        return dict(hit), "fresh"
    value, age = svc._MOVE_STALE.peek(key)
    if isinstance(value, dict) and age is not None and age <= svc._MOVE_STALE.max_age:
        return dict(value), "last_good"
    return None, "not_cached"


def _read_at(raw: Any) -> Optional[str]:
    try:
        d = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return env.utc_iso(d if d.tzinfo else d.replace(tzinfo=timezone.utc))


def _pos(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v > 0


def read_expected_move(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = params["symbol"].strip().upper()
    asked_day = params.get("report_date")

    store_ok = True
    history: list[dict] = []
    since = None
    try:
        from api.services import implied_store
        raw = implied_store.get_implied_history(sym, limit=HISTORY_LIMIT)
        since = implied_store.get_earliest_report_date(sym)
        history = [{k: r.get(k) for k in HISTORY_FIELDS} for r in (raw if isinstance(raw, list) else [])
                   if isinstance(r, dict) and _ISO_DAY.match(str(r.get("report_date") or "")) and _pos(r.get("pct"))]
    except Exception:  # noqa: BLE001 — a failing store is said, never read as "no captures"
        store_ok, history, since = False, [], None

    today = today_et()
    ahead = sorted(r["report_date"] for r in history if r["report_date"] >= today)
    report_day = asked_day or (ahead[0] if ahead else None)
    try:
        live, state = cached_move(sym, report_day)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never a guess
        if not history:
            return env.unavailable(KIND, params, SOURCE, NOTE_FAILED.format(sym=sym))
        live, state = None, "not_cached"

    notes = [NOTE_WHAT]
    if live is not None and (live.get("source") not in LICENSED_SOURCES or not _pos(live.get("pct"))):
        if live.get("source") not in LICENSED_SOURCES:
            notes.append(NOTE_UNLICENSED)
        live, state = None, "not_cached"
    if live is None and not history:
        return env.unavailable(KIND, params, SOURCE, (NOTE_UNAVAILABLE if store_ok else NOTE_FAILED).format(sym=sym))

    read_at = None
    stale = False
    if live is not None:
        live = {k: live.get(k) for k in LIVE_FIELDS}
        read_at = _read_at(live.get("asof"))
        notes.append(NOTE_READ.format(at=read_at) if read_at else NOTE_NO_READ_TIME)
        if state == "last_good":
            stale = True
            notes.append(NOTE_LAST_GOOD)
        if report_day is None:
            notes.append(NOTE_NO_REPORT_DATE.format(sym=sym))
    else:
        notes += [NOTE_NOT_CACHED.format(sym=sym), NOTE_CAPTURE_TIME]
    if history:
        notes.append(NOTE_CAPTURES)
    else:
        notes.append((NOTE_NO_HISTORY if store_ok else NOTE_STORE_FAILED).format(sym=sym))

    # `live` / `live_outcome` / `history` / `history_since` keep the route's own names (the EXMV panel's model reads them)
    data = {"symbol": sym, "report_date": report_day, "live": live, "live_state": state,
            "live_outcome": {"kind": "ok", "reason": None} if live is not None else None, "read_at": read_at,
            "history": history, "history_since": since if isinstance(since, str) and _ISO_DAY.match(since) else None,
            "store_read": store_ok}
    partial = live is None or not store_ok
    return env.make_envelope(KIND, params, status="partial" if partial else "ok", freshness="periodic", as_of=None,
                             source=SOURCE, data=data, stale=stale, notes=notes, provider_calls=0)
