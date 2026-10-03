"""The market context frozen at the fill: the ONE authority (wave 13, lane 13E-1).

When a member enters a position, this module freezes what the market looked like that day,
ONCE, under the key (member, symbol, entry day ET). The 13E-2 card, 13F's leak finder
("regime at entry", "held into earnings") and 13I-2's playbook filters read it from here and
nowhere else (WAVE-13-PLAN.md section 3.1, A.13E).

THE KEY IS (member, symbol, entry day ET), NEVER A POSITION ID. Broker trades carry a sentinel
`position_id` (`trades.bulk_insert_trades` mints `manual-<uuid>`, trades.py:773, :851) and
broker positions store `'{}'` context (`broker/balances.py`:425-429), so an id cannot carry
the context from the open position to the closed trade. The entry day is
`timeutil.compute_trading_day_et(entry_date)` -- the same ET-day spine `j2_trades.trading_day_et`
is written with (db.py:1737), applied to the ENTRY timestamp (that column holds the exit day).
A closed trade reaches its context by `contexts_for_trades` on that key.

EVERY FIELD IS REUSED, NEVER RE-DERIVED, and each carries its own source and as-of:

  field                  source (file:line, function)
  regime                 journal_two/regime.py:54 get_current_regime (the label it classifies
                         from the wire's UCT Exposure Rating); the as-of is the wire run's
                         own date, engine.py:439 get_breadth()["wire_date"]
  exposure               the same read: get_current_regime()["score"], the wire's UCT Exposure
                         Rating (the one exposure authority)
  breadth_pct_above_50   breadth_live.py:1611 compute_live(cached_only=True)
                         ["metrics"]["pct_above_50sma"] (never recomputes; a cold cache is
                         not paid for here); when that cache is cold, the wire's daily
                         engine.py:439 get_breadth()["pct_above_50ma"], under its OWN source
                         string and as-of so a reader can tell the two universes apart
  rs_rank                rs_ranking.py:287 get_rs_for_ticker (cached rankings only); a miss is
                         told apart as "cache cold" vs "not ranked" by rs_ranking.py:260
                         cached_rank_map, the one by-symbol reader of that cache
  days_to_earnings       earnings_table.py:393 _next_report_date (calendar days from the
                         as-of day to that date)
  uct_scans              engine.py:2746 get_candidates (the envelope's market_date is the
                         as-of) and engine.py:2805 candidate_tickers, per bucket the scan wrote
  member_screens         the member's saved screens, user_definitions.py:1670 list_for_user,
                         each one's latest swept session screener/scan_store.py:532
                         latest_covered_as_of and its hits scan_store.py:270 hits -- the
                         nightly results GET /api/scans/definition-results serves
                         (scan_results.py:107)
  fingerprint            journal_two/tech_fingerprint.py:403 compute (lane 13I-1), CALLED as of
                         the entry day; never re-derived here

⛔ MISSING IS LABELLED, NEVER INVENTED. Every field is
``{"value", "source", "asOf", "missing", "detail"}``; a field with a ``missing`` code has
``value: None``, and the codes are `MISSING_REASONS`.

⛔⛔ FROZEN ONCE. `freeze` writes with INSERT OR IGNORE and nothing ever UPDATEs a context:
a second open, a re-sync, a later sweep or a changed source leaves the row exactly as it
was. The member's "why did you take it" note (`set_why`) is the one thing that changes, and
it writes only its own two columns.

WHEN IT FREEZES (and only while `NOTEBOOK_ENTRY_CONTEXT_ENABLED` is on):
  * a manual position add (`on_position_added`, called by the add route AFTER the position
    is written, off the request);
  * a broker sync (`after_broker_sync`), a hook that runs AFTER the sync job finishes,
    through an APScheduler listener (`install_scheduler_hooks`) -- no broker or positions
    code is edited, the hook only READS j2_positions / j2_trades, and it never raises;
  * a sweep every 10 minutes in market hours (the same function), for any path the
    listener does not see (a member's "Sync now", a CSV import);
  * on demand, when a position's or trade's page reads it (the router).
  Each of those freezes only an entry whose day IS TODAY (ET): that is "at entry". A past
  day reads NOT CAPTURED and is never reconstructed as if frozen. The one exception is
  `backfill_open_positions`, which freezes TODAY's context for an existing open position
  and labels it ``captured_late`` with the capture day -- a reader that wants "the market at
  the fill" (13F) must use ``captureKind == "at_entry"`` rows only.
  A broker position whose entry day is a placeholder (``entry_estimated = 1``, a carried-in
  holding, balances.py:391-407) has NO known entry day and is never keyed.

⛔ NO MODEL CALL. One vendor read is reachable: `_next_report_date` (FMP, then Finnhub), the
authority the plan names for the report date; it runs in the scheduler thread or after the
add response, never on a member's request path except the on-demand read.

THE BELL (lane 13E-2): one in-app notification per member per ET day for a NEW fill, through
the same claim-then-deliver idiom `note_tasks.py` uses for its task reminders (an atomic
``INSERT OR IGNORE`` on ``(user_id, day)`` is the claim; a delivery that raises releases it so
a later freeze that day retries; `api.services.alerts.add_alert` at severity ``info`` is the
one delivery channel, same as `note_tasks._deliver_in_app` -- never email). `notify_new_fill`
fires from `capture_at_entry` exactly when THAT call freshly froze an entry (never on an
``already_frozen`` answer, and `backfill_open_positions` never calls `capture_at_entry` at
all, so a backfill for an older position never rings it): manual add, broker sync, the
market-hours sweep and an on-demand page open each route through it, and the per-day claim is
what turns "however many fills today" into exactly one line.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from api.services.journal_two.timeutil import compute_trading_day_et
from api.services.notebook_flags import flag_on

log = logging.getLogger(__name__)

#: The enablement gate (unset = OFF; plan section 3.6).
FLAG = "NOTEBOOK_ENTRY_CONTEXT_ENABLED"


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(FLAG, False)


#: Bumped only if a field's MEANING changes; a frozen row keeps the version it was built under.
CONTEXT_VERSION = 1

#: The fields, in display order.
FIELDS = (
    "regime", "exposure", "breadth_pct_above_50", "rs_rank", "days_to_earnings",
    "uct_scans", "member_screens", "fingerprint",
)

#: How a row came to be. ``at_entry``: frozen on the entry day. ``captured_late``: the
#: backfill froze TODAY's market for an older open position (the row says so, with the day).
CAPTURE_KINDS = ("at_entry", "captured_late")

#: What asked for the freeze (stored for the record, never used to decide a value).
TRIGGERS = ("manual_add", "broker_sync", "sweep", "on_demand", "backfill")

#: The ``missing`` codes. Each is a statement about the DATA, never a default.
MISSING_REASONS = {
    "source_error": "the source could not be read when the context was frozen",
    "wire_unavailable": "the morning wire's exposure block was not available",
    "breadth_unavailable": "no warm live breadth reading and no wire breadth value",
    "rs_cache_cold": "the RS rankings cache was cold (the background warmer had not run)",
    "rs_not_ranked": "the symbol is not in the RS-ranked universe",
    "no_report_date": "no upcoming report date was found for the symbol",
    "no_scan_published": "no UCT scanner run had been published",
    "no_screens_swept": "none of the member's saved screens had a nightly sweep",
    "bad_symbol": "the symbol is not one the chart data can be read for",
}

#: Not-captured statuses a read can answer (never a guessed context).
NOT_CAPTURED_REASONS = {
    "not_captured": "No market context was captured for this entry. It is frozen only on the "
                    "day of the entry, and a past day is never reconstructed.",
    "entry_day_unknown": "The broker reported this holding without its entry date, so there is "
                         "no entry day to freeze a market context for.",
}

#: The member's "why did you take it" note, at most this many characters.
WHY_MAX_CHARS = 500

#: Entries one sweep freezes at most (each pays one report-date read).
SWEEP_BUDGET = 50

#: Open positions one member's backfill freezes at most.
BACKFILL_BUDGET = 25

#: Rows one list read returns at most.
LIST_LIMIT = 500

#: Saved screens one capture consults at most (two indexed reads each).
SCREENS_LIMIT = 50

#: The APScheduler jobs whose completion is "a broker sync just wrote".
#: (api/main.py: broker_sync_due, broker_sync_warming, broker_sync_nightly_reconcile,
#: broker_recent_orders_poll.)
BROKER_SYNC_JOB_IDS = frozenset({
    "broker_sync_due", "broker_sync_warming", "broker_sync_nightly_reconcile",
    "broker_recent_orders_poll",
})
AFTER_SYNC_JOB_ID = "notebook_entry_context_after_sync"
SWEEP_JOB_ID = "notebook_entry_context_sweep"

SRC_REGIME = "journal_two.regime.get_current_regime"
SRC_EXPOSURE = "journal_two.regime.get_current_regime (wire UCT Exposure Rating)"
SRC_BREADTH_LIVE = "breadth_live.compute_live(cached_only) pct_above_50sma"
SRC_BREADTH_WIRE = "engine.get_breadth pct_above_50ma (the wire's daily breadth)"
SRC_RS = "rs_ranking.get_rs_for_ticker"
SRC_EARNINGS = "earnings_table._next_report_date"
SRC_UCT_SCANS = "engine.get_candidates / engine.candidate_tickers"
SRC_SCREENS = "user_definitions.list_for_user + screener.scan_store.hits"
SRC_FINGERPRINT = "journal_two.tech_fingerprint.compute"

#: The bell -- one in-app notice per member per ET day for a new fill (lane 13E-2).
BELL_SOURCE = "notebook_entry_context_new_fill"
BELL_TITLE = "New fill captured"
BELL_MESSAGE = "A new fill's market context was captured in your Notebook."
BELL_VIEW_URL = "/journal?j2tab=positions"

_DDL = (
    """CREATE TABLE IF NOT EXISTS j2_entry_context (
        user_id         TEXT NOT NULL,
        symbol          TEXT NOT NULL,
        entry_day_et    TEXT NOT NULL,
        capture_kind    TEXT NOT NULL CHECK(capture_kind IN ('at_entry','captured_late')),
        capture_day_et  TEXT NOT NULL,
        captured_at     TEXT NOT NULL,
        trigger_source  TEXT NOT NULL,
        version         INTEGER NOT NULL,
        context         TEXT NOT NULL,
        why_text        TEXT,
        why_updated_at  TEXT,
        PRIMARY KEY (user_id, symbol, entry_day_et)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_j2_entry_context_day ON j2_entry_context(entry_day_et)",
    # Lane 13E-2's bell dedup -- the claim table for "one new-fill notice a day". No name
    # column (address_space.saved_object_tables only counts an owned, NAMED table).
    """CREATE TABLE IF NOT EXISTS j2_entry_context_bell_log (
        user_id     TEXT NOT NULL,
        day         TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, day)
    )""",
)


