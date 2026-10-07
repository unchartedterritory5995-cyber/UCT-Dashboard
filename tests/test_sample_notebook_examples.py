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
    # W14-C1 ruling: the per-capability examples exist only while the wave-14 switch is on
    # (sample_notebook.seed; tests/test_sample_notebook_switch.py proves both states)
    monkeypatch.setenv("NOTEBOOK_ONBOARDING_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_GETTING_STARTED_ENABLED", "1")
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

def test_the_example_thesis_is_indexed_but_puts_no_chip_on_a_real_row(db, seeded):
    """fin-data I3: the example's status and stop are in the note and its level index, and
    the chip surface (a member's REAL position or watchlist row) never reads them. The
    control -- the member's own note with the same words does chip -- is in
    tests/test_sample_never_feeds_real_numbers.py."""
    c = _conn()
    try:
        assert thesis_chips.batch_chips(c, U1, [sample_examples.SYM_THESIS]) == {}
        stop = c.execute("SELECT price FROM j2_note_levels WHERE user_id = ? AND symbol = ? AND role = 'stop'",
                         (U1, sample_examples.SYM_THESIS)).fetchone()
        props = c.execute("SELECT properties_json FROM j2_notes WHERE user_id = ? AND ticker = ?",
                          (U1, sample_examples.SYM_THESIS)).fetchone()[0]
    finally:
        c.close()
    assert stop is not None and stop[0] == 110.0
    assert json.loads(props)["builtin:thesis_status"] == "active"


# ⛔⛔ THE EXAMPLE NOTICE NEVER COMPETES WITH A REAL ALERT (wave 14 docs lane). The first
# version queued a real insight at importance 8 -- above every real resurfacing (<= 7) -- which
# led the Compass inbox, was mirrored into the Compass chat thread, opened the next voice
# session, spent a resurfacing slot and put NVDA on cooldown. The notice now lives ONLY in the
# thesis note, as a callout labelled as an example. Each test below fails on the old seed.

def _walk(node):
    if isinstance(node, dict):
        yield node
        for c in node.get("content") or []:
            yield from _walk(c)


def _thesis_note(c, user_id):
    return c.execute("SELECT id, body_json, import_source FROM j2_notes WHERE user_id = ? AND title LIKE ?",
                     (user_id, f"Thesis: example -- {sample_examples.SYM_THESIS}%")).fetchone()


def test_seeding_queues_no_insight_at_all(db, monkeypatch):
    """The ONE insight door is never knocked on -- so nothing reaches the inbox, the Compass
    chat mirror (which a dismissal cannot undo) or a voice session's opener."""
    from api.services import voice_proactive_service
    calls = []
    real = voice_proactive_service.add_insight
    monkeypatch.setattr(voice_proactive_service, "add_insight",
                        lambda *a, **k: calls.append((a, k)) or real(*a, **k))
    sample_notebook.seed(U1)
    assert calls == []
    assert voice_proactive_service.list_pending_insights(U1, limit=20) == []
    assert voice_proactive_service.list_history(U1, limit=50) == []
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    assert pref["examples"]["insightId"] is None
    assert pref["examples"]["errors"] == {}
    c = _conn()
    try:
        assert _count(c, "voice_proactive_insights", U1) == 0
        assert _count(c, "j2_note_resurface_fires", U1) == 0     # no ledger row -> no review-draft line
    finally:
        c.close()


def test_the_example_notice_is_shown_in_the_thesis_note_and_labelled(db, seeded):
    c = _conn()
    try:
        row = _thesis_note(c, U1)
    finally:
        c.close()
    callouts = [n for n in _walk(json.loads(row["body_json"])) if n.get("type") == "callout"]
    assert len(callouts) == 1
    text = " ".join(n.get("text", "") for n in _walk(callouts[0]) if n.get("type") == "text")
    assert text.startswith("Example: ")
    assert sample_examples.RESURFACE_HEADLINE in text and "not a live alert" in text


