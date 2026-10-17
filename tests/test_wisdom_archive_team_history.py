"""The chart's per-ticker Team history panel (api/services/wisdom/archive/team_history.py).

SYNTHETIC data only — the repo is public. Tickers are ZZ-prefixed, notes are invented.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the route answering an unpaid member (402), or anyone while either flag is off (404), or the
   unpaid answer leaking the flag state;
2. an outcome leaving the module for a call 20 sessions old or younger (the archive's aging rule),
   or an aged call losing its outcome;
3. a price level (entry / stop / target) appearing anywhere in the payload;
4. a post naming the ticker without a call being dropped instead of shown as a mention;
5. the session moment being anything but null without a resolver, or a resolver's junk / external
   link / exception reaching the member;
6. the flag being undeclared, on by default, or missing from the auth payload.
"""
from __future__ import annotations

import json
import pathlib
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import provider, service, team_history
from api.services.wisdom.core import flags, store
from tests.authclients import FREE_MEMBER, PAID_MEMBER, authorize

REPO = pathlib.Path(__file__).resolve().parents[1]
SECRET = "s3cret-team-history-test"
BATCH = "/api/internal/wisdom/archive/batch"
AUTH = {"Authorization": f"Bearer {SECRET}"}
ROUTE = "/api/wisdom/archive/ticker/ZZTH/team-history"
TODAY = date(2026, 10, 16)                     # a Friday; every date below is relative to it


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("WISDOM_TICKER_HISTORY_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


@pytest.fixture(autouse=True)
def no_resolver():
    team_history.set_moment_resolver(None)
    yield
    team_history.set_moment_resolver(None)


def _client(user):
    a = FastAPI()
    a.include_router(wisdom_archive.member_router)
    a.include_router(wisdom_archive.internal_router)
    if user is not None:
        authorize(a, user)
    return TestClient(a, raise_server_exceptions=False)


def _seed(recent_posted: str):
    """One aged scored call, one recent call the import already scored, one mention-only post."""
    c = _client(None)
    recs = [
        {"record_id": "t9301", "author_id": "tsdr", "stated_date": "2025-01-02", "record_type": "CALL",
         "tickers": ["ZZTH"], "note": "synthetic flag breakout", "quote": "", "image_count": 0},
        {"record_id": "t9302", "author_id": "bracco", "stated_date": recent_posted, "record_type": "CALL",
         "tickers": ["ZZTH"], "note": "synthetic pullback entry", "quote": "", "image_count": 0},
        {"record_id": "t9303", "author_id": "manrav", "stated_date": "2025-06-10", "record_type": "MACRO",
         "tickers": ["ZZTH", "ZZOT"], "note": "synthetic watchlist mention", "quote": "", "image_count": 0},
    ]
    calls = [
        {"call_id": "t9301#0", "record_id": "t9301", "author_id": "tsdr", "ticker": "ZZTH",
         "direction": "long", "setup": "flag_htf", "action": "entry", "posted": "2025-01-02T14:00:00",
         "entry": 10.5, "stop": 9.75, "target": 14.0, "outcome": {"r5": 0.031, "r20": 0.124}},
        {"call_id": "t9302#0", "record_id": "t9302", "author_id": "bracco", "ticker": "ZZTH",
         "direction": "long", "setup": "pullback_ma", "action": "idea", "posted": recent_posted + "T15:00:00",
         "entry": 12.25, "stop": 11.5, "outcome": {"r5": 0.02, "r20": 0.05}},
    ]
    assert c.post(BATCH, json={"kind": "records", "items": recs}, headers=AUTH).json()["inserted"] == 3
    assert c.post(BATCH, json={"kind": "calls", "items": calls}, headers=AUTH).json()["inserted"] == 2


def _payload(today=TODAY):
    with store.read() as conn:
        return team_history.for_ticker(conn, "zzth", today=today)


# ── 1. the paid gate and the two flags ───────────────────────────────────────

def test_paid_member_200_unpaid_402_anonymous_refused(wisdom_db, on):
    _seed("2026-10-14")
    assert _client(PAID_MEMBER).get(ROUTE).status_code == 200
    r = _client(FREE_MEMBER).get(ROUTE)
    assert r.status_code == 402 and r.json()["detail"] == "The trader archive requires a paid plan"
    assert _client(None).get(ROUTE).status_code in (401, 403)


@pytest.mark.parametrize("flag", ["WISDOM_TICKER_HISTORY_ENABLED", "WISDOM_ARCHIVE_ENABLED"])
@pytest.mark.parametrize("raw", ["0", "", "off"])
def test_either_flag_off_is_404_and_the_unpaid_answer_does_not_leak_it(wisdom_db, on, monkeypatch, flag, raw):
    _seed("2026-10-14")
    monkeypatch.setenv(flag, raw)
    assert _client(PAID_MEMBER).get(ROUTE).status_code == 404
    assert _client(FREE_MEMBER).get(ROUTE).status_code == 402      # credential checked first


def test_a_malformed_symbol_is_422_not_500(wisdom_db, on):
    assert _client(PAID_MEMBER).get("/api/wisdom/archive/ticker/%21%21/team-history").status_code == 422


# ── 2. aging: outcomes only for calls older than 20 sessions ─────────────────

def test_a_recent_call_carries_no_outcome_even_when_the_import_scored_it(wisdom_db, on):
    _seed("2026-10-14")
    rows = {r["id"]: r for r in _payload()["rows"]}
    recent = rows["t9302#0"]
    assert recent["outcome_status"] == "pending" and recent["outcome"] is None
    aged = rows["t9301#0"]
    assert aged["outcome_status"] == "scored"
    assert aged["outcome"] == {"r5": pytest.approx(0.031), "r20": pytest.approx(0.124)}


def test_the_boundary_is_the_archives_own_rule_twenty_sessions_is_not_aged(wisdom_db, on):
    """Walk back exactly 20 and 21 sessions from TODAY with the archive's own calendar."""
    from api.services.wisdom.core import timeutil

    d20 = TODAY
    for _ in range(provider.PRICE_AGE_SESSIONS):
        d20 = timeutil.previous_session(d20)
    d21 = timeutil.previous_session(d20)
    assert provider.sessions_since(d20, TODAY) == 20 and provider.sessions_since(d21, TODAY) == 21
    _seed(d20.isoformat())
    assert {r["id"]: r for r in _payload()["rows"]}["t9302#0"]["outcome"] is None
    # the same call one day later in the calendar becomes aged and shows its numbers
    later = TODAY + timedelta(days=3)                      # Monday: one more session elapsed
    row = {r["id"]: r for r in _payload(later)["rows"]}["t9302#0"]
    assert row["outcome_status"] == "scored" and row["outcome"]["r20"] == pytest.approx(0.05)


def test_an_aged_call_with_no_score_says_unscored_not_pending(wisdom_db, on):
    c = _client(None)
    c.post(BATCH, json={"kind": "records", "items": [
        {"record_id": "t9310", "author_id": "jersace", "stated_date": "2024-05-01", "record_type": "CALL",
         "tickers": ["ZZTH"], "note": "synthetic", "quote": "", "image_count": 0}]}, headers=AUTH)
    c.post(BATCH, json={"kind": "calls", "items": [
        {"call_id": "t9310#0", "record_id": "t9310", "author_id": "jersace", "ticker": "ZZTH",
         "posted": "2024-05-01", "setup": "inside_day"}]}, headers=AUTH)
    row = _payload()["rows"][0]
    assert row["outcome_status"] == "unscored" and row["outcome"] is None


# ── 3. never a price level ───────────────────────────────────────────────────

def test_no_price_level_appears_anywhere_in_the_payload(wisdom_db, on):
    _seed("2026-10-14")
    body = _client(PAID_MEMBER).get(ROUTE).json()
    text = json.dumps(body)
    for row in body["rows"]:                                   # ("entry" is also an ACTION value)
        assert not {"entry", "stop", "target", "levels"} & set(row), row["id"]
    assert not {"entry", "stop", "target", "levels"} & set(body)
    for price in ("10.5", "9.75", "14.0", "12.25", "11.5"):
        assert price not in text, price
    assert "t9301#0" in text                                   # control: the calls are there


# ── 4. rows: calls, mentions, traders, order ─────────────────────────────────

def test_rows_are_calls_plus_mentions_newest_first_with_trader_names(wisdom_db, on):
    _seed("2026-10-14")
    out = _payload()
    assert out["ticker"] == "ZZTH" and out["n_calls"] == 2 and out["n_mentions"] == 1
    assert out["n_scored"] == 1 and out["n_pending"] == 1 and out["age_sessions"] == 20
    assert [r["id"] for r in out["rows"]] == ["t9302#0", "t9303", "t9301#0"]
    mention = out["rows"][1]
    assert mention["kind"] == "mention" and mention["record_type"] == "MACRO"
    assert mention["outcome"] is None and mention["setup"] is None
    assert {r["trader"] for r in out["rows"]} == {"TSDR", "Bracco", "Manrav"}
    call = out["rows"][2]
    assert call["setup"] == "flag_htf" and call["action"] == "entry" and call["date"] == "2025-01-02"
    for r in out["rows"]:
        assert "author_id" not in r and "note" not in r and "quote" not in r


def test_a_record_with_a_call_on_the_ticker_is_not_repeated_as_a_mention(wisdom_db, on):
    _seed("2026-10-14")
    ids = [r["record_id"] for r in _payload()["rows"]]
    assert ids.count("t9301") == 1 and ids.count("t9302") == 1


def test_an_unknown_ticker_is_an_empty_history_not_an_error(wisdom_db, on):
    with store.read() as conn:
        out = team_history.for_ticker(conn, "ZZNONE", today=TODAY)
    assert out["rows"] == [] and out["n_calls"] == 0 and out["n_mentions"] == 0


# ── 5. the session moment is a nullable integration point ────────────────────

def test_moment_is_null_without_a_resolver(wisdom_db, on):
    _seed("2026-10-14")
    rows = _payload()["rows"]
    assert all("moment" in r and r["moment"] is None for r in rows)


def test_a_resolver_fills_calls_and_only_in_app_links_survive(wisdom_db, on):
    _seed("2026-10-14")
    seen = {}

    def resolver(conn, call_ids):
        seen["ids"] = list(call_ids)
        return {"t9301#0": {"url": "/desk?video=7&t=754", "label": "  Morning   session ", "t": 754},
                "t9302#0": {"url": "https://evil.example/x"}}

    team_history.set_moment_resolver(resolver)
    rows = {r["id"]: r for r in _payload()["rows"]}
    assert sorted(seen["ids"]) == ["t9301#0", "t9302#0"]
    assert rows["t9301#0"]["moment"] == {"url": "/desk?video=7&t=754", "label": "Morning session", "t": 754}
    assert rows["t9302#0"]["moment"] is None                   # an external link never reaches a member
    assert rows["t9303"]["moment"] is None                     # mentions are not resolved


@pytest.mark.parametrize("bad", ["//evil.example/x", "javascript:alert(1)", "", None, 7])
def test_protocol_relative_and_junk_urls_are_refused(bad):
    assert team_history._clean_moment({"url": bad}) is None


def test_a_failing_resolver_costs_the_links_never_the_panel(wisdom_db, on):
    _seed("2026-10-14")

    def boom(conn, call_ids):
        raise RuntimeError("synthetic resolver failure")

    team_history.set_moment_resolver(boom)
    rows = _payload()["rows"]
    assert len(rows) == 3 and all(r["moment"] is None for r in rows)


# ── 6. the flag: default off, declared dark, member-visible, on the auth payload ──

def test_the_flag_is_default_off_member_visible_and_declared_dark(monkeypatch):
    monkeypatch.delenv("WISDOM_TICKER_HISTORY_ENABLED", raising=False)
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    assert flags.team_history_enabled() is False and team_history.enabled() is False
    row = next(g for g in flags.GATES if g[0] == "WISDOM_TICKER_HISTORY_ENABLED")
    assert row[2] is True
    entry = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"][
        "WISDOM_TICKER_HISTORY_ENABLED"]
    assert entry["status"] == "dark" and entry["exposure"] == "members" and entry["default"] == "0"


