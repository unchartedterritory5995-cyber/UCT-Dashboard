"""PUBR, the Terminal's public records for one company: federal contract awards (USAspending.gov), its
clinical trials (ClinicalTrials.gov) and FDA drug approvals (openFDA, Drugs@FDA), and its lobbying
(LDA.gov, the Lobbying Disclosure Act database run by the Secretary of the Senate and the Clerk of the
House). Four government sources, each read keyless, each its own section with its own source, as-of and
the names that were matched.

    get_public_records(sym) -> the body of GET /api/research/public-records/{ticker}
      status   'ok' (always: each block says its own state)
      company  how the ticker was turned into names: {status, cik, names [{name, source, source_words,
               until}], sec_state ('ok' | 'none' | 'failed' | 'no_cik'), read_at}
      contracts, trials, fda, lobbying   each a section:
               {status: 'ok' | 'computing' | 'failed' | 'unavailable', reason, http_status, source,
                source_url, read_at, searched_for, state ('matched' | 'no_match' | 'no_name'), names,
                counted [names that matched, with how], not_counted [names returned, not matched], check,
                ...the section's own rows (`public_records_parse`)}

HOW A TICKER BECOMES A NAME (`public_records_match`, the whole rule): the company name the server
already holds for the ticker (ticker-meta), and the company's own SEC name and recent former names (its
EDGAR submissions, found by its CIK through the house chain `edgar.resolve_cik` and read through the house
SEC client). Each agency is searched with the company's name; every name the agency returns is compared
with the company's names, and only a match counts. Nothing is matched by guesswork: a subsidiary that
reports under its own name is listed as returned but not counted.

OUTBOUND (keyless; the house form of user agent, who is asking and no address):
  POST https://api.usaspending.gov/api/v2/search/spending_by_category/recipient/   (twice: two windows)
  POST https://api.usaspending.gov/api/v2/search/spending_by_award/                 (once)
  GET  https://clinicaltrials.gov/api/v2/studies                                    (twice: active, closed)
  GET  https://clinicaltrials.gov/api/v2/version                                    (at most every 6 hours)
  GET  https://api.fda.gov/drug/drugsfda.json                                       (once)
  GET  https://lda.gov/api/v1/filings/                                              (a page each, at most LDA_MAX_PAGES)
  GET  https://data.sec.gov/submissions/CIK##########.json   (through api/services/fundamentals_pit/sec_client.py)
No published rate limit was found for USAspending.gov or ClinicalTrials.gov; openFDA publishes 240 a
minute and 1,000 a day for a caller without a key; LDA.gov publishes 15 a minute for a caller without a
key. This module paces each host (`HOSTS`: a minimum gap between two requests, a daily budget well under
any published limit) process-wide, whatever the number of companies or members.

WHEN IT ASKS (the house rule, builder rule 5): NEVER on a member's request. One answer per company per
section is held in this module (`held_reads.KeyedHeld`, at most `MAX_KEYS` companies); the FIRST member
read of a company starts ONE background build per section (and one for the company's names), waits up to
`WAIT_S` and otherwise says `computing`. A held answer is refreshed after `TTL_S` (a day: these records
change daily at most), after `RETRY_S` when its read failed. Not on a schedule. A refusal (a 403 or a
redirect, never followed) or a 429 stops that HOST for every company (`REFUSED_HOLD_S`,
`RATE_LIMITED_HOLD_S`, or the agency's own Retry-After); a spent daily budget stops it until the next UTC
day. Each build writes ONE log line, prefix `[public-records]`, with the status of each request and the
counts; no URL and no search words are logged.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from api.services import held_build
from api.services import public_records_match as M
from api.services import public_records_parse as P
from api.services.held_reads import KeyedHeld

_log = logging.getLogger(__name__)

#: the house form for an official source (api/services/econ/http.py, api/services/fed_watch.py)
USER_AGENT = "UCT-Intelligence public-records (contact: see docs)"

USA_BASE = "https://api.usaspending.gov"
CT_BASE = "https://clinicaltrials.gov"
FDA_BASE = "https://api.fda.gov"
LDA_BASE = "https://lda.gov"
SEC_DATA = "https://data.sec.gov"

SOURCES = {
    "contracts": {"source": "USAspending.gov (U.S. Department of the Treasury, Bureau of the Fiscal Service)",
                  "source_url": "https://www.usaspending.gov"},
    "trials": {"source": "ClinicalTrials.gov (U.S. National Library of Medicine)", "source_url": "https://clinicaltrials.gov"},
    "fda": {"source": "openFDA, Drugs@FDA (U.S. Food and Drug Administration)", "source_url": "https://open.fda.gov"},
    "lobbying": {"source": "LDA.gov, Lobbying Disclosure Act filings (Senate Office of Public Records)",
                 "source_url": "https://lda.gov"},
}
COMPANY_SOURCE = "The site's company name and the company's SEC EDGAR record"

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
TTL_S = 24 * 3600.0             # a held section is refreshed after a day (on the next read)
IDENTITY_TTL_S = 7 * 24 * 3600.0  # the company's names, after a week
RETRY_S = 1800.0                # a section whose read failed is tried again after 30 minutes
REFUSED_HOLD_S = 6 * 3600.0     # a host that refused (a 4xx other than 429, or a redirect) is not asked for this long
RATE_LIMITED_HOLD_S = 900.0     # a 429 without a Retry-After
RETRY_AFTER_CAP_S = 3600.0      # the longest Retry-After honoured
SHAPE_HOLD_S = 3600.0           # an answer that is not the shape this module reads
WAIT_S = 3.0                    # the longest a member's request waits on the builds it started
IDENTITY_WAIT_S = 60.0          # a section's build waits this long for the company's names (background only)
MAX_KEYS = 150                  # companies held per section
MAX_WAITING = 24                # builds queued for one source past which a new one is told to come back
HTTP_TIMEOUT = (10, 45)         # connect, read (seconds)
MAX_BYTES = 6_000_000           # an answer is at most a few hundred kB
CT_VERSION_TTL_S = 6 * 3600.0
FDA_YEARS = 2                   # FDA actions of the last two years
CLOSED_TRIAL_DAYS = 365         # closed trials updated in the last year
LDA_QUARTERS = 8
LDA_PAGE_SIZE = 25              # LDA.gov's own maximum
LDA_MAX_PAGES = 12              # pages read for one company per build (300 filings)
USA_RECIPIENTS = 100            # recipient names read per window
USA_AWARDS = 100                # awards read (the largest new awards of the last twelve months)
FDA_LIMIT = 100                 # applications read
CT_ACTIVE_PAGE = 200
CT_CLOSED_PAGE = 100
SEC_TIMEOUT_S = 20.0

#: per host: the least gap between two requests (seconds), requests per UTC day, builds at once
HOSTS: dict[str, dict] = {
    "usaspending": {"gap": 1.0, "daily": 3000, "builds": 2},
    "ctgov": {"gap": 1.0, "daily": 3000, "builds": 2},
    "openfda": {"gap": 0.5, "daily": 500, "builds": 2},     # published: 1,000 a day without a key
    "lda": {"gap": 5.0, "daily": 2000, "builds": 1},        # published: 15 a minute without a key
}
SECTION_HOST = {"contracts": "usaspending", "trials": "ctgov", "fda": "openfda", "lobbying": "lda"}


# ── the hosts: pacing, budget, blocks ────────────────────────────────────────────────────────

class _Host:
    def __init__(self, key: str):
        self.key = key
        self.lock = threading.Lock()
        self.next_at = 0.0
        self.day = ""
        self.used = 0
        self.blocked_until = 0.0
        self.block: Optional[tuple[str, str, Optional[int]]] = None   # (state, reason, http_status)
        self.sem = threading.BoundedSemaphore(HOSTS[key]["builds"])
        self.waiting = 0


_hosts: dict[str, _Host] = {k: _Host(k) for k in HOSTS}


def _utc_day() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _seconds_to_utc_midnight() -> float:
    now = datetime.now(timezone.utc)
    nxt = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    return max(60.0, (nxt - now).total_seconds())


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _turn(host: str) -> None:
    """Wait for this host's next slot; `held_build.Stop` when the host is blocked or its day is spent."""
    h = _hosts[host]
    with h.lock:
        now = time.time()
        if h.block is not None and now < h.blocked_until:
            state, reason, status = h.block
            raise held_build.Stop(state, reason, status, hold=max(60.0, h.blocked_until - now),
                                  note=f"{host} held back ({reason})")
        day = _utc_day()
        if h.day != day:
            h.day, h.used = day, 0
        if h.used >= HOSTS[host]["daily"]:
            raise held_build.Stop("unavailable", "budget", None, hold=_seconds_to_utc_midnight(),
                                  note=f"{host} daily budget spent")
        h.used += 1
        mono = time.monotonic()
        at = max(mono, h.next_at)
        h.next_at = at + HOSTS[host]["gap"]
    delay = at - time.monotonic()
    if delay > 0:
        _sleep(delay)


