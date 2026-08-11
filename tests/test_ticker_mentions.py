"""Cross-session ticker mentions for Desk chart markers + timeline (spec
2026-08-11, Phase 2A).

`education_service.videos_with_ticker_moments` is monkeypatched at
ticker_mentions' imported name — the sqlite layer has its own coverage; these
tests pin the per-mention scan/filter, case/$ normalization, newest-first
ordering, the 50-item cap, the no-created_at skip, and the TTL cache."""
import pytest

from api.services import ticker_mentions


def _row(id, youtube_id, title, created_at, moments):
    return {"id": id, "youtube_id": youtube_id, "title": title,
            "created_at": created_at, "ticker_moments": moments}


def test_shape_and_ordering_two_videos_plus_a_double_mention(monkeypatch):
    ticker_mentions._cache.clear()
    # video 11: older session (2026-08-05), one NVDA mention
    # video 12: newer session (2026-08-09), NVDA mentioned twice at t=30, t=900
    rows = [
        _row(11, "ytOld", "Aug 5 Session", 1785931200,  # 2026-08-05 ET-ish
             '[{"ticker": "NVDA", "t": 120, "note": "breakout"}]'),
        _row(12, "ytNew", "Aug 9 Session", 1786327200,  # 2026-08-09
             '[{"ticker": "NVDA", "t": 900, "note": "follow-through"}, '
             '{"ticker": "NVDA", "t": 30, "note": "opening look"}]'),
    ]
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", lambda: rows)
    out = ticker_mentions.mentions_for_symbol("NVDA")
    mentions = out["mentions"]
    assert len(mentions) == 3
    # newest anchor_date first (video 12's 2026-08-09 session before video 11's
    # 2026-08-05 session); within the SAME anchor_date, ascending t.
    assert [m["anchor_date"] for m in mentions] == [
        "2026-08-09", "2026-08-09", "2026-08-05"]
    assert [m["t"] for m in mentions] == [30, 900, 120]
    first = mentions[0]
    assert first == {
        "video_id": 12, "youtube_id": "ytNew", "title": "Aug 9 Session",
        "anchor_date": "2026-08-09", "t": 30, "note": "opening look",
    }
    assert out["as_of"]


def test_case_and_dollar_sign_normalization(monkeypatch):
    ticker_mentions._cache.clear()
    rows = [_row(1, "yt1", "Session", 1786327200,
                 '[{"ticker": "$nvda", "t": 5, "note": ""}]')]
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", lambda: rows)
    # query lowercase, un-prefixed — must still match a stored "$nvda" moment
    out = ticker_mentions.mentions_for_symbol("nvda")
    assert len(out["mentions"]) == 1
    assert out["mentions"][0]["video_id"] == 1

    ticker_mentions._cache.clear()
    # query with a leading $ and mixed case — must still match a plain "NVDA"
    rows2 = [_row(2, "yt2", "Session 2", 1786327200,
                  '[{"ticker": "NVDA", "t": 5, "note": ""}]')]
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", lambda: rows2)
    out2 = ticker_mentions.mentions_for_symbol("$Nvda")
    assert len(out2["mentions"]) == 1
    assert out2["mentions"][0]["video_id"] == 2


def test_cap_50_mentions(monkeypatch):
    ticker_mentions._cache.clear()
    # one session per day (multiples of 86400s preserve time-of-day so each
    # row lands on a distinct, monotonically increasing ET calendar date)
    rows = [
        _row(i, f"yt{i}", f"Session {i}", 1786327200 + i * 86400,
             f'[{{"ticker": "AMD", "t": {i}, "note": ""}}]')
        for i in range(60)
    ]
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", lambda: rows)
    out = ticker_mentions.mentions_for_symbol("AMD")
    assert len(out["mentions"]) == 50
    # the cap keeps the newest 50 (highest created_at / anchor_date), not an
    # arbitrary prefix of the source rows
    kept_ids = {m["video_id"] for m in out["mentions"]}
    assert kept_ids == set(range(10, 60))


def test_unknown_symbol_returns_empty_200_shape(monkeypatch):
    ticker_mentions._cache.clear()
    rows = [_row(1, "yt1", "Session", 1786327200,
                 '[{"ticker": "NVDA", "t": 5, "note": ""}]')]
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", lambda: rows)
    out = ticker_mentions.mentions_for_symbol("ZZZZ")
    assert out["mentions"] == []
    assert out["as_of"]


