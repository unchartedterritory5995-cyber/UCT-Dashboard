"""FED, the Terminal's Fed watch: the latest FOMC statement and what changed, Fed speeches and
testimony, live Fed headlines, the next meeting and the policy rate, the officials' own rate
projections, and the New York Fed's survey of what market professionals expect.

ONE ANSWER, SEVEN BLOCKS, EACH WITH ITS OWN SOURCE IN WORDS AND ITS OWN AS-OF:

  statement    Federal Reserve Board. The newest "Federal Reserve issues FOMC statement" in the
               Board's monetary policy feed and the one before it, both pages read once and held for
               good (a published statement never changes), and the word-level difference between
               them (`fed_watch_parse.redline`). The minutes link is the newest minutes item in the
               same feed; the implementation note link is the one on the statement page.
  speeches     Federal Reserve Board. The speeches and testimony feeds, newest 15. Title, speaker,
               where and the link only: the speech pages are not read.
  projections  Federal Reserve Board. The median projection of the federal funds rate by year and the
               longer run, from the newest Summary of Economic Projections the monetary policy feed
               names, read once from its accessible table page and held for good.
  survey       Federal Reserve Bank of New York. The newest Survey of Market Expectations data file
               the survey page links to (read once and held for good), the page itself looked at no
               more than every `SURVEY_PAGE_TTL_S`.
  headlines    TradeXchange. The newest Fed headlines in the headline store the news widget reads
               (`api/services/trade_exchange_news`): never a vendor call.
  calendar     the economic calendar. The next FOMC decision and this week's Fed speakers, read
               only from the calendar weeks the site already holds (`api/routers/calendar.py`'s
               caches): never a build, never a provider call.
  rates        Federal Reserve Bank of New York, through the economics store (`api/services/econ`):
               the effective federal funds rate and the target range, each with its own date, read
               only while that feature is switched on (`ECON_ENABLED`, its own flag).

OUTBOUND (all keyless public pages; nothing else is ever asked):
  https://www.federalreserve.gov/feeds/press_monetary.xml
  https://www.federalreserve.gov/feeds/speeches.xml
  https://www.federalreserve.gov/feeds/testimony.xml
  https://www.federalreserve.gov/newsevents/pressreleases/monetaryYYYYMMDDa.htm   (a statement, each once)
  https://www.federalreserve.gov/monetarypolicy/fomcprojtablYYYYMMDD.htm          (projections, each once)
  https://www.newyorkfed.org/markets/market-intelligence/survey-of-market-expectations
  https://www.newyorkfed.org/medialibrary/media/markets/survey/YYYY/<mon>-YYYY-data.xlsx (each once)
The shapes are as the public pages gave them on 2026-11-21 (`fed_watch_parse`). THIS SERVER HAS
NEVER ASKED THEM: a government website may answer a server differently from a browser, so a
refusal (a 4xx or a redirect, never followed) is a first-class answer, `unavailable`, remembered
for `REFUSED_HOLD_S`; a 429 is remembered for `RATE_LIMITED_HOLD_S`; a timeout or a 5xx is `failed`;
a body that is not the expected shape is `unavailable` with reason `shape`. Every background build
writes ONE log line, prefix `[fed-watch]`, naming each request's status.

HOW OFTEN (the house pattern of `api/services/treasury_yields.py`): a request NEVER fetches. It
answers from what this module holds at once and, when something is due, starts ONE background
build (one at a time, whatever the number of members). With nothing held yet the Board's blocks say
`computing` at once (`WAIT_S` is none) and the panel asks again every 3 seconds.
  * each Board feed: at most once per `feed_ttl` (10 minutes on weekdays 07:00-20:00 New York time,
    an hour otherwise), counted from the last ATTEMPT, so a failing feed is not asked more often;
  * a statement page, a projections page, a survey data file: once each, ever (held in memory and
    on disk); a failed one waits `PAGE_RETRY_S` (or the refusal hold) before it is asked again;
  * the survey page: at most once per `SURVEY_PAGE_TTL_S`.
The most this module can ask in an hour is 18 feed reads, plus a new statement, a new projections
page and a new survey file the hour each is published, plus one survey page read.

The answer and the pages it was built from are held in this module AND on disk under the data
directory, so a restart does not start cold. `held_answer` is read-only for a caller that must not
cause work (the agent, later).

THE REQUEST READS NOTHING ITSELF (speed pass 3, 2026-11-24; live, a first open took 7.1 s and the next one 1.5 s).
The two blocks that read on the request are served from what this module holds, refreshed off it:
  * rates      `rates_served`: the block `rates_block` builds (three series through the economics store, which goes
               to the data bucket whenever its 120 s cache has lapsed, and computes an ETag over each whole series
               on every call), held here and refreshed by ONE background thread (`RATES_THREAD`) once it is older
               than that cache's own lifetime. It is kept on disk for its New York day (`rates_v1.json`; a copy for
               another day, registry, version or shape is never served). A refresh that comes back with fewer
               figures than the block held for the same day is a failed read: it never replaces the held block and
               is tried again after `RATES_RETRY_S`. Nothing held yet: the block says `computing`.
  * headlines  `headlines_served`: the newest outcome of `headlines_block`, run by ONE background pass
               (`HEADLINES_THREAD`) every `HEADLINE_MIN_S` while requests keep coming (`HEADLINE_WATCH_S`), so the
               list is as fresh as a request's own pass made it; the pass stops when no one is asking. Nothing held
               yet: the block says `computing`.
The other blocks are made from what is held in memory, as before. `warm` (a boot DATE job) starts both.

NOTHING HERE IS A FORECAST BY UCT: the projections are the officials' own, the survey numbers are
its respondents', and there is no AI and no summary of any Fed text.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from api.services import fed_watch_parse as P

_log = logging.getLogger(__name__)

#: the house form for an official source (api/services/econ/http.py): who is asking, no address
USER_AGENT = "UCT-Intelligence fed-watch (contact: see docs)"
FEEDS = {
    "monetary": f"{P.BOARD_BASE}/feeds/press_monetary.xml",
    "speeches": f"{P.BOARD_BASE}/feeds/speeches.xml",
    "testimony": f"{P.BOARD_BASE}/feeds/testimony.xml",
}
SURVEY_PAGE_URL = f"{P.NYFED_BASE}{P.SURVEY_PAGE_PATH}"

SOURCE_BOARD = "Federal Reserve Board"
SOURCE_NYFED = "Federal Reserve Bank of New York"
SOURCE_TX = "TradeXchange"
SOURCE_CALENDAR = "the economic calendar"
#: the Board's disclaimer asks to be cited (https://www.federalreserve.gov/disclaimer.htm)
BOARD_CITE = "Source: Board of Governors of the Federal Reserve System."
#: the New York Fed's default attribution (api/services/econ/registry/attributions.json `nyfed`)
NYFED_CREDIT = ("© {year} Federal Reserve Bank of New York. Content from the New York Fed subject to the "
                "Terms of Use at newyorkfed.org.")
#: the reference-rate notice the same terms require beside the effective rate and the target range
NYFED_RATE_NOTICE = ("The effective federal funds rate and the federal funds target range are subject to the Terms "
                     "of Use posted at newyorkfed.org. The New York Fed is not responsible for publication of the "
                     "effective federal funds rate and the federal funds target range by UCT Intelligence, does not "
                     "sanction or endorse any particular republication, and has no liability for your use.")

# ── defaults (each one is the builder's, not an owner ruling) ────────────────────────────────
FEED_TTL_DAY_S = 600.0          # a feed is read at most every 10 minutes on a weekday, 07:00-20:00 ET
FEED_TTL_QUIET_S = 3600.0       # and at most hourly otherwise
DAY_HOURS_ET = (7, 20)
SURVEY_PAGE_TTL_S = 6 * 3600.0  # the survey page is looked at no more than every six hours
PAGE_RETRY_S = 600.0            # a statement, projections or survey file that failed waits this long
REFUSED_HOLD_S = 6 * 3600.0     # a refusal (a 4xx or a redirect) is not asked again for this long
RATE_LIMITED_HOLD_S = 900.0     # a 429
SHAPE_HOLD_S = 6 * 3600.0       # a page that answered, but not in a shape this module reads
HTTP_TIMEOUT = (10, 30)         # connect, read (seconds)
MAX_FEED_BYTES = 1_000_000      # a feed is about 10 kB
MAX_PAGE_BYTES = 3_000_000      # a statement page is about 85 kB, the projections page about 250 kB
MAX_FILE_BYTES = 8_000_000      # a survey data file is about 180 kB
PAUSE_S = 1.0                   # between two requests of one build
WAIT_S = 0.0                    # the longest a request waits on the build it started: none (speed pass 2026-11-23)
KEEP_STATEMENTS = 6
KEEP_PROJECTIONS = 2
KEEP_SURVEYS = 2
HEADLINE_SCAN = 3000            # the newest headlines on the wire the Fed headlines are picked from
HEADLINE_MIN_S = 10.0           # the Fed headlines are worked out again at most this often
CALENDAR_WEEKS_AHEAD = 8        # held calendar weeks looked through for the next meeting
DISK_VERSION = 1
RATES_DISK_VERSION = 1
RATES_RETRY_S = 60.0            # a rates refresh that gave fewer figures than the block held is tried again after this
HEADLINE_WATCH_S = 90.0         # the headline pass runs while a request came this recently (the panel asks every minute)
RATES_THREAD = "fed-watch-rates"
HEADLINES_THREAD = "fed-watch-headlines"
WARM_BOOT_DELAY_S = 540         # the boot DATE job's offset (api/main.py): past the busy minutes, an offset no other job uses

_lock = threading.Lock()
_gen = 0                        # bumped by reset_for_tests: a thread started before it writes nothing


def _blank_state() -> dict:
    return {
        "feeds": {},          # name -> {items, read_at, checked, retry_at, check}
        "statements": {},     # url -> {date, title, paragraphs, implementation_note_url, date_text, read_at}
        "projections": {},    # table url -> {meeting, date, release_url, medians, materials_date, read_at}
        "surveys": {},        # file url -> {year, month, extract, read_at}
        "pages": {},          # url -> {retry_at, check}: a page read that did not go well
        "survey_page": {"checked": 0.0, "retry_at": 0.0, "check": None, "links": []},
        "loaded": False,
        "inflight": None,
        "headlines": None,    # (top seq, built at, answer)
        "rates": None,        # {block, day, servable, checked}: the rates block, refreshed off the request
        "rates_loaded": False,  # the disk copy has been looked for in this process
        "rates_retry_at": 0.0,
        "rates_inflight": None,
        "headlines_last": None,  # the headline pass's newest outcome (the answer `headlines_block` gave it)
        "headlines_worker": None,  # the running headline pass's done event
        "asked_at": 0.0,      # the newest request (the headline pass runs while one came within HEADLINE_WATCH_S)
    }


_state: dict[str, Any] = _blank_state()


class _Stop(Exception):
    """A read that did not give a usable body. `state`: 'unavailable' | 'failed'."""

    def __init__(self, state: str, http_status: Optional[int] = None, reason: Optional[str] = None,
                 hold: float = PAGE_RETRY_S):
        super().__init__(reason or state)
        self.state = state
        self.http_status = http_status
        self.reason = reason
        self.hold = hold


# ── the readers (each one small, so a test can stand in for it) ──────────────────────────────

def _http_get(url: str, accept: str, max_bytes: int) -> tuple[int, str, bytes]:
    """ONE GET: (status, content type, body). No redirect is followed and no more than `max_bytes`
    (and one more) is read. Raises whatever the HTTP library raises."""
    import requests
    with requests.get(url, timeout=HTTP_TIMEOUT, allow_redirects=False, stream=True,
                      headers={"User-Agent": USER_AGENT, "Accept": accept}) as resp:
        body = resp.raw.read(max_bytes + 1, decode_content=True) or b""
        return resp.status_code, str(resp.headers.get("Content-Type") or ""), body


def _pause(seconds: float) -> None:
    time.sleep(seconds)


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
    return os.path.join(base, "fed_watch", f"fed_watch_v{DISK_VERSION}.json") if base else None


def fetch(url: str, accept: str, max_bytes: int) -> bytes:
    """One body, or `_Stop`. The status decides: 200 is the body; 429 a remembered failure; 408 or
    5xx a failure; any other answer (a 3xx, a 403, a 404) a refusal, never worked around."""
    try:
        status, _ctype, body = _http_get(url, accept, max_bytes)
    except Exception as exc:  # noqa: BLE001 -- only the error's class is ever logged, never its text
        name = type(exc).__name__
        raise _Stop("failed", None, "timeout" if "timeout" in name.lower() else "source", PAGE_RETRY_S) from None
    if status == 429:
        raise _Stop("failed", 429, "rate_limited", RATE_LIMITED_HOLD_S)
    if status == 408 or status >= 500:
        raise _Stop("failed", status, "source", PAGE_RETRY_S)
    if status != 200:
        raise _Stop("unavailable", status, "refused", REFUSED_HOLD_S)
    if len(body) > max_bytes:
        raise _Stop("unavailable", 200, "shape", SHAPE_HOLD_S)
    return body


def feed_ttl(now: Optional[datetime] = None) -> float:
    """Pure: how long one Board feed read stands: 10 minutes in a weekday's working hours (New York
    time), an hour otherwise."""
    now = now or now_et()
    busy = now.weekday() < 5 and DAY_HOURS_ET[0] <= now.hour < DAY_HOURS_ET[1]
    return FEED_TTL_DAY_S if busy else FEED_TTL_QUIET_S


# ── disk ─────────────────────────────────────────────────────────────────────────────────────

_DISK_KEYS = ("feeds", "statements", "projections", "surveys", "survey_page")


def _save_disk() -> None:
    path = _disk_path()
    if not path:
        return
    with _lock:
        doc = {"v": DISK_VERSION, **{k: _state[k] for k in _DISK_KEYS}}
        blob = json.dumps(doc)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".fedwatch_", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(blob)
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:  # noqa: BLE001 -- the answer is still held in memory
        _log.warning("[fed-watch] the held pages could not be written to disk (%s)", type(exc).__name__)


def _load_disk() -> Optional[dict]:
    path = _disk_path()
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("v") != DISK_VERSION:
        return None
    out = {}
    for k in _DISK_KEYS:
        if not isinstance(doc.get(k), dict):
            return None
        out[k] = doc[k]
    now = time.time()
    for feed in out["feeds"].values():                      # a clock from the future is not trusted
        if isinstance(feed, dict):
            feed["checked"] = min(float(feed.get("checked") or 0.0), now)
    sp = out["survey_page"]
    sp["checked"] = min(float(sp.get("checked") or 0.0), now)
    return out


def _ensure_loaded() -> None:
    with _lock:
        if _state["loaded"]:
            return
    doc = _load_disk()
    with _lock:
        if _state["loaded"]:
            return
        _state["loaded"] = True
        if doc:
            for k in ("feeds", "statements", "projections", "surveys"):
                if not _state[k]:
                    _state[k] = doc[k]
            sp = _state["survey_page"]
            if not sp.get("links") and not sp.get("checked"):
                _state["survey_page"] = {**_blank_state()["survey_page"], **doc["survey_page"]}


# ── what is due ──────────────────────────────────────────────────────────────────────────────

def _feed_due(name: str, now: float, ttl: float) -> bool:
    f = _state["feeds"].get(name) or {}
    return now - float(f.get("checked") or 0.0) >= ttl and now >= float(f.get("retry_at") or 0.0)


def _page_due(url: str, now: float) -> bool:
    p = _state["pages"].get(url)
    return p is None or now >= float(p.get("retry_at") or 0.0)


def _survey_page_due(now: float) -> bool:
    sp = _state["survey_page"]
    return now - float(sp.get("checked") or 0.0) >= SURVEY_PAGE_TTL_S and now >= float(sp.get("retry_at") or 0.0)


def plan(now: Optional[float] = None, ttl: Optional[float] = None) -> list[tuple[str, str]]:
    """Pure over the held state: the requests one build would make, in order, as (kind, url):
    the feeds that are due, the statement pages and projections page the held monetary feed names
    that are not held yet, then the survey page when due and the newest survey file not held."""
    now = time.time() if now is None else now
    ttl = feed_ttl() if ttl is None else ttl
    out: list[tuple[str, str]] = []
    with _lock:
        for name, url in FEEDS.items():
            if _feed_due(name, now, ttl):
                out.append(("feed:" + name, url))
        items = (_state["feeds"].get("monetary") or {}).get("items") or []
        for s in P.statement_items(items)[:2]:
            if s["url"] not in _state["statements"] and _page_due(s["url"], now):
                out.append(("statement", s["url"]))
        proj = P.projections_item(items)
        if proj and proj["table_url"] not in _state["projections"] and _page_due(proj["table_url"], now):
            out.append(("projections", proj["table_url"]))
        if _survey_page_due(now):
            out.append(("survey_page", SURVEY_PAGE_URL))
        newest = next(iter(_state["survey_page"].get("links") or []), None)
        if newest and newest["url"] not in _state["surveys"] and _page_due(newest["url"], now):
            out.append(("survey_file", newest["url"]))
    return out


def refresh_due(now: Optional[float] = None) -> bool:
    return bool(plan(now))


# ── one background build ─────────────────────────────────────────────────────────────────────

def _remember_page_stop(url: str, stop: _Stop) -> None:
    with _lock:
        _state["pages"][url] = {"retry_at": time.time() + stop.hold,
                                "check": {"state": stop.state, "reason": stop.reason, "http_status": stop.http_status,
                                          "at": _now_iso()}}


def _trim(d: dict, keep: int, key: Callable[[dict], Any]) -> dict:
    if len(d) <= keep:
        return d
    newest = sorted(d.items(), key=lambda kv: key(kv[1]), reverse=True)[:keep]
    return dict(newest)


def _read_feed(name: str, url: str) -> str:
    started = time.time()
    try:
        body = fetch(url, "application/rss+xml, application/xml, text/xml", MAX_FEED_BYTES)
        try:
            items = P.parse_rss(body)
        except P.Shape as shape:
            raise _Stop("unavailable", 200, "shape", SHAPE_HOLD_S) from shape
    except _Stop as stop:
        with _lock:
            f = _state["feeds"].setdefault(name, {})
            f["checked"], f["retry_at"] = started, started + stop.hold
            f["check"] = {"state": stop.state, "reason": stop.reason, "http_status": stop.http_status, "at": _now_iso()}
        return f"{name}={stop.http_status or stop.reason}"
    with _lock:
        _state["feeds"][name] = {"items": items, "read_at": _now_iso(), "checked": started, "retry_at": 0.0, "check": None}
    return f"{name}=200({len(items)})"


def _read_statement(url: str) -> str:
    try:
        body = fetch(url, "text/html", MAX_PAGE_BYTES)
        try:
            got = P.extract_statement(body)
        except P.Shape as shape:
            raise _Stop("unavailable", 200, "shape", SHAPE_HOLD_S) from shape
    except _Stop as stop:
        _remember_page_stop(url, stop)
        return f"statement={stop.http_status or stop.reason}"
    with _lock:
        items = (_state["feeds"].get("monetary") or {}).get("items") or []
        meta = next((s for s in P.statement_items(items) if s["url"] == url), {})
        _state["statements"][url] = {"url": url, "date": meta.get("date") or P.press_day(url),
                                     "title": meta.get("title"), "read_at": _now_iso(), **got}
        _state["statements"] = _trim(_state["statements"], KEEP_STATEMENTS, lambda s: s.get("date") or "")
        _state["pages"].pop(url, None)
    return f"statement=200({len(got['paragraphs'])}p)"


def _read_projections(url: str) -> str:
    try:
        body = fetch(url, "text/html", MAX_PAGE_BYTES)
        try:
            got = P.parse_projections(body)
        except P.Shape as shape:
            raise _Stop("unavailable", 200, "shape", SHAPE_HOLD_S) from shape
    except _Stop as stop:
        _remember_page_stop(url, stop)
        return f"projections={stop.http_status or stop.reason}"
    with _lock:
        items = (_state["feeds"].get("monetary") or {}).get("items") or []
        meta = P.projections_item(items) or {}
        _state["projections"][url] = {"meeting": meta.get("meeting"), "date": meta.get("date"),
                                      "release_url": meta.get("release_url"), "read_at": _now_iso(), **got}
        _state["projections"] = _trim(_state["projections"], KEEP_PROJECTIONS, lambda s: s.get("date") or "")
        _state["pages"].pop(url, None)
    return f"projections=200({len(got['medians'])})"


def _read_survey_page() -> str:
    started = time.time()
    try:
        body = fetch(SURVEY_PAGE_URL, "text/html", MAX_PAGE_BYTES)
        links = P.survey_data_links(body)
        if not links:
            raise _Stop("unavailable", 200, "shape", SHAPE_HOLD_S)
    except _Stop as stop:
        with _lock:
            sp = _state["survey_page"]
            sp["checked"], sp["retry_at"] = started, started + stop.hold
            sp["check"] = {"state": stop.state, "reason": stop.reason, "http_status": stop.http_status, "at": _now_iso()}
        return f"survey_page={stop.http_status or stop.reason}"
    with _lock:
        _state["survey_page"] = {"checked": started, "retry_at": 0.0, "check": None, "links": links[:3],
                                 "read_at": _now_iso()}
    return f"survey_page=200({len(links)})"


def _read_survey_file(url: str) -> str:
    try:
        body = fetch(url, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", MAX_FILE_BYTES)
        try:
            extract = P.survey_extract(P.read_xlsx_rows(body))
        except P.Shape as shape:
            raise _Stop("unavailable", 200, "shape", SHAPE_HOLD_S) from shape
    except _Stop as stop:
        _remember_page_stop(url, stop)
        return f"survey_file={stop.http_status or stop.reason}"
    with _lock:
        link = next((ln for ln in _state["survey_page"].get("links") or [] if ln["url"] == url), {})
        _state["surveys"][url] = {"year": link.get("year"), "month": link.get("month"), "extract": extract,
                                  "read_at": _now_iso()}
        _state["surveys"] = _trim(_state["surveys"], KEEP_SURVEYS,
                                  lambda s: (s.get("year") or 0, s.get("month") or 0))
        _state["pages"].pop(url, None)
    return "survey_file=200"


def build() -> str:
    """Make the requests that are due, one after another on the calling (background) thread,
    `PAUSE_S` apart, feeds first (the pages they name are planned again after them). Returns the
    log line's text. Each read records its own outcome; one failing never stops the others."""
    said: list[str] = []
    asked = 0
    done: set[str] = set()
    for _round in range(2):                      # the second round sees the pages a fresh feed names
        for kind, url in plan():
            if url in done:
                continue
            done.add(url)
            if asked:
                _pause(PAUSE_S)
            asked += 1
            if kind.startswith("feed:"):
                said.append(_read_feed(kind[5:], url))
            elif kind == "statement":
                said.append(_read_statement(url))
            elif kind == "projections":
                said.append(_read_projections(url))
            elif kind == "survey_page":
                said.append(_read_survey_page())
            elif kind == "survey_file":
                said.append(_read_survey_file(url))
    return f"requests={asked} " + " ".join(said) if said else "requests=0"


