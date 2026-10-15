"""POST /api/screener/count/batch -- up to 30 counts in one request.

The screen menu shows a match count per screen; this lets it load them in one or
two requests. Every spec runs through exactly the path `/count` uses: same
`require_paid` gate, same user id source (the dependency, never the body).
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import screener as screener_mod
from api.services.screener import query as scr_query

PAID = {"id": "u1", "role": "member", "plan": "pro"}
FREE = {"id": "f1", "role": "member", "plan": "free"}
URL = "/api/screener/count/batch"


def _client(user):
    app = FastAPI()
    app.include_router(screener_mod.router)
    if user is not None:
        # Override what the gate DEPENDS ON, never the gate itself.
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Every test counts against its own empty database and a fresh cache, so a
    cached answer from one test can never answer another."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setattr(scr_query, "_COUNT_CACHE", None)


@pytest.fixture
def paid(monkeypatch):
    calls = []

    def fake_preview(spec, user_id=None, conn=None, overlay=None):
        calls.append((spec, user_id))
        for f in spec.get("filters") or []:
            if f.get("key") == "boom":
                raise ValueError("unknown filter boom")
            if f.get("key") == "crash":
                raise RuntimeError("secret internal path /data/screener.db")
        return {"count": 7, "as_of": "2026-10-12"}

    monkeypatch.setattr(scr_query, "preview_count", fake_preview)
    return _client(PAID), calls


def test_counts_in_order_and_errors_inline(paid):
    c, calls = paid
    body = {"specs": [{"filters": []}, {"filters": [{"key": "boom", "op": "gte", "min": 1}]}, {"filters": []}]}
    r = c.post(URL, json=body)
    assert r.status_code == 200
    out = r.json()["counts"]
    assert out[0] == {"count": 7, "as_of": "2026-10-12"}
    assert out[1] == {"error": "unknown filter boom"}
    assert out[2]["count"] == 7
    assert len(calls) == 3


def test_an_unexpected_failure_is_generic_and_leaks_nothing(paid):
    c, _ = paid
    out = c.post(URL, json={"specs": [{"filters": [{"key": "crash"}]}, {"filters": []}]}).json()["counts"]
    assert out[0] == {"error": "count failed"}
    assert "secret" not in str(out)
    assert out[1]["count"] == 7


def test_user_id_comes_from_the_dependency_not_the_body(paid):
    c, calls = paid
    c.post(URL, json={"specs": [{"filters": []}], "user_id": "someone-else"})
    assert [uid for _, uid in calls] == ["u1"]


def test_rejects_more_than_30(paid):
    c, calls = paid
    assert c.post(URL, json={"specs": [{"filters": []}] * 31}).status_code == 422
    assert calls == []


def test_accepts_exactly_30(paid):
    c, calls = paid
    r = c.post(URL, json={"specs": [{"filters": []}] * 30})
    assert r.status_code == 200 and len(r.json()["counts"]) == 30


def test_rejects_empty(paid):
    c, _ = paid
    assert c.post(URL, json={"specs": []}).status_code == 422


def test_a_free_member_is_refused_before_any_count_runs(monkeypatch):
    calls = []
    monkeypatch.setattr(scr_query, "preview_count", lambda spec, user_id=None, conn=None, overlay=None: calls.append(spec) or {"count": 1})
    r = _client(FREE).post(URL, json={"specs": [{"filters": []}]})
    assert r.status_code == 402
    assert calls == []


def test_the_batch_route_is_not_shadowed_by_a_parametrised_one():
    """Registration order: no route registered before the batch route may match its path."""
    from starlette.routing import Match
    scope = {"type": "http", "method": "POST", "path": URL, "root_path": "", "query_string": b"", "headers": []}
    for route in screener_mod.router.routes:
        m, _ = route.matches(scope)
        if m == Match.FULL:
            assert route.path == URL, f"{route.path} would answer {URL}"
            break
    else:
        pytest.fail("no route matches the batch path")


# -- the real path: one connection, one overlay, a bounded TTL cache ----------

from api.services.screener import snapshot_db as db  # noqa: E402

_SPECS = [
    {},
    {"filters": [{"key": "price", "op": "gte", "min": 20}]},
    {"filters": [{"key": "rsi14", "op": "lte", "max": 50}]},
    {"filters": [{"key": "security_type", "op": "in", "values": ["Stock", "ADR"]}]},
    {"filters": [{"key": "security_type", "op": "not_in", "values": ["ETF"]}]},
    {"filters": [{"key": "price", "op": "gte", "min": 1000}]},
    {"rank": {"criteria": [{"key": "rsi14"}], "top_n": 1}},
]


@pytest.fixture
def snap():
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "price": 100.0, "rsi14": 20.0, "security_type": "Stock",
         "snapshot_date": "2026-08-24"},
        {"ticker": "BBB", "price": 50.0, "rsi14": 80.0, "security_type": "ADR",
         "snapshot_date": "2026-08-24"},
        {"ticker": "QQQ", "price": 400.0, "rsi14": 60.0, "security_type": "ETF",
         "snapshot_date": "2026-08-24"},
        {"ticker": "GAP", "price": 10.0, "rsi14": None, "security_type": "Stock",
         "snapshot_date": "2026-08-23"},
    ])


def _strip(res):
    return {k: v for k, v in res.items() if k != "as_of"} | {
        "as_of": {k: v for k, v in res["as_of"].items() if k != "counted_at"}}


def test_the_batch_answers_exactly_what_each_single_count_answers(snap):
    """Sharing one connection and one overlay must change no answer."""
    batch = scr_query.preview_count_batch(_SPECS, user_id="u1")
    single = [scr_query.preview_count(s, user_id="u1") for s in _SPECS]
    assert [_strip(r) for r in batch] == [_strip(r) for r in single]
    # non-vacuity: the specs genuinely disagree with each other
    assert len({r["count"] for r in batch}) >= 3


def test_the_batch_opens_one_connection_and_decides_the_overlay_once(snap, monkeypatch):
    opened, decided = [], []
    real_connect, real_overlay = db.connect, scr_query._overlay
    monkeypatch.setattr(db, "connect", lambda *a, **k: opened.append(1) or real_connect(*a, **k))
    monkeypatch.setattr(scr_query, "_overlay", lambda c: decided.append(1) or real_overlay(c))
    scr_query.preview_count_batch(_SPECS, user_id="u1")
    assert opened == [1] and decided == [1]


def test_a_repeat_is_served_from_the_cache(snap, monkeypatch):
    first = scr_query.preview_count_batch(_SPECS, user_id="u1")
    calls = []
    real = scr_query.preview_count
    monkeypatch.setattr(scr_query, "preview_count",
                        lambda spec, user_id=None, conn=None, overlay=None:
                        calls.append(spec) or real(spec, user_id=user_id, conn=conn, overlay=overlay))
    again = scr_query.preview_count_batch(_SPECS, user_id="u1")
    assert calls == [] and again == first
    # another member does not read the first member's answers
    scr_query.preview_count_batch(_SPECS[:1], user_id="u2")
    assert len(calls) == 1


def test_a_new_snapshot_misses_the_cache(snap):
    before = scr_query.preview_count_batch([{}], user_id="u1")[0]["count"]
    db.upsert_rows([{"ticker": "NEW", "price": 5.0, "security_type": "Stock",
                     "snapshot_date": "2026-08-24"}])
    assert scr_query.preview_count_batch([{}], user_id="u1")[0]["count"] == before + 1


def test_a_spec_naming_member_data_is_never_cached():
    stamp = "s"
    assert scr_query._count_cache_key({"filters": []}, "u1", stamp)
    assert scr_query._count_cache_key(
        {"filters": [{"key": "list", "op": "in", "value": ["flagged"]}]}, "u1", stamp) is None
    assert scr_query._count_cache_key(
        {"logic": {"any": [{"key": "scan", "op": "in", "value": ["h"]}]}}, "u1", stamp) is None
    assert scr_query._count_cache_key({"filters": []}, "u1", None) is None


def test_the_cache_is_bounded():
    assert scr_query._count_cache().max_size == scr_query.COUNT_CACHE_MAX <= 1000
    assert 0 < scr_query.COUNT_CACHE_TTL_S <= 300


def test_one_bad_spec_does_not_poison_the_batch(snap):
    out = scr_query.preview_count_batch(
        [{}, {"filters": [{"key": "not_a_filter", "op": "gte", "min": 1}]}, {}], user_id="u1")
    assert out[0]["count"] == 4 and isinstance(out[1], ValueError) and out[2]["count"] == 4


def test_an_unexpected_failure_is_logged_with_its_slot(paid, caplog):
    c, _ = paid
    with caplog.at_level("ERROR"):
        c.post(URL, json={"specs": [{"filters": []}, {"filters": [{"key": "crash"}]}]})
    recs = [r for r in caplog.records if "count batch slot 1 failed" in r.getMessage()]
    assert recs and recs[0].exc_info and "secret internal path" in str(recs[0].exc_info[1])


# -- the overlay ON, in RTH: the moving cutoff must not defeat the cache ------

import time as _time  # noqa: E402

from api.services.screener import live_tier  # noqa: E402


def _live_row(ticker, asof, **values):
    row = {c: None for c in live_tier.LIVE_COLUMNS}
    row.update(values)
    row.update({"ticker": ticker, "live_session_ymd": 20260823,
                "live_asof": float(asof), "anchor_bars_asof": "20260822",
                "src_price": float(values.get("price") or 1.0),
                "anchor_price": 1.0, "live_cols": len(values)})
    return row


@pytest.fixture
def rth(monkeypatch):
    """Armed tier, regular session, and a cutoff that ADVANCES on every
    overlay decision (one second each), the way `time.time() - max_age` does,
    while staying inside one cache bucket."""
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "1")
    monkeypatch.setattr(live_tier, "_session", lambda: "regular")
    now = _time.time()
    base = (int(now - 120) // scr_query.COUNT_CACHE_TTL_S) * scr_query.COUNT_CACHE_TTL_S + 10
    ticks = iter(range(10_000))
    monkeypatch.setattr(live_tier, "min_serve_asof",
                        lambda now=None: float(base + next(ticks)))
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "price": 10.0, "bars_asof": "20260822",
         "snapshot_date": "2026-08-22", "built_at": 1},
        {"ticker": "BBB", "price": 10.0, "bars_asof": "20260822",
         "snapshot_date": "2026-08-22", "built_at": 1},
    ])
    db.upsert_live_rows([_live_row("AAA", now, price=50.0)])
    return now


_OVER_20 = [{"filters": [{"key": "price", "op": "gte", "min": 20}]}]


def test_with_the_overlay_on_in_RTH_a_repeat_batch_hits_the_cache(rth, monkeypatch):
    first = scr_query.preview_count_batch(_OVER_20, user_id="u1")
    assert first[0]["count"] == 1          # the LIVE price qualified AAA
    calls = []
    real = scr_query.preview_count
    monkeypatch.setattr(scr_query, "preview_count",
                        lambda spec, user_id=None, conn=None, overlay=None:
                        calls.append(spec) or real(spec, user_id=user_id, conn=conn, overlay=overlay))
    again = scr_query.preview_count_batch(_OVER_20, user_id="u1")
    assert calls == [] and again == first


def test_with_the_overlay_on_a_new_live_sweep_misses_the_cache(rth):
    assert scr_query.preview_count_batch(_OVER_20, user_id="u1")[0]["count"] == 1
    db.upsert_live_rows([_live_row("BBB", rth + 1, price=60.0)])
    assert scr_query.preview_count_batch(_OVER_20, user_id="u1")[0]["count"] == 2


def test_the_nightly_half_of_the_stamp_is_the_live_tiers_own_fingerprint(snap):
    conn = db.connect()
    try:
        stamp = scr_query._snapshot_stamp(conn, scr_query._overlay(conn))
        assert repr(live_tier._anchor_fingerprint(conn)) in stamp
    finally:
        conn.close()


def test_a_database_that_will_not_open_is_logged_once_not_per_slot(monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError("disk gone")
    monkeypatch.setattr(db, "connect", boom)
    c = _client(PAID)
    with caplog.at_level("ERROR"):
        out = c.post(URL, json={"specs": [{"filters": []}] * 5}).json()["counts"]
    assert out == [{"error": "count failed"}] * 5
    errs = [r for r in caplog.records if r.levelname == "ERROR"]
    assert len(errs) == 1 and "could not open" in errs[0].getMessage()
