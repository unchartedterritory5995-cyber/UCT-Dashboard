"""Complete 5m / 15m / 30m / 60m sessions for the first-frame seed: a post-close pass, and the proof
the builder packs by.

WHY (measured 2026-11-21 on build 20261121T0137Z, as of Friday 2026-11-20). The seed reads the WORKER's
bars.db. There the prewarm fetches a symbol's 15m / 30m / 60m ONCE per session: `bars_prewarm._warm_one`
skips every intraday series whose newest bar already bears the session's date (`_boot_can_skip`, added
2026-09-23 for the boot pass, but `_warm_one` is the steady refresh loop's job too), and outside 04:00 to
20:00 ET the loop does not scan at all. So a series holds whatever the first fetch of the morning returned,
its last row a bucket caught WHILE FORMING, and nothing asks again. Symbol A's 30m: last provider check and
last write 10:16:56 ET, last row the 10:00 bucket (L 173.76, C 174.29, V 43,567 against L 172.23, C 172.34,
V 84,444 from its own minutes). 6 of 3,541 symbols' 30m reached the session's last bucket. The long tail's
5m has the same rule in its own writer (`bars_universe_crawler._default_is_stale`: stale only when the
newest bar predates the session), so it holds the crawler's one visit of the day (symbol A: 11:19:32 ET,
last row the 11:15 bucket).

THE PASS (`complete_session`). Runs inside the nightly seed build (`ffseed.nightly`), after the as-of
session's EXTENDED hours have ended, for every seed-universe symbol:

  * 5m and 15m are PROVIDER series: the as-of session (and the days back to the stored tail, when the store
    stops before it) is fetched at that timespan with the same provider read the serve path's range repairs
    use (`bars_fetch._fetch_intraday_range`, split-adjusted) and written the same way (`put_bars` inside
    `provider_check`). 2 requests a symbol.
  * 30m and 60m are DERIVED series: the serve path's rule is that a stored 30m / 60m bucket is always the
    resample of the STORED 15m rows in it (`bars_fetch._derive_from_stored_base`, the one derivation path).
    The pass re-derives them from the 15m it has just completed, from the first day that 15m changed. No
    provider call.

⛔ NOT DERIVED FROM 1m. Rolling a symbol's provider 1m up to 5m does not give the provider's 5m: measured
on symbol A (2026-11-20, complete buckets only), all 21 comparable 5m buckets had equal prices and 19 had
a volume 1 to 2 shares above the sum of their minutes (15m: 3 to 5 shares). The provider's volumes are
fractional and the store keeps each bar's integer part, so a sum of truncated minutes is not the truncated
sum. `/api/bars` answers 5m and 15m with the provider's aggregates at that timespan, so the seed must hold
those.

THE PROOF (`known_complete`). A (symbol, timeframe) is COMPLETE for the as-of session when THIS pass, at an
instant after that session's extended hours ended, asked the provider for the whole session (or derived it
from a 15m that is complete), the rows reached the store, and the series has not been written since. The
ledger (<DATA_DIR>/ffseed_intraday_complete.json) records, per timeframe and symbol, the store's revision
of the series right after the pass's write; a later write (or a store replaced wholesale) changes the
revision and the entry no longer proves anything, so the next pass asks again. A symbol with no print in
the session's last bucket is complete all the same: the provider was asked after the close and returned
none. `ffseed.build_tf` packs an intraday symbol only on this proof; everything else is left out of that
timeframe and counted (`incomplete`).

Bounded like the 1m pass: `FFSEED_INTRADAY_WORKERS` threads (default 2), `FFSEED_INTRADAY_DEADLINE_S`
(default 5400 s; past it the pass stops, the build goes ahead, and what the pass did not reach is left
out). Off: `FFSEED_INTRADAY_BACKFILL=0` (the build then refuses every gated timeframe: fail closed).
A symbol's failure is counted, never fatal. Memory: one symbol's rows per thread at a time.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from typing import Callable, Dict, Iterable, List, Optional, Tuple

from api.services import ffseed
from api.services import ffseed_onemin as onemin

log = logging.getLogger(__name__)

_LEDGER_FILE = "ffseed_intraday_complete.json"
#: Seconds after the extended session's end before the pass may ask (the bar contract's own seal lag,
#: `bar_contract.SEAL_LAG_S`, is 45 s: a bucket is final once the provider was asked that long after it ended).
SETTLE_S = 60
_SAVE_EVERY = 200


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        return default


def enabled() -> bool:
    return os.environ.get("FFSEED_INTRADAY_BACKFILL", "1").strip() != "0"


def workers() -> int:
    return max(1, _int_env("FFSEED_INTRADAY_WORKERS", 2))


def deadline_s() -> int:
    return max(1, _int_env("FFSEED_INTRADAY_DEADLINE_S", 5400))


# --------------------------------------------------------------------------------------------
# which timeframes are fetched and which are derived: the serve path's own split, never restated
# --------------------------------------------------------------------------------------------

def tf_roles() -> Tuple[Tuple[str, ...], Tuple[str, ...], str]:
    """(provider timeframes, derived timeframes, the derived ones' base) among the seed's gated
    timeframes, as `bars_fetch` defines them (30m / 60m derive from the stored 15m)."""
    from api.services import bars_fetch
    derived = tuple(tf for tf in ffseed.GATED_TFS if tf in bars_fetch._DERIVED_TFS)
    base = tuple(tf for tf in ffseed.GATED_TFS if tf not in derived)
    return base, derived, bars_fetch._DERIVED_BASE_TF


def settled_at(asof: date) -> int:
    """The first instant the pass may ask for `asof`: its extended session's end plus `SETTLE_S`."""
    from api.services import bars_fetch
    return int(bars_fetch._session_window(asof, "eth")[1]) + SETTLE_S


def _et_day(ts: int) -> date:
    return datetime.fromtimestamp(int(ts), ffseed.ET).date()


def first_day(asof: date, last_ts: Optional[int], reach_days: int) -> Optional[date]:
    """The first ET day to write so the series stays contiguous: `asof` when the store already holds
    part of it (or nothing at all), else the day of the stored tail. None when that tail is more than
    `reach_days` back: the series is left alone (its own repair owns the gap) and the symbol left out."""
    if last_ts is None:
        return asof
    d = _et_day(last_ts)
    if d >= asof:
        return asof
    return d if (asof - d).days <= int(reach_days) else None


# --------------------------------------------------------------------------------------------
# the ledger: what this pass proved complete for ONE as-of session
# --------------------------------------------------------------------------------------------

def _ledger_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), _LEDGER_FILE)


