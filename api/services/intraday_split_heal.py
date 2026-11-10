"""DETECT (and log) a split CLIFF in the stored INTRADAY series — no writes yet.

🔴 THE DEFECT. Massive's intraday aggs are `adjusted=true` AS OF FETCH TIME. Rows the
store fetched before a split stay on the old scale forever; every delta after the split
lands on the new one. The trailing heal window (8h) and the gap-fill (2-14 days) only
re-write RECENT rows, so the pre-split body of the series was never re-adjusted: the
chart showed a 2x / 10x cliff at the split session on 1/5/15/30/60m.
`adjustment_basis._intraday_basis` could DETECT it (TERM-055) — and said so — but
nothing healed it ("Nothing heals an intraday split").

⭐ ONE DETECTOR. The judgement is `bars_sanitize.unadjusted_splits` asked of the
series' per-session closes (exactly what `intraday_unadjusted_splits` does): same
`_SPLIT_TOL`, same `adjudicable` guard, same ± window around the declared date.

⛔⛔ DETECT + LOG ONLY — DELIBERATELY NO WRITES (integrator review N1/N2, 2026-11-10).
Two write designs were built and withdrawn:
  1. purge + refetch (`replace_series`): its DELETE was unbounded while the read and
     the refetch were not, so it could drop real history (review F1/F3/F4);
  2. chunked in-place rescale with a durable cursor (`rescale_before`): it decided
     WHICH rows to divide by POSITION (everything below the boundary / below the
     cursor), not by what the DATA shows. A re-heal after a partial old-basis rewrite
     would divide already-healed deep history a second time, and new-basis rows written
     below a pending cursor (full fetch, SWR, replay) would be double-scaled on resume.
A per-row "is this row on the old basis" test does not exist here — the only evidence
is a session-to-session step matched against a tolerance, and a real price move inside
an old-basis span can hide the span's far end. A silent double-adjust corrupts history
with no signal; a logged cliff is visible (`adjustment_basis` already labels it
`splits=False, unadjusted_split_at=…` for the member), so the safe ship is detection.
The healing write belongs in a follow-up that re-fetches a BOUNDED span from the
provider and replaces it only after proving the span's both edges are continuous.

What runs: per-session closes are streamed (`bars_sqlite.iter_ts_close`, O(sessions)
memory) and every declared split showing as a cliff is logged once per check with
counts and dates only (never prices).

⛔ BOUNDED, OFF THE REQUEST PATH. `note_served` (called from the intraday serve
chokepoint `bars_fetch._fmt_sqlite_bars`) does only cache reads; the heal itself runs on
ONE background worker (detection only) with a small dedup'd queue, and a (ticker, split) pair is checked
at most once per `_CHECK_TTL_S`. Split metadata is read from `bars_sanitize`'s cache
only — never a synchronous vendor call on a serve path.
⚠️ (F5, known) A cache MISS in `note_served` schedules `bars_sanitize`'s metadata warm
for that ticker — the same bounded, deduped 2-worker warm the daily serve path already
triggers for every ticker it sanitizes; an intraday-only scan adds the tickers whose
daily chart was never opened.

Kill switch: `INTRADAY_SPLIT_HEAL_ENABLED=0` (default ON).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Optional, Sequence
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

INTRADAY_TFS = ("1", "5", "15", "30", "60")
#: A declared date this far outside the served window can still be the session the
#: price stepped on (`bars_sanitize._SPLIT_BOUNDARY_WINDOW` = 7 sessions ≈ 10 days).
_DECLARED_PAD_DAYS = 10
#: A (ticker, newest-split) pair is re-checked at most this often.
_CHECK_TTL_S = float(os.environ.get("INTRADAY_SPLIT_HEAL_CHECK_TTL_S", str(6 * 3600)))
_CHECK_MAX_KEYS = 20_000
_QUEUE_MAX = 32

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="intraday-split-heal")
_lock = threading.Lock()
_inflight: set[str] = set()
_checked: dict[tuple[str, str], float] = {}


def enabled() -> bool:
    return os.environ.get("INTRADAY_SPLIT_HEAL_ENABLED", "1") != "0"


def _session_date(t) -> Optional[date]:
    try:
        return datetime.fromtimestamp(int(t), _ET).date()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _declared(ticker: str) -> list:
    """Declared splits from `bars_sanitize`'s CACHE (a cold miss schedules its warm)."""
    from api.services import bars_sanitize as _san
    if os.environ.get("PYTEST_CURRENT_TEST"):
        # cache-only under pytest: no vendor warm thread from a serve-path unit test
        from api.services.cache import cache
        meta = cache.get(_san._META_KEY.format(ticker.upper())) or {}
    else:
        meta = _san._meta_cached(ticker.upper()) or {}
    return list(meta.get("splits") or [])


