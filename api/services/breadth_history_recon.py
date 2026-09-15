"""Historical breadth reconstruction — recompute past breadth values from stored bars.

The breadth collector only began storing daily snapshots on 2026-01-02, but our daily
stock bars go back decades. This module recomputes a past day's CLOSE-basis breadth from
those bars through the EXACT live METHOD (`breadth_live._metrics_at_close` = build levels
from prior sessions, fold in the day's close, `compute_metrics`), so we can (Phase 0)
VALIDATE it against days we actually collected, then (Phase 1+) backfill years of
close-basis history.

🔴 IT REPRODUCES THE METHOD. IT CANNOT REPRODUCE THE COLLECTOR'S ANSWER, and this
docstring asserted the opposite ("a deterministic recomputation … via the EXACT live
method") for the life of the file. The recompute is deterministic; it is not the same
measurement, because it is not taken over the same POPULATION.

MEASURED 2026-08-30, per name, over all 114 usable collector frames (2026-03-16..08-28),
diffing the recompute against the collector's own cached frame on that frame's own
point-in-time universe:

    disagreeing names, by kind          count      net effect on adv−dec
    --------------------------------    ------     ---------------------
    priced by the collector, absent      32,202     the whole gap
      from bars.db that session
    priced by bars.db, absent from          325     small
      the collector's frame
    ex-dividend sign flip                     5     ~nil (2,190 ex-div
                                                    names were comparable)
    exactly-flat boundary                   120     ~nil
    genuine value disagreement              801     concentrated on ONE
                                                    session (2026-03-18)

Subtract the two coverage terms and the recompute lands on the collector's number
EXACTLY on 64 of 114 sessions (median residual 0, p90 2). The dividend-adjustment
hypothesis is FALSIFIED as a material cause: five sign flips in 114 sessions.

⛔ SO THE ERROR IS NOT NOISE AND DOES NOT SHRINK WITH CARE — it is a scale factor.
bars.db priced 0.3%–22% fewer names than the collector's universe on a normal session,
and the names it is missing are distributed like the day, not like a coin. So a
count metric comes back as `collector_value × coverage`: on 61 sessions with ≥99%
bars coverage the median |diff| on `adv_decline` is still 6, it is never 0, and it
points TOWARD ZERO relative to the day's own net on 43 of those 61. A recompute of a
strong day will always understate it. Treat every count this module produces as
"the collector's count, scaled by that session's bars coverage"; the `pct_above_*`
family is coverage-invariant by construction and is the part that survives.

Phase 0 only: recompute + validation. No writes to any chart store yet.

⭐ ONE EXCEPTION, and it earns it: `apply_adv_dec_counts` (bottom of this file)
DOES write — the two advance/decline COUNTS the collector computed and threw
away — but only onto rows that are missing them, only those two keys, and only
where the pair reproduces the `adv_decline` the collector already stored,
exactly. Phase 0's discipline is what makes that safe: the validation is not a
campaign that ran once, it is a per-row precondition of every write, so no
source can put a plausible-but-wrong number into a table people read. See the
long header above that function for the measurement that decides which source
is allowed to write.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Optional


def _f(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


_DEEP_RESULTS: dict = {}   # date -> result (validation / proof runs, in-memory)


def run_deep_async(date: str, limit: int = 0) -> None:
    """Background: recompute one past date's breadth from the deep pipeline and stash the
    result. Deep fetches (uncached history from Massive) are slow, so this can't run inline."""
    import time as _t
    from api.services import breadth_live as bl
    _DEEP_RESULTS[date] = {"status": "running", "started": True}
    try:
        tickers, _ = bl.universe()
        if limit:
            tickers = tickers[:limit]
        t0 = _t.perf_counter()
        out = recompute_close_deep(date, tickers)
        out["elapsed_s"] = round(_t.perf_counter() - t0, 1)
        out["tickers_used"] = len(tickers)
        out["status"] = "done"
        _DEEP_RESULTS[date] = out
    except Exception as e:
        _DEEP_RESULTS[date] = {"status": "error", "reason": f"{type(e).__name__}: {e}"}


import glob as _glob
import json as _json
import os as _os
import time as _time
from concurrent.futures import ThreadPoolExecutor as _Pool
from datetime import datetime as _dt, timezone as _tz

_DEEP_DIR = _os.path.join(_os.environ.get("DATA_DIR", "/data"), "bars_cache_deep")
_CACHE_DIR = _os.path.join(_os.environ.get("DATA_DIR", "/data"), "bars_cache")


def _norm_date(t) -> Optional[str]:
    """A bar's `t` (unix ms/s, or 'YYYY-MM-DD') -> 'YYYY-MM-DD'."""
    if isinstance(t, str):
        return t[:10] if len(t) >= 10 else None
    try:
        tv = int(t)
        if tv > 1_000_000_000_000:   # ms -> s
            tv //= 1000
        if tv > 20_000_000:          # unix seconds
            return _dt.fromtimestamp(tv, tz=_tz.utc).date().isoformat()
    except (TypeError, ValueError):
        return None
    return None


def _lean_deep_daily(ticker: str) -> list:
    """One ticker's DEEP daily bars — LEAN: read the deep disk cache we already warmed
    (free, no chart machinery), fall back to a single direct Massive daily-agg call. Skips
    _get_bars_inner entirely (its per-request overhead made bulk use crawl). Returns
    [{t,o,h,l,c,v}] or []."""
    tk = ticker.upper()
    for d in (_DEEP_DIR, _CACHE_DIR):
        try:
            for p in sorted(_glob.glob(_os.path.join(d, f"{tk}_D_*.json")), reverse=True):
                with open(p) as f:
                    data = _json.load(f)
                bars = data.get("bars")
                if bars and len(bars) > 250:      # deep enough to bother
                    return bars
        except Exception:
            continue
    try:
        from api.services import massive
        return massive.get_agg_bars(tk, "1995-01-01", "2027-01-01") or []
    except Exception:
        return []


def load_deep_frame(tickers: list[str], since: Optional[str] = None, workers: int = 3) -> dict:
    """Aligned frame {dates, date_pos, closes[n×D], vols[n×D]}. MEMORY-CRITICAL: instead of
    accumulating a dict-of-all-tickers-bars (a ~280MB spike that crash-restarted the web pod),
    preallocate the numpy arrays against a FIXED session index (SPY's trading days) and STREAM
    each ticker straight into its row. Peak memory = just the two arrays (~20MB) + one ticker's
    bars transiently. `since` bounds the range. Workers write DISJOINT rows (thread-safe)."""
    import numpy as np
    import time as _time
    # Trading-session index from a complete reference (SPY has deep, gap-free daily history).
    ref = _lean_deep_daily("SPY")
    idx_dates = sorted({d for d in (_norm_date(b.get("t")) for b in (ref or []))
                        if d and (since is None or d >= since)})
    if not idx_dates:
        return {"dates": [], "date_pos": {}, "closes": np.zeros((0, 0)),
                "vols": np.zeros((0, 0)), "names": 0}
    date_pos = {d: i for i, d in enumerate(idx_dates)}
    n, D = len(tickers), len(idx_dates)
    closes = np.full((n, D), np.nan)
    vols = np.full((n, D), np.nan)

    def _one(pair):
        ti, t = pair
        for b in (_lean_deep_daily(t) or []):
            ds = _norm_date(b.get("t"))
            j = date_pos.get(ds) if ds else None
            if j is None:
                continue
            cf = _f(b.get("c"))
            if cf is not None and cf > 0:
                closes[ti, j] = cf                 # disjoint row per ticker -> no data race
                vf = _f(b.get("v"))
                if vf is not None:
                    vols[ti, j] = vf
        _time.sleep(0.004)   # yield GIL so the web event loop stays responsive (health checks)
        return ti

    with _Pool(max_workers=workers) as ex:
        list(ex.map(_one, list(enumerate(tickers))))
    names = int(np.count_nonzero(~np.all(np.isnan(closes), axis=1)))
    return {"dates": idx_dates, "date_pos": date_pos, "closes": closes, "vols": vols, "names": names}


