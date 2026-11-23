"""api/services/cot_service.py — CFTC Commitment of Traders data pipeline.

Database: SQLite at DB_PATH (Railway persistent volume: /data/cot.db).
          Falls back to data/cot.db relative to project root on local dev.

Public API:
    init_db()                          → create tables if absent
    is_empty() -> bool                 → True if cot_records has no rows
    seed_from_historical() -> int      → download CFTC zip, parse, upsert all history
    refresh_from_current() -> int      → download current-year file, upsert new records
    get_cot_data(symbol, weeks) -> list → last N weekly records, ascending by date
    get_status() -> dict               → last_updated, next_friday, record_count
    _parse_cftc_stream(stream) -> (list, set)  → (records, unmapped_names) — exported for tests

How a CFTC row becomes one of our symbols: its contract market code first (`cot_finer.CONTRACT_CODES`, the one
code table), then its market name (SYMBOL_MAP + _CFTC_ALIASES, runs of spaces collapsed). See _parse_cftc_stream.
"""

import io
import csv
import os
import threading
import zipfile
import logging
import sqlite3
from datetime import datetime, timedelta, timezone, date as _date_cls
from typing import TextIO

import requests

logger = logging.getLogger(__name__)

# ── DB path ────────────────────────────────────────────────────────────────────
_DEFAULT_DB_PATH = (
    "/data/cot.db"
    if os.path.isdir("/data")
    else os.path.join(os.path.dirname(__file__), "..", "..", "data", "cot.db")
)
DB_PATH: str = os.environ.get("COT_DB_PATH", _DEFAULT_DB_PATH)

# ── CFTC public URLs ───────────────────────────────────────────────────────────
# Per-year zips: https://www.cftc.gov/files/dea/history/deacot{YEAR}.zip
_HIST_BASE   = "https://www.cftc.gov/files/dea/history/deacot"
_SEED_YEARS  = 10   # download last N years for seed (covers 5Y lookback + buffer)
_TIMEOUT     = 120   # seconds

