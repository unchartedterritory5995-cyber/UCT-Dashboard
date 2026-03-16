# COT Data Tile Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a COT Data tile to the Screener tab that links to a full Chart.js visualization of CFTC Commitment of Traders data across 70+ futures markets, backed by a SQLite database seeded from CFTC free public data.

**Architecture:** A new `cot_service.py` handles all DB operations (SQLite at `/data/cot.db` on the Railway persistent volume), CFTC CSV parsing, and weekly refresh via APScheduler running inside the FastAPI lifespan. A new `cot.py` router exposes three endpoints. The React page at `/screener/cot` uses Chart.js with a mixed bar+line chart and a searchable grouped dropdown.

**Tech Stack:** Python + SQLite (`sqlite3` stdlib) + APScheduler 3.x + `requests` (already installed) · React + `chart.js` + `react-chartjs-2` · CFTC Legacy COT free public data

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `api/services/cot_service.py` | DB init, CFTC download/parse, symbol map, query functions |
| Create | `api/routers/cot.py` | FastAPI router: GET /api/cot/{symbol}, /symbols, /status, POST /refresh |
| Modify | `api/main.py` | Include cot router; APScheduler start/stop in lifespan; startup DB init + seed |
| Modify | `requirements.txt` | Add `apscheduler>=3.10.4` and `tzdata>=2024.1` |
| Create | `tests/test_cot_parse.py` | Unit tests for CSV parser (no DB, no network) |
| Create | `tests/api/test_cot_endpoints.py` | Integration tests for all four endpoints |
| Modify | `app/package.json` | Add `chart.js` and `react-chartjs-2` |
| Modify | `app/src/App.jsx` | Add `/screener/cot` route inside Layout |
| Modify | `app/src/pages/Screener.jsx` | Replace first "Coming Soon" with clickable COT DATA tile |
| Modify | `app/src/pages/Screener.module.css` | Add `.cotTileLink`, `.cotTileBody`, `.cotTileDesc`, `.cotCategories`, `.cotCategory` styles |
| Create | `app/src/pages/CotData.jsx` | Full COT chart page: dropdown, lookback buttons, Chart.js mixed chart |
| Create | `app/src/pages/CotData.module.css` | Styles matching UCT dark theme |

---

## Chunk 1: Backend — COT Service + Database

### Task 1: Write failing parser tests

**Files:**
- Create: `tests/test_cot_parse.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_cot_parse.py
"""Unit tests for CFTC COT CSV parser — no DB, no network."""
import csv
import io
import pytest


def _make_cftc_csv(rows: list[dict]) -> io.StringIO:
    """Build a minimal CFTC-format CSV string from a list of row dicts."""
    fieldnames = [
        "Market_and_Exchange_Names",
        "Report_Date_as_MM_DD_YYYY",
        "Open_Interest_All",
        "NonComm_Positions_Long_All",
        "NonComm_Positions_Short_All",
        "Comm_Positions_Long_All",
        "Comm_Positions_Short_All",
        "NonRept_Positions_Long_All",
        "NonRept_Positions_Short_All",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)
    return output


_ES_ROW = {
    "Market_and_Exchange_Names": "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    "Report_Date_as_MM_DD_YYYY": "03/07/2025",
    "Open_Interest_All": "2500000",
    "NonComm_Positions_Long_All": "300000",
    "NonComm_Positions_Short_All": "150000",
    "Comm_Positions_Long_All":    "800000",
    "Comm_Positions_Short_All":   "1000000",
    "NonRept_Positions_Long_All": "200000",
    "NonRept_Positions_Short_All":"150000",
}


def test_parse_known_symbol():
    from api.services.cot_service import _parse_cftc_stream
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([_ES_ROW]))
    assert len(records) == 1
    r = records[0]
    assert r["symbol"]         == "ES"
    assert r["date"]           == "2025-03-07"
    assert r["large_spec_net"] == 150000    # 300000 - 150000
    assert r["commercial_net"] == -200000   # 800000 - 1000000
    assert r["small_spec_net"] == 50000     # 200000 - 150000
    assert r["open_interest"]  == 2500000
    assert unmapped == set()


def test_parse_unknown_symbol_goes_to_unmapped():
    from api.services.cot_service import _parse_cftc_stream
    unknown = {**_ES_ROW, "Market_and_Exchange_Names": "WIDGET FUTURES - UNKNOWN EXCHANGE"}
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([unknown]))
    assert records == []
    assert "WIDGET FUTURES - UNKNOWN EXCHANGE" in unmapped


def test_parse_bad_date_row_skipped():
    from api.services.cot_service import _parse_cftc_stream
    bad = {**_ES_ROW, "Report_Date_as_MM_DD_YYYY": "not-a-date"}
    records, _ = _parse_cftc_stream(_make_cftc_csv([bad]))
    assert records == []


def test_parse_empty_csv():
    from api.services.cot_service import _parse_cftc_stream
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([]))
    assert records == []
    assert unmapped == set()


def test_parse_mixed_known_and_unknown():
    from api.services.cot_service import _parse_cftc_stream
    unknown = {**_ES_ROW, "Market_and_Exchange_Names": "MYSTERY MARKET - NOWHERE"}
    records, unmapped = _parse_cftc_stream(_make_cftc_csv([_ES_ROW, unknown]))
    assert len(records) == 1
    assert records[0]["symbol"] == "ES"
    assert "MYSTERY MARKET - NOWHERE" in unmapped


def test_parse_comma_formatted_numbers():
    from api.services.cot_service import _parse_cftc_stream
    row = {**_ES_ROW, "Open_Interest_All": "2,500,000", "NonComm_Positions_Long_All": "300,000"}
    records, _ = _parse_cftc_stream(_make_cftc_csv([row]))
    assert records[0]["open_interest"] == 2500000
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
cd C:\Users\Patrick\uct-dashboard
pytest tests/test_cot_parse.py -v
```
Expected: `ImportError: cannot import name '_parse_cftc_stream' from 'api.services.cot_service'`

