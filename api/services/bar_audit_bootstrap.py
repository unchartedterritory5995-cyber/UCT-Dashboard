"""One-shot scanner for existing cache corruption.

Run on startup so any pre-existing bad bars (cached before validation was
wired in) get quarantined. Forces re-fetch on next access.
"""
import json
import logging
import os
import re
import time
from datetime import datetime, timezone

from api.services import bars_disk_cache, bar_quarantine, bar_validation

_logger = logging.getLogger(__name__)
_FNAME_RE = re.compile(r"^([A-Z0-9.\-]+)_([0-9DWM]+)_(\d+)\.json$")

# This scan is a ONE-SHOT migration: it backfills quarantine entries for bars
# that were cached before inline validation existed. New bad bars are already
# quarantined on the normal fetch path, so once this completes it must never
# run again — re-running it re-quarantines the SAME ~260k bars via ~260k
# individual auth.db transactions (~36 min), starving the user-facing web
# process for that entire window after every deploy. A versioned marker on
# the persistent /data volume makes it converge. Bump the version only if
# validation logic changes and a full re-scan is genuinely wanted.
_BOOTSTRAP_VERSION = 1


def _marker_path() -> str:
    # Read _CACHE_DIR lazily (tests monkeypatch it) and place the marker on
    # the same persistent volume as the cache it scanned (parent of /data/bars_cache).
    return os.path.join(
        os.path.dirname(bars_disk_cache._CACHE_DIR), "bar_audit_bootstrap.marker"
    )


def _read_marker() -> dict | None:
    try:
        with open(_marker_path()) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _write_marker(quarantined: int, elapsed_s: float) -> None:
    """Atomically record completion so subsequent boots skip the full scan."""
    path = _marker_path()
    try:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(
                {
                    "version": _BOOTSTRAP_VERSION,
                    "completed_at": int(time.time()),
                    "quarantined": quarantined,
                    "elapsed_s": round(elapsed_s, 1),
                },
                f,
            )
        os.replace(tmp, path)  # atomic — a partial marker can't cause a false skip
    except OSError as e:  # noqa: BLE001
        _logger.warning(
            "[bar_audit_bootstrap] could not write completion marker (%s) — "
            "scan will repeat next boot: %s",
            path, e,
        )


def _to_epoch(t) -> int | None:
    """Convert a bar timestamp to an integer epoch.

    Handles plain ints, stringified ints, and ISO date strings (e.g. '2024-07-01').
    Returns None only when the value is truly unparseable.
    """
    if isinstance(t, int):
        return t
    try:
        return int(t)
    except (ValueError, TypeError):
        pass
    try:
        return int(datetime.fromisoformat(str(t)).replace(tzinfo=timezone.utc).timestamp())
    except Exception:
        return None


def scan_and_quarantine_existing_cache(force: bool = False) -> int:
    """Scan every cache file, validate each bar, quarantine failures.

    One-shot: if a completion marker for the current bootstrap version is
    already present on the persistent volume, the full scan is skipped and
    the previously-recorded count is returned. Pass ``force=True`` to re-scan
    regardless (operator/manual use). Returns count of bars quarantined.
    """
    if not force:
        m = _read_marker()
        if m and int(m.get("version") or 0) >= _BOOTSTRAP_VERSION:
            _logger.info(
                "[bar_audit_bootstrap] skipping full scan — one-shot migration "
                "already completed (v%s, %s bars in %.0fs); new bad bars are "
                "quarantined inline on the fetch path",
                m.get("version"), m.get("quarantined"),
                float(m.get("elapsed_s") or 0),
            )
            return int(m.get("quarantined") or 0)

    t0 = time.time()
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
        skipped_ts: list[str] = []          # batch unparseable timestamps
        for bar in bars:
            if not isinstance(bar, dict):
                continue
            try:
                ok, reasons = bar_validation.validate_bar(bar, prior_close=prior_close)
            except Exception as e:  # noqa: BLE001
                _logger.debug(
                    "[bar_audit_bootstrap] %s %s: validate_bar crashed: %s",
                    ticker, tf, e,
                )
                ok, reasons = False, [f"validator crashed: {e}"]

            if not ok and bar.get("t") is not None:
                t_int = _to_epoch(bar["t"])
                if t_int is None:
                    skipped_ts.append(str(bar["t"]))
                    continue
                try:
                    bar_quarantine.add(
                        ticker, tf, t_int,
                        "; ".join(reasons),
                        source=payload.get("source") or "bootstrap-scan",
                    )
                    quarantined += 1
                except Exception as e:  # noqa: BLE001
                    _logger.debug(
                        "[bar_audit_bootstrap] %s %s: quarantine.add failed: %s",
                        ticker, tf, e,
                    )
            else:
                prior_close = bar.get("c")

        # One summary line per ticker/tf instead of per-bar
        if skipped_ts:
            _logger.warning(
                "[bar_audit_bootstrap] %s %s: skipped %d bars with unparseable t (first: %s)",
                ticker, tf, len(skipped_ts), skipped_ts[0],
            )

    elapsed = time.time() - t0
    _logger.info(
        "[bar_audit_bootstrap] quarantined %d bars from existing cache in %.1fs",
        quarantined, elapsed,
    )
    # Only reached on a real scan (the skip path returns early). Record
    # completion so future boots don't repeat this 36-min write storm.
    _write_marker(quarantined, elapsed)
    return quarantined
