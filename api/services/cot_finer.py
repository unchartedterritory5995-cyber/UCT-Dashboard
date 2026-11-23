"""COT by trader type: the CFTC's Traders in Financial Futures (TFF) and Disaggregated futures-only reports, read,
stored and served beside the legacy report (`api/services/cot_service.py`, which this module never changes).

WHY. The legacy report splits each market into large speculators, commercials and small traders. The CFTC also
publishes, every week, two finer splits of the same markets: TFF for financial contracts (dealers, asset managers,
leveraged funds, other reportables) and Disaggregated for physical commodities (producers and merchants, swap
dealers, managed money, other reportables). Every market the legacy reader keys appears in exactly one of them.

THE FILES (established 2026-11-22 from the CFTC's own pages; every figure in this repo's tests is invented):
    https://www.cftc.gov/files/dea/history/fut_fin_txt_{YEAR}.zip      TFF, futures only, one year (member FinFutYY.txt)
    https://www.cftc.gov/files/dea/history/fut_disagg_txt_{YEAR}.zip   Disaggregated, futures only (member f_year.txt)
  * The names are the CFTC's "Historical Compressed" page
    (https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalCompressed/index.htm), the same page and the
    same directory as the legacy `deacot{YEAR}.zip`.
  * The column names are the CFTC's variable pages (TFF: .../HistoricalViewable/cotvariablestfm.html, 87 fields;
    Disaggregated: .../HistoricalViewable/CFTC_023168.html, 191 fields), checked once against each 2026 file's own
    header line. Two facts only the files gave: the report date column in BOTH files is `Report_Date_as_YYYY-MM-DD`
    (the TFF page says `Report_Date_as_MM_DD_YYYY`, the Disaggregated page `As_of_Date_Form_YYYY-MM-DD`), and the
    Disaggregated swap columns are spelled with a doubled underscore (`Swap__Positions_Short_All`). So every header
    is matched NORMALISED (case folded, runs of underscores collapsed), and the date falls back to
    `As_of_Date_In_Form_YYMMDD`, which both pages and both files carry.
  * The CFTC's terms (https://www.cftc.gov/WebPolicy/index.htm): "Government information at the CFTC website is in
    the public domain. Public domain information may be freely distributed and copied, but it is requested that in
    any subsequent use the CFTC be given appropriate acknowledgement." The panel names the CFTC as the source.

HOW A ROW BECOMES A MARKET (`CONTRACT_CODES`, then the legacy reader's own names). Each market the site lists is
matched by its CFTC contract market code, the code that survives the CFTC's renames (all 66 checked in the 2026
files). A row whose code is not in the table falls back to its market name through the legacy reader's own name
table (`cot_service._NAME_TO_SYMBOL`, SYMBOL_MAP plus its rename aliases), with runs of spaces collapsed; a code
match always beats a name match for the same market and week. Each stored week keeps the code, the CFTC's name and
which way it matched, and a market answer lists the records its weeks came from. Found in the 2026 files: Hard Red
Spring wheat (MW) now reads "WHEAT-HRSpring - MIAX FUTURES EXCHANGE" and Micro Ether (TA) carries two spaces before
its hyphen in the TFF file, so the legacy name table as it stood found neither; their codes (001626, 146022) still do.
THE LEGACY READER MATCHES THROUGH THIS SAME RULE (`cot_service._parse_cftc_stream` calls `symbol_for`, 2026-11-22):
a change to `CONTRACT_CODES` or `symbol_for` changes what the legacy report stores too.

WHEN (never on a member's request). The scheduler calls `run_scheduled` at 05:10 and 21:10 New York time
(`RUN_HOURS_ET`, `RUN_MINUTE_ET`), both inside scan_period's quiet span (`scan_period._reuse_quiet_now`, read, never
retyped): 21:10 on the Friday the CFTC publishes (15:30 ET), the next morning as the retry, and the evening of a
holiday week's Monday release. A run asks for NOTHING when each report already holds the report the CFTC should
have published by now (`cot_service.expected_latest_report_date`, the legacy reader's holiday-aware rule) and every
year of the seed (`cot_service._SEED_YEARS`, the legacy reader's ten) is held. Otherwise it asks, one file at a
time, for the year of the expected report first and then each missing seed year, newest first, until the run's
budget (`RUN_BUDGET_S`) or the quiet span ends; what it read stays written, so a cut run resumes the next time.
A failure is recorded (`cot_finer_runs`) and the last good weeks stay; nothing retries on a member's request.

MEMORY AND DISK. A file is streamed to disk in 64 KB pieces (at most `MAX_ZIP_BYTES`, refused not truncated), read
from the zip row by row, and deleted; one file is on disk at a time, beside the COT database. A run holds one
file's matched weeks (at most 66 markets times 53 weeks) and nothing else: `MEASURED_PEAK_MB`.

THE REQUEST PATH (`market_answer`, `board_answer`, called by `GET /api/cot/{symbol}/breakdown` and
`GET /api/cot/breakdown`): small indexed reads of what is stored. They never download, never build and never
start a run. Positions are the CFTC's own counts (long, short, spreading, traders); the net, the week's change, the
share of open interest and the place in the range are worked out by the panel with the legacy panel's own
arithmetic (app/src/pages/cot/cotRead.js), never a second formula here.
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import shutil
import sqlite3
import threading
import time
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional, TextIO

from api.services import cot_service

_log = logging.getLogger(__name__)

SOURCE = "CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), futures only"
TERMS_URL = "https://www.cftc.gov/WebPolicy/index.htm"
FILE_BASE = "https://www.cftc.gov/files/dea/history/"

# ── the builder's defaults (not owner rulings) ───────────────────────────────────────────────────
RUN_HOURS_ET = (5, 21)          # two runs a day, New York time, both inside scan_period's quiet span
RUN_MINUTE_ET = 10
RUN_BUDGET_S = 1200.0           # wall clock one run may take
PAUSE_S = 2.0                   # between two downloads of one run
HTTP_TIMEOUT = (15, 120)        # connect, read (seconds)
CHUNK_BYTES = 64 * 1024
MAX_ZIP_BYTES = 40_000_000      # the largest file seen is 2.2 MB (Disaggregated 2026, 46 weeks); refused above this
MAX_TEXT_BYTES = 250_000_000    # a zip member that says it unpacks past this is refused (20.3 MB seen)
DISK_HEADROOM_BYTES = 200_000_000
MAX_WEEKS = 520                 # the most weeks one answer carries (the legacy route's bound)
#: The most private memory one file's read and store added, measured on the dev PC 2026-11-22 (the process's peak
#: private bytes, no tracer): the real 2026 Disaggregated file (12,575 rows, 191 columns, 20.3 MB unpacked, 35
#: markets matched) 7.1 MB in 0.8 s; the real 2026 TFF file (4,115 rows) 6.5 MB in 0.3 s; an INVENTED file in the
#: Disaggregated layout of 31,800 rows (38.8 MB unpacked) in which all 66 markets match for 53 weeks, the most a
#: file can hold, 17.2 MB in 1.9 s. The read keeps only matched weeks, so it grows with markets times weeks, never
#: with the file's size.
MEASURED_PEAK_MB = 17


class Shape(ValueError):
    """The file is not the layout this module reads (a required column is missing, or it is not a zip)."""


class TooLarge(ValueError):
    """A download or a zip member larger than its cap: refused, never truncated."""


class HttpStatus(Exception):
    def __init__(self, status: int):
        super().__init__(f"status {status}")
        self.status = status


class _Stop(Exception):
    """End this run now; what was written stays. `reason` is a word the answer and the log can say."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# ── the two reports ──────────────────────────────────────────────────────────────────────────────