def recompute_from_frame(frame: dict, tickers: list[str], target_date: str,
                         window: int = 320, members: Optional[set] = None) -> dict:
    """PURE recompute for one date by SLICING the pre-loaded numpy frame — no fetching, no
    per-date allocation of the whole universe. Levels from the window's sessions strictly
    before target; target's close folded in as the price (mirrors _metrics_at_close).

    ⭐ `members` IS THE UNIVERSE, AND IT IS APPLIED TO `prices` ALONE. When given, only
    those tickers get a price, and `compute_metrics`' `have = ~isnan(px)` mask does the
    rest — every metric, from the MA family to the counts to the highs and lows, is
    computed over exactly that set. The LEVELS are still built from the whole matrix,
    which is correct and not wasteful: a 50-day average of a member is the same number
    whoever else is in the frame, and rebuilding the matrix per universe would triple
    the work to get identical columns.

    ⚠️ `None` means "every priced ticker", which is the pre-universe behaviour the UCT
    path still uses."""
    import numpy as np
    from api.services import breadth_live as bl
    dp = frame["date_pos"]
    tj = dp.get(target_date)
    if tj is None:
        return {"ok": False, "reason": f"no bar on {target_date} (holiday / no data)"}
    lo = max(0, tj - int(window) + 1)
    cols = slice(lo, tj + 1)
    win = tj - lo + 1
    if win < 221:
        return {"ok": False, "reason": f"only {win} sessions <=target (need 221)"}
    closes = frame["closes"][:, cols]
    vols = frame["vols"][:, cols]
    # Levels from sessions STRICTLY BEFORE target (drop the last column = target day).
    levels = bl.build_levels(tickers, closes[:, :-1], vols[:, :-1], 0)
    last_c = closes[:, -1]
    last_v = vols[:, -1]
    prices = {tickers[i]: float(last_c[i]) for i in range(len(tickers))
              if not np.isnan(last_c[i]) and last_c[i] > 0
              and (members is None or tickers[i] in members)}
    dvols = {tickers[i]: float(last_v[i]) for i in range(len(tickers))
             if not np.isnan(last_v[i]) and last_v[i] > 0
             and (members is None or tickers[i] in members)}
    if not prices:
        return {"ok": False, "reason": "no prices on target"}
    metrics = bl.compute_metrics(levels, prices, dvols)
    return {"ok": True, "date": target_date, "universe": len(tickers),
            "priced": len(prices), "measured": int(metrics.get("universe_count", 0)),
            "metrics": {k: v for k, v in metrics.items() if not k.startswith("_")}}


def recompute_close_deep(target_date: str, tickers: Optional[list[str]] = None,
                         window: int = 320) -> dict:
    """One-date convenience: LEAN-load the deep frame (parallel) then recompute. For many
    dates, call load_deep_frame once + recompute_from_frame per date instead."""
    from api.services import breadth_live as bl
    if tickers is None:
        tickers, _ = bl.universe()
    if not tickers:
        return {"ok": False, "reason": "no universe"}
    from datetime import date as _date, timedelta as _td
    since = (_date.fromisoformat(target_date) - _td(days=560)).isoformat()
    frame = load_deep_frame(tickers, since=since)
    out = recompute_from_frame(frame, tickers, target_date, window)
    out["frame_names"] = frame.get("names")
    return out


# Metrics this sweep must NEVER write into `breadth_daily_ohlc`, whatever
# `compute_metrics` hands back.
#
# `new_ath` is an ALL-TIME-high count. This sweep only ever holds `window`
# sessions (320 by default), so anything it computed under that name would be a
# ~15-month high FILED AS an all-time high — and `write_bulk` is a write to
# stored history, so every row it touched would carry the wrong definition
# permanently, mixed in beside rows that carry the real one.
#
# Today `compute_metrics` publishes `new_ath: None` and the `fv is None` skip
# below already drops it. That is INCIDENTAL: give the key a number again and
# the sweep starts writing it silently. This set is the standing refusal.
# Rail: tests/test_breadth_recon_never_writes_new_ath.py
_NEVER_SWEEP_STORE = frozenset({"new_ath"})


def _applies(metric: str, universe: str) -> bool:
    """May `universe` store `metric`? UCT: always (it is where they are measured).
    A PIT universe: only what `breadth_metrics` marks portable.

    ⚠️ Fails OPEN for UCT and CLOSED for a PIT universe, which is the safe direction
    for each: UCT must never lose a metric it has always written, and a new universe
    must never gain one nobody decided it should have."""
    from api.services import breadth_universes as _bu
    if _bu.normalize(universe) == _bu.DEFAULT_UNIVERSE:
        return True
    from api.services import breadth_metrics as _bm
    return _bm.applies_to(metric, universe)

def _seed_carry_in(prev: dict, full: dict, uni: str) -> None:
    """Carry a warm-up row's values into `prev` — the close-to-close OPEN of the next
    stored bar.

    ⭐ A NAMED FUNCTION RATHER THAN FOUR INLINE LINES, so the behaviour can be DISABLED
    in a bite-check. A rail for an invariant nothing can break is not a rail, and this
    is the invariant BL-021's second half restored: the first stored bar of an
    invocation must open at the previous session's close, not at its own.
    """
    for metric, val in full.items():
        if metric == "date" or metric in _NEVER_SWEEP_STORE:
            continue
        if not _applies(metric, uni):
            continue
        fv = _f(val)
        if fv is not None:
            prev[metric] = fv


_SWEEP_STATE: dict = {"status": "idle"}


