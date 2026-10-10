# api/services/earnings_session_resolver.py
"""Verify the week's UNCONFIRMED earnings rows: right date, right session.

Two defects, one cause. FMP's range calendar carries no session field, so every
FMP-only row lands in `tbd` (40 of 78 on the week of 2026-10-12). And a row
whose date is a provider PROJECTION (`date_est`) is frequently on the wrong
DAY: on that same week FMP had CBSH on Oct 14 (company-confirmed Oct 20),
GBCI on Oct 15 (press release: Oct 22 after the close), RCBC on Oct 15
(press release: Oct 23 after the close), CWBC on Oct 14 (Oct 22). A card that
shows those names on those days is wrong, whatever time it prints.

Only rows that are NOT already confirmed are touched: a row in `tbd`, or a row
carrying `date_est`. A session a provider stated with a confirmed date is never
second-guessed.

CONFIRMED sources, strongest first. Each gives a DATE and a SESSION:
1. **Nasdaq** `api.nasdaq.com/api/calendar/earnings?date=`, a timed row.
   Scanned over the week AND the three weeks after it, so a name the company
   confirmed for a later week is found. Measured 2026-10-09 against Finnhub on
   the coming week: 253 rows timed by both, 253 agree.
   **EarningsWhispers** `api/caldata/<yyyymmdd>` beside it: it lists only
   names whose date the company has CONFIRMED (`confirmDate`), with
   `releaseTime` 1 = before the open, 3 = after the close.
2. **Yahoo**, `isEarningsDateEstimate == False`. Measured 2026-10-10 against 79
   Nasdaq-confirmed names over three weeks: 78/79 dates, 79/79 sessions.
3. **The company's own date announcement** — a press release ("will report
   third quarter results after the market closes on October 22, 2026"), read
   from FMP's press-release feed. GBCI and RCBC were confirmed this way on
   2026-10-10 before Nasdaq or Yahoo listed them.
4. **The 8-K itself** — a past day whose Item 2.02 8-K was filed on the report
   date already says when the release went out (session only).

A confirmed date ON the row's day sets the session and clears `date_est`. A
confirmed date on ANOTHER day of this week moves the row there. A confirmed
date OUTSIDE this week removes the row from this week: the company has said
when it reports, and it is not this week.

UNCONFIRMED (no company confirmation anywhere):
* A company that files no 10-Q (a foreign issuer reporting twice a year, a
  closed-end fund) is removed: an unannounced quarterly date for it is a guess
  with no basis (HKD and the fund PEO on 2026-10-12).
* If Yahoo answers and has NO date for it, the row is removed: only the one
  projecting provider says "this week" (ALOY, which FMP had just moved from
  Nov 18 to Oct 14). A Yahoo FAILURE is not that answer and removes nothing.
* If Yahoo's own estimate puts it OUTSIDE this week, the row is removed: two
  independent projections disagree and nothing supports "this week". The name
  comes back on its own the moment the company confirms (the build re-runs
  hourly), so the cost of waiting is a late listing, never a wrong one.
* If Yahoo's estimate is ANOTHER day of this week, the row moves there: FMP's
  projections were wrong for 5 of 5 names checked on 2026-10-10. A Yahoo date
  already in the past is stale and is ignored.
* Otherwise it stays, still `date_est`, and gets a session from the company's
  filing history when that is unanimous over its last 3-4 Item 2.02 8-Ks
  (covers 91/127 confirmed reporters at 0.90), else from the publish times of
  its earnings-result press releases (all agreeing; PBAM's are 08:00). The
  release's own timestamp outranks the 8-K proxy, which LAGS it: WABC releases
  at ~11:04 ET, during the session, while its 8-Ks read as "before the open".
  A during-market release goes in `tbd` with `session_note`, the calendar's
  existing home for Finnhub's `dmh`. Else
  from Yahoo's estimate time. With none of those, it stays in `tbd`.

How an 8-K acceptance time maps to a session (measured on 127 confirmed):
  * before 16:00 ET                       -> bmo  (8-Ks LAG a morning release)
  * 16:00+ ET, filed the SAME date        -> amc
  * 16:00+ ET, filingDate is the NEXT day -> bmo  (PEP files ~22:00 for its
    06:00 release and dates it to the morning)

Never raises; bounded, cached, and inside a wall-clock budget (the range path
can sit on a request). Each touched row carries `session_src`
(`nasdaq` | `earningswhispers` | `yahoo` | `press_release` | `release_history` | `edgar_filing` | `edgar_history` | `yahoo_estimate`) and
`date_confirmed` when a company confirmation backed it.
Kill switch: `CALENDAR_TBD_RESOLVER=0` (unset = ON).
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

_NASDAQ_URL = "https://api.nasdaq.com/api/calendar/earnings?date={ds}"
_NASDAQ_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}
_NASDAQ_TIME = {"time-pre-market": "bmo", "time-after-hours": "amc"}
_LOOKAHEAD_DAYS = 21      # how far past the week a confirmation is looked for

_OK_TTL = {"nasdaq": 3 * 3600, "ew": 3 * 3600, "sec": 24 * 3600, "yahoo": 6 * 3600,
           "press": 3 * 3600}
_EW_TIME = {1: "bmo", 3: "amc"}
_FAIL_TTL = 15 * 60
_HISTORY_MIN = 3          # filings needed before a history is trusted
_HISTORY_N = 4            # most recent filings consulted
_SAME_QUARTER_DAYS = 1    # |filingDate - report date| that counts as THIS report

_cache: dict[tuple[str, str], tuple[float, object]] = {}
_cache_lock = threading.Lock()


def is_enabled() -> bool:
    """Read PER CALL. Unset means ON."""
    return os.environ.get("CALENDAR_TBD_RESOLVER", "1").strip().lower() not in ("0", "false", "no", "off")


def _cached(kind: str, key: str, fetch):
    now = time.time()
    with _cache_lock:
        hit = _cache.get((kind, key))
        if hit and hit[0] > now:
            return hit[1]
    try:
        val, ttl = fetch(), _OK_TTL[kind]
    except Exception as exc:          # noqa: BLE001
        _logger.info("session resolver: %s %s failed: %s", kind, key, exc)
        val, ttl = None, _FAIL_TTL
    with _cache_lock:
        _cache[(kind, key)] = (now + ttl, val)
    return val


def _session_of_minute(m: int) -> str | None:
    return "bmo" if m < 9 * 60 + 30 else ("amc" if m >= 16 * 60 else None)


# ── transports (replaced by name in tests) ─────────────────────────────────

def _nasdaq_fetch(ds: str) -> dict:
    import requests
    r = requests.get(_NASDAQ_URL.format(ds=ds), headers=_NASDAQ_HEADERS, timeout=6)
    r.raise_for_status()
    return r.json()


def _sec_fetch(cik: str) -> dict:
    from api.services.fundamentals_pit import sec_client
    return json.loads(sec_client.get_bytes(
        f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json", retries=1, timeout=8))


def _yahoo_fetch(sym: str) -> dict | None:
    """Yahoo's `info` for one symbol, through the shared bounded yfinance pool."""
    from api.services import yf_util

    def _info():
        import yfinance as yf
        return yf.Ticker(sym).get_info()
    return yf_util.bounded_call(_info, None, timeout=10, reraise=True, lane="earnings")