def _norm(header: str) -> str:
    """A header as it is matched: trimmed, case folded, runs of underscores collapsed."""
    return re.sub(r"_+", "_", str(header or "").strip()).lower()


@dataclass(frozen=True)
class TraderClass:
    key: str                       # our key, as the route and the panel name it
    cftc: str                      # the CFTC's own name for the class
    long: str                      # its columns, NORMALISED (`_norm`)
    short: str
    spread: Optional[str] = None
    traders_long: Optional[str] = None
    traders_short: Optional[str] = None
    traders_spread: Optional[str] = None


def _cls(key: str, cftc: str, stem: str, *, spread: bool = True) -> TraderClass:
    """One class from its CFTC column stem (`Lev_Money`): `{stem}_Positions_Long_All`, `Traders_{stem}_Long_All`.
    `spread=False`: the class has no spreading column (producers and merchants). The doubled underscores of the
    Disaggregated swap columns disappear in `_norm`, so one spelling reads both."""
    return TraderClass(
        key=key, cftc=cftc,
        long=_norm(f"{stem}_Positions_Long_All"), short=_norm(f"{stem}_Positions_Short_All"),
        spread=_norm(f"{stem}_Positions_Spread_All") if spread else None,
        traders_long=_norm(f"Traders_{stem}_Long_All"), traders_short=_norm(f"Traders_{stem}_Short_All"),
        traders_spread=_norm(f"Traders_{stem}_Spread_All") if spread else None,
    )


NONREPORTABLE = TraderClass(key="nonreportable", cftc="Nonreportable Positions",
                            long=_norm("NonRept_Positions_Long_All"), short=_norm("NonRept_Positions_Short_All"))


@dataclass(frozen=True)
class Report:
    key: str
    name: str                      # the CFTC's name for the report
    file: str                      # the yearly futures-only text file, `{year}`
    watch: str                     # the class traders watch most in it
    classes: tuple[TraderClass, ...]

    def url(self, year: int) -> str:
        return FILE_BASE + self.file.format(year=year)