def test_videos_without_created_at_are_skipped(monkeypatch):
    ticker_mentions._cache.clear()
    rows = [
        _row(1, "yt1", "No timestamp", None,
             '[{"ticker": "TSLA", "t": 5, "note": ""}]'),
        _row(2, "yt2", "Has timestamp", 1786327200,
             '[{"ticker": "TSLA", "t": 7, "note": ""}]'),
    ]
    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", lambda: rows)
    out = ticker_mentions.mentions_for_symbol("TSLA")
    assert [m["video_id"] for m in out["mentions"]] == [2]


def test_ttl_cache_serves_then_expires(monkeypatch):
    ticker_mentions._cache.clear()
    hits = {"n": 0}

    def counting_rows():
        hits["n"] += 1
        return [_row(1, "yt1", "Session", 1786327200,
                     '[{"ticker": "AMD", "t": 1, "note": ""}]')]

    monkeypatch.setattr(ticker_mentions.edu, "videos_with_ticker_moments", counting_rows)
    ticker_mentions.mentions_for_symbol("AMD", now=1000.0)
    ticker_mentions.mentions_for_symbol("AMD", now=1100.0)      # inside TTL — cache hit
    assert hits["n"] == 1
    ticker_mentions.mentions_for_symbol("AMD", now=1000.0 + 601.0)  # expired — recompute
    assert hits["n"] == 2


def test_route_registered_with_paid_auth():
    from api.routers import education
    routes = {r.path: r for r in education.router.routes}
    path = "/api/education/tickers/{sym}/mentions"
    assert path in routes, f"ticker-mentions route missing; have: {sorted(routes)}"
    # Non-vacuity control: the sibling ticker-returns route is in the same table
    assert "/api/education/videos/{video_id}/ticker-returns" in routes


def test_endpoint_returns_service_payload(monkeypatch):
    ticker_mentions._cache.clear()
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import education
    sentinel = {"mentions": [{"video_id": 1, "youtube_id": "yt1", "title": "Session",
                              "anchor_date": "2026-08-09", "t": 5, "note": ""}],
                "as_of": "x"}
    monkeypatch.setattr(ticker_mentions, "mentions_for_symbol", lambda sym: sentinel)
    app = FastAPI()
    app.include_router(education.router)
    app.dependency_overrides[education.require_paid] = lambda: {"email": "t@t.t"}
    client = TestClient(app)
    resp = client.get("/api/education/tickers/NVDA/mentions")
    assert resp.status_code == 200 and resp.json() == sentinel


def test_endpoint_requires_auth(monkeypatch):
    # lesson_gate_that_cannot_fail: test_endpoint_returns_service_payload uses
    # dependency_overrides[require_paid] for every request, so deleting
    # `Depends(require_paid)` from the route reds nothing there. This test
    # builds the SAME app WITHOUT the override and hits the route
    # unauthenticated — it must fail closed. Mutation-checked: with
    # `Depends(require_paid)` removed from get_ticker_mentions in
    # api/routers/education.py, this test fails (200 instead of 401/403);
    # restored, it passes.
    ticker_mentions._cache.clear()
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import education
    sentinel = {"mentions": [], "as_of": "x"}
    monkeypatch.setattr(ticker_mentions, "mentions_for_symbol", lambda sym: sentinel)

    # Unauthenticated request against a client with NO auth override.
    app = FastAPI()
    app.include_router(education.router)
    client = TestClient(app)
    resp = client.get("/api/education/tickers/NVDA/mentions")
    assert resp.status_code in (401, 403), \
        f"expected the auth gate to reject an unauthenticated request, got {resp.status_code}: {resp.text}"

    # Non-vacuity control: the SAME route, overridden, still returns 200 —
    # proves the 401/403 above came from the auth dependency, not from the
    # route/app being broken some other way.
    app2 = FastAPI()
    app2.include_router(education.router)
    app2.dependency_overrides[education.require_paid] = lambda: {"email": "t@t.t"}
    client2 = TestClient(app2)
    resp2 = client2.get("/api/education/tickers/NVDA/mentions")
    assert resp2.status_code == 200 and resp2.json() == sentinel
