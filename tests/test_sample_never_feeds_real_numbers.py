"""fin-data I3 -- a sample note is never data about the member.

The sample notebook writes example notes that name real tickers (a thesis on NVDA with a
stop, a plan on AAPL with an entry and a stop). They are examples to read. They must never
become a fact about the member: not the plan a real trade is graded against, not "what you
wrote before a loss", not "symbols you have research on", not a chip on a real position, not
a name they passed on, not a template the nightly scan matches the market against.

ONE marker (`j2_notes.import_source = 'sample'`), ONE predicate (`sample_marker`). Each test
below drives the real read function of one consumer with a seeded sample, and each carries a
CONTROL: the same content written as the member's own note IS read -- so a reader that
simply returns nothing cannot pass.

The last section is the ledger rail: every module under `api/` whose code reads a note table
is listed, either as GUARDED (it must use the predicate) or EXEMPT with a reason. A new
reader that is in neither list fails by name.

The database is a temp file (`auth_db._DB_PATH`); nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from api.services import auth_db
from api.services.journal_two import (
    note_levels, notes, passed_setups, plan_grading, playbook_patterns, sample_examples,
    sample_marker, sample_notebook, similar_matches, thesis_chips,
)

U1 = "u-fin-i3-1"
U2 = "u-fin-i3-2"
ACCOUNT = "acc-fin-i3"
REPO = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture
def db(monkeypatch, tmp_path):
    path = str(tmp_path / "i3.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    monkeypatch.setenv("NOTEBOOK_ONBOARDING_ENABLED", "1")
    monkeypatch.setenv("NOTEBOOK_GETTING_STARTED_ENABLED", "1")
    auth_db.init_db()
    c = auth_db.get_connection()
    try:
        for uid in (U1, U2):
            c.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
                      " VALUES (?, ?, 'x', 'x', 'member')", (uid, f"{uid}@example.test"))
            c.execute(
                "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size,"
                " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                (f"{ACCOUNT}-{uid}", uid, "Main", "#fff", 10000.0, 10000.0,
                 "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"))
        c.commit()
    finally:
        c.close()
    return path


@pytest.fixture
def conn(db):
    c = auth_db.get_connection()
    yield c
    c.close()


@pytest.fixture
def seeded(db):
    """U1 has the sample notebook, with every capability example."""
    out = sample_notebook.seed(U1)
    c = auth_db.get_connection()
    try:
        rows = c.execute("SELECT id, title, ticker FROM j2_notes WHERE user_id = ?", (U1,)).fetchall()
    finally:
        c.close()
    by_title = {r["title"]: r["id"] for r in rows}
    thesis = next(i for t, i in by_title.items() if t.startswith("Thesis: example"))
    plan = next(i for t, i in by_title.items() if t.startswith("Trade plan: example"))
    return {"ids": out["ids"], "thesis": thesis, "plan": plan}


def _later(hours: float = 1.0) -> str:
    """An instant after every note written in this test: the trade is entered AFTER the note."""
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def add_trade(conn, user, symbol, *, entry_price=120.0, exit_price=112.0, stop=110.0, shares=100.0):
    tid = f"t-{uuid.uuid4().hex[:10]}"
    entry, exit_ = _later(1), _later(2)
    pnl = round((exit_price - entry_price) * shares, 2)
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple, hold_days,"
        " result, context_at_entry, created_at, account_id, fees, hour_et, trading_day_et)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,1,?,?,?,?,0,10,?)",
        (tid, user, f"pos-{tid}", symbol, "Long", shares, entry_price, entry, exit_price, exit_, stop,
         pnl, pnl / (entry_price * shares), -0.8, "Loss", "{}", exit_, f"{ACCOUNT}-{user}", exit_[:10]))
    conn.commit()
    return conn.execute("SELECT * FROM j2_trades WHERE id = ?", (tid,)).fetchone()


def own_note(conn, user, title, body, *, ticker=None, source="file", key=None):
    """The member's OWN note with the same content a sample has (the control), through the
    same import door, so the only difference from a sample is the marker."""
    out = notes.import_confirm(user, {"source": source, "notes": [{
        "importKey": key or f"own:{uuid.uuid4().hex}", "title": title, "bodyJson": body,
        "tags": [], "ticker": ticker, "folderPath": ["Mine"]}]}, conn=conn)
    assert not out["failed"], out["failed"]
    nid = (out["created"] or out["updated"])[0]["id"]
    row = conn.execute("SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes"
                       " WHERE id = ?", (nid,)).fetchone()
    note_levels.ensure_schema(conn)
    note_levels.project_note(conn, user, row)
    conn.commit()
    return nid


def links(conn, user):
    return conn.execute("SELECT trade_ref, note_id FROM j2_trade_plan_links WHERE user_id = ?",
                        (user,)).fetchall()


# ── the predicate itself ───────────────────────────────────────────────────────────────────

def test_the_marker_is_one_value_and_both_sample_modules_read_it():
    assert sample_marker.SAMPLE_SOURCE == "sample"
    assert sample_notebook.SOURCE is sample_marker.SAMPLE_SOURCE
    assert sample_examples.IMPORT_SOURCE is sample_marker.SAMPLE_SOURCE


def test_every_seeded_note_carries_the_marker_and_nothing_else_does(conn, seeded):
    own = own_note(conn, U1, "Mine", sample_examples._thesis_note_body("NVDA", 110.0), ticker="NVDA")
    assert sample_marker.sample_note_ids(conn, U1) == set(seeded["ids"])
    assert own not in sample_marker.sample_note_ids(conn, U1)
    assert sample_marker.is_sample_note(conn, U1, seeded["thesis"]) is True
    assert sample_marker.is_sample_note(conn, U1, own) is False
    assert sample_marker.is_sample_note(conn, U1, "no-such-note") is False
    # Another member's sample is not this member's.
    assert sample_marker.is_sample_note(conn, U2, seeded["thesis"]) is False


def test_the_marker_survives_trash(conn, seeded):
    """A trashed sample is still a sample: cleaning up after it depends on this."""
    sample_notebook.remove(U1)
    assert sample_marker.sample_note_ids(conn, U1) == set(seeded["ids"])


def test_a_member_cannot_write_the_marker_through_the_import_door(db):
    """The marker is the server's. A client that could set it could hide its own notes from
    its own statistics, and have "Remove sample" trash them."""
    from api.routers import journal_two
    payload = {"source": "sample", "notes": [{"importKey": "x", "title": "t", "bodyJson": {"type": "doc", "content": []},
                                               "tags": [], "folderPath": []}]}
    with pytest.raises(HTTPException) as e:
        journal_two.notes_import_confirm_endpoint(payload, user={"id": U2})
    assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        journal_two.notes_import_confirm_endpoint({**payload, "source": " Sample "}, user={"id": U2})
    c = auth_db.get_connection()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (U2,)).fetchone()[0] == 0
        # Control: the same payload with an ordinary source is accepted.
        out = journal_two.notes_import_confirm_endpoint({**payload, "source": "file"}, user={"id": U2})
        assert len(out["created"]) == 1
    finally:
        c.close()


# ── plan grading: a sample is never a plan ──────────────────────────────────────────────────

def test_a_sample_thesis_is_never_matched_as_a_real_trades_plan(conn, seeded):
    trade = add_trade(conn, U1, "NVDA")
    p = plan_grading.grade_payload(conn, U1, trade)
    assert p["status"] == plan_grading.STATUS_UNPLANNED
    assert p["plan"] is None and p["checks"] is None
    assert links(conn, U1) == []
    assert seeded["thesis"] not in {c["id"] for c in p["candidates"]}, "offered in the Re-link picker"


def test_control_the_members_own_note_with_the_same_words_is_the_plan(conn, seeded):
    own = own_note(conn, U1, "My NVDA thesis", sample_examples._thesis_note_body("NVDA", 110.0), ticker="NVDA")
    trade = add_trade(conn, U1, "NVDA")
    p = plan_grading.grade_payload(conn, U1, trade)
    assert p["status"] == plan_grading.STATUS_PLANNED
    assert p["plan"]["noteId"] == own
    assert [r["note_id"] for r in links(conn, U1)] == [own]


def test_a_sample_the_member_linked_to_a_trade_by_hand_is_still_not_its_plan(conn, seeded, monkeypatch):
    from api.services.journal_two import note_trade_links
    trade = add_trade(conn, U1, "AAPL", entry_price=181.0, exit_price=172.0, stop=170.0)
    monkeypatch.setattr(note_trade_links, "notes_linked_to_trade", lambda *a, **k: [seeded["plan"]])
    p = plan_grading.grade_payload(conn, U1, trade)
    assert p["status"] == plan_grading.STATUS_UNPLANNED and links(conn, U1) == []


def test_relinking_a_trade_to_a_sample_is_refused(conn, seeded):
    trade = add_trade(conn, U1, "NVDA")
    with pytest.raises(plan_grading.RelinkError) as e:
        plan_grading.relink(conn, U1, trade, note_id=seeded["thesis"])
    assert "example" in str(e.value).lower()
    assert links(conn, U1) == []


def _freeze_against(conn, user, trade, note_id):
    """What the code before this fix did on its own: freeze the sample as the trade's plan."""
    row = conn.execute(f"SELECT {plan_grading._NOTE_COLS} FROM j2_notes WHERE id = ?", (note_id,)).fetchone()
    moment = plan_grading.entry_moment(trade["entry_date"])
    cand = plan_grading._note_candidate(conn, user, row, trade["symbol"], moment, [], "window")
    assert cand is not None, "the fixture note names no plan; the test would prove nothing"
    ref = plan_grading.trade_ref_for_row(trade)
    assert plan_grading.freeze(conn, user, ref, trade["symbol"], cand, "window", moment)
    return ref


