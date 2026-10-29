"""THIS RHYMES — the team archive's precedent beside today's scanner hits.

SYNTHETIC data only (the repo is public). Real detector ids go through the real vocabulary map
(uct_kicker -> kicker), so the join under test is the shipped one, not a stub.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the store or the scan being opened while the flag is off;
2. a price level (entry / stop / target) leaving the module, for any call;
3. an internal detector, a candlestick shape, an unmapped detector or a detection older than the
   active window reaching the hits;
4. "closest" not being the same setup in the same market state, or listing the hit's own ticker;
5. the ranking not putting a ticker the team has history on first;
6. the route not being paid + flag gated;
7. the Ask AI line appearing for an unrelated question, or uncited; the Compass tool answering
   while the flag is off.
"""
from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import askai, rhymes, setup_map, tools
from api.services.wisdom.core import store
from tests.authclients import FREE_MEMBER, PAID_MEMBER, authorize
from tests.test_wisdom_archive_members import _playbook, _stats

SECRET = "s3cret-archive-rhymes-test"
BATCH = "/api/internal/wisdom/archive/batch"
AUTH = {"Authorization": f"Bearer {SECRET}"}
ROUTE = "/api/wisdom/archive/rhymes"


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)
    store.init_db()
    setup_map.clear_cache()
    rhymes.clear_cache()
    monkeypatch.setattr(setup_map, "market_state", lambda: "downtrend")
    yield
    rhymes.clear_cache()


def _client(user):
    app = FastAPI()
    app.include_router(wisdom_archive.member_router)
    app.include_router(wisdom_archive.internal_router)
    if user is not None:
        authorize(app, user)
    return TestClient(app, raise_server_exceptions=False)


def _call(cid, ticker, posted, regime, r20, **over):
    out = {"call_id": cid, "record_id": cid.split("#")[0], "author_id": "tsdr", "ticker": ticker,
           "direction": "long", "setup": "kicker", "posted": posted, "entry": 10.0, "stop": 9.0,
           "target": 14.0, "outcome": {"r20": r20, "sim_R": 2.0, "regime": regime, "status": "scored"}}
    out.update(over)
    return out


def _seed_archive():
    c = _client(None)
    recs = [{"record_id": f"t95{i:02d}", "author_id": "tsdr", "stated_date": "2025-01-02", "record_type": "CALL",
             "tickers": [], "note": "synthetic", "quote": "", "image_count": 0} for i in range(1, 7)]
    calls = [
        _call("t9501#0", "ZZTA", "2025-06-02T14:00:00", "downtrend", 0.12),   # the hit's own ticker
        _call("t9502#0", "ZZB", "2025-05-01T14:00:00", "downtrend", 0.20),
        _call("t9503#0", "ZZC", "2025-07-01T14:00:00", "uptrend", 0.30),      # wrong market state
        _call("t9504#0", "ZZD", "2025-04-01T14:00:00", "downtrend", -0.05),
        _call("t9505#0", "ZZE", "2025-03-01T14:00:00", "downtrend", 0.01),
        _call("t9506#0", "ZZF", "2025-02-01T14:00:00", "downtrend", 0.02),
    ]
    kicker = _playbook(setup_id="kicker", name="Kicker candle", aliases=["kicker"],
                       stats=_stats(140, 0.4, 3.4))                            # a measured edge
    assert c.post(BATCH, json={"kind": "records", "items": recs}, headers=AUTH).json()["inserted"] == 6
    out = c.post(BATCH, json={"kind": "calls", "items": calls}, headers=AUTH).json()
    assert out["inserted"] == 6, out
    assert c.post(BATCH, json={"kind": "setups", "items": [kicker]}, headers=AUTH).json()["inserted"] == 1


