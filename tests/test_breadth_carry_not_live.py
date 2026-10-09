"""carry_missing_not_live fills only absent NOT_LIVE fields (2026-10-09 audit)."""
from api.services import breadth_self_heal as sh
from api.services import breadth_monitor as bm


def test_fills_only_missing_not_live_fields(monkeypatch):
    stored = {"cnn_fear_greed": None, "uct_exposure": 80, "pct_above_50sma": 41.0}
    monkeypatch.setattr(bm, "raw_row", lambda d: dict(stored))
    monkeypatch.setattr(sh, "_not_live_keys", lambda: ("cnn_fear_greed", "uct_exposure"))

    def carry(d, keys, dates=None):
        assert list(keys) == ["cnn_fear_greed"]          # a present value is never re-carried
        dates["cnn_fear_greed"] = "2026-02-04"
        return {"cnn_fear_greed": 31.0}
    monkeypatch.setattr(sh, "_carry_not_live", carry)
    seen = {}
    monkeypatch.setattr(bm, "patch_fields", lambda d, v: seen.update(v) or True)
    out = sh.carry_missing_not_live("2026-02-05")
    assert out["ok"] and seen == {"cnn_fear_greed": 31.0, "cnn_fear_greed_asof": "2026-02-04"}


def test_nothing_missing_writes_nothing(monkeypatch):
    monkeypatch.setattr(bm, "raw_row", lambda d: {"cnn_fear_greed": 40.0})
    monkeypatch.setattr(sh, "_not_live_keys", lambda: ("cnn_fear_greed",))
    monkeypatch.setattr(bm, "patch_fields", lambda d, v: (_ for _ in ()).throw(AssertionError))
    assert sh.carry_missing_not_live("2026-02-05")["carried"] == {}
