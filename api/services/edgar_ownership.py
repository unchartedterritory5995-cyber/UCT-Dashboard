"""TERM-045 (FB-A7-01) -- ownership read straight from SEC EDGAR: Form 4 insider
transactions, and the Form 13F information table.

Why this exists. EDGAR is public domain (licensing register T-83, class A) and
was already wired here for filings, yet every ownership figure a member sees
came from a vendor column or a scrape (T-39: FMP insider + 13F, class R;
T-73: yfinance, class X). This module reads the filings themselves, so every
insider row carries the accession number of the Form 4 it came from.

⛔ DARK behind `EDGAR_OWNERSHIP_ENABLED` (read per call, unset = OFF). Unset,
nothing here is reached from a member request, no thread is started and SEC is
never called (`_schedule` refuses as well, so a stray caller cannot open the
door the flag closed). Armed, `GET /api/research/ownership/{sym}` sources its
insider section from here instead of FMP/Finnhub (DOC-2: the incumbent is
RETIRED from the display, not joined beside it) and carries `insider_source`.

Request path vs fetch path.
  * `form4_snapshot()` is the only thing a request calls. It reads the cache
    and NEVER touches the network: a miss answers `state: pending` and queues
    one refresh.
  * `_refresh()` runs on this module's own single worker thread (not the
    web pod's anyio pool). It reaches SEC only through
    `fundamentals_pit.sec_client` -- the repo's one fair-access client: the
    declared `SEC_USER_AGENT`, one process-wide limiter (<=9 req/s, default 5)
    and bounded backoff. There is no second EDGAR client or User-Agent here.
  * Ticker -> CIK goes through `edgar.resolve_cik`, the existing chain
    (bulk file -> FMP profile -> browse-edgar). The bulk `company_tickers.json`
    is PARTIAL, so its silence is never read as "not a filer".

Unknown is never zero. A snapshot has a `state`:
  ok          every listed filing in the window was read
  partial     some filings were not read (named by accession) or the window
              was cut by the filing cap / the submissions index
  pending     not read yet (cache miss; a refresh is queued)
  not_found   no SEC filer could be matched to the symbol
  unavailable SEC could not be read
Only `ok` and `partial` carry rows. For the other three `display_rows()`
returns None, never [] -- an empty list would read as "no insider activity",
which is a claim nobody measured.

Scope of a row. Non-derivative, open-market purchases and sales only
(transaction codes P and S), with buy/sell derived from the filing's own
acquired/disposed code (A/D) and a row with no A/D excluded -- the same scope
and the same sign rule as the incumbent `insider._classify_txn_fmp`, so the two
are comparable name by name (`compare_by_name`). A price the filer did not
report is None and so is its amount; never 0.

13F. `parse_13f_information_table` + `aggregate_13f_positions` +
`to_thirteen_f_holder` read ONE filer's information table into the Ownership
tab's `thirteen_f.holders` row shape. ⚠️ They are not wired to the tab: a 13F
is keyed by the FILER and names issuers by CUSIP, so "who holds AAPL" needs a
CUSIP -> issuer join across every filer. That join is blocked twice over --
on TERM-023/FB-S3-01 (entity identity) and on CUSIP's own terms, which the
capability matrix records as prohibiting a maintained master file. The owner
decides that before anything here claims a holders table.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from api.services import provider_errors as _pe
from api.services.cache import cache
from api.services.provider_licensing_class import licensing_class_for

_logger = logging.getLogger(__name__)

VENDOR = "sec_edgar"
_ERR = _pe.make_vendor_errors(VENDOR, class_prefix="SecEdgar")

WINDOW_DAYS = 180          # Form 4 look-back
MAX_FILINGS = 40           # Form 4 documents read per refresh
DISPLAY_ROWS = 10          # rows the Ownership tab shows (the incumbent's cap)
_SEC_TIMEOUT_S = 15        # per SEC request
_SEC_RETRIES = 1           # sec_client retries 403/429/5xx with backoff
_REFRESH_BUDGET_S = 90.0   # wall clock for one ticker's refresh
_TTL_OK = 4 * 3600         # every listed filing read (or structurally capped)
_TTL_FAIL = 300            # something was not read -- retry soon
_TTL_NOT_FOUND = 3600
_MAX_QUEUED = 16

_CACHE_PREFIX = "edgar_own_f4::"
_WWW = "https://www.sec.gov"
_DATA = "https://data.sec.gov"

# A 13F filed on or after this date reports `value` in dollars; before it, in
# thousands (SEC Form 13F instructions, effective 2023-01-03).
_13F_DOLLARS_FROM = "2023-01-03"

READABLE_STATES = ("ok", "partial")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get("EDGAR_OWNERSHIP_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


# ── parsing helpers ─────────────────────────────────────────────────────────

class ParseError(ValueError):
    """The document is not the form it was fetched as, or is not XML."""


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(el, name: str):
    if el is None:
        return None
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _children(el, name: str) -> list:
    if el is None:
        return []
    return [c for c in el if _local(c.tag) == name]


def _path(el, *names):
    for n in names:
        el = _child(el, n)
        if el is None:
            return None
    return el


def _text(el) -> Optional[str]:
    if el is None or el.text is None:
        return None
    t = el.text.strip()
    return t or None


def _value(el, *names) -> Optional[str]:
    """Form 4 wraps most facts as <x><value>..</value></x>. A fact given only
    as a footnote reference has no <value> and is None -- never a default."""
    node = _path(el, *names)
    if node is None:
        return None
    v = _child(node, "value")
    return _text(v) if v is not None else _text(node)


def _num(s: Optional[str]) -> Optional[float]:
    if s is None:
        return None
    try:
        return float(str(s).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _flag(s: Optional[str]) -> bool:
    return (s or "").strip().lower() in ("1", "true")


def _parse_xml(xml_bytes: bytes):
    try:
        return ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ParseError(f"not XML: {exc}") from exc


# ── Form 4 ──────────────────────────────────────────────────────────────────

def parse_form4(xml_bytes: bytes, *, accession: str, filing_date: Optional[str] = None) -> dict:
    """One Form 4 / 4/A ownership document -> issuer, reporting owners and every
    non-derivative transaction, verbatim. Raises ParseError when the bytes are
    not an ownershipDocument."""
    root = _parse_xml(xml_bytes)
    if _local(root.tag) != "ownershipDocument":
        raise ParseError(f"root is <{_local(root.tag)}>, not <ownershipDocument>")
    doc_type = _text(_child(root, "documentType"))
    if doc_type not in ("4", "4/A"):
        raise ParseError(f"documentType {doc_type!r} is not a Form 4")

    issuer = _child(root, "issuer")
    owners = []
    for ro in _children(root, "reportingOwner"):
        rel = _child(ro, "reportingOwnerRelationship")
        owners.append({
            "cik": _text(_path(ro, "reportingOwnerId", "rptOwnerCik")),
            "name": _text(_path(ro, "reportingOwnerId", "rptOwnerName")),
            "is_director": _flag(_text(_child(rel, "isDirector"))),
            "is_officer": _flag(_text(_child(rel, "isOfficer"))),
            "is_ten_percent": _flag(_text(_child(rel, "isTenPercentOwner"))),
            "is_other": _flag(_text(_child(rel, "isOther"))),
            "officer_title": _text(_child(rel, "officerTitle")),
            "other_text": _text(_child(rel, "otherText")),
        })

    txns = []
    for t in _children(_child(root, "nonDerivativeTable"), "nonDerivativeTransaction"):
        txns.append({
            "security": _value(t, "securityTitle"),
            "date": _value(t, "transactionDate"),
            "code": _text(_path(t, "transactionCoding", "transactionCode")),
            "shares": _num(_value(t, "transactionAmounts", "transactionShares")),
            "price": _num(_value(t, "transactionAmounts", "transactionPricePerShare")),
            "acquired_disposed": _value(t, "transactionAmounts", "transactionAcquiredDisposedCode"),
            "owned_after": _num(_value(t, "postTransactionAmounts", "sharesOwnedFollowingTransaction")),
            "direct_indirect": _value(t, "ownershipNature", "directOrIndirectOwnership"),
        })

    return {
        "accession": accession,
        "form": doc_type,
        "filing_date": filing_date,
        "period": _text(_child(root, "periodOfReport")),
        "issuer": {
            "cik": _text(_child(issuer, "issuerCik")),
            "name": _text(_child(issuer, "issuerName")),
            "symbol": _text(_child(issuer, "issuerTradingSymbol")),
        },
        "owners": owners,
        "transactions": txns,
    }


def _owner_title(o: dict) -> str:
    parts = []
    if o.get("is_officer"):
        parts.append(o.get("officer_title") or "Officer")
    if o.get("is_director"):
        parts.append("Director")
    if o.get("is_ten_percent"):
        parts.append("10% Owner")
    if o.get("is_other"):
        parts.append(o.get("other_text") or "Other")
    return ", ".join(parts)


def classify_form4_txn(txn: dict) -> Optional[str]:
    """'buy' / 'sell' / None (skip). Open-market P and S only; the SIGN comes
    from the filing's A/D code and a blank one excludes the row -- the same
    rule as `insider._classify_txn_fmp`."""
    code = (txn.get("code") or "").strip().upper()
    if code not in ("P", "S"):
        return None
    ad = (txn.get("acquired_disposed") or "").strip().upper()
    if ad == "A":
        return "buy"
    if ad == "D":
        return "sell"
    return None


def filing_index_url(cik: str | int, accession: str) -> str:
    return f"{_WWW}/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.htm"


def form4_rows(doc: dict) -> list[dict]:
    """A parsed Form 4 -> rows in the Ownership tab's insider shape, plus the
    accession number, form and a link to the filing. Rows whose share count
    the filer did not state are dropped (as the incumbent drops them)."""
    owners = doc.get("owners") or []
    names = [o["name"] for o in owners if o.get("name")]
    title = _owner_title(owners[0]) if owners else ""
    issuer_cik = (doc.get("issuer") or {}).get("cik")
    url = filing_index_url(issuer_cik, doc["accession"]) if issuer_cik else None
    rows = []
    for t in doc.get("transactions") or []:
        kind = classify_form4_txn(t)
        if kind is None:
            continue
        shares = t.get("shares")
        if shares is None:
            continue
        price = t.get("price")
        rows.append({
            "name": "; ".join(names) or "Unknown",
            "title": title,
            "type": kind,
            "shares": abs(int(shares)),
            "price": round(price, 2) if price is not None else None,
            "amount": round(abs(shares * price), 2) if price is not None else None,
            "date": t.get("date") or "",
            "filing_date": doc.get("filing_date") or "",
            "accession": doc["accession"],
            "form": doc.get("form"),
            "url": url,
            "owned_after": t.get("owned_after"),
        })
    return rows


def form4_owner_roles(doc: dict) -> list[dict]:
    """A parsed Form 4 -> one row per reporting owner with the ROLE the filing
    declares (director / officer + title / 10% owner / other), whatever the
    transaction codes were. COV-05 (Research People) reads these: a grant or a
    gift still states who the insider is, so this is NOT limited to P/S rows."""
    issuer_cik = (doc.get("issuer") or {}).get("cik")
    url = filing_index_url(issuer_cik, doc["accession"]) if issuer_cik else None
    out = []
    for o in doc.get("owners") or []:
        if not o.get("name"):
            continue
        out.append({
            "name": o["name"],
            "cik": o.get("cik"),
            "role": _owner_title(o) or "Not stated in the filing",
            "is_director": bool(o.get("is_director")),
            "is_officer": bool(o.get("is_officer")),
            "is_ten_percent": bool(o.get("is_ten_percent")),
            "officer_title": o.get("officer_title"),
            "filing_date": doc.get("filing_date") or "",
            "accession": doc["accession"],
            "form": doc.get("form"),
            "url": url,
        })
    return out


def merge_owner_roles(rows: list[dict]) -> list[dict]:
    """One row per reporting owner (keyed by owner CIK, else name), keeping the
    NEWEST filing's declared role -- a director who became CEO reads as CEO."""
    best: dict[str, dict] = {}
    for r in rows:
        k = r.get("cik") or r["name"].upper()
        cur = best.get(k)
        if cur is None or (r["filing_date"], r["accession"]) > (cur["filing_date"], cur["accession"]):
            best[k] = r
    return sorted(best.values(), key=lambda r: (r["filing_date"], r["accession"]), reverse=True)


