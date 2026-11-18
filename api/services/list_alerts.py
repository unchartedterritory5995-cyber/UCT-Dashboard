"""Tell a member when a stock they follow comes onto one of three Terminal lists.

Owner pick 2026-11-17: "Alerts on the new lists: get the alert bell and an email when a
stock you follow hits a 52-week high, appears on the confluence board, or gets a
repeat-hit contract." Three kinds, one per list:

  highs52            the Breadth Monitor's New 52-week highs list (Terminal code H52)
  confluence         the confluence board (CONFL)
  repeat_contracts   the repeat-hit option contracts list (ACCUM)

NOT A SECOND ALERT SYSTEM. Everything that already existed is used as it is:
  * EACH LIST is read where its panel's route reads it: the stored breadth row
    (`breadth_monitor.raw_row`), the cached confluence board (`confluence_screen`), and the
    flow-worker's by-contract answer (the one key its warmer keeps warm).
  * "A STOCK YOU FOLLOW" is `member_interest.own_list_symbols_by_user`: the member's own
    watchlists plus their Flagged list, the predicate the rest of the app already uses.
    Not positions, not the UCT 20, never a prebuilt index list.
  * DELIVERY is `watchlist_alert_service.deliver_alert_payload` (the alert bell, plus the
    channels the member's alert settings allow), with the member's routing rule read the
    way the RS screens message reads it. No Discord: a private alert has no Discord leg.

ONE JOB FOR EVERY MEMBER (`run_evening`). Each list is read ONCE per run, then joined in
memory against every subscribed member's names. Never a list read per member.

THE RULES (each is a test in tests/test_list_alerts.py)
  * ⛔ NOTHING WITH THE SETTING OFF. ``TERMINAL_LIST_ALERTS_ENABLED`` is read per call:
    unset or ``0`` is off, ``admin`` is the owner's preview (admins only), ``1`` is every
    paid member. Off, `run_evening` returns before it opens a database or reads a list, the
    routes 404 and no control is drawn.
  * ⛔ NOTHING WITHOUT THE MEMBER'S OWN SWITCH. A switch is a row in `list_alert_subs`;
    no row is off, and nobody has a row they did not ask for.
  * ⛔ NEVER TWICE. Two durable records, taken in one transaction BEFORE anything is sent:
    `list_alert_messages` (member, kind, session): one message per member per list per
    session, however many times the job runs; and `list_alerts_told` (member, kind, key,
    streak): a member is told about one stock (or one contract) once per appearance. A
    delivery that reached nobody gives both back so a later run can try again. A process
    killed between the claim and the send loses that one message: it is never sent twice.
  * "NEWLY" IS ABOUT THE LIST, NOT THE MEMBER. A stock is new on a list when it is on it
    tonight and was not on it in any of the last `REARM_SESSIONS` checked sessions
    (`list_alert_presence`, kept for everyone whether or not anybody subscribed). So a
    stock that stays on a list is said once, and turning a switch on, or adding a
    watchlist, never sends a burst about names that were already there.
  * SILENCE IS A RESULT. A list that cannot be read, is not of tonight's session, or has
    no recent earlier check to compare with sends nothing; the first two record nothing.
  * ONE MEMBER NEVER COSTS ANOTHER. Each member and each list is isolated.
  * The words are facts from the list's own row. Nothing here says what to do.

WHEN IT RUNS. `api.main.register_list_alert_jobs`: `CHECK_TIMES_ET` on weekdays, and only
after the close of a trading day (`AFTER_CLOSE_MINUTES`). The second pass is the retry for
a list that was not ready and a delivery that reached nobody; it can never repeat a
message. The by-contract read is on the flow-worker, so it is never made in market hours.

WHERE IT IS STORED. Five small tables in screener.db (`snapshot_db`), beside the RS
screens' own alert tables. The three that carry a member id are in
`alert_erasure.SCREENER_TABLES`, so they go with the account.
"""
from __future__ import annotations

import contextlib
import datetime
import logging
import os
import time
from urllib.parse import quote

log = logging.getLogger(__name__)

FLAG = "TERMINAL_LIST_ALERTS_ENABLED"
#: The alert type the bell and the alert feed file these under.
SOURCE = "list_alert"

HIGHS52, CONFLUENCE, REPEAT = "highs52", "confluence", "repeat_contracts"
KINDS = (HIGHS52, CONFLUENCE, REPEAT)
#: Each kind's Terminal code, the command the bell's click opens, and its plain name.
KIND_INFO = {
    HIGHS52: {"code": "H52", "command": "H52 HIGHS", "name": "New 52-week highs"},
    CONFLUENCE: {"code": "CONFL", "command": "CONFL", "name": "Confluence board"},
    REPEAT: {"code": "ACCUM", "command": "ACCUM", "name": "Repeat-hit option contracts"},
}