def _empty(asof: date) -> dict:
    return {"v": 1, "asof": asof.isoformat(), "tfs": {tf: {} for tf in ffseed.GATED_TFS}}


def load_ledger(asof: date) -> dict:
    """The ledger for `asof`; one for another session, a missing or an unreadable one is EMPTY (nothing
    is known complete)."""
    try:
        with open(_ledger_path(), encoding="ascii") as f:
            led = json.load(f)
        if (isinstance(led, dict) and led.get("v") == 1 and led.get("asof") == asof.isoformat()
                and isinstance(led.get("tfs"), dict)):
            out = _empty(asof)
            for tf in out["tfs"]:
                e = led["tfs"].get(tf)
                if isinstance(e, dict):
                    out["tfs"][tf] = e
            return out
    except Exception:  # noqa: BLE001
        pass
    return _empty(asof)


def save_ledger(led: dict) -> None:
    try:
        tmp = _ledger_path() + ".tmp"
        with open(tmp, "w", encoding="ascii") as f:
            json.dump(led, f, sort_keys=True, separators=(",", ":"))
        os.replace(tmp, _ledger_path())
    except Exception:  # noqa: BLE001
        log.warning("[ffseed-intraday] could not write the ledger")


def _store_rev(sym: str, tf: str) -> int:
    """The store's revision of a series (`bars_sqlite.series_meta`): it changes on every write and when
    the store is replaced wholesale. 0 = no write recorded (or an unreadable store)."""
    from api.services import bars_sqlite
    return int(bars_sqlite.series_meta(sym, tf).get("rev") or 0)


def _holds(entry, sym: str, tf: str, rev: Callable[[str, str], int]) -> bool:
    """A ledger entry is `[revision after the pass's write, first day written]`; it proves the series
    complete while the store's revision is still that one (read only when there is an entry)."""
    return isinstance(entry, list) and len(entry) == 2 and int(entry[0]) == int(rev(sym, tf))


def known_complete(asof: date, *, rev: Callable[[str, str], int] = None,
                   ledger: Optional[dict] = None) -> Callable[[str, str], bool]:
    """`(symbol, timeframe) -> bool`: the pass proved this series complete for `asof` and it has not been
    written since (see the module doc). Anything it cannot read answers False."""
    led = ledger if ledger is not None else load_ledger(asof)
    rev = rev or _store_rev

    def complete(sym: str, tf: str) -> bool:
        try:
            s, t = str(sym).upper(), str(tf)
            return _holds(led["tfs"].get(t, {}).get(s), s, t, rev)
        except Exception:  # noqa: BLE001 - unknown is not complete
            return False

    return complete


# --------------------------------------------------------------------------------------------
# the provider read, the derivation and the write (the serve path's own)
# --------------------------------------------------------------------------------------------

