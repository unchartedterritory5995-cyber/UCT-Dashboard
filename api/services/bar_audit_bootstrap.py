"""One-shot scanner for existing cache corruption.

Run on startup so any pre-existing bad bars (cached before validation was
wired in) get quarantined. Forces re-fetch on next access.
"""
import json
import logging
import os
import re

from api.services import bars_disk_cache, bar_quarantine, bar_validation

_logger = logging.getLogger(__name__)
_FNAME_RE = re.compile(r"^([A-Z0-9.\-]+)_([0-9DWM]+)_(\d+)\.json$")


def scan_and_quarantine_existing_cache() -> int:
    """Scan every cache file, validate each bar, quarantine failures.

    Returns count of bars quarantined.
    """
    cache_dir = bars_disk_cache._CACHE_DIR
    if not os.path.isdir(cache_dir):
        return 0

    quarantined = 0
    for fname in os.listdir(cache_dir):
        m = _FNAME_RE.match(fname)
        if not m:
            continue
        ticker, tf, _bars = m.group(1), m.group(2), m.group(3)
        path = os.path.join(cache_dir, fname)
        try:
            with open(path) as f:
                payload = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        bars = payload.get("bars") or []
        prior_close = None
        for bar in bars:
            if not isinstance(bar, dict):
                continue
            try:
                ok, reasons = bar_validation.validate_bar(bar, prior_close=prior_close)
            except Exception as e:  # noqa: BLE001
                # Validation itself crashed on this bar — treat as invalid
                _logger.warning(
                    "[bar_audit_bootstrap] %s %s: validate_bar crashed: %s",
                    ticker, tf, e,
                )
                ok, reasons = False, [f"validator crashed: {e}"]

            if not ok and bar.get("t") is not None:
                try:
                    t_int = int(bar["t"])
                except (ValueError, TypeError):
                    # Bar's timestamp isn't a plain int (could be a date string).
                    # Skip rather than abort the whole scan.
                    _logger.warning(
                        "[bar_audit_bootstrap] %s %s: skipping bar with non-int t=%r",
                        ticker, tf, bar.get("t"),
                    )
                    continue
                try:
                    bar_quarantine.add(
                        ticker, tf, t_int,
                        "; ".join(reasons),
                        source=payload.get("source") or "bootstrap-scan",
                    )
                    quarantined += 1
                except Exception as e:  # noqa: BLE001
                    _logger.warning(
                        "[bar_audit_bootstrap] %s %s: quarantine.add failed: %s",
                        ticker, tf, e,
                    )
            else:
                prior_close = bar.get("c")
    _logger.info("[bar_audit_bootstrap] quarantined %d bars from existing cache", quarantined)
    return quarantined
