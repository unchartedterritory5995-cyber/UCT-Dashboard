"""DILU, the Terminal's dilution watch: what one company has filed with the SEC that bears on
selling new shares, read from the company's public EDGAR filing index and from nothing else.

One source, the SEC's own submissions data (no key, no account, no vendor):

  GET https://data.sec.gov/submissions/CIK##########.json          the company's filing index
  GET https://data.sec.gov/submissions/CIK##########-submissions-NNN.json   an older page of it

  The first answer is an object: `name`, `entityType` ("operating" for a company), `tickers`, and
  `filings`. `filings.recent` is a set of COLUMNS, one entry per filing, newest first; the SEC's
  page says it holds "at least one year's of filing or to 1,000 (whichever is more) of the most
  recent filings". The columns read here:
      form             "S-3", "S-3ASR", "424B5", "EFFECT", "8-K", ...
      filingDate       "2026-11-02"
      accessionNumber  "0001193125-26-442833" (the filing's own number; its page on sec.gov is built from it)
      acceptanceDateTime  used only to order two filings of one day
      fileNumber       "333-284510": the registration a filing belongs to. A prospectus supplement
                       carries the file number of the registration statement it was filed under,
                       which is how a supplement is set beside its shelf here.
      items            "1.01,3.02": an 8-K's item numbers
  `filings.files` lists older pages (`name`, `filingFrom`, `filingTo`); each is the same columns.

The shape is as the SEC's page "EDGAR Application Programming Interfaces" and one real answer gave
it on 2026-11-18. The form names are the SEC's own (its EDGAR form index).

WHAT IS READ FROM IT, AND WHAT EACH IS (the whole list; `FORMS` below is the code's copy):

  shelf registrations     S-3, S-3ASR, F-3, F-3ASR; their amendments S-3/A, F-3/A and POSASR.
                          A shelf is the CAPACITY to sell later. An automatic shelf (ASR) takes
                          effect the day it is filed; any other needs the SEC's notice (below).
  effectiveness           EFFECT, set beside its registration by file number.
  offering documents      424B1, 424B2, 424B3, 424B4, 424B5, 424B7, 424B8: a prospectus or a
                          prospectus supplement, filed when securities are offered. These are what
                          the "offering documents" counts count. FWP (a free writing prospectus,
                          offering material) is listed but not counted.
  new registrations       S-1, F-1 and their amendments S-1/A, F-1/A; S-1MEF, S-3MEF, F-1MEF,
                          F-3MEF (more securities for an offering already registered); POS AM (an
                          amendment after a registration took effect).
  employee plans          S-8. Listed apart: shares for employees, not a market offering.
  withdrawals             RW (a request to withdraw a registration).
  unregistered sales      an 8-K (or 8-K/A) whose items include 3.02, "Unregistered Sales of
                          Equity Securities".
  material agreements     an 8-K whose items include 1.01 and not 3.02. Listed apart: most are not
                          about selling shares, and the index does not say what the agreement is.

WHAT THE INDEX CANNOT SAY, so this module never says it: how many shares or dollars; whether a
filing is for common stock, preferred stock, notes or warrants; whether an S-3 is the company's
own shelf or a resale by holders; whether a shelf has been used up or replaced; what a proxy
proposes (a larger share authorisation, a reverse split). None of the filing DOCUMENTS is
downloaded. Canadian companies that register on Form F-10 are not classified.

"STILL LIVE" IS AN ESTIMATE FROM DATES. SEC Rule 415(a)(5) lets a company's own shelf be used for
three years from the day it took effect. So: effective day (the filing day for an automatic shelf,
else the day of the first EFFECT notice with the same file number) plus `SHELF_LIFE_YEARS`. A shelf
with no notice in the index is "not effective yet"; one with an RW after it is "withdrawal
requested". The three-year limit does not bind a shelf that only registers holders' resales, and
the index cannot tell the two apart, so the panel says the date is an estimate and why.
NOBODY HAS SEEN AN `EFFECT` ROW IN A REAL ANSWER YET (the one company looked at files automatic
shelves): that its `fileNumber` is the registration's is how EDGAR lists it, not something this
code has observed. If it were not, a shelf would read "no notice yet", never wrongly "live".

NOTHING IS BUILT ON A MEMBER'S REQUEST (the house pattern, `api/services/scan_period.py`): a
request returns what this module holds at once; with nothing held it starts ONE background build,
waits a few seconds for it and otherwise answers `computing`, and the panel asks again. An answer
is held in memory per ticker (`KEEP` at most) for `FRESH_S`; the last good one is served, marked
`refreshing`, while its replacement is built.

HOW THE SEC IS ASKED. Through the house client (`api/services/fundamentals_pit/sec_client.py`: the
declared User-Agent, one process-wide limiter under the SEC's 10 requests a second, bounded
retries) and nowhere else. One request for most companies; a company whose recent page does not
reach back far enough costs at most `MAX_OLDER_PAGES` more, and an answer that could not be read
back to the start of its window says so (`coverage`) and withholds the counts it cannot stand
behind. Ticker to company number is the house chain (`api/services/edgar.py`, `resolve_cik`).

  * a refusal (403) is a first-class answer, `unavailable`. A 429 is `failed` with reason
    `rate_limited`. Both are REMEMBERED for the whole module (`REFUSED_HOLD_S`,
    `RATE_LIMITED_HOLD_S`), so no other stock asks the SEC while one stands;
  * a timeout or a 5xx is `failed` with its reason, tried again after `FAILED_S`;
  * an answer that is not the filing index is `unavailable` with reason `shape`;
  * a symbol the SEC lists no filer for, or a filer with no filings, is `none`: a healthy answer;
  * every build writes ONE log line, prefix `[dilution]`, with the status and the counts. No URL
    is ever logged; the company number is the only thing of the request that is.

Reused by the Terminal panel (app/src/pages/terminal/panels/dilutionModel.js); `held_watch` is
read-only for a caller that must not cause work.
"""
from __future__ import annotations