def _build_bg(done: threading.Event) -> None:
    started = time.time()
    said, level = "failed", logging.WARNING
    try:
        said = build()
        level = logging.INFO
    except Exception as exc:  # noqa: BLE001 -- a failed build is said, never left as "computing" for ever
        said = f"failed ({type(exc).__name__})"
    finally:
        try:
            _save_disk()
        finally:
            _log.log(level, "[fed-watch] %s; %.2fs", said, time.time() - started)
            with _lock:
                _state["inflight"] = None
            done.set()


def _start_job() -> threading.Event:
    with _lock:
        done = _state["inflight"]
        if done is None:
            done = _state["inflight"] = threading.Event()
            threading.Thread(target=_build_bg, args=(done,), daemon=True, name="fed-watch-build").start()
        return done


def _board_held() -> bool:
    with _lock:
        return bool(_state["feeds"].get("monetary", {}).get("items") is not None
                    or _state["feeds"].get("speeches", {}).get("items") is not None)


# ── the blocks ───────────────────────────────────────────────────────────────────────────────

def _feed_state(name: str, computing: bool) -> tuple[str, Optional[dict]]:
    """('ok' | 'computing' | 'unavailable' | 'failed', the last look's check) for one feed."""
    f = _state["feeds"].get(name) or {}
    if f.get("items") is not None:
        return "ok", f.get("check")
    check = f.get("check")
    if check:
        return check["state"], check
    return ("computing" if computing else "failed"), None