def ensure_schema(conn: sqlite3.Connection) -> None:
    for stmt in _DDL:
        conn.execute(stmt)


def _connect() -> sqlite3.Connection:
    from api.services.auth_db import get_connection
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


class _Conn:
    """Use the caller's connection, or open (and close) one."""

    def __init__(self, conn: sqlite3.Connection | None):
        self.owned = conn is None
        self.conn = conn

    def __enter__(self) -> sqlite3.Connection:
        if self.conn is None:
            self.conn = _connect()
        else:
            if self.conn.row_factory is None:
                self.conn.row_factory = sqlite3.Row
            ensure_schema(self.conn)
        return self.conn

    def __exit__(self, *exc) -> None:
        if self.owned and self.conn is not None:
            self.conn.close()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_et() -> str:
    from api.services.journal_two.calendar import et_today
    return et_today()


class EntryContextRequestError(ValueError):
    """A request the caller must fix (a bad symbol, day or note)."""


def clean_symbol(symbol: Any) -> str:
    s = symbol.strip().upper() if isinstance(symbol, str) else ""
    if not s or len(s) > 16 or not all(c.isalnum() or c in ".-/" for c in s):
        raise EntryContextRequestError("A symbol is letters, digits, '.', '-' or '/', up to 16.")
    return s


