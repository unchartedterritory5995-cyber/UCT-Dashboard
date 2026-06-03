"""SQLite store for the Model Book — a curated library of the best stocks in
history, organized by year, with the firm's playbook setups labeled on each
stock's chart.

DB path: /data/modelbook.db (web service Railway volume).
Dashboard-OWNED storage (NOT the cross-repo uct_intelligence model_examples
table, which is unreachable on Railway). Mirrors api/services/catalyst/store.py:
WAL mode, _WRITE_LOCK on writes, contextlib.closing on every connection
(Windows teardown requires explicit close), foreign_keys=ON for cascade delete.

Two tables:
  modelbook_stocks  — one row per (year, symbol): a curated "model book stock".
  modelbook_setups  — N rows per stock: a playbook setup labeled on its chart.
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time
from typing import Optional

_DB_PATH = os.environ.get("MODELBOOK_DB_PATH", "/data/modelbook.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS modelbook_stocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  year        INTEGER NOT NULL,
  symbol      TEXT    NOT NULL,
  company     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  thesis      TEXT,
  gain_pct    REAL,
  oc_pct      REAL,          -- cached year open->close % (closed years are static)
  lh_pct      REAL,          -- cached year low->high %
  avg_vol     REAL,          -- cached avg daily volume for the year
  stats_at    INTEGER,       -- epoch when oc_pct/lh_pct were computed
  company_desc TEXT,         -- AI: one-sentence "what the company does"
  run_story    TEXT,         -- AI: brief "why it moved that year" narrative
  desc_at      INTEGER,      -- epoch when descriptions were generated
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  UNIQUE(year, symbol)
);
CREATE INDEX IF NOT EXISTS idx_mb_stocks_year ON modelbook_stocks(year, sort_order);

CREATE TABLE IF NOT EXISTS modelbook_setups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id     INTEGER NOT NULL REFERENCES modelbook_stocks(id) ON DELETE CASCADE,
  setup_type   TEXT    NOT NULL,
  label_date   TEXT    NOT NULL,
  timeframe    TEXT    NOT NULL DEFAULT 'D',
  entry_price  REAL,
  stop_price   REAL,
  target_price REAL,
  grade        TEXT,
  notes        TEXT,
  marker_side  TEXT    NOT NULL DEFAULT 'belowBar',
  marker_shape TEXT    NOT NULL DEFAULT 'arrowUp',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mb_setups_stock ON modelbook_setups(stock_id, label_date);
"""

# Fields a client may set on a stock / setup (id, created_at, updated_at managed here).
_STOCK_FIELDS = ("year", "symbol", "company", "sort_order", "thesis", "gain_pct",
                 "company_desc", "run_story")
_SETUP_FIELDS = ("setup_type", "label_date", "timeframe", "entry_price",
                 "stop_price", "target_price", "grade", "notes",
                 "marker_side", "marker_shape")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        # Forward-compat: add new columns to existing DBs. SQLite has no
        # IF NOT EXISTS on columns, so try + swallow duplicate-column.
        for table, col, decl in (
            ("modelbook_stocks", "oc_pct", "REAL"),
            ("modelbook_stocks", "lh_pct", "REAL"),
            ("modelbook_stocks", "avg_vol", "REAL"),
            ("modelbook_stocks", "stats_at", "INTEGER"),
            ("modelbook_stocks", "company_desc", "TEXT"),
            ("modelbook_stocks", "run_story", "TEXT"),
            ("modelbook_stocks", "desc_at", "INTEGER"),
        ):
            try:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError as e:
                if "duplicate column name" not in str(e).lower():
                    raise
        c.commit()


# ── Stocks ───────────────────────────────────────────────────────────────────