import calendar
import json
import logging
import re
import threading
import time
from datetime import date, datetime, timezone
from typing import Any, Optional

from api.services.short_data import clean_symbol

_log = logging.getLogger(__name__)

SOURCE = "SEC EDGAR filings"
_DATA = "https://data.sec.gov"
_WWW = "https://www.sec.gov"

# ── the kinds of filing (the panel words each one; `MINOR` it lists apart) ───────────────────
SHELF = "shelf"
SHELF_AMENDMENT = "shelf_amendment"
EFFECT = "effect"
OFFERING = "offering"
FWP = "fwp"
REGISTRATION = "registration"
REGISTRATION_AMENDMENT = "registration_amendment"
PLAN = "plan"
WITHDRAWAL = "withdrawal"
UNREGISTERED = "unregistered"
AGREEMENT = "agreement"

#: the SEC's form type -> (kind, what it is in a few plain words). The whole list this module reads.
FORMS: dict[str, tuple[str, str]] = {
    "S-3": (SHELF, "Shelf registration"),
    "S-3ASR": (SHELF, "Automatic shelf registration"),
    "F-3": (SHELF, "Shelf registration (foreign company)"),
    "F-3ASR": (SHELF, "Automatic shelf registration (foreign company)"),
    "S-3/A": (SHELF_AMENDMENT, "Shelf registration, amended"),
    "F-3/A": (SHELF_AMENDMENT, "Shelf registration, amended (foreign company)"),
    "POSASR": (SHELF_AMENDMENT, "Automatic shelf registration, amended after it took effect"),
    "EFFECT": (EFFECT, "SEC notice that a registration took effect"),
    "424B1": (OFFERING, "Prospectus"),
    "424B2": (OFFERING, "Prospectus supplement"),
    "424B3": (OFFERING, "Prospectus supplement"),
    "424B4": (OFFERING, "Prospectus"),
    "424B5": (OFFERING, "Prospectus supplement"),
    "424B7": (OFFERING, "Prospectus supplement naming selling holders"),
    "424B8": (OFFERING, "Prospectus, filed late"),
    "FWP": (FWP, "Free writing prospectus (offering material)"),
    "S-1": (REGISTRATION, "Registration statement"),
    "F-1": (REGISTRATION, "Registration statement (foreign company)"),
    "S-1MEF": (REGISTRATION, "Registration of more securities for an offering already registered"),
    "S-3MEF": (REGISTRATION, "Registration of more securities for an offering already registered"),
    "F-1MEF": (REGISTRATION, "Registration of more securities for an offering already registered"),
    "F-3MEF": (REGISTRATION, "Registration of more securities for an offering already registered"),
    "S-1/A": (REGISTRATION_AMENDMENT, "Registration statement, amended"),
    "F-1/A": (REGISTRATION_AMENDMENT, "Registration statement, amended (foreign company)"),
    "POS AM": (REGISTRATION_AMENDMENT, "Registration statement, amended after it took effect"),
    "S-8": (PLAN, "Employee plan registration"),
    "RW": (WITHDRAWAL, "Request to withdraw a registration"),
}
#: shelf forms that take effect the day they are filed
AUTOMATIC_SHELVES = frozenset({"S-3ASR", "F-3ASR"})
#: 8-K item numbers read (the SEC's Form 8-K captions)
ITEM_UNREGISTERED = "3.02"
ITEM_AGREEMENT = "1.01"
#: forms only a fund files; one of them in the index means the filer is not an operating company
FUND_FORMS = frozenset({"485BPOS", "485APOS", "N-CSR", "N-CSRS", "NPORT-P", "497", "497K"})

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
WINDOW_YEARS = 3              # the timeline's window
RECENT_MONTHS = 12            # the shorter horizon the counts are also given for
SHELF_LIFE_YEARS = 3          # SEC Rule 415(a)(5): a shelf may be used this long after it takes effect
SCAN_EXTRA_YEARS = 1          # registrations filed this long before the window are read, to set a notice beside them
MAX_OLDER_PAGES = 3           # older pages of the index read for one company, at most
ROWS_MAX = 250                # timeline rows one answer carries (newest first); the counts cover every row read
SEC_TIMEOUT_S = 20.0
SEC_RETRIES = 1               # the house client retries a 403 / 429 / 5xx with backoff