def _stored_last_ts(sym: str, tf: str) -> Optional[int]:
    from api.services import bars_sqlite
    return bars_sqlite.get_last_ts(sym, tf)


def _stored_first_ts(sym: str, tf: str) -> Optional[int]:
    from api.services import bars_sqlite
    return bars_sqlite.get_first_ts(sym, tf)


def _fetch(sym: str, tf: str, frm: date, to: date) -> list:
    """The provider's split-adjusted aggregates AT `tf` for [frm, to] (whole ET days); raises on failure.
    Only ever called with a provider timeframe: `_fetch_intraday_range` resamples 30 / 60 in memory, which
    is not the stored-base derivation the serve path keeps."""
    from api.services import bars_fetch
    if tf in bars_fetch._DERIVED_TFS:
        raise ValueError(f"tf {tf} is derived, never fetched")
    return bars_fetch._fetch_intraday_range(sym, tf, frm.isoformat(), to.isoformat(), raise_errors=True)


def _derive(sym: str, tf: str, from_ts: int) -> list:
    """The derived `tf` buckets from `from_ts` on, built from the STORED base (the serve path's one
    derivation: `bars_fetch._derive_from_stored_base`)."""
    from api.services import bars_fetch
    return bars_fetch._derive_from_stored_base(sym, tf, bars_fetch._derived_bucket_start(tf, int(from_ts)))


def _store(sym: str, tf: str, rows: list, checked_at: float) -> int:
    """The range-repair write: rows a newer provider check sealed are never overwritten."""
    from api.services import bars_fetch, bars_sqlite
    with bars_fetch._provider_write(checked_at):
        return bars_sqlite.put_bars(sym, tf, rows)


def reach_days() -> int:
    """How far back (calendar days) a stored tail may be for the pass to join it. The serve path's tail
    repair fetches from the stored tail's day however old; this bounds one symbol's request."""
    return max(1, _int_env("FFSEED_INTRADAY_REACH_DAYS", 30))


def _covers_tail(rows: list, last_ts: Optional[int], frm: date, asof: date) -> bool:
    """The answer reaches the tail the store already held inside the window it was asked for. A stored
    bucket traded, so a whole answer holds it; one that stops before it (or is empty) is not whole, and
    the rows it failed to replace may be the forming ones."""
    if last_ts is None:
        return True
    lo = onemin.session_start_ts(frm)
    hi = onemin.session_start_ts(asof) + 86400
    if not (lo <= int(last_ts) < hi):
        return True                       # the tail is outside the asked window: nothing to compare
    return bool(rows) and max(int(b["t"]) for b in rows) >= int(last_ts)


# --------------------------------------------------------------------------------------------
# the pass
# --------------------------------------------------------------------------------------------