def list_years() -> list[int]:
    """Distinct years that have at least one curated stock, newest first."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT DISTINCT year FROM modelbook_stocks ORDER BY year DESC"
        ).fetchall()
        return [r["year"] for r in rows]


def get_stocks_for_year(year: int) -> list[dict]:
    """All curated stocks for a year, ordered by rank, each with setup_count."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT s.*, COUNT(u.id) AS setup_count
               FROM modelbook_stocks s
               LEFT JOIN modelbook_setups u ON u.stock_id = s.id
               WHERE s.year = ?
               GROUP BY s.id
               ORDER BY s.sort_order ASC, s.symbol ASC""",
            (int(year),),
        ).fetchall()
        return [dict(r) for r in rows]


def get_all_stocks() -> list[dict]:
    """Every curated stock across all years (used for background stat warming)."""
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute("SELECT * FROM modelbook_stocks").fetchall()]


def migrate_dollar_volume() -> None:
    """One-time: clear avg_vol (previously SHARE volume) so the warm recomputes
    it as DOLLAR volume. Flag-gated so it runs once ever."""
    flag = os.path.join(os.path.dirname(os.path.abspath(_DB_PATH)) or ".",
                        ".modelbook_dollarvol_v1")
    if os.path.exists(flag):
        return
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute("UPDATE modelbook_stocks SET avg_vol = NULL")
            c.commit()
        with open(flag, "w", encoding="utf-8") as f:
            f.write("done\n")
    except OSError:
        pass


def save_stats(stock_id: int, oc_pct, lh_pct, avg_vol=None) -> None:
    """Persist computed year price stats so they survive redeploys (closed-year
    stats are static, so this is a permanent cache)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "UPDATE modelbook_stocks SET oc_pct = ?, lh_pct = ?, avg_vol = ?, stats_at = ? WHERE id = ?",
            (oc_pct, lh_pct, avg_vol, int(time.time()), int(stock_id)),
        )
        c.commit()


def save_descriptions(stock_id: int, company_desc, run_story) -> None:
    """Persist AI-generated company description + year narrative (generated once)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "UPDATE modelbook_stocks SET company_desc = ?, run_story = ?, desc_at = ? WHERE id = ?",
            (company_desc, run_story, int(time.time()), int(stock_id)),
        )
        c.commit()


def mark_desc_attempt(stock_id: int) -> None:
    """Record that we attempted description generation (even on failure) so the
    generator/poller don't retry in a tight loop."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE modelbook_stocks SET desc_at = ? WHERE id = ?",
                  (int(time.time()), int(stock_id)))
        c.commit()


def get_stock_detail(stock_id: int) -> Optional[dict]:
    """A single stock with its full setups[] list (ordered by label_date)."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM modelbook_stocks WHERE id = ?", (int(stock_id),)
        ).fetchone()
        if not row:
            return None
        stock = dict(row)
        setups = c.execute(
            """SELECT * FROM modelbook_setups
               WHERE stock_id = ?
               ORDER BY label_date ASC, id ASC""",
            (int(stock_id),),
        ).fetchall()
        stock["setups"] = [dict(s) for s in setups]
        return stock


def create_stock(payload: dict) -> dict:
    """Insert a curated stock. Re-adding the same (year, symbol) updates it."""
    now = int(time.time())
    data = {f: payload.get(f) for f in _STOCK_FIELDS}
    data["symbol"] = (data.get("symbol") or "").upper()
    data["sort_order"] = data.get("sort_order") or 0
    data["created_at"] = now
    data["updated_at"] = now
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            """INSERT INTO modelbook_stocks
               (year, symbol, company, sort_order, thesis, gain_pct,
                created_at, updated_at)
               VALUES (:year, :symbol, :company, :sort_order, :thesis, :gain_pct,
                       :created_at, :updated_at)
               ON CONFLICT(year, symbol) DO UPDATE SET
                 company    = excluded.company,
                 sort_order = excluded.sort_order,
                 thesis     = excluded.thesis,
                 gain_pct   = excluded.gain_pct,
                 updated_at = excluded.updated_at""",
            data,
        )
        c.commit()
        new_id = cur.lastrowid
        # ON CONFLICT path doesn't reliably set lastrowid — resolve by key.
        if not new_id:
            new_id = c.execute(
                "SELECT id FROM modelbook_stocks WHERE year = ? AND symbol = ?",
                (data["year"], data["symbol"]),
            ).fetchone()["id"]
    return get_stock_detail(new_id)


def update_stock(stock_id: int, payload: dict) -> Optional[dict]:
    """Patch any provided stock fields. Unknown keys ignored."""
    fields = {f: payload[f] for f in _STOCK_FIELDS if f in payload}
    if "symbol" in fields and fields["symbol"]:
        fields["symbol"] = fields["symbol"].upper()
    if not fields:
        return get_stock_detail(stock_id)
    fields["updated_at"] = int(time.time())
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["id"] = int(stock_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            f"UPDATE modelbook_stocks SET {set_clause} WHERE id = :id", fields
        )
        c.commit()
        if cur.rowcount == 0:
            return None
    return get_stock_detail(stock_id)


def delete_stock(stock_id: int) -> bool:
    """Delete a stock and (via FK cascade) all its setups."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM modelbook_stocks WHERE id = ?", (int(stock_id),))
        c.commit()
        return cur.rowcount > 0


