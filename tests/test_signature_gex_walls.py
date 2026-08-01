import copy
import json

from api.services.signature import rules
from api.services.signature.gex_walls import shape_walls, fetch_gex_walls

# The ONLY regimes gex_service can emit (classify_gex_state, gex_service.py:195-210).
# Fixtures use these so nothing in the repo documents a regime enum that
# cannot occur in production.
REAL_REGIMES = ("bullish", "bearish", "choppy", "unbound")


def _gex(spot=500.0):
    return {"spot": spot, "regime": "choppy",
            "callWall": {"strike": 510.0, "gex": 1e9},
            "putWall": {"strike": 480.0, "gex": -8e8},
            "zeroGamma": 495.0}


def test_shapes_three_levels():
    out = shape_walls(_gex())
    kinds = {l["kind"]: l["price"] for l in out["levels"]}
    assert kinds == {"callWall": 510.0, "putWall": 480.0, "zeroGamma": 495.0}
    assert out["regime"] == "choppy" and out["version"] == "gxw-v1"


def test_far_levels_dropped():
    g = _gex()
    g["callWall"]["strike"] = 700.0  # 40% away
    out = shape_walls(g)
    assert all(l["kind"] != "callWall" for l in out["levels"])


def test_error_passthrough_is_safe():
    out = shape_walls({"error": "Schwab not authenticated"})
    assert out["levels"] == [] and out["error"]


# ── The payload is a wire contract: pin it exactly, once ─────────────────

def test_exact_levels_payload_is_pinned():
    """The dict-comprehension test above passes on ANY key ordering, extra
    keys, or renamed envelope fields. This is the one place the shape the
    chart overlay actually consumes is pinned whole."""
    assert shape_walls(_gex()) == {
        "levels": [
            {"kind": "callWall", "price": 510.0},
            {"kind": "putWall", "price": 480.0},
            {"kind": "zeroGamma", "price": 495.0},
        ],
        "spot": 500.0,
        "regime": "choppy",
        "version": "gxw-v1",
    }


def test_error_payload_is_exactly_shaped():
    """An error payload must carry NO spot/regime keys a caller could read as
    real data, and must still be version-stamped so a stale-served envelope is
    identifiable."""
    assert shape_walls({"error": "Schwab not authenticated"}) == {
        "levels": [], "error": "Schwab not authenticated", "version": "gxw-v1",
    }


def test_empty_and_none_input_are_safe():
    """gex_service can hand back {} on an empty chain; a serve-stale slot can
    hand back None. Neither may raise, and neither may report levels -- and
    both must say WHY rather than look like a successful empty chain."""
    for bad in (None, {}):
        out = shape_walls(bad)
        assert out["levels"] == [], bad
        assert out["error"] == "no data", bad
        assert out["version"] == "gxw-v1", bad


# ── The ±15% band: <= keeps, > drops, and the number comes from rules ────

def test_level_exactly_at_the_band_edge_is_kept():
    """575.0 is EXACTLY 15% above a 500 spot ((575-500)/500 == 0.15 as an IEEE
    double, no rounding slop). The gate is `<=`, so it is IN. A `<` would drop
    it and every test above would stay green."""
    g = _gex()
    g["callWall"]["strike"] = 500.0 * (1 + rules.GXW_MAX_DIST_PCT)
    assert (575.0 - 500.0) / 500.0 == rules.GXW_MAX_DIST_PCT  # no float slop
    kinds = {l["kind"] for l in shape_walls(g)["levels"]}
    assert "callWall" in kinds


def test_level_one_step_past_the_band_edge_is_dropped():
    g = _gex()
    g["callWall"]["strike"] = 575.01
    assert all(l["kind"] != "callWall" for l in shape_walls(g)["levels"])


def test_band_gate_reads_the_rules_constant(monkeypatch):
    """Mutation check on 'constants come from rules, never re-hardcoded'.

    Tightening the constant must DROP a level the default keeps, and widening
    it must KEEP one the default drops. A hardcoded 0.15 in gex_walls.py fails
    both halves while every other test stays green."""
    monkeypatch.setattr(rules, "GXW_MAX_DIST_PCT", 0.005)
    assert shape_walls(_gex())["levels"] == []      # 510/480/495 are all >0.5% away

    monkeypatch.setattr(rules, "GXW_MAX_DIST_PCT", 0.50)
    g = _gex()
    g["callWall"]["strike"] = 700.0                 # 40% away
    assert any(l["kind"] == "callWall" for l in shape_walls(g)["levels"])


def test_the_band_is_two_sided():
    """`abs()`, not a one-sided compare: a wall far BELOW spot is just as
    unusable as one far above."""
    g = _gex()
    g["putWall"]["strike"] = 300.0   # 40% below
    g["zeroGamma"] = 250.0           # 50% below
    assert [l["kind"] for l in shape_walls(g)["levels"]] == ["callWall"]


