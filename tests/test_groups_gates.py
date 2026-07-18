import importlib
from api.services import groups_gates as g


def test_env_float_defaults_on_bad_value(monkeypatch):
    monkeypatch.setenv("X_BAD", "not-a-number")
    assert g._env_float("X_BAD", 4.0) == 4.0
    monkeypatch.setenv("X_OK", "12.5")
    assert g._env_float("X_OK", 4.0) == 12.5
    monkeypatch.delenv("X_MISSING", raising=False)
    assert g._env_float("X_MISSING", 7.0) == 7.0


def test_gates_enabled_default_off(monkeypatch):
    monkeypatch.delenv("GROUPS_SWING_GATES_ENABLED", raising=False)
    assert g.gates_enabled() is False
    monkeypatch.setenv("GROUPS_SWING_GATES_ENABLED", "1")
    assert g.gates_enabled() is True
    monkeypatch.setenv("GROUPS_SWING_GATES_ENABLED", "0")
    assert g.gates_enabled() is False


def test_gate_bands_liquidity_tiers(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    # confirmed liquid + full momentum
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6}) == (0, 2)
    # confirmed liquid, no momentum
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": 30, "adr_pct": 2}) == (0, 0)
    # missing price -> unconfirmed (band 1), even with great momentum (IPO case)
    assert g.gate_bands({"price": None, "dollar_vol": None, "rs_rank": 90, "adr_pct": 7}) == (1, 2)
    # confirmed illiquid: real data below floors -> band 2, momentum still computed
    assert g.gate_bands({"price": 2.0, "dollar_vol": 1e6, "rs_rank": 88, "adr_pct": 6}) == (2, 2)
    # missing momentum inputs count 0, not failure
    assert g.gate_bands({"price": 50, "dollar_vol": 5e8, "rs_rank": None, "adr_pct": None}) == (0, 0)
    # None / empty metrics -> unconfirmed, zero momentum
    assert g.gate_bands(None) == (1, 0)


def test_gate_score_composite(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    assert g.gate_score({"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6}) == 4  # liq2 + mom2
    assert g.gate_score({"price": 2.0, "dollar_vol": 1e6, "rs_rank": 88, "adr_pct": 6}) == 2  # liq0 + mom2
    assert g.gate_score(None) == 1  # unconfirmed liq(1) + mom0


def test_pass_rates_counts_each_gate(monkeypatch):
    monkeypatch.setattr(g, "PX_MIN", 5.0)
    monkeypatch.setattr(g, "DVOL_MIN", 20_000_000.0)
    monkeypatch.setattr(g, "RS_MIN", 70.0)
    monkeypatch.setattr(g, "ADR_MIN", 4.0)
    pr = g.pass_rates({
        "A": {"price": 50, "dollar_vol": 5e8, "rs_rank": 88, "adr_pct": 6},   # all four pass
        "B": {"price": 2, "dollar_vol": 1e6, "rs_rank": 30, "adr_pct": 2},    # none pass
    })
    assert pr == {"rs": 1, "dvol": 1, "adr": 1, "px": 1, "n": 2}
