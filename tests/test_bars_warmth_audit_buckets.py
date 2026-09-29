"""The warm/cold audit must be able to COMPUTE the p95 gate it is quoted for.

⚰️⚰️ THE DEFECT. `tools/bars_warmth_audit.py` classed `stale-swr` as COLD while its
own docstring defined COLD as "the user waited". Stale-while-revalidate serves the
cached value IMMEDIATELY and refreshes behind the request, so nobody waited. On
daily reads that is the dominant layer, so the WARM set came back EMPTY — and the
old code was `if warm_ms:` with no `else`, so it printed NOTHING and the next line,
the COLD line's `p50=... max=...`, was read as the p95. CARD 16's ratified p95 bar
had therefore never once been computed, and a figure recorded as a PASS was a
different statistic over the opposite population.

⭐ WHY A THIRD BUCKET AND NOT A REASSIGNMENT. Folding `stale-swr` into WARM lets the
gate pass by serving stale data instantly; folding it into COLD claims a wait that
did not happen. "Instant but stale" is its own fact, and this is the same rule
`CoverageLine` follows by keeping "not computable" apart from "dropped".

These tests pin the three-way split, the no-wait population the gate is computed
over, and — the load-bearing one — that an all-waited sample reports NOT COMPUTABLE
rather than falling silent.
"""
from __future__ import annotations

import importlib.util
import os

import pytest

_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "tools", "bars_warmth_audit.py")


def _load():
    """Import the tool by path; it is a script in tools/, not a package module."""
    spec = importlib.util.spec_from_file_location("bars_warmth_audit", _PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_stale_swr_is_its_own_bucket_and_not_cold():
    m = _load()
    assert "stale-swr" in m.STALE_SERVED, (
        "stale-swr must be its own state — it is served instantly")
    assert "stale-swr" not in m.COLD, (
        "stale-swr back in COLD: on daily that empties WARM and the p95 gate "
        "becomes uncomputable, which is exactly how a cold p50/max got recorded "
        "as a p95 pass")
    assert "stale-swr" not in m.WARM, (
        "stale-swr in WARM would let the gate pass by serving STALE data instantly")


def test_the_three_buckets_are_disjoint():
    m = _load()
    assert not (m.WARM & m.COLD), "WARM and COLD overlap"
    assert not (m.WARM & m.STALE_SERVED), "WARM and STALE_SERVED overlap"
    assert not (m.COLD & m.STALE_SERVED), "COLD and STALE_SERVED overlap"


def test_the_layers_that_mean_the_user_waited_are_still_cold():
    """A control: the reclassification must not have emptied COLD as a side effect."""
    m = _load()
    for layer in ("fetch", "inflight-wait", "disk", "miss", "unknown"):
        assert layer in m.COLD, f"{layer} must stay COLD — the user waited for it"


def test_pct_of_reproduces_the_arithmetic_the_inline_p95_used():
    """Continuity: a number printed today must compare with one already recorded."""
    m = _load()
    vals = sorted([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    for q in (0.50, 0.90, 0.95):
        expected = vals[min(len(vals) - 1, int(len(vals) * q))]
        assert m.pct_of(vals, q) == expected, f"q={q} diverged from the old formula"


def test_pct_of_REFUSES_an_empty_sample_rather_than_returning_zero():
    """⛔ The load-bearing one.

    A percentile of 0 over no samples is precisely the shape that lets an
    uncomputable gate read as a pass. It must raise so the caller is forced to
    print NOT COMPUTABLE.
    """
    m = _load()
    with pytest.raises(ValueError):
        m.pct_of([], 0.95)


def test_an_all_stale_sample_IS_computable_which_it_was_not_before():
    """The regression in one assertion.

    Before the fix, a sample served entirely by stale-swr produced an empty WARM
    list and no p95 at all. The gate is a LATENCY bar, so the no-wait population
    is WARM plus STALE_SERVED — and over an all-stale sample that is non-empty,
    so the gate can be evaluated.
    """
    m = _load()
    warm_ms: list[float] = []
    stale_ms = [120.0, 130.0, 140.0, 150.0]
    nowait = sorted(warm_ms + stale_ms)
    assert nowait, "an all-stale sample must still yield a no-wait population"
    assert m.pct_of(nowait, 0.95) == 150.0


def test_forty_stale_swr_samples_produce_a_p95_line_naming_n_and_the_quantity():
    """TERM-012 (a)+(b): the ticket's own control, a 40-sample stale-swr fixture."""
    m = _load()
    stale_ms = sorted(float(100 + i) for i in range(40))
    line = m.pct_line("no-wait latency", stale_ms)
    assert "p95=" in line and "n=40" in line
    assert m.QUANTITY in line, "a percentile that does not name its quantity is TERM-012's defect"


def test_the_p95_index_on_forty_samples_is_38_the_second_largest():
    """INST-8/DOC-1: on n=40 the nearest-rank p95 is index 38, the second largest."""
    m = _load()
    vals = list(range(40))
    assert m.pct_of(vals, 0.95) == 38


def test_both_buckets_print_through_the_one_line_helper():
    """Neither the no-wait nor the COLD print may bypass pct_line (and so drop n or the quantity)."""
    import pathlib
    src = pathlib.Path(_load().__file__).read_text(encoding="utf-8")
    code = "\n".join(l.split("#", 1)[0] for l in src.splitlines())
    assert code.count('pct_line("no-wait latency"') == 1
    assert code.count('pct_line("COLD latency"') == 1
    assert "pct_of(nowait" not in code and "pct_of(cold_ms" not in code
