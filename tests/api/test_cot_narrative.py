# tests/api/test_cot_narrative.py
"""`api/services/cot_narrative.py` + `POST /api/cot/{symbol}/narrative`.

The model is a FAKE installed on `api.services.engine._get_anthropic_client`
(the service resolves that name through the module at call time, so the patch
lands). Every test that drives the service records the exact kwargs the fake
saw, so "no second model call" and "the retry names the offending token" are
measured, not inferred.

The DB goes through `COT_DB_PATH` -> tmp (the root conftest TRIPWIRE fails the
run on any write under `/data`, which is `C:\\data` on this box).
"""
from __future__ import annotations

import importlib
import sqlite3
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api.services import cot_narrative as cn
# Every request in this module is made by a PAID member: the route is
# `require_paid`; the gate itself is owned by tests/test_exposed_routes_gated.py.
from tests.authclients import as_a_paid_member  # noqa: F401  (autouse fixture)

SYMBOL, NAME, REPORT_DATE = "GC", "Gold", "2026-08-18"

FACTS = {
    "lookback_years": 3,
    "report_date": REPORT_DATE,
    "groups": {
        "commercials": {"net": -113553, "index": 12.4, "zone": "extreme short", "streak_weeks": 6},
        "large_specs": {"net": 98210, "index": 91.0, "zone": "crowded long"},
        "small_specs": {"net": 15343, "index": 64.2, "zone": "neutral"},
    },
    "open_interest": 2501120,
    "bias": "contrarian bearish",
    "precedents": {"count": 4, "avg_fwd_8w_pct": -3.1},
}

# Every number here is in FACTS (or derivable: 114K is 113553 in thousands).
GROUNDED = (
    "Commercials, the producers and merchants who hedge physical metal, are carrying "
    "a net short of roughly 114K contracts, and on the 3-year scale that sits near the "
    "bottom of their range at a COT Index reading of 12.4, which is about as stretched "
    "as hedgers get. They have been leaning harder into that short for 6 straight weeks. "
    "Large speculators, the trend-following funds, sit on the other side with a crowded "
    "long near the top of their range, and small speculators, the retail crowd, are "
    "closer to neutral. That is the classic contrarian picture: the people who know the "
    "physical market best are selling into strength while the trend money is all in.\n\n"
    "The 4 prior times this setup showed up, price was lower on average 8 weeks later, "
    "by about 3.1 percent, though that is a tendency and not a promise. Nothing here says "
    "the top is in; crowded longs can stay crowded for a while. What I would watch this "
    "week is whether the funds start trimming that long while the hedgers hold their "
    "short, because that is usually when the tension resolves."
)
# Same prose with ONE invented number.
UNGROUNDED = GROUNDED.replace("about as stretched as hedgers get",
                              "about 87% of the way to as stretched as hedgers get")
TOO_SHORT = "Hedgers are short and the funds are long. Watch the open."


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def db(tmp_path, monkeypatch):
    """COT DB -> tmp, narrative env cleared, service reloaded, tables created."""
    path = tmp_path / "cot_test.db"
    monkeypatch.setenv("COT_DB_PATH", str(path))
    for var in (cn.ENABLED_ENV, cn.MODEL_ENV, cn.CAP_ENV):
        monkeypatch.delenv(var, raising=False)
    import api.services.cot_service as svc
    importlib.reload(svc)
    svc.init_db()
    # The service holds the MODULE, which reload updates in place — prove it.
    assert cn.cot_service.DB_PATH == str(path)
    return path


@pytest.fixture
def client(db):
    from api.main import app
    return TestClient(app)


class _FakeMessages:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if not self.replies:
            raise AssertionError("the model was called more times than the test scripted")
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=reply)], stop_reason="end_turn")


class _FakeClient:
    def __init__(self, replies):
        self.messages = _FakeMessages(replies)


@pytest.fixture
def fake_model(monkeypatch):
    """`fake_model(*replies)` installs a fake Anthropic client whose successive
    `messages.create` calls return the scripted replies (an Exception raises)."""
    def _install(*replies):
        fake = _FakeClient(replies)
        monkeypatch.setattr("api.services.engine._get_anthropic_client", lambda: fake)
        return fake
    return _install


