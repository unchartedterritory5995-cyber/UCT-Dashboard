"""INS CLUSTER, the Terminal's insider cluster buys, read from the SEC's own Form 4 filings: a
stock in which several insiders bought shares with their own money within a few days.

WHY. The site's only cluster list (`api/services/insider_clusters.py`) scrapes a third-party
website with no agreement on record. Form 4 filings are public-domain SEC data (licensing register
T-83, T-99). This module builds the list from the filings themselves; it does NOT replace or change
that scraper or its callers (removing a source is the owner's call).

WHAT IS READ (sec.gov only, every request through `edgar_ownership._sec_get`, the site's one SEC
transport: the declared SEC_USER_AGENT, ONE process-wide limiter of 5 requests a second by default
and never more than 9, bounded backoff, a 404 never retried):

  https://www.sec.gov/Archives/edgar/daily-index/YYYY/QTRn/master.YYYYMMDD.idx
      EDGAR's daily master index of one filing day: a short preamble, the header
      `CIK|Company Name|Form Type|Date Filed|File Name`, a dashed line, then one pipe-delimited row
      per filing PER PARTY. A Form 4 is listed once for the issuer and once for every reporting
      owner, under the same accession number, so rows are de-duplicated by accession. Only form
      type `4` is read: a `4/A` amendment restates a filing already read and would count the same
      purchase twice.
  https://www.sec.gov/Archives/edgar/data/<cik>/<accession>.txt
      one Form 4's complete submission text file, the index's own File Name column. The
      <DOCUMENT> whose <TYPE> is 4 carries the ownership XML between <XML> and </XML>. One request
      per filing (the filing index and then the XML would be two).

The shapes are as the SEC's "Accessing EDGAR Data" page describes them (the daily-index directory,
the five fields, the master index "sorted by CIK number") and as one daily index file and one
Form 4 submission gave them on 2026-11-21. Every test document is invented in that structure.

WHEN. That page: "Indexes incorporating the current business day's filings are updated nightly
starting about 10:00 p.m., ET; the process is usually completed within a few hours", and a Form 4
submitted after 10:00 p.m. is disseminated the next business day, in that day's index. So the
read runs at `RUN_AT_ET` (01:20 New York time) Tuesday to Saturday, the night after each weekday,
and reads the weekdays BEFORE that date. It is registered in `api/main.py`; nothing else starts it.

WHAT EACH RUN DOES (one at a time, on its own thread, never on a member's request):
  * reads the index of each of the last `SCAN_WEEKDAYS` weekdays, newest first (12 weekdays hold
    10 business days even across two federal holidays; a holiday has no index, a 404, said as
    `no_index`). Every index in that window is read again each night, so a filing that reached an
    index after the last read, or a filing that failed, is picked up the next night. The FIRST run
    is the backfill: nothing is held, so every Form 4 of those days is read, within the same caps;
  * reads each listed Form 4 not read yet, newest day first, and keeps only OPEN-MARKET PURCHASES:
    transaction code P with the acquired code A, the rule `edgar_ownership.classify_form4_txn`
    applies (non-derivative transactions only, `edgar_ownership.parse_form4`);
  * stops at `MAX_FILINGS_PER_RUN` documents or `RUN_BUDGET_S` of wall clock, whichever comes first.
    PAST THE CAP nothing is lost: the filings not read stay listed for their day as not read, the
    day says `partial` with its counts, the answer says the read is incomplete, and the next night
    reads them (a filing day is re-read for `SCAN_WEEKDAYS` weekdays, about two and a half weeks);
  * stops at once when the SEC refuses (403) or says too many requests (429) after the client's own
    retry, or after `STOP_AFTER_FAILURES` failed reads in a row: the rest waits for the next night.
    A filing that failed `MAX_TRIES` nights is given up and counted as such.
REQUESTS PER NIGHT: at most `SCAN_WEEKDAYS` index reads plus `MAX_FILINGS_PER_RUN` documents
(12 + 15,000), each of which the client may retry once on a 403 / 429 / 5xx, at no more than the
client's rate (5 a second by default: the cap alone is 50 minutes, so the hour's budget ends a run
first only when the SEC is slow). A normal night is one new filing day: about 600 to 3,000 Form 4s.

WHAT IS KEPT (in this module AND on disk under the data directory, last good kept, so a restart
does not start cold): per filing with a purchase, the issuer's CIK, ticker and name, each reporting
owner's name and roles, each purchase's date, shares and price, and the filing's totals; per filing
day, how many Form 4s it listed and how many were read. `KEEP_DAYS` calendar days are kept.

A CLUSTER (`find_clusters`): an issuer with `CLUSTER_MIN_INSIDERS` or more DISTINCT insiders whose
open-market purchases fall within `CLUSTER_WINDOW_DAYS` business days (NYSE sessions,
`session_calendar`), first buy to last inclusive. Reporting owners who ever file TOGETHER (a fund
and its general partner on one Form 4) are one insider, so a joint filing never makes a cluster on
its own. For each issuer the newest such window counts. Newest last buy first, at most
`MAX_CLUSTERS`, cut from the oldest end and said. The latest close is the bar store's own newest
daily close (`local_bars.read_bars`, a local read, never a vendor call), read when the list is
built, with its date; a close older than `CLOSE_MAX_AGE_DAYS` before the newest filing day is not
used. A price the filer did not state is None and never 0: the total value then covers only the
purchases with a price, and says so.
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

_log = logging.getLogger(__name__)

SOURCE = "SEC Form 4 filings (open-market purchases)"
VENDOR = "sec_edgar"
INDEX_URL = "https://www.sec.gov/Archives/edgar/daily-index/{year}/QTR{quarter}/master.{ymd}.idx"
ARCHIVES_URL = "https://www.sec.gov/Archives/"

# ── the cluster rule (the builder's defaults, not owner rulings) ─────────────────────────────
CLUSTER_MIN_INSIDERS = 3      # distinct insiders (joint filers are one)
CLUSTER_WINDOW_DAYS = 10      # business days (NYSE sessions), first buy to last buy inclusive
MAX_CLUSTERS = 50             # clusters in the answer, newest last buy first
CLOSE_MAX_AGE_DAYS = 7        # a held close older than this (before the newest filing day) is not used

# ── the store and the nightly read (the builder's defaults) ──────────────────────────────────
KEEP_DAYS = 30                # calendar days of filing days kept
SCAN_WEEKDAYS = 12            # weekdays whose index each run reads
MAX_FILINGS_PER_RUN = 15_000  # Form 4 documents one run may read
RUN_BUDGET_S = 3600.0         # wall clock one run may take
MAX_TRIES = 3                 # nights a failing filing is tried before it is given up
STOP_AFTER_FAILURES = 10      # failed reads in a row that end the run
MAX_DOC_BYTES = 3_000_000     # a Form 4 submission is a few kB; past this it is not read
MAX_INDEX_BYTES = 30_000_000  # a daily master index is a few hundred kB
RUN_AT_ET = (1, 20)           # Tuesday to Saturday, New York time
DISK_VERSION = 1

ROLE_ORDER = ("ceo", "cfo", "officer", "director", "ten_percent", "other", "not_stated")
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ACCESSION = re.compile(r"^\d{10}-\d{2}-\d{6}$")
_INDEX_PATH = re.compile(r"^edgar/data/(\d{1,10})/(\d{10}-\d{2}-\d{6})\.txt$")
_CEO = re.compile(r"\bC\.?E\.?O\b|CHIEF\s+EXECUTIVE", re.I)
_CFO = re.compile(r"\bC\.?F\.?O\b|CHIEF\s+FINANCIAL", re.I)
_DOCUMENT = re.compile(rb"<DOCUMENT>(.*?)</DOCUMENT>", re.S | re.I)
_DOC_TYPE = re.compile(rb"<TYPE>[ \t]*([^\r\n<]+)", re.I)
_XML_BLOCK = re.compile(rb"<XML>(.*?)</XML>", re.S | re.I)
#: what a filer types where a trading symbol belongs when the issuer has none (its letters only:
#: "N/A" and "n.a." are "NA")
_NO_SYMBOL = frozenset({"NONE", "NA", "NULL", "NIL", "NO", "TBD", "UNKNOWN", "OTC", "PRIVATE"})


class IndexShape(Exception):
    """The body is not EDGAR's daily master index. `why` is plain words for the log."""

    def __init__(self, why: str):
        super().__init__(why)
        self.why = why