_REDLINES: dict[tuple, dict] = {}


def _redline_for(new: dict, old: dict) -> dict:
    key = (new.get("date"), old.get("date"), len(new.get("paragraphs") or []), len(old.get("paragraphs") or []))
    hit = _REDLINES.get(key)
    if hit is None:
        hit = P.redline(old.get("paragraphs") or [], new.get("paragraphs") or [])
        if len(_REDLINES) > 8:
            _REDLINES.clear()
        _REDLINES[key] = hit
    return hit


def statement_block(computing: bool) -> dict:
    state, check = _feed_state("monetary", computing)
    feed = _state["feeds"].get("monetary") or {}
    out: dict[str, Any] = {"state": state, "source": SOURCE_BOARD, "read_at": feed.get("read_at"), "check": check}
    if state != "ok":
        return out
    items = feed.get("items") or []
    listed = P.statement_items(items)
    minutes = P.minutes_item(items)
    out["minutes"] = minutes
    held = sorted(_state["statements"].values(), key=lambda s: s.get("date") or "", reverse=True)
    newest = listed[0] if listed else (held[0] if held else None)
    if newest is None:
        out["state"] = "none"
        return out
    page = _state["statements"].get(newest["url"]) if newest.get("url") else newest
    out.update(date=newest.get("date"), url=newest.get("url"), title=newest.get("title"))
    if page is None:
        miss = _state["pages"].get(newest["url"])
        out["state"] = "computing" if miss is None else "unreadable"
        out["page_check"] = miss.get("check") if miss else None
        return out
    out["implementation_note_url"] = page.get("implementation_note_url")
    out["paragraphs"] = page.get("paragraphs") or []
    previous = next((s for s in held if (s.get("date") or "") < (newest.get("date") or "")), None)
    prev_listed = next((s for s in listed if (s.get("date") or "") < (newest.get("date") or "")), None)
    if previous is None:
        if prev_listed is not None and prev_listed["url"] not in _state["statements"]:
            miss = _state["pages"].get(prev_listed["url"])
            out["redline"] = {"state": "computing" if miss is None else "unreadable",
                              "previous": {"date": prev_listed["date"], "url": prev_listed["url"]}}
        else:
            out["redline"] = {"state": "no_previous"}
        return out
    red = _redline_for(page, previous)
    out["redline"] = {**red, "previous": {"date": previous.get("date"), "url": previous.get("url")}}
    return out


