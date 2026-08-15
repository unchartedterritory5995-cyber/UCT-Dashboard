"""
darkpool_db.py — SQLite persistence for dark pool block trade data.

Mirrors the flow_db.py architecture: Railway persistent volume, dedup on
insert, date-range queries, streaming CSV output, auto-prune for old data.

Seeding from app/public/Darkpool-data.csv is handled by main.py's startup
background thread (parallel to the flow DB seed) — it is NOT triggered on
import here. That keeps app boot fast and the seed observable in logs.
"""

import sqlite3
import os
import csv
import io

# Railway persistent volume path (matches flow_db)
DB_DIR = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "/data")
DB_PATH = os.path.join(DB_DIR, "darkpool.db")

# CSV column order — must match what DarkPool.jsx expects from /api/darkpool/data
CSV_COLUMNS = [
    "Date", "Timestamp", "Ticker", "Volume", "Price", "Pct_of_Avg30Day",
    "Notional", "Message", "Type", "SecurityType", "Industry", "Sector",
    "Avg30Day", "Float", "EarningsDate"
]
_HEADER_LINE = ",".join(CSV_COLUMNS) + "\n"

# DB column names in the same logical order (for SELECT)
_DB_COLS = [
    "date", "timestamp", "ticker", "volume", "price", "pct_avg30",
    "notional", "message", "type", "security_type", "industry", "sector",
    "avg30day", "float_shares", "earnings_date"
]
_SELECT_COLS = ", ".join(_DB_COLS)

# Stream batch size: balance ASGI round-trips vs memory.
# Larger = fewer yields, smaller = lower peak memory.
_STREAM_BATCH = 2000


def get_conn():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables and indexes if they don't exist. Idempotent + fast."""
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS darkpool_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            timestamp TEXT,
            ticker TEXT NOT NULL,
            volume REAL,
            price REAL,
            pct_avg30 REAL,
            notional REAL,
            message TEXT,
            type TEXT,
            security_type TEXT,
            industry TEXT,
            sector TEXT,
            avg30day REAL,
            float_shares REAL,
            earnings_date TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(date, timestamp, ticker, price, notional, message)
        );

        CREATE INDEX IF NOT EXISTS idx_dp_date ON darkpool_trades(date);
        CREATE INDEX IF NOT EXISTS idx_dp_ticker ON darkpool_trades(ticker);
        CREATE INDEX IF NOT EXISTS idx_dp_type ON darkpool_trades(type);
        CREATE INDEX IF NOT EXISTS idx_dp_date_ticker ON darkpool_trades(date, ticker);

        -- Ephemeral intraday preview table (2026-07-27). Live prints land HERE,
        -- never in darkpool_trades, so the intraday poller can insert every few
        -- minutes without bumping darkpool_aggregator's DB signature (which would
        -- invalidate + rebuild every historical window — the 90d/all rebuild
        -- storm). Same schema + dedup as darkpool_trades. This is a preview only:
        -- the nightly 19:20 ET ingest writes the authoritative session into
        -- darkpool_trades and then clear_today() rolls this table.
        CREATE TABLE IF NOT EXISTS darkpool_today (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            timestamp TEXT,
            ticker TEXT NOT NULL,
            volume REAL,
            price REAL,
            pct_avg30 REAL,
            notional REAL,
            message TEXT,
            type TEXT,
            security_type TEXT,
            industry TEXT,
            sector TEXT,
            avg30day REAL,
            float_shares REAL,
            earnings_date TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(date, timestamp, ticker, price, notional, message)
        );

        CREATE INDEX IF NOT EXISTS idx_dpt_ticker ON darkpool_today(ticker);
    """)
    conn.close()


def parse_date_to_sortable(date_str):
    """Convert M/D/YYYY to YYYY-MM-DD for consistent sorting."""
    try:
        parts = date_str.strip().split("/")
        if len(parts) >= 3:
            m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
            if y < 100:
                y += 2000
            return f"{y:04d}-{m:02d}-{d:02d}"
    except (ValueError, IndexError):
        pass
    return date_str


def _resolve_dates(conn, days):
    """Return date strings for the last N trading days, sorted newest first."""
    rows = conn.execute(
        "SELECT DISTINCT date FROM darkpool_trades"
    ).fetchall()
    all_dates = [r["date"] for r in rows]
    all_dates.sort(key=lambda d: parse_date_to_sortable(d), reverse=True)
    if days is not None:
        return all_dates[:days]
    return all_dates


def _insert_rows(csv_text: str, table: str) -> dict:
    """
    Parse CSV text and insert rows into ``table`` (darkpool_trades or
    darkpool_today — identical schema/dedup). Returns
    { inserted, duplicates, errors, total }.
    """
    if table not in ("darkpool_trades", "darkpool_today"):
        raise ValueError(f"refusing to insert into unexpected table {table!r}")

    conn = get_conn()
    reader = csv.DictReader(io.StringIO(csv_text))

    inserted = 0
    duplicates = 0
    errors = 0
    total = 0

    for row in reader:
        total += 1
        try:
            date_raw = (row.get("Date") or "").strip()
            if not date_raw:
                errors += 1
                continue

            ticker = (row.get("Ticker") or "").strip()
            if not ticker:
                errors += 1
                continue

            timestamp = (row.get("Timestamp") or "").strip()
            volume = _float(row.get("Volume"))
            price = _float(row.get("Price"))
            pct_avg30 = _float(row.get("Pct_of_Avg30Day"))
            notional = _float(row.get("Notional"))
            message = (row.get("Message") or "").strip()
            type_ = (row.get("Type") or "").strip()
            security_type = (row.get("SecurityType") or "").strip()
            industry = (row.get("Industry") or "").strip()
            sector = (row.get("Sector") or "").strip()
            avg30day = _float(row.get("Avg30Day"))
            float_shares = _float(row.get("Float"))
            earnings_date = (row.get("EarningsDate") or "").strip()

            cur = conn.execute(f"""
                INSERT OR IGNORE INTO {table}
                (date, timestamp, ticker, volume, price, pct_avg30, notional,
                 message, type, security_type, industry, sector, avg30day,
                 float_shares, earnings_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                date_raw, timestamp, ticker, volume, price, pct_avg30, notional,
                message, type_, security_type, industry, sector, avg30day,
                float_shares, earnings_date
            ))

            if cur.rowcount > 0:
                inserted += 1
            else:
                duplicates += 1

        except Exception as e:
            errors += 1
            if errors <= 3:
                print(f"[darkpool_db] Row error ({table}): {e}")

    conn.commit()
    conn.close()

    print(f"[darkpool_db] {table} upload: {inserted} inserted, {duplicates} dupes, "
          f"{errors} errors / {total} total")
    return {"inserted": inserted, "duplicates": duplicates, "errors": errors, "total": total}