def test_the_sample_leaves_the_real_resurfacing_budget_untouched(db, seeded):
    """A REAL NVDA stop touch right after seeding is queued, and so is a second resurfacing
    the same day -- the old seed's insight put NVDA on a 6-hour per-kind cooldown and spent
    one of the two resurfacing slots a day."""
    from api.services import voice_proactive_service
    first = voice_proactive_service.add_insight(
        U1, kind="note_level_touch", symbol=sample_examples.SYM_THESIS,
        headline="NVDA reached 120.00, the stop you named", importance=7)
    second = voice_proactive_service.add_insight(
        U1, kind="note_big_move", symbol="AMD", headline="AMD is up 9.0% today", importance=6)
    assert first is not None and second is not None


def test_a_sample_note_is_never_read_by_the_resurfacing_scan(db, seeded):
    """The sample's stop is in the level index (its own note page shows it), but the scan
    (`load_index`) skips a sample note -- so an NVDA move can never resurface the example. A
    member's OWN note naming the same stop is still scanned (the control)."""
    own = notes.import_confirm(U1, {"source": "file", "notes": [{
        "importKey": "own:nvda", "title": "My NVDA thesis", "tags": [], "folderPath": [],
        "ticker": sample_examples.SYM_THESIS,
        "bodyJson": sample_examples._thesis_note_body(sample_examples.SYM_THESIS, 110.0),
    }]})["created"][0]["id"]
    c = _conn()
    try:
        thesis_id = _thesis_note(c, U1)["id"]
        assert c.execute("SELECT COUNT(*) FROM j2_note_levels WHERE user_id = ? AND note_id = ?",
                         (U1, thesis_id)).fetchone()[0] >= 1      # indexed
        own_row = c.execute("SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes"
                            " WHERE id = ?", (own,)).fetchone()
        note_levels.project_note(c, U1, own_row)
        c.commit()
        scanned = {r["note_id"] for r in note_levels.load_index(c).get(U1, [])}
    finally:
        c.close()
    assert thesis_id not in scanned
    assert own in scanned


def test_remove_still_clears_an_insight_recorded_by_the_earlier_version(db, seeded):
    """A preference written by the first version names an `insightId`; Remove dismisses it."""
    from api.services import voice_proactive_service
    legacy = voice_proactive_service.add_insight(
        U1, kind="note_level_touch", symbol=sample_examples.SYM_THESIS,
        headline="Example: NVDA reached 110.00, the stop you wrote about", importance=8)
    assert legacy is not None
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    pref["examples"]["insightId"] = legacy
    auth_service.set_user_preference(U1, sample_notebook.PREF_KEY, json.dumps(pref))
    out = sample_notebook.remove(U1)
    assert out["examplesRemoved"]["insightDismissed"] is True
    assert voice_proactive_service.list_pending_insights(U1, limit=10) == []


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
    assert examples["insightId"] is None and examples2["insightId"] is None

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
    # the preference is unchanged -- still naming the FIRST seed's passed setup.
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    assert pref["examples"]["passedSetupId"] == examples["passedSetupId"]
    assert pref["examples"]["insightId"] is None


# ── fin-data I4: "Remove sample" only ever removes rows the sample created ──────────────────
#
# `passed_setups.add_manual` answers an EXISTING row when the member already has that name on
# that day (and un-dismisses it). The sample recorded whatever id came back, so for a member
# who had already passed on GOOGL that day, "Remove it" dismissed the member's own row.

def _saved_on():
    return (sample_examples._et_today() - __import__("datetime").timedelta(days=20)).isoformat()


def _passed_rows(user):
    c = _conn()
    try:
        passed_setups.ensure_schema(c)
        return [dict(r) for r in c.execute(
            "SELECT id, symbol, source, dismissed_at FROM j2_passed_setups WHERE user_id = ?"
            " ORDER BY created_at, id", (user,)).fetchall()]
    finally:
        c.close()


def test_the_samples_passed_setup_is_marked_as_the_samples_own(db, seeded):
    rows = _passed_rows(U1)
    assert [(r["symbol"], r["source"]) for r in rows] == [(sample_examples.SYM_PASSED, passed_setups.SOURCE_SAMPLE)]
    item = passed_setups.list_items(U1)["items"][0]
    assert item["source"] == passed_setups.SOURCE_SAMPLE