def speeches_block(computing: bool) -> dict:
    states = {name: _feed_state(name, computing) for name in ("speeches", "testimony")}
    lists, missing = [], []
    for name, kind in (("speeches", "speech"), ("testimony", "testimony")):
        if states[name][0] == "ok":
            lists.append(P.speech_items(_state["feeds"][name].get("items") or [], kind))
        else:
            missing.append(name)
    reads = [(_state["feeds"].get(n) or {}).get("read_at") for n in ("speeches", "testimony")]
    out: dict[str, Any] = {"source": SOURCE_BOARD, "read_at": max([r for r in reads if r] or [None], key=lambda r: r or ""),
                           "missing": missing, "checks": {n: s[1] for n, s in states.items() if s[1]}}
    if not lists:
        both = [s[0] for s in states.values()]
        out["state"] = "computing" if "computing" in both else ("unavailable" if "unavailable" in both else "failed")
        out.update(items=[], total=0)
        return out
    items, total = P.merge_speeches(*lists)
    out.update(state="ok", items=items, total=total, limit=P.MAX_SPEECHES)
    return out


def projections_block(computing: bool) -> dict:
    state, check = _feed_state("monetary", computing)
    out: dict[str, Any] = {"state": state, "source": SOURCE_BOARD, "check": check}
    if state != "ok":
        return out
    listed = P.projections_item((_state["feeds"].get("monetary") or {}).get("items") or [])
    held = sorted(_state["projections"].items(), key=lambda kv: kv[1].get("date") or "", reverse=True)
    if listed is None and not held:
        out["state"] = "none"
        return out
    url = listed["table_url"] if listed else held[0][0]
    page = _state["projections"].get(url)
    if page is None:
        miss = _state["pages"].get(url)
        out.update(state="computing" if miss is None else "unreadable", page_url=url,
                   release_url=listed.get("release_url") if listed else None, date=listed.get("date") if listed else None,
                   meeting=listed.get("meeting") if listed else None, page_check=miss.get("check") if miss else None)
        return out
    out.update(state="ok", page_url=url, release_url=page.get("release_url"), date=page.get("date"),
               meeting=page.get("meeting"), medians=page.get("medians") or [], read_at=page.get("read_at"))
    return out


