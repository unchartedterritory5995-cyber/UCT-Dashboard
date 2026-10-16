"""The TSDR archive as a provider to the Wisdom publish adapters (owner decisions 2026-10-16).

SYNTHETIC data only — the repo is public.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a call's entry/stop/target reaching any surface before it is older than the price gate;
2. any archive read happening while WISDOM_ARCHIVE_ENABLED is off (or the adapter's own flag);
3. the adapters not using the archive once both flags are on (the wiring being cut);
4. the team-call route serving an unpaid caller, or answering while a gate is off;
5. the dossier carrying a price, a level or a date from an archive note;
6. the watchlist team-call fact appearing for a caller that did not opt in.
"""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_publish
from api.services import watchlist_digest, watchlist_intelligence
from api.services.wisdom.archive import provider, service
from api.services.wisdom.core import store, timeutil
from api.services.wisdom.publish import level_alerts, lookalike
from api.services.wisdom.publish.adapters import badges, brainkb, desk_markers, dossier, provenance
from tests.authclients import FREE_MEMBER, PAID_MEMBER, authorize

TODAY = timeutil.now_et().date()
RECENT = (TODAY - timedelta(days=3)).isoformat()      # inside the 20-session price gate
AGED = (TODAY - timedelta(days=45)).isoformat()       # well past it (~30 sessions)
OLD = (TODAY - timedelta(days=400)).isoformat()       # outside every lookback


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def archive_on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")


def _call(rid, n, ticker, posted, *, author="tsdr", action="entry", direction="long", setup="kicker",
          entry=10.0, stop=9.0, target=13.0, r20=0.08):
    return {"call_id": f"{rid}#{n}", "record_id": rid, "author_id": author, "ticker": ticker,
            "direction": direction, "setup": setup, "action": action, "posted": posted,
            "entry": entry, "stop": stop, "target": target, "outcome": {"r20": r20, "status": "scored"}}


def _seed():
    records = [
        {"record_id": "t9001", "author_id": "tsdr", "stated_date": AGED, "record_type": "CALL", "tickers": ["ZZTA"],
         "note": "synthetic kicker entry above $10.50 on 3/14, stop 9", "quote": "", "image_count": 1},
        {"record_id": "t9002", "author_id": "tsdr", "stated_date": RECENT, "record_type": "CALL", "tickers": ["ZZTA"],
         "note": "synthetic add on the retest", "quote": "", "image_count": 0},
        {"record_id": "t9003", "author_id": "bracco", "stated_date": RECENT, "record_type": "CALL", "tickers": ["ZZTB"],
         "note": "synthetic watchlist name", "quote": "", "image_count": 0},
        {"record_id": "t9004", "author_id": "tsdr", "stated_date": AGED, "record_type": "LESSON", "tickers": [],
         "note": "synthetic lesson: cut losers fast", "quote": "synthetic words about patience", "image_count": 0},
        {"record_id": "t9005", "author_id": "bracco", "stated_date": AGED, "record_type": "MACRO", "tickers": [],
         "note": "synthetic market read: breadth improving", "quote": "", "image_count": 0},
        {"record_id": "t9006", "author_id": "tsdr", "stated_date": OLD, "record_type": "CALL", "tickers": ["ZZTC"],
         "note": "synthetic old call", "quote": "", "image_count": 0},
    ]
    calls = [
        _call("t9001", 0, "ZZTA", AGED),
        _call("t9002", 0, "ZZTA", RECENT, action="add", entry=11.0, stop=10.2, target=None, r20=None),
        _call("t9003", 0, "ZZTB", RECENT, author="bracco", action="watch", setup="flag_htf", entry=None,
              stop=None, target=None, r20=None),
        _call("t9006", 0, "ZZTC", OLD, action="idea"),
    ]
    with store.write() as conn:
        assert service.upsert_batch(conn, "records", records)["inserted"] == len(records)
        assert service.upsert_batch(conn, "calls", calls)["inserted"] == len(calls)


