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
