"""UCT Relative Strength — the `rsLine` server-lane provider.

Moved here verbatim from `api/routers/signature.py` (unit VA1, 2026-11-07): the
provider body, every `_rs_*` helper, the thresholds, the payload-shape number,
the data-generation memo and the ET session-day / TTL helpers. Behaviour is
byte-identical; the cache key and `_RS_PAYLOAD_SHAPE` did not change.

⭐ THE ROUTER STILL OWNS THE DATA PATH. `api/routers/signature.py` keeps the
registered provider (`_rs_line_provider`, a thin wrapper), the bar reader
(`_fetch_bars_for_tf`) and the cache-key builder (`_ck`), and hands the last two
to `rs_line_envelope` as callables. So the lane's bars are still reachable only
from the module whose every route declares `Depends(require_paid)` — the rule
the router's "THE PROVIDERS LIVE HERE" note exists for — and nothing in this
module reads `bars_sqlite` itself. The rating and evidence reads below are
garnishes that never raise, as before.

⭐ TIMING (unit VA1). Every call records its own duration and its stages in a
thread-local (`last_timing`); the `/api/signature/columns` route turns that into
a `Server-Timing` header in `/api/bars`' shape (`server_timing`). No log line
per request.
"""
from __future__ import annotations

import json
import logging
import math
import os
import threading
import time

from api.services.cache import cache
from api.services.signature import registry_defs
from api.services.signature.flow_breakout import _bar_date_iso

logger = logging.getLogger(__name__)


# ── per-call timing (unit VA1, 2026-11-07) ───────────────────────────────────
#
# BEHAVIOUR-NEUTRAL, the `bars_fetch` serve-marks pattern: one thread-local per
# request thread, written once at the end of each `rs_line_envelope` call, read
# by the route. Stages, in milliseconds:
#   * ``bars``     every bar read the call made (the stock, the benchmark, the
#                  regime's deep benchmark read, the sensitivity legs), summed;
#   * ``rating``   the nightly rating read (`_rs_rating`);
#   * ``evidence`` the evidence artifact read (`_rs_evidence`);
#   * ``compute``  everything else after the cache miss: columns, Mansfield,
#                  rounding, blanking and the scalar blocks.
# The flag-off (v1) envelope reads no rating and no evidence, so it records
# ``bars`` and ``compute`` only. A cache hit records the total alone, tier
# ``cache``. The cache-key build and lookup are in ``total`` and in no stage.
_TIMING = threading.local()


def timing_reset() -> None:
    """Forget this thread's last record (the route calls it before serving)."""
    _TIMING.last = None


def last_timing() -> dict | None:
    """``{"tier": "cold" | "cache", "total_ms": float, "stages": {name: ms}}``
    for the newest `rs_line_envelope` call on this thread, or None."""
    rec = getattr(_TIMING, "last", None)
    return None if rec is None else {"tier": rec["tier"], "total_ms": rec["total_ms"],
                                     "stages": dict(rec["stages"])}


def server_timing() -> str | None:
    """This thread's last record as a `Server-Timing` value, `/api/bars`' shape:
    ``rs;desc="cold";dur=41.2, rs-bars;dur=3.1, rs-rating;dur=0.2, ...``
    (`serve_stale.server_timing` writes the head). None when nothing ran."""
    rec = last_timing()
    if rec is None:
        return None
    from api.services.serve_stale import server_timing as _head
    out = _head("rs", rec["tier"], rec["total_ms"])
    for name, ms in rec["stages"].items():
        out += f", rs-{name};dur={ms:.1f}"
    return out


def _record_timing(tier: str, t0: float, stages: dict) -> None:
    try:
        _TIMING.last = {"tier": tier, "total_ms": (time.perf_counter() - t0) * 1000.0,
                        "stages": {k: round(v, 3) for k, v in stages.items()}}
    except Exception:                                  # noqa: BLE001 — a diagnostic never fails a chart
        pass


def _timed_fetch(fetch_bars, stages: dict):
    """`fetch_bars`, passed through unchanged, with its wall time added to
    ``stages["bars"]``."""
    def fetch(*args, **kwargs):
        t = time.perf_counter()
        try:
            return fetch_bars(*args, **kwargs)
        finally:
            stages["bars"] = stages.get("bars", 0.0) + (time.perf_counter() - t) * 1000.0
    return fetch


def _timed(stages: dict, name: str, fn, *args):
    """``fn(*args)``, unchanged, with its wall time ADDED to ``stages[name]`` (the
    RS Rating Reading's series read lands in ``rating`` too, rev 5)."""
    t = time.perf_counter()
    try:
        return fn(*args)
    finally:
        stages[name] = stages.get(name, 0.0) + (time.perf_counter() - t) * 1000.0


def _stage_order(stages: dict, build_ms: float) -> dict:
    """``bars, rating, compute, evidence`` (the ones that ran), ``compute`` being
    the build's wall time less the timed reads."""
    timed = sum(v for k, v in stages.items())
    out = {"bars": stages.get("bars", 0.0)}
    if "rating" in stages:
        out["rating"] = stages["rating"]
    out["compute"] = max(0.0, build_ms - timed)
    if "evidence" in stages:
        out["evidence"] = stages["evidence"]
    return out


def rs_line_envelope(sym: str, tf: str, inputs: dict, *, fetch_bars, cache_key, warm=None) -> dict:
    """⭐ THE FOURTH TENANT, AND THE PROOF THE LANE IS GENERIC.

    It is not a Signature indicator, shares no code with one, and needed no line
    inside `registry_defs.serve` to be served. It is here because Task 14's
    decision A3 put it on this lane: spec §4's compute contract carries ONE
    `bars` and an RS line needs two, so the second symbol is fetched where a
    second symbol is reachable.

    ⭐ PHASE 2a (unit 2a-14, `compute.rev` 3). Beside the Phase 1 columns the
    v3 envelope carries the Mansfield line and its zero-cross events, and the
    `payload` grows the Leadership readout's scalars (plan §6.6, §7 items 13,
    21-23): `rating` (the nightly IBD-style rating from `rs_history`), `regime`,
    `sensitivity` (the 20-bar RS slope against SPY, RSP and the sector ETF),
    `checks` (the four UCT checks, each a boolean with its reason), `theme`
    (the sector / industry label) and `mansfield`. Every scalar block is built
    by one pure helper below, each of which answers ``None`` WITH A REASON when
    the bars cannot support it, so the readout prints a muted fallback rather
    than a number that was never computable. The flag-off v1 envelope is
    byte-for-byte what Phase 1 shipped.

    ⭐ PHASE 3 (unit 3-06, `compute.rev` 4, only when the installed row is v4,
    i.e. `RS_V3_ENABLED` on top of `RS_V2_ENABLED`). The envelope adds the six
    Phase 3 wire columns, one "Reading" (`view`) that decides which family the
    pane draws (`_RS_VIEW_FAMILIES`; the legacy `showMansfield` maps to
    `mansfield` only when no `view` was sent, decision D2 and unit 3-08b), a member's own benchmark (`CUSTOM` plus
    `customBenchmark`, decision D4, warmed through ``warm``), the picked
    `anchorDate` for the Checks anchor (decision D6), and three payload blocks:
    `rotation`, `quality` and `vars` (`_rs_phase3`). The payload shape is
    `_RS_PAYLOAD_SHAPE_V4`. With the row at rev 3 every one of those branches
    is skipped, and the v3 envelope and cache key are byte-identical.

    ⭐ ROUND 2 (Deepvue, 2026-11-08, `compute.rev` 5 on the same v4 row). Two
    additions, both v4 only: `rating.m9` (the 9-month component rank) joins the
    rating block and its Components text, and the RS Rating Reading
    (`view: "rating"`) plots the stock's stored daily IBD-style rating with its
    21-session average (`ratingLine` / `ratingMa`, `payload.ratingHistory`). The
    rating history is read ONLY under that Reading, on a daily chart, with
    `RS_HISTORY_ENABLED` on: one bounded indexed read (`_rs_rating_view`).

    ``fetch_bars(sym, tf, count)`` and ``cache_key(kind, sym)`` are the router's
    `_fetch_bars_for_tf` and `_ck` (see the module docstring). ``warm(ticker)``
    is the router's fire-and-forget bar warm for a custom benchmark the pod has
    no rows for yet (v4 only; `rs_benchmarks` calls it at most once per ticker
    per ten minutes). Each call leaves its timing in `last_timing` (unit VA1).
    """
    t0 = time.perf_counter()
    from api.services import relative_strength as rsmod
    from api.services import rs_benchmarks
    from api.services.indicator_compute import _round_series

    reader = fetch_bars            # the caller's reader, the composite memo's namespace
    params = rsmod.resolve_phase1_inputs(inputs)
    params["mansfieldLength"] = _rs_mansfield_length((inputs or {}).get("mansfieldLength"))
    requested = (inputs or {}).get("benchmark") or registry_defs.RS_LINE_BENCHMARKS[0]
    toggles = {k: bool((inputs or {}).get(k, dflt)) for k, dflt in _RS_TOGGLE_DEFAULTS.items()}
    store = registry_defs.store_tf(tf)
    intraday = store not in ("D", "W", "M")
    count = _rs_bars_count(store, params["lookback"])
    rev = int(registry_defs.definition("rsLine")["compute"]["rev"])
    # ⭐ PHASE 3 IS THE ROW, NOT A SECOND FLAG READ (unit 3-06). The v4 row is
    # installed only with both flags on (`registry_defs._rs_line_row`), so the
    # rev it serves is the switch: rev 3 never reaches a Phase 3 line below.
    v4 = registry_defs.RS_V2_ENABLED and rev == registry_defs.RS_V4_REV
    if v4:
        # The Phase 3 inputs join `params`, so they ride the cache key and
        # `payload.inputs` (the resolved view, the effective custom ticker).
        params.update(_rs_phase3_params(inputs, requested, toggles))

    # ⭐ CACHED PER ET SESSION DAY (plan §8.2). The key carries only COMPUTE inputs
    # (`resolve_inputs` already dropped the rest), the resolved timeframe and the
    # EASTERN calendar day — the day a session closes on, not UTC's, which rolls
    # over at 8 pm ET and would split one session's answer across two keys — so a
    # stale answer cannot outlive the session it describes. The TTL (below) runs
    # to the next session close on D/W/M; the day in the key is the floor. The
    # row's `compute.rev` leads the key, so a rev bump is a cold cache by itself.
    #
    # ⭐ AND, ON V2, THE DATA GENERATION (review #16, 2026-11-07). The day alone let
    # an envelope built between ET midnight and the 04:15 rating job / 04:30
    # evidence pull pin the previous session's rating and artifact until 16:05.
    # The newest stored rating session and the artifact's `asof` now sit in the
    # key, so the first request after either job lands is a cold compute. The
    # flag-off (v1) key is unchanged: v1 carries neither block.
    #
    # ⭐ AND THE PAYLOAD SHAPE (visual round VA1, 2026-11-06). Rev 3 is unreleased,
    # so the summaries and the Mansfield-view blanking did not bump it; the shape
    # number in the v2 key keeps an envelope cached before them from being served
    # after them for the rest of the session. The v1 key is unchanged.
    day = _et_session_day()
    gen = f"{_rs_data_generation()}:" if registry_defs.RS_V2_ENABLED else ""
    shape = (f"p{_RS_PAYLOAD_SHAPE_V4 if v4 else _RS_PAYLOAD_SHAPE}"
             if registry_defs.RS_V2_ENABLED else "")
    ck = cache_key(f"rs{rev}{shape}",
             f"{sym.upper()}:{store}:{requested}:{json.dumps(params, sort_keys=True)}:"
             f"{json.dumps(toggles, sort_keys=True)}:{gen}{day}")
    try:
        hit = cache.get(ck)
    except Exception:                                  # noqa: BLE001 — a cache read is bookkeeping
        hit = None
    if hit:
        _record_timing("cache", t0, {})
        return hit

    stages: dict = {"bars": 0.0}
    t_build = time.perf_counter()
    fetch_bars = _timed_fetch(fetch_bars, stages)
    bars = fetch_bars(sym, tf, count)
    if v4:
        # D4: `custom` is the member's ticker (blank unless the benchmark is
        # CUSTOM); `warm` fills bars.db behind a ticker with no rows yet, and the
        # pane says so (`bench["note"]`) rather than swapping in SPY.
        # 2026-11-12: `sector` / `theme` are the picked sector and theme, blank
        # unless the benchmark reads them (`rs_benchmarks.benchmark_picks`).
        bench = rs_benchmarks.resolve_benchmark(sym, requested, tf, count, fetch_bars=fetch_bars,
                                                custom=params["customBenchmark"] or None, warm=warm,
                                                sector=params["sectorBenchmark"] or None,
                                                theme=params["themeBenchmark"] or None, memo=reader)
    else:
        bench = rs_benchmarks.resolve_benchmark(sym, requested, tf, count, fetch_bars=fetch_bars)
    times = [int(b["t"]) for b in bars]
    # The STATE the chart should show (plan §6.10), decided here from the data
    # rather than inferred client-side from an empty pane. `same-symbol` and
    # `no-benchmark-bars` blank every derived column: a flat 1.0 ratio against
    # itself would fire a "new high" on every bar (ties count), and a benchmark
    # with no bars has no ratio at all.
    same_symbol = str(bench.get("resolved", "")).upper() == sym.upper()
    no_bench = not bench.get("bars")
    short_history = bool(times) and len(times) < count
    derived = not (same_symbol or no_bench)
    if derived:
        cols = rsmod.compute_phase1_columns(bars, bench["bars"], params, short_history=short_history)
    else:
        cols = {k: [None] * len(times) for k in rsmod.PHASE1_COLUMNS}
    state = ("same-symbol" if same_symbol else "no-benchmark-bars" if no_bench
             else "no-bars" if not times else "intraday" if intraday
             else "short-history" if short_history else "ok")

    if not registry_defs.RS_V2_ENABLED:
        envelope = {"columns": {"rsLine": _round_series(cols["rsLine"], 6)},
                    "times": times, "asOf": time.time()}
    else:
        # ── Phase 2a columns: the Mansfield line and its zero crosses ──────────
        if derived:
            mans = rsmod.compute_mansfield_columns(bars, bench["bars"], params["mansfieldLength"])
        else:
            mans = {k: [None] * len(times) for k in rsmod.PHASE2A_COLUMNS}
        cols["mansfield"] = mans["mansfield"]
        cols["mansfieldCrossUp"] = mans["mansfieldCrossUp"]
        cols["mansfieldCrossDown"] = mans["mansfieldCrossDown"]
        # ⭐ THE CROSS DOT IS A CROSS UP, CENTRED ON THE ZERO LINE (visual round
        # A2, 2026-11-06): one dot at 0 on each bar where the line crosses UP
        # through zero. Crosses down are not drawn (the line falling through the
        # zero guide shows them; the readout names the last cross either way).
        # A value of 0 is NOT `relative_strength.dot_column` (that refuses a
        # non-positive value, the right rule for a ratio), so the chart draws it
        # as the series' own point marker, which paints at any finite value. The
        # `mansfieldCrossUp` / `mansfieldCrossDown` EVENT columns are untouched.
        cols["dotMansfieldCross"] = _rs_zero_cross_dot(mans["mansfield"], mans["mansfieldCrossUp"])
        # The readout's Mansfield scalars are read BEFORE the toggle blanks the
        # column: the reading is true whether or not the line is drawn.
        mansfield_scalars = _rs_mansfield_scalars(mans, params["mansfieldLength"])
        if v4:
            # ── Phase 3 columns and blocks (unit 3-06): rotation, quality, VARS.
            # Each block is read before the view blanks its column, the
            # Mansfield rule: the reading is true whether or not it is drawn.
            p3 = _rs_phase3(bars, bench.get("bars") or [], params, count, store=store,
                            intraday=intraday, bench_name=str(bench.get("resolved") or "the benchmark"),
                            why=(None if derived else
                                 "benchmark is the symbol" if same_symbol else "no benchmark bars"))
            cols.update(p3["columns"])
            # ── the RS Rating Reading (rev 5): the stored rating over the window.
            # It reads no benchmark, so it draws in the no-ratio states too.
            rating_view = _rs_rating_view(sym, times, store, params["view"], stages)
            cols.update(rating_view["columns"])

        # The data carries the timeframe rule (plan §6.5): on an intraday chart a
        # 252-bar "new high" is two days and means nothing, so events and dots are
        # blank there whatever the chart's visibility settings say.
        blank = [None] * len(times)
        event_keys = ("rsNH", "rsNHpartial", "pxNH", "rsNHbeforePx", "rsNHred", "rsNL", "gor", "rog",
                      "mansfieldCrossUp", "mansfieldCrossDown")
        dot_keys = ("dotNH", "dotNHbeforePx", "dotNHred", "dotNHpartial", "dotNL", "dotMansfieldCross")
        if intraday:
            for k in event_keys + dot_keys:
                cols[k] = list(blank)
            if v4:
                # Rotation and the gap dot are intraday-blank like the dots
                # (`_rs_phase3` never fills them there; stated again here so the
                # rule lives beside the one it extends).
                for k in ("rsRatio", "rsMomentum", "dotClenowGap"):
                    cols[k] = list(blank)
        # The dot toggles are compute inputs on purpose: the engine has no
        # per-plot visibility an input can drive, so "off" means the column is
        # blank and the marker draws nothing (plan §4, audit A3). The event
        # columns beside them stay for the screener and the alert lane.
        for toggle, keys in _RS_TOGGLE_BLANKS.items():
            # v4: the "Reading" decides what Mansfield draws (below), not the
            # legacy toggle, which only maps onto that choice (D2).
            if v4 and toggle == "showMansfield":
                continue
            if not toggles[toggle]:
                for k in keys:
                    cols[k] = list(blank)
        for k in ("rsLine", "rsMa") + dot_keys[:5]:
            cols[k] = _round_series(cols[k], 6)      # a RATIO: six places, not four
        for k in ("mansfield", "dotMansfieldCross"):
            cols[k] = _round_series(cols[k], 4)      # a PERCENT distance from its own average
        if v4:
            for k in registry_defs.RS_PHASE3_WIRE_COLUMNS:
                cols[k] = _round_series(cols[k], 4)  # around 100 / a fraction / an ATR sum
            cols["ratingMa"] = _round_series(cols["ratingMa"], 2)   # a 1-99 average; the line is whole numbers

        # The legend and last-high scalars are read HERE, after rounding and
        # BEFORE the Mansfield view blanks the ratio (A2): the RS line and Last RS
        # high rows still print under Mansfield view, because the reading is true
        # whether or not the line is drawn.
        legend = _rs_legend(rsmod.legend_scalars(cols), times, params)
        last_high = _rs_last_high(rsmod.last_rs_high(cols, times), params["lookback"], len(times),
                                  intraday=intraday,
                                  why=(None if derived else
                                       "benchmark is the symbol" if same_symbol else "no benchmark bars"))
        # ⭐ MANSFIELD VIEW (A2): one reading per pane. The ratio, its average,
        # the above flag and every RS-line dot column go all-null in the WIRE
        # (they stay in `columns`, so the definition's exact-match column contract
        # holds) and the Mansfield line draws alone. Event columns stay.
        if v4:
            # ⭐ ONE READING PER PANE (D2): the view keeps its own family and
            # blanks every other one. Event columns are never blanked here.
            for view, keys in _RS_VIEW_FAMILIES.items():
                if view != params["view"]:
                    for k in keys:
                        cols[k] = list(blank)
        elif toggles["showMansfield"]:
            for k in _RS_MANSFIELD_VIEW_BLANKS:
                cols[k] = list(blank)

        # ── the Leadership scalars (plan §6.6; §7 items 21-23) ───────────────
        groups = rs_benchmarks._groups_for(sym) or {}
        daily = store == "D"
        if not derived:
            why = "benchmark is the symbol" if same_symbol else "no benchmark bars"
            regime = _rs_regime_unavailable(why)
            sensitivity = _rs_sensitivity_unavailable(why)
            checks = _rs_checks_unavailable(why)
        elif not daily:
            why = "daily charts only"
            regime = _rs_regime_unavailable(why)
            sensitivity = _rs_sensitivity_unavailable(why)
            checks = _rs_checks_unavailable(why)
        else:
            # The regime reads the benchmark at a FIXED depth (review #19,
            # 2026-11-07): read at the chart's `count` (lookback + 600) the
            # volatility distribution held ~493 samples at lookback 20 and 756
            # only near 500, so an unrelated new-high setting could flip the label.
            regime = _rs_regime([b.get("c") for b in _rs_regime_bench_bars(
                sym, requested, tf, count, bench, fetch_bars,
                custom=(params["customBenchmark"] or None) if v4 else None,
                picks=({"sector": params["sectorBenchmark"] or None, "theme": params["themeBenchmark"] or None,
                        "memo": reader} if v4 else None))])
            sensitivity = _rs_sensitivity(sym, bars, bench, tf, count, groups, fetch_bars)
            checks = _rs_checks(bars, bench["bars"], str(bench.get("resolved") or "benchmark"),
                                params["redDayThreshold"],
                                anchor_date=params["anchorDate"] if v4 else None)
        if v4:
            # D6: the anchor says which rule chose its bar, on every chart.
            checks["anchor"].setdefault("source", "picked" if params["anchorDate"] else "default")
            checks["anchor"].setdefault("date", params["anchorDate"] or None)
        bench_block = dict({k: bench[k] for k in ("requested", "resolved", "label", "fallback")},
                           bars=len(bench.get("bars") or []),
                           note=_rs_benchmark_note(bench, legend, times, intraday=intraday,
                                                   same_symbol=same_symbol))
        if v4:
            # 2026-11-12: the plain name the pane label prints (`XLK`,
            # `Semiconductors`, `AI / GPU Chips`), never `THEME:<id>`. v4 only:
            # the v3 payload is byte-identical (its own control rail).
            bench_block["name"] = rs_benchmarks.benchmark_name(bench)
        payload = {
            "benchmark": bench_block,
            "legend": legend,
            "lastRsHigh": last_high,
            "history": {"bars": len(times), "requested": count, "short": short_history,
                        "summary": f"{_rs_plural(len(times), 'bar')} held; dots use every bar"
                        if short_history else None},
            "inputs": params,
            "intraday": intraday,
            "state": state,
            "rating": _timed(stages, "rating", _rs_rating, sym, v4),
            "mansfield": mansfield_scalars,
            "regime": regime,
            "sensitivity": sensitivity,
            "checks": checks,
            "theme": _rs_theme(groups),
            # THE EVIDENCE'S `asof` IS IN THE KEY (review #16, 2026-11-07; it
            # used to ride the day alone, which pinned the previous night's
            # numbers for an envelope cached between ET midnight and the 04:30
            # pull). `_rs_data_generation` reads it through a short in-process
            # memo, so a request pays no stat of its own. `generated_at` is
            # deliberately NOT in the key: it would cold-cache every symbol on
            # every re-publish of the same measurement.
            #
            # The sentence is measured on DAILY bars and says so in sessions
            # (review #7), so it is true on a weekly chart too.
            "evidence": _timed(stages, "evidence", _rs_evidence),
        }
        if v4:
            payload["rotation"] = p3["rotation"]
            payload["quality"] = p3["quality"]
            payload["vars"] = p3["vars"]
            payload["ratingHistory"] = rating_view["block"]
        envelope = {"columns": cols, "times": times, "asOf": time.time(), "payload": payload}
    t_built = time.perf_counter()

    # A degraded answer (no benchmark bars yet, nothing for the symbol) is cached
    # for one minute only: the worker may land the missing rows any time, and a
    # six-hour memory of "nothing" would outlive the fix (review finding).
    try:
        if times:
            ttl = 60 if no_bench else (900 if intraday else _seconds_to_next_et_close())
            cache.set(ck, envelope, ttl=ttl)
    except Exception:                                  # noqa: BLE001 — see the DPL cache-write note
        logger.exception("signature: rs cache write failed for %s", sym)
    _record_timing("cold", t0, _stage_order(stages, (t_built - t_build) * 1000.0))
    return envelope