# ── Symbol map: our symbol → CFTC market name (uppercase for matching) ─────────
SYMBOL_MAP: dict[str, str] = {
    # INDICES
    "ES":  "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    "NQ":  "NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE",
    "YM":  "DJIA Consolidated - CHICAGO BOARD OF TRADE",
    "QR":  "RUSSELL E-MINI - CHICAGO MERCANTILE EXCHANGE",
    "EW":  "E-MINI S&P 400 STOCK INDEX - CHICAGO MERCANTILE EXCHANGE",
    "VI":  "VIX FUTURES - CBOE FUTURES EXCHANGE",
    "ET":  "MICRO E-MINI S&P 500 INDEX - CHICAGO MERCANTILE EXCHANGE",
    "NM":  "MICRO E-MINI NASDAQ-100 INDEX - CHICAGO MERCANTILE EXCHANGE",
    "NK":  "NIKKEI STOCK AVERAGE - CHICAGO MERCANTILE EXCHANGE",
    # METALS
    "GC":  "GOLD - COMMODITY EXCHANGE INC.",
    "SI":  "SILVER - COMMODITY EXCHANGE INC.",
    "HG":  "COPPER-GRADE #1 - COMMODITY EXCHANGE INC.",        # pre-2021 name
    "PL":  "PLATINUM - NEW YORK MERCANTILE EXCHANGE",
    "PA":  "PALLADIUM - NEW YORK MERCANTILE EXCHANGE",
    "AL":  "ALUMINUM - COMMODITY EXCHANGE INC.",
    # ENERGIES
    "CL":  "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE",  # pre-2022 name
    "HO":  "#2 HEATING OIL- NY HARBOR-ULSD - NEW YORK MERCANTILE EXCHANGE",  # pre-2022 name
    "RB":  "GASOLINE BLENDSTOCK (RBOB) - NEW YORK MERCANTILE EXCHANGE",      # pre-2022 name
    "NG":  "NATURAL GAS - NEW YORK MERCANTILE EXCHANGE",               # pre-2022 name
    "FL":  "ETHANOL - NEW YORK MERCANTILE EXCHANGE",
    "BZ":  "BRENT CRUDE OIL LAST DAY - NEW YORK MERCANTILE EXCHANGE",  # pre-2022 name
    # GRAINS
    "ZW":  "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    "ZC":  "CORN - CHICAGO BOARD OF TRADE",
    "ZS":  "SOYBEANS - CHICAGO BOARD OF TRADE",
    "ZM":  "SOYBEAN MEAL - CHICAGO BOARD OF TRADE",
    "ZL":  "SOYBEAN OIL - CHICAGO BOARD OF TRADE",
    "ZR":  "ROUGH RICE - CHICAGO BOARD OF TRADE",
    "KE":  "WHEAT-HRW - CHICAGO BOARD OF TRADE",
    "MW":  "WHEAT-HRSpring - MINNEAPOLIS GRAIN EXCHANGE",
    "RS":  "CANOLA - ICE FUTURES U.S.",
    "OA":  "OATS - CHICAGO BOARD OF TRADE",
    # SOFTS
    "CT":  "COTTON NO. 2 - ICE FUTURES U.S.",
    "OJ":  "FRZN CONCENTRATED ORANGE JUICE - ICE FUTURES U.S.",
    "KC":  "COFFEE C - ICE FUTURES U.S.",
    "SB":  "SUGAR NO. 11 - ICE FUTURES U.S.",
    "CC":  "COCOA - ICE FUTURES U.S.",
    "LB":  "LUMBER - CHICAGO MERCANTILE EXCHANGE",
    # LIVESTOCK & DAIRY
    "LE":  "LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "GF":  "FEEDER CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "HE":  "LEAN HOGS - CHICAGO MERCANTILE EXCHANGE",
    "DL":  "MILK, Class III - CHICAGO MERCANTILE EXCHANGE",
    "DF":  "NON FAT DRY MILK - CHICAGO MERCANTILE EXCHANGE",
    "BD":  "BUTTER (CASH SETTLED) - CHICAGO MERCANTILE EXCHANGE",
    "BJ":  "CHEESE (CASH-SETTLED) - CHICAGO MERCANTILE EXCHANGE",
    # FINANCIALS
    "ZB":  "U.S. TREASURY BONDS - CHICAGO BOARD OF TRADE",      # pre-2022 name
    "UD":  "ULTRA U.S. TREASURY BONDS - CHICAGO BOARD OF TRADE", # pre-2022 name
    "ZN":  "10-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "ZF":  "5-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "ZT":  "2-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "ZQ":  "FED FUNDS - CHICAGO BOARD OF TRADE",
    "SR3": "SOFR-3M - CHICAGO MERCANTILE EXCHANGE",
    # CURRENCIES
    "DX":  "U.S. DOLLAR INDEX - ICE FUTURES U.S.",              # pre-2022 name
    "BA":  "MICRO BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    "TA":  "MICRO ETHER - CHICAGO MERCANTILE EXCHANGE",
    "B6":  "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE", # pre-2022 name
    "D6":  "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
    "J6":  "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",
    "S6":  "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE",
    "E6":  "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    "A6":  "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
    "M6":  "MEXICAN PESO - CHICAGO MERCANTILE EXCHANGE",
    "N6":  "NEW ZEALAND DOLLAR - CHICAGO MERCANTILE EXCHANGE",   # pre-2022 name
    "T6":  "SO AFRICAN RAND - CHICAGO MERCANTILE EXCHANGE",
    "L6":  "BRAZILIAN REAL - CHICAGO MERCANTILE EXCHANGE",
    "BTC": "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    "ETH": "ETHER CASH SETTLED - CHICAGO MERCANTILE EXCHANGE",
}

