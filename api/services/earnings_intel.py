"""Normalized earnings intelligence for the Company Intelligence panel.

WHY THIS EXISTS
The Earnings tab was wired to `/api/fundamentals/earnings-table`, which returns
annual rows plus a couple of unlabelled forward estimates — no quarterly
actuals, no report dates, no surprise. Meanwhile `earnings_estimates.
get_year_earnings()` already assembles exactly that per fiscal quarter (EPS and
revenue, actual vs estimate, with surprise) from providers we already pay for.
This module is the missing normalization layer between them.

SOURCE PRECEDENCE (§50) — explicit, not "whoever answered first":
  1. FMP / Finnhub via earnings_estimates — the only sources carrying CONSENSUS
     estimates, so the only ones that can produce a surprise.
  2. yfinance quarterly income statement via financial_statements — reported EPS
     and revenue ACTUALS only. Free, keyless, and already cached for the
     Financials tab, so it costs nothing extra. It fills quarters tier 1 misses
     and is the whole story when no estimate provider is configured.
Actuals from tier 2 never invent an estimate, and a quarter whose actual and
estimate come from different bases never gets a surprise (§29).

EPS BASIS (§28) — this is the trap in earnings data. FMP's `epsActual` is the
consensus-comparable figure (typically adjusted/non-GAAP); a yfinance income
statement's Diluted EPS is GAAP. Comparing one against the other's estimate
would manufacture a fake surprise, so every quarter records `eps_basis` and a
surprise is computed ONLY when actual and estimate share a basis.

CACHING (§44-47) — company-level and shared. Reported quarters are immutable, so
the payload persists to the same SQLite store the other panels use. Freshness is
proximity-weighted: far from a report the payload is good for days; inside the
report window it drops to minutes, because that is the only time the numbers
actually move.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime

from api.services import fundamentals_snapshot_store as snap_store
from api.services.cache import cache

_log = logging.getLogger(__name__)

# VERSIONED: the normalized row shape is part of what gets persisted, so widening
# it must invalidate stored payloads — otherwise every ticker keeps serving the
# older shape and the new fields read as missing data. Bump on schema change.
_KIND = "earnings_intel_v3"
_STALE_MAX = 45 * 86400
# Proximity-weighted freshness: estimates and a pending print move, settled
# history does not (§46).
_TTL_FAR = 24 * 3600        # > 10 days from the next report
_TTL_NEAR = 3 * 3600        # within 10 days
_TTL_WINDOW = 15 * 60       # within ~2 days either side of the report

_QUARTERS_BACK = 12         # how far the history reaches when data supports it

_refreshing: set[str] = set()
_lock = threading.Lock()


# ── math with honest edge cases ─────────────────────────────────────────────
def _yoy(cur, prior):
    """(pct, note). A percentage across a sign change is meaningless, so those
    cases return a NOTE instead of a number (§56)."""
    if cur is None or prior is None:
        return None, None
    if prior == 0:
        return None, None
    if prior < 0 and cur >= 0:
        return None, "turned_profitable"
    if prior > 0 and cur < 0:
        return None, "turned_negative"
    if prior < 0 and cur < 0:
        # both losses: shrinking loss is an improvement, expressed on magnitudes
        return ((abs(prior) - abs(cur)) / abs(prior)) * 100.0, "loss_narrowing" if abs(cur) < abs(prior) else "loss_widening"
    return ((cur - prior) / abs(prior)) * 100.0, None


def _surprise(actual, estimate, *, eps: bool):
    """(pct, abs, note). Percent surprise is unusable when the estimate sits near
    zero — a $0.01 estimate and a $0.03 actual is '+200%', which overstates a
    two-cent beat. Those return the absolute surprise instead (§9)."""
    if actual is None or estimate is None:
        return None, None, None
    diff = actual - estimate
    if eps and abs(estimate) < 0.05:
        return None, diff, "near_zero_estimate"
    if estimate == 0:
        return None, diff, "zero_estimate"
    return (diff / abs(estimate)) * 100.0, diff, None


def _fiscal_label(year, q):
    return f"FY{year} Q{q}" if year and q else None


def fiscal_qy(period_end: str, fye_month: int | None):
    """(fiscal_year, fiscal_quarter) for a period-end date.

    Calendar quarters are WRONG for most large companies. Micron's fiscal year
    ends in August, so its quarter ending 31 May is fiscal Q3 — deriving the
    quarter from the calendar month labels it Q2 and shifts every period by one.
    Apple (Sep), Microsoft (Jun), Walmart and NVIDIA (Jan) are all affected.

    With the fiscal-year-end month known, the quarter is the position of this
    period inside the fiscal year, and the fiscal year rolls forward once the
    month passes the year end.
    """
    try:
        d = datetime.strptime(str(period_end)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None, None
    if not fye_month:
        # Unknown fiscal calendar: fall back to calendar quarters, which is at
        # least honest for the ~30% of companies that end in December.
        return d.year, (d.month - 1) // 3 + 1
    q = ((d.month - fye_month - 1) % 12) // 3 + 1
    fy = d.year + (1 if d.month > fye_month else 0)
    return fy, q


# ── tier 2: free quarterly ACTUALS from the statements we already cache ─────
def _actuals_from_statements(sym: str) -> dict:
    """{(year, quarter): row} of reported EPS/revenue from the yfinance quarterly
    income statement. GAAP diluted EPS — labelled as such, never silently mixed
    with a consensus estimate."""
    out = {}
    try:
        from api.services.financial_statements import get_statements
        st = get_statements(sym) or {}
        rows = ((st.get("income") or {}).get("quarterly")) or []
        # The annual period end IS the fiscal year end — the cheapest reliable
        # source of a company's fiscal calendar, and we already have it cached.
        annual = ((st.get("income") or {}).get("annual")) or []
        fye_month = int(str(annual[0]["period"])[5:7]) if annual else None
    except Exception as e:  # noqa: BLE001
        _log.debug("earnings actuals from statements failed for %s: %s", sym, e)
        return out
    out["_fye_month"] = fye_month
    for p in rows:
        period = str(p.get("period") or "")[:10]
        if len(period) < 10:
            continue
        try:
            d = datetime.strptime(period, "%Y-%m-%d").date()
        except ValueError:
            continue
        v = p.get("values") or {}
        rev, ni = v.get("revenue"), v.get("net_income")
        # After-tax margin per quarter. IBD's earnings block carries margin beside
        # EPS and sales for a reason: growth without margin corroboration is the
        # classic trap (a sales surge funded by discounting looks identical to a
        # real one until you see the margin). Free — same statement row we cache.
        margin = (ni / rev * 100.0) if (rev not in (None, 0) and ni is not None) else None
        # Fiscal quarter is derived from the period-end month; the fiscal YEAR is
        # the one the company labels it, which we cannot know from the statement
        # alone — so key on the calendar period end and let the caller align
        # year-over-year by date rather than by fiscal label.
        fy, fq = fiscal_qy(period, fye_month)
        out[period] = {
            "period_end": period,
            "period_date": d,
            "fiscal_year": fy, "fiscal_quarter": fq,
            "eps_actual": v.get("eps_diluted"),
            "revenue_actual": rev,
            "net_margin_pct": margin,
            "eps_basis": "gaap_diluted",
            "source": "yfinance-statement",
        }
    return out


# ── tier 1: consensus-bearing quarters ──────────────────────────────────────
def _quarters_from_estimates(sym: str) -> list:
    """Reported quarters WITH consensus, newest first. Empty when no estimate
    provider is configured — the caller then runs on actuals alone."""
    rows = []
    try:
        from api.services import earnings_estimates as ee
    except Exception:  # noqa: BLE001
        return rows
    this_year = date.today().year
    for year in range(this_year - 3, this_year + 1):
        try:
            got = ee.get_year_earnings(sym, year) or []
        except Exception as e:  # noqa: BLE001
            _log.debug("get_year_earnings %s %s failed: %s", sym, year, e)
            continue
        for r in got:
            if r.get("eps_actual") is None and r.get("revenue_actual") is None:
                continue
            rows.append({
                "year": r.get("year"), "quarter": r.get("quarter"),
                "report_date": r.get("date"),
                "eps_actual": r.get("eps_actual"),
                "eps_estimate": r.get("eps_estimate"),
                "revenue_actual": r.get("revenue_actual"),
                "revenue_estimate": r.get("revenue_estimate"),
                # FMP/Finnhub actuals are the consensus-comparable figure.
                "eps_basis": "consensus_comparable",
                "source": "fmp/finnhub",
            })
    rows.sort(key=lambda r: (r.get("year") or 0, r.get("quarter") or 0), reverse=True)
    return rows


def _build(sym: str) -> dict:
    tier1 = _quarters_from_estimates(sym)
    tier2 = _actuals_from_statements(sym)
    fye_month = tier2.pop("_fye_month", None)

    quarters = []
    if tier1:
        for r in tier1:
            quarters.append({**r, "reported": True,
                             "label": _fiscal_label(r.get("year"), r.get("quarter"))})
        used = "fmp/finnhub"
    else:
        # Actuals-only mode. Real reported history, no consensus — so no surprise
        # is shown rather than a fabricated one.
        for period in sorted(tier2.keys(), reverse=True):
            a = tier2[period]
            quarters.append({
                "year": a["fiscal_year"], "quarter": a["fiscal_quarter"],
                "label": _fiscal_label(a["fiscal_year"], a["fiscal_quarter"]),
                "report_date": None, "period_end": period,
                "eps_actual": a["eps_actual"], "eps_estimate": None,
                "revenue_actual": a["revenue_actual"], "revenue_estimate": None,
                "eps_basis": a["eps_basis"], "source": a["source"],
                "reported": True,
            })
        used = "yfinance-statement" if quarters else None

    # Fill missing actuals from tier 2 where tier 1 had a gap, matching on the
    # fiscal period end when we have one.
    by_end = {v["period_end"]: v for v in tier2.values()}
    for q in quarters:
        pe = q.get("period_end")
        src = by_end.get(pe) if pe else None
        if src:
            for k in ("eps_actual", "revenue_actual"):
                if q.get(k) is None:
                    q[k] = src.get(k)
        if q.get("net_margin_pct") is None and src:
            q["net_margin_pct"] = src.get("net_margin_pct")

    quarters = quarters[:_QUARTERS_BACK]

    # Year-over-year: the SAME fiscal quarter one year earlier, matched by
    # (year-1, quarter) rather than "four rows back", which breaks the moment a
    # quarter is missing or a company reports semi-annually (§55).
    index = {(q.get("year"), q.get("quarter")): q for q in quarters}
    for q in quarters:
        prior = index.get(((q.get("year") or 0) - 1, q.get("quarter")))
        eps_yoy, eps_note = _yoy(q.get("eps_actual"), prior.get("eps_actual") if prior else None)
        rev_yoy, rev_note = _yoy(q.get("revenue_actual"), prior.get("revenue_actual") if prior else None)
        q["eps_yoy_pct"], q["eps_yoy_note"] = eps_yoy, eps_note
        q["rev_yoy_pct"], q["rev_yoy_note"] = rev_yoy, rev_note

        # A surprise is only computed when both sides share a basis (§28/§29).
        comparable = q.get("eps_basis") == "consensus_comparable"
        if comparable:
            sp, sa, note = _surprise(q.get("eps_actual"), q.get("eps_estimate"), eps=True)
            q["eps_surprise_pct"], q["eps_surprise_abs"], q["eps_surprise_note"] = sp, sa, note
            rp, ra, rnote = _surprise(q.get("revenue_actual"), q.get("revenue_estimate"), eps=False)
            q["rev_surprise_pct"], q["rev_surprise_abs"], q["rev_surprise_note"] = rp, ra, rnote
        else:
            q["eps_surprise_pct"] = q["eps_surprise_abs"] = None
            q["eps_surprise_note"] = "no_comparable_estimate"
            q["rev_surprise_pct"] = q["rev_surprise_abs"] = None
            q["rev_surprise_note"] = "no_comparable_estimate"

        # Intelligence flags — factual statements about the reported numbers,
        # never a verdict on the company (§57).
        q["eps_triple"] = bool(eps_yoy is not None and eps_yoy >= 100)
        q["rev_triple"] = bool(rev_yoy is not None and rev_yoy >= 100)
        q["double_triple"] = bool(q["eps_triple"] and q["rev_triple"])
        eb = (q.get("eps_surprise_abs") if q.get("eps_surprise_pct") is None else q.get("eps_surprise_pct"))
        rb = (q.get("rev_surprise_abs") if q.get("rev_surprise_pct") is None else q.get("rev_surprise_pct"))
        q["eps_beat"] = None if eb is None else bool(eb > 0)
        q["rev_beat"] = None if rb is None else bool(rb > 0)
        q["double_beat"] = bool(q["eps_beat"] and q["rev_beat"])

    summary = _summarize(quarters)

    return {
        "ticker": sym,
        "quarters": quarters,
        "summary": summary,
        "meta": {
            "actuals_source": used,
            "estimates_available": bool(tier1),
            "eps_basis": ("consensus-comparable (provider adjusted)" if tier1
                          else "GAAP diluted, as reported"),
            "retrieved_at": time.time(),
            "quarters_returned": len(quarters),
            # Lets the client label forward quarters with real fiscal periods
            # instead of "next quarter".
            "fiscal_year_end_month": fye_month,
            "surprise_method": "(actual − estimate) ÷ |estimate|; absolute surprise when |EPS estimate| < $0.05",
            "yoy_method": "same fiscal quarter one year earlier; sign changes reported as turned profitable/negative rather than a percentage",
        },
    }


def _summarize(quarters: list) -> dict:
    """Beat streaks and growth trend — computed over the quarters we actually
    have, and returning None rather than a number when the inputs are absent."""
    rep = [q for q in quarters if q.get("reported")]
    scored = [q for q in rep if q.get("eps_beat") is not None]
    eps_beats = sum(1 for q in scored if q.get("eps_beat"))
    rev_scored = [q for q in rep if q.get("rev_beat") is not None]
    rev_beats = sum(1 for q in rev_scored if q.get("rev_beat"))

    streak = 0
    for q in rep:                      # newest first
        if q.get("double_beat"):
            streak += 1
        else:
            break

    def accel(key):
        """Consecutive most-recent quarters whose YoY growth RATE exceeded the
        prior quarter's — acceleration as a COUNT, not an adjective.

        This is the one idea worth borrowing wholesale from IBD: they expose
        "number of quarters of EPS growth acceleration" as a countable field
        rather than prose, which makes the second derivative of growth something
        you can actually compare between companies. Returns (count, direction).
        """
        vals = [q.get(key) for q in rep if q.get(key) is not None]
        if len(vals) < 2:
            return None, None
        up = down = 0
        for i in range(len(vals) - 1):          # vals is newest-first
            if vals[i] > vals[i + 1]:
                up += 1
            else:
                break
        for i in range(len(vals) - 1):
            if vals[i] < vals[i + 1]:
                down += 1
            else:
                break
        if up:
            return up, "accelerating"
        if down:
            return down, "decelerating"
        return 0, "flat"

    eps_n, eps_dir = accel("eps_yoy_pct")
    rev_n, rev_dir = accel("rev_yoy_pct")

    return {
        "eps_beats": eps_beats if scored else None,
        "eps_beats_of": len(scored) or None,
        "rev_beats": rev_beats if rev_scored else None,
        "rev_beats_of": len(rev_scored) or None,
        "double_beat_streak": streak or None,
        "eps_accel_quarters": eps_n, "eps_trend": eps_dir,
        "rev_accel_quarters": rev_n, "rev_trend": rev_dir,
    }


def _ttl_for(payload: dict) -> float:
    """Freshness by proximity to the next report — cheap when nothing is moving,
    responsive when it is."""
    nxt = payload.get("next_report_date")
    if not nxt:
        return _TTL_FAR
    try:
        d = datetime.strptime(str(nxt)[:10], "%Y-%m-%d").date()
    except ValueError:
        return _TTL_FAR
    days = (d - date.today()).days
    if abs(days) <= 2:
        return _TTL_WINDOW
    if 0 <= days <= 10:
        return _TTL_NEAR
    return _TTL_FAR


def _schedule_refresh(sym: str) -> None:
    with _lock:
        if sym in _refreshing:
            return
        _refreshing.add(sym)

    def _run():
        try:
            fresh = _build(sym)
            if fresh.get("quarters"):
                ttl = _ttl_for(fresh)
                cache.set(f"{_KIND}::{sym}", fresh, ttl)
                snap_store.put(_KIND, sym, fresh, ttl)
        except Exception as e:  # noqa: BLE001
            _log.warning("earnings refresh %s failed: %s", sym, e)
        finally:
            with _lock:
                _refreshing.discard(sym)

    threading.Thread(target=_run, name=f"earn-refresh-{sym}", daemon=True).start()


def get_earnings(ticker: str) -> dict:
    """Normalized earnings for a ticker. memory → disk (fresh) → disk (stale,
    refresh behind the response) → build. Shared by every user (§47)."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    ck = f"{_KIND}::{sym}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    stored = snap_store.get(_KIND, sym)
    if stored is not None:
        payload, age, ttl = stored
        if isinstance(payload, dict) and payload.get("quarters"):
            payload.setdefault("meta", {})["age_seconds"] = int(age)
            if age <= ttl:
                cache.set(ck, payload, max(60, int(ttl - age)))
                return payload
            if age <= _STALE_MAX:
                payload["meta"]["stale"] = True
                cache.set(ck, payload, 300)
                _schedule_refresh(sym)
                return payload
    out = _build(sym)
    ttl = _ttl_for(out)
    cache.set(ck, out, ttl if out.get("quarters") else 600)
    if out.get("quarters"):
        snap_store.put(_KIND, sym, out, ttl)
    return out