REPORTS: dict[str, Report] = {r.key: r for r in (
    Report("tff", "Traders in Financial Futures", "fut_fin_txt_{year}.zip", "leveraged_funds", (
        _cls("dealer", "Dealer/Intermediary", "Dealer"),
        _cls("asset_manager", "Asset Manager/Institutional", "Asset_Mgr"),
        _cls("leveraged_funds", "Leveraged Funds", "Lev_Money"),
        _cls("other_reportable", "Other Reportables", "Other_Rept"),
        NONREPORTABLE,
    )),
    Report("disaggregated", "Disaggregated", "fut_disagg_txt_{year}.zip", "managed_money", (
        _cls("producer_merchant", "Producer/Merchant/Processor/User", "Prod_Merc", spread=False),
        _cls("swap_dealer", "Swap Dealers", "Swap"),
        _cls("managed_money", "Managed Money", "M_Money"),
        _cls("other_reportable", "Other Reportables", "Other_Rept"),
        NONREPORTABLE,
    )),
)}

COL_NAME = _norm("Market_and_Exchange_Names")
COL_CODE = _norm("CFTC_Contract_Market_Code")
COL_OI = _norm("Open_Interest_All")
COL_TRADERS = _norm("Traders_Tot_All")
#: The report date: the column the files carry, then the one both CFTC pages and both files carry.
DATE_COLS = ((_norm("Report_Date_as_YYYY-MM-DD"), "%Y-%m-%d"), (_norm("As_of_Date_In_Form_YYMMDD"), "%y%m%d"))
#: The share of each side held by the largest four and eight traders (gross and net), percent.
CONCENTRATION = (
    ("gross_4_long", _norm("Conc_Gross_LE_4_TDR_Long_All")), ("gross_4_short", _norm("Conc_Gross_LE_4_TDR_Short_All")),
    ("gross_8_long", _norm("Conc_Gross_LE_8_TDR_Long_All")), ("gross_8_short", _norm("Conc_Gross_LE_8_TDR_Short_All")),
    ("net_4_long", _norm("Conc_Net_LE_4_TDR_Long_All")), ("net_4_short", _norm("Conc_Net_LE_4_TDR_Short_All")),
    ("net_8_long", _norm("Conc_Net_LE_8_TDR_Long_All")), ("net_8_short", _norm("Conc_Net_LE_8_TDR_Short_All")),
)

#: Each market the legacy reader keys, by the CFTC contract market code of its record in the TFF or Disaggregated
#: file. Every code read from the CFTC's own 2026 files on 2026-11-22 (TFF: 31 markets, Disaggregated: 35); a
#: test holds this table to `cot_service.SYMBOL_MAP`, so a market added there cannot go unmapped here.
CONTRACT_CODES: dict[str, str] = {
    # TFF: indexes
    "ES": "13874A", "NQ": "20974+", "YM": "12460+", "QR": "239742", "EW": "33874A", "VI": "1170E1",
    "ET": "13874U", "NM": "209747", "NK": "240741",
    # TFF: rates
    "ZB": "020601", "UD": "020604", "ZN": "043602", "ZF": "044601", "ZT": "042601", "ZQ": "045601", "SR3": "134741",
    # TFF: currencies and crypto
    "DX": "098662", "B6": "096742", "D6": "090741", "J6": "097741", "S6": "092741", "E6": "099741", "A6": "232741",
    "M6": "095741", "N6": "112741", "T6": "122741", "L6": "102741",
    "BTC": "133741", "BA": "133742", "ETH": "146021", "TA": "146022",
    # Disaggregated: metals
    "GC": "088691", "SI": "084691", "HG": "085692", "PL": "076651", "PA": "075651", "AL": "191691",
    # Disaggregated: energies
    "CL": "067651", "HO": "022651", "RB": "111659", "NG": "023651", "FL": "025651", "BZ": "06765T",
    # Disaggregated: grains
    "ZW": "001602", "ZC": "002602", "ZS": "005602", "ZM": "026603", "ZL": "007601", "ZR": "039601",
    "KE": "001612", "MW": "001626", "RS": "135731", "OA": "004603",
    # Disaggregated: softs
    "CT": "033661", "OJ": "040701", "KC": "083731", "SB": "080732", "CC": "073732", "LB": "058644",
    # Disaggregated: livestock and dairy
    "LE": "057642", "GF": "061641", "HE": "054642", "DL": "052641", "DF": "052642", "BD": "050642", "BJ": "063642",
}
_CODE_TO_SYMBOL: dict[str, str] = {code: sym for sym, code in CONTRACT_CODES.items()}


def _name_key(name: str) -> str:
    return " ".join(str(name or "").split()).upper()


#: The legacy reader's names (SYMBOL_MAP and its rename aliases), runs of spaces collapsed. Read, never retyped.
_NAME_TO_SYMBOL: dict[str, str] = {_name_key(n): s for n, s in cot_service._NAME_TO_SYMBOL.items()}

MATCH_CODE = "code"
MATCH_NAME = "name"
_MATCH_RANK = {MATCH_CODE: 0, MATCH_NAME: 1}