def test_remove_never_dismisses_a_pass_the_member_already_had(db):
    """The member passed on GOOGL that same day BEFORE adding the sample."""
    mine = passed_setups.add_manual(U1, sample_examples.SYM_PASSED, _saved_on())["item"]
    assert mine["source"] == "manual"

    sample_notebook.seed(U1)
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    assert pref["examples"]["passedSetupId"] is None, "the sample recorded a row it did not create"
    assert [r["id"] for r in _passed_rows(U1)] == [mine["id"]], "the sample added a second row"

    sample_notebook.remove(U1)

    rows = _passed_rows(U1)
    assert [(r["id"], r["source"], r["dismissed_at"]) for r in rows] == [(mine["id"], "manual", None)]
    assert [it["id"] for it in passed_setups.list_items(U1)["items"]] == [mine["id"]]


def test_the_sample_never_brings_back_a_pass_the_member_had_dismissed(db):
    mine = passed_setups.add_manual(U1, sample_examples.SYM_PASSED, _saved_on())["item"]
    assert passed_setups.dismiss(U1, mine["id"]) is True
    sample_notebook.seed(U1)
    rows = _passed_rows(U1)
    assert len(rows) == 1 and rows[0]["dismissed_at"] is not None, "seeding un-dismissed the member's row"
    assert passed_setups.list_items(U1)["items"] == []


def test_remove_ignores_an_id_in_the_preference_that_is_not_a_sample_row(db, seeded):
    """The preference is client-writable. Naming the member's own row there must do nothing."""
    mine = passed_setups.add_manual(U1, "AMD")["item"]
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    pref["examples"]["passedSetupId"] = mine["id"]
    auth_service.set_user_preference(U1, sample_notebook.PREF_KEY, json.dumps(pref))

    sample_notebook.remove(U1)

    by_symbol = {r["symbol"]: r for r in _passed_rows(U1)}
    assert by_symbol["AMD"]["dismissed_at"] is None, "Remove dismissed a row the sample did not create"
    assert by_symbol[sample_examples.SYM_PASSED]["dismissed_at"] is not None, "the sample's own row was left"


def test_remove_finds_the_samples_row_even_when_the_preference_never_recorded_it(db, seeded):
    """The row is found by its own marker, so a seed that died before recording it leaves nothing behind."""
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    pref["examples"]["passedSetupId"] = None
    auth_service.set_user_preference(U1, sample_notebook.PREF_KEY, json.dumps(pref))
    sample_notebook.remove(U1)
    assert all(r["dismissed_at"] is not None for r in _passed_rows(U1))
    assert passed_setups.list_items(U1)["items"] == []


def test_a_member_cannot_add_a_pass_marked_as_the_samples(db):
    assert passed_setups.add_manual(U1, "AMD")["item"]["source"] == "manual"
    import inspect
    assert "source" not in inspect.signature(passed_setups.add_manual).parameters


def test_the_samples_row_never_stands_in_for_the_members_own_pass(db, seeded):
    """After seeding, the member passes on the same name on the same day: they get THEIR row,
    not the sample's handed back, and theirs survives the removal."""
    mine = passed_setups.add_manual(U1, sample_examples.SYM_PASSED, _saved_on())
    assert mine["deduped"] is False and mine["item"]["source"] == "manual"
    assert {r["source"] for r in _passed_rows(U1)} == {"manual", passed_setups.SOURCE_SAMPLE}
    sample_notebook.remove(U1)
    assert [(it["id"], it["source"]) for it in passed_setups.list_items(U1)["items"]] == [(mine["item"]["id"], "manual")]
    # And asking again answers the member's own row, never the dismissed sample one.
    again = passed_setups.add_manual(U1, sample_examples.SYM_PASSED, _saved_on())
    assert again["deduped"] is True and again["item"]["id"] == mine["item"]["id"]
    assert sum(1 for r in _passed_rows(U1) if r["dismissed_at"] is None) == 1


def test_the_samples_row_never_blocks_a_save_the_member_made_from_a_watchlist(db, seeded, monkeypatch):
    import datetime as dt
    day = dt.date.fromisoformat(_saved_on())
    saved_at = dt.datetime(day.year, day.month, day.day, 15, 0, tzinfo=dt.timezone.utc)
    monkeypatch.setattr(passed_setups, "_watchlist_candidates", lambda conn, user, since: [
        {"symbol": sample_examples.SYM_PASSED, "saved_at": saved_at, "source": "watchlist", "source_ref": "Mine"}])
    monkeypatch.setattr(passed_setups, "_scanner_candidates", lambda conn, user, since: [])
    c = _conn()
    try:
        assert passed_setups.collect(c, U1) == 1
    finally:
        c.close()
    assert {r["source"] for r in _passed_rows(U1)} == {"watchlist", passed_setups.SOURCE_SAMPLE}