def _hold_host(host: str, state: str, reason: str, status: Optional[int], seconds: float) -> None:
    h = _hosts[host]
    with h.lock:
        h.block = (state, reason, status)
        h.blocked_until = time.time() + seconds


def _http(method: str, url: str, *, params: Optional[dict] = None, body: Optional[dict] = None,
          max_bytes: int = MAX_BYTES) -> tuple[int, dict, bytes]:
    """ONE request: (status, the headers this module reads, body). No redirect is followed and no more
    than `max_bytes` (and one more) is read. Raises whatever the HTTP library raises."""
    import requests
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    kw: dict[str, Any] = {"timeout": HTTP_TIMEOUT, "allow_redirects": False, "stream": True, "headers": headers}
    if params is not None:
        kw["params"] = params
    if body is not None:
        kw["json"] = body
    with requests.request(method, url, **kw) as resp:
        raw = resp.raw.read(max_bytes + 1, decode_content=True) or b""
        return resp.status_code, {"retry-after": resp.headers.get("Retry-After")}, raw


def _retry_after(v: Any) -> Optional[float]:
    try:
        s = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    return min(RETRY_AFTER_CAP_S, max(1.0, s)) if s > 0 else None


def fetch_json(host: str, method: str, url: str, *, params: Optional[dict] = None, body: Optional[dict] = None,
               log: Optional[list] = None, none_on: tuple = ()) -> Any:
    """One JSON answer from `host`, or `held_build.Stop`. 200 is the answer; a status in `none_on` is
    None (an agency's documented "nothing found"); 429 holds the host back (its Retry-After, else
    `RATE_LIMITED_HOLD_S`); 408 or a 5xx is a failure tried again after `RETRY_S`; any other answer (a
    redirect, a 403, a 404) is a refusal that holds the host back `REFUSED_HOLD_S`, never worked around."""
    _turn(host)
    try:
        status, headers, raw = _http(method, url, params=params, body=body)
    except Exception as exc:  # noqa: BLE001 -- only the error's class is ever kept, never its text
        name = type(exc).__name__
        if log is not None:
            log.append(f"{host}=error")
        raise held_build.Stop("failed", "timeout" if "timeout" in name.lower() else "source", None, hold=RETRY_S,
                              note=f"{host} {name}") from None
    if log is not None:
        log.append(f"{host}={status}")
    if status == 429:
        hold = _retry_after(headers.get("retry-after")) or RATE_LIMITED_HOLD_S
        _hold_host(host, "failed", "rate_limited", 429, hold)
        raise held_build.Stop("failed", "rate_limited", 429, hold=hold, note=f"{host} 429")
    if status == 408 or status >= 500:
        raise held_build.Stop("failed", "source", status, hold=RETRY_S, note=f"{host} {status}")
    if status in none_on:
        return None
    if status != 200:
        _hold_host(host, "unavailable", "refused", status, REFUSED_HOLD_S)
        raise held_build.Stop("unavailable", "refused", status, hold=REFUSED_HOLD_S, note=f"{host} {status}")
    if len(raw) > MAX_BYTES:
        raise held_build.Stop("unavailable", "shape", 200, hold=SHAPE_HOLD_S, note=f"{host} answer too large")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise held_build.Stop("unavailable", "shape", 200, hold=SHAPE_HOLD_S, note=f"{host} answer is not JSON") from None