class _Stop(Exception):
    """End this run now: the SEC refused, rate-limited, or kept failing. The rest waits."""

    def __init__(self, reason: str, http_status: Optional[int] = None):
        super().__init__(reason)
        self.reason = reason
        self.http_status = http_status


# ── the readers (each one small, so a test can stand in for it) ──────────────────────────────

def _sec_get(url: str) -> bytes:
    """ONE request through the site's SEC transport (`edgar_ownership._sec_get`: the declared user
    agent, the process-wide limiter). Raises its `SecError`. Tests replace this by name."""
    from api.services import edgar_ownership
    return edgar_ownership._sec_get(url)


def _sec_error_type():
    from api.services.fundamentals_pit.sec_client import SecError
    return SecError


def _latest_close(ticker: str) -> Optional[tuple[float, str]]:
    """(close, YYYY-MM-DD) of the bar store's newest daily bar for `ticker`, or None. A LOCAL read
    of what the site already holds (`local_bars.read_bars`): never a vendor call."""
    from api.services import local_bars
    rows = local_bars.read_bars(ticker, local_bars.DAILY_TF, 1) or []
    if not rows:
        return None
    bar = rows[-1]
    close, stamp = bar.get("c"), str(bar.get("t") or "")
    if not isinstance(close, (int, float)) or isinstance(close, bool) or close <= 0 or not re.fullmatch(r"\d{8}", stamp):
        return None
    return float(close), f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:]}"