FRESH_S = 3600.0              # one stock's answer
STALE_EXTRA_S = 23 * 3600.0   # the last good answer may be served this long past its freshness
NONE_S = 3600.0               # "the SEC lists no filer for this symbol"
SHAPE_S = 900.0               # the SEC answered, but not with a filing index this module can read
FAILED_S = 60.0               # a failed build is said briefly, then tried again
REFUSED_HOLD_S = 900.0        # a 403: nothing is asked for this long (the SEC lifts a block ten minutes after the asking stops)
RATE_LIMITED_HOLD_S = 900.0   # a 429
KEEP = 300                    # stocks held
MAX_BUILDS = 2                # stocks being read from the SEC at once
WAIT_S = 3.0                  # the longest a request waits on the build it started

_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ACCESSION = re.compile(r"^\d{10}-\d{2}-\d{6}$")
_FILE_NUMBER = re.compile(r"^\d{3}-\d{3,8}$")
_ITEM = re.compile(r"^\d{1,2}\.\d{2}$")
_PAGE_NAME = re.compile(r"^CIK\d{10}-submissions-\d{3}\.json$")

_lock = threading.Lock()
_done: dict[str, tuple[float, dict]] = {}          # sym -> (fresh until, answer)
_old: dict[str, tuple[float, dict]] = {}           # sym -> (servable until, last GOOD answer)
_inflight: dict[str, threading.Event] = {}         # sym -> set when its build finishes
_blocked: list = [None]                            # (until, answer): the SEC refused or rate-limited; nothing is asked


class _Stop(Exception):
    """A read that did not give a filing index. `state`: 'none' | 'unavailable' | 'failed'."""

    def __init__(self, state: str, http_status: Optional[int] = None, reason: Optional[str] = None, note: str = ""):
        super().__init__(reason or state)
        self.state = state
        self.http_status = http_status
        self.reason = reason
        self.note = note


# ── the readers (each one small, so a test can stand in for it) ──────────────────────────────

def _sec_get(url: str) -> bytes:
    """ONE request to the SEC through the house client. Raises its `SecError`."""
    from api.services.fundamentals_pit import sec_client
    return sec_client.get_bytes(url, retries=SEC_RETRIES, timeout=SEC_TIMEOUT_S)


def _resolve_cik(sym: str) -> tuple[Optional[str], bool]:
    """(the company's ten-digit SEC number or None, whether the SEC's ticker list could be read).
    The house chain; its own list is asked once more because the chain remembers a miss for the
    life of the process, and a miss made while the list was unreadable must not stand."""
    from api.services import edgar
    cik = edgar.resolve_cik(sym)
    if cik:
        return str(cik).zfill(10), True
    bulk = edgar._ticker_to_cik_bulk()
    hit = bulk.get(sym)
    return (str(hit).zfill(10) if hit else None), bool(bulk)


def now_et() -> datetime:
    """The time in New York (the SEC's filing day)."""
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def shift_months(day: date, months: int) -> date:
    """The same day of the month `months` later (earlier when negative); the month's last day
    when it has no such day."""
    idx = day.year * 12 + (day.month - 1) + months
    year, month = divmod(idx, 12)
    return date(year, month + 1, min(day.day, calendar.monthrange(year, month + 1)[1]))