def test_a_plan_already_frozen_from_a_sample_is_dropped_on_the_next_read(conn, seeded):
    trade = add_trade(conn, U1, "NVDA")
    _freeze_against(conn, U1, trade, seeded["thesis"])
    assert len(links(conn, U1)) == 1
    p = plan_grading.grade_payload(conn, U1, trade)
    assert p["status"] == plan_grading.STATUS_UNPLANNED and p["plan"] is None
    assert links(conn, U1) == []
    record = plan_grading.discipline_record(conn, U1)
    assert record["windows"][0]["planned"] == 0 and record["windows"][0]["unplanned"] == 1


def test_removing_the_sample_unfreezes_every_trade_it_was_frozen_to(conn, seeded):
    """With NO read in between: Remove alone must leave no real trade graded on a sample."""
    nvda = add_trade(conn, U1, "NVDA")
    _freeze_against(conn, U1, nvda, seeded["thesis"])
    own = own_note(conn, U1, "My MSFT plan", sample_examples._thesis_note_body("MSFT", 395.0), ticker="MSFT")
    msft = add_trade(conn, U1, "MSFT", entry_price=410.0, exit_price=400.0, stop=395.0)
    assert plan_grading.grade_payload(conn, U1, msft)["status"] == plan_grading.STATUS_PLANNED
    assert len(links(conn, U1)) == 2

    sample_notebook.remove(U1)

    left = links(conn, U1)
    assert [r["note_id"] for r in left] == [own], "the member's own frozen plan must survive"


