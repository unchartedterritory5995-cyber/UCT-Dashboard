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

THE PASS (`complete_session`). Runs inside the nightly seed build (`ffseed.nightly`), and only in the QUIET
GAP of its session (`cannot_run`): after the as-of session's EXTENDED hours have ended and before the next
trading day's extended session opens (04:00 ET). Before the gap a "whole session" is not whole; after it
the store is being written by the day's own fetches (which void the proofs anyway) and ~7,300 requests and
~14,400 series writes would land on a live session. A pass still running when the gap closes stops there
(`not_reached`). For every seed-universe symbol:

  * 5m and 15m are PROVIDER series: the as-of session (and the days back to the stored tail, when the store
    stops before it) is fetched at that timespan with the same provider read the serve path's range repairs
    use (`bars_fetch._fetch_intraday_range`, split-adjusted) and written the same way (`put_bars` inside
    `provider_check`). 2 requests a symbol.
  * 30m and 60m are DERIVED series: the serve path's rule is that a stored 30m / 60m bucket is always the
    resample of the STORED 15m rows in it (`bars_fetch._derive_from_stored_base`, the one derivation path).
    The pass re-derives them from the 15m it has just completed, over exactly the days it refetched: the
    15m request starts at the oldest of the three tails (15m, 30m, 60m), so no day is resampled from 15m
    rows the pass did not just read whole. No provider call.

⛔ NOT DERIVED FROM 1m. Rolling a symbol's provider 1m up to 5m does not give the provider's 5m: measured
on symbol A (2026-11-20, complete buckets only), all 21 comparable 5m buckets had equal prices and 19 had
a volume 1 to 2 shares above the sum of their minutes (15m: 3 to 5 shares). The provider's volumes are
fractional and the store keeps each bar's integer part, so a sum of truncated minutes is not the truncated
sum. `/api/bars` answers 5m and 15m with the provider's aggregates at that timespan, so the seed must hold
those.

THE PROOF (`known_complete`). A (symbol, timeframe) is COMPLETE for the as-of session when THIS pass, in
that session's quiet gap, asked the provider for the whole session (or derived it from a 15m that is
complete), the answer was WHOLE, its rows reached the store, and the series has not been written since.