def norm_form(raw: Any) -> str:
    """A form type as the SEC writes it: capitals, single spaces ("POS AM", "8-K/A")."""
    return " ".join(str(raw or "").upper().split())


def items_of(raw: Any) -> list[str]:
    """An 8-K's item numbers from the index's "1.01,3.02" (anything that is not one is left out)."""
    return [c for c in (p.strip() for p in str(raw or "").split(",")) if _ITEM.match(c)]


def classify(form: str, items: list[str]) -> Optional[tuple[str, str]]:
    """(kind, what it is) for one filing, or None when this module does not read the form."""
    base = form[:-2] if form.endswith("/A") else form
    if base == "8-K":
        if ITEM_UNREGISTERED in items:
            return UNREGISTERED, f"Unregistered sale of equity securities ({form} item {ITEM_UNREGISTERED})"
        if ITEM_AGREEMENT in items:
            return AGREEMENT, f"Material agreement ({form} item {ITEM_AGREEMENT})"
        return None
    return FORMS.get(form)


def filing_url(cik: str, accession: str) -> str:
    """The filing's own page on sec.gov (the list of its documents), as the filings feed links it."""
    return f"{_WWW}/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.htm"


def read_columns(cols: Any) -> tuple[list[dict], int]:
    """(filings, dropped) from one page of the index (`filings.recent`, or an older page). Every
    form is kept, classified or not: the page's newest and oldest day and a fund's forms are read
    from the unclassified ones. A row without its form, its day or its accession number is dropped
    and counted. Raises ValueError when the page is not columns."""
    if not isinstance(cols, dict):
        raise ValueError("not an object")
    forms, days, accs = cols.get("form"), cols.get("filingDate"), cols.get("accessionNumber")
    if not (isinstance(forms, list) and isinstance(days, list) and isinstance(accs, list)) or not (len(forms) == len(days) == len(accs)):
        raise ValueError("the form, filingDate and accessionNumber columns are missing or of different lengths")
    col = lambda name: cols.get(name) if isinstance(cols.get(name), list) and len(cols.get(name)) == len(forms) else None  # noqa: E731
    files, items, accepted = col("fileNumber"), col("items"), col("acceptanceDateTime")
    out: list[dict] = []
    dropped = 0
    for i, raw in enumerate(forms):
        form = norm_form(raw)
        day = _iso(days[i])
        acc = accs[i].strip() if isinstance(accs[i], str) else ""
        if not form or not day or not _ACCESSION.match(acc):
            dropped += 1
            continue
        file_no = files[i].strip() if files is not None and isinstance(files[i], str) else ""
        out.append({
            "form": form, "date": day, "accession": acc,
            "accepted": accepted[i] if accepted is not None and isinstance(accepted[i], str) else "",
            "file_number": file_no if _FILE_NUMBER.match(file_no) else None,
            "items": items_of(items[i]) if items is not None else [],
        })
    return out, dropped


def older_pages(sub: dict, since: str) -> list[str]:
    """The names of the older index pages that may hold a filing on or after `since`, newest
    first. A page that does not say where it ends is taken to be one of them (and read last)."""
    files = ((sub.get("filings") or {}).get("files")) if isinstance(sub.get("filings"), dict) else None
    hits = []
    for f in files if isinstance(files, list) else []:
        name = f.get("name") if isinstance(f, dict) else None
        to = _iso(f.get("filingTo")) if isinstance(f, dict) else None
        if isinstance(name, str) and _PAGE_NAME.match(name) and (to is None or to >= since):
            hits.append((to or "", name))
    return [name for _to, name in sorted(hits, reverse=True)]