def symbol_for(code: str, name: str) -> tuple[Optional[str], Optional[str]]:
    """(symbol, how it matched) for one row: its contract code first, its name second; (None, None) when neither."""
    sym = _CODE_TO_SYMBOL.get(str(code or "").strip())
    if sym:
        return sym, MATCH_CODE
    sym = _NAME_TO_SYMBOL.get(_name_key(name))
    return (sym, MATCH_NAME) if sym else (None, None)


# ── parsing ──────────────────────────────────────────────────────────────────────────────────────

def _int(raw: Any) -> Optional[int]:
    """A count from the file, or None when the cell is blank or not a number (never 0 for a missing figure)."""
    s = str(raw if raw is not None else "").replace(",", "").strip()
    if not s or s == ".":
        return None
    try:
        return int(s)
    except ValueError:
        try:
            f = float(s)
        except ValueError:
            return None
        return int(f) if f == f and f.is_integer() else None


def _float(raw: Any) -> Optional[float]:
    s = str(raw if raw is not None else "").replace(",", "").strip()
    if not s or s == ".":
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if f == f else None


def _date(raw: Any, fmt: str) -> Optional[str]:
    s = str(raw if raw is not None else "").strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, fmt).date().isoformat()
    except ValueError:
        return None


@dataclass
class Parsed:
    """One file's matched weeks. `markets`: (symbol, date) -> the market row; `positions`: the same key -> one row per
    class. `rows` counts every data row read, `unmatched` those that are no market of ours, `newest` is the newest
    report date anywhere in the file (matched or not)."""
    report: str
    markets: dict
    positions: dict
    rows: int = 0
    unmatched: int = 0
    newest: Optional[str] = None
    no_date: int = 0


def parse_report(stream: TextIO, report: Report) -> Parsed:
    """Read one TFF or Disaggregated file, row by row. Raises `Shape` when a required column is missing.
    Required: the market name, a report date column, open interest, and each class's long and short. The contract
    code, spreading, trader counts and concentration are read when present, else None."""
    reader = csv.reader(stream)
    try:
        header = next(reader)
    except StopIteration:
        raise Shape("the file is empty") from None
    at = {}
    for i, h in enumerate(header):
        at.setdefault(_norm(h), i)
    need = [COL_NAME, COL_OI] + [c for k in report.classes for c in (k.long, k.short)]
    missing = sorted(c for c in need if c not in at)
    dates = [(at[c], fmt) for c, fmt in DATE_COLS if c in at]
    if missing or not dates:
        raise Shape("missing columns: " + ", ".join(missing + ([] if dates else ["a report date"])))

    def col(name):
        return at.get(name) if name else None

    i_name, i_code, i_oi, i_traders = at[COL_NAME], col(COL_CODE), at[COL_OI], col(COL_TRADERS)
    conc = [(k, col(c)) for k, c in CONCENTRATION]
    classes = [(k.key, at[k.long], at[k.short], col(k.spread), col(k.traders_long), col(k.traders_short),
                col(k.traders_spread)) for k in report.classes]
    width = len(header)

    def cell(row, i):
        return row[i] if i is not None and i < len(row) else None

    out = Parsed(report=report.key, markets={}, positions={})
    seen_dates: dict[tuple[int, str], Optional[str]] = {}     # a file carries about 50 distinct dates
    for row in reader:
        if not row or len(row) < min(width, i_oi + 1):
            continue
        out.rows += 1
        when = None
        for i, fmt in dates:
            raw = str(cell(row, i) or "").strip()
            if (i, raw) not in seen_dates:
                seen_dates[(i, raw)] = _date(raw, fmt)
            when = seen_dates[(i, raw)]
            if when:
                break
        if when is None:
            out.no_date += 1
            continue
        if out.newest is None or when > out.newest:
            out.newest = when
        name = str(cell(row, i_name) or "").strip()
        code = str(cell(row, i_code) or "").strip()
        sym, match = symbol_for(code, name)
        if sym is None:
            out.unmatched += 1
            continue
        key = (sym, when)
        held = out.markets.get(key)
        if held is not None and _MATCH_RANK[held["match"]] <= _MATCH_RANK[match]:
            continue                                   # a code match is never replaced by a name match
        out.markets[key] = {
            "symbol": sym, "date": when, "report": report.key, "cftc_code": code or None,
            "market_name": " ".join(name.split()) or None, "match": match,
            "open_interest": _int(cell(row, i_oi)), "traders_total": _int(cell(row, i_traders)),
            **{f"conc_{k}": _float(cell(row, i)) for k, i in conc},
        }
        out.positions[key] = [
            {"symbol": sym, "date": when, "cls": k, "long": _int(cell(row, il)), "short": _int(cell(row, ishort)),
             "spread": _int(cell(row, isp)), "traders_long": _int(cell(row, itl)),
             "traders_short": _int(cell(row, its)), "traders_spread": _int(cell(row, itsp))}
            for (k, il, ishort, isp, itl, its, itsp) in classes
        ]
    return out