def _cik_for(sym: str) -> str | None:
    # The bulk file only: the resolver chain's later tiers are slow by design
    # and this pass can sit on a request. A miss just leaves the row as it was.
    from api.services.edgar import _ticker_to_cik_bulk
    try:
        return _ticker_to_cik_bulk().get(sym)
    except Exception:                 # noqa: BLE001
        return None


# ── Nasdaq: confirmed (date, session) per symbol over a window ─────────────

def _nasdaq_day(ds: str) -> dict[str, str]:
    def fetch():
        rows = ((_nasdaq_fetch(ds) or {}).get("data") or {}).get("rows") or []
        return {(r.get("symbol") or "").strip().upper(): _NASDAQ_TIME[r.get("time")]
                for r in rows if r.get("time") in _NASDAQ_TIME}
    return _cached("nasdaq", ds, fetch) or {}


def _ew_fetch(ds: str) -> list:
    import requests
    ymd = ds.replace("-", "")
    r = requests.get(f"https://www.earningswhispers.com/api/caldata/{ymd}", timeout=8, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
        "Referer": f"https://www.earningswhispers.com/calendar/{ymd}/1"})
    r.raise_for_status()
    items = r.json()
    return items if isinstance(items, list) else []


def _ew_day(ds: str) -> dict[str, str]:
    """{sym: session} for names EarningsWhispers lists as company-CONFIRMED on `ds`."""
    def fetch():
        return {(i.get("ticker") or "").strip().upper(): _EW_TIME[i.get("releaseTime")]
                for i in _ew_fetch(ds)
                if i.get("confirmDate") and i.get("releaseTime") in _EW_TIME}
    return _cached("ew", ds, fetch) or {}


