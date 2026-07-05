"""Background reconciliation: continuously diff SQLite bars vs Polygon
canonical, surgically heal any drift before users see it.

This is the structural safety net behind the chart correctness contract.
Every "noon cutoff" / "wrong close" / "phantom bar" bug we've shipped a
patch for had the same shape: a write happened with bad data, persisted
silently, and was only noticed weeks later when a user spotted it
visually. The fixes we ship for individual bug classes (FMP timezone,
strict-> filter, in-progress-bar storage, etc.) prevent the next instance
of each known pattern — but cannot defend against the bugs we have not
found yet. This module catches every variant by definition: if cached
data diverges from Polygon canonical, the cached rows are wiped so the
next fetch repopulates clean.

Cadence: one cycle per RECONCILE_CYCLE_SECONDS (default 1800 = 30 min),
auditing RECONCILE_PAIRS_PER_CYCLE (default 60) (ticker, tf) pairs sampled
across hot-set / priority / long-tail. Polygon API cost per cycle is
bounded by the pair count (one canonical fetch per pair); ~60/cycle ×
~48 cycles/day = ~2880 calls/day — comfortably under any tier.

Heal action on drift: surgically `DELETE` the specific (ticker, tf, ts)
rows that diverged from canonical, plus clear the in-memory cache for
that key. Next fetch repopulates from canonical via the now-relaxed `>=`
delta path. Does NOT mass-wipe.

Enabled by default (2026-05-30) — set `RECONCILE_ENABLED=0` to disable.
Runs on the WEB pod (started from main.py's lifespan), and that is correct:
the worker→web R2 merge is INSERT OR IGNORE / newer-wins and cannot overwrite
an already-stored bad row, so a worker-side heal would never reach the cache
users actually read. Healing must happen on the web pod. Polygon/Massive is
flat-rate, so the extra canonical fetches cost nothing.
"""
import json
import logging
import os
import random
import sqlite3
import threading
import time
from datetime import datetime

_logger = logging.getLogger(__name__)

# ── Config (env-tunable) ──────────────────────────────────────────────────────
_CYCLE_SECONDS = int(os.environ.get("RECONCILE_CYCLE_SECONDS", "1800"))  # 30 min
_PAIRS_PER_CYCLE = int(os.environ.get("RECONCILE_PAIRS_PER_CYCLE", "60"))
_BARS_PER_AUDIT = int(os.environ.get("RECONCILE_BARS_PER_AUDIT", "200"))
# Intraday is where every known bug class has lived. D/W/M is included
# but at lower frequency (one TF picked at random per pair means each TF
# gets ~1/8 of attention). Could weight if we ever see drift bias.
# Scoped (2026-05-30) to the intraday-minute TFs where (a) the malformed
# in-progress-partial poison actually lives and (b) audit.py's canonical fetch
# uses identical standard minute buckets, so a cache-vs-canonical diff is
# trustworthy. EXCLUDES:
#   60m — app stores session-anchored ET hourly (9:30-10:30…) but audit.py
#         fetches Polygon clock-hour native; they don't align, so reconciling
#         60m would DELETE correct bars. 60m heals indirectly: once its 30m
#         source is clean, the 60m resample is clean.
#   D    — HEALING excluded (a mis-heal on the default TF is the worst case),
#         but Daily previously had ZERO drift VISIBILITY — if a bad daily bar
#         ever landed, nothing caught it. Daily now runs a DETECT-ONLY pass
#         (audits vs canonical, records + alerts fail-severity drift, NEVER
#         deletes) so the default timeframe is monitored with zero mis-heal
#         risk. See _run_detect_only below.
#   W/M  — resampled in-app and not yet verified against the canonical fetch;
#         exclude until audit.py resamples canonical to match (avoid mis-heal).
_TFS = ("1", "5", "15", "30")