class _Slot:
    """One build of a source at a time per `HOSTS[...]["builds"]`; past `MAX_WAITING` queued, a new
    build is told to come back."""

    def __init__(self, host: str):
        self.h = _hosts[host]

    def __enter__(self):
        with self.h.lock:
            if self.h.waiting >= MAX_WAITING:
                raise held_build.Stop("failed", "busy", None, hold=60.0, note=f"{self.h.key} queue full")
            self.h.waiting += 1
        self.h.sem.acquire()
        with self.h.lock:
            self.h.waiting -= 1
        return self

    def __exit__(self, *exc):
        self.h.sem.release()
        return False


def _today() -> date:
    return datetime.now(timezone.utc).date()


# ── the company's names ──────────────────────────────────────────────────────────────────────

def _site_name(sym: str) -> Optional[str]:
    from api.services import held_reads
    return held_reads.held_name(sym)


def _resolve_cik(sym: str) -> Optional[str]:
    """The company's ten-digit SEC number through the house chain (`edgar.resolve_cik`), or None."""
    try:
        from api.services import edgar
        cik = edgar.resolve_cik(sym)
    except Exception:  # noqa: BLE001 -- no number is an answer: the site's name is still searched
        return None
    return str(cik).zfill(10) if cik and str(cik).strip().isdigit() else None


