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


def test_recent_verdicts_includes_rejected_and_feedback(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    s.put_verdict({"ticker": "NVDA", "tf": "D", "setup": "vcp", "asof_date": "2026-06-19",
                   "confirmed": 1, "vision_confidence": 80, "rationale": "ok",
                   "signals_hash": "a", "judged_at": 5})
    s.put_verdict({"ticker": "TSLA", "tf": "D", "setup": "bull_flag", "asof_date": "2026-06-19",
                   "confirmed": 0, "vision_confidence": 30, "rationale": "weak",
                   "signals_hash": "b", "judged_at": 6})
    s.record_feedback("TSLA", "D", "bull_flag", "2026-06-19", "down", note="missed the pole")
    recent = s.get_recent_verdicts(limit=10)
    assert {r["setup"] for r in recent} == {"vcp", "bull_flag"}  # both confirmed + rejected
    tsla = next(r for r in recent if r["ticker"] == "TSLA")
    assert tsla["feedback"]["rating"] == "down" and tsla["feedback"]["note"] == "missed the pole"


def test_exemplar_roundtrip_and_delete(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    eid = s.add_exemplar("vcp", b"\x89PNGideal", ticker="NVDA", asof_date="2026-06-19",
                         note="this is the ideal coil", drawings_json='[]', by_user="u1")
    assert s.exemplar_pngs("vcp") == [b"\x89PNGideal"]
    meta = s.list_exemplars("vcp")
    assert len(meta) == 1 and meta[0]["note"] == "this is the ideal coil"
    assert "png" not in meta[0]  # blob excluded from listing
    s.delete_exemplar(eid)
    assert s.exemplar_pngs("vcp") == []


def test_feedback_source_and_list(tmp_path, monkeypatch):
    s = _fresh(tmp_path, monkeypatch)
    s.record_feedback("NVDA", "D", "vcp", "2026-06-19", "up", source="chart")
    s.record_feedback("AAPL", "D", "scan:pullback", "2026-06-19", "down",
                      note="extended", source="scanner")
    scanner = s.list_feedback(source="scanner")
    assert len(scanner) == 1 and scanner[0]["ticker"] == "AAPL"
    assert scanner[0]["source"] == "scanner" and scanner[0]["note"] == "extended"
    assert len(s.list_feedback()) == 2  # both, unfiltered
