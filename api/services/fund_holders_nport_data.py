"""The Funds (N-PORT) index: which registered funds (mutual funds and ETFs) hold a stock, how much, and what
changed since each fund's previous report, built from the SEC's quarterly Form N-PORT data sets.

This module READS ONE DATA SET ZIP IT IS GIVEN and WRITES ONE SQLITE FILE. It never reaches the network and has no
clock of its own; `api/services/fund_holders_nport.py` downloads the zips, runs this on its own thread and serves
the file. Nothing here runs on a member's request.

THE SOURCE (established 2026-11-22 from the SEC's own pages, each read once through the site's SEC client):
  * the listing, https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets: "Form N-PORT Data Sets
    October 2019 - September 2026"; "The data sets will be updated quarterly. Data contained in documents filed
    after 5:30 PM Eastern on the last business day of a quarter will be included in the subsequent quarterly
    posting."; one ZIP a quarter at /files/dera/data/form-n-port-data-sets/{YYYY}q{N}_nport.zip, listed at 228.89 MB
    (2019 Q4) to 690.83 MB (2022 Q3), and 387.2 to 483.26 MB for every quarter from 2023 Q1 to 2026 Q3.
  * the readme, https://www.sec.gov/files/nport_readme.pdf: "up to 30 data files", "text format, tab delimited,
    UTF-8 encoding", each quarter "accompanied by a metadata file conforming to the W3C specification for tabular
    data", and the table definitions. The five tables and the columns read here:
        SUBMISSION             ACCESSION_NUMBER, FILING_DATE, SUB_TYPE ("NPORT-P, NPORT-P/A, NT NPORT-P"), REPORT_DATE
                               ("Date as of which information is reported")
        REGISTRANT             ACCESSION_NUMBER, CIK, REGISTRANT_NAME
        FUND_REPORTED_INFO     ACCESSION_NUMBER, SERIES_NAME, SERIES_ID, NET_ASSETS
        FUND_REPORTED_HOLDING  ACCESSION_NUMBER, HOLDING_ID, ISSUER_NAME, ISSUER_CUSIP, BALANCE, UNIT,
                               CURRENCY_VALUE (Item C.2.c), PERCENTAGE ("Percentage value compared to net assets of
                               the Fund"), PAYOFF_PROFILE ("long, short, N/A"), ASSET_CAT
        IDENTIFIERS            HOLDING_ID, IDENTIFIER_ISIN, IDENTIFIER_TICKER
  * Form N-PORT, https://www.sec.gov/files/formn-port.pdf: Item C.2.c "Value. Report values in U.S. dollars";
    Item C.1.e "At least one of the following other identifiers: i. ISIN. ii. Ticker (if ISIN is not available).";
    an amendment "must provide information in response to all items".
NO WHOLE DATA SET WAS DOWNLOADED to write this. The member file names, the header row, the date format and the code
values (asset type "EC" / equity-common, unit "NS" / number of shares, payoff "Long") are read the way the readme and
the form describe them, and both spellings of each code are accepted. Every test reads an invented miniature in that
layout. A table or column this cannot find, or a data set with no common-stock share holding in it, is a `Shape`
error: the build stops and the last good index stays.

WHAT A ROW IS. A fund's long position in a common stock, in shares: asset type equity-common, unit number of shares,
payoff profile long (or not given), a positive balance. Short positions, preferred stock, bonds, options and swaps
are not holders of the stock and are left out (counted).

WHICH REPORT IS A FUND'S. A fund is its SERIES_ID (else its registrant's CIK and series name). Its CURRENT report is
the newest REPORT_DATE among its filings in the newest data set, the latest-filed one for that date (an amendment
restates the whole report). Its PREVIOUS report is the newest REPORT_DATE before that, from the same data set or the
one before it. Late-filing notices (NT NPORT-P) carry no holdings and are skipped.

MATCHING A HOLDING TO A TICKER (no name or CUSIP is ever matched on its own words alone):
  1. the security is its ISSUER_CUSIP (check digit verified), else the CUSIP inside a US or CA ISIN;
  2. that CUSIP's ticker comes from, in this order:
       `sec_ftd`      the SEC's fails-to-deliver files the server already holds pair the CUSIP with a symbol;
       `fund_ticker`  the tickers the funds themselves reported for the holding (IDENTIFIER_TICKER): the most-
                      reported one, when it has at least `MIN_TICKER_SHARE` of the reports;
       `sec_name`     only for a CUSIP whose first character is a digit (a US or Canadian issue): the issuer name the
                      funds gave, in a plain normal form, equals the SEC company name (company_tickers.json) of
                      exactly ONE ticker. Never for a name two tickers share (two share classes).
  3. one ticker, one security: when two CUSIPs reach the same ticker, the better tier wins, then the more fund
     positions, then the more value; the other's holdings are not listed (counted as `conflict`).
Holdings that end with no ticker are counted by reason (`no_identifier`, `no_ticker`, `conflict`) in rows and in
dollars, and the panel says what share of the data set's common-stock value was matched.

MEMORY. No more than one CUSIP partition's holdings are in memory at once (`Builder`: each zip read once, holdings
split into `PARTS` files by a hash of the CUSIP, then each partition loaded, worked out, written and let go). What is
kept whole: one table entry per security and per report used (names, votes, counts), and, while a data set's
IDENTIFIERS are read, one 8-byte join key per kept holding of that data set. Measured on INVENTED data sets in this
layout (Windows, one process; not yet seen on a real one): the peak working set rises about 95 to 135 MB at 100,000
securities and 7,500 to 15,000 funds, for 0.54M to 2.16M holding rows read; time follows the rows read (about
50 seconds a million, the identifiers and the partition files included). `MAX_EQUITY_ROWS` caps the rows kept (and so
the partition files): past it the build stops with a `Shape` reason and the last good index stays.

NO CUSIP IS STORED. CUSIPs are used in memory during a build to join a holding to its ticker and a fund's two
reports to each other; the index written to disk is keyed by ticker and holds no CUSIP (CUSIP Global Services' terms
on keeping a database of CUSIP numbers: docs/terminal-research/05-product-strategy/prds/entity-master-prd.md).
"""
from __future__ import annotations

import io
import json
import os
import re
import sqlite3
import sys
import zipfile
import zlib
from array import array
from collections.abc import Mapping
from datetime import date, datetime, timezone
from typing import Callable, Iterable, Optional

#: the tables read, and the columns each one must carry (by NAME, in any order)
TABLES = {
    "SUBMISSION": ("ACCESSION_NUMBER", "FILING_DATE", "SUB_TYPE", "REPORT_DATE"),
    "REGISTRANT": ("ACCESSION_NUMBER", "CIK", "REGISTRANT_NAME"),
    "FUND_REPORTED_INFO": ("ACCESSION_NUMBER", "SERIES_NAME", "SERIES_ID", "NET_ASSETS"),
    "FUND_REPORTED_HOLDING": ("ACCESSION_NUMBER", "HOLDING_ID", "ISSUER_NAME", "ISSUER_CUSIP", "BALANCE", "UNIT",
                              "CURRENCY_VALUE", "PERCENTAGE", "PAYOFF_PROFILE", "ASSET_CAT"),
    "IDENTIFIERS": ("HOLDING_ID", "IDENTIFIER_ISIN", "IDENTIFIER_TICKER"),
}