def complete_session(asof: date, symbols: Optional[Iterable[str]] = None, *,
                     fetch: Callable[[str, str, date, date], list] = None,
                     derive: Callable[[str, str, int], list] = None,
                     store: Callable[[str, str, list, float], int] = None,
                     rev: Callable[[str, str], int] = None,
                     last_ts: Callable[[str, str], Optional[int]] = None,
                     first_ts: Callable[[str, str], Optional[int]] = None,
                     n_workers: Optional[int] = None, deadline: Optional[float] = None,
                     clock: Callable[[], float] = time.monotonic,
                     now: Optional[float] = None) -> dict:
    """Bring every universe symbol's 5m / 15m / 30m / 60m for `asof` to completeness and record the proof.
    Never raises for a symbol. Returns the pass's stats; `requests` is the provider calls made."""
    fetch, derive, store = fetch or _fetch, derive or _derive, store or _store
    rev, last_ts, first_ts = rev or _store_rev, last_ts or _stored_last_ts, first_ts or _stored_first_ts
    syms = sorted({str(s).upper() for s in (symbols if symbols is not None else ffseed.universe()) if s})
    base_tfs, derived_tfs, derived_base = tf_roles()
    counters = ("current", "done", "rows", "empty", "failed", "short_answer", "behind", "no_base", "not_reached")
    stats: Dict[str, object] = {"asof": asof.isoformat(), "symbols": len(syms), "requests": 0, "secs": 0.0,
                                "tfs": {tf: dict.fromkeys(counters, 0) for tf in base_tfs + derived_tfs}}
    now_ts = time.time() if now is None else float(now)
    if now_ts < settled_at(asof):
        # Before the extended session has ended a "whole session" answer is not whole (and the derived
        # post-market buckets would be written while forming). Nothing is fetched, nothing is proved.
        stats["skipped"] = "session not settled"
        log.warning("[ffseed-intraday] %s is not settled yet (extended hours end + %ds): pass skipped",
                    asof, SETTLE_S)
        return stats
    t0 = clock()
    stop_at = t0 + (deadline if deadline is not None else deadline_s())
    led = load_ledger(asof)
    lock = threading.Lock()
    unsaved = [0]

    def bump(tf: str, key: str, n: int = 1) -> None:
        with lock:
            stats["tfs"][tf][key] += n

    def mark(tf: str, sym: str, frm: date) -> None:
        r = rev(sym, tf)
        with lock:
            led["tfs"][tf][sym] = [int(r), frm.isoformat()]
            unsaved[0] += 1
            if unsaved[0] >= _SAVE_EVERY:
                unsaved[0] = 0
                save_ledger(led)

    def is_done(tf: str, sym: str) -> bool:
        with lock:
            e = led["tfs"][tf].get(sym)
        return _holds(e, sym, tf, rev)

    def base_one(sym: str, tf: str) -> Optional[str]:
        """'current' (already proven), 'done' (fetched and stored now) or None (not complete)."""
        if is_done(tf, sym):
            bump(tf, "current")
            return "current"
        if clock() > stop_at:
            bump(tf, "not_reached")
            return None
        held = last_ts(sym, tf)
        frm = first_day(asof, held, reach_days())
        if frm is None:
            bump(tf, "behind")
            return None
        checked = time.time()
        with lock:
            stats["requests"] += 1
        rows = fetch(sym, tf, frm, asof)
        if not _covers_tail(rows, held, frm, asof):
            bump(tf, "short_answer")      # stops before a bucket the store already holds: not whole
            return None
        n = int(store(sym, tf, rows, checked) or 0) if rows else 0
        if rows and not n:
            bump(tf, "failed")            # the provider answered and nothing reached the store
            return None
        mark(tf, sym, frm)
        bump(tf, "done")
        bump(tf, "rows", n)
        if not rows:
            bump(tf, "empty")
        return "done"

    def derived_one(sym: str, tf: str, base_state: str) -> None:
        # proven AND its base untouched since: nothing to do. A base fetched again in this run is
        # derived again, so the stored bucket stays the resample of the stored base.
        if base_state == "current" and is_done(tf, sym):
            bump(tf, "current")
            return
        with lock:
            base_e = led["tfs"][derived_base].get(sym)
        # the first day whose base rows this pass rewrote: the derived rows are rebuilt from there, so a
        # stored bucket is always the resample of the stored base (the serve path's invariant)
        base_from = date.fromisoformat(base_e[1])
        held = last_ts(sym, tf)
        own_from = first_day(asof, held, reach_days())
        if own_from is None:
            bump(tf, "behind")
            return
        frm = min(own_from, base_from)
        b0 = first_ts(sym, derived_base)
        if b0 is not None and _et_day(b0) > frm:
            bump(tf, "behind")            # the base does not reach back to the derived tail: a hole
            return
        rows = derive(sym, tf, onemin.session_start_ts(frm))
        if not _covers_tail(rows, held, frm, asof):
            bump(tf, "short_answer")
            return
        n = int(store(sym, tf, rows, time.time()) or 0) if rows else 0
        if rows and not n:
            bump(tf, "failed")
            return
        mark(tf, sym, frm)
        bump(tf, "done")
        bump(tf, "rows", n)
        if not rows:
            bump(tf, "empty")

    def one(sym: str) -> None:
        state = {}
        for tf in base_tfs:
            try:
                state[tf] = base_one(sym, tf)
            except Exception as e:  # noqa: BLE001 - one symbol never stops the pass
                log.info("[ffseed-intraday] %s tf=%s failed: %s", sym, tf, type(e).__name__)
                bump(tf, "failed")
                state[tf] = None
        for tf in derived_tfs:
            if not state.get(derived_base):
                bump(tf, "no_base")       # its 15m is not complete: nothing to derive from
                continue
            try:
                derived_one(sym, tf, state[derived_base])
            except Exception as e:  # noqa: BLE001
                log.info("[ffseed-intraday] %s tf=%s failed: %s", sym, tf, type(e).__name__)
                bump(tf, "failed")

    with ThreadPoolExecutor(max_workers=n_workers or workers(), thread_name_prefix="ffseed-intra") as ex:
        list(ex.map(one, syms))
    save_ledger(led)
    stats["secs"] = round(clock() - t0, 1)
    log.info("[ffseed-intraday] pass %s", stats)
    return stats


def run_pass(asof: date, **kw) -> dict:
    return complete_session(asof, **kw)


def status(asof: date) -> dict:
    led = load_ledger(asof)
    return {"enabled": enabled(), "asof": led["asof"], "proved": {tf: len(v) for tf, v in led["tfs"].items()}}


__all__: List[str] = ["complete_session", "known_complete", "run_pass", "enabled", "tf_roles", "settled_at",
                      "first_day", "load_ledger", "save_ledger", "status"]