def _sec_submissions(cik: str) -> Any:
    from api.services.fundamentals_pit import sec_client
    return json.loads(sec_client.get_bytes(f"{SEC_DATA}/submissions/CIK{cik}.json", retries=1, timeout=SEC_TIMEOUT_S))


def _identity_build_for(sym: str) -> Callable[[Optional[dict]], tuple[dict, str]]:
    def build(previous: Optional[dict] = None) -> tuple[dict, str]:
        site = _site_name(sym)
        cik = _resolve_cik(sym)
        sec_name, former, sec_state = None, [], "no_cik"
        if cik:
            try:
                sub = _sec_submissions(cik)
                sec_name = P.text(sub.get("name")) if isinstance(sub, dict) else None
                former = sub.get("formerNames") if isinstance(sub, dict) and isinstance(sub.get("formerNames"), list) else []
                sec_state = "ok" if sec_name else "none"
            except Exception as exc:  # noqa: BLE001 -- only the class is logged
                status = getattr(exc, "status", None)
                sec_state = "none" if status == 404 else "failed"
                if previous and previous.get("cik") == cik and previous.get("sec_name"):
                    sec_name, former = previous.get("sec_name"), previous.get("former_raw") or []
        names = M.company_names(site, sec_name, former, today=_today())
        answer = {"status": "ok", "sym": sym, "cik": cik, "sec_name": sec_name, "sec_state": sec_state,
                  "former_raw": [f for f in former if isinstance(f, dict)][:20], "names": names,
                  "read_at": held_build.now_iso()}
        return answer, f"company {sym} cik={'yes' if cik else 'no'} sec={sec_state} names={len(names)}"
    return build


def _identity_due(answer: dict, checked: float, now: Optional[float] = None) -> bool:
    ttl = RETRY_S if (answer or {}).get("sec_state") == "failed" else IDENTITY_TTL_S
    return ((time.time() if now is None else now) - float(checked or 0)) >= ttl


def _identity_valid(held: dict) -> bool:
    return held.get("status") == "ok" and isinstance(held.get("names"), list)


_identity = KeyedHeld("public-records-company", _identity_build_for, _identity_due, max_keys=MAX_KEYS,
                      valid=_identity_valid)


def _company(sym: str) -> dict:
    """The company's names for a section's build (background thread), or `held_build.Stop`."""
    got = _identity.get(sym, wait_s=IDENTITY_WAIT_S)
    if got.get("status") != "ok":
        raise held_build.Stop("failed", "company", None, hold=120.0, note=f"company names for {sym} not ready")
    return got


def _base(section: str, sym: str, company: dict, searched: Optional[str]) -> dict:
    return {"status": "ok", "sym": sym, "section": section, **SOURCES[section], "read_at": held_build.now_iso(),
            "searched_for": searched, "names": M.public_names(company.get("names") or [])}