def parse_zip(path: str, report: Report) -> Parsed:
    """The text member of one downloaded zip, streamed. `Shape` when it is not a zip or has no text member;
    `TooLarge` when the member says it unpacks past MAX_TEXT_BYTES."""
    try:
        with zipfile.ZipFile(path) as zf:
            members = [i for i in zf.infolist() if i.filename.lower().endswith((".txt", ".csv"))]
            if not members:
                raise Shape("no text file in the zip")
            info = members[0]
            if info.file_size > MAX_TEXT_BYTES:
                raise TooLarge(f"unpacks to {info.file_size} bytes")
            with zf.open(info) as fh:
                return parse_report(io.TextIOWrapper(fh, encoding="utf-8", errors="replace", newline=""), report)
    except zipfile.BadZipFile as exc:
        raise Shape("the download is not a zip") from exc


# ── the database (the legacy reader's cot.db, its own connection helper) ─────────────────────────

_MARKET_COLS = ("symbol", "date", "report", "cftc_code", "market_name", "match", "open_interest", "traders_total",
                *(f"conc_{k}" for k, _ in CONCENTRATION))
_POSITION_COLS = ("symbol", "date", "cls", "long", "short", "spread", "traders_long", "traders_short",
                  "traders_spread")


def init_db() -> None:
    """Create this module's tables in the COT database if absent (the legacy tables are never touched)."""
    os.makedirs(os.path.dirname(os.path.abspath(cot_service.DB_PATH)), exist_ok=True)
    conc_cols = "".join(f"                conc_{k} REAL,\n" for k, _ in CONCENTRATION)
    with cot_service._get_conn() as conn:
        conn.executescript(f"""
            CREATE TABLE IF NOT EXISTS cot_finer_markets (
                symbol        TEXT NOT NULL,
                date          DATE NOT NULL,
                report        TEXT NOT NULL,
                cftc_code     TEXT,
                market_name   TEXT,
                match         TEXT NOT NULL,
                open_interest INTEGER,
                traders_total INTEGER,
{conc_cols}                PRIMARY KEY (symbol, date)
            );
            CREATE TABLE IF NOT EXISTS cot_finer_positions (
                symbol         TEXT NOT NULL,
                date           DATE NOT NULL,
                cls            TEXT NOT NULL,
                long           INTEGER,
                short          INTEGER,
                spread         INTEGER,
                traders_long   INTEGER,
                traders_short  INTEGER,
                traders_spread INTEGER,
                PRIMARY KEY (symbol, date, cls)
            );
            CREATE TABLE IF NOT EXISTS cot_finer_files (
                report     TEXT    NOT NULL,
                year       INTEGER NOT NULL,
                fetched_at TEXT    NOT NULL,
                bytes      INTEGER NOT NULL,
                rows       INTEGER NOT NULL,
                weeks      INTEGER NOT NULL,
                newest     DATE,
                PRIMARY KEY (report, year)
            );
            CREATE TABLE IF NOT EXISTS cot_finer_runs (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                run_at    TEXT NOT NULL,
                state     TEXT NOT NULL,
                reason    TEXT,
                requests  INTEGER NOT NULL DEFAULT 0,
                bytes     INTEGER NOT NULL DEFAULT 0,
                weeks     INTEGER NOT NULL DEFAULT 0,
                elapsed_s REAL
            );
        """)


def store(parsed: Parsed, year: int, nbytes: int) -> int:
    """Write one file's weeks and its ledger row in ONE transaction (a later read of the same year replaces its
    weeks, as the legacy reader's upsert does). Returns the weeks written."""
    weeks = len(parsed.markets)
    mcols, pcols = ", ".join(_MARKET_COLS), ", ".join(_POSITION_COLS)
    with cot_service._get_conn() as conn:
        conn.executemany(
            f"INSERT OR REPLACE INTO cot_finer_markets ({mcols}) VALUES ({', '.join(':' + c for c in _MARKET_COLS)})",
            list(parsed.markets.values()))
        conn.executemany(
            f"INSERT OR REPLACE INTO cot_finer_positions ({pcols}) VALUES ({', '.join(':' + c for c in _POSITION_COLS)})",
            [p for rows in parsed.positions.values() for p in rows])
        conn.execute(
            "INSERT OR REPLACE INTO cot_finer_files (report, year, fetched_at, bytes, rows, weeks, newest) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (parsed.report, year, _now_iso(), nbytes, parsed.rows, weeks, parsed.newest))
    return weeks


def _note_not_posted(report: str, year: int) -> None:
    """A past year the CFTC answered 404 for: a ledger row with nothing read, so the plan does not ask again."""
    with cot_service._get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO cot_finer_files (report, year, fetched_at, bytes, rows, weeks, newest) "
            "VALUES (?, ?, ?, 0, 0, 0, NULL)", (report, year, _now_iso()))


def held_files() -> dict[str, dict[int, Optional[str]]]:
    """{report: {year: newest report date in that file}} for every file read so far ({} before the first)."""
    out: dict[str, dict[int, Optional[str]]] = {k: {} for k in REPORTS}
    try:
        with cot_service._get_conn() as conn:
            for row in conn.execute("SELECT report, year, newest FROM cot_finer_files"):
                if row["report"] in out:
                    out[row["report"]][int(row["year"])] = row["newest"]
    except sqlite3.Error:
        return {k: {} for k in REPORTS}
    return out