# ── UCT RS Phase 2a (unit 2a-14): the toggles, the dot builder, the scalars ──
#
# Every helper below is PURE over lists and dicts (the one I/O, `_rs_rating`,
# wraps its read in a try and never raises), so `tests/test_rs_columns_provider.py`
# exercises each on synthetic bars. The thresholds are stated once, here, and
# every `reason` string carries the numbers it was decided on, so the readout
# shows the member the fact and not only the verdict.

#: The dot / line toggles and their defaults (JS: `RS_LINE_RAW.inputs`).
_RS_TOGGLE_DEFAULTS: dict[str, bool] = {
    "showNewHigh": True, "showNewHighBeforePrice": True, "shortHistoryDots": True,
    "showRedDay": False, "showNewLow": False, "showMansfield": False,
}
#: Which columns a toggle blanks when OFF. Event columns are never blanked here.
_RS_TOGGLE_BLANKS: dict[str, tuple[str, ...]] = {
    "showNewHigh": ("dotNH",),
    "showNewHighBeforePrice": ("dotNHbeforePx",),
    "shortHistoryDots": ("dotNHpartial",),
    "showRedDay": ("dotNHred",),
    "showNewLow": ("dotNL",),
    "showMansfield": ("mansfield", "dotMansfieldCross"),
}
_RS_SMA_LONG = 200            # the 200-day average (plan §7 item 21; v3 §7.20)
_RS_SMA_SHORT = 50
_RS_TREND_BARS = 504          # two trading years (item 21)
_RS_VOL_WINDOW = 126          # realised-volatility window, sessions (item 21)
_RS_VOL_DIST_MIN = 252        # a year of vol samples before a tercile is claimed
_RS_VOL_DIST_MAX = 756        # three trading years — the distribution the tercile reads against
#: The regime's own benchmark depth, independent of the RS lookback (review #19):
#: the full 756-sample distribution needs 126 + 756 + 1 closes; any deeper read
#: gives the same answer.
_RS_REGIME_BARS = _RS_VOL_WINDOW + _RS_VOL_DIST_MAX + 1
_RS_ANCHOR_WINDOW = 20        # the anchor is the benchmark's lowest close of the last 20 sessions
_RS_PIVOT_RED_DAYS = 10       # pivot speed counts over the last ten red days
_RS_PIVOT_TOP_SHARE = 2.0 / 3.0
_RS_PIVOT_PASS = 5            # at least half of them closed in the top third
_RS_GREEN_ON_RED_WINDOW = 20
#: UCT's chart threshold for the green-on-red check. No screener starter uses 6:
#: the "Up on down days" starter is a looser 3+ scan (saved_screens.py), so a
#: name it features can still fail this check. Unmeasured, like the other checks
#: (review #21, 2026-11-07).
_RS_GREEN_ON_RED_PASS = 6
_RS_PULLBACK_EMA = 8          # pullback distance from the 8-day EMA (v3 §7.20)
#: The v2 payload's shape, in the cache key (bump when a payload field or a
#: wire blanking rule changes inside one `compute.rev`). 4 (2026-11-07):
#: `rating.m1` / `m3` / `m6` / `m12` and `rating.components`.
_RS_PAYLOAD_SHAPE = 4
#: The v4 payload's shape (unit 3-06, `compute.rev` 4 only): the `rotation`,
#: `quality` and `vars` blocks, the Phase 3 `inputs`, `checks.anchor.source` /
#: `date`. A separate number, so the v3 key (`rs3p4`) stays byte-identical
#: while the flag is off; the v4 key led with `rs4p5`.
#: 6 (Deepvue round 2, 2026-11-08, `compute.rev` 5): `rating.m9`, the 9M part of
#: `rating.components`, and the `ratingHistory` block. The key now leads `rs5p6`.
#: 7 (2026-11-12, sector and theme benchmarks): `benchmark.name` and the
#: `inputs.sectorBenchmark` / `inputs.themeBenchmark` picks. The key leads `rs5p7`.
_RS_PAYLOAD_SHAPE_V4 = 7
#: What Mansfield view blanks in the wire (A2): the ratio, its average, the
#: above flag and every RS-line dot. Event columns are never blanked here.
_RS_MANSFIELD_VIEW_BLANKS: tuple[str, ...] = (
    "rsLine", "rsMa", "rsAbove", "dotNH", "dotNHbeforePx", "dotNHred", "dotNHpartial", "dotNL",
)
#: ⭐ THE v4 VIEW TABLE (unit 3-06, decision D2): each "Reading" keeps its own
#: family and the wire blanks every other family to all-null (the columns stay,
#: so the exact-match wire contract holds). `ratio` and `mansfield` blank what
#: they blanked in v3 (the Mansfield line and its dot / the ratio family), now
#: plus the three Phase 3 families. Event columns are never blanked here.
_RS_VIEW_FAMILIES: dict[str, tuple[str, ...]] = {
    "ratio": _RS_MANSFIELD_VIEW_BLANKS,
    "mansfield": ("mansfield", "dotMansfieldCross"),
    "rotation": ("rsRatio", "rsMomentum"),
    "quality": ("clenowScore", "dotClenowGap"),
    "vars": ("vars", "varsMa"),
    # rev 5: the RS Rating Reading. Its two columns are blank under every other
    # view, and every other family is blank under it.
    "rating": tuple(registry_defs.RS_RATING_WIRE_COLUMNS),
}
_RS_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


# ── copy helpers (visual round A1, 2026-11-06) ───────────────────────────────
#
# Every summary below is a sentence-free fragment in operator voice with no
# trailing period, and the client prints it verbatim. The number rules match
# `readoutSchema.formatReadoutValue` so a figure reads the same in a summary and
# in the card's numbers block: one decimal, a sign on a non-zero percent, never
# "-0.0%"; `today` / `1 bar ago` / `n bars ago`; never "1 bars".

def _rs_plural(n: int, word: str) -> str:
    """``1 bar`` / ``2 bars`` / ``0 bars``."""
    n = int(n)
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


#: U+00A0. A v4 summary keeps each number with its label or unit on one line
#: (``R² 0.09`` broke between the two in the readout row, 3-14); the readout
#: wraps at the ordinary spaces between the phrases instead.
_RS_NBSP = "\u00a0"


def _rs_count(n: int, word: str) -> str:
    """`_rs_plural` with the number held to its unit: ``6 weeks`` (U+00A0 between) (v4 summaries)."""
    return _rs_plural(n, word).replace(" ", _RS_NBSP, 1)


def _rs_ago(n: int) -> str:
    """``today`` / ``1 bar ago`` / ``n bars ago`` (the readout's barsAgo rule)."""
    n = int(n)
    return "today" if n == 0 else f"{_rs_plural(n, 'bar')} ago"


def _rs_bar_ymd(t) -> str | None:
    """A bar time (YYYYMMDD key or unix seconds) as ``YYYYMMDD``; None when unreadable."""
    iso = _bar_date_iso(t) if t is not None else ""
    return iso.replace("-", "") if len(iso) == 10 else None


def _rs_short_date(ymd: str | None) -> str | None:
    """``20261104`` → ``Nov 4``."""
    try:
        return f"{_RS_MONTHS[int(ymd[4:6]) - 1]} {int(ymd[6:8])}"
    except (TypeError, ValueError, IndexError):
        return None


def _rs_zero_cross_dot(values, cross_up) -> list:
    """``0.0`` where the Mansfield line crossed UP through zero and has a value,
    else ``None``: the Trend preset's cross dot, centred on the zero guide (A2)."""
    out = [None] * len(values)
    for i, (v, e) in enumerate(zip(values, cross_up)):
        if e == 1.0 and _rs_num(v):
            out[i] = 0.0
    return out