def _no_name(section: str, sym: str, company: dict) -> tuple[dict, str]:
    return ({**_base(section, sym, company, None), "state": "no_name", "counted": [], "not_counted": [],
             "not_counted_total": 0}, f"{section} {sym} no company name to search with")


def _state(body: dict) -> str:
    return "matched" if body.get("counted") else "no_match"


# ── the four sections ────────────────────────────────────────────────────────────────────────

AWARD_FIELDS = ["Award ID", "Recipient Name", "recipient_id", "Base Obligation Date", "Award Amount", "Awarding Agency",
                "Awarding Sub Agency", "Description", "Place of Performance State Code",
                "Place of Performance Country Code", "Primary Place of Performance", "Contract Award Type",
                "generated_internal_id"]
CONTRACT_TYPES = ["A", "B", "C", "D"]


def _contracts_build_for(sym: str):
    def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
        company = _company(sym)
        names = company.get("names") or []
        search = M.search_text(names)
        if not search:
            return _no_name("contracts", sym, company)
        win = P.contract_windows(_today())
        log: list[str] = []
        with _Slot("usaspending"):
            def by_recipient(window):
                return fetch_json("usaspending", "POST", f"{USA_BASE}/api/v2/search/spending_by_category/recipient/", log=log,
                                  body={"filters": {"recipient_search_text": [search], "award_type_codes": CONTRACT_TYPES,
                                                    "time_period": [{"start_date": window[0], "end_date": window[1]}]},
                                        "limit": USA_RECIPIENTS, "page": 1})
            recent = by_recipient(win["recent"])
            prior = by_recipient(win["prior"])
            awards = fetch_json("usaspending", "POST", f"{USA_BASE}/api/v2/search/spending_by_award/", log=log, body={
                "filters": {"recipient_search_text": [search], "award_type_codes": CONTRACT_TYPES,
                            "time_period": [{"start_date": win["recent"][0], "end_date": win["recent"][1],
                                             "date_type": "new_awards_only"}]},
                "fields": AWARD_FIELDS, "sort": "Award Amount", "order": "desc", "limit": USA_AWARDS, "page": 1})
        try:
            body = P.shape_contracts(recent, prior, awards, names)
        except ValueError:
            raise held_build.Stop("unavailable", "shape", 200, hold=SHAPE_HOLD_S, note=f"contracts {sym} shape") from None
        answer = {**_base("contracts", sym, company, search), "windows": win, **body}
        answer["state"] = _state(body)
        return answer, (f"contracts {sym} {','.join(log)} counted={len(body['counted'])} "
                        f"awards={len(body['awards'])}")
    return build


def _ct_version() -> Optional[str]:
    """ClinicalTrials.gov's data timestamp, read at most every `CT_VERSION_TTL_S` (a miss is None)."""
    with _ct_lock:
        if _ct_version_state["value"] is not None and time.time() - _ct_version_state["at"] < CT_VERSION_TTL_S:
            return _ct_version_state["value"]
    try:
        value = P.data_timestamp(fetch_json("ctgov", "GET", f"{CT_BASE}/api/v2/version"))
    except held_build.Stop:
        return _ct_version_state["value"]
    with _ct_lock:
        _ct_version_state.update({"value": value, "at": time.time()})
    return value


_ct_lock = threading.Lock()
_ct_version_state: dict[str, Any] = {"value": None, "at": 0.0}


def essie_words(search: str) -> str:
    """The search words for ClinicalTrials.gov's query language: its operators (AND, OR, NOT) dropped."""
    return " ".join(w for w in search.split() if w not in ("AND", "OR", "NOT"))


