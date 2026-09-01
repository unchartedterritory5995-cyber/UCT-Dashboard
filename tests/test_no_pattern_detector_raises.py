"""No PATTERN-ENGINE detector may RAISE. Same defect class as `_sma`.

⭐⭐ WHY THIS FILE EXISTS, AND WHY IT IS A COPY OF NOTHING.
`pattern_engine.detect_all` ends every detector call with:

    except Exception as e:
        # Detectors should not crash the engine. Swallow + log.
        logging.getLogger(__name__).warning("detector %s raised: %s", ...)

That is the identical contract to `bases._collect_relations`, and it produced
the identical outage there: a detector whose later lines raise fires on ZERO
symbols forever while everything upstream reports success. `_detect_pocket_pivot`
cost 2,811 tickers' worth of a shipped structure that way. The engine has 85
registered detectors behind that one `except`, and the log line it writes goes
to a Railway stream that is, in this repo's own words, "flooded by yfinance/theme
noise" — so the warning is not a safety net, it is where the evidence goes to die.

⛔ THE SWALLOW HAS A SECOND MOUTH, AND IT IS BIGGER. Both production callers
(`main.py::_run_patterns_universe_scan` and `pattern_vision/orchestrator.py`)
wrap `build_context(...)` in the SAME try as `detect_all(...)`, and the
orchestrator's handler returns `[]`. A raise in `build_context` therefore costs
not one detector but ALL 85, for that symbol, silently. It is swept here first.

⛔ TWO SPELLINGS OF `t`, BOTH SHIPPED. `types.Bar` documents `t` as unix
seconds; the only thing that builds these bars in production is
`bars_sqlite.get_bars(sym, "D", 200)`, whose own docstring says "ts is YYYYMMDD
for D/W/M, unix seconds for intraday". So the DAILY path — every scheduled
universe scan — feeds YYYYMMDD ints into a field documented as epoch. Both are
swept: a rail that drove only the documented one would leave the shipped one
unmeasured. (See `tests/detector_fixtures.py`.)

⛔ AND THE BAR COUNTS ARE PRODUCTION'S, NOT ROUND NUMBERS. `get_bars(…, 200)`
caps the daily window at 200 and both callers skip symbols under 30, so the real
range a detector ever sees is 30-200 bars — well under the 620 the screener rail
uses. A 620-bar-only fixture would never execute the "insufficient history"
branches that half these detectors open with.
"""
import sys, pathlib, logging
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

# Importing the patterns router is what REGISTERS all detectors; the registry is
# empty until then. Both production callers do exactly this.
import api.routers.patterns  # noqa: F401

from api.services.pattern_engine import detect_all
from api.services.pattern_engine.detectors.registry import (
    get_detector, list_pattern_ids,
)
from api.services.pattern_engine.primitives.context import build_context

#: ⛔ ONE fixture authority, shared with `tests/test_no_detector_raises.py`.
from tests.detector_fixtures import (
    walk, gap_walk, edge_series, ymd_t, epoch_t,
)


def _intraday_t(i):
    return epoch_t(i, minutes=5)


def _series():
    """Every synthetic series this rail runs over, as `(name, bars)`.

    ⛔ ONE list, consumed by the rule AND by both controls."""
    # The shipped daily path: YYYYMMDD `t`, production's 30-200 bar window.
    for seed in range(20):
        full = gap_walk(seed, bars=200, t=ymd_t)
        for n in (200, 120, 60, 30):
            yield f"daily-ymd/seed={seed}/n={n}", full[:n]
    # The DOCUMENTED contract: unix-seconds `t`.
    for seed in range(10):
        full = gap_walk(seed, bars=200, t=epoch_t)
        for n in (200, 60):
            yield f"daily-epoch/seed={seed}/n={n}", full[:n]
    # Intraday, where `t` really is unix seconds and the opening-range
    # detectors read the first bars of the list as the opening range.
    for seed in range(10):
        full = gap_walk(seed, bars=78, t=_intraday_t)
        for n in (78, 39):
            yield f"intraday-5m/seed={seed}/n={n}", full[:n]
    yield from edge_series()
    # The un-gapped walk too, so the original fixture's coverage is not lost.
    for seed in range(5):
        yield f"walk/seed={seed}", walk(seed, bars=200)


SERIES = list(_series())


def _detectors() -> dict:
    """The REGISTERED detectors, derived — never a typed list."""
    return {pid: get_detector(pid) for pid in list_pattern_ids()}


def _sweep(detectors: dict, series=None):
    """Run every detector over every series.

    Returns `(failures, fired, ctx_failures)` where `failures` is
    `{pattern_id: [errors]}` and `fired` is `{pattern_id: n_series_with_hits}`.

    ⛔ ONE implementation, shared by the rule and by its controls. A control
    that reimplements the sweep proves the control works, not the rail. The
    `series` override exists so a control can plant a MALFORMED series without
    mutating the module-level list every other case reads."""
    failures, fired, ctx_failures = {}, {}, []
    for name, bars in (SERIES if series is None else series):
        try:
            ctx = build_context(bars, "TEST")
        except Exception as e:                          # noqa: BLE001
            ctx_failures.append(f"{name}: {type(e).__name__}: {e}")
            continue
        for pid, fn in detectors.items():
            try:
                out = fn(bars, ctx)
            except Exception as e:                      # noqa: BLE001
                failures.setdefault(pid, []).append(
                    f"{name}: {type(e).__name__}: {e}")
                continue
            if out:
                fired[pid] = fired.get(pid, 0) + 1
    return failures, fired, ctx_failures