def clean_day(day: Any) -> str:
    try:
        return date.fromisoformat(str(day)[:10]).isoformat() if day else ""
    except ValueError:
        raise EntryContextRequestError("A day is YYYY-MM-DD.") from None


def entry_day_for(entry_date: Any) -> str | None:
    """The ET entry day of a stored entry timestamp (the journal's own spine)."""
    return compute_trading_day_et(str(entry_date)) if entry_date else None


# ── one field ─────────────────────────────────────────────────────────────────────────────

def _field(value: Any, source: str, as_of: Any, detail: dict | None = None) -> dict:
    return {"value": value, "source": source, "asOf": as_of, "missing": None,
            "detail": detail or None}


def _missing(source: str, code: str, detail: dict | None = None) -> dict:
    assert code in MISSING_REASONS, code
    return {"value": None, "source": source, "asOf": None, "missing": code,
            "detail": detail or None}


def _guard(source: str, fn, *args) -> dict:
    """`fn(*args)`, or the field saying its source could not be read. Never raises."""
    try:
        return fn(*args)
    except Exception:  # noqa: BLE001 -- one source never takes the whole context down
        log.warning("[entry_context] %s unreadable", source, exc_info=True)
        return _missing(source, "source_error")


# ── the sources (each a reuse; see the table in the module docstring) ─────────────────────

def _wire_breadth() -> dict:
    from api.services import engine
    payload = engine.get_breadth()
    return payload if isinstance(payload, dict) else {}


def _regime_fields(memo: dict) -> tuple[dict, dict]:
    if "regime" in memo:
        return memo["regime"]
    from api.services.journal_two import regime as regime_service
    try:
        now = regime_service.get_current_regime() or {}
        as_of = now.get("asOf")
        if as_of is None and now.get("regime") is not None:
            # get_current_regime reads engine.get_breadth()["exposure"], whose normalised
            # block carries no date; the payload's own wire_date is that run's date.
            as_of = _wire_breadth().get("wire_date")
        if now.get("regime") is None or now.get("score") is None:
            out = (_missing(SRC_REGIME, "wire_unavailable"), _missing(SRC_EXPOSURE, "wire_unavailable"))
        else:
            out = (_field(now["regime"], SRC_REGIME, as_of),
                   _field(float(now["score"]), SRC_EXPOSURE, as_of))
    except Exception:  # noqa: BLE001
        log.warning("[entry_context] regime unreadable", exc_info=True)
        out = (_missing(SRC_REGIME, "source_error"), _missing(SRC_EXPOSURE, "source_error"))
    memo["regime"] = out
    return out