def _trials_build_for(sym: str):
    def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
        company = _company(sym)
        names = company.get("names") or []
        search = M.search_core(names)
        if not search:
            return _no_name("trials", sym, company)
        words = essie_words(search) or search
        since = (_today() - timedelta(days=CLOSED_TRIAL_DAYS)).isoformat()
        fields = "|".join(P.TRIAL_FIELDS)
        log: list[str] = []
        with _Slot("ctgov"):
            active = fetch_json("ctgov", "GET", f"{CT_BASE}/api/v2/studies", log=log, params={
                "query.lead": words, "filter.overallStatus": "|".join(P.ACTIVE_STATUSES), "fields": fields,
                "pageSize": CT_ACTIVE_PAGE, "countTotal": "true", "sort": "LastUpdatePostDate:desc"})
            closed = fetch_json("ctgov", "GET", f"{CT_BASE}/api/v2/studies", log=log, params={
                "query.lead": words, "filter.overallStatus": "|".join(P.CLOSED_STATUSES),
                "filter.advanced": f"AREA[LastUpdatePostDate]RANGE[{since},MAX]", "fields": fields,
                "pageSize": CT_CLOSED_PAGE, "countTotal": "true", "sort": "LastUpdatePostDate:desc"})
            processed = _ct_version()
        try:
            body = P.shape_trials(active, closed, names)
        except ValueError:
            raise held_build.Stop("unavailable", "shape", 200, hold=SHAPE_HOLD_S, note=f"trials {sym} shape") from None
        answer = {**_base("trials", sym, company, words), "data_processed": processed, "closed_since": since, **body}
        answer["state"] = "matched" if (body["active"] or body["closed"]) else "no_match"
        return answer, (f"trials {sym} {','.join(log)} active={body['active_matched']} closed={body['closed_matched']}")
    return build


def _fda_build_for(sym: str):
    def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
        company = _company(sym)
        names = company.get("names") or []
        search = M.search_core(names)
        if not search:
            return _no_name("fda", sym, company)
        today = _today()
        start = P.shift_years(today, -FDA_YEARS)
        query = (f'sponsor_name:"{search}" AND submissions.submission_status_date:'
                 f'[{start.strftime("%Y%m%d")} TO {today.strftime("%Y%m%d")}]')
        log: list[str] = []
        with _Slot("openfda"):
            # openFDA answers a search that finds nothing with a 404 (its documented NOT_FOUND error):
            # an empty answer, not a refusal, so the host is not held back for it
            got = fetch_json("openfda", "GET", f"{FDA_BASE}/drug/drugsfda.json", log=log,
                             params={"search": query, "limit": FDA_LIMIT}, none_on=(404,))
            if got is None:
                got = {"meta": {}, "results": []}
        try:
            body = P.shape_fda(got, names, start.isoformat())
        except ValueError:
            raise held_build.Stop("unavailable", "shape", 200, hold=SHAPE_HOLD_S, note=f"fda {sym} shape") from None
        answer = {**_base("fda", sym, company, search), "since": start.isoformat(), **body}
        answer["state"] = _state(body)
        return answer, f"fda {sym} {','.join(log)} counted={len(body['counted'])} actions={body['actions_matched']}"
    return build


def lda_words(search: str) -> str:
    """LDA.gov matches a client's name by the text it CONTAINS, so the words go as clients write them:
    lower case, and AND as "&" (a client is "JOHNSON & JOHNSON"; the normalised name says AND)."""
    return " ".join("&" if w == "AND" else w for w in search.split()).lower()


def _lobbying_build_for(sym: str):
    def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
        company = _company(sym)
        names = company.get("names") or []
        search = M.search_text(names)
        if not search:
            return _no_name("lobbying", sym, company)
        words = lda_words(search)
        quarters = P.last_quarters(_today(), LDA_QUARTERS)
        years = sorted({q["year"] for q in quarters}, reverse=True)
        filings: list[dict] = []
        log: list[str] = []
        pages, cut, dropped, counts = 0, False, 0, {}
        with _Slot("lda"):
            for year in years:
                page = 1
                while True:
                    if pages >= LDA_MAX_PAGES:
                        cut = True
                        break
                    got = fetch_json("lda", "GET", f"{LDA_BASE}/api/v1/filings/", log=log, params={
                        "client_name": words, "filing_year": year, "page_size": LDA_PAGE_SIZE,
                        "ordering": "-dt_posted", "page": page})
                    pages += 1
                    try:
                        rows, count, more, bad = P.filing_rows(got)
                    except ValueError:
                        raise held_build.Stop("unavailable", "shape", 200, hold=SHAPE_HOLD_S,
                                              note=f"lobbying {sym} shape") from None
                    filings.extend(rows)
                    dropped += bad
                    counts[year] = count
                    if not more:
                        break
                    page += 1
                if cut:
                    break
        body = P.shape_lobbying(filings, names, quarters)
        answer = {**_base("lobbying", sym, company, words), **body, "filings_read": len(filings),
                  "filings_held": sum(c for c in counts.values() if isinstance(c, int)), "cut": cut, "dropped": dropped}
        answer["state"] = _state(body)
        return answer, f"lobbying {sym} pages={pages} {','.join(log)} counted={len(body['counted'])} cut={cut}"
    return build