# The Benchmark row's muted second line (Phase 2a visual spec, rows 1 and A8):
# the server's `benchmark.fallback` reason in sentence form. A reason this table
# does not know still prints, in the generic shape, rather than vanishing.
_RS_AUTO_NOUN = {"SECTOR": "Sector ETF", "INDUSTRY": "Industry group", "SECTOR_PICK": "Sector",
                 "THEME": "Theme", "THEME_PICK": "Theme"}
_RS_FALLBACK_SENTENCE = {
    # 2026-11-12: the sector and theme benchmarks. A theme reason may carry the
    # sector's own after "; " (an ETF, an unmapped sector): the THEME reason
    # leads, and the sentence still ends on what is actually used.
    "no sector picked": "No sector picked; using {resolved}",
    "no theme": "No UCT theme for this stock; using {resolved}",
    "no theme picked": "No theme picked; using {resolved}",
    "theme not found": "That theme no longer exists; using {resolved}",
    "theme too small": "Theme too small to average; using {resolved}",
    "symbol is an ETF": "{noun} not available for an ETF; using {resolved}",
    "no sector": "{noun} not available: no sector on file; using {resolved}",
    "no industry": "{noun} not available: no industry on file; using {resolved}",
    "no industry or sector": "{noun} not available: no industry or sector on file; using {resolved}",
    "industry group too small": "Industry group too small to average; using {resolved}",
    # Phase 3 (D4): "Your symbol" was picked with the box left empty.
    "no custom symbol": "No symbol entered for Your symbol; using {resolved}",
}


def _rs_benchmark_note(bench: dict, legend: dict, times, *, intraday: bool,
                       same_symbol: bool = False) -> str | None:
    """The Benchmark row's second line, or None.

    A benchmark gap wins (A8): when the RS line has no value on the newest bar,
    ``No SPY bar for Nov 5 yet`` says why the label is muted and dated. Daily,
    weekly and monthly only: an intraday gap is one bar wide and names no date a
    member could check, and a chart of the benchmark itself has no ratio to be
    missing (its state says so). Otherwise the fallback reason as a sentence
    (``Sector ETF not available for an ETF; using SPY``).

    A resolver ``note`` wins over both (unit 3-06): a custom benchmark the pod
    holds no bars for yet says ``No SMH bars yet; they usually load within a
    minute`` rather than the gap sentence. No v3 benchmark carries a note."""
    if bench.get("note"):
        return str(bench["note"])
    resolved = str(bench.get("resolved") or "")
    idx = legend.get("index") if isinstance(legend, dict) else None
    gap = bool(times) and (not isinstance(idx, int) or idx < len(times) - 1)
    if (gap and not intraday and not same_symbol and resolved and not resolved.startswith("INDUSTRY:")
            and not resolved.startswith("THEME:")):
        day = _rs_short_date(_rs_bar_ymd(times[-1]))
        if day:
            return f"No {resolved} bar for {day} yet"
    reason = bench.get("fallback")
    if not reason:
        return None
    reason = str(reason).split("; ", 1)[0]     # a theme reason leads a chained one
    noun = _RS_AUTO_NOUN.get(str(bench.get("requested") or "").upper(), "Benchmark")
    shape = _RS_FALLBACK_SENTENCE.get(str(reason))
    if shape is None and str(reason).startswith("sector not mapped: "):
        return f"{noun} not available for the {str(reason)[19:]} sector; using {resolved}"
    return (shape or "{noun} not available: {reason}; using {resolved}").format(
        noun=noun, resolved=resolved, reason=reason)


def _rs_legend(leg: dict, times, params: dict) -> dict:
    """`relative_strength.legend_scalars` plus what the RS line row prints (A1,
    A8): ``asOf`` (YYYYMMDD of the bar the scalars were read at, the last bar
    with a finite RS value), ``stale`` (that bar is not the newest one, a
    benchmark gap) and ``summary`` (``above its 21 EMA by 6.8%`` /
    ``below its 50 SMA by 2.1%`` / ``at its 21 EMA``, with `` · as of Nov 4``
    when stale). The length and type are the instance's own."""
    out = dict(leg)
    idx = out.get("index")
    asof = _rs_bar_ymd(times[idx]) if isinstance(idx, int) and 0 <= idx < len(times) else None
    out["asOf"] = asof
    out["stale"] = bool(isinstance(idx, int) and idx < len(times) - 1)
    pct, above = out.get("pctFromMa"), out.get("above")
    summary = None
    if _rs_num(pct) and above is not None:
        avg = f"its {int(params.get('maLength') or 0)} {str(params.get('maType') or '').upper()}"
        mag = f"{abs(pct):.1f}"
        if float(mag) == 0.0:
            summary = f"at {avg}"
        else:
            summary = f"{'above' if above else 'below'} {avg} by {mag}%"
        if out["stale"] and _rs_short_date(asof):
            summary += f" · as of {_rs_short_date(asof)}"
    out["summary"] = summary
    return out


def _rs_last_high(last: dict | None, lookback: int, bars_held: int, *, intraday: bool, why: str | None) -> dict:
    """`relative_strength.last_rs_high`, always a dict, plus ``summary`` (A1):
    ``today · before price`` / ``1 bar ago · before price · red day`` /
    ``38 bars ago`` / ``none in the last 252 bars``. A short history that cannot
    hold a full-lookback high says so (``needs 252 bars (has 180)``); intraday and
    the no-ratio states carry their reason."""
    out = dict(last) if last else {"index": None, "time": None, "beforePrice": None,
                                     "redDay": None, "barsAgo": None}
    if why:
        summary = why
    elif intraday:
        summary = "not read on intraday charts"
    elif last:
        parts = [_rs_ago(last["barsAgo"])]
        if last.get("beforePrice"):
            parts.append("before price")
        if last.get("redDay"):
            parts.append("red day")
        summary = " · ".join(parts)
    elif bars_held < lookback:
        summary = f"needs {_rs_plural(lookback, 'bar')} (has {bars_held})"
    else:
        summary = f"none in the last {_rs_plural(lookback, 'bar')}"
    out["summary"] = summary
    return out


def _rs_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _rs_mansfield_length(raw) -> int:
    from api.services import relative_strength as rsmod
    lo, hi = rsmod.MANSFIELD_LENGTH_RANGE
    try:
        f = float(raw)
    except (TypeError, ValueError):
        f = float(rsmod.DEFAULT_MANSFIELD_LENGTH)
    if not math.isfinite(f):
        f = float(rsmod.DEFAULT_MANSFIELD_LENGTH)
    return int(round(min(float(hi), max(float(lo), f))))


def _rs_mansfield_scalars(mans: dict, length: int) -> dict:
    """The last bar's Mansfield reading in words and numbers.

    Visual round A1 (2026-11-06) adds ``slope`` (1 / -1 / 0 against the bar
    before), ``crossDirection`` + ``lastCross`` (``up, 57 bars ago``; the last
    zero cross in EITHER direction, from the event columns) and ``summary``
    (``+18.7%, above zero, falling``): sign and slope spelled out, because the
    state word ``neutral`` beside +18.7% read as a contradiction. ``stateLabel``
    stays for any reader of the old field."""
    series = mans.get("mansfield") or [None]
    value = series[-1]
    state = (mans.get("mansfieldState") or [None])[-1]
    age = (mans.get("mansfieldCrossBarsAgo") or [None])[-1]
    labels = {1: "bull", -1: "bear", 0: "neutral"}
    slope = None
    if _rs_num(value) and len(series) >= 2 and _rs_num(series[-2]):
        d = float(value) - float(series[-2])
        slope = 1 if d > 0 else (-1 if d < 0 else 0)
    up = mans.get("mansfieldCrossUp") or []
    down = mans.get("mansfieldCrossDown") or []
    direction = cross_ago = None
    for i in range(max(len(up), len(down)) - 1, -1, -1):
        if i < len(up) and up[i] == 1.0:
            direction = "up"
        elif i < len(down) and down[i] == 1.0:
            direction = "down"
        else:
            continue
        cross_ago = max(len(up), len(down)) - 1 - i
        break
    summary = None
    if _rs_num(value):
        text = _rs_pct(float(value))
        where = "at zero" if text == "0.0%" else ("above zero" if value > 0 else "below zero")
        summary = f"{text}, {where}"
        if slope is not None:
            summary += ", " + {1: "rising", -1: "falling", 0: "flat"}[slope]
    return {
        "value": float(value) if _rs_num(value) else None,
        "aboveZero": (value >= 0) if _rs_num(value) else None,
        "state": int(state) if state is not None else None,
        "stateLabel": labels.get(state) if state is not None else None,
        "crossBarsAgo": int(age) if _rs_num(age) else None,
        "length": int(length),
        "lengthText": _rs_plural(int(length), "bar"),
        "slope": slope,
        "crossDirection": direction,
        "lastCross": f"{direction}, {_rs_ago(cross_ago)}" if direction else None,
        "summary": summary,
    }


#: How long one read of the data generation serves (`_rs_data_generation`).
_RS_GEN_TTL_S = 30.0
_RS_GEN_MEMO: dict = {"at": None, "value": None}
_RS_GEN_LOCK = threading.Lock()


def _rs_newest_rating_session():
    """The newest session in `rs_history.TABLE`, by its own PRIMARY KEY read
    (``MAX(session)`` over ``PRIMARY KEY (session, ticker)`` is one b-tree
    seek). Read-only: never creates the table, so a dark pod stays without one;
    a missing table or any failure is None. rs_history.py does not change."""
    try:
        from contextlib import closing
        from api.services.screener import rs_history, snapshot_db
        with closing(snapshot_db.connect()) as conn:
            row = conn.execute(f"SELECT MAX(session) FROM {rs_history.TABLE}").fetchone()
        return row[0] if row else None
    except Exception:                                  # noqa: BLE001 — no table on a dark pod is the normal case
        return None


def _rs_evidence_asof():
    try:
        from api.services import rs_evidence_pull as ep
        art = ep.load_local()
        return art.get("asof") if isinstance(art, dict) else None
    except Exception:                                  # noqa: BLE001
        return None


def _rs_data_generation(now: float | None = None) -> str:
    """``r<newest rating session>|e<evidence asof>`` for the v2 cache key
    (review #16). Memoised in-process for `_RS_GEN_TTL_S` seconds, so a chart
    request pays one SQLite seek and one ``os.stat`` at most twice a minute,
    and a new rating session or artifact is seen within that window. Never
    raises; an unknown part is ``-``."""
    t = time.monotonic() if now is None else float(now)
    with _RS_GEN_LOCK:
        at = _RS_GEN_MEMO["at"]
        if at is not None and 0 <= t - at < _RS_GEN_TTL_S and _RS_GEN_MEMO["value"] is not None:
            return _RS_GEN_MEMO["value"]
    rating = _rs_newest_rating_session()
    asof = _rs_evidence_asof()
    value = f"r{rating if rating is not None else '-'}|e{asof if asof is not None else '-'}"
    with _RS_GEN_LOCK:
        _RS_GEN_MEMO.update(at=t, value=value)
    return value


#: The rating's component ranks as `rs_history` stores them, and the label each
#: prints under in the Components row (plan §6.6: ``1M 91 · 3M 97 · 6M 95 · 12M 96``).
#: Each is a 1 to 99 percentile, ranked like the rating: a RANK, never a return. 1M is
#: of the plain 21-bar return; 3M is of the equal-weighted average of the 1-, 2- and 3-month
#: ratios (`rs_weighted_return.EQUAL_WEIGHT_COMPONENT_TERMS`); 6M, 9M and 12M are of the
#: recency-weighted blend (newest quarter double, `rs_weighted_return.IBD_STYLE_COMPONENT_TERMS`).
_RS_COMPONENTS: tuple[tuple[str, str], ...] = (("m1", "1M"), ("m3", "3M"), ("m6", "6M"), ("m12", "12M"))
#: The v4 envelope's five (Deepvue round 2, 2026-11-08): the 9-month rank (the
#: recency-weighted 63/126/189-bar blend, `rs_history.component_values`) between 6M and 12M, so
#: the Components row reads ``1M 91 · 3M 97 · 6M 95 · 9M 96 · 12M 96`` and the RS
#: pane's ranks strip carries its 9M column. The v3 payload keeps the four.
_RS_COMPONENTS_V4: tuple[tuple[str, str], ...] = (
    ("m1", "1M"), ("m3", "3M"), ("m6", "6M"), ("m9", "9M"), ("m12", "12M"))


def _rs_rating(sym: str, nine: bool = False) -> dict:
    """``{ibd, fast, asof, d5, d20, m1, m3, m6, m12, source, summary, components}``
    from `rs_history.read_fields`, plus ``m9`` when ``nine`` (the v4 envelope).

    ``source`` is ``row`` when the history table holds the symbol, ``dark`` when
    `RS_HISTORY_ENABLED` is off (the table is never written on a dark pod) and
    ``missing`` when it is on and the symbol has no row yet. Never raises and
    never fabricates a number: every value is ``None`` until a row exists, and a
    component the row does not hold (a young listing has no 12-month rank) stays
    ``None`` and is left out of ``components``.
    """
    comps = _RS_COMPONENTS_V4 if nine else _RS_COMPONENTS
    out = {"ibd": None, "fast": None, "asof": None, "d5": None, "d20": None,
           **{k: None for k, _ in comps}, "source": "missing"}
    dark = os.environ.get("RS_HISTORY_ENABLED", "0") != "1"
    row: dict = {}
    try:
        from api.services.screener import rs_history
        row = (rs_history.read_fields([sym]) or {}).get(str(sym or "").upper()) or {}
    except Exception:                                  # noqa: BLE001 — the rating is a garnish, never a 500
        logger.exception("signature: rs rating read failed for %s", sym)
        row = {}
    if row and (row.get("ibd") is not None or row.get("fast") is not None):
        for k in ("ibd", "fast", "d5", "d20") + tuple(k for k, _ in comps):
            v = row.get(k)
            out[k] = int(v) if _rs_num(v) else None
        out["asof"] = row.get("asof")
        out["source"] = "row"
    else:
        out["source"] = "dark" if dark else "missing"
    out["summary"] = _rs_rating_summary(out["ibd"], out["fast"])
    out["components"] = _rs_components_summary(out, comps)
    return out


def _rs_components_summary(rating: dict, comps=_RS_COMPONENTS) -> str | None:
    """The Components row (plan §6.6): ``1M 91 · 3M 97 · 6M 95 · 12M 96`` (v4:
    ``... · 9M 96 · 12M 96``), the component ranks that exist in order; None when
    none does (the row is omitted)."""
    parts = [f"{label} {rating[k]}" for k, label in comps if rating.get(k) is not None]
    return " · ".join(parts) or None


# ── the RS Rating Reading (Deepvue round 2, 2026-11-08; `compute.rev` 5) ─────
#
# Deepvue draws the rating itself as a line. This Reading plots the stock's
# stored daily IBD-style rating (1-99, the nightly `rs_rating_history` row) at
# each bar's session, its 21-session average, and says where it stands now and
# how far it moved in 20 stored sessions (the `rating.d20` rule: stored
# sessions, not calendar days). Daily charts only: the rating is stored once a
# session. Nothing is fabricated: a bar whose session has no stored row is null.

#: The average's length, in stored sessions: a trading month, the RS line's own
#: default average (`relative_strength.DEFAULT_MA_LENGTH`).
_RS_RATING_MA = 21
#: The change the summary states: the rating minus its value this many stored
#: sessions earlier (the same span as `rating.d20`).
_RS_RATING_CHANGE = 20


def _rs_rating_view_unavailable(reason: str) -> dict:
    return {"value": None, "average": None, "change20": None, "sessions": 0, "asof": None,
            "stale": None, "summary": reason, "reason": reason}