def _shelves(scan: list[dict], window_from: str, today: date) -> list[dict]:
    """Every shelf registration among `scan` (oldest first), one per file number, newest first:
    when it took effect, when three years from that falls, and what was filed under it."""
    by_file: dict[str, dict] = {}
    for r in scan:
        if r["kind"] == SHELF and r["file_number"] and r["file_number"] not in by_file:
            by_file[r["file_number"]] = r
    out = []
    for file_no, base in by_file.items():
        later = [r for r in scan if r["file_number"] == file_no and r["date"] >= base["date"] and r is not base]
        automatic = base["form"] in AUTOMATIC_SHELVES
        notice = next((r["date"] for r in later if r["kind"] == EFFECT), None)
        effective = base["date"] if automatic else notice
        withdrawn = next((r["date"] for r in later if r["kind"] == WITHDRAWAL), None)
        expires = shift_months(date.fromisoformat(effective), 12 * SHELF_LIFE_YEARS).isoformat() if effective else None
        if withdrawn:
            state = "withdrawal_requested"
        elif not effective:
            state = "not_effective"
        else:
            state = "live" if today.isoformat() < expires else "expired"
        if base["date"] < window_from and state != "live":
            continue                                   # older than the window and not in force: not this answer's
        offerings = [r["date"] for r in later if r["kind"] == OFFERING]
        out.append({
            "form": base["form"], "what": base["what"], "file_number": file_no, "filed": base["date"],
            "accession": base["accession"], "url": base["url"], "automatic": automatic,
            "effective": effective, "effective_basis": ("automatic" if automatic else "notice") if effective else None,
            "expires_estimate": expires, "state": state, "withdrawal_requested": withdrawn,
            "amendments": sum(1 for r in later if r["kind"] == SHELF_AMENDMENT),
            "offerings": len(offerings), "latest_offering": max(offerings) if offerings else None,
        })
    return sorted(out, key=lambda s: (s["filed"], s["accession"]), reverse=True)


def assemble(sym: str, cik: str, sub: dict, filings: list[dict], *, today: date, covered_from: Optional[str],
             requests: int = 1, pages_unread: int = 0, read_at: Optional[str] = None) -> dict:
    """Pure: one stock's answer from every filing read. `covered_from` is the oldest day read when
    older pages of the index were left unread, else None (everything the window needs was read).
    A count is None, never a smaller number, when the read does not reach back past the start of
    its horizon."""
    today_s = today.isoformat()
    window_from = shift_months(today, -12 * WINDOW_YEARS).isoformat()
    recent_from = shift_months(today, -RECENT_MONTHS).isoformat()
    scan_from = shift_months(today, -12 * (WINDOW_YEARS + SCAN_EXTRA_YEARS)).isoformat()
    reaches = lambda start: covered_from is None or covered_from < start  # noqa: E731

    seen: set[str] = set()
    scan: list[dict] = []
    newest = None
    fund_forms = 0
    for f in filings:
        if f["accession"] in seen or f["date"] > today_s:
            continue
        seen.add(f["accession"])
        newest = f["date"] if newest is None or f["date"] > newest else newest
        if f["form"] in FUND_FORMS and f["date"] >= window_from:
            fund_forms += 1
        hit = classify(f["form"], f["items"]) if f["date"] >= scan_from else None
        if hit is None:
            continue
        scan.append({
            "date": f["date"], "form": f["form"], "kind": hit[0], "what": hit[1], "accession": f["accession"],
            "url": filing_url(cik, f["accession"]), "file_number": f["file_number"],
            "items": f["items"] if hit[0] in (UNREGISTERED, AGREEMENT) else [], "under": None, "_at": f["accepted"],
        })
    scan.sort(key=lambda r: (r["date"], r["_at"], r["accession"]))              # oldest first

    # a filing beside the registration it belongs to, by file number
    base: dict[str, dict] = {}
    for r in scan:
        if r["kind"] in (SHELF, REGISTRATION) and r["file_number"] and r["file_number"] not in base:
            base[r["file_number"]] = r
    for r in scan:
        reg = base.get(r["file_number"]) if r["file_number"] else None
        if reg is not None and reg is not r and r["date"] >= reg["date"]:
            r["under"] = {"form": reg["form"], "filed": reg["date"], "shelf": reg["kind"] == SHELF}

    shelves = _shelves(scan, window_from, today)
    window = [r for r in reversed(scan) if r["date"] >= window_from]              # newest first
    counts: dict[str, int] = {}
    for r in window:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1

    def horizon(kind: str) -> dict:
        days = [r["date"] for r in window if r["kind"] == kind]
        return {
            "m12": sum(1 for d in days if d >= recent_from) if reaches(recent_from) else None,
            "y3": len(days) if reaches(window_from) else None,
            "latest": days[0] if days else None,
        }

    live = [s for s in shelves if s["state"] == "live"]
    pending = [s for s in shelves if s["state"] == "not_effective"]
    entity = sub.get("entityType") if isinstance(sub.get("entityType"), str) else None
    name = sub.get("name") if isinstance(sub.get("name"), str) else None
    rows = [{k: v for k, v in r.items() if k != "_at"} for r in window[:ROWS_MAX]]
    return {
        "status": "ok",
        "sym": sym,
        "cik": cik,
        "company": name.strip() if name and name.strip() else None,
        "entity_type": entity.strip().lower() if entity and entity.strip() else None,
        "fund_like": fund_forms > 0 or (entity or "").strip().lower() == "investment",
        "window": {"years": WINDOW_YEARS, "from": window_from, "to": today_s, "recent_months": RECENT_MONTHS,
                   "recent_from": recent_from},
        "coverage": {"complete": reaches(window_from), "from": covered_from if not reaches(window_from) else window_from,
                     "requests": requests, "pages_unread": pages_unread},
        "newest_filing": newest,
        "summary": {
            "live_shelves": len(live), "newest_live_shelf": live[0] if live else None,
            "pending_shelves": len(pending), "newest_pending_shelf": pending[0] if pending else None,
            "offerings": horizon(OFFERING), "unregistered": horizon(UNREGISTERED), "registrations": horizon(REGISTRATION),
        },
        "shelves": shelves,
        "shelf_life_years": SHELF_LIFE_YEARS,
        "rows": rows,
        "rows_total": len(window),
        "cut": len(window) > len(rows),
        "counts": counts,
        "read_at": read_at or _now_iso(),
        "source": SOURCE,
    }