# CFTC renames contracts periodically. Map new names → symbol so both old and new
# historical years resolve correctly. These are ADDITIONAL aliases on top of SYMBOL_MAP.
_CFTC_ALIASES: dict[str, str] = {
    # METALS — renamed ~2021
    "COPPER- #1 - COMMODITY EXCHANGE INC.":                      "HG",
    # ENERGIES — renamed ~2022
    "WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE":                "CL",
    "NY HARBOR ULSD - NEW YORK MERCANTILE EXCHANGE":              "HO",
    "GASOLINE RBOB - NEW YORK MERCANTILE EXCHANGE":               "RB",
    "NAT GAS NYME - NEW YORK MERCANTILE EXCHANGE":                "NG",
    "BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE":              "BZ",
    # FINANCIALS — renamed ~2022
    "UST BOND - CHICAGO BOARD OF TRADE":                          "ZB",
    "ULTRA UST BOND - CHICAGO BOARD OF TRADE":                    "UD",
    "UST 10Y NOTE - CHICAGO BOARD OF TRADE":                      "ZN",
    "UST 5Y NOTE - CHICAGO BOARD OF TRADE":                       "ZF",
    "UST 2Y NOTE - CHICAGO BOARD OF TRADE":                       "ZT",
    # CURRENCIES — renamed ~2022
    "USD INDEX - ICE FUTURES U.S.":                               "DX",
    "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE":                "B6",
    "NZ DOLLAR - CHICAGO MERCANTILE EXCHANGE":                    "N6",
    # GRAINS: the Minneapolis Grain Exchange now reads as MIAX Futures (every week of the 2026 file, code 001626)
    "WHEAT-HRSpring - MIAX FUTURES EXCHANGE":                     "MW",
}

SYMBOL_NAMES: dict[str, str] = {
    "ES": "S&P 500 E-Mini",        "NQ": "Nasdaq-100 E-Mini",
    "YM": "DJIA E-Mini",           "QR": "Russell 2000 Mini",
    "EW": "S&P MidCap 400",        "VI": "VIX",
    "ET": "S&P 500 Micro E-Mini",  "NM": "Nasdaq-100 Micro",
    "NK": "Nikkei 225",
    "GC": "Gold",                  "SI": "Silver",
    "HG": "Copper",                "PL": "Platinum",
    "PA": "Palladium",             "AL": "Aluminum",
    "CL": "Crude Oil (WTI)",       "HO": "Heating Oil",
    "RB": "RBOB Gasoline",         "NG": "Natural Gas",
    "FL": "Fuel Ethanol",          "BZ": "Brent Crude",
    "ZW": "Wheat (SRW)",           "ZC": "Corn",
    "ZS": "Soybeans",              "ZM": "Soybean Meal",
    "ZL": "Soybean Oil",           "ZR": "Rough Rice",
    "KE": "Wheat (HRW)",           "MW": "Wheat (Spring)",
    "RS": "Canola",                "OA": "Oats",
    "CT": "Cotton No. 2",          "OJ": "Orange Juice",
    "KC": "Coffee C",              "SB": "Sugar No. 11",
    "CC": "Cocoa",                 "LB": "Lumber",
    "LE": "Live Cattle",           "GF": "Feeder Cattle",
    "HE": "Lean Hogs",             "DL": "Class III Milk",
    "DF": "Nonfat Dry Milk",       "BD": "Butter",
    "BJ": "Cheese",
    "ZB": "30-Year T-Bond",        "UD": "Ultra T-Bond",
    "ZN": "10-Year T-Note",        "ZF": "5-Year T-Note",
    "ZT": "2-Year T-Note",         "ZQ": "Fed Funds 30-Day",
    "SR3":"SOFR 3-Month",
    "DX": "US Dollar Index",       "BA": "Micro Bitcoin",
    "TA": "Micro Ether",           "B6": "British Pound",
    "D6": "Canadian Dollar",       "J6": "Japanese Yen",
    "S6": "Swiss Franc",           "E6": "Euro FX",
    "A6": "Australian Dollar",     "M6": "Mexican Peso",
    "N6": "New Zealand Dollar",    "T6": "South African Rand",
    "L6": "Brazilian Real",        "BTC": "Bitcoin",
    "ETH": "Ether",
}

SYMBOL_GROUPS: dict[str, list[str]] = {
    # The "Most watched" roster the COT tab pins at the top of its picker
    # (app/src/pages/CotData.jsx SYMBOL_GROUPS) and the set the Friday weekly
    # post covers (api/services/cot_weekly_post.py). Keep the two in step.
    "MOST WATCHED":     ["ES", "NQ", "YM", "QR", "EW", "VI", "NK", "DX", "J6", "ZN", "BTC", "ETH"],
    "INDICES":          ["ES", "NQ", "YM", "QR", "EW", "VI", "NK"],
    "METALS":           ["GC", "SI", "HG", "PL", "PA", "AL"],
    "ENERGIES":         ["CL", "HO", "RB", "NG", "FL", "BZ"],
    "GRAINS":           ["ZW", "ZC", "ZS", "ZM", "ZL", "ZR", "KE", "MW", "OA"],
    "SOFTS":            ["CT", "OJ", "KC", "SB", "CC", "LB"],
    "LIVESTOCK & DAIRY":["LE", "GF", "HE", "DF", "BJ"],
    "FINANCIALS":       ["ZB", "UD", "ZN", "ZF", "ZT", "ZQ", "SR3"],
    "CURRENCIES":       ["DX", "B6", "D6", "J6", "S6", "E6",
                         "A6", "M6", "N6", "L6", "BTC", "ETH"],
}

