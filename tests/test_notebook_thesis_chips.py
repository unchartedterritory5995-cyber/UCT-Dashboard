"""Wave 13 lane 13G-2 -- thesis chips on rows (`api/services/journal_two/thesis_chips.py`,
`api/routers/notebook_thesis_chips.py`).

What each section proves:
  * THE GATE: the route answers the one 404 while NOTEBOOK_THESIS_CHIPS_ENABLED is off,
    signed in or not; a paid plan is required once it is on.
  * ONE BATCH QUERY: N requested symbols cost exactly one `conn.execute` call, never one
    per symbol.
  * THE LEVEL IS READ FROM `j2_note_levels`, NEVER RECOMPUTED: a chip's stop/target/entry
    equal the index row's price even when the note's OWN BODY TEXT disagrees with it (the
    index is deliberately desynced from the note in this test, which is exactly what a
    second parse would get wrong).
  * NEWEST NOTE WINS when a member has written about one symbol in more than one note.
  * THESIS STATUS comes from the note's own `builtin:thesis_status` property, nothing else.
  * A symbol with no live note for this member is absent from the response, not a blank.
  * NO SECOND READ of a Notebook flag, and no import of `plan_extract` (the "never
    recomputed" claim, proved structurally as well as behaviourally).
"""
from __future__ import annotations

import ast
import importlib
import os
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

REPO = Path(__file__).resolve().parents[1]
FLAG = "NOTEBOOK_THESIS_CHIPS_ENABLED"
A, B = "user-tc-a", "user-tc-b"
PAID = {"plan": "pro"}
FREE = {"plan": "free"}


# ── fixtures ──────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid, email in ((A, "a@example.com"), (B, "b@example.com")):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, email, "x", uid, "member"))
    conn.commit()
    conn.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


@pytest.fixture
def app(db_path):
    from api.routers import notebook_thesis_chips as r
    fa = FastAPI()
    fa.include_router(r.router)
    yield fa
    fa.dependency_overrides.clear()


@pytest.fixture
def client(app):
    return TestClient(app)


def as_user(app, user_id: str, plan: dict = PAID) -> None:
    user = {"id": user_id, "role": "member", **plan}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _conn():
    from api.services import auth_db
    from api.services.journal_two import note_levels as nl
    c = auth_db.get_connection()
    nl.ensure_schema(c)
    return c


def _doc(*lines):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in lines]}


def _note(uid, ticker, *lines, title="thesis note", properties=None):
    from api.services.journal_two import notes
    c = _conn()
    try:
        n = notes.create_note(uid, {"title": title, "ticker": ticker, "bodyJson": _doc(*lines)}, conn=c)
        if properties:
            notes.update_note(uid, n["id"], {"properties": properties}, conn=c)
        c.commit()
        return n
    finally:
        c.close()


def _project(uid, note_id):
    """Run 13D's real projection for one note, as the awareness scan would."""
    from api.services.journal_two import note_levels as nl
    c = _conn()
    try:
        note = c.execute(
            "SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes"
            " WHERE id = ? AND user_id = ?", (note_id, uid)).fetchone()
        nl.project_note(c, uid, note)
        c.commit()
    finally:
        c.close()


def _set_level_price(uid, note_id, role, price):
    """Directly overwrite one projected level's price -- simulating a desync between the
    index and the note's own text, which is exactly the case a re-parse would get wrong."""
    c = _conn()
    try:
        c.execute("UPDATE j2_note_levels SET price = ? WHERE user_id = ? AND note_id = ? AND role = ?",
                  (price, uid, note_id, role))
        c.commit()
    finally:
        c.close()


def _chips(uid, symbols):
    from api.services.journal_two import thesis_chips as tcj
    c = _conn()
    try:
        return tcj.batch_chips(c, uid, symbols)
    finally:
        c.close()


# ── the gate ──────────────────────────────────────────────────────────────────────────

def test_the_route_404s_while_the_flag_is_off_signed_in_or_not(app, client):
    as_user(app, A)
    r = client.post("/api/j2/thesis-chips", json={"symbols": ["NVDA"]})
    assert r.status_code == 404
    app.dependency_overrides.clear()
    r = client.post("/api/j2/thesis-chips", json={"symbols": ["NVDA"]})
    assert r.status_code == 404


def test_the_route_requires_a_paid_plan_once_on(app, client, gate_on):
    as_user(app, A, FREE)
    r = client.post("/api/j2/thesis-chips", json={"symbols": ["NVDA"]})
    assert r.status_code == 402


def test_the_route_requires_a_session_once_on(app, client, gate_on):
    r = client.post("/api/j2/thesis-chips", json={"symbols": ["NVDA"]})
    assert r.status_code in (401, 403)


def test_a_non_list_symbols_is_refused(app, client, gate_on):
    as_user(app, A)
    r = client.post("/api/j2/thesis-chips", json={"symbols": "NVDA"})
    assert r.status_code == 400


# ── one batch query ───────────────────────────────────────────────────────────────────

class _CountingConn:
    """Counts every `execute` call that reaches the real connection, and nothing else --
    the service must be able to call any other sqlite3.Connection method untouched."""
    def __init__(self, inner):
        self._inner = inner
        self.calls = 0

    def execute(self, *a, **kw):
        self.calls += 1
        return self._inner.execute(*a, **kw)

    def __getattr__(self, name):
        return getattr(self._inner, name)