def sweep_history(from_date: str, to_date: Optional[str] = None,
                  tickers: Optional[list[str]] = None, window: int = 320,
                  batch: int = 4000, universe: Optional[str] = None,
                  warmup_days: int = 560) -> dict:
    """Backfill close-basis breadth history for [from_date, to_date]: load the deep frame
    ONCE, recompute every session, write close-to-close BODIES to breadth_daily_ohlc
    (source 'close_recon'). Bounded memory (numpy frame) + batched writes. This is the
    workhorse — heavy, so run it in a background thread (run_sweep_async).

    ⭐⭐ `universe` IS THE ONLY THING THAT CHANGES BETWEEN UNIVERSES. Pass `us`,
    `nasdaq` or `nyse` and the frame comes from `breadth_pit_frame` — the
    survivorship-free grouped-daily matrix with a per-date member set — instead of
    today's UCT ticker list. Everything after that line is IDENTICAL: the same
    `recompute_from_frame`, the same `bl.compute_metrics`, the same
    `derive_live_row`, the same close-to-close body construction, the same store.
    There is no `sweep_us`, and there must never be one: four algorithms that are
    supposed to agree are four chances to disagree.

    ⛔ THE PER-DATE MEMBER SET IS APPLIED THROUGH `prices`, NOT THROUGH A SECOND
    METRIC PATH. `compute_metrics` masks on `have = ~isnan(px)` and `px` is filled
    only from the `prices` dict, so handing it one date's eligible members
    restricts every metric it computes to that universe without the metric engine
    learning that universes exist.

    ⚠️ Omitting `universe` keeps the EXACT pre-universe behaviour — today's UCT
    list, written to `universe='uct'`. Existing callers are untouched.

    ⚠️ `warmup_days` IS THE PRE-ROLL, AND IT IS COMPUTATIONAL CONTEXT ONLY — never
    output. 560 days (~1.6 yr) is the production default because the 200-day average
    and the 52-week extreme need it. It is a PARAMETER rather than a constant for one
    honest reason: a bounded control run whose frame cache starts later than
    `from_date − 560d` would otherwise trip `_sessions`' consecutive-empty-day guard
    and return "no sessions in range", which reads like a bug in the sweep rather
    than a gap in the cache. Lowering it is only safe while the remaining window
    still clears the metric's own lookback (221 sessions is `recompute_from_frame`'s
    floor); the frame builder does not check that for you.
    """
    from datetime import date as _date, timedelta as _td
    from api.services import breadth_live as bl
    from api.services import breadth_daily_ohlc, breadth_monitor
    from api.services import breadth_universes as bu

    uni = bu.normalize(universe)
    pit_frame = None
    if bu.is_pit(uni):
        if tickers is not None:
            return {"ok": False, "reason": f"{uni} builds its own universe per date; "
                                           "an explicit ticker list is not accepted"}
        bu.sweepable_range(uni, from_date, to_date)
        from api.services import breadth_pit_frame as bpf
        to_date = to_date or from_date
        pit_frame = bpf.build_frame(uni, from_date, to_date, warmup_days=warmup_days)
        if not pit_frame.get("ok"):
            # ⚠️ CARRY THE DATE LIST, NOT JUST THE SENTENCE. `build_frame` names the
            # sessions whose RAW frame is missing; dropping that leaves the caller —
            # the forward seal, the health surface — with prose to parse. The reason
            # is for a human, `missing_raw` is for the machine.
            return {"ok": False, "reason": pit_frame.get("reason", "pit frame failed"),
                    "missing_raw": pit_frame.get("missing_raw")}
        frame, tickers = pit_frame, pit_frame["tickers"]
    else:
        if tickers is None:
            tickers, _ = bl.universe()
        if not tickers:
            return {"ok": False, "reason": "no universe"}
        since = (_date.fromisoformat(from_date) - _td(days=560)).isoformat()  # ~1.6yr warmup for 200MA/52w
        frame = load_deep_frame(tickers, since=since)
    dates = frame["dates"]
    to_date = to_date or (dates[-1] if dates else from_date)
    # Start the derived-metric buffer `WARM_SESSIONS` before from_date so the rolling
    # ratios aren't cold at the range start (ratio_10day needs 9 predecessors).
    #
    # ⛔ THE LENGTH IS `breadth_pit_frame.WARM_SESSIONS`, NOT A 15 TYPED HERE. The frame
    # builds membership for exactly that many sessions before `from_date`; if the two
    # numbers ever disagreed, the extra sessions would have no member set and BL-021
    # would come back for precisely those rows.
    from api.services import breadth_pit_frame as _bpf_const
    _warm_n = _bpf_const.WARM_SESSIONS
    warm_start = next((d for d in dates if d >= from_date), from_date)
    warm_idx = max(0, dates.index(warm_start) - _warm_n) if warm_start in dates else 0
    sweep = [d for d in dates[warm_idx:] if d <= to_date]
    prev: dict = {}
    recent: list = []          # full derived rows, NEWEST-FIRST (derive_live_row wants that)
    rows: list = []
    computed = written = 0
    # ⭐⭐ THE WARM-UP ROWS CARRY THE SAME MEMBER SET AS AN OUTPUT DATE — BL-021.
    #
    # ⚰️ THIS COMMENT USED TO SAY THE OPPOSITE, and said it confidently: "the warm-up
    # rows are never stored, and building eligibility for 560 extra sessions would
    # double the frame's cost to refine numbers nobody reads." Two of those three
    # clauses were true. The third was not: `ratio_5day` and `ratio_10day` ARE stored,
    # they ARE in V1, and they are SUMS over exactly those warm rows — so a warm row
    # measured over every priced ticker (7,835 names, against the universe's 3,073) put
    # whole-market counts into a US series. Measured error up to 29 % on R5's first 4
    # output sessions and 24 % on R10's first 9, at EVERY chunk boundary, and on every
    # forward-seal tick.
    #
    # ⛔ AND IT WAS NEVER 560 SESSIONS. The 560-day span is the frame's per-ticker
    # warm-up (averages, 52-week extremes) and needs no membership at all; the rolling
    # metrics need `WARM_SESSIONS` — fifteen. `build_frame` now resolves those fifteen,
    # which is ~2 % more raw fetches over a full grind.
    members_of = (pit_frame or {}).get("eligible") or {}
    for ds in sweep:
        r = recompute_from_frame(frame, tickers, ds, window,
                                 members=members_of.get(ds))
        if not r.get("ok"):
            continue
        base = dict(r["metrics"])
        base["date"] = ds
        try:
            full = breadth_monitor.derive_live_row(base, recent)   # + breadth_score, ratios, hi/lo, A/D cum
        except Exception:
            full = base
        recent.insert(0, full)
        if len(recent) > 30:
            recent.pop()
        if ds < from_date:
            # ⭐ WARM-UP: seeds the buffer AND the close-to-close carry-in, but stores
            # nothing. `prev` is what the next stored bar opens at, so seeding it here
            # is the whole of BL-021's second half: without it the first stored bar of
            # every invocation took `o = c` and rendered a doji, and "the first date of
            # this function call" was silently standing in for "the first date of the
            # series".
            #
            # ⚠️ A GENUINELY FIRST DATE STILL OPENS AT ITS OWN CLOSE, and that is
            # correct rather than a fallback: when no earlier session exists there is no
            # prior close for it to open at. The difference is that it is now decided by
            # the DATA — whether a warm session exists — not by where the loop began.
            _seed_carry_in(prev, full, uni)
            continue
        for metric, val in full.items():
            if metric == "date" or metric in _NEVER_SWEEP_STORE:
                continue
            # ⛔⛔ APPLICABILITY DECIDES WHAT A PIT UNIVERSE MAY STORE, and a control
            # sweep is what proved this was missing. `derive_live_row` computes the
            # WHOLE row — including `breadth_score`, a composite that consumes AAII,
            # put/call and VIX — so a US sweep wrote a US `breadth_score` built from
            # UCT's formula over a row whose sentiment inputs are absent. A number
            # that looks plausible and means something else is precisely the failure
            # the catalogue's `portability` column exists to prevent.
            #
            # ⚠️ UCT IS UNTOUCHED: it applies to every metric by definition, so this
            # branch cannot change a single value the shipped path writes.
            if not _applies(metric, uni):
                continue
            fv = _f(val)
            if fv is None:
                continue
            o = prev.get(metric, fv)                       # close-to-close body
            rows.append((ds, metric, round(o, 4), round(max(o, fv), 4),
                         round(min(o, fv), 4), round(fv, 4)))
            prev[metric] = fv
        computed += 1
        _SWEEP_STATE.update(progress=f"{ds} ({computed} written)")
        import time as _time
        _time.sleep(0.02)     # yield between recomputes so the web pod stays healthy
        if len(rows) >= batch:
            written += breadth_daily_ohlc.write_bulk(rows, source="close_recon", universe=uni)
            rows = []
    if rows:
        written += breadth_daily_ohlc.write_bulk(rows, source="close_recon", universe=uni)
    coverage = {d: c for d, c in ((pit_frame or {}).get("coverage") or {}).items()}
    return {"ok": True, "universe": uni,
            "from": from_date, "to": to_date, "sessions": computed, "rows": written,
            "coverage": coverage,
            "frame_names": frame.get("names"),
            "first_date": sweep[0] if sweep else None, "last_date": sweep[-1] if sweep else None}


def _floor_marker_path() -> str:
    return _os.path.join(_os.environ.get("DATA_DIR", "/data"), "breadth_history_floor.txt")


def set_backfill_floor(floor: Optional[str]) -> None:
    """Persist (or clear) the target floor. While a valid floor is set, the scheduled tick
    keeps sweeping the next chunk below current coverage until it reaches this date. Durable
    across restarts — that's what makes the backfill resilient."""
    p = _floor_marker_path()
    try:
        if floor:
            with open(p, "w") as f:
                f.write(floor.strip())
        elif _os.path.exists(p):
            _os.remove(p)
    except Exception:
        pass


def get_backfill_floor() -> Optional[str]:
    try:
        with open(_floor_marker_path()) as f:
            v = f.read().strip()
        return v or None
    except Exception:
        return None


_TICK_LOCK = __import__("threading").Lock()


def _resolve_universe():
    """(tickers, date) to reconstruct over. Prefers breadth_live.universe() — the
    collector's stored universe_list, i.e. the SAME population the live + 2024-now
    rows used, so pre-2024 history joins them with no seam discontinuity.

    On the WORKER pod that snapshot lives on the WEB volume and is empty here, so
    fall back to fetching the web's /universe endpoint — keeping ONE population
    rather than diverging to cap_universe.json (a ~40% larger set = a visible seam).
    Returns ([], None) if neither source yields a universe (caller sweeps nothing)."""
    from api.services import breadth_live as bl
    tickers, d = bl.universe()
    if tickers:
        return tickers, d
    import os as _os, json as _json, urllib.request as _u
    base = _os.environ.get("DASHBOARD_URL") or "https://uctintelligence.com"
    try:
        req = _u.Request(base.rstrip("/") + "/api/breadth-monitor/universe",
                         headers={"User-Agent": "Mozilla/5.0"})   # browser UA: Cloudflare 1010-blocks bare UAs
        with _u.urlopen(req, timeout=30) as r:
            data = _json.loads(r.read().decode())
        t = sorted({str(x).upper() for x in (data.get("tickers") or []) if x})
        return t, data.get("date")
    except Exception:
        return [], None


def backfill_tick(chunk_days: int = 548, limit: int = 0) -> dict:
    """ONE restart-safe step: if a floor is set and coverage hasn't reached it, sweep the
    next chunk just BELOW the current coverage floor. Idempotent + resumable — reads where it
    is from the store each time, so a pod restart simply picks up on the next tick. Serialized
    so overlapping scheduler ticks can't double-run."""
    floor = get_backfill_floor()
    if not floor:
        return {"ok": True, "idle": True}
    if not _TICK_LOCK.acquire(blocking=False):
        return {"ok": True, "busy": True}
    try:
        from datetime import date as _date, timedelta as _td
        from api.services import breadth_daily_ohlc, breadth_live as bl
        cur_first = (breadth_daily_ohlc.stats() or {}).get("first") or "2024-01-01"
        if cur_first <= floor:
            set_backfill_floor(None)   # reached the floor — stop the scheduler
            return {"ok": True, "complete": True, "floor": floor, "coverage_first": cur_first}
        hi = _date.fromisoformat(cur_first) - _td(days=1)
        lo = max(_date.fromisoformat(floor), hi - _td(days=chunk_days - 1))
        tickers, _ = _resolve_universe()   # worker has no collector snapshot → fetch web's universe
        if limit:
            tickers = tickers[:limit]
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(status="running", mode="tick", floor=floor,
                            current_chunk=f"{lo.isoformat()}..{hi.isoformat()}")
        res = sweep_history(lo.isoformat(), hi.isoformat(), tickers)
        res.update(mode="tick", floor=floor, coverage_was=cur_first, status="done")
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(res)
        return res
    except Exception as e:
        import traceback
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(status="error", mode="tick", reason=f"{type(e).__name__}: {e}",
                            trace=traceback.format_exc()[-500:])
        return {"ok": False, "reason": str(e)}
    finally:
        _TICK_LOCK.release()


