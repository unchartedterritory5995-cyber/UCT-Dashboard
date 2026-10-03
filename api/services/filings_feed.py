"""COV-09 -- a live feed of new SEC filings, per ticker and market-wide.
The Research > Filings feed tab.

Forms: 8-K (with its item codes), 10-Q, 10-K, Form 4, Schedule 13D / 13G and
S-1 -- amendments included. Every row cites its accession number and links to
the filing's SEC index page.

Two reads, both through `fundamentals_pit.sec_client` (the repo's one SEC path:
one declared User-Agent, one process-wide limiter, bounded backoff):
  * MARKET: EDGAR's "latest filings" Atom feed (`browse-edgar?action=getcurrent`),
    one request per form, polled by a scheduled job every FILINGS_FEED_POLL_MINUTES
    (default 5) and merged into a bounded in-process cache (newest MARKET_KEEP).
    Live-verified 2026-10-02: the 13D/13G form types are now "SCHEDULE 13D" /
    "SCHEDULE 13G" -- the legacy "SC 13D" / "SC 13G" queries return 0 entries.
  * TICKER: the company's EDGAR submissions document (which carries the 8-K
    `items` field), read on this module's own single worker thread on a cache
    miss, cached 15 minutes, then merged with any newer market-feed rows for the
    same CIK.

REQUEST PATH IS CACHE-ONLY. `market_feed()` and `ticker_feed()` never touch the
network: a miss answers `pending` (and queues one bounded refresh).

Ticker <-> CIK comes from SEC's own `company_tickers.json` via sec_client,
loaded once a day. That file is PARTIAL (see edgar_ownership), so a symbol it
lacks is `not_found` with that reason, never "no filings".

DARK behind FILINGS_FEED_ENABLED: unset, the routes 404, the poll does nothing
and `_schedule` refuses.
"""
from __future__ import annotations

import html
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from api.services.cache import cache

_logger = logging.getLogger(__name__)

ENABLED_ENV = "FILINGS_FEED_ENABLED"
SOURCE_FEED = "SEC EDGAR latest-filings feed"
SOURCE_SUBMISSIONS = "SEC EDGAR submissions"

FEED_FORMS = ("8-K", "10-Q", "10-K", "4", "SCHEDULE 13D", "SCHEDULE 13G", "S-1")
FEED_COUNT = 100
MARKET_KEEP = 600
TICKER_ROWS = 60
POLL_MINUTES = int(os.environ.get("FILINGS_FEED_POLL_MINUTES", "5"))

_MARKET_KEY = "filings_feed::market"
_TICKER_PREFIX = "filings_feed::sym::"
_MARKET_TTL = 24 * 3600
_TTL_OK = 15 * 60
_TTL_FAIL = 5 * 60
_TTL_NOT_FOUND = 3600
_TICKERS_TTL = 24 * 3600
_SEC_TIMEOUT_S = 20
_SEC_RETRIES = 1
_MAX_QUEUED = 16

_WWW = "https://www.sec.gov"
_DATA = "https://data.sec.gov"

# Form 8-K item numbers -> the item's caption (SEC Form 8-K General Instructions).
ITEM_LABELS = {
    "1.01": "Entry into a Material Definitive Agreement",
    "1.02": "Termination of a Material Definitive Agreement",
    "1.03": "Bankruptcy or Receivership",
    "1.04": "Mine Safety",
    "1.05": "Material Cybersecurity Incidents",
    "2.01": "Completion of Acquisition or Disposition of Assets",
    "2.02": "Results of Operations and Financial Condition",
    "2.03": "Creation of a Direct Financial Obligation",
    "2.04": "Triggering Events That Accelerate a Financial Obligation",
    "2.05": "Costs Associated with Exit or Disposal Activities",
    "2.06": "Material Impairments",
    "3.01": "Notice of Delisting or Failure to Satisfy a Listing Rule",
    "3.02": "Unregistered Sales of Equity Securities",
    "3.03": "Material Modification to Rights of Security Holders",
    "4.01": "Changes in Registrant's Certifying Accountant",
    "4.02": "Non-Reliance on Previously Issued Financial Statements",
    "5.01": "Changes in Control of Registrant",
    "5.02": "Departure / Election of Directors or Officers; Compensatory Arrangements",
    "5.03": "Amendments to Articles or Bylaws; Change in Fiscal Year",
    "5.04": "Temporary Suspension of Trading Under Employee Benefit Plans",
    "5.05": "Amendments to the Code of Ethics",
    "5.06": "Change in Shell Company Status",
    "5.07": "Submission of Matters to a Vote of Security Holders",
    "5.08": "Shareholder Director Nominations",
    "6.01": "ABS Informational and Computational Material",
    "7.01": "Regulation FD Disclosure",
    "8.01": "Other Events",
    "9.01": "Financial Statements and Exhibits",
}