def test_the_archive_flag_alone_does_not_arm_the_panel(monkeypatch):
    monkeypatch.setenv("WISDOM_TICKER_HISTORY_ENABLED", "1")
    monkeypatch.delenv("WISDOM_ARCHIVE_ENABLED", raising=False)
    assert team_history.enabled() is False
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    assert team_history.enabled() is True                      # control


def test_the_auth_payload_carries_the_same_reader(monkeypatch):
    from api.routers import auth

    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("WISDOM_TICKER_HISTORY_ENABLED", "1")
    assert auth._wisdom_ticker_history_enabled() is True
    monkeypatch.setenv("WISDOM_TICKER_HISTORY_ENABLED", "0")
    assert auth._wisdom_ticker_history_enabled() is False
    src = (REPO / "api" / "routers" / "auth.py").read_text(encoding="utf-8")
    assert '"wisdom_ticker_history_enabled": _wisdom_ticker_history_enabled(),' in src


def test_team_authors_only(wisdom_db, on):
    """The batch validator already refuses a non-team author; the read filters again so a row
    written by any other path cannot reach the panel."""
    _seed("2026-10-14")
    with store.write() as conn:
        conn.execute(
            "INSERT INTO wisdom_archive_records (record_id, author_id, stated_date, record_type, tickers, "
            "note, quote, image_count, sha, imported_at) VALUES ('t9399','guest:zz','2026-01-05','MACRO',"
            "'ZZTH','x','',0,'0000000000000000','2026-01-05')")
    ids = [r["id"] for r in _payload()["rows"]]
    assert "t9399" not in ids and len(ids) == 3
    assert service.team_authors() >= {"tsdr", "bracco", "manrav"}
