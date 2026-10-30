"""The indicator SUPPORT LOOP, Phase A: gap counts (A2) and opt-in reports (A3).

Spec: ``docs/pine/support-loop/PHASE-A.md``. Phase B (a daily ranked fix loop)
reads what this module writes; the shapes it reads are named in that doc and in
``gap_ranking`` / ``admin_list_reports`` below.

## A2 — gap counts, and why a dedicated table rather than a telemetry event

``indicator_telemetry`` forbids list and dict values on every event, by design
(its 2026-09-04 hardening). A paste that loses three built-ins is a LIST of
(name, kind) pairs, so as an event it would have to be one row per name — one
``landing_events`` row per name per paste per keystroke-settle — and Phase B's
question, "rank names by the number of DISTINCT members hit", would be a JSON
scan over a shared marketing table. A dedicated aggregate is cleaner:

    indicator_gap_hits(day, name, kind, member_key, hits)   PK (day, name, kind, member_key)

One row per member per name per kind per day; ``hits`` counts repeat pastes,
capped at ``HITS_CAP_PER_DAY`` so one member cannot weigh a name by pasting it
200 times. Distinct members is ``COUNT(DISTINCT member_key)``, exact, and the table
holds no content: ``name`` is ALWAYS either a member of the closed allowlist
(``pineBuiltins.json``, the same file the client reads) or the constant
``_unlisted``; ``kind`` is one of two constants; ``member_key`` is
``HMAC-SHA256(PUSH_SECRET, "indicator-gap-hits:v1|" + user_id)`` (``member_key``),
never the raw member id and never a free-form string they typed. The key is the
same every day for one member, so distinct members across a window and the
per-member daily cap both still work; without the server secret it cannot be
turned back into an id. Rows older than ``GAP_RETAIN_DAYS`` (400) are purged with
the report retention (``purge_expired``).

⛔⛔ THE ALLOWLIST IS ENFORCED HERE, NOT TRUSTED FROM THE CLIENT. A name not in
the list is never written, under any spelling; it is counted as ``_unlisted``.

## A3 — the opt-in report, the ONE place a member's source is kept

The standing decision recorded in ``indicator_telemetry.py`` (pasted source is
never stored) still holds for everything else. The owner's exception: a member
may CHOOSE to send a script that does not match TradingView, and only then, only
with explicit consent, and only to fix support. Enforced three ways:

* the feature flag ``PINE_SUPPORT_REPORTS_ENABLED`` (default OFF): off, a create
  is refused before anything is read or written;
* ``consent`` must be the boolean ``True`` (not ``1``, not ``"yes"``) or the
  create is refused;
* the table itself carries ``CHECK (consent = 1)``, so a future code path that
  forgot the check still could not insert a row.

Limits: ``MAX_SOURCE_BYTES`` (UTF-8 bytes), ``MAX_NOTE_CHARS``, a TradingView-only
link pattern, ``MAX_GAPS`` gap entries (each re-validated against the allowlist),
and a per-member rate limit counted in the table itself (``RATE_PER_HOUR`` and
``RATE_PER_DAY``), so it survives a restart and a second process.

Retention (``purge_expired``, run on every create and every admin list): a
report is DELETED 30 days after it is marked ``fixed`` or ``wontfix``, and in any
case 365 days after it was created. A member's withdrawal deletes it at once.

⛔ NEVER RAISES OUT OF THE GAP PATH: a gap-count failure must never break the
import it observes. The report path raises ``ReportRefused`` with an HTTP status
and a member-readable sentence; the router renders it verbatim.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Optional

from api.services import auth_db

log = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parents[2]
ALLOWLIST_PATH = (_ROOT / "app" / "src" / "components" / "chart" / "supportLoop"
                  / "pineBuiltins.json")

GAP_KINDS = frozenset({"name-unknown", "call-unmapped"})
UNLISTED = "_unlisted"
HITS_CAP_PER_DAY = 50
MAX_GAPS = 64
MAX_UNLISTED_PER_CALL = 64

FLAG_ENV = "PINE_SUPPORT_REPORTS_ENABLED"
GAP_LOG_OFF_ENV = "PINE_GAP_LOG"          # "off" disables A2; anything else = on
MAX_SOURCE_BYTES = 128 * 1024
MAX_NOTE_CHARS = 1000
MAX_LINK_CHARS = 300
RATE_PER_HOUR = 5
RATE_PER_DAY = 20
STATUSES = ("new", "triaged", "fixed", "wontfix")
CLOSED_STATUSES = ("fixed", "wontfix")
RETAIN_AFTER_CLOSED_DAYS = 30
RETAIN_MAX_DAYS = 365
GAP_RETAIN_DAYS = 400

_LINK_RE = re.compile(
    r"https://(www\.|[a-z]{2}\.)?tradingview\.com/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,280}")
_SYMBOL_RE = re.compile(r"[A-Za-z0-9.^=:_!/-]{1,32}")
_TF_RE = re.compile(r"[0-9]{0,4}[A-Za-z]{0,2}")
_ID_RE = re.compile(r"[0-9a-f]{32}")


def _load_allowlist() -> frozenset:
    data = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
    names = data["names"]
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise ValueError("pineBuiltins.json: `names` must be a list of strings")
    return frozenset(names)


#: ⭐ ONE LIST, TWO READERS — the client's ``importGaps.js`` imports the same file.
PINE_BUILTINS: frozenset = _load_allowlist()


def is_pine_builtin(name: Any) -> bool:
    return isinstance(name, str) and name in PINE_BUILTINS


_SCHEMA = """
CREATE TABLE IF NOT EXISTS indicator_gap_hits (
    day        TEXT NOT NULL,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('name-unknown', 'call-unmapped')),
    member_key TEXT NOT NULL,
    hits       INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (day, name, kind, member_key)
);
CREATE INDEX IF NOT EXISTS idx_indicator_gap_hits_name ON indicator_gap_hits(name, kind, day);

