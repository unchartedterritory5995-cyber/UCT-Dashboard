

# ── placeholder-stop detection must not rest on exact float equality ────────
#
# SAFETY-CRITICAL: a broker placeholder (stop == entry, because the column is
# NOT NULL and the broker reports no stop) counted as a REAL stop reads as zero
# risk → under-reported heat → an over-cap add escapes the no-GO guard. Exact
# equality holds today only because the placeholder is a straight copy; any
# recompute leaves a few ULPs and the guard silently stops firing.

from api.services.portfolio_heat import _is_placeholder_stop


def test_exact_placeholder_is_detected():
    assert _is_placeholder_stop(100.0, 100.0) is True


def test_placeholder_survives_float_drift():
    """The regression this guards: a recomputed copy, not a byte-identical one."""
    entry = 187.43
    drifted = (entry * 3) / 3          # mathematically entry, not bitwise
    assert _is_placeholder_stop(drifted, entry) is True


def test_a_real_stop_is_not_a_placeholder():
    assert _is_placeholder_stop(95.0, 100.0) is False
    assert _is_placeholder_stop(99.99, 100.0) is False


def test_unusable_stops_are_placeholders():
    assert _is_placeholder_stop(0.0, 100.0) is True
    assert _is_placeholder_stop(-5.0, 100.0) is True
    assert _is_placeholder_stop(100.0, 0.0) is True