def _never_called(*_a, **_k):  # pragma: no cover - the point is that it is not
    raise AssertionError("the wisdom store was opened with a gate off")


# ── 1. the price gate ────────────────────────────────────────────────────────

def test_the_price_gate_counts_trading_sessions_and_is_strict():
    monday = date(2026, 3, 2)
    assert provider.sessions_since(monday, monday) == 0
    assert provider.sessions_since(monday, monday + timedelta(days=7)) == 5      # a week = five sessions
    twenty_after = monday
    for _ in range(20):
        twenty_after = twenty_after + timedelta(days=1)
        while not timeutil.is_trading_day(twenty_after):
            twenty_after += timedelta(days=1)
    assert provider.sessions_since(monday, twenty_after) == 20
    assert provider.is_aged(monday, twenty_after) is False                       # exactly 20 is not aged
    nxt = twenty_after + timedelta(days=1)
    while not timeutil.is_trading_day(nxt):
        nxt += timedelta(days=1)
    assert provider.is_aged(monday, nxt) is True                                # 21 is
    assert provider.is_aged("not a date", nxt) is False                         # unknown age is never aged


def test_aged_before_agrees_with_is_aged():
    cutoff = date.fromisoformat(provider.aged_before(TODAY))
    assert provider.is_aged(cutoff, TODAY) and not provider.is_aged(cutoff + timedelta(days=1), TODAY)


def test_levels_are_read_only_for_aged_calls(wisdom_db, archive_on):
    _seed()
    with store.read() as conn:
        lv = provider.levels(conn, ["t9001#0", "t9002#0"])
        calls = {c["call_id"]: c for c in provider.calls(conn, tickers=["ZZTA"])}
    assert set(lv) == {"t9001#0"}                                               # the recent add has none
    assert dict(lv["t9001#0"]) == {"entry": 10.0, "stop": 9.0, "target": 13.0}
    for c in calls.values():
        assert not {"entry", "stop", "target"} & set(c)                         # calls() never carries them
    assert "levels" not in provider.public_call(calls["t9002#0"])
    assert provider.public_call(calls["t9001#0"], lv["t9001#0"])["levels"][0] == {"kind": "entry", "price": 10.0}


# ── 2-3. desk markers ────────────────────────────────────────────────────────