def _rs_rating_view(sym: str, times: list, store: str, view: str, stages: dict) -> dict:
    """``{"columns": {ratingLine, ratingMa}, "block": payload.ratingHistory}``.

    Reads the history ONLY when ``view == "rating"``, the chart is daily and
    `RS_HISTORY_ENABLED` is on; every other case returns blank columns and a
    reason (no read at all). The one read is `rs_history.rating_series`: this
    ticker's newest ``len(times) + 20`` stored sessions ending at the newest
    bar's session, one walk of the ``(ticker, session)`` index, its time added
    to the ``rating`` stage. The average is the plain mean of 21 consecutive
    stored values, null until 21 exist (never a shorter mean)."""
    n = len(times)
    cols = {k: [None] * n for k in registry_defs.RS_RATING_WIRE_COLUMNS}

    def unavailable(reason: str) -> dict:
        return {"columns": cols, "block": _rs_rating_view_unavailable(reason)}

    if view != "rating":
        return unavailable("not the chosen reading")
    if store != "D":
        return unavailable("daily charts only")
    if not n:
        return unavailable("no bars for this symbol")
    if os.environ.get("RS_HISTORY_ENABLED", "0") != "1":
        return unavailable("the rating history is not switched on")
    ymds = [_rs_bar_ymd(t) for t in times]
    newest = next((y for y in reversed(ymds) if y), None)
    t = time.perf_counter()
    try:
        from api.services.screener import rs_history
        series = rs_history.rating_series(sym, upto=newest, limit=n + _RS_RATING_MA - 1)
    except Exception:                                  # noqa: BLE001 — a garnish, never a 500
        logger.exception("signature: rs rating series read failed for %s", sym)
        series = []
    finally:
        stages["rating"] = stages.get("rating", 0.0) + (time.perf_counter() - t) * 1000.0
    vals = [v for _s, v in series]
    if not any(_rs_num(v) for v in vals):
        return unavailable("not yet rated")
    ma: list = [None] * len(vals)
    for i in range(_RS_RATING_MA - 1, len(vals)):
        w = vals[i - _RS_RATING_MA + 1:i + 1]
        if all(_rs_num(v) for v in w):
            ma[i] = sum(w) / float(_RS_RATING_MA)
    at = {str(s).replace("-", ""): i for i, (s, _v) in enumerate(series)}
    for i, y in enumerate(ymds):
        j = at.get(y) if y else None
        if j is not None and _rs_num(vals[j]):
            cols["ratingLine"][i] = int(vals[j])
            cols["ratingMa"][i] = ma[j]
    idx = max(i for i, v in enumerate(vals) if _rs_num(v))
    value = int(vals[idx])
    prior = vals[idx - _RS_RATING_CHANGE] if idx >= _RS_RATING_CHANGE else None
    change = value - int(prior) if _rs_num(prior) else None
    held = sum(1 for v in cols["ratingLine"] if v is not None)
    if change is None:
        have = sum(1 for v in vals[:idx + 1] if _rs_num(v))
        text = f"{value}, {_rs_count(have, 'session')} of history"
    elif change > 0:
        text = f"{value}, up{_RS_NBSP}{change} in {_rs_count(_RS_RATING_CHANGE, 'session')}"
    elif change < 0:
        text = f"{value}, down{_RS_NBSP}{-change} in {_rs_count(_RS_RATING_CHANGE, 'session')}"
    else:
        text = f"{value}, unchanged in {_rs_count(_RS_RATING_CHANGE, 'session')}"
    asof = str(series[idx][0])
    stale = asof.replace("-", "") != newest
    if stale and _rs_short_date(asof.replace("-", "")):
        text += f" · as of {_rs_short_date(asof.replace('-', '')).replace(' ', _RS_NBSP)}"
    return {"columns": cols, "block": {
        "value": value, "average": round(ma[idx], 2) if ma[idx] is not None else None,
        "change20": change, "sessions": held, "asof": asof, "stale": stale,
        "summary": text, "reason": None}}


def _rs_rating_summary(ibd, fast) -> str | None:
    """The Rating row (A1): ``94 · fast 91`` / ``fast 91 · nightly pending`` /
    ``94`` / None when neither exists (the row prints its muted fallback)."""
    if ibd is not None and fast is not None:
        return f"{ibd} · fast {fast}"
    if fast is not None:
        return f"fast {fast} · nightly pending"
    if ibd is not None:
        return f"{ibd}"
    return None


def _rs_evidence() -> dict:
    """``payload.evidence`` (unit 2b-03): what the worker's evidence job measured
    for each readout card's signal, read from the artifact the 04:30 ET pull
    lands at ``<DATA_DIR>/rs_evidence.json`` (`rs_evidence_pull.load_local`,
    one ``os.stat`` per call, parsed once per file).

    ``{asof, horizon, signals: {rsHigh, beforePrice, redDay, phase, mansfield},
    sentence: {same keys}, baseline, source}``. Each ``signals[key]`` is
    `rs_evidence_pull.evidence_for` for the card's signal (`CARD_SIGNALS`:
    rsHigh -> rs_new_high, beforePrice -> rs_new_high_before_price, redDay ->
    rs_new_high_red_day, phase -> rs_cross_up_21ema, mansfield ->
    mansfield_cross_up) at the 63-bar horizon, or None when the artifact is
    absent or carries no block for it. Each ``sentence[key]`` is the card's
    evidence sentence (`rs_evidence_pull.sentence_for`): the measured one, with
    its baseline, when the EFFECTIVE n (events capped by the distinct sessions
    they fell on) clears the artifact's own display floor; what was measured
    and why it is withheld when it does not; `HONESTY_SENTENCE` when the
    artifact has no block for the signal. ``baseline`` is the all-bars
    hit rate the signal is read against. ``source`` is ``artifact`` or ``none``.
    Never raises and never fabricates: absent means every signal None and every
    sentence the honesty line, so a card can point at
    ``scalar:evidence.sentence.<key>`` and always print something true.
    """
    from api.services import rs_evidence_pull as ep
    keys = tuple(ep.CARD_SIGNALS)

    def _empty() -> dict:
        return {"asof": None, "horizon": ep.DEFAULT_HORIZON,
                "signals": {k: None for k in keys},
                "sentence": {k: ep.HONESTY_SENTENCE for k in keys},
                "baseline": None, "source": "none"}

    try:
        art = ep.load_local()
        if not art:
            return _empty()
        signals = {k: ep.evidence_for(name, ep.DEFAULT_HORIZON, art) for k, name in ep.CARD_SIGNALS.items()}
        return {"asof": art.get("asof"), "horizon": ep.DEFAULT_HORIZON,
                "signals": signals,
                "sentence": {k: ep.sentence_for(ev) for k, ev in signals.items()},
                "baseline": ep.baseline_for(ep.DEFAULT_HORIZON, art), "source": "artifact"}
    except Exception:                                  # noqa: BLE001 -- the evidence is a garnish, never a 500
        logger.exception("signature: rs evidence read failed")
        return _empty()


def _rs_theme(groups: dict) -> dict | None:
    """The symbol's sector / industry label from the same map `rs_benchmarks`
    resolves SECTOR through; ``None`` when the map knows nothing. An ETF is
    filed under industry ``Exchange Traded Fund`` by the map's source, so its
    theme says so rather than printing the sector every ETF shares."""
    from api.services import rs_benchmarks
    sector = (groups or {}).get("sector")
    industry = (groups or {}).get("industry")
    if not sector and not industry:
        return None
    if (industry or "") == rs_benchmarks.ETF_INDUSTRY:
        return {"sector": None, "industry": industry, "etf": None,
                "label": "Exchange-traded fund", "note": "symbol is an ETF"}
    etf = rs_benchmarks.SECTOR_ETF.get(sector or "")
    label = industry or sector
    if etf:
        label = f"{label} ({etf})"
    return {"sector": sector, "industry": industry, "etf": etf, "label": label, "note": None}


def _rs_closes(bars) -> list:
    return [float(b["c"]) for b in bars if _rs_num(b.get("c"))]


def _rs_sma_last(values: list, n: int):
    if len(values) < n or n <= 0:
        return None
    return sum(values[-n:]) / n


def _rs_regime_unavailable(reason: str) -> dict:
    """The regime for a chart that cannot have one (a non-daily store, the
    benchmark is the symbol, no benchmark bars). The reason IS the label
    (review #24, 2026-11-07): left None, the readout printed its declared
    "needs more history" fallback on AAPL weekly with 20 years of bars. The
    ``reason`` is None, as on every labelled regime, so the readout does not
    print the same words twice."""
    return {"label": reason, "above200": None, "trend2y": None, "volTercile": None,
            "pctFrom200": None, "return2y": None, "bars": 0, "reason": None}


def _rs_regime_bench_bars(sym: str, requested: str, tf: str, count: int, bench: dict,
                          fetch_bars, custom: str | None = None, picks: dict | None = None) -> list:
    """The chart benchmark's bars at `_RS_REGIME_BARS` depth, whatever the RS
    lookback (review #19). The bars already in hand serve when they were read at
    least that deep; otherwise the same benchmark is resolved again at the fixed
    depth. Either way the regime reads the last `_RS_REGIME_BARS` closes, so the
    block is identical at every lookback. A failed or mismatched re-read falls
    back to the bars in hand: a shorter regime with its reason, never a 500.
    ``custom`` is the v4 custom ticker (unit 3-06), re-resolved without a warm
    (the chart's own resolve already asked for one). ``picks`` (2026-11-12,
    v4 only) is ``{"sector", "theme", "memo"}``, passed through the same way."""
    have = bench.get("bars") or []
    # ⭐ 2026-11-12: a COMPOSITE (industry or theme) is never re-resolved deeper.
    # A second build is one more bar read per member (up to 60), measured at
    # 30-60 s cold on the sandbox's store; the regime reads the composite in hand
    # (852 daily closes against the full 883: a slightly shorter volatility
    # distribution, never a missing block). Every ticker benchmark is unchanged.
    if str(bench.get("resolved") or "").startswith(("INDUSTRY:", "THEME:")):
        return list(have[-_RS_REGIME_BARS:])
    if count < _RS_REGIME_BARS:
        try:
            from api.services import rs_benchmarks
            if custom or picks:
                deep = rs_benchmarks.resolve_benchmark(sym, requested, tf, _RS_REGIME_BARS,
                                                       fetch_bars=fetch_bars, custom=custom,
                                                       **(picks or {}))
            else:
                deep = rs_benchmarks.resolve_benchmark(sym, requested, tf, _RS_REGIME_BARS,
                                                       fetch_bars=fetch_bars)
            if (str(deep.get("resolved") or "").upper() == str(bench.get("resolved") or "").upper()
                    and len(deep.get("bars") or []) > len(have)):
                have = deep["bars"]
        except Exception:                              # noqa: BLE001 — the regime is a garnish
            logger.exception("signature: rs regime benchmark read failed for %s", sym)
    return list(have[-_RS_REGIME_BARS:])


def _rs_regime(bench_closes: list) -> dict:
    """Plan §7 item 21 over the BENCHMARK's own closes: above / below its
    200-day average, the sign of the 504-bar return, and the 126-session
    realised-volatility tercile against its own trailing three-year distribution.
    ``persistence`` = above the 200-day with a positive two-year trend;
    ``rebound risk`` = negative two-year trend in the high-vol tercile (the
    Daniel-Moskowitz panic state); ``mixed`` otherwise. The label is printed
    verbatim, so it is spelled as words (A1: was ``rebound-risk``). ``label`` is ``None``
    with a ``reason`` while the bars cannot decide it."""
    closes = [float(c) for c in bench_closes if _rs_num(c)]
    n = len(closes)
    out = {"label": None, "above200": None, "trend2y": None, "volTercile": None,
           "pctFrom200": None, "return2y": None, "bars": n, "reason": None}
    reasons: list[str] = []
    sma = _rs_sma_last(closes, _RS_SMA_LONG)
    if sma:
        out["above200"] = closes[-1] > sma
        out["pctFrom200"] = (closes[-1] / sma - 1.0) * 100.0
    else:
        reasons.append(f"needs {_RS_SMA_LONG} bars for the 200-day average (have {n})")
    if n > _RS_TREND_BARS and closes[-1 - _RS_TREND_BARS] > 0:
        r = closes[-1] / closes[-1 - _RS_TREND_BARS] - 1.0
        out["trend2y"] = 1 if r > 0 else (-1 if r < 0 else 0)
        out["return2y"] = r * 100.0
    else:
        reasons.append(f"needs {_RS_TREND_BARS + 1} bars for the two-year trend (have {n})")
    samples = _rs_realised_vol_series(closes, _RS_VOL_WINDOW)
    if len(samples) >= _RS_VOL_DIST_MIN + 1:
        current = samples[-1]
        dist = samples[-1 - _RS_VOL_DIST_MAX:-1]
        below = sum(1 for v in dist if v < current)
        share = below / len(dist)
        out["volTercile"] = "low" if share < 1.0 / 3.0 else ("high" if share >= 2.0 / 3.0 else "mid")
        out["volPct"] = share * 100.0
        out["volSamples"] = len(dist)
    else:
        reasons.append(f"needs {_RS_VOL_WINDOW + _RS_VOL_DIST_MIN + 1} bars for the volatility tercile (have {n})")
    if out["above200"] is not None and out["trend2y"] is not None:
        if out["above200"] and out["trend2y"] > 0:
            out["label"] = "persistence"
        elif out["trend2y"] < 0 and out["volTercile"] == "high":
            out["label"] = "rebound risk"
        elif out["trend2y"] < 0 and out["volTercile"] is None:
            pass                                       # rebound-risk or mixed: the tercile decides
        else:
            out["label"] = "mixed"
    if out["label"] is None:
        out["reason"] = "; ".join(reasons) if reasons else "the volatility tercile is needed to label a down trend"
    return out


def _rs_realised_vol_series(closes: list, window: int) -> list:
    """Annualised realised volatility of log returns over a trailing ``window``,
    one sample per bar once the window is full (population std, sqrt(252))."""
    rets: list[float] = []
    for a, b in zip(closes, closes[1:]):
        rets.append(math.log(b / a) if a > 0 and b > 0 else 0.0)
    if len(rets) < window:
        return []
    # Each window is computed whole (two passes, population variance). A rolling
    # subtract-and-add sum is refused in this backend (single-authority rail) and
    # drifts on a running sum of squares; n x window here is at most ~1,600 x 126.
    out: list[float] = []
    for i in range(window, len(rets) + 1):
        w = rets[i - window:i]
        mean = sum(w) / window
        var = sum((r - mean) * (r - mean) for r in w) / window
        out.append(math.sqrt(var) * math.sqrt(252.0))
    return out


def _rs_sensitivity_unavailable(reason: str) -> dict:
    from api.services import relative_strength as rsmod
    return {"window": rsmod.DEFAULT_SENSITIVITY_WINDOW, "spy": None, "rsp": None, "sector": None,
            "reasons": {"spy": reason, "rsp": reason, "sector": reason},
            "legs": {"spy": reason, "rsp": reason, "sector": reason},
            "agree": None, "summary": None}


def _rs_slope_leg(bars, leg_bars, window: int, name: str, rs=None):
    """``(leg, reason, note)``: the leg, or None with its ``reason`` (the long
    form `reasons` keeps) and its ``note`` (the short form the Agreement summary
    prints after ``<ticker>: ``). ``rs`` is the caller's ``rs_line(bars,
    leg_bars)`` when it has already joined them (one join per leg, not two)."""
    from api.services import relative_strength as rsmod
    if rs is None:
        rs = rsmod.rs_line(bars, leg_bars)
    if len(rs) < window:
        return (None, f"needs {window} bars of RS against {name} (have {len(rs)})",
                f"needs {_rs_plural(window, 'bar')} (has {len(rs)})")
    tail = rs[-window:]
    if any(v is None for v in tail):
        return None, f"a gap in the last {window} bars against {name}", f"gap in last {_rs_plural(window, 'bar')}"
    slope = rsmod._slope(tail)
    if slope is None:
        return None, f"no slope against {name}", "no slope"
    sign = 1 if slope > 0 else (-1 if slope < 0 else 0)
    return {"sign": sign, "slope": slope, "word": {1: "rising", -1: "falling", 0: "flat"}[sign]}, None, None


