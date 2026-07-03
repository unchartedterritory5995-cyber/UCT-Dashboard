"""grade_ticker: deterministic verdict assembly with injected sub-fns (no I/O)."""
from api.services import grade_ticker as gt


def _regime(band="GREEN", conf=0.8):
    labels = {"GREEN": "bull_trend", "YELLOW": "bull_correction",
              "ORANGE": "distribution", "RED": "bear_trend"}
    return lambda: {"regime": labels[band], "confidence": conf,
                    "narration": f"{band} tape"}


def _quote(last):
    return lambda sym: {"symbol": sym, "last": last, "direction": "up", "abs_pct": 1.0}


def _patterns(entry=None, stop=None, target=None, conf=75, direction="long", name="HTF"):
    if entry is None:
        return lambda sym: []
    return lambda sym: [{
        "pattern_id": "htf", "pattern_name": name, "confidence": conf,
        "direction": direction, "status": "active",
        "levels": {"entry": entry, "stop": stop, "target_primary": target},
    }]


def _playbook(max_stop=8.0, wr=57.0):
    return lambda name: {"ok": True, "name": name, "max_stop_pct": max_stop,
                         "winrate": {"win_rate_pct": wr}, "common_mistakes": ["chasing"]}


def _size(size_pct=15.0, acct_risk=0.7, shares=50):
    return lambda entry, stop, account, regime="", grade="A", risk_pct=1.0: {
        "ok": True, "shares": shares, "max_position_pct": size_pct,
        "account_risk": acct_risk, "r1_target": entry + (entry - stop) * 1.5,
        "recommendation": "ENTER"}


def _call(**over):
    kw = dict(regime_fn=_regime(), quote_fn=_quote(170.0),
              patterns_fn=_patterns(entry=172.4, stop=164.0, target=185.0),
              playbook_fn=_playbook(), size_fn=_size(), account_size=50000.0)
    kw.update(over)
    return gt.grade_ticker("DECK", **kw)


def test_verdict_is_never_null_and_is_go_on_clean_setup():
    out = _call()
    assert out["ok"] is True
    assert out["verdict"] == "GO"
    assert out["regime"] == "GREEN"
    assert out["entry"] == 172.4 and out["stop"] == 164.0
    assert out["size_pct"] == 15.0 and out["account_risk_pct"] == 0.7
    assert out["setup"] == "HTF" and out["grade"] in ("A", "B+")
    assert out["sources"]  # non-empty, traceable


def test_no_setup_forces_skip():
    out = _call(patterns_fn=_patterns())  # empty detections
    assert out["verdict"] == "SKIP"
    assert "no_setup" in out["hard_flags"]
    assert out["entry"] is None


def test_regime_red_forces_skip_regime_first():
    out = _call(regime_fn=_regime("RED"))
    assert out["verdict"] == "SKIP"
    assert "regime_red" in out["hard_flags"]
    assert out["regime"] == "RED"


def test_low_grade_forces_skip():
    out = _call(patterns_fn=_patterns(entry=172.4, stop=164.0, target=185.0, conf=45))
    assert out["grade"] in ("C", "F")
    assert out["verdict"] == "SKIP"
    assert "grade_below_b" in out["hard_flags"]


def test_orange_regime_downgrades_go_to_hold():
    out = _call(regime_fn=_regime("ORANGE"))
    assert out["verdict"] == "HOLD"


def test_extended_price_downgrades_to_hold():
    # last 178 vs entry 172.4 => >3% past pivot
    out = _call(quote_fn=_quote(178.0))
    assert out["verdict"] == "HOLD"
    assert "extended" in out["hard_flags"]


def test_risk_over_cap_forces_skip():
    out = _call(size_fn=_size(size_pct=40.0, acct_risk=3.1))
    assert out["verdict"] == "SKIP"
    assert "risk_over_cap" in out["hard_flags"]


def test_regime_unavailable_returns_not_ok():
    out = _call(regime_fn=lambda: None)
    assert out["ok"] is False and "regime" in out["reason"].lower()


def test_never_raises_on_subfn_exception():
    def boom(*a, **k):
        raise RuntimeError("x")
    out = _call(patterns_fn=boom)
    assert out["ok"] in (True, False)  # returned a dict, did not raise


def test_reads_real_engine_size_keys():
    # real calculate_position_size returns max_position_pct + risk_pct (echo) +
    # r1_target + recommendation — NOT account_risk.
    def real_size(entry, stop, account, regime="", grade="A", risk_pct=1.0):
        return {"ok": True, "shares": 50, "max_position_pct": 15.0,
                "dollar_risk": 350.0, "risk_pct": 0.7,
                "r1_target": 185.0, "recommendation": "ENTER"}
    out = _call(size_fn=real_size)
    assert out["verdict"] == "GO"
    assert out["size_pct"] == 15.0
    assert out["account_risk_pct"] == 0.7  # from risk_pct echo
    assert out["first_target"] == 185.0


def test_engine_recommendation_skip_forces_skip():
    def skip_size(entry, stop, account, regime="", grade="A", risk_pct=1.0):
        return {"ok": True, "shares": 0, "max_position_pct": 0.0,
                "recommendation": "SKIP", "risk_pct": 0.0}
    out = _call(size_fn=skip_size)
    assert out["verdict"] == "SKIP"
    assert "size_skip" in out["hard_flags"]


def test_unsizable_setup_forces_skip():
    # sizing unavailable (e.g. brain pack down) -> cannot size -> not a GO.
    out = _call(size_fn=lambda *a, **k: {"ok": False, "reason": "brain not available"})
    assert out["verdict"] == "SKIP"
    assert "size_unavailable" in out["hard_flags"]
    assert out["size_pct"] is None