def _breadth_field(memo: dict) -> dict:
    if "breadth" in memo:
        return memo["breadth"]

    def read() -> dict:
        from api.services import breadth_live
        live = breadth_live.compute_live(cached_only=True) or {}
        if live.get("ok"):
            v = (live.get("metrics") or {}).get("pct_above_50sma")
            if v is not None:
                return _field(float(v), SRC_BREADTH_LIVE, live.get("as_of"),
                              {"universe": "live", "measured": live.get("measured"),
                               "degraded": live.get("degraded")})
        wire = _wire_breadth()
        v = wire.get("pct_above_50ma")
        if v is not None:
            return _field(float(v), SRC_BREADTH_WIRE, wire.get("wire_date"),
                          {"universe": "wire", "liveUnavailable": live.get("reason")})
        return _missing(SRC_BREADTH_LIVE, "breadth_unavailable",
                        {"liveUnavailable": live.get("reason")})

    memo["breadth"] = _guard(SRC_BREADTH_LIVE, read)
    return memo["breadth"]


def _rs_field(symbol: str, read_at: str) -> dict:
    def read() -> dict:
        from api.services import rs_ranking
        row = rs_ranking.get_rs_for_ticker(symbol)
        if row and row.get("rs_rank") is not None:
            return _field(row.get("rs_rank"), SRC_RS, read_at, {"rsScore": row.get("rs_score")})
        code = "rs_not_ranked" if rs_ranking.cached_rank_map() else "rs_cache_cold"
        return _missing(SRC_RS, code)
    return _guard(SRC_RS, read)


def _earnings_field(symbol: str, as_of_day: str, read_at: str) -> dict:
    def read() -> dict:
        from api.services import earnings_table
        nxt = earnings_table._next_report_date(symbol)
        day = str(nxt)[:10] if nxt else None
        if not day:
            return _missing(SRC_EARNINGS, "no_report_date")
        days = (date.fromisoformat(day) - date.fromisoformat(as_of_day)).days
        if days < 0:
            return _missing(SRC_EARNINGS, "no_report_date", {"staleReportDate": day})
        return _field(days, SRC_EARNINGS, read_at, {"reportDate": day, "countedFrom": as_of_day})
    return _guard(SRC_EARNINGS, read)


def _candidates_envelope(memo: dict) -> dict:
    if "candidates" not in memo:
        from api.services import engine
        memo["candidates"] = engine.get_candidates() or {}
    return memo["candidates"]


def _uct_scans_field(symbol: str, memo: dict) -> dict:
    def read() -> dict:
        from api.services import engine
        env = _candidates_envelope(memo)
        as_of = env.get("market_date") or env.get("generated_at")
        groups = env.get("candidates")
        if not as_of or not isinstance(groups, dict):
            return _missing(SRC_UCT_SCANS, "no_scan_published")
        on = [bucket for bucket in groups if symbol in engine.candidate_tickers(bucket)]
        return _field(on, SRC_UCT_SCANS, as_of, {"scans": list(groups)})
    return _guard(SRC_UCT_SCANS, read)


def _member_screens_field(user_id: str, symbol: str, memo: dict) -> dict:
    key = ("screens", user_id)

    def swept() -> list[dict]:
        if key not in memo:
            from api.services import user_definitions
            from api.services.screener import scan_store
            out = []
            for d in user_definitions.list_for_user(user_id)[:SCREENS_LIMIT]:
                h = d.get("ast_hash")
                if not h:
                    continue
                as_of = scan_store.latest_covered_as_of(h, "D")
                if as_of is None:
                    continue
                name = ((d.get("definition") or {}).get("meta") or {}).get("name") or "Untitled"
                out.append({"defId": d.get("def_id"), "name": name, "asOf": str(as_of),
                            "hits": set(scan_store.hits(h, "D", as_of))})
            memo[key] = out
        return memo[key]

    def read() -> dict:
        screens = swept()
        if not screens:
            return _missing(SRC_SCREENS, "no_screens_swept")
        on = [{"defId": s["defId"], "name": s["name"], "asOf": s["asOf"]}
              for s in screens if symbol in s["hits"]]
        return _field(on, SRC_SCREENS, max(s["asOf"] for s in screens), {"swept": len(screens)})
    return _guard(SRC_SCREENS, read)


def _fingerprint_field(symbol: str, entry_day: str) -> dict:
    from api.services.journal_two import tech_fingerprint as tfp
    try:
        fp = tfp.compute(symbol, entry_day)
    except tfp.FingerprintRequestError:
        return _missing(SRC_FINGERPRINT, "bad_symbol")
    except Exception:  # noqa: BLE001 -- an unreadable store is a labelled gap, never a guess
        log.warning("[entry_context] fingerprint unreadable for %s %s", symbol, entry_day,
                    exc_info=True)
        return _missing(SRC_FINGERPRINT, "source_error")
    return _field(fp, SRC_FINGERPRINT, (fp or {}).get("as_of"),
                  {"version": (fp or {}).get("v"), "mode": (fp or {}).get("mode")})


def build_context(user_id: str, symbol: str, entry_day: str, *, capture_day: str,
                  memo: dict | None = None) -> dict[str, dict]:
    """Every field, read NOW (the market fields) and as of the entry day (the fingerprint).

    Never raises for a source: each one that fails or answers nothing is a labelled gap.
    `memo` shares the market-wide reads across the entries of one sweep."""
    memo = {} if memo is None else memo
    read_at = _now_iso()
    regime, exposure = _regime_fields(memo)
    return {
        "regime": regime,
        "exposure": exposure,
        "breadth_pct_above_50": _breadth_field(memo),
        "rs_rank": _rs_field(symbol, read_at),
        "days_to_earnings": _earnings_field(symbol, capture_day, read_at),
        "uct_scans": _uct_scans_field(symbol, memo),
        "member_screens": _member_screens_field(user_id, symbol, memo),
        "fingerprint": _fingerprint_field(symbol, entry_day),
    }