WHOLE (`later_trade`) is a rule about the answer, not about what the store held: the answer has bars OF the
as-of day (an empty answer, or one with other days only, proves nothing), and NO OTHER RECORD of that
symbol's as-of day shows a trade in a later bucket. The records: the newest as-of-day bar the store holds
at 1m (the 1m pass's own, separate provider read), at 5m and at 15m, and the newest as-of-day bar of the
other timeframe's answer in this same pass (a separate request). A trade in any of them is a trade the
provider's bar at this timeframe must hold, so an answer that ends before its bucket was cut short.
Whichever record is missing is simply not consulted; the two answers always check each other. The
ledger (<DATA_DIR>/ffseed_intraday_complete.json) records, per timeframe and symbol, the store's revision
of the series right after the pass's write; a later write (or a store replaced wholesale) changes the
revision and the entry no longer proves anything, so the next pass asks again. A symbol with no print in
the session's last bucket is complete all the same: every record agrees its trading ended earlier.
`ffseed.build_tf` packs an intraday symbol only on this proof; everything else is left out of that
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
from datetime import date, datetime, timedelta
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
    _open_ts, close_ts = bars_fetch._session_window(asof, "eth")
    return int(close_ts) + SETTLE_S


def gap_end(asof: date) -> int:
    """The instant the quiet gap of `asof` closes: the next trading day's extended session opens."""
    from api.services import bars_fetch
    open_ts, _close_ts = bars_fetch._session_window(ffseed.next_session(asof), "eth")
    return int(open_ts)


def cannot_run(asof: date, now_ts: float) -> Optional[str]:
    """Why the pass for `asof` must not run at `now_ts`, or None: it runs only in the quiet gap between
    the end of `asof`'s extended session (+ `SETTLE_S`) and the next trading day's extended open."""
    if now_ts < settled_at(asof):
        return "session not settled"
    if now_ts >= gap_end(asof):
        return f"a later session has begun ({ffseed.next_session(asof).isoformat()})"
    return None


def _et_day(ts: int) -> date:
    return datetime.fromtimestamp(int(ts), ffseed.ET).date()


def day_bounds(d: date) -> Tuple[int, int]:
    """[start, end) of the ET calendar day `d`, unix seconds."""
    n = d + timedelta(days=1)
    return (int(datetime(d.year, d.month, d.day, tzinfo=ffseed.ET).timestamp()),
            int(datetime(n.year, n.month, n.day, tzinfo=ffseed.ET).timestamp()))


def last_bar_of_day(rows: list, d: date) -> Optional[int]:
    """Start of the newest bar of `rows` that lies in the ET day `d`, or None."""
    lo, hi = day_bounds(d)
    ts = [int(b["t"]) for b in rows or () if lo <= int(b["t"]) < hi]
    return max(ts) if ts else None


def later_trade(tf: str, last_bar: int, records: Iterable[Tuple[str, int]]) -> Optional[Tuple[str, int]]:
    """The first record (label, instant of a traded bar) whose bucket on `tf`'s grid lies AFTER `last_bar`,
    or None. A traded bar at any timeframe is a trade, and the provider's `tf` bar for that bucket must
    exist: an answer whose newest bar is before it does not cover the session's last traded bucket."""
    from api.services import bars_fetch
    for label, t in records:
        if int(last_bar) < int(bars_fetch._derived_bucket_start(tf, int(t))):
            return label, int(t)
    return None


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


def _stored_day_tail(sym: str, tf: str, d: date) -> Optional[int]:
    """Start of the newest STORED bar of (sym, tf) that lies in the ET day `d`, or None. One tail read;
    a second, bounded one only when the store already holds a later day (a late run)."""
    from api.services import bars_sqlite
    lt = bars_sqlite.get_last_ts(sym, tf)
    if lt is None:
        return None
    lo, hi = day_bounds(d)
    if int(lt) < lo:
        return None
    if int(lt) < hi:
        return int(lt)
    rows = bars_sqlite.get_bars_before(sym, tf, 1, hi - 1)
    ts = int(rows[-1][0]) if rows else None
    return ts if ts is not None and ts >= lo else None


# --------------------------------------------------------------------------------------------
# the pass
# --------------------------------------------------------------------------------------------

def complete_session(asof: date, symbols: Optional[Iterable[str]] = None, *,
                     fetch: Callable[[str, str, date, date], list] = None,
                     derive: Callable[[str, str, int], list] = None,
                     store: Callable[[str, str, list, float], int] = None,
                     rev: Callable[[str, str], int] = None,
                     last_ts: Callable[[str, str], Optional[int]] = None,
                     day_tail: Callable[[str, str, date], Optional[int]] = None,
                     n_workers: Optional[int] = None, deadline: Optional[float] = None,
                     clock: Callable[[], float] = time.monotonic,
                     now: Optional[float] = None) -> dict:
    """Bring every universe symbol's 5m / 15m / 30m / 60m for `asof` to completeness and record the proof.
    Never raises for a symbol. Returns the pass's stats; `requests` is the provider calls made, and
    `skipped` (with nothing fetched and nothing proved) says why the pass could not run now."""
    fetch, derive, store = fetch or _fetch, derive or _derive, store or _store
    rev, last_ts, day_tail = rev or _store_rev, last_ts or _stored_last_ts, day_tail or _stored_day_tail
    syms = sorted({str(s).upper() for s in (symbols if symbols is not None else ffseed.universe()) if s})
    base_tfs, derived_tfs, derived_base = tf_roles()
    counters = ("current", "done", "rows", "empty", "failed", "short_answer", "behind", "no_base", "not_reached")
    stats: Dict[str, object] = {"asof": asof.isoformat(), "symbols": len(syms), "requests": 0, "secs": 0.0,
                                "tfs": {tf: dict.fromkeys(counters, 0) for tf in base_tfs + derived_tfs}}
    now_ts = time.time() if now is None else float(now)
    why = cannot_run(asof, now_ts)
    if why is not None:
        stats["skipped"] = why
        log.warning("[ffseed-intraday] pass for %s skipped: %s (it runs only between that session's extended "
                    "close + %ds and the next trading day's 04:00 ET)", asof, why, SETTLE_S)
        return stats
    t0 = clock()
    # the deadline, and never past the end of the quiet gap: the next session's writes are not ours to race
    stop_at = t0 + min(float(deadline if deadline is not None else deadline_s()), gap_end(asof) - now_ts)
    reach = reach_days()
    _day_start, day_end = day_bounds(asof)
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

    def ask(sym: str, tf: str) -> Optional[tuple]:
        """(rows, first day asked, check instant) of one provider timeframe, or None (counted)."""
        if clock() > stop_at:
            bump(tf, "not_reached")
            return None
        frm = first_day(asof, last_ts(sym, tf), reach)
        if frm is None:
            bump(tf, "behind")
            return None
        if tf == derived_base:
            # the derived series are rebuilt over the days asked for here and no others, so the request
            # starts at the oldest of the three tails (one request either way)
            for d_tf in derived_tfs:
                own = first_day(asof, last_ts(sym, d_tf), reach)
                if own is not None and own < frm:
                    frm = own
        checked = time.time()
        with lock:
            stats["requests"] += 1
        return fetch(sym, tf, frm, asof), frm, checked

    def refuse_short(sym: str, tf: str, last: int, gap: Tuple[str, int]) -> None:
        bump(tf, "short_answer")
        log.info("[ffseed-intraday] %s tf=%s short answer: ends %s ET, but %s holds a bar at %s ET",
                 sym, tf, datetime.fromtimestamp(last, ffseed.ET).strftime("%H:%M"), gap[0],
                 datetime.fromtimestamp(gap[1], ffseed.ET).strftime("%m-%d %H:%M"))

    def one(sym: str) -> None:
        state: Dict[str, Optional[str]] = {}
        answers: Dict[str, tuple] = {}
        for tf in base_tfs:
            state[tf] = None
            try:
                if is_done(tf, sym):
                    bump(tf, "current")
                    state[tf] = "current"
                    continue
                got = ask(sym, tf)
                if got is not None:
                    answers[tf] = got
            except Exception as e:  # noqa: BLE001 - one symbol never stops the pass
                log.info("[ffseed-intraday] %s tf=%s failed: %s", sym, tf, type(e).__name__)
                bump(tf, "failed")
        # every record of the symbol's as-of day: what the store holds at 1m and at the provider
        # timeframes, and what each answer of this pass holds (see WHOLE in the module doc)
        records: List[Tuple[str, int]] = []
        try:
            for r_tf in ("1",) + base_tfs:
                t = day_tail(sym, r_tf, asof)
                if t is not None:
                    records.append((f"the stored {r_tf}m", t))
        except Exception as e:  # noqa: BLE001 - records that cannot be read: nothing is proved
            log.info("[ffseed-intraday] %s records unreadable: %s", sym, type(e).__name__)
            for tf in answers:
                bump(tf, "failed")
            answers = {}
        for tf, (rows, _frm, _checked) in answers.items():
            t = last_bar_of_day(rows, asof)
            if t is not None:
                records.append((f"the {tf}m answer", t))
        checked_base: Optional[float] = None
        for tf, (rows, frm, checked) in answers.items():
            try:
                last = last_bar_of_day(rows, asof)
                if last is None:
                    bump(tf, "empty")             # no bar of the as-of day: never proof
                    continue
                gap = later_trade(tf, last, records)
                if gap is not None:
                    refuse_short(sym, tf, last, gap)
                    continue
                n = int(store(sym, tf, rows, checked) or 0)
                if not n:
                    bump(tf, "failed")            # the provider answered and nothing reached the store
                    continue
                mark(tf, sym, frm)
                bump(tf, "done")
                bump(tf, "rows", n)
                state[tf] = "done"
                if tf == derived_base:
                    checked_base = checked
            except Exception as e:  # noqa: BLE001
                log.info("[ffseed-intraday] %s tf=%s failed: %s", sym, tf, type(e).__name__)
                bump(tf, "failed")
        for tf in derived_tfs:
            if not state.get(derived_base):
                bump(tf, "no_base")               # its 15m is not complete: nothing to derive from
                continue
            try:
                # proven AND its base untouched since: nothing to do. A base fetched again in this run
                # is derived again, so the stored bucket stays the resample of the stored base.
                if state[derived_base] == "current" and is_done(tf, sym):
                    bump(tf, "current")
                    continue
                with lock:
                    base_e = led["tfs"][derived_base].get(sym)
                base_from = date.fromisoformat(base_e[1])   # the first day whose 15m this pass refetched
                own_from = first_day(asof, last_ts(sym, tf), reach)
                if own_from is None or own_from < base_from:
                    bump(tf, "behind")            # its tail is on a day whose 15m was not refetched
                    continue
                # the refetched days and no others: nothing after the as-of day is resampled either
                rows = [r for r in derive(sym, tf, onemin.session_start_ts(base_from)) if int(r["t"]) < day_end]
                last = last_bar_of_day(rows, asof)
                if last is None:
                    bump(tf, "empty")
                    continue
                gap = later_trade(tf, last, records)
                if gap is not None:
                    refuse_short(sym, tf, last, gap)
                    continue
                # the base's own check instant when it was fetched in this run: a newer check's seal wins
                n = int(store(sym, tf, rows, checked_base if checked_base is not None else time.time()) or 0)
                if not n:
                    bump(tf, "failed")
                    continue
                mark(tf, sym, base_from)
                bump(tf, "done")
                bump(tf, "rows", n)
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
                      "gap_end", "cannot_run", "later_trade", "last_bar_of_day", "first_day", "load_ledger",
                      "save_ledger", "status"]
