"""Orchestrates the fundamentals widget payload: annual table (annual_financials)
+ quarterly strip (get_year_earnings) + next earnings date. Picks a cache TTL
that collapses to 5 min around a ticker's earnings (the event fast-path).

Serve path is stale-while-revalidate over a persistent disk snapshot
(fundamentals_snapshot_store): memory hit → disk hit (fresh) → disk hit
(stale ≤3 days: return instantly + background rebuild) → synchronous build
(first-ever ticker only). The multi-provider assembly never lands on the
request path for a ticker anyone has viewed before — including across
redeploys."""
from __future__ import annotations

import logging
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from api.services import earnings_estimates as ee
from api.services import fundamentals_snapshot_store as snap_store
from api.services import yf_util
from api.services.annual_financials import get_annual_financials
from api.services.cache import cache

_log = logging.getLogger(__name__)

_FAST_TTL = 300       # 5 min — within the earnings window
_SLOW_TTL = 21_600    # 6 h — normal cadence
_EMPTY_TTL = 120      # 2 min — a fully-empty payload (transient outage) self-heals fast
_STALE_SERVE_MAX = 3 * 86400   # serve an expired snapshot up to 3 days old while refreshing
_SNAP_KIND = "earnings_table"

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - zoneinfo always present on 3.9+
    _ET = timezone.utc

# Indirection so tests can monkeypatch the annual builder by name.
get_annual_financials_fn = get_annual_financials

_Q_LABEL = lambda year, q: f"{year} Q{q}"


def _next_q_label(label):
    """Increment a 'YYYY Qn' fiscal-quarter label by one (Q4 rolls to next-year
    Q1). Used to label the next (unreported) earnings row in sequence with the
    reported quarters — avoids the calendar-derived label colliding with an
    already-reported fiscal quarter (the duplicate '2026 Q3' bug)."""
    m = re.match(r"(\d{4})\s*Q([1-4])$", str(label or "").strip())
    if not m:
        return None
    y, q = int(m.group(1)), int(m.group(2))
    q += 1
    if q > 4:
        q = 1
        y += 1
    return f"{y} Q{q}"


def _label_from_period_end(date_str):
    """"YYYY QN" label for an estimate row keyed by its fiscal period END date
    (FMP analyst-estimates' `date` field). Delegates to the single shared mapper
    (`ee._fiscal_q_from_period_end`) so estimates and actuals — across every
    source — share ONE fiscal-quarter numbering."""
    q, y = ee._fiscal_q_from_period_end(date_str)
    return f"{y} Q{q}" if q else None


def _yoy_label(label):
    """The same fiscal quarter one year earlier ('2027 Q1' → '2026 Q1'). Used to
    find the prior-year actual for a forward estimate quarter's YoY growth %."""
    m = re.match(r"(\d{4})\s*Q([1-4])$", str(label or "").strip())
    if not m:
        return None
    return f"{int(m.group(1)) - 1} Q{int(m.group(2))}"


def _parse_date(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _in_earnings_window(next_date, last_report, now, days=1):
    nowdt = datetime.fromtimestamp(now, tz=timezone.utc)
    nd = _parse_date(next_date)
    if nd is not None and abs((nd - nowdt).days) <= days:
        return True
    lr = _parse_date(last_report)
    if lr is not None and 0 <= (nowdt - lr).days <= days + 1:
        return True
    return False


def _next_earnings(ticker):
    """Upcoming earnings date + consensus from Finnhub /calendar/earnings."""
    from datetime import date, timedelta
    today = date.today()
    to = today + timedelta(days=120)
    data = ee._fh_get("/calendar/earnings",
                      {"symbol": ticker, "from": today.isoformat(), "to": to.isoformat()})
    rows = (data or {}).get("earningsCalendar") if isinstance(data, dict) else None
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: str(r.get("date") or ""))
    nxt = rows[0]
    return {
        "date": str(nxt.get("date") or "")[:10] or None,
        "eps_estimate": nxt.get("epsEstimate"),
        "rev_estimate": nxt.get("revenueEstimate"),
    }


def _last_report_date(ticker):
    intel = ee.get_earnings_intel(ticker) or {}
    hist = intel.get("beat_history") or []
    dates = [h.get("period") for h in hist if h.get("period")]
    return max(dates) if dates else None


