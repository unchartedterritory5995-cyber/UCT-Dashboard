"""Background prewarmer that fills the ticker_meta disk cache for every
ticker in the cap_universe. Runs once on Railway startup as a daemon
thread; survives redeploys because the cache is on the persistent volume.

Design notes:
- Walks cap_universe sequentially; skips tickers that already have a
  fresh disk-cached entry (idempotent across restarts).
- Sleeps between calls so yfinance rate limits don't trip — a full pass
  takes ~30 min in steady state, but most subsequent boots no-op after
  ~10 seconds because the cache is already warm.
- Never raises — backfill is best-effort. The autocomplete still works
  with whatever subset has been warmed.
- Repeatedly-unresolvable tickers back off exponentially (see below) so a
  handful of dead symbols can't tax every cold start.
"""
import json
import logging
import os
import threading
import time

_logger = logging.getLogger(__name__)

# --- dead-ticker backoff -------------------------------------------------
# `ticker_meta._base_meta` only persists a disk entry `if any(data.values())`,
# so a symbol that resolves to nothing at BOTH yfinance and Finnhub leaves no
# trace and is re-fetched on EVERY boot forever. Production 2026-07-26:
#   [ticker-names-prewarm] done in 46.6s — warmed=0 skipped=3722 failed=20
# ~20 dead symbols (ASGN, ATGE, CCCS, MPW, NWAX-U, EXPI, PSTG, XWIN…) cost 47s
# of every cold start, and there were 40 cold starts that day.
#
# This is deliberately BACKOFF, not a blacklist. A permanent dead-list is the
# trap that made tools/detect_dead_tickers.py unsafe -- self-induced load made
# it false-flag LIVE megacaps as delisted. Here every ticker is always retried
# eventually (wait is capped), and a single success wipes the record, so a
# rename/relisting or a transient provider outage self-heals.
#
# PRODUCTION EVIDENCE (2026-07-26, first pass after shipping this): of the 20
# symbols that failed, several are unmistakably LIVE companies -- BK (BNY
# Mellon), MMC (Marsh & McLennan), PSTG (Pure Storage), LC, MPW, SJW, NR --
# alongside genuinely unresolvable ones (NWAX-U, XWIN, GIG) and VIX, which is an
# index and never resolves as an equity. So "failed here" does NOT mean
# "delisted"; it mostly means the provider was flaky for that symbol. That is
# why the cap is ONE DAY, not a month: a live-but-flaky ticker must get another
# chance within 24h, while a permanently-dead one still drops from ~40
# attempts/day to 1. Nearly all of the saving, almost none of the risk.
_BASE_BACKOFF_SECONDS = 2 * 3600        # 1st failure -> skip for 2h
_MAX_BACKOFF_SECONDS = 24 * 3600        # cap: every ticker retried at least daily


def _backoff_path() -> str:
    # Resolved per call so DATA_DIR overrides (and tests) take effect.
    return os.path.join(
        os.environ.get("DATA_DIR", "/data"), "ticker_names_prewarm_backoff.json"
    )


def _load_backoff() -> dict:
    try:
        with open(_backoff_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        # Missing or corrupt -> behave as if nothing is backed off. Degrading
        # toward "attempt it" is the safe direction: worst case we pay the
        # fetch, we never wrongly suppress a live ticker.
        return {}


def _save_backoff(data: dict) -> None:
    try:
        path = _backoff_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, path)
    except Exception as e:
        _logger.info("[ticker-names-prewarm] backoff save failed: %s", e)


def _should_attempt(ticker: str, now: float | None = None) -> bool:
    now = time.time() if now is None else now
    entry = _load_backoff().get(ticker)
    if not entry:
        return True
    try:
        return now >= float(entry.get("next_attempt", 0))
    except Exception:
        return True


