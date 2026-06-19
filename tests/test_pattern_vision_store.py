import importlib


def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


def test_put_and_get_confirmed(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
                   "confirmed": 1, "vision_confidence": 82.0, "rationale": "tight contractions",
                   "key_level": 184.0, "raw_confidence": 0.6, "model": "claude-opus-4-8",
                   "signals_hash": "abc", "judged_at": 1})
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "bull_flag", "asof_date": "2026-06-19",
                   "confirmed": 0, "vision_confidence": 20.0, "rationale": "no pole",
                   "signals_hash": "def", "judged_at": 1})
    conf = s.get_confirmed("NVDA")
    assert len(conf) == 1 and conf[0]["setup"] == "vcp"
    assert conf[0]["rationale"] == "tight contractions"


def test_cost_guard(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_COST_HARD_CAP", "1.00")
    s = _fresh(tmp_path, monkeypatch)
    assert s.may_judge("2026-06-19") is True
    s.log_cost("2026-06-19", "NVDA", "claude-opus-4-8", 1000, 200, 0.90)
    assert s.cost_today("2026-06-19") == 0.90
    assert s.may_judge("2026-06-19") is True
    s.log_cost("2026-06-19", "AAPL", "claude-opus-4-8", 1000, 200, 0.20)
    assert s.may_judge("2026-06-19") is False  # 1.10 >= 1.00
