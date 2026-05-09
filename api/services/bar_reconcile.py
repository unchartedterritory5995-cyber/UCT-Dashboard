"""Multi-source bar reconciliation.

For high-priority tickers, after a bar is cached from one source, async-fetch
the same bar from a second source and compare. If they agree within tolerance
(0.1% on close, 5% on volume), mark provenance.verified_at. If they disagree,
quarantine the cached bar and log for operator review.

This module provides the reconcile_bar API; Plan 5 schedules it across the
priority universe via the continuous audit thread.
"""
import logging
from typing import Optional
from api.services import bar_provenance, bar_quarantine

_logger = logging.getLogger(__name__)
_CLOSE_TOLERANCE = 0.001  # 0.1%
_VOLUME_TOLERANCE = 0.05  # 5%


def _close_diff(a: float, b: float) -> float:
    """Return relative difference. Zero-divide protected."""
    if a == 0:
        return 1.0 if b != 0 else 0.0
    return abs(a - b) / a


def _volume_diff(a: float, b: float) -> float:
    """Return relative volume difference. Zero-divide protected."""
    if max(a, b) == 0:
        return 0.0
    return abs(a - b) / max(a, b)


def _fetch_secondary(ticker: str, tf: str, bar_time: int, source: str) -> Optional[dict]:
    """Fetch a single bar from `source` for the given (ticker, tf, bar_time).

    Plan 3 leaves this as a placeholder — Plan 4's fetch_minute_snapshot or
    a similar single-bar API would be the implementation. For now, returns
    None (tests patch this).
    """
    return None


def reconcile_bar(
    ticker: str, tf: str, bar_time: int, cached_bar: dict, secondary_source: str = "fmp"
) -> str:
    """Compare cached bar against a secondary source. Returns verdict.

    Returns:
      "verified": agree within tolerance — provenance.verified_at updated
      "disagree": disagreement — cached bar quarantined
      "skipped": secondary unavailable — neither verified nor quarantined
    """
    secondary = _fetch_secondary(ticker, tf, bar_time, secondary_source)
    if not secondary:
        return "skipped"

    close_d = _close_diff(cached_bar.get("c", 0), secondary.get("c", 0))
    vol_d = _volume_diff(cached_bar.get("v", 0), secondary.get("v", 0))

    if close_d <= _CLOSE_TOLERANCE and vol_d <= _VOLUME_TOLERANCE:
        try:
            bar_provenance.mark_verified(ticker, tf, bar_time)
        except Exception:
            _logger.exception("[reconcile] mark_verified failed for %s %s @ %s", ticker, tf, bar_time)
        return "verified"

    try:
        bar_quarantine.add(
            ticker, tf, bar_time,
            f"reconcile-disagreement: close_diff={close_d*100:.2f}%, vol_diff={vol_d*100:.2f}% (cached vs {secondary_source})",
            source=f"reconcile/{secondary_source}",
        )
    except Exception:
        _logger.exception("[reconcile] quarantine.add failed")
    _logger.warning(
        "[reconcile] %s %s @ %s — disagreement close=%.4f%% vol=%.2f%%",
        ticker, tf, bar_time, close_d * 100, vol_d * 100,
    )
    return "disagree"
