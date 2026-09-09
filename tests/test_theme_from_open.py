"""From-Open overlay: the Theme Tracker's "vs Open" basis.

Pins that _apply_live_returns layers a live-only `open` period onto each holding and
the theme aggregate, using the SAME owner-only rule as every other period (engine-overlay
members keep their own row but never move the theme number).
"""
from api.services import theme_performance as tp


def _result():
    return {"themes": [{
        "ticker": "XYZ", "name": "Test Theme",
        "group_return": {"1d": 1.0},
        "holdings": [
            {"sym": "AAA", "ref_prices": {"1d": 100.0, "1w": 90.0},
             "returns": {"1d": 1.0, "1w": 5.0}, "source": "owner"},
            {"sym": "BBB", "ref_prices": {"1d": 50.0},
             "returns": {"1d": 2.0}, "source": "owner"},
            {"sym": "ENG", "ref_prices": {"1d": 10.0},
             "returns": {"1d": 9.0}, "source": "engine"},   # engine → excluded from aggregate
        ],
    }]}


def test_open_period_is_layered_per_holding_and_owner_only(monkeypatch):
    monkeypatch.setattr(tp, "_fetch_live_1d_map",
                        lambda syms: {"AAA": 1.5, "BBB": 2.5, "ENG": 9.0})
    monkeypatch.setattr(tp, "_fetch_live_open_map",
                        lambda syms: {"AAA": 0.8, "BBB": 1.2, "ENG": 4.0})

    out = tp._apply_live_returns(_result())
    th = out["themes"][0]
    hs = {h["sym"]: h for h in th["holdings"]}

    # Every holding (owner AND engine) carries its own from-open value.
    assert hs["AAA"]["returns"]["open"] == 0.8
    assert hs["BBB"]["returns"]["open"] == 1.2
    assert hs["ENG"]["returns"]["open"] == 4.0

    # Theme aggregate = owner-only mean (engine member excluded), identical rule to 1d/1w/…
    assert "open" in th["group_return"]
    assert th["group_return"]["open"] == tp._owner_only_mean({"AAA": 0.8, "BBB": 1.2},
                                                             {"AAA", "BBB"})
    # And it is NOT the all-members aggregate — proves the engine row didn't move it.
    assert th["group_return"]["open"] != tp._owner_only_mean(
        {"AAA": 0.8, "BBB": 1.2, "ENG": 4.0}, {"AAA", "BBB", "ENG"})


def test_open_absent_when_no_open_data(monkeypatch):
    # Pre-market / no regular open yet → open map empty → no `open` aggregate, other periods intact.
    monkeypatch.setattr(tp, "_fetch_live_1d_map",
                        lambda syms: {"AAA": 1.5, "BBB": 2.5, "ENG": 9.0})
    monkeypatch.setattr(tp, "_fetch_live_open_map", lambda syms: {})

    out = tp._apply_live_returns(_result())
    th = out["themes"][0]
    assert "open" not in th["group_return"]
    assert all("open" not in h["returns"] for h in th["holdings"])
    assert "1d" in th["group_return"]        # existing behavior untouched


def test_the_1d_path_is_unchanged_by_the_open_overlay(monkeypatch):
    # Byte-for-byte: with an empty open map, the result equals the pre-feature behavior.
    monkeypatch.setattr(tp, "_fetch_live_1d_map",
                        lambda syms: {"AAA": 1.5, "BBB": 2.5, "ENG": 9.0})
    monkeypatch.setattr(tp, "_fetch_live_open_map", lambda syms: {})
    out = tp._apply_live_returns(_result())
    hs = {h["sym"]: h for h in out["themes"][0]["holdings"]}
    assert hs["AAA"]["returns"]["1d"] == 1.5
    assert hs["BBB"]["returns"]["1d"] == 2.5