def survey_block(computing: bool, today: str) -> dict:
    sp = _state["survey_page"]
    out: dict[str, Any] = {"source": SOURCE_NYFED, "page_url": SURVEY_PAGE_URL, "check": sp.get("check")}
    held = sorted(_state["surveys"].items(), key=lambda kv: (kv[1].get("year") or 0, kv[1].get("month") or 0), reverse=True)
    newest = next(iter(sp.get("links") or []), None)
    if newest and newest["url"] not in _state["surveys"]:
        miss = _state["pages"].get(newest["url"])
        if miss is not None and not held:
            out.update(state="unreadable", file_url=newest["url"], page_check=miss.get("check"))
            return out
        if miss is None and not held:
            out.update(state="computing", file_url=newest["url"])
            return out
    if not held:
        check = sp.get("check")
        out["state"] = check["state"] if check else ("computing" if computing else "failed")
        return out
    url, s = held[0]
    view = P.survey_view(s.get("extract") or {}, today)
    year, month = s.get("year"), s.get("month")
    out.update(state="ok", file_url=url, read_at=s.get("read_at"), year=year, month=month,
               survey=(f"{P.MONTH_NAMES[month - 1]} {year}" if year and month else None),
               credit=NYFED_CREDIT.format(year=year or now_et().year), **view)
    return out