def list_form4_filings(submissions: dict, *, since: str) -> dict:
    """Form 4 / 4/A entries in a submissions document filed on/after `since`,
    newest first. `index_short` is True when the submissions `recent` block
    (at most ~1000 filings) ends inside the window, so older Form 4s in the
    window exist but are not listed there."""
    recent = ((submissions or {}).get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    accs = recent.get("accessionNumber") or []
    dates = recent.get("filingDate") or []
    docs = recent.get("primaryDocument") or []
    accepted = recent.get("acceptanceDateTime") or []
    out = []
    for i, form in enumerate(forms):
        if form not in ("4", "4/A"):
            continue
        fd = dates[i] if i < len(dates) else None
        if not fd or fd < since:
            continue
        out.append({
            "accession": accs[i] if i < len(accs) else None,
            "form": form,
            "filing_date": fd,
            "primary_document": docs[i] if i < len(docs) else None,
            "accepted": accepted[i] if i < len(accepted) else None,
        })
    out.sort(key=lambda f: (f["filing_date"], f["accession"] or ""), reverse=True)
    oldest_listed = min(dates) if dates else None
    more_pages = bool(((submissions or {}).get("filings") or {}).get("files"))
    index_short = bool(more_pages and oldest_listed and oldest_listed > since)
    return {"filings": out, "index_short": index_short}


def latest_proxy_filing(submissions: dict, cik: str | int) -> Optional[dict]:
    """COV-05: the newest definitive proxy statement (form DEF 14A) in a submissions
    document, read from the SAME document the Form 4 listing uses (no extra SEC request).
    The proxy is where an issuer publishes its director and officer biographies; this is
    a link to it, never extracted text. None when the recent block lists no DEF 14A."""
    recent = ((submissions or {}).get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    accs = recent.get("accessionNumber") or []
    dates = recent.get("filingDate") or []
    docs = recent.get("primaryDocument") or []
    best = None
    for i, form in enumerate(forms):
        if form != "DEF 14A":
            continue
        fd = dates[i] if i < len(dates) else None
        acc = accs[i] if i < len(accs) else None
        if not fd or not acc:
            continue
        if best is None or (fd, acc) > (best["filing_date"], best["accession"]):
            doc = docs[i] if i < len(docs) else None
            best = {"form": form, "filing_date": fd, "accession": acc,
                    "url": (f"{_WWW}/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/{doc}"
                            if doc else filing_index_url(cik, acc)),
                    "index_url": filing_index_url(cik, acc)}
    return best


def _raw_document(primary_document: Optional[str]) -> Optional[str]:
    """`xslF345X06/form4.xml` is the rendered view; the raw XML is the same
    name without the stylesheet directory. Anything that is not XML (a paper
    filing's .txt) has no ownershipDocument to read."""
    if not primary_document:
        return None
    doc = primary_document
    if "/" in doc and doc.split("/", 1)[0].lower().startswith("xsl"):
        doc = doc.split("/", 1)[1]
    return doc if doc.lower().endswith(".xml") else None


def _sec_get(url: str) -> bytes:
    """The one SEC transport, via the repo's fair-access client. Indirection so
    tests replace it by name."""
    from api.services.fundamentals_pit import sec_client
    return sec_client.get_bytes(url, retries=_SEC_RETRIES, timeout=_SEC_TIMEOUT_S)


def _resolve_cik(sym: str) -> Optional[str]:
    from api.services.edgar import resolve_cik
    return resolve_cik(sym)


def _accepted_epoch(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def fetch_form4_activity(sym: str, *, today: Optional[date] = None,
                         budget_s: float = _REFRESH_BUDGET_S) -> _pe.ProviderResult:
    """Read a ticker's Form 4 filings from EDGAR. OFF THE REQUEST PATH ONLY --
    up to 1 + MAX_FILINGS SEC requests. Raises the SecEdgar* error family:
    NotFound (no filer matched / SEC 404), Transient (anything else on the
    submissions read). A single unreadable Form 4 does not raise: it is named
    in `filings_unread` and the result is partial."""
    from api.services.fundamentals_pit.sec_client import SecError

    sym = (sym or "").upper().strip()
    started = time.monotonic()
    cik = _resolve_cik(sym)
    if not cik:
        raise _ERR.not_found(f"no SEC filer matched {sym}")
    cik = str(cik).zfill(10)
    try:
        submissions = json.loads(_sec_get(f"{_DATA}/submissions/CIK{cik}.json"))
    except SecError as exc:
        if exc.status == 404:
            raise _ERR.not_found(f"no submissions for CIK {cik}", status=404) from exc
        raise _ERR.transient(f"submissions read failed for CIK {cik}: {exc}", status=exc.status) from exc
    except ValueError as exc:
        raise _ERR.transient(f"submissions for CIK {cik} were not JSON") from exc

    today = today or datetime.now(timezone.utc).date()
    since = (today - timedelta(days=WINDOW_DAYS)).isoformat()
    listing = list_form4_filings(submissions, since=since)
    listed = listing["filings"]
    to_read = listed[:MAX_FILINGS]

    rows: list[dict] = []
    owner_roles: list[dict] = []
    unread: list[dict] = []
    other_issuer = 0
    read = 0
    newest_accepted = None
    for f in to_read:
        acc = f["accession"]
        if time.monotonic() - started > budget_s:
            unread.append({"accession": acc, "reason": "time_budget"})
            continue
        doc_name = _raw_document(f["primary_document"])
        if not acc or not doc_name:
            unread.append({"accession": acc, "reason": "no_xml_document"})
            continue
        url = f"{_WWW}/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/{doc_name}"
        try:
            doc = parse_form4(_sec_get(url), accession=acc, filing_date=f["filing_date"])
        except SecError as exc:
            unread.append({"accession": acc, "reason": f"sec_{exc.status or 'error'}"})
            continue
        except ParseError:
            unread.append({"accession": acc, "reason": "parse_error"})
            continue
        read += 1
        # An issuer's submissions also list Form 4s the company filed as a
        # REPORTING OWNER of someone else's stock. Those are not its insiders.
        if str(doc["issuer"].get("cik") or "").zfill(10) != cik:
            other_issuer += 1
            continue
        rows.extend(form4_rows(doc))
        owner_roles.extend(form4_owner_roles(doc))
        ep = _accepted_epoch(f.get("accepted"))
        if ep is not None and (newest_accepted is None or ep > newest_accepted):
            newest_accepted = ep

    rows.sort(key=lambda r: (r["date"], r["accession"]), reverse=True)
    value = {
        "sym": sym,
        "cik": cik,
        "rows": rows,
        # COV-05: every reporting owner's declared role, from every Form 4 read
        # (not only the P/S rows above), newest filing per owner.
        "owner_roles": merge_owner_roles(owner_roles),
        # COV-05 (board / bios): the newest DEF 14A, from the same submissions read.
        "latest_proxy": latest_proxy_filing(submissions, cik),
        "window_days": WINDOW_DAYS,
        "since": since,
        "filings_listed": len(listed),
        "filings_read": read,
        "filings_unread": unread,
        "truncated_at_cap": len(listed) > MAX_FILINGS,
        "index_short": listing["index_short"],
        "other_issuer_filings": other_issuer,
    }
    return _pe.ProviderResult(
        value=value,
        provenance=_pe.ProvenanceRecord(
            vendor=VENDOR,
            source_activity="edgar_ownership.fetch_form4_activity",
            source_observed_at=newest_accepted,
        ),
        licensing_class=licensing_class_for(VENDOR, "insider"),
        # Not established: a Form 4's lag is the filer's (two business days by
        # rule), not a vendor delivery tier.
        freshness=None,
    )


def snapshot_from_result(result: _pe.ProviderResult) -> dict:
    v = dict(result.value)
    incomplete = bool(v["filings_unread"]) or v["truncated_at_cap"] or v["index_short"]
    v["state"] = "partial" if incomplete else "ok"
    v["vendor"] = result.provenance.vendor
    v["source_activity"] = result.provenance.source_activity
    v["fetched_at"] = result.provenance.fetched_at
    v["source_observed_at"] = result.provenance.source_observed_at
    v["licensing_class"] = result.licensing_class
    return v


def display_rows(snapshot: dict) -> Optional[list]:
    """The rows a member may be shown, or None when the read did not happen.
    ⛔ None, never [] -- `[]` is "no insider activity", and for pending /
    not_found / unavailable nobody measured that."""
    if (snapshot or {}).get("state") not in READABLE_STATES:
        return None
    return list(snapshot.get("rows") or [])[:DISPLAY_ROWS]


# ── cache + background refresh ──────────────────────────────────────────────

_lock = threading.Lock()
_queued: set[str] = set()
_executor: Optional[ThreadPoolExecutor] = None


def _key(sym: str) -> str:
    return _CACHE_PREFIX + sym


def _refresh(sym: str) -> dict:
    """Fetch, snapshot and cache one ticker. Never raises."""
    try:
        snap = snapshot_from_result(fetch_form4_activity(sym))
        ttl = _TTL_FAIL if snap["filings_unread"] else _TTL_OK
    except _pe.ProviderNotFound as exc:
        snap = {"state": "not_found", "sym": sym, "detail": str(exc)}
        ttl = _TTL_NOT_FOUND
    except Exception as exc:  # noqa: BLE001 -- recorded as a state, never swallowed silently
        _logger.warning("edgar form4 refresh failed for %s: %s", sym, exc)
        snap = {"state": "unavailable", "sym": sym, "detail": type(exc).__name__}
        ttl = _TTL_FAIL
    snap.setdefault("vendor", VENDOR)
    snap.setdefault("window_days", WINDOW_DAYS)
    cache.set(_key(sym), snap, ttl)
    return snap


def _run(sym: str) -> None:
    try:
        _refresh(sym)
    finally:
        with _lock:
            _queued.discard(sym)


def _schedule(sym: str) -> bool:
    """Queue one refresh on this module's own worker. Refuses when the flag is
    off, when the ticker is already queued, or when the queue is full (the next
    request asks again)."""
    global _executor
    if not is_enabled():
        return False
    with _lock:
        if sym in _queued or len(_queued) >= _MAX_QUEUED:
            return False
        _queued.add(sym)
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="edgar-ownership")
        ex = _executor
    ex.submit(_run, sym)
    return True


def form4_snapshot(sym: str) -> dict:
    """REQUEST PATH. Cache only; a miss queues a refresh and answers pending."""
    sym = (sym or "").upper().strip()
    hit = cache.get(_key(sym))
    if hit is not None:
        return hit
    queued = _schedule(sym)
    return {"state": "pending", "sym": sym, "vendor": VENDOR, "window_days": WINDOW_DAYS,
            "queued": queued}


# ── the Ownership tab overlay + coverage by name ────────────────────────────

def _norm_name(s: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", str(s or "").upper())).strip()


def compare_by_name(edgar_rows: list[dict], incumbent_rows: list[dict]) -> dict:
    """Which filers each source shows, ENUMERATED BY NAME (FB-A7-01's "known it
    worked": never a percentage). EDGAR rows are restricted to the incumbent's
    own date span, because the incumbent is capped at 10 rows and would
    otherwise "miss" everything older than its tenth row."""
    inc = [r for r in (incumbent_rows or []) if isinstance(r, dict)]
    inc_dates = [r.get("date") for r in inc if r.get("date")]
    start = min(inc_dates) if inc_dates else None
    ed = [r for r in (edgar_rows or []) if start is None or (r.get("date") or "") >= start]

    def names(rows):
        out = set()
        for r in rows:
            for part in str(r.get("name") or "").split(";"):
                n = _norm_name(part)
                if n:
                    out.add(n)
        return out

    e, i = names(ed), names(inc)
    return {
        "both": sorted(e & i),
        "edgar_only": sorted(e - i),
        "incumbent_only": sorted(i - e),
        "incumbent_rows": len(inc),
        "compared_from": start,
    }


_SOURCE_KEYS = ("state", "window_days", "since", "cik", "filings_listed", "filings_read",
                "filings_unread", "truncated_at_cap", "index_short", "other_issuer_filings",
                "fetched_at", "source_observed_at", "licensing_class", "source_activity")


def overlay_insider(payload: dict, sym: str) -> dict:
    """Armed only. Returns a NEW dict (the cached payload is never mutated)
    whose `insider` is EDGAR's rows -- or None while unknown -- and which
    carries `insider_source`. Every other key is the payload's own."""
    snap = form4_snapshot(sym)
    out = dict(payload or {})
    incumbent = (payload or {}).get("insider") or []
    rows = display_rows(snap)
    out["insider"] = rows
    source = {k: snap.get(k) for k in _SOURCE_KEYS}
    source["vendor"] = VENDOR
    source["label"] = "SEC EDGAR Form 4"
    source["rows_total"] = len(snap.get("rows") or []) if rows is not None else None
    source["compare"] = compare_by_name(snap.get("rows") or [], incumbent) if rows is not None else None
    out["insider_source"] = source
    return out


# ── Form 13F information table (parser + normalization; NOT wired) ──────────

def parse_13f_information_table(xml_bytes: bytes, *, accession: str,
                                filed_date: Optional[str]) -> list[dict]:
    """One 13F-HR information table -> its rows, verbatim. `value_usd` is set
    only when the filing date fixes the unit (dollars from 2023-01-03,
    thousands before); with no filing date it is None -- a unit is never
    guessed. Raises ParseError when the bytes are not an informationTable."""
    root = _parse_xml(xml_bytes)
    if _local(root.tag) != "informationTable":
        raise ParseError(f"root is <{_local(root.tag)}>, not <informationTable>")
    if filed_date is None:
        scale = None
    else:
        scale = 1.0 if filed_date >= _13F_DOLLARS_FROM else 1000.0
    out = []
    for it in _children(root, "infoTable"):
        raw_value = _num(_text(_child(it, "value")))
        vote = _child(it, "votingAuthority")
        out.append({
            "accession": accession,
            "issuer": _text(_child(it, "nameOfIssuer")),
            "title_of_class": _text(_child(it, "titleOfClass")),
            "cusip": _text(_child(it, "cusip")),
            "value_reported": raw_value,
            "value_usd": (raw_value * scale) if (raw_value is not None and scale is not None) else None,
            "shares": _num(_text(_path(it, "shrsOrPrnAmt", "sshPrnamt"))),
            "shares_type": _text(_path(it, "shrsOrPrnAmt", "sshPrnamtType")),
            "put_call": _text(_child(it, "putCall")),
            "discretion": _text(_child(it, "investmentDiscretion")),
            "voting": {
                "sole": _num(_text(_child(vote, "Sole"))),
                "shared": _num(_text(_child(vote, "Shared"))),
                "none": _num(_text(_child(vote, "None"))),
            },
        })
    return out


def aggregate_13f_positions(rows: list[dict]) -> list[dict]:
    """A filer often reports one security on several rows (one per manager
    combination). Sum SHARE positions per (cusip, class); option rows
    (`put_call`) and principal-amount rows (`PRN`) are not share ownership and
    are left out. A missing value makes the security's value None, not a
    partial sum."""
    acc: dict[tuple, dict] = {}
    for r in rows:
        if r.get("put_call") or (r.get("shares_type") or "SH") != "SH":
            continue
        k = (r.get("cusip"), r.get("title_of_class"))
        a = acc.setdefault(k, {"cusip": k[0], "title_of_class": k[1], "issuer": r.get("issuer"),
                               "accession": r.get("accession"), "shares": 0.0, "value_usd": 0.0,
                               "rows": 0})
        a["rows"] += 1
        a["shares"] = None if (a["shares"] is None or r.get("shares") is None) else a["shares"] + r["shares"]
        a["value_usd"] = None if (a["value_usd"] is None or r.get("value_usd") is None) else a["value_usd"] + r["value_usd"]
    return sorted(acc.values(), key=lambda p: (p["value_usd"] is None, -(p["value_usd"] or 0)))


def to_thirteen_f_holder(filer_name: str, position: dict) -> dict:
    """One filer's aggregated position -> the Ownership tab's `thirteen_f.holders`
    row. A single filing cannot know the prior quarter, so every change field
    is None (unknown), never 0 / False."""
    return {
        "name": filer_name,
        "shares": position.get("shares"),
        "change_shares": None,
        "change_pct": None,
        "ownership": None,
        "market_value": position.get("value_usd"),
        "is_new": None,
        "is_sold_out": None,
        "accession": position.get("accession"),
    }
