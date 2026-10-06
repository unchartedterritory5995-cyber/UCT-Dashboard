"""IV history from OUR OWN options log -- the per-symbol ATM IV series, and BRK-10's
first slice (a print's implied move against its realized move).

WHY THIS READS OUR LOG AND NOTHING ELSE
  Massive (2026-09-30): historical aggs/trades/quotes only -- no historical chains,
  greeks, IV or OI, no IV series, surface or term structure. The only IV history this
  product will ever hold is the one `api/services/options_universe_log.py` records
  forward, one file a trading day, under R2 `options_log/<YYYY>/<date>.*`. This module
  reads the per-underlying summary files (`*.underlyings.csv.gz`, ~80 KB a day), never
  the 108 MB contracts files.

⛔ HONEST COVERAGE. Every answer carries `logging_began` (the log's first session),
  `covers_from` (this symbol's first logged ATM IV), the trading sessions the log
  SHOULD hold and does not (`missing_sessions`), and `partial` with the reasons in
  words. A missed day is a gap, never interpolated.
⛔ EVERY POINT CARRIES ITS DATE AND ITS `atm_dte`. The ATM read is "the expiry closest
  to 30 days" (7-90); the days-to-expiry it was read at travels with the number. A day
  written under the first run's 20-45 day rule is marked `rule: "legacy-20-45"` and is
  left OUT of a rank (one method per statistic).
⛔ NO RANK BELOW 20 SESSIONS. IV rank / percentile need `RANK_MIN_SESSIONS` points; below
  that the answer is the sentence "N sessions logged, rank needs 20", never a number.
⛔ NO CALIBRATION IT CANNOT SUPPORT (BRK-10). The implied-vs-realized reliability summary
  needs `CALIBRATION_MIN_PRINTS` paired prints; below that it lists what it has and says
  how many it needs. With zero it says when the first comparison can exist.

⛔ DARK behind `IV_HISTORY_ENABLED` (read per call, unset = OFF).
"""
from __future__ import annotations

import csv
import datetime as _dt
import gzip
import json
import os
import re
import tempfile
import threading
import time
from collections import OrderedDict
from typing import Callable, Optional
from zoneinfo import ZoneInfo

FLAG = "IV_HISTORY_ENABLED"
RANK_MIN_SESSIONS = 20
RANK_WINDOW = 252
CALIBRATION_MIN_PRINTS = 4
#: The logger runs 16:30 ET and measured 13-15 min; a session counts as "should be
#: logged" only once this time has passed on its own day.
LOG_DUE_ET = _dt.time(17, 15)
CURRENT_RULE = "closest-30"
LEGACY_RULE = "legacy-20-45"
SOURCE = "UCT options log (Massive /v3/snapshot?type=options, recorded daily at 16:30 ET)"
METHOD = ("ATM IV is the mean of the call and put implied volatility at the strike closest "
          "to the underlying, on the expiry closest to 30 days out (7-90 days); the "
          "days-to-expiry it was read at is shown with each point.")
IMPLIED_METHOD = ("Implied move = the front straddle (call + put bid/ask mids, first expiry "
                  "after the session, strike closest to the underlying) divided by the "
                  "underlying price, read at the close of the session before the "
                  "announcement date. Realized move = the earnings gap (larger of the "
                  "pre-market and after-hours gap when the timing is not known).")

_ET = ZoneInfo("America/New_York")
_SYM_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_KEY_RE = re.compile(r"options_log/\d{4}/(\d{4}-\d{2}-\d{2})\.(manifest\.json|underlyings\.csv\.gz)$")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(FLAG, "").strip().lower() in ("1", "true", "yes", "on")


def normalize_symbol(sym: str) -> Optional[str]:
    s = (sym or "").strip().upper()
    return s if _SYM_RE.match(s) else None


# ── the store ───────────────────────────────────────────────────────────────────

