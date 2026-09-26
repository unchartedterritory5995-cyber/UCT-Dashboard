"""Wave 8 lane 8C, C3 -- the sample notebook (ruling D-C6).

Three halves, and each fails for a different reason:

* THE CONTENT (`api/services/journal_two/sample_notebook.json`) is measured, never trusted:
  every body passes the server's body validation and uses only registered node and mark
  types; no cashtag, no word the ticker extractor reads as a ticker, no all-capitals word
  that is a real ticker (RS, EMA, MA, GAP and PEG all are); no date mention; no task with a
  due date; no properties. Each check carries a control proving it can fail.
* THE SEED (`sample_notebook.seed`): five notes in "Sample notebook", two of them linked to
  each other through `notes.import_confirm` (the importer's own door); refused for a member
  with ANY note -- active, archived or trashed -- without `import_confirm` ever being
  called; two seeds at once give exactly one sample; a member's sample never touches
  another member's notebook; afterwards the member's mentioned-symbol vocabulary (the
  source the Awareness Engine's thesis-stop alert reads) is empty.
* THE ROUTES (`api/routers/notebook_onboarding.py`): 404 with the gate off and nothing
  written, 402 for an unpaid member, 409 with the sentence, and remove trashing exactly
  the recorded ids.

The database is a temp file (`auth_db._DB_PATH`); nothing here reaches `C:\\data`.
"""
from __future__ import annotations

import json
import re
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db, auth_service, buzz_extract, buzz_universe
from api.services.journal_two import note_tasks, notes, sample_notebook
from api.services.journal_two.notebook_schema import NOTEBOOK_TYPE_SCHEMA

U1, U2, U3 = "u-sample-1", "u-sample-2", "u-sample-3"
REFUSED = "You already have notes, so we didn't add the sample. You can import notes instead."
CAPS_WORD = re.compile(r"\b[A-Z][A-Z0-9]*(?:[.-][A-Z]{1,2})?\b")


@pytest.fixture
def db(monkeypatch, tmp_path):
    path = str(tmp_path / "sample.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    auth_db.init_db()
    return path


def _conn():
    c = auth_db.get_connection()
    return c


def _own_note(user_id, key="own:1", title="My own note"):
    out = notes.import_confirm(user_id, {"source": "test", "notes": [{
        "importKey": key, "title": title, "tags": [], "folderPath": [],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "mine"}]}]},
    }]})
    return out["created"][0]["id"]


def _types(node, out=None):
    out = set() if out is None else out
    if isinstance(node, dict):
        if isinstance(node.get("type"), str):
            out.add(node["type"])
        for m in node.get("marks") or []:
            if isinstance(m, dict) and isinstance(m.get("type"), str):
                out.add(m["type"])
        for c in node.get("content") or []:
            _types(c, out)
    return out


def _walk(node):
    if isinstance(node, dict):
        yield node
        for c in node.get("content") or []:
            yield from _walk(c)


def _plain(entry):
    body = notes._validate_body_json(entry["body"])
    return entry["title"] + "\n" + notes.extract_plain_text(body)


def _ticker_words(text):
    syms = buzz_universe.symbols()
    return sorted({w for w in CAPS_WORD.findall(text) if w in syms})


# ── the content ──────────────────────────────────────────────────────────────

def test_the_sample_is_five_notes_in_one_folder_with_a_welcome():
    data = json.loads(sample_notebook.SAMPLE_PATH.read_text(encoding="utf-8"))
    assert data["folder"] == "Sample notebook"
    keys = [n["key"] for n in data["notes"]]
    assert keys == ["welcome", "research", "thesis", "daily", "checklist"]
    assert data["welcome"] == "welcome"
    welcome = _plain(data["notes"][0])
    assert "Remove it" in welcome and "Trash" in welcome      # says how to remove it


def test_every_body_passes_validation_and_uses_only_registered_types():
    registered = set(NOTEBOOK_TYPE_SCHEMA)
    for e in sample_notebook.sample_notes():
        notes._validate_body_json(e["body"])
        ids = {x["key"]: f"id-{x['key']}" for x in sample_notebook.sample_notes()}
        linked = sample_notebook._with_links(e["body"], ids)
        notes._validate_body_json(linked)
        stray = _types(linked) - registered
        assert stray == set(), f"{e['key']} uses unregistered types {stray}"


