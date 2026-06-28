"""
Ticker classification cache — sourced from Massive's reference data API.

Replaces BBS's per-row StockEtf field (which is a row-level guess) with the
authoritative exchange-listing type from Massive.

Schema:
  CREATE TABLE ticker_types (
      ticker TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,          -- normalized: 'STOCK'|'ETF'|'INDEX'|'OTHER'
      raw_type TEXT,                      -- Massive's raw code: 'CS','ETF','ETN','ADRC',...
      name TEXT,                          -- e.g. 'Apple Inc.'
      primary_exchange TEXT,              -- MIC code, e.g. 'XNAS'
      market TEXT,                        -- 'stocks'|'indices'|...
      active INTEGER DEFAULT 1,           -- 1 if currently active
      last_synced TEXT                    -- ISO timestamp
  )

Type normalization (Massive raw -> our asset_type):
  STOCK : CS, ADRC, ADRP, ADRR, ADRW, PFD, UNIT, RIGHT, WARRANT, GDR, NYRS, SP, OS
  ETF   : ETF, ETN, ETV, FUND
  INDEX : INDEX  (only from market='indices' query)
  OTHER : anything else

Massive endpoints used:
  GET /v3/reference/tickers?market=stocks&active=true&limit=1000
  GET /v3/reference/tickers?market=indices&active=true&limit=1000

Pagination: follow `next_url` until null. Each page <= 1000 results.
Auth: Massive API key passed as ?apiKey=... query param.

Environment:
  MASSIVE_API_KEY : required for sync
  FLOW_DB_PATH    : defaults to /data/flow.db
"""
import sqlite3
import os
import logging
import datetime
import time
import urllib.parse
import urllib.request
import json

logger = logging.getLogger(__name__)
DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")

MASSIVE_BASE = "https://api.massive.com"

# Raw type -> normalized asset_type
STOCK_TYPES = {"CS", "ADRC", "ADRP", "ADRR", "ADRW", "PFD", "UNIT",
               "RIGHT", "WARRANT", "GDR", "NYRS", "SP", "OS"}
ETF_TYPES = {"ETF", "ETN", "ETV", "FUND"}
INDEX_TYPES = {"INDEX"}


def normalize_type(raw_type: str, market: str = "stocks") -> str:
    """Map Massive's raw type code to our STOCK/ETF/INDEX/OTHER classification.

    Indices market: Massive returns indices with an empty `type` field — the
    market='indices' query is itself the classifier. So if market=='indices'
    we return 'INDEX' regardless of raw_type.
    """
    # market='indices' is dispositive — any ticker returned by that query is an INDEX
    if market == "indices":
        return "INDEX"
    if not raw_type:
        return "OTHER"
    t = raw_type.upper().strip()
    if t in STOCK_TYPES:
        return "STOCK"
    if t in ETF_TYPES:
        return "ETF"
    if t in INDEX_TYPES:
        return "INDEX"
    return "OTHER"


def ensure_schema(conn) -> None:
    """Create the ticker_types table if it doesn't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ticker_types (
            ticker TEXT PRIMARY KEY,
            asset_type TEXT NOT NULL,
            raw_type TEXT,
            name TEXT,
            primary_exchange TEXT,
            market TEXT,
            active INTEGER DEFAULT 1,
            last_synced TEXT
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ticker_types_asset_type
        ON ticker_types(asset_type)
    """)
    conn.commit()


