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
  sector      TEXT,          -- curated GICS sector for the watermark (historical/delisted/renamed tickers)
  industry    TEXT,          -- curated GICS industry for the watermark
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
  frame_start_date TEXT,           -- optional left edge for the focus-zoom frame (label_date is the right edge)
  timeframe    TEXT    NOT NULL DEFAULT 'D',
  entry_price  REAL,
  stop_price   REAL,
  target_price REAL,
  grade        TEXT,
  notes        TEXT,
  marker_side  TEXT    NOT NULL DEFAULT 'belowBar',
  marker_shape TEXT    NOT NULL DEFAULT 'arrowUp',
  drawings_json TEXT,              -- JSON array of chart annotations (trendlines etc.) shown when this setup is focused
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mb_setups_stock ON modelbook_setups(stock_id, label_date);

CREATE TABLE IF NOT EXISTS modelbook_catalysts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id      INTEGER NOT NULL REFERENCES modelbook_stocks(id) ON DELETE CASCADE,
  catalyst_date TEXT    NOT NULL,  -- 'YYYY-MM-DD' the trading day the catalyst hit (the candle marked)
  title         TEXT    NOT NULL,  -- short headline (e.g. "Q3 earnings beat")
  description   TEXT,              -- one-sentence explanation of the catalyst + why it moved the stock
  move_pct      REAL,              -- the immediate single-day % move on that day
  sort_order    INTEGER NOT NULL DEFAULT 0,
  source        TEXT    NOT NULL DEFAULT 'ai',  -- 'ai' (generated) or 'manual' (admin-entered)
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mb_catalysts_stock ON modelbook_catalysts(stock_id, catalyst_date);

CREATE TABLE IF NOT EXISTS modelbook_index_drawings (
  symbol        TEXT PRIMARY KEY,   -- index pane symbol, e.g. '^IXIC' (GLOBAL: one shared set, shown on every stock)
  drawings_json TEXT,               -- JSON array of chart annotations (measure marks for Nasdaq corrections)
  updated_at    INTEGER
);

CREATE TABLE IF NOT EXISTS modelbook_stock_bars (
  stock_id   INTEGER PRIMARY KEY REFERENCES modelbook_stocks(id) ON DELETE CASCADE,
  bars_json  TEXT,                  -- uploaded daily OHLCV for a delisted stock (JSON array [{t,o,h,l,c,v}]); served to the chart instead of the (missing) provider data
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS modelbook_year_recaps (
  year         INTEGER PRIMARY KEY, -- calendar year (1990..) — one AI market recap shown on year-tab hover
  headline     TEXT,                -- short characterization of the year (3-7 words)
  recap        TEXT,                -- flowing prose: broad market, leadership themes, momentum-trader climate
  themes_json  TEXT,                -- JSON array of the year's leadership theme strings (chips)
  trader_score INTEGER,             -- 1-10 how hospitable the year was to a momentum/breakout swing trader
  market_tone  TEXT,                -- short tone label (e.g. "Roaring bull", "Brutal bear")
  recap_at     INTEGER,             -- epoch of last generation attempt (the "already tried, don't loop" marker)
  model        TEXT
);
"""

# Fields a client may set on a stock / setup (id, created_at, updated_at managed here).
_STOCK_FIELDS = ("year", "symbol", "company", "sector", "industry", "sort_order",
                 "thesis", "gain_pct", "company_desc", "run_story", "drawings_json")
_SETUP_FIELDS = ("setup_type", "label_date", "frame_start_date", "timeframe",
                 "entry_price", "stop_price", "target_price", "grade", "notes",
                 "marker_side", "marker_shape", "drawings_json")
_CATALYST_FIELDS = ("catalyst_date", "title", "description", "move_pct",
                    "sort_order", "source")


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
            ("modelbook_stocks", "catalysts_at", "INTEGER"),   # epoch of last AI catalyst-generation attempt
            ("modelbook_stocks", "drawings_json", "TEXT"),      # stock-level chart annotations (full-year view, not tied to a setup)
            ("modelbook_stocks", "sector", "TEXT"),             # curated watermark sector (renamed/delisted tickers)
            ("modelbook_stocks", "industry", "TEXT"),           # curated watermark industry
            ("modelbook_setups", "frame_start_date", "TEXT"),
            ("modelbook_setups", "drawings_json", "TEXT"),
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


def regen_descriptions(version_tag: str) -> None:
    """One-time (per tag): clear AI descriptions so the warm regenerates them with
    an updated prompt. Flag-gated by version_tag so each prompt revision runs once."""
    flag = os.path.join(os.path.dirname(os.path.abspath(_DB_PATH)) or ".",
                        f".modelbook_desc_{version_tag}")
    if os.path.exists(flag):
        return
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute("UPDATE modelbook_stocks SET company_desc = NULL, run_story = NULL, desc_at = NULL")
            c.commit()
        with open(flag, "w", encoding="utf-8") as f:
            f.write("done\n")
    except OSError:
        pass


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


def save_descriptions(stock_id: int, company_desc, run_story,
                      sector=None, industry=None) -> None:
    """Persist AI-generated company description + year narrative (generated once).
    Also backfills the watermark sector/industry, but only when they're still
    empty — COALESCE(NULLIF(...)) so a manually-curated value is never clobbered."""
    sector = (sector or "").strip() or None
    industry = (industry or "").strip() or None
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """UPDATE modelbook_stocks
               SET company_desc = ?, run_story = ?, desc_at = ?,
                   sector   = COALESCE(NULLIF(sector, ''), ?),
                   industry = COALESCE(NULLIF(industry, ''), ?)
               WHERE id = ?""",
            (company_desc, run_story, int(time.time()), sector, industry, int(stock_id)),
        )
        c.commit()


def mark_desc_attempt(stock_id: int) -> None:
    """Record that we attempted description generation (even on failure) so the
    generator/poller don't retry in a tight loop."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE modelbook_stocks SET desc_at = ? WHERE id = ?",
                  (int(time.time()), int(stock_id)))
        c.commit()