# ── the store ─────────────────────────────────────────────────────────────────────────────

def _serialize(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    try:
        fields = json.loads(row["context"])
    except (TypeError, ValueError):
        fields = {}
    why = ({"text": row["why_text"], "updatedAt": row["why_updated_at"]}
           if row["why_text"] else None)
    return {
        "symbol": row["symbol"],
        "entryDay": row["entry_day_et"],
        "captureKind": row["capture_kind"],
        "capturedLate": row["capture_kind"] == "captured_late",
        "captureDay": row["capture_day_et"],
        "capturedAt": row["captured_at"],
        "trigger": row["trigger_source"],
        "version": row["version"],
        "fields": {f: fields.get(f) for f in FIELDS},
        "why": why,
    }


def _row(conn: sqlite3.Connection, user_id: str, symbol: str, entry_day: str):
    return conn.execute(
        "SELECT * FROM j2_entry_context WHERE user_id = ? AND symbol = ? AND entry_day_et = ?",
        (str(user_id), symbol, entry_day)).fetchone()


def get_context(user_id: str, symbol: str, entry_day: str,
                conn: sqlite3.Connection | None = None) -> dict | None:
    """The frozen context for (member, symbol, entry day), or None (not captured)."""
    sym, day = clean_symbol(symbol), clean_day(entry_day)
    with _Conn(conn) as c:
        return _serialize(_row(c, user_id, sym, day))


def freeze(user_id: str, symbol: str, entry_day: str, *, capture_kind: str, trigger: str,
           conn: sqlite3.Connection | None = None, memo: dict | None = None,
           capture_day: str | None = None) -> dict:
    """Freeze the context for (member, symbol, entry day) ONCE.

    Returns ``{"frozen": bool, "context": dict}``. A key that already holds a row is
    answered from that row and nothing is read or computed again: the first freeze wins,
    for ever (INSERT OR IGNORE also settles two writers racing)."""
    if capture_kind not in CAPTURE_KINDS:
        raise ValueError(capture_kind)
    if trigger not in TRIGGERS:
        raise ValueError(trigger)
    sym, day = clean_symbol(symbol), clean_day(entry_day)
    if not day:
        raise EntryContextRequestError("An entry needs its day.")
    with _Conn(conn) as c:
        existing = _row(c, user_id, sym, day)
        if existing is not None:
            return {"frozen": False, "context": _serialize(existing)}
        cap_day = capture_day or today_et()
        fields = build_context(str(user_id), sym, day, capture_day=cap_day, memo=memo)
        cur = c.execute(
            "INSERT OR IGNORE INTO j2_entry_context (user_id, symbol, entry_day_et, capture_kind,"
            " capture_day_et, captured_at, trigger_source, version, context)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (str(user_id), sym, day, capture_kind, cap_day, _now_iso(), trigger, CONTEXT_VERSION,
             json.dumps(fields, separators=(",", ":"), default=str)))
        c.commit()
        return {"frozen": cur.rowcount == 1, "context": _serialize(_row(c, user_id, sym, day))}


def _deliver_bell(user_id: str, day: str) -> None:
    """The in-app bell ONLY -- same channel note_tasks._deliver_in_app uses, `info` severity
    (below the Discord threshold), never email."""
    from api.services.alerts import add_alert
    add_alert(BELL_SOURCE, BELL_TITLE, BELL_MESSAGE, severity="info",
             data={"source": BELL_SOURCE, "day": day, "research_url": BELL_VIEW_URL}, user_id=user_id)


def notify_new_fill(user_id: str, day: str, *, conn: sqlite3.Connection | None = None,
                    deliver=None) -> bool:
    """ONE in-app bell per member per ET day for a freshly captured fill.

    Claims atomically -- an ``INSERT OR IGNORE`` on ``(user_id, day)``, the same idiom `freeze`
    uses for the context row itself -- so of however many entries freeze for one member on one
    day, only the first one delivers. A delivery that raises releases the claim, so a LATER
    freeze that same day retries it; this never raises itself, so a bell failure can never fail
    the capture that triggered it. Returns whether a bell was actually sent (tests only; no
    caller branches on it)."""
    deliver = deliver or _deliver_bell
    try:
        with _Conn(conn) as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO j2_entry_context_bell_log (user_id, day, created_at)"
                " VALUES (?, ?, ?)", (str(user_id), day, _now_iso()))
            c.commit()
            if cur.rowcount == 0:
                return False
            try:
                deliver(str(user_id), day)
            except Exception:  # noqa: BLE001 -- a bell failure must never surface
                c.execute("DELETE FROM j2_entry_context_bell_log WHERE user_id = ? AND day = ?",
                         (str(user_id), day))
                c.commit()
                return False
            return True
    except Exception:  # noqa: BLE001 -- never fails the capture that asked for it
        log.warning("[entry_context] bell notify failed for %s", user_id, exc_info=True)
        return False