# ── the read ─────────────────────────────────────────────────────────────────────────────────

def _stop_of(exc: Exception, what: str) -> _Stop:
    """The `_Stop` for a failed SEC request. Only the error's class and status are ever said."""
    status = getattr(exc, "status", None)
    if status == 403:
        return _Stop("unavailable", 403, "refused",
                     note=f"unavailable (the SEC refused the request for {what}; nothing is asked for {int(REFUSED_HOLD_S // 60)} min)")
    if status == 429:
        return _Stop("failed", 429, "rate_limited",
                     note=f"failed (the SEC said too many requests, for {what}; nothing is asked for {int(RATE_LIMITED_HOLD_S // 60)} min)")
    if status is None and "timed out" in str(exc).lower():
        return _Stop("failed", None, "timeout", note=f"failed (the SEC did not answer in time, for {what})")
    if status is None or status >= 500:
        return _Stop("failed", status, "source", note=f"failed ({type(exc).__name__}, for {what})")
    return _Stop("unavailable", status, "refused", note=f"unavailable (the SEC answered {status} for {what})")


def build(sym: str, today: Optional[date] = None) -> tuple[dict, str]:
    """(one stock's answer, the log line's text). Runs on the calling (background) thread: the
    company number, the filing index, and older pages of it only while the window is not covered.
    Never raises."""
    from api.services.fundamentals_pit.sec_client import SecError
    today = today or now_et().date()
    cik: Optional[str] = None
    asked = 0

    def said(status: Any, text: str) -> str:
        return f"{sym} cik={cik or 'none'} status={status if status is not None else 'none'} {text}"

    def stopped(stop: _Stop) -> tuple[dict, str]:
        return ({"status": stop.state, "sym": sym, "reason": stop.reason, "http_status": stop.http_status, "source": SOURCE},
                said(stop.http_status, f"{stop.note} requests={asked}"))

    try:
        try:
            cik, listed = _resolve_cik(sym)
        except Exception as exc:  # noqa: BLE001 -- a failed lookup is said, never read as "no such company"
            raise _Stop("failed", None, "source", note=f"failed ({type(exc).__name__}, looking up the company number)") from None
        if not cik:
            if not listed:
                raise _Stop("failed", None, "source", note="failed (the SEC's ticker list could not be read)")
            raise _Stop("none", None, "no_cik", note="none (the SEC lists no filer for this symbol)")
        asked += 1
        try:
            sub = json.loads(_sec_get(f"{_DATA}/submissions/CIK{cik}.json"))
        except SecError as exc:
            if exc.status == 404:
                raise _Stop("none", 404, "no_filings", note="none (the SEC has no filing index for this company number)") from None
            raise _stop_of(exc, "the filing index") from None
        except ValueError:
            raise _Stop("unavailable", 200, "shape", note="rows=0 shape mismatch (the answer is not JSON)") from None
        except Exception as exc:  # noqa: BLE001
            raise _stop_of(exc, "the filing index") from None
        try:
            recent = sub["filings"]["recent"] if isinstance(sub, dict) and isinstance(sub.get("filings"), dict) else None
            filings, dropped = read_columns(recent)
        except (KeyError, ValueError) as shape:
            raise _Stop("unavailable", 200, "shape", note=f"rows=0 shape mismatch ({shape})") from None
        if not filings:
            if dropped:
                raise _Stop("unavailable", 200, "shape",
                            note=f"rows=0 shape mismatch ({dropped} filings listed, none with a form, a day and an accession number)")
            raise _Stop("none", 200, "no_filings", note="none (the SEC's index lists no filing for this company)")

        # The recent page is whole and newest first. Older pages are read, newest first, only while
        # the read does not reach back past the start of what the answer needs.
        scan_from = shift_months(today, -12 * (WINDOW_YEARS + SCAN_EXTRA_YEARS)).isoformat()
        oldest = min(f["date"] for f in filings)
        pages = older_pages(sub, scan_from) if oldest > scan_from else []
        unread = 0
        after: Optional[_Stop] = None
        for i, name in enumerate(pages):
            if i >= MAX_OLDER_PAGES:
                unread = len(pages) - i
                break
            asked += 1
            try:
                more, lost = read_columns(json.loads(_sec_get(f"{_DATA}/submissions/{name}")))
            except Exception as exc:  # noqa: BLE001 -- what was read is still an answer; the page is said as unread
                after = _Stop("unavailable", 200, "shape") if isinstance(exc, ValueError) else _stop_of(exc, "an older page of the index")
                unread = len(pages) - i
                break
            filings += more
            dropped += lost
            if more:
                oldest = min(oldest, min(f["date"] for f in more))
        out = assemble(sym, cik, sub, filings, today=today, covered_from=oldest if unread else None,
                       requests=asked, pages_unread=unread)
        s = out["summary"]
        text = (f"ok rows={out['rows_total']} shelves={len(out['shelves'])} live={s['live_shelves']} "
                f"offerings_3y={s['offerings']['y3'] if s['offerings']['y3'] is not None else 'unknown'} "
                f"unregistered_3y={s['unregistered']['y3'] if s['unregistered']['y3'] is not None else 'unknown'} "
                f"filings_read={len(filings)} requests={asked} "
                f"coverage={'complete' if out['coverage']['complete'] else 'from ' + str(out['coverage']['from'])}")
        if unread:
            text += f" pages_unread={unread}"
        if dropped:
            text += f" dropped={dropped}"
        if after is not None:
            text += f" older_page={after.reason}"
            out["_after"] = {"state": after.state, "reason": after.reason, "http_status": after.http_status}
        return out, said(200, text)
    except _Stop as stop:
        return stopped(stop)
    except Exception as exc:  # noqa: BLE001 -- a failed build is said, never raised into the thread
        return stopped(_Stop("failed", None, "error", note=f"failed ({type(exc).__name__})"))