def save_watermark_meta(stock_id: int, sector=None, industry=None) -> None:
    """Backfill ONLY the watermark sector/industry (COALESCE — never clobber a
    curated value), without touching company_desc/run_story/desc_at. Used when an
    LLM pass yielded the GICS meta but no usable description, so the description
    still re-attempts later while the watermark fills now."""
    sector = (sector or "").strip() or None
    industry = (industry or "").strip() or None
    if not (sector or industry):
        return
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """UPDATE modelbook_stocks
               SET sector   = COALESCE(NULLIF(sector, ''), ?),
                   industry = COALESCE(NULLIF(industry, ''), ?)
               WHERE id = ?""",
            (sector, industry, int(stock_id)),
        )
        c.commit()


def reset_year_derived(stock_id: int) -> None:
    """Invalidate a stock's cached year data after its bars are replaced/cleared:
    clear the price stats (oc/lh/avg_vol) so the warm recomputes them, drop any
    AI-generated catalysts (they were anchored to the OLD bars' big-move days), and
    reset catalysts_at so they regenerate from the new bars. Manual catalysts are
    preserved (and keep auto-gen from running while they exist)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("DELETE FROM modelbook_catalysts WHERE stock_id = ? AND source = 'ai'",
                  (int(stock_id),))
        c.execute("""UPDATE modelbook_stocks
                     SET oc_pct = NULL, lh_pct = NULL, avg_vol = NULL, stats_at = NULL,
                         catalysts_at = NULL
                     WHERE id = ?""", (int(stock_id),))
        c.commit()


def heal_custom_bars_derived(version_tag: str) -> None:
    """One-time (per tag): for stocks with admin-uploaded custom bars, clear cached
    price stats + reset catalysts_at (only when they have no catalysts yet) so the
    background warm recomputes BOTH from the uploaded bars. Fixes delisted/renamed
    tickers (e.g. YELL=YRCW in 2013) whose gain/$vol/catalysts were blank because
    the old code fetched provider data the current symbol no longer has. Flag-gated."""
    flag = os.path.join(os.path.dirname(os.path.abspath(_DB_PATH)) or ".",
                        f".modelbook_heal_{version_tag}")
    if os.path.exists(flag):
        return
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute(
                """UPDATE modelbook_stocks
                   SET oc_pct = NULL, lh_pct = NULL, avg_vol = NULL, stats_at = NULL,
                       catalysts_at = CASE
                         WHEN id IN (SELECT stock_id FROM modelbook_catalysts)
                         THEN catalysts_at ELSE NULL END
                   WHERE id IN (SELECT stock_id FROM modelbook_stock_bars
                                WHERE bars_json IS NOT NULL)""")
            c.commit()
        with open(flag, "w", encoding="utf-8") as f:
            f.write("done\n")
    except OSError:
        pass


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
        catalysts = c.execute(
            """SELECT * FROM modelbook_catalysts
               WHERE stock_id = ?
               ORDER BY sort_order ASC, catalyst_date ASC, id ASC""",
            (int(stock_id),),
        ).fetchall()
        stock["catalysts"] = [dict(x) for x in catalysts]
        # Flag (not the data) so the detail stays light — the chart fetches the
        # actual uploaded bars once from /stock/{id}/bars when this is true.
        bw = c.execute(
            "SELECT 1 FROM modelbook_stock_bars WHERE stock_id = ? AND bars_json IS NOT NULL",
            (int(stock_id),),
        ).fetchone()
        stock["has_custom_bars"] = bw is not None
        return stock


def create_stock(payload: dict) -> dict:
    """Insert a curated stock. Re-adding the same (year, symbol) updates it."""
    now = int(time.time())
    data = {f: payload.get(f) for f in _STOCK_FIELDS}
    data["symbol"] = (data.get("symbol") or "").upper()
    # Normalize blanks to NULL so the ON CONFLICT COALESCE keeps any AI-filled value.
    data["sector"] = (data.get("sector") or "").strip() or None
    data["industry"] = (data.get("industry") or "").strip() or None
    data["sort_order"] = data.get("sort_order") or 0
    data["created_at"] = now
    data["updated_at"] = now
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            """INSERT INTO modelbook_stocks
               (year, symbol, company, sector, industry, sort_order, thesis, gain_pct,
                created_at, updated_at)
               VALUES (:year, :symbol, :company, :sector, :industry, :sort_order,
                       :thesis, :gain_pct, :created_at, :updated_at)
               ON CONFLICT(year, symbol) DO UPDATE SET
                 company    = excluded.company,
                 -- only overwrite curated sector/industry when the re-add supplies
                 -- one (an Add with the field left blank keeps the AI-filled value)
                 sector     = COALESCE(excluded.sector, modelbook_stocks.sector),
                 industry   = COALESCE(excluded.industry, modelbook_stocks.industry),
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
               (stock_id, setup_type, label_date, frame_start_date, timeframe,
                entry_price, stop_price, target_price, grade, notes, marker_side,
                marker_shape, drawings_json, created_at)
               VALUES (:stock_id, :setup_type, :label_date, :frame_start_date,
                       :timeframe, :entry_price, :stop_price, :target_price,
                       :grade, :notes, :marker_side, :marker_shape, :drawings_json,
                       :created_at)""",
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


# ── Catalysts ─────────────────────────────────────────────────────────────────

def get_catalyst(catalyst_id: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM modelbook_catalysts WHERE id = ?", (int(catalyst_id),)
        ).fetchone()
        return dict(row) if row else None


def create_catalyst(stock_id: int, payload: dict) -> Optional[dict]:
    """Add one catalyst to a stock. Returns None if the stock is missing."""
    data = {f: payload.get(f) for f in _CATALYST_FIELDS}
    data["stock_id"] = int(stock_id)
    data["source"] = data.get("source") or "manual"
    data["sort_order"] = data.get("sort_order") or 0
    data["created_at"] = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        if not _stock_exists(c, stock_id):
            return None
        cur = c.execute(
            """INSERT INTO modelbook_catalysts
               (stock_id, catalyst_date, title, description, move_pct, sort_order,
                source, created_at)
               VALUES (:stock_id, :catalyst_date, :title, :description, :move_pct,
                       :sort_order, :source, :created_at)""",
            data,
        )
        c.commit()
        new_id = cur.lastrowid
    return get_catalyst(new_id)


def update_catalyst(catalyst_id: int, payload: dict) -> Optional[dict]:
    fields = {f: payload[f] for f in _CATALYST_FIELDS if f in payload}
    if not fields:
        return get_catalyst(catalyst_id)
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["id"] = int(catalyst_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            f"UPDATE modelbook_catalysts SET {set_clause} WHERE id = :id", fields
        )
        c.commit()
        if cur.rowcount == 0:
            return None
    return get_catalyst(catalyst_id)


def delete_catalyst(catalyst_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM modelbook_catalysts WHERE id = ?", (int(catalyst_id),))
        c.commit()
        return cur.rowcount > 0


def mark_catalysts_attempt(stock_id: int) -> None:
    """Stamp catalysts_at without writing rows — records that auto-generation was
    attempted (even on failure/empty) so the poller/warm don't retry in a loop."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE modelbook_stocks SET catalysts_at = ? WHERE id = ?",
                  (int(time.time()), int(stock_id)))
        c.commit()