class LocalStore:
    """The log's layout on a local disk: `<root>/options_log/<YYYY>/<date>.*`.
    Tests seed one; the R2 store mirrors into one."""

    def __init__(self, root: str):
        self.root = root

    def sessions(self) -> dict:
        """{session_iso: manifest dict} for every day with a summary file."""
        out = {}
        base = os.path.join(self.root, "options_log")
        if not os.path.isdir(base):
            return out
        for year in sorted(os.listdir(base)):
            ydir = os.path.join(base, year)
            if not os.path.isdir(ydir):
                continue
            for name in os.listdir(ydir):
                m = re.match(r"^(\d{4}-\d{2}-\d{2})\.underlyings\.csv\.gz$", name)
                if not m:
                    continue
                manifest = {}
                mp = os.path.join(ydir, f"{m.group(1)}.manifest.json")
                try:
                    with open(mp, encoding="utf-8") as fh:
                        manifest = json.load(fh)
                except (OSError, ValueError):
                    manifest = {"complete": False, "reason": "no readable manifest"}
                out[m.group(1)] = manifest
        return out

    def summary_path(self, session: str) -> Optional[str]:
        p = os.path.join(self.root, "options_log", session[:4], f"{session}.underlyings.csv.gz")
        return p if os.path.exists(p) else None


class R2Store(LocalStore):
    """The production log in R2, mirrored on demand into a local cache directory.
    The listing is cached `LIST_TTL_S`; a day's file is re-fetched only when its ETag
    changes (a `resummarize()` replaces a summary in place)."""

    LIST_TTL_S = 600

    def __init__(self, cache_dir: Optional[str] = None):
        super().__init__(cache_dir or os.environ.get("IV_HISTORY_CACHE_DIR")
                         or os.path.join(tempfile.gettempdir(), "uct_iv_history"))
        self._lock = threading.Lock()
        self._listed_at = 0.0
        self._etags: dict = {}

    def _client(self):
        from api import flow_backup
        client, bucket = flow_backup._r2_client(), flow_backup._bucket()
        if client is None or not bucket:
            raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
        return client, bucket

    def _sync(self) -> None:
        with self._lock:
            if time.monotonic() - self._listed_at < self.LIST_TTL_S and self._listed_at:
                return
            client, bucket = self._client()
            seen = {}
            for page in client.get_paginator("list_objects_v2").paginate(
                    Bucket=bucket, Prefix="options_log/"):
                for o in page.get("Contents") or []:
                    if _KEY_RE.search(o["Key"]):
                        seen[o["Key"]] = o.get("ETag", "")
            for key, etag in seen.items():
                local = os.path.join(self.root, *key.split("/"))
                if self._etags.get(key) == etag and os.path.exists(local):
                    continue
                os.makedirs(os.path.dirname(local), exist_ok=True)
                tmp = local + ".part"
                client.download_file(bucket, key, tmp)
                os.replace(tmp, local)
                self._etags[key] = etag
            self._listed_at = time.monotonic()

    def sessions(self) -> dict:
        self._sync()
        return super().sessions()


_store_override: Optional[LocalStore] = None
_default_store: Optional[R2Store] = None


def get_store() -> LocalStore:
    """Tests set `_store_override` to a seeded LocalStore; production reads R2."""
    global _default_store
    if _store_override is not None:
        return _store_override
    if _default_store is None:
        _default_store = R2Store()
    return _default_store


# ── one day's row for one symbol ────────────────────────────────────────────────

class _LRU(OrderedDict):
    """S10 (terminal backend fixes, 2026-10-05): a bounded cache that drops its
    least-recently-used entry. The row cache used to be cleared WHOLESALE at its cap, so
    one long-history symbol could wipe every other member's warm rows mid-request; the
    prints cache had no cap at all. Reads and writes hold one lock (threadpool callers)."""

    def __init__(self, cap: int):
        super().__init__()
        self.cap = cap
        self.lock = threading.Lock()

    def lookup(self, key, default=None):
        with self.lock:
            if key not in self:
                return default
            self.move_to_end(key)
            return self[key]

    def store(self, key, value) -> None:
        with self.lock:
            self[key] = value
            self.move_to_end(key)
            while len(self) > self.cap:
                self.popitem(last=False)


_MISS = object()
_ROW_CACHE_MAX = 4096
_ROW_CACHE = _LRU(_ROW_CACHE_MAX)