# ── one stock: one build, off the request ────────────────────────────────────────────────────

def _ttl(out: dict) -> float:
    status = out.get("status")
    if status == "ok":
        return FRESH_S
    if status == "none":
        return NONE_S
    if out.get("reason") == "shape":
        return SHAPE_S
    return FAILED_S


def _block_for(state: Any, reason: Any, http_status: Any) -> None:
    """Remember a refusal or a rate limit for the whole module: no stock asks while it stands."""
    hold = REFUSED_HOLD_S if (state, reason) == ("unavailable", "refused") and http_status == 403 else \
        RATE_LIMITED_HOLD_S if reason == "rate_limited" else 0.0
    if hold:
        with _lock:
            _blocked[0] = (time.time() + hold, {"status": state, "reason": reason, "http_status": http_status, "source": SOURCE})


def _block() -> Optional[dict]:
    with _lock:
        hit = _blocked[0]
        if hit is None:
            return None
        if hit[0] <= time.time():
            _blocked[0] = None
            return None
        return dict(hit[1])


def _remember(sym: str, out: dict, ttl: float) -> None:
    now = time.time()
    with _lock:
        _done[sym] = (now + ttl, out)
        for k in [k for k, (exp, _o) in _done.items() if exp <= now]:
            _done.pop(k, None)
        while len(_done) > KEEP:
            _done.pop(min(_done, key=lambda k: _done[k][0]), None)
        if out.get("status") == "ok":
            _old[sym] = (now + ttl + STALE_EXTRA_S, out)
            for k in [k for k, (until, _o) in _old.items() if until <= now]:
                _old.pop(k, None)
            while len(_old) > KEEP:
                _old.pop(min(_old, key=lambda k: _old[k][0]), None)


def _answer(sym: str) -> Optional[dict]:
    with _lock:
        hit = _done.get(sym)
        if hit is None:
            return None
        if hit[0] <= time.time():
            _done.pop(sym, None)
            return None
        return hit[1]


def _old_answer(sym: str, *, mark: bool = True) -> Optional[dict]:
    with _lock:
        hit = _old.get(sym)
        if hit is None:
            return None
        if hit[0] <= time.time():
            _old.pop(sym, None)
            return None
        return {**hit[1], "refreshing": True} if mark else hit[1]