def declared_splits_cached(ticker: str) -> list:
    """Declared splits from cache ONLY — never schedules a warm (for the R2 merge)."""
    try:
        from api.services import bars_sanitize as _san
        from api.services.cache import cache
        meta = cache.get(_san._META_KEY.format(ticker.upper())) or {}
        return list(meta.get("splits") or [])
    except Exception:  # noqa: BLE001
        return []


def _splits_near(splits: Sequence, first: date, last: date) -> list:
    lo, hi = first - timedelta(days=_DECLARED_PAD_DAYS), last + timedelta(days=_DECLARED_PAD_DAYS)
    out = []
    for s in splits or ():
        try:
            d = date.fromisoformat(str(s[0])[:10])
        except (ValueError, TypeError, IndexError):
            continue
        if lo <= d <= hi:
            out.append(s)
    return out


def note_served(ticker: str, tf: str, bars: Sequence[dict]) -> bool:
    """Serve-path hook: schedule a background heal when a declared split falls inside
    the served intraday window and has not been checked recently. Cheap (cache reads
    only), never raises, never blocks. Returns True when a heal was scheduled."""
    try:
        if not enabled() or tf not in INTRADAY_TFS or not bars or len(bars) < 2:
            return False
        first, last = _session_date(bars[0].get("t")), _session_date(bars[-1].get("t"))
        if first is None or last is None:
            return False
        tk = ticker.upper()
        near = _splits_near(_declared(tk), first, last)
        if not near:
            return False
        key = (tk, max(str(s[0])[:10] for s in near))
        now = time.monotonic()
        with _lock:
            exp = _checked.get(key)
            if exp is not None and now < exp:
                return False
            if tk in _inflight or len(_inflight) >= _QUEUE_MAX:
                return False
            if len(_checked) >= _CHECK_MAX_KEYS:
                _checked.clear()           # bounded; a cleared memo costs one re-check
            _checked[key] = now + _CHECK_TTL_S
            _inflight.add(tk)
        # 🔴 Never from a test process: a daemon heal outliving a test would write into
        # whatever store the restored `_DB_PATH` points at (see bars_fetch deepfill).
        if os.environ.get("PYTEST_CURRENT_TEST"):
            with _lock:
                _inflight.discard(tk)
            return False

        def _job():
            try:
                heal_ticker(tk)
            except Exception as e:  # noqa: BLE001
                _log.warning("[intraday-split-heal] %s failed: %s", tk, e)
            finally:
                with _lock:
                    _inflight.discard(tk)
        try:
            _pool.submit(_job)
        except Exception:  # noqa: BLE001
            with _lock:
                _inflight.discard(tk)
            return False
        return True
    except Exception:  # noqa: BLE001 — never into a serve
        return False


def _closes(rows) -> list[dict]:
    """(ts, c) rows (oldest first) → per-ET-session last close, O(sessions) memory."""
    last: dict[str, float] = {}
    for ts, c in rows:
        if c is None:
            continue
        d = _session_date(ts)
        if d is not None:
            last[d.isoformat()] = c
    return [{"t": d, "c": last[d]} for d in sorted(last)]


def heal_series(ticker: str, tf: str, *, splits: Optional[Sequence] = None) -> dict:
    """DETECT ONE (ticker, tf)'s unapplied split cliffs and log them. ⛔ Writes NOTHING
    (see the module docstring for the data-safety reason). Returns counts and dates."""
    from api.services import bars_sanitize as _san
    from api.services import bars_sqlite

    tk = ticker.upper()
    out = {"ticker": tk, "tf": tf, "cliffs": [], "written": 0}
    declared = list(splits) if splits is not None else _declared(tk)
    if not declared:
        return out
    cliffs = _san.unadjusted_splits(_closes(bars_sqlite.iter_ts_close(tk, tf)), declared)
    out["cliffs"] = [(d.isoformat(), r) for d, r in cliffs]
    if cliffs:
        _log.warning("[intraday-split-cliff] %s tf=%s unapplied split boundary(ies) %s "
                     "-- detected, NOT rewritten (detect-only)", tk, tf,
                     [d for d, _ in out["cliffs"]])
    return out


def heal_ticker(ticker: str, *, splits: Optional[Sequence] = None,
                tfs: Sequence[str] = INTRADAY_TFS, **kw) -> list[dict]:
    """Detect (log) cliffs on every intraday tf of one ticker. One tf's failure never
    stops the others."""
    if not enabled():
        return []
    declared = list(splits) if splits is not None else _declared(ticker)
    res = []
    for tf in tfs:
        try:
            res.append(heal_series(ticker, tf, splits=declared, **kw))
        except Exception as e:  # noqa: BLE001
            _log.warning("[intraday-split-heal] %s tf=%s: %s", ticker, tf, e)
            res.append({"ticker": ticker.upper(), "tf": tf, "error": str(e)})
    return res