_ENTRY = re.compile(r"<entry>(.*?)</entry>", re.S)
_TITLE = re.compile(r"<title>(.*?)</title>", re.S)
_HREF = re.compile(r'<link[^>]*href="([^"]+)"')
_UPDATED = re.compile(r"<updated>(.*?)</updated>")
_SUMMARY = re.compile(r"<summary[^>]*>(.*?)</summary>", re.S)
_ACCN = re.compile(r"(\d{10}-\d{2}-\d{6})")
_TITLE_PARTS = re.compile(r"^(?P<form>.+?) - (?P<company>.*) \((?P<cik>\d{4,10})\) \((?P<role>[^)]+)\)\s*$", re.S)
_FILED = re.compile(r"Filed:</b>\s*(\d{4}-\d{2}-\d{2})")
_ITEM = re.compile(r"Item (\d{1,2}\.\d{2})")

# Which entry of a multi-party filing names the company the filing is ABOUT.
_SUBJECT_ROLES = ("Issuer", "Subject", "Filer")


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def base_form(form: str) -> str:
    f = (form or "").strip().upper()
    return f[:-2] if f.endswith("/A") else f


def in_scope(form: str) -> bool:
    return base_form(form) in FEED_FORMS


def index_url(cik: Any, accession: str) -> str:
    return f"{_WWW}/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.htm"


def items_of(codes: list[str]) -> list[dict]:
    return [{"code": c, "label": ITEM_LABELS.get(c, "Item not in the 8-K caption list")} for c in codes]


# ── parsing ─────────────────────────────────────────────────────────────────

def parse_feed(atom: str) -> list[dict]:
    """EDGAR getcurrent Atom -> one row per ACCESSION. A Form 4 / 13D / 13G is
    listed twice (issuer + reporting owner, subject + filer); the row keeps the
    company the filing is about and names the other party in `filed_by`."""
    by_acc: dict[str, dict] = {}
    for body in _ENTRY.findall(atom or ""):
        t, h = _TITLE.search(body), _HREF.search(body)
        if not (t and h):
            continue
        m = _TITLE_PARTS.match(html.unescape(t.group(1)).strip())
        a = _ACCN.search(h.group(1))
        if not (m and a):
            continue
        summary = html.unescape(_SUMMARY.search(body).group(1)) if _SUMMARY.search(body) else ""
        filed = _FILED.search(summary)
        upd = _UPDATED.search(body)
        e = {"form": m.group("form").strip(), "company": m.group("company").strip(),
             "cik": int(m.group("cik")), "role": m.group("role").strip(), "accession": a.group(1),
             "filed": filed.group(1) if filed else None, "accepted": upd.group(1).strip() if upd else None,
             "items": _ITEM.findall(summary)}
        cur = by_acc.get(e["accession"])
        if cur is None:
            by_acc[e["accession"]] = e
            continue
        # keep the subject-side entry; remember the other party
        if e["role"] in _SUBJECT_ROLES and cur["role"] not in _SUBJECT_ROLES:
            e["filed_by"] = cur["company"]
            by_acc[e["accession"]] = e
        elif cur["role"] in _SUBJECT_ROLES and e["role"] not in _SUBJECT_ROLES:
            cur["filed_by"] = e["company"]
    out = []
    for e in by_acc.values():
        if not in_scope(e["form"]):
            continue
        out.append(_row(form=e["form"], company=e["company"], cik=e["cik"], accession=e["accession"],
                        filed=e["filed"], accepted=e["accepted"], items=e["items"], source=SOURCE_FEED,
                        filed_by=e.get("filed_by") if e["role"] in _SUBJECT_ROLES else e["company"],
                        subject_known=e["role"] in _SUBJECT_ROLES))
    return out


def _row(*, form, company, cik, accession, filed, accepted, items, source, filed_by=None,
         subject_known=True, ticker=None) -> dict:
    is_8k = base_form(form) == "8-K"
    r = {"form": form, "company": company, "cik": int(cik), "ticker": ticker, "accession": accession,
         "filed": filed, "accepted": accepted, "url": index_url(cik, accession), "source": source,
         "items": items_of(items) if is_8k else None}
    if is_8k and not items:
        r["items_note"] = "unavailable: the source listed no item codes for this 8-K"
    if filed_by and filed_by != company:
        r["filed_by"] = filed_by
    if not subject_known:
        r["subject_note"] = "the feed window held only the filer's entry; the subject company is not named"
    return r


