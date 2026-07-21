"""Tests for the AI Search capture foundation (api/services/ai_search_log.py)."""
import json
import sqlite3

import pytest

import api.services.ai_search_log as ail


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path / "ais.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", "unit-test-secret-XYZ")
    ail._reset_for_tests()
    return tmp_path / "ais.db"


def _rows(path):
    with sqlite3.connect(str(path)) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute("SELECT * FROM ai_search_log ORDER BY id").fetchall()]


# ── classifiers ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("q,recency,sources,expect", [
    ("what's moving right now?", "day", [], "time_sensitive"),
    ("latest analyst price target on NVDA", "week", ["analyst"], "time_sensitive"),   # week must NOT be evergreen
    ("is NVDA a buy here?", None, ["quote"], "time_sensitive"),                        # live-grounded verdict
    ("what is a VCP pattern?", None, [], "evergreen"),
    ("compare NVDA vs AMD on valuation", None, ["fundamentals"], "evergreen"),
    ("some vague thing", None, [], "time_sensitive"),                                  # ambiguous → conservative
])
def test_classify_freshness(q, recency, sources, expect):
    assert ail.classify_freshness(q, recency, sources) == expect


@pytest.mark.parametrize("q,expect", [
    ("why is NVDA up today?", "why-move"),
    ("compare NVDA vs AMD", "compare"),
    ("should I sell my NVDA?", "portfolio-risk"),
    ("what's NVDA's forward P/E?", "valuation"),
    ("options flow on NVDA today", "options-flow"),
    ("what is a bull flag?", "concept-education"),
])
def test_question_type(q, expect):
    assert ail.classify_question_type(q) == expect


@pytest.mark.parametrize("q,expect", [
    ("should I sell my 500 NVDA shares from $120?", 1),
    ("my cost basis is 100", 1),
    ("email me at trader@example.com", 1),
    ("what is a VCP?", 0),
    ("why is NVDA moving?", 0),
])
def test_first_person(q, expect):
    assert ail.first_person_flag(q) == expect


def test_answer_tickers_from_links_and_cashtags():
    a = "**[Nvidia]($NVDA)** leads; watch $AMD and [Broadcom]($AVGO)."
    assert ail.extract_answer_tickers(a) == ["NVDA", "AMD", "AVGO"]


# ── write + read ─────────────────────────────────────────────────────────────
def test_log_and_insights(db):
    ail.log(user_id="u1", query="Why is SMCI moving today?", answer="[SMCI]($SMCI) is up +5% today.",
            recency="day", grounded_sources=["quote", "movers"], query_tickers=["SMCI"],
            citations=["https://reuters.com/x"], mode="fast", model="sonar-pro")
    ail.log(user_id="u2", query="What is a VCP pattern?", answer="A volatility contraction pattern is...",
            recency=None, grounded_sources=[], mode="fast", model="sonar-pro")
    rows = _rows(db)
    assert len(rows) == 2
    by_q = {r["query"]: r for r in rows}
    hot = by_q["Why is SMCI moving today?"]
    assert hot["freshness"] == "time_sensitive"
    assert json.loads(hot["answer_tickers"]) == ["SMCI"]
    assert json.loads(hot["citations_json"]) == ["https://reuters.com/x"]
    assert hot["citation_count"] == 1 and hot["answer_hash"] and hot["capture_version"] == ail.CAPTURE_VERSION
    assert by_q["What is a VCP pattern?"]["freshness"] == "evergreen"

    ins = ail.insights(days=7)
    assert ins["window_count"] == 2 and ins["answered"] == 2
    assert ins["by_freshness"].get("time_sensitive") == 1 and ins["by_freshness"].get("evergreen") == 1
    assert any(t["ticker"] == "SMCI" for t in ins["top_tickers"])
    assert ins["distinct_buckets"] == 2


def test_flag_off_is_noop(db, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "0")
    ail.log(user_id="u1", query="hello", answer="world")
    assert ail.insights()["total"] == 0