def _is_fresh_window(ticker, now):
    """True within ±1 day of the ticker's next/last earnings — the window where
    the strip must freshen aggressively so a just-reported quarter flips fast."""
    try:
        nxt = _next_earnings(ticker)
    except Exception:
        nxt = None
    try:
        last = _last_report_date(ticker)
    except Exception:
        last = None
    nd = nxt.get("date") if nxt else None
    return _in_earnings_window(nd, last, now)


def _choose_ttl(ticker, now):
    return _FAST_TTL if _is_fresh_window(ticker, now) else _SLOW_TTL


_FWD_QUARTERS = 4   # how many forward-estimate quarters to surface


def _num(v):
    # Coerce to a finite float; NaN/inf → None (yfinance estimate cells are NaN
    # for thin names — a raw NaN 500s the JSON render via allow_nan=False).
    try:
        if v is None:
            return None
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _sanitize(obj):
    """Recursively replace non-finite floats (NaN/inf) with None so the payload
    is always renderable by Starlette's json.dumps(allow_nan=False). Belt-and-
    suspenders behind the per-source _num guards: a single stray NaN otherwise
    500s the endpoint AND caches the poison for the full TTL."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


def _rev(v):
    """A revenue estimate is never legitimately exactly 0 for an operating
    company — some vendors (e.g. Yahoo for certain utilities) return 0/NaN when
    they simply lack a quarterly revenue consensus. Treat 0 as missing so the
    strip renders '—' instead of a misleading '$0'."""
    n = _num(v)
    return None if (n is None or n == 0) else n


# Grace window for a fiscal quarter that has ENDED but not yet been REPORTED
# (10-Qs land ~3-6 weeks after period end; 130d also covers slow foreign
# filers). An estimate row older than this with still no reported actual is
# dead/delinquent data — drop it.
_UNREPORTED_GRACE_DAYS = 130


def _fmp_forward_quarters(ticker, limit, reported_labels=frozenset()):
    """Up to `limit` UNREPORTED quarters of analyst consensus (EPS + revenue)
    from FMP stable/analyst-estimates (period=quarter), chronological
    [{period_end, label, eps_estimate, rev_estimate}].

    FMP's `date` is the fiscal period END, not the report date — a quarter that
    ended days ago but reports weeks from now is still a FORWARD quarter. So
    the filter keeps every row inside the grace window whose derived fiscal
    label has no reported actual yet (the 2026-07-02 MXL off-by-one: filtering
    on `period_end < today` dropped the just-ended quarter and shifted all four
    forward cards one quarter over).

    GATED by FUNDAMENTALS_FMP_ANALYST_ESTIMATES=1 (quarterly analyst-estimates
    is an FMP Ultimate feature; the yfinance backstop carries forward quarters
    when off, so the call would be a wasted round-trip on every load)."""
    if os.environ.get("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "0").lower() not in ("1", "true", "yes"):
        return []
    data = ee._fmp_get("/stable/analyst-estimates",
                       {"symbol": ticker, "period": "quarter", "limit": 40})
    if not isinstance(data, list):
        return []
    from datetime import date, timedelta
    floor = (date.today() - timedelta(days=_UNREPORTED_GRACE_DAYS)).isoformat()

    def _pick(row, *keys):
        for k in keys:
            v = row.get(k)
            if v is not None:
                return _num(v)
        return None

    fut, seen = [], set()
    for row in data:
        d = str(row.get("date") or "")[:10]
        if not d or d < floor:
            continue
        label = _label_from_period_end(d)
        if label is None or label in reported_labels or label in seen:
            continue
        eps = _pick(row, "epsAvg", "estimatedEpsAvg")
        rev = _rev(_pick(row, "revenueAvg", "estimatedRevenueAvg"))
        if eps is None and rev is None:
            continue
        seen.add(label)
        fut.append({"period_end": d, "label": label,
                    "eps_estimate": eps, "rev_estimate": rev})
    fut.sort(key=lambda r: r["period_end"])
    return fut[:limit]


def _yf_forward_quarters(ticker, limit):
    """Up to 2 near forward quarters (current 0q + next +1q) of mean EPS &
    revenue from yfinance — the broad-coverage US backstop for the long tail
    where FMP analyst-estimates is empty. No report dates (Yahoo gives none)."""
    try:
        import yfinance as yf
    except Exception:
        return []
    out = []
    try:
        # Bound each Yahoo fetch so a hung response frees the worker thread.
        eps_df = yf_util.bounded_call(lambda: yf.Ticker(ticker).earnings_estimate, None)
        rev_df = yf_util.bounded_call(lambda: yf.Ticker(ticker).revenue_estimate, None)

        def _avg(df, idx):
            try:
                if df is None or idx not in df.index:
                    return None
                return _num(df.loc[idx].get("avg"))
            except Exception:
                return None

        for idx in ("0q", "+1q"):
            eps = _avg(eps_df, idx)
            rev = _rev(_avg(rev_df, idx))
            if eps is None and rev is None:
                continue
            out.append({"date": None, "eps_estimate": eps, "rev_estimate": rev})
    except Exception as exc:
        _log.info("yfinance forward quarters failed for %s: %s", ticker, exc)
    return out[:limit]


def _next_report_date(ticker, now=None):
    """The next scheduled earnings report date. FMP stable/earnings carries the
    upcoming report as a future row (epsActual null) with a real date and is on
    the current plan — use its earliest future date; fall back to the Finnhub
    calendar. Used to stamp a real date onto the nearest forward quarter when
    the estimate source (yfinance) supplies none.

    `now` (unix seconds) is the AS-OF clock, threaded from _build_quarterly. It
    used to read date.today() directly, which silently ignored the injected
    clock: every caller below already honors `now`, so "what is still in the
    future" was answered against the real date while everything around it was
    answered against the as-of date. Harmless in prod (they coincide) but it
    made the seam untestable — a pinned-date test drifted into failure the day
    its fixture's scheduled report slipped into the real past."""
    try:
        data = ee._fmp_get("/stable/earnings", {"symbol": ticker, "limit": 8})
        if isinstance(data, list):
            from datetime import date, datetime, timezone
            today = (date.today().isoformat() if now is None else
                     datetime.fromtimestamp(now, tz=timezone.utc).date().isoformat())
            futures = sorted(
                str(r.get("date") or "")[:10] for r in data
                if r.get("epsActual") is None and r.get("revenueActual") is None
                and str(r.get("date") or "")[:10] >= today
            )
            if futures:
                return futures[0]
    except Exception:
        pass
    try:
        nxt = _next_earnings(ticker)
        return nxt.get("date") if nxt else None
    except Exception:
        return None