# Detect-only timeframes: audited every cycle but NEVER healed (no deletion).
# Daily is the DEFAULT chart TF, so silent drift there is the highest-impact
# data-doubt failure — but auto-deleting daily rows on any audit false-positive
# is more dangerous than the drift itself. Detect-only threads the needle:
# full visibility, zero deletion. Only FAIL-severity diffs are reported (a
# genuine >~0.5% divergence); benign yfinance-tail cent differences classify
# as 'ok'/'warn' and are ignored, so the signal stays clean.
_DETECT_TFS = tuple(
    t.strip() for t in os.environ.get("RECONCILE_DETECT_TFS", "D").split(",") if t.strip()
) if os.environ.get("RECONCILE_DAILY_DETECT_ENABLED", "1") != "0" else ()
_DETECT_PAIRS_PER_CYCLE = int(os.environ.get("RECONCILE_DETECT_PAIRS_PER_CYCLE", "12"))

_PRIORITY_TICKERS = (
    "SPY", "QQQ", "IWM", "DIA", "AAPL", "NVDA", "MSFT", "TSLA",
    "AMZN", "META", "GOOGL", "AMD", "AVGO", "SMCI", "PLTR", "ARM",
    "COIN", "MSTR", "HOOD", "ANET", "NFLX", "CRM", "ORCL", "UBER",
)

# ── State (for status endpoint + ops visibility) ──────────────────────────────
_state_lock = threading.Lock()
_state = {
    "enabled": False,
    "running": False,
    "started_at": None,
    "cycle_seconds": _CYCLE_SECONDS,
    "pairs_per_cycle": _PAIRS_PER_CYCLE,
    "cycles_completed": 0,
    "audits_run": 0,
    "audits_errored": 0,
    "drift_detected_count": 0,
    "rows_healed_total": 0,
    "detect_only_drift_count": 0,   # Daily (+ any _DETECT_TFS) drift seen, NOT healed
    "last_cycle_at": None,
    "last_drift": [],  # ring buffer, last 30 healed drifts detected
    "last_detect_drift": [],  # ring buffer, last 30 detect-only (unhealed) drifts
}


def _record_detect_drift(ticker: str, tf: str, fail_count: int, warn_count: int,
                         bad_ts: list[int]):
    """Record a DETECT-ONLY drift — audited, flagged, but deliberately NOT healed.
    A hit here means a default-TF (Daily) bar looks wrong AND we did not delete
    it; an operator should investigate (it could be a real upstream/write bug, or
    an audit edge case). Surfaced on /api/admin/reconciliation-status."""
    with _state_lock:
        _state["detect_only_drift_count"] += 1
        _state["last_detect_drift"].append({
            "ticker": ticker, "tf": tf,
            "fail_count": fail_count, "warn_count": warn_count,
            "sample_ts": bad_ts[:5],
            "at": datetime.utcnow().isoformat() + "Z",
        })
        _state["last_detect_drift"] = _state["last_detect_drift"][-30:]


def _record_drift(ticker: str, tf: str, fail_count: int, warn_count: int, healed: int):
    with _state_lock:
        _state["drift_detected_count"] += 1
        _state["rows_healed_total"] += healed
        _state["last_drift"].append({
            "ticker": ticker, "tf": tf,
            "fail_count": fail_count, "warn_count": warn_count,
            "healed_rows": healed,
            "at": datetime.utcnow().isoformat() + "Z",
        })
        # Cap to 30 most recent so memory doesn't grow unbounded.
        _state["last_drift"] = _state["last_drift"][-30:]