# Reverse lookup: CFTC market name (uppercase) → our symbol
# Built from both SYMBOL_MAP (historical names) and _CFTC_ALIASES (renamed contracts). The name fallback of
# cot_finer.symbol_for reads it (runs of spaces collapsed); both readers match a row through that one function.
_NAME_TO_SYMBOL: dict[str, str] = {v.upper(): k for k, v in SYMBOL_MAP.items()}
_NAME_TO_SYMBOL.update({k.upper(): v for k, v in _CFTC_ALIASES.items()})

# ── CFTC column names (actual names from deacot{year}.zip annual.txt) ─────────
_COL_MARKET   = "Market and Exchange Names"
_COL_CODE     = "CFTC Contract Market Code"   # read when present (not required): a file without it matches by name
_COL_DATE     = "As of Date in Form YYYY-MM-DD"
_COL_OI       = "Open Interest (All)"
_COL_NC_LONG  = "Noncommercial Positions-Long (All)"
_COL_NC_SHORT = "Noncommercial Positions-Short (All)"
_COL_C_LONG   = "Commercial Positions-Long (All)"
_COL_C_SHORT  = "Commercial Positions-Short (All)"
_COL_NR_LONG  = "Nonreportable Positions-Long (All)"
_COL_NR_SHORT = "Nonreportable Positions-Short (All)"
_REQUIRED_COLS = {
    _COL_MARKET, _COL_DATE, _COL_OI,
    _COL_NC_LONG, _COL_NC_SHORT,
    _COL_C_LONG,  _COL_C_SHORT,
    _COL_NR_LONG, _COL_NR_SHORT,
}