def _num(v):
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _day_row(store: LocalStore, session: str, sym: str) -> Optional[dict]:
    """The summary row for `sym` on `session`, or None. The file is sorted by
    underlying, so the scan stops once it passes the symbol."""
    path = store.summary_path(session)
    if path is None:
        return None
    try:
        stamp = os.path.getmtime(path)
    except OSError:
        return None
    ck = (path, stamp, sym)
    hit = _ROW_CACHE.lookup(ck, _MISS)
    if hit is not _MISS:
        return hit
    found = None
    with gzip.open(path, "rt", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        legacy = "atm_dte" not in (reader.fieldnames or [])
        for r in reader:
            u = r.get("underlying") or ""
            if u == sym:
                found = dict(r)
                found["_rule"] = LEGACY_RULE if legacy else CURRENT_RULE
                break
            if u > sym:
                break
    _ROW_CACHE.store(ck, found)
    return found


def _point(session: str, r: dict) -> dict:
    iv = _num(r.get("atm_iv"))
    dte = _num(r.get("atm_dte"))
    if dte is None and r.get("atm_expiration"):
        # a legacy (20-45 rule) day has no atm_dte column; the DTE it was read at is
        # still exact: its own expiration minus its own session
        try:
            dte = (_dt.date.fromisoformat(r["atm_expiration"]) - _dt.date.fromisoformat(session)).days
        except ValueError:
            dte = None
    return {"date": session, "atm_iv": iv, "atm_dte": int(dte) if dte is not None else None,
            "atm_expiration": r.get("atm_expiration") or None,
            "underlying_price": _num(r.get("underlying_price")), "rule": r["_rule"]}


# ── sessions the log should hold ────────────────────────────────────────────────

def _now_et(now: Optional[_dt.datetime]) -> _dt.datetime:
    return (now or _dt.datetime.now(_ET)).astimezone(_ET)


def expected_sessions(first: str, now: Optional[_dt.datetime] = None) -> list:
    """Every trading session from `first` through the last one whose log is due."""
    from api.services import session_calendar
    n = _now_et(now)
    last = n.date() if n.time() >= LOG_DUE_ET else n.date() - _dt.timedelta(days=1)
    d, out = _dt.date.fromisoformat(first), []
    while d <= last:
        if session_calendar.is_trading_day(d):
            out.append(d.isoformat())
        d += _dt.timedelta(days=1)
    return out


def _prev_trading_day(d: _dt.date) -> _dt.date:
    from api.services import session_calendar
    d -= _dt.timedelta(days=1)
    while not session_calendar.is_trading_day(d):
        d -= _dt.timedelta(days=1)
    return d


def _next_trading_day(d: _dt.date) -> _dt.date:
    from api.services import session_calendar
    d += _dt.timedelta(days=1)
    while not session_calendar.is_trading_day(d):
        d += _dt.timedelta(days=1)
    return d


# ── the IV series ───────────────────────────────────────────────────────────────

def rank_of(values: list) -> dict:
    """IV rank and percentile of the LAST value against the window. Caller has
    already enforced RANK_MIN_SESSIONS."""
    cur, lo, hi = values[-1], min(values), max(values)
    prior = values[:-1]
    return {
        "current": cur,
        "iv_rank": None if hi == lo else round((cur - lo) / (hi - lo) * 100, 1),
        "iv_percentile": round(sum(1 for v in prior if v < cur) / len(prior) * 100, 1),
        "low": lo, "high": hi, "window_sessions": len(values),
    }


def iv_history(sym: str, *, now: Optional[_dt.datetime] = None,
               store: Optional[LocalStore] = None) -> dict:
    store = store or get_store()
    manifests = store.sessions()
    base = {"symbol": sym, "source": SOURCE, "method": METHOD,
            "rank_min_sessions": RANK_MIN_SESSIONS}
    if not manifests:
        return {**base, "status": "no_log", "logging_began": None, "covers_from": None,
                "covers_to": None, "points": [], "n": 0, "partial": True,
                "partial_reasons": ["The options log holds no sessions yet."],
                "missing_sessions": [], "rank": None,
                "rank_note": f"0 sessions logged, rank needs {RANK_MIN_SESSIONS}."}
    sessions = sorted(manifests)
    began = sessions[0]
    expected = expected_sessions(began, now)
    missing = [d for d in expected if d not in manifests]
    points, absent_days = [], []
    for d in sessions:
        r = _day_row(store, d, sym)
        if r is None:
            absent_days.append(d)
            continue
        p = _point(d, r)
        p["complete"] = bool(manifests[d].get("complete", False))
        points.append(p)
    with_iv = [p for p in points if p["atm_iv"] is not None]
    covers_from = with_iv[0]["date"] if with_iv else None
    reasons = []
    if covers_from:
        gap = [d for d in missing if d >= covers_from]
        if gap:
            reasons.append(f"{len(gap)} trading session{'s' if len(gap) != 1 else ''} since "
                           f"{covers_from} {'were' if len(gap) != 1 else 'was'} not logged "
                           f"({', '.join(gap[-5:])}{' ...' if len(gap) > 5 else ''}).")
        inc = [p["date"] for p in with_iv if not p["complete"]]
        if inc:
            reasons.append(f"The log was incomplete on {', '.join(inc)}.")
        no_iv = [p["date"] for p in points if p["atm_iv"] is None and p["date"] >= covers_from]
        no_row = [d for d in absent_days if d >= covers_from]
        if no_iv or no_row:
            reasons.append(f"No ATM IV for {sym} on {', '.join(sorted(no_iv + no_row))}.")
        legacy = [p["date"] for p in with_iv if p["rule"] == LEGACY_RULE]
        if legacy:
            reasons.append(f"{', '.join(legacy)} {'were' if len(legacy) > 1 else 'was'} read under "
                           "the first run's 20-45 day rule and is left out of any rank.")
    ranked = [p["atm_iv"] for p in with_iv if p["rule"] == CURRENT_RULE][-RANK_WINDOW:]
    n = len(with_iv)
    if len(ranked) >= RANK_MIN_SESSIONS:
        rank, rank_note = rank_of(ranked), None
    else:
        rank = None
        rank_note = (f"{len(ranked)} session{'s' if len(ranked) != 1 else ''} logged, "
                     f"rank needs {RANK_MIN_SESSIONS}.")
    if not with_iv:
        status = "not_in_log"
        reasons.insert(0, f"The log holds no ATM IV for {sym} since it began on {began}.")
    else:
        status = "ok"
    return {**base, "status": status, "logging_began": began, "covers_from": covers_from,
            "covers_to": with_iv[-1]["date"] if with_iv else None,
            "points": points, "n": n, "sessions_logged": len(sessions),
            "missing_sessions": missing, "partial": bool(reasons) or not with_iv,
            "partial_reasons": reasons, "rank": rank, "rank_note": rank_note}


# ── BRK-10: implied vs realized, trailing ──────────────────────────────────────

_PRINTS_CACHE_MAX = 512
_PRINTS_CACHE = _LRU(_PRINTS_CACHE_MAX)
_PRINTS_TTL_S = 6 * 3600


def _default_prints(sym: str) -> list:
    """Past prints, newest first: [{reportedDate, reportTime}] (FMP stable/earnings via the
    engine's normalizer). FMP carries no pre/post timing, so O4 fills `reportTime` from the
    earnings calendar where it has the print ("pre-market" / "post-market", the words every
    reader here already parses); a print the calendar does not time stays '' = unknown."""
    hit = _PRINTS_CACHE.lookup(sym)
    if hit and time.monotonic() - hit[0] < _PRINTS_TTL_S:
        return hit[1]
    from api.services.engine import _fetch_quarterly_history
    quarters = _fetch_quarterly_history(sym)
    if quarters:
        quarters = with_report_times(sym, quarters)
        _PRINTS_CACHE.store(sym, (time.monotonic(), quarters))
    return quarters


_HOUR_WORDS = {"bmo": "pre-market", "amc": "post-market"}


def _default_calendar_hours(sym: str, start: str, end: str) -> dict:
    """{report_date: 'bmo'|'amc'} from Finnhub's earnings calendar for one symbol over a range.
    Finnhub's `hour` is the only timing source on our plans; its symbol-filtered history is
    patchy, so whatever it does not answer stays unknown. {} on any failure."""
    from api.services.finnhub_client import fh_get
    data = fh_get("/calendar/earnings", {"symbol": sym, "from": start, "to": end}, timeout=8)
    rows = data.get("earningsCalendar") if isinstance(data, dict) else None
    out = {}
    for r in rows or []:
        if not isinstance(r, dict) or (r.get("symbol") or "").upper() != sym.upper():
            continue
        h, d = (r.get("hour") or "").strip().lower(), str(r.get("date") or "")[:10]
        if d and h in _HOUR_WORDS:
            out[d] = h
    return out


_calendar_hours = _default_calendar_hours


def with_report_times(sym: str, quarters: list) -> list:
    """Copies of `quarters` with `reportTime` filled from the earnings calendar where it is
    blank (never overwriting a vendor's own value). A failure leaves every print as it was."""
    dates = sorted(str(q.get("reportedDate") or "")[:10] for q in quarters if q.get("reportedDate"))
    if not dates:
        return quarters
    try:
        hours = _calendar_hours(sym, dates[0], dates[-1]) or {}
    except Exception:  # noqa: BLE001 -- timing is best-effort; unknown stays unknown
        hours = {}
    out = []
    for q in quarters:
        q = dict(q)
        h = hours.get(str(q.get("reportedDate") or "")[:10])
        if not (q.get("reportTime") or "").strip() and h:
            q["reportTime"] = _HOUR_WORDS[h]
            q["reportTimeSource"] = "earnings calendar (Finnhub)"
        out.append(q)
    return out


def _default_realized(sym: str, quarters: list) -> list:
    """Signed earnings gap %, positionally aligned with quarters[:8] (None = unknown)."""
    from api.services.earnings_enrichment import get_historical_earnings_moves
    out = get_historical_earnings_moves(sym, quarters) or {}
    return list(out.get("moves_pct") or [])


def implied_vs_realized(sym: str, *, now: Optional[_dt.datetime] = None,
                        store: Optional[LocalStore] = None,
                        prints: Optional[Callable[[str], list]] = None,
                        realized: Optional[Callable[[str, list], list]] = None) -> dict:
    store = store or get_store()
    prints = prints or _default_prints
    realized = realized or _default_realized
    manifests = store.sessions()
    began = min(manifests) if manifests else None
    base = {"symbol": sym, "logging_began": began, "method": IMPLIED_METHOD, "source": SOURCE,
            "calibration_min_prints": CALIBRATION_MIN_PRINTS}
    today = _now_et(now).date()
    quarters = [q for q in (prints(sym) or [])[:8]]
    rows, before_log, not_logged = [], 0, []
    pairable = []
    for i, q in enumerate(quarters):
        try:
            d = _dt.date.fromisoformat((q.get("reportedDate") or "")[:10])
        except ValueError:
            continue
        if d >= today:
            continue
        timing = (q.get("reportTime") or "").lower()
        pre = d if "post" in timing else _prev_trading_day(d)
        reaction = _next_trading_day(d) if "post" in timing or not timing else d
        if began is None or pre.isoformat() < began:
            before_log += 1
            continue
        if pre.isoformat() not in manifests:
            not_logged.append(d.isoformat())
            continue
        pairable.append((i, d, pre, reaction, timing))
    moves = realized(sym, quarters) if pairable else []
    for i, d, pre, reaction, timing in pairable:
        r = _day_row(store, pre.isoformat(), sym) or {}
        straddle, px = _num(r.get("front_straddle")), _num(r.get("underlying_price"))
        fexp = r.get("front_expiration") or None
        row = {"report_date": d.isoformat(), "pre_print_session": pre.isoformat(),
               "timing": timing or "unknown", "front_expiration": fexp,
               "implied_move_pct": None, "realized_move_pct": None, "ratio": None,
               "inside": None, "note": None}
        if straddle is None or not px:
            row["note"] = "The log has no two-sided front straddle for this session."
        elif fexp is None or fexp < reaction.isoformat():
            row["note"] = "The front expiry closed before the reaction session."
        else:
            row["implied_move_pct"] = round(straddle / px * 100, 2)
        mv = moves[i] if i < len(moves) else None
        if mv is not None:
            row["realized_move_pct"] = round(float(mv), 2)
        elif row["note"] is None:
            row["note"] = "The realized move is not available yet."
        if row["implied_move_pct"] and row["realized_move_pct"] is not None:
            a = abs(row["realized_move_pct"])
            row["ratio"] = round(a / row["implied_move_pct"], 2)
            row["inside"] = a <= row["implied_move_pct"]
        rows.append(row)
    paired = [r for r in rows if r["ratio"] is not None]
    n = len(paired)
    if n >= CALIBRATION_MIN_PRINTS:
        calibration = {
            "prints": n,
            "mean_ratio": round(sum(r["ratio"] for r in paired) / n, 2),
            "inside_share": round(sum(1 for r in paired if r["inside"]) / n * 100, 1),
        }
        note = None
    else:
        calibration = None
        if began is None:
            note = "The options log holds no sessions yet; no print can be compared."
        elif n == 0:
            note = (f"Logging began {began}; first comparison after the next print.")
        else:
            note = (f"{n} print{'s' if n != 1 else ''} compared; a reliability read needs "
                    f"{CALIBRATION_MIN_PRINTS}.")
    return {**base, "prints": rows, "paired": n, "prints_before_log": before_log,
            "prints_not_logged": not_logged, "calibration": calibration,
            "calibration_note": note}