def _confirmed_day(ds: str) -> dict[str, tuple[str, str]]:
    """{sym: (session, source)}; Nasdaq wins a disagreement."""
    out = {sym: (sess, "earningswhispers") for sym, sess in _ew_day(ds).items()}
    out.update({sym: (sess, "nasdaq") for sym, sess in _nasdaq_day(ds).items()})
    return out


def _weekdays(first: date, last: date) -> list[str]:
    out, d = [], first
    while d <= last:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


# ── the company's own announcement, from FMP's press-release feed ──────────

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], 1)}
_DATE = (r"(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?(january|february|march|april|may|"
         r"june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(20\d\d)")
_AMC = (r"after\s+(?:the\s+)?(?:u\.s\.\s+)?(?:stock\s+)?markets?\s+(?:close|closes|closed|has closed)"
        r"|after\s+the\s+close(?:\s+of\s+(?:the\s+)?(?:market|trading))?")
_BMO = (r"before\s+(?:the\s+)?(?:u\.s\.\s+)?(?:stock\s+)?markets?\s+(?:open|opens)"
        r"|prior\s+to\s+(?:the\s+)?markets?\s+open(?:ing|s)?|before\s+the\s+open(?:ing\s+bell)?")
_ANNOUNCE = [(re.compile(rf"(?:{_AMC})[^.;]{{0,40}}?\bon\s+{_DATE}", re.I), "amc"),
             (re.compile(rf"(?:{_BMO})[^.;]{{0,40}}?\bon\s+{_DATE}", re.I), "bmo"),
             (re.compile(rf"\bon\s+{_DATE}[^.;]{{0,60}}?(?:{_AMC})", re.I), "amc"),
             (re.compile(rf"\bon\s+{_DATE}[^.;]{{0,60}}?(?:{_BMO})", re.I), "bmo")]
_EARNINGS_WORDS = re.compile(r"quarter|results|earnings", re.I)


def parse_announcement(text: str) -> tuple[str, str] | None:
    """(date, session) from a release that announces when results come out."""
    for pat, sess in _ANNOUNCE:
        m = pat.search(text or "")
        if m:
            mon, day, yr = m.groups()
            try:
                return date(int(yr), _MONTHS[mon.lower()], int(day)).isoformat(), sess
            except ValueError:
                continue
    return None


def _press_fetch(sym: str) -> list:
    import requests
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return []
    r = requests.get("https://financialmodelingprep.com/stable/news/press-releases",
                     params={"symbols": sym, "limit": 25, "apikey": key}, timeout=8)
    r.raise_for_status()
    return r.json() or []


_RESULT_TITLE = re.compile(r"\b(reports?|announces?|posts?|delivers?)\b.*\b(results|earnings|net income)\b"
                           r"|\b(results|earnings)\b.*\b(quarter|fiscal|year)\b", re.I)
_NOT_RESULT = re.compile(r"\b(to (report|announce|release|host)|will|schedul|date for|conference call|"
                         r"webcast|meeting|dividend)\b", re.I)