def _record_failure(ticker: str, now: float | None = None) -> None:
    now = time.time() if now is None else now
    data = _load_backoff()
    entry = data.get(ticker) or {}
    try:
        fails = int(entry.get("fails", 0)) + 1
    except Exception:
        fails = 1
    # 2h, 4h, 8h, ... capped at 30d. Cap the exponent first so a long-dead
    # ticker can't overflow the shift.
    wait = min(_BASE_BACKOFF_SECONDS * (2 ** min(fails - 1, 20)), _MAX_BACKOFF_SECONDS)
    data[ticker] = {"fails": fails, "next_attempt": now + wait, "last_failed": now}
    _save_backoff(data)


def _record_success(ticker: str) -> None:
    data = _load_backoff()
    if data.pop(ticker, None) is not None:
        _save_backoff(data)


def _sleep_between_calls() -> None:
    """Politeness delay between live fetches (patched out in tests)."""
    time.sleep(0.25)


def _resolve_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    if os.path.exists(here):
        return here
    return os.path.join("api", "data", "cap_universe.json")


def _load_universe():
    try:
        with open(_resolve_universe_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            return [str(t).upper() for t in data if t]
    except Exception as e:
        _logger.warning("[ticker-names-prewarm] cap_universe load failed: %s", e)
    return []


def _has_fresh_disk_entry(ticker: str) -> bool:
    try:
        from api.services import ticker_meta as tm
        p = tm._disk_path(ticker)
        if not os.path.exists(p):
            return False
        # _disk_get returns None when the file is older than _TTL; we want
        # the same staleness semantics so the prewarmer refreshes 24h+ rows.
        return tm._disk_get(ticker) is not None
    except Exception:
        return False


def _warm_one(ticker: str) -> bool:
    """Returns True if the ticker now has a name in cache."""
    try:
        from api.services.ticker_meta import _base_meta
        meta = _base_meta(ticker)
        return bool(meta and meta.get("name"))
    except Exception as e:
        _logger.info("[ticker-names-prewarm] %s failed: %s", ticker, e)
        return False


def _run_pass():
    universe = _load_universe()
    if not universe:
        return

    skipped = 0
    warmed = 0
    failed = 0
    backed_off = 0
    started = time.time()
    _logger.info("[ticker-names-prewarm] starting pass over %d tickers", len(universe))

    for i, ticker in enumerate(universe, 1):
        if _has_fresh_disk_entry(ticker):
            skipped += 1
            continue
        # Known-unresolvable and still inside its backoff window — skip WITHOUT
        # a network call. This is the whole point: it keeps ~20 dead symbols
        # from costing 47s on every cold start.
        if not _should_attempt(ticker):
            backed_off += 1
            continue
        ok = _warm_one(ticker)
        if ok:
            warmed += 1
            _record_success(ticker)
        else:
            failed += 1
            _record_failure(ticker)
        # Be polite to yfinance / Finnhub — 250ms between live fetches is
        # gentle enough to avoid sustained 429s while still finishing the
        # full universe in well under an hour.
        _sleep_between_calls()
        if i % 200 == 0:
            _logger.info(
                "[ticker-names-prewarm] progress %d/%d (warmed=%d skipped=%d failed=%d backed_off=%d)",
                i, len(universe), warmed, skipped, failed, backed_off,
            )

    elapsed = time.time() - started
    _logger.info(
        "[ticker-names-prewarm] done in %.1fs — warmed=%d skipped=%d failed=%d backed_off=%d",
        elapsed, warmed, skipped, failed, backed_off,
    )


def start_async() -> None:
    """Kick off the prewarm pass on a background daemon thread."""
    if os.environ.get("TICKER_NAMES_PREWARM_DISABLED") == "1":
        _logger.info("[ticker-names-prewarm] disabled via env")
        return

    def _runner():
        # Stagger boot — let the rest of startup settle so we don't fight
        # for the worker pool while bars_prewarm is in its initial flurry.
        time.sleep(60)
        try:
            _run_pass()
        except Exception as e:
            _logger.warning("[ticker-names-prewarm] aborted: %s", e)

    threading.Thread(target=_runner, daemon=True, name="ticker-names-prewarm").start()