def refresh_due(answer: dict, checked: float, now: Optional[float] = None) -> bool:
    """Pure: a held section is due after a day."""
    return ((time.time() if now is None else now) - float(checked or 0)) >= TTL_S


def _section_valid(held: dict) -> bool:
    return held.get("status") == "ok" and held.get("state") in ("matched", "no_match", "no_name")


_sections: dict[str, KeyedHeld] = {
    "contracts": KeyedHeld("public-records-contracts", _contracts_build_for, refresh_due, max_keys=MAX_KEYS, valid=_section_valid),
    "trials": KeyedHeld("public-records-trials", _trials_build_for, refresh_due, max_keys=MAX_KEYS, valid=_section_valid),
    "fda": KeyedHeld("public-records-fda", _fda_build_for, refresh_due, max_keys=MAX_KEYS, valid=_section_valid),
    "lobbying": KeyedHeld("public-records-lobbying", _lobbying_build_for, refresh_due, max_keys=MAX_KEYS, valid=_section_valid),
}
SECTIONS = tuple(_sections)


def _company_public(got: Optional[dict]) -> dict:
    if not got or got.get("status") != "ok":
        return {"status": (got or {}).get("status") or "computing", "source": COMPANY_SOURCE}
    return {"status": "ok", "source": COMPANY_SOURCE, "cik": got.get("cik"), "sec_state": got.get("sec_state"),
            "names": M.public_names(got.get("names") or []), "read_at": got.get("read_at")}


def _section_public(section: str, got: dict) -> dict:
    if got.get("status") == "ok":
        return got
    return {"status": got.get("status") or "failed", "reason": got.get("reason"), "http_status": got.get("http_status"),
            "section": section, **SOURCES[section]}


def get_public_records(sym: str, *, wait_s: Optional[float] = None) -> dict:
    """The route's body. Never builds on the caller's thread: each held answer at once, else the builds
    it starts (one per section and one for the company's names) waited on for `WAIT_S` in all."""
    budget = WAIT_S if wait_s is None else wait_s
    ends = time.monotonic() + budget
    _identity.get(sym, wait_s=0)
    got = {k: held.get(sym, wait_s=0) for k, held in _sections.items()}
    for k, held in _sections.items():
        left = ends - time.monotonic()
        if got[k].get("status") == "computing" and left > 0:
            got[k] = held.get(sym, wait_s=left)
    out = {"status": "ok", "sym": sym, "company": _company_public(_identity.peek(sym))}
    for k in SECTIONS:
        out[k] = _section_public(k, got[k])
    return out


def held_records(sym: str) -> dict:
    """READ ONLY, for a caller that must not cause work (the agent, later): what is held, never a build."""
    out = {"status": "ok", "sym": sym, "company": _company_public(_identity.peek(sym))}
    for k, held in _sections.items():
        got = held.peek(sym)
        out[k] = _section_public(k, got) if got else {"status": "not_held", "section": k, **SOURCES[k]}
    return out


def reset_for_tests() -> None:
    _identity.reset()
    for held in _sections.values():
        held.reset()
    for k in list(_hosts):
        _hosts[k] = _Host(k)
    with _ct_lock:
        _ct_version_state.update({"value": None, "at": 0.0})


def drain_for_tests(timeout: float = 5.0) -> None:
    _identity.drain(timeout)
    for held in _sections.values():
        held.drain(timeout)