# ── Database ───────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    # WAL so a COT refresh write doesn't block dashboard reads (and vice-versa).
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db() -> None:
    """Create all tables if they don't exist. Safe to call on every startup."""
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS cot_records (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol          TEXT    NOT NULL,
                date            DATE    NOT NULL,
                large_spec_net  INTEGER NOT NULL,
                commercial_net  INTEGER NOT NULL,
                small_spec_net  INTEGER NOT NULL,
                open_interest   INTEGER NOT NULL,
                UNIQUE(symbol, date)
            );
            CREATE INDEX IF NOT EXISTS idx_cot_symbol_date
                ON cot_records(symbol, date);

            CREATE TABLE IF NOT EXISTS cot_refresh_log (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                run_at           TEXT    NOT NULL,
                records_inserted INTEGER NOT NULL DEFAULT 0,
                status           TEXT    NOT NULL DEFAULT 'ok'
            );

            CREATE TABLE IF NOT EXISTS cot_symbols_unmapped (
                market_name TEXT PRIMARY KEY,
                first_seen  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cot_narratives (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol      TEXT NOT NULL,
                report_date TEXT NOT NULL,
                facts_hash  TEXT NOT NULL UNIQUE,
                text        TEXT NOT NULL,
                model       TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );
        """)


def is_empty() -> bool:
    """Return True if cot_records table has no rows."""
    with _get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) FROM cot_records").fetchone()
        return row[0] == 0


# ── Parsing ────────────────────────────────────────────────────────────────────

def _parse_cftc_stream(stream: TextIO) -> tuple[list[dict], set[str]]:
    """Parse a CFTC COT CSV file stream.

    How a row becomes a symbol (2026-11-22): `cot_finer.symbol_for`, the trader-type reader's own rule, so the two
    readers cannot disagree. Its CFTC contract market code first, through `cot_finer.CONTRACT_CODES` (the one code
    table; a test holds it to SYMBOL_MAP); a row whose code is not in it falls back to its market name through
    SYMBOL_MAP + _CFTC_ALIASES with runs of spaces collapsed. A code match beats a name match for the same symbol and
    week; any other repeat is kept in file order, as before (the upsert's last write wins). A file without the code
    column matches by name alone.

    WHY THE CODE. It survives the CFTC's renames, and the names did not: Hard Red Spring wheat (MW, code 001626) reads
    "WHEAT-HRSpring - MIAX FUTURES EXCHANGE" in every week of the 2026 file, which the name table did not hold, so MW
    stopped updating while every other market kept matching. Checked once against the CFTC's 2026 `deacot2026.zip`
    on 2026-11-22: it carries the code column, all 66 markets match by code, and a code match and a name match never
    named two different markets; MW was the only market the names missed.

    Returns:
        records  — list of dicts ready for upsert
        unmapped — set of CFTC market name strings matched by neither code nor name
    """
    # Imported here, not at the top: cot_finer imports this module at its own top.
    from api.services.cot_finer import MATCH_CODE, symbol_for

    reader = csv.DictReader(stream)
    if reader.fieldnames:
        reader.fieldnames = [f.strip() for f in reader.fieldnames]

    missing = _REQUIRED_COLS - set(reader.fieldnames or [])
    if missing:
        raise ValueError(f"CFTC CSV missing required columns: {missing}")

    def _int(row: dict, col: str) -> int:
        try:
            return int(str(row.get(col, "0")).replace(",", "").strip() or "0")
        except (ValueError, TypeError):
            return 0

    matched: list[tuple[dict, str]] = []
    code_weeks: set[tuple[str, str]] = set()
    unmapped: set[str]  = set()

    for row in reader:
        market_raw = row.get(_COL_MARKET, "").strip()
        sym, how = symbol_for(row.get(_COL_CODE), market_raw)

        if sym is None:
            unmapped.add(market_raw)
            continue

        raw_date = row.get(_COL_DATE, "").strip()
        try:
            date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except ValueError:
            logger.warning("COT: bad date %r for symbol %s — row skipped", raw_date, sym)
            continue

        record = {
            "symbol":         sym,
            "date":           date.isoformat(),
            "large_spec_net": _int(row, _COL_NC_LONG) - _int(row, _COL_NC_SHORT),
            "commercial_net": _int(row, _COL_C_LONG)  - _int(row, _COL_C_SHORT),
            "small_spec_net": _int(row, _COL_NR_LONG) - _int(row, _COL_NR_SHORT),
            "open_interest":  _int(row, _COL_OI),
        }
        matched.append((record, how))
        if how == MATCH_CODE:
            code_weeks.add((sym, record["date"]))

    # A name match never stands beside a code match for the same symbol and week, wherever either sits in the file.
    records = [r for r, how in matched if how == MATCH_CODE or (r["symbol"], r["date"]) not in code_weeks]
    return records, unmapped


# ── Persistence helpers ────────────────────────────────────────────────────────

def _upsert_records(records: list[dict]) -> int:
    """Insert or replace records into cot_records. Returns count upserted."""
    if not records:
        return 0
    with _get_conn() as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO cot_records
                (symbol, date, large_spec_net, commercial_net, small_spec_net, open_interest)
            VALUES
                (:symbol, :date, :large_spec_net, :commercial_net, :small_spec_net, :open_interest)
            """,
            records,
        )
    return len(records)


def _log_unmapped(names: set[str]) -> None:
    if not names:
        return
    now = datetime.now(timezone.utc).isoformat()
    with _get_conn() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO cot_symbols_unmapped (market_name, first_seen) VALUES (?, ?)",
            [(n, now) for n in names],
        )


def _log_refresh(n: int, status: str = "ok") -> None:
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO cot_refresh_log (run_at, records_inserted, status) VALUES (?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), n, status),
        )


# ── Public pipeline functions ──────────────────────────────────────────────────

def _download_year_zip(year: int) -> tuple[list[dict], set[str]]:
    """Download and parse one year's COT zip from CFTC. Returns (records, unmapped)."""
    url = f"{_HIST_BASE}{year}.zip"
    logger.info("COT: downloading %d data (%s)...", year, url)
    resp = requests.get(url, timeout=_TIMEOUT)
    resp.raise_for_status()
    records: list[dict] = []
    unmapped: set[str]  = set()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        for name in zf.namelist():
            if not name.lower().endswith((".txt", ".csv")):
                continue
            with zf.open(name) as f:
                text = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
                recs, unmap = _parse_cftc_stream(text)
                records.extend(recs)
                unmapped |= unmap
    return records, unmapped


