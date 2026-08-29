"""`_ctx_candidates` must read the shape `get_candidates()` actually returns.

⛔ THE TWO TESTS THAT ALREADY NAME THIS FUNCTION CANNOT SEE THIS DEFECT.
`test_ai_search_audit_fixes.py` and `test_ai_search_topic_matrix.py` both
`monkeypatch.setattr(ai, "_ctx_candidates", lambda: "[CANDIDATES]")` — they
assert the ROUTING reaches the pack, which is a different claim, and correctly
so. The pack's own read of the payload had no test of any kind, so a wrong key
produced a bare `""` and every routed answer simply went without it.

⛔ THE FIXTURE IS THE REAL SHAPE, DERIVED FROM THE PRODUCER: buckets nested
under `candidates`, symbols keyed `ticker`. See `engine._EMPTY_CANDIDATES` and
`scanner_candidates.run_scanner`'s output. A fixture invented to match the
reader would pass against the bug — the whole defect was a reader that agreed
with itself.
"""
import pytest

from api.routers import ai_search as ai


def _payload(pullbacks=(), remounts=()):
    """The wire's real envelope — `_EMPTY_CANDIDATES` with rows filled in."""
    return {
        "generated_at": "2026-08-28 06:40:51 CT",
        "market_date": "2026-08-28",
        "candidates": {
            "pullback_ma": [{"ticker": t, "candle_score": 70} for t in pullbacks],
            "gapper_news": [],
            "remount": [{"ticker": t, "candle_score": 70} for t in remounts],
        },
        "counts": {"total": len(pullbacks) + len(remounts)},
    }


@pytest.fixture
def candidates(monkeypatch):
    box = {}

    def _set(payload):
        box["p"] = payload
        import api.services.engine as engine
        monkeypatch.setattr(engine, "get_candidates", lambda: box["p"])

    return _set


def test_the_nested_buckets_are_read(candidates):
    candidates(_payload(pullbacks=["ANGX", "BCRX", "AXON"], remounts=["CCXI"]))
    out = ai._ctx_candidates()
    assert "ANGX" in out and "BCRX" in out and "AXON" in out, out
    assert "CCXI" in out, out
    assert out.startswith("UCT scanner candidates today:")


def test_a_pullback_only_day_still_says_something(candidates):
    """The ordinary day — remount carries 0-2 names and is usually empty."""
    candidates(_payload(pullbacks=["ANGX"]))
    out = ai._ctx_candidates()
    assert "ANGX" in out
    assert "remounts — none" in out


def test_only_the_first_five_are_named(candidates):
    candidates(_payload(pullbacks=[f"S{i}" for i in range(9)]))
    out = ai._ctx_candidates()
    assert "S4" in out and "S5" not in out, out


def test_a_genuinely_empty_scan_says_nothing(candidates):
    """`""` must stay reserved for "no candidates", which is the only reason
    the wrong-key version was invisible for as long as it was."""
    candidates(_payload())
    assert ai._ctx_candidates() == ""


def test_a_missing_payload_says_nothing(candidates):
    candidates({})
    assert ai._ctx_candidates() == ""


def test_the_legacy_sym_key_is_still_honoured(candidates):
    """Older pushes keyed the symbol `sym`; `voice_market_tools` accepts both
    and so does this — the fallback is deliberate, not leftover."""
    p = _payload()
    p["candidates"]["pullback_ma"] = [{"sym": "OLD"}]
    candidates(p)
    assert "OLD" in ai._ctx_candidates()
