"""D2 CP3 — the DURABLE dual-compute sample store.

⚰️ **WHY THIS EXISTS.** CP3's gate was *"200 production samples with zero
inequality"*, and it was **unreachable by construction**. The samples lived in
`dual_read`'s in-process ledger, which dies with the process — and on
2026-09-12 **167 commits landed on master**, every one of them rebuilding web.
A threshold of 200 cannot be reached by a counter that resets on a cadence set
by other people's pushes. The intent was right and the mechanism could not
express it.

⛔ **OWNER RULING 2026-09-12, verbatim in effect:** samples go to a small
append-only sqlite table under `DATA_DIR`, one row per sample, a fixed fraction
of production calls during RTH; the new gate is **>= 200 rows spanning >= 1 full
trading session, zero inequality.**

Three properties carried over from `dual_read`, because the reason for each is
unchanged:

  **It never raises.** Not on a locked database, not on a missing volume, not on
  a bug in this file. D2 ADVISES. A recorder that can take a member page down
  over a manifest is worse than no recorder.

  **It changes nothing that is served.** Nothing here returns a value anyone
  renders. It is a side effect on the way past.

  ⛔ **A DISAGREEMENT AND AN UNAVAILABLE BOOK STAY DIFFERENT.** The ruling names
  an `equal` column and this table has one, but `equal` is **NULL** when the book
  could not answer, and the `outcome` column carries which of the three it was.
  Folding `book_unavailable` into `equal=0` would make a deleted manifest read as
  a wrong answer; folding it into `equal=1` would make silent sessions read as
  clean ones. Same discipline as `CoverageLine`'s four counts.

⚠️ **APPEND-ONLY, AND THERE IS DELIBERATELY NO PRUNE.** The reader is cold (see
`gate_status`), so this table grows by tens of rows a day, not millions. A prune
function with zero callers is exactly what `scan_store.prune` turned out to be —
a retention policy that was really just an absence — and adding one here would
create the same trap for the next reader.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

# ⭐ ONE AUTHORITY ON MARKET HOURS. `bars_liveness.is_market_open` already owns
# this question; restating 09:30-16:00 here would be a second authority over one
# value, which is this programme's most-repeated defect.
from api.services.bars_liveness import is_market_open

_logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

#: Kill switch. ⛔ An env var, never a DELETE against the table — stopping a dark
#: run must never destroy the evidence it collected (standing owner rule).
ENABLED_ENV = "D2_SAMPLE_PERSIST_ENABLED"

#: Fixed fraction of comparisons that are persisted, read at CALL time.
PERSIST_PCT_ENV = "D2_SAMPLE_PERSIST_PCT"
DEFAULT_PERSIST_PCT = 100

#: ⛔ RTH-only by the ruling. Set to "0" to record around the clock (tests do).
RTH_ONLY_ENV = "D2_SAMPLE_PERSIST_RTH_ONLY"

#: The gate the owner set: ">= 200 rows spanning >= 1 full trading session, zero
#: inequality."
#: ⛔⛔ NARROWED, AND THE NARROWING IS THE POINT. "Rows" is counted as **AGREED**
#: rows, not total rows. A literal reading passes on 200 rows of
#: `book_unavailable` — a DELETED MANIFEST has zero inequalities — which would
#: certify the book against a book that never answered. This module's own
#: docstring warns that folding `book_unavailable` into agreement makes silent
#: sessions read as clean ones, and the first draft of this gate did exactly that.
#: Caught by `test_a_book_unavailable_run_does_not_quietly_satisfy_the_gate`
#: BEFORE merge; the test is kept as the rail.
GATE_MIN_ROWS = 200
GATE_MIN_SESSIONS = 1

#: A session counts as COVERED when its first sample is at or before 09:45 ET and
#: its last is at or after 15:45 ET.
#: ⚠️ THE 15-MINUTE MARGIN IS A CHOICE AND IT IS LOAD-BEARING. Demanding a sample
#: at exactly 09:30:00 would make this gate unreachable for the same reason the
#: last one was: the reader is COLD — it fires only when a member opens a Desk
#: page — so the open and close ticks are not ours to schedule.
COVER_OPEN_HHMM = 945
COVER_CLOSE_HHMM = 1545

_lock = threading.Lock()
_SCHEMA = """
CREATE TABLE IF NOT EXISTS d2_dual_samples (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            REAL    NOT NULL,
    session_date  TEXT    NOT NULL,
    et_hhmm       INTEGER NOT NULL,
    reader        TEXT    NOT NULL,
    key           TEXT    NOT NULL,
    legacy_value  TEXT,
    book_value    TEXT,
    outcome       TEXT    NOT NULL,
    equal         INTEGER
);
CREATE INDEX IF NOT EXISTS ix_d2_samples_session ON d2_dual_samples (session_date);
"""


def db_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "d2_dual_samples.db")


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(db_path(), timeout=2.0)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=2000")
    return con


def init_db() -> None:
    """Idempotent. Safe to call at every boot; cheap."""
    with _lock, _connect() as con:
        con.executescript(_SCHEMA)


def enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "1").strip() not in ("0", "false", "False", "")


def persist_pct() -> int:
    raw = os.environ.get(PERSIST_PCT_ENV)
    if raw is None or raw.strip() == "":
        return DEFAULT_PERSIST_PCT
    try:
        return max(0, min(100, int(float(raw))))
    except (TypeError, ValueError):
        _logger.warning("[d2-store] %s=%r is not a number; using %d",
                        PERSIST_PCT_ENV, raw, DEFAULT_PERSIST_PCT)
        return DEFAULT_PERSIST_PCT


def rth_only() -> bool:
    return os.environ.get(RTH_ONLY_ENV, "1").strip() not in ("0", "false", "False")


def should_persist(now: datetime | None = None) -> bool:
    if not enabled():
        return False
    if rth_only() and not is_market_open(now or datetime.now(_ET)):
        return False
    pct = persist_pct()
    if pct >= 100:
        return True
    if pct <= 0:
        return False
    import random
    return random.random() * 100.0 < pct


def _as_text(v) -> str | None:
    if v is None:
        return None
    try:
        return repr(v)
    except Exception:                                   # noqa: BLE001
        return "<unrepresentable>"


def record(reader: str, key: str, legacy, book, outcome: str,
           now: datetime | None = None) -> bool:
    """Append one sample. Returns True if a row landed. ⛔ NEVER RAISES."""
    try:
        if not should_persist(now):
            return False
        n = now or datetime.now(_ET)
        equal = None
        if outcome == "agreed":
            equal = 1
        elif outcome == "disagreed":
            equal = 0
        # outcome == "book_unavailable" -> equal stays NULL, deliberately.
        with _lock, _connect() as con:
            con.execute(
                "INSERT INTO d2_dual_samples "
                "(ts, session_date, et_hhmm, reader, key, legacy_value, book_value, outcome, equal) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (time.time(), n.strftime("%Y-%m-%d"), n.hour * 100 + n.minute,
                 str(reader), str(key), _as_text(legacy), _as_text(book), outcome, equal))
        return True
    except Exception:                                   # noqa: BLE001 — see module docstring
        _logger.exception("[d2-store] could not persist a sample for %s (serving is unaffected)",
                          key)
        return False


def gate_status() -> dict:
    """The four facts CP3's gate turns on. ⛔ Named facts, never a pass rate.

    ⭐ It LEADS with what it observed. An empty store prints zeroes, and four
    zeroes read like perfect agreement unless the report says out loud that it
    saw nothing.
    """
    out = {
        "rows": 0, "sessions": 0, "agreed": 0, "disagreed": 0, "book_unavailable": 0,
        "covered_sessions": [], "readers": [], "observed": False,
        "gate_met": False, "why": "",
    }
    try:
        with _lock, _connect() as con:
            con.row_factory = sqlite3.Row
            out["rows"] = con.execute("SELECT COUNT(*) c FROM d2_dual_samples").fetchone()["c"]
            out["disagreed"] = con.execute(
                "SELECT COUNT(*) c FROM d2_dual_samples WHERE outcome='disagreed'").fetchone()["c"]
            out["book_unavailable"] = con.execute(
                "SELECT COUNT(*) c FROM d2_dual_samples WHERE outcome='book_unavailable'"
            ).fetchone()["c"]
            out["readers"] = [r["reader"] for r in con.execute(
                "SELECT DISTINCT reader FROM d2_dual_samples ORDER BY reader")]
            rows = con.execute(
                "SELECT session_date, COUNT(*) n, MIN(et_hhmm) first_hhmm, MAX(et_hhmm) last_hhmm "
                "FROM d2_dual_samples GROUP BY session_date ORDER BY session_date").fetchall()
        out["sessions"] = len(rows)
        out["covered_sessions"] = [
            {"date": r["session_date"], "rows": r["n"],
             "first_hhmm": r["first_hhmm"], "last_hhmm": r["last_hhmm"]}
            for r in rows
            if r["first_hhmm"] <= COVER_OPEN_HHMM and r["last_hhmm"] >= COVER_CLOSE_HHMM
        ]
        out["observed"] = True
    except Exception:                                   # noqa: BLE001
        _logger.exception("[d2-store] gate_status could not read the store")
        out["why"] = "the store could not be read — this is NOT zero samples"
        return out

    out["agreed"] = out["rows"] - out["disagreed"] - out["book_unavailable"]

    if out["rows"] == 0:
        out["why"] = ("ZERO ROWS. That is 'the reader has not been called', not 'no "
                      "disagreements'. ticker_returns._close is reached only through the "
                      "Desk's since-mention returns — no scheduler, no hot path.")
    elif out["disagreed"]:
        # ⛔ CHECKED FIRST, AND THE ORDER IS THE POINT. An inequality is the one
        # thing this gate exists to catch, so it must never be masked by a
        # row-count branch reporting "not enough samples yet" — the first draft
        # did exactly that, and 199 agreements plus one disagreement reported as
        # a sample-size problem.
        out["why"] = f"⛔ {out['disagreed']} INEQUALITIES — the gate requires zero"
    elif out["agreed"] < GATE_MIN_ROWS:
        out["why"] = (f"{out['agreed']} AGREED rows of {out['rows']} total, gate needs "
                      f"{GATE_MIN_ROWS} agreed "
                      f"({out['book_unavailable']} book_unavailable, "
                      f"{out['disagreed']} disagreed)")
    elif len(out["covered_sessions"]) < GATE_MIN_SESSIONS:
        out["why"] = (f"{out['rows']} rows but no session yet spans "
                      f"{COVER_OPEN_HHMM}-{COVER_CLOSE_HHMM} ET")
    else:
        out["gate_met"] = True
        out["why"] = (f"{out['agreed']} agreed rows across {len(out['covered_sessions'])} "
                      f"covered session(s), zero inequality")
    return out


def reset_for_tests() -> None:
    """⛔ TESTS ONLY. Production never calls this — and it is why there is no
    prune: the only thing that may empty this table is a test fixture."""
    with _lock, _connect() as con:
        con.execute("DELETE FROM d2_dual_samples")