def get_stocks_needing_catalysts(retry_after: int = 86400) -> list[dict]:
    """Stocks with NO catalysts and no recent generation attempt — used by the
    background warm to pre-populate catalysts (each generated once, then kept)."""
    cutoff = int(time.time()) - int(retry_after)
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT s.* FROM modelbook_stocks s
               LEFT JOIN modelbook_catalysts x ON x.stock_id = s.id
               WHERE x.id IS NULL AND (s.catalysts_at IS NULL OR s.catalysts_at < ?)
               GROUP BY s.id""",
            (cutoff,),
        ).fetchall()
        return [dict(r) for r in rows]


def regen_catalysts(version_tag: str) -> None:
    """One-time (per tag): drop AI-generated catalysts + reset catalysts_at so the
    auto-generator rebuilds them with an updated prompt/policy (e.g. bullish-only).
    Manual ('manual' source) catalysts are preserved. Flag-gated so it runs once."""
    flag = os.path.join(os.path.dirname(os.path.abspath(_DB_PATH)) or ".",
                        f".modelbook_catalysts_{version_tag}")
    if os.path.exists(flag):
        return
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute("DELETE FROM modelbook_catalysts WHERE source = 'ai'")
            c.execute("UPDATE modelbook_stocks SET catalysts_at = NULL")
            c.commit()
        with open(flag, "w", encoding="utf-8") as f:
            f.write("done\n")
    except OSError:
        pass


def replace_catalysts(stock_id: int, items: list[dict]) -> Optional[list[dict]]:
    """Replace ALL of a stock's catalysts with a fresh set (used by AI generation).
    Stamps catalysts_at so a failed/empty generation isn't retried in a loop.
    Returns the new catalyst list, or None if the stock is missing."""
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        if not _stock_exists(c, stock_id):
            return None
        c.execute("DELETE FROM modelbook_catalysts WHERE stock_id = ?", (int(stock_id),))
        for i, it in enumerate(items or []):
            data = {f: it.get(f) for f in _CATALYST_FIELDS}
            data["stock_id"] = int(stock_id)
            data["source"] = data.get("source") or "ai"
            data["sort_order"] = data.get("sort_order") if data.get("sort_order") is not None else i
            data["created_at"] = now
            c.execute(
                """INSERT INTO modelbook_catalysts
                   (stock_id, catalyst_date, title, description, move_pct, sort_order,
                    source, created_at)
                   VALUES (:stock_id, :catalyst_date, :title, :description, :move_pct,
                           :sort_order, :source, :created_at)""",
                data,
            )
        c.execute("UPDATE modelbook_stocks SET catalysts_at = ? WHERE id = ?",
                  (now, int(stock_id)))
        c.commit()
        rows = c.execute(
            """SELECT * FROM modelbook_catalysts WHERE stock_id = ?
               ORDER BY sort_order ASC, catalyst_date ASC, id ASC""",
            (int(stock_id),),
        ).fetchall()
        return [dict(r) for r in rows]


# ── Index-pane annotations (GLOBAL — shared across every stock) ────────────────
# The ^IXIC reference line in the top pane is the same on every chart (just
# clipped to each stock's date window), so its annotations (measure marks for
# Nasdaq corrections) live in ONE shared row keyed by index symbol — drawn once
# by an admin, shown read-only to all users on every stock.

def get_index_drawings(symbol: str) -> str:
    """Return the stored drawings_json for an index symbol, or '[]' if none."""
    sym = (symbol or "").upper()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT drawings_json FROM modelbook_index_drawings WHERE symbol = ?",
            (sym,),
        ).fetchone()
    if row and row["drawings_json"]:
        return row["drawings_json"]
    return "[]"


def get_stock_bars(stock_id: int) -> Optional[str]:
    """Uploaded daily OHLCV (JSON array string) for a delisted stock, or None."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT bars_json FROM modelbook_stock_bars WHERE stock_id = ?",
            (int(stock_id),),
        ).fetchone()
    return row["bars_json"] if row and row["bars_json"] else None