# ── every example is in the shape its own feature's reader and writer use ────────────────────
#
# The sample's chart plan stored each level as `{role, type, price}`: no `id`, no `points`.
# That is not what the product writes when a member draws a plan (`lib/chartPlan.js`
# `withPlanRole`: the line's anchor `points[0].price` IS the level, and no `price` is kept).
# The server read it all the same, so every test was green -- and in the browser the role
# buttons did nothing, "Arm alert" refused and no line was drawn. The example misrepresented
# the feature it is there to teach. These tests read the example through the feature's OWN
# reader and hold it to the rules the product's own writer applies.

import pathlib  # noqa: E402
import re  # noqa: E402

from api.services.journal_two import chart_plan, plan_extract, tech_fingerprint  # noqa: E402

_REPO = pathlib.Path(__file__).resolve().parents[1]


def _client_role_types():
    """The drawing types the CLIENT lets carry a plan role, read from its own source."""
    src = (_REPO / "app/src/pages/journal-2-0/lib/chartPlan.js").read_text(encoding="utf-8")
    m = re.search(r"PLAN_ROLE_DRAWING_TYPES\s*=\s*Object\.freeze\(\[([^\]]*)\]\)", src)
    assert m, "chartPlan.js no longer declares PLAN_ROLE_DRAWING_TYPES where this test reads it"
    return set(re.findall(r"'([^']+)'", m.group(1)))


def _example_chart(db, title_prefix, embed_id):
    c = _conn()
    try:
        row = c.execute("SELECT body_json FROM j2_notes WHERE user_id = ? AND title LIKE ?",
                        (U1, title_prefix + "%")).fetchone()
    finally:
        c.close()
    attrs = chart_plan.find_chart_block(row["body_json"], embed_id)
    assert attrs is not None, f"no chart block {embed_id!r} in the example note"
    return attrs


def _assert_drawn_shape(levels, wanted_roles, frozen_at):
    assert [a["role"] for a in levels] == wanted_roles
    ids = [a.get("id") for a in levels]
    assert all(isinstance(i, str) and i for i in ids), "a level has no id: the role buttons cannot address it"
    assert len(set(ids)) == len(ids), "two levels share an id: a role set on one lands on both"
    for a in levels:
        assert a["type"] in _client_role_types(), "the client would refuse a plan role on this drawing type"
        assert "price" not in a, ("a top-level price is a second copy of the level: plan_extract reads it "
                                  "FIRST, and the client deletes it whenever a role is set")
        pts = a.get("points")
        assert isinstance(pts, list) and len(pts) == 1 and isinstance(pts[0], dict)
        assert isinstance(pts[0]["price"], float) and pts[0]["price"] > 0     # the alert and the line read this
        assert pts[0]["time"] == frozen_at                                    # anchored where the chart is frozen
        assert plan_extract._annotation_price(a) == pts[0]["price"]


def test_the_plan_examples_levels_are_drawn_levels_and_the_servers_reader_agrees(db, seeded):
    attrs = _example_chart(db, "Trade plan: example", "ex-plan")
    _assert_drawn_shape(attrs["annotations"], ["entry", "stop", "target"], attrs["params"]["to"])
    plan = chart_plan.read_block_plan(attrs, sample_examples.SYM_PLAN)
    assert (plan["entry"], plan["stop"], plan["target"], plan["shares"]) == (180.0, 170.0, 205.0, 100.0)
    assert plan["side"] == "long" and plan["setup"] == "Classic Flag/Pullback"
    assert {r: plan["roles"][r]["state"] for r in ("entry", "stop", "target")} == {
        "entry": plan_extract.STATE_OK, "stop": plan_extract.STATE_OK, "target": plan_extract.STATE_OK}