def _surnames() -> list[str]:
    from api.routers.calendar import _fed_surnames
    try:
        return sorted(_fed_surnames())
    except Exception:  # noqa: BLE001 -- an unreadable roster leaves only the structural words
        return []


def headlines_block() -> dict:
    out: dict[str, Any] = {"source": SOURCE_TX, "items": []}
    try:
        from api.services.trade_exchange_news import config as txn_config
        from api.services.trade_exchange_news import pipeline as txn_pipeline
    except Exception:  # noqa: BLE001
        return {**out, "state": "failed"}
    if not txn_config.enabled():
        return {**out, "state": "off"}
    pipe = txn_pipeline.get()
    if pipe is None:
        return {**out, "state": "not_started"}
    try:
        store = pipe.store
        top = store.last_seq()
        now = time.time()
        with _lock:
            hit = _state["headlines"]
        if hit and (hit[0] == top or now - hit[1] < HEADLINE_MIN_S):
            return hit[2]
        rows = store.index_before(top + 1, HEADLINE_SCAN) if top else []
        surnames = _surnames()
        picked = [r for r in reversed(rows) if P.is_fed_headline(r[2], surnames)]
        answer = {**out, "state": "ok", "items": [_headline(r) for r in picked[:P.MAX_HEADLINES]],
                  "matched": len(picked), "scanned": len(rows), "limit": P.MAX_HEADLINES,
                  "newest_ms": rows[-1][3] if rows else None}
    except Exception as exc:  # noqa: BLE001 -- a store read that fails is said, never an empty list
        _log.warning("[fed-watch] the headline store could not be read (%s)", type(exc).__name__)
        return {**out, "state": "failed"}
    with _lock:
        _state["headlines"] = (top, now, answer)
    return answer


def _headline(row: tuple) -> dict:
    """(seq, source, content, received_at_ms, …) -> one Fed headline, with the tickers the news
    widget's own derivation finds in it."""
    tickers: list[str] = []
    try:
        from api.services.trade_exchange_news import archive as txn_archive
        tickers = [str(t) for t in (txn_archive.event_fields(row[1], row[2]).get("tickers") or [])][:6]
    except Exception:  # noqa: BLE001 -- the tickers are an extra; the headline stands without them
        tickers = []
    return {"seq": row[0], "text": P.clean_text(row[2]), "received_at_ms": row[3], "tickers": tickers}


def _calendar_payloads(today: date) -> list[Optional[dict]]:
    """The calendar weeks the site already holds, this week first. Read ONLY: never a build."""
    from api.services.cache import cache
    out: list[Optional[dict]] = []
    current = cache.get("calendar_weekly")
    if current is None:
        try:
            from api.routers import calendar as cal
            current, _at = cal._WEEKLY_STALE.peek("current")
        except Exception:  # noqa: BLE001
            current = None
    out.append(current)
    monday = today - timedelta(days=today.weekday())
    for i in range(1, CALENDAR_WEEKS_AHEAD + 1):
        out.append(cache.get(f"calendar_week_{(monday + timedelta(weeks=i)).isoformat()}"))
    # ⛔ TERM-030: every week this panel reads goes through the ONE shape assertion every other week
    # reader calls. A malformed week is counted, logged at ERROR and sent to the ops feed by name
    # (week_days does all three before it raises), then dropped HERE, so the panel treats it as a
    # week it does not hold ("not held" for this week; the survey's dates for the next meeting)
    # and never as a week with no Fed events. A well-formed or absent week passes through untouched.
    from api.services.calendar_week_contract import WeekContractViolation, week_days
    for i, payload in enumerate(out):
        try:
            week_days(payload, reader="api.services.fed_watch._calendar_payloads")
        except WeekContractViolation:
            out[i] = None
    return out


def calendar_block(today: date, survey_extract: Optional[dict]) -> dict:
    iso = today.isoformat()
    try:
        payloads = _calendar_payloads(today)
    except Exception:  # noqa: BLE001
        payloads = []
    days = P.calendar_days(payloads)
    week_start, week_end = P.week_bounds(today)
    nxt = P.next_meeting_from_calendar(days, iso)
    if nxt:
        meeting = {"state": "ok", **nxt, "source": SOURCE_CALENDAR}
    else:
        fallback = P.next_meeting_from_survey(survey_extract, iso)
        if fallback:
            meeting = {"state": "ok", "date": fallback["date"], "time": None, "event": None, "label": fallback["label"],
                       "source": f"{SOURCE_NYFED} (the meeting dates in its Survey of Market Expectations)"}
        else:
            meeting = {"state": "none", "date": None, "reason": "no_meeting_held"}
    if meeting.get("date"):
        meeting["days_to_go"] = P.days_between(iso, meeting["date"])
    held_week = payloads[0] if payloads else None
    if held_week:
        rows, total = P.week_speakers(days, week_start, week_end)
        week = {"state": "ok", "items": rows, "total": total, "limit": P.MAX_WEEK_SPEAKERS}
    else:
        week = {"state": "not_held", "items": [], "total": 0}
    return {"source": SOURCE_CALENDAR, "today": iso, "week_start": week_start, "week_end": week_end,
            "next_meeting": meeting, "this_week": week}


def _latest_point(symbol: str) -> dict:
    from api.services.econ import serving
    try:
        status, body, _etag = serving.series(symbol)
    except Exception:  # noqa: BLE001
        return {"value": None, "date": None, "reason": "failed"}
    if status != 200 or not isinstance(body, dict):
        return {"value": None, "date": None, "reason": "no_data"}
    best = None
    for p in body.get("points") or []:
        if not isinstance(p, (list, tuple)) or len(p) < 4:
            continue
        v = p[1]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        key = (str(p[3] or ""), p[0] or 0)
        if best is None or key > best[0]:
            best = (key, float(v), str(p[3] or p[2] or "")[:10] or None)
    if best is None:
        return {"value": None, "date": None, "reason": "no_data"}
    return {"value": best[1], "date": best[2], "reason": None}