# ── the builder's defaults (not owner rulings) ───────────────────────────────────────────────────
KEEP_ROWS = 50                 # funds kept per stock, by value (the panel shows 20, the rest on request)
KEEP_SOLD = 10                 # funds that sold out kept per stock, by the value they held before
MAX_TICKERS = 20_000           # stocks in one index (the most widely held first)
MIN_TICKER_SHARE = 0.6         # the most-reported ticker for a security needs this share of the reports
MAX_TABLE_ROWS = 60_000_000    # a table longer than this is not the data set this reads
MAX_EQUITY_ROWS = 10_000_000   # common-stock share holdings kept over both data sets (temporary disk: 24 bytes each)
TICK_EVERY = 100_000           # rows between two calls of the build's `tick` (time budget, quiet span, a pause)
MAX_VALUE_USD = 1e15           # a holding valued at this or more is a filing error, read as not reported
MAX_PCT = 1e6                  # likewise a percent of net assets
PARTS = 64                     # CUSIP partitions; the build holds one partition's holdings at a time (memory)
FLUSH_ROWS = 100_000           # holdings buffered before they are appended to their partitions' files
JOIN_BATCH = 20_000            # IDENTIFIERS rows joined to the holdings at once
WRITE_BATCH = 20_000           # index rows written at once
PCT_SAMPLE = 200_000           # current-report holdings the percent-unit check reads (the first ones read)
INDEX_VERSION = 1

EQUITY_CODES = frozenset({"EC", "EQUITY-COMMON", "EQUITY COMMON"})
SHARE_UNITS = frozenset({"NS", "NUMBER OF SHARES"})
LONG_PAYOFFS = frozenset({"LONG", ""})

TIERS = ("sec_ftd", "fund_ticker", "sec_name")
_NO_CODE = (1 << 20) - 1          # the IDENTIFIERS join key's code for a holding with no CUSIP (yet)
_CODE_MASK = (1 << 20) - 1
_MAX_HOLDING_ID = 1 << 43         # a holding id must fit beside a 20-bit security code in 64 bits
STATES = ("added", "cut", "unchanged", "new", "no_prior")