#: The re-arm rule: a stock (or a contract) is new on a list again only after it has been
#: off that list for this many CHECKED sessions in a row. A session whose list could not be
#: read is not counted either way: unknown is never "off".
REARM_SESSIONS = 5
#: A first appearance is only said when the list was also checked within this many calendar
#: days before (a long weekend is 4). Older than that, tonight's check is a new baseline:
#: recorded, nothing sent, because "it was not there before" cannot be known.
BASELINE_MAX_AGE_DAYS = 5
#: Stocks (or contracts) named in one message before "+N more".
MAX_NAMED = 12
#: The checks, Eastern time, Monday to Friday. `api.main` schedules exactly these.
CHECK_TIMES_ET = ((18, 10), (21, 50))
#: A run earlier than this after the session's close does nothing.
AFTER_CLOSE_MINUTES = 60
#: The confluence board is rebuilt about every 30 minutes. A cached board older than this
#: is a build that has been failing, and is not read as tonight's board.
CONFLUENCE_MAX_AGE_S = 2 * 3600
#: The hit floor of the one by-contract key the flow-worker keeps warm (the ACCUM panel's).
REPEAT_MIN_HITS = 3
#: Rows older than this many days are pruned (they can no longer change any answer).
KEEP_DAYS = 180

OUTCOME_SENT, OUTCOME_SUSPENDED = "sent", "suspended"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS list_alert_subs (
  user_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
-- ⛔ ONE MESSAGE PER (member, list, SESSION): the daily cap. Claimed before anything is sent.
CREATE TABLE IF NOT EXISTS list_alert_messages (
  user_id  TEXT    NOT NULL,
  kind     TEXT    NOT NULL,
  session  TEXT    NOT NULL,
  sent_at  INTEGER NOT NULL,
  outcome  TEXT    NOT NULL,
  n_keys   INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, session)
);
-- ⛔ ONE TELLING PER (member, list, stock or contract, APPEARANCE). `streak_start` is the
-- session the stock came onto the list; it stays the same for as long as it stays on.
CREATE TABLE IF NOT EXISTS list_alerts_told (
  user_id      TEXT    NOT NULL,
  kind         TEXT    NOT NULL,
  key          TEXT    NOT NULL,
  streak_start TEXT    NOT NULL,
  session      TEXT    NOT NULL,
  told_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, key, streak_start)
);
-- What was on each list, for everyone (no member id): when each stock came on, and the
-- last checked session it was still on.
CREATE TABLE IF NOT EXISTS list_alert_presence (
  kind          TEXT NOT NULL,
  key           TEXT NOT NULL,
  first_session TEXT NOT NULL,
  last_session  TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);
-- Every session a list was read and compared (no member id).
CREATE TABLE IF NOT EXISTS list_alert_sessions (
  kind       TEXT    NOT NULL,
  session    TEXT    NOT NULL,
  checked_at INTEGER NOT NULL,
  n_keys     INTEGER NOT NULL,
  PRIMARY KEY (kind, session)
);
"""

_done: set = set()


class UnknownKind(LookupError):
    """Not one of the three lists: a 404."""


# --------------------------------------------------------------------------- #
# the one server setting
# --------------------------------------------------------------------------- #

def mode() -> str:
    """``off`` | ``admin`` | ``on``, from ``TERMINAL_LIST_ALERTS_ENABLED``, read PER CALL
    (so a flip needs no restart and a rollback is an unset). Only the literal ``1`` is on
    for every paid member; ``admin`` is the owner's preview; anything else is off.
    Ledger: docs/feature_flags.json. The name is spelled out here (not read from
    :data:`FLAG`) because the ledger's index of gates is derived from the literal."""
    raw = os.environ.get("TERMINAL_LIST_ALERTS_ENABLED", "0").strip().lower()
    return "on" if raw == "1" else "admin" if raw == "admin" else "off"


def enabled() -> bool:
    """Is the feature armed at all (for everyone, or for the owner's preview)?"""
    return mode() != "off"


def allowed(user) -> bool:
    """May THIS member be offered a switch, or sent a message? ``user`` is the member's own
    record with ``plan`` on it. Off: nobody. ``admin``: admins only. On: the app's one paid
    predicate (admin, a paid plan, or inside the trial). Unknown is never allowed."""
    m = mode()
    if m == "off" or not isinstance(user, dict):
        return False
    if m == "admin":
        return user.get("role") == "admin"
    from api.middleware.auth_middleware import is_paid_user   # noqa: PLC0415 - lazy: no cycle
    return bool(is_paid_user(user))


# --------------------------------------------------------------------------- #
# the store
# --------------------------------------------------------------------------- #