def test_N_symbols_cost_exactly_one_execute_call(db_path):
    from api.services.journal_two import thesis_chips as tcj
    n1 = _note(A, "NVDA", "Entry: 100", "Stop: 90", "Target: 120")
    _project(A, n1["id"])
    for extra in ("AMD", "TSLA", "MSFT", "AAPL"):
        n = _note(A, extra, f"Entry: 10", f"Stop: 9")
        _project(A, n["id"])
    c = _CountingConn(_conn())
    out = tcj.batch_chips(c, A, ["NVDA", "AMD", "TSLA", "MSFT", "AAPL", "GOOG", "SPY"])
    assert c.calls == 1, f"expected one batch query, got {c.calls}"
    assert set(out) == {"NVDA", "AMD", "TSLA", "MSFT", "AAPL"}


def test_an_empty_symbol_list_makes_no_query_at_all(db_path):
    from api.services.journal_two import thesis_chips as tcj
    c = _CountingConn(_conn())
    assert tcj.batch_chips(c, A, []) == {}
    assert c.calls == 0


# ── the level is read from the index, never recomputed ──────────────────────────────────

def test_the_chip_reports_the_INDEX_price_even_when_the_notes_own_text_disagrees(db_path):
    n = _note(A, "NVDA", "Entry: 100", "Stop: 90", "Target: 120")
    _project(A, n["id"])
    chip = _chips(A, ["NVDA"])["NVDA"]
    assert (chip["entry"], chip["stop"], chip["target"]) == (100.0, 90.0, 120.0)

    # Desync the index from the note's own text -- a re-parse of the body would still say
    # 90; the index now says 42.5. The chip must follow the INDEX, proving it is read, not
    # recomputed from the note's own words.
    _set_level_price(A, n["id"], "stop", 42.5)
    chip2 = _chips(A, ["NVDA"])["NVDA"]
    assert chip2["stop"] == 42.5, "the chip recomputed the stop from the note body instead of reading the index"
    assert chip2["entry"] == 100.0 and chip2["target"] == 120.0


def test_a_note_with_no_price_levels_still_answers_with_its_thesis_status(db_path):
    n = _note(A, "AMD", "Just watching this one.", properties={"builtin:thesis_status": "watching"})
    _project(A, n["id"])
    chip = _chips(A, ["AMD"])["AMD"]
    assert chip["thesisStatus"] == "watching"
    assert chip["stop"] is None and chip["entry"] is None and chip["target"] is None


# ── newest note wins ──────────────────────────────────────────────────────────────────

def test_the_most_recently_updated_live_note_wins(db_path, monkeypatch):
    older = _note(A, "TSLA", "Entry: 200", "Stop: 180", title="old thesis")
    _project(A, older["id"])
    newer = _note(A, "TSLA", "Entry: 250", "Stop: 230", title="new thesis")
    # Force a later updated_at than the first note's, deterministically.
    c = _conn()
    c.execute("UPDATE j2_notes SET updated_at = ? WHERE id = ? AND user_id = ?",
              ("2099-01-01T00:00:00Z", newer["id"], A))
    c.commit()
    c.close()
    _project(A, newer["id"])
    chip = _chips(A, ["TSLA"])["TSLA"]
    assert chip["title"] == "new thesis"
    assert chip["stop"] == 230.0


# ── absence, not a blank ──────────────────────────────────────────────────────────────

def test_a_symbol_with_no_note_is_absent_not_blank(db_path):
    n = _note(A, "NVDA", "Entry: 100", "Stop: 90")
    _project(A, n["id"])
    out = _chips(A, ["NVDA", "ZZZZ"])
    assert "ZZZZ" not in out
    assert "NVDA" in out


def test_another_members_note_never_leaks(db_path):
    n = _note(B, "NVDA", "Entry: 1", "Stop: 1")
    _project(B, n["id"])
    assert _chips(A, ["NVDA"]) == {}


# ── no new table, nothing for purge to take ──────────────────────────────────────────

def test_the_service_creates_no_table_of_its_own(db_path):
    """Reading j2_note_levels/j2_notes requires no DDL of this module's own -- the set of
    tables in the database is BYTE-IDENTICAL before and after a batch call (a diff, never
    a name guess: other wave's tables already contain the substrings "thesis"/"chip",
    which is exactly why a name-based check would be the wrong rail here)."""
    n = _note(A, "NVDA", "Entry: 100", "Stop: 90")
    _project(A, n["id"])

    def table_names():
        c = _conn()
        try:
            return {r[0] for r in c.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()}
        finally:
            c.close()

    before = table_names()
    _chips(A, ["NVDA"])
    after = table_names()
    assert after == before, (
        f"thesis_chips must read existing tables only -- it created {after - before}, "
        "which would need an account_purge entry this lane deliberately does not add")


# ── structural: no second flag read, no re-derivation of a plan level ────────────────

def test_thesis_chips_module_imports_no_plan_level_parser():
    """The 'never recomputed' claim, structurally: this module must not be able to
    re-derive a price level from a note's body -- it has no import edge to
    plan_extract or notebook_schema's body walkers."""
    src = (REPO / "api" / "services" / "journal_two" / "thesis_chips.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
        elif isinstance(node, ast.Import):
            for a in node.names:
                names.add(a.name)
    forbidden = {m for m in names if m.endswith("plan_extract") or m.endswith("notebook_schema")}
    assert not forbidden, f"thesis_chips.py must not import a body parser: {forbidden}"


def test_thesis_chips_reads_the_flag_through_the_one_parse_only():
    src = (REPO / "api" / "services" / "journal_two" / "thesis_chips.py").read_text(encoding="utf-8")
    assert "os.environ" not in src, "thesis_chips.py must read its flag through notebook_flags.flag_on only"
    assert "flag_on(FLAG" in src or "flag_on(\"NOTEBOOK_THESIS_CHIPS_ENABLED\"" in src
