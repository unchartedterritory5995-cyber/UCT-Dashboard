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
"""

import io
import csv
import os
import zipfile
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
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
# Built from both SYMBOL_MAP (historical names) and _CFTC_ALIASES (renamed contracts)
_NAME_TO_SYMBOL: dict[str, str] = {v.upper(): k for k, v in SYMBOL_MAP.items()}
_NAME_TO_SYMBOL.update({k.upper(): v for k, v in _CFTC_ALIASES.items()})

# ── CFTC column names (actual names from deacot{year}.zip annual.txt) ─────────
_COL_MARKET   = "Market and Exchange Names"
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
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
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
        """)


def is_empty() -> bool:
    """Return True if cot_records table has no rows."""
    with _get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) FROM cot_records").fetchone()
        return row[0] == 0


# ── Parsing ────────────────────────────────────────────────────────────────────

def _parse_cftc_stream(stream: TextIO) -> tuple[list[dict], set[str]]:
    """Parse a CFTC COT CSV file stream.

    Returns:
        records  — list of dicts ready for upsert
        unmapped — set of CFTC market name strings not in our symbol map
    """
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

    records: list[dict] = []
    unmapped: set[str]  = set()

    for row in reader:
        market_raw = row.get(_COL_MARKET, "").strip()
        sym = _NAME_TO_SYMBOL.get(market_raw.upper())

        if sym is None:
            unmapped.add(market_raw)
            continue

        raw_date = row.get(_COL_DATE, "").strip()
        try:
            date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except ValueError:
            logger.warning("COT: bad date %r for symbol %s — row skipped", raw_date, sym)
            continue

        records.append({
            "symbol":         sym,
            "date":           date.isoformat(),
            "large_spec_net": _int(row, _COL_NC_LONG) - _int(row, _COL_NC_SHORT),
            "commercial_net": _int(row, _COL_C_LONG)  - _int(row, _COL_C_SHORT),
            "small_spec_net": _int(row, _COL_NR_LONG) - _int(row, _COL_NR_SHORT),
            "open_interest":  _int(row, _COL_OI),
        })

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


def refresh_from_current() -> int:
    """Download current-year CFTC zip and upsert into DB.

    Called by APScheduler every Friday at 3:45 PM ET.
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


def get_status() -> dict:
    """Return last refresh info, next scheduled Friday, and total record count."""
    with _get_conn() as conn:
        last = conn.execute(
            "SELECT run_at, records_inserted, status FROM cot_refresh_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        count = conn.execute("SELECT COUNT(*) FROM cot_records").fetchone()[0]

    # Next Friday at 4:30 PM ET (UTC-4 in summer, UTC-5 in winter — approximate)
    now = datetime.now(timezone.utc)
    days_until_fri = (4 - now.weekday()) % 7
    if days_until_fri == 0 and now.hour >= 21:   # past 4:30 PM ET (≈21:30 UTC)
        days_until_fri = 7
    next_fri = (now + timedelta(days=days_until_fri)).strftime("%Y-%m-%d") + " 16:30 ET"

    return {
        "last_updated":           last["run_at"] if last else None,
        "last_records_inserted":  last["records_inserted"] if last else 0,
        "last_status":            last["status"] if last else None,
        "next_scheduled_refresh": next_fri,
        "record_count":           count,
    }