def test_control_a_frozen_plan_from_the_members_own_note_is_never_dropped(conn, seeded):
    own = own_note(conn, U1, "My NVDA thesis", sample_examples._thesis_note_body("NVDA", 110.0), ticker="NVDA")
    trade = add_trade(conn, U1, "NVDA")
    _freeze_against(conn, U1, trade, own)
    for _ in range(2):
        assert plan_grading.grade_payload(conn, U1, trade)["status"] == plan_grading.STATUS_PLANNED
    assert [r["note_id"] for r in links(conn, U1)] == [own]


# ── playbook patterns: "what you wrote before" ──────────────────────────────────────────────

def test_a_sample_is_never_what_you_wrote_before_a_trade(conn, seeded, monkeypatch):
    from api.services.journal_two import note_trade_links
    own = own_note(conn, U1, "My NVDA thesis", sample_examples._thesis_note_body("NVDA", 110.0), ticker="NVDA")
    trade = add_trade(conn, U1, "NVDA")
    monkeypatch.setattr(note_trade_links, "notes_linked_to_trade", lambda *a, **k: [seeded["thesis"], own])
    before = playbook_patterns.notes_before_trade(conn, U1, trade)
    assert [b["noteId"] for b in before] == [own]


# ── the thesis-stop alert and the member's ticker vocabulary ────────────────────────────────

def test_sample_tickers_are_not_symbols_the_member_has_research_on(conn, seeded):
    assert notes._member_mentioned_symbols(U1, conn) == []
    assert U1 not in notes.bulk_member_mentioned_symbols(conn)


def test_control_the_members_own_chart_note_is_research_on_that_symbol(conn, seeded):
    body = sample_examples._active_setup_note_body("MSFT", "2026-10-01", "2026-10-01T16:00:00Z",
                                                   410.0, 395.0, "Flat Base Breakout")
    own_note(conn, U1, "My MSFT setup", body)
    assert notes._member_mentioned_symbols(U1, conn) == ["MSFT"]
    assert notes.bulk_member_mentioned_symbols(conn) == {U1: {"MSFT"}}


