"""Bar audit — compare cached SQLite bars against Polygon canonical.

The keystone of Phase 2C. Without a way to mechanically prove bars are
correct, every "fix" is faith-based and bugs surface only when humans
notice. This module does the diff.

Architecture:

  cached_bars   = bars_sqlite.get_bars(ticker, tf, bars)
  canonical     = fetch_canonical_bars(ticker, tf, bars)  # Polygon directly
  result        = diff_bars(cached_bars, canonical, tolerances)

The diff produces a structured AuditResult enumerating:
  - per-bar diffs (which field, cached vs canonical, delta, severity)
  - bars only in cache (likely pre/post-market the canonical excluded)
  - bars only in canonical (likely cache gaps from missed fetches)
  - overall pass rate

Tolerance bands acknowledge real-world noise:
  - Price: ±$0.01 absolute or ±0.05% relative — covers cent-rounding
    when our cache stores `round(b["o"], 2)` against canonical's full
    precision. Real bugs are larger than this.
  - Volume: ±1% or ±100 shares absolute — covers Polygon's late-print
    volume corrections that arrive minutes after the bar closed.
  - Timestamp: exact match required after unit normalization.

Used by:
  - tools/audit_bars.py (CLI)
  - GET /api/admin/audit-bars/{ticker} (HTTP)
  - CI regression suite (Phase 2C step 4, future)
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Iterable

# Public tolerance defaults. CLI and HTTP can override.
PRICE_ABS_TOLERANCE = 0.01           # dollars
PRICE_PCT_TOLERANCE = 0.0005         # 0.05% relative
VOLUME_ABS_TOLERANCE = 100           # shares
VOLUME_PCT_TOLERANCE = 0.01          # 1% relative

# Severity thresholds. A diff above PRICE_ABS_TOLERANCE / VOLUME_ABS_TOLERANCE
# but within 10× is a "warn" (worth investigation, not necessarily a bug).
# Anything above 10× the tolerance is a "fail" (real defect, regression
# tests should drive it to zero).
SEVERITY_WARN_MULTIPLIER = 1
SEVERITY_FAIL_MULTIPLIER = 10


@dataclass
class BarDiff:
    """One field-level disagreement between cache and canonical."""
    timestamp: int
    field_name: str       # 'o' | 'h' | 'l' | 'c' | 'v'
    cached: float
    canonical: float
    delta: float
    pct_delta: float | None
    severity: str         # 'ok' | 'warn' | 'fail'


@dataclass
class AuditResult:
    ticker: str
    tf: str
    bars_compared: int = 0
    bars_only_in_cache: list[int] = field(default_factory=list)
    bars_only_in_canonical: list[int] = field(default_factory=list)
    diffs: list[BarDiff] = field(default_factory=list)
    error: str | None = None      # populated if audit could not run

    @property
    def pass_rate(self) -> float:
        """Fraction of compared bars with no fail-severity diffs."""
        if self.bars_compared == 0:
            return 1.0 if not self.diffs else 0.0
        failed = {d.timestamp for d in self.diffs if d.severity == "fail"}
        return 1.0 - (len(failed) / self.bars_compared)

    @property
    def fail_count(self) -> int:
        return sum(1 for d in self.diffs if d.severity == "fail")

    @property
    def warn_count(self) -> int:
        return sum(1 for d in self.diffs if d.severity == "warn")

    def to_dict(self) -> dict:
        """JSON-serializable shape for the HTTP endpoint."""
        return {
            "ticker": self.ticker,
            "tf": self.tf,
            "bars_compared": self.bars_compared,
            "bars_only_in_cache": self.bars_only_in_cache,
            "bars_only_in_canonical": self.bars_only_in_canonical,
            "fail_count": self.fail_count,
            "warn_count": self.warn_count,
            "pass_rate": round(self.pass_rate, 6),
            "diffs": [
                {
                    "timestamp": d.timestamp,
                    "field": d.field_name,
                    "cached": d.cached,
                    "canonical": d.canonical,
                    "delta": round(d.delta, 6),
                    "pct_delta": round(d.pct_delta, 6) if d.pct_delta is not None else None,
                    "severity": d.severity,
                }
                for d in self.diffs
            ],
            "error": self.error,
        }


def _classify_price_severity(delta_abs: float, base: float) -> str:
    """Decide ok/warn/fail for a price-field diff."""
    abs_thresh = PRICE_ABS_TOLERANCE
    pct_thresh = abs(base) * PRICE_PCT_TOLERANCE
    threshold = max(abs_thresh, pct_thresh)
    if delta_abs <= threshold * SEVERITY_WARN_MULTIPLIER:
        return "ok"
    if delta_abs <= threshold * SEVERITY_FAIL_MULTIPLIER:
        return "warn"
    return "fail"


def _classify_volume_severity(delta_abs: float, base: float) -> str:
    abs_thresh = VOLUME_ABS_TOLERANCE
    pct_thresh = abs(base) * VOLUME_PCT_TOLERANCE
    threshold = max(abs_thresh, pct_thresh)
    if delta_abs <= threshold * SEVERITY_WARN_MULTIPLIER:
        return "ok"
    if delta_abs <= threshold * SEVERITY_FAIL_MULTIPLIER:
        return "warn"
    return "fail"


def _diff_field(
    timestamp: int, field_name: str, cached: float, canonical: float,
) -> BarDiff | None:
    """Compare one field. Returns BarDiff if outside tolerance, else None.
    Note: returns the BarDiff even at 'warn' severity so callers can
    surface it; only 'ok'-severity diffs are dropped (no signal)."""
    delta = float(cached) - float(canonical)
    delta_abs = abs(delta)
    base = max(abs(float(cached)), abs(float(canonical)))
    pct_delta = (delta / base) if base > 0 else None

    if field_name == "v":
        sev = _classify_volume_severity(delta_abs, base)
    else:  # price field
        sev = _classify_price_severity(delta_abs, base)

    if sev == "ok":
        return None
    return BarDiff(
        timestamp=timestamp,
        field_name=field_name,
        cached=float(cached),
        canonical=float(canonical),
        delta=delta,
        pct_delta=pct_delta,
        severity=sev,
    )


def diff_bars(
    cached: Iterable[dict],
    canonical: Iterable[dict],
    *,
    ticker: str,
    tf: str,
) -> AuditResult:
    """Pure-function diff of two bar streams. Both are lists of dicts with
    keys ``t`` (unix seconds for intraday, YYYYMMDD int for daily) plus
    ``o, h, l, c, v``. Bars are matched by timestamp; missing on either
    side is reported separately from field-level diffs.

    This function does NO I/O — it's the unit-testable core of the audit.
    """
    cached_by_ts: dict[int, dict] = {int(b["t"]): b for b in cached}
    canonical_by_ts: dict[int, dict] = {int(b["t"]): b for b in canonical}

    only_cache = sorted(set(cached_by_ts) - set(canonical_by_ts))
    only_canonical = sorted(set(canonical_by_ts) - set(cached_by_ts))
    both = sorted(set(cached_by_ts) & set(canonical_by_ts))

    diffs: list[BarDiff] = []
    for ts in both:
        c = cached_by_ts[ts]
        k = canonical_by_ts[ts]
        for fld in ("o", "h", "l", "c", "v"):
            if fld not in c or fld not in k:
                continue
            d = _diff_field(ts, fld, c[fld], k[fld])
            if d is not None:
                diffs.append(d)

    return AuditResult(
        ticker=ticker.upper(),
        tf=tf,
        bars_compared=len(both),
        bars_only_in_cache=only_cache,
        bars_only_in_canonical=only_canonical,
        diffs=diffs,
    )


# ── Canonical fetch (live; not for unit tests) ────────────────────────────

def _massive_endpoint_for(tf: str) -> tuple[int, str]:
    """Map our timeframe code to Massive's (multiplier, timespan) pair.

    Daily/Weekly/Monthly use the timespan endpoint; intraday minutes use
    the minute endpoint with a multiplier."""
    if tf == "D":
        return 1, "day"
    if tf == "W":
        return 1, "week"
    if tf == "M":
        return 1, "month"
    if tf in ("1", "5", "15", "30"):
        return int(tf), "minute"
    if tf == "60":
        # Caller is expected to fetch 30-min and resample if comparing
        # to a session-aligned hourly cache (which is how our hourly bars
        # are produced). For raw 1-hour, use minute=60.
        return 60, "minute"
    raise ValueError(f"unsupported tf {tf!r}")


def _date_range_for(tf: str, bars: int) -> tuple[str, str]:
    """Compute (from_date, to_date) ISO strings to fetch ~`bars` worth of
    data. Generous lookback on intraday so partial trading days are
    covered.
    """
    today = datetime.utcnow().date()
    if tf in ("D", "W", "M"):
        days = bars * 2 if tf == "D" else (bars * 14 if tf == "W" else bars * 32)
    else:
        # intraday: 16h/day extended hours, but we may filter to RTH later
        bars_per_day = (16 * 60) // max(int(tf), 1)
        days = max(7, int(bars / max(bars_per_day, 1)) + 3)
    days = min(days, 730)  # 2-year cap
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


def fetch_canonical_bars(ticker: str, tf: str, bars: int) -> list[dict]:
    """Fetch the canonical OHLCV bars from Polygon (Massive) directly.

    Handles pagination (Polygon truncates at 50k bars per page). Returns
    bars normalized to the cache's storage shape:
      - intraday: ``t`` in unix SECONDS
      - daily/weekly/monthly: ``t`` as YYYYMMDD int

    On any error returns an empty list — callers must handle the empty
    case (typically by surfacing it as ``error`` on the AuditResult).
    Does NOT silently fall through to other sources; this is canonical
    by definition.
    """
    import httpx
    api_key = os.environ.get("MASSIVE_API_KEY", "")
    if not api_key:
        return []

    multiplier, timespan = _massive_endpoint_for(tf)
    from_date, to_date = _date_range_for(tf, bars)
    base = "https://api.massive.com"
    url = (
        f"{base}/v2/aggs/ticker/{ticker.upper()}/range/{multiplier}/{timespan}"
        f"/{from_date}/{to_date}"
        f"?adjusted=true&sort=asc&limit=50000&apiKey={api_key}"
    )

    out: list[dict] = []
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=3.0, read=30.0)) as client:
            for _page in range(20):  # safety cap
                resp = client.get(url)
                resp.raise_for_status()
                data = resp.json()
                results = data.get("results") or []
                out.extend(results)
                next_url = data.get("next_url")
                if not next_url:
                    break
                sep = "&" if "?" in next_url else "?"
                url = f"{next_url}{sep}apiKey={api_key}"
    except Exception:
        return []

    date_tf = tf in ("D", "W", "M")
    bars_norm: list[dict] = []
    for r in out:
        ts_ms = r.get("t")
        if ts_ms is None:
            continue
        if date_tf:
            dt = datetime.utcfromtimestamp(ts_ms / 1000)
            t_norm: int = int(dt.strftime("%Y%m%d"))
        else:
            t_norm = int(ts_ms / 1000)
        bars_norm.append({
            "t": t_norm,
            "o": round(float(r["o"]), 2),
            "h": round(float(r["h"]), 2),
            "l": round(float(r["l"]), 2),
            "c": round(float(r["c"]), 2),
            "v": int(r.get("v", 0) or 0),
        })

    return bars_norm[-bars:] if len(bars_norm) > bars else bars_norm


def audit_ticker(
    ticker: str,
    tf: str,
    bars: int = 200,
) -> AuditResult:
    """Top-level: read cache + fetch canonical + diff. Returns AuditResult.

    On Massive failure (no API key, network, etc.) returns a result with
    ``error`` populated and zero comparisons. On cache emptiness returns
    a result with ``bars_only_in_canonical`` populated (every canonical
    bar is "missing" from cache).
    """
    from api.services import bars_sqlite

    canonical = fetch_canonical_bars(ticker, tf, bars)
    if not canonical:
        return AuditResult(
            ticker=ticker.upper(),
            tf=tf,
            error="canonical fetch returned empty (Massive API key missing or upstream error)",
        )

    cached_rows = bars_sqlite.get_bars(ticker, tf, bars)
    cached = [
        {"t": row[0], "o": row[1], "h": row[2], "l": row[3], "c": row[4], "v": row[5]}
        for row in cached_rows
    ]

    return diff_bars(cached, canonical, ticker=ticker, tf=tf)
