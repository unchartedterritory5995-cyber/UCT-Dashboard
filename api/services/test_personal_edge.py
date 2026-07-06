from api.services import personal_edge as pe


def test_normalize_setup_resolves_via_engine(monkeypatch):
    # engine alias resolver maps a journal display name to a canonical key
    monkeypatch.setattr(pe, "_resolve", lambda n: "HTF" if "high tight" in n.lower() else None)
    assert pe.normalize_setup("High Tight Flag (Powerplay)") == "HTF"


def test_normalize_setup_none_for_unjoinable(monkeypatch):
    monkeypatch.setattr(pe, "_resolve", lambda n: None)
    assert pe.normalize_setup("random freetext tag") is None


def test_normalize_setup_never_raises(monkeypatch):
    def boom(n):
        raise RuntimeError("x")
    monkeypatch.setattr(pe, "_resolve", boom)
    assert pe.normalize_setup("anything") is None


# ── Task 2: edge_for_setups ───────────────────────────────────────────────────

def test_edge_soft_mutes_only_on_size_and_negative(monkeypatch):
    monkeypatch.setattr(pe, "normalize_setup", lambda s: s)  # identity for the test
    perf = [
        {"setup": "HTF", "trade_count": 30, "win_rate": 0.7, "avg_r": 0.9, "total_r": 27},
        {"setup": "Bull Flag", "trade_count": 30, "win_rate": 0.2, "avg_r": -0.4, "total_r": -12},
        {"setup": "VCP", "trade_count": 8, "win_rate": 0.25, "avg_r": -0.3, "total_r": -2.4},
    ]
    out = pe.edge_for_setups("u", setup_perf_fn=lambda uid, aid: perf)
    assert out["HTF"]["verdict"] == "edge" and out["HTF"]["muted"] is False
    assert out["Bull Flag"]["muted"] is True and out["Bull Flag"]["verdict"] == "weak"
    assert out["VCP"]["muted"] is False and out["VCP"]["verdict"] == "thin"
    assert "small sample" in out["VCP"]["note"].lower()


def test_edge_never_raises(monkeypatch):
    out = pe.edge_for_setups("u", setup_perf_fn=lambda uid, aid: (_ for _ in ()).throw(RuntimeError()))
    assert out == {}


def test_edge_reads_breakdown_key_shape(monkeypatch):
    # real _exec_get_aggregates breakdown rows are keyed 'key', not 'setup'
    monkeypatch.setattr(pe, "normalize_setup", lambda s: s)
    rows = [{"key": "HTF", "trade_count": 30, "avg_r": 0.8, "total_r": 24, "win_rate": 0.7}]
    out = pe.edge_for_setups("u", setup_perf_fn=lambda uid, aid: rows)
    assert out["HTF"]["verdict"] == "edge"