def _press(sym: str, today_str: str) -> dict:
    """{"announced": (date, session) still ahead | None,
        "history": session when 2+ past result releases agree | None}"""
    def fetch():
        ann, times = [], []
        for p in _press_fetch(sym):
            title = p.get("title") or ""
            pub = p.get("publishedDate") or ""
            if not _EARNINGS_WORDS.search(title):
                continue
            got = parse_announcement(title + ". " + (p.get("text") or "")[:3000])
            if got:
                ann.append((pub, got))
            elif _RESULT_TITLE.search(title) and not _NOT_RESULT.search(title) and len(pub) >= 16:
                times.append((pub, int(pub[11:13]) * 60 + int(pub[14:16])))
        return {"ann": ann, "times": times}
    rows = _cached("press", sym, fetch) or {}
    ahead = [got for _, got in sorted(rows.get("ann") or [], reverse=True) if got[0] >= today_str]
    past = [_session_of_minute(m) or "dmh" for pub, m in sorted(rows.get("times") or [], reverse=True)
            if pub[:10] < today_str][:4]
    hist = past[0] if past and len(set(past)) == 1 else None    # "dmh" = during market hours
    return {"announced": ahead[0] if ahead else None, "history": hist}


# ── Yahoo: {date, session, confirmed} ──────────────────────────────────────

def yahoo_answer(info: dict | None) -> dict | None:
    """Reduce Yahoo's `info` to the one fact used here, or None."""
    if not isinstance(info, dict) or not info:
        return None                                   # a failure, not an answer
    ts = info.get("earningsTimestampStart") or info.get("earningsTimestamp")
    if not ts:
        return {"date": None, "session": None, "confirmed": False}
    try:
        t = datetime.fromtimestamp(float(ts), _ET)
    except (TypeError, ValueError, OverflowError, OSError):
        return {"date": None, "session": None, "confirmed": False}
    return {"date": t.date().isoformat(),
            "session": _session_of_minute(t.hour * 60 + t.minute),
            "confirmed": info.get("isEarningsDateEstimate") is False}


def _yahoo(sym: str) -> dict | None:
    return _cached("yahoo", sym, lambda: yahoo_answer(_yahoo_fetch(sym)))


# ── SEC 8-K Item 2.02 acceptance times ─────────────────────────────────────

def filing_session(accepted: str, filing_date: str) -> str | None:
    """Session implied by one Item 2.02 8-K. See the module docstring."""
    try:
        t = datetime.fromisoformat(accepted.replace("Z", "+00:00")).astimezone(_ET)
    except (ValueError, AttributeError):
        return None
    if t.hour < 16:
        return "bmo"
    return "bmo" if (filing_date or "") > t.date().isoformat() else "amc"


def _company(sym: str) -> dict | None:
    """{"filings": [(filingDate, session)] newest first, "foreign": bool} or None."""
    cik = _cik_for(sym)
    if not cik:
        return None

    def fetch():
        recent = ((_sec_fetch(cik) or {}).get("filings") or {}).get("recent") or {}
        out = []
        for form, items, acc, fd in zip(recent.get("form") or [], recent.get("items") or [],
                                        recent.get("acceptanceDateTime") or [],
                                        recent.get("filingDate") or []):
            if form == "8-K" and "2.02" in (items or ""):
                s = filing_session(acc, fd)
                if s:
                    out.append((fd, s))
        out.sort(reverse=True)
        forms = set(recent.get("form") or [])
        return {"filings": out, "no_10q": bool(forms) and "10-Q" not in forms}
    return _cached("sec", cik, fetch)


def session_from_filings(filings: list[tuple[str, str]], ds: str) -> tuple[str, str] | None:
    """(session, source) for a report on `ds`, or None."""
    try:
        d = date.fromisoformat(ds)
    except ValueError:
        return None
    for fd, s in filings:
        try:
            if abs((date.fromisoformat(fd) - d).days) <= _SAME_QUARTER_DAYS:
                return s, "edgar_filing"
        except ValueError:
            continue
    # History = filings clearly BEFORE this report (a prior quarter).
    cutoff = (d - timedelta(days=20)).isoformat()
    hist = [s for fd, s in filings if fd < cutoff][:_HISTORY_N]
    if len(hist) < _HISTORY_MIN:
        return None
    top, n = Counter(hist).most_common(1)[0]
    return (top, "edgar_history") if n == len(hist) else None


