"""A dual-class ticker resolves in either spelling (audit 2026-10-08).

The universe stores ``BRK-B``; a member typing ``BRK.B`` got "No RS data".
"""

from api.services import rs_ranking as svc


def _seed():
    rows = [
        {"ticker": "BRK-B", "rs_score": 1.0, "rs_rank": 55, "returns": {}},
        {"ticker": "AAPL", "rs_score": 2.0, "rs_rank": 80, "returns": {}},
    ]
    svc._rs_cache.set(svc._CACHE_KEY, rows, ttl=60)


def test_dot_and_slash_forms_resolve_to_the_hyphen_row():
    _seed()
    try:
        for spelling in ("BRK-B", "BRK.B", "brk.b", "BRK/B", " brk-b "):
            hit = svc.get_rs_for_ticker(spelling)
            assert hit is not None, spelling
            assert hit["ticker"] == "BRK-B"
    finally:
        svc._rs_cache.invalidate(svc._CACHE_KEY)


def test_an_unknown_symbol_still_answers_none():
    _seed()
    try:
        assert svc.get_rs_for_ticker("AAPL")["rs_rank"] == 80
        assert svc.get_rs_for_ticker("ZZZZ.Q") is None
        assert svc.get_rs_for_ticker("") is None
    finally:
        svc._rs_cache.invalidate(svc._CACHE_KEY)