def _http_get(url: str, timeout: int = 30) -> dict:
    """Simple GET with JSON parsing. Raises on non-200."""
    req = urllib.request.Request(url, headers={"User-Agent": "UCT/ticker-sync"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} from {url}")
        return json.loads(resp.read().decode("utf-8"))


def _fetch_page(api_key: str, params: dict, cursor_url: str = None) -> dict:
    """Fetch one page of /v3/reference/tickers, returning {results, next_url}."""
    if cursor_url:
        # Massive's next_url comes back without the API key; we append it.
        sep = "&" if "?" in cursor_url else "?"
        url = f"{cursor_url}{sep}apiKey={api_key}"
    else:
        q = dict(params)
        q["apiKey"] = api_key
        url = f"{MASSIVE_BASE}/v3/reference/tickers?{urllib.parse.urlencode(q)}"
    data = _http_get(url)
    return {
        "results": data.get("results", []),
        "next_url": data.get("next_url"),
        "count": data.get("count", 0),
    }


def sync_from_massive(market: str = "stocks", limit_per_page: int = 1000,
                      max_pages: int = 50) -> dict:
    """Sync ticker reference data from Massive into the local cache.

    market: 'stocks' (CS/ETF/ADRC/etc.) or 'indices' (INDEX). Run both for
            complete coverage.
    limit_per_page: 1000 is the Massive max.
    max_pages: safety cap. 50 * 1000 = 50K tickers, plenty for US market.
    """
    api_key = os.environ.get("MASSIVE_API_KEY")
    if not api_key:
        raise RuntimeError("MASSIVE_API_KEY env var not set")

    stats = {
        "market": market,
        "pages_fetched": 0,
        "tickers_seen": 0,
        "tickers_upserted": 0,
        "stock_count": 0,
        "etf_count": 0,
        "index_count": 0,
        "other_count": 0,
        "errors": [],
    }

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        ensure_schema(conn)

        # One-time cleanup: remove stale 'I:'-prefixed rows that were stored
        # before we started stripping the prefix. Safe to run every sync since
        # post-fix the cache never contains I:-prefixed rows again.
        if market == "indices":
            cur = conn.execute("DELETE FROM ticker_types WHERE ticker LIKE 'I:%'")
            stale_removed = cur.rowcount if cur.rowcount >= 0 else 0
            if stale_removed > 0:
                logger.info(f"[ticker_types] removed {stale_removed} stale I:-prefixed cache rows")
                stats["stale_rows_removed"] = stale_removed
            conn.commit()

        now_iso = datetime.datetime.utcnow().isoformat()
        params = {"market": market, "active": "true", "limit": limit_per_page}
        cursor_url = None

        for page_n in range(max_pages):
            try:
                page = _fetch_page(api_key, params, cursor_url)
            except Exception as e:
                stats["errors"].append(f"page {page_n}: {e}")
                logger.exception(f"[ticker_types] page {page_n} fetch failed")
                break

            stats["pages_fetched"] += 1
            results = page["results"]
            if not results:
                break

            # Upsert each ticker
            rows = []
            for r in results:
                ticker = (r.get("ticker") or "").strip().upper()
                if not ticker:
                    continue
                # Massive returns indices with an 'I:' prefix (e.g. 'I:SPX')
                # but FlowDB stores them as bare symbols ('SPX'). Strip the
                # prefix so cache keys match how Symbol is stored in flow rows.
                if ticker.startswith("I:"):
                    ticker = ticker[2:]
                if not ticker:
                    continue
                raw = (r.get("type") or "").strip().upper()
                asset_type = normalize_type(raw, market)
                rows.append((
                    ticker,
                    asset_type,
                    raw,
                    r.get("name") or "",
                    r.get("primary_exchange") or "",
                    market,
                    1 if r.get("active", True) else 0,
                    now_iso,
                ))
                stats["tickers_seen"] += 1
                if asset_type == "STOCK": stats["stock_count"] += 1
                elif asset_type == "ETF": stats["etf_count"] += 1
                elif asset_type == "INDEX": stats["index_count"] += 1
                else: stats["other_count"] += 1

            conn.executemany("""
                INSERT INTO ticker_types
                  (ticker, asset_type, raw_type, name, primary_exchange,
                   market, active, last_synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(ticker) DO UPDATE SET
                  asset_type = excluded.asset_type,
                  raw_type = excluded.raw_type,
                  name = excluded.name,
                  primary_exchange = excluded.primary_exchange,
                  market = excluded.market,
                  active = excluded.active,
                  last_synced = excluded.last_synced
            """, rows)
            conn.commit()
            stats["tickers_upserted"] += len(rows)

            if not page["next_url"]:
                break
            cursor_url = page["next_url"]
            # Be polite to the API
            time.sleep(0.1)

        logger.info(f"[ticker_types] sync done: {stats}")
        return stats

    finally:
        conn.close()


def get_asset_type(ticker: str) -> str:
    """Look up a single ticker's asset type. Returns 'STOCK'/'ETF'/'INDEX'/'OTHER'
    or 'UNKNOWN' if not in cache."""
    if not ticker:
        return "UNKNOWN"
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        cur = conn.execute(
            "SELECT asset_type FROM ticker_types WHERE ticker = ?",
            (ticker.upper().strip(),)
        )
        row = cur.fetchone()
        return row[0] if row else "UNKNOWN"
    finally:
        conn.close()


def backfill_flow_source(target_date: str = None) -> dict:
    """Apply ticker_types classifications to existing rows in the `flow` table.

    Updates the `source` column based on the cached asset_type:
      asset_type == 'ETF'   -> source = 'indexes'
      asset_type == 'INDEX' -> source = 'indexes'
      asset_type == 'STOCK' -> source = 'stocks'

    target_date: 'M/D/YYYY' to limit scope, or None for all-time.

    Idempotent — re-running produces zero updates after the first pass.

    Returns counts of moved rows by direction.
    """
    stats = {
        "target_date": target_date or "ALL",
        "rows_moved_to_indexes": 0,    # STOCK->ETF/INDEX reclassification (DRAM case)
        "rows_moved_to_stocks": 0,     # ETF->STOCK reclassification (AAL case)
        "ticker_types_in_cache": 0,
        "unmatched_tickers": 0,        # tickers in flow not in cache
    }

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        ensure_schema(conn)
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM ticker_types")
        stats["ticker_types_in_cache"] = cur.fetchone()[0]
        if stats["ticker_types_in_cache"] == 0:
            raise RuntimeError("ticker_types cache empty — run sync first")

        # Build the SQL — optionally scoped to a date
        date_clause = "AND f.CreatedDate = ?" if target_date else ""
        date_param = (target_date,) if target_date else ()

        # Move flow rows from 'stocks' source -> 'indexes' for tickers classified as ETF/INDEX
        cur.execute(f"""
            UPDATE flow
            SET source = 'indexes'
            WHERE source = 'stocks'
              AND Symbol IN (
                SELECT ticker FROM ticker_types
                WHERE asset_type IN ('ETF', 'INDEX')
              )
              {"AND CreatedDate = ?" if target_date else ""}
        """, date_param)
        stats["rows_moved_to_indexes"] = cur.rowcount if cur.rowcount >= 0 else 0

        # Move flow rows from 'indexes' source -> 'stocks' for tickers classified as STOCK
        cur.execute(f"""
            UPDATE flow
            SET source = 'stocks'
            WHERE source = 'indexes'
              AND Symbol IN (
                SELECT ticker FROM ticker_types
                WHERE asset_type = 'STOCK'
              )
              {"AND CreatedDate = ?" if target_date else ""}
        """, date_param)
        stats["rows_moved_to_stocks"] = cur.rowcount if cur.rowcount >= 0 else 0

        # Count tickers in flow that aren't in the cache (so we know our coverage)
        cur.execute(f"""
            SELECT COUNT(DISTINCT f.Symbol)
            FROM flow f
            LEFT JOIN ticker_types t ON t.ticker = f.Symbol
            WHERE t.ticker IS NULL
              {date_clause}
        """, date_param)
        stats["unmatched_tickers"] = cur.fetchone()[0]

        conn.commit()
        logger.info(f"[ticker_types] backfill done: {stats}")
        return stats

    finally:
        conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import sys, json as _json
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "sync":
        market = sys.argv[2] if len(sys.argv) > 2 else "stocks"
        print(_json.dumps(sync_from_massive(market=market), indent=2))
    elif cmd == "backfill":
        target = sys.argv[2] if len(sys.argv) > 2 else None
        print(_json.dumps(backfill_flow_source(target), indent=2))
    elif cmd == "lookup":
        ticker = sys.argv[2]
        print(get_asset_type(ticker))
    else:
        print("Usage: python ticker_types.py {sync [market] | backfill [date] | lookup TICKER}")