def rates_block() -> dict:
    out: dict[str, Any] = {"source": SOURCE_NYFED, "notice": NYFED_RATE_NOTICE}
    if os.environ.get("ECON_ENABLED", "0") != "1":
        off = {"value": None, "date": None, "reason": "econ_off"}
        return {**out, "state": "off", "effective": dict(off), "upper": dict(off), "lower": dict(off)}
    eff, upper, lower = _latest_point("USEFFR"), _latest_point("USFEDFUNDSU"), _latest_point("USFEDFUNDSL")
    any_value = any(x["value"] is not None for x in (eff, upper, lower))
    return {**out, "state": "ok" if any_value else "no_data", "effective": eff, "upper": upper, "lower": lower}


# ── the two blocks a request never reads itself (speed pass 3; see the module docstring) ────────

_RATE_KEYS = ("effective", "upper", "lower")


def _rates_ttl() -> float:
    """How long a held rates block stands before a request starts its refresh: the economics serving cache's own
    lifetime (`econ.serving.TTL`), so the figures are as fresh as they were when each request read them through it."""
    from api.services.econ import serving
    return float(serving.TTL)


def _rates_servable() -> tuple:
    """Which of the three series the web build's registry serves: a copy made under another registry is not served."""
    from api.services import fed_watch_held
    from api.services.econ import publish as econ_publish
    return tuple(econ_publish.resolve(symbol) is not None for _name, symbol in fed_watch_held.RATE_SERIES)


def _rates_figures(block: Optional[dict]) -> int:
    block = block if isinstance(block, dict) else {}
    return sum(1 for k in _RATE_KEYS if isinstance(block.get(k), dict) and block[k].get("value") is not None)


def _rates_path() -> Optional[str]:
    base = _data_dir()
    return os.path.join(base, "fed_watch", f"rates_v{RATES_DISK_VERSION}.json") if base else None


def _rates_shape_ok(block: Any) -> bool:
    """A block with at least one figure, in exactly the shape `rates_block` builds, with this build's words."""
    if not isinstance(block, dict) or block.get("state") != "ok":
        return False
    if block.get("source") != SOURCE_NYFED or block.get("notice") != NYFED_RATE_NOTICE:
        return False
    for k in _RATE_KEYS:
        p = block.get(k)
        if not isinstance(p, dict) or set(p) != {"value", "date", "reason"}:
            return False
        v = p["value"]
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))):
            return False
    return _rates_figures(block) > 0


def _save_rates(held: dict) -> None:
    """The held block on disk for its New York day. A block without a figure is never written."""
    path = _rates_path()
    if not path or not _rates_shape_ok(held.get("block")):
        return
    doc = {"v": RATES_DISK_VERSION, "day": held["day"], "servable": list(held["servable"]),
           "checked": held["checked"], "block": held["block"]}
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".fedrates_", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(doc, fh)
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except Exception as exc:  # noqa: BLE001 -- the block is still held in memory
        _log.warning("[fed-watch] the rates could not be written to disk (%s)", type(exc).__name__)


def _load_rates(day: str, servable: tuple) -> Optional[dict]:
    """The disk copy, only when it is for `day` (New York), this registry, this version and this shape."""
    path = _rates_path()
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("v") != RATES_DISK_VERSION or doc.get("day") != day:
        return None
    if doc.get("servable") != list(servable) or not _rates_shape_ok(doc.get("block")):
        return None
    checked = doc.get("checked")
    checked = float(checked) if isinstance(checked, (int, float)) and not isinstance(checked, bool) else 0.0
    return {"block": doc["block"], "day": day, "servable": servable, "checked": min(checked, time.time())}


def _rates_load_once() -> None:
    with _lock:
        if _state["rates_loaded"]:
            return
        _state["rates_loaded"] = True
    got = _load_rates(now_et().date().isoformat(), _rates_servable())
    if got is not None:
        with _lock:
            if _state["rates"] is None:
                _state["rates"] = got


def _rates_refresh_bg(done: threading.Event, gen: int) -> None:
    """ONE refresh of the rates block, on its own thread: the service's own `rates_block`. A refresh that gives fewer
    figures than the block held for the same New York day and registry is a failed read (a published figure does not
    vanish within a day): it never replaces the held block, and is tried again after `RATES_RETRY_S`."""
    started = time.time()
    said = "stopped"
    try:
        block = rates_block()
        fresh = {"block": block, "day": now_et().date().isoformat(), "servable": _rates_servable(),
                 "checked": time.time()}
        with _lock:
            if gen != _gen:
                return
            held = _state["rates"]
            worse = (held is not None and held["day"] == fresh["day"] and held["servable"] == fresh["servable"]
                     and _rates_figures(block) < _rates_figures(held["block"]))
            if worse:
                _state["rates_retry_at"] = fresh["checked"] + RATES_RETRY_S
            else:
                _state["rates"], _state["rates_retry_at"] = fresh, 0.0
        if worse:
            said = f"kept the held block ({_rates_figures(block)} of {_rates_figures(held['block'])} figures read)"
        else:
            said = f"{block.get('state')} ({_rates_figures(block)} figures)"
            _save_rates(fresh)
    except Exception as exc:  # noqa: BLE001 -- the held block stands; tried again after RATES_RETRY_S
        with _lock:
            if gen == _gen:
                _state["rates_retry_at"] = time.time() + RATES_RETRY_S
        said = f"failed ({type(exc).__name__})"
    finally:
        _log.info("[fed-watch] rates: %s; %.2fs", said, time.time() - started)
        with _lock:
            if _state.get("rates_inflight") is done:
                _state["rates_inflight"] = None
        done.set()


def _start_rates() -> threading.Event:
    with _lock:
        done = _state["rates_inflight"]
        if done is None:
            done = _state["rates_inflight"] = threading.Event()
            threading.Thread(target=_rates_refresh_bg, args=(done, _gen), daemon=True, name=RATES_THREAD).start()
        return done


def _rates_due(now: float) -> bool:
    with _lock:
        held, retry_at = _state["rates"], _state["rates_retry_at"]
    return now >= retry_at and (held is None or now - held["checked"] >= _rates_ttl())


