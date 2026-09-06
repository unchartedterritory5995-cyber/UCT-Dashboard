"""Seam 28 (2026-09-06): the pattern-bridge tools must disclose that every
detection is UNCONFIRMED rule-engine output, not Opus-vision-verified — the
same raw feed whose universe-wide page was retired for exactly this trust
reason. The disclosure must live IN the returned data (narration + a
`confirmed` field), not depend on a prompt instruction, since these tools
are shared verbatim across Compass voice, Compass chat, and AI Search's
agent lane (voice_tool_impls.py's own docstring: "the same implementations,
through the same dispatch()")."""
from api.services import voice_tool_impls as vti


def _row(pattern_id="bull_flag", confidence=82.0, direction="bullish",
         status="ready", entry=100.0, stop=95.0, target=110.0):
    return {
        "pattern_id": pattern_id, "confidence": confidence,
        "direction": direction, "status": status,
        "levels": {"entry": entry, "stop": stop, "target_primary": target},
    }


def test_find_patterns_on_ticker_discloses_unconfirmed_with_results(monkeypatch):
    monkeypatch.setattr(
        "api.services.pattern_engine.memory.get_active_detections",
        lambda **kw: [_row()],
    )
    out = vti._find_patterns_on_ticker(symbol="NVDA")
    assert out["ok"] is True
    assert out["confirmed"] is False
    assert "unconfirmed" in out["narration"].lower()
    assert "16%" in out["narration"]


def test_find_patterns_on_ticker_discloses_unconfirmed_with_no_results(monkeypatch):
    monkeypatch.setattr(
        "api.services.pattern_engine.memory.get_active_detections",
        lambda **kw: [],
    )
    out = vti._find_patterns_on_ticker(symbol="NVDA")
    assert out["ok"] is True
    assert out["count"] == 0
    assert out["confirmed"] is False


def test_find_patterns_on_ticker_still_surfaces_levels_alongside_disclosure(monkeypatch):
    # The disclosure must not swallow the actual data -- a member who wants
    # the raw candidate can still see it, just never mistake it for confirmed.
    monkeypatch.setattr(
        "api.services.pattern_engine.memory.get_active_detections",
        lambda **kw: [_row(pattern_id="vcp", entry=50.0, stop=47.5, target=58.0)],
    )
    out = vti._find_patterns_on_ticker(symbol="AAPL")
    assert out["count"] == 1
    assert out["detections"][0]["levels"]["entry"] == 50.0
    assert "entry $50.00" in out["narration"]


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, sql, params):
        return self

    def fetchall(self):
        return self._rows

    def close(self):
        pass


def _scan_row(sym="NVDA", pattern_id="bull_flag", confidence=80.0,
              direction="bullish", entry=100.0, stop=95.0, target=110.0):
    import json
    return {
        "id": 1, "sym": sym, "tf": "D", "pattern_id": pattern_id,
        "category": "uct", "direction": direction, "confidence": confidence,
        "status": "ready",
        "levels_json": json.dumps({"entry": entry, "stop": stop, "target_primary": target}),
        "detected_at": 0,
    }


def test_scan_active_patterns_discloses_unconfirmed_with_results(monkeypatch):
    monkeypatch.setattr(
        "api.services.pattern_engine.pattern_db.get_connection",
        lambda: _FakeCursor([_scan_row()]),
    )
    out = vti._scan_active_patterns()
    assert out["ok"] is True
    assert out["confirmed"] is False
    assert "unconfirmed" in out["narration"].lower()
    assert "16%" in out["narration"]


def test_scan_active_patterns_discloses_unconfirmed_with_no_results(monkeypatch):
    monkeypatch.setattr(
        "api.services.pattern_engine.pattern_db.get_connection",
        lambda: _FakeCursor([]),
    )
    out = vti._scan_active_patterns()
    assert out["ok"] is True
    assert out["count"] == 0
    assert out["confirmed"] is False


def test_pattern_tool_descriptions_disclose_unconfirmed_status():
    # Defense-in-depth: the calling model sees this even before it ever
    # invokes the tool. Read straight off the registered voice_tool specs
    # (voice_tools._REGISTRY), not retyped, so this can't silently drift from
    # what's actually shipped.
    from api.services import voice_tools as vt
    for name in ("find_patterns_on_ticker", "scan_active_patterns"):
        assert "unconfirmed" in vt._REGISTRY[name]["description"].lower()