def _rs_sensitivity(sym: str, bars, bench: dict, tf: str, count: int, groups: dict, fetch_bars) -> dict:
    """Plan §7 item 22: the sign of the 20-bar RS slope against SPY, RSP and the
    sector ETF. A leg whose benchmark has no bars (or, for an ETF, no sector of
    its own) is ``None`` with its reason; ``agree`` is `benchmark_agree`'s last
    value when all three legs exist. The bars already fetched for the chart's
    own benchmark are reused rather than read twice."""
    from api.services import relative_strength as rsmod
    from api.services import rs_benchmarks
    window = rsmod.DEFAULT_SENSITIVITY_WINDOW
    resolved = str(bench.get("resolved") or "").upper()
    out = {"window": window, "spy": None, "rsp": None, "sector": None, "reasons": {},
           "agree": None, "summary": None}
    #: the short form of a missing leg, ``(label, note)``: ``RSP: no bars``,
    #: ``sector: none for an ETF``. The long ``reasons`` stay as they were.
    notes: dict[str, tuple[str, str]] = {}

    def leg_bars(ticker: str):
        if ticker == resolved and bench.get("bars"):
            return bench["bars"]
        try:
            return fetch_bars(ticker, tf, count) or []
        except Exception:                              # noqa: BLE001 — one missing leg is a reason, not a 500
            logger.exception("signature: rs sensitivity fetch failed for %s", ticker)
            return []

    legs: dict[str, tuple] = {}
    for key, ticker in (("spy", "SPY"), ("rsp", "RSP")):
        lb = leg_bars(ticker)
        if not lb:
            out["reasons"][key] = f"no {ticker} bars"
            notes[key] = (ticker, "no bars")
            continue
        legs[key] = (ticker, lb)
    industry = (groups or {}).get("industry") or ""
    sector = (groups or {}).get("sector")
    etf = rs_benchmarks.SECTOR_ETF.get(sector or "")
    if industry == rs_benchmarks.ETF_INDUSTRY:
        out["reasons"]["sector"] = "symbol is an ETF"
        notes["sector"] = ("sector", "none for an ETF")
    elif not etf:
        out["reasons"]["sector"] = "no sector" if not sector else f"sector not mapped: {sector}"
        notes["sector"] = ("sector", "none known" if not sector else f"{sector} not mapped")
    else:
        lb = leg_bars(etf)
        if not lb:
            out["reasons"]["sector"] = f"no {etf} bars"
            notes["sector"] = (etf, "no bars")
        else:
            legs["sector"] = (etf, lb)
    series: dict[str, list] = {}
    for key, (ticker, lb) in legs.items():
        rs = rsmod.rs_line(bars, lb)                   # joined once: the leg's slope and the agreement read it
        leg, why, note = _rs_slope_leg(bars, lb, window, ticker, rs=rs)
        if leg is None:
            out["reasons"][key] = why
            notes[key] = (ticker, note)
            continue
        leg["ticker"] = ticker
        out[key] = leg
        series[key] = rs
    if all(k in series for k in ("spy", "rsp", "sector")):
        # Only the newest bar is read: the whole per-bar column was the largest single
        # item of a cold compute (`relative_strength.benchmark_agree_last`).
        agree = rsmod.benchmark_agree_last(series["spy"], series["rsp"], series["sector"], window)
        out["agree"] = (agree == 1.0) if agree is not None else None
    # The Agreement card's numbers block, one value per leg (A1): SPY
    # ``rising`` / RSP ``no bars`` / Sector ``XLK rising`` or ``none for an ETF``.
    out["legs"] = {k: ((out[k]["word"] if k != "sector" else f"{out[k]['ticker']} {out[k]['word']}")
                       if out[k] else (notes[k][1] if k in notes else out["reasons"].get(k)))
                   for k in ("spy", "rsp", "sector")}
    out["summary"] = _rs_sensitivity_summary(out, notes)
    return out


def _rs_and(names: list) -> str:
    """``SPY`` / ``SPY and XLK`` / ``SPY, RSP and XLK``."""
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _rs_sensitivity_summary(out: dict, notes: dict) -> str | None:
    """The Agreement row (A1): ``SPY, RSP and XLK all rising`` /
    ``split: SPY rising, RSP falling, XLK rising`` / ``SPY and XLK rising; RSP:
    no bars``. Legs that share one word are grouped; a missing leg follows a
    semicolon as ``<ticker>: <short reason>``."""
    keys = ("spy", "rsp", "sector")
    present = [k for k in keys if out[k]]
    missing = [f"{notes[k][0]}: {notes[k][1]}" for k in keys if not out[k] and k in notes]
    if not present:
        return "; ".join(missing) or None
    words = {out[k]["word"] for k in present}
    names = [out[k]["ticker"] for k in present]
    if len(words) == 1:
        word = words.pop()
        head = f"{_rs_and(names)} all {word}" if len(names) == 3 else f"{_rs_and(names)} {word}"
    else:
        head = "split: " + ", ".join(f"{out[k]['ticker']} {out[k]['word']}" for k in present)
    return "; ".join([head] + missing)


def _rs_checks_unavailable(reason: str) -> dict:
    """The checks for a chart that cannot run them. ``summary`` carries the
    reason (review #24), so the readout never shows its "needs more history"
    fallback for a known reason; each check keeps it too."""
    blank = {"pass": None, "reason": reason, "line": reason}
    return {"ma": dict(blank), "anchor": dict(blank), "pivotSpeed": dict(blank), "greenOnRed": dict(blank),
            "pullbackEma8": None, "passed": 0, "of": 0, "summary": reason}


def _rs_pct(v) -> str:
    """One decimal, a sign on a non-zero value, never ``-0.0%`` (the readout's
    ``pct`` rule, so a number reads the same on the server and the client)."""
    s = f"{v:.1f}"
    if float(s) == 0.0:
        return "0.0%"
    return f"+{s}%" if v > 0 else f"{s}%"


def _rs_check_line(check: dict) -> str:
    """A check's card line (A1): ``pass · <reason>`` / ``fail · <reason>``, or the
    reason alone while the check is undecided. Pass and fail are words."""
    p = check.get("pass")
    reason = check.get("reason") or ""
    return reason if p is None else f"{'pass' if p else 'fail'} · {reason}"


def _rs_checks(bars, bench_bars, bench_name: str, red_day_pct: float, *,
               anchor_date: str | None = None, today=None) -> dict:
    """Plan §7 item 23 (v3 §7.20), the four UCT checks as booleans with reasons:

    * ``ma``         the stock's distance from its 200-day average beats the
                     benchmark's (the 50-day pair is reported beside it);
    * ``anchor``     from the benchmark's lowest close of the last 20 sessions,
                     the stock has returned more than the benchmark;
    * ``pivotSpeed`` at least 5 of the last 10 red days closed in the top
                     third of their range;
    * ``greenOnRed`` at least 6 of the last 20 sessions were up on a red day.

    ``pullbackEma8`` (distance from the 8-day EMA) rides beside them as a number.
    A check the bars cannot answer is ``pass: None`` with the reason.

    ``anchor_date`` (v4 only, unit 3-06, decision D6): ``None`` is the v3 rule,
    byte for byte. A string adds ``source`` and ``date`` to the anchor: blank is
    the default 20-session low (``source: "default"``); a ``YYYY-MM-DD`` date
    anchors on the first session on or after it (``source: "picked"``,
    `_rs_anchor_picked`). ``today`` (a `datetime.date`, ET) is for tests.
    """
    from api.services import relative_strength as rsmod
    from api.services.indicator_compute import compute_ema
    out: dict = {}
    c = _rs_closes(bars)
    bc = _rs_closes(bench_bars)
    n = len(c)

    # ma
    s200, b200 = _rs_sma_last(c, _RS_SMA_LONG), _rs_sma_last(bc, _RS_SMA_LONG)
    s50, b50 = _rs_sma_last(c, _RS_SMA_SHORT), _rs_sma_last(bc, _RS_SMA_SHORT)
    if s200 and b200:
        sd, bd = (c[-1] / s200 - 1.0) * 100.0, (bc[-1] / b200 - 1.0) * 100.0
        ma = {"pass": sd > bd, "stock200": sd, "bench200": bd,
              "reason": f"stock {_rs_pct(sd)} vs its 200-day, {bench_name} {_rs_pct(bd)}"}
        if s50 and b50:
            ma["stock50"] = (c[-1] / s50 - 1.0) * 100.0
            ma["bench50"] = (bc[-1] / b50 - 1.0) * 100.0
    else:
        ma = {"pass": None, "reason": f"needs {_RS_SMA_LONG} bars of both (have {n} and {len(bc)})"}
    out["ma"] = ma

    # anchor: the benchmark's lowest close of the last 20 sessions, on the stock's calendar
    aligned = rsmod.benchmark_closes_aligned(bars, bench_bars)
    window = [(i, aligned[i]) for i in range(max(0, len(bars) - _RS_ANCHOR_WINDOW), len(bars))
              if aligned[i] is not None and _rs_num(bars[i].get("c"))]
    if len(window) >= 2 and aligned[-1] is not None and _rs_num(bars[-1].get("c")):
        a, _ = min(window, key=lambda p: p[1])
        sr = (float(bars[-1]["c"]) / float(bars[a]["c"]) - 1.0) * 100.0
        br = (aligned[-1] / aligned[a] - 1.0) * 100.0
        ago = len(bars) - 1 - a
        if ago == 0:
            # The low is TODAY (review #13, 2026-11-07): both returns are +0.0%,
            # and `sr > br` would score a FAIL on exactly the selloff days the
            # check is meant for. Undecided, with the reason, and out of the count.
            out["anchor"] = {"pass": None, "stock": sr, "bench": br, "anchorTime": bars[a].get("t"),
                             "barsAgo": 0,
                             "reason": f"{bench_name}'s {_RS_ANCHOR_WINDOW}-session low is today"}
        else:
            # A1: the value no longer opens with its label's words ("Since the
            # low"), and "1 bars ago" is "1 bar ago".
            out["anchor"] = {"pass": sr > br, "stock": sr, "bench": br, "anchorTime": bars[a].get("t"),
                             "barsAgo": ago,
                             "reason": f"stock {_rs_pct(sr)}, {bench_name} {_rs_pct(br)}; low was {_rs_ago(ago)}"}
    else:
        out["anchor"] = {"pass": None, "reason": f"needs {_RS_ANCHOR_WINDOW} sessions of both"}
    if anchor_date is not None:
        if str(anchor_date).strip():
            out["anchor"] = _rs_anchor_picked(bars, aligned, bench_name, str(anchor_date).strip(),
                                              today if today is not None else _et_now().date())
        else:
            out["anchor"].update(source="default", date=None)

    # pivot speed over the last ten red days
    red = rsmod.red_day_column(rsmod.pct_change(aligned), red_day_pct)
    hits = 0
    seen = 0
    for i in range(len(bars) - 1, -1, -1):
        if red[i] != 1.0:
            continue
        b = bars[i]
        h, l, cl = b.get("h"), b.get("l"), b.get("c")
        if not (_rs_num(h) and _rs_num(l) and _rs_num(cl)):
            continue
        seen += 1
        if h > l and (cl - l) / (h - l) >= _RS_PIVOT_TOP_SHARE:
            hits += 1
        if seen == _RS_PIVOT_RED_DAYS:
            break
    if seen == _RS_PIVOT_RED_DAYS:
        out["pivotSpeed"] = {"pass": hits >= _RS_PIVOT_PASS, "count": hits, "of": seen,
                             "reason": f"{hits} of the last {seen} red days closed in the top third"}
    else:
        out["pivotSpeed"] = {"pass": None, "count": hits, "of": seen,
                             "reason": f"only {_rs_plural(seen, 'red day')} in {_rs_plural(len(bars), 'bar')} "
                                       f"(needs {_RS_PIVOT_RED_DAYS})"}

    # green on red over the last twenty sessions
    stock_chg = rsmod.pct_change([float(b["c"]) if _rs_num(b.get("c")) else None for b in bars])
    gor = rsmod.both(red, rsmod.up_day_column(stock_chg))
    cnt = rsmod.rolling_count(gor, _RS_GREEN_ON_RED_WINDOW)[-1] if gor else None
    if cnt is not None:
        k = int(cnt)
        # The denominator is the RED DAYS in the window, counted on the same
        # 20 sessions (review #8, 2026-11-07): "3 of the last 20 red days" read a
        # true 3-of-4 as a weak 3-of-20. `of` stays the window, as the Checks card
        # and `green_on_red_20` describe it.
        reds = rsmod.rolling_count(red, _RS_GREEN_ON_RED_WINDOW)[-1]
        red_days = int(reds) if reds is not None else None
        where = f"in the last {_RS_GREEN_ON_RED_WINDOW} sessions"
        # A1 pluralisation: the noun follows the count it sits beside.
        if red_days == 0:
            reason = f"no red days {where}"
        elif red_days is not None:
            reason = f"up on {k} of {_rs_plural(red_days, 'red day')} {where}"
        else:
            reason = f"up on {_rs_plural(k, 'red day')} {where}"
        out["greenOnRed"] = {"pass": k >= _RS_GREEN_ON_RED_PASS, "count": k, "of": _RS_GREEN_ON_RED_WINDOW,
                             "redDays": red_days, "reason": reason}
    else:
        out["greenOnRed"] = {"pass": None, "reason": f"needs {_RS_GREEN_ON_RED_WINDOW + 1} sessions of both"}

    # pullback distance from the 8-day EMA
    pull = None
    if n >= _RS_PULLBACK_EMA:
        e = compute_ema(c, _RS_PULLBACK_EMA)[-1]
        if _rs_num(e) and e != 0:
            pull = (c[-1] / e - 1.0) * 100.0
    out["pullbackEma8"] = pull

    decided = [out[k]["pass"] for k in ("ma", "anchor", "pivotSpeed", "greenOnRed") if out[k]["pass"] is not None]
    out["passed"] = sum(1 for p in decided if p)
    out["of"] = len(decided)
    out["summary"] = f"{out['passed']} of {out['of']} pass" if decided else None
    for k in ("ma", "anchor", "pivotSpeed", "greenOnRed"):
        out[k]["line"] = _rs_check_line(out[k])
    return out


# ── UCT RS Phase 3 (unit 3-06): the inputs, the three readings, the anchor ──
#
# Same convention as the 2a helpers above: each block is built by one pure
# helper over lists and dicts, and a block the bars cannot support keeps every
# key with ``None`` values plus a ``reason`` (also its ``summary``, so the
# readout prints the reason in the value slot rather than a generic fallback,
# the review #24 rule). The maths is `relative_strength`'s (unit 3-03), never
# restated here: this section only chooses WHICH bars each function reads and
# words the answer.
#
# ⭐ BOUNDED WORK (plan §8.2 budget). Every Phase 3 column is computed on the
# tail the chart can show, `count` bars (lookback + 600 on daily), plus the
# reading's own warm-up, and padded with ``None`` in front. The lane's fetch
# already returns at most `count` bars, so on the pod the tail is the whole
# series; the bound is what keeps a caller that hands over more (the 5,000-bar
# budget rail) from paying O(n·w) on all of it. Clenow's rolling fit is the
# expensive one, so its full column is built only under the Quality reading
# (the only view that draws it); the `quality` block reads the last window
# alone, exactly the closes the column's last value reads (the screener's
# `_closes_suffix` rule), so the block costs one fit on every view.

#: The time word for a store timeframe in member copy (``Leading, 6 weeks``).
_RS_UNIT: dict[str, str] = {"D": "session", "W": "week", "M": "month"}
#: The Phase 3 number inputs, read from the v4 row's own declaration so the
#: provider clamps exactly as `resolve_inputs` does (one statement of the ranges).
_RS_PHASE3_NUMBER_KEYS: tuple[str, ...] = (
    "rrgRatioLength", "rrgMomentumLength", "clenowWindow", "clenowGapPct", "atrLength", "varsLookback",
)
_RS_ANCHOR_SHAPE = None       # compiled on first use from `registry_defs.RS_ANCHOR_DATE_PATTERN`