# ── the decision for one row (pure) ────────────────────────────────────────

def _bucket(session: str) -> str:
    """A during-market release has no bmo/amc slot; the calendar's convention
    (Finnhub `dmh` too) is the `tbd` bucket."""
    return session if session in ("bmo", "amc") else "tbd"


def decide(ds: str, week: set[str], is_future: bool, nasdaq: tuple[str, str] | None,
           yahoo: dict | None, filings: list | None, in_tbd: bool,
           press: tuple[str, str] | None = None, no_10q: bool = False,
           today_str: str = "", release_history: str | None = None):
    """What to do with one unconfirmed row. Returns one of
    ("place", date, session, source, confirmed) — put it on `date` in `session`
    ("drop", reason)                            — not this week
    None                                        — leave it exactly as it is."""
    if is_future:
        conf = None
        if nasdaq:
            conf = (nasdaq[0], nasdaq[1], nasdaq[2] if len(nasdaq) > 2 else "nasdaq")
        elif yahoo and yahoo.get("confirmed") and yahoo.get("session"):
            conf = (yahoo["date"], yahoo["session"], "yahoo")
        elif press:
            conf = (press[0], press[1], "press_release")
        if conf:
            if conf[0] in week:
                return ("place", conf[0], conf[1], conf[2], True)
            return ("drop", f"confirmed {conf[0]} ({conf[2]})")
        if no_10q:
            return ("drop", "unconfirmed date for a company that files no 10-Q")
        if isinstance(yahoo, dict) and not yahoo.get("date"):
            return ("drop", "unconfirmed; no source but the projecting provider has a date")
        y_date = (yahoo or {}).get("date") or ""
        if y_date and y_date >= today_str and not yahoo.get("confirmed"):
            if y_date not in week:
                return ("drop", f"unconfirmed; Yahoo estimates {y_date}")
            if y_date != ds:
                if release_history:
                    return ("place", y_date, _bucket(release_history), "release_history", False)
                got = session_from_filings(filings, y_date) if filings else None
                if got and got[1] == "edgar_history":
                    return ("place", y_date, got[0], "edgar_history", False)
                if yahoo.get("session"):
                    return ("place", y_date, yahoo["session"], "yahoo_estimate", False)
                return ("place", y_date, "tbd", "yahoo_estimate", False)
    if not in_tbd:
        return None
    got = session_from_filings(filings, ds) if filings else None
    if got and got[1] == "edgar_filing":
        return ("place", ds, got[0], got[1], True)
    if is_future and release_history:
        return ("place", ds, _bucket(release_history), "release_history", False)
    if got:
        return ("place", ds, got[0], got[1], False)
    if is_future and yahoo and yahoo.get("date") == ds and yahoo.get("session"):
        return ("place", ds, yahoo["session"], "yahoo_estimate", False)
    return None


# ── the pass ───────────────────────────────────────────────────────────────

def _sort_key(e):
    return (-(e.get("ew") or 0), e.get("eps_est") is None and e.get("rev_est") is None,
            e.get("sym") or "")


def _run_pool(fn, keys, deadline, workers, prefix):
    if not keys or time.monotonic() >= deadline:
        return {}
    pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=prefix)
    futs = {pool.submit(fn, k): k for k in keys}
    done, _ = wait(futs, timeout=max(0.0, deadline - time.monotonic()))
    pool.shutdown(wait=False, cancel_futures=True)
    out = {}
    for f in done:
        try:
            out[futs[f]] = f.result()
        except Exception:             # noqa: BLE001
            pass
    return out