def test_the_research_note_shows_what_the_brief_asks_for():
    research = next(e for e in sample_notebook.sample_notes() if e["key"] == "research")
    types = _types(research["body"])
    for t in ("heading", "table", "callout", "codeBlock", "blockMath", "inlineMath"):
        assert t in types, t


def test_no_cashtag_and_no_word_the_extractor_reads_as_a_ticker():
    for e in sample_notebook.sample_notes():
        assert buzz_extract.extract(_plain(e)) == [], e["key"]
        assert "$" not in e["title"]


def test_no_all_capitals_word_is_a_real_ticker():
    for e in sample_notebook.sample_notes():
        assert _ticker_words(_plain(e)) == [], e["key"]


def test_CONTROLS_the_content_checks_can_fail():
    assert buzz_extract.extract("watching $NVDA into the close") != []
    assert _ticker_words("the RS line and the 21 EMA held the MA; no GAP; PEG") == ["EMA", "GAP", "MA", "PEG", "RS"]


def test_no_date_mention_no_dated_task_no_ticker_no_properties():
    for e in sample_notebook.sample_notes():
        assert not any(n.get("type") == "dateMention" for n in _walk(e["body"])), e["key"]
        assert all(t["due"] is None for t in note_tasks.extract_tasks(e["body"])), e["key"]
        assert set(e) == {"key", "title", "body"}, e["key"]     # no ticker, no properties, no tags
    checklist = next(e for e in sample_notebook.sample_notes() if e["key"] == "checklist")
    assert len(note_tasks.extract_tasks(checklist["body"])) == 4    # non-vacuity: tasks exist


def test_CONTROL_a_dated_task_is_seen():
    body = {"type": "doc", "content": [{"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": False},
             "content": [{"type": "paragraph", "content": [{"type": "text", "text": "call "},
                                                           {"type": "dateMention", "attrs": {"date": "2026-10-01"}}]}]}]}]}
    assert [t["due"] for t in note_tasks.extract_tasks(body)] == ["2026-10-01"]


# ── the seed ─────────────────────────────────────────────────────────────────

def test_seed_writes_the_sample_linked_and_records_its_ids(db):
    out = sample_notebook.seed(U1)
    c = _conn()
    try:
        rows = c.execute("SELECT id, title, folder_id, ticker, import_source, properties_json FROM j2_notes"
                         " WHERE user_id = ? ORDER BY created_at", (U1,)).fetchall()
        assert len(rows) == 5
        assert {r["id"] for r in rows} == set(out["ids"])
        assert {r["folder_id"] for r in rows} == {out["folderId"]}
        folder = c.execute("SELECT name, parent_id FROM j2_note_folders WHERE id = ?", (out["folderId"],)).fetchone()
        assert folder["name"] == "Sample notebook" and not folder["parent_id"]
        assert all(r["ticker"] is None and r["import_source"] == "sample" for r in rows)
        assert all(r["properties_json"] in (None, "", "{}") for r in rows)
        by_title = {r["title"]: r["id"] for r in rows}
        assert out["welcomeNoteId"] == by_title["Welcome to your sample notebook"]
        research, thesis = by_title["Research: how a base forms"], by_title["Thesis: leaders recover first"]
        links = {(r["note_id"], r["target_note_id"]) for r in c.execute(
            "SELECT note_id, target_note_id FROM j2_note_links WHERE user_id = ?", (U1,))}
        assert (research, thesis) in links and (thesis, research) in links    # the pair links both ways
        assert {t for w, t in links if w == out["welcomeNoteId"]} == set(out["ids"]) - {out["welcomeNoteId"]}
        # every stored link points at a real sample note (no "@key" placeholder survived)
        assert all(t in out["ids"] for _, t in links)
    finally:
        c.close()
    pref = json.loads(auth_service.get_user_preferences(U1)[sample_notebook.PREF_KEY])
    assert pref["v"] == 1 and pref["ids"] == out["ids"] and isinstance(pref["at"], str)