def capture_at_entry(user_id: str, symbol: str, entry_date: Any, *, trigger: str,
                     entry_estimated: bool = False, conn: sqlite3.Connection | None = None,
                     memo: dict | None = None, today: str | None = None, notify: bool = True,
                     notify_deliver=None) -> dict:
    """Freeze the context if, and only if, this entry's day is TODAY (ET).

    ``{"status": "frozen" | "already_frozen" | "not_entry_day" | "entry_day_unknown", ...}``.
    A past day is never captured here (it reads "not captured"); a carried-in broker holding
    (`entry_estimated`) has no entry day to key. A FRESH freeze (status "frozen", never
    "already_frozen") also rings the one-a-day bell (`notify_new_fill`) -- `notify=False` is
    for a caller that never wants one (none exists today; the seam is here for 13F/future)."""
    if entry_estimated:
        return {"status": "entry_day_unknown"}
    day = entry_day_for(entry_date)
    if not day:
        return {"status": "entry_day_unknown"}
    today = today or today_et()
    if day != today:
        return {"status": "not_entry_day", "entryDay": day}
    out = freeze(user_id, symbol, day, capture_kind="at_entry", trigger=trigger, conn=conn,
                 memo=memo, capture_day=today)
    if out["frozen"] and notify:
        notify_new_fill(user_id, today, conn=conn, deliver=notify_deliver)
    return {"status": "frozen" if out["frozen"] else "already_frozen", "entryDay": day,
            "context": out["context"]}


def set_why(user_id: str, symbol: str, entry_day: str, text: Any,
            conn: sqlite3.Connection | None = None) -> dict | None:
    """Set (or, with an empty text, clear) the member's "why did you take it" note.

    Writes ONLY the two why columns; the frozen context is untouched. None when the key has
    no captured context (there is nothing to attach the note to)."""
    if text is not None and not isinstance(text, str):
        raise EntryContextRequestError("The note is text.")
    clean = (text or "").strip()
    if len(clean) > WHY_MAX_CHARS:
        raise EntryContextRequestError(f"The note is at most {WHY_MAX_CHARS} characters.")
    sym, day = clean_symbol(symbol), clean_day(entry_day)
    with _Conn(conn) as c:
        cur = c.execute(
            "UPDATE j2_entry_context SET why_text = ?, why_updated_at = ?"
            " WHERE user_id = ? AND symbol = ? AND entry_day_et = ?",
            (clean or None, _now_iso() if clean else None, str(user_id), sym, day))
        c.commit()
        if cur.rowcount == 0:
            return None
        return _serialize(_row(c, user_id, sym, day))


def list_contexts(user_id: str, *, since: str | None = None, until: str | None = None,
                  symbol: str | None = None, limit: int = LIST_LIMIT,
                  conn: sqlite3.Connection | None = None) -> list[dict]:
    """The member's frozen contexts, newest entry day first (13F, 13I-2)."""
    sql = ["SELECT * FROM j2_entry_context WHERE user_id = ?"]
    args: list[Any] = [str(user_id)]
    if since:
        sql.append("AND entry_day_et >= ?")
        args.append(clean_day(since))
    if until:
        sql.append("AND entry_day_et <= ?")
        args.append(clean_day(until))
    if symbol:
        sql.append("AND symbol = ?")
        args.append(clean_symbol(symbol))
    sql.append("ORDER BY entry_day_et DESC, symbol LIMIT ?")
    args.append(max(1, min(int(limit), LIST_LIMIT)))
    with _Conn(conn) as c:
        return [_serialize(r) for r in c.execute(" ".join(sql), args).fetchall()]


def contexts_for_trades(user_id: str, trades: Iterable[dict],
                        conn: sqlite3.Connection | None = None) -> dict[str, dict | None]:
    """``{trade id: context or None}`` for trades as the journal serialises them
    (``id``, ``symbol``, ``entryDate``). The join is the KEY, never ``positionId``: a broker
    trade's position id is a sentinel."""
    keyed: dict[str, tuple[str, str] | None] = {}
    for t in trades:
        tid = str(t.get("id"))
        try:
            sym = clean_symbol(t.get("symbol"))
        except EntryContextRequestError:
            keyed[tid] = None
            continue
        day = entry_day_for(t.get("entryDate"))
        keyed[tid] = (sym, day) if day else None
    days = sorted({k[1] for k in keyed.values() if k})
    found: dict[tuple[str, str], dict] = {}
    if days:
        with _Conn(conn) as c:
            marks = ",".join("?" * len(days))
            for r in c.execute(f"SELECT * FROM j2_entry_context WHERE user_id = ?"
                               f" AND entry_day_et IN ({marks})", (str(user_id), *days)):
                found[(r["symbol"], r["entry_day_et"])] = _serialize(r)
    return {tid: (found.get(k) if k else None) for tid, k in keyed.items()}