def test_desk_markers_read_nothing_with_the_archive_off(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    monkeypatch.setattr("api.services.wisdom.core.store.read", _never_called)
    assert desk_markers.archive_rows("ZZTA") == []


def test_desk_markers_carry_archive_calls_with_levels_only_when_aged(wisdom_db, archive_on):
    _seed()
    rows = desk_markers.archive_rows("ZZTA")
    assert [r["anchor_date"] for r in rows] == [RECENT, AGED]                   # newest first
    by_date = {r["anchor_date"]: r for r in rows}
    assert by_date[AGED]["call"]["levels"] and "levels" not in by_date[RECENT]["call"]
    for r in rows:
        assert r["source_detail"] == "archive" and r["archive_ticker"] == "ZZTA" and r["video_id"] is None
        assert provenance.is_marked(r) and "TSDR" in r["note"]
    merged = desk_markers.merge({"mentions": []}, "ZZTA")                       # the consumer hook's path
    assert sum(1 for m in merged["mentions"] if m.get("source_detail") == "archive") == 2


# ── 4. badges + the team-call route ──────────────────────────────────────────

@pytest.mark.parametrize("badges_on, archive_on_v", [("0", "1"), ("1", "0")])
def test_badges_need_both_gates(monkeypatch, badges_on, archive_on_v):
    monkeypatch.setenv("WISDOM_BADGES_ENABLED", badges_on)
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", archive_on_v)
    monkeypatch.setattr("api.services.wisdom.core.store.read", _never_called)
    assert badges.archive_badges(["ZZTA"]) == {} and badges.archive_history(["ZZTA"]) == {}


def test_badges_name_the_newest_call_in_the_lookback_and_never_a_level(wisdom_db, archive_on, monkeypatch):
    monkeypatch.setenv("WISDOM_BADGES_ENABLED", "1")
    _seed()
    found = badges.archive_badges(["ZZTA", "ZZTB", "ZZTC"])
    assert set(found) == {"ZZTA", "ZZTB"}                                       # ZZTC is outside the lookback
    assert found["ZZTA"]["action"] == "add" and found["ZZTA"]["label"] == "Team added"
    assert found["ZZTB"]["kind"] == "mention" and found["ZZTB"]["speaker"] == "Bracco"
    hist = badges.archive_history(["ZZTA", "ZZTC"])
    assert hist["ZZTA"]["n_calls"] == 2 and hist["ZZTA"]["n_scored"] == 1
    assert abs(hist["ZZTA"]["mean_r20"] - 0.08) < 1e-9 and hist["ZZTC"]["n_calls"] == 1
    blob = repr(found) + repr(hist)
    assert "'levels'" not in blob and not any(p in blob for p in ("10.0", "9.0", "13.0", "11.0", "10.2"))


def _client(user):
    app = FastAPI()
    app.include_router(wisdom_publish.member_router)
    if user is not None:
        authorize(app, user)
    return TestClient(app, raise_server_exceptions=False)


def test_the_team_call_route_is_paid_only_and_dark_while_a_gate_is_off(wisdom_db, archive_on, monkeypatch):
    _seed()
    url = "/api/wisdom/team-calls?tickers=ZZTA,ZZTB"
    monkeypatch.setenv("WISDOM_BADGES_ENABLED", "1")
    assert _client(None).get(url).status_code in (401, 403)
    free = _client(FREE_MEMBER).get(url)
    assert free.status_code == 402 and free.json()["detail"] == "Team call history requires a paid plan"
    ok = _client(PAID_MEMBER).get(url)
    assert ok.status_code == 200 and set(ok.json()["badges"]) == {"ZZTA", "ZZTB"}
    assert ok.json()["history"]["ZZTA"]["last"]["trader"] == "TSDR"
    monkeypatch.setenv("WISDOM_BADGES_ENABLED", "0")
    assert _client(PAID_MEMBER).get(url).status_code == 404
    monkeypatch.setenv("WISDOM_BADGES_ENABLED", "1")
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    assert _client(PAID_MEMBER).get(url).status_code == 404


def test_the_team_call_route_is_mounted_by_the_registry():
    from api.services.wisdom import registry

    assert any(getattr(r, "prefix", "") == "/api/wisdom/team-calls" for r in registry.routers())


# ── 5. dossier ───────────────────────────────────────────────────────────────

def test_dossier_archive_lines_are_scrubbed_and_gated(wisdom_db, archive_on, monkeypatch):
    _seed()
    monkeypatch.setenv("WISDOM_DOSSIER_ENABLED", "1")
    lines = dossier.wisdom_lines("ZZTA")
    assert lines and all(dossier.LABEL in ln and "(trader archive)" in ln for ln in lines)
    text = " ".join(ln.split("[wisdom-provenance")[0] for ln in lines)
    assert "$" not in text and "10.50" not in text and "3/14" not in text and AGED not in text
    assert all(provenance.is_marked(ln) for ln in lines)
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    assert dossier.wisdom_lines("ZZTA") == []


# ── brain KB, lookalike, level alerts ────────────────────────────────────────

def test_brainkb_stages_lessons_and_market_reads_with_a_marker(wisdom_db, archive_on):
    _seed()
    with store.read() as conn:
        rows = brainkb.archive_rows(conn)
    refs = {r["source_ref"]: r for r in rows}
    assert set(refs) == {"wisdom:archive:t9004", "wisdom:archive:t9005"}
    assert refs["wisdom:archive:t9004"]["category"] == "RULE"
    assert refs["wisdom:archive:t9005"]["category"] == "MACRO"
    for r in rows:
        assert provenance.is_marked(r["content"]) and r["priority"] == brainkb.PRIORITY
        assert AGED in r["title"] and r["content_sha256"]
    assert "In their words: synthetic words about patience" in refs["wisdom:archive:t9004"]["content"]


def test_brainkb_archive_rows_are_empty_with_the_archive_off(wisdom_db, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    with store.read() as conn:
        assert brainkb.archive_rows(conn) == []


def test_lookalike_reference_set_includes_archive_calls_as_of_their_session(wisdom_db, archive_on, monkeypatch):
    _seed()
    asked = []
    monkeypatch.setattr(lookalike, "_daily_bars", lambda t, ymd, n: asked.append((t, ymd)) or [])
    monkeypatch.setattr(lookalike, "features", lambda bars: {k: 0.0 for k in lookalike.FEATURES})
    with store.read() as conn:
        refs = lookalike.archive_reference_vectors(conn, TODAY)
    assert sorted(rid for rid, _ in refs) == ["archive:t9001#0", "archive:t9002#0"]   # TSDR long entry/add only
    assert ("ZZTA", int(AGED.replace("-", ""))) in asked                              # bars as of the posted day


def test_level_alerts_score_only_aged_open_archive_calls(wisdom_db, archive_on):
    _seed()
    with store.read() as conn:
        calls, levels = level_alerts.archive_open_calls(conn, TODAY)
    assert [c["record_id"] for c in calls] == ["archive:t9001#0"]               # the recent add is not aged
    assert dict(levels["archive:t9001#0"]) == {"entry": 10.0, "stop": 9.0, "target": 13.0}
    with store.write() as conn:
        service.upsert_batch(conn, "records", [{"record_id": "t9007", "author_id": "tsdr", "stated_date": RECENT,
                                                "record_type": "RESULT", "tickers": ["ZZTA"], "note": "out",
                                                "quote": "", "image_count": 0}])
        service.upsert_batch(conn, "calls", [_call("t9007", 0, "ZZTA", RECENT, action="exit")])
    with store.read() as conn:
        assert level_alerts.archive_open_calls(conn, TODAY) == ([], {})         # a later exit closes it


# ── 6. the watchlist fact is opt-in ──────────────────────────────────────────

def _quiet_intel(monkeypatch):
    monkeypatch.setattr(watchlist_intelligence, "_earnings_facts", lambda syms: ({}, False))
    monkeypatch.setattr(watchlist_intelligence, "_analyst_fact", lambda sym: None)
    monkeypatch.setattr(watchlist_intelligence, "_filing_fact", lambda sym: None)
    monkeypatch.setattr(watchlist_intelligence, "_rating_context", lambda sym: {})


def test_the_team_call_fact_appears_only_when_asked_for(wisdom_db, archive_on, monkeypatch):
    monkeypatch.setenv("WISDOM_BADGES_ENABLED", "1")
    _seed()
    _quiet_intel(monkeypatch)
    plain = watchlist_intelligence.get_intelligence_for_symbols(["ZZTA"])
    assert plain["ZZTA"]["facts"] == [] and plain["ZZTA"]["notable"] is False
    asked = watchlist_intelligence.get_intelligence_for_symbols(["ZZTA"], include_team_calls=True)
    (fact,) = asked["ZZTA"]["facts"]
    assert fact["kind"] == "team_call" and fact["as_of"] == RECENT              # the CALL's own date
    assert fact["label"].startswith("Team added: TSDR") and asked["ZZTA"]["status"] == "ok"


def test_the_digest_line_is_withheld_from_an_unpaid_subscriber(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE users (id TEXT, role TEXT, email TEXT)")
    conn.execute("INSERT INTO users VALUES ('u1', 'member', 'x@example.invalid')")
    monkeypatch.setattr(watchlist_digest, "get_connection", lambda: _NoClose(conn))
    monkeypatch.setattr("api.middleware.auth_middleware.get_user_plan", lambda uid: "free")
    monkeypatch.setattr(watchlist_intelligence, "team_call_facts", _never_called)
    assert watchlist_digest._team_calls_for("u1", ["ZZTA"]) == {}


class _NoClose:
    def __init__(self, conn):
        self._c = conn

    def execute(self, *a):
        return self._c.execute(*a)

    def close(self):
        pass