def test_after_seeding_nothing_reads_as_a_stock_or_a_reminder(db):
    out = sample_notebook.seed(U1)
    c = _conn()
    try:
        # the Awareness Engine's source (R6 thesis-stop) and the per-member query agree: empty
        assert notes.bulk_member_mentioned_symbols(c).get(U1, set()) == set()
        assert notes._member_mentioned_symbols(U1, c) == []
        assert c.execute("SELECT COUNT(*) FROM j2_note_mentions WHERE user_id = ?", (U1,)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM j2_note_embeds WHERE user_id = ? AND symbol IS NOT NULL",
                         (U1,)).fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM j2_note_properties WHERE user_id = ?", (U1,)).fetchone()[0] == 0
        for nid in out["ids"]:
            body = json.loads(c.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,)).fetchone()[0])
            assert all(t["due"] is None for t in note_tasks.extract_tasks(body))
    finally:
        c.close()


def test_CONTROL_the_mentions_rail_sees_a_cashtag(db):
    notes.import_confirm(U2, {"source": "test", "notes": [{
        "importKey": "c:1", "title": "x", "tags": [], "folderPath": [],
        "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "long $NVDA"}]}]}}]})
    c = _conn()
    try:
        assert notes.bulk_member_mentioned_symbols(c).get(U2) == {"NVDA"}
    finally:
        c.close()


@pytest.mark.parametrize("state", ["active", "archived", "trashed"])
def test_seed_is_refused_for_a_member_with_any_note_and_never_imports(db, monkeypatch, state):
    nid = _own_note(U1)
    if state == "archived":
        notes.set_note_archived(U1, nid, True)
    elif state == "trashed":
        notes.delete_note(U1, nid)
    calls = []
    real = notes.import_confirm
    monkeypatch.setattr(notes, "import_confirm", lambda *a, **k: calls.append(a) or real(*a, **k))
    with pytest.raises(sample_notebook.SampleRefused):
        sample_notebook.seed(U1)
    assert calls == []
    c = _conn()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (U1,)).fetchone()[0] == 1
    finally:
        c.close()
    assert sample_notebook.PREF_KEY not in auth_service.get_user_preferences(U1)


def test_two_seeds_at_once_give_exactly_one_sample(db, monkeypatch):
    # Both seeds are held right after they count, so without the write lock both would
    # count zero and both would go on to write. With it, the second cannot count until the
    # first has committed -- and then it counts five notes and is refused.
    barrier = threading.Barrier(2)
    real = sample_notebook.count_all_notes

    def held(user_id, conn):
        n = real(user_id, conn)
        try:
            barrier.wait(timeout=1.0)
        except threading.BrokenBarrierError:
            pass
        return n

    monkeypatch.setattr(sample_notebook, "count_all_notes", held)
    results = []

    def run():
        try:
            results.append(("ok", sample_notebook.seed(U1)))
        except (sample_notebook.SampleRefused, sample_notebook.SampleBusy) as exc:
            results.append((type(exc).__name__, None))

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert sorted(r[0] for r in results) == ["SampleRefused", "ok"]
    c = _conn()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = ?", (U1,)).fetchone()[0] == 5
    finally:
        c.close()


def test_a_members_sample_never_touches_another_members_notebook(db):
    other = _own_note(U2, key="own:u2")
    out1 = sample_notebook.seed(U1)
    out3 = sample_notebook.seed(U3)                 # U3 has no notes: seeded independently
    assert set(out1["ids"]).isdisjoint(out3["ids"])
    with pytest.raises(sample_notebook.SampleRefused):
        sample_notebook.seed(U2)                    # U2 has a note of its own
    sample_notebook.remove(U1)
    c = _conn()
    try:
        live = {r[0]: r[1] for r in c.execute("SELECT user_id, COUNT(*) FROM j2_notes WHERE deleted_at IS NULL"
                                               " GROUP BY user_id")}
    finally:
        c.close()
    assert live == {U2: 1, U3: 5}
    assert notes.get_note(U2, other) is not None


def test_remove_trashes_exactly_the_recorded_ids_still_active(db):
    out = sample_notebook.seed(U1)
    mine = _own_note(U1, key="own:after")           # written after the sample, in the notebook
    already = out["ids"][2]
    notes.delete_note(U1, already)                  # the member trashed one sample note themselves
    notes.set_note_archived(U1, out["ids"][3], True)
    result = sample_notebook.remove(U1)
    assert result == {"trashed": [i for i in out["ids"] if i != already]}
    assert notes.get_note(U1, mine) is not None     # the member's own note is untouched
    for nid in out["ids"]:
        assert notes.get_note(U1, nid) is None
        assert notes.get_note(U1, nid, include_deleted=True) is not None   # in Trash, restorable
    assert sample_notebook.remove(U1) == {"trashed": []}


def test_active_ids_reads_the_pref_and_the_trash(db):
    assert sample_notebook.active_ids(U1) == []
    out = sample_notebook.seed(U1)
    assert sample_notebook.active_ids(U1) == out["ids"]
    notes.delete_note(U1, out["ids"][0])
    assert sample_notebook.active_ids(U1) == out["ids"][1:]


# ── the routes ───────────────────────────────────────────────────────────────

@pytest.fixture
def app(db, monkeypatch):
    from api.middleware.auth_middleware import get_current_user
    from api.routers import notebook_onboarding

    monkeypatch.setenv("NOTEBOOK_ONBOARDING_ENABLED", "1")
    fa = FastAPI()
    fa.include_router(notebook_onboarding.router)
    fa.dependency_overrides[get_current_user] = lambda: {"id": U1, "role": "admin"}
    return fa


def _as(app, user_id, role="admin"):
    from api.middleware.auth_middleware import get_current_user
    app.dependency_overrides[get_current_user] = lambda: {"id": user_id, "role": role}


def test_the_routes_seed_report_and_remove(app):
    client = TestClient(app)
    r = client.post("/api/j2/onboarding/sample-notebook")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"folderId", "welcomeNoteId"}
    status = client.get("/api/j2/onboarding/sample-notebook").json()
    assert len(status["ids"]) == 5 and status["activeIds"] == status["ids"]
    assert body["welcomeNoteId"] in status["ids"]
    again = client.post("/api/j2/onboarding/sample-notebook")
    assert again.status_code == 409 and again.json()["detail"] == REFUSED
    gone = client.delete("/api/j2/onboarding/sample-notebook")
    assert gone.status_code == 200 and sorted(gone.json()["trashed"]) == sorted(status["ids"])
    assert client.get("/api/j2/onboarding/sample-notebook").json()["activeIds"] == []


@pytest.mark.parametrize("state", ["active", "archived", "trashed"])
def test_the_route_answers_409_with_the_sentence(app, state):
    nid = _own_note(U1)
    if state == "archived":
        notes.set_note_archived(U1, nid, True)
    elif state == "trashed":
        notes.delete_note(U1, nid)
    r = TestClient(app).post("/api/j2/onboarding/sample-notebook")
    assert r.status_code == 409
    assert r.json() == {"detail": REFUSED}


def test_the_gate_off_is_404_everywhere_and_writes_nothing(app, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_ONBOARDING_ENABLED", "0")
    client = TestClient(app)
    for method in ("post", "get", "delete"):
        r = getattr(client, method)("/api/j2/onboarding/sample-notebook")
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}, method
    monkeypatch.delenv("NOTEBOOK_ONBOARDING_ENABLED")      # unset means OFF too
    assert client.post("/api/j2/onboarding/sample-notebook").status_code == 404
    c = _conn()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM j2_note_folders").fetchone()[0] == 0
    finally:
        c.close()
    assert sample_notebook.PREF_KEY not in auth_service.get_user_preferences(U1)


def test_an_unpaid_member_is_refused_402_and_nothing_is_written(app, monkeypatch):
    from api.routers import notebook_onboarding
    monkeypatch.setattr(notebook_onboarding, "is_paid_user", lambda user: False)
    _as(app, U1, role="member")
    r = TestClient(app).post("/api/j2/onboarding/sample-notebook")
    assert r.status_code == 402
    assert r.json()["detail"] == "The sample notebook is part of a paid plan."
    c = _conn()
    try:
        assert c.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0] == 0
    finally:
        c.close()


def test_the_delete_route_is_scoped_to_the_caller(app):
    client = TestClient(app)
    assert client.post("/api/j2/onboarding/sample-notebook").status_code == 200
    _as(app, U3)
    assert client.post("/api/j2/onboarding/sample-notebook").status_code == 200
    assert client.delete("/api/j2/onboarding/sample-notebook").status_code == 200
    assert len(sample_notebook.active_ids(U1)) == 5 and sample_notebook.active_ids(U3) == []


def test_a_locked_database_is_503_with_its_sentence(app, monkeypatch):
    def busy(user_id, *, conn=None):
        raise sample_notebook.SampleBusy("database is locked")
    monkeypatch.setattr(sample_notebook, "seed", busy)
    r = TestClient(app).post("/api/j2/onboarding/sample-notebook")
    assert r.status_code == 503
    assert r.json()["detail"] == "The sample notebook is being added. Try again in a moment."


def test_the_routes_are_mounted_on_the_real_app():
    from api.main import app as real
    paths = {(m, r.path) for r in real.routes for m in (getattr(r, "methods", None) or ())}
    for m in ("POST", "GET", "DELETE"):
        assert (m, "/api/j2/onboarding/sample-notebook") in paths


def test_the_seed_counts_unlocked_then_takes_the_write_lock_and_counts_again():
    # The concurrency rail's mechanism, named (wave-8 final review M-9): an UNLOCKED count
    # answers the common refusal, then BEGIN IMMEDIATE, then the count that decides.
    src = sample_notebook.SAMPLE_PATH.with_suffix(".py").read_text(encoding="utf-8")
    body = src[src.index("def seed("):src.index("def _link_targets(")]
    begin = body.index('conn.execute("BEGIN IMMEDIATE")')
    counts = [m.start() for m in re.finditer(re.escape("count_all_notes(user_id, conn)"), body)]
    assert len(counts) == 2 and counts[0] < begin < counts[1], (counts, begin)
    # ...and the ids are recorded between pass 1 and pass 2.
    passes = [m.start() for m in re.finditer(re.escape("notes.import_confirm("), body)]
    record = body.index("auth_service.set_user_preference(user_id, PREF_KEY")
    assert len(passes) == 2 and passes[0] < record < passes[1], (passes, record)


def test_M9_a_refusal_never_takes_the_write_lock(db):
    """The common POST is a refusal, and it used to take `BEGIN IMMEDIATE` (the auth.db write
    lock) just to count and roll back. With ANOTHER connection holding the write lock, a
    member who has notes is still refused at once -- and never reported busy -- because the
    refusal is answered by an unlocked count."""
    _own_note(U1)
    holder = _conn()
    try:
        holder.execute("BEGIN IMMEDIATE")
        with pytest.raises(sample_notebook.SampleRefused):
            sample_notebook.seed(U1)
    finally:
        holder.rollback()
        holder.close()
    # ...and the statement trace of a refusal holds no BEGIN at all.
    traced: list[str] = []
    c = _conn()
    try:
        c.set_trace_callback(traced.append)
        with pytest.raises(sample_notebook.SampleRefused):
            sample_notebook.seed(U1, conn=c)
    finally:
        c.close()
    assert traced and not any("BEGIN" in s.upper() for s in traced), traced


def test_M9_CONTROL_a_member_with_no_note_does_take_the_lock(db):
    """CONTROL: the lock is still what a real seed takes -- with another writer holding it,
    a member with NO note is told the notebook is busy rather than seeded twice."""
    holder = _conn()
    try:
        holder.execute("BEGIN IMMEDIATE")
        c = auth_db.get_connection()
        c.execute("PRAGMA busy_timeout = 0")
        try:
            with pytest.raises(sample_notebook.SampleBusy):
                sample_notebook.seed(U1, conn=c)
        finally:
            c.close()
    finally:
        holder.rollback()
        holder.close()
    assert sample_notebook.seed(U1)["ids"], "the seed runs once the lock is free"


def test_M9_a_failure_in_pass_2_leaves_a_sample_that_can_be_removed(db, monkeypatch):
    """⚰️ The ids were recorded only after pass 2: anything raising between the passes left
    five notes no `remove` could find -- and a member who now 'has notes' can never re-seed.
    They are recorded right after pass 1 now."""
    real = notes.import_confirm
    calls = []

    def fail_second(*a, **k):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("pass 2 failed")
        return real(*a, **k)

    monkeypatch.setattr(notes, "import_confirm", fail_second)
    with pytest.raises(RuntimeError):
        sample_notebook.seed(U1)
    assert len(calls) == 2, "non-vacuity: pass 1 ran and pass 2 was reached"
    c = _conn()
    try:
        written = {r[0] for r in c.execute("SELECT id FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL",
                                           (U1,))}
    finally:
        c.close()
    assert len(written) == 5
    assert set(sample_notebook.recorded_ids(U1)) == written, "the sample pass 1 wrote is not recorded"
    monkeypatch.setattr(notes, "import_confirm", real)
    trashed = sample_notebook.remove(U1)["trashed"]
    assert set(trashed) == written
    assert sample_notebook.active_ids(U1) == []