def run_backfill_chain(floor: str, ceiling: str = "2023-12-31", chunk_days: int = 730,
                       limit: int = 0) -> None:
    """SELF-CHAINING backfill, all server-side: sweep 2-year chunks from `ceiling` back to
    `floor`, one after another, in ONE background thread. Trigger it ONCE and it runs
    unattended — no repeated client commands (each of which would hit a permission prompt
    and stall overnight). Memory-bounded: each chunk loads + frees its own frame."""
    from datetime import date as _date, timedelta as _td
    from api.services import breadth_live as bl
    _SWEEP_STATE.clear()
    _SWEEP_STATE.update(status="running", mode="chain", floor=floor, ceiling=ceiling, chunks_done=0)
    try:
        tickers, _ = bl.universe()
        if limit:
            tickers = tickers[:limit]
        flr = _date.fromisoformat(floor)
        hi = _date.fromisoformat(ceiling)
        results = []
        while hi >= flr:
            lo = max(flr, hi - _td(days=chunk_days - 1))
            _SWEEP_STATE.update(current_chunk=f"{lo.isoformat()}..{hi.isoformat()}",
                                chunks_done=len(results))
            try:
                res = sweep_history(lo.isoformat(), hi.isoformat(), tickers)
                results.append({"from": lo.isoformat(), "to": hi.isoformat(),
                                "rows": res.get("rows"), "sessions": res.get("sessions"),
                                "names": res.get("frame_names")})
            except Exception as ce:
                results.append({"from": lo.isoformat(), "to": hi.isoformat(),
                                "error": f"{type(ce).__name__}: {ce}"})
            hi = lo - _td(days=1)
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(status="done", mode="chain", floor=floor, chunks=results,
                            total_rows=sum((c.get("rows") or 0) for c in results))
    except Exception as e:
        import traceback
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(status="error", mode="chain", reason=f"{type(e).__name__}: {e}",
                            trace=traceback.format_exc()[-600:])


def run_sweep_async(from_date: str, to_date: Optional[str] = None, limit: int = 0) -> None:
    """Background wrapper: recompute-and-store the close-basis history for a range."""
    import time as _t
    from api.services import breadth_live as bl
    _SWEEP_STATE.clear()
    _SWEEP_STATE.update(status="running", **{"from": from_date, "to": to_date})
    try:
        tickers, _ = bl.universe()
        if limit:
            tickers = tickers[:limit]
        t0 = _t.perf_counter()
        res = sweep_history(from_date, to_date, tickers)
        res["elapsed_s"] = round(_t.perf_counter() - t0, 1)
        res["status"] = "done"
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(res)
    except Exception as e:
        import traceback
        _SWEEP_STATE.clear()
        _SWEEP_STATE.update(status="error", reason=f"{type(e).__name__}: {e}",
                            trace=traceback.format_exc()[-600:])


def recompute_close(target_ts: int, tickers: Optional[list[str]] = None) -> dict:
    """All price-derived breadth metrics at a past session's CLOSE (the live method applied
    to a completed day). Returns {} if the day can't be built (not enough prior sessions /
    no bars). `tickers` defaults to the current universe."""
    from api.services import breadth_live as bl
    conn = bl._bars_conn()
    if tickers is None:
        tickers, _ = bl.universe()
    if not tickers:
        return {}
    try:
        out = bl._metrics_at_close(conn, tickers, int(target_ts))
    except Exception:
        return {}
    return out or {}


def recompute_close_with_members(target_ts: int, tickers: Optional[list[str]] = None):
    """Like recompute_close but also returns the per-metric member ticker lists + the set
    of names that had a price today — so we can diff against the collector's stored drill
    lists and classify WHY a name differs. Returns (metrics, members, priced_set, universe_set)."""
    from datetime import date as _date, timedelta as _td
    from api.services import breadth_live as bl
    import numpy as _np
    conn = bl._bars_conn()
    if tickers is None:
        tickers, _ = bl.universe()
    if not tickers:
        raise ValueError("no universe (bl.universe returned empty)")
    row = conn.execute(
        "SELECT MAX(ts) FROM ohlcv WHERE tf='D' AND ticker='SPY' AND ts < ?", (int(target_ts),)
    ).fetchone()
    prior = int(row[0]) if row and row[0] else None
    if not prior:
        raise ValueError(f"no prior SPY session before ts={target_ts}")
    start = bl._ts_int(_date.fromisoformat(bl._iso(prior)) - _td(days=bl._LOAD_CALENDAR_DAYS))
    dates = bl._session_dates(conn, prior, start)
    if len(dates) < 221:
        raise ValueError(f"only {len(dates)} sessions (need 221) prior={prior} start={start}")
    closes, volumes = bl._load_frame(conn, tickers, dates)
    try:
        closes = bl._apply_dividend_basis(tickers, dates, closes, int(target_ts))
    except Exception:
        pass
    levels = bl.build_levels(tickers, closes, volumes, prior)
    index_levels = bl.build_index_levels(bl._load_index_series(conn, prior, start))
    del closes, volumes
    day_c, day_v = bl._load_frame(conn, tickers, [int(target_ts)])
    prices = {t: float(day_c[i, 0]) for i, t in enumerate(tickers)
              if not _np.isnan(day_c[i, 0]) and day_c[i, 0] > 0}
    vols = {t: float(day_v[i, 0]) for i, t in enumerate(tickers)
            if not _np.isnan(day_v[i, 0]) and day_v[i, 0] > 0}
    if not prices:
        raise ValueError(f"no prices for day ts={target_ts} (universe={len(tickers)})")
    members: dict = {}
    out = bl.compute_metrics(levels, prices, vols, members=members)
    out.update(bl.compute_index_metrics(index_levels, {}))
    return out, members, set(prices.keys()), set(tickers)


def _tickers_of(lst) -> set:
    out = set()
    for it in (lst or []):
        if isinstance(it, str):
            out.add(it.upper())
        elif isinstance(it, dict):
            t = it.get("t") or it.get("ticker") or it.get("sym")
            if t:
                out.add(str(t).upper())
    return out


def diff_members(date: str, metric: str) -> dict:
    """For one day + one drillable metric, diff the recomputed member set against the
    collector's stored drill list, and CLASSIFY why each mismatch happens: name absent from
    our universe, no price in our bars that day, or a genuine threshold flip. This tells us
    whether the count drift is a fixable data gap or inherent threshold sensitivity."""
    from api.services import breadth_live as bl
    from api.services import breadth_monitor
    conn = bl._bars_conn()
    # resolve the SPY session ts for `date`
    ts = None
    for r in conn.execute("SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' ORDER BY ts DESC LIMIT 400").fetchall():
        if bl._iso(int(r[0])) == date:
            ts = int(r[0]); break
    if ts is None:
        return {"ok": False, "reason": f"no SPY session for {date}"}

    try:
        metrics, members, priced, uni = recompute_close_with_members(ts)
    except Exception as e:
        import traceback
        return {"ok": False, "reason": f"recompute raised: {type(e).__name__}: {e}",
                "trace": traceback.format_exc()[-800:], "ts": ts}
    if not members:
        return {"ok": False, "reason": "recompute produced no members",
                "ts": ts, "universe": len(uni), "priced": len(priced),
                "metric_keys": sorted(list(metrics.keys()))[:6]}
    recompute_set = _tickers_of(members.get(metric))

    stored_row = None
    for r in breadth_monitor.get_history(400):
        if r.get("date") == date:
            stored_row = r; break
    collector_set = _tickers_of((stored_row or {}).get(f"{metric}_list"))

    only_recompute = recompute_set - collector_set
    only_collector = collector_set - recompute_set

    # classify the collector-only names (present for the collector, missing for us)
    cls = {"not_in_universe": 0, "no_price_today": 0, "threshold_or_history": 0}
    sample_not_in_uni, sample_no_price = [], []
    for t in only_collector:
        if t not in uni:
            cls["not_in_universe"] += 1
            if len(sample_not_in_uni) < 15:
                sample_not_in_uni.append(t)
        elif t not in priced:
            cls["no_price_today"] += 1
            if len(sample_no_price) < 15:
                sample_no_price.append(t)
        else:
            cls["threshold_or_history"] += 1

    return {
        "ok": True, "date": date, "metric": metric,
        "recompute_count": len(recompute_set), "collector_count": len(collector_set),
        "overlap": len(recompute_set & collector_set),
        "only_recompute": len(only_recompute), "only_collector": len(only_collector),
        "collector_only_classified": cls,
        "sample_not_in_universe": sorted(sample_not_in_uni),
        "sample_no_price_today": sorted(sample_no_price),
        "universe_size": len(uni), "priced_today": len(priced),
    }


