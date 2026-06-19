"""Vision verdict store + cost guard for the pattern-vision judge.

Own DB (`/data/pattern_vision.db`) so the existing pattern_detections store is
untouched. Stores one verdict per (ticker, tf, setup, asof_date) + a cost log.
"""
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


def get_confirmed(ticker, tf="D") -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT * FROM pattern_verdicts WHERE ticker=? AND tf=? AND confirmed=1 "
                         "ORDER BY judged_at DESC", (ticker.upper(), tf)).fetchall()
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