def test_best_effort_never_raises(tmp_path, monkeypatch):
    # DB path whose parent is an existing FILE → makedirs/connect fail; log must swallow.
    f = tmp_path / "not_a_dir"
    f.write_text("x")
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(f / "sub" / "ais.db"))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    ail._reset_for_tests()
    ail.log(user_id="u1", query="q", answer="a")   # must not raise
    assert ail.insights()["total"] == 0            # graceful empty


def test_length_caps(db):
    ail.log(user_id="u1", query="Q" * 5000, answer="A" * 40000)
    r = _rows(db)[0]
    assert len(r["query"]) == 2000 and len(r["answer"]) == 16000


# ── privacy / HMAC bucket ────────────────────────────────────────────────────
def test_user_bucket_stable_keyed_and_rotates(db):
    b1 = ail._user_bucket("user-42", "2026-07-21")
    b2 = ail._user_bucket("user-42", "2026-07-21")   # same day → stable
    b3 = ail._user_bucket("user-42", "2026-07-22")   # next day → different (unlinkable)
    b4 = ail._user_bucket("user-99", "2026-07-21")   # other user → different
    assert b1 == b2 and b1 != b3 and b1 != b4 and len(b1) == 16
    assert ail._user_bucket(None, "2026-07-21") is None


def test_user_bucket_survives_redeploy(db):
    before = ail._user_bucket("user-42", "2026-07-21")
    ail._reset_for_tests()          # simulate a process restart / redeploy
    assert ail._user_bucket("user-42", "2026-07-21") == before   # not a per-process random salt


def test_secret_not_persisted(db):
    ail.log(user_id="user-42", query="hello", answer="world")
    raw = open(str(db), "rb").read()
    assert b"unit-test-secret-XYZ" not in raw   # HMAC secret never written to the DB


# ── signals + curation ───────────────────────────────────────────────────────
def test_signal_and_pin_flag(db):
    ail.log(user_id="u1", answer_id="aid-123", query="q", answer="a")
    ail.record_signal("aid-123", "save")
    ail.record_signal("aid-123", "pin")
    with sqlite3.connect(str(db)) as c:
        fb = c.execute("SELECT kind FROM ai_search_feedback WHERE answer_id='aid-123' ORDER BY id").fetchall()
        pinned = c.execute("SELECT pinned FROM ai_search_log WHERE answer_id='aid-123'").fetchone()[0]
    assert [k for (k,) in fb] == ["save", "pin"]
    assert pinned == 1


def test_curation_flag_transitions(db):
    """pin/unpin and exclude/unexclude flip the curation flags Phase-2 retrieval reads."""
    ail.log(user_id="u1", answer_id="aid-x", query="q", answer="a")

    def flags():
        with sqlite3.connect(str(db)) as c:
            return c.execute("SELECT pinned, excluded FROM ai_search_log WHERE answer_id='aid-x'").fetchone()

    assert flags() == (0, 0)
    ail.record_signal("aid-x", "pin");      assert flags() == (1, 0)
    ail.record_signal("aid-x", "exclude");  assert flags() == (1, 1)
    ail.record_signal("aid-x", "unpin");    assert flags() == (0, 1)
    ail.record_signal("aid-x", "unexclude"); assert flags() == (0, 0)


# ── forward-compatibility: additive migration ────────────────────────────────
def test_additive_migration_from_bare_table(tmp_path, monkeypatch):
    p = tmp_path / "old.db"
    with sqlite3.connect(str(p)) as c:   # a pre-existing DB with ONLY the id column
        c.execute("CREATE TABLE ai_search_log (id INTEGER PRIMARY KEY AUTOINCREMENT)")
        c.commit()
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(p))
    monkeypatch.setenv("AI_SEARCH_LOG_ENABLED", "1")
    ail._reset_for_tests()
    ail.log(user_id="u1", query="migrated ok", answer="a")   # init must ALTER-add every column
    rows = _rows(p)
    assert len(rows) == 1 and rows[0]["query"] == "migrated ok" and "freshness" in rows[0]