def _log_run(summary: dict) -> None:
    try:
        with cot_service._get_conn() as conn:
            conn.execute(
                "INSERT INTO cot_finer_runs (run_at, state, reason, requests, bytes, weeks, elapsed_s) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (summary.get("at") or _now_iso(), summary.get("state") or "failed", summary.get("reason"),
                 int(summary.get("requests") or 0), int(summary.get("bytes") or 0), int(summary.get("weeks") or 0),
                 summary.get("elapsed_s")))
    except sqlite3.Error as exc:
        _log.warning("[cot-finer] the run could not be recorded (%s)", type(exc).__name__)


def last_run() -> Optional[dict]:
    try:
        with cot_service._get_conn() as conn:
            row = conn.execute("SELECT run_at, state, reason FROM cot_finer_runs ORDER BY id DESC LIMIT 1").fetchone()
    except sqlite3.Error:
        return None
    return {"at": row["run_at"], "state": row["state"], "reason": row["reason"]} if row else None


# ── clock and plan ───────────────────────────────────────────────────────────────────────────────

def now_et() -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def quiet(now: datetime) -> bool:
    """scan_period's quiet span, read from scan_period itself (weekends; weekdays before 07:00 or from 20:15 ET)."""
    from zoneinfo import ZoneInfo
    from api.services import scan_period
    return scan_period._reuse_quiet_now(now.astimezone(ZoneInfo("America/New_York")))


def next_run(now: Optional[datetime] = None) -> datetime:
    """The next scheduled run after `now` (New York time)."""
    now = now or now_et()
    for days in (0, 1):
        for hour in sorted(RUN_HOURS_ET):
            slot = (now + timedelta(days=days)).replace(hour=hour, minute=RUN_MINUTE_ET, second=0, microsecond=0)
            if slot > now:
                return slot
    return (now + timedelta(days=1)).replace(hour=min(RUN_HOURS_ET), minute=RUN_MINUTE_ET, second=0, microsecond=0)


def plan(held: dict[str, dict[int, Optional[str]]], expected: date) -> list[tuple[str, int]]:
    """PURE: the files this run asks for, in order. For each report: the year of the expected report when the
    report does not hold it yet, then every seed year not held, newest first. [] when everything is held."""
    want = expected.isoformat()
    top = expected.year
    seed = range(top, top - cot_service._SEED_YEARS, -1)
    todo: list[tuple[str, int]] = []
    for key in REPORTS:
        files = held.get(key) or {}
        newest = max((d for d in files.values() if d), default=None)
        if newest is None or newest < want:
            todo.append((key, top))
    for key in REPORTS:
        files = held.get(key) or {}
        todo.extend((key, y) for y in seed if y not in files and (key, y) not in todo)
    return todo


# ── one run ──────────────────────────────────────────────────────────────────────────────────────

def _download(url: str, dest: str) -> int:
    """ONE GET, streamed to `dest`, at most MAX_ZIP_BYTES. No redirect is followed. The request is the legacy
    reader's (`requests.get`, its default user agent; same host, same directory). Tests replace this by name."""
    import requests
    n = 0
    with requests.get(url, timeout=HTTP_TIMEOUT, stream=True, allow_redirects=False) as resp:
        if resp.status_code != 200:
            raise HttpStatus(resp.status_code)
        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(CHUNK_BYTES):
                n += len(chunk)
                if n > MAX_ZIP_BYTES:
                    raise TooLarge(f"larger than {MAX_ZIP_BYTES} bytes")
                fh.write(chunk)
    return n


def _pause(seconds: float) -> None:
    time.sleep(seconds)


def _work_dir() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(cot_service.DB_PATH)), "cot_finer_tmp")