def test_the_active_setup_examples_levels_are_drawn_levels_too(db, seeded):
    attrs = _example_chart(db, "Active setup: example", "ex-setup")
    _assert_drawn_shape(attrs["annotations"], ["entry", "stop"], attrs["params"]["to"])
    plan = chart_plan.read_block_plan(attrs, sample_examples.SYM_SETUP)
    assert (plan["entry"], plan["stop"], plan["target"]) == (410.0, 395.0, None)
    c = _conn()
    try:
        cards = setups_board.build_cards(c, U1)["cards"]
    finally:
        c.close()
    assert any(card["symbol"] == sample_examples.SYM_SETUP for card in cards)   # still on its board


def test_the_two_examples_never_share_a_level_id(db, seeded):
    a = _example_chart(db, "Trade plan: example", "ex-plan")["annotations"]
    b = _example_chart(db, "Active setup: example", "ex-setup")["annotations"]
    ids = [x["id"] for x in a + b]
    assert len(set(ids)) == len(ids)


def test_the_examples_fingerprint_is_the_shape_the_fingerprint_module_writes(db, seeded):
    """The example's fingerprint is hand-written (it must never call `compute`), so it is held
    to the real module's own field list and version here, where importing it is allowed."""
    fp = _example_chart(db, "Trade plan: example", "ex-plan")["ta"]["fingerprint"]
    assert fp["v"] == tech_fingerprint.FINGERPRINT_VERSION == sample_examples.FINGERPRINT_VERSION
    assert tuple(fp["fields"]) == tuple(tech_fingerprint.FIELDS)
    for name, field in fp["fields"].items():
        assert set(field) >= {"value", "source", "missing"} and field["missing"] is None, name
    assert tech_fingerprint.summary_values(fp)                      # the module's own reader takes it
    block = next(b for b in chart_blocks.list_blocks(U1) if b["embedKey"] == "ex-plan")
    assert block["setupTag"] == "Classic Flag/Pullback" and block["fingerprint"]["fields"]["rs_rank"]["value"] == 92