def seed_from_historical() -> int:
    """Download last _SEED_YEARS years of CFTC per-year zips, parse, upsert into DB.

    Runs in a background thread so it never blocks FastAPI startup.
    Returns total records inserted.
    """
    current_year = datetime.now(timezone.utc).year
    all_records: list[dict] = []
    all_unmapped: set[str]  = set()

    for year in range(current_year - _SEED_YEARS + 1, current_year + 1):
        try:
            recs, unmapped = _download_year_zip(year)
            all_records.extend(recs)
            all_unmapped |= unmapped
            logger.info("COT: %d — %d records parsed", year, len(recs))
        except Exception as exc:
            logger.warning("COT: skipping %d — %s", year, exc)

    n = _upsert_records(all_records)
    _log_unmapped(all_unmapped)
    _log_refresh(n, "seed")
    logger.info(
        "COT: initial seed complete — %d records inserted (%d unmapped markets ignored)",
        n, len(all_unmapped),
    )
    return n


def _latest_record_date() -> str | None:
    """Return the most recent report date in the DB, or None if empty."""
    try:
        with _get_conn() as conn:
            row = conn.execute("SELECT MAX(date) AS d FROM cot_records").fetchone()
            return row["d"] if row else None
    except Exception:
        return None


def refresh_from_current() -> int:
    """Download current-year CFTC zip and upsert into DB.

    Called by APScheduler every Friday at 3:50 PM ET (primary),
    with retries at 4:15 PM and 4:45 PM if no new data arrived.
    Safe to call manually via POST /api/cot/refresh.
    Returns records inserted/updated.
    """
    current_year = datetime.now(timezone.utc).year
    url = f"{_HIST_BASE}{current_year}.zip"
    logger.info("COT: refreshing from current-year zip (%s)...", url)
    try:
        recs, unmapped = _download_year_zip(current_year)
        n = _upsert_records(recs)
        _log_unmapped(unmapped)
        _log_refresh(n, "ok")
        logger.info("COT: refresh complete — %d records upserted", n)
        return n
    except Exception as exc:
        logger.error("COT: refresh failed: %s", exc)
        _log_refresh(0, f"error: {exc}")
        raise


def refresh_if_stale() -> int:
    """Retry refresh only if the store lacks the report CFTC has released by today.

    Called by APScheduler at 4:15 PM and 4:45 PM ET as retry windows (after CFTC's 3:30 PM
    publish, so TODAY's release counts — `include_day=True`, no 4:30 threshold here).
    Skips the download if fresh data already arrived from the 3:50 PM primary run, and — the
    holiday fix — on a holiday week whose release moved to Monday, where the old "latest is
    at most 6 days old" rule re-downloaded on every retry. Same shared rule as
    expected_latest_report_date; on a normal week it decides exactly as the old rule did.
    """
    from zoneinfo import ZoneInfo
    now_et = datetime.now(ZoneInfo("America/New_York"))
    latest = _latest_record_date()
    if latest:
        try:
            due = _report_due_by(now_et.date(), include_day=True)
        except Exception as exc:  # noqa: BLE001 — fail toward re-downloading (today's behaviour)
            logger.warning("COT: holiday-aware due date failed (%s) — re-downloading", exc)
            due = None
        if due is not None and _date_cls.fromisoformat(latest) >= due:
            logger.info("COT: retry skipped — latest record %s covers the report due by today (%s)", latest, due)
            return 0
    logger.info("COT: retry — latest record %s is stale, re-downloading...", latest)
    return refresh_from_current()


# ── Query functions ────────────────────────────────────────────────────────────