def validate_recent(days: int = 10) -> dict:
    """Recompute the last `days` COLLECTED sessions and diff each metric against the value
    the collector stored (breadth_monitor). Small diffs => the recompute faithfully
    reproduces the collector and the backfill can be trusted. Read-only."""
    from api.services import breadth_live as bl
    from api.services import breadth_monitor
    conn = bl._bars_conn()
    tickers, uni_date = bl.universe()
    if not tickers:
        return {"ok": False, "reason": "no universe"}

    # recent SPY sessions -> {date: ts}
    rows = conn.execute(
        "SELECT ts FROM ohlcv WHERE tf='D' AND ticker='SPY' ORDER BY ts DESC LIMIT ?",
        (int(days) + 3,),
    ).fetchall()
    date_ts = {bl._iso(int(r[0])): int(r[0]) for r in rows}

    stored = {}
    try:
        for r in breadth_monitor.get_history(int(days) + 6):
            if r.get("date"):
                stored[r["date"]] = r
    except Exception:
        stored = {}

    diffs = defaultdict(lambda: {"sum": 0.0, "max": 0.0, "n": 0})
    per_day = []
    for date in sorted(date_ts)[-int(days):]:
        s = stored.get(date)
        if not s:
            continue
        rc = recompute_close(date_ts[date], tickers)
        if not rc:
            continue
        worst = ("", 0.0)
        for k, v in rc.items():
            if k.startswith("_"):
                continue
            rv, sv = _f(v), _f(s.get(k))
            if rv is None or sv is None:
                continue
            d = abs(rv - sv)
            e = diffs[k]
            e["sum"] += d
            e["max"] = max(e["max"], d)
            e["n"] += 1
            if d > worst[1]:
                worst = (k, d)
        per_day.append({"date": date, "worst_metric": worst[0], "worst_diff": round(worst[1], 3)})

    summary = {k: {"mean": round(v["sum"] / v["n"], 3), "max": round(v["max"], 3), "n": v["n"]}
               for k, v in diffs.items() if v["n"]}
    # headline: the largest mean diff across metrics (should be tiny if the engine is faithful)
    worst_metric = max(summary.items(), key=lambda kv: kv[1]["mean"], default=(None, {"mean": 0}))
    return {
        "ok": True,
        "universe": len(tickers),
        "universe_date": uni_date,
        "days_checked": len(per_day),
        "worst_mean_diff": {"metric": worst_metric[0], **({"mean": worst_metric[1]["mean"]} if worst_metric[0] else {})},
        "per_metric": summary,
        "per_day": per_day,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  ADVANCE/DECLINE COUNTS — the historical backfill of `advancing`/`declining`
# ─────────────────────────────────────────────────────────────────────────────
#
# The collector computed `adv` and `dec` and stored only `adv - dec`, so every
# stored row carries `adv_decline` and NEITHER count. The Event Ledger's Zweig
# Breadth Thrust needs `advancing / (advancing + declining)` and therefore
# refuses to evaluate at all ("Advance/decline counts cover 0 of 90 sessions —
# needs 11"). The collector fix (uct-intelligence `0c13eb9`) is forward-only.
#
# ⭐ THE ORACLE. There is no stored `advancing` to check a recomputation
# against — that IS the problem. But `adv_decline` was computed from the SAME
# two counts on the SAME closes over the SAME universe, so
#
#       advancing - declining == adv_decline
#
# is an exact identity that any correct pair must satisfy, and it is
# independent of everything written here. Every write below is gated on it,
# PER ROW. A pair that fails is refused, never rounded into place.
#
# ⛔⛔ MEASURED, AND IT DECIDES WHICH SOURCE MAY WRITE (2026-08-30, 96 collected
# sessions 2026-03-16..2026-08-04, each recomputed over that row's OWN stored
# point-in-time `universe_list`):
#
#   source                                    reproduces adv_decline exactly
#   ------------------------------------      ------------------------------
#   bars.db recompute (this module's recon)     0 / 96      median |diff| 8.5
#     …restricted to sessions where bars.db     0 / 61      median |diff| 6
#       covered >= 99% of the PIT universe
#   the collector's OWN cached price frame     91 / 98      median |diff| 0
#     (uct-intelligence data/massive_cache/
#      breadth_ohlcv_<date>.pkl)
#
# WHY, measured per name rather than guessed (2026-08-30 — see the module
# docstring for the full table): it is COVERAGE, essentially alone. bars.db
# cannot price 0.3-22% of the collector's point-in-time universe on a given
# session, those names are distributed like the day rather than like a coin, and
# a count therefore comes back scaled by the coverage fraction. Add the missing
# names back and the recompute is EXACT on 64 of 114 sessions (median residual
# 0). The basis difference everyone reaches for first — the collector reads
# yfinance `auto_adjust=True` while bars.db is split-only — moves this number by
# almost nothing: 5 ex-dividend sign flips in 114 sessions across 2,190
# comparable ex-dividend names. It matters enormously for the LONG-lookback
# metrics (see `breadth_dividends`); it does not matter for a one-day change.
#
# ⛔ 0/61 at >=99% coverage is the sentence that decides this. The residual
# error is proportional, not additive, so it does not shrink with a better
# bars.db unless coverage reaches 100% — and `adv_decline` is an exact integer
# identity, which has no tolerance to spend. That is why `breadth_live._ACCURACY`
# grades `adv_decline` "tight" (abs 3 / rel 3%) rather than "exact". Tight is
# fine for a live read shown beside a stored number; it is NOT fine for
# MANUFACTURING the two numbers a stored row will be read as having measured —
# a row whose `advancing - declining` disagrees with its own `adv_decline` is a
# row that says two different things about one session.
#
# So `backfill_adv_dec_from_recon` exists, runs the same gate, and — on today's
# data — writes NOTHING. That is the honest outcome, not a bug: run
# `validate_adv_dec_recon` on the pod and read its `verdict`. The source that
# passes the gate is delivered as `scripts/backfill_adv_dec_counts.py`, which
# reads the collector's own frames on the machine the collector runs on and
# POSTs the pairs to `apply_adv_dec_counts` — which re-runs the identity gate
# server-side, so the store's guarantee never depends on the client.

# Mirrors `app/src/pages/breadth/views/breadthEvents.js`. The JS file is the
# authority (it is what refuses on screen); `test_breadth_adv_dec_backfill.py`
# reads the constants back out of it and fails if these drift.
ZWEIG_PERIOD = 10
ZWEIG_MIN_SESSIONS = ZWEIG_PERIOD + 1


def zweig_ad_coverage(rows) -> int:
    """`scanEvents`' coverage arithmetic, in Python.

    The JS builds one ratio per session and counts the non-null ones:

        const a = r?.advancing, d = r?.declining
        if (a == null || d == null || (Number(a) + Number(d)) === 0) return null
        return Number(a) / (Number(a) + Number(d))
        ...
        const adCoverage = ratios.filter(v => v != null).length

    ⛔ Note what it is NOT: it is not a run of CONSECUTIVE sessions. Zweig's
    EMA skips a null session without resetting, so the lens only asks whether
    the loaded window holds `ZWEIG_MIN_SESSIONS` measurable ones.
    """
    n = 0
    for r in (rows or ()):
        if not isinstance(r, dict):
            continue
        a, d = r.get("advancing"), r.get("declining")
        if a is None or d is None:
            continue
        af, df = _f(a), _f(d)
        if af is None or df is None or (af + df) == 0:
            continue
        n += 1
    return n


def adv_dec_status(days: int = 90) -> dict:
    """What the Event Ledger would say about Zweig over the last `days` rows.

    Read-only. `covered` is the number the refusal sentence prints; `zweig_ok`
    is whether the lens evaluates instead of refusing.
    """
    from api.services import breadth_monitor as bm
    rows = bm.get_history(int(days)) or []
    covered = zweig_ad_coverage(rows)
    with_ad = sum(1 for r in rows
                  if isinstance(r, dict) and r.get("adv_decline") is not None)
    return {
        "days_requested": int(days),
        "sessions": len(rows),
        "covered": covered,
        "needs": ZWEIG_MIN_SESSIONS,
        "zweig_ok": covered >= ZWEIG_MIN_SESSIONS,
        "sessions_with_adv_decline": with_ad,
        "backfillable": with_ad - covered,
        "newest": rows[0].get("date") if rows else None,
        "oldest": rows[-1].get("date") if rows else None,
    }


def pit_universe(date: str) -> list:
    """The POINT-IN-TIME universe for a COLLECTED session.

    ⭐ For a date the collector wrote, the point-in-time universe is not
    something to reconstruct — it is stored. `universe_list` is literally the
    names that had a close that day (`closes.iloc[-1].dropna().index` in
    `breadth_collector.py`), recorded on the day, delistings and all. So it
    carries no survivorship bias by construction, and it is strictly better
    than the `breadth_pit_universe` price/liquidity PROXY, which exists for the
    dates BEFORE collection started, where no such list was ever written.

    ⛔ Do NOT substitute `breadth_live.universe()` here. That returns the
    NEWEST snapshot's universe — today's ticker list — which against an April
    session is exactly the survivorship bias this avoids. Measured over the
    validation window the collector's universe moved between 2,637 and 3,759
    names; using one date's list for another is a different population, and a
    different population is a different metric.
    """
    from api.services import breadth_monitor as bm
    return sorted(_tickers_of(bm.get_drill_list(date, "universe_list")))


def _as_pair(value):
    """`(advancing, declining)` from a tuple/list or an {advancing,declining}
    dict — or None when it is neither, or either side is not a whole count."""
    if isinstance(value, dict):
        a, d = value.get("advancing"), value.get("declining")
    elif isinstance(value, (list, tuple)) and len(value) == 2:
        a, d = value
    else:
        return None
    af, df = _f(a), _f(d)
    if af is None or df is None:
        return None
    if af != int(af) or df != int(df) or af < 0 or df < 0:
        return None
    return int(af), int(df)


def _row_metrics(date: str):
    """The raw stored metrics blob for one date, or None. Read straight from
    the table rather than through `get_history`, which strips `_list` keys and
    layers derived fields on top — this gate must see what is STORED."""
    import json as _j
    from api.services import breadth_monitor as bm
    with bm._conn() as c:
        r = c.execute(
            "SELECT metrics FROM breadth_snapshots WHERE date = ?", (date,)
        ).fetchone()
    return _j.loads(r["metrics"]) if r else None


def apply_adv_dec_counts(pairs: dict, dry_run: bool = True,
                         source: str = "unspecified") -> dict:
    """Write `advancing`/`declining` onto stored rows — and NOTHING else.

    THE GATE, per row, all of which must hold before a single byte is written:

      1. a snapshot exists for that date;
      2. it stores an `adv_decline`;
      3. both counts are absent (additive-only — it never overwrites a
         collected value, which is what makes re-running it a no-op);
      4. `advancing - declining == adv_decline` EXACTLY.

    (4) is the whole safety argument. It is the collector's own arithmetic on
    the collector's own session, so a pair that satisfies it cannot be a
    plausible-looking guess: to pass while being wrong, a source would have to
    be wrong by the same amount in advancers and decliners at once.

    ⛔ Only the two keys are written (`breadth_monitor.patch_fields`, one
    transaction). `adv_decline` and every other collected metric are read and
    never assigned — including the derived ones, which `get_history` recomputes
    from the stored row on every read anyway.

    `dry_run=True` (the DEFAULT) evaluates the whole gate and writes nothing,
    so the report is a measurement you can read before committing to it.
    """
    from api.services import breadth_monitor as bm
    report = {
        "ok": True, "dry_run": bool(dry_run), "source": source,
        "considered": len(pairs or {}),
        "written": [], "already_present": [], "partial_present": [],
        "refused_identity": [], "refused_no_row": [],
        "refused_no_adv_decline": [], "refused_malformed": [],
        "write_failed": [],
    }
    report["coverage_before"] = adv_dec_status(90)

    for date in sorted(pairs or {}):
        pair = _as_pair(pairs[date])
        if pair is None:
            report["refused_malformed"].append(date)
            continue
        adv, dec = pair

        try:
            row = _row_metrics(date)
        except Exception as e:
            report["write_failed"].append({"date": date, "reason": f"read: {e}"})
            continue
        if row is None:
            report["refused_no_row"].append(date)
            continue

        stored = _f(row.get("adv_decline"))
        if stored is None:
            report["refused_no_adv_decline"].append(date)
            continue

        have_a = row.get("advancing") is not None
        have_d = row.get("declining") is not None
        if have_a and have_d:
            report["already_present"].append(date)
            continue
        if have_a or have_d:
            # One side alone is not a measurement. Say so rather than healing
            # it silently: it should be impossible, so its existence means
            # something else has written here and that is worth surfacing.
            report["partial_present"].append(date)
            continue

        if (adv - dec) != int(stored):
            report["refused_identity"].append({
                "date": date, "advancing": adv, "declining": dec,
                "net": adv - dec, "stored_adv_decline": int(stored),
                "diff": (adv - dec) - int(stored),
            })
            continue

        if dry_run:
            report["written"].append(date)
            continue
        if bm.patch_fields(date, {"advancing": adv, "declining": dec}):
            report["written"].append(date)
        else:
            report["write_failed"].append(
                {"date": date, "reason": "patch_fields returned False"})

    if dry_run:
        report["coverage_after"] = report["coverage_before"]
    else:
        # `patch_fields` already drops the cached history on every write; this
        # is the belt for the run as a whole. A dry run must NOT clear it —
        # dropping a cache is a side effect, and "writes nothing" includes that.
        try:
            from api.services.cache import cache
            cache.delete_prefix("breadth_history_")
        except Exception:
            pass
        report["coverage_after"] = adv_dec_status(90)

    for k in ("written", "already_present", "partial_present", "refused_identity",
              "refused_no_row", "refused_no_adv_decline", "refused_malformed",
              "write_failed"):
        report["n_" + k] = len(report[k])
    return report


def recompute_adv_dec(date: str, tickers=None) -> dict:
    """Recompute one session's `advancing`/`declining` through the EXISTING
    recon (`recompute_close` -> `breadth_live._metrics_at_close` ->
    `compute_metrics`), over that row's own point-in-time universe.

    Returns `{ok, advancing, declining, net, universe, measured, coverage}` or
    `{ok: False, reason}`. Never writes.
    """
    from datetime import date as _date
    from api.services import breadth_live as bl
    if tickers is None:
        tickers = pit_universe(date)
    if not tickers:
        return {"ok": False, "reason": "no stored universe_list for " + str(date)}
    try:
        ts = bl._ts_int(_date.fromisoformat(date))
    except ValueError:
        return {"ok": False, "reason": "bad date " + repr(date)}
    m = recompute_close(ts, tickers)
    if not m:
        return {"ok": False,
                "reason": "recompute produced nothing (no bars / <221 prior sessions)"}
    adv, dec = _f(m.get("advancing")), _f(m.get("declining"))
    if adv is None or dec is None:
        return {"ok": False, "reason": "recompute produced no advancing/declining"}
    measured = int(_f(m.get("universe_count")) or 0)
    return {"ok": True, "date": date, "advancing": int(adv), "declining": int(dec),
            "net": int(adv) - int(dec), "universe": len(tickers),
            "measured": measured,
            "coverage": round(measured / len(tickers), 4) if tickers else None}


def validate_adv_dec_recon(days: int = 20, limit: int = 0) -> dict:
    """⭐ THE VALIDATION THAT MUST COME FIRST. Read-only; writes nothing.

    For every stored session in the window that has an `adv_decline`, recompute
    the pair through the recon over that row's own point-in-time universe and
    check the identity the backfill gates on:
    `advancing - declining == adv_decline`.

    `verdict` is the go/no-go:
      * `"pass"`  — every checked session reproduced EXACTLY; the recon source
                    may be used to backfill.
      * `"fail"`  — at least one did not. Do not backfill from the recon; use a
                    source that does reproduce.
      * `"empty"` — nothing to check.

    ⛔ There is no tolerance parameter, deliberately. "Close enough" is what
    puts a number people read next to a number it contradicts.
    """
    from api.services import breadth_monitor as bm
    hist = bm.get_history(int(days)) or []
    per_day, exact, checked = [], 0, 0
    for row in hist:
        date = row.get("date")
        stored = _f(row.get("adv_decline"))
        if not date or stored is None:
            continue
        if limit and checked >= int(limit):
            break
        uni = pit_universe(date)
        if not uni:
            per_day.append({"date": date, "skipped": "no stored universe_list"})
            continue
        r = recompute_adv_dec(date, uni)
        if not r.get("ok"):
            per_day.append({"date": date, "skipped": r.get("reason")})
            continue
        checked += 1
        diff = r["net"] - int(stored)
        if diff == 0:
            exact += 1
        per_day.append({"date": date, "advancing": r["advancing"],
                        "declining": r["declining"], "net": r["net"],
                        "stored_adv_decline": int(stored), "diff": diff,
                        "universe": r["universe"], "measured": r["measured"],
                        "coverage": r["coverage"]})
    graded = [d for d in per_day if "diff" in d]
    diffs = sorted(abs(d["diff"]) for d in graded)
    covs = sorted(d["coverage"] for d in graded if d.get("coverage") is not None)
    verdict = "empty" if not graded else ("pass" if exact == len(graded) else "fail")
    return {
        "ok": True, "verdict": verdict,
        "sessions_checked": len(graded), "exact_matches": exact,
        "match_rate": round(exact / len(graded), 4) if graded else None,
        "median_abs_diff": diffs[len(diffs) // 2] if diffs else None,
        "max_abs_diff": diffs[-1] if diffs else None,
        "median_universe_coverage": covs[len(covs) // 2] if covs else None,
        "min_universe_coverage": covs[0] if covs else None,
        "per_day": per_day,
        "note": ("The recon reconstructs the METHOD, not the collector's POPULATION: "
                 "bars.db cannot price 0.3-22% of each session's point-in-time "
                 "universe, and the missing names are distributed like the day, so "
                 "every count comes back scaled by `coverage` (reported per day "
                 "above). Measured per name, that accounts for the whole gap; "
                 "dividend basis contributes ~nothing to a one-day change (5 "
                 "ex-dividend sign flips in 114 sessions). The error is therefore "
                 "proportional, not additive, and `adv_decline` is an exact "
                 "identity with no tolerance to spend. Anything but verdict=pass "
                 "means this source must not write."),
    }


def backfill_adv_dec_from_recon(days: int = 90, dry_run: bool = True,
                                limit: int = 0) -> dict:
    """Backfill from the recon source, through the SAME per-row gate.

    Validate first, then feed only the pairs the recon produced into
    `apply_adv_dec_counts`, which re-checks the identity itself. As measured
    (see the header), the recon reproduces `adv_decline` on 0 of 96 sessions,
    so this is expected to write nothing today — and that refusal is the
    feature. One gate, two possible sources; a source earns the right to write
    by reproducing the number the collector already stored.
    """
    val = validate_adv_dec_recon(days=days, limit=limit)
    pairs = {d["date"]: (d["advancing"], d["declining"])
             for d in val.get("per_day", []) if "advancing" in d}
    out = apply_adv_dec_counts(pairs, dry_run=dry_run, source="recon")
    out["validation"] = {k: v for k, v in val.items() if k != "per_day"}
    return out


# ── The PIT-universe backfill, SHIPPED DARK ──────────────────────────────────
#
# ⛔⛔ THIS IS THE CANNON, AND IT IS DELIBERATELY NOT LOADED. A full 2008→present
# grind over three universes materialises hundreds of thousands of derived rows and
# thousands of whole-market provider fetches; the owner holds that for an explicit
# decision. Everything here exists so that decision is a flag flip against proven
# machinery rather than a night of new code — and so the FLOOR is enforced by the
# thing that walks history, not only by the thing that computes one chunk.
#
# ⚠️ SEPARATE FROM `backfill_tick`, WHICH STAYS UCT-ONLY. That function walks
# downward from current coverage and has no floor of its own beyond its marker
# file; giving it a universe argument would let a marker edit send it below an
# exchange universe's approved start. `test_the_default_backfill_loop_can_only_ever
# _sweep_uct` pins that separation by reading its source.

def universe_backfill_enabled() -> bool:
    """Ships DARK. An explicit "1" arms the PIT backfill loop.

    Same shape as `BREADTH_DIVIDEND_BASIS` and for the same reason: this one
    creates derived data at scale, so the deploy must be a no-op and the start must
    be a deliberate flip."""
    return _os.environ.get("BREADTH_UNIVERSE_BACKFILL_ENABLED", "0") == "1"


def universe_backfill_plan(universe: str, target_floor: Optional[str] = None,
                           chunk_days: int = 365) -> dict:
    """What the next chunk WOULD be — computed, never executed.

    ⭐ A PLANNER SEPARATE FROM A RUNNER, so the floor arithmetic is testable and
    inspectable without touching a provider or a store. `blocked` is the honest
    answer for "this universe has nothing left to sweep"; `reason` says which.

    ⛔ THE FLOOR IS CLAMPED HERE AND REFUSED IN `sweep_history`. Two layers, on
    purpose: the planner must not ASK for a pre-floor chunk (asking would make the
    loop look stuck), and the sweep must refuse one anyway (a caller that bypasses
    the planner is a bug, not a special case).
    """
    from api.services import breadth_daily_ohlc, breadth_universes as bu
    from datetime import date as _d, timedelta as _t

    row = bu.get(universe)
    if not bu.is_pit(universe):
        return {"ok": False, "blocked": True,
                "reason": f"{row['label']} is not a PIT universe; this project does "
                          "not recompute it"}
    floor = row["floor"]
    if target_floor:
        # ⚠️ CLAMPED UP, never down. A caller asking for 2008 NASDAQ gets 2011 and is
        # TOLD so; silently honouring it would publish what Phase 1 refused.
        floor = max(floor, target_floor) if floor else target_floor
    stats = breadth_daily_ohlc.stats(universe) or {}
    covered_first = stats.get("first")
    if covered_first and covered_first <= floor:
        return {"ok": True, "blocked": True, "complete": True, "universe": row["id"],
                "floor": floor, "coverage_first": covered_first,
                "reason": "coverage already reaches the floor"}
    hi = (_d.fromisoformat(covered_first) - _t(days=1)) if covered_first else _d.today()
    lo = max(_d.fromisoformat(floor), hi - _t(days=int(chunk_days) - 1))
    if lo > hi:
        return {"ok": True, "blocked": True, "complete": True, "universe": row["id"],
                "floor": floor, "reason": "nothing below current coverage"}
    # ⛔⛔ A REMAINING WINDOW WITH NO WEEKDAY IN IT IS DONE, NOT PENDING — and this
    # is a real infinite loop, not a tidiness point. Coverage reaching 2011-01-03
    # against a 2011-01-01 floor leaves 1-2 Jan, a Saturday and a Sunday: the plan
    # would ask for them forever, the sweep would return zero sessions forever,
    # coverage would never move, and the grind would look busy while making no
    # progress. Asking the CALENDAR is exact and costs nothing; the holiday case
    # that survives this is caught by the `exhausted` signal in the tick below.
    if not any((lo + _t(days=i)).weekday() < 5 for i in range((hi - lo).days + 1)):
        return {"ok": True, "blocked": True, "complete": True, "universe": row["id"],
                "floor": floor, "coverage_first": covered_first,
                "reason": "no trading sessions remain above the floor"}
    return {"ok": True, "blocked": False, "universe": row["id"], "floor": floor,
            "coverage_first": covered_first,
            "from": lo.isoformat(), "to": hi.isoformat(),
            "clamped": bool(target_floor and target_floor < (row["floor"] or ""))}


def universe_backfill_tick(universe: str, target_floor: Optional[str] = None,
                           chunk_days: int = 365) -> dict:
    """ONE restart-safe chunk for a PIT universe. Refuses unless armed.

    Resumable by construction: the next chunk is read from the STORE's current
    coverage each time, so a pod restart mid-grind simply picks up where the rows
    stop — the same property `backfill_tick` has, and the reason neither needs a
    progress file that could disagree with the data.
    """
    if not universe_backfill_enabled():
        return {"ok": False, "disarmed": True,
                "reason": "BREADTH_UNIVERSE_BACKFILL_ENABLED is not 1"}
    plan = universe_backfill_plan(universe, target_floor, chunk_days)
    if not plan.get("ok") or plan.get("blocked"):
        return plan
    if not _TICK_LOCK.acquire(blocking=False):
        return {"ok": True, "busy": True}
    try:
        res = sweep_history(plan["from"], plan["to"], universe=universe)
        # ⭐ A CHUNK THAT PRODUCED NOTHING ENDS THE GRIND. Coverage is the progress
        # marker, so a window that yields zero sessions (a holiday-only remainder,
        # or a range the provider has no frames for) would otherwise be re-planned
        # identically on the next tick, forever. Reporting exhaustion lets the
        # scheduler stop instead of spinning.
        if res.get("ok") and not res.get("sessions"):
            return {**plan, "result": res, "blocked": True, "exhausted": True,
                    "reason": "the planned window produced no sessions"}
        return {**plan, "result": res}
    finally:
        _TICK_LOCK.release()


# ── THE DAILY FORWARD SEAL ─────────────────────────────────────────
#
# ⭐⭐ THE BACKFILL ONLY WALKS BACKWARD, AND THAT IS A PUBLICATION BLOCKER ON ITS OWN.
# `universe_backfill_plan` computes the next chunk BELOW current coverage and stops
# when it reaches the floor. Nothing advances the RIGHT edge — so a published PIT
# universe would freeze on whatever day the grind happened to end, and a member would
# be looking at a chart that simply stopped, with no error anywhere to say so.
#
# ⛔⛔ AND IT IS NOT A SECOND METRIC ENGINE. This orchestrates; `sweep_history` does
# the work, which means the daily value is produced by the SAME eligibility
# (`breadth_pit_frame.eligible_on`), the SAME computation (`breadth_live.compute_metrics`
# via `recompute_from_frame`), the SAME applicability filter (`_applies`) and the SAME
# writer (`breadth_daily_ohlc.write_bulk`) as every historical row beside it. A
# separate "daily" path is how a series develops a seam at the date the backfill
# stopped and the live job started.
#
# ⚠️ ONE CALL FOR THE WHOLE GAP, NOT ONE PER DATE. `sweep_history` builds a ~560-day
# frame; asking it per date would rebuild that frame for every session. A three-day
# catch-up is one frame and three recomputes.

#: How many sessions one run may seal. A forward seal is a DAILY job; a gap wider than
#: this is not a late tick, it is an outage, and the historical tool owns recovery.
FORWARD_SEAL_MAX_SESSIONS = 10


def _et_today() -> str:
    from datetime import datetime as _dtm
    try:
        from zoneinfo import ZoneInfo
        return _dtm.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        return _dtm.utcnow().date().isoformat()


def is_trading_session(iso: str) -> bool:
    """Weekday AND not a NYSE full closure.

    ⛔ THE HOLIDAY LIST IS NOT RESTATED HERE. `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` is
    this repo's ONE closure table — five services already read it and it carries an
    explicit "refresh annually from nyse.com" contract. A second copy would diverge in
    the year nobody remembered to update it, which is this repo's most repeated defect.
    ⚠️ Full closures only: a 1pm early close is still a session and still seals.
    """
    from datetime import date as _d
    d = _d.fromisoformat(iso)
    if d.weekday() >= 5:
        return False
    try:
        from api.services.bars_fetch import _is_nyse_holiday
        return not _is_nyse_holiday(int(iso.replace("-", "")))
    except Exception:
        # ⚠️ Degrade to weekday-only rather than refusing every date: a missing
        # holiday answer must not stop the seal, and a holiday that slips through is
        # caught downstream — `build_frame` finds no adjusted frame and refuses it.
        return True


def sessions_between(after_iso: str, through_iso: str, limit: int = 0) -> list:
    """Trading sessions strictly after `after_iso`, up to and including `through_iso`."""
    from datetime import date as _d, timedelta as _t
    out = []
    d = _d.fromisoformat(after_iso) + _t(days=1)
    end = _d.fromisoformat(through_iso)
    while d <= end:
        iso = d.isoformat()
        if is_trading_session(iso):
            out.append(iso)
            if limit and len(out) >= limit:
                break
        d += _t(days=1)
    return out


def forward_seal_plan(universe: str, through: Optional[str] = None,
                      max_sessions: int = FORWARD_SEAL_MAX_SESSIONS) -> dict:
    """What the next forward seal WOULD do — computed, never executed.

    ⭐ A PLANNER SEPARATE FROM A RUNNER, the same split `universe_backfill_plan`
    uses, so the calendar and bound arithmetic is testable without a provider, a store
    write or a clock.

    ⛔ `through` DEFAULTS TO YESTERDAY, NOT TODAY. Today's grouped-daily frame is not
    settled while the session is open, and `massive.get_grouped_daily_ohlcv` only
    writes its durable tier for settled dates. Sealing today would either fail or
    — worse — seal a partial session as if it were final.
    """
    from datetime import date as _d, timedelta as _t
    from api.services import breadth_daily_ohlc, breadth_universes as bu

    if not bu.is_pit(universe):
        return {"ok": False, "blocked": True, "universe": bu.normalize(universe),
                "reason": "the forward seal is for PIT universes; UCT is sealed by "
                          "the 4:15pm collector"}
    uni = bu.normalize(universe)
    through = through or (_d.fromisoformat(_et_today()) - _t(days=1)).isoformat()
    stats = breadth_daily_ohlc.stats(uni) or {}
    last = stats.get("last")
    if not last:
        # ⛔ AN EMPTY STORE IS NOT A ONE-DAY GAP. With no rows there is no "latest
        # sealed session" to walk forward from, and inventing one (the floor, say)
        # would turn this job into the historical grind it must never become.
        return {"ok": True, "blocked": True, "universe": uni, "empty": True,
                "last_sealed": None, "through": through,
                "reason": "no rows for this universe — the historical backfill owns "
                          "the first population"}
    if last >= through:
        return {"ok": True, "blocked": True, "universe": uni, "current": True,
                "last_sealed": last, "through": through, "sessions": [],
                "reason": "already sealed through the last settled session"}

    pending = sessions_between(last, through)
    if not pending:
        return {"ok": True, "blocked": True, "universe": uni, "current": True,
                "last_sealed": last, "through": through, "sessions": [],
                "reason": "no trading session between the last sealed day and now"}
    if len(pending) > int(max_sessions):
        # ⛔⛔ REPORT GAPPED, DO NOT QUIETLY GRIND. A 200-session hole is an outage,
        # and letting a daily job close it would be an accidental historical grind on
        # the web pod — the exact failure `start_breadth_warm` was written around.
        return {"ok": True, "blocked": True, "universe": uni, "gapped": True,
                "last_sealed": last, "through": through,
                "pending": len(pending), "max_sessions": int(max_sessions),
                "first_missing": pending[0], "last_missing": pending[-1],
                "sessions": [],
                "reason": f"{len(pending)} sessions behind, over the {int(max_sessions)}-"
                          "session bound — the historical backfill owns recovery"}
    return {"ok": True, "blocked": False, "universe": uni, "last_sealed": last,
            "through": through, "sessions": pending,
            "from": pending[0], "to": pending[-1]}


#: Last forward-seal outcome per universe, for the health surface. In-process only.
_FORWARD_SEAL_STATE: dict = {}


def forward_seal_state(universe: Optional[str] = None):
    if universe is None:
        return dict(_FORWARD_SEAL_STATE)
    from api.services import breadth_universes as bu
    return _FORWARD_SEAL_STATE.get(bu.normalize(universe))


def forward_seal_tick(universe: str, through: Optional[str] = None,
                      max_sessions: int = FORWARD_SEAL_MAX_SESSIONS) -> dict:
    """Seal the bounded forward gap for ONE PIT universe. Idempotent.

    ⭐ IDEMPOTENT BY CONSTRUCTION, not by a guard. The plan is read from the STORE's
    own `last` every time, so a second run finds nothing pending; and even a forced
    re-sweep of a sealed date writes the same `(universe, date, metric)` primary keys
    with the same computed values, because the frame, the eligibility and the
    computation are all deterministic functions of settled provider data.

    ⛔ REFUSAL IS THE SUCCESS PATH WHEN INPUTS ARE MISSING. `build_frame` already
    refuses a chunk whose sweep dates have no RAW frame rather than writing a silent
    gap (the Phase-6 defect). This records that refusal and leaves the dates for the
    next tick; it never writes a partial day, never fabricates a zero, and never
    reports success over a window it did not compute.
    """
    from api.services import breadth_universes as bu
    plan = forward_seal_plan(universe, through=through, max_sessions=max_sessions)
    if not plan.get("ok") or plan.get("blocked"):
        _FORWARD_SEAL_STATE[plan.get("universe", bu.normalize(universe))] = {
            **{k: v for k, v in plan.items() if k != "sessions"},
            "at": _time.time(), "sealed": 0,
        }
        return plan
    uni = plan["universe"]
    if not _TICK_LOCK.acquire(blocking=False):
        return {**plan, "busy": True}
    try:
        res = sweep_history(plan["from"], plan["to"], universe=uni)
        want = len(plan["sessions"])
        got = int(res.get("sessions") or 0) if res.get("ok") else 0
        out = {**plan, "result": res, "expected": want, "sealed": got}
        if not res.get("ok"):
            # The chunk was refused — typically a missing RAW frame. Keep the reason
            # verbatim: "the provider had not published 2026-09-15 yet" and "the fetch
            # failed" must not collapse into one message.
            out["failed"] = True
            out["reason"] = res.get("reason")
            out["missing_raw"] = res.get("missing_raw")
        elif got < want:
            # ⚠️ FEWER SESSIONS THAN PLANNED IS NOT SUCCESS. The planner used the
            # NYSE calendar; the frame used what the provider actually published. A
            # difference means one of them is wrong, and saying so beats a green log.
            out["partial"] = True
            out["reason"] = (f"planned {want} sessions, sealed {got} — the calendar and "
                             "the provider disagree about this window")
        _FORWARD_SEAL_STATE[uni] = {
            **{k: v for k, v in out.items() if k not in ("sessions", "result")},
            "at": _time.time(),
        }
        return out
    finally:
        _TICK_LOCK.release()


def forward_seal_all(through: Optional[str] = None,
                     max_sessions: int = FORWARD_SEAL_MAX_SESSIONS) -> dict:
    """One forward-seal pass over every PUBLISHED PIT universe.

    ⛔ PUBLISHED ONLY. A dark universe's rows are not served, so sealing them daily
    would spend provider fetches and pod CPU on data nobody can see — and would do it
    on the web pod. The historical backfill is what populates a dark universe.

    ⚠️ FAILURE IS ISOLATED PER UNIVERSE: one refusing does not stop the others.
    """
    from api.services import breadth_universes as bu
    out = {}
    published = set(bu.published_universe_ids())
    for uni in bu.PIT_UNIVERSE_IDS:
        if uni not in published:
            continue
        try:
            out[uni] = forward_seal_tick(uni, through=through, max_sessions=max_sessions)
        except Exception as e:  # noqa: BLE001
            out[uni] = {"ok": False, "universe": uni,
                        "reason": f"{type(e).__name__}: {e}"}
            _FORWARD_SEAL_STATE[uni] = {**out[uni], "at": _time.time(), "sealed": 0}
    return out