@contextlib.contextmanager
def _db():
    """One connection to screener.db: committed on a clean exit, rolled back on an error,
    always closed. The schema is ensured once per database file."""
    from api.services.screener import snapshot_db               # noqa: PLC0415 - lazy
    conn = snapshot_db.connect()
    try:
        path = snapshot_db.get_db_path()
        if path not in _done:
            conn.executescript(_SCHEMA)
            _done.add(path)
        with conn:
            yield conn
    finally:
        conn.close()


def _kind(kind) -> str:
    k = str(kind or "")
    if k not in KINDS:
        raise UnknownKind(k)
    return k


def set_switch(user_id, kind, on: bool) -> dict:
    """Turn one list's alert on or off for one member. On twice is on; off twice is off.
    What was already said stays recorded, so off and on again never repeats a message."""
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("a switch needs a member")
    k = _kind(kind)
    with _db() as conn:
        if on:
            conn.execute("INSERT OR IGNORE INTO list_alert_subs (user_id, kind, created_at) "
                         "VALUES (?,?,?)", (uid, k, int(time.time())))
        else:
            conn.execute("DELETE FROM list_alert_subs WHERE user_id=? AND kind=?", (uid, k))
    return {"kind": k, "on": bool(on)}


def switches(user_id) -> set:
    """The kinds this member has switched on."""
    with _db() as conn:
        have = {r[0] for r in conn.execute(
            "SELECT kind FROM list_alert_subs WHERE user_id=?", (str(user_id),))}
    return {k for k in KINDS if k in have}


def state(user_id) -> dict:
    """What `GET /api/alerts/lists` answers for a member the feature is on for: each list's
    switch, how many names the server counts as followed (None when they could not be
    read), and the numbers the controls put into words."""
    uid = str(user_id)
    on = switches(uid)
    try:
        from api.services import member_interest                # noqa: PLC0415 - lazy
        follows = len(member_interest.own_list_symbols_by_user([uid]).get(uid, ()))
    except Exception as e:                                      # noqa: BLE001 - a count, never the switch
        log.warning("[list-alerts] follows not counted: %s: %s", type(e).__name__, e)
        follows = None
    return {
        "available": True,
        "kinds": [{"kind": k, "on": k in on, **KIND_INFO[k]} for k in KINDS],
        "follows": follows,
        "rearm_sessions": REARM_SESSIONS,
        "max_named": MAX_NAMED,
        "checks_et": [f"{h:02d}:{m:02d}" for h, m in CHECK_TIMES_ET],
    }


# --------------------------------------------------------------------------- #
# pure: numbers and dates as words
# --------------------------------------------------------------------------- #

def _num(v):
    if isinstance(v, bool) or v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def _price(v) -> str | None:
    n = _num(v)
    return None if n is None else f"${n:,.2f}"


def _signed_pct(v) -> str | None:
    n = _num(v)
    return None if n is None else f"{n:+.2f}%"


def _money(v) -> str | None:
    """Dollars, short: ``$182.0M``, ``$950K``. The size only; the caller says which way."""
    n = _num(v)
    if n is None:
        return None
    a = abs(n)
    if a >= 1e9:
        return f"${a / 1e9:.1f}B"
    if a >= 1e6:
        return f"${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"${a / 1e3:.0f}K"
    return f"${a:.0f}"


def _strike(v) -> str | None:
    n = _num(v)
    if n is None or n <= 0:
        return None
    return f"${n:,.0f}" if n == int(n) else f"${n:,.2f}"


def _iso_day(raw) -> str | None:
    """``11/17/2026`` (the flow store) or ``2026-11-17...`` as ``2026-11-17``, or None."""
    s = str(raw or "").strip()
    try:
        if "/" in s:
            m, d, y = (int(x) for x in s.split("/"))
            return datetime.date(y, m, d).isoformat()
        return datetime.date.fromisoformat(s[:10]).isoformat()
    except (TypeError, ValueError):
        return None


def _day(session) -> str:
    """``2026-11-17`` -> ``Nov 17``; anything else as it came."""
    try:
        d = datetime.date.fromisoformat(str(session)[:10])
        return f"{d.strftime('%b')} {d.day}"
    except (TypeError, ValueError):
        return str(session or "")


def _listed(parts, sep=", ") -> str:
    shown = list(parts[:MAX_NAMED])
    more = len(parts) - len(shown)
    return sep.join(shown + ([f"+{more} more"] if more > 0 else []))


def _plural(n, one, many) -> str:
    return one if n == 1 else many


# --------------------------------------------------------------------------- #
# pure: the words (the ONE place they are built)
# --------------------------------------------------------------------------- #

def _highs_facts(r) -> str:
    bits = []
    if _price(r.get("close")):
        bits.append(f"close {_price(r['close'])}")
    if _signed_pct(r.get("pct")):
        bits.append(f"{_signed_pct(r['pct'])} on the day")
    return ", ".join(bits)