def get_cot_data(symbol: str, weeks: int = 52) -> list[dict]:
    """Return the last `weeks` weekly records for `symbol`, sorted ascending."""
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT date, large_spec_net, commercial_net, small_spec_net, open_interest
            FROM   cot_records
            WHERE  symbol = ?
            ORDER  BY date DESC
            LIMIT  ?
            """,
            (symbol.upper(), weeks),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def get_latest_date() -> str | None:
    """Return the most recent report date in the DB, or None if empty."""
    return _latest_record_date()


# ── Calendar-aware staleness + request-driven auto-refresh ────────────────────
# Self-healing layer that fires regardless of APScheduler state. If the
# scheduler silently fails to run (Railway redeploy lost the lock, restart
# missed the window, etc), any hit to /api/cot/status will kick off a
# background refresh — gated by a cooldown to prevent runaway calls.

# Buffer past CFTC's typical 3:30 PM ET publish time. Anything past 4:30 PM ET
# Friday should have this week's report available.
_PUBLISH_HOUR_ET = 16
_PUBLISH_MIN_ET  = 30

_AUTO_REFRESH_LOCK     = threading.Lock()
_AUTO_REFRESH_COOLDOWN = timedelta(minutes=30)
_LAST_AUTO_REFRESH_AT: datetime | None = None


def _friday_rule_report_date(now_et: datetime) -> _date_cls:
    """The pre-holiday-calendar rule: every release on Friday, positions as of the Tuesday
    before. Kept as the FALLBACK — when the holiday-aware rule cannot decide, staleness is
    judged as before (flag it), never silently relaxed."""
    today = now_et.date()
    weekday = now_et.weekday()  # Mon=0 ... Sun=6
    if weekday == 4:  # Friday
        if (now_et.hour, now_et.minute) >= (_PUBLISH_HOUR_ET, _PUBLISH_MIN_ET):
            most_recent_publish_friday = today
        else:
            most_recent_publish_friday = today - timedelta(days=7)
    else:
        days_back = (weekday - 4) % 7
        most_recent_publish_friday = today - timedelta(days=days_back)
    return most_recent_publish_friday - timedelta(days=3)  # Tuesday before Friday


def _report_due_by(day: _date_cls, include_day: bool) -> _date_cls:
    """The as-of date of the newest report whose CFTC release DATE is on or before `day`
    (strictly before it when `include_day` is False).

    THE RULE (CFTC's published 2026 release schedule, every holiday exception, and its 2025
    entries; the same rule `market_indicators.cot_release.rule_release_date` implements and
    this reuses, so the COT tab and the Market Indicators knowledge time cannot disagree):
      * positions as of Tuesday, released that week's Friday;
      * a federal holiday or federal closure on the WEDNESDAY, THURSDAY or FRIDAY of that week
        moves the release to the next federal publication day (2026: Jan 5, Jun 22, Jul 6,
        Nov 16, Nov 30, Dec 28 — all Mondays). A Monday or Tuesday holiday does not move it
        (2026: MLK, Presidents, Memorial, Labor, Columbus weeks all release Friday);
      * a TUESDAY federal holiday moves the AS-OF date to the previous business day (as-of Monday
        2025-11-10, Veterans Day Tuesday 2025-11-11); a one-off closure does not.
    Holidays come from the econ package's federal calendar, derived by RULE (fixed dates with
    the Sat→Fri / Sun→Mon observed shift, plus the nth-weekday holidays); closures are its
    executive-order list. No release date is hard-coded here."""
    from api.services.econ import timeutil as fedcal
    from api.services.market_indicators import cot_release
    tue = day - timedelta(days=(day.weekday() - 1) % 7)          # the Tuesday on or before `day`
    for _ in range(6):
        rel = cot_release.rule_release_date(tue)
        if rel < day or (include_day and rel == day):
            asof = tue
            # a Tuesday federal HOLIDAY: as-of the business day before. Only a holiday (rule-derived), never a one-off
            # closure: an OPM closure (2026-01-27) does not stop CFTC's as-of date, and shifting it would expect an
            # OLDER report — the direction that could hide a real miss.
            while not fedcal.is_business_day(asof):
                asof -= timedelta(days=1)
            return asof
        tue -= timedelta(days=7)
    raise ValueError(f"no COT release found in the six weeks before {day}")


def expected_latest_report_date(now_et: datetime) -> _date_cls:
    """The as-of date of the newest COT report CFTC should have published by `now_et`.

    Holiday-aware (see `_report_due_by`): the release is due at the 4:30 PM ET threshold on its
    release day (CFTC publishes by 3:30 PM; 4:30 is a conservative buffer). If the calendar
    cannot decide (a lookup fails), the old every-Friday rule answers — it can only flag MORE
    stale, never hide a real miss.
    """
    try:
        after = (now_et.hour, now_et.minute) >= (_PUBLISH_HOUR_ET, _PUBLISH_MIN_ET)
        return _report_due_by(now_et.date(), include_day=after)
    except Exception as exc:  # noqa: BLE001 — fail toward flagging stale
        logger.warning("COT: holiday-aware report date failed (%s) — using the every-Friday rule", exc)
        return _friday_rule_report_date(now_et)


def daily_catchup(now_et: datetime | None = None) -> bool:
    """The 18:00 ET daily catch-up (api/main.py `cot_daily_catchup`): download the current-year file when the store
    lacks the report CFTC should have published by now. Returns True when it downloaded.

    Holiday-aware through expected_latest_report_date. It replaced an inline "latest is 8+ days old" rule, which
    re-downloaded every evening of a holiday week (the report not out until Monday) and every Wednesday / Thursday of a
    normal week (last week's report is 8-9 days old by then, and current). It is also the scheduled path that fetches a
    holiday week's DELAYED MONDAY release: the Friday cron jobs never run on a Monday."""
    if now_et is None:
        from zoneinfo import ZoneInfo
        now_et = datetime.now(ZoneInfo("America/New_York"))
    latest = _latest_record_date()
    if not latest:
        return False                        # empty store: seed_from_historical's job, as before
    expected = expected_latest_report_date(now_et)
    if _date_cls.fromisoformat(latest) < expected:
        logger.info("COT: daily catch-up — latest %s < expected %s, refreshing", latest, expected)
        refresh_from_current()
        return True
    logger.info("COT: daily catch-up — latest %s covers expected %s, skipping", latest, expected)
    return False


def _maybe_auto_refresh_if_stale() -> None:
    """If the DB's latest report is older than the expected current report,
    kick off a background refresh — provided we haven't tried in the last 30 min.

    Cooldown lives at module scope so it survives any number of in-flight
    /api/cot/status calls. Safe to invoke from request handlers — never raises.
    """
    global _LAST_AUTO_REFRESH_AT
    try:
        from zoneinfo import ZoneInfo
        latest_iso = _latest_record_date()
        if not latest_iso:
            return  # empty DB — seed_from_historical path handles this
        latest_date = _date_cls.fromisoformat(latest_iso)
        now_et = datetime.now(ZoneInfo("America/New_York"))
        if latest_date >= expected_latest_report_date(now_et):
            return  # already current
        with _AUTO_REFRESH_LOCK:
            now_utc = datetime.now(timezone.utc)
            if (
                _LAST_AUTO_REFRESH_AT is not None
                and now_utc - _LAST_AUTO_REFRESH_AT < _AUTO_REFRESH_COOLDOWN
            ):
                return
            _LAST_AUTO_REFRESH_AT = now_utc
        logger.info(
            "COT: auto-refresh triggered (latest=%s, expected=%s)",
            latest_iso, expected_latest_report_date(now_et).isoformat(),
        )
        threading.Thread(
            target=refresh_from_current,
            daemon=True,
            name="cot-auto-refresh",
        ).start()
    except Exception as exc:
        logger.warning("COT: auto-refresh check failed: %s", exc)


def get_status() -> dict:
    """Return last refresh info, next scheduled Friday, and total record count.

    Side-effect: if data is stale per the expected CFTC publish schedule, fires
    a background refresh (cooldown-gated). This is the safety net for cases
    where the APScheduler Friday jobs silently fail to run.
    """
    _maybe_auto_refresh_if_stale()
    with _get_conn() as conn:
        last = conn.execute(
            "SELECT run_at, records_inserted, status FROM cot_refresh_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        count = conn.execute("SELECT COUNT(*) FROM cot_records").fetchone()[0]

    # Next Friday at 3:50 PM ET (retries at 4:15, 4:45 if stale)
    now = datetime.now(timezone.utc)
    days_until_fri = (4 - now.weekday()) % 7
    if days_until_fri == 0 and now.hour >= 21:   # past 4:45 PM ET (≈20:45 UTC)
        days_until_fri = 7
    next_fri = (now + timedelta(days=days_until_fri)).strftime("%Y-%m-%d") + " 15:50 ET (retries 16:15, 16:45)"

    return {
        "last_updated":           last["run_at"] if last else None,
        "last_records_inserted":  last["records_inserted"] if last else 0,
        "last_status":            last["status"] if last else None,
        "next_scheduled_refresh": next_fri,
        "record_count":           count,
    }