def refresh(now: Optional[datetime] = None) -> dict:
    """One run on the CALLING thread. Never raises. `state`: 'current' (nothing asked) | 'built' (every planned file
    read) | 'stopped' (cut by the budget, the quiet span's end or a refusal; what was read stays) | 'not_published'
    (the expected year's file is not posted yet) | 'failed' | 'shape' | 'low_disk'."""
    now = now or now_et()
    started = time.monotonic()
    summary: dict[str, Any] = {"state": None, "at": _now_iso(), "requests": 0, "bytes": 0, "weeks": 0, "files": []}
    try:
        init_db()
        expected = cot_service.expected_latest_report_date(now)
        todo = plan(held_files(), expected)
    except Exception as exc:  # noqa: BLE001 -- only the class is kept
        summary.update(state="failed", reason=type(exc).__name__)
        return _finish(summary, started)
    summary["expected"] = expected.isoformat()
    if not todo:
        summary["state"] = "current"
        return _finish(summary, started)

    work = _work_dir()
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    not_posted: list[str] = []
    try:
        for n, (key, year) in enumerate(todo):
            if n:
                if time.monotonic() - started > RUN_BUDGET_S:
                    raise _Stop("time")
                if not quiet(now_et()):
                    raise _Stop("busy")
                _pause(PAUSE_S)
            if shutil.disk_usage(work).free < DISK_HEADROOM_BYTES:
                raise _Stop("low_disk")
            report = REPORTS[key]
            dest = os.path.join(work, f"{key}_{year}.zip")
            summary["requests"] += 1
            try:
                nbytes = _download(report.url(year), dest)
            except HttpStatus as exc:
                if exc.status == 404:
                    not_posted.append(f"{key} {year}")
                    summary["files"].append({"report": key, "year": year, "status": "not_posted"})
                    if year < expected.year:
                        _note_not_posted(key, year)       # a past year that is not there is not asked again
                    continue
                if exc.status in (403, 429):
                    raise _Stop(f"http_{exc.status}") from None
                raise
            summary["bytes"] += nbytes
            try:
                parsed = parse_zip(dest, report)
            finally:
                try:
                    os.remove(dest)
                except OSError:
                    pass
            weeks = store(parsed, year, nbytes)
            summary["weeks"] += weeks
            summary["files"].append({"report": key, "year": year, "status": "read", "bytes": nbytes,
                                     "rows": parsed.rows, "weeks": weeks, "newest": parsed.newest})
        read_any = any(f["status"] == "read" for f in summary["files"])
        summary["state"] = "built" if read_any else "not_published"
        if not_posted:
            summary["not_posted"] = not_posted
    except _Stop as stop:
        summary.update(state="low_disk" if stop.reason == "low_disk" else "stopped", reason=stop.reason)
    except Shape as shape:
        summary.update(state="shape", reason=str(shape)[:200])
    except TooLarge:
        summary.update(state="failed", reason="too_large")
    except HttpStatus as exc:
        summary.update(state="failed", reason=f"http_{exc.status}")
    except Exception as exc:  # noqa: BLE001 -- only the class is kept; the stored weeks stay
        summary.update(state="failed", reason=type(exc).__name__)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return _finish(summary, started)


def _finish(summary: dict, started: float) -> dict:
    summary["elapsed_s"] = round(time.monotonic() - started, 1)
    if summary["state"] != "current":
        _log_run(summary)
    line = (f"state={summary['state']} expected={summary.get('expected')} requests={summary['requests']} "
            f"bytes={summary['bytes']} weeks={summary['weeks']} reason={summary.get('reason')} "
            f"{summary['elapsed_s']}s")
    (_log.info if summary["state"] in ("built", "current", "not_published") else _log.warning)("[cot-finer] %s", line)
    return summary


# ── one run at a time ────────────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_state: dict[str, Any] = {"inflight": None}


def _run(done: threading.Event, now: datetime) -> None:
    try:
        refresh(now)
    except Exception as exc:  # noqa: BLE001 -- refresh never raises; this is the last guard
        _log.warning("[cot-finer] run failed (%s); the stored weeks are kept", type(exc).__name__)
    finally:
        with _lock:
            _state["inflight"] = None
        done.set()


def run_scheduled(now: Optional[datetime] = None) -> dict:
    """THE SCHEDULED ENTRY (`api/main.py`, RUN_HOURS_ET at RUN_MINUTE_ET): start one run on its own thread, unless one
    is running or the clock is outside the quiet span. Returns at once."""
    now = now or now_et()
    if not quiet(now):
        return {"started": False, "reason": "not_quiet"}
    with _lock:
        if _state["inflight"] is not None:
            return {"started": False, "reason": "running"}
        done = _state["inflight"] = threading.Event()
    threading.Thread(target=_run, args=(done, now), daemon=True, name="cot-finer").start()
    return {"started": True}


def building() -> bool:
    with _lock:
        return _state["inflight"] is not None


def drain(timeout: float = 10.0) -> None:
    """Tests: wait for the run in flight, if any."""
    with _lock:
        done = _state["inflight"]
    if done is not None:
        done.wait(timeout)


# ── the request path ─────────────────────────────────────────────────────────────────────────────

def _classes_of(report: Report) -> list[dict]:
    return [{"key": k.key, "cftc": k.cftc, "spread": k.spread is not None, "traders": k.traders_long is not None}
            for k in report.classes]


def _status_block() -> dict:
    """What every answer says about the reader itself: when it next looks, and a last look that did not go well."""
    last = last_run()
    out: dict[str, Any] = {"next_check": next_run().isoformat(timespec="minutes"), "building": building()}
    if last and last.get("state") not in ("built", "current", "not_published"):
        out["check"] = last
    return out


def _nothing_held(conn) -> bool:
    """No file has been read yet (a past year noted as not posted is not a read)."""
    return conn.execute("SELECT COUNT(*) FROM cot_finer_files WHERE bytes > 0").fetchone()[0] == 0