def _stamp_next_report_date(ticker, rows, now=None):
    """Attach the real scheduled report date to the NEAREST forward quarter.
    Sanity-gated when the row carries a period end: the scheduled report must
    fall between the period end and ~120 days after it, else a wrong-symbol or
    stale calendar entry would mislabel the card."""
    if not rows or rows[0].get("report_date"):
        return rows
    d = _next_report_date(ticker, now=now)
    if not d:
        return rows
    pe = rows[0].get("period_end")
    if pe:
        pe_dt, d_dt = _parse_date(pe), _parse_date(d)
        if pe_dt is None or d_dt is None:
            return rows
        delta = (d_dt - pe_dt).days
        if not (0 <= delta <= 120):
            return rows
    rows[0] = {**rows[0], "report_date": d}
    return rows


def _forward_quarters(ticker, limit, reported_labels=frozenset(), now=None):
    """Forward-estimate quarters for the strip, coverage-maximizing chain:
    FMP analyst-estimates (depth, period-labeled, FMP Ultimate) → yfinance
    (broad backstop, 2 near quarters, no labels) → single Finnhub next-earnings
    event. First non-empty wins. Rows are normalized to
    {label?, period_end?, report_date?, eps_estimate, rev_estimate}; the
    nearest quarter gets the real scheduled report date."""
    try:
        rows = _fmp_forward_quarters(ticker, limit, reported_labels)
    except Exception:
        rows = []
    if not rows:
        try:
            rows = [{"period_end": None, "label": None,
                     "eps_estimate": r.get("eps_estimate"),
                     "rev_estimate": r.get("rev_estimate")}
                    for r in _yf_forward_quarters(ticker, limit)]
        except Exception:
            rows = []
    if rows:
        return _stamp_next_report_date(ticker, rows[:limit], now=now)
    try:
        nxt = _next_earnings(ticker)
    except Exception:
        nxt = None
    if nxt and nxt.get("date"):
        return [{"period_end": None, "label": None, "report_date": nxt["date"],
                 "eps_estimate": nxt.get("eps_estimate"),
                 "rev_estimate": nxt.get("rev_estimate")}]
    return []