def _rows(db):
    with sqlite3.connect(db) as conn:
        return conn.execute(
            "SELECT symbol, report_date, facts_hash, text, model, created_at "
            "FROM cot_narratives").fetchall()


def _allowed():
    return cn._allowed_numbers(FACTS, NAME, REPORT_DATE, SYMBOL)


# ── controls: the fixtures themselves ─────────────────────────────────────────

def test_CONTROL_the_grounded_fixture_passes_the_gate_and_the_ungrounded_one_fails():
    """A gate that every reply passes proves nothing. The clean fixture passes;
    the same prose with one invented number names exactly that number."""
    assert cn.MIN_WORDS <= cn._word_count(GROUNDED) <= cn.MAX_WORDS
    assert cn._validate(GROUNDED, _allowed()) == (None, [])
    assert cn._validate(UNGROUNDED, _allowed()) == ("ungrounded", ["87%"])
    assert cn._validate(TOO_SHORT, _allowed())[0] == "length"


@pytest.mark.parametrize("token, expected", [
    ("113,553", "113553"), ("-12.50%", "12.5"), ("$2,500", "2500"), ("08", "8"),
    ("+3.0", "3"), ("91.0", "91"), ("−6", "6"), ("not-a-number", None),
])
def test_normalise(token, expected):
    assert cn._normalise(token) == expected


def test_allowed_numbers_carry_the_derived_forms():
    allowed = _allowed()
    # literal, thousands (113.6 / 114 == "114K"), integer rounding, date parts, name
    for n in ("113553", "113.6", "114", "12.4", "12", "91", "64.2", "64",
              "2026", "8", "18", "3", "4", "3.1", "6", "2501120", "2.5"):
        assert n in allowed, n
    assert "87" not in allowed
    # a ratio may be spoken as a percent; bools are not numbers
    assert "62" in cn._allowed_numbers({"share": 0.62, "flag": True})
    assert "1" not in cn._allowed_numbers({"flag": True})


# ── 1. generate, store, cache ─────────────────────────────────────────────────

def test_generates_stores_and_the_second_identical_call_is_served_from_cache(db, fake_model):
    fake = fake_model(GROUNDED)
    first = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert first["status"] == "ok"
    assert first["cached"] is False
    assert first["text"] == GROUNDED
    assert first["model"] == cn.DEFAULT_MODEL
    assert first["created_at"]
    assert len(fake.messages.calls) == 1

    rows = _rows(db)
    assert len(rows) == 1
    assert rows[0][0] == SYMBOL and rows[0][1] == REPORT_DATE
    assert rows[0][2] == cn.facts_hash(SYMBOL, REPORT_DATE, FACTS)

    second = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert second["status"] == "ok"
    assert second["cached"] is True
    assert second["text"] == GROUNDED
    assert second["created_at"] == first["created_at"]
    assert len(fake.messages.calls) == 1, "a cache hit must not call the model"


def test_get_cached_returns_none_for_an_unknown_hash(db):
    assert cn.get_cached(SYMBOL, REPORT_DATE, "0" * 40) is None


# ── 2. hashing ────────────────────────────────────────────────────────────────

def test_facts_hash_is_key_order_independent_and_sensitive_to_content():
    reordered = {k: FACTS[k] for k in reversed(list(FACTS))}
    assert cn.facts_hash(SYMBOL, REPORT_DATE, FACTS) == cn.facts_hash("gc", REPORT_DATE, reordered)
    changed = {**FACTS, "bias": "neutral"}
    assert cn.facts_hash(SYMBOL, REPORT_DATE, FACTS) != cn.facts_hash(SYMBOL, REPORT_DATE, changed)
    assert cn.facts_hash(SYMBOL, REPORT_DATE, FACTS) != cn.facts_hash(SYMBOL, "2026-08-25", FACTS)
    assert cn.facts_hash(SYMBOL, REPORT_DATE, FACTS) != cn.facts_hash("SI", REPORT_DATE, FACTS)


