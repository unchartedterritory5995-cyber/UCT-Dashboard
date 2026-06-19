import importlib


def _setup(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    import api.services.pattern_vision.orchestrator as orch
    importlib.reload(orch)
    return s, orch


def test_judge_ticker_confirms_and_stores(tmp_path, monkeypatch):
    s, orch = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6, "asof_date": "2026-06-19"}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    monkeypatch.setattr(orch.chart_render, "render_chart", lambda bars, **k: b"\x89PNGx")
    monkeypatch.setattr(orch.vision_judge, "judge",
                        lambda setup, png, client=None, **kw: {"confirmed": True, "confidence": 80,
                        "reason": "tight", "key_level": 10.0, "model": "claude-opus-4-8",
                        "checks": [{"criterion": "tight contractions", "passed": True}],
                        "usage": {"input_tokens": 1000, "output_tokens": 100}})
    out = orch.judge_ticker("NVDA", client=object())
    assert out["judged"] == 1 and out["confirmed"] == 1
    conf = s.get_confirmed("NVDA")[0]
    assert conf["setup"] == "vcp"
    assert conf["checks"][0]["criterion"] == "tight contractions"  # decoded back to list
    out2 = orch.judge_ticker("NVDA", client=object())
    assert out2["skipped"] == 1 and out2["judged"] == 0


def test_low_confidence_is_gated_not_confirmed(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_MIN_CONFIDENCE", "70")
    s, orch = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6,
                                            "asof_date": "2026-06-19", "key_level": 10.0}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    monkeypatch.setattr(orch.chart_render, "render_chart", lambda bars, **k: b"\x89PNGx")
    # model confirms but at only 55 confidence (< 70 floor) → must NOT confirm
    monkeypatch.setattr(orch.vision_judge, "judge",
                        lambda setup, png, client=None, **kw: {"confirmed": True, "confidence": 55,
                        "reason": "borderline", "key_level": None, "checks": [],
                        "model": "claude-opus-4-8", "usage": {"input_tokens": 1, "output_tokens": 1}})
    out = orch.judge_ticker("NVDA", client=object())
    assert out["judged"] == 1 and out["confirmed"] == 0
    assert s.get_confirmed("NVDA") == []


def test_cost_cap_blocks_judging(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "0.00")
    s, orch = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(orch, "candidates_for",
                        lambda t, tf="D": [{"setup": "vcp", "raw_confidence": 0.6, "asof_date": "2026-06-19"}])
    monkeypatch.setattr(orch, "_read_bars", lambda t, tf: [(20260101, 1, 1, 1, 1, 1)])
    out = orch.judge_ticker("NVDA", client=object())
    assert out["cost_capped"] is True and out["judged"] == 0