def _sample_pairs() -> list[tuple[str, str]]:
    """Pick PAIRS_PER_CYCLE (ticker, tf) pairs weighted toward where users
    actually look. The mix is intentional:

    - **Hot set (50%)** — most-recently-fetched tickers. If users are
      seeing a bug, it'll be on these; catching drift here heals charts
      before complaints come in.
    - **Priority (20%)** — fixed list (SPY/QQQ/UCT20 majors). Always
      audited so a degradation on the highest-traffic tickers is impossible
      to miss.
    - **Random long-tail (30%)** — any (ticker, tf) from cap_universe.
      Ensures nothing escapes attention across weeks of cycling. Statistical
      coverage of the whole universe over time.

    Each ticker is paired with ONE random TF per cycle (not all 8) so the
    Polygon call count stays bounded. Over 48 cycles/day each ticker that
    enters the rotation gets sampled across multiple TFs.
    """
    pairs: list[tuple[str, str]] = []

    n_hot = _PAIRS_PER_CYCLE // 2
    n_priority = _PAIRS_PER_CYCLE // 5
    n_tail = _PAIRS_PER_CYCLE - n_hot - n_priority

    # Hot set (recently-fetched intraday)
    try:
        from api.services.bars_fetch import get_hot_intraday_tickers
        hot = get_hot_intraday_tickers(200)
    except Exception:
        hot = []
    if hot:
        for t in random.sample(hot, min(n_hot, len(hot))):
            pairs.append((t, random.choice(_TFS)))

    # Priority
    for t in random.sample(_PRIORITY_TICKERS, min(n_priority, len(_PRIORITY_TICKERS))):
        pairs.append((t, random.choice(_TFS)))

    # Long-tail random sample
    try:
        cap_path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
        if os.path.exists(cap_path):
            with open(cap_path) as f:
                universe = json.load(f)
            if isinstance(universe, dict):
                universe = universe.get("tickers") or []
            if universe:
                for t in random.sample(universe, min(n_tail, len(universe))):
                    pairs.append((t, random.choice(_TFS)))
    except Exception:
        _logger.warning("[reconcile] failed to load cap_universe for long-tail sample", exc_info=True)

    return pairs


def _heal_drift(ticker: str, tf: str, bad_timestamps: list[int]) -> int:
    """Surgically delete the (ticker, tf, ts) rows that diverged from canonical.
    Returns the count of rows deleted. Next user fetch repopulates them
    cleanly via the now-correct delta path.

    Surgical (not full-ticker wipe) so unrelated rows aren't disturbed —
    other timeframes keep serving, the rest of this ticker's history stays
    cached, only the bad bars are gone.
    """
    if not bad_timestamps:
        return 0
    db_path = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
    if not os.path.exists(db_path):
        return 0
    deleted = 0
    try:
        conn = sqlite3.connect(db_path, timeout=30)
        try:
            conn.execute("PRAGMA busy_timeout=30000")
            # SQLite has a host-parameter limit; chunk in groups of 500 to be safe.
            CHUNK = 500
            for i in range(0, len(bad_timestamps), CHUNK):
                chunk = bad_timestamps[i:i + CHUNK]
                placeholders = ",".join("?" * len(chunk))
                cur = conn.execute(
                    f"DELETE FROM ohlcv WHERE ticker=? AND tf=? AND ts IN ({placeholders})",
                    (ticker.upper(), tf, *chunk),
                )
                deleted += cur.rowcount or 0
            conn.commit()
        finally:
            conn.close()
    except Exception:
        _logger.exception(f"[reconcile] heal SQLite delete failed for {ticker}/{tf}")
        return deleted

    # Also clear in-memory cache for this (ticker, tf) so the next request
    # doesn't serve stale rows from Layer 1.
    try:
        from api.services.cache import cache as _mem
        _mem.delete_prefix(f"bars_{ticker.upper()}_{tf}_")
    except Exception:
        pass

    # And bump the DB epoch so thread-local connections refresh against the
    # now-modified table.
    try:
        from api.services import bars_sqlite
        bars_sqlite.bump_db_epoch()
    except Exception:
        pass

    return deleted


def _heal_companion_60m(ticker: str, bad_30m_ts: list[int]) -> int:
    """Active companion heal for the 60m timeframe.

    60m is deliberately excluded from `_TFS` because the app stores
    session-anchored ET hourly bars while audit.py fetches Polygon clock-hour
    native — they don't align, so auditing 60m directly would DELETE correct
    bars. The standing assumption (see `_TFS` comment) is that "60m heals
    indirectly: once its 30m source is clean, the 60m resample is clean." But
    that only fires if SOMETHING re-resamples the 60m row after the 30m is
    healed. Rather than rely on a prewarm pass eventually touching it, we drop
    the stored 60m rows whose session buckets contain the just-healed 30m
    timestamps, so the next 60m fetch re-resamples them from the now-clean 30m.

    Returns 60m rows deleted.
    """
    if not bad_30m_ts:
        return 0
    try:
        from api.services.bars_fetch import bucket_60_et_unix_seconds
    except Exception:
        _logger.exception("[reconcile] could not import bucket_60_et_unix_seconds")
        return 0
    buckets = sorted({bucket_60_et_unix_seconds(int(t)) for t in bad_30m_ts})
    return _heal_drift(ticker, "60", buckets)