def _rs_unit(store: str) -> str:
    return _RS_UNIT.get(store, "bar")


def _rs_view(inputs: dict, toggles: dict) -> str:
    """The resolved "Reading" (D2). An unknown or missing value is the row's
    default.

    ⭐ THE LEGACY SWITCH (unit 3-08b): ``showMansfield: true`` reads as
    ``mansfield`` ONLY when the caller sent no ``view``. The row declares it
    (``showMansfield.mapsTo``) and ``registry_defs.resolve_inputs`` applies it,
    where the raw request is still visible, so a saved v3 Trend instance draws
    Mansfield and a member who picked the RS line by hand
    (``showMansfield: true, view: "ratio"``) gets the RS line. It is read here
    through ``legacy_mapped`` too, for a caller that hands this provider raw
    inputs (a no-op on resolved ones, which always carry ``view``). ``toggles``
    stays in the signature; the toggle no longer decides the view."""
    inp = registry_defs.legacy_mapped("rsLine", inputs)
    raw = str(inp.get("view") or "").strip().lower()
    return raw if raw in registry_defs.RS_VIEWS else registry_defs.RS_DEFAULT_VIEW


def _rs_phase3_params(inputs: dict, requested: str, toggles: dict) -> dict:
    """The nine Phase 3 inputs as the v4 compute reads them (and as the cache
    key and ``payload.inputs`` carry them): the resolved view; the custom ticker
    normalised, and blank unless the benchmark is CUSTOM (so a ticker left in
    the box under SPY is not a second cache entry for the same answer); the six
    method numbers clamped by the row's own specs; the anchor date stripped.
    Blank ``customBenchmark`` means not set (3-05)."""
    from api.services import rs_benchmarks
    inp = inputs or {}
    specs = {i["key"]: i for i in registry_defs._rs_phase3_inputs()}
    out: dict = {"view": _rs_view(inp, toggles)}
    # The custom ticker, the picked sector and the picked theme, each blank
    # unless the benchmark reads it (one rule, `rs_benchmarks.benchmark_picks`).
    out.update(rs_benchmarks.benchmark_picks(requested, inp))
    for key in _RS_PHASE3_NUMBER_KEYS:
        spec = specs[key]
        out[key] = registry_defs._clamp_number(inp.get(key, spec["default"]), spec, spec["type"])
    out["anchorDate"] = str(inp.get("anchorDate") or "").strip()[:32]
    return out


def _rs_tail(bars, bench_bars, keep: int):
    """``(bars_tail, bench_tail, start)``: the last ``keep`` bars, the benchmark
    bars from the tail's first time on (so both series' ATRs seed together), and
    the offset to pad back with. A series no longer than ``keep`` is returned
    whole, untouched (the pod's case)."""
    start = max(0, len(bars) - int(keep))
    if start == 0:
        return bars, bench_bars, 0
    t0 = bars[start].get("t")
    try:
        bb = [b for b in bench_bars if b.get("t") is not None and b["t"] >= t0]
    except TypeError:                                  # mixed encodings: keep the benchmark whole
        bb = list(bench_bars)
    return bars[start:], bb, start


def _rs_pad(col, start: int) -> list:
    return ([None] * start + list(col)) if start else list(col)


def _rs_joined(bars, bench_bars) -> int:
    """Bars where both series have a usable close (the ``has n`` in a reason)."""
    from api.services import relative_strength as rsmod
    aligned = rsmod.benchmark_closes_aligned(bars, bench_bars)
    return sum(1 for b, a in zip(bars, aligned)
               if a is not None and a > 0 and _rs_num(b.get("c")) and b["c"] > 0)


def _rs_fixed(v: float, places: int) -> str:
    """``v`` to ``places`` decimals, never ``-0.00``."""
    s = f"{v:.{places}f}"
    return f"{0:.{places}f}" if float(s) == 0.0 else s


def _rs_signed(v: float) -> str:
    """One decimal with a sign on a non-zero value, never ``-0.0`` (``+3.4``)."""
    s = f"{v:.1f}"
    if float(s) == 0.0:
        return "0.0"
    return f"+{s}" if v > 0 else s


def _rs_stale_tail(summary: str, idx: int, n: int, times) -> tuple[str, str | None, bool]:
    """A reading taken before the newest bar (a benchmark gap) says when, the
    legend's A8 rule: ``Leading, 6 weeks · as of Nov 4``."""
    asof = _rs_bar_ymd(times[idx]) if 0 <= idx < len(times) else None
    stale = idx < n - 1
    if stale and _rs_short_date(asof):
        summary += f" · as of {_rs_short_date(asof).replace(' ', _RS_NBSP)}"
    return summary, asof, stale


def _rs_rotation_unavailable(reason: str) -> dict:
    return {"quadrant": None, "ratio": None, "momentum": None, "inQuadrantBars": None,
            "asOf": None, "stale": None, "summary": reason, "reason": reason}


def _rs_rotation(rr: dict, times, ratio_len: int, mom_len: int, unit: str, joined) -> dict:
    """``payload.rotation``: the newest bar's quadrant (the Terminal's RRG, D1),
    its RS-Ratio and RS-Momentum, and how many bars in a row it has held that
    quadrant (bars with no reading, a benchmark gap, are skipped, not a break).
    ``summary`` is ``Leading, 6 weeks``. ``joined`` is a callable for the
    reason's bar count, run only when the reading is missing."""
    from api.services import relative_strength as rsmod
    q = rr.get("quadrant") or []
    idx = next((i for i in range(len(q) - 1, -1, -1) if q[i] is not None), None)
    if idx is None:
        need = ratio_len + mom_len - 1
        return _rs_rotation_unavailable(f"needs {_rs_count(need, unit)} of both (has {joined()})")
    code = q[idx]
    run = 0
    for i in range(idx, -1, -1):
        if q[i] is None:
            continue
        if q[i] != code:
            break
        run += 1
    name = rsmod.RRG_QUADRANT_NAMES[int(code) - 1]
    summary, asof, stale = _rs_stale_tail(f"{name}, {_rs_count(run, unit)}", idx, len(q), times)
    return {"quadrant": name, "ratio": round(float(rr["rsRatio"][idx]), 2),
            "momentum": round(float(rr["rsMomentum"][idx]), 2), "inQuadrantBars": run,
            "asOf": asof, "stale": stale, "summary": summary, "reason": None}


def _rs_quality_unavailable(reason: str, window: int, gap_pct: float) -> dict:
    return {"score": None, "annualPct": None, "r2": None, "gap": None, "window": int(window),
            "gapPct": float(gap_pct), "asOf": None, "summary": reason, "reason": reason}


def _rs_gap_text(gap_pct: float) -> str:
    """``15`` / ``12.5``: the threshold as the member typed it."""
    return f"{float(gap_pct):g}"


def _rs_quality(bars, window: int, gap_pct: float) -> dict:
    """``payload.quality``: Clenow's score on the newest ``window`` valid
    closes (`relative_strength.clenow_columns` over exactly those closes, so it
    equals the column's last value). ``score`` is the fraction (0.62),
    ``annualPct`` the yearly pace in percent (91.0), ``r2`` the fit (0.68),
    ``gap`` whether one session inside the window moved more than ``gap_pct``.
    ``summary``: ``Score 0.62, 91% a year, R² 0.68, no gap over 15%``."""
    from api.services import relative_strength as rsmod
    valid = [i for i, b in enumerate(bars) if _rs_num(b.get("c")) and b["c"] > 0]
    if len(valid) < window:
        return _rs_quality_unavailable(f"needs {_rs_count(window, 'session')} (has {len(valid)})",
                                       window, gap_pct)
    seg = [bars[i] for i in valid[-window:]]
    got = rsmod.clenow_columns(seg, window, gap_pct)
    score, annual, r2, gap = (got[k][-1] for k in ("clenowScore", "clenowAnnual", "clenowR2", "clenowGap"))
    if not (_rs_num(score) and _rs_num(annual) and _rs_num(r2)):
        return _rs_quality_unavailable(f"the price was flat over the last {_rs_count(window, 'session')}",
                                       window, gap_pct)
    annual_pct = float(annual) * 100.0
    yearly = f"{round(annual_pct):,}"
    yearly = "0" if yearly == "-0" else yearly
    gap_b = gap == 1.0
    nb = _RS_NBSP
    summary = (f"Score{nb}{_rs_fixed(float(score), 2)}, {yearly}% a year, R²{nb}{_rs_fixed(float(r2), 2)}, "
               f"{'has a gap' if gap_b else 'no gap'} over{nb}{_rs_gap_text(gap_pct)}%")
    return {"score": round(float(score), 4), "annualPct": round(annual_pct, 1), "r2": round(float(r2), 4),
            "gap": gap_b, "window": int(window), "gapPct": float(gap_pct),
            "asOf": _rs_bar_ymd(bars[valid[-1]].get("t")), "summary": summary, "reason": None}


def _rs_vars_unavailable(reason: str, lookback: int, atr_length: int, ma_length: int) -> dict:
    return {"value": None, "ma": None, "state": None, "stateWord": None, "lookback": int(lookback),
            "atrLength": int(atr_length), "maLength": int(ma_length), "asOf": None, "stale": None,
            "summary": reason, "reason": reason}


def _rs_vars(vc: dict, times, lookback: int, atr_length: int, ma_length: int, unit: str,
             bench_name: str, joined) -> dict:
    """``payload.vars``: the newest VARS reading (OANDA's volatility-adjusted
    RS, `relative_strength.vars_columns`), its 50-bar average and its state in
    the screener's words (`rs_columns.VARS_STATE_NAMES`, one vocabulary).
    ``summary``: ``Strong, rising: +3.4 against SPY, above its 50-session average``."""
    from api.services.screener.rs_columns import VARS_STATE_NAMES
    v_col, m_col, s_col = vc.get("vars") or [], vc.get("varsMa") or [], vc.get("varsState") or []
    idx = next((i for i in range(len(v_col) - 1, -1, -1) if _rs_num(v_col[i])), None)
    if idx is None:
        need = atr_length + lookback
        return _rs_vars_unavailable(f"needs {_rs_count(need, unit)} of both (has {joined()})",
                                    lookback, atr_length, ma_length)
    v = float(v_col[idx])
    m = m_col[idx] if idx < len(m_col) and _rs_num(m_col[idx]) else None
    code = s_col[idx] if idx < len(s_col) else None
    word = VARS_STATE_NAMES[int(code) - 1] if code else None
    avg = f"its {ma_length}-{unit} average"
    if word and m is not None:
        where = "above" if v > m else ("below" if v < m else "at")
        text = f"{word}: {_rs_signed(v)} against {bench_name}, {where} {avg}"
    elif _rs_signed(v) == "0.0":
        text = f"0.0, level with {bench_name}"
    else:
        have = sum(1 for x in v_col[:idx + 1] if _rs_num(x))
        text = f"{_rs_signed(v)} against {bench_name}; {avg} needs {ma_length}{_RS_NBSP}readings (has {have})"
    summary, asof, stale = _rs_stale_tail(text, idx, len(v_col), times)
    return {"value": round(v, 4), "ma": round(float(m), 4) if m is not None else None,
            "state": int(code) if code else None, "stateWord": word, "lookback": int(lookback),
            "atrLength": int(atr_length), "maLength": int(ma_length), "asOf": asof, "stale": stale,
            "summary": summary, "reason": None}


def _rs_phase3(bars, bench_bars, params: dict, count: int, *, store: str, intraday: bool,
               bench_name: str, why: str | None) -> dict:
    """``{"columns": {the six Phase 3 wire columns}, "rotation", "quality",
    "vars"}`` for one v4 envelope. ``why`` is the no-ratio state's reason
    (benchmark is the symbol / no benchmark bars): every column blank and every
    block unavailable with it.

    * Rotation: the chart's own bars (the weekly preset carries the read),
      never intraday (blank like the dots).
    * Quality: daily charts only. `clenow_columns` annualises with 252 bars a
      year, so a weekly or intraday fit would print a yearly pace that is not
      one; the block says so instead.
    * VARS: every timeframe (an ATR-scaled sum, unit-free), 50-bar average.
    """
    from api.services import relative_strength as rsmod
    n = len(bars)
    cols = {k: [None] * n for k in registry_defs.RS_PHASE3_WIRE_COLUMNS}
    r_len, m_len = params["rrgRatioLength"], params["rrgMomentumLength"]
    window, gap_pct = params["clenowWindow"], params["clenowGapPct"]
    atr_len, look = params["atrLength"], params["varsLookback"]
    ma_len = rsmod.DEFAULT_VARS_MA_LENGTH
    unit = _rs_unit(store)
    if why or not n:
        reason = why or "no bars for this symbol"
        return {"columns": cols, "rotation": _rs_rotation_unavailable(reason),
                "quality": _rs_quality_unavailable(reason, window, gap_pct),
                "vars": _rs_vars_unavailable(reason, look, atr_len, ma_len)}

    # Rotation
    if intraday:
        rotation = _rs_rotation_unavailable("not read on intraday charts")
    else:
        tb, tbb, start = _rs_tail(bars, bench_bars, count + r_len + m_len)
        rr = rsmod.rrg_columns(tb, tbb, r_len, m_len)
        cols["rsRatio"] = _rs_pad(rr["rsRatio"], start)
        cols["rsMomentum"] = _rs_pad(rr["rsMomentum"], start)
        rotation = _rs_rotation(rr, [b.get("t") for b in tb], r_len, m_len, unit,
                                lambda: _rs_joined(tb, tbb))

    # Quality
    if store != "D":
        quality = _rs_quality_unavailable("daily charts only", window, gap_pct)
    else:
        quality = _rs_quality(bars, window, gap_pct)
        if params["view"] == "quality":
            tb, _unused, start = _rs_tail(bars, (), count + window)
            score = rsmod.clenow_columns(tb, window, gap_pct)["clenowScore"]
            # ⭐ THE GAP DOT IS THE GAP SESSION ITSELF, on the score line. The
            # window flag `clenowGap` is 1 on every bar whose window holds the
            # move (90 bars in a row), which as dots would be a dotted line. The
            # same rule read on ONE pair (`clenow_columns` with a 2-close window:
            # its `clenowGap` is 1 exactly where that session moved more than
            # the threshold) marks the session the gap happened on, with the
            # module's own threshold test rather than a second one written here.
            pair = rsmod.clenow_columns(tb, 2, gap_pct)["clenowGap"]
            cols["clenowScore"] = _rs_pad(score, start)
            cols["dotClenowGap"] = _rs_pad([s if (p == 1.0 and _rs_num(s)) else None
                                            for s, p in zip(score, pair)], start)

    # VARS
    tb, tbb, start = _rs_tail(bars, bench_bars, count + 3 * atr_len + look + ma_len)
    vc = rsmod.vars_columns(tb, tbb, atr_len, look, ma_len)
    cols["vars"] = _rs_pad(vc["vars"], start)
    cols["varsMa"] = _rs_pad(vc["varsMa"], start)
    vars_block = _rs_vars(vc, [b.get("t") for b in tb], look, atr_len, ma_len, unit, bench_name,
                          lambda: _rs_joined(tb, tbb))
    return {"columns": cols, "rotation": rotation, "quality": quality, "vars": vars_block}


def _rs_long_date(ymd: str | None) -> str | None:
    """``20260304`` → ``Mar 4, 2026`` (a picked date can be years back)."""
    short = _rs_short_date(ymd)
    return f"{short}, {int(ymd[:4])}" if short else None