def parse_submissions(sub: dict, *, cik: int, ticker: str, limit: int = TICKER_ROWS) -> list[dict]:
    rec = ((sub or {}).get("filings") or {}).get("recent") or {}
    forms = rec.get("form") or []
    out = []
    for i, form in enumerate(forms):
        if not in_scope(form):
            continue
        acc = (rec.get("accessionNumber") or [None] * len(forms))[i]
        if not acc:
            continue
        items_raw = (rec.get("items") or [""] * len(forms))[i] or ""
        out.append(_row(form=form, company=sub.get("name") or ticker, cik=cik, accession=acc,
                        filed=(rec.get("filingDate") or [None] * len(forms))[i],
                        accepted=(rec.get("acceptanceDateTime") or [None] * len(forms))[i],
                        items=[c.strip() for c in items_raw.split(",") if c.strip()],
                        source=SOURCE_SUBMISSIONS, ticker=ticker))
        if len(out) >= limit:
            break
    return out


# ── SEC transport + ticker map ──────────────────────────────────────────────

def _sec_get(url: str) -> bytes:
    """The one SEC transport (sec_client). Indirection so tests replace it by name."""
    from api.services.fundamentals_pit import sec_client
    return sec_client.get_bytes(url, retries=_SEC_RETRIES, timeout=_SEC_TIMEOUT_S)


_tickers_lock = threading.Lock()
_tickers: dict[str, Any] = {"by_ticker": None, "by_cik": None, "at": 0.0}


def _load_tickers(force: bool = False) -> bool:
    """SEC company_tickers.json -> both directions. OFF THE REQUEST PATH ONLY."""
    with _tickers_lock:
        fresh = _tickers["by_ticker"] is not None and time.time() - _tickers["at"] < _TICKERS_TTL
    if fresh and not force:
        return True
    try:
        j = json.loads(_sec_get(f"{_WWW}/files/company_tickers.json"))
    except Exception as exc:  # noqa: BLE001
        _logger.warning("filings_feed: company_tickers unavailable: %s", exc)
        return _tickers["by_ticker"] is not None
    by_t, by_c = {}, {}
    for v in (j.values() if isinstance(j, dict) else []):
        try:
            t, c = str(v["ticker"]).upper(), int(v["cik_str"])
        except (KeyError, TypeError, ValueError):
            continue
        by_t[t] = c
        by_c.setdefault(c, t)          # first listed ticker = the primary class
    with _tickers_lock:
        _tickers.update(by_ticker=by_t, by_cik=by_c, at=time.time())
    return True


def _ticker_for(cik: int) -> Optional[str]:
    m = _tickers["by_cik"]
    return m.get(int(cik)) if m else None


# ── MARKET: the scheduled poll ──────────────────────────────────────────────