def test_prices_are_not_rounded():
    """The chart draws these lines against real bar prices; rounding a wall to
    2dp moves the level. Nothing here may round."""
    g = _gex()
    g["zeroGamma"] = 495.123456789
    g["callWall"]["strike"] = 510.987654321
    prices = {l["kind"]: l["price"] for l in shape_walls(g)["levels"]}
    assert prices["zeroGamma"] == 495.123456789
    assert prices["callWall"] == 510.987654321


# ── Real upstream nulls: gex_service emits these on a thin chain ─────────

def test_none_zero_gamma_is_skipped_not_crashed():
    """`zeroGamma` is float|None — it is None whenever the search finds no
    flip strike and there is no put wall to fall back to."""
    g = _gex()
    g["zeroGamma"] = None
    assert [l["kind"] for l in shape_walls(g)["levels"]] == ["callWall", "putWall"]


def test_none_and_missing_walls_are_skipped_not_crashed():
    """cw_dict/pw_dict are literally `None` when no wall is found (gex_service
    L484-485). Without the `or {}` guard this is a TypeError, i.e. a 500."""
    g = _gex()
    g["callWall"] = None
    del g["putWall"]
    assert [l["kind"] for l in shape_walls(g)["levels"]] == ["zeroGamma"]

    g2 = _gex()
    g2["callWall"] = {}                 # present but empty -> strike missing
    g2["putWall"] = {"strike": None}    # present but null strike
    g2["zeroGamma"] = None
    assert shape_walls(g2)["levels"] == []


def test_missing_or_unusable_spot_yields_no_levels_and_never_divides_by_zero():
    """Every distance is `/ spot`. A missing/None/zero spot must yield an empty
    level list, not a ZeroDivisionError."""
    for spot in (None, 0, 0.0, -1.0):
        g = _gex()
        g["spot"] = spot
        out = shape_walls(g)
        assert out["levels"] == [], spot
        assert out["spot"] == float(spot or 0), spot

    g = _gex()
    del g["spot"]
    assert shape_walls(g)["levels"] == []


def test_missing_regime_is_an_empty_string_not_none():
    g = _gex()
    del g["regime"]
    assert shape_walls(g)["regime"] == ""


# ── Non-finite must never reach the wire (FastAPI serializes allow_nan=False) ──

def test_nan_spot_yields_an_empty_json_serializable_payload():
    """gex_service's own gate is `if spot <= 0` (gex_service.py:290) and
    `nan <= 0` is False -- so a NaN underlyingPrice sails straight through to
    here. A bare NaN in the response is NOT a walls-only failure: FastAPI's
    JSONResponse uses allow_nan=False, and a browser `r.json()` on `NaN`
    throws, killing the WHOLE chart-overlay hook.

    json.dumps(..., allow_nan=False) is the load-bearing assertion -- the
    empty level list alone passes even with the bug, because every NaN
    comparison in the band gate is already False."""
    for bad_spot in (float("nan"), float("inf"), float("-inf")):
        g = _gex()
        g["spot"] = bad_spot
        out = shape_walls(g)
        assert out["levels"] == [], bad_spot
        json.dumps(out, allow_nan=False)     # raises ValueError if NaN/inf leaked


def test_a_nan_strike_drops_only_that_level():
    """One poisoned wall must not take the other levels down with it, and the
    full envelope must still serialize."""
    g = _gex()
    g["callWall"]["strike"] = float("nan")
    out = shape_walls(g)

    assert [l["kind"] for l in out["levels"]] == ["putWall", "zeroGamma"]
    assert out["spot"] == 500.0
    json.dumps(out, allow_nan=False)

    g2 = _gex()
    g2["zeroGamma"] = float("inf")
    out2 = shape_walls(g2)
    assert [l["kind"] for l in out2["levels"]] == ["callWall", "putWall"]
    json.dumps(out2, allow_nan=False)


# ── One fixture built from the REAL get_gex_data return ──────────────────

