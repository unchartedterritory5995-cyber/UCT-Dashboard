# tests/theme_curation/test_propose.py
from tools.theme_curation import propose, proposals as P
from tools.theme_curation.ledger import Ledger


def test_thin_flag_excluded_from_prompt(monkeypatch):
    captured = {}
    class _Msg:
        def create(self, **kw):
            captured["prompt"] = kw["messages"][0]["content"]
            class R:
                content = [type("B", (), {"text": '{"proposals": []}'})()]
            return R()
    class _Client:
        messages = _Msg()
    monkeypatch.setattr(propose, "_client", lambda: _Client())
    # NOTE: theme name must avoid the literal substring "thin" — it is grounded
    # verbatim into the prompt, and this test asserts the audit FLAG 'thin' (below)
    # never leaks in. A name like "Thin Theme" would false-fail on its own name.
    theme = {"id": "t", "name": "Sparse Theme", "sub_themes": [], "holdings": []}
    propose.propose_theme(theme, ["AAA"], {"AAA": True}, [], {"thin": True, "dead": []}, "m")
    assert "thin" not in captured["prompt"].lower()


def test_dead_reaches_prompt_thin_does_not(monkeypatch):
    captured = {}
    class _Msg:
        def create(self, **kw):
            captured["prompt"] = kw["messages"][0]["content"]
            class R:
                content = [type("B", (), {"text": '{"proposals": []}'})()]
            return R()
    class _Client:
        messages = _Msg()
    monkeypatch.setattr(propose, "_client", lambda: _Client())
    theme = {"id": "t", "name": "Sparse Theme", "sub_themes": [], "holdings": []}
    propose.propose_theme(theme, [], {}, [], {"thin": True, "dead": ["DEADCO"], "dups": []}, "m")
    p = captured["prompt"]
    assert "DEADCO" in p and "thin" not in p.lower()


def test_suppress_rejected(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    lg.record("t", "BAD", "add", "reject")
    props = [P.Proposal("t", "add", "BAD", 0.9), P.Proposal("t", "add", "OK", 0.9)]
    kept = propose.suppress_rejected(props, lg)
    assert [p.sym for p in kept] == ["OK"]


def test_boost_confidence():
    props = [P.Proposal("t", "add", "NVDA", 0.5), P.Proposal("t", "add", "XX", 0.5)]
    propose.boost_confidence(props, {"NVDA": True, "XX": False})
    d = {p.sym: p.confidence for p in props}
    assert d["NVDA"] > 0.5 and d["XX"] == 0.5