---

### Task 2: Implement COT service

**Files:**
- Create: `api/services/cot_service.py`

- [ ] **Step 3: Create `api/services/cot_service.py`**

```python
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
from datetime import datetime, timedelta
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
_HIST_URL    = "https://www.cftc.gov/dea/newcot/deahistfo.zip"
_CURRENT_URL = "https://www.cftc.gov/dea/newcot/deafut.txt"
_TIMEOUT     = 120   # seconds

# ── Symbol map: our symbol → CFTC market name (uppercase for matching) ─────────
SYMBOL_MAP: dict[str, str] = {
    # INDICES
    "ES":  "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    "NQ":  "E-MINI NASDAQ-100 STOCK INDEX - CHICAGO MERCANTILE EXCHANGE",
    "YM":  "DOW JONES INDUSTRIAL AVERAGE - CHICAGO BOARD OF TRADE",
    "QR":  "RUSSELL 2000 MINI INDEX FUTURES - ICE FUTURES U.S.",
    "EW":  "S&P MIDCAP 400 STOCK INDEX - CHICAGO MERCANTILE EXCHANGE",
    "VI":  "S&P 500 VOLATILITY INDEX - CBOE FUTURES EXCHANGE",
    "ET":  "S&P 500 MICRO E-MINI - CHICAGO MERCANTILE EXCHANGE",
    "NM":  "MICRO E-MINI NASDAQ-100 INDEX - CHICAGO MERCANTILE EXCHANGE",
    "NK":  "NIKKEI STOCK AVERAGE - CHICAGO MERCANTILE EXCHANGE",
    # METALS
    "GC":  "GOLD - COMMODITY EXCHANGE INC.",
    "SI":  "SILVER - COMMODITY EXCHANGE INC.",
    "HG":  "COPPER- GRADE #1 - COMMODITY EXCHANGE INC.",
    "PL":  "PLATINUM - NEW YORK MERCANTILE EXCHANGE",
    "PA":  "PALLADIUM - NEW YORK MERCANTILE EXCHANGE",
    "AL":  "ALUMINUM - COMMODITY EXCHANGE INC.",
    # ENERGIES
    "CL":  "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE",
    "HO":  "NO. 2 HEATING OIL, NEW YORK HARBOR - NEW YORK MERCANTILE EXCHANGE",
    "RB":  "GASOLINE BLENDSTOCK (RBOB) - NEW YORK MERCANTILE EXCHANGE",
    "NG":  "NATURAL GAS - NEW YORK MERCANTILE EXCHANGE",
    "FL":  "DENATURED FUEL ETHANOL - CHICAGO BOARD OF TRADE",
    "BZ":  "BRENT CRUDE OIL LAST DAY - NEW YORK MERCANTILE EXCHANGE",
    # GRAINS
    "ZW":  "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    "ZC":  "CORN - CHICAGO BOARD OF TRADE",
    "ZS":  "SOYBEANS - CHICAGO BOARD OF TRADE",
    "ZM":  "SOYBEAN MEAL - CHICAGO BOARD OF TRADE",
    "ZL":  "SOYBEAN OIL - CHICAGO BOARD OF TRADE",
    "ZR":  "ROUGH RICE - CHICAGO BOARD OF TRADE",
    "KE":  "WHEAT-HRW - CHICAGO BOARD OF TRADE",
    "MW":  "WHEAT-SPRING (MGEX) - MINNEAPOLIS GRAIN EXCHANGE",
    "RS":  "CANOLA - ICE FUTURES U.S.",
    "OA":  "OATS - CHICAGO BOARD OF TRADE",
    # SOFTS
    "CT":  "COTTON NO. 2 - ICE FUTURES U.S.",
    "OJ":  "FROZEN CONCENTRATED ORANGE JUICE - ICE FUTURES U.S.",
    "KC":  "COFFEE C - ICE FUTURES U.S.",
    "SB":  "SUGAR NO. 11 - ICE FUTURES U.S.",
    "CC":  "COCOA - ICE FUTURES U.S.",
    "LB":  "RANDOM LENGTH LUMBER - CHICAGO MERCANTILE EXCHANGE",
    # LIVESTOCK & DAIRY
    "LE":  "LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "GF":  "FEEDER CATTLE - CHICAGO MERCANTILE EXCHANGE",
    "HE":  "LEAN HOGS - CHICAGO MERCANTILE EXCHANGE",
    "DL":  "CLASS III MILK - CHICAGO MERCANTILE EXCHANGE",
    "DF":  "NONFAT DRY MILK - CHICAGO MERCANTILE EXCHANGE",
    "BD":  "CASH-SETTLED BUTTER - CHICAGO MERCANTILE EXCHANGE",
    "BJ":  "CASH-SETTLED CHEESE - CHICAGO MERCANTILE EXCHANGE",
    # FINANCIALS
    "ZB":  "30-YEAR U.S. TREASURY BONDS - CHICAGO BOARD OF TRADE",
    "UD":  "ULTRA U.S. TREASURY BONDS - CHICAGO BOARD OF TRADE",
    "ZN":  "10-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "ZF":  "5-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "ZT":  "2-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE",
    "ZQ":  "30-DAY FEDERAL FUNDS - CHICAGO BOARD OF TRADE",
    "SR3": "3-MONTH SOFR - CHICAGO MERCANTILE EXCHANGE",
    # CURRENCIES
    "DX":  "U.S. DOLLAR INDEX - ICE FUTURES U.S.",
    "BA":  "MICRO BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    "TA":  "MICRO ETHER - CHICAGO MERCANTILE EXCHANGE",
    "B6":  "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE",
    "D6":  "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
    "J6":  "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",
    "S6":  "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE",
    "E6":  "EURO FX - CHICAGO MERCANTILE EXCHANGE",
    "A6":  "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE",
    "M6":  "MEXICAN PESO - CHICAGO MERCANTILE EXCHANGE",
    "N6":  "NEW ZEALAND DOLLAR - CHICAGO MERCANTILE EXCHANGE",
    "T6":  "SOUTH AFRICAN RAND - CHICAGO MERCANTILE EXCHANGE",
    "L6":  "BRAZILIAN REAL - CHICAGO MERCANTILE EXCHANGE",
    "BTC": "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    "ETH": "ETHER - CHICAGO MERCANTILE EXCHANGE",
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
    "INDICES":          ["ES", "NQ", "YM", "QR", "EW", "VI", "ET", "NM", "NK"],
    "METALS":           ["GC", "SI", "HG", "PL", "PA", "AL"],
    "ENERGIES":         ["CL", "HO", "RB", "NG", "FL", "BZ"],
    "GRAINS":           ["ZW", "ZC", "ZS", "ZM", "ZL", "ZR", "KE", "MW", "RS", "OA"],
    "SOFTS":            ["CT", "OJ", "KC", "SB", "CC", "LB"],
    "LIVESTOCK & DAIRY":["LE", "GF", "HE", "DL", "DF", "BD", "BJ"],
    "FINANCIALS":       ["ZB", "UD", "ZN", "ZF", "ZT", "ZQ", "SR3"],
    "CURRENCIES":       ["DX", "BA", "TA", "B6", "D6", "J6", "S6", "E6",
                         "A6", "M6", "N6", "T6", "L6", "BTC", "ETH"],
}

# Reverse lookup: CFTC market name (uppercase) → our symbol
_NAME_TO_SYMBOL: dict[str, str] = {v.upper(): k for k, v in SYMBOL_MAP.items()}

# ── CFTC column names ──────────────────────────────────────────────────────────
_COL_MARKET   = "Market_and_Exchange_Names"
_COL_DATE     = "Report_Date_as_MM_DD_YYYY"
_COL_OI       = "Open_Interest_All"
_COL_NC_LONG  = "NonComm_Positions_Long_All"
_COL_NC_SHORT = "NonComm_Positions_Short_All"
_COL_C_LONG   = "Comm_Positions_Long_All"
_COL_C_SHORT  = "Comm_Positions_Short_All"
_COL_NR_LONG  = "NonRept_Positions_Long_All"
_COL_NR_SHORT = "NonRept_Positions_Short_All"
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
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
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
            date = datetime.strptime(raw_date, "%m/%d/%Y").date()
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
    now = datetime.utcnow().isoformat()
    with _get_conn() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO cot_symbols_unmapped (market_name, first_seen) VALUES (?, ?)",
            [(n, now) for n in names],
        )


def _log_refresh(n: int, status: str = "ok") -> None:
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO cot_refresh_log (run_at, records_inserted, status) VALUES (?, ?, ?)",
            (datetime.utcnow().isoformat(), n, status),
        )


# ── Public pipeline functions ──────────────────────────────────────────────────

def seed_from_historical() -> int:
    """Download CFTC historical zip, parse all records, upsert into DB.

    Only called when cot_records is empty. Runs in a background thread
    so it never blocks the FastAPI startup.
    Returns total records inserted.
    """
    logger.info("COT: downloading historical archive (%s)...", _HIST_URL)
    resp = requests.get(_HIST_URL, timeout=_TIMEOUT, stream=True)
    resp.raise_for_status()
    raw = resp.content
    logger.info("COT: historical zip received (%d bytes)", len(raw))

    all_records: list[dict] = []
    all_unmapped: set[str]  = set()

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        for name in zf.namelist():
            if not name.lower().endswith((".txt", ".csv")):
                continue
            with zf.open(name) as f:
                text = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
                recs, unmapped = _parse_cftc_stream(text)
                all_records.extend(recs)
                all_unmapped |= unmapped

    n = _upsert_records(all_records)
    _log_unmapped(all_unmapped)
    _log_refresh(n, "seed")
    logger.info(
        "COT: initial seed complete — %d records inserted (%d unmapped markets ignored)",
        n, len(all_unmapped),
    )
    return n


def refresh_from_current() -> int:
    """Download current-year CFTC file and upsert into DB.

    Called by APScheduler every Friday at 3:45 PM ET.
    Safe to call manually via POST /api/cot/refresh.
    Returns records inserted/updated.
    """
    logger.info("COT: refreshing from current-year file (%s)...", _CURRENT_URL)
    try:
        resp = requests.get(_CURRENT_URL, timeout=_TIMEOUT)
        resp.raise_for_status()
        stream  = io.StringIO(resp.text)
        records, unmapped = _parse_cftc_stream(stream)
        n = _upsert_records(records)
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

    # Next Friday at 3:45 PM ET (UTC-4 in summer, UTC-5 in winter — approximate)
    now = datetime.utcnow()
    days_until_fri = (4 - now.weekday()) % 7
    if days_until_fri == 0 and now.hour >= 20:   # past 3:45 PM ET (≈20:45 UTC)
        days_until_fri = 7
    next_fri = (now + timedelta(days=days_until_fri)).strftime("%Y-%m-%d") + " 15:45 ET"

    return {
        "last_updated":           last["run_at"] if last else None,
        "last_records_inserted":  last["records_inserted"] if last else 0,
        "last_status":            last["status"] if last else None,
        "next_scheduled_refresh": next_fri,
        "record_count":           count,
    }
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
pytest tests/test_cot_parse.py -v
```
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/services/cot_service.py tests/test_cot_parse.py
git commit -m "feat: cot_service — CFTC parser, DB schema, query functions"
```

---

## Chunk 2: Backend — Router + Main.py + Scheduler

### Task 3: Write failing endpoint tests

**Files:**
- Create: `tests/api/test_cot_endpoints.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_cot_endpoints.py
"""Integration tests for /api/cot/* endpoints."""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with COT DB pointing at a temp directory."""
    monkeypatch.setenv("COT_DB_PATH", str(tmp_path / "cot_test.db"))
    # Re-import to pick up new DB_PATH
    import importlib
    import api.services.cot_service as svc
    importlib.reload(svc)
    svc.init_db()

    from api.main import app
    return TestClient(app)


def test_get_symbols_structure(client):
    resp = client.get("/api/cot/symbols")
    assert resp.status_code == 200
    data = resp.json()
    assert "groups" in data
    assert "INDICES" in data["groups"]
    assert "METALS"  in data["groups"]
    indices = data["groups"]["INDICES"]
    assert any(item["symbol"] == "ES" for item in indices)
    assert any(item["symbol"] == "NQ" for item in indices)
    # Each item has symbol + name
    for group_items in data["groups"].values():
        for item in group_items:
            assert "symbol" in item
            assert "name"   in item


def test_get_status_shape(client):
    resp = client.get("/api/cot/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "last_updated"            in data
    assert "next_scheduled_refresh"  in data
    assert "record_count"            in data
    assert data["record_count"] == 0   # empty test DB


def test_unknown_symbol_returns_404(client):
    resp = client.get("/api/cot/FAKESYMBOL")
    assert resp.status_code == 404


def test_weeks_below_range_returns_400(client):
    resp = client.get("/api/cot/ES?weeks=0")
    assert resp.status_code == 400


def test_weeks_above_range_returns_400(client):
    resp = client.get("/api/cot/ES?weeks=999")
    assert resp.status_code == 400


def test_get_cot_empty_db_returns_empty_list(client):
    resp = client.get("/api/cot/ES?weeks=52")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_cot_returns_correct_shape(client, tmp_path, monkeypatch):
    """Insert one record directly and verify the endpoint returns it."""
    monkeypatch.setenv("COT_DB_PATH", str(tmp_path / "cot_test.db"))
    import importlib
    import api.services.cot_service as svc
    importlib.reload(svc)
    svc.init_db()
    svc._upsert_records([{
        "symbol": "ES", "date": "2025-03-07",
        "large_spec_net": 150000, "commercial_net": -200000,
        "small_spec_net": 50000,  "open_interest": 2500000,
    }])
    from api.main import app
    c = TestClient(app)
    resp = c.get("/api/cot/ES?weeks=52")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    r = data[0]
    assert r["date"]           == "2025-03-07"
    assert r["large_spec_net"] == 150000
    assert r["commercial_net"] == -200000
    assert r["small_spec_net"] == 50000
    assert r["open_interest"]  == 2500000


def test_manual_refresh_accepted(client):
    with patch("api.services.cot_service.refresh_from_current", return_value=42):
        resp = client.post("/api/cot/refresh")
    assert resp.status_code == 200
    assert resp.json()["status"] == "refresh started"
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
pytest tests/api/test_cot_endpoints.py -v
```
Expected: `404 Not Found` for `/api/cot/symbols` — router not registered yet.

---

### Task 4: Implement COT router

**Files:**
- Create: `api/routers/cot.py`

- [ ] **Step 3: Create `api/routers/cot.py`**

```python
"""api/routers/cot.py — COT Data API endpoints.