CREATE TABLE IF NOT EXISTS indicator_support_reports (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    consent            INTEGER NOT NULL CHECK (consent = 1),
    source             TEXT NOT NULL,
    source_hash        TEXT NOT NULL,
    source_bytes       INTEGER NOT NULL,
    note               TEXT,
    tradingview_link   TEXT,
    symbol             TEXT,
    timeframe          TEXT,
    gaps               TEXT NOT NULL DEFAULT '[]',
    translator_version TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'triaged', 'fixed', 'wontfix')),
    created_at         TEXT NOT NULL,
    status_changed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_isr_user ON indicator_support_reports(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_isr_hash ON indicator_support_reports(source_hash);
CREATE INDEX IF NOT EXISTS idx_isr_status ON indicator_support_reports(status, created_at);
"""


def _migrate_gap_table(conn) -> None:
    """The first build of this branch keyed ``indicator_gap_hits`` by the RAW
    ``user_id``. That table never reached production, so it is replaced rather
    than converted: a raw id must not survive into the keyed table."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(indicator_gap_hits)").fetchall()]
    if cols and "member_key" not in cols:
        conn.execute("DROP TABLE indicator_gap_hits")
        conn.commit()


def _conn():
    conn = auth_db.get_connection()
    _migrate_gap_table(conn)
    conn.executescript(_SCHEMA)
    return conn


# ─── the member key ─────────────────────────────────────────────────────────

#: Domain separation: the same secret keys other things in this codebase
#: (`ai_search_log._user_bucket`, the calendar's ICS tokens), and a key minted
#: for one purpose must never equal one minted for another.
_MEMBER_KEY_DOMAIN = b"indicator-gap-hits:v1|"
_DEV_FALLBACK_SECRET = b"uct-indicator-gap-dev-salt"
_warned_no_secret = False