def _rs_parse_anchor_date(raw: str):
    """A `datetime.date` for a ``YYYY-MM-DD`` that names a real day, else None.
    The row checks the shape only (3-05), so ``2026-13-45`` arrives here."""
    import re
    from datetime import date
    global _RS_ANCHOR_SHAPE
    if _RS_ANCHOR_SHAPE is None:
        _RS_ANCHOR_SHAPE = re.compile(registry_defs.RS_ANCHOR_DATE_PATTERN)
    if not _RS_ANCHOR_SHAPE.fullmatch(raw or ""):
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _rs_anchor_picked(bars, aligned, bench_name: str, raw: str, today) -> dict:
    """The Checks anchor on a member's date (D6): the first session ON OR AFTER
    ``raw`` (an ET session date, the bar keys' own calendar) where both closes
    exist, compared with the newest session. Every unusable date is
    ``pass: None`` with a reason that names it, never a quiet return to the
    default rule: not a real date, in the future, before the history this
    reading holds, or no session on or after it yet. A pick on the newest
    session is undecided (both returns are 0, the review #13 rule)."""
    out = {"pass": None, "stock": None, "bench": None, "anchorTime": None, "barsAgo": None,
           "reason": None, "source": "picked", "date": raw}
    d = _rs_parse_anchor_date(raw)
    if d is None:
        out["reason"] = f"{raw} is not a real date"
        return out
    target = d.strftime("%Y%m%d")
    when = _rs_long_date(target)
    if d > today:
        out["reason"] = f"{when} is in the future"
        return out
    ymds = [_rs_bar_ymd(b.get("t")) for b in bars]
    first = next((y for y in ymds if y), None)
    if first is None:
        out["reason"] = "no sessions held to anchor on"
        return out
    if target < first:
        out["reason"] = f"{when} is before the history this reading holds, which starts {_rs_long_date(first)}"
        return out
    a = next((i for i, y in enumerate(ymds)
              if y and y >= target and aligned[i] is not None and _rs_num(bars[i].get("c"))), None)
    if a is None:
        out["reason"] = f"no session of both on or after {when} yet"
        return out
    if aligned[-1] is None or not _rs_num(bars[-1].get("c")):
        out["reason"] = f"no {bench_name} bar for the newest session yet"
        return out
    used = _rs_long_date(ymds[a])
    since = used if ymds[a] == target else f"{used} (the first session after {_rs_short_date(target)})"
    sr = (float(bars[-1]["c"]) / float(bars[a]["c"]) - 1.0) * 100.0
    br = (aligned[-1] / aligned[a] - 1.0) * 100.0
    ago = len(bars) - 1 - a
    out.update(stock=sr, bench=br, anchorTime=bars[a].get("t"), barsAgo=ago)
    if ago == 0:
        out["reason"] = f"{since} is the newest session; there is no move to compare yet"
    else:
        out["pass"] = sr > br
        out["reason"] = f"stock {_rs_pct(sr)}, {bench_name} {_rs_pct(br)} since {since}"
    return out


def _et_now():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def _et_session_day() -> str:
    """The Eastern calendar day — the day a session closes on."""
    return _et_now().strftime("%Y-%m-%d")