def test_different_facts_make_a_new_generation(db, fake_model):
    fake = fake_model(GROUNDED, GROUNDED)
    cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, {**FACTS, "bias": "neutral"})
    assert out["status"] == "ok" and out["cached"] is False
    assert len(fake.messages.calls) == 2
    assert len({r[2] for r in _rows(db)}) == 2


# ── 3. disabled ───────────────────────────────────────────────────────────────

def test_disabled_by_env_returns_disabled_without_touching_the_model(db, fake_model, monkeypatch):
    fake = fake_model(GROUNDED)
    monkeypatch.setenv(cn.ENABLED_ENV, "0")
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert out["status"] == "disabled"
    assert out["text"] is None and out["cached"] is False
    assert fake.messages.calls == []
    assert _rows(db) == []


# ── 4. daily cap ──────────────────────────────────────────────────────────────

def test_daily_cap_stops_the_second_distinct_generation(db, fake_model, monkeypatch):
    fake = fake_model(GROUNDED, GROUNDED)
    monkeypatch.setenv(cn.CAP_ENV, "1")
    assert cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)["status"] == "ok"
    out = cn.get_or_create("SI", "Silver", REPORT_DATE, FACTS)
    assert out["status"] == "capped"
    assert out["text"] is None
    assert "1" in out["reason"]
    assert len(fake.messages.calls) == 1
    assert len(_rows(db)) == 1
    # A cache hit is served even under the cap — the cache is checked first.
    again = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert again["status"] == "ok" and again["cached"] is True
    assert len(fake.messages.calls) == 1


def test_daily_cap_counts_only_rows_created_today_utc(db, fake_model, monkeypatch):
    monkeypatch.setenv(cn.CAP_ENV, "1")
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO cot_narratives (symbol, report_date, facts_hash, text, model, created_at) "
            "VALUES ('SI', '2026-08-11', 'oldhash', 'old text', 'm', '2000-01-01T09:00:00+00:00')")
    fake = fake_model(GROUNDED)
    assert cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)["status"] == "ok"
    assert len(fake.messages.calls) == 1


# ── 5. grounding ──────────────────────────────────────────────────────────────

def test_ungrounded_first_reply_is_retried_with_the_offending_token_named_then_stored(db, fake_model):
    fake = fake_model(UNGROUNDED, GROUNDED)
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert out["status"] == "ok" and out["cached"] is False
    assert out["text"] == GROUNDED
    assert len(fake.messages.calls) == 2
    first_prompt = fake.messages.calls[0]["messages"][0]["content"]
    retry_prompt = fake.messages.calls[1]["messages"][0]["content"]
    assert "87%" not in first_prompt
    assert "87%" in retry_prompt
    assert retry_prompt.startswith(first_prompt), "the retry is the original prompt plus an appended instruction"
    assert len(_rows(db)) == 1 and _rows(db)[0][3] == GROUNDED


def test_a_reply_that_stays_ungrounded_is_an_error_and_nothing_is_stored(db, fake_model):
    fake = fake_model(UNGROUNDED, UNGROUNDED)
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert out["status"] == "error"
    assert out["reason"] == "ungrounded"
    assert out["text"] is None
    assert len(fake.messages.calls) == 2, "exactly one retry"
    assert _rows(db) == []
    # ...and the next call tries again rather than serving a cached failure.
    fake2 = fake_model(GROUNDED)
    assert cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)["status"] == "ok"
    assert len(fake2.messages.calls) == 1


def test_the_grounding_set_includes_the_market_name_and_report_date_numbers(db, fake_model):
    """'10-Year T-Note' puts 10 in play; the report date puts 2026 in play."""
    facts = {"bias": "neutral", "groups": {"commercials": {"index": 40.0}}}
    text = (
        "Commercials, the hedgers who carry the physical exposure, sit close to the "
        "middle of their range on the 10-year note, a reading that says nobody has "
        "been forced to lean hard either way yet, and into 2026 that has mostly meant "
        "chop rather than trend. The trend money has not taken a strong stance either, "
        "so the contrarian read is muted: there is no crowd to fade and no hedger "
        "extreme to lean on, which is a real piece of information in itself.\n\n"
        "When positioning is this balanced the next move usually starts outside the "
        "report, in the data or the auction tape, and then the groups chase it. Keep "
        "it simple and patient here. What I would watch this week is whether the "
        "commercial index starts pushing toward one end of its range, because the "
        "first decisive lean by the hedgers tends to be the tell that matters."
    )
    fake = fake_model(text)
    out = cn.get_or_create("ZN", "10-Year T-Note", "2026-08-18", facts)
    assert out["status"] == "ok", out
    assert len(fake.messages.calls) == 1