# ── Setups ───────────────────────────────────────────────────────────────────

def _stock_exists(c: sqlite3.Connection, stock_id: int) -> bool:
    return c.execute(
        "SELECT 1 FROM modelbook_stocks WHERE id = ?", (int(stock_id),)
    ).fetchone() is not None


def create_setup(stock_id: int, payload: dict) -> Optional[dict]:
    """Add a labeled playbook setup to a stock. Returns None if stock missing."""
    data = {f: payload.get(f) for f in _SETUP_FIELDS}
    data["stock_id"] = int(stock_id)
    data["timeframe"] = data.get("timeframe") or "D"
    data["marker_side"] = data.get("marker_side") or "belowBar"
    data["marker_shape"] = data.get("marker_shape") or "arrowUp"
    data["created_at"] = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        if not _stock_exists(c, stock_id):
            return None
        cur = c.execute(
            """INSERT INTO modelbook_setups
               (stock_id, setup_type, label_date, timeframe, entry_price,
                stop_price, target_price, grade, notes, marker_side,
                marker_shape, created_at)
               VALUES (:stock_id, :setup_type, :label_date, :timeframe,
                       :entry_price, :stop_price, :target_price, :grade, :notes,
                       :marker_side, :marker_shape, :created_at)""",
            data,
        )
        c.commit()
        new_id = cur.lastrowid
    return get_setup(new_id)


def get_setup(setup_id: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM modelbook_setups WHERE id = ?", (int(setup_id),)
        ).fetchone()
        return dict(row) if row else None


def update_setup(setup_id: int, payload: dict) -> Optional[dict]:
    fields = {f: payload[f] for f in _SETUP_FIELDS if f in payload}
    if not fields:
        return get_setup(setup_id)
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["id"] = int(setup_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            f"UPDATE modelbook_setups SET {set_clause} WHERE id = :id", fields
        )
        c.commit()
        if cur.rowcount == 0:
            return None
    return get_setup(setup_id)


def delete_setup(setup_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM modelbook_setups WHERE id = ?", (int(setup_id),))
        c.commit()
        return cur.rowcount > 0


# ── One-time bootstrap seed ───────────────────────────────────────────────────

# Initial curated lists. Seeded once at startup so the library isn't empty even
# before the operator has admin rights to use the in-app curation UI.
_SEED = {
    2024: [
        ("QUBT", "Quantum Computing Inc."), ("QBTS", "D-Wave Quantum"),
        ("RGTI", "Rigetti Computing"), ("IONQ", "IonQ"),
        ("ASTS", "AST SpaceMobile"), ("AAOI", "Applied Optoelectronics"),
        ("APP", "AppLovin"), ("MSTR", "MicroStrategy"),
        ("OKLO", "Oklo"), ("PLTR", "Palantir Technologies"),
    ],
    2025: [
        ("SNDK", "SanDisk"), ("APLD", "Applied Digital"),
        ("BE", "Bloom Energy"), ("CIFR", "Cipher Mining"),
        ("AXTI", "AXT Inc."), ("ASTS", "AST SpaceMobile"),
        ("CLS", "Celestica"), ("IREN", "IREN Ltd"),
        ("MU", "Micron Technology"), ("ONDS", "Ondas Holdings"),
    ],
}


def seed_initial() -> None:
    """One-time seed of the initial model-book lists. Gated by a flag file
    (mirrors the DATA_DIR heal-flag idiom) so it runs once ever and never fights
    future manual curation — once seeded, operator deletions stick across deploys.
    Upserts on (year, symbol), so it's also safe if some rows already exist."""
    flag = os.path.join(os.path.dirname(os.path.abspath(_DB_PATH)) or ".",
                        ".modelbook_seed_v1")
    if os.path.exists(flag):
        return
    for year, rows in _SEED.items():
        for i, (symbol, company) in enumerate(rows):
            create_stock({"year": year, "symbol": symbol,
                          "company": company, "sort_order": i + 1})
    try:
        with open(flag, "w", encoding="utf-8") as f:
            f.write("seeded\n")
    except OSError:
        pass