def insert_csv_rows(csv_text: str) -> dict:
    """Parse CSV text and insert into darkpool_trades (the historical table)."""
    return _insert_rows(csv_text, "darkpool_trades")


# ── Intraday preview table (darkpool_today) ─────────────────────────────

def insert_today_rows(csv_text: str) -> dict:
    """Insert live intraday prints into the ephemeral darkpool_today table.

    Same parse/dedup as insert_csv_rows but targets the preview table, so a
    poll every few minutes never touches darkpool_trades (and thus never
    invalidates the historical aggregation cache). Returns the insert summary.
    """
    return _insert_rows(csv_text, "darkpool_today")


def today_rows_signature() -> str:
    """Cheap fingerprint of darkpool_today (row_count, max_id). Used as the
    today-aggregate cache key so it rebuilds only when new live prints land —
    independent of the historical darkpool_trades signature."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS c, MAX(id) AS m FROM darkpool_today"
        ).fetchone()
        return f"{row['c']}-{row['m'] or 0}"
    finally:
        conn.close()


def clear_today() -> int:
    """Truncate the intraday preview table. Called at session roll and after
    the nightly ingest folds the authoritative day into darkpool_trades.
    Returns the number of rows removed."""
    conn = get_conn()
    try:
        n = conn.execute("SELECT COUNT(*) AS c FROM darkpool_today").fetchone()["c"]
        conn.execute("DELETE FROM darkpool_today")
        conn.commit()
        print(f"[darkpool_db] cleared darkpool_today ({n} rows)")
        return n
    finally:
        conn.close()


def get_today_stats() -> dict:
    """Row/ticker/notional summary of the live preview table + its latest print
    timestamp — feeds the intraday status endpoint and the frontend freshness
    line. Cheap: one partial day of rows."""
    conn = get_conn()
    try:
        total = conn.execute("SELECT COUNT(*) AS c FROM darkpool_today").fetchone()["c"]
        tickers = conn.execute(
            "SELECT COUNT(DISTINCT ticker) AS c FROM darkpool_today").fetchone()["c"]
        row = conn.execute(
            "SELECT MAX(date) AS d, SUM(notional) AS n FROM darkpool_today").fetchone()
        last_ts = conn.execute(
            "SELECT timestamp FROM darkpool_today ORDER BY id DESC LIMIT 1").fetchone()
        return {
            "total_rows": total,
            "tickers": tickers,
            "date": row["d"] if row else None,
            "total_notional": row["n"] if row and row["n"] else 0,
            "last_timestamp": last_ts["timestamp"] if last_ts else None,
        }
    finally:
        conn.close()


def stream_today_csv():
    """Yield the darkpool_today rows as CSV (header first). Mirrors stream_csv
    but for the preview table — the intraday aggregate consumes this."""
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            f"SELECT {_SELECT_COLS} FROM darkpool_today "
            f"ORDER BY date DESC, timestamp DESC"
        )
        yield _HEADER_LINE
        buf = io.StringIO()
        writer = csv.writer(buf)
        count = 0
        for row in cursor:
            writer.writerow(list(row))
            count += 1
            if count % _STREAM_BATCH == 0:
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate(0)
        remainder = buf.getvalue()
        if remainder:
            yield remainder
    finally:
        conn.close()


# ── Streaming CSV (preferred for /api/darkpool/data) ────────────────────

def stream_csv(days=None, all_data: bool = False):
    """
    Generator that yields CSV chunks from the database.

    Uses cursor iteration (no fetchall) so memory stays flat regardless
    of result size, and rows ship as soon as the first batch is ready —
    no server-side wait for a giant string to be built.

    ``days=None`` or ``all_data=True`` means everything.
    Matches the flow_db.FlowDB.stream_csv pattern.
    """
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    try:
        if all_data or days is None:
            cursor = conn.execute(
                f"SELECT {_SELECT_COLS} FROM darkpool_trades "
                f"ORDER BY date DESC, timestamp DESC"
            )
        else:
            selected_dates = _resolve_dates(conn, days)
            if not selected_dates:
                yield _HEADER_LINE
                return
            placeholders = ",".join(["?"] * len(selected_dates))
            cursor = conn.execute(
                f"SELECT {_SELECT_COLS} FROM darkpool_trades "
                f"WHERE date IN ({placeholders}) "
                f"ORDER BY date DESC, timestamp DESC",
                selected_dates,
            )

        yield _HEADER_LINE

        buf = io.StringIO()
        writer = csv.writer(buf)
        count = 0

        for row in cursor:
            writer.writerow(list(row))
            count += 1
            if count % _STREAM_BATCH == 0:
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate(0)

        remainder = buf.getvalue()
        if remainder:
            yield remainder
    finally:
        conn.close()


# ── Legacy full-string method (kept for backward compat) ────────────────

def get_data_csv(days=None, all_data: bool = False) -> str:
    """
    Retrieve dark pool data as CSV text. Kept for backward compat — new
    code should use stream_csv() to avoid building large strings in memory.
    """
    if days is None and not all_data:
        days = 1
    return "".join(stream_csv(days=days, all_data=all_data))


def get_available_dates() -> list:
    """Return list of unique trading dates in the DB, sorted chronologically."""
    conn = get_conn()
    rows = conn.execute("SELECT DISTINCT date FROM darkpool_trades").fetchall()
    conn.close()
    dates = [r["date"] for r in rows]
    dates.sort(key=lambda d: parse_date_to_sortable(d))
    return dates


def get_stats() -> dict:
    """Return DB stats for admin dashboard."""
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) as c FROM darkpool_trades").fetchone()["c"]
    dates = conn.execute("SELECT COUNT(DISTINCT date) as c FROM darkpool_trades").fetchone()["c"]
    tickers = conn.execute("SELECT COUNT(DISTINCT ticker) as c FROM darkpool_trades").fetchone()["c"]
    # 2026-07-24: `date` is TEXT in M/D/YYYY, so ORDER BY date is a LEXICOGRAPHIC
    # sort — "7/9/2026" beats "7/24/2026" because '9' > '2'. That made
    # latest_date report 7/9 while the DB actually ran through 7/23, which is
    # misleading precisely when you check it (confirming a nightly ingest ran).
    # Every other function here already routes through parse_date_to_sortable();
    # do the same by sorting the distinct dates in Python.
    _all_dates = [r["date"] for r in
                  conn.execute("SELECT DISTINCT date FROM darkpool_trades").fetchall()]
    _all_dates.sort(key=parse_date_to_sortable)
    latest = {"date": _all_dates[-1]} if _all_dates else None
    earliest = {"date": _all_dates[0]} if _all_dates else None
    db_size = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
    conn.close()
    return {
        "total_rows": total,
        "trading_days": dates,
        "tickers": tickers,
        "latest_date": latest["date"] if latest else None,
        "earliest_date": earliest["date"] if earliest else None,
        "db_path": DB_PATH,
        "db_size_mb": round(db_size / 1e6, 1),
    }


def prune_old_data(keep_days: int = 120):
    """Remove data older than keep_days trading days."""
    conn = get_conn()
    dates = conn.execute(
        "SELECT DISTINCT date FROM darkpool_trades"
    ).fetchall()
    date_list = sorted(
        [r["date"] for r in dates],
        key=lambda d: parse_date_to_sortable(d),
        reverse=True
    )
    if len(date_list) <= keep_days:
        conn.close()
        return 0

    old_dates = date_list[keep_days:]
    placeholders = ",".join("?" * len(old_dates))
    result = conn.execute(
        f"DELETE FROM darkpool_trades WHERE date IN ({placeholders})",
        old_dates
    )
    deleted = result.rowcount
    conn.commit()
    conn.close()
    print(f"[darkpool_db] Pruned {deleted} rows from {len(old_dates)} old trading days")
    return deleted


def clear_all():
    """Delete all data (admin use)."""
    conn = get_conn()
    conn.execute("DELETE FROM darkpool_trades")
    conn.commit()
    conn.close()
    print("[darkpool_db] Cleared all data")


# ── Helpers ────────────────────────────────────────────────────────────

def _float(val):
    try:
        return float(val) if val else None
    except (ValueError, TypeError):
        return None


def get_ticker_prints(ticker: str, days: int = 30, limit: int = 30, order: str = "date") -> list:
    """Return top dark pool prints for a single ticker over the last ``days``.

    ``order`` controls which ``limit`` prints survive the cap:
      - ``"date"`` (default): most RECENT first — for the Patterns drilldown, where
        current activity is what matters.
      - ``"notional"``: BIGGEST first, across the whole window — for the chart ZONE
        overlay, whose display is already size-ranked. On a heavy dark-flow name
        (e.g. SMH) a recency cap is used up by the last few days and hides large
        historical zones at other price levels; ranking by notional surfaces them.

    Each row dict contains the fields the frontend needs to render print bars:
    date (M/D), price, notional, pctAvgVol, volume, type.
    """
    if not ticker:
        return []
    ticker = ticker.upper().strip()
    if not ticker.replace(".", "").isalnum():
        return []
    if days <= 0 or days > 365:
        days = 30
    if limit <= 0 or limit > 200:
        limit = 30
    by_notional = (order == "notional")
    _order_sql = ("notional DESC, parse_sort_date(date) DESC" if by_notional
                  else "parse_sort_date(date) DESC, notional DESC")

    conn = get_conn()
    try:
        # Use sortable dates (YYYY-MM-DD) for proper range filtering. Take
        # the last N distinct dates, then pull all trades for the ticker on
        # those dates and let the caller filter / rank.
        cur = conn.execute(
            f"""
            WITH recent_dates AS (
                SELECT DISTINCT date FROM darkpool_trades
                ORDER BY parse_sort_date(date) DESC LIMIT ?
            )
            SELECT date, timestamp, price, notional, pct_avg30, volume, type, message
            FROM darkpool_trades
            WHERE ticker = ?
              AND date IN (SELECT date FROM recent_dates)
              AND notional IS NOT NULL
            ORDER BY {_order_sql}
            LIMIT ?
            """,
            (days, ticker, limit),
        )
        rows = cur.fetchall()
    except sqlite3.OperationalError:
        # parse_sort_date isn't a SQL function — fall back to Python-side sort.
        cur = conn.execute(
            "SELECT DISTINCT date FROM darkpool_trades",
        )
        all_dates = [r[0] for r in cur.fetchall()]
        all_dates.sort(key=parse_date_to_sortable, reverse=True)
        recent = set(all_dates[:days])
        if not recent:
            conn.close()
            return []
        placeholders = ",".join("?" for _ in recent)
        cur = conn.execute(
            f"""
            SELECT date, timestamp, price, notional, pct_avg30, volume, type, message
            FROM darkpool_trades
            WHERE ticker = ?
              AND date IN ({placeholders})
              AND notional IS NOT NULL
            """,
            (ticker, *recent),
        )
        raw = cur.fetchall()
        if by_notional:
            raw.sort(key=lambda r: (r[3] or 0, parse_date_to_sortable(r[0])), reverse=True)
        else:
            raw.sort(key=lambda r: (parse_date_to_sortable(r[0]), r[3] or 0), reverse=True)
        rows = raw[:limit]
    finally:
        conn.close()

    out = []
    for row in rows:
        date_str = row[0]
        # Convert M/D/YYYY to short M/D for compact display
        date_short = date_str
        try:
            parts = date_str.split("/")
            if len(parts) >= 2:
                date_short = f"{int(parts[0])}/{int(parts[1])}"
        except (ValueError, IndexError):
            pass
        # Full date for tooltip
        date_long = date_str
        try:
            sortable = parse_date_to_sortable(date_str)
            y, m, d = sortable.split("-")
            months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
            date_long = f"{months[int(m)-1]} {int(d)}, {y}"
        except (ValueError, IndexError):
            pass

        out.append({
            "date": date_short,
            "dateLong": date_long,
            "dateRaw": date_str,
            "price": _float(row[2]),
            "notional": _float(row[3]),
            "pctAvgVol": _float(row[4]) or 0,
            "volume": _float(row[5]),
            "type": row[6] or "",
        })
    return out


def _print_row(row) -> dict:
    """Shape one darkpool_trades row into the print dict callers expect.

    Mirrors the row shape get_ticker_prints returns (date short M/D, dateLong,
    dateRaw, price, notional, pctAvgVol, volume, type).
    """
    date_str = row[0]
    # Convert M/D/YYYY to short M/D for compact display
    date_short = date_str
    try:
        parts = date_str.split("/")
        if len(parts) >= 2:
            date_short = f"{int(parts[0])}/{int(parts[1])}"
    except (ValueError, IndexError):
        pass
    # Full date for tooltip
    date_long = date_str
    try:
        sortable = parse_date_to_sortable(date_str)
        y, m, d = sortable.split("-")
        months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        date_long = f"{months[int(m)-1]} {int(d)}, {y}"
    except (ValueError, IndexError):
        pass
    return {
        "date": date_short,
        "dateLong": date_long,
        "dateRaw": date_str,
        "price": _float(row[2]),
        "notional": _float(row[3]),
        "pctAvgVol": _float(row[4]) or 0,
        "volume": _float(row[5]),
        "type": row[6] or "",
    }


def get_ticker_prints_window(ticker: str, days: int = 30) -> list:
    """Return EVERY print for a ticker over the last N trading days — no row cap.

    Same guards, same date handling (``_resolve_dates``) and same row shape as
    ``get_ticker_prints``, but without its ``LIMIT``. That limit exists to bound
    a display drilldown; for an aggregate (clustering prints into levels) it
    silently truncates the window on a high-volume ticker: ordered date DESC,
    200 rows can cover only the newest handful of dates, so the OLDEST dates —
    and any level that lives on them — vanish from the aggregate entirely. A
    partial window would produce a confidently-wrong #1 level, so this read
    takes the whole window.

    Rows come back newest-date-first, then notional desc, matching
    ``get_ticker_prints``' ordering.
    """
    if not ticker:
        return []
    ticker = ticker.upper().strip()
    if not ticker.replace(".", "").isalnum():
        return []
    if days <= 0 or days > 365:
        days = 30

    conn = get_conn()
    try:
        recent = _resolve_dates(conn, days)
        if not recent:
            return []
        placeholders = ",".join("?" for _ in recent)
        cur = conn.execute(
            f"""
            SELECT date, timestamp, price, notional, pct_avg30, volume, type, message
            FROM darkpool_trades
            WHERE ticker = ?
              AND date IN ({placeholders})
              AND notional IS NOT NULL
            """,
            (ticker, *recent),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    rows = sorted(
        rows,
        key=lambda r: (parse_date_to_sortable(r[0]), r[3] or 0),
        reverse=True,
    )
    return [_print_row(r) for r in rows]


def _dp_dnum(date_raw) -> int:
    """M/D/YYYY (or M/D) → sortable YYYYMMDD int for 'most recent print' picks."""
    parts = str(date_raw or "").split("/")
    if len(parts) < 2:
        return 0
    def _i(x):
        try:
            return int(x)
        except (TypeError, ValueError):
            return 0
    m, d = _i(parts[0]), _i(parts[1])
    y = _i(parts[2]) if len(parts) >= 3 else 0
    return y * 10000 + m * 100 + d


def _cluster_prints_to_zones(prints: list, zone_pct: float = 0.02) -> list:
    """Server-side port of the client clusterDarkPoolPrintsForOverlay: a greedy
    price-sorted merge where a print joins the current zone if it's within
    ``zone_pct`` of the zone's running notional-weighted mean, SUMMING notional +
    volume. So a level hit big across back-to-back days reports its true CUMULATIVE
    notional. Uncapped by design — every print in the window contributes (the
    display drilldown's row cap is what silently understated multi-day levels)."""
    ps = sorted((p for p in prints if (p.get("price") or 0) > 0),
                key=lambda p: p.get("price") or 0)
    zones: list = []
    cur = None
    for p in ps:
        price = p.get("price") or 0
        notional = p.get("notional") or 0
        volume = p.get("volume") or 0
        if cur is not None and abs(price - cur["price"]) <= cur["price"] * zone_pct:
            cur["_members"].append(p)
            cur["notional"] += notional
            cur["volume"] += volume
            wsum = sum((m.get("price") or 0) * ((m.get("volume") or 0) or 1) for m in cur["_members"])
            wden = sum(((m.get("volume") or 0) or 1) for m in cur["_members"])
            cur["price"] = wsum / wden if wden > 0 else price
            cur["priceLow"] = min(cur["priceLow"], price)
            cur["priceHigh"] = max(cur["priceHigh"], price)
        else:
            cur = {"price": price, "notional": notional, "volume": volume,
                   "priceLow": price, "priceHigh": price, "_members": [p]}
            zones.append(cur)
    out = []
    for z in zones:
        members = z.pop("_members")
        # Label a merged zone by its MOST RECENT print (not the lowest-price seed),
        # so a multi-day cluster reads as current, not as its oldest member.
        latest = max(members, key=lambda m: _dp_dnum(m.get("dateRaw")))
        out.append({
            "price": round(z["price"], 4),
            "priceLow": round(z["priceLow"], 4),
            "priceHigh": round(z["priceHigh"], 4),
            "notional": z["notional"],
            "volume": z["volume"],
            "printCount": len(members),
            "_clusterCount": len(members),
            "_isCluster": len(members) > 1,
            "biggestPrint": max((m.get("notional") or 0) for m in members),
            "date": latest.get("date"),
            "dateLong": latest.get("dateLong"),
            "dateRaw": latest.get("dateRaw"),
            "pctAvgVol": latest.get("pctAvgVol") or 0,
            "type": latest.get("type"),
        })
    return out


def get_ticker_zones(ticker: str, days: int = 180, zone_pct: float = 0.02,
                     limit: int = 25) -> list:
    """Full server-side dark-pool ZONE aggregation for the chart overlay.

    Clusters EVERY print in the window (via get_ticker_prints_window — no per-print
    cap) into ``zone_pct`` price bands, so a level accumulated across multiple days
    shows its true cumulative notional (the client fetch was capped at the top-200
    prints, understating multi-day accumulation levels). Returns the top ``limit``
    zones by notional, newest-print zone flagged ``isLatest``.
    """
    prints = get_ticker_prints_window(ticker, days=days)
    if not prints:
        return []
    zones = _cluster_prints_to_zones(prints, zone_pct=zone_pct)
    if zones:
        newest = max(_dp_dnum(z.get("dateRaw")) for z in zones)
        for z in zones:
            z["isLatest"] = bool(newest > 0 and _dp_dnum(z.get("dateRaw")) == newest)
    zones.sort(key=lambda z: z.get("notional") or 0, reverse=True)
    return zones[:limit]


# Auto-init tables on import (idempotent, fast — just CREATE IF NOT EXISTS).
# The CSV seed is intentionally NOT triggered here — main.py runs it in a
# background thread on startup to mirror the flow DB pattern.
init_db()
