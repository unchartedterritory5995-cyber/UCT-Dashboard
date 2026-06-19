from api.services.pattern_vision import eval as pv_eval


def test_evaluate_computes_recall(monkeypatch):
    truth = [
        {"symbol": "AAA", "setup": "vcp", "label_date": "2026-01-05", "timeframe": "D"},
        {"symbol": "BBB", "setup": "vcp", "label_date": "2026-02-05", "timeframe": "D"},
    ]
    monkeypatch.setattr(pv_eval, "_modelbook_truth", lambda: truth)

    def judge_fn(sym, setup, date):
        return {"confirmed": sym == "AAA" and setup == "vcp"}

    rep = pv_eval.evaluate(judge_fn=judge_fn)
    assert rep["per_setup"]["vcp"]["truth"] == 2
    assert rep["per_setup"]["vcp"]["confirmed"] == 1
    assert rep["per_setup"]["vcp"]["recall"] == 0.5
    assert rep["n"] == 2
    assert rep["false_positive_rate"] is None


def test_normalize_maps_display_names():
    assert pv_eval._norm("VCP") == "vcp"
    assert pv_eval._norm("Classic Flag/Pullback") == "bull_flag"
    assert pv_eval._norm("Some Intraday Thing") is None
    assert pv_eval._norm("hammer") == "hammer"


def test_max_rows_caps_truth(monkeypatch):
    truth = [{"symbol": f"S{i}", "setup": "vcp", "label_date": "2026-01-01", "timeframe": "D"}
             for i in range(10)]
    monkeypatch.setattr(pv_eval, "_modelbook_truth", lambda: truth)
    rep = pv_eval.evaluate(judge_fn=lambda *a: {"confirmed": False}, max_rows=3)
    assert rep["n"] == 3
