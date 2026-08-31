"""No structure detector may RAISE. A crashing detector is a silent dead one.

⭐⭐ THE DEFECT THIS EXISTS FOR, MEASURED. `_detect_pocket_pivot` called
`_sma(closes, 10)` where `_sma` takes BARS, so it raised `AttributeError` on
every symbol that got past its early gates. `bases._collect_relations` catches
per-predicate exceptions BY DESIGN — "one bad predicate costs that predicate,
never the row" — which is the right contract and is exactly what made this
invisible. Measured 2026-08-31: pocket-pivot fired on **0 of 2,811 tickers**
while its catalog entry claimed `coverage_pct=1.5`. After the one-word fix it
fires on 43 of 2,811 (1.53%), so the CLAIM had been right all along and the
code had silently stopped matching it.

⛔ WHY A UNIT TEST COULD NOT HAVE CAUGHT IT. Nothing was logically wrong with
the structure's rules, its criteria, its provenance or its catalog entry. The
failure lived in the gap between a correct predicate and a correct swallow, and
only running the predicate over data that reaches its later lines exposes it.

⛔ AND WHY THIS FILE USES SYNTHETIC SERIES RATHER THAN THE REAL UNIVERSE. A rail
that needs `bars.db` cannot run in CI, would touch the owner's live data, and
would be skipped into uselessness. Seeded random walks are deterministic, need
no database, and drive the detectors deep: a walk that gaps, trends, reverses
and expands its range hits the same later lines the universe does — which is
the whole reason this rail reproduces the bug.
"""
import sys, pathlib, random, datetime
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest

from api.services.screener import base_catalog as bc
from api.services.screener.bases import BaseCtx

_DAY0 = datetime.date(2023, 1, 2)

SERIES = 60          # seeded walks per run
BARS = 620           # comfortably past the deepest `min_bars` (210) + 200-dma


def _walk(seed: int, bars: int = BARS) -> list:
    """A price series with trends, gaps, reversals and volume swings.

    ⛔ NOT a smooth line. A flat or monotonic series is rejected by nearly every
    detector's early gates, so it would exercise none of the later arithmetic
    where this bug class lives — a fixture that cannot reach the defect is not
    a rail.
    """
    rng = random.Random(seed)
    out, price = [], 20.0 + rng.random() * 180.0
    drift = rng.uniform(-0.0015, 0.0025)
    for i in range(bars):
        if rng.random() < 0.03:                 # regime flip
            drift = rng.uniform(-0.003, 0.004)
        shock = rng.gauss(0, 0.022) + drift
        if rng.random() < 0.02:                 # gap
            shock += rng.choice([-1, 1]) * rng.uniform(0.03, 0.12)
        o = price
        price = max(0.5, price * (1.0 + shock))
        c = price
        spread = abs(c - o) + o * rng.uniform(0.002, 0.03)
        h = max(o, c) + spread * rng.random()
        l = max(0.01, min(o, c) - spread * rng.random())
        v = int(abs(rng.gauss(1_000_000, 400_000))) + rng.randint(1, 50_000)
        if rng.random() < 0.05:                 # volume spike
            v *= rng.randint(3, 12)
        # ⛔ REAL calendar dates. The first draft used `20240101 + i`, which
        # produces 20240132 — and the Weinstein stage detectors parse `t` as a
        # date, so they raised on every series. That was the FIXTURE lying, not
        # the product, and it is worth recording: this rail is sensitive enough
        # to catch a malformed timestamp, so a failure here is read carefully
        # before anything in `api/` is touched.
        d = _DAY0 + datetime.timedelta(days=i)
        out.append({"t": int(d.strftime("%Y%m%d")),
                    "o": o, "h": h, "l": l, "c": c, "v": v})
    return out


def _ctx(bars):
    return BaseCtx(bars=bars, bars_full=bars)


def _detectors():
    return [s for s in bc.ALL_STRUCTURES if s.detect is not None]