def _real_gex():
    """The actual gex_service.get_gex_data payload shape (gex_service.py:493-525),
    including the fields this module ignores.

    Note `levels` here is gex_service's OWN semantic dict (classify_gex_state
    returns Dict[str, dict] keyed call_wall/put_wall/zero_gamma) -- a DIFFERENT
    thing under the SAME key as our output. Values are internally consistent
    with classify_gex_state for this spot/walls: asymmetry (1e9-9.5e8)/1e9 =
    5.0% <= 15% -> "choppy"."""
    return {
        "ticker": "SPY", "spot": 500.0, "totalGex": 5.0e9,
        "callGex": 1.4e10, "putGex": -9.0e9, "zeroGamma": 495.0,
        "netDelta": -1234567,
        "callWall": {"strike": 510.0, "gex": 1.0e9},
        "putWall": {"strike": 480.0, "gex": -9.5e8},
        "strikes": [{"strike": 480.0, "gex": -9.5e8, "callGex": 1e7, "putGex": -9.6e8},
                    {"strike": 495.0, "gex": -1.0e6, "callGex": 5e7, "putGex": -5.1e7},
                    {"strike": 510.0, "gex": 1.0e9, "callGex": 1.0e9, "putGex": -2e6}],
        "dteFilter": "week", "wallBandPct": 0.15, "wallBandCapped": False,
        "adjusted": False, "attributionDays": 0, "avgConfidence": 0.0,
        "coveragePct": 0.0, "contractsWithDp": 0, "contractsWithoutDp": 812,
        "levels": {
            "call_wall": {"strike": 510.0, "gex": 1.0e9, "above_spot": True,
                          "at_wall": False, "distance_pct": 2.0,
                          "label": "Ceiling", "role": "resistance"},
            "put_wall": {"strike": 480.0, "gex": -9.5e8, "above_spot": False,
                         "at_wall": False, "distance_pct": 4.0,
                         "label": "Floor", "role": "support"},
            "zero_gamma": {"strike": 495.0, "above_spot": False,
                           "distance_pct": 1.0, "near": True, "spot_below": False,
                           "label": "Gamma Flip", "role": "gamma_flip"},
        },
        "regime": "choppy", "asymmetryPct": 5.0,
        "warnings": {"below_danger_active": False, "spot_near_danger": True},
    }


def test_real_payload_is_reduced_to_the_contract_and_nothing_leaks():
    """gex_service already HAS a `levels` key -- its semantic Ceiling/Floor/
    Magnet dict. shape_walls must REPLACE it with the [{kind, price}] list the
    overlay consumes, never pass the upstream one through, and never carry any
    other upstream field (strikes/warnings/netDelta) into the envelope."""
    out = shape_walls(_real_gex())

    assert out["levels"] == [
        {"kind": "callWall", "price": 510.0},
        {"kind": "putWall", "price": 480.0},
        {"kind": "zeroGamma", "price": 495.0},
    ]
    assert set(out) == {"levels", "spot", "regime", "version"}
    assert out["regime"] == "choppy" and out["regime"] in REAL_REGIMES
    assert out["spot"] == 500.0 and out["version"] == "gxw-v1"
    json.dumps(out, allow_nan=False)


def test_every_real_regime_passes_through_verbatim():
    """The overlay renders this string; it is never remapped or defaulted."""
    for regime in REAL_REGIMES:
        g = _real_gex()
        g["regime"] = regime
        assert shape_walls(g)["regime"] == regime


def test_shape_walls_does_not_mutate_its_input():
    """Pure: the router hands it a ServeStale-held payload that other callers
    may still be reading."""
    g = _gex()
    before = copy.deepcopy(g)
    shape_walls(g)
    assert g == before


# ── fetch_gex_walls: the ONLY door to the live ~20s Schwab /chains call ──

async def test_fetch_uses_the_week_dte_from_rules_and_stamps_the_envelope(monkeypatch):
    calls = []

    async def fake_get_gex_data(ticker, dte_filter):
        calls.append((ticker, dte_filter))
        return _gex()

    monkeypatch.setattr("api.gex_service.get_gex_data", fake_get_gex_data)
    out = await fetch_gex_walls("spy")

    assert calls == [("spy", "week")]           # rules.GXW_DTE, pinned literally
    assert calls[0][1] == rules.GXW_DTE
    assert out["sym"] == "SPY"                  # uppercased for the cache key
    assert isinstance(out["asOf"], float) and out["asOf"] > 0
    assert len(out["levels"]) == 3 and out["version"] == "gxw-v1"


async def test_fetch_adds_no_caching_of_its_own(monkeypatch):
    """ServeStale lives in the ROUTER (task 6). A cache here would double-cache
    the live chain and make the router's max-age contract unenforceable."""
    calls = []

    async def fake_get_gex_data(ticker, dte_filter):
        calls.append(ticker)
        return _gex()

    monkeypatch.setattr("api.gex_service.get_gex_data", fake_get_gex_data)
    first = await fetch_gex_walls("SPY")
    second = await fetch_gex_walls("SPY")

    assert len(calls) == 2, "fetch_gex_walls must not memoize the live chain"
    assert second["asOf"] >= first["asOf"]


async def test_auth_down_becomes_a_safe_empty_payload(monkeypatch):
    """gex_service returns {"error": "Schwab not authenticated"} whenever the
    refresh token is dead — a routine, hours-long production state. It must
    surface as an empty-levels envelope, never an exception."""
    async def fake_get_gex_data(ticker, dte_filter):
        return {"error": "Schwab not authenticated"}

    monkeypatch.setattr("api.gex_service.get_gex_data", fake_get_gex_data)
    out = await fetch_gex_walls("spy")

    assert out["levels"] == [] and out["error"] == "Schwab not authenticated"
    assert out["sym"] == "SPY" and out["version"] == "gxw-v1"
    assert isinstance(out["asOf"], float)
