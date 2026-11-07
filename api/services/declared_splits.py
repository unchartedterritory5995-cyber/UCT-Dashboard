"""Declared split lists for the nightly RS batch jobs (the rating history and the
evidence job), so the ONE split detector can judge every name.

WHY THIS EXISTS (owner decisions N4 / N5, 2026-11-07). The split guard on both
jobs is ``bars_sanitize.unadjusted_splits``: a declared split whose boundary still
shows its factor in the closes. That detector needs the ticker's DECLARED split
list, and the only place that list lived was ``bars_sanitize``'s in-process
cache: the shared 1,000-entry LRU, warmed by the serve path. A nightly pass over
~3,700 names finds most of them cold (the 05:00 ET split sweep says the same
about itself in ``api/main.py::_run_bars_split_repair_sweep``), and the evidence
job runs as a fresh SUBPROCESS whose cache is always empty. A cache-only guard
would therefore judge almost nothing while reading as healthy.

So a batch reader asks, in this order:

1. a FRESH memo row (a provider answer this job stored, younger than
   ``bars_sanitize._META_TTL``, the cache's own lifetime);
2. ``bars_sanitize``'s cache (read only: a miss schedules no warm);
3. the provider, through ``bars_sanitize._fetch_meta`` (the one fetcher the split
   sweep uses), at most ``budget`` times per run, behind ``bars_sanitize``'s own
   refusal brake (``_warm_gate_open``), with the sweep's politeness pause. The
   answer is written to the cache and to the memo;
4. a STALE memo row (an older answer is still a declared list);
5. ``None``: unknown. The caller counts it and does not guess.

A batch job may make the provider call: it runs on a scheduler thread or in the
worker's subprocess, off the request path, which is the context the split sweep
already uses for the same call. The serve path's cache-only invariant is
untouched.

ONLY PROVIDER ANSWERS ARE PERSISTED. A cached ``{"splits": []}`` can be
``bars_sanitize``'s one-hour failure sentinel, which reads exactly like "no splits
declared"; storing it for a week would turn one refused call into seven quiet
nights. It is used for this run and not written down.

The memo table lives in the caller's own SQLite file (``screener.db`` for the
rating history, the evidence store for the evidence job). With ``conn=None`` or
``persist=False`` (a dry run) the reader keeps answers in memory only.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Callable, Optional

log = logging.getLogger(__name__)

TABLE = "declared_split_lists"

#: Provider fetches one nightly run may make. The universe is ~3,700 names and a
#: stored answer stays fresh for ``bars_sanitize._META_TTL`` (seven days), so about
#: 530 lists expire a night; 600 covers that with room, which keeps a nightly to
#: roughly the split sweep's own per-night load (500 names). A first run with an
#: empty memo is the backfill's job, which passes ``None`` (no limit).
DEFAULT_FETCH_BUDGET = 600

#: Seconds between provider calls: the split sweep's politeness pause, not a rate limit.
FETCH_PAUSE_S = 0.05

_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    ticker TEXT PRIMARY KEY,
    splits TEXT NOT NULL,
    fetched_at REAL NOT NULL
)"""

Splits = list  # [(iso_date, ratio), ...]


def ensure_schema(conn) -> None:
    conn.execute(_SQL)


def _meta_ttl() -> float:
    from api.services import bars_sanitize as san
    return float(san._META_TTL)


def _default_fetch(ticker: str) -> dict:
    from api.services import bars_sanitize as san
    return san._fetch_meta(ticker)


def _default_cache_get(ticker: str):
    from api.services import bars_sanitize as san
    return san.cache.get(san._META_KEY.format(ticker))


def _default_cache_set(ticker: str, meta: dict) -> None:
    from api.services import bars_sanitize as san
    san.cache.set(san._META_KEY.format(ticker), meta, ttl=san._META_TTL)


def _default_gate():
    """``(is_open, note_failure, note_success)`` - ``bars_sanitize``'s refusal brake,
    so a rate-limited provider stops being asked by every reader at once."""
    from api.services import bars_sanitize as san
    return san._warm_gate_open, san._warm_note_failure, san._warm_note_success


def _clean(splits) -> Splits:
    out = []
    for item in splits or ():
        try:
            d, r = item[0], float(item[1])
        except (TypeError, ValueError, IndexError):
            continue
        if d and r > 0:
            out.append((str(d)[:10], r))
    return out