_SERIES_ID = re.compile(r"^S\d{9}$")
_ACCESSION = re.compile(r"^\d{10}-\d{2}-\d{6}$")
_US_TICKER = re.compile(r"^[A-Z]{1,5}(?:-[A-Z]{1,2})?$")
_CLASS_PAIR = re.compile(r"^([A-Z]{1,5})[ ./]([A-Z])$")
_MONTHS = {m: i for i, m in enumerate(("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1)}
_LEGAL_TAIL = frozenset({"INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "PLC",
                         "LLC", "LP", "SA", "NV", "AG", "SE", "DE", "DEL", "NEW", "THE"})
_NO_TICKER = frozenset({"NONE", "NA", "NULL", "NIL", "TBD", "UNKNOWN", "N"})


class Shape(Exception):
    """The zip is not the data set this reads (a table or column missing, too large, nothing in it). `why` is plain
    words for the log and the build's state."""

    def __init__(self, why: str):
        super().__init__(why)
        self.why = why


# ── small pure helpers ───────────────────────────────────────────────────────────────────────────

def cusip_check_digit(base8: str) -> Optional[int]:
    """The CUSIP check digit of an 8-character base (the standard modulus-10 'double add double' rule), or None
    for a base that is not 8 letters, digits, `*`, `@` or `#`."""
    if len(base8) != 8:
        return None
    total = 0
    for i, ch in enumerate(base8):
        if ch.isdigit():
            v = ord(ch) - 48
        elif "A" <= ch <= "Z":
            v = ord(ch) - 55
        elif ch == "*":
            v = 36
        elif ch == "@":
            v = 37
        elif ch == "#":
            v = 38
        else:
            return None
        if i % 2 == 1:
            v *= 2
        total += v // 10 + v % 10
    return (10 - total % 10) % 10


def valid_cusip(raw) -> Optional[str]:
    """The 9-character CUSIP when it is one (check digit verified), else None. All zeros and all nines, which pass
    the check, are placeholders and are None."""
    s = raw.strip().upper() if isinstance(raw, str) else ""
    if len(s) != 9 or s in ("000000000", "999999999") or not s[8].isdigit():
        return None
    return s if cusip_check_digit(s[:8]) == int(s[8]) else None


def cusip_from_isin(raw) -> Optional[str]:
    """The CUSIP inside a US or CA ISIN (country code + the 9-character CUSIP + one check digit), else None."""
    s = raw.strip().upper() if isinstance(raw, str) else ""
    if len(s) != 12 or s[:2] not in ("US", "CA"):
        return None
    return valid_cusip(s[2:11])


def norm_ticker(raw) -> Optional[str]:
    """A ticker as a fund typed it, in the site's spelling (`BRK-B`), or None when it is not a US-style ticker.
    `AAPL US`, `AAPL UW Equity` and `NASDAQ: AAPL` read `AAPL`; `BRK B`, `BRK/B` and `BRK.B` read `BRK-B`; a
    numeric local code (`7203`) or a word for none (`N/A`) is None."""
    s = raw.strip().upper() if isinstance(raw, str) else ""
    if not s:
        return None
    if ":" in s:
        s = s.rsplit(":", 1)[1].strip()
    letters = re.sub(r"[^A-Z]", "", s)
    if not letters or letters in _NO_TICKER:
        return None
    m = _CLASS_PAIR.match(s)
    if m:
        s = f"{m.group(1)}-{m.group(2)}"
    else:
        s = re.split(r"[,;\s]+", s)[0].replace("/", "-").replace(".", "-")
    return s if _US_TICKER.match(s) else None


def norm_name(raw) -> str:
    """A company name in a plain normal form for an exact comparison: upper case, `&` as AND, punctuation as
    spaces, a leading THE and trailing legal-form words (INC, CORP, CO, LTD, PLC, /DE/ ...) dropped."""
    s = raw.upper() if isinstance(raw, str) else ""
    s = re.sub(r"[^A-Z0-9 ]+", " ", s.replace("&", " AND "))
    words = s.split()
    if words and words[0] == "THE":
        words = words[1:]
    while words and words[-1] in _LEGAL_TAIL:
        words.pop()
    return " ".join(words)


def parse_day(raw) -> Optional[str]:
    """`YYYY-MM-DD` from the data set's date forms (`2031-09-30`, `30-SEP-2031`, `09/30/2031`, `20310930`, with or
    without a time), else None."""
    s = raw.strip().upper() if isinstance(raw, str) else ""
    if not s:
        return None
    s = s.split(" ")[0].split("T")[0]
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            return date.fromisoformat(s).isoformat()
        m = re.fullmatch(r"(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})", s)
        if m and m.group(2) in _MONTHS:
            y = int(m.group(3))
            y = y + 2000 if y < 100 else y
            return date(y, _MONTHS[m.group(2)], int(m.group(1))).isoformat()
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
        if m:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
        if re.fullmatch(r"\d{8}", s):
            return date(int(s[:4]), int(s[4:6]), int(s[6:])).isoformat()
    except ValueError:
        return None
    return None


def to_num(raw) -> Optional[float]:
    if raw is None:
        return None
    s = raw.strip() if isinstance(raw, str) else raw
    if s == "" or s is None:
        return None
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def _to_int(raw) -> Optional[int]:
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


def _text(raw) -> Optional[str]:
    s = raw.strip() if isinstance(raw, str) else ""
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1].strip()
    return s or None


# ── the zip ──────────────────────────────────────────────────────────────────────────────────────

def _header(zf: zipfile.ZipFile, member: str) -> set:
    try:
        with zf.open(member) as raw:
            line = raw.readline(65536).decode("utf-8", "replace")
    except (KeyError, zipfile.BadZipFile, OSError):
        return set()
    return {h.strip().strip('"').upper() for h in line.rstrip("\r\n").lstrip("﻿").split("\t")}


def find_members(zf: zipfile.ZipFile) -> dict[str, str]:
    """{table: member name} for the five tables, found by, in order:
      1. a member whose base name (any folder, `.tsv` or `.txt`, any case) is the table's name;
      2. the W3C metadata file: a table whose column list holds every column read here;
      3. the one remaining member whose header row holds every column read here.
    A table not found, or found twice by its columns, is a `Shape` error."""
    names = [n for n in zf.namelist() if not n.endswith("/")]
    data = [n for n in names if n.rsplit(".", 1)[-1].lower() in ("tsv", "txt")]
    out: dict[str, str] = {}
    for n in data:
        stem = n.rsplit("/", 1)[-1].rpartition(".")[0].upper()
        if stem in TABLES and stem not in out:
            out[stem] = n
    if len(out) == len(TABLES):
        return out
    for n in names:
        if not n.lower().endswith(".json"):
            continue
        try:
            if zf.getinfo(n).file_size > 5_000_000:
                continue
            meta = json.loads(zf.read(n).decode("utf-8", "replace"))
        except (ValueError, KeyError, zipfile.BadZipFile):
            continue
        for t in meta.get("tables", []) if isinstance(meta, dict) else []:
            if not isinstance(t, dict) or not isinstance(t.get("url"), str):
                continue
            cols = {str(c.get("name") or c.get("titles") or "").upper()
                    for c in (t.get("tableSchema") or {}).get("columns", []) if isinstance(c, dict)}
            base = t["url"].rsplit("/", 1)[-1]
            hit = next((m for m in data if m.rsplit("/", 1)[-1] == base), None)
            for table, need in TABLES.items():
                if hit and table not in out and set(need) <= cols and hit not in out.values():
                    out[table] = hit
    for table, need in TABLES.items():
        if table in out:
            continue
        hits = [n for n in data if n not in out.values() and set(need) <= _header(zf, n)]
        if len(hits) > 1:
            raise Shape(f"{len(hits)} files could be the {table} table")
        if hits:
            out[table] = hits[0]
    for table in TABLES:
        if table not in out:
            raise Shape(f"no {table} file in the data set")
    return out


def iter_table(zf: zipfile.ZipFile, member: str, columns: tuple, tick: Callable[[], None]) -> Iterable[list]:
    """Each row of one tab-delimited member as a list of the `columns` values (by header NAME). A row with fewer
    fields than the header is skipped. `tick()` is called every TICK_EVERY rows."""
    with zf.open(member) as raw:
        fh = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")
        header = fh.readline().rstrip("\r\n").lstrip("﻿").split("\t")
        index = {h.strip().strip('"').upper(): i for i, h in enumerate(header)}
        missing = [c for c in columns if c not in index]
        if missing:
            raise Shape(f"{member} has no column {', '.join(missing)}")
        pick = [index[c] for c in columns]
        width = len(header)
        n = 0
        for line in fh:
            n += 1
            if n % TICK_EVERY == 0:
                tick()
                if n > MAX_TABLE_ROWS:
                    raise Shape(f"{member} is longer than {MAX_TABLE_ROWS} rows")
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) < width:
                continue
            yield [parts[i] for i in pick]


# ── reports: which filing is each fund's ─────────────────────────────────────────────────────────

def read_reports(zf: zipfile.ZipFile, members: dict, tick: Callable[[], None]) -> list[dict]:
    """Every holdings report of one data set: accession, filing date, report date, the fund (series id and name, its
    key) and its registrant (CIK, name), net assets. Late-filing notices and undated reports are left out."""
    subs: dict[str, dict] = {}
    for acc, filed, kind, rdate in iter_table(zf, members["SUBMISSION"], TABLES["SUBMISSION"], tick):
        acc, kind = (acc or "").strip(), (_text(kind) or "").upper()
        if not _ACCESSION.match(acc) or kind.startswith("NT"):
            continue
        day = parse_day(rdate)
        if day is None:
            continue
        subs[acc] = {"acc": acc, "filed": parse_day(filed), "kind": kind, "report_date": day,
                     "cik": None, "family": None, "series_id": None, "name": None, "net_assets": None}
    for acc, cik, name in iter_table(zf, members["REGISTRANT"], TABLES["REGISTRANT"], tick):
        rec = subs.get((acc or "").strip())
        if rec is not None:
            digits = re.sub(r"\D", "", cik or "")
            rec["cik"] = (digits.lstrip("0") or None) if digits else None
            rec["family"] = _text(name)
    for acc, sname, sid, net in iter_table(zf, members["FUND_REPORTED_INFO"], TABLES["FUND_REPORTED_INFO"], tick):
        rec = subs.get((acc or "").strip())
        if rec is not None:
            rec["name"] = _text(sname)
            sid = (_text(sid) or "").upper()
            rec["series_id"] = sid if _SERIES_ID.match(sid) else None
            rec["net_assets"] = to_num(net)
    out = []
    for rec in subs.values():
        if rec["series_id"]:
            rec["key"] = rec["series_id"]
        elif rec["cik"]:
            rec["key"] = f"{rec['cik']}|{norm_name(rec['name'] or '')}"
        else:
            rec["key"] = rec["acc"]
        out.append(rec)
    return out


def _newest(reports: list[dict]) -> Optional[dict]:
    """The newest report: the latest report date, then the latest filing of it (an amendment restates it)."""
    return max(reports, key=lambda r: (r["report_date"], r["filed"] or "", r["acc"]), default=None)


# ── the build ────────────────────────────────────────────────────────────────────────────────────

class _Interner:
    def __init__(self):
        self.ids: dict[str, int] = {}
        self.items: list[str] = []

    def get(self, s: str) -> int:
        i = self.ids.get(s)
        if i is None:
            i = self.ids[s] = len(self.items)
            self.items.append(s)
        return i


def _spill_dtype():
    import numpy as np
    return np.dtype([("rep", "<i4"), ("cus", "<i4"), ("bal", "<f8"), ("val", "<f4"), ("pct", "<f4")])


def _loose_dtype():
    import numpy as np
    return np.dtype([("rep", "<i4"), ("hid", "<i8"), ("bal", "<f8"), ("val", "<f4"), ("pct", "<f4")])


class Builder:
    """One index from the newest data set and the one before it, read so that no more than ONE CUSIP partition's
    holdings are ever in memory:

        b = Builder(tick, work_dir, parts)
        b.add_current(zip_newest)      # every fund's current report (and a previous one filed in the same data set)
        b.add_prior(zip_before)        # the previous report of every fund that has none yet
        summary = b.finish(path, meta, ftd_pairs=..., sec_names=...)   # writes the index file; the builder is spent

    READING (once per data set). FUND_REPORTED_HOLDING is streamed ONCE: each kept holding goes, in batches of
    `FLUSH_ROWS`, to one of `parts` partition files under `work_dir`, chosen by a stable hash of its CUSIP
    (CRC-32 mod `parts`), as 24 bytes (report, security code, shares, value, percent). A holding with no CUSIP waits
    in a side file until IDENTIFIERS has been read (its ISIN may give one). IDENTIFIERS is then streamed once for
    the ticker votes and those ISINs, joined to the holdings through one 8-byte key per kept holding of this data set
    (holding id and security code, packed and sorted in place), let go when the data set is done. Neither zip is
    read twice, and only one is open at a time.

    FINISHING. The matching is decided once for every security (it needs every vote and every claim on a ticker).
    Then, partition by partition, the two data sets' rows of that partition are loaded, every stock in it is
    worked out (a stock's holdings all carry its one security, and a fund's two reports are joined on that same
    security, so a stock never spans two partitions) and written to the index file, and the rows are let go before
    the next partition is loaded. `stats["max_rows_held"]` is the most holding rows loaded at once.
    """

    def __init__(self, tick: Optional[Callable[[], None]] = None, work_dir: Optional[str] = None,
                 parts: Optional[int] = None):
        self.tick = tick or (lambda: None)
        self.parts = max(1, min(int(parts or PARTS), 32_000))
        self.work_dir = work_dir             # made when the first holding is written (a temporary folder if None)
        self.reps: list[dict] = []           # the reports used: every fund's current one and its previous one
        self.series = _Interner()
        self.cur: dict[int, int] = {}        # series -> its current report
        self.prev: dict[int, int] = {}       # series -> its previous report
        self.cusips = _Interner()
        self._part_of = array("h")           # security code -> its partition
        self._rows_by: list[int] = []        # security code -> holdings kept (the tie-break between two claims)
        self._val_by: list[float] = []       # security code -> their dollars
        self.names: dict = {}                # security code -> [name, rows] or {name: rows} (three at most), US/CA only
        self.votes: dict[tuple, int] = {}    # (security code, ticker) -> reports of that ticker
        self._sample = {k: array(t) for k, t in (("rep", "i"), ("val", "f"), ("pct", "f"))}   # for the percent unit
        self._no_id = [0, 0.0]               # current-report holdings with no CUSIP or US/CA ISIN: rows, dollars
        self.stats = {"holdings_rows": 0, "equity_rows": 0, "short_rows": 0, "isin_cusips": 0,
                      "reports_current": 0, "reports_previous": 0, "prior_read": False,
                      "partitions": self.parts, "partition_rows": [], "max_rows_held": 0, "join_key_bytes": 0}
        self.data_sets: dict[str, dict] = {}

    # ── one data set ──
    def add_current(self, zf: zipfile.ZipFile, label: str = "current") -> None:
        members = find_members(zf)
        reports = read_reports(zf, members, self.tick)
        by_series: dict[str, list[dict]] = {}
        for r in reports:
            by_series.setdefault(r["key"], []).append(r)
        del reports
        wanted: dict[str, int] = {}
        for key, rs in by_series.items():
            s = self.series.get(key)
            cur = _newest(rs)
            self.cur[s] = self._add_rep(cur, s)
            wanted[cur["acc"]] = self.cur[s]
            before = _newest([r for r in rs if r["report_date"] < cur["report_date"]])
            if before is not None:
                self.prev[s] = self._add_rep(before, s)
                wanted[before["acc"]] = self.prev[s]
        self.stats["reports_current"] = len(self.cur)
        self.data_sets[label] = {"reports": sum(len(v) for v in by_series.values()), "funds": len(by_series)}
        del by_series
        self._read_holdings(zf, members, wanted, label)

    def add_prior(self, zf: zipfile.ZipFile, label: str = "prior") -> None:
        members = find_members(zf)
        reports = read_reports(zf, members, self.tick)
        by_series: dict[str, list[dict]] = {}
        for r in reports:
            by_series.setdefault(r["key"], []).append(r)
        del reports
        wanted: dict[str, int] = {}
        for key, rs in by_series.items():
            s = self.series.ids.get(key)
            if s is None or s not in self.cur or s in self.prev:
                continue
            cur_day = self.reps[self.cur[s]]["report_date"]
            before = _newest([r for r in rs if r["report_date"] < cur_day])
            if before is not None:
                self.prev[s] = self._add_rep(before, s)
                wanted[before["acc"]] = self.prev[s]
        self.stats["prior_read"] = True
        self.data_sets[label] = {"reports": sum(len(v) for v in by_series.values()), "funds": len(by_series)}
        del by_series
        if wanted:
            self._read_holdings(zf, members, wanted, label)

    def _add_rep(self, rec: dict, s: int) -> int:
        """Keep what the index uses of a report (a trust's name once for all its funds)."""
        family = rec.get("family")
        self.reps.append({"acc": rec["acc"], "filed": rec.get("filed"), "report_date": rec["report_date"],
                          "cik": rec.get("cik"), "family": sys.intern(family) if isinstance(family, str) else None,
                          "series_id": rec.get("series_id"), "name": rec.get("name"),
                          "net_assets": rec.get("net_assets"), "s": s})
        return len(self.reps) - 1

    def _code(self, cusip: str) -> int:
        """The security code of a CUSIP, made (with its partition) the first time it is seen."""
        n = len(self.cusips.items)
        code = self.cusips.get(cusip)
        if code == n:
            if code >= _NO_CODE:
                raise Shape(f"more than {_NO_CODE - 1} securities")
            self._part_of.append(zlib.crc32(cusip.encode("ascii")) % self.parts)
            self._rows_by.append(0)
            self._val_by.append(0.0)
        return code

    def _spill_path(self, label: str, part) -> str:
        if self.work_dir is None:
            import tempfile
            self.work_dir = tempfile.mkdtemp(prefix="nport_build_")
        os.makedirs(self.work_dir, exist_ok=True)
        return os.path.join(self.work_dir, f"{label}_{part}.bin")

    def _flush(self, label: str, buf: dict) -> None:
        """Append the buffered holdings to their partitions' files, and empty the buffer."""
        import numpy as np
        n = len(buf["rep"])
        if not n:
            return
        rec = np.empty(n, dtype=_spill_dtype())
        rec["rep"] = np.frombuffer(buf["rep"], dtype=np.int32)
        rec["cus"] = np.frombuffer(buf["cus"], dtype=np.int32)
        rec["bal"] = np.frombuffer(buf["bal"], dtype=np.float64)
        rec["val"] = np.frombuffer(buf["val"], dtype=np.float32)
        rec["pct"] = np.frombuffer(buf["pct"], dtype=np.float32)
        part = np.frombuffer(self._part_of, dtype=np.int16)[rec["cus"]]
        order = np.argsort(part, kind="stable")
        edges = np.searchsorted(part[order], np.arange(self.parts + 1))
        for p in range(self.parts):
            a, b = int(edges[p]), int(edges[p + 1])
            if b > a:
                with open(self._spill_path(label, p), "ab") as fh:
                    rec[order[a:b]].tofile(fh)
        del rec, part, order
        for k, t in (("rep", "i"), ("cus", "i"), ("bal", "d"), ("val", "f"), ("pct", "f")):
            buf[k] = array(t)

    @staticmethod
    def _flush_loose(fh, lbuf: dict) -> None:
        """Append the buffered holdings that have no CUSIP (yet) to the side file, and empty the buffer."""
        import numpy as np
        n = len(lbuf["rep"])
        if not n:
            return
        rec = np.empty(n, dtype=_loose_dtype())
        for k, dt in (("rep", np.int32), ("hid", np.int64), ("bal", np.float64), ("val", np.float32), ("pct", np.float32)):
            rec[k] = np.frombuffer(lbuf[k], dtype=dt)
        rec.tofile(fh)
        del rec
        for k, t in (("rep", "i"), ("hid", "q"), ("bal", "d"), ("val", "f"), ("pct", "f")):
            lbuf[k] = array(t)

    def _read_holdings(self, zf: zipfile.ZipFile, members: dict, wanted: dict[str, int], label: str) -> None:
        import numpy as np
        cur_reps = set(self.cur.values())
        buf = {k: array(t) for k, t in (("rep", "i"), ("cus", "i"), ("bal", "d"), ("val", "f"), ("pct", "f"))}
        loose = open(self._spill_path(label, "loose"), "wb")
        loose_dt = _loose_dtype()
        lbuf = {k: array(t) for k, t in (("rep", "i"), ("hid", "q"), ("bal", "d"), ("val", "f"), ("pct", "f"))}
        keys = array("q")                    # (holding id << 20) | security code (or _NO_CODE): the IDENTIFIERS join
        nan = float("nan")
        seen = equity_coded = kept = 0
        sample = self._sample
        try:
            for acc, hid, iname, cusip, bal, unit, val, pct, payoff, cat in iter_table(
                    zf, members["FUND_REPORTED_HOLDING"], TABLES["FUND_REPORTED_HOLDING"], self.tick):
                seen += 1
                if (_text(cat) or "").upper() not in EQUITY_CODES or (_text(unit) or "").upper() not in SHARE_UNITS:
                    continue
                equity_coded += 1
                rep = wanted.get(acc.strip() if acc else "")
                if rep is None:
                    continue
                if (_text(payoff) or "").upper() not in LONG_PAYOFFS:
                    self.stats["short_rows"] += 1
                    continue
                shares = to_num(bal)
                h = _to_int(hid)
                if shares is None or shares <= 0 or h is None:
                    continue
                if not 0 <= h < _MAX_HOLDING_ID:
                    raise Shape("a holding id beyond what this reads")
                v, p = to_num(val), to_num(pct)
                # a value or percent no fund could hold (negative, or past float32's range) is not reported, never inf
                v = v if v is not None and 0 <= v < MAX_VALUE_USD else nan
                p = p if p is not None and 0 <= p < MAX_PCT else nan
                c = valid_cusip(cusip)
                if c:
                    code = self._code(c)
                    if c[0].isdigit():               # names match US/CA issues only (a CUSIP, not a CINS)
                        self._note_name(code, iname)
                    buf["rep"].append(rep)
                    buf["cus"].append(code)
                    buf["bal"].append(shares)
                    buf["val"].append(v)
                    buf["pct"].append(p)
                    self._rows_by[code] += 1
                    if v == v:
                        self._val_by[code] += v
                    keys.append((h << 20) | code)
                    if len(buf["rep"]) >= FLUSH_ROWS:
                        self._flush(label, buf)
                else:
                    for k, x in (("rep", rep), ("hid", h), ("bal", shares), ("val", v), ("pct", p)):
                        lbuf[k].append(x)
                    keys.append((h << 20) | _NO_CODE)
                    if len(lbuf["rep"]) >= FLUSH_ROWS:
                        self._flush_loose(loose, lbuf)
                if rep in cur_reps and len(sample["rep"]) < PCT_SAMPLE and v == v and p == p:
                    sample["rep"].append(rep)
                    sample["val"].append(v)
                    sample["pct"].append(p)
                kept += 1
                if self.stats["equity_rows"] + kept > MAX_EQUITY_ROWS:
                    raise Shape(f"more than {MAX_EQUITY_ROWS} common-stock holdings")
            self._flush(label, buf)
            self._flush_loose(loose, lbuf)
        finally:
            loose.close()
        self.stats["holdings_rows"] += seen
        self.stats["equity_rows"] += kept
        if seen >= 1000 and equity_coded == 0:
            raise Shape("no common-stock share holding in the data set (the asset type or unit codes are not as read)")
        if kept == 0:
            return

        # IDENTIFIERS, once: the funds' tickers (votes), and a CUSIP from a US/CA ISIN for a holding that gave none
        key_np = np.frombuffer(keys, dtype=np.int64)
        key_np.sort()
        self.stats["join_key_bytes"] = max(self.stats["join_key_bytes"], key_np.nbytes)
        found_code: dict[int, int] = {}      # holding id -> the security its ISIN gave (holdings with no CUSIP only)
        batch_h, batch_rest = [], []

        def join():
            if not batch_h:
                return
            hq = np.asarray(batch_h, dtype=np.int64)
            pos = np.searchsorted(key_np, hq << 20)
            pos[pos >= len(key_np)] = 0
            hit = (key_np[pos] >> 20) == hq
            for j in np.nonzero(hit)[0].tolist():
                code = int(key_np[pos[j]] & _CODE_MASK)
                isin, tick_raw = batch_rest[j]
                if code == _NO_CODE:
                    h = batch_h[j]
                    code = found_code.get(h, -1)
                    if code < 0:
                        c = cusip_from_isin(isin)
                        if c:
                            code = found_code[h] = self._code(c)
                            self.stats["isin_cusips"] += 1
                if code >= 0:
                    t = norm_ticker(tick_raw)
                    if t:
                        self.votes[(code, t)] = self.votes.get((code, t), 0) + 1
            batch_h.clear()
            batch_rest.clear()

        for hid, isin, tick_raw in iter_table(zf, members["IDENTIFIERS"], TABLES["IDENTIFIERS"], self.tick):
            if not (isin and isin.strip()) and not (tick_raw and tick_raw.strip()):
                continue
            h = _to_int(hid)
            if h is None or not 0 <= h < _MAX_HOLDING_ID:
                continue
            batch_h.append(h)
            batch_rest.append((isin, tick_raw))
            if len(batch_h) >= JOIN_BATCH:
                join()
        join()
        del key_np, keys

        # the holdings that waited for an ISIN: to their partitions, or counted as having no identifier
        path = self._spill_path(label, "loose")
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            done = 0
            while done < size:
                chunk = np.fromfile(fh, dtype=loose_dt, count=FLUSH_ROWS)
                done += chunk.nbytes
                for rep, h, shares, v, p in chunk.tolist():
                    code = found_code.get(h, -1)
                    if code < 0:
                        if rep in cur_reps:
                            self._no_id[0] += 1
                            self._no_id[1] += v if v == v else 0.0
                        continue
                    buf["rep"].append(rep)
                    buf["cus"].append(code)
                    buf["bal"].append(shares)
                    buf["val"].append(v)
                    buf["pct"].append(p)
                    self._rows_by[code] += 1
                    if v == v:
                        self._val_by[code] += v
                self._flush(label, buf)
                if not len(chunk):
                    break
        os.remove(path)

    def _note_name(self, code: int, raw) -> None:
        """Count the issuer name's spellings for a security: [name, count] while it has one (most do), then
        {name: count} for up to three."""
        n = norm_name(raw)
        if not n:
            return
        seen = self.names.get(code)
        if seen is None:
            self.names[code] = [n, 1]
        elif isinstance(seen, list):
            if seen[0] == n:
                seen[1] += 1
            else:
                self.names[code] = {seen[0]: seen[1], n: 1}
        elif n in seen or len(seen) < 3:
            seen[n] = seen.get(n, 0) + 1

    # ── matching ──
    def match(self, ftd_pairs: Optional[dict] = None, sec_names: Optional[dict] = None):
        """(ticker of each security code or None, its tier or None, the votes for the winner, conflict losers)."""
        ftd_pairs, sec_names = ftd_pairs or {}, sec_names or {}
        n = len(self.cusips.items)
        rows_by = self._rows_by + [0] * (n - len(self._rows_by))
        val_by = self._val_by + [0.0] * (n - len(self._val_by))
        # each security's ticker reports, tallied as it goes (no dict per security): the total, the most reports a
        # ticker has, that ticker, and how many tickers share that most
        total, top_k, top_t, ties = [0] * n, [0] * n, [None] * n, [0] * n
        for (code, t), k in self.votes.items():
            total[code] += k
            if k > top_k[code]:
                top_k[code], top_t[code], ties[code] = k, t, 1
            elif k == top_k[code]:
                ties[code] += 1
        claim: list[Optional[tuple]] = [None] * n       # (ticker, tier, votes)
        for code, c in enumerate(self.cusips.items):
            t = ftd_pairs.get(c)
            if t:
                claim[code] = (t, "sec_ftd", 0)
                continue
            if total[code]:
                k = top_k[code]
                if k / total[code] >= MIN_TICKER_SHARE and ties[code] == 1:
                    claim[code] = (top_t[code], "fund_ticker", k)
                    continue
            names = self.names.get(code)          # recorded for US/CA issues only (`_read_holdings`)
            if names:
                name = names[0] if isinstance(names, list) else max(names.items(), key=lambda kv: (kv[1], kv[0]))[0]
                hits = sec_names.get(name)
                if hits and len(hits) == 1:
                    claim[code] = (next(iter(hits)), "sec_name", 0)
        # one ticker, one security
        owner: dict[str, int] = {}
        for code, cl in enumerate(claim):
            if cl is None:
                continue
            cur = owner.get(cl[0])
            if cur is None:
                owner[cl[0]] = code
                continue
            a, b = claim[cur], cl
            ka = (-TIERS.index(a[1]), int(rows_by[cur]), float(val_by[cur]))
            kb = (-TIERS.index(b[1]), int(rows_by[code]), float(val_by[code]))
            if kb > ka:
                owner[cl[0]] = code
        ticker = [None] * n
        tier = [None] * n
        votes = [0] * n
        conflict = [False] * n
        for code, cl in enumerate(claim):
            if cl is None:
                continue
            if owner.get(cl[0]) == code:
                ticker[code], tier[code], votes[code] = cl
            else:
                conflict[code] = True
        return ticker, tier, votes, conflict

    # ── the index, partition by partition ──
    def finish(self, path: str, meta: Optional[dict] = None, ftd_pairs: Optional[dict] = None,
               sec_names: Optional[dict] = None) -> dict:
        """Write the whole index to `path` (a new file; any file there is replaced) and return what it holds:
        {stocks (a read-only view of the file), funds, coverage, pct_units, stats, data_sets, periods, bytes}.
        A partition's rows are loaded, worked out, written and let go before the next one is loaded."""
        import numpy as np
        ticker_of, tier_of, votes_of, conflict = self.match(ftd_pairs, sec_names)
        self.votes, self.names = {}, {}
        pct_units, pct_factor = self._pct_units(np.frombuffer(self._sample["rep"], dtype=np.int32).copy(),
                                                np.frombuffer(self._sample["val"], dtype=np.float32).astype(np.float64),
                                                np.frombuffer(self._sample["pct"], dtype=np.float32).astype(np.float64))
        self._sample = {}
        n_rep, i32 = len(self.reps), np.int32
        is_cur = np.zeros(n_rep, dtype=bool)
        is_prev = np.zeros(n_rep, dtype=bool)
        is_cur[list(self.cur.values())] = True
        if self.prev:
            is_prev[list(self.prev.values())] = True
        series_of = np.array([r["s"] for r in self.reps], dtype=i32) if n_rep else np.zeros(0, dtype=i32)
        tickers = sorted({t for t in ticker_of if t})
        tix = {t: i for i, t in enumerate(tickers)}
        T = len(tickers)
        tick_of_cus = np.array([tix[t] if t else -1 for t in ticker_of], dtype=i32) if ticker_of else np.zeros(0, dtype=i32)
        kind_of_cus = np.array([(2 + TIERS.index(tier_of[c])) if ticker_of[c] else (1 if conflict[c] else 0)
                                for c in range(len(ticker_of))], dtype=np.int8) if ticker_of else np.zeros(0, dtype=np.int8)
        cus_of_tick = np.full(T, -1, dtype=np.int64)
        for code, t in enumerate(ticker_of):
            if t:
                cus_of_tick[tix[t]] = code
        tier_of_tick = [tier_of[int(c)] for c in cus_of_tick]
        votes_of_tick = [votes_of[int(c)] for c in cus_of_tick]
        has_prev = np.zeros(len(self.series.items), dtype=bool)
        has_cur = np.zeros(len(self.series.items), dtype=bool)
        if self.prev:
            has_prev[list(self.prev.keys())] = True
        if self.cur:
            has_cur[list(self.cur.keys())] = True
        day_of_series = np.zeros(len(self.series.items), dtype=np.int64)
        for s, r in self.cur.items():
            day_of_series[s] = date.fromisoformat(self.reps[r]["report_date"]).toordinal()

        n_kind = 3 + len(TIERS)
        cov_rows, cov_value = np.zeros(n_kind, dtype=np.int64), np.zeros(n_kind)
        cov_rows[0], cov_value[0] = self._no_id[0], self._no_id[1]
        funds_per, sold_per = np.zeros(T, dtype=np.int64), np.zeros(T, dtype=np.int64)
        state_names = np.array(STATES, dtype=object)
        spill = _spill_dtype()
        labels = list(self.data_sets)

        for p in ("", "-journal"):
            if os.path.exists(path + p):
                os.remove(path + p)
        con = sqlite3.connect(path)
        try:
            con.executescript(_SCHEMA)
            for part in range(self.parts):
                self.tick()
                files = [self._spill_path(lab, part) for lab in labels if os.path.exists(self._spill_path(lab, part))]
                rec = np.concatenate([np.fromfile(f, dtype=spill) for f in files]) if files else np.zeros(0, dtype=spill)
                for f in files:
                    os.remove(f)
                self.stats["partition_rows"].append(int(len(rec)))
                self.stats["max_rows_held"] = max(self.stats["max_rows_held"], int(len(rec)))
                if not len(rec):
                    continue
                here, f_per, s_per = self._partition(con, rec, T, tickers, is_cur, is_prev, series_of, tick_of_cus,
                                                     kind_of_cus, cus_of_tick, has_prev, has_cur, day_of_series,
                                                     pct_factor, state_names, tier_of_tick, votes_of_tick,
                                                     cov_rows, cov_value)
                funds_per[here] += f_per
                sold_per[here] += s_per
                del rec
                con.commit()

            # the stocks: the most widely held first, bounded
            alive = np.nonzero((funds_per > 0) | (sold_per > 0))[0].tolist()
            alive.sort(key=lambda i: (-int(funds_per[i]), tickers[i]))
            dropped = [tickers[i] for i in alive[MAX_TICKERS:]]
            for table in ("stock", "holder", "sold"):
                con.executemany(f"DELETE FROM {table} WHERE sym = ?", ((t,) for t in dropped))
            used = sorted({r[0] for r in con.execute("SELECT DISTINCT fund FROM holder UNION SELECT DISTINCT fund FROM sold")})
            funds = {}
            for s in used:
                cur = self.reps[self.cur[s]]
                prev = self.reps[self.prev[s]] if s in self.prev else None
                funds[s] = {
                    "series_id": cur.get("series_id"), "name": cur.get("name"), "family": cur.get("family"),
                    "cik": cur.get("cik"), "accession": cur["acc"], "report_date": cur["report_date"],
                    "filed": cur.get("filed"), "net_assets": cur.get("net_assets"),
                    "prior_accession": prev["acc"] if prev else None,
                    "prior_report_date": prev["report_date"] if prev else None,
                    "prior_filed": prev.get("filed") if prev else None,
                }
            con.executemany("INSERT INTO fund VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
                (s, f["series_id"], f["name"], f["family"], f["cik"], f["accession"], f["report_date"], f["filed"],
                 f["net_assets"], f["prior_accession"], f["prior_report_date"], f["prior_filed"])
                for s, f in funds.items()))
            coverage = self._coverage(cov_rows, cov_value)
            coverage["stocks"] = min(len(alive), MAX_TICKERS)
            coverage["stocks_dropped"] = len(dropped)
            days = [self.reps[r]["report_date"] for r in self.cur.values()]
            periods = {"from": min(days) if days else None, "to": max(days) if days else None,
                       "funds": len(self.cur), "funds_with_previous": len(self.prev)}
            full_meta = {**(meta or {}), "version": INDEX_VERSION, "coverage": coverage, "pct_units": pct_units,
                         "periods": periods, "stats": dict(self.stats), "data_sets": dict(self.data_sets),
                         "keep_rows": KEEP_ROWS, "keep_sold": KEEP_SOLD}
            con.executemany("INSERT INTO meta VALUES (?, ?)", ((k, json.dumps(v)) for k, v in full_meta.items()))
            con.commit()
            if dropped:
                con.execute("VACUUM")             # give back the cut stocks' pages
        finally:
            con.close()
        return {"stocks": _IndexStocks(path), "funds": funds, "coverage": coverage, "pct_units": pct_units,
                "stats": dict(self.stats), "data_sets": dict(self.data_sets), "periods": periods,
                "bytes": os.path.getsize(path)}

    def _partition(self, con, rec, T, tickers, is_cur, is_prev, series_of, tick_of_cus, kind_of_cus, cus_of_tick,
                   has_prev, has_cur, day_of_series, pct_factor, state_names, tier_of_tick, votes_of_tick,
                   cov_rows, cov_value):
        """Every stock of one partition, worked out and written. Returns (the stocks present, as indices into
        `tickers`; their funds; their sold-out funds)."""
        import numpy as np
        rep, cus, bal = rec["rep"], rec["cus"], rec["bal"]
        val, pct = rec["val"], rec["pct"]
        cur_rows, prev_rows = is_cur[rep], is_prev[rep]
        n_kind = len(cov_rows)
        c_kind = kind_of_cus[cus[cur_rows]].astype(np.int64) + 1
        cov_rows += np.bincount(c_kind, minlength=n_kind)
        cov_value += np.bincount(c_kind, weights=np.nan_to_num(val[cur_rows].astype(np.float64)), minlength=n_kind)
        del c_kind

        # the current holdings, one per (stock, fund)
        c_t = tick_of_cus[cus[cur_rows]]
        m = c_t >= 0
        c_rep = rep[cur_rows][m]
        g_t, g_s, g_bal, g_val, g_pct = self._group(c_t[m], series_of[c_rep], bal[cur_rows][m],
                                                    val[cur_rows][m].astype(np.float64),
                                                    pct[cur_rows][m].astype(np.float64) * pct_factor)
        del c_t, m, c_rep
        # the previous holdings, one per (fund, security), sorted by (fund, security)
        pk_s, pk_c, p_bal, p_val = np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.int64), np.zeros(0), np.zeros(0)
        if prev_rows.any():
            p_v = val[prev_rows].astype(np.float64)
            pk_s, pk_c, p_bal, p_val, _ = self._group(series_of[rep[prev_rows]], cus[prev_rows], bal[prev_rows], p_v, p_v)
            del p_v
        del cur_rows, prev_rows

        # each current holding against the same fund's previous report
        pkey = pk_s * (1 << 32) + pk_c
        q = g_s * (1 << 32) + (cus_of_tick[g_t] if len(g_t) else np.zeros(0, dtype=np.int64))
        pos = np.minimum(np.searchsorted(pkey, q), max(len(pkey) - 1, 0)) if len(pkey) else np.zeros(len(q), dtype=np.int64)
        found = (pkey[pos] == q) if len(pkey) else np.zeros(len(q), dtype=bool)
        prior_bal = np.where(found, p_bal[pos] if len(pkey) else 0.0, np.nan)
        prior_val = np.where(found, p_val[pos] if len(pkey) else 0.0, np.nan)
        known = has_prev[g_s] if len(g_s) else np.zeros(0, dtype=bool)
        state = np.full(len(g_t), 4, dtype=np.int8)                      # no_prior
        diff = g_bal - np.nan_to_num(prior_bal)
        state[known & ~found] = 3                                        # new
        state[known & found & (diff > 0.5)] = 0                          # added
        state[known & found & (diff < -0.5)] = 1                         # cut
        state[known & found & (np.abs(diff) <= 0.5)] = 2                 # unchanged
        del pkey, q, pos, diff

        # sold out: held at the previous report, none at a current report (_group keeps (stock, fund) order)
        gkey = g_t * (1 << 32) + g_s
        p_t = tick_of_cus[pk_c].astype(np.int64) if len(pk_c) else np.zeros(0, dtype=np.int64)
        sold_mask = (p_t >= 0) & (has_cur[pk_s] if len(pk_s) else np.zeros(0, dtype=bool))
        if sold_mask.any() and len(gkey):
            sk = p_t * (1 << 32) + pk_s
            sp = np.minimum(np.searchsorted(gkey, sk), len(gkey) - 1)
            sold_mask &= gkey[sp] != sk
        sold_idx = np.nonzero(sold_mask)[0]
        sold_t = p_t[sold_idx]
        del gkey, sold_mask

        # this partition's stocks, over EVERY matched fund; arrays sized to the stocks present here, not to all
        present = np.unique(np.concatenate([g_t, sold_t])) if (len(g_t) or len(sold_t)) else np.zeros(0, dtype=np.int64)
        L = len(present)
        lg = np.searchsorted(present, g_t)                               # g_t is sorted, so lg is too
        ls = np.searchsorted(present, sold_t)
        vok = ~np.isnan(g_val)
        funds_per = np.bincount(lg, minlength=L)
        sold_per = np.bincount(ls, minlength=L)
        shares = np.bincount(lg, weights=g_bal, minlength=L)
        value = np.bincount(lg, weights=np.where(vok, g_val, 0.0), minlength=L)
        missing = np.bincount(lg, weights=(~vok).astype(np.float64), minlength=L)
        both_now = np.bincount(lg[known], weights=g_bal[known], minlength=L)
        both_prior = (np.bincount(lg[known & found], weights=prior_bal[known & found], minlength=L)
                      + np.bincount(ls, weights=p_bal[sold_idx], minlength=L))
        by_state = [np.bincount(lg[state == k], minlength=L) for k in range(len(STATES))]
        day_from = np.full(L, np.iinfo(np.int64).max, dtype=np.int64)
        day_to = np.zeros(L, dtype=np.int64)
        if len(lg):
            g_day = day_of_series[g_s]
            np.minimum.at(day_from, lg, g_day)
            np.maximum.at(day_to, lg, g_day)

        top = _top_rows(lg, g_val, g_bal, KEEP_ROWS, L)
        p_rows = np.where(found, prior_bal, np.where(known, 0.0, np.nan))
        p_vals = np.where(found, prior_val, np.where(known, 0.0, np.nan))
        top_sold = _top_rows(ls, p_val[sold_idx], p_bal[sold_idx], KEEP_SOLD, L)
        stop = sold_idx[top_sold]
        row_edges = np.searchsorted(lg[top], np.arange(L + 1))
        sold_edges = np.searchsorted(ls[top_sold], np.arange(L + 1))

        def opt(v):
            v = float(v)
            return None if v != v else v

        stock_rows, holder_rows, sold_rows = [], [], []

        def write():
            con.executemany("INSERT INTO stock VALUES (?, ?)", stock_rows)
            con.executemany("INSERT INTO holder VALUES (?,?,?,?,?,?,?,?,?)", holder_rows)
            con.executemany("INSERT INTO sold VALUES (?,?,?,?,?)", sold_rows)
            stock_rows.clear()
            holder_rows.clear()
            sold_rows.clear()

        for i in range(L):
            t = int(present[i])
            sym, funds = tickers[t], int(funds_per[i])
            summary = {
                "funds": funds, "shares": float(shares[i]), "value": float(value[i]) if funds else None,
                "value_complete": bool(missing[i] == 0),
                **{name: int(by_state[k][i]) for k, name in enumerate(STATES)},
                "sold_out": int(sold_per[i]), "both_now": float(both_now[i]), "both_prior": float(both_prior[i]),
                "period_from": date.fromordinal(int(day_from[i])).isoformat() if funds else None,
                "period_to": date.fromordinal(int(day_to[i])).isoformat() if funds else None,
                "tier": tier_of_tick[t], "votes": votes_of_tick[t] or None,
            }
            stock_rows.append((sym, json.dumps(summary, separators=(",", ":"))))
            for r, j in enumerate(top[row_edges[i]:row_edges[i + 1]].tolist()):
                holder_rows.append((sym, r, int(g_s[j]), float(g_bal[j]), opt(g_val[j]), opt(g_pct[j]),
                                    opt(p_rows[j]), opt(p_vals[j]), str(state_names[state[j]])))
            for r, j in enumerate(stop[sold_edges[i]:sold_edges[i + 1]].tolist()):
                sold_rows.append((sym, r, int(pk_s[j]), float(p_bal[j]), opt(p_val[j])))
            if len(holder_rows) >= WRITE_BATCH:
                write()
        write()
        return present, funds_per, sold_per

    @staticmethod
    def _group(a, b, bal, val, pct):
        """Sum the rows of each (a, b) pair: shares always; a value or percent only when every row of the pair has
        one (else NaN, never a partial sum)."""
        import numpy as np
        if not len(a):
            e = np.zeros(0, dtype=np.int64)
            return e, e.copy(), np.zeros(0), np.zeros(0), np.zeros(0)
        key = a.astype(np.int64) * (1 << 32) + b.astype(np.int64)
        uniq, inv = np.unique(key, return_inverse=True)
        cnt = np.bincount(inv)
        s_bal = np.bincount(inv, weights=bal)
        out = []
        for x in (val, pct):
            ok = ~np.isnan(x)
            tot = np.bincount(inv, weights=np.where(ok, x, 0.0))
            n_ok = np.bincount(inv, weights=ok.astype(np.float64))
            out.append(np.where(n_ok == cnt, tot, np.nan))
        return (uniq >> 32), (uniq & 0xFFFFFFFF), s_bal, out[0], out[1]

    @staticmethod
    def _coverage(rows, dollars) -> dict:
        """What share of the current reports' common-stock holdings was matched to a ticker, in rows and in dollars,
        by tier, and why the rest was not (`no_identifier`, `no_ticker`, `conflict`), from the counts by kind
        (0 no identifier, 1 no ticker, 2 conflict, 3.. matched, by tier)."""
        n = 3 + len(TIERS)

        def part(lo, hi=None):
            hi = lo + 1 if hi is None else hi
            return {"rows": int(rows[lo:hi].sum()), "value": float(dollars[lo:hi].sum())}

        out = {"all": part(0, n), "matched": part(3, n), "no_identifier": part(0), "no_ticker": part(1),
               "conflict": part(2), "tiers": {name: part(3 + k) for k, name in enumerate(TIERS)}}
        allv = out["all"]["value"]
        out["matched_value_pct"] = round(out["matched"]["value"] / allv * 100, 1) if allv > 0 else None
        out["matched_rows_pct"] = round(out["matched"]["rows"] / out["all"]["rows"] * 100, 1) if out["all"]["rows"] else None
        return out

    def _pct_units(self, c_rep, c_val, c_pct):
        """Whether PERCENTAGE is a percent (the form's "Percentage value") or a fraction, from the reports' own net
        assets: the median of PERCENTAGE / (value / net assets x 100) over the current rows. Returns (unit, factor):
        a percent is kept (1), a fraction is scaled (100), and an unclear unit is withheld (NaN, so None), never
        guessed."""
        import numpy as np
        if len(c_rep) < 20:
            return "assumed_percent", 1.0
        net = np.array([r["net_assets"] if isinstance(r.get("net_assets"), float) and r["net_assets"] > 0 else np.nan
                        for r in self.reps], dtype=np.float64)
        na = net[c_rep]
        ok = ~np.isnan(c_pct) & ~np.isnan(c_val) & (c_val > 0) & ~np.isnan(na) & (na > 0) & (c_pct > 0)
        if ok.sum() < 20:
            return "assumed_percent", 1.0
        ratio = float(np.median(c_pct[ok] / (c_val[ok] / na[ok] * 100.0)))
        if 0.5 <= ratio <= 2.0:
            return "percent", 1.0
        if 0.005 <= ratio <= 0.02:
            return "fraction", 100.0
        return "unclear", float("nan")