def _detect_only_pairs() -> list[tuple[str, str]]:
    """Sample (ticker, tf) pairs for the DETECT-ONLY pass. Weighted to the same
    hot + priority tickers users actually watch, each paired with every
    detect-only TF (Daily). Bounded by _DETECT_PAIRS_PER_CYCLE tickers so the
    extra Polygon audit calls stay small."""
    if not _DETECT_TFS:
        return []
    tickers: list[str] = []
    try:
        from api.services.bars_fetch import get_hot_intraday_tickers
        hot = get_hot_intraday_tickers(100)
    except Exception:
        hot = []
    n_hot = max(1, _DETECT_PAIRS_PER_CYCLE // 2)
    if hot:
        tickers.extend(random.sample(hot, min(n_hot, len(hot))))
    remaining = _DETECT_PAIRS_PER_CYCLE - len(tickers)
    if remaining > 0:
        tickers.extend(random.sample(_PRIORITY_TICKERS, min(remaining, len(_PRIORITY_TICKERS))))
    seen: set[str] = set()
    pairs: list[tuple[str, str]] = []
    for t in tickers:
        if t in seen:
            continue
        seen.add(t)
        for tf in _DETECT_TFS:
            pairs.append((t, tf))
    return pairs


def _run_detect_only(audit) -> None:
    """Audit the detect-only TFs (Daily) and RECORD fail-severity drift WITHOUT
    healing. Zero deletion → cannot mis-heal the default timeframe; pure
    visibility into whether Daily ever drifts."""
    for ticker, tf in _detect_only_pairs():
        try:
            result = audit.audit_ticker(ticker, tf, bars=_BARS_PER_AUDIT)
            if result.error or result.fail_count <= 0:
                continue
            bad_ts = sorted({d.timestamp for d in result.diffs if d.severity == "fail"})
            _logger.warning(
                "[reconcile] DETECT-ONLY DRIFT %s/%s: %d fail / %d warn — NOT healed "
                "(default-TF, investigate); sample ts=%s",
                ticker, tf, result.fail_count, result.warn_count, bad_ts[:5],
            )
            _record_detect_drift(ticker, tf, result.fail_count, result.warn_count, bad_ts)
            # Route to the same ops alert channel the intraday watchdog uses, so a
            # real daily-drift event pages someone instead of hiding in logs.
            try:
                from api.services import chart_health_alerts
                chart_health_alerts.emit(
                    "daily_drift_detected",
                    "warn",
                    f"{ticker}/{tf}: {result.fail_count} daily bar(s) diverge from canonical "
                    f"(detect-only, not auto-healed) — investigate",
                    {"ticker": ticker, "tf": tf, "fail_count": result.fail_count,
                     "sample_ts": bad_ts[:5]},
                )
            except Exception:
                pass
        except Exception:
            _logger.exception(f"[reconcile] detect-only audit crashed for {ticker}/{tf}")


def _run_cycle():
    """One reconciliation pass: sample pairs, audit each, heal drift."""
    from api.services import audit
    pairs = _sample_pairs()
    if not pairs:
        _logger.info("[reconcile] cycle: no pairs to audit (universe load failed?)")
        return

    drift_count = 0
    rows_healed = 0
    audits_ok = 0
    audits_err = 0

    for ticker, tf in pairs:
        try:
            result = audit.audit_ticker(ticker, tf, bars=_BARS_PER_AUDIT)
            if result.error:
                audits_err += 1
                continue
            audits_ok += 1
            if result.fail_count > 0:
                bad_ts = sorted({d.timestamp for d in result.diffs if d.severity == "fail"})
                healed = _heal_drift(ticker, tf, bad_ts)
                # 30m drift implies the resampled 60m built from it is also
                # wrong. Actively drop the overlapping session-hour 60m rows so
                # they re-resample clean on next fetch (60m isn't audited
                # directly — see _heal_companion_60m).
                companion_60m = 0
                if tf == "30":
                    companion_60m = _heal_companion_60m(ticker, bad_ts)
                    healed += companion_60m
                drift_count += 1
                rows_healed += healed
                _logger.warning(
                    "[reconcile] DRIFT %s/%s: %d fail / %d warn — healed %d row(s)%s",
                    ticker, tf, result.fail_count, result.warn_count, healed,
                    f" (+{companion_60m} companion 60m)" if companion_60m else "",
                )
                _record_drift(ticker, tf, result.fail_count, result.warn_count, healed)
        except Exception:
            audits_err += 1
            _logger.exception(f"[reconcile] cycle: audit crashed for {ticker}/{tf}")

    # Detect-only pass (Daily) — audits + alerts drift but NEVER deletes. Runs
    # after the heal loop so it never competes with a heal on the same tick.
    try:
        _run_detect_only(audit)
    except Exception:
        _logger.exception("[reconcile] detect-only pass crashed")

    with _state_lock:
        _state["cycles_completed"] += 1
        _state["audits_run"] += audits_ok
        _state["audits_errored"] += audits_err
        _state["last_cycle_at"] = datetime.utcnow().isoformat() + "Z"

    _logger.info(
        "[reconcile] cycle complete: %d pairs audited (%d ok, %d err), "
        "%d drift detected, %d rows healed",
        len(pairs), audits_ok, audits_err, drift_count, rows_healed,
    )


def _run_forever():
    """Loop: sleep, run cycle, sleep, repeat. Catches all per-cycle errors so
    one bad iteration cannot kill the daemon."""
    # Default ON (2026-05-30): this is the structural healer for the
    # malformed-partial poison and must run on the WEB pod (main.py lifespan),
    # because the worker→web R2 merge is INSERT OR IGNORE and cannot overwrite
    # bad rows — so healing has to happen where users read. Set
    # RECONCILE_ENABLED=0 to disable.
    enabled = os.environ.get("RECONCILE_ENABLED", "1") == "1"
    with _state_lock:
        _state["enabled"] = enabled
    if not enabled:
        _logger.info("[reconcile] disabled (RECONCILE_ENABLED=0)")
        return

    with _state_lock:
        _state["running"] = True
        _state["started_at"] = datetime.utcnow().isoformat() + "Z"

    _logger.info(
        "[reconcile] started — cycle every %ds, %d pairs per cycle, %d bars per audit",
        _CYCLE_SECONDS, _PAIRS_PER_CYCLE, _BARS_PER_AUDIT,
    )

    # Initial delay so startup isn't slammed (prewarm, integrity check, heals
    # all want the SQLite write lock first).
    time.sleep(120)

    # Runs 24/7 (CORRECTNESS RESTORE 2026-06-08). A 2026-06-07 cost trim gated
    # this on in_active_data_window() on the theory that "nothing drifts when the
    # market's closed." But drift created late in a session (e.g. a wrong
    # in-progress bar frozen near 3:45pm ET) needs many sampled cycles to be
    # caught — this healer only audits ~60 (ticker,tf) pairs/cycle across a
    # ~2,800-ticker universe, so off-hours passes are how the long tail actually
    # gets reached. Canonical fetches are Massive flat-rate (CPU, not egress $),
    # so 24/7 healing is cheap relative to chart-data trust. Set
    # RECONCILE_ENABLED=0 to disable entirely.
    while True:
        try:
            _run_cycle()
        except Exception:
            _logger.exception("[reconcile] cycle outer crashed (caught — looping)")
        # Sleep with short ticks so a future stop signal could be responsive,
        # though we don't currently expose stop().
        slept = 0
        while slept < _CYCLE_SECONDS:
            time.sleep(10)
            slept += 10


def start():
    """Spawn the daemon thread. Idempotent — calling twice is a no-op."""
    if getattr(start, "_started", False):
        return
    start._started = True
    t = threading.Thread(target=_run_forever, daemon=True, name="bars-reconciliation")
    t.start()


def get_state() -> dict:
    """For the status endpoint."""
    with _state_lock:
        return dict(_state)