def _build_quarterly(ticker, now, fresh=False):
    cur_y = datetime.fromtimestamp(now, tz=_ET).year   # ET: fiscal/earnings calendar boundary
    reported = []
    for y in (cur_y - 1, cur_y):
        for r in ee.get_year_earnings(ticker, y, fresh=fresh):
            if r.get("eps_actual") is None and r.get("revenue_actual") is None:
                continue
            reported.append({
                "label": _Q_LABEL(r.get("year"), r.get("quarter")),
                "_sort": (r.get("year") or 0, r.get("quarter") or 0),
                "eps_actual": r.get("eps_actual"),
                "eps_estimate": r.get("eps_estimate"),
                "eps_surprise_pct": r.get("eps_surprise_pct"),
                "rev_actual": r.get("revenue_actual"),
                "rev_estimate": r.get("revenue_estimate"),
                "rev_surprise_pct": r.get("revenue_surprise_pct"),
                "reported": True,
            })
    reported.sort(key=lambda r: r["_sort"])
    # Lookup of ALL available actuals by label (not just the displayed 5) so a
    # forward estimate quarter can compute YoY growth vs the year-ago actual.
    actual_by_label = {r["label"]: r for r in reported}
    last5 = reported[-5:]
    for r in last5:
        r.pop("_sort", None)

    out = list(last5)
    # Forward estimate quarters. FMP rows carry an authoritative label derived
    # from their fiscal period end (and rows for already-reported periods were
    # filtered out upstream); label-less rows (yfinance / Finnhub) fall back to
    # incrementing the last label in sequence, which never duplicates a
    # reported label by construction.
    label = last5[-1]["label"] if last5 else None
    for q in _forward_quarters(ticker, _FWD_QUARTERS, frozenset(actual_by_label), now=now):
        next_label = q.get("label") or _next_q_label(label)
        if next_label is None:
            qd = _parse_date(q.get("report_date") or q.get("period_end"))
            next_label = _Q_LABEL(qd.year, (qd.month - 1) // 3 + 1) if qd else None
        # YoY growth %: estimate vs the same fiscal quarter a year ago (actual).
        # ee._surprise_pct(a, e) = (a-e)/|e| — exactly the YoY growth of `a` over `e`.
        ya = actual_by_label.get(_yoy_label(next_label))
        eps_yoy = ee._surprise_pct(q.get("eps_estimate"), ya.get("eps_actual")) if ya else None
        rev_yoy = ee._surprise_pct(q.get("rev_estimate"), ya.get("rev_actual")) if ya else None
        out.append({
            "label": next_label,
            "report_date": q.get("report_date"),
            "period_end": q.get("period_end"),
            "eps_estimate": q.get("eps_estimate"),
            "rev_estimate": q.get("rev_estimate"),
            "eps_est_chg_pct": eps_yoy,
            "rev_est_chg_pct": rev_yoy,
            "reported": False,
        })
        label = next_label
    return out


def _build(ticker, now):
    """Full multi-provider assembly → (sanitized result, fresh). Annual runs in
    parallel with the (fresh-window + quarterly) chain — the two halves hit
    disjoint providers, so overlap roughly halves a cold build."""
    with ThreadPoolExecutor(max_workers=1) as ex:
        fut_annual = ex.submit(lambda: get_annual_financials_fn(ticker, now=now))
        # Compute the earnings window ONCE: it both selects the outer TTL and
        # tells the quarterly builder to freshen the inner year-earnings cache.
        fresh = _is_fresh_window(ticker, now)
        quarterly = _build_quarterly(ticker, now, fresh=fresh)
        annual = fut_annual.result()
    # Sanitize any non-finite float (NaN/inf) → None so the response always
    # renders (Starlette json.dumps allow_nan=False) and no poison is cached.
    result = _sanitize({"ticker": ticker, "annual": annual, "quarterly": quarterly})
    return result, fresh


def _build_and_cache(ticker, now=None):
    """Build + populate memory cache; persist non-empty results to disk."""
    now = time.time() if now is None else now
    result, fresh = _build(ticker, now)
    ckey = f"earnings_table::{ticker}"
    ttl = _FAST_TTL if fresh else _SLOW_TTL
    # ⛔ NEVER CACHE A PARTIAL RESULT AS IF IT WERE COMPLETE.
    #
    # This used to read `not annual AND not quarterly` — i.e. only a TOTALLY
    # empty payload got the short retry TTL. If just ONE leg failed (annual
    # resolved, quarterly didn't, or vice versa) the half-answer fell through
    # to the branch below and was pinned for up to 6h in cache AND persisted to
    # the snapshot store, where a stale-served blank sticks even longer. The
    # user sees a half-populated earnings table and no retry until it expires.
    #
    # Same bug class already fixed once in `earnings_estimates.get_earnings_
    # intel` (a partial intel fetch pinned `beat_history: []` for 6h while the
    # provider was healthy) and documented in this repo as "never cache a
    # failed fetch as a value". Found again here by the 2026-08-05 data-coverage
    # audit. A partial is still SERVED — dropping it would discard the leg that
    # did work — it just expires fast so the missing leg self-heals in minutes.
    partial = not result["annual"] or not result["quarterly"]
    if partial:
        # Not persisted to the snapshot store either: a stale-served partial
        # would outlive the outage that caused it.
        cache.set(ckey, result, _EMPTY_TTL)
        return result
    cache.set(ckey, result, ttl)
    snap_store.put(_SNAP_KIND, ticker, result, ttl, now=now)
    return result


_refresh_inflight: set[str] = set()
_refresh_lock = threading.Lock()


def _schedule_refresh(ticker):
    """Background rebuild after a stale-serve (deduped per ticker)."""
    with _refresh_lock:
        if ticker in _refresh_inflight:
            return
        _refresh_inflight.add(ticker)

    def _run():
        try:
            _build_and_cache(ticker)
        except Exception as e:
            _log.warning("earnings-table bg refresh failed for %s: %s", ticker, e)
        finally:
            with _refresh_lock:
                _refresh_inflight.discard(ticker)

    threading.Thread(target=_run, daemon=True, name=f"fund-table-refresh-{ticker}").start()


def invalidate(ticker):
    """Drop the ticker's payload from memory AND disk so the next read is a
    true rebuild (used by the fundamentals monitor's self-heal)."""
    s = (ticker or "").upper().strip()
    if not s:
        return
    cache.invalidate(f"earnings_table::{s}")
    snap_store.delete(_SNAP_KIND, s)


def refresh_now(ticker, max_age=600, now=None):
    """Synchronous rebuild if the stored snapshot is older than `max_age`
    seconds (the earnings-day reporters warm). Also clears the inner per-year
    earnings cache so a just-reported quarter is pulled fresh from the source
    rather than served from a pre-print inner entry. Returns True if rebuilt."""
    now = time.time() if now is None else now
    s = (ticker or "").upper().strip()
    if not s:
        return False
    snap = snap_store.get(_SNAP_KIND, s, now=now)
    if snap is not None and snap[1] <= max_age:
        return False
    cache.invalidate(f"earnings_table::{s}")
    # Separator-anchored prefix (must span the per-year suffix) — same idiom as
    # the fundamentals monitor heal.
    cache.delete_prefix(f"mb_year_earnings_{s}_")
    _build_and_cache(s, now=now)
    return True


def get_earnings_table(ticker, now=None, debug=False):
    now = time.time() if now is None else now
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return {"ticker": "", "annual": [], "quarterly": []}

    if debug:
        result, _fresh = _build(ticker, now)
        result["_sources"] = {
            "annual": (result["annual"][0].get("_source") if result["annual"] else None),
            "quarterly": "get_year_earnings",
        }
        return result

    ckey = f"earnings_table::{ticker}"
    hit = cache.get(ckey)
    if hit is not None:
        return hit

    snap = snap_store.get(_SNAP_KIND, ticker, now=now)
    if snap is not None:
        payload, age, ttl = snap
        if age <= ttl:
            # Fresh on disk (e.g. right after a redeploy) — seed memory, serve.
            cache.set(ckey, payload, max(60, ttl - age))
            return payload
        if age <= _STALE_SERVE_MAX:
            # Stale-while-revalidate: instant response, background rebuild.
            # Short memory pin so a request storm doesn't re-read disk per hit;
            # the background refresh overwrites it with the rebuilt payload.
            cache.set(ckey, payload, 60)
            _schedule_refresh(ticker)
            return payload
        # Too old to trust — fall through to a synchronous rebuild.

    return _build_and_cache(ticker, now=now)