class DeclaredSplits:
    """``reader(ticker) -> [(iso_date, ratio), ...] | None`` (module header).

    ``budget`` is the number of provider fetches this reader may make (``None``:
    no limit, ``0``: never). ``stats`` counts where each answer came from.
    Never raises from ``__call__``.
    """

    def __init__(self, conn=None, *, budget: Optional[int] = DEFAULT_FETCH_BUDGET,
                 persist: bool = True, fetch: Optional[Callable] = None,
                 cache_get: Optional[Callable] = None, cache_set: Optional[Callable] = None,
                 gate=None, now: Callable[[], float] = time.time,
                 sleep: Callable[[float], None] = time.sleep, ttl: Optional[float] = None):
        self.conn = conn
        self.persist = bool(persist and conn is not None)
        self.budget = None if budget is None else max(0, int(budget))
        self._fetch = fetch or _default_fetch
        self._cache_get = cache_get or _default_cache_get
        self._cache_set = cache_set or _default_cache_set
        self._gate = gate
        self._now = now
        self._sleep = sleep
        self._ttl = ttl
        self._memo: dict = {}
        self._seen: dict = {}
        self.stats = {"memo": 0, "cache": 0, "fetched": 0, "fetch_failed": 0, "stale_memo": 0,
                      "unknown": 0, "budget": self.budget}
        if self.conn is not None:
            self._load()

    # ------------------------------------------------------------------ memo --
    def _load(self) -> None:
        try:
            if self.persist:
                ensure_schema(self.conn)
            rows = self.conn.execute(f"SELECT ticker, splits, fetched_at FROM {TABLE}").fetchall()
        except sqlite3.Error:
            return                                   # no table on a read-only store: memo stays empty
        for t, raw, at in rows:
            try:
                self._memo[str(t).upper()] = (_clean(json.loads(raw)), float(at))
            except (TypeError, ValueError):
                continue

    def _remember(self, ticker: str, splits: Splits) -> None:
        at = float(self._now())
        self._memo[ticker] = (splits, at)
        if not self.persist:
            return
        try:
            ensure_schema(self.conn)
            self.conn.execute(f"INSERT OR REPLACE INTO {TABLE} (ticker, splits, fetched_at) VALUES (?, ?, ?)",
                              (ticker, json.dumps([list(s) for s in splits]), at))
            self.conn.commit()
        except sqlite3.Error as e:
            log.warning("[declared_splits] memo write failed for %s: %s", ticker, e)

    # --------------------------------------------------------------- answers --
    def _budget_left(self) -> bool:
        return self.budget is None or self.stats["fetched"] + self.stats["fetch_failed"] < self.budget

    def _ask_provider(self, ticker: str):
        if not self._budget_left():
            return None
        is_open, note_failure, note_success = self._gate or _default_gate()
        try:
            if not is_open():
                return None
        except Exception:                            # noqa: BLE001 - an unreadable brake is a closed one
            return None
        try:
            meta = self._fetch(ticker)
        except Exception as e:                       # noqa: BLE001 - "could not ask" is not "no splits"
            self.stats["fetch_failed"] += 1
            log.debug("[declared_splits] provider refused %s: %s", ticker, e)
            try:
                note_failure()
            except Exception:                        # noqa: BLE001
                pass
            return None
        try:
            note_success()
        except Exception:                            # noqa: BLE001
            pass
        self.stats["fetched"] += 1
        splits = _clean((meta or {}).get("splits"))
        try:
            self._cache_set(ticker, meta if isinstance(meta, dict) else {"ipo": None, "splits": splits})
        except Exception:                            # noqa: BLE001
            pass
        self._remember(ticker, splits)
        if FETCH_PAUSE_S:
            self._sleep(FETCH_PAUSE_S)
        return splits

    def __call__(self, ticker) -> Optional[Splits]:
        t = str(ticker or "").strip().upper()
        if not t:
            return None
        if t in self._seen:                          # one answer per name per run
            return self._seen[t]
        got = self._resolve(t)
        self._seen[t] = got
        return got

    def _resolve(self, t: str) -> Optional[Splits]:
        ttl = self._ttl if self._ttl is not None else _meta_ttl()
        memo = self._memo.get(t)
        if memo is not None and self._now() - memo[1] < ttl:
            self.stats["memo"] += 1
            return list(memo[0])
        try:
            cached = self._cache_get(t)
        except Exception:                            # noqa: BLE001
            cached = None
        if isinstance(cached, dict):
            self.stats["cache"] += 1
            return _clean(cached.get("splits"))
        fetched = self._ask_provider(t)
        if fetched is not None:
            return fetched
        if memo is not None:
            self.stats["stale_memo"] += 1
            return list(memo[0])
        self.stats["unknown"] += 1
        return None