def now_et() -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _data_dir() -> Optional[str]:
    base = os.environ.get("DATA_DIR", "/data")
    return base if os.path.isdir(base) else None


def _disk_path() -> Optional[str]:
    base = _data_dir()
    return os.path.join(base, "insider_clusters_sec", f"store_v{DISK_VERSION}.json") if base else None


def _is_trading_day(d: date) -> bool:
    from api.services import session_calendar
    return session_calendar.is_trading_day(d)


# ── pure helpers ─────────────────────────────────────────────────────────────────────────────

def _iso(v: Any) -> Optional[str]:
    s = v.strip()[:10] if isinstance(v, str) else ""
    if not _ISO_DAY.match(s):
        return None
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


def index_url(day: date) -> str:
    return INDEX_URL.format(year=day.year, quarter=(day.month - 1) // 3 + 1, ymd=day.strftime("%Y%m%d"))


def scan_days(today: date) -> list[date]:
    """The weekdays whose index a run reads: the last `SCAN_WEEKDAYS` before `today`, newest first."""
    out, d = [], today - timedelta(days=1)
    while len(out) < SCAN_WEEKDAYS:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return out


def parse_master_index(body: bytes) -> list[dict]:
    """The Form 4s of one daily master index: `[{accession, cik, path}]`, one per accession (the
    first party's row), in accession order. Raises `IndexShape` when the body is not the index."""
    if len(body) > MAX_INDEX_BYTES:
        raise IndexShape("an answer larger than the index ever is")
    text = body.decode("latin-1")
    head = text[:400].lstrip().lower()
    if head.startswith(("<!doctype html", "<html")):
        raise IndexShape("a web page where the index was expected")
    lines = text.splitlines()
    try:
        header = next(i for i, ln in enumerate(lines) if ln.strip().upper().startswith("CIK|COMPANY NAME|FORM TYPE|"))
    except StopIteration:
        raise IndexShape("no `CIK|Company Name|Form Type|Date Filed|File Name` header") from None
    if header + 1 >= len(lines) or not lines[header + 1].startswith("---"):
        raise IndexShape("no dashed line under the header")
    seen: dict[str, dict] = {}
    for ln in lines[header + 2:]:
        parts = ln.split("|")
        if len(parts) != 5 or parts[2].strip() != "4":
            continue
        m = _INDEX_PATH.match(parts[4].strip())
        if not m or m.group(2) in seen:
            continue
        seen[m.group(2)] = {"accession": m.group(2), "cik": m.group(1), "path": m.group(0)}
    return [seen[a] for a in sorted(seen)]


def form4_xml(body: bytes) -> bytes:
    """The ownership XML of the Form 4 document in one complete submission text file. Raises
    `edgar_ownership.ParseError` when there is none, when it is too large, or when it carries a
    document type declaration (never parsed, so no entity is ever expanded)."""
    from api.services.edgar_ownership import ParseError
    if len(body) > MAX_DOC_BYTES:
        raise ParseError("a submission larger than a Form 4 ever is")
    for doc in _DOCUMENT.findall(body):
        kind = _DOC_TYPE.search(doc)
        if not kind or kind.group(1).strip().upper() != b"4":
            continue
        block = _XML_BLOCK.search(doc)
        if not block:
            raise ParseError("the Form 4 document has no XML")
        xml = block.group(1).strip()
        upper = xml.upper()
        if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
            raise ParseError("a document type declaration; not parsed")
        return xml
    raise ParseError("no document of type 4 in the submission")


def norm_ticker(raw: Any) -> Optional[str]:
    """The issuer's trading symbol as the filer typed it, in the site's one spelling (`BRK-B`), or
    None ("NONE", "N/A", an exchange word alone, anything that is not a ticker). `NYSE: ABC` and
    `ABC, ABCW` read as `ABC`."""
    from api.services.ticker_resolver import route_symbol
    s = raw.strip().upper() if isinstance(raw, str) else ""
    if ":" in s:
        s = s.rsplit(":", 1)[1].strip()
    letters = re.sub(r"[^A-Z]", "", s)
    if not letters or letters in _NO_SYMBOL:              # "N/A", "n.a.", "None", "-"
        return None
    s = re.split(r"[,;\s]+", s)[0]
    sym = route_symbol(s)
    if not sym or not sym[0].isalpha() or len(sym.split("-")[0]) > 6:
        return None
    return sym


def owner_roles(owner: dict) -> list[str]:
    """The roles a Form 4 declares for one reporting owner, from ROLE_ORDER: an officer whose title
    names the chief executive is `ceo`, the chief financial officer `cfo`, any other officer
    `officer`; then `director`, `ten_percent` (a 10% owner), `other`; `not_stated` when none."""
    roles: list[str] = []
    if owner.get("is_officer"):
        title = owner.get("officer_title") or ""
        if _CEO.search(title):
            roles.append("ceo")
        if _CFO.search(title):
            roles.append("cfo")
        if not roles:
            roles.append("officer")
    for flag, role in (("is_director", "director"), ("is_ten_percent", "ten_percent"), ("is_other", "other")):
        if owner.get(flag):
            roles.append(role)
    return roles or ["not_stated"]


def primary_role(roles) -> str:
    """The first of ROLE_ORDER among `roles` (a CEO who is also a director reads as CEO)."""
    have = set(roles or ())
    return next((r for r in ROLE_ORDER if r in have), "not_stated")


def _totals(txns: list[dict]) -> dict:
    """Shares, the dollars of the purchases that state a price, the weighted average price, and how
    many purchases gave no price. A price the filer did not state is never 0."""
    shares = sum(t["shares"] for t in txns)
    priced = [t for t in txns if t.get("price") is not None]
    priced_shares = sum(t["shares"] for t in priced)
    value = sum(t["shares"] * t["price"] for t in priced) if priced else None
    return {
        "shares": shares,
        "value": round(value, 2) if value is not None else None,
        "avg_price": round(value / priced_shares, 4) if priced and priced_shares > 0 else None,
        "unpriced": len(txns) - len(priced),
    }


def purchase_record(doc: dict, *, filed: str) -> Optional[dict]:
    """One parsed Form 4 (`edgar_ownership.parse_form4`) -> the record kept for it, or None when it
    has no open-market purchase. A purchase needs its date and a positive share count; a price of 0
    or none is None."""
    from api.services.edgar_ownership import classify_form4_txn, filing_index_url
    issuer = doc.get("issuer") or {}
    cik = re.sub(r"\D", "", str(issuer.get("cik") or ""))
    if not cik:
        return None
    cik = cik.zfill(10)
    txns = []
    for t in doc.get("transactions") or []:
        if classify_form4_txn(t) != "buy":
            continue
        shares, price, day = t.get("shares"), t.get("price"), _iso(t.get("date"))
        if not day or not isinstance(shares, (int, float)) or shares <= 0:
            continue
        if not isinstance(price, (int, float)) or price <= 0:
            price = None
        txns.append({"date": day, "shares": float(shares), "price": float(price) if price is not None else None})
    if not txns:
        return None
    owners = []
    for o in doc.get("owners") or []:
        if not (o.get("name") or o.get("cik")):
            continue
        owners.append({
            "cik": re.sub(r"\D", "", str(o.get("cik") or "")).zfill(10) if o.get("cik") else None,
            "name": (o.get("name") or "").strip() or None,
            "roles": owner_roles(o),
            "title": (o.get("officer_title") or "").strip() or None,
        })
    if not owners:
        owners = [{"cik": None, "name": None, "roles": ["not_stated"], "title": None}]
    dates = sorted(t["date"] for t in txns)
    return {
        "accession": doc["accession"],
        "filed": filed,
        "issuer_cik": cik,
        "ticker": norm_ticker(issuer.get("symbol")),
        "company": (issuer.get("name") or "").strip() or None,
        "owners": owners,
        "txns": txns,
        "first_date": dates[0],
        "date": dates[-1],
        **_totals(txns),
        "url": filing_index_url(cik, doc["accession"]),
    }


def _owner_key(o: dict) -> str:
    return f"cik:{o['cik']}" if o.get("cik") else f"name:{(o.get('name') or '').upper()}"


class _Groups:
    """Union-find over reporting owners: owners named on one filing are one insider."""

    def __init__(self):
        self.parent: dict[str, str] = {}

    def find(self, k: str) -> str:
        self.parent.setdefault(k, k)
        while self.parent[k] != k:
            self.parent[k] = self.parent[self.parent[k]]
            k = self.parent[k]
        return k

    def union(self, keys: list[str]) -> None:
        roots = [self.find(k) for k in keys]
        for r in roots[1:]:
            self.parent[r] = roots[0]


def _session_positions(first: date, last: date, is_trading_day: Callable[[date], bool]) -> dict[str, int]:
    """{day: how many NYSE sessions fall on or before it, from `first`} for every day in the range."""
    out, n, d = {}, 0, first
    while d <= last:
        if is_trading_day(d):
            n += 1
        out[d.isoformat()] = n
        d += timedelta(days=1)
    return out


def find_clusters(records: list[dict], *, newest_day: str,
                  is_trading_day: Optional[Callable[[date], bool]] = None) -> list[dict]:
    """Pure: every issuer's newest cluster (see the module docstring), newest last buy first. A
    purchase dated after its filing day, or more than `KEEP_DAYS` before the newest filing day, is
    not counted (a late filing of an old purchase is not a cluster today)."""
    is_trading_day = is_trading_day or _is_trading_day
    floor = (date.fromisoformat(newest_day) - timedelta(days=KEEP_DAYS)).isoformat()
    by_issuer: dict[str, list[tuple[dict, dict]]] = {}
    for rec in records:
        for t in rec["txns"]:
            if floor <= t["date"] <= rec["filed"]:
                by_issuer.setdefault(rec["issuer_cik"], []).append((t, rec))
    if not by_issuer:
        return []
    days = [t["date"] for items in by_issuer.values() for t, _ in items]
    pos = _session_positions(date.fromisoformat(min(days)), date.fromisoformat(max(days)), is_trading_day)
    out = []
    for cik, items in by_issuer.items():
        groups = _Groups()
        for _t, rec in items:
            groups.union([_owner_key(o) for o in rec["owners"]])
        group_of = lambda rec: groups.find(_owner_key(rec["owners"][0]))  # noqa: E731
        for end in sorted({t["date"] for t, _ in items}, reverse=True):
            window = [(t, rec) for t, rec in items
                      if t["date"] <= end and pos[end] - pos[t["date"]] < CLUSTER_WINDOW_DAYS]
            if len({group_of(rec) for _t, rec in window}) >= CLUSTER_MIN_INSIDERS:
                out.append(_cluster(cik, window, group_of))
                break
    out.sort(key=lambda c: (c["last_buy"], c["insiders"], c["value"] or 0.0), reverse=True)
    return out


def _cluster(cik: str, window: list[tuple[dict, dict]], group_of) -> dict:
    recs = {rec["accession"]: rec for _t, rec in window}
    newest = max(recs.values(), key=lambda r: (r["filed"], r["accession"]))
    by_filed = sorted(recs.values(), key=lambda r: (r["filed"], r["accession"]), reverse=True)
    ticker = next((r["ticker"] for r in by_filed if r.get("ticker")), None)
    company = next((r["company"] for r in by_filed if r.get("company")), None)
    people: dict[str, dict] = {}
    for t, rec in window:
        g = people.setdefault(group_of(rec), {"names": [], "roles": set(), "title": None, "txns": [], "last_buy": ""})
        for o in rec["owners"]:
            if o.get("name") and o["name"] not in g["names"]:
                g["names"].append(o["name"])
            g["roles"].update(o["roles"])
            if o.get("title") and not g["title"]:
                g["title"] = o["title"]
        g["txns"].append(t)
        g["last_buy"] = max(g["last_buy"], t["date"])
    insiders = []
    for g in people.values():
        role = primary_role(g["roles"])
        tot = _totals(g["txns"])
        insiders.append({"names": g["names"] or ["Name not given"], "role": role,
                         "roles": [r for r in ROLE_ORDER if r in g["roles"]], "title": g["title"],
                         "last_buy": g["last_buy"], "shares": tot["shares"], "value": tot["value"],
                         "avg_price": tot["avg_price"]})
    insiders.sort(key=lambda p: (ROLE_ORDER.index(p["role"]), -(p["value"] or 0.0)))
    roles = {r: 0 for r in ROLE_ORDER}
    for p in insiders:
        roles[p["role"]] += 1
    txns = [t for t, _rec in window]
    tot = _totals(txns)
    return {
        "issuer_cik": cik,
        "ticker": ticker,
        "company": company,
        "insiders": len(insiders),
        "roles": roles,
        "people": insiders,
        "first_buy": min(t["date"] for t in txns),
        "last_buy": max(t["date"] for t in txns),
        "buys": len(txns),
        "filings": len(recs),
        "last_filed": newest["filed"],
        "shares": tot["shares"],
        "value": tot["value"],
        "value_complete": tot["unpriced"] == 0,
        "unpriced_buys": tot["unpriced"],
        "avg_price": tot["avg_price"],
        "url": newest["url"],
    }


def attach_closes(clusters: list[dict], newest_day: str, read_close: Callable[[str], Optional[tuple]]) -> None:
    """Each cluster's `close` ({value, date, reason}) and `change_pct` since the average buy price,
    from the bar store's held daily close. Never 0 for a close it does not have."""
    floor = (date.fromisoformat(newest_day) - timedelta(days=CLOSE_MAX_AGE_DAYS)).isoformat()
    for c in clusters:
        c["change_pct"] = None
        if not c.get("ticker"):
            c["close"] = {"value": None, "date": None, "reason": "no_ticker"}
            continue
        try:
            got = read_close(c["ticker"])
        except Exception:  # noqa: BLE001 -- a store that cannot be read is "not held", never a number
            got = None
        if not got:
            c["close"] = {"value": None, "date": None, "reason": "not_held"}
            continue
        value, day = got
        if day < floor:
            c["close"] = {"value": None, "date": day, "reason": "stale"}
            continue
        c["close"] = {"value": round(value, 4), "date": day, "reason": None}
        if c.get("avg_price"):
            c["change_pct"] = round((value / c["avg_price"] - 1.0) * 100.0, 2)


# ── the day ledger ───────────────────────────────────────────────────────────────────────────

def _new_day() -> dict:
    return {"state": "unread", "listed": None, "read": 0, "unreadable": 0, "given_up": 0, "purchases": 0,
            "index_read_at": None, "index_error": None, "seen": {}}


def _recount(day: dict, buys: dict, iso: str) -> None:
    """A day's counts from its `seen` ledger: 1 read, 2 read but not a Form 4 the parser takes,
    -n failed n nights. `state` is `complete` when every listed filing is read or given up."""
    seen = day.get("seen")
    if seen is not None and day.get("listed") is not None:
        day["read"] = sum(1 for v in seen.values() if v > 0)
        day["unreadable"] = sum(1 for v in seen.values() if v == 2)
        day["given_up"] = sum(1 for v in seen.values() if v <= -MAX_TRIES)
        day["state"] = "complete" if day["read"] + day["given_up"] >= day["listed"] else "partial"
    day["purchases"] = sum(1 for b in buys.values() if b["filed"] == iso)


def _empty_store() -> dict:
    return {"v": DISK_VERSION, "days": {}, "buys": {}}


def build(store: dict, *, now: datetime,
          checkpoint: Optional[Callable[[dict], None]] = None) -> tuple[dict, dict]:
    """The night's read on the CALLING thread: (the store, a summary). `store` is changed in place.
    `checkpoint(store)` is called after each filing day, so a restart keeps what was read."""
    SecError = _sec_error_type()
    from api.services.edgar_ownership import ParseError, parse_form4
    started = time.monotonic()
    today = now.date()
    days, buys = store["days"], store["buys"]
    window = scan_days(today)
    for day in window:                       # a day the run does not reach still says "not read yet"
        days.setdefault(day.isoformat(), _new_day())
    summary = {"index_reads": 0, "documents": 0, "purchases_new": 0, "failed_reads": 0, "stop": None,
               "http_status": None, "days": len(window)}
    in_row = 0

    def stop_if(exc_status: Optional[int]) -> None:
        if exc_status == 403:
            raise _Stop("refused", 403)
        if exc_status == 429:
            raise _Stop("rate_limited", 429)
        if in_row >= STOP_AFTER_FAILURES:
            raise _Stop("failures", exc_status)

    try:
        for day in window:
            iso = day.isoformat()
            rec = days.setdefault(iso, _new_day())
            rec.setdefault("seen", {})
            if time.monotonic() - started > RUN_BUDGET_S:
                raise _Stop("time")
            summary["index_reads"] += 1
            try:
                listed = parse_master_index(_sec_get(index_url(day)))
            except SecError as exc:
                if exc.status == 404:
                    if rec.get("listed") is None:
                        rec["state"] = "no_index"
                    rec["index_error"] = "no_index"
                    continue
                in_row += 1
                summary["failed_reads"] += 1
                rec["index_error"] = f"sec_{exc.status or 'error'}"
                if rec.get("listed") is None:
                    rec["state"] = "failed"
                stop_if(exc.status)
                continue
            except IndexShape as shape:
                summary["failed_reads"] += 1
                rec["index_error"] = "shape"
                if rec.get("listed") is None:
                    rec["state"] = "failed"
                _log.warning("[insider-clusters] index %s is not the master index (%s)", iso, shape.why)
                continue
            except Exception as exc:  # noqa: BLE001 -- a transport error the client did not wrap
                in_row += 1
                summary["failed_reads"] += 1
                rec["index_error"] = type(exc).__name__
                if rec.get("listed") is None:
                    rec["state"] = "failed"
                stop_if(None)
                continue
            in_row = 0
            rec["listed"], rec["index_read_at"], rec["index_error"] = len(listed), _now_iso(), None
            seen = rec["seen"]
            try:
                for item in listed:
                    acc = item["accession"]
                    state = seen.get(acc)
                    if state is not None and (state > 0 or state <= -MAX_TRIES):
                        continue
                    if summary["documents"] >= MAX_FILINGS_PER_RUN:
                        raise _Stop("cap")
                    if time.monotonic() - started > RUN_BUDGET_S:
                        raise _Stop("time")
                    summary["documents"] += 1
                    try:
                        body = _sec_get(ARCHIVES_URL + item["path"])
                    except Exception as exc:  # noqa: BLE001 -- SecError, or a transport error it did not wrap
                        seen[acc] = (state if state is not None and state < 0 else 0) - 1
                        in_row += 1
                        summary["failed_reads"] += 1
                        stop_if(exc.status if isinstance(exc, SecError) else None)
                        continue
                    in_row = 0
                    try:
                        doc = parse_form4(form4_xml(body), accession=acc, filing_date=iso)
                    except ParseError:
                        seen[acc] = 2
                        continue
                    seen[acc] = 1
                    got = purchase_record(doc, filed=iso)
                    if got is not None:
                        buys[acc] = got
                        summary["purchases_new"] += 1
            finally:
                _recount(rec, buys, iso)
                if checkpoint is not None:
                    checkpoint(store)
    except _Stop as stop:
        summary["stop"], summary["http_status"] = stop.reason, stop.http_status

    # keep KEEP_DAYS of filing days; a day out of the scan window is final, so its ledger goes
    floor = (today - timedelta(days=KEEP_DAYS)).isoformat()
    in_window = {d.isoformat() for d in window}
    for iso in [d for d in days if d < floor]:
        del days[iso]
    for acc in [a for a, b in buys.items() if b["filed"] < floor]:
        del buys[acc]
    for iso, rec in days.items():
        _recount(rec, buys, iso)
        if iso not in in_window:
            rec.pop("seen", None)
    summary["elapsed_s"] = round(time.monotonic() - started, 1)
    return store, summary


def coverage(store: dict, today: date) -> dict:
    """What the store holds, in words the panel can say: the filing days read, newest first, and
    whether every Form 4 of the scan window's days was read."""
    window = {d.isoformat() for d in scan_days(today)}
    rows = []
    listed = read = given_up = 0
    complete = True
    for iso in sorted(store["days"], reverse=True):
        rec = store["days"][iso]
        rows.append({k: rec.get(k) for k in ("state", "listed", "read", "unreadable", "given_up", "purchases")} | {"date": iso})
        if iso in window:
            if rec.get("state") in ("partial", "failed", "unread"):
                complete = False
            if rec.get("listed") is not None:
                listed += rec["listed"]
                read += rec.get("read") or 0
                given_up += rec.get("given_up") or 0
    read_days = [r["date"] for r in rows if r["state"] in ("complete", "partial")]
    return {
        "days": rows,
        "window_weekdays": SCAN_WEEKDAYS,
        "complete": complete,
        "listed": listed,
        "read": read,
        "given_up": given_up,
        "from": read_days[-1] if read_days else None,
        "to": read_days[0] if read_days else None,
    }


RULES = {
    "min_insiders": CLUSTER_MIN_INSIDERS,
    "window_business_days": CLUSTER_WINDOW_DAYS,
    "transaction": "P (open-market purchase), acquired",
    "form": "4",
    "keep_days": KEEP_DAYS,
    "max_clusters": MAX_CLUSTERS,
}


def assemble(store: dict, *, today: date, read_close: Optional[Callable] = None,
             summary: Optional[dict] = None) -> dict:
    """The held answer from the store: clusters (bounded), coverage, the rule, the as-of."""
    cov = coverage(store, today)
    newest = cov["to"]
    clusters = find_clusters(list(store["buys"].values()), newest_day=newest) if newest else []
    shown = clusters[:MAX_CLUSTERS]
    if newest:
        attach_closes(shown, newest, read_close or _latest_close)
    stop = (summary or {}).get("stop")
    return {
        "v": DISK_VERSION,
        "as_of": newest,
        "read_at": _now_iso(),
        "source": SOURCE,
        "rules": dict(RULES),
        "clusters": shown,
        "total": len(clusters),
        "truncated": len(clusters) > MAX_CLUSTERS,
        "cut_from": "oldest" if len(clusters) > MAX_CLUSTERS else None,
        "coverage": cov,
        "last_run": {"stop": stop, "http_status": (summary or {}).get("http_status"),
                     "documents": (summary or {}).get("documents"), "at": _now_iso()} if summary else None,
    }


# ── one build at a time, held here and on disk ───────────────────────────────────────────────

_lock = threading.Lock()
_state: dict[str, Any] = {"held": None, "store": None, "loaded": False, "inflight": None}


def _save_disk(store: dict, held: Optional[dict]) -> None:
    path = _disk_path()
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".store_", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"store": store, "held": held}, fh, separators=(",", ":"))
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:  # noqa: BLE001 -- the answer is still held in memory
        _log.warning("[insider-clusters] the store could not be written to disk (%s)", type(exc).__name__)