def _detect(rows):
    from api.services.pattern_engine import pattern_db

    now = int(time.time())
    with pattern_db.get_connection() as conn:
        for i, (sym, pid, category, age_days, conf) in enumerate(rows):
            conn.execute(
                "INSERT INTO pattern_detections (id, sym, tf, pattern_id, category, direction, start_t, end_t, "
                "confidence, quality_json, geometry_json, levels_json, context_json, narrative_json, status, "
                "detected_at, last_seen_at, hash_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"d{i}", sym, "D", pid, category, "long", now, now, conf, "{}", "{}",
                 '{"entry": 11.0, "stop": 10.0}', "{}", "{}", "forming", now - age_days * 86400, now, f"h{i}"))
        conn.commit()


def _keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from _keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from _keys(v)


# ── 1. the gate ──────────────────────────────────────────────────────────────

def test_flag_off_opens_neither_the_scan_nor_the_store(env, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")

    def boom(*a, **k):
        raise AssertionError("opened while the flag is off")

    monkeypatch.setattr(rhymes, "_detections", boom)
    monkeypatch.setattr(store, "read", boom)
    assert rhymes.today() is None
    assert tools.rhymes()["ok"] is False


# ── 2-5. what a hit carries ──────────────────────────────────────────────────

def test_a_hit_carries_the_record_the_history_and_the_closest_calls_without_levels(env):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    out = rhymes.today()
    assert out["market_state"] == "downtrend" and out["n_hits"] == 1
    hit = out["hits"][0]
    assert hit["ticker"] == "ZZTA" and hit["setup"] == "kicker" and hit["pattern_id"] == "uct_kicker"
    assert hit["playbook"]["verdict"] == "measured edge" and hit["playbook"]["n_scored"] == 140
    assert hit["playbook"]["today_cut"]["n_scored"] == 40                         # the downtrend cut
    th = hit["ticker_history"]
    assert th["n_calls"] == 1 and th["last_call"]["record_id"] == "t9501" and th["last_call"]["trader"]
    closest = hit["closest"]
    assert [c["ticker"] for c in closest] == ["ZZB", "ZZD", "ZZE"]                 # same state, newest first
    assert "ZZTA" not in {c["ticker"] for c in closest}                            # never the hit itself
    assert "ZZC" not in {c["ticker"] for c in closest}                             # never another market state
    assert not {"entry", "stop", "target", "levels", "levels_json"} & set(_keys(out))


def test_internal_candlestick_unmapped_and_stale_detections_never_rhyme(env, monkeypatch):
    _seed_archive()
    _detect([
        ("ZZTA", "uct_kicker", "uct", 0, 80.0),                  # control: rhymes
        ("ZZG", "uct_kicker", "candlestick", 0, 90.0),           # a candlestick shape
        ("ZZH", "doji_not_a_mapped_detector", "uct", 0, 90.0),   # maps to no archive setup
        ("ZZI", "uct_kicker", "uct", 9, 90.0),                   # older than the active window
    ])
    assert [h["ticker"] for h in rhymes.today()["hits"]] == ["ZZTA"]
    from api.services.pattern_engine.detectors import registry

    monkeypatch.setattr(registry, "INTERNAL_PATTERN_IDS", frozenset({"uct_kicker"}))
    assert rhymes.today(force=True)["hits"] == []                                  # internal ids never surface


def test_a_ticker_the_team_has_history_on_ranks_first(env):
    _seed_archive()
    _detect([("ZZQ", "uct_kicker", "uct", 0, 99.0),               # no team history, higher confidence
             ("ZZTA", "uct_kicker", "uct", 0, 60.0)])             # team history
    assert [h["ticker"] for h in rhymes.today()["hits"]] == ["ZZTA", "ZZQ"]


def test_one_hit_per_ticker_and_setup_keeps_the_most_confident_detection(env):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 60.0), ("ZZTA", "uct_kicker", "uct", 1, 90.0)])
    hits = rhymes.today()["hits"]
    assert len(hits) == 1 and hits[0]["confidence"] == 90.0


# ── 6. the route ─────────────────────────────────────────────────────────────