def _top_rows(t_arr, first, second, limit: int, n_stocks: int):
    """Indices of each stock's first `limit` rows, by `first` highest (a missing one last) then `second` highest,
    ordered by stock and then by that rank."""
    import numpy as np
    if not len(t_arr):
        return np.zeros(0, dtype=np.int64)
    order = np.lexsort((-second, -np.nan_to_num(first, nan=-1.0), t_arr))
    ts = t_arr[order]
    rank = np.arange(len(ts)) - np.searchsorted(ts, np.arange(n_stocks))[ts]
    return order[rank < limit]


class _IndexStocks(Mapping):
    """The stocks of a written index file, {ticker: {summary, holders, sold}}, read from the file one stock at a time
    (for the tests and any reader that wants the build's own shape; the request path reads the file itself)."""

    def __init__(self, path: str):
        self._path = path

    def _con(self):
        return sqlite3.connect(f"file:{self._path}?mode=ro", uri=True, timeout=2.0)

    def __iter__(self):
        con = self._con()
        try:
            syms = [r[0] for r in con.execute("SELECT sym FROM stock ORDER BY sym")]
        finally:
            con.close()
        return iter(syms)

    def __len__(self):
        con = self._con()
        try:
            return int(con.execute("SELECT COUNT(*) FROM stock").fetchone()[0])
        finally:
            con.close()

    def __getitem__(self, sym: str) -> dict:
        con = self._con()
        try:
            row = con.execute("SELECT summary FROM stock WHERE sym = ?", (sym,)).fetchone()
            if row is None:
                raise KeyError(sym)
            holders = [{"fund": f, "shares": sh, "value": v, "pct": pc, "prior_shares": ps, "prior_value": pv,
                        "state": st} for f, sh, v, pc, ps, pv, st in con.execute(
                "SELECT fund, shares, value, pct, prior_shares, prior_value, state FROM holder WHERE sym = ? ORDER BY rank",
                (sym,))]
            sold = [{"fund": f, "prior_shares": ps, "prior_value": pv} for f, ps, pv in con.execute(
                "SELECT fund, prior_shares, prior_value FROM sold WHERE sym = ? ORDER BY rank", (sym,))]
        finally:
            con.close()
        return {"summary": json.loads(row[0]), "holders": holders, "sold": sold}


# ── the index on disk ────────────────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE fund (id INTEGER PRIMARY KEY, series_id TEXT, name TEXT, family TEXT, cik TEXT, accession TEXT,
  report_date TEXT, filed TEXT, net_assets REAL, prior_accession TEXT, prior_report_date TEXT, prior_filed TEXT);
CREATE TABLE stock (sym TEXT PRIMARY KEY, summary TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE holder (sym TEXT NOT NULL, rank INTEGER NOT NULL, fund INTEGER NOT NULL, shares REAL NOT NULL,
  value REAL, pct REAL, prior_shares REAL, prior_value REAL, state TEXT NOT NULL, PRIMARY KEY (sym, rank)) WITHOUT ROWID;
CREATE TABLE sold (sym TEXT NOT NULL, rank INTEGER NOT NULL, fund INTEGER NOT NULL, prior_shares REAL NOT NULL,
  prior_value REAL, PRIMARY KEY (sym, rank)) WITHOUT ROWID;
"""


def built_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