def rates_served() -> dict:
    """The rates block a request gets, AT ONCE: with the economics feature off, the service's own switched-off block
    (no read); else the block held here (or its disk copy for today), starting ONE background refresh once it is older
    than the serving cache's lifetime; with nothing held yet, `computing`. Never reads a series itself."""
    if os.environ.get("ECON_ENABLED", "0") != "1":
        return rates_block()
    _rates_load_once()
    if _rates_due(time.time()):
        _start_rates()
    with _lock:
        held = _state["rates"]
    if held is not None:
        return held["block"]
    blank = {"value": None, "date": None, "reason": "computing"}
    return {"source": SOURCE_NYFED, "notice": NYFED_RATE_NOTICE, "state": "computing",
            "effective": dict(blank), "upper": dict(blank), "lower": dict(blank)}


def _headline_pause(seconds: float) -> None:
    time.sleep(seconds)


def _headlines_pass(done: threading.Event, gen: int) -> None:
    """The headline pass (see `headlines_served`): `headlines_block` itself, which reads the store only when the wire
    has moved and `HEADLINE_MIN_S` has passed, every `HEADLINE_MIN_S`; it stops once no request has come for
    `HEADLINE_WATCH_S`."""
    try:
        while True:
            try:
                answer = headlines_block()
            except Exception:  # noqa: BLE001 -- said as the block does: a store that fails is failed
                answer = {"source": SOURCE_TX, "items": [], "state": "failed"}
            with _lock:
                if gen != _gen:
                    return
                _state["headlines_last"] = answer
                if time.time() - _state["asked_at"] >= HEADLINE_WATCH_S:
                    if _state["headlines_worker"] is done:
                        _state["headlines_worker"] = None
                    return
            _headline_pause(HEADLINE_MIN_S)
    finally:
        with _lock:
            if _state.get("headlines_worker") is done:
                _state["headlines_worker"] = None
        done.set()


def _start_headlines() -> None:
    with _lock:
        if _state["headlines_worker"] is None:
            done = _state["headlines_worker"] = threading.Event()
            threading.Thread(target=_headlines_pass, args=(done, _gen), daemon=True, name=HEADLINES_THREAD).start()


def headlines_served() -> dict:
    """The Fed headlines a request gets, AT ONCE: the wire's switch states as `headlines_block` says them; else the
    newest outcome of the headline pass (ONE background thread, `HEADLINES_THREAD`, which runs every `HEADLINE_MIN_S`
    while requests keep coming and so keeps the list as fresh as a request's own pass made it); with no pass finished
    yet, `computing`. Never reads the store itself."""
    out: dict[str, Any] = {"source": SOURCE_TX, "items": []}
    try:
        from api.services.trade_exchange_news import config as txn_config
        from api.services.trade_exchange_news import pipeline as txn_pipeline
    except Exception:  # noqa: BLE001
        return {**out, "state": "failed"}
    if not txn_config.enabled():
        return {**out, "state": "off"}
    if txn_pipeline.get() is None:
        return {**out, "state": "not_started"}
    with _lock:
        _state["asked_at"] = time.time()
        last = _state["headlines_last"]
    _start_headlines()
    return last if last is not None else {**out, "state": "computing"}


def warm() -> str:
    """Boot (a DATE job in `api/main.py`, past the boot's busy minutes): start the rates refresh and one headline pass,
    so the first member after a deploy gets both at once. Reads only what a request's blocks read (the economics
    store, the news store), never the Board or the New York Fed. A no-op for a block already held and fresh."""
    said = []
    if os.environ.get("ECON_ENABLED", "0") == "1":
        _rates_load_once()
        if _rates_due(time.time()):
            _start_rates()
            said.append("rates")
    try:
        from api.services.trade_exchange_news import config as txn_config
        from api.services.trade_exchange_news import pipeline as txn_pipeline
        wire = txn_config.enabled() and txn_pipeline.get() is not None
    except Exception:  # noqa: BLE001
        wire = False
    with _lock:
        cold = _state["headlines_last"] is None
    if wire and cold:
        _start_headlines()                     # no request is counted: the pass runs once and stops
        said.append("headlines")
    return " ".join(said) or "warm"


# ── the answer ───────────────────────────────────────────────────────────────────────────────

def _assemble(computing: bool, *, rates: Optional[dict] = None, headlines: Optional[dict] = None) -> dict:
    """The answer from what is held. `rates` / `headlines`: the blocks a request is served (`rates_served`,
    `headlines_served`); without them the blocks are read here, as `held_answer` reads them."""
    today = now_et().date()
    with _lock:
        statement = statement_block(computing)
        speeches = speeches_block(computing)
        projections = projections_block(computing)
        survey = survey_block(computing, today.isoformat())
        held_survey = sorted(_state["surveys"].values(), key=lambda s: (s.get("year") or 0, s.get("month") or 0), reverse=True)
        extract = held_survey[0].get("extract") if held_survey else None
    return {
        "status": "ok",
        "statement": statement,
        "speeches": speeches,
        "headlines": headlines_block() if headlines is None else headlines,
        "calendar": calendar_block(today, extract),
        "rates": rates_block() if rates is None else rates,
        "projections": projections,
        "survey": survey,
        "board_cite": BOARD_CITE,
        "built_at": _now_iso(),
    }


def held_answer() -> tuple[dict, str]:
    """READ ONLY: the answer from what this module already holds, as `(answer, how)`. It never
    starts a build. how: 'held' | 'not_held' (the Board's feeds have never been read)."""
    _ensure_loaded()
    return _assemble(False), ("held" if _board_held() else "not_held")


def get_fed_watch(*, wait_s: Optional[float] = None) -> dict:
    """The Fed watch answer (see the module docstring). NEVER fetches or reads a store on the caller's
    thread: with something due it starts the one background build and answers at once from what is
    held (the rates and the headlines included, `rates_served` / `headlines_served`); with the Board's
    feeds never read it waits up to `WAIT_S` for that build first."""
    _ensure_loaded()
    if refresh_due():
        done = _start_job()
        if not _board_held():
            done.wait(WAIT_S if wait_s is None else wait_s)
    with _lock:
        running = _state["inflight"] is not None
    return _assemble(running, rates=rates_served(), headlines=headlines_served())


def reset_for_tests() -> None:
    """Tests only: forget everything this module holds (a thread started before this writes nothing)."""
    global _gen
    with _lock:
        _state.clear()
        _state.update(_blank_state())
        _gen += 1
    _REDLINES.clear()