def _seconds_to_next_et_close(close_hour: int = 16, close_minute: int = 5) -> int:
    """Seconds until the next 16:05 ET (five minutes after the cash close, when the
    day's bars have settled). Weekends roll to the next weekday; the result is at
    least 60 and at most three days, so a holiday never pins an answer for a week."""
    from datetime import timedelta
    now = _et_now()
    target = now.replace(hour=close_hour, minute=close_minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    while target.weekday() >= 5:
        target += timedelta(days=1)
    return int(max(60, min((target - now).total_seconds(), 3 * 24 * 3600)))


def _rs_bars_count(store_tf: str, lookback: int) -> int:
    """How many bars the RS lane reads (plan §8.2): the lookback plus two and a
    half years of dot history on a daily chart, the lookback plus 200 on weekly
    and monthly, the lane's usual 400 intraday. Measured on master: the old fixed
    400 left ~7 months of dots behind a 252-bar lookback."""
    if store_tf == "D":
        return int(lookback) + 600
    if store_tf in ("W", "M"):
        return int(lookback) + 200
    return 400


# ── The RS split (unit U4, 2026-11-09): one shared core, three envelopes ─────
#
# `rsRating`, `rsPhases` and `rsVsEma` (engineering map projects/rs-split-
# handoff-2026-11-09/engineering-map.md §(a) U4, formulas §(d)) are served by
# the three envelopes below. None of them reads the regime, the sensitivity
# legs or the evidence artifact: those stay the RS line's (and Compass's,
# `rs_read_tools`) until unit U10, which keeps the three under the provider
# budget rail (`tests/test_rs_provider_budget.py`).
#
# ⭐ THE CORE IS MEMOISED PER PROCESS FOR ONE REQUEST CYCLE. A chart with the
# RS line, RS Phases and RS vs 21 EMA on it asks the lane three times in the
# same second; `_rs_core` keeps the stock's bars, and the resolved benchmark
# with its bars and the ratio, for `_RS_CORE_TTL_S` seconds keyed on what was
# asked (symbol, store timeframe, benchmark, custom ticker, bar count, ET
# session day), so the second and third request read no bars at all. It is a
# short in-process memo like `_rs_data_generation`'s, bounded (`_RS_CORE_MAX`
# entries, expired ones swept on every write), and the per-envelope cache
# (`cache`, the rsLine pattern: `compute.rev` and a payload-shape number lead
# the key, the ET session day is in it, TTL to the next session close on D/W/M
# and 900 s intraday, 60 s for a degraded answer) sits in front of it, so the
# memo only ever matters on a cold cycle.

_RS_CORE_TTL_S = 15.0
_RS_CORE_MAX = 64
_RS_CORE_MEMO: dict = {}
_RS_CORE_LOCK = threading.Lock()

#: Each new envelope's payload shape, in its cache key (bump when a payload
#: field or a wire blanking rule changes inside one `compute.rev`).
#: 2 (2026-11-12, sector and theme benchmarks): `benchmark.name`, and the
#: `inputs` carry `sectorBenchmark` / `themeBenchmark` beside a NORMALISED
#: `customBenchmark` (each blank unless the benchmark reads it).
_RS_RATING_PAYLOAD_SHAPE = 1
_RS_PHASES_PAYLOAD_SHAPE = 2
_RS_VS_EMA_PAYLOAD_SHAPE = 2
_RS_EXIT_PAYLOAD_SHAPE = 2

#: The phase column's words (the legend row; the bgcolor paint reads the number).
_RS_PHASE_LABELS = {1: "RS rising while the market falls", 0: "RS falling while the market rises"}
_RS_NO_PHASE = "no split: RS and the market trend together"


def rs_core_reset() -> None:
    """Forget every memoised core (tests; a bars repair that must be seen now)."""
    with _RS_CORE_LOCK:
        _RS_CORE_MEMO.clear()


def _rs_core_get(key: tuple):
    now = time.monotonic()
    with _RS_CORE_LOCK:
        hit = _RS_CORE_MEMO.get(key)
        if hit is not None and 0 <= now - hit[0] < _RS_CORE_TTL_S:
            return hit[1]
    return None


def _rs_core_put(key: tuple, value) -> None:
    now = time.monotonic()
    with _RS_CORE_LOCK:
        for k in [k for k, (at, _v) in _RS_CORE_MEMO.items() if not (0 <= now - at < _RS_CORE_TTL_S)]:
            _RS_CORE_MEMO.pop(k, None)
        while len(_RS_CORE_MEMO) >= _RS_CORE_MAX:
            _RS_CORE_MEMO.pop(next(iter(_RS_CORE_MEMO)))
        _RS_CORE_MEMO[key] = (now, value)


def _rs_split_picks(requested: str, src: dict) -> dict:
    """The split rows' benchmark second values, as the compute reads them."""
    from api.services import rs_benchmarks
    return rs_benchmarks.benchmark_picks(requested, src)


def _rs_core(sym: str, tf: str, requested: str | None, custom, *,
             fetch_bars, warm, count: int, day: str, memo=None) -> dict:
    """``{bars, times, bench, rs, same_symbol, no_bench, short_history}`` for
    one (symbol, timeframe, benchmark) ask, memoised (see above). ``requested``
    None means no benchmark (the rating): ``bench`` and ``rs`` are None and the
    two blank-state flags are False. The bars memo and the benchmark memo are
    separate entries, so the rating and the two ratio indicators share the
    stock's bars while only the latter pay for the benchmark.

    2026-11-12: ``custom`` is the picks dict (`_rs_split_picks`: the custom
    ticker, the picked sector, the picked theme) or a bare custom ticker;
    ``memo`` is the caller's reader, the composite memo's namespace."""
    picks = custom if isinstance(custom, dict) else {"customBenchmark": str(custom or "")}
    from api.services import relative_strength as rsmod
    from api.services import rs_benchmarks
    store = registry_defs.store_tf(tf)
    sym_u = sym.upper()
    bars_key = ("bars", sym_u, store, int(count), day)
    bars = _rs_core_get(bars_key)
    if bars is None:
        bars = fetch_bars(sym, tf, count)
        _rs_core_put(bars_key, bars)
    times = [int(b["t"]) for b in bars]
    out = {"bars": bars, "times": times, "bench": None, "rs": None,
           "same_symbol": False, "no_bench": False,
           "short_history": bool(times) and len(times) < count}
    if requested is None:
        return out
    pick_key = tuple(str(picks.get(k) or "") for k in ("customBenchmark", "sectorBenchmark", "themeBenchmark"))
    bench_key = ("bench", sym_u, store, str(requested), pick_key, int(count), day)
    hit = _rs_core_get(bench_key)
    if hit is None:
        bench = rs_benchmarks.resolve_benchmark(sym, requested, tf, count, fetch_bars=fetch_bars,
                                                custom=picks.get("customBenchmark") or None, warm=warm,
                                                sector=picks.get("sectorBenchmark") or None,
                                                theme=picks.get("themeBenchmark") or None, memo=memo)
        hit = {"bench": bench, "rs": rsmod.rs_line(bars, bench.get("bars") or [])}
        _rs_core_put(bench_key, hit)
    out["bench"] = hit["bench"]
    out["rs"] = hit["rs"]
    out["same_symbol"] = str(hit["bench"].get("resolved", "")).upper() == sym_u
    out["no_bench"] = not hit["bench"].get("bars")
    return out


def _rs_split_rev(def_id: str) -> int:
    """The row's `compute.rev`, read from `registry_defs.RS_SPLIT_DEFS` (built
    whether or not the flag is on, so a direct call never needs the row
    installed)."""
    return int(next(d for d in registry_defs.RS_SPLIT_DEFS if d["id"] == def_id)["compute"]["rev"])


def _rs_split_state(core: dict, intraday: bool) -> str:
    return ("same-symbol" if core["same_symbol"] else "no-benchmark-bars" if core["no_bench"]
            else "no-bars" if not core["times"] else "intraday" if intraday
            else "short-history" if core["short_history"] else "ok")


def _rs_split_why(core: dict) -> str | None:
    """The blank-state reason, the RS line's own words (`rs_line_envelope`)."""
    if core["same_symbol"]:
        return "benchmark is the symbol"
    if core["no_bench"]:
        return "no benchmark bars"
    if not core["times"]:
        return "no bars for this symbol"
    return None


def _rs_split_benchmark_block(core: dict, legend_index, *, intraday: bool) -> dict:
    from api.services import rs_benchmarks
    bench = core["bench"]
    return dict({k: bench.get(k) for k in ("requested", "resolved", "label", "fallback")},
                bars=len(bench.get("bars") or []), name=rs_benchmarks.benchmark_name(bench),
                note=_rs_benchmark_note(bench, {"index": legend_index}, core["times"],
                                        intraday=intraday, same_symbol=core["same_symbol"]))


def _rs_split_history(core: dict, count: int) -> dict:
    return {"bars": len(core["times"]), "requested": int(count), "short": core["short_history"]}


def _rs_split_cached(ck):
    try:
        return cache.get(ck)
    except Exception:                                  # noqa: BLE001 — a cache read is bookkeeping
        return None


def _rs_split_store(ck, envelope: dict, ttl: int, def_id: str, sym: str) -> None:
    try:
        cache.set(ck, envelope, ttl=ttl)
    except Exception:                                  # noqa: BLE001 — see the DPL cache-write note
        logger.exception("signature: %s cache write failed for %s", def_id, sym)


def _rs_split_ttl(core: dict, intraday: bool) -> int:
    """The rsLine rule: a degraded answer (no benchmark bars yet) lives one
    minute, an intraday one 900 s, a D/W/M one until the next session close."""
    return 60 if core["no_bench"] else (900 if intraday else _seconds_to_next_et_close())


def rs_rating_envelope(sym: str, tf: str, inputs: dict, *, fetch_bars, cache_key, warm=None) -> dict:
    """`rsRating`: the stock's stored daily rating at each bar's session and its
    21-session average (`ratingLine` / `ratingMa`), with the `rating` block
    (ibd + m1/m3/m6/m9/m12 + asof + summary + components, `_rs_rating`) and the
    `ratingHistory` block exactly as the rsLine rev 5 Rating Reading builds them
    (`_rs_rating_view`), so the JS definition reuses the same `scalar:` paths.

    Daily charts only: on W/M/intraday the columns are blank and
    ``ratingHistory.reason`` says "daily charts only" (`_rs_rating_view`'s own
    rule). No benchmark input and no benchmark read. The cache key carries the
    rating data generation (`_rs_data_generation`), so the first request after
    the nightly job lands is a cold compute."""
    t0 = time.perf_counter()
    from api.services import relative_strength as rsmod
    from api.services.indicator_compute import _round_series
    store = registry_defs.store_tf(tf)
    intraday = store not in ("D", "W", "M")
    count = _rs_bars_count(store, rsmod.DEFAULT_LOOKBACK)
    rev = _rs_split_rev("rsRating")
    day = _et_session_day()
    ck = cache_key(f"rsRating{rev}p{_RS_RATING_PAYLOAD_SHAPE}",
                   f"{sym.upper()}:{store}:{_rs_data_generation()}:{day}")
    hit = _rs_split_cached(ck)
    if hit:
        _record_timing("cache", t0, {})
        return hit
    stages: dict = {"bars": 0.0}
    t_build = time.perf_counter()
    core = _rs_core(sym, tf, None, None, fetch_bars=_timed_fetch(fetch_bars, stages), warm=warm,
                    count=count, day=day)
    times = core["times"]
    view = _rs_rating_view(sym, times, store, "rating", stages)
    cols = dict(view["columns"])
    cols["ratingMa"] = _round_series(cols["ratingMa"], 2)   # a 1-99 average; the line is whole numbers
    state = "no-bars" if not times else "daily-only" if store != "D" else "ok"
    payload = {
        "rating": _timed(stages, "rating", _rs_rating, sym, True),
        "ratingHistory": view["block"],
        "history": _rs_split_history(core, count),
        "inputs": {},
        "intraday": intraday,
        "state": state,
    }
    envelope = {"columns": cols, "times": times, "asOf": time.time(), "payload": payload}
    t_built = time.perf_counter()
    if times:
        _rs_split_store(ck, envelope, 900 if intraday else _seconds_to_next_et_close(), "rsRating", sym)
    _record_timing("cold", t0, _stage_order(stages, (t_built - t_build) * 1000.0))
    return envelope


def _rs_last_finite(*cols) -> int | None:
    """The last index at which every given column is finite, or None."""
    n = min((len(c) for c in cols), default=0)
    for i in range(n - 1, -1, -1):
        if all(_rs_num(c[i]) for c in cols):
            return i
    return None


def _rs_phases_legend(cols: dict, times, why: str | None) -> dict:
    """The RS Phases legend: the newest bar's phase (1 / 0 / None), its words,
    the divergence z-score and the two trends, read at the last bar with both
    trends; ``summary`` is the phase's words plus ``· divergence +1.2`` when
    the z-score exists, with ``· as of Nov 4`` when that bar is not the newest.
    A blank state carries its reason as the summary."""
    out = {"phase": None, "phaseLabel": None, "divergence": None, "rsTrend": None, "benchTrend": None,
           "asOf": None, "stale": None, "summary": why}
    if why:
        return out
    idx = _rs_last_finite(cols["rsTrend"], cols["benchTrend"])
    if idx is None:
        out["summary"] = "not enough bars yet"
        return out
    phase = cols["phase"][idx]
    z = cols["divergence"][idx]
    out.update(phase=int(phase) if _rs_num(phase) else None,
               phaseLabel=_RS_PHASE_LABELS.get(int(phase)) if _rs_num(phase) else _RS_NO_PHASE,
               divergence=float(z) if _rs_num(z) else None,
               rsTrend=float(cols["rsTrend"][idx]), benchTrend=float(cols["benchTrend"][idx]),
               asOf=_rs_bar_ymd(times[idx]), stale=idx < len(times) - 1)
    summary = out["phaseLabel"]
    if out["divergence"] is not None:
        summary += f" · divergence {out['divergence']:+.1f}"
    if out["stale"] and _rs_short_date(out["asOf"]):
        summary += f" · as of {_rs_short_date(out['asOf'])}"
    out["summary"] = summary
    return out


def rs_phases_envelope(sym: str, tf: str, inputs: dict, *, fetch_bars, cache_key, warm=None) -> dict:
    """`rsPhases`: `relative_strength.compute_rs_phases_columns` on the shared
    core, the `phase` and `divergence` wire columns, and a payload of
    `benchmark`, `legend`, `history`, `inputs`, `intraday`, `state`. Every
    timeframe (the ratio exists intraday). Same-symbol and no-benchmark states
    blank both columns and put the RS line's reason in ``legend.summary``."""
    t0 = time.perf_counter()
    from api.services import relative_strength as rsmod
    from api.services.indicator_compute import _round_series
    src = inputs or {}
    store = registry_defs.store_tf(tf)
    intraday = store not in ("D", "W", "M")
    count = _rs_bars_count(store, rsmod.DEFAULT_LOOKBACK)
    requested = src.get("benchmark") or registry_defs.RS_LINE_BENCHMARKS[0]
    custom = _rs_split_picks(requested, src)
    params = {
        "benchmark": requested, **custom,
        "shortEma": int(round(rsmod._clamp(src.get("shortEma"), *rsmod.PHASES_SHORT_RANGE,
                                           default=rsmod.DEFAULT_PHASES_SHORT))),
        "longEma": int(round(rsmod._clamp(src.get("longEma"), *rsmod.PHASES_LONG_RANGE,
                                          default=rsmod.DEFAULT_PHASES_LONG))),
    }
    rev = _rs_split_rev("rsPhases")
    day = _et_session_day()
    ck = cache_key(f"rsPhases{rev}p{_RS_PHASES_PAYLOAD_SHAPE}",
                   f"{sym.upper()}:{store}:{json.dumps(params, sort_keys=True)}:{day}")
    hit = _rs_split_cached(ck)
    if hit:
        _record_timing("cache", t0, {})
        return hit
    stages: dict = {"bars": 0.0}
    t_build = time.perf_counter()
    core = _rs_core(sym, tf, requested, custom, fetch_bars=_timed_fetch(fetch_bars, stages), warm=warm,
                    count=count, day=day, memo=fetch_bars)
    times = core["times"]
    why = _rs_split_why(core)
    if why is None:
        cols = rsmod.compute_rs_phases_columns(core["bars"], core["bench"]["bars"],
                                               params["shortEma"], params["longEma"])
    else:
        cols = {k: [None] * len(times) for k in rsmod.RS_PHASES_COLUMNS}
    legend = _rs_phases_legend(cols, times, why)
    wire = {"phase": list(cols["phase"]), "divergence": _round_series(cols["divergence"], 4)}
    payload = {
        "benchmark": _rs_split_benchmark_block(core, _rs_last_finite(core["rs"]), intraday=intraday),
        "legend": legend,
        "history": _rs_split_history(core, count),
        "inputs": params,
        "intraday": intraday,
        "state": _rs_split_state(core, intraday),
    }
    envelope = {"columns": wire, "times": times, "asOf": time.time(), "payload": payload}
    t_built = time.perf_counter()
    if times:
        _rs_split_store(ck, envelope, _rs_split_ttl(core, intraday), "rsPhases", sym)
    _record_timing("cold", t0, _stage_order(stages, (t_built - t_build) * 1000.0))
    return envelope


def rs_vs_ema_envelope(sym: str, tf: str, inputs: dict, *, fetch_bars, cache_key, warm=None) -> dict:
    """`rsVsEma`: `relative_strength.compute_rs_vs_ema_columns` on the shared
    core (`dist`, `fast`, `slow`), and a payload of `benchmark`, `legend`,
    `history`, `inputs`, `intraday`, `state`. The legend is the RS line's own
    (`_rs_legend` over `legend_scalars` at the 21 EMA), so ``legend.summary``
    prints the same "above its 21 EMA by 6.8%" and ``legend.pctFromMa`` IS the
    newest `dist` cell; ``legend.fast`` / ``legend.slow`` are the two averages
    at that bar. Every timeframe. Blank states carry the RS line's reason."""
    t0 = time.perf_counter()
    from api.services import relative_strength as rsmod
    from api.services.indicator_compute import _round_series
    src = inputs or {}
    store = registry_defs.store_tf(tf)
    intraday = store not in ("D", "W", "M")
    count = _rs_bars_count(store, rsmod.DEFAULT_LOOKBACK)
    requested = src.get("benchmark") or registry_defs.RS_LINE_BENCHMARKS[0]
    custom = _rs_split_picks(requested, src)
    params = {"benchmark": requested, **custom,
              "maLength": rsmod.DEFAULT_VS_EMA_LENGTH, "maType": "EMA",
              "fast": rsmod.DEFAULT_VS_EMA_FAST, "slow": rsmod.DEFAULT_VS_EMA_SLOW}
    rev = _rs_split_rev("rsVsEma")
    day = _et_session_day()
    ck = cache_key(f"rsVsEma{rev}p{_RS_VS_EMA_PAYLOAD_SHAPE}",
                   f"{sym.upper()}:{store}:{json.dumps(params, sort_keys=True)}:{day}")
    hit = _rs_split_cached(ck)
    if hit:
        _record_timing("cache", t0, {})
        return hit
    stages: dict = {"bars": 0.0}
    t_build = time.perf_counter()
    core = _rs_core(sym, tf, requested, custom, fetch_bars=_timed_fetch(fetch_bars, stages), warm=warm,
                    count=count, day=day, memo=fetch_bars)
    times = core["times"]
    why = _rs_split_why(core)
    if why is None:
        cols = rsmod.compute_rs_vs_ema_columns(core["bars"], core["bench"]["bars"],
                                               params["maLength"], params["fast"], params["slow"])
        ma = rsmod.rs_moving_average(core["rs"], params["maLength"], "EMA")
        legend = _rs_legend(rsmod.legend_scalars({"rsLine": core["rs"], "rsMa": ma}), times, params)
    else:
        cols = {k: [None] * len(times) for k in rsmod.RS_VS_EMA_COLUMNS}
        legend = _rs_legend(rsmod.legend_scalars({"rsLine": [], "rsMa": []}), times, params)
        legend["summary"] = why
    idx = legend.get("index")
    legend["fast"] = float(cols["fast"][idx]) if isinstance(idx, int) and _rs_num(cols["fast"][idx]) else None
    legend["slow"] = float(cols["slow"][idx]) if isinstance(idx, int) and _rs_num(cols["slow"][idx]) else None
    wire = {k: _round_series(cols[k], 4) for k in rsmod.RS_VS_EMA_COLUMNS}   # percents: four places
    payload = {
        "benchmark": _rs_split_benchmark_block(core, idx, intraday=intraday),
        "legend": legend,
        "history": _rs_split_history(core, count),
        "inputs": params,
        "intraday": intraday,
        "state": _rs_split_state(core, intraday),
    }
    envelope = {"columns": wire, "times": times, "asOf": time.time(), "payload": payload}
    t_built = time.perf_counter()
    if times:
        _rs_split_store(ck, envelope, _rs_split_ttl(core, intraday), "rsVsEma", sym)
    _record_timing("cold", t0, _stage_order(stages, (t_built - t_build) * 1000.0))
    return envelope


# ── UCT RS Exit Warnings (`rsExit`, 2026-11-12) ─────────────────────────────
#
# Mike Webster's Quick Break / Quicksand / Grateful Dead Break on the RS line
# (`relative_strength.compute_rs_exit_columns`; the module header there states
# the rules and why they are OUR reading of a published idea). Daily and weekly
# charts only: the lengths are daily 21 / 50 and weekly 8 / 21 and a warning on a
# minute chart means nothing, so any other timeframe answers blank columns and
# says so (`state: "daily-weekly-only"`), reading no benchmark at all.

_RS_EXIT_KIND_LABELS = {"quickBreak": "Quick Break", "quicksand": "Quicksand", "deadBreak": "Grateful Dead Break"}
#: Most severe first: on a bar where two fire, the legend names the worse one.
_RS_EXIT_SEVERITY = ("deadBreak", "quicksand", "quickBreak")
_RS_EXIT_BLANK_WHY = "daily and weekly charts only"


def _rs_exit_when(bars_ago: int) -> str:
    return "on the latest bar" if bars_ago == 0 else ("1 bar ago" if bars_ago == 1 else f"{bars_ago} bars ago")


def _rs_exit_last_warning(cols: dict) -> dict | None:
    """The newest warning in the columns: ``{kind, label, index, barsAgo}`` (``barsAgo``
    counted from the newest bar, 0 = that bar), the worse one when two share a bar,
    or None when no warning has fired in the bars held."""
    n = len(cols["rsLine"])
    for i in range(n - 1, -1, -1):
        for kind in _RS_EXIT_SEVERITY:
            if cols[kind][i] == 1.0:
                return {"kind": kind, "label": _RS_EXIT_KIND_LABELS[kind], "index": i, "barsAgo": n - 1 - i}
    return None


def _rs_exit_legend(cols: dict, times, params: dict, why: str | None) -> dict:
    """The RS Exit Warnings legend: the newest warning in plain words
    (``Last warning: Quicksand, 6 bars ago``), where the RS line sits against its
    two averages at the newest bar it can be judged at, and both averages'
    values. A blank state carries its reason as the summary."""
    out = {"lastKind": None, "lastLabel": None, "barsAgo": None, "lastAsOf": None, "chipText": None,
           "blankReason": why,
           "status": None, "statusLabel": None, "rs": None, "fast": None, "slow": None,
           "fastLength": params["fastLength"], "slowLength": params["slowLength"],
           "asOf": None, "stale": None, "summary": why}
    if why:
        return out
    idx = _rs_last_finite(cols["rsLine"], cols["fast"])
    if idx is None:
        out["summary"] = out["blankReason"] = "not enough bars yet"
        return out
    rs, fast = float(cols["rsLine"][idx]), float(cols["fast"][idx])
    slow = float(cols["slow"][idx]) if _rs_num(cols["slow"][idx]) else None
    below_fast = rs < fast
    below_slow = slow is not None and rs < slow
    if below_fast and below_slow:
        status, label = "belowBoth", "RS is below both averages"
    elif below_fast:
        status, label = "belowFast", f"RS is below its {params['fastLength']}-bar average"
    elif below_slow:
        status, label = "belowSlow", f"RS is below its {params['slowLength']}-bar average"
    else:
        status, label = "aboveBoth", "RS is above both averages"
    out.update(status=status, statusLabel=label, rs=rs, fast=fast, slow=slow,
               asOf=_rs_bar_ymd(times[idx]), stale=idx < len(times) - 1)
    last = _rs_exit_last_warning(cols)
    if last is None:
        out["summary"] = "No warning in the bars shown"
        out["chipText"] = "no warning"
    else:
        out.update(lastKind=last["kind"], lastLabel=last["label"], barsAgo=last["barsAgo"],
                   lastAsOf=_rs_bar_ymd(times[last["index"]]))
        out["summary"] = f"Last warning: {last['label']}, {_rs_exit_when(last['barsAgo'])}"
        # the pane label's short form (the chip row): `Quicksand · 6 bars ago`
        out["chipText"] = f"{last['label']} · {_rs_exit_when(last['barsAgo']).replace('on the latest bar', 'latest bar')}"
    if out["stale"] and _rs_short_date(out["asOf"]):
        out["summary"] += f" · as of {_rs_short_date(out['asOf'])}"
    return out


def rs_exit_envelope(sym: str, tf: str, inputs: dict, *, fetch_bars, cache_key, warm=None) -> dict:
    """`rsExit`: `relative_strength.compute_rs_exit_columns` on the shared core,
    the RS line, its two simple averages and the three dots on the wire, and a
    payload of `benchmark`, `legend`, `history`, `inputs` (the RESOLVED lengths:
    0 in the request is auto, daily 21 / 50, weekly 8 / 21), `intraday`, `state`.
    Daily and weekly only: any other timeframe answers blank columns with
    ``state: "daily-weekly-only"`` and reads no benchmark. The same-symbol and
    no-benchmark states blank the columns with the RS line's reason."""
    t0 = time.perf_counter()
    from api.services import relative_strength as rsmod
    from api.services.indicator_compute import _round_series
    src = inputs or {}
    store = registry_defs.store_tf(tf)
    intraday = store not in ("D", "W", "M")
    supported = store in ("D", "W")
    count = _rs_bars_count(store, rsmod.DEFAULT_LOOKBACK)
    requested = src.get("benchmark") or registry_defs.RS_LINE_BENCHMARKS[0]
    custom = _rs_split_picks(requested, src)
    fast, slow = rsmod.resolve_exit_lengths(store, src.get("fastLength"), src.get("slowLength"))
    params = {"benchmark": requested, **custom, "fastLength": fast, "slowLength": slow,
              "maType": "SMA"}
    rev = _rs_split_rev("rsExit")
    day = _et_session_day()
    ck = cache_key(f"rsExit{rev}p{_RS_EXIT_PAYLOAD_SHAPE}",
                   f"{sym.upper()}:{store}:{json.dumps(params, sort_keys=True)}:{day}")
    hit = _rs_split_cached(ck)
    if hit:
        _record_timing("cache", t0, {})
        return hit
    stages: dict = {"bars": 0.0}
    t_build = time.perf_counter()
    core = _rs_core(sym, tf, requested if supported else None, custom, fetch_bars=_timed_fetch(fetch_bars, stages),
                    warm=warm, count=count, day=day, memo=fetch_bars)
    times = core["times"]
    why = _RS_EXIT_BLANK_WHY if not supported else _rs_split_why(core)
    if why is None:
        cols = rsmod.compute_rs_exit_columns(core["bars"], core["bench"]["bars"], fast, slow)
    else:
        cols = {k: [None] * len(times) for k in rsmod.RS_EXIT_COLUMNS}
    legend = _rs_exit_legend(cols, times, params, why)
    wire = {k: _round_series(cols[k], 6) for k in registry_defs.RS_EXIT_WIRE_COLUMNS}   # a RATIO: six places
    state = "daily-weekly-only" if not supported else _rs_split_state(core, False)
    payload = {
        "benchmark": (_rs_split_benchmark_block(core, _rs_last_finite(core["rs"]), intraday=intraday)
                      if supported else {"requested": requested, "resolved": None, "label": None,
                                         "fallback": None, "bars": 0, "name": None, "note": None}),
        "legend": legend,
        "history": _rs_split_history(core, count),
        "inputs": params,
        "intraday": intraday,
        "state": state,
    }
    envelope = {"columns": wire, "times": times, "asOf": time.time(), "payload": payload}
    t_built = time.perf_counter()
    if times:
        _rs_split_store(ck, envelope, _rs_split_ttl(core, intraday), "rsExit", sym)
    _record_timing("cold", t0, _stage_order(stages, (t_built - t_build) * 1000.0))
    return envelope
