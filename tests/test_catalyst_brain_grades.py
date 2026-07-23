"""Brain setup-grade enrichment: infer a firm setup, attach its historical edge."""
import pytest

from api.services.catalyst import brain_grades


# ── _infer_setup ────────────────────────────────────────────────────────
def test_infer_scanner_bucket_wins():
    c = {"scanner_setup": {"setup_type": "GAPPER_NEWS"}, "gap_pct": 1.0}
    assert brain_grades._infer_setup(c) == "Episodic Pivot"


def test_infer_remount():
    c = {"scanner_setup": {"setup_type": "REMOUNT"}}
    assert brain_grades._infer_setup(c) == "Remount"


def test_infer_earnings_gap_is_peg():
    c = {"earnings_just_reported": True, "gap_pct": 8.0}
    assert brain_grades._infer_setup(c) == "Power Earnings Gap"


def test_infer_news_gap_is_episodic_pivot():
    c = {"gap_pct": 6.0, "rss": [{"title": "contract win"}],
         "earnings_just_reported": False}
    assert brain_grades._infer_setup(c) == "Episodic Pivot"


def test_infer_new_high_breakout():
    c = {"gap_pct": 0.5, "near_52w_high": True}
    assert brain_grades._infer_setup(c) == "Flat Base Breakout"


def test_infer_none_on_flat_no_signal():
    c = {"gap_pct": 0.4}
    assert brain_grades._infer_setup(c) is None


def test_infer_gap_without_news_is_not_ep():
    # A bare gap with no news/earnings/scanner/52w-high maps to nothing.
    c = {"gap_pct": 6.0, "earnings_just_reported": False}
    assert brain_grades._infer_setup(c) is None


# ── enrich (brain_service mocked) ───────────────────────────────────────
def _mock_brain(monkeypatch, *, available=True, perf=None):
    import api.services.brain_service as bs
    monkeypatch.setattr(bs, "available", lambda: available)
    monkeypatch.setattr(bs, "setup_winrate",
                        lambda setup, regime="ALL": (perf or {"ok": False}))


def test_enrich_disabled_is_noop(monkeypatch):
    monkeypatch.setenv("CATALYST_BRAIN_ENABLED", "0")
    cands = [{"scanner_setup": {"setup_type": "GAPPER_NEWS"}, "gap_pct": 5.0}]
    assert brain_grades.enrich(cands) == 0
    assert "brain_grade" not in cands[0]


def test_enrich_noop_when_brain_unavailable(monkeypatch):
    monkeypatch.setenv("CATALYST_BRAIN_ENABLED", "1")
    _mock_brain(monkeypatch, available=False)
    cands = [{"scanner_setup": {"setup_type": "GAPPER_NEWS"}, "gap_pct": 5.0}]
    assert brain_grades.enrich(cands) == 0
    assert "brain_grade" not in cands[0]


def test_enrich_attaches_grade(monkeypatch):
    monkeypatch.setenv("CATALYST_BRAIN_ENABLED", "1")
    _mock_brain(monkeypatch, perf={
        "ok": True, "setup": "EP", "win_rate_pct": 42.7,
        "total_trades": 335, "expectancy": 1.68, "avg_gain_pct": 12.0,
    })
    cands = [{"gap_pct": 6.0, "rss": [{"title": "x"}], "earnings_just_reported": False}]
    n = brain_grades.enrich(cands)
    assert n == 1
    bg = cands[0]["brain_grade"]
    assert bg["setup"] == "EP"
    assert bg["win_rate_pct"] == 42.7
    assert bg["sample"] == 335
    assert bg["expectancy"] == 1.68


def test_enrich_skips_thin_sample(monkeypatch):
    monkeypatch.setenv("CATALYST_BRAIN_ENABLED", "1")
    _mock_brain(monkeypatch, perf={"ok": False, "reason": "not enough sample"})
    cands = [{"gap_pct": 6.0, "rss": [{"title": "x"}]}]
    assert brain_grades.enrich(cands) == 0
    assert "brain_grade" not in cands[0]


def test_enrich_memoizes_per_setup(monkeypatch):
    monkeypatch.setenv("CATALYST_BRAIN_ENABLED", "1")
    calls = {"n": 0}
    import api.services.brain_service as bs
    monkeypatch.setattr(bs, "available", lambda: True)

    def _wr(setup, regime="ALL"):
        calls["n"] += 1
        return {"ok": True, "setup": "EP", "win_rate_pct": 42.0,
                "total_trades": 300, "expectancy": 1.5}
    monkeypatch.setattr(bs, "setup_winrate", _wr)
    # Two news gappers → same inferred setup → one brain lookup.
    cands = [
        {"gap_pct": 6.0, "rss": [{"title": "a"}]},
        {"gap_pct": 7.0, "tweets": [{"text": "b"}]},
    ]
    assert brain_grades.enrich(cands) == 2
    assert calls["n"] == 1


def test_enrich_never_raises(monkeypatch):
    monkeypatch.setenv("CATALYST_BRAIN_ENABLED", "1")
    import api.services.brain_service as bs
    monkeypatch.setattr(bs, "available", lambda: True)

    def _boom(setup, regime="ALL"):
        raise RuntimeError("brain exploded")
    monkeypatch.setattr(bs, "setup_winrate", _boom)
    cands = [{"gap_pct": 6.0, "rss": [{"title": "x"}]}]
    # _grade_one swallows the error → no grade, no raise.
    assert brain_grades.enrich(cands) == 0