def test_the_route_is_paid_and_flag_gated(env, monkeypatch):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    assert _client(FREE_MEMBER).get(ROUTE).status_code == 402
    assert _client(None).get(ROUTE).status_code in (401, 403)
    ok = _client(PAID_MEMBER).get(ROUTE)
    assert ok.status_code == 200 and ok.json()["hits"][0]["ticker"] == "ZZTA"     # control
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    assert _client(PAID_MEMBER).get(ROUTE).status_code == 404


# ── 7. Ask AI and Compass ────────────────────────────────────────────────────

def test_ask_ai_carries_a_cited_bounded_rhymes_line_only_when_asked(env):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    assert askai.asks_for_rhymes("what's rhyming today?") and askai.asks_for_rhymes("today's setups")
    assert not askai.asks_for_rhymes("what did TSDR say about breakouts")
    text, cites = askai.archive_block("what's rhyming today?", query_tickers=[])
    assert "TODAY'S SCANNER HITS THAT RHYME" in text and "ZZTA" in text and "t9501" in text
    rc = [c for c in cites if c["kind"] == askai.RHYMES_KIND]
    assert rc and rc[0]["record_id"] == "t9501"
    assert len(askai.rhymes_line()[0]) <= askai.RHYMES_CHARS
    other, _ = askai.archive_block("zzzunmatchedword", query_tickers=[])
    assert "RHYME" not in other                                                    # control


def test_the_compass_tool_answers_bounded_while_on(env):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    out = tools.rhymes(limit=50)
    assert out["ok"] and out["count"] == 1 and len(out["hits"]) <= tools.MAX_RHYMES
    assert "trader_archive_rhymes" in tools.NAMES


# ── 8. the cache: never the scan on a hit, ONE compute at a time (2026-10-29) ──────────────────
# Production, 2026-10-29: GET /rhymes ran >130 s and never answered, because every request ran the
# full detection read just to build its cache key, and nothing stopped N requests computing at once.

def _count(monkeypatch, name):
    calls = []
    real = getattr(rhymes, name)

    def wrapped(*a, **k):
        calls.append(1)
        return real(*a, **k)

    monkeypatch.setattr(rhymes, name, wrapped)
    return calls


def test_a_cached_answer_is_served_without_reading_the_scan(env, monkeypatch):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    reads = _count(monkeypatch, "_detections")
    first = rhymes.today()
    assert len(reads) == 1 and first["n_hits"] == 1                               # control: a cold cache reads
    for _ in range(5):
        assert rhymes.today() is first
    assert len(reads) == 1


def test_a_stale_answer_is_served_at_once_and_refreshed_once_in_the_background(env, monkeypatch):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    first = rhymes.today()
    computes = _count(monkeypatch, "_compute")
    started = []
    monkeypatch.setattr(rhymes, "_start_background", lambda: started.append(1) or True)
    with rhymes._LOCK:
        rhymes._CACHE["at"] -= rhymes.REFRESH_S + 1                                # make it refresh-old
    assert rhymes.today() is first and rhymes.today() is first                    # served, not recomputed
    assert computes == [] and len(started) == 2                                   # _start_background is the single-flight
    with rhymes._LOCK:
        rhymes._CACHE["at"] -= rhymes.STALE_MAX_S                                  # too old to serve
    assert rhymes.today() is not first and len(computes) == 1                     # the request computes


def test_only_one_background_refresh_runs_at_a_time(env, monkeypatch):
    import threading

    gate = threading.Event()
    ran = []

    def slow(*a, **k):
        ran.append(1)
        gate.wait(5)
        return None

    monkeypatch.setattr(rhymes, "_refresh", slow)
    assert rhymes._start_background() is True
    assert rhymes._start_background() is False and rhymes._start_background() is False
    gate.set()
    for _ in range(100):
        if not rhymes._STATE["refreshing"]:
            break
        time.sleep(0.02)
    assert ran == [1] and rhymes._STATE["refreshing"] is False