def test_a_stopped_out_position_in_a_sample_ticker_gets_no_review_your_research_alert(conn, seeded):
    from api.services.awareness import rules
    mentioned = notes.bulk_member_mentioned_symbols(conn).get(U1, set())
    position = {"symbol": "AAPL", "side": "Long", "stop_price": 170.0, "entry_price": 180.0, "source": "manual"}
    scan = {"live_prices": {"AAPL": 169.0}}
    assert rules.rule_thesis_stop_review(scan, {"mentioned_symbols": mentioned, "positions": [position]}) == []
    # Control: the rule does fire for this exact position once the member has real research.
    fired = rules.rule_thesis_stop_review(scan, {"mentioned_symbols": {"AAPL"}, "positions": [position]})
    assert [c.kind for c in fired] == ["thesis_stop_review"]


# ── thesis chips ────────────────────────────────────────────────────────────────────────────

def test_a_sample_puts_no_chip_on_a_real_row(conn, seeded):
    assert thesis_chips.batch_chips(conn, U1, ["NVDA", "AAPL", "MSFT"]) == {}


def test_control_the_members_own_thesis_is_the_chip_even_beside_a_sample(conn, seeded):
    own = own_note(conn, U1, "My NVDA thesis", sample_examples._thesis_note_body("NVDA", 104.5), ticker="NVDA")
    # Touch the sample AFTER, so "newest note on the symbol" would pick it if it were read.
    notes.update_note(U1, seeded["thesis"], {"title": "Thesis: example -- NVDA leadership (edited)"}, conn=conn)
    chip = thesis_chips.batch_chips(conn, U1, ["NVDA"])["NVDA"]
    assert chip["noteId"] == own and chip["stop"] == 104.5


# ── passed setups: names saved from a scan ──────────────────────────────────────────────────

def _scan_body(symbols):
    now = datetime.now(timezone.utc).isoformat()
    return {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "scanner", "embedId": "s1", "mode": "snapshot", "capturedAt": now,
        "params": {"rows": [{"sym": s} for s in symbols]}}}]}


def test_a_scan_capture_inside_a_sample_is_not_a_name_the_member_passed_on(conn, db):
    notes.import_confirm(U2, {"source": sample_marker.SAMPLE_SOURCE, "notes": [{
        "importKey": "sample:scan", "title": "Example scan", "bodyJson": _scan_body(["CRWD"]),
        "tags": [], "folderPath": ["Sample notebook"]}]}, conn=conn)
    own_note(conn, U2, "My scan", _scan_body(["PLTR"]))
    since = datetime.now(timezone.utc) - timedelta(days=5)
    found = {c["symbol"] for c in passed_setups._scanner_candidates(conn, U2, since)}
    assert found == {"PLTR"}


# ── similar matches: the nightly scan's templates ───────────────────────────────────────────

def test_a_sample_chart_is_never_a_template_for_the_nightly_match(conn, seeded):
    from api.services.journal_two import chart_blocks
    chart_blocks.catch_up(U1, conn=conn)
    assert any(b["setupTag"] and b["fingerprint"] for b in chart_blocks.list_blocks(U1, conn)), \
        "the sample plan block is not indexed; this test would prove nothing"
    assert similar_matches.templates_for(conn, U1) == []


def test_control_the_members_own_tagged_chart_is_a_template(conn, seeded):
    from api.services.journal_two import chart_blocks
    fp = sample_examples._static_fingerprint("AAPL", "2026-10-01")
    body = sample_examples._plan_note_body("AAPL", "2026-10-01", "2026-10-01T16:00:00Z",
                                           180.0, 170.0, 205.0, 100.0, "Classic Flag/Pullback", fp)
    own = own_note(conn, U1, "My AAPL plan", body)
    chart_blocks.catch_up(U1, conn=conn)
    assert [t["noteId"] for t in similar_matches.templates_for(conn, U1)] == [own]


# ── the ledger rail: every reader of a note table is accounted for ──────────────────────────

NOTE_TABLES = ("j2_notes", "j2_notes_fts", "j2_note_levels", "j2_chart_blocks", "j2_note_embeds",
               "j2_note_mentions")