def _load_disk() -> tuple[Optional[dict], Optional[dict]]:
    path = _disk_path()
    if not path:
        return None, None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None, None
    store = doc.get("store") if isinstance(doc, dict) else None
    held = doc.get("held") if isinstance(doc, dict) else None
    if (not isinstance(store, dict) or store.get("v") != DISK_VERSION or not isinstance(store.get("days"), dict)
            or not isinstance(store.get("buys"), dict)):
        return None, None
    if not isinstance(held, dict) or held.get("v") != DISK_VERSION or not isinstance(held.get("clusters"), list):
        held = None
    return store, held


def _ensure_loaded() -> None:
    with _lock:
        if _state["loaded"]:
            return
    store, held = _load_disk()
    with _lock:
        if not _state["loaded"]:
            _state["loaded"] = True
            if _state["store"] is None and store is not None:
                _state["store"], _state["held"] = store, held


def _run(done: threading.Event, now: Optional[datetime]) -> None:
    started = time.time()
    try:
        _ensure_loaded()
        with _lock:
            store = json.loads(json.dumps(_state["store"])) if _state["store"] is not None else _empty_store()
        when = now or now_et()
        store, summary = build(store, now=when, checkpoint=lambda s: _save_disk(s, _state["held"]))
        held = assemble(store, today=when.date(), summary=summary)
        with _lock:
            _state["store"], _state["held"] = store, held
        _save_disk(store, held)
        cov = held["coverage"]
        _log.info("[insider-clusters] index=%d documents=%d purchases_new=%d failed=%d stop=%s clusters=%d "
                  "latest=%s read=%d/%d %.1fs", summary["index_reads"], summary["documents"],
                  summary["purchases_new"], summary["failed_reads"], summary["stop"] or "none",
                  held["total"], held["as_of"], cov["read"], cov["listed"], time.time() - started)
    except Exception as exc:  # noqa: BLE001 -- a failed run is said; the last good answer stays held
        _log.warning("[insider-clusters] run failed (%s); the last good answer is kept", type(exc).__name__)
    finally:
        with _lock:
            _state["inflight"] = None
        done.set()


