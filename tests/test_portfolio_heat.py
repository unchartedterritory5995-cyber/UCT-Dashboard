

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


def test_wave2_a_real_stop_reports_its_price_and_dollars_a_placeholder_reports_none(monkeypatch):
    from api.services import portfolio_heat as ph
    from api.services.portfolio_heat import portfolio_heat
    monkeypatch.setattr(ph, "_sectors_for", lambda s: set())
    rows = [{"symbol": "NVDA", "entryPrice": 100, "shares": 10, "stopPrice": 95.5},
            {"symbol": "AMD", "entryPrice": 50, "shares": 10, "stopPrice": 50}]
    out = portfolio_heat("u", account_size=10000, positions_fn=lambda u, a: rows,
                         regime_fn=lambda: {}, cap_fn=lambda: 10)
    by = {p["symbol"]: p for p in out["per_position"]}
    assert by["NVDA"]["stop_price"] == 95.5 and by["NVDA"]["risk_dollars"] == 45.0
    assert by["AMD"]["stop_price"] is None and by["AMD"]["risk_dollars"] is None


def test_unusable_stops_are_placeholders():
    assert _is_placeholder_stop(0.0, 100.0) is True
    assert _is_placeholder_stop(-5.0, 100.0) is True
    assert _is_placeholder_stop(100.0, 0.0) is True