_READ = re.compile(r"\b(?:FROM|JOIN)\s+(" + "|".join(NOTE_TABLES) + r")\b", re.I)
_PREDICATES = ("NOT_SAMPLE_SQL", "not_sample_sql", "is_sample", "is_sample_note", "sample_note_ids",
               "without_sample_notes")

#: Readers that turn a note's content into a fact about the member. Each MUST use the predicate.
GUARDED = {
    "api/services/journal_two/plan_grading.py": "which note is a trade's plan; the discipline record",
    "api/services/journal_two/playbook_patterns.py": "what the member wrote before wins and losses",
    "api/services/journal_two/notes.py": "symbols the member has research on (thesis-stop alert, vocabulary)",
    "api/services/journal_two/thesis_chips.py": "the chip on a position, holdings or watchlist row",
    "api/services/journal_two/passed_setups.py": "names saved from a scan and not traded",
    "api/services/journal_two/similar_matches.py": "the templates the nightly market match runs on",
}

#: Readers that do NOT turn a note into a fact about the member, each with the reason.
_NOTE_ITSELF = "serves, searches, exports, shares or stores the note itself; a sample is a note the member can read"
EXEMPT = {
    "api/services/journal_two/sample_examples.py": "writes the sample",
    "api/services/journal_two/sample_notebook.py": "writes and removes the sample",
    "api/services/journal_two/note_levels.py": "the resurfacing scan filters the marker in its own SQL "
                                                "(checked below); the index itself is a projection of every note",
    "api/services/journal_two/chart_blocks.py": "the chart-block index is a projection of every note; its "
                                                 "statistic-shaped readers are guarded (similar_matches) or listed here",
    "api/services/journal_two/setups_board.py": "shows the example plan as its own card, titled as an example "
                                                 "(tests/test_sample_notebook_examples.py); no trade statistic reads it",
    "api/services/journal_two/visual_playbook.py": "shows the example chart as its own card; every trade number on it "
                                                    "comes from frozen plan links, which plan_grading never makes for a sample",
    "api/services/journal_two/review_drafts.py": "reads note TITLES for links a guarded reader already chose "
                                                  "(plan links, the resurfacing ledger, which never fires for a sample)",
    "api/services/journal_two/ticker_research.py": "lists the member's notes on a ticker by title",
    "api/services/journal_two/thesis_changelog.py": "the change log of one note the member opened",
    "api/services/journal_two/review_search.py": _NOTE_ITSELF,
    "api/services/journal_two/evidence_candidates.py": _NOTE_ITSELF,
    "api/services/journal_two/enrichment.py": "the import arrival screen's ticker offer, for notes the member names",
    "api/services/journal_two/stage_a_validation.py": "an offline validation tool, not a member surface",
    "api/services/journal_two/notebook_soak.py": "the soak monitor's population counts, not a member surface",
    "api/services/journal_two/db.py": "schema and migrations",
    "api/services/user_playbook/service.py": "titles of notes the member linked to a playbook entry by hand",
    "api/routers/journal_two.py": _NOTE_ITSELF,
    "api/routers/notebook_chart_alerts.py": "reads one chart block of a note the member has open, on their click",
}
for _name in ("ai_actions", "ask_retrieval", "attachment_gc", "capture_destinations", "document_ocr",
              "document_search", "excerpt_search", "note_computed", "note_connectors/engine", "note_mentions",
              "note_personal_api", "note_properties", "note_publish", "note_semantic", "note_shares",
              "note_tasks", "note_trade_links", "notebook_home", "notes_export", "public_note_payload",
              "transcript_capture", "web_capture_store"):
    EXEMPT[f"api/services/journal_two/{_name}.py"] = _NOTE_ITSELF


def _code_strings(tree: ast.AST):
    """Every string constant that is code, never a docstring: a table named in prose is not a read."""
    docs = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            b = n.body
            if b and isinstance(b[0], ast.Expr) and isinstance(b[0].value, ast.Constant) \
                    and isinstance(b[0].value.value, str):
                docs.add(id(b[0].value))
    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs:
            yield n.value


def reads_note_tables(source: str) -> set[str]:
    return {m.group(1).lower() for s in _code_strings(ast.parse(source)) for m in _READ.finditer(s)}


