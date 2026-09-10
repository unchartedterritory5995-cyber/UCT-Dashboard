"""Vision verdict store + cost guard for the pattern-vision judge.

Own DB (`/data/pattern_vision.db`) so the existing pattern_detections store is
untouched. Stores one verdict per (ticker, tf, setup, asof_date) + a cost log.
"""
import datetime
import json
import os
import sqlite3
import threading
import time

_WRITE_LOCK = threading.Lock()

VERDICT_COLUMNS = [
    "ticker", "tf", "setup", "asof_date", "confirmed", "vision_confidence",
    "rationale", "key_level", "raw_confidence", "model", "signals_hash", "judged_at",
    "checks",  # JSON: [{"criterion": str, "passed": bool}, ...]
]


def get_db_path() -> str:
    p = os.environ.get("PATTERN_VISION_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/pattern_vision.db"
    os.makedirs("./data", exist_ok=True)
    return "./data/pattern_vision.db"


def connect() -> sqlite3.Connection:
    c = sqlite3.connect(get_db_path(), timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    return c


def init_db() -> None:
    with _WRITE_LOCK, connect() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS pattern_verdicts (
            ticker TEXT, tf TEXT, setup TEXT, asof_date TEXT,
            confirmed INTEGER, vision_confidence REAL, rationale TEXT, key_level REAL,
            raw_confidence REAL, model TEXT, signals_hash TEXT, judged_at INTEGER,
            checks TEXT,
            PRIMARY KEY (ticker, tf, setup, asof_date))""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_pv_conf "
                  "ON pattern_verdicts(ticker, tf, confirmed)")
        c.execute("""CREATE TABLE IF NOT EXISTS vision_cost_log (
            day TEXT, ticker TEXT, model TEXT, in_tok INTEGER, out_tok INTEGER,
            cost_usd REAL, logged_at INTEGER)""")
        # Migrate the already-shipped prod table (added the `checks` column).
        cols = {r[1] for r in c.execute("PRAGMA table_info(pattern_verdicts)").fetchall()}
        if "checks" not in cols:
            c.execute("ALTER TABLE pattern_verdicts ADD COLUMN checks TEXT")
        # Phase 3 — feedback loop (thumbs + notes) and annotated teaching examples.
        c.execute("""CREATE TABLE IF NOT EXISTS pattern_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT, tf TEXT, setup TEXT, asof_date TEXT,
            rating TEXT, note TEXT, by_user TEXT, created_at INTEGER, source TEXT)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_pf_key "
                  "ON pattern_feedback(ticker, tf, setup, asof_date)")
        pf_cols = {r[1] for r in c.execute("PRAGMA table_info(pattern_feedback)").fetchall()}
        if "source" not in pf_cols:
            c.execute("ALTER TABLE pattern_feedback ADD COLUMN source TEXT")
        c.execute("""CREATE TABLE IF NOT EXISTS pattern_exemplars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setup TEXT, ticker TEXT, asof_date TEXT, png BLOB,
            note TEXT, drawings_json TEXT, by_user TEXT, created_at INTEGER)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_pe_setup ON pattern_exemplars(setup)")
        # -- Slot observability -------------------------------------------
        # One row per judge invocation, written UNCONDITIONALLY at the end of
        # the run including the abort path. Before this existed, four paths
        # wrote nothing at all -- skip-if-stable, the cost cap, a chart-render
        # failure (which logs NOTHING), and a judge exception (stdout only) --
        # so "the 16:00 slot produced no rows" was unresolvable between
        # all-skipped, all-failed and an empty active set, and could only be
        # chased through a log buffer that holds ~10 minutes.
        # ⛔ slot_start is deliberately NOT UNIQUE. A unique constraint would
        # make a second run for the same slot FAIL its insert and disappear --
        # re-creating the invisibility this table exists to remove. Two rows
        # with one slot_start is the detection.
        c.execute("""CREATE TABLE IF NOT EXISTS vision_slot_log (
            slot_start TEXT, source TEXT, started_ts INTEGER, finished_ts INTEGER,
            duration_s REAL,
            evidence_min TEXT, evidence_max TEXT, evidence_distinct INTEGER,
            active_set_n INTEGER, judged INTEGER, skipped INTEGER, capped INTEGER,
            render_failed INTEGER, errored INTEGER,
            aborted INTEGER, abort_ticker TEXT,
            paid_calls INTEGER, spend_usd REAL)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_vsl_slot ON vision_slot_log(slot_start)")
        # Per-ticker detail for the two paths that are otherwise invisible.
        # Bounded on purpose: only render_failed and errored rows land here, so
        # a healthy slot writes none. asof_date is recorded per ticker because
        # _evidence_bar() runs per ticker -- ingestion lag can be PARTIAL, and a
        # single per-slot evidence date would hide that.
        c.execute("""CREATE TABLE IF NOT EXISTS vision_slot_ticker (
            slot_start TEXT, source TEXT, ticker TEXT, tf TEXT, setup TEXT,
            asof_date TEXT, path TEXT, message TEXT, logged_at INTEGER)""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_vst_slot ON vision_slot_ticker(slot_start)")
        c.commit()


def put_verdict(v: dict) -> None:
    ph = ", ".join("?" for _ in VERDICT_COLUMNS)
    with _WRITE_LOCK, connect() as c:
        c.execute(f"INSERT OR REPLACE INTO pattern_verdicts ({', '.join(VERDICT_COLUMNS)}) "
                  f"VALUES ({ph})", [v.get(k) for k in VERDICT_COLUMNS])
        c.commit()


def _decode(row) -> dict:
    d = dict(row)
    raw = d.get("checks")
    if isinstance(raw, str) and raw:
        try:
            d["checks"] = json.loads(raw)
        except (ValueError, TypeError):
            d["checks"] = []
    elif raw is None:
        d["checks"] = []
    return d


def get_verdict(ticker, tf, setup, asof_date) -> dict | None:
    with connect() as c:
        r = c.execute("SELECT * FROM pattern_verdicts WHERE ticker=? AND tf=? AND setup=? "
                      "AND asof_date=?", (ticker.upper(), tf, setup, asof_date)).fetchone()
        return _decode(r) if r else None


#: How many CALENDAR days of evidence age `get_confirmed` will serve.
#: Calendar days, not trading sessions, deliberately: the exchange calendar
#: lives in three separate runtime-local tables (`bars_fetch.py`,
#: `market_calendar.py`, `liveflow_monitor.py`) and the Seam 7 adjudication
#: ruled against adding a fourth consumer for precision this bound does not
#: need. 7 covers a weekend plus a holiday plus a day of bars-ingestion lag.
#: An exceptional multi-day exchange closure empties the window and serves
#: NOTHING rather than something stale -- that is the safe direction.
CONFIRMED_MAX_AGE_DAYS = 7


def confirmed_window_floor(today: str | None = None) -> str:
    """Oldest `asof_date` `get_confirmed` will serve, INCLUSIVE."""
    d = datetime.date.fromisoformat(today) if today else datetime.date.today()
    return (d - datetime.timedelta(days=CONFIRMED_MAX_AGE_DAYS)).isoformat()


def get_confirmed(ticker, tf="D", today: str | None = None) -> list[dict]:
    """Confirmed verdicts a consumer may narrate as the CURRENT technical read.

    ⛔ THIS IS NOT "every row with confirmed=1", and the order of the two rules
    below is load-bearing:

    1. **Latest evidence bar per setup FIRST, confirmed filter second.** A key
       confirmed on an older bar and REJECTED on a newer one must not be
       served. Filtering `confirmed=1` first returns the stale confirm and the
       consumer narrates it as present-tense -- the exact defect this function
       had, and the same trust-boundary class already adjudicated as Seam
       23/28. The correlated subquery picks the newest `asof_date` per
       (ticker, tf, setup); the filter then applies to THAT row only.
    2. **Recency bound second.** A candidate that stops being detected writes
       no new row, so nothing else ever retires its last confirm -- without
       this bound a June verdict is still served today. `judged_at` is NOT
       usable for this: it records when the judge ran, not which bar it
       judged, and the two diverge whenever bars ingestion lags.

    `asof_date` is TEXT 'YYYY-MM-DD', so lexicographic MAX() is chronological
    and `>=` is a valid date comparison. The subquery rides the table's own
    PRIMARY KEY (ticker, tf, setup, asof_date) autoindex -- no new index.

    `today` is injectable for tests only; production passes nothing.
    """
    floor = confirmed_window_floor(today)
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM pattern_verdicts v "
            "WHERE v.ticker=? AND v.tf=? "
            "  AND v.asof_date = (SELECT MAX(v2.asof_date) FROM pattern_verdicts v2 "
            "                     WHERE v2.ticker=v.ticker AND v2.tf=v.tf "
            "                       AND v2.setup=v.setup) "
            "  AND v.confirmed=1 "
            "  AND v.asof_date >= ? "
            "ORDER BY v.asof_date DESC, v.setup",
            (ticker.upper(), tf, floor)).fetchall()
        return [_decode(r) for r in rows]


def cost_today(day: str) -> float:
    with connect() as c:
        r = c.execute("SELECT COALESCE(SUM(cost_usd),0) FROM vision_cost_log WHERE day=?",
                      (day,)).fetchone()
        return float(r[0] or 0.0)


def log_cost(day, ticker, model, in_tok, out_tok, cost_usd) -> None:
    with _WRITE_LOCK, connect() as c:
        c.execute("INSERT INTO vision_cost_log (day,ticker,model,in_tok,out_tok,cost_usd,logged_at) "
                  "VALUES (?,?,?,?,?,?,?)",
                  (day, ticker, model, in_tok, out_tok, cost_usd, int(time.time())))
        c.commit()


def slot_spend(from_ts: int, to_ts: int) -> tuple:
    """(paid_calls, spend_usd) from the append-only cost log in a time window.

    Counted from `vision_cost_log` rather than from the judge's own return
    value because a cost row is committed BEFORE the verdict row: on the abort
    path a call can be paid for and never counted as judged. The cost log
    cannot lose it.
    """
    with connect() as c:
        r = c.execute("SELECT COUNT(*), COALESCE(SUM(cost_usd),0) FROM vision_cost_log "
                      "WHERE logged_at >= ? AND logged_at <= ?", (from_ts, to_ts)).fetchone()
        return int(r[0] or 0), round(float(r[1] or 0.0), 6)


SLOT_COLUMNS = [
    "slot_start", "source", "started_ts", "finished_ts", "duration_s",
    "evidence_min", "evidence_max", "evidence_distinct", "active_set_n",
    "judged", "skipped", "capped", "render_failed", "errored",
    "aborted", "abort_ticker", "paid_calls", "spend_usd",
]


def log_slot(row: dict, problems: list | None = None) -> None:
    """Append one slot row (+ any per-ticker problem rows).

    ⛔ CALLERS MUST INVOKE THIS FROM A `finally`, AND WRAP IT so a failure here
    can never mask the exception that aborted the slot. The whole point is that
    the row lands on the abort path; if this raised, it would replace the
    original error with a logging error and lose both.
    """
    ph = ", ".join("?" for _ in SLOT_COLUMNS)
    with _WRITE_LOCK, connect() as c:
        c.execute(f"INSERT INTO vision_slot_log ({', '.join(SLOT_COLUMNS)}) VALUES ({ph})",
                  [row.get(k) for k in SLOT_COLUMNS])
        for p in (problems or []):
            c.execute("INSERT INTO vision_slot_ticker "
                      "(slot_start,source,ticker,tf,setup,asof_date,path,message,logged_at) "
                      "VALUES (?,?,?,?,?,?,?,?,?)",
                      (row.get("slot_start"), row.get("source"), p.get("ticker"), p.get("tf"),
                       p.get("setup"), p.get("asof_date"), p.get("path"),
                       str(p.get("message"))[:500], int(time.time())))
        c.commit()


def may_judge(day: str) -> bool:
    hard = float(os.environ.get("PATTERN_VISION_COST_HARD_CAP", "10.0"))
    return cost_today(day) < hard


# ---- Phase 3: review feed, feedback, annotated teaching examples ----------

def get_recent_verdicts(limit: int = 100) -> list[dict]:
    """Recent verdicts, BOTH confirmed and rejected (for the review surface),
    each with its latest feedback rating/note attached."""
    with connect() as c:
        rows = c.execute("SELECT * FROM pattern_verdicts ORDER BY judged_at DESC LIMIT ?",
                         (int(limit),)).fetchall()
        out = []
        for r in rows:
            d = _decode(r)
            fb = c.execute(
                "SELECT rating, note FROM pattern_feedback WHERE ticker=? AND tf=? AND setup=? "
                "AND asof_date=? ORDER BY created_at DESC LIMIT 1",
                (d["ticker"], d["tf"], d["setup"], d["asof_date"])).fetchone()
            d["feedback"] = dict(fb) if fb else None
            out.append(d)
        return out


def record_feedback(ticker, tf, setup, asof_date, rating, note=None, by_user=None,
                    source=None) -> int:
    with _WRITE_LOCK, connect() as c:
        cur = c.execute(
            "INSERT INTO pattern_feedback (ticker,tf,setup,asof_date,rating,note,by_user,created_at,source) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (ticker.upper(), tf, setup, asof_date, rating, note, by_user, int(time.time()), source))
        c.commit()
        return cur.lastrowid


def list_feedback(source=None, limit=200) -> list[dict]:
    q = "SELECT * FROM pattern_feedback"
    args = []
    if source:
        q += " WHERE source=?"
        args.append(source)
    q += " ORDER BY created_at DESC LIMIT ?"
    args.append(int(limit))
    with connect() as c:
        return [dict(r) for r in c.execute(q, args).fetchall()]


def add_exemplar(setup, png, *, ticker=None, asof_date=None, note=None,
                 drawings_json=None, by_user=None) -> int:
    """Store a user-drawn annotated chart that becomes a teaching example for `setup`."""
    with _WRITE_LOCK, connect() as c:
        cur = c.execute(
            "INSERT INTO pattern_exemplars (setup,ticker,asof_date,png,note,drawings_json,by_user,created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (setup, ticker, asof_date, sqlite3.Binary(png) if png else None,
             note, drawings_json, by_user, int(time.time())))
        c.commit()
        return cur.lastrowid


def list_exemplars(setup=None) -> list[dict]:
    """Metadata only (no PNG blob) — for the admin manage view."""
    q = ("SELECT id,setup,ticker,asof_date,note,by_user,created_at FROM pattern_exemplars")
    args = ()
    if setup:
        q += " WHERE setup=?"
        args = (setup,)
    q += " ORDER BY created_at DESC"
    with connect() as c:
        return [dict(r) for r in c.execute(q, args).fetchall()]


def exemplar_pngs(setup, limit=3) -> list:
    """The annotated example images for a setup (newest first) — fed to the judge."""
    with connect() as c:
        rows = c.execute(
            "SELECT png FROM pattern_exemplars WHERE setup=? AND png IS NOT NULL "
            "ORDER BY created_at DESC LIMIT ?", (setup, int(limit))).fetchall()
        return [bytes(r[0]) for r in rows if r[0] is not None]


def delete_exemplar(exemplar_id: int) -> None:
    with _WRITE_LOCK, connect() as c:
        c.execute("DELETE FROM pattern_exemplars WHERE id=?", (int(exemplar_id),))
        c.commit()