def market_answer(symbol: str, weeks: int = 52) -> dict:
    """One market's stored weeks of its finer report, oldest first. Never raises. `state`: 'ok' | 'no_record' (the
    held files carry no record of this market) | 'not_built' (nothing read from the CFTC yet) | 'unavailable'."""
    sym = str(symbol or "").strip().upper()
    weeks = max(1, min(int(weeks), MAX_WEEKS))
    base: dict[str, Any] = {"symbol": sym, "source": SOURCE}
    try:
        with cot_service._get_conn() as conn:
            if _nothing_held(conn):
                return {**base, "state": "not_built", **_status_block()}
            head = conn.execute(f"SELECT {', '.join(_MARKET_COLS[1:])} FROM cot_finer_markets WHERE symbol = ? "
                                "ORDER BY date DESC LIMIT ?", (sym, weeks)).fetchall()
            if not head:
                return {**base, "state": "no_record", **_status_block()}
            report = REPORTS.get(head[0]["report"])
            if report is None:
                return {**base, "state": "unavailable", "reason": "an unknown report is stored"}
            head = [r for r in head if r["report"] == report.key]
            pos = conn.execute(f"SELECT {', '.join(_POSITION_COLS[1:])} FROM cot_finer_positions "
                               "WHERE symbol = ? AND date >= ?", (sym, head[-1]["date"])).fetchall()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return {**base, "state": "not_built", **_status_block()}
        _log.warning("[cot-finer] a market read failed (%s)", type(exc).__name__)
        return {**base, "state": "unavailable", "reason": "the stored report could not be read"}
    except sqlite3.Error as exc:
        _log.warning("[cot-finer] a market read failed (%s)", type(exc).__name__)
        return {**base, "state": "unavailable", "reason": "the stored report could not be read"}

    by_date: dict[str, dict] = {}
    for p in pos:
        by_date.setdefault(p["date"], {})[p["cls"]] = {k: p[k] for k in _POSITION_COLS[3:]}
    keys = [k.key for k in report.classes]
    rows = [{"date": r["date"], "open_interest": r["open_interest"], "traders_total": r["traders_total"],
             "classes": {k: by_date.get(r["date"], {}).get(k) for k in keys}} for r in reversed(head)]
    records: list[dict] = []
    for r in reversed(head):
        ident = (r["cftc_code"], r["market_name"], r["match"])
        if records and (records[-1]["cftc_code"], records[-1]["market_name"], records[-1]["match"]) == ident:
            records[-1]["last"] = r["date"]
        else:
            records.append({"cftc_code": ident[0], "market_name": ident[1], "match": ident[2],
                            "first": r["date"], "last": r["date"]})
    newest = head[0]
    conc = {k: newest[f"conc_{k}"] for k, _ in CONCENTRATION}
    return {**base, "state": "ok", "report": report.key, "report_name": report.name, "watch": report.watch,
            "classes": _classes_of(report), "records": records, "rows": rows,
            "concentration": {"date": newest["date"], **conc} if any(v is not None for v in conc.values()) else None,
            **_status_block()}


def board_answer() -> dict:
    """Every listed market's newest two weeks of the class traders watch most in its report (leveraged funds in
    TFF, managed money in Disaggregated). Never raises. `state`: 'ok' | 'not_built' | 'unavailable'."""
    base: dict[str, Any] = {"source": SOURCE, "watch": {k: r.watch for k, r in REPORTS.items()},
                            "reports": {k: r.name for k, r in REPORTS.items()}}
    markets: dict[str, dict] = {}
    no_record: list[str] = []
    try:
        with cot_service._get_conn() as conn:
            if _nothing_held(conn):
                return {**base, "state": "not_built", **_status_block()}
            for sym in cot_service.SYMBOL_MAP:
                head = conn.execute("SELECT date, report, open_interest FROM cot_finer_markets WHERE symbol = ? "
                                    "ORDER BY date DESC LIMIT 2", (sym,)).fetchall()
                report = REPORTS.get(head[0]["report"]) if head else None
                if report is None:
                    no_record.append(sym)
                    continue
                pos = {p["date"]: p for p in conn.execute(
                    "SELECT date, long, short, spread FROM cot_finer_positions WHERE symbol = ? AND cls = ? "
                    f"AND date IN ({', '.join('?' * len(head))})", (sym, report.watch, *[h["date"] for h in head]))}
                weeks = []
                for h in head:
                    if h["report"] != report.key:
                        continue
                    p = pos.get(h["date"])
                    weeks.append({"date": h["date"], "open_interest": h["open_interest"],
                                  **{k: (p[k] if p is not None else None) for k in ("long", "short", "spread")}})
                markets[sym] = {"report": report.key, "watch": report.watch, **weeks[0],
                                "previous": weeks[1] if len(weeks) > 1 else None}
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc):
            return {**base, "state": "not_built", **_status_block()}
        _log.warning("[cot-finer] the board read failed (%s)", type(exc).__name__)
        return {**base, "state": "unavailable", "reason": "the stored report could not be read"}
    except sqlite3.Error as exc:
        _log.warning("[cot-finer] the board read failed (%s)", type(exc).__name__)
        return {**base, "state": "unavailable", "reason": "the stored report could not be read"}
    return {**base, "state": "ok", "markets": markets, "no_record": no_record, **_status_block()}