def resolve_tbd_sessions(days: dict, today_str: str | None = None, *,
                         budget_s: float = 30.0) -> dict:
    """Verify every unconfirmed row in `days`. Mutates `days`; returns per-
    outcome counts. Never raises."""
    stats = Counter()
    if not is_enabled():
        return stats
    try:
        today_str = today_str or datetime.now(_ET).date().isoformat()
        deadline = time.monotonic() + budget_s
        week = {ds for ds, day in days.items() if isinstance(day, dict)}
        if not week:
            return stats
        cands = []        # (ds, bucket, entry)
        for ds in sorted(week):
            for b in ("bmo", "amc", "tbd"):
                for e in days[ds].get(b) or []:
                    if e.get("sym") and (b == "tbd" or e.get("date_est")):
                        cands.append((ds, b, e))
        if not cands:
            return stats
        syms = sorted({e["sym"] for _, _, e in cands})
        future_syms = sorted({e["sym"] for ds, _, e in cands if ds >= today_str})

        # 1. Nasdaq over the week and the weeks after it.
        nasdaq: dict[str, tuple[str, str, str]] = {}      # sym -> (date, session, source)
        if future_syms:
            first = max(date.fromisoformat(min(week)), date.fromisoformat(today_str))
            span = _weekdays(first, date.fromisoformat(max(week)) + timedelta(days=_LOOKAHEAD_DAYS))
            for ds, m in sorted(_run_pool(_confirmed_day, span, min(deadline, time.monotonic() + 12),
                                          6, "tbd-nq").items()):
                for sym, (sess, src) in (m or {}).items():
                    nasdaq.setdefault(sym, (ds, sess, src))   # earliest confirmed date wins
        # 2. Yahoo and SEC, in parallel, for whatever is still open.
        need_y = [s for s in future_syms if s not in nasdaq]
        yahoo = _run_pool(_yahoo, need_y, deadline, 4, "tbd-yf")
        need_sec = sorted({e["sym"] for _, b, e in cands if b == "tbd"} | set(need_y))
        company = _run_pool(_company, need_sec, deadline, 4, "tbd-sec")
        need_pr = sorted({s for s in need_y if not ((yahoo.get(s) or {}).get("confirmed"))}
                         | {e["sym"] for ds, b, e in cands if b == "tbd" and ds >= today_str})
        press = _run_pool(lambda s: _press(s, today_str), need_pr, deadline, 4, "tbd-pr")

        # 3. Decide, then apply.
        placed = {(ds, e["sym"]) for ds in week for b in ("bmo", "amc", "tbd")
                  for e in days[ds].get(b) or [] if e.get("sym")}
        touched = set()
        for ds, b, e in cands:
            sym = e["sym"]
            co = company.get(sym) or {}
            pr = press.get(sym) or {}
            act = decide(ds, week, ds >= today_str, nasdaq.get(sym), yahoo.get(sym),
                         co.get("filings"), b == "tbd", pr.get("announced"),
                         bool(co.get("no_10q")), today_str, pr.get("history"))
            if act is None:
                if b == "tbd":
                    stats["left_tbd"] += 1
                continue
            days[ds][b] = [x for x in days[ds][b] if x is not e]
            touched.add((ds, b))
            if act[0] == "drop":
                stats["dropped"] += 1
                _logger.info("Calendar: %s off %s — %s", sym, ds, act[1])
                continue
            _, to_ds, sess, src, confirmed = act
            if src == "release_history" and sess == "tbd":
                e["session_note"] = "during market hours"
                stats["during_market"] += 1
            elif to_ds == ds and sess == b == "tbd":
                days[ds]["tbd"].append(e)               # nothing better known
                stats["left_tbd"] += 1
                continue
            if to_ds != ds and (to_ds, sym) in placed:
                stats["dup_removed"] += 1          # already shown on its real day
                continue
            e["session_src"] = src
            if confirmed:
                e["date_confirmed"] = True
                e.pop("date_est", None)
            if to_ds != ds:
                e["date_moved_in_week"] = {"from": ds, "to": to_ds}
                placed.add((to_ds, sym))
                stats["moved"] += 1
            days[to_ds].setdefault(sess, []).append(e)
            touched.add((to_ds, sess))
            stats[src] += 1
        for ds, b in touched:
            days[ds][b] = sorted(days[ds].get(b) or [], key=_sort_key)
        if stats:
            _logger.info("Calendar: unconfirmed-row resolver %s", dict(stats))
    except Exception as exc:          # noqa: BLE001
        _logger.warning("Calendar: unconfirmed-row resolver failed: %s", exc)
    return stats