def poll_market(*, forms=FEED_FORMS) -> dict:
    """The scheduled job: one getcurrent read per form, merged into the cache.
    A form whose read fails keeps the rows already held and is marked so."""
    if not is_enabled():
        return {"skipped": "flag off"}
    _load_tickers()
    prev = cache.get(_MARKET_KEY) or {}
    rows = {r["accession"]: r for r in prev.get("rows") or []}
    status = dict(prev.get("forms") or {})
    for form in forms:
        url = (f"{_WWW}/cgi-bin/browse-edgar?action=getcurrent&type={form.replace(' ', '+')}"
               f"&company=&dateb=&owner=include&start=0&count={FEED_COUNT}&output=atom")
        try:
            got = parse_feed(_sec_get(url).decode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001 -- recorded per form, never silent
            status[form] = {"state": "unavailable", "at": time.time(), "detail": type(exc).__name__}
            continue
        for r in got:
            if base_form(r["form"]) != form:
                continue
            r["ticker"] = _ticker_for(r["cik"])
            rows[r["accession"]] = r
        status[form] = {"state": "ok", "at": time.time(), "n": len(got)}
    merged = sorted(rows.values(), key=lambda r: (r.get("accepted") or "", r["accession"]), reverse=True)
    snap = {"rows": merged[:MARKET_KEEP], "forms": status, "polled_at": time.time(),
            "poll_minutes": POLL_MINUTES}
    cache.set(_MARKET_KEY, snap, _MARKET_TTL)
    return {"rows": len(snap["rows"]), "forms": {f: s["state"] for f, s in status.items()}}


def market_feed(*, form: Optional[str] = None, now: Optional[float] = None) -> dict:
    """REQUEST PATH. Cache only."""
    snap = cache.get(_MARKET_KEY)
    if not snap:
        return {"state": "pending", "source": SOURCE_FEED, "rows": None,
                "reason": f"the feed has not been polled yet on this server; it polls every {POLL_MINUTES} minutes"}
    rows = snap["rows"]
    if form:
        rows = [r for r in rows if base_form(r["form"]) == base_form(form)]
    age = (now or time.time()) - snap["polled_at"]
    state = "ok" if age <= 3 * POLL_MINUTES * 60 else "stale"
    failed = sorted(f for f, s in snap["forms"].items() if s.get("state") != "ok")
    out = {"state": state, "source": SOURCE_FEED, "polled_at": snap["polled_at"], "rows": rows,
           "forms": snap["forms"], "poll_minutes": snap.get("poll_minutes", POLL_MINUTES)}
    if state == "stale":
        out["reason"] = f"the last successful poll was {int(age // 60)} minutes ago"
    if failed:
        out["partial"] = f"these forms could not be read on the last poll: {', '.join(failed)}"
    return out


# ── TICKER: cache + single-worker refresh ───────────────────────────────────

_lock = threading.Lock()
_queued: set[str] = set()
_executor: Optional[ThreadPoolExecutor] = None


def _refresh(sym: str) -> dict:
    """Fetch, shape and cache one ticker. Never raises."""
    from api.services.fundamentals_pit.sec_client import SecError
    try:
        _load_tickers()
        by_t = _tickers["by_ticker"]
        if by_t is None:
            snap, ttl = {"state": "unavailable", "detail": "SEC company_tickers.json could not be read"}, _TTL_FAIL
        elif sym not in by_t:
            snap, ttl = {"state": "not_found",
                         "detail": "symbol not in SEC company_tickers.json (that file is partial)"}, _TTL_NOT_FOUND
        else:
            cik = by_t[sym]
            sub = json.loads(_sec_get(f"{_DATA}/submissions/CIK{cik:010d}.json"))
            snap = {"state": "ok", "cik": cik, "company": sub.get("name"),
                    "rows": parse_submissions(sub, cik=cik, ticker=sym), "fetched_at": time.time()}
            ttl = _TTL_OK
    except SecError as exc:
        snap, ttl = {"state": "unavailable", "detail": f"SEC {exc.status or 'error'}"}, _TTL_FAIL
    except Exception as exc:  # noqa: BLE001
        _logger.warning("filings_feed refresh failed for %s: %s", sym, exc)
        snap, ttl = {"state": "unavailable", "detail": type(exc).__name__}, _TTL_FAIL
    snap["sym"] = sym
    cache.set(_TICKER_PREFIX + sym, snap, ttl)
    return snap


def _run(sym: str) -> None:
    try:
        _refresh(sym)
    finally:
        with _lock:
            _queued.discard(sym)


def _schedule(sym: str) -> bool:
    global _executor
    if not is_enabled():
        return False
    with _lock:
        if sym in _queued or len(_queued) >= _MAX_QUEUED:
            return False
        _queued.add(sym)
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="filings-feed")
        ex = _executor
    ex.submit(_run, sym)
    return True


def ticker_feed(sym: str, *, form: Optional[str] = None) -> dict:
    """REQUEST PATH. Cache only: the ticker's submissions read, plus any NEWER
    rows the market poll has seen for the same CIK."""
    sym = (sym or "").upper().strip()
    snap = cache.get(_TICKER_PREFIX + sym)
    if snap is None:
        queued = _schedule(sym)
        return {"state": "pending", "ticker": sym, "source": SOURCE_SUBMISSIONS, "rows": None, "queued": queued,
                "reason": "the filing list is being read from SEC; it appears on a later visit"}
    if snap["state"] != "ok":
        return {"state": snap["state"], "ticker": sym, "source": SOURCE_SUBMISSIONS, "rows": None,
                "reason": snap.get("detail") or "unknown"}
    rows = list(snap["rows"])
    have = {r["accession"] for r in rows}
    market = cache.get(_MARKET_KEY) or {}
    newer = [dict(r, ticker=sym) for r in market.get("rows") or []
             if r["cik"] == snap["cik"] and r["accession"] not in have]
    rows = sorted(newer + rows, key=lambda r: (r.get("accepted") or r.get("filed") or "", r["accession"]),
                  reverse=True)
    if form:
        rows = [r for r in rows if base_form(r["form"]) == base_form(form)]
    out = {"state": "ok", "ticker": sym, "cik": snap["cik"], "company": snap.get("company"),
           "source": SOURCE_SUBMISSIONS, "fetched_at": snap.get("fetched_at"),
           "merged_from_feed": len(newer), "rows": rows}
    if not rows:
        out["state"] = "none_in_scope"
        out["reason"] = ("SEC's recent-filings list for this company holds no "
                         + (form or "8-K, 10-Q, 10-K, Form 4, 13D/G or S-1") + " filing")
    return out