# ── 6. length / markdown rejection ────────────────────────────────────────────

def test_too_short_twice_is_an_error_with_reason_length(db, fake_model):
    fake = fake_model(TOO_SHORT, TOO_SHORT)
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert (out["status"], out["reason"]) == ("error", "length")
    assert len(fake.messages.calls) == 2
    assert "wrong length" in fake.messages.calls[1]["messages"][0]["content"]
    assert _rows(db) == []


def test_too_long_is_rejected(db, fake_model):
    padded = GROUNDED + " " + " ".join(["patience"] * (cn.MAX_WORDS + 1))
    fake_model(padded, padded)
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert (out["status"], out["reason"]) == ("error", "length")


@pytest.mark.parametrize("bad", [
    pytest.param("- " + GROUNDED.replace("\n\n", "\n- "), id="bullets"),
    pytest.param(GROUNDED.replace("Commercials", "**Commercials**"), id="bold"),
    pytest.param("## The read\n" + GROUNDED, id="header"),
    pytest.param("<thinking>hmm</thinking>\n" + GROUNDED, id="thinking-tag"),
    pytest.param(GROUNDED + " 🚀", id="emoji"),
])
def test_markdown_or_markup_is_rejected(db, fake_model, bad):
    fake = fake_model(bad, bad)
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert (out["status"], out["reason"]) == ("error", "markdown")
    assert "plain prose only" in fake.messages.calls[1]["messages"][0]["content"]
    assert _rows(db) == []


# ── 7. model exception ────────────────────────────────────────────────────────

def test_a_model_exception_is_an_error_status_not_a_raise(db, fake_model):
    fake_model(RuntimeError("boom"))
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert out["status"] == "error"
    assert "RuntimeError" in out["reason"]
    assert out["model"] == cn.DEFAULT_MODEL
    assert _rows(db) == []


def test_the_route_returns_200_with_status_error_when_the_model_fails(client, fake_model):
    fake_model(RuntimeError("boom"))
    resp = client.post(f"/api/cot/{SYMBOL}/narrative",
                       json={"report_date": REPORT_DATE, "name": NAME, "facts": FACTS})
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"


# ── the call shape ────────────────────────────────────────────────────────────

def test_the_model_call_shape_is_kwarg_minimal_with_thinking_disabled(db, fake_model, monkeypatch):
    """Pinned: no `temperature` (the pod's SDK TypeErrors on it and the Claude 5
    family rejects sampling params), thinking DISABLED (it would eat max_tokens),
    the facts in the user turn, the mentor register in the system turn."""
    fake = fake_model(GROUNDED)
    cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    kw = fake.messages.calls[0]
    assert set(kw) == {"model", "max_tokens", "thinking", "system", "messages"}
    assert kw["model"] == "claude-opus-5"
    assert kw["max_tokens"] == 450
    assert kw["thinking"] == {"type": "disabled"}
    assert "temperature" not in kw
    assert "dashboard" in kw["system"] and "55 of 150" in kw["system"]
    user = kw["messages"][0]["content"]
    assert kw["messages"][0]["role"] == "user"
    assert f"Market: {NAME} ({SYMBOL})" in user and REPORT_DATE in user
    assert "-113553" in user and '"precedents"' in user
    assert "precedents: cite them" in user
    assert "two paragraphs" in user and "NEVER state a number" in user


def test_the_precedent_rule_is_only_sent_when_precedents_are_present(db, fake_model):
    fake = fake_model(GROUNDED)
    facts = {k: v for k, v in FACTS.items() if k != "precedents"}
    cn.get_or_create(SYMBOL, NAME, REPORT_DATE, facts)
    assert "precedents: cite them" not in fake.messages.calls[0]["messages"][0]["content"]