Routes:
    GET  /api/cot/symbols         → grouped symbol list
    GET  /api/cot/status          → last_updated, next refresh, record count
    POST /api/cot/refresh         → manual refresh (background task)
    GET  /api/cot/{symbol}        → weekly records for a symbol
"""
from fastapi import APIRouter, BackgroundTasks, HTTPException
from api.services import cot_service

router = APIRouter(prefix="/api/cot", tags=["cot"])


@router.get("/symbols")
def get_symbols():
    """Return full grouped symbol list with display names."""
    return {
        "groups": {
            group: [
                {"symbol": s, "name": cot_service.SYMBOL_NAMES.get(s, s)}
                for s in syms
            ]
            for group, syms in cot_service.SYMBOL_GROUPS.items()
        }
    }


@router.get("/status")
def get_status():
    """Return last refresh timestamp, next scheduled Friday, and total record count."""
    return cot_service.get_status()


@router.post("/refresh")
def manual_refresh(background_tasks: BackgroundTasks):
    """Trigger a COT data refresh in the background. Returns immediately."""
    background_tasks.add_task(cot_service.refresh_from_current)
    return {"status": "refresh started"}


@router.get("/{symbol}")
def get_cot(symbol: str, weeks: int = 52):
    """Return the last `weeks` weekly COT records for `symbol`, ascending by date."""
    sym = symbol.upper()
    if sym not in cot_service.SYMBOL_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown COT symbol: {sym}")
    if not 1 <= weeks <= 520:
        raise HTTPException(status_code=400, detail="weeks must be between 1 and 520")
    return cot_service.get_cot_data(sym, weeks)
```

---

### Task 5: Wire router + scheduler + startup seed into main.py

**Files:**
- Modify: `api/main.py` (lines 1–20 imports, lines 35–56 lifespan)
- Modify: `requirements.txt`

- [ ] **Step 4: Add dependencies to requirements.txt**

Add these two lines at the end of `requirements.txt`:
```
apscheduler>=3.10.4
tzdata>=2024.1
```

- [ ] **Step 5: Update `api/main.py`**

**Add imports** — insert after the existing `from api.schwab_router import router as schwab_router` line:
```python
from api.routers import cot as cot_router
from api.services import cot_service as _cot_service
```

**Update the lifespan function** — replace the existing lifespan with:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Wire data cache seed ───────────────────────────────────────
    _seed_cache_from_volume()

    # ── Schwab token ───────────────────────────────────────────────
    from api.schwab_service import start_auto_refresh, stop_auto_refresh, refresh_access_token, load_tokens
    tokens = load_tokens()
    if tokens and "refresh_token" in tokens:
        print("[startup] Found Schwab refresh token on disk, refreshing access token...")
        try:
            result = await refresh_access_token()
            if result:
                print("[startup] Schwab access token refreshed — API ready for all users.")
            else:
                print("[startup] Schwab token refresh FAILED — re-auth needed at /api/schwab/login")
        except Exception as e:
            print(f"[startup] Schwab token refresh error: {e}")
    else:
        print("[startup] No Schwab tokens found. Admin must visit /api/schwab/login once to connect.")
    start_auto_refresh()

    # ── COT database ───────────────────────────────────────────────
    try:
        _cot_service.init_db()
        if _cot_service.is_empty():
            import threading
            print("[startup] COT table empty — seeding from CFTC historical archive (background)...")
            threading.Thread(
                target=_cot_seed_background, daemon=True, name="cot-seed"
            ).start()
        else:
            print("[startup] COT database ready.")
    except Exception as e:
        print(f"[startup] COT init error (non-fatal): {e}")

    # ── COT weekly scheduler ───────────────────────────────────────
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from zoneinfo import ZoneInfo
    _scheduler = BackgroundScheduler(timezone=ZoneInfo("America/New_York"))
    _scheduler.add_job(
        _cot_service.refresh_from_current,
        trigger=CronTrigger(day_of_week="fri", hour=15, minute=45),
        id="cot_weekly_refresh",
        max_instances=1,
        replace_existing=True,
    )
    _scheduler.start()
    print("[startup] COT scheduler running — refreshes every Friday at 3:45 PM ET")

    yield

    # ── Shutdown ───────────────────────────────────────────────────
    _scheduler.shutdown(wait=False)
    stop_auto_refresh()
```

**Add helper function** — add before the lifespan function:
```python
def _cot_seed_background():
    """Run COT historical seed in a background thread (called once on first deploy)."""
    try:
        n = _cot_service.seed_from_historical()
        print(f"[startup] COT initial seed complete — {n} records inserted")
    except Exception as e:
        print(f"[startup] COT seed failed: {e}")
```

**Register the router** — add after `app.include_router(charts.router)`:
```python
app.include_router(cot_router.router)
```

- [ ] **Step 6: Run endpoint tests — verify they PASS**

```bash
pip install apscheduler tzdata
pytest tests/api/test_cot_endpoints.py -v
```
Expected: 8 tests PASS

- [ ] **Step 7: Run full test suite — verify nothing broken**

```bash
pytest -v
```
Expected: all existing tests still PASS, new COT tests PASS

- [ ] **Step 8: Commit**

```bash
git add api/routers/cot.py api/main.py requirements.txt tests/api/test_cot_endpoints.py
git commit -m "feat: cot router + APScheduler weekly refresh + startup DB seed"
```

---

## Chunk 3: Frontend — CotData Page

### Task 6: Install Chart.js and add React route

**Files:**
- Modify: `app/package.json`
- Modify: `app/src/App.jsx`

- [ ] **Step 1: Add Chart.js dependencies**

In `app/package.json`, add to `"dependencies"`:
```json
"chart.js": "^4.4.0",
"react-chartjs-2": "^5.2.0"
```

- [ ] **Step 2: Install**

```bash
cd app && npm install
```

- [ ] **Step 3: Add `/screener/cot` route to `app/src/App.jsx`**

Add the import at the top (after existing imports):
```js
import CotData from './pages/CotData'
```

Add the route inside the `<Route element={<Layout />}>` block (after the `/screener` route):
```jsx
<Route path="/screener/cot" element={<CotData />} />
```

Full updated routes block:
```jsx
<Route element={<Layout />}>
  <Route index element={<Navigate to="/dashboard" replace />} />
  <Route path="/dashboard"    element={<Dashboard />} />
  <Route path="/morning-wire" element={<MorningWire />} />
  <Route path="/uct-20"       element={<UCT20 />} />
  <Route path="/traders"      element={<Traders />} />
  <Route path="/screener"     element={<Screener />} />
  <Route path="/screener/cot" element={<CotData />} />
  <Route path="/options-flow" element={<OptionsFlow />} />
  <Route path="/dark-pool"    element={<DarkPool />} />
  <Route path="/post-market"  element={<PostMarket />} />
  <Route path="/model-book"   element={<ModelBook />} />
  <Route path="/settings"     element={<Settings />} />
</Route>
```

---

### Task 7: Update Screener.jsx — replace first Coming Soon with COT tile

**Files:**
- Modify: `app/src/pages/Screener.jsx`
- Modify: `app/src/pages/Screener.module.css`

- [ ] **Step 1: Update Screener.jsx**

Add import at top:
```js
import { Link } from 'react-router-dom'
```

Replace the first `columnDim` block (lines 88–93):
```jsx
{/* OLD — remove this: */}
<div className={`${styles.column} ${styles.columnDim}`}>
  <div className={styles.columnHeader}>
    <span className={styles.columnTitle}>Coming Soon</span>
  </div>
  <div className={styles.columnBodyEmpty} />
</div>
```

With:
```jsx
<Link to="/screener/cot" className={styles.cotTileLink}>
  <div className={styles.column}>
    <div className={styles.columnHeader}>
      <span className={styles.columnTitle}>COT Data</span>
      <span className={styles.cotArrow}>↗</span>
    </div>
    <div className={styles.cotTileBody}>
      <p className={styles.cotTileDesc}>
        CFTC Commitment of Traders — weekly positioning across 70+ futures markets
      </p>
      <div className={styles.cotCategories}>
        {['Indices', 'Metals', 'Energies', 'Grains', 'Currencies'].map(cat => (
          <span key={cat} className={styles.cotCategory}>{cat}</span>
        ))}
      </div>
    </div>
  </div>
</Link>
```

- [ ] **Step 2: Add CSS to `Screener.module.css`**

Append at the bottom of `app/src/pages/Screener.module.css`:
```css
/* ── COT Data tile ─────────────────────────────────────────────── */
.cotTileLink {
  display: block;
  text-decoration: none;
  color: inherit;
}
.cotTileLink:hover .column {
  border-color: rgba(201, 168, 76, 0.5);
  background: var(--bg-hover);
}

.cotArrow {
  font-size: 13px;
  color: var(--text-muted);
  margin-left: auto;
  transition: color 0.15s;
}
.cotTileLink:hover .cotArrow {
  color: #c9a84c;
}

.cotTileBody {
  padding: 10px 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cotTileDesc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.cotCategories {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.cotCategory {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
```

- [ ] **Step 3: Verify screener page still loads**

```bash
cd app && npm run dev
```
Navigate to `http://localhost:5173/screener` — confirm COT DATA tile appears in position 4, clicking it navigates to `/screener/cot`.

---

### Task 8: Build CotData page

**Files:**
- Create: `app/src/pages/CotData.jsx`
- Create: `app/src/pages/CotData.module.css`

- [ ] **Step 1: Create `app/src/pages/CotData.module.css`**

```css
/* ── CotData page ────────────────────────────────────────────────── */
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px 40px;
}

/* ── Top bar ─────────────────────────────────────────────────────── */
.topBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

/* ── Dropdown ────────────────────────────────────────────────────── */
.dropdownWrap {
  position: relative;
}

.dropdownBtn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  min-width: 240px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.15s;
}
.dropdownBtn:hover { border-color: rgba(255, 255, 255, 0.3); }

.chevron {
  font-size: 9px;
  color: var(--text-muted);
}

.dropdownMenu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 200;
  width: 310px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
}

.dropdownSearch {
  padding: 10px 14px;
  background: #111;
  border: none;
  border-bottom: 1px solid var(--border);
  color: white;
  font-size: 12px;
  outline: none;
}
.dropdownSearch::placeholder { color: var(--text-muted); }

.dropdownList {
  overflow-y: auto;
  flex: 1;
}

.dropdownGroup {
  padding: 10px 14px 4px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.dropdownGroup:first-child { border-top: none; }

.dropdownItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  cursor: pointer;
  transition: background 0.1s;
}
.dropdownItem:hover  { background: rgba(255, 255, 255, 0.06); }
.dropdownItemActive  { background: #3B82F6 !important; }

.dropdownSym {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  min-width: 36px;
  color: #c9a84c;
}
.dropdownItemActive .dropdownSym { color: white; }

.dropdownName {
  font-size: 11px;
  color: var(--text-primary);
}
.dropdownItemActive .dropdownName { color: white; }

/* ── Lookback buttons ────────────────────────────────────────────── */
.lookbackBtns {
  display: flex;
  gap: 6px;
}

.lookbackBtn {
  padding: 7px 18px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  transition: all 0.15s;
}
.lookbackBtn:hover { border-color: rgba(255, 255, 255, 0.3); color: var(--text-primary); }
.lookbackActive {
  background: #3B82F6;
  border-color: #3B82F6;
  color: white;
}

/* ── Chart container ─────────────────────────────────────────────── */
.chartWrap {
  position: relative;
  background: #000000;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  height: 480px;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-muted);
  border-radius: 12px;
}
.overlayError { color: #f87171; }
```

- [ ] **Step 2: Create `app/src/pages/CotData.jsx`**

```jsx
// app/src/pages/CotData.jsx
import { useState, useRef, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'
import styles from './CotData.module.css'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Title, Tooltip, Legend,
)

// ── Symbol data ────────────────────────────────────────────────────────────────

const SYMBOL_NAMES = {
  ES: 'S&P 500 E-Mini',      NQ: 'Nasdaq-100 E-Mini',   YM: 'DJIA E-Mini',
  QR: 'Russell 2000 Mini',   EW: 'S&P MidCap 400',      VI: 'VIX',
  ET: 'S&P 500 Micro',       NM: 'Nasdaq-100 Micro',    NK: 'Nikkei 225',
  GC: 'Gold',                SI: 'Silver',               HG: 'Copper',
  PL: 'Platinum',            PA: 'Palladium',            AL: 'Aluminum',
  CL: 'Crude Oil (WTI)',     HO: 'Heating Oil',          RB: 'RBOB Gasoline',
  NG: 'Natural Gas',         FL: 'Fuel Ethanol',         BZ: 'Brent Crude',
  ZW: 'Wheat (SRW)',         ZC: 'Corn',                 ZS: 'Soybeans',
  ZM: 'Soybean Meal',        ZL: 'Soybean Oil',          ZR: 'Rough Rice',
  KE: 'Wheat (HRW)',         MW: 'Wheat (Spring)',       RS: 'Canola',
  OA: 'Oats',                CT: 'Cotton No. 2',         OJ: 'Orange Juice',
  KC: 'Coffee C',            SB: 'Sugar No. 11',         CC: 'Cocoa',
  LB: 'Lumber',              LE: 'Live Cattle',          GF: 'Feeder Cattle',
  HE: 'Lean Hogs',           DL: 'Class III Milk',       DF: 'Nonfat Dry Milk',
  BD: 'Butter',              BJ: 'Cheese',               ZB: '30-Year T-Bond',
  UD: 'Ultra T-Bond',        ZN: '10-Year T-Note',       ZF: '5-Year T-Note',
  ZT: '2-Year T-Note',       ZQ: 'Fed Funds 30-Day',     SR3:'SOFR 3-Month',
  DX: 'US Dollar Index',     BA: 'Micro Bitcoin',        TA: 'Micro Ether',
  B6: 'British Pound',       D6: 'Canadian Dollar',      J6: 'Japanese Yen',
  S6: 'Swiss Franc',         E6: 'Euro FX',              A6: 'Australian Dollar',
  M6: 'Mexican Peso',        N6: 'New Zealand Dollar',   T6: 'South African Rand',
  L6: 'Brazilian Real',      BTC:'Bitcoin',              ETH:'Ether',
}

const SYMBOL_GROUPS = {
  INDICES:           ['ES','NQ','YM','QR','EW','VI','ET','NM','NK'],
  METALS:            ['GC','SI','HG','PL','PA','AL'],
  ENERGIES:          ['CL','HO','RB','NG','FL','BZ'],
  GRAINS:            ['ZW','ZC','ZS','ZM','ZL','ZR','KE','MW','RS','OA'],
  SOFTS:             ['CT','OJ','KC','SB','CC','LB'],
  'LIVESTOCK & DAIRY':['LE','GF','HE','DL','DF','BD','BJ'],
  FINANCIALS:        ['ZB','UD','ZN','ZF','ZT','ZQ','SR3'],
  CURRENCIES:        ['DX','BA','TA','B6','D6','J6','S6','E6','A6','M6','N6','T6','L6','BTC','ETH'],
}

const LOOKBACKS = [
  { label: '1Y', weeks: 52  },
  { label: '2Y', weeks: 104 },
  { label: '3Y', weeks: 156 },
  { label: '5Y', weeks: 260 },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  // "2025-11-07" → "11/7/2025"
  const [y, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}/${y}`
}

function fmtNum(v) {
  if (v == null) return ''
  const abs = Math.abs(Math.round(v)).toLocaleString()
  return v < 0 ? `(${abs})` : abs
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CotData() {
  const [symbol,       setSymbol]       = useState('ES')
  const [weeks,        setWeeks]        = useState(52)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search,       setSearch]       = useState('')
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const dropdownRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Fetch COT data when symbol or weeks changes
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/cot/${symbol}?weeks=${weeks}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d  => { setData(d);          setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [symbol, weeks])

  // Filter symbol groups by search query
  const filteredGroups = Object.entries(SYMBOL_GROUPS).reduce((acc, [grp, syms]) => {
    const q = search.toLowerCase()
    const matches = syms.filter(s =>
      s.toLowerCase().includes(q) ||
      (SYMBOL_NAMES[s] || '').toLowerCase().includes(q) ||
      grp.toLowerCase().includes(q)
    )
    if (matches.length) acc[grp] = matches
    return acc
  }, {})

  // ── Chart config ─────────────────────────────────────────────────────────────
  const labels = data ? data.map(d => fmtDate(d.date)) : []

  const chartData = data && data.length > 0 ? {
    labels,
    datasets: [
      {
        type:            'bar',
        label:           'Small Speculators',
        data:            data.map(d => d.small_spec_net),
        backgroundColor: '#FFD700',
        yAxisID:         'y',
        order:           3,
      },
      {
        type:            'bar',
        label:           'Large Speculators',
        data:            data.map(d => d.large_spec_net),
        backgroundColor: '#1E90FF',
        yAxisID:         'y',
        order:           2,
      },
      {
        type:            'bar',
        label:           'Commercials',
        data:            data.map(d => d.commercial_net),
        backgroundColor: '#FF3333',
        yAxisID:         'y',
        order:           1,
      },
      {
        type:            'line',
        label:           'Open Interest',
        data:            data.map(d => d.open_interest),
        borderColor:     '#00FF00',
        backgroundColor: 'transparent',
        borderDash:      [5, 5],
        borderWidth:     1.5,
        pointRadius:     0,
        pointHoverRadius:5,
        yAxisID:         'y2',
        order:           0,
      },
    ],
  } : null

  const chartOptions = {
    responsive:          true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: {
        display: true,
        text:    `${SYMBOL_NAMES[symbol] || symbol} — ${symbol}`,
        color:   'white',
        font:    { size: 13, weight: 'normal' },
        padding: { bottom: 18 },
      },
      legend: {
        position: 'bottom',
        labels: {
          color:          'rgba(255,255,255,0.75)',
          usePointStyle:  true,
          pointStyleWidth:10,
          padding:        22,
          font:           { size: 11 },
        },
      },
      tooltip: {
        backgroundColor: '#1a1a1a',
        titleColor:      'white',
        titleFont:       { weight: 'bold', size: 12 },
        bodyFont:        { size: 11 },
        borderColor:     '#333',
        borderWidth:     1,
        padding:         10,
        callbacks: {
          title:      items => items[0]?.label || '',
          label:      ctx  => {
            const v = ctx.raw
            const lbl = ctx.dataset.label
            if (lbl === 'Open Interest') {
              return `  Open Interest: ${Math.round(v).toLocaleString()}`
            }
            return `  ${lbl}: ${fmtNum(v)}`
          },
          labelColor: ctx  => {
            const colors = {
              'Small Speculators': '#FFD700',
              'Large Speculators': '#1E90FF',
              'Commercials':       '#FF3333',
              'Open Interest':     '#00FF00',
            }
            const c = colors[ctx.dataset.label] || 'white'
            return { borderColor: c, backgroundColor: c }
          },
        },
      },
    },
    scales: {
      x: {
        grid:   { display: false },
        border: { color: '#444' },
        ticks:  {
          color:        'rgba(255,255,255,0.55)',
          maxTicksLimit: 13,
          maxRotation:   0,
          font:          { size: 10 },
        },
      },
      y: {
        grid:   { color: '#1e1e1e', drawBorder: false },
        border: { color: '#444', dash: [2, 2] },
        ticks:  {
          color: 'rgba(255,255,255,0.6)',
          font:  { size: 10 },
          callback: v => v < 0 ? `(${Math.abs(v).toLocaleString()})` : v.toLocaleString(),
        },
      },
      y2: {
        position: 'right',
        grid:     { display: false },
        border:   { color: '#333' },
        ticks:    {
          color: 'rgba(0,255,0,0.7)',
          font:  { size: 10 },
          callback: v => v.toLocaleString(),
        },
      },
    },
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* Top bar */}
      <div className={styles.topBar}>

        {/* Market dropdown */}
        <div className={styles.dropdownWrap} ref={dropdownRef}>
          <button
            className={styles.dropdownBtn}
            onClick={() => setDropdownOpen(v => !v)}
          >
            <span>{SYMBOL_NAMES[symbol] || symbol} ({symbol})</span>
            <span className={styles.chevron}>{dropdownOpen ? '▲' : '▼'}</span>
          </button>

          {dropdownOpen && (
            <div className={styles.dropdownMenu}>
              <input
                className={styles.dropdownSearch}
                placeholder="Search markets..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
              <div className={styles.dropdownList}>
                {Object.entries(filteredGroups).map(([grp, syms]) => (
                  <div key={grp}>
                    <div className={styles.dropdownGroup}>{grp}</div>
                    {syms.map(s => (
                      <div
                        key={s}
                        className={`${styles.dropdownItem} ${s === symbol ? styles.dropdownItemActive : ''}`}
                        onClick={() => { setSymbol(s); setDropdownOpen(false); setSearch('') }}
                      >
                        <span className={styles.dropdownSym}>{s}</span>
                        <span className={styles.dropdownName}>{SYMBOL_NAMES[s] || ''}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {Object.keys(filteredGroups).length === 0 && (
                  <div style={{ padding: '14px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    No markets match "{search}"
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Lookback buttons */}
        <div className={styles.lookbackBtns}>
          {LOOKBACKS.map(lb => (
            <button
              key={lb.label}
              className={`${styles.lookbackBtn} ${weeks === lb.weeks ? styles.lookbackActive : ''}`}
              onClick={() => setWeeks(lb.weeks)}
            >
              {lb.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className={styles.chartWrap}>
        {loading && (
          <div className={styles.overlay}>Loading COT data…</div>
        )}
        {!loading && error && (
          <div className={`${styles.overlay} ${styles.overlayError}`}>
            {error}
          </div>
        )}
        {!loading && !error && (!data || data.length === 0) && (
          <div className={styles.overlay}>
            No COT data available for {symbol}
            {data !== null && ' — database may still be seeding'}
          </div>
        )}
        {!loading && !error && chartData && (
          <Chart type="bar" data={chartData} options={chartOptions} />
        )}
      </div>

    </div>
  )
}
```

- [ ] **Step 3: Verify in browser**

```bash
cd app && npm run dev
```

Navigate to `http://localhost:5173/screener/cot`

Verify:
- Top bar shows "S&P 500 E-Mini (ES)" dropdown + [ 1Y ] [ 2Y ] [ 3Y ] [ 5Y ] buttons
- Chart area shows black background
- `1Y` button is highlighted blue by default
- Dropdown opens on click, shows all groups, search filters correctly
- Selecting a different market updates the URL fetch and chart title

If the backend isn't running, the chart area should show the "No COT data available" message (not crash).

- [ ] **Step 4: Commit frontend**

```bash
cd ..
git add app/src/App.jsx app/src/pages/CotData.jsx app/src/pages/CotData.module.css \
        app/src/pages/Screener.jsx app/src/pages/Screener.module.css app/package.json \
        app/package-lock.json
git commit -m "feat: CotData page — Chart.js mixed chart, grouped dropdown, lookback tabs"
```

---

## Chunk 4: Full Stack Smoke Test + Deploy

### Task 9: End-to-end smoke test + deploy

- [ ] **Step 1: Start backend with local DB**

```bash
cd C:\Users\Patrick\uct-dashboard
uvicorn api.main:app --reload --port 8000
```

Watch console for:
```
[startup] COT table empty — seeding from CFTC historical archive (background)...
[startup] COT scheduler running — refreshes every Friday at 3:45 PM ET
```

Then in a second terminal after a few minutes:
```
[startup] COT initial seed complete — XXXXX records inserted
```

- [ ] **Step 2: Smoke test API endpoints**

```bash
# Should return grouped symbol list
curl http://localhost:8000/api/cot/symbols | python -m json.tool | head -30

# Should return status (record_count > 0 after seed)
curl http://localhost:8000/api/cot/status

# Should return 52 weekly records for ES
curl "http://localhost:8000/api/cot/ES?weeks=52" | python -m json.tool | head -30

# Should return 404
curl http://localhost:8000/api/cot/FAKE

# Should return 400
curl "http://localhost:8000/api/cot/ES?weeks=0"
```

- [ ] **Step 3: Run full test suite**

```bash
pytest -v
```
Expected: all tests PASS

- [ ] **Step 4: Run manual refresh**

```bash
curl -X POST http://localhost:8000/api/cot/refresh
# Expected: {"status":"refresh started"}
```

- [ ] **Step 5: Verify chart renders with real data**

Navigate to `http://localhost:5173/screener/cot` with Vite dev server running.

Verify:
- Chart renders with 4 datasets (3 colored bars + 1 green dashed line)
- Black background, white/colored axes
- Tooltip on hover shows date + all 4 values with correct formatting
- Lookback buttons change the number of bars
- Dropdown search works — type "gold", "crude", "euro"
- Changing symbol updates chart title and data

- [ ] **Step 6: Commit and push to Railway**

```bash
git push origin master
```

Railway auto-deploys. On first deploy, COT database seeds in background.

Watch Railway logs for:
```
[startup] COT table empty — seeding from CFTC historical archive (background)...
[startup] COT initial seed complete — XXXXX records inserted
```

---

## Environment Notes

No new environment variables are required. COT data comes from free public CFTC URLs.

Optional override (not needed on Railway — volume auto-mounts at `/data`):
```
COT_DB_PATH=/custom/path/to/cot.db
```

The SQLite database lives at `/data/cot.db` on Railway (same persistent volume that holds `wire_data.json`). It survives redeploys automatically.