def set_stock_bars(stock_id: int, bars_json: str) -> bool:
    """Upsert uploaded bars for a stock. Returns False if the stock is missing."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        if not _stock_exists(c, stock_id):
            return False
        c.execute(
            """INSERT INTO modelbook_stock_bars (stock_id, bars_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(stock_id) DO UPDATE SET
                 bars_json  = excluded.bars_json,
                 updated_at = excluded.updated_at""",
            (int(stock_id), bars_json, int(time.time())),
        )
        c.commit()
    return True


def delete_stock_bars(stock_id: int) -> bool:
    """Remove uploaded bars for a stock. Returns True if a row was deleted."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM modelbook_stock_bars WHERE stock_id = ?", (int(stock_id),))
        c.commit()
        return cur.rowcount > 0


def set_index_drawings(symbol: str, drawings_json: str) -> str:
    """Upsert the shared drawings_json for an index symbol. Returns the stored value."""
    sym = (symbol or "").upper()
    val = drawings_json if drawings_json else "[]"
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO modelbook_index_drawings (symbol, drawings_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(symbol) DO UPDATE SET
                 drawings_json = excluded.drawings_json,
                 updated_at    = excluded.updated_at""",
            (sym, val, int(time.time())),
        )
        c.commit()
    return val


# ── Year recaps (AI market-history recap shown on year-tab hover) ─────────────

def get_year_recap(year: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM modelbook_year_recaps WHERE year = ?", (int(year),)
        ).fetchone()
        return dict(row) if row else None


def save_year_recap(year: int, data: dict) -> None:
    """Upsert a generated year recap. Stamps recap_at as the don't-loop marker."""
    payload = {
        "year": int(year),
        "headline": (data.get("headline") or None),
        "recap": (data.get("recap") or None),
        "themes_json": data.get("themes_json"),
        "trader_score": data.get("trader_score"),
        "market_tone": (data.get("market_tone") or None),
        "recap_at": int(time.time()),
        "model": data.get("model"),
    }
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO modelbook_year_recaps
               (year, headline, recap, themes_json, trader_score, market_tone, recap_at, model)
               VALUES (:year, :headline, :recap, :themes_json, :trader_score, :market_tone,
                       :recap_at, :model)
               ON CONFLICT(year) DO UPDATE SET
                 headline = excluded.headline, recap = excluded.recap,
                 themes_json = excluded.themes_json, trader_score = excluded.trader_score,
                 market_tone = excluded.market_tone, recap_at = excluded.recap_at,
                 model = excluded.model""",
            payload,
        )
        c.commit()


def mark_recap_attempt(year: int) -> None:
    """Stamp recap_at without writing prose — records a failed/empty generation so
    the poller/warm don't retry in a tight loop."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO modelbook_year_recaps (year, recap_at) VALUES (?, ?)
               ON CONFLICT(year) DO UPDATE SET recap_at = excluded.recap_at""",
            (int(year), int(time.time())),
        )
        c.commit()


def regen_year_recaps(version_tag: str) -> None:
    """One-time (per tag): drop all stored year recaps so they regenerate with an
    updated prompt/length (e.g. after the 1200-char mid-word truncation fix).
    Flag-gated so it runs once ever; warm + on-demand hover rebuild them."""
    flag = os.path.join(os.path.dirname(os.path.abspath(_DB_PATH)) or ".",
                        f".modelbook_recaps_{version_tag}")
    if os.path.exists(flag):
        return
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as c:
            c.execute("DELETE FROM modelbook_year_recaps")
            c.commit()
        with open(flag, "w", encoding="utf-8") as f:
            f.write("done\n")
    except OSError:
        pass


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