def test_model_env_override_is_used_and_reported(db, fake_model, monkeypatch):
    monkeypatch.setenv(cn.MODEL_ENV, "claude-sonnet-5")
    fake = fake_model(GROUNDED)
    out = cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)
    assert fake.messages.calls[0]["model"] == "claude-sonnet-5"
    assert out["model"] == "claude-sonnet-5"
    assert _rows(db)[0][4] == "claude-sonnet-5"


def test_blank_name_falls_back_to_the_service_symbol_name(db, fake_model):
    fake = fake_model(GROUNDED)
    cn.get_or_create(SYMBOL, "", REPORT_DATE, FACTS)
    assert "Market: Gold (GC)" in fake.messages.calls[0]["messages"][0]["content"]


# ── schema ────────────────────────────────────────────────────────────────────

def test_init_db_creates_the_table_and_the_service_works_on_an_older_db_without_it(db, fake_model):
    with sqlite3.connect(db) as conn:
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "cot_narratives" in names
        conn.execute("DROP TABLE cot_narratives")  # an older db that predates the feature
    fake_model(GROUNDED)
    assert cn.get_or_create(SYMBOL, NAME, REPORT_DATE, FACTS)["status"] == "ok"
    assert len(_rows(db)) == 1


def test_the_two_CREATE_TABLE_copies_agree_on_the_schema(db, tmp_path):
    """`init_db()` and the service's `_ensure_table()` each carry the DDL
    (`init_db` so a fresh db has it at startup; the service so an older db
    gains it). Two copies drift; this is what says when they have."""
    def _cols(path):
        with sqlite3.connect(path) as conn:
            return conn.execute("PRAGMA table_info(cot_narratives)").fetchall()
    from_init_db = _cols(db)
    other = tmp_path / "service_only.db"
    with sqlite3.connect(other):
        pass
    real = cn.cot_service.DB_PATH
    cn.cot_service.DB_PATH = str(other)
    try:
        cn._ensure_table()
    finally:
        cn.cot_service.DB_PATH = real
    assert from_init_db and _cols(other) == from_init_db


# ── 8. the route ──────────────────────────────────────────────────────────────

def test_paid_member_post_returns_the_generated_read(client, db, fake_model):
    fake = fake_model(GROUNDED)
    resp = client.post(f"/api/cot/{SYMBOL.lower()}/narrative",
                       json={"report_date": REPORT_DATE, "name": NAME, "facts": FACTS})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ok" and body["cached"] is False
    assert body["text"] == GROUNDED
    assert set(body) == {"status", "text", "model", "cached", "created_at", "reason"}
    assert len(fake.messages.calls) == 1
    assert _rows(db)[0][0] == SYMBOL  # symbol stored upper-cased


def test_unknown_symbol_is_404(client, fake_model):
    fake = fake_model(GROUNDED)
    resp = client.post("/api/cot/FAKESYMBOL/narrative",
                       json={"report_date": REPORT_DATE, "facts": FACTS})
    assert resp.status_code == 404
    assert fake.messages.calls == []


def test_oversized_facts_are_413(client, fake_model):
    fake = fake_model(GROUNDED)
    big = {**FACTS, "padding": "x" * (cn.MAX_FACTS_BYTES + 1)}
    resp = client.post(f"/api/cot/{SYMBOL}/narrative",
                       json={"report_date": REPORT_DATE, "facts": big})
    assert resp.status_code == 413
    assert str(cn.MAX_FACTS_BYTES) in resp.json()["detail"]
    assert fake.messages.calls == []


@pytest.mark.parametrize("bad_date", ["2026-13-45", "18-08-2026", "2026/08/18", "", "yesterday"])
def test_bad_report_date_is_422(client, fake_model, bad_date):
    fake = fake_model(GROUNDED)
    resp = client.post(f"/api/cot/{SYMBOL}/narrative",
                       json={"report_date": bad_date, "facts": FACTS})
    assert resp.status_code == 422
    assert fake.messages.calls == []


def test_missing_facts_is_422(client):
    resp = client.post(f"/api/cot/{SYMBOL}/narrative", json={"report_date": REPORT_DATE})
    assert resp.status_code == 422