def _position_entry(conn: sqlite3.Connection, user_id: str, position_id: str):
    return conn.execute(
        "SELECT id, symbol, entry_date, entry_estimated, closed_at FROM j2_positions"
        " WHERE user_id = ? AND id = ?", (str(user_id), position_id)).fetchone()


def _trade_entry(conn: sqlite3.Connection, user_id: str, trade_id: str):
    return conn.execute(
        "SELECT id, symbol, entry_date, position_id FROM j2_trades WHERE user_id = ? AND id = ?",
        (str(user_id), trade_id)).fetchone()


def read_for(user_id: str, kind: str, item_id: str, *, capture: bool = True,
             conn: sqlite3.Connection | None = None, today: str | None = None) -> dict | None:
    """The context for one of the member's positions or trades, by the KEY.

    None when the item is not the member's. When `capture` and the entry is today's and not
    yet frozen, freezes it now (on demand, at entry). Answers a status, never a guess."""
    with _Conn(conn) as c:
        row = (_position_entry(c, user_id, item_id) if kind == "position"
               else _trade_entry(c, user_id, item_id))
        if row is None:
            return None
        estimated = kind == "position" and bool(row["entry_estimated"])
        day = None if estimated else entry_day_for(row["entry_date"])
        try:
            sym = clean_symbol(row["symbol"])
        except EntryContextRequestError:
            sym = None
        if sym is None or day is None:
            return {"status": "entry_day_unknown", "key": None, "context": None,
                    "reason": NOT_CAPTURED_REASONS["entry_day_unknown"]}
        key = {"symbol": sym, "entryDay": day}
        ctx = _serialize(_row(c, user_id, sym, day))
        if ctx is None and capture:
            out = capture_at_entry(user_id, sym, row["entry_date"], trigger="on_demand",
                                   conn=c, today=today)
            ctx = out.get("context")
        if ctx is None:
            return {"status": "not_captured", "key": key, "context": None,
                    "reason": NOT_CAPTURED_REASONS["not_captured"]}
        return {"status": "captured", "key": key, "context": ctx, "reason": None}


# ── the doors that freeze ─────────────────────────────────────────────────────────────────

def on_position_added(user_id: str, position: Any) -> dict:
    """The manual add's hook: runs AFTER the position is written (the add route schedules it
    after its response). Reads the returned position only; never raises."""
    try:
        if not enabled() or not isinstance(position, dict):
            return {"status": "skipped"}
        return capture_at_entry(user_id, position.get("symbol"), position.get("entryDate"),
                                trigger="manual_add",
                                entry_estimated=bool(position.get("entryEstimated")))
    except Exception as e:  # noqa: BLE001 -- the add already succeeded; this never fails it
        log.warning("[entry_context] manual-add capture failed for %s", user_id, exc_info=True)
        return {"status": "error", "error": type(e).__name__}


def _todays_entries(conn: sqlite3.Connection, today: str) -> list[dict]:
    """(member, symbol, entry date) for every entry whose ET day is `today`: open positions
    with a known entry day, and same-day round trips (a trade that exits today). READ ONLY."""
    floor = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
    rows: list[dict] = []
    for r in conn.execute(
            "SELECT user_id, symbol, entry_date FROM j2_positions WHERE closed_at IS NULL"
            " AND COALESCE(entry_estimated, 0) = 0 AND entry_date >= ?", (floor,)):
        rows.append(dict(r))
    for r in conn.execute(
            "SELECT user_id, symbol, entry_date FROM j2_trades WHERE trading_day_et = ?", (today,)):
        rows.append(dict(r))
    out, seen = [], set()
    for r in rows:
        if entry_day_for(r["entry_date"]) != today:
            continue
        try:
            sym = clean_symbol(r["symbol"])
        except EntryContextRequestError:
            continue
        k = (str(r["user_id"]), sym)
        if k not in seen:
            seen.add(k)
            out.append({"user_id": k[0], "symbol": sym, "entry_date": r["entry_date"]})
    return out


def capture_todays_entries(*, trigger: str = "sweep", budget: int = SWEEP_BUDGET,
                           conn: sqlite3.Connection | None = None,
                           today: str | None = None) -> dict:
    """Freeze every not-yet-frozen entry of TODAY, across members, up to `budget`.

    Only READS j2_positions and j2_trades; writes only j2_entry_context. One entry failing
    is counted and the rest go on. Raises only if the journal itself cannot be read (the
    guarded door `after_broker_sync` catches that)."""
    today = today or today_et()
    summary = {"candidates": 0, "frozen": 0, "already": 0, "failed": 0, "deferred": 0}
    with _Conn(conn) as c:
        entries = _todays_entries(c, today)
        done = {(str(r["user_id"]), r["symbol"]) for r in c.execute(
            "SELECT user_id, symbol FROM j2_entry_context WHERE entry_day_et = ?", (today,))}
        todo = [e for e in entries if (e["user_id"], e["symbol"]) not in done]
        summary["candidates"] = len(entries)
        summary["already"] = len(entries) - len(todo)
        memo: dict = {}
        for e in todo:
            if summary["frozen"] + summary["failed"] >= budget:
                summary["deferred"] += 1
                continue
            try:
                out = capture_at_entry(e["user_id"], e["symbol"], e["entry_date"], trigger=trigger,
                                       conn=c, memo=memo, today=today)
                summary["frozen" if out["status"] == "frozen" else "already"] += 1
            except Exception:  # noqa: BLE001 -- one entry never stops the rest
                log.warning("[entry_context] capture failed for %s %s", e["user_id"], e["symbol"],
                            exc_info=True)
                summary["failed"] += 1
    return summary