def _member_key_secret() -> bytes:
    """``PUSH_SECRET``, the server secret every internal caller already holds and
    the one ``ai_search_log`` keys its member buckets with. Read per call.

    ⚠️ UNSET (a local dev box) falls back to a fixed salt, with one warning, as
    ``ai_search_log`` does: the key is then still one-way to anyone without this
    source, but it is not SECRET, so production must have ``PUSH_SECRET`` set (it
    does: it is the internal bearer). Rotating ``PUSH_SECRET`` starts a new key per
    member, so distinct-member counts that span the rotation count a member twice
    for that window; the 400-day retention ages the old keys out."""
    global _warned_no_secret
    s = (os.environ.get("PUSH_SECRET") or "").strip()
    if s:
        return s.encode("utf-8")
    if not _warned_no_secret:
        _warned_no_secret = True
        log.warning("[indicator-support] PUSH_SECRET unset; gap member keys use the dev salt")
    return _DEV_FALLBACK_SECRET


def member_key(user_id: Any) -> str:
    """⭐ THE ONE PLACE A MEMBER'S GAP-COUNT KEY IS COMPUTED. Account deletion
    (``journal_two/account_purge.py``) calls this to find the member's rows."""
    return hmac.new(_member_key_secret(), _MEMBER_KEY_DOMAIN + str(user_id).encode("utf-8"),
                    hashlib.sha256).hexdigest()


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _iso(t: _dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


# ─── A2 ─────────────────────────────────────────────────────────────────────

def gap_log_enabled() -> bool:
    return (os.environ.get(GAP_LOG_OFF_ENV) or "").strip().lower() != "off"


def clean_gaps(gaps: Any, unlisted: Any = 0) -> list[tuple[str, str]]:
    """The ONLY (name, kind) pairs that may be stored. A name not on the closed
    list becomes ``UNLISTED``; a kind not in ``GAP_KINDS`` becomes
    ``call-unmapped`` (the conservative direction, as in ``doorCoverage.js``);
    anything that is not a ``{name, kind}`` dict counts as unlisted. Deduped.
    """
    out: dict[tuple[str, str], None] = {}
    extra = 0
    for g in (gaps if isinstance(gaps, list) else [])[:MAX_GAPS]:
        name = g.get("name") if isinstance(g, dict) else None
        kind = g.get("kind") if isinstance(g, dict) else None
        kind = kind if kind in GAP_KINDS else "call-unmapped"
        if is_pine_builtin(name):
            out[(name, kind)] = None
        else:
            extra += 1
    try:
        extra += max(0, min(int(unlisted), MAX_UNLISTED_PER_CALL)) if not isinstance(unlisted, bool) else 0
    except (TypeError, ValueError):
        pass
    if extra:
        out[(UNLISTED, "call-unmapped")] = None
    return list(out)


def record_gaps(user_id: Any, gaps: Any, unlisted: Any = 0, *, day: Optional[str] = None) -> int:
    """Count one paste's gaps for one member. Returns the number of (name, kind)
    rows touched. Never raises."""
    if not gap_log_enabled():
        return 0
    try:
        pairs = clean_gaps(gaps, unlisted)
        if not pairs:
            return 0
        key = member_key(user_id)
        d = day or _now().strftime("%Y-%m-%d")
        conn = _conn()
        try:
            for name, kind in pairs:
                conn.execute(
                    "INSERT INTO indicator_gap_hits (day, name, kind, member_key, hits)"
                    " VALUES (?, ?, ?, ?, 1)"
                    " ON CONFLICT(day, name, kind, member_key)"
                    " DO UPDATE SET hits = MIN(hits + 1, ?)",
                    (d, name, kind, key, HITS_CAP_PER_DAY),
                )
            conn.commit()
        finally:
            conn.close()
        return len(pairs)
    except Exception:  # noqa: BLE001
        log.exception("[indicator-support] gap write failed")
        return 0


def gap_ranking(days: int = 30, limit: int = 200) -> list[dict]:
    """⭐ PHASE B's READ: one row per (name, kind), ranked by DISTINCT members hit,
    then total hits. ``members`` and ``hits`` are over the window; ``first_day`` /
    ``last_day`` bound it. No user ids are returned."""
    days = max(1, min(int(days or 30), 365))
    limit = max(1, min(int(limit or 200), 1000))
    since = (_now() - _dt.timedelta(days=days - 1)).strftime("%Y-%m-%d")
    conn = _conn()
    try:
        rows = conn.execute(
            "SELECT name, kind, COUNT(DISTINCT member_key) AS members, SUM(hits) AS hits,"
            "       MIN(day), MAX(day), COUNT(DISTINCT day)"
            "  FROM indicator_gap_hits WHERE day >= ?"
            " GROUP BY name, kind"
            " ORDER BY members DESC, hits DESC, name ASC LIMIT ?",
            (since, limit),
        ).fetchall()
    finally:
        conn.close()
    return [
        {"name": r[0], "kind": r[1], "members": r[2], "hits": r[3],
         "first_day": r[4], "last_day": r[5], "days_seen": r[6]}
        for r in rows
    ]


# ─── A3 ─────────────────────────────────────────────────────────────────────

class ReportRefused(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def reports_enabled() -> bool:
    return (os.environ.get(FLAG_ENV) or "").strip().lower() in ("1", "true", "on", "yes")


def translator_version() -> str:
    """The deployed commit, read on the SERVER (never trusted from the client)."""
    for k in ("RAILWAY_GIT_COMMIT_SHA", "GIT_COMMIT_SHA"):
        v = (os.environ.get(k) or "").strip()
        if v:
            return v[:12]
    return "unrecorded"


def source_hash(source: str) -> str:
    """Dedupe key: line endings normalised and trailing whitespace stripped per
    line, so the same script pasted from two editors hashes once."""
    norm = "\n".join(line.rstrip() for line in source.replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def purge_gap_hits(now: Optional[_dt.datetime] = None) -> int:
    """Gap-count retention: delete ``indicator_gap_hits`` rows whose day is more
    than ``GAP_RETAIN_DAYS`` before ``now``. Returns the rows deleted."""
    t = now or _now()
    cutoff = (t - _dt.timedelta(days=GAP_RETAIN_DAYS)).strftime("%Y-%m-%d")
    conn = _conn()
    try:
        cur = conn.execute("DELETE FROM indicator_gap_hits WHERE day < ?", (cutoff,))
        conn.commit()
        return cur.rowcount or 0
    finally:
        conn.close()


def purge_expired(now: Optional[_dt.datetime] = None) -> int:
    """The retention rule, for reports AND gap counts (``purge_gap_hits``). Runs on
    every report create and every admin list. Returns the number of REPORTS deleted."""
    try:
        purge_gap_hits(now)
    except Exception:  # noqa: BLE001 - gap retention must never block a report
        log.exception("[indicator-support] gap retention failed")
    t = now or _now()
    closed_before = _iso(t - _dt.timedelta(days=RETAIN_AFTER_CLOSED_DAYS))
    created_before = _iso(t - _dt.timedelta(days=RETAIN_MAX_DAYS))
    conn = _conn()
    try:
        cur = conn.execute(
            "DELETE FROM indicator_support_reports"
            " WHERE (status IN ('fixed', 'wontfix') AND status_changed_at < ?)"
            "    OR created_at < ?",
            (closed_before, created_before),
        )
        conn.commit()
        return cur.rowcount or 0
    finally:
        conn.close()


def _opt_str(value: Any, field: str, max_len: int, pattern: Optional[re.Pattern] = None) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ReportRefused(422, f"{field}-type", f"{field} must be text.")
    v = value.strip()
    if not v:
        return None
    if len(v) > max_len:
        raise ReportRefused(413 if field == "note" else 422, f"{field}-length",
                            f"The {field} is longer than {max_len} characters.")
    if pattern is not None and not pattern.fullmatch(v):
        raise ReportRefused(422, f"{field}-format", f"That {field} is not one this report can carry.")
    return v


def _public(row: dict, *, with_source: bool) -> dict:
    out = {
        "id": row["id"], "status": row["status"], "created_at": row["created_at"],
        "status_changed_at": row["status_changed_at"], "symbol": row["symbol"],
        "timeframe": row["timeframe"], "note": row["note"],
        "tradingview_link": row["tradingview_link"],
        "gaps": json.loads(row["gaps"] or "[]"), "translator_version": row["translator_version"],
        "source_bytes": row["source_bytes"], "source_hash": row["source_hash"],
    }
    if with_source:
        out["source"] = row["source"]
    return out


_COLS = ("id, user_id, consent, source, source_hash, source_bytes, note, tradingview_link,"
         " symbol, timeframe, gaps, translator_version, status, created_at, status_changed_at")


def _row(r) -> dict:
    keys = [c.strip() for c in _COLS.split(",")]
    return dict(zip(keys, r))


def create_report(user_id: Any, *, consent: Any, source: Any, note: Any = None,
                  tradingview_link: Any = None, symbol: Any = None, timeframe: Any = None,
                  gaps: Any = None, now: Optional[_dt.datetime] = None) -> dict:
    """Store one opt-in report. Raises ``ReportRefused``; stores NOTHING on any
    refusal. Returns the member-facing view of the row (no source), with
    ``duplicate: True`` when this member already has the same script open."""
    # ⛔ ORDER MATTERS: the flag and consent are checked before the source is so
    # much as measured.
    if not reports_enabled():
        raise ReportRefused(404, "disabled", "Reports are not being collected right now.")
    if consent is not True:
        raise ReportRefused(422, "consent",
                            "A report can only be sent with your consent to send the script's code.")
    if not isinstance(source, str) or not source.strip():
        raise ReportRefused(422, "source", "There is no script code to send.")
    size = len(source.encode("utf-8"))
    if size > MAX_SOURCE_BYTES:
        raise ReportRefused(413, "source-size",
                            f"This script is larger than the {MAX_SOURCE_BYTES // 1024} KB a report can carry.")
    note_v = _opt_str(note, "note", MAX_NOTE_CHARS)
    link_v = _opt_str(tradingview_link, "link", MAX_LINK_CHARS, _LINK_RE)
    sym_v = _opt_str(symbol, "symbol", 32, _SYMBOL_RE)
    tf_v = _opt_str(timeframe, "timeframe", 6, _TF_RE)
    gap_list = [{"name": n, "kind": k} for n, k in clean_gaps(gaps or [], 0)]

    uid = str(user_id)
    t = now or _now()
    purge_expired(t)
    h = source_hash(source)
    conn = _conn()
    try:
        hour = conn.execute(
            "SELECT COUNT(*) FROM indicator_support_reports WHERE user_id = ? AND created_at >= ?",
            (uid, _iso(t - _dt.timedelta(hours=1)))).fetchone()[0]
        day = conn.execute(
            "SELECT COUNT(*) FROM indicator_support_reports WHERE user_id = ? AND created_at >= ?",
            (uid, _iso(t - _dt.timedelta(days=1)))).fetchone()[0]
        if hour >= RATE_PER_HOUR or day >= RATE_PER_DAY:
            raise ReportRefused(429, "rate",
                                "You have sent several reports recently. Please try again later.")
        dup = conn.execute(
            f"SELECT {_COLS} FROM indicator_support_reports"
            " WHERE user_id = ? AND source_hash = ? AND status IN ('new', 'triaged')"
            " ORDER BY created_at DESC LIMIT 1", (uid, h)).fetchone()
        if dup is not None:
            return {**_public(_row(dup), with_source=False), "duplicate": True}
        rid = uuid.uuid4().hex
        stamp = _iso(t)
        conn.execute(
            f"INSERT INTO indicator_support_reports ({_COLS})"
            " VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)",
            (rid, uid, source, h, size, note_v, link_v, sym_v, tf_v,
             json.dumps(gap_list, separators=(",", ":")), translator_version(), stamp, stamp),
        )
        conn.commit()
        row = conn.execute(f"SELECT {_COLS} FROM indicator_support_reports WHERE id = ?",
                           (rid,)).fetchone()
    finally:
        conn.close()
    return {**_public(_row(row), with_source=False), "duplicate": False}


def list_mine(user_id: Any) -> list[dict]:
    conn = _conn()
    try:
        rows = conn.execute(
            f"SELECT {_COLS} FROM indicator_support_reports WHERE user_id = ?"
            " ORDER BY created_at DESC LIMIT 100", (str(user_id),)).fetchall()
    finally:
        conn.close()
    return [_public(_row(r), with_source=False) for r in rows]


def get_mine(user_id: Any, report_id: str) -> Optional[dict]:
    """The member's OWN report, with its source; None for any other member's."""
    if not isinstance(report_id, str) or not _ID_RE.fullmatch(report_id):
        return None
    conn = _conn()
    try:
        r = conn.execute(
            f"SELECT {_COLS} FROM indicator_support_reports WHERE id = ? AND user_id = ?",
            (report_id, str(user_id))).fetchone()
    finally:
        conn.close()
    return _public(_row(r), with_source=True) if r else None


def withdraw(user_id: Any, report_id: str) -> bool:
    """Delete the member's OWN report. False (and nothing deleted) for anyone else's."""
    if not isinstance(report_id, str) or not _ID_RE.fullmatch(report_id):
        return False
    conn = _conn()
    try:
        cur = conn.execute(
            "DELETE FROM indicator_support_reports WHERE id = ? AND user_id = ?",
            (report_id, str(user_id)))
        conn.commit()
        return (cur.rowcount or 0) > 0
    finally:
        conn.close()


def admin_list_reports(status: Optional[str] = None, limit: int = 200) -> list[dict]:
    """⭐ PHASE B's OTHER READ: reports WITHOUT their source (fetch one by id for
    that), each with ``same_script_reports`` — how many reports share its hash —
    and ``reporter`` (the member id, for follow-up)."""
    purge_expired()
    limit = max(1, min(int(limit or 200), 1000))
    conn = _conn()
    try:
        if status in STATUSES:
            rows = conn.execute(
                f"SELECT {_COLS} FROM indicator_support_reports WHERE status = ?"
                " ORDER BY created_at DESC LIMIT ?", (status, limit)).fetchall()
        else:
            rows = conn.execute(
                f"SELECT {_COLS} FROM indicator_support_reports"
                " ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        counts = dict(conn.execute(
            "SELECT source_hash, COUNT(*) FROM indicator_support_reports GROUP BY source_hash").fetchall())
    finally:
        conn.close()
    out = []
    for r in rows:
        d = _row(r)
        out.append({**_public(d, with_source=False), "reporter": d["user_id"],
                    "same_script_reports": counts.get(d["source_hash"], 1)})
    return out


def admin_get_report(report_id: str) -> Optional[dict]:
    if not isinstance(report_id, str) or not _ID_RE.fullmatch(report_id):
        return None
    conn = _conn()
    try:
        r = conn.execute(f"SELECT {_COLS} FROM indicator_support_reports WHERE id = ?",
                         (report_id,)).fetchone()
    finally:
        conn.close()
    if not r:
        return None
    d = _row(r)
    return {**_public(d, with_source=True), "reporter": d["user_id"]}


def admin_set_status(report_id: str, status: str, now: Optional[_dt.datetime] = None) -> bool:
    if status not in STATUSES or not isinstance(report_id, str) or not _ID_RE.fullmatch(report_id):
        return False
    conn = _conn()
    try:
        cur = conn.execute(
            "UPDATE indicator_support_reports SET status = ?, status_changed_at = ? WHERE id = ?",
            (status, _iso(now or _now()), report_id))
        conn.commit()
        return (cur.rowcount or 0) > 0
    finally:
        conn.close()

