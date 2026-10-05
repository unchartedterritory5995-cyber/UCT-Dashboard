"""Wave 14, lane W14-E -- the sample notebook's capability examples (`sample_examples.py`).

Each test below answers one question for one capability: with its flag ON, does the seeded
example actually show something on that capability's own surface -- never a second parser,
always the real read function the member's own page calls. A companion test per capability
answers the flag-OFF half: the row exists (seeding never reads a capability's own flag), and
the gated route still answers 404, exactly as it would for a real member's data.

The database is a temp file (`auth_db._DB_PATH`); nothing here reaches `C:\\data`. A real
`users` row is required for U1 (`voice_proactive_insights.user_id REFERENCES users(id)`,
unlike the j2_* family, which has no foreign key at all -- account_purge.py's own docstring).
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db, auth_service
from api.services.journal_two import (
    chart_blocks, note_levels, notes, passed_setups,
    playbook_stats, sample_examples, sample_notebook, setups_board, thesis_chips,
    visual_playbook,
)

U1 = "u-w14e-1"
U2 = "u-w14e-2"


@pytest.fixture
def db(monkeypatch, tmp_path):
    path = str(tmp_path / "sample.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    auth_db.init_db()
    c = auth_db.get_connection()
    try:
        for uid in (U1, U2):
            c.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
                     " VALUES (?, ?, 'x', 'x', 'member')", (uid, f"{uid}@example.test"))
        c.commit()
    finally:
        c.close()
    return path


def _conn():
    return auth_db.get_connection()


@pytest.fixture
def seeded(db):
    out = sample_notebook.seed(U1)
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    return out, pref["examples"]


# ── the trade plan example (chart plan + TA fingerprint): UNTRADED, no entry context ───────
# Wave 14 integration round 2: no example trade is seeded (a member's P&L and stats read
# `j2_trades` with no sample filter). The per-consumer exclusion rails live in
# tests/test_sample_notebook_trade_exclusion.py.

def _count(c, table, user_id):
    exists = c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
    if not exists:
        return 0
    return c.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user_id,)).fetchone()[0]


def test_the_plan_example_is_an_untraded_plan_and_no_trade_is_seeded(db, seeded):
    out, examples = seeded
    assert examples["errors"] == {}
    assert examples["tradeId"] is None and examples["entryContext"] is None
    c = _conn()
    try:
        assert _count(c, "j2_trades", U1) == 0
        assert _count(c, "j2_positions", U1) == 0
        row = c.execute("SELECT title, body_json FROM j2_notes WHERE user_id = ? AND title LIKE ?",
                        (U1, f"Trade plan: example -- {sample_examples.SYM_PLAN}%")).fetchone()
    finally:
        c.close()
    assert row is not None
    embeds = [n for n in json.loads(row["body_json"])["content"] if n.get("type") == "widgetEmbed"]
    assert len(embeds) == 1
    assert "tradeRef" not in embeds[0]["attrs"]
    assert {a["role"] for a in embeds[0]["attrs"]["annotations"]} == {"entry", "stop", "target"}


def test_no_entry_context_is_seeded(db, seeded):
    """Keyed by (member, symbol, day): a sample row would be read by -- and block the freeze
    of -- a real trade on the same symbol and day."""
    c = _conn()
    try:
        assert _count(c, "j2_entry_context", U1) == 0
    finally:
        c.close()


def test_the_fingerprint_travels_with_the_note_no_live_compute(db, seeded, monkeypatch):
    out, examples = seeded
    # If anything here called tech_fingerprint.compute, this would raise -- the panel must
    # read the note's OWN frozen `ta.fingerprint`, never recompute it.
    from api.services.journal_two import tech_fingerprint
    monkeypatch.setattr(tech_fingerprint, "compute",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("live compute called")))
    blocks = chart_blocks.list_blocks(U1, symbol=sample_examples.SYM_PLAN)
    assert len(blocks) == 1
    block = blocks[0]
    assert block["fingerprintSource"] == "note"
    assert block["fingerprint"]["fields"]["rs_rank"]["value"] == 92
    assert block["values"]["adr_pct"] == 3.2


# ── active setups board (13J) ────────────────────────────────────────────────────────────

def test_the_setups_board_shows_the_untraded_example(db, seeded):
    c = _conn()
    try:
        board = setups_board.build_cards(c, U1)
    finally:
        c.close()
    cards = {card["symbol"]: card for card in board["cards"]}
    assert sample_examples.SYM_SETUP in cards
    card = cards[sample_examples.SYM_SETUP]
    assert card["entry"] == 410.0 and card["stop"] == 395.0
    # The trade-plan example is untraded too (no sample trade is seeded), so the board
    # truthfully lists it as well: a drawn entry and stop with no linked trade IS an active
    # setup. Before round 2 a seeded trade had consumed it.
    assert sample_examples.SYM_PLAN in cards
    assert cards[sample_examples.SYM_PLAN]["entry"] == 180.0
    assert cards[sample_examples.SYM_PLAN]["stop"] == 170.0


# ── thesis chips (13G-2) + resurfacing (13D) ────────────────────────────────────────────

def test_thesis_chip_shows_status_and_stop(db, seeded):
    c = _conn()
    try:
        chips = thesis_chips.batch_chips(c, U1, [sample_examples.SYM_THESIS])
    finally:
        c.close()
    chip = chips[sample_examples.SYM_THESIS]
    assert chip["thesisStatus"] == "active"
    assert chip["stop"] == 110.0


def test_resurfacing_fired_once_and_is_in_the_voice_inbox(db, seeded):
    out, examples = seeded
    from api.services import voice_proactive_service
    c = _conn()
    try:
        fired = c.execute(
            "SELECT kind, note_id FROM j2_note_resurface_fires WHERE user_id = ? AND fire_key = ?",
            (U1, sample_examples.RESURFACE_FIRE_KEY)).fetchone()
    finally:
        c.close()
    assert fired is not None
    assert fired["kind"] == sample_examples.RESURFACE_KIND
    pending = voice_proactive_service.list_pending_insights(U1, limit=10)
    assert any(p["id"] == examples["insightId"] for p in pending)
    assert any("NVDA" in (p["headline"] or "") for p in pending)


# ── passed setups (13G-1 G3) ─────────────────────────────────────────────────────────────

def test_passed_setup_shows_up_and_is_not_traded(db, seeded):
    passed = passed_setups.list_items(U1)
    syms = {it["symbol"] for it in passed["items"]}
    assert sample_examples.SYM_PASSED in syms
    assert passed["tradedCount"] == 0


# ── earnings prep (13C) ──────────────────────────────────────────────────────────────────

def test_earnings_prep_note_is_tagged_and_static(db, seeded):
    c = _conn()
    try:
        row = c.execute("SELECT title, tags, ticker FROM j2_notes WHERE user_id = ?"
                        " AND ticker = ?", (U1, sample_examples.SYM_EARNINGS)).fetchone()
    finally:
        c.close()
    assert row is not None
    assert json.loads(row["tags"]) == [sample_examples.EARNINGS_PREP_TAG]
    assert "example" in row["title"].lower() or "Example" in row["title"]


# ── transcript capture (13G-1 G1) ────────────────────────────────────────────────────────

def test_transcript_excerpt_is_cited_in_the_note(db, seeded):
    c = _conn()
    try:
        excerpt = c.execute("SELECT captured_text, document_id FROM j2_note_excerpts WHERE user_id = ?",
                            (U1,)).fetchone()
        assert excerpt is not None
        note = c.execute("SELECT body_json FROM j2_notes WHERE user_id = ? AND ticker = ?",
                         (U1, sample_examples.SYM_TRANSCRIPT)).fetchone()
        doc = c.execute("SELECT name, attachment_url FROM j2_note_documents WHERE id = ?",
                        (excerpt["document_id"],)).fetchone()
    finally:
        c.close()
    body = json.loads(note["body_json"])
    types = {n.get("type") for n in body["content"]}
    assert "documentExcerpt" in types
    assert doc["attachment_url"].startswith("sample:")
    assert "EXAMPLE" in doc["name"]


# ── My Playbook (13B) + Visual Playbook (13I-2) + Reviews (13F): fully derived ────────────

def test_my_playbook_stats_never_count_the_sample(db, seeded):
    """My Playbook's numbers are TRADE stats; the sample adds no trade, so it adds nothing
    here. (It used to show the sample trade as n=1 -- exactly the contamination ruled out.)"""
    c = _conn()
    try:
        stats = playbook_stats.get_playbook_stats(U1, conn=c)
    finally:
        c.close()
    assert stats == []


def test_visual_playbook_shows_the_examples_charts_by_setup(db, seeded):
    c = _conn()
    try:
        grid = visual_playbook.cards(U1, conn=c)
    finally:
        c.close()
    tags = {c2["setupTag"] for c2 in grid["cards"]}
    assert "Classic Flag/Pullback" in tags and "Flat Base Breakout" in tags


# ── removal: every surface above goes back to showing nothing ───────────────────────────

def test_removal_clears_every_capability_surface(db, seeded):
    out, examples = seeded
    sample_notebook.remove(U1)
    c = _conn()
    try:
        assert setups_board.build_cards(c, U1)["cards"] == []
        assert thesis_chips.batch_chips(c, U1, [sample_examples.SYM_THESIS]) == {}
        assert chart_blocks.list_blocks(U1, conn=c) == []
        assert _count(c, "j2_trades", U1) == 0
        stats = playbook_stats.get_playbook_stats(U1, conn=c)
        assert stats == []
    finally:
        c.close()
    passed = passed_setups.list_items(U1)
    assert passed["items"] == [] and passed["tradedCount"] == 0
    from api.services import voice_proactive_service
    assert voice_proactive_service.list_pending_insights(U1, limit=10) == []


# ── flag-off harmlessness: the data exists; the gated surface does not ──────────────────

def test_flag_off_routes_answer_404_even_though_the_example_exists(db, seeded, monkeypatch):
    out, examples = seeded
    for env in ("NOTEBOOK_PLAN_GRADING_ENABLED", "NOTEBOOK_ENTRY_CONTEXT_ENABLED",
               "NOTEBOOK_TA_FINGERPRINT_ENABLED", "NOTEBOOK_SETUPS_BOARD_ENABLED",
               "NOTEBOOK_THESIS_CHIPS_ENABLED", "NOTEBOOK_PASSED_SETUPS_ENABLED"):
        monkeypatch.delenv(env, raising=False)

    from api.routers import (
        notebook_entry_context, notebook_fingerprint, notebook_plan_grades,
        notebook_setups_board, notebook_thesis_chips,
    )
    from api.routers import notebook_research_capture
    from api.middleware.auth_middleware import get_current_user

    fa = FastAPI()
    for router in (notebook_plan_grades.router, notebook_entry_context.router,
                  notebook_fingerprint.router, notebook_setups_board.router,
                  notebook_thesis_chips.router, notebook_research_capture.passed_router):
        fa.include_router(router)
    fa.dependency_overrides[get_current_user] = lambda: {"id": U1, "role": "admin"}
    client = TestClient(fa)

    assert client.get("/api/j2/plan-grades/trades/any-trade-id").status_code == 404
    assert client.get("/api/j2/setups-board").status_code == 404
    r = client.post("/api/j2/thesis-chips", json={"symbols": [sample_examples.SYM_THESIS]})
    assert r.status_code == 404
    assert client.get("/api/j2/research-capture/passed-setups").status_code == 404

    # the underlying data is untouched by the flags being off -- it is the SURFACE that is
    # dark, never the row.
    c = _conn()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_passed_setups WHERE user_id = ?",
                         (U1,)).fetchone()[0] == 1
    finally:
        c.close()


# ── one member's sample never touches another's data ─────────────────────────────────────

def test_a_members_examples_never_touch_another_members(db, seeded):
    """The same cross-member isolation the base five already have (`sample_notebook.py`'s
    own test), extended to every table a capability example writes."""
    out, examples = seeded
    out2 = sample_notebook.seed(U2)
    pref2 = json.loads(auth_service.get_user_preferences(U2)[sample_notebook.PREF_KEY])
    examples2 = pref2["examples"]
    assert examples["tradeId"] is None and examples2["tradeId"] is None
    assert examples["passedSetupId"] != examples2["passedSetupId"]
    assert examples["insightId"] != examples2["insightId"]

    sample_notebook.remove(U1)
    c = _conn()
    try:
        # U2's rows are untouched by U1's removal.
        assert c.execute("SELECT COUNT(*) FROM j2_passed_setups WHERE user_id = ? AND dismissed_at IS NULL",
                         (U2,)).fetchone()[0] == 1
        board2 = setups_board.build_cards(c, U2)
        assert sample_examples.SYM_SETUP in {card["symbol"] for card in board2["cards"]}
        # U1's are gone.
        assert c.execute("SELECT COUNT(*) FROM j2_passed_setups WHERE user_id = ? AND dismissed_at IS NULL",
                         (U1,)).fetchone()[0] == 0
    finally:
        c.close()


# ── idempotent re-add: a second click while the sample is live changes nothing ──────────

def test_a_second_seed_while_the_sample_is_live_is_refused_and_writes_nothing_new(db, seeded):
    out, examples = seeded
    with pytest.raises(sample_notebook.SampleRefused):
        sample_notebook.seed(U1)
    c = _conn()
    try:
        assert _count(c, "j2_trades", U1) == 0
        assert c.execute("SELECT COUNT(*) FROM j2_passed_setups WHERE user_id = ?",
                         (U1,)).fetchone()[0] == 1
        assert c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (U1,)).fetchone()[0] == 10
    finally:
        c.close()
    # the preference is unchanged -- still naming the FIRST seed's passed setup and insight.
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    assert pref["examples"]["passedSetupId"] == examples["passedSetupId"]
    assert pref["examples"]["insightId"] == examples["insightId"]