def _compose_highs(rows, session) -> tuple:
    day = _day(session)
    if len(rows) == 1:
        r = rows[0]
        facts = _highs_facts(r)
        return (f"{r['sym']} made a new 52-week high",
                f"{r['sym']}, a stock you follow, made a new 52-week high on {day}"
                f"{f' ({facts})' if facts else ''}. "
                "From the Breadth Monitor's new 52-week highs list.")
    parts = [f"{r['sym']} ({_highs_facts(r)})" if _highs_facts(r) else r["sym"] for r in rows]
    return (f"{len(rows)} stocks you follow made a new 52-week high",
            f"New 52-week highs on {day} among the stocks you follow: {_listed(parts)}. "
            "From the Breadth Monitor's new 52-week highs list.")


_LEAN = {"BULL": "bullish", "BEAR": "bearish"}
_STATUS = {"BUILDING": "building", "STEADY": "steady", "ESTABLISHED": "established"}


def _confluence_words(r) -> str:
    return ", ".join(w for w in (_LEAN.get(r.get("dir")), _STATUS.get(r.get("status"))) if w)


def _compose_confluence(rows, session, days=None) -> tuple:
    day = _day(session)
    span = f"the last {int(days)} trading days" if _num(days) else "its window"
    if len(rows) == 1:
        r = rows[0]
        words = _confluence_words(r)
        lean = _LEAN.get(r.get("dir"))
        facts = []
        if _money(r.get("dark_pool")):
            facts.append(f"{_money(r['dark_pool'])} traded in the dark pool")
        if _money(r.get("net")) and lean:
            facts.append(f"{_money(r['net'])} net {lean} option premium")
        detail = "; ".join(x for x in (words, " and ".join(facts)) if x)
        return (f"{r['sym']} is now on the confluence board",
                f"{r['sym']}, a stock you follow, came onto the confluence board "
                f"(checked {day}, after the close){f': {detail}' if detail else ''}. "
                f"The board lists stocks where dark pool size and long-dated options flow "
                f"line up over {span}.")
    parts = [f"{r['sym']} ({_confluence_words(r)})" if _confluence_words(r) else r["sym"]
             for r in rows]
    return (f"{len(rows)} stocks you follow are now on the confluence board",
            f"Came onto the confluence board among the stocks you follow (checked {day}, "
            f"after the close): {_listed(parts)}. The board lists stocks where dark pool "
            f"size and long-dated options flow line up over {span}.")


_SIDE = {"C": "call", "P": "put"}
_DIRECTION = {"BULL": "bullish", "BEAR": "bearish", "MIXED": "mixed"}


def _contract_words(r) -> str:
    """``$150 call expiring 2026-12-18``; a part the row lacks is left out."""
    head = " ".join(x for x in (_strike(r.get("strike")), _SIDE.get(r.get("cp"))) if x)
    return " expiring ".join(x for x in (head or "contract", r.get("expiry")) if x)


def _contract_direction(r) -> str:
    return _DIRECTION.get(str(r.get("direction") or "").upper(), "side not clear")


def _compose_repeat(rows, session, min_hits=None) -> tuple:
    day = _day(session)
    floor = int(min_hits) if _num(min_hits) else REPEAT_MIN_HITS
    rule = (f"A contract is listed when trades over a size floor hit it {floor} or more "
            "times in one session.")
    syms = []
    for r in rows:
        if r["sym"] not in syms:
            syms.append(r["sym"])
    if len(rows) == 1:
        r = rows[0]
        hits = _num(r.get("hits"))
        how = []
        if hits:
            how.append(f"hit {int(hits)} {_plural(int(hits), 'time', 'times')}")
        if _money(r.get("premium")):
            how.append(f"{'for ' if how else ''}{_money(r['premium'])} in premium")
        tail = f", {' '.join(how)}" if how else ""
        return (f"{r['sym']} has a new repeat-hit option contract",
                f"{r['sym']}, a stock you follow, has a new repeat-hit option contract on "
                f"{day}: the {_contract_words(r)}{tail} ({_contract_direction(r)}). {rule}")
    parts = []
    for r in rows:
        hits = _num(r.get("hits"))
        facts = [f"{int(hits)} {_plural(int(hits), 'hit', 'hits')}" if hits else None,
                 f"{_money(r['premium'])} premium" if _money(r.get("premium")) else None,
                 _contract_direction(r)]
        parts.append(f"{r['sym']} {_contract_words(r)} ({', '.join(x for x in facts if x)})")
    one = len(syms) == 1
    title = (f"{syms[0]} has {len(rows)} new repeat-hit option contracts" if one
             else f"New repeat-hit option contracts on {len(syms)} stocks you follow")
    lead = (f"{syms[0]}, a stock you follow, has {len(rows)} new repeat-hit option contracts "
            f"on {day}" if one
            else f"New repeat-hit option contracts on {day} among the stocks you follow")
    return title, f"{lead}: {_listed(parts, sep='; ')}. {rule}"