def _bg(sym: str, done: threading.Event) -> None:
    started = time.time()
    said = f"{sym} cik=none status=none failed"
    level = logging.WARNING
    try:
        out, said = build(sym)
        after = out.pop("_after", None)
        _remember(sym, out, _ttl(out))
        _block_for(out.get("status"), out.get("reason"), out.get("http_status"))
        if after:
            _block_for(after["state"], after["reason"], after["http_status"])
        level = logging.INFO if out.get("status") in ("ok", "none") and not after else logging.WARNING
    except Exception as exc:  # noqa: BLE001 -- a failed build is said, never left as "computing" for ever
        said = f"{sym} cik=none status=none failed ({type(exc).__name__})"
        with _lock:
            _done[sym] = (time.time() + FAILED_S, {"status": "failed", "sym": sym, "reason": "error", "http_status": None, "source": SOURCE})
    finally:
        _log.log(level, "[dilution] %s; %.2fs", said, time.time() - started)
        with _lock:
            _inflight.pop(sym, None)
        done.set()


def held_watch(ticker: Any) -> tuple[Optional[dict], str]:
    """READ ONLY: what this module already holds for one stock, as `(answer, how)`. It never starts
    a build. how: 'fresh' | 'last_good' | 'not_held' | 'refused' (not a symbol)."""
    sym = clean_symbol(ticker)
    if sym is None:
        return {"status": "bad_symbol", "sym": None}, "refused"
    held = _answer(sym)
    if held is not None and held.get("status") in ("ok", "none"):
        return held, "fresh"
    old = _old_answer(sym, mark=False)
    if old is not None:
        return old, "last_good"
    return (held, "fresh") if held is not None else (None, "not_held")


def get_watch(ticker: Any, *, wait_s: Optional[float] = None) -> dict:
    """One company's share-issuance filings of the last three years, classified. NEVER builds on
    the caller's thread: the held answer, else the last good one marked `refreshing`, else a short
    wait on the one background build, else `{"status": "computing"}`.

    status: 'ok' | 'none' (`reason`: 'no_cik' the SEC lists no filer for the symbol | 'no_filings')
            | 'computing' | 'unavailable' (`reason`: 'refused' with its `http_status` | 'shape')
            | 'failed' (`reason`: 'rate_limited' | 'timeout' | 'source' | 'error') | 'bad_symbol'
    ok:     sym, cik, company, entity_type, fund_like, window {years, from, to, recent_months,
            recent_from}, coverage {complete, from, requests, pages_unread}, newest_filing (the day
            of the newest filing of ANY form in the index), summary {live_shelves,
            newest_live_shelf, pending_shelves, newest_pending_shelf, offerings {m12, y3, latest},
            unregistered {...}, registrations {...}} (a count is None when the read does not reach
            back that far), shelves [{form, what, file_number, filed, url, automatic, effective,
            effective_basis ('automatic' | 'notice'), expires_estimate, state ('live' | 'expired' |
            'not_effective' | 'withdrawal_requested'), withdrawal_requested, amendments, offerings,
            latest_offering}], rows [{date, form, kind, what, url, accession, file_number, items,
            under {form, filed, shelf} | None}] newest first, rows_total, cut, counts {kind: n},
            shelf_life_years, read_at (when the site read the SEC), source, refreshing?
    """
    sym = clean_symbol(ticker)
    if sym is None:
        return {"status": "bad_symbol", "sym": None}
    held = _answer(sym)
    if held is not None and held.get("status") in ("ok", "none"):
        return held
    old = _old_answer(sym)
    if held is not None:
        # a failed or refused rebuild is held for a while; the last good answer is worth more
        return old if old is not None else held
    block = _block()
    if block is not None:
        return old if old is not None else {**block, "sym": sym}
    with _lock:
        done = _inflight.get(sym)
        if done is None:
            if len(_inflight) >= MAX_BUILDS:
                return old if old is not None else {"status": "computing", "sym": sym, "busy": True}
            done = _inflight[sym] = threading.Event()
            threading.Thread(target=_bg, args=(sym, done), daemon=True, name="dilution-watch").start()
    if old is not None:
        return old                                   # at once; the build replaces it for the next read
    done.wait(WAIT_S if wait_s is None else wait_s)
    held = _answer(sym)
    return held if held is not None else {"status": "computing", "sym": sym}


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds."""
    with _lock:
        _done.clear()
        _old.clear()
        _inflight.clear()
        _blocked[0] = None