_CACHE = {}


def _sweep_all():
    """The full sweep, run ONCE per session and shared by every case below."""
    if "r" not in _CACHE:
        _CACHE["r"] = _sweep(_detectors())
    return _CACHE["r"]


# ─── the controls, first ────────────────────────────────────────────────────

def test_the_registry_is_actually_populated():
    """⛔ NON-VACUITY, outermost layer. The registry is EMPTY until
    `api.routers.patterns` is imported — so a sweep that forgot the import runs
    zero detectors over every series and reports a clean, meaningless pass."""
    ids = list_pattern_ids()
    # Measured 2026-08-31: 85 registered.
    assert len(ids) >= 80, (
        f"only {len(ids)} detectors registered ({ids}) — the registry is not "
        f"populated, so 'no detector raised' is a statement about nothing")
    assert len(SERIES) > 100, (
        f"only {len(SERIES)} series built — the sweep is not driving the "
        f"detectors over a meaningful population")


def test_the_fixture_actually_makes_detectors_FIRE():
    """⛔ NON-VACUITY, the half that matters. Every assertion below is "nothing
    raised", which a fixture rejected on line 1 by all 85 detectors satisfies
    perfectly. This demands they actually return detections."""
    _failures, fired, _ctx = _sweep_all()
    # Measured 2026-08-31: 62 of 85 detectors fire at least once across
    # these 131 series.
    assert len(fired) >= 55, (
        f"only {len(fired)} of {len(list_pattern_ids())} detectors ever "
        f"returned a detection ({sorted(fired)}) — 'nothing raised' says "
        f"little about the ones never driven past their early gates")


def test_the_sweep_reports_a_PLANTED_crashing_detector():
    """⛔ THE CONTROL THAT MATTERS. The rule asserts an EMPTY dict — a sweep
    that swallowed its own exceptions, or that never called anything, returns
    `{}` and passes forever. Routed through the SAME `_sweep`.

    Note the planted detector is passed IN rather than `register()`ed: the
    registry is a process-global dict and a test that poisons it would leak
    into every other pattern-engine test in the session."""
    def _boom(bars, context):
        raise AttributeError("'float' object has no attribute 'get'")

    failures, fired, _ctx = _sweep({"planted-crash": _boom})
    assert "planted-crash" in failures, (
        "the sweep did not report a detector that raises on every series — it "
        "cannot see the defect this file exists to catch")
    assert len(failures["planted-crash"]) == len(SERIES)
    assert not fired, "a detector that only raises must never count as fired"


def test_the_sweep_reports_a_PLANTED_broken_context():
    """The context half of the control. `build_context` raising costs all 85
    detectors at once, so the sweep must report that separately and not as a
    quiet zero-detector pass."""
    _f, _fired, ctx_failures = _sweep_all()
    assert ctx_failures == [], (
        "build_context RAISED. Both production callers wrap it in the same "
        "try as detect_all, so this silently costs the symbol every one of "
        f"its {len(list_pattern_ids())} detectors:\n  " + "\n  ".join(ctx_failures))
    # and prove the reporting channel is live, using the same helper:
    _f2, _fired2, planted_ctx = _sweep(
        {}, series=[("planted-bad-bars", [{"t": "not-a-bar"}])])
    assert planted_ctx, (
        "the sweep did not report a build_context failure on a malformed "
        "series — it cannot see the failure that costs every detector at once")


# ─── the rule ───────────────────────────────────────────────────────────────

def test_no_pattern_detector_raises_on_any_synthetic_series():
    failures, _fired, _ctx = _sweep_all()
    assert not failures, (
        "these detectors RAISED. `pattern_engine.detect_all` swallows the "
        "exception per detector and logs a warning into a stream nothing "
        "reads, so in production each of these is a pattern that can never be "
        "detected while the engine reports a clean scan:\n"
        + "\n".join(f"  {k}: {v[0]}  ({len(v)} of {len(SERIES)} series)"
                    for k, v in sorted(failures.items()))
    )


def test_detect_all_itself_swallows_nothing(caplog):
    """⛔ THE WIRE, NOT THE COMPONENTS. Everything above calls the detector
    functions directly. This drives the REAL production entrypoint and asserts
    the swallow never fires — so a detector that raises only when reached
    THROUGH `detect_all` (a registry mismatch, a bad `pattern_ids` filter, a
    sort key blowing up on a malformed Detection) is caught too."""
    sample = [(n, b) for n, b in SERIES if len(b) >= 60][:12]
    assert len(sample) == 12, "no series long enough to drive detect_all"
    total = 0
    with caplog.at_level(logging.WARNING,
                         logger="api.services.pattern_engine"):
        for name, bars in sample:
            ctx = build_context(bars, "TEST")
            total += len(detect_all(bars, ctx))
    swallowed = [r.getMessage() for r in caplog.records if "raised" in r.getMessage()]
    assert not swallowed, (
        "detect_all logged a swallowed detector exception:\n  "
        + "\n  ".join(sorted(set(swallowed))))
    # ⛔ NON-VACUITY: an entrypoint that returned [] for every symbol would
    # also log nothing.
    assert total > 50, (
        f"detect_all produced only {total} detections across {len(sample)} "
        f"series — 'nothing was swallowed' is vacuous if nothing ran")
