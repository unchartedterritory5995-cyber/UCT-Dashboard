"""`min_conf` must apply on the confirmed branch of GET /api/patterns/{sym}.

It was accepted as a query parameter and silently ignored there: a caller asking
for >=90 received every confirmed verdict, 60s included. The rule-engine branch
honoured it; the confirmed branch did not, so the same parameter meant two
different things depending on a second parameter.

⚠️ The load-bearing property is that the DEFAULT is unchanged. A verdict is only
stored confirmed once its vision confidence cleared PATTERN_VISION_MIN_CONFIDENCE
(60), which is above this parameter's default of 50 -- so at the default the
filter can never remove a row, and no member sees a difference.
"""
import importlib


def _store(tmp_path, monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pv.db"))
    import api.services.pattern_vision.store as s
    importlib.reload(s)
    s.init_db()
    return s


def _verdict(s, setup, conf, asof):
    s.put_verdict({
        "ticker": "NVDA", "tf": "D", "setup": setup, "asof_date": asof,
        "confirmed": 1, "vision_confidence": conf, "rationale": "x",
        "key_level": 1.0, "raw_confidence": 0.5, "model": "claude-opus-4-8",
        "signals_hash": "h" + setup, "judged_at": 1789045200, "checks": "[]",
    })


def _call(monkeypatch, s, min_conf):
    import api.routers.patterns as p
    monkeypatch.setattr(p, "require_paid", lambda: {"id": 1}, raising=False)
    import api.services.pattern_vision.store as live
    monkeypatch.setattr(p, "memory", p.memory, raising=False)
    # the endpoint imports the store inside the function, so patch the module
    monkeypatch.setattr(live, "get_confirmed", s.get_confirmed, raising=False)
    monkeypatch.setattr(live, "init_db", lambda: None, raising=False)
    return p.get_detections("NVDA", _user={"id": 1}, tf="D", types=None,
                            min_conf=min_conf, confirmed_only=True)


def test_a_confirmed_verdict_below_min_conf_is_excluded(tmp_path, monkeypatch):
    s = _store(tmp_path, monkeypatch)
    today = __import__("datetime").date.today().isoformat()
    _verdict(s, "vcp", 65.0, today)
    _verdict(s, "bull_flag", 95.0, today)

    out = _call(monkeypatch, s, 90.0)
    setups = sorted(v["setup"] for v in out["verdicts"])
    assert setups == ["bull_flag"], "the 65-confidence verdict must be filtered out"
    assert out["count"] == 1, "count must reflect the filtered list, not the raw one"


def test_the_default_is_a_no_op(tmp_path, monkeypatch):
    """THE LOAD-BEARING ONE. Confirmed verdicts already cleared a 60 floor at
    write time, and this parameter defaults to 50 -- so the default response
    must be unchanged. If this ever fails, the change became member-visible."""
    s = _store(tmp_path, monkeypatch)
    today = __import__("datetime").date.today().isoformat()
    _verdict(s, "vcp", 60.0, today)
    _verdict(s, "bull_flag", 61.0, today)

    out = _call(monkeypatch, s, 50.0)
    assert out["count"] == 2
    assert sorted(v["setup"] for v in out["verdicts"]) == ["bull_flag", "vcp"]


def test_a_missing_confidence_does_not_raise(tmp_path, monkeypatch):
    """Degenerate row: vision_confidence NULL. It must sort below any floor
    rather than crash the read path a member's Technical tab depends on."""
    s = _store(tmp_path, monkeypatch)
    today = __import__("datetime").date.today().isoformat()
    with s.connect() as c:
        c.execute("INSERT INTO pattern_verdicts (ticker,tf,setup,asof_date,confirmed,"
                  "vision_confidence,judged_at) VALUES ('NVDA','D','odd',?,1,NULL,1)",
                  (today,))
        c.commit()
    out = _call(monkeypatch, s, 50.0)
    assert all(v["setup"] != "odd" for v in out["verdicts"])
