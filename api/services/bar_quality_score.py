"""Per-ticker chart-data quality score.

Composite of:
  - Validation pass rate over last 7 days (weight: 40%)
  - Source agreement rate (verified bars / total bars) (weight: 20%)
  - Hours since last corruption detected (weight: 15%, decays linearly to 0 over 0-72hr)
  - Completeness vs expected bars-per-session (weight: 15%)
  - Freshness during RTH (weight: 10%)

Returns 0-100. Used by admin heatmap + per-ticker dot indicator.
"""
from api.services import bar_quarantine


_WEIGHTS = {
    "validation": 40,
    "source_agreement": 20,
    "corruption_age": 15,
    "completeness": 15,
    "freshness": 10,
}


def _validation_pass_rate(ticker: str) -> float:
    """1.0 - (quarantined / total estimate). Default 1.0 if no data."""
    try:
        q = bar_quarantine.count(ticker)
        # Approximate total: 8 timeframes × 5000 bars = 40000
        total_estimate = 40000
        if total_estimate == 0:
            return 1.0
        return max(0.0, 1.0 - q / total_estimate)
    except Exception:
        return 1.0


def _source_agreement_rate(ticker: str) -> float:
    """Verified-by-reconciliation / total bars with provenance.

    Plan 5: Stub returning 1.0 until provenance verified_at is populated by
    the continuous audit thread.
    """
    return 1.0


def _hours_since_last_corruption(ticker: str) -> float:
    """Hours since the most recent quarantine entry. 999 if none."""
    try:
        items = bar_quarantine.list_for_ticker(ticker)
        if not items:
            return 999.0
        import time
        most_recent = max(item["detected_at"] for item in items)
        return max(0.0, (time.time() - most_recent) / 3600.0)
    except Exception:
        return 999.0


def _completeness_score(ticker: str) -> float:
    """Stub: actual minute bars vs expected per session. Plan 5 follow-up."""
    return 1.0


def _freshness_score(ticker: str) -> float:
    """Stub: based on bars_liveness for the ticker's most-recent intraday bar."""
    return 1.0


def compute(ticker: str) -> int:
    """Return integer 0-100 quality score for ticker."""
    val = _validation_pass_rate(ticker)
    src = _source_agreement_rate(ticker)
    corr_age = _hours_since_last_corruption(ticker)
    comp = _completeness_score(ticker)
    fresh = _freshness_score(ticker)

    # Decay corruption age signal: 0 hours = 0 score, 72+ hours = 1.0
    corr_signal = min(1.0, corr_age / 72.0)

    score = (
        val * _WEIGHTS["validation"]
        + src * _WEIGHTS["source_agreement"]
        + corr_signal * _WEIGHTS["corruption_age"]
        + comp * _WEIGHTS["completeness"]
        + fresh * _WEIGHTS["freshness"]
    )
    return int(round(score))


def compute_universe(tickers: list[str]) -> dict[str, int]:
    return {str(t).upper(): compute(t) for t in tickers}
