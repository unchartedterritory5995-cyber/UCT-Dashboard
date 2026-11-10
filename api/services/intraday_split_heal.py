"""Heal a split CLIFF in the stored INTRADAY series — every tf on one basis.

🔴 THE DEFECT. Massive's intraday aggs are `adjusted=true` AS OF FETCH TIME. Rows the
store fetched before a split stay on the old scale forever; every delta after the split
lands on the new one. The trailing heal window (8h) and the gap-fill (2-14 days) only
re-write RECENT rows, so the pre-split body of the series was never re-adjusted: the
chart showed a 2x / 10x cliff at the split session on 1/5/15/30/60m.
`adjustment_basis._intraday_basis` could DETECT it (TERM-055) — and said so — but
nothing healed it ("Nothing heals an intraday split").

⭐ ONE DETECTOR. The judgement is `bars_sanitize.intraday_unadjusted_splits` (itself the
one daily detector asked of per-session closes): same `_SPLIT_TOL`, same `adjudicable`
guard, same ± window around the declared date. Nothing here re-derives it.

⭐ THE HEAL, PER (ticker, tf), WHEN A CLIFF IS OBSERVED:
  1. PURGE + REFETCH: re-pull the stored span from Massive (`_fetch_intraday_range`,
     `adjusted=true`, so it comes back on the post-split basis) and, if the refetch
     itself shows NO cliff and carries the series, swap it in with ONE atomic
     `bars_sqlite.replace_series` transaction.
  2. RESCALE (fallback when the provider cannot answer): divide every pre-boundary bar
     by the observed factor with `bars_sanitize.split_factor` / `scale_bar` — the same
     arithmetic the daily store repair uses — and upsert through `put_bars`.

⛔ IDEMPOTENT BY CONSTRUCTION. Both paths fire only on an OBSERVED split-sized
discontinuity; once healed the boundary ratio is ≈ 1, nothing matches, and a second run
writes nothing. A series with no declared split is never even read.

⛔ BOUNDED, OFF THE REQUEST PATH. `note_served` (called from the intraday serve
chokepoint `bars_fetch._fmt_sqlite_bars`) does only cache reads; the heal itself runs on
ONE background worker with a small dedup'd queue, and a (ticker, split) pair is checked
at most once per `_CHECK_TTL_S`. Split metadata is read from `bars_sanitize`'s cache
only — never a synchronous vendor call on a serve path.

Kill switch: `INTRADAY_SPLIT_HEAL_ENABLED=0` (default ON).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Callable, Optional, Sequence
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

INTRADAY_TFS = ("1", "5", "15", "30", "60")
#: Whole stored series per tf — a split factor applies to EVERY bar before the boundary.
_MAX_ROWS = 400_000
#: A declared date this far outside the served window can still be the session the
#: price stepped on (`bars_sanitize._SPLIT_BOUNDARY_WINDOW` = 7 sessions ≈ 10 days).
_DECLARED_PAD_DAYS = 10
#: A (ticker, newest-split) pair is re-checked at most this often.
_CHECK_TTL_S = float(os.environ.get("INTRADAY_SPLIT_HEAL_CHECK_TTL_S", str(6 * 3600)))
_CHECK_MAX_KEYS = 20_000
_QUEUE_MAX = 32
#: A refetch carrying fewer than this share of the stored rows is not trusted to
#: REPLACE the series (the rescale path keeps the depth instead).
_REFETCH_MIN_SHARE = 0.5

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


def _read(ticker: str, tf: str) -> list[dict]:
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(ticker, tf, _MAX_ROWS) or []
    return [{"t": int(r[0]), "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
            for r in rows]


def _default_fetch(ticker: str, tf: str, from_iso: str, to_iso: str) -> list[dict]:
    from api.services import bars_fetch
    return bars_fetch._fetch_intraday_range(ticker, tf, from_iso, to_iso)


def _spans(bars: Sequence[dict], boundary: date) -> bool:
    """The series has sessions on BOTH sides of `boundary`."""
    ds = [_session_date(b.get("t")) for b in bars]
    return any(d is not None and d < boundary for d in ds) and \
        any(d is not None and d >= boundary for d in ds)


def _rescaled(bars: Sequence[dict], cliffs) -> list[dict]:
    from api.services import bars_sanitize as _san
    out = []
    for b in bars:
        d = _session_date(b["t"])
        if d is None:
            continue
        f = _san.split_factor(d, cliffs)
        if f != 1.0:
            out.append(_san.scale_bar(dict(b), f))
    return out


def heal_series(ticker: str, tf: str, *, splits: Optional[Sequence] = None,
                fetch: Optional[Callable] = None, today: Optional[date] = None) -> dict:
    """Detect and heal ONE (ticker, tf). Returns a summary; writes only on a cliff."""
    from api.services import bars_sanitize as _san
    from api.services import bars_sqlite

    tk = ticker.upper()
    out = {"ticker": tk, "tf": tf, "cliffs": [], "method": None, "written": 0, "scanned": 0}
    declared = list(splits) if splits is not None else _declared(tk)
    if not declared:
        return out
    bars = _read(tk, tf)
    out["scanned"] = len(bars)
    if len(bars) < 2:
        return out
    cliffs = _san.intraday_unadjusted_splits(bars, declared)
    if not cliffs:
        return out
    out["cliffs"] = [(d.isoformat(), r) for d, r in cliffs]
    newest_boundary = max(d for d, _ in cliffs)

    # 1. purge + refetch on the provider's CURRENT (post-split) basis
    fetch = fetch or _default_fetch
    first = _session_date(bars[0]["t"])
    today = today or datetime.now(_ET).date()
    fresh: list = []
    try:
        fresh = list(fetch(tk, tf, first.isoformat(), today.isoformat()) or [])
    except Exception as e:  # noqa: BLE001
        _log.warning("[intraday-split-heal] %s tf=%s refetch failed: %s", tk, tf, e)
    if (fresh and len(fresh) >= _REFETCH_MIN_SHARE * len(bars)
            and _spans(fresh, newest_boundary)
            and not _san.intraday_unadjusted_splits(fresh, declared)):
        out["method"] = "refetch"
        out["written"] = int(bars_sqlite.replace_series(tk, tf, fresh) or 0)
    else:
        # 2. rescale the pre-boundary rows by the OBSERVED factor
        changed = _rescaled(bars, cliffs)
        out["method"] = "rescale"
        if changed:
            out["written"] = int(bars_sqlite.put_bars(tk, tf, changed, date_tf=False) or 0)
    _invalidate(tk, tf)
    _log.info("[intraday-split-heal] %s tf=%s cliffs=%s method=%s wrote %d/%d rows",
              tk, tf, out["cliffs"], out["method"], out["written"], out["scanned"])
    return out


def _invalidate(ticker: str, tf: str) -> None:
    try:
        from api.services.cache import cache
        cache.delete_prefix(f"bars_{ticker}_{tf}_")
        cache.invalidate(f"histfull_{ticker}_{tf}")   # depth may have changed
    except Exception:  # noqa: BLE001
        pass


def heal_ticker(ticker: str, *, splits: Optional[Sequence] = None,
                fetch: Optional[Callable] = None, tfs: Sequence[str] = INTRADAY_TFS,
                today: Optional[date] = None) -> list[dict]:
    """Heal every intraday tf of one ticker so the whole stored set is on ONE basis.
    One tf's failure never stops the others."""
    if not enabled():
        return []
    declared = list(splits) if splits is not None else _declared(ticker)
    res = []
    for tf in tfs:
        try:
            res.append(heal_series(ticker, tf, splits=declared, fetch=fetch, today=today))
        except Exception as e:  # noqa: BLE001
            _log.warning("[intraday-split-heal] %s tf=%s: %s", ticker, tf, e)
            res.append({"ticker": ticker.upper(), "tf": tf, "error": str(e)})
    return res