# ─── the control, first ─────────────────────────────────────────────────────

def test_the_fixture_actually_reaches_the_detectors():
    """⛔ NON-VACUITY. Every assertion below is "nothing raised". A fixture that
    every detector rejects on its first line satisfies that trivially. This
    demands the walks be interesting enough that detectors actually FIRE."""
    fired = set()
    for seed in range(SERIES):
        ctx = _ctx(_walk(seed))
        for s in _detectors():
            if len(ctx.bars) < s.min_bars:
                continue
            try:
                if s.detect(ctx):
                    fired.add(s.key)
            except Exception:
                pass
    assert len(fired) >= 6, (
        f"only {sorted(fired)} fired on {SERIES} synthetic series — the fixture "
        f"is not driving the detectors deep enough for 'nothing raised' to mean "
        f"anything"
    )


def _sweep(detectors) -> dict:
    """Run every detector over every series; return {key: [errors]}.

    ⛔ ONE implementation, shared by the rule and by its control. A control that
    reimplements the sweep proves the control works, not the rail — the
    `_render_order` probe in this repo made exactly that mistake and
    re-measured 56 twice."""
    failures = {}
    for seed in range(SERIES):
        bars = _walk(seed)
        ctx = _ctx(bars)
        for s in detectors:
            if len(bars) < s.min_bars:
                continue
            try:
                s.detect(ctx)
            except Exception as e:                     # noqa: BLE001
                failures.setdefault(s.key, []).append(
                    f"seed={seed}: {type(e).__name__}: {e}")
    return failures


def test_the_sweep_reports_a_PLANTED_crashing_detector():
    """⛔ THE CONTROL THAT MATTERS. `test_no_structure_detector_raises` asserts
    an EMPTY dict — a sweep that silently swallowed its own exceptions, or that
    skipped every detector on a `min_bars` check, would return `{}` and pass
    forever. This plants a detector that always raises and requires the SAME
    `_sweep` to report it by name.

    Mutation-verified against the real thing on 2026-08-31: restoring the
    original `_sma(closes, ...)` bug makes the rule case fail with
    `pocket-pivot: AttributeError ... (8 of 60 series)`."""
    planted = bc.Structure(
        key="planted-crash", label="Planted Crash", axis="relation",
        family="Test", bias="neutral", rank=999, min_bars=1,
        desc="always raises",
        detect=lambda ctx: (_ for _ in ()).throw(
            AttributeError("'float' object has no attribute 'get'")),
    )
    found = _sweep([planted])
    assert "planted-crash" in found, (
        "the sweep did not report a detector that raises on every series — it "
        "cannot see the defect this file exists to catch"
    )
    assert len(found["planted-crash"]) == SERIES


# ─── the rule ───────────────────────────────────────────────────────────────

def test_no_structure_detector_raises_on_any_synthetic_series():
    failures = _sweep(_detectors())
    assert not failures, (
        "these detectors RAISED. `bases._collect_relations` swallows the "
        "exception per predicate, so in production each of these is a "
        "structure that can never fire while its catalog entry still "
        "advertises a coverage figure:\n"
        + "\n".join(f"  {k}: {v[0]}  ({len(v)} of {SERIES} series)"
                    for k, v in sorted(failures.items()))
    )


def test_no_shape_classifier_raises_either():
    """The SHAPE axis is a total partition — a raise there does not lose one
    label, it loses the symbol's only guaranteed answer."""
    from api.services.screener import bases
    for seed in range(SERIES):
        bars = _walk(seed)
        try:
            out = bases.classify(bars)
        except Exception as e:                          # noqa: BLE001
            pytest.fail(f"bases.classify raised on seed={seed}: "
                        f"{type(e).__name__}: {e}")
        assert out.get("base_shape"), (
            f"seed={seed} produced no shape, but the shape axis is a TOTAL "
            f"partition — every symbol must get exactly one"
        )