def test_concurrent_cold_callers_share_one_compute(env, monkeypatch):
    import threading

    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    real = rhymes._compute
    computes = []

    def slow(*a, **k):
        computes.append(1)
        time.sleep(0.3)
        return real(*a, **k)

    monkeypatch.setattr(rhymes, "_compute", slow)
    out = []
    threads = [threading.Thread(target=lambda: out.append(rhymes.today())) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert len(out) == 4 and all(o is not None and o["n_hits"] == 1 for o in out)
    assert computes == [1]


def test_warm_is_flag_gated_and_starts_nothing_when_fresh(env, monkeypatch):
    started = []
    monkeypatch.setattr(rhymes, "_start_background", lambda: started.append(1) or True)
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    rhymes.warm()
    assert started == []
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    rhymes.warm()
    assert started == [1]                                                          # control: cold, on => starts
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    rhymes.today(force=True)
    rhymes.warm()
    assert started == [1]                                                          # fresh => nothing


def test_a_ticker_on_many_setups_reads_its_history_once(env, monkeypatch):
    from api.services.wisdom.archive import service

    _seed_archive()
    c = _client(None)
    flag = _playbook(setup_id="flag_htf", name="Flag", aliases=["flag"], stats=_stats(90, 0.1, 1.0))
    assert c.post(BATCH, json={"kind": "setups", "items": [flag]}, headers=AUTH).json()["inserted"] == 1
    index = dict(setup_map._index(), uct_flag_synthetic="flag_htf")
    monkeypatch.setattr(setup_map, "_index", lambda: index)
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0), ("ZZTA", "uct_flag_synthetic", "uct", 0, 70.0)])
    lookups = []
    real_summary = service.ticker_summary
    monkeypatch.setattr(service, "ticker_summary", lambda conn, sym: lookups.append(sym) or real_summary(conn, sym))
    out = rhymes.today(force=True)
    assert sorted(h["setup"] for h in out["hits"]) == ["flag_htf", "kicker"]       # control: two hits, one ticker
    assert lookups == ["ZZTA"]


def test_a_cold_route_answers_warming_instead_of_outliving_the_cdn(env, monkeypatch):
    import threading

    from api.routers import wisdom_archive as route_mod

    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    gate = threading.Event()
    real = rhymes._compute

    def slow(*a, **k):
        gate.wait(10)
        return real(*a, **k)

    monkeypatch.setattr(rhymes, "_compute", slow)
    monkeypatch.setattr(route_mod, "RHYMES_WAIT_S", 0.2)
    first = _client(PAID_MEMBER).get(ROUTE)
    assert first.status_code == 202 and first.json()["status"] == "warming"
    gate.set()
    for _ in range(100):
        if rhymes._CACHE["value"] is not None:
            break
        time.sleep(0.02)
    second = _client(PAID_MEMBER).get(ROUTE)
    assert second.status_code == 200 and second.json()["n_hits"] == 1           # the background answer landed


def test_wait_s_returns_the_answer_when_it_lands_in_time(env):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    out = rhymes.today(wait_s=10)
    assert out is not rhymes.WARMING and out["n_hits"] == 1


def test_the_scan_read_returns_only_mapped_detectors_and_the_best_row_per_detector(env):
    _detect([
        ("ZZTA", "uct_kicker", "uct", 0, 60.0),
        ("ZZTA", "uct_kicker", "uct", 1, 90.0),                  # the best ZZTA kicker
        ("ZZTA", "uct_kicker", "uct", 0, 70.0),
        ("ZZB", "doji_not_a_mapped_detector", "uct", 0, 99.0),   # maps to no setup: never read
    ])
    rows = rhymes._detections()
    assert [(r[0], r[1], r[3]) for r in rows] == [("ZZTA", "uct_kicker", 90.0)]


def test_an_empty_vocabulary_reads_no_scan(env, monkeypatch):
    monkeypatch.setattr(setup_map, "pattern_ids", lambda: ())
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    assert rhymes._detections() == []