def test_the_thesis_example_is_read_by_the_plan_reader_as_a_stop_and_nothing_else(db, seeded):
    c = _conn()
    try:
        note = _thesis_note(c, U1)
        row = c.execute("SELECT body_json, properties_json FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()
    finally:
        c.close()
    reading = plan_extract.read_note_plan(row["body_json"], row["properties_json"], [], sample_examples.SYM_THESIS)
    assert reading.value("stop") == 110.0 and reading.value("entry") is None and reading.value("target") is None


# ── round 2: a sample added before the shape fix is read in the drawn shape ──────────────────
#
# Sandboxes and testers already hold a sample whose chart levels are `{role, type, price}`.
# Nobody should have to remove and re-add it. When such a note is READ it is served with its
# levels in the drawn shape, built in memory; the stored body is not touched by a read.

from api.services.journal_two import sample_marker  # noqa: E402


def _old_shape_body(symbol, embed_id, to, **levels):
    body = sample_examples._plan_note_body(symbol, "2026-10-01", "2026-10-01T16:00:00Z", 180.0, 170.0, 205.0,
                                           100.0, "Classic Flag/Pullback",
                                           sample_examples._static_fingerprint(symbol, "2026-10-01"))
    for node in body["content"]:
        if node.get("type") == "widgetEmbed":
            node["attrs"]["embedId"] = embed_id
            node["attrs"]["annotations"] = [{"role": r, "type": "horizontal", "price": p} for r, p in levels.items()]
            node["attrs"]["params"]["to"] = to
    return body


def _import(user, source, key, body):
    out = notes.import_confirm(user, {"source": source, "notes": [{
        "importKey": key, "title": f"old {key}", "tags": [], "folderPath": [], "bodyJson": body}]})
    assert not out["failed"]
    return out["created"][0]["id"]


def _stored(note_id):
    c = _conn()
    try:
        r = c.execute("SELECT body_json, updated_at FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
        return r["body_json"], r["updated_at"]
    finally:
        c.close()


def _levels(note):
    return next(n["attrs"] for n in note["bodyJson"]["content"] if n.get("type") == "widgetEmbed")


def test_an_old_shape_sample_is_served_in_the_drawn_shape_and_the_stored_body_is_untouched(db):
    nid = _import(U1, sample_examples.IMPORT_SOURCE, "sample-example:old-plan",
                  _old_shape_body("AAPL", "ex-plan", 1790000000, entry=180.0, stop=170.0, target=205.0))
    before = _stored(nid)
    assert '"price": 180.0' in before[0] and '"points"' not in before[0]      # the fixture IS the old shape

    served = notes.get_note(U1, nid)
    attrs = _levels(served)
    _assert_drawn_shape(attrs["annotations"], ["entry", "stop", "target"], 1790000000)
    assert [a["id"] for a in attrs["annotations"]] == ["ex-plan-entry", "ex-plan-stop", "ex-plan-target"]
    plan = chart_plan.read_block_plan(attrs, "AAPL")
    assert (plan["entry"], plan["stop"], plan["target"]) == (180.0, 170.0, 205.0)

    notes.get_note(U1, nid)                                                   # read again
    assert _stored(nid) == before, "a read wrote the upgraded body (or moved updated_at)"


def test_the_upgrade_gives_the_same_ids_the_new_seed_writes(db, seeded):
    fresh = _example_chart(db, "Trade plan: example", "ex-plan")["annotations"]
    old = sample_marker.upgrade_sample_levels(
        _old_shape_body("AAPL", "ex-plan", fresh[0]["points"][0]["time"], entry=180.0, stop=170.0, target=205.0))
    assert _levels({"bodyJson": old})["annotations"] == fresh


def test_a_members_own_note_in_that_shape_is_not_touched(db):
    """`{role, price}` with no drawing is also a shape the PRODUCT writes for a member (a level
    with no line on the chart). Only a sample is upgraded."""
    nid = _import(U1, "file", "own:plan", _old_shape_body("AAPL", "mine", 1790000000, entry=180.0, stop=170.0))
    anns = _levels(notes.get_note(U1, nid))["annotations"]
    assert anns == [{"role": "entry", "type": "horizontal", "price": 180.0},
                    {"role": "stop", "type": "horizontal", "price": 170.0}]


def test_the_upgrade_leaves_a_drawn_level_and_everything_else_exactly_as_it_is():
    drawn = {"id": "keep", "type": "horizontal", "role": "stop", "points": [{"time": 5, "price": 9.0}], "color": "#fff"}
    plain = {"id": "line", "type": "trendline", "points": [{"time": 1, "price": 1.0}, {"time": 2, "price": 2.0}]}
    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Entry: 180"}]},
        {"type": "widgetEmbed", "attrs": {"widgetId": "chart", "embedId": "e", "params": {"symbol": "AAPL", "to": 5},
                                          "annotations": [drawn, plain]}}]}
    assert sample_marker.upgrade_sample_levels(body) is body                  # nothing to do: the same object
    # Mixed: only the level that needs it changes, and the input is never mutated.
    body["content"][1]["attrs"]["annotations"].append({"role": "entry", "type": "horizontal", "price": 11.0})
    snapshot = json.dumps(body, sort_keys=True)
    out = sample_marker.upgrade_sample_levels(body)
    assert json.dumps(body, sort_keys=True) == snapshot
    anns = out["content"][1]["attrs"]["annotations"]
    assert anns[:2] == [drawn, plain]
    assert anns[2] == {"id": "e-entry", "type": "horizontal", "role": "entry", "points": [{"time": 5, "price": 11.0}]}
    assert sample_marker.upgrade_sample_levels(out) is out                    # idempotent


def test_two_old_levels_with_the_same_role_get_different_ids():
    body = {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {
        "widgetId": "chart", "embedId": "e", "params": {"to": 7},
        "annotations": [{"role": "target", "type": "horizontal", "price": 10.0},
                        {"role": "target", "type": "horizontal", "price": 12.0}]}}]}
    ids = [a["id"] for a in sample_marker.upgrade_sample_levels(body)["content"][0]["attrs"]["annotations"]]
    assert len(set(ids)) == 2 and ids[0] == "e-target"


def test_the_upgrade_never_raises_on_a_body_it_does_not_understand():
    for odd in (None, [], "text", {"type": "doc"}, {"type": "doc", "content": "x"},
                {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {"annotations": "x"}}]},
                {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {"widgetId": "chart", "annotations": [
                    {"role": "entry", "price": "NaN"}, {"role": "entry", "price": True}, 7]}}]}):
        assert sample_marker.upgrade_sample_levels(odd) is odd
