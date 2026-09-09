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