def test_the_scan_read_walks_the_detected_at_index(env, monkeypatch):
    """The query plan, not a timing: idx_pd_detected, never idx_pd_status (see _detections)."""
    from api.services.pattern_engine import pattern_db

    plans = []
    real = pattern_db.get_connection

    class Spy:
        def __init__(self, conn):
            self._c = conn

        def execute(self, sql, params=()):
            plans.extend(r[-1] for r in self._c.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall())
            return self._c.execute(sql, params)

        def close(self):
            self._c.close()

    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    monkeypatch.setattr(pattern_db, "get_connection", lambda: Spy(real()))
    assert len(rhymes._detections()) == 1                                       # control: it read
    assert any("idx_pd_detected" in p for p in plans), plans
    assert not any("idx_pd_status" in p or "idx_pd_pattern" in p for p in plans), plans


def test_one_setup_cannot_take_every_slot(env, monkeypatch):
    _seed_archive()
    c = _client(None)
    flag = _playbook(setup_id="flag_htf", name="Flag", aliases=["flag"], stats=_stats(90, 0.1, 1.0))
    assert c.post(BATCH, json={"kind": "setups", "items": [flag]}, headers=AUTH).json()["inserted"] == 1
    index = dict(setup_map._index(), uct_flag_synthetic="flag_htf")
    monkeypatch.setattr(setup_map, "_index", lambda: index)
    monkeypatch.setattr(rhymes, "PER_SETUP_MAX", 2)
    _detect([(f"ZK{i}", "uct_kicker", "uct", 0, 80.0 + i) for i in range(4)]
            + [("ZF0", "uct_flag_synthetic", "uct", 0, 50.0)])
    out = rhymes.today(force=True)
    assert out["n_hits"] == 5                                                     # the total is still the total
    assert [h["setup"] for h in out["hits"]].count("kicker") == 2                 # capped
    assert "flag_htf" in [h["setup"] for h in out["hits"]]                        # the other setup got a slot


# ── 9. the answer survives a restart (2026-10-29) ─────────────────────────────────────────────

def _restart():
    """What a new process sees: an empty in-memory cache that has not yet looked at the disk."""
    with rhymes._LOCK:
        rhymes._CACHE.update(at=0.0, value=None)
    rhymes._DISK_LOADED["done"] = False


def test_a_restarted_process_serves_the_saved_answer_without_reading_the_scan(env, monkeypatch):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    first = rhymes.today()
    assert first["n_hits"] == 1
    _restart()
    reads = _count(monkeypatch, "_detections")
    again = rhymes.today(wait_s=0)
    assert again is not rhymes.WARMING and again["n_hits"] == 1 and again["hits"][0]["ticker"] == "ZZTA"
    assert reads == []                                                             # served from the file


def test_a_saved_answer_too_old_to_serve_is_ignored(env, monkeypatch):
    _seed_archive()
    _detect([("ZZTA", "uct_kicker", "uct", 0, 80.0)])
    rhymes.today()
    import json as _json

    path = rhymes._disk_path()
    saved = _json.load(open(path, encoding="utf-8"))
    saved["at"] -= rhymes.STALE_MAX_S + 1
    _json.dump(saved, open(path, "w", encoding="utf-8"))
    _restart()
    started = []
    monkeypatch.setattr(rhymes, "_start_background", lambda: started.append(1) or True)
    assert rhymes.today(wait_s=0) is rhymes.WARMING and started == [1]            # never served stale


def test_a_corrupt_saved_answer_is_ignored_never_served(env, monkeypatch):
    open(rhymes._disk_path(), "w", encoding="utf-8").write("{not json")
    _restart()
    started = []
    monkeypatch.setattr(rhymes, "_start_background", lambda: started.append(1) or True)
    assert rhymes.today(wait_s=0) is rhymes.WARMING and started == [1]


def test_flag_off_reads_no_saved_answer(env, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    monkeypatch.setattr(rhymes, "_load_from_disk", lambda: (_ for _ in ()).throw(AssertionError("read while off")))
    assert rhymes.today() is None