def uses_predicate(source: str) -> bool:
    """The module names `sample_marker` AND one of its predicates, in code."""
    tree = ast.parse(source)
    imported = any(
        (isinstance(n, ast.ImportFrom) and (n.module or "").endswith("sample_marker"))
        or (isinstance(n, ast.ImportFrom) and any(a.name == "sample_marker" for a in n.names))
        or (isinstance(n, ast.Import) and any(a.name.endswith("sample_marker") for a in n.names))
        for n in ast.walk(tree))
    named = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} | \
            {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    return imported and any(p in named for p in _PREDICATES)


def _readers() -> dict[str, set[str]]:
    out = {}
    for p in sorted((REPO / "api").rglob("*.py")):
        if p.name.startswith("test_") or p.name == "sample_marker.py":
            continue
        hits = reads_note_tables(p.read_text(encoding="utf-8"))
        if hits:
            out[p.relative_to(REPO).as_posix()] = hits
    return out


def test_the_scan_sees_readers_at_all():
    """Non-vacuity: an empty scan would pass every check below."""
    readers = _readers()
    assert len(readers) >= 40
    assert "j2_notes" in readers["api/services/journal_two/plan_grading.py"]
    assert "j2_note_levels" in readers["api/services/journal_two/thesis_chips.py"]


def test_every_reader_of_a_note_table_is_guarded_or_exempt_with_a_reason():
    readers = _readers()
    unknown = sorted(set(readers) - set(GUARDED) - set(EXEMPT))
    assert not unknown, (
        "These modules read a note table and are in neither list. If a note's content becomes a "
        "fact about the member there (a statistic, a grade, an alert, a chip), add it to GUARDED "
        "and filter with sample_marker; otherwise add it to EXEMPT with the reason: " + ", ".join(unknown))
    assert not (set(GUARDED) & set(EXEMPT))


def test_no_ledger_entry_is_stale():
    """An entry for a module that no longer reads a note table is a claim nobody checks."""
    readers = _readers()
    gone = sorted((set(GUARDED) | set(EXEMPT)) - set(readers))
    assert not gone, "listed but no longer reading a note table: " + ", ".join(gone)


def test_every_guarded_reader_uses_the_one_predicate():
    missing = [m for m in GUARDED if not uses_predicate((REPO / m).read_text(encoding="utf-8"))]
    assert not missing, "guarded readers that do not use sample_marker: " + ", ".join(missing)


def test_no_reader_restates_the_marker_as_its_own_literal():
    """One predicate. A second `import_source ... 'sample'` typed elsewhere is a copy that drifts."""
    allowed = {"api/services/journal_two/note_levels.py"}   # another lane's file; pinned just below
    lit = re.compile(r"import_source[^\n]{0,40}['\"]sample['\"]")
    restated = [m for m in _readers() if m not in allowed
                and any(lit.search(s) for s in _code_strings(ast.parse((REPO / m).read_text(encoding="utf-8"))))]
    assert not restated, "these restate the sample marker; use sample_marker: " + ", ".join(restated)


def test_the_resurfacing_scans_own_filter_names_the_same_marker():
    src = (REPO / "api/services/journal_two/note_levels.py").read_text(encoding="utf-8")
    assert f"n.import_source IS NOT '{sample_marker.SAMPLE_SOURCE}'" in src
    assert sample_marker.NOT_SAMPLE_SQL.format(alias="n.") == f"n.import_source IS NOT '{sample_marker.SAMPLE_SOURCE}'"


def test_control_the_rail_catches_a_new_reader_that_skips_the_predicate():
    """A reader written tomorrow, in the shape of the ones that leaked."""
    new_reader = (
        '"""Reads FROM j2_notes in prose only."""\n'
        "def stops(conn, user_id):\n"
        '    return conn.execute("SELECT body_json FROM j2_notes n JOIN j2_note_levels l ON l.note_id = n.id"\n'
        '                        " WHERE n.user_id = ?", (user_id,)).fetchall()\n')
    assert reads_note_tables(new_reader) == {"j2_notes", "j2_note_levels"}
    assert uses_predicate(new_reader) is False
    guarded = new_reader.replace(
        "def stops", "from api.services.journal_two import sample_marker\n\ndef stops").replace(
        '" WHERE n.user_id = ?"', '" WHERE n.user_id = ? AND " + sample_marker.not_sample_sql("n")')
    assert uses_predicate(guarded) is True
    # Importing the module without asking it anything is not a guard.
    assert uses_predicate("from api.services.journal_two import sample_marker\nx = 1\n") is False
    # A table named only in a docstring is not a read.
    assert reads_note_tables('"""SELECT * FROM j2_notes"""\nx = 1\n') == set()
