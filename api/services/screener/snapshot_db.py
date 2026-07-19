"""Screener snapshot DB — one precomputed row per ticker for server-side scans.

Built nightly by ``snapshot_builder``; queried by ``query``. All numeric fields
nullable so a ticker missing fundamentals still screens on technicals.
"""
import os
import sqlite3
import threading

_WRITE_LOCK = threading.Lock()

# Canonical column set. Add columns here ONLY (builder + query read this list).
COLUMNS = [
    "ticker", "company", "sector", "industry", "exchange",
    "market_cap", "price", "avg_volume_30d", "dividend_yield",
    # fundamentals
    "pe_ttm", "pe_fwd", "peg", "ps", "pb", "eps_growth", "rev_growth",
    "op_margin", "gross_margin", "net_margin", "roe", "roa",
    "debt_to_equity", "current_ratio", "beta", "inst_pct",
    # uct ratings
    "uct_composite", "rs_rank", "rs_return", "accdis",
    # technical
    "chg_pct_1d", "chg_pct_1w", "chg_pct_1m", "rsi14",
    "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200", "pct_vs_ema20",
    "ma_stack", "adr_pct", "atr_pct", "vol_ratio", "gap_pct",
    "dist_52w_high_pct", "dist_52w_low_pct", "above_50sma", "new_52w_high",
    # single candle
    "candle_type", "body_pct", "upper_wick_pct", "lower_wick_pct",
    "close_position", "wide_bar", "narrow_bar",
    # multi candle
    "inside_bar_run", "tight_consolidation", "pullback_depth_pct",
    "higher_lows_run", "nr7", "consecutive_up", "consecutive_down",
    # patterns
    "patterns", "pattern_conf_max",
    # meta
    "snapshot_date", "bars_asof", "built_at",
]

_TEXT = {"ticker", "company", "sector", "industry", "exchange", "ma_stack",
         "candle_type", "patterns", "snapshot_date", "bars_asof"}
_INT = {"uct_composite", "rs_rank", "inside_bar_run", "higher_lows_run",
        "consecutive_up", "consecutive_down", "built_at",
        # bools stored as 0/1
        "above_50sma", "new_52w_high", "wide_bar", "narrow_bar",
        "tight_consolidation", "nr7"}


def get_db_path() -> str:
    p = os.environ.get("SCREENER_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/screener.db"
    os.makedirs("./data", exist_ok=True)
    return "./data/screener.db"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _coldef(name: str) -> str:
    if name == "ticker":
        return "ticker TEXT PRIMARY KEY"
    if name in _TEXT:
        return f"{name} TEXT"
    if name in _INT:
        return f"{name} INTEGER"
    return f"{name} REAL"


def init_db() -> None:
    with _WRITE_LOCK, connect() as conn:
        cols = ", ".join(_coldef(c) for c in COLUMNS)
        conn.execute(f"CREATE TABLE IF NOT EXISTS screener_rows ({cols})")
        for idx in ("sector", "market_cap", "uct_composite", "rs_rank",
                    "above_50sma", "chg_pct_1d", "candle_type", "built_at"):
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS idx_sr_{idx} ON screener_rows({idx})")
        conn.commit()


def _coerce(name, value):
    """Normalize python bools to 0/1 for the INTEGER bool columns."""
    if isinstance(value, bool):
        return 1 if value else 0
    return value


def upsert_rows(rows: list[dict]) -> int:
    if not rows:
        return 0
    placeholders = ", ".join("?" for _ in COLUMNS)
    sql = (f"INSERT OR REPLACE INTO screener_rows ({', '.join(COLUMNS)}) "
           f"VALUES ({placeholders})")
    payload = [[_coerce(c, r.get(c)) for c in COLUMNS] for r in rows]
    with _WRITE_LOCK, connect() as conn:
        conn.executemany(sql, payload)
        conn.commit()
    return len(rows)


def get_row(ticker: str) -> dict | None:
    with connect() as conn:
        r = conn.execute("SELECT * FROM screener_rows WHERE ticker=?",
                         (ticker.upper(),)).fetchone()
        return dict(r) if r else None


def get_rows(tickers: list) -> dict:
    """Batch fetch: {ticker: row-dict} for the given tickers, one connection.
    Tickers are uppercased to match the stored PK; misses are simply absent."""
    tks = [t.upper() for t in tickers if t]
    if not tks:
        return {}
    out = {}
    with connect() as conn:
        # SQLite's variable limit is 999; theme fill-sets are <=50, chunk to be safe.
        for i in range(0, len(tks), 900):
            chunk = tks[i:i + 900]
            ph = ", ".join("?" for _ in chunk)
            for r in conn.execute(
                    f"SELECT * FROM screener_rows WHERE ticker IN ({ph})", chunk):
                out[r["ticker"]] = dict(r)
    return out


def count_rows() -> int:
    with connect() as conn:
        return conn.execute("SELECT COUNT(*) FROM screener_rows").fetchone()[0]


def status() -> dict:
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) n, MAX(built_at) b, MAX(snapshot_date) d "
            "FROM screener_rows").fetchone()
    return {"rows": row["n"] or 0, "latest_built_at": row["b"],
            "latest_snapshot_date": row["d"]}