def compose(kind, rows, session, context=None) -> tuple:
    """``(title, message)`` for one member's new rows on one list. Every number is from
    the list's own row; a number the row does not carry is left out, never drawn as 0."""
    context = context or {}
    if kind == HIGHS52:
        return _compose_highs(rows, session)
    if kind == CONFLUENCE:
        return _compose_confluence(rows, session, context.get("days"))
    if kind == REPEAT:
        return _compose_repeat(rows, session, context.get("min_hits"))
    raise UnknownKind(str(kind))


def list_link(kind) -> str:
    """The path the bell's click opens: the list itself, in the Terminal."""
    return "/terminal?cmd=" + quote(KIND_INFO[_kind(kind)]["command"])


# --------------------------------------------------------------------------- #
# the three lists (each read ONCE per run)
# --------------------------------------------------------------------------- #
# Each answers {"state": "ok", "rows": [...], "context": {...}} or {"state": <why not>}.
# A row carries `key` (what is remembered: the symbol, or the contract) and `sym`.

def load_highs52(session: str) -> dict:
    """Tonight's stored New 52-week highs list: the row the H52 panel shows for a finished
    session. No row for the session yet, or a row that looks like a failed price pull, is
    not a list."""
    from api.services import breadth_monitor as bm              # noqa: PLC0415 - lazy
    row = bm.raw_row(session)
    if not isinstance(row, dict):
        return {"state": "not_stored"}
    if bm.snapshot_looks_degraded(row):
        return {"state": "degraded"}
    items = row.get("new_52w_highs_list")
    if not isinstance(items, list):
        return {"state": "no_list"}
    rows, seen = [], set()
    for it in items:
        if not isinstance(it, dict):
            continue
        sym = str(it.get("t") or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        rows.append({"key": sym, "sym": sym, "close": _num(it.get("c")), "pct": _num(it.get("pct"))})
    return {"state": "ok", "rows": rows, "context": {}}


def load_confluence(session: str, *, now_ts=None) -> dict:
    """The confluence board the server holds right now (the 30-day window, the one it keeps
    warm). ⛔ READ ONLY: the cache entry is looked at where `get_board` keeps it, and no
    build is started from here. No board, a failed board, or one that has not been rebuilt
    for `CONFLUENCE_MAX_AGE_S` is not a list."""
    from api import confluence_screen as cs                     # noqa: PLC0415 - lazy
    entry = cs._CACHES.get(cs.DAYS) or {}
    board = entry.get("board")
    if not isinstance(board, dict) or board.get("ok") is not True or not isinstance(board.get("rows"), list):
        return {"state": "not_built"}
    age = (time.time() if now_ts is None else float(now_ts)) - float(entry.get("at") or 0)
    if age > CONFLUENCE_MAX_AGE_S:
        return {"state": "stale"}
    rows, seen = [], set()
    for it in board["rows"]:
        if not isinstance(it, dict):
            continue
        sym = str(it.get("sym") or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        rows.append({"key": sym, "sym": sym, "dir": str(it.get("dir") or "").upper(),
                     "status": str(it.get("status") or "").upper(),
                     "dark_pool": _num(it.get("dpn")), "net": _num(it.get("net"))})
    return {"state": "ok", "rows": rows, "context": {"days": board.get("days") or cs.DAYS}}


def _worker_json(path: str):
    """One GET to the flow-worker over the private network, the way `confluence_screen`
    reads its flow leg (the same base URL and the same server-to-server credential).
    Returns the parsed body, or None when no worker is configured. Raises on a failure."""
    import httpx                                                # noqa: PLC0415 - lazy
    from api import confluence_screen as cs                     # noqa: PLC0415 - lazy
    if not cs.WORKER_INTERNAL_URL:
        return None
    headers = {"Authorization": f"Bearer {cs._PUSH_SECRET}"} if cs._PUSH_SECRET else {}
    r = httpx.get(f"{cs.WORKER_INTERNAL_URL}{path}", headers=headers,
                  timeout=httpx.Timeout(60.0, connect=10.0))
    r.raise_for_status()
    return r.json()


def load_repeat_contracts(session: str) -> dict:
    """Today's repeat-hit option contracts, from the flow-worker.

    WHAT THIS READ COSTS. It is the ONE by-contract key the flow-worker's own warmer keeps
    present (today, stocks and ETFs, 3 hits, one day: the key the ACCUM panel and the Live
    Flow page read). An answer older than two minutes is served as it is while the worker
    runs at most ONE refresh behind it (single-flight). So one run here is at most one
    rebuild of a finished day's tape, the same as one member opening the list after the
    close. `run_evening` never calls this before the close.

    An answer for another day (the worker's clock has moved on, or it has no tape) is not
    tonight's list."""
    body = _worker_json("/api/live/massive/by-contract?stock_etf=all"
                        f"&min_hits={REPEAT_MIN_HITS}&lookback_days=1")
    if body is None:
        return {"state": "no_worker"}
    if not isinstance(body, dict) or not isinstance(body.get("contracts"), list):
        return {"state": "unreadable"}
    if _iso_day(body.get("query_date")) != session:
        return {"state": "other_day"}
    rows, seen = [], set()
    for it in body["contracts"]:
        if not isinstance(it, dict):
            continue
        sym = str(it.get("ticker") or "").strip().upper()
        cp = str(it.get("cp") or "").strip().upper()[:1]
        strike = _num(it.get("strike"))
        expiry = _iso_day(it.get("exp"))
        if not sym or cp not in _SIDE or strike is None or not expiry:
            continue                                            # not a contract this can name
        key = f"{sym}|{cp}|{strike:g}|{expiry}"
        if key in seen:
            continue
        seen.add(key)
        rows.append({"key": key, "sym": sym, "cp": cp, "strike": strike, "expiry": expiry,
                     "hits": _num(it.get("qualifying_hits")),
                     "premium": _num(it.get("total_premium")),
                     "direction": str(it.get("direction") or "")})
    return {"state": "ok", "rows": rows, "context": {"min_hits": body.get("min_hits")}}


LOADERS = {HIGHS52: load_highs52, CONFLUENCE: load_confluence, REPEAT: load_repeat_contracts}


# --------------------------------------------------------------------------- #
# what was on each list: the re-arm rule
# --------------------------------------------------------------------------- #

def _advance(kind: str, session: str, keys) -> dict:
    """Record that ``keys`` are on the list for ``session`` and answer which of them are
    NEW tonight: ``{"announce", "new", "prev_session"}``.

    A key is new when it has no earlier record, or its last recorded session is followed
    by `REARM_SESSIONS` or more checked sessions it was absent from. Running this again for
    the same session changes nothing and answers the same. ``announce`` is False when there
    is no earlier check within `BASELINE_MAX_AGE_DAYS` to compare with: tonight is then a
    baseline, and nothing is said."""
    keys = list(dict.fromkeys(keys))
    with _db() as conn:
        prior = [r[0] for r in conn.execute(
            "SELECT session FROM list_alert_sessions WHERE kind=? AND session<? "
            "ORDER BY session DESC LIMIT ?", (kind, session, REARM_SESSIONS + 1))]
        have = {r[0]: (r[1], r[2]) for r in conn.execute(
            "SELECT key, first_session, last_session FROM list_alert_presence WHERE kind=?",
            (kind,))}
        new = set()
        for key in keys:
            row = have.get(key)
            if row is None:
                conn.execute("INSERT INTO list_alert_presence (kind, key, first_session, "
                             "last_session) VALUES (?,?,?,?)", (kind, key, session, session))
                new.add(key)
                continue
            first, last = row
            if last >= session:                                  # this session, seen already
                if first == session:
                    new.add(key)
                continue
            absent = sum(1 for s in prior if s > last)            # checked sessions it missed
            if absent >= REARM_SESSIONS:
                conn.execute("UPDATE list_alert_presence SET first_session=?, last_session=? "
                             "WHERE kind=? AND key=?", (session, session, kind, key))
                new.add(key)
            else:
                conn.execute("UPDATE list_alert_presence SET last_session=? WHERE kind=? AND key=?",
                             (session, kind, key))
        conn.execute("INSERT OR IGNORE INTO list_alert_sessions (kind, session, checked_at, n_keys) "
                     "VALUES (?,?,?,?)", (kind, session, int(time.time()), len(keys)))
    prev = prior[0] if prior else None
    announce = False
    if prev:
        try:
            gap = (datetime.date.fromisoformat(session) - datetime.date.fromisoformat(prev)).days
            announce = 0 < gap <= BASELINE_MAX_AGE_DAYS
        except ValueError:
            announce = False
    return {"announce": announce, "new": new, "prev_session": prev}


def _prune(session: str) -> None:
    """Drop rows too old to change any answer. Best effort."""
    try:
        cut = (datetime.date.fromisoformat(session) - datetime.timedelta(days=KEEP_DAYS)).isoformat()
        with _db() as conn:
            conn.execute("DELETE FROM list_alert_presence WHERE last_session < ?", (cut,))
            conn.execute("DELETE FROM list_alerts_told WHERE session < ?", (cut,))
            conn.execute("DELETE FROM list_alert_messages WHERE session < ?", (cut,))
            conn.execute("DELETE FROM list_alert_sessions WHERE session < ?", (cut,))
    except Exception:                                           # noqa: BLE001
        log.warning("[list-alerts] prune failed", exc_info=True)


# --------------------------------------------------------------------------- #
# the dedup rows
# --------------------------------------------------------------------------- #

def _claim(user_id, kind, session, keys, outcome):
    """Take this member's message for (kind, session) and the keys it will name, in ONE
    transaction. Returns the keys that are this caller's to say; ``None`` when the
    member was already sent this list's message for the session; ``[]`` when every key was
    already told for its appearance (the session row is then not kept)."""
    uid, now = str(user_id), int(time.time())
    with _db() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO list_alert_messages (user_id, kind, session, sent_at, outcome, "
            "n_keys) VALUES (?,?,?,?,?,0)", (uid, kind, session, now, outcome))
        if cur.rowcount != 1:
            return None
        mine = []
        for key in keys:
            c = conn.execute(
                "INSERT OR IGNORE INTO list_alerts_told (user_id, kind, key, streak_start, session, "
                "told_at) VALUES (?,?,?,?,?,?)", (uid, kind, key, session, session, now))
            if c.rowcount == 1:
                mine.append(key)
        if mine:
            conn.execute("UPDATE list_alert_messages SET n_keys=? WHERE user_id=? AND kind=? AND session=?",
                         (len(mine), uid, kind, session))
        else:
            conn.execute("DELETE FROM list_alert_messages WHERE user_id=? AND kind=? AND session=?",
                         (uid, kind, session))
        return mine


def _release(user_id, kind, session) -> None:
    """Give a claim back after a delivery that reached nobody, so a later run can send."""
    with _db() as conn:
        conn.execute("DELETE FROM list_alerts_told WHERE user_id=? AND kind=? AND session=?",
                     (str(user_id), kind, session))
        conn.execute("DELETE FROM list_alert_messages WHERE user_id=? AND kind=? AND session=?",
                     (str(user_id), kind, session))


def _reached_nobody(report) -> bool:
    """`deliver_alert_payload` reports per channel. Nothing landed and something failed is
    the one outcome that is retried; a report this module cannot read is a delivery."""
    return (isinstance(report, dict) and report.get("channels_ok") == 0
            and bool(report.get("channels_failed")))


# --------------------------------------------------------------------------- #
# the run
# --------------------------------------------------------------------------- #

def _member(user_id):
    """The member's own record with their plan, for `allowed`, or None (no such account,
    or the accounts store could not be read): unknown is never sent to."""
    try:
        from api.services import auth_service                   # noqa: PLC0415 - lazy
        user = auth_service.get_user_by_id(str(user_id))
        if not user:
            return None
        user["plan"] = auth_service.get_user_plan(user["id"])
        return user
    except Exception:                                           # noqa: BLE001
        return None


def _session_for(now):
    """``(session, None)`` when ``now`` is late enough after a trading day's close, else
    ``(None, why)``. The session is the Eastern calendar day of ``now``."""
    from api.services import session_calendar as cal            # noqa: PLC0415 - lazy
    at = now.astimezone(cal.ET)
    day = at.date()
    if not cal.is_trading_day(day):
        return None, "not_a_trading_day"
    close = cal.close_time(day)
    if close is None or at < close + datetime.timedelta(minutes=AFTER_CLOSE_MINUTES):
        return None, "before_the_close"
    return day.isoformat(), None


def _kind_receipt() -> dict:
    return {"state": None, "on_list": 0, "new": 0, "subscribers": 0, "sent": 0, "quiet": 0,
            "skipped_dedup": 0, "suspended": 0, "not_allowed": 0, "errors": 0}


def run_evening(now=None, *, deliver=None, routing=None, loaders=None, follows=None) -> dict:
    """Read each list once and tell every subscribed member which of their stocks came
    onto it. Returns a receipt; never raises.

    ``now`` is a timezone-aware instant (default: now). ``deliver``, ``routing``,
    ``loaders`` (``{kind: fn(session)}``) and ``follows`` (``fn(user_ids) -> {uid: set}``)
    are injected by tests; the defaults are the real delivery, the member's routing rule,
    the three lists and `member_interest.own_list_symbols_by_user`."""
    receipt = {"mode": mode(), "session": None, "reason": None, "members": 0, "sent": 0,
               "errors": 0, "kinds": {k: _kind_receipt() for k in KINDS}}
    if receipt["mode"] == "off":
        receipt["reason"] = "disabled"
        return receipt
    try:
        _run(receipt, now, deliver, routing, loaders, follows)
    except Exception as e:                                      # noqa: BLE001 - never costs the scheduler
        receipt["errors"] += 1
        receipt["reason"] = f"{type(e).__name__}: {e}"[:200]
        log.warning("[list-alerts] run failed", exc_info=True)
    receipt["sent"] = sum(k["sent"] for k in receipt["kinds"].values())
    log.info("[list-alerts] %s", receipt)
    return receipt


def _run(receipt, now, deliver, routing, loaders, follows) -> None:
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    session, why = _session_for(now)
    if not session:
        receipt["reason"] = why
        return
    receipt["session"] = session

    with _db() as conn:
        subs = [(r[0], r[1]) for r in conn.execute(
            "SELECT user_id, kind FROM list_alert_subs ORDER BY user_id, kind")]
    by_member: dict = {}
    for uid, kind in subs:
        if kind in KINDS:
            by_member.setdefault(uid, set()).add(kind)
    receipt["members"] = len(by_member)

    # The members' names FIRST: if they cannot be read, nothing is read, sent or recorded.
    names = {}
    if by_member:
        if follows is None:
            from api.services import member_interest            # noqa: PLC0415 - lazy
            follows = member_interest.own_list_symbols_by_user
        try:
            names = follows(sorted(by_member)) or {}
        except Exception as e:                                  # noqa: BLE001
            receipt["errors"] += 1
            receipt["reason"] = f"follows_unreadable: {type(e).__name__}"
            log.warning("[list-alerts] members' names not read", exc_info=True)
            return

    if deliver is None:
        from api.services.watchlist_alert_service import deliver_alert_payload  # noqa: PLC0415
        deliver = deliver_alert_payload
    if routing is None:
        from api.services.alert_taxonomy import routing_rule    # noqa: PLC0415
        routing = routing_rule.effective
    loaders = {**LOADERS, **(loaders or {})}

    for kind in KINDS:
        out = receipt["kinds"][kind]
        try:
            loaded = loaders[kind](session)
        except Exception:                                       # noqa: BLE001 - one list never stops the run
            loaded = {"state": "error"}
            log.warning("[list-alerts] %s not read", kind, exc_info=True)
        if not isinstance(loaded, dict) or loaded.get("state") != "ok":
            # ⛔ A list that did not load: nothing sent, nothing recorded.
            out["state"] = (loaded or {}).get("state") if isinstance(loaded, dict) else "error"
            out["state"] = out["state"] or "error"
            if out["state"] == "error":
                out["errors"] += 1
            continue
        rows = [r for r in (loaded.get("rows") or []) if r.get("key") and r.get("sym")]
        out["on_list"] = len(rows)
        try:
            seen = _advance(kind, session, [r["key"] for r in rows])
        except Exception:                                       # noqa: BLE001
            out["state"] = "error"
            out["errors"] += 1
            log.warning("[list-alerts] %s not recorded", kind, exc_info=True)
            continue
        if not seen["announce"]:
            out["state"] = "baseline"                           # recorded; nothing to compare with
            continue
        out["state"] = "ok"
        fresh = [r for r in rows if r["key"] in seen["new"]]
        out["new"] = len(fresh)
        context = loaded.get("context") or {}
        for uid in sorted(u for u, kinds in by_member.items() if kind in kinds):
            out["subscribers"] += 1
            try:
                _send_member(out, uid, kind, session, fresh, names.get(uid) or set(), context,
                             deliver, routing)
            except Exception:                                   # noqa: BLE001 - one member never stops the run
                out["errors"] += 1
                log.warning("[list-alerts] member %s failed on %s", uid, kind, exc_info=True)
    receipt["errors"] += sum(k["errors"] for k in receipt["kinds"].values())
    _prune(session)


def _send_member(out, uid, kind, session, fresh, follows, context, deliver, routing) -> None:
    mine = [r for r in fresh if r["sym"] in follows]
    if not mine:
        out["quiet"] += 1
        return
    if not allowed(_member(uid)):
        out["not_allowed"] += 1                                 # nothing recorded
        return
    rule = routing(uid)
    suspended = rule is not None and getattr(rule, "suspended", False)
    # The member paused every alert: recorded as said, nothing sent, so resuming later the
    # same evening does not send what was held back.
    claimed = _claim(uid, kind, session, [r["key"] for r in mine],
                     OUTCOME_SUSPENDED if suspended else OUTCOME_SENT)
    if not claimed:
        out["skipped_dedup"] += 1
        return
    if suspended:
        out["suspended"] += 1
        return
    said = set(claimed)
    rows = [r for r in mine if r["key"] in said]
    try:
        title, message = compose(kind, rows, session, context)
        symbols = list(dict.fromkeys(r["sym"] for r in rows))
        report = deliver(
            user_id=str(uid), sym=symbols[0] if len(symbols) == 1 else "MARKET",
            title=title, message=message, source=SOURCE,
            # A note about a list, not a warning about a stock.
            severity="info",
            extra_data={"kind": kind, "session": session, "symbols": symbols,
                        "keys": [r["key"] for r in rows],
                        # the bell's own click-through key: it opens the list
                        "research_url": list_link(kind)},
            **({"channels_allowed": rule.channels_allowed()} if rule is not None else {}))
    except Exception:
        _release(uid, kind, session)
        raise
    if _reached_nobody(report):
        _release(uid, kind, session)
        out["errors"] += 1
    else:
        out["sent"] += 1