def run_nightly(now: Optional[datetime] = None) -> dict:
    """THE SCHEDULED ENTRY (`api/main.py`): start the night's read on its own thread, unless one is
    already running. Returns at once: `{"started": bool}`."""
    with _lock:
        if _state["inflight"] is not None:
            return {"started": False, "reason": "running"}
        done = _state["inflight"] = threading.Event()
    threading.Thread(target=_run, args=(done, now), daemon=True, name="insider-clusters-sec").start()
    return {"started": True}


def next_run(now: Optional[datetime] = None) -> datetime:
    """The next scheduled read: the next Tuesday-to-Saturday `RUN_AT_ET` after `now` (New York)."""
    now = now or now_et()
    slot = now.replace(hour=RUN_AT_ET[0], minute=RUN_AT_ET[1], second=0, microsecond=0)
    if slot <= now:
        slot += timedelta(days=1)
    while slot.weekday() not in (1, 2, 3, 4, 5):
        slot += timedelta(days=1)
    return slot


def held_answer() -> tuple[Optional[dict], str]:
    """READ ONLY: the answer this module holds (looked for on disk once), as `(answer, how)`, how =
    'held' | 'not_held'. It never reads the SEC and never starts a run. For a caller that must not
    cause work (the voice tool, the Screener's capture, the agent)."""
    _ensure_loaded()
    with _lock:
        held = _state["held"]
    if held is None:
        return None, "not_held"
    return {k: v for k, v in held.items() if k != "v"}, "held"