def after_broker_sync(*, trigger: str = "broker_sync", conn: sqlite3.Connection | None = None,
                      today: str | None = None) -> dict:
    """THE HOOK after a broker sync wrote. Inert while the flag is off; NEVER raises, so a
    failure here can never fail (or retry, or alter) the sync that ran before it."""
    try:
        if not enabled():
            return {"ok": True, "skipped": "flag off"}
        return {"ok": True, **capture_todays_entries(trigger=trigger, conn=conn, today=today)}
    except Exception as e:  # noqa: BLE001
        log.warning("[entry_context] after-sync capture failed", exc_info=True)
        return {"ok": False, "error": type(e).__name__}


def run_after_broker_sync_blocking() -> None:
    after_broker_sync(trigger="broker_sync")


def run_sweep_blocking() -> None:
    after_broker_sync(trigger="sweep")


def backfill_open_positions(user_id: str, *, budget: int = BACKFILL_BUDGET,
                            conn: sqlite3.Connection | None = None,
                            today: str | None = None) -> dict:
    """Freeze a context for the member's open positions that have none: TODAY's market,
    labelled ``captured_late`` with today's date (``at_entry`` when the entry IS today).
    A carried-in holding with no entry day is skipped and counted."""
    today = today or today_et()
    summary = {"frozen": 0, "capturedLate": 0, "already": 0, "noEntryDay": 0, "deferred": 0,
               "failed": 0}
    with _Conn(conn) as c:
        rows = c.execute(
            "SELECT symbol, entry_date, COALESCE(entry_estimated, 0) AS est FROM j2_positions"
            " WHERE user_id = ? AND closed_at IS NULL ORDER BY entry_date DESC",
            (str(user_id),)).fetchall()
        memo: dict = {}
        seen: set[tuple[str, str]] = set()
        for r in rows:
            day = None if r["est"] else entry_day_for(r["entry_date"])
            try:
                sym = clean_symbol(r["symbol"])
            except EntryContextRequestError:
                sym = None
            if not day or not sym:
                summary["noEntryDay"] += 1
                continue
            if (sym, day) in seen:
                continue
            seen.add((sym, day))
            if _row(c, user_id, sym, day) is not None:
                summary["already"] += 1
                continue
            if summary["frozen"] + summary["failed"] >= budget:
                summary["deferred"] += 1
                continue
            kind = "at_entry" if day == today else "captured_late"
            try:
                out = freeze(user_id, sym, day, capture_kind=kind, trigger="backfill", conn=c,
                             memo=memo, capture_day=today)
            except Exception:  # noqa: BLE001
                log.warning("[entry_context] backfill failed for %s %s", user_id, sym, exc_info=True)
                summary["failed"] += 1
                continue
            if out["frozen"]:
                summary["frozen"] += 1
                summary["capturedLate"] += kind == "captured_late"
            else:
                summary["already"] += 1
    return summary


# ── the scheduler wiring (api/main.py calls install_scheduler_hooks once) ─────────────────

def make_after_sync_listener(scheduler: Any):
    """An APScheduler listener: when a broker-sync job finishes (ok or not -- a failed sync may
    still have written), queue ONE after-sync capture as its own job. The listener itself
    does no I/O and never raises, so it cannot slow or fail the scheduler or the sync."""
    def _listener(event: Any) -> None:
        try:
            if getattr(event, "job_id", None) not in BROKER_SYNC_JOB_IDS or not enabled():
                return
            scheduler.add_job(run_after_broker_sync_blocking, id=AFTER_SYNC_JOB_ID,
                              replace_existing=True, max_instances=1, coalesce=True,
                              misfire_grace_time=600)
        except Exception:  # noqa: BLE001
            log.warning("[entry_context] could not queue the after-sync capture", exc_info=True)
    return _listener


def install_scheduler_hooks(scheduler: Any, cron_trigger: Any, tz: Any) -> bool:
    """Register the market-hours sweep and the after-broker-sync listener. Both are inert
    while the flag is off (read per run), so a flip needs no restart. Never raises."""
    try:
        from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
        scheduler.add_job(run_sweep_blocking,
                          trigger=cron_trigger(day_of_week="mon-fri", hour="9-16",
                                               minute="4,14,24,34,44,54", timezone=tz),
                          id=SWEEP_JOB_ID, max_instances=1, coalesce=True,
                          misfire_grace_time=300, replace_existing=True)
        scheduler.add_listener(make_after_sync_listener(scheduler),
                               EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)
        return True
    except Exception:  # noqa: BLE001
        log.warning("[entry_context] scheduler hooks not installed", exc_info=True)
        return False
