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
    """``fn(*args)``, unchanged, with its wall time stored as ``stages[name]``."""
    t = time.perf_counter()
    try:
        return fn(*args)
    finally:
        stages[name] = (time.perf_counter() - t) * 1000.0


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
    `mansfield`, decision D2), a member's own benchmark (`CUSTOM` plus
    `customBenchmark`, decision D4, warmed through ``warm``), the picked
    `anchorDate` for the Checks anchor (decision D6), and three payload blocks:
    `rotation`, `quality` and `vars` (`_rs_phase3`). The payload shape is
    `_RS_PAYLOAD_SHAPE_V4`. With the row at rev 3 every one of those branches
    is skipped, and the v3 envelope and cache key are byte-identical.

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
        bench = rs_benchmarks.resolve_benchmark(sym, requested, tf, count, fetch_bars=fetch_bars,
                                                custom=params["customBenchmark"] or None, warm=warm)
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
                custom=(params["customBenchmark"] or None) if v4 else None)])
            sensitivity = _rs_sensitivity(sym, bars, bench, tf, count, groups, fetch_bars)
            checks = _rs_checks(bars, bench["bars"], str(bench.get("resolved") or "benchmark"),
                                params["redDayThreshold"],
                                anchor_date=params["anchorDate"] if v4 else None)
        if v4:
            # D6: the anchor says which rule chose its bar, on every chart.
            checks["anchor"].setdefault("source", "picked" if params["anchorDate"] else "default")
            checks["anchor"].setdefault("date", params["anchorDate"] or None)
        payload = {
            "benchmark": dict({k: bench[k] for k in ("requested", "resolved", "label", "fallback")},
                              bars=len(bench.get("bars") or []),
                              note=_rs_benchmark_note(bench, legend, times, intraday=intraday,
                                                       same_symbol=same_symbol)),
            "legend": legend,
            "lastRsHigh": last_high,
            "history": {"bars": len(times), "requested": count, "short": short_history,
                        "summary": f"{_rs_plural(len(times), 'bar')} held; dots use every bar"
                        if short_history else None},
            "inputs": params,
            "intraday": intraday,
            "state": state,
            "rating": _timed(stages, "rating", _rs_rating, sym),
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
#: while the flag is off; the v4 key leads with `rs4p5`.
_RS_PAYLOAD_SHAPE_V4 = 5
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
_RS_AUTO_NOUN = {"SECTOR": "Sector ETF", "INDUSTRY": "Industry group"}
_RS_FALLBACK_SENTENCE = {
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
    if gap and not intraday and not same_symbol and resolved and not resolved.startswith("INDUSTRY:"):
        day = _rs_short_date(_rs_bar_ymd(times[-1]))
        if day:
            return f"No {resolved} bar for {day} yet"
    reason = bench.get("fallback")
    if not reason:
        return None
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
#: Each is the 1 to 99 percentile of the plain 21 / 63 / 126 / 252-bar return
#: (`rs_history.COMPONENTS`), ranked like the rating: a RANK, never a return.
_RS_COMPONENTS: tuple[tuple[str, str], ...] = (("m1", "1M"), ("m3", "3M"), ("m6", "6M"), ("m12", "12M"))


def _rs_rating(sym: str) -> dict:
    """``{ibd, fast, asof, d5, d20, m1, m3, m6, m12, source, summary, components}``
    from `rs_history.read_fields`.

    ``source`` is ``row`` when the history table holds the symbol, ``dark`` when
    `RS_HISTORY_ENABLED` is off (the table is never written on a dark pod) and
    ``missing`` when it is on and the symbol has no row yet. Never raises and
    never fabricates a number: every value is ``None`` until a row exists, and a
    component the row does not hold (a young listing has no 12-month rank) stays
    ``None`` and is left out of ``components``.
    """
    out = {"ibd": None, "fast": None, "asof": None, "d5": None, "d20": None,
           "m1": None, "m3": None, "m6": None, "m12": None, "source": "missing"}
    dark = os.environ.get("RS_HISTORY_ENABLED", "0") != "1"
    row: dict = {}
    try:
        from api.services.screener import rs_history
        row = (rs_history.read_fields([sym]) or {}).get(str(sym or "").upper()) or {}
    except Exception:                                  # noqa: BLE001 — the rating is a garnish, never a 500
        logger.exception("signature: rs rating read failed for %s", sym)
        row = {}
    if row and (row.get("ibd") is not None or row.get("fast") is not None):
        for k in ("ibd", "fast", "d5", "d20") + tuple(k for k, _ in _RS_COMPONENTS):
            v = row.get(k)
            out[k] = int(v) if _rs_num(v) else None
        out["asof"] = row.get("asof")
        out["source"] = "row"
    else:
        out["source"] = "dark" if dark else "missing"
    out["summary"] = _rs_rating_summary(out["ibd"], out["fast"])
    out["components"] = _rs_components_summary(out)
    return out


def _rs_components_summary(rating: dict) -> str | None:
    """The Components row (plan §6.6): ``1M 91 · 3M 97 · 6M 95 · 12M 96``, the
    component ranks that exist in order; None when none does (the row is omitted)."""
    parts = [f"{label} {rating[k]}" for k, label in _RS_COMPONENTS if rating.get(k) is not None]
    return " · ".join(parts) or None


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
                          fetch_bars, custom: str | None = None) -> list:
    """The chart benchmark's bars at `_RS_REGIME_BARS` depth, whatever the RS
    lookback (review #19). The bars already in hand serve when they were read at
    least that deep; otherwise the same benchmark is resolved again at the fixed
    depth. Either way the regime reads the last `_RS_REGIME_BARS` closes, so the
    block is identical at every lookback. A failed or mismatched re-read falls
    back to the bars in hand: a shorter regime with its reason, never a 500.
    ``custom`` is the v4 custom ticker (unit 3-06), re-resolved without a warm
    (the chart's own resolve already asked for one)."""
    have = bench.get("bars") or []
    if count < _RS_REGIME_BARS:
        try:
            from api.services import rs_benchmarks
            if custom:
                deep = rs_benchmarks.resolve_benchmark(sym, requested, tf, _RS_REGIME_BARS,
                                                       fetch_bars=fetch_bars, custom=custom)
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


def _rs_slope_leg(bars, leg_bars, window: int, name: str):
    """``(leg, reason, note)``: the leg, or None with its ``reason`` (the long
    form `reasons` keeps) and its ``note`` (the short form the Agreement summary
    prints after ``<ticker>: ``)."""
    from api.services import relative_strength as rsmod
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
        leg, why, note = _rs_slope_leg(bars, lb, window, ticker)
        if leg is None:
            out["reasons"][key] = why
            notes[key] = (ticker, note)
            continue
        leg["ticker"] = ticker
        out[key] = leg
        series[key] = rsmod.rs_line(bars, lb)
    if all(k in series for k in ("spy", "rsp", "sector")):
        agree = rsmod.benchmark_agree(series["spy"], series["rsp"], series["sector"], window)[-1]
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
    default; ``showMansfield: true`` with the view absent or ``ratio`` is
    ``mansfield``, which keeps every saved Trend instance drawing what it drew.
    An explicit non-ratio view wins over the legacy toggle."""
    raw = str((inputs or {}).get("view") or "").strip().lower()
    view = raw if raw in registry_defs.RS_VIEWS else registry_defs.RS_DEFAULT_VIEW
    if view == "ratio" and toggles.get("showMansfield"):
        return "mansfield"
    return view


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
    custom = ""
    if str(requested or "").upper() == rs_benchmarks.CUSTOM_BENCHMARK:
        custom = rs_benchmarks.normalize_custom_symbol(inp.get("customBenchmark")) or ""
    out["customBenchmark"] = custom
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
        summary += f" · as of {_rs_short_date(asof)}"
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
        return _rs_rotation_unavailable(f"needs {_rs_plural(need, unit)} of both (has {joined()})")
    code = q[idx]
    run = 0
    for i in range(idx, -1, -1):
        if q[i] is None:
            continue
        if q[i] != code:
            break
        run += 1
    name = rsmod.RRG_QUADRANT_NAMES[int(code) - 1]
    summary, asof, stale = _rs_stale_tail(f"{name}, {_rs_plural(run, unit)}", idx, len(q), times)
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
        return _rs_quality_unavailable(f"needs {_rs_plural(window, 'session')} (has {len(valid)})",
                                       window, gap_pct)
    seg = [bars[i] for i in valid[-window:]]
    got = rsmod.clenow_columns(seg, window, gap_pct)
    score, annual, r2, gap = (got[k][-1] for k in ("clenowScore", "clenowAnnual", "clenowR2", "clenowGap"))
    if not (_rs_num(score) and _rs_num(annual) and _rs_num(r2)):
        return _rs_quality_unavailable(f"the price was flat over the last {_rs_plural(window, 'session')}",
                                       window, gap_pct)
    annual_pct = float(annual) * 100.0
    yearly = f"{round(annual_pct):,}"
    yearly = "0" if yearly == "-0" else yearly
    gap_b = gap == 1.0
    summary = (f"Score {_rs_fixed(float(score), 2)}, {yearly}% a year, R² {_rs_fixed(float(r2), 2)}, "
               f"{'has a gap' if gap_b else 'no gap'} over {_rs_gap_text(gap_pct)}%")
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
        return _rs_vars_unavailable(f"needs {_rs_plural(need, unit)} of both (has {joined()})",
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
        text = f"{_rs_signed(v)} against {bench_name}; {avg} needs {ma_length} readings (has {have})"
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