def get_clusters() -> dict:
    """THE REQUEST PATH (`GET /api/insider/clusters`): only what is held, never a read of the SEC.

    status: 'ok' | 'not_built' (no night has run yet: `building` says whether the first read is
            running now, `next_run` when the next one is due)
    ok:     as_of (the newest filing day whose index was read), read_at (when the list was built),
            source, rules, clusters [{issuer_cik, ticker (None when the filer gave none), company,
            insiders, roles {ceo, cfo, officer, director, ten_percent, other, not_stated}, people
            [{names, role, roles, title, last_buy, shares, value, avg_price}], first_buy, last_buy,
            buys, filings, last_filed, shares, value (None when no purchase stated a price),
            value_complete, unpriced_buys, avg_price, close {value, date, reason}, change_pct, url}],
            total, truncated, cut_from, coverage {days, window_weekdays, complete, listed, read,
            given_up, from, to}, last_run {stop, http_status, documents, at}, building, next_run
    """
    held, _how = held_answer()
    with _lock:
        building = _state["inflight"] is not None
    upcoming = next_run().isoformat(timespec="minutes")
    if held is None:
        return {"status": "not_built", "building": building, "source": SOURCE, "rules": dict(RULES),
                "next_run": upcoming}
    return {"status": "ok", **held, "building": building, "next_run": upcoming}


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    with _lock:
        _state.update({"held": None, "store": None, "loaded": False, "inflight": None})
